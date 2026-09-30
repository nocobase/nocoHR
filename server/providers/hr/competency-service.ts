/**
 * V3-08 能力体系, the parts that sit between the framework (positions and
 * their requirements) and people:
 *
 * - 差距口径: gap = required − current level, over confirmed requirements
 *   only; a competency with no assessment counts as 0 and is marked
 *   `assessed: false` (shown as 未评定), distinct from an assessment of 0.
 * - 发展目标岗位 (拟任人员): a position an employee is prepared for without
 *   holding it; its 对标差距 uses the same rule. Setting one changes nothing
 *   about the employee's position, permissions or pay.
 * - 评定待办: one work item per employee for their department head, listing
 *   the mandatory competencies of their position and active targets that
 *   nobody has assessed yet. Raised when a position's requirements are first
 *   confirmed or a target is set; refreshed after every assessment.
 * - 评定导入: an Excel preview that names every row's problems, and a commit
 *   that adds `source=import` rows in one transaction without touching
 *   existing ones.
 * - 岗位说明书: attaching an uploaded file to a position and extracting its
 *   text in the background, for the framework advisor.
 * - The reference blocks on a transfer / promotion (审批页) and the change
 *   checklist's competencyGap items.
 *
 * Every read and write authorizes first and never inside a transaction.
 */
import type { NocoBaseDriveManager } from '@nocobase/drive';
import * as XLSX from 'xlsx';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import type {
  ChecklistProvider,
  ProviderContext,
} from './change-checklists.js';
import { documentKind, extractDocumentText } from './document-text.js';
import {
  toCompetency,
  toLevel,
  type ActorContext,
  type CompetencyLevel,
} from './framework-service.js';
import type { JobEvent } from './job-events.js';
import type { Platform } from './platform.js';
import { bool } from './platform.js';
import { HrError, isRecord, newId, requireString, str } from './shared.js';
import { createWorkItemStore } from './work-item-store.js';

const EMPLOYEE = 'talent.employee';
const ASSESSMENT = 'talent.assessment';
const TARGET = 'talent.developmentTarget';
const FRAMEWORK = 'talent.framework';

/** Extracted job descriptions are capped; the advisor reads at most this much. */
export const JD_TEXT_LIMIT = 20_000;
/** At most this many rows are read from one assessment import. */
export const IMPORT_ROW_LIMIT = 2000;
export const ASSESSMENT_IMPORT_HEADER = [
  '工号',
  '能力项编码',
  '等级',
  '依据',
  '评定日期',
] as const;

export interface CompetencyGapRow {
  competencyId: string;
  code: string;
  title: string;
  category: string;
  maxLevel: number;
  /** Null for an assessed competency the position does not require. */
  requiredLevel: number | null;
  mandatory: boolean;
  /** 0 when unassessed; see `assessed`. */
  currentLevel: number;
  /** False when the employee has no assessment for it (未评定). */
  assessed: boolean;
  gap: number;
  levels: CompetencyLevel[];
}

export interface GapSummary {
  /** Confirmed mandatory requirements with a gap. */
  mandatoryGaps: number;
  /** The sum of all gaps over confirmed requirements. */
  totalGap: number;
  /** Confirmed mandatory requirements without any assessment. */
  unassessedMandatory: number;
}

export interface DevelopmentTarget {
  id: string;
  employeeId: string;
  targetPositionId: string;
  reason: string | null;
  status: 'active' | 'achieved' | 'cancelled';
  createdBy: string;
  achievedAt: string | null;
  decisionActionId: string | null;
  createdAt: string;
}

export interface EmployeeCompetencyView {
  employee: { id: string; name: string; positionId: string | null };
  positionTitle: string | null;
  rows: CompetencyGapRow[];
  summary: GapSummary;
  targets: (DevelopmentTarget & {
    targetPositionTitle: string;
    rows: CompetencyGapRow[];
    summary: GapSummary;
  })[];
}

export interface CandidateRow extends DevelopmentTarget {
  employeeName: string;
  employeeNo: string;
  currentPositionTitle: string | null;
  departmentTitle: string;
  createdByName: string;
  summary: GapSummary;
}

export interface PositionGapBlock {
  positionId: string;
  positionTitle: string;
  /** Whether the caller may see the employee's assessments; without it only requirements are listed. */
  levelsVisible: boolean;
  rows: {
    competencyId: string;
    title: string;
    category: string;
    requiredLevel: number;
    currentLevel: number | null;
    assessed: boolean | null;
    gap: number | null;
  }[];
}

export interface ImportPreviewRow {
  row: number;
  employeeNo: string;
  employeeId: string | null;
  employeeName: string | null;
  competencyCode: string;
  competencyId: string | null;
  competencyTitle: string | null;
  level: number | null;
  evidence: string | null;
  assessedAt: string | null;
  errors: string[];
}

export interface CompetencyServiceDeps {
  readonly platform: Platform;
  readonly drive: () => NocoBaseDriveManager;
  /** Server wording in the application's default language. */
  readonly translate: (
    key: string,
    params: Record<string, string>,
  ) => Promise<string>;
  /** The talent service's own assessment rule (scope, self, level and competency checks). */
  readonly createAssessment: (
    ctx: ActorContext,
    employeeId: string,
    input: unknown,
  ) => Promise<unknown>;
  /** Runs work after the request, such as extracting a job description. */
  readonly background: (label: string, run: () => Promise<unknown>) => void;
}

interface Requirement {
  positionId: string;
  competencyId: string;
  requiredLevel: number;
  mandatory: boolean;
}

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(str(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTarget(row: Record<string, unknown>): DevelopmentTarget {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    targetPositionId: str(row.targetPositionId),
    reason: row.reason == null ? null : str(row.reason),
    status: str(row.status) as DevelopmentTarget['status'],
    createdBy: str(row.createdBy),
    achievedAt: iso(row.achievedAt),
    decisionActionId:
      row.decisionActionId == null ? null : str(row.decisionActionId),
    createdAt: iso(row.createdAt) ?? '',
  };
}

/** An import cell's date: `date` null for an empty cell; `invalid` for one that is not a calendar date. */
export interface ImportDate {
  readonly date: string | null;
  readonly invalid: boolean;
}

const INVALID_DATE: ImportDate = { date: null, invalid: true };

/** Reads a cell as the `YYYY-MM-DD` date it holds: an Excel serial, a Date or text. */
export function parseImportDate(value: unknown): ImportDate {
  if (value == null || value === '') return { date: null, invalid: false };
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? INVALID_DATE
      : { date: value.toISOString().slice(0, 10), invalid: false };
  if (typeof value === 'number') {
    const parsed = (
      XLSX.SSF as {
        parse_date_code(
          serial: number,
        ): { y: number; m: number; d: number } | null;
      }
    ).parse_date_code(value);
    if (!parsed) return INVALID_DATE;
    return {
      date: `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`,
      invalid: false,
    };
  }
  const text = str(value).trim().replace(/[/.]/gu, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/u.exec(text);
  if (!match) return INVALID_DATE;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() !== Number(match[2]) - 1 ||
    date.getUTCDate() !== Number(match[3])
  )
    return INVALID_DATE;
  return { date: date.toISOString().slice(0, 10), invalid: false };
}

/**
 * The gap rows of one requirement set against current levels (差距口径).
 * Mandatory requirements come first, then larger gaps; assessed competencies
 * outside the requirements follow when `extras` is set.
 */
export function computeGapRows(
  requirements: readonly Requirement[],
  levels: ReadonlyMap<string, number>,
  competencies: ReadonlyMap<
    string,
    {
      id: string;
      code: string;
      title: string;
      category: string;
      maxLevel: number;
    }
  >,
  levelTexts: ReadonlyMap<string, CompetencyLevel[]>,
  extras: boolean,
): CompetencyGapRow[] {
  const rows: CompetencyGapRow[] = [];
  for (const requirement of requirements) {
    const competency = competencies.get(requirement.competencyId);
    if (!competency) continue;
    const assessed = levels.has(requirement.competencyId);
    const currentLevel = levels.get(requirement.competencyId) ?? 0;
    rows.push({
      competencyId: competency.id,
      code: competency.code,
      title: competency.title,
      category: competency.category,
      maxLevel: competency.maxLevel,
      requiredLevel: requirement.requiredLevel,
      mandatory: requirement.mandatory,
      currentLevel,
      assessed,
      gap: Math.max(requirement.requiredLevel - currentLevel, 0),
      levels: levelTexts.get(competency.id) ?? [],
    });
  }
  if (extras)
    for (const [competencyId, level] of levels) {
      if (requirements.some((r) => r.competencyId === competencyId)) continue;
      const competency = competencies.get(competencyId);
      if (!competency) continue;
      rows.push({
        competencyId,
        code: competency.code,
        title: competency.title,
        category: competency.category,
        maxLevel: competency.maxLevel,
        requiredLevel: null,
        mandatory: false,
        currentLevel: level,
        assessed: true,
        gap: 0,
        levels: levelTexts.get(competencyId) ?? [],
      });
    }
  rows.sort(
    (a, b) =>
      Number(b.requiredLevel !== null) - Number(a.requiredLevel !== null) ||
      Number(b.mandatory) - Number(a.mandatory) ||
      b.gap - a.gap ||
      a.title.localeCompare(b.title),
  );
  return rows;
}

export function summarize(rows: readonly CompetencyGapRow[]): GapSummary {
  const required = rows.filter((r) => r.requiredLevel !== null);
  return {
    mandatoryGaps: required.filter((r) => r.mandatory && r.gap > 0).length,
    totalGap: required.reduce((sum, r) => sum + r.gap, 0),
    unassessedMandatory: required.filter((r) => r.mandatory && !r.assessed)
      .length,
  };
}

export function createCompetencyService(deps: CompetencyServiceDeps) {
  const { platform, translate } = deps;
  const { database, organization } = platform;

  async function can(
    ctx: ActorContext,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return (
      (await tryAuthorizeAction(ctx.authz, resource, action)) !== undefined
    );
  }

  /** The employee as the caller may see it (the employee view scope), or a 404. */
  async function visibleEmployee(ctx: ActorContext, employeeId: string) {
    const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'view');
    const row = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id: employeeId } });
    if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    const record = row as Record<string, unknown>;
    return {
      id: str(record.id),
      name: str(record.name),
      userId: record.userId == null ? null : str(record.userId),
      departmentId: str(record.departmentId),
      positionId: record.positionId == null ? null : str(record.positionId),
      status: str(record.status),
    };
  }

  /** The latest assessment per competency (取最新一条) for a set of employees. */
  async function currentLevels(
    employeeIds: readonly string[],
  ): Promise<Map<string, Map<string, number>>> {
    const result = new Map<string, Map<string, number>>();
    if (!employeeIds.length) return result;
    const rows = await database
      .query()
      .selectFrom('employeeCompetencies')
      .select([
        'employeeId',
        'competencyId',
        'level',
        'assessedAt',
        'createdAt',
      ])
      .where('employeeId', 'in', [...new Set(employeeIds)])
      .execute();
    const sorted = [...rows].sort(
      (a, b) =>
        new Date(str(a.assessedAt)).getTime() -
          new Date(str(b.assessedAt)).getTime() ||
        new Date(str(a.createdAt)).getTime() -
          new Date(str(b.createdAt)).getTime(),
    );
    for (const row of sorted) {
      const employeeId = str(row.employeeId);
      const levels = result.get(employeeId) ?? new Map<string, number>();
      levels.set(str(row.competencyId), Number(row.level));
      result.set(employeeId, levels);
    }
    return result;
  }

  async function confirmedRequirements(
    positionIds: readonly (string | null)[],
  ): Promise<Map<string, Requirement[]>> {
    const map = new Map<string, Requirement[]>();
    const clean = [
      ...new Set(positionIds.filter((id): id is string => Boolean(id))),
    ];
    if (!clean.length) return map;
    const rows = await database
      .query()
      .selectFrom('positionRequirements')
      .select(['positionId', 'competencyId', 'requiredLevel', 'mandatory'])
      .where('positionId', 'in', clean)
      .where('reviewStatus', '=', 'confirmed')
      .execute();
    for (const row of rows) {
      const requirement: Requirement = {
        positionId: str(row.positionId),
        competencyId: str(row.competencyId),
        requiredLevel: Number(row.requiredLevel),
        mandatory: bool(row.mandatory),
      };
      map.set(requirement.positionId, [
        ...(map.get(requirement.positionId) ?? []),
        requirement,
      ]);
    }
    return map;
  }

  async function competencyCatalog(ids: readonly string[]) {
    const competencies = new Map<
      string,
      {
        id: string;
        code: string;
        title: string;
        category: string;
        maxLevel: number;
      }
    >();
    const levels = new Map<string, CompetencyLevel[]>();
    const clean = [...new Set(ids)];
    if (!clean.length) return { competencies, levels };
    for (const row of await database
      .query()
      .selectFrom('competencies')
      .select([
        'id',
        'code',
        'title',
        'category',
        'description',
        'maxLevel',
        'source',
        'reviewStatus',
        'active',
      ])
      .where('id', 'in', clean)
      .execute()) {
      const competency = toCompetency(row);
      competencies.set(competency.id, competency);
    }
    for (const row of await database
      .query()
      .selectFrom('competencyLevels')
      .select(['id', 'competencyId', 'level', 'title', 'behaviors'])
      .where('competencyId', 'in', clean)
      .orderBy('level', 'asc')
      .execute()) {
      const level = toLevel(row);
      levels.set(level.competencyId, [
        ...(levels.get(level.competencyId) ?? []),
        level,
      ]);
    }
    return { competencies, levels };
  }

  async function positionTitles(
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const clean = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!clean.length) return new Map();
    const rows = await database
      .query()
      .selectFrom('positions')
      .select(['id', 'title'])
      .where('id', 'in', clean)
      .execute();
    return new Map(rows.map((r) => [str(r.id), str(r.title)]));
  }

  /** Gap rows for many (employee, position) pairs with one read of each table. */
  async function gapsFor(
    pairs: readonly { employeeId: string; positionId: string | null }[],
    extras: boolean,
  ): Promise<Map<string, CompetencyGapRow[]>> {
    const requirements = await confirmedRequirements(
      pairs.map((p) => p.positionId),
    );
    const levels = await currentLevels(pairs.map((p) => p.employeeId));
    const ids = new Set<string>();
    for (const list of requirements.values())
      for (const r of list) ids.add(r.competencyId);
    if (extras)
      for (const map of levels.values())
        for (const id of map.keys()) ids.add(id);
    const catalog = await competencyCatalog([...ids]);
    const result = new Map<string, CompetencyGapRow[]>();
    for (const pair of pairs)
      result.set(
        `${pair.employeeId}:${pair.positionId ?? ''}`,
        computeGapRows(
          pair.positionId ? (requirements.get(pair.positionId) ?? []) : [],
          levels.get(pair.employeeId) ?? new Map(),
          catalog.competencies,
          catalog.levels,
          extras,
        ),
      );
    return result;
  }

  async function activeTargetsOf(
    employeeIds: readonly string[],
  ): Promise<DevelopmentTarget[]> {
    if (!employeeIds.length) return [];
    return (
      await database
        .query()
        .selectFrom('developmentTargets')
        .selectAll()
        .where('employeeId', 'in', [...new Set(employeeIds)])
        .where('status', '=', 'active')
        .execute()
    ).map(toTarget);
  }

  /**
   * Brings one employee's assessment to-do in line: the mandatory
   * competencies of their position and active targets nobody has assessed.
   * With `create` false an absent to-do is not raised, only updated or closed.
   */
  async function refreshTodo(
    employeeId: string,
    options: { create: boolean },
  ): Promise<boolean> {
    const employee = await platform.employee(employeeId);
    if (!employee || employee.status === 'leave') return false;
    const targets = await activeTargetsOf([employeeId]);
    const positionIds = [
      employee.positionId || null,
      ...targets.map((t) => t.targetPositionId),
    ];
    const requirements = await confirmedRequirements(positionIds);
    const levels =
      (await currentLevels([employeeId])).get(employeeId) ?? new Map();
    const missing = new Set<string>();
    for (const id of positionIds) {
      if (!id) continue;
      for (const r of requirements.get(id) ?? [])
        if (r.mandatory && !levels.has(r.competencyId))
          missing.add(r.competencyId);
    }
    const head = await platform.headOf(employee);
    const existing = await database
      .query()
      .selectFrom('workItems')
      .select(['id', 'recipientUserId'])
      .where('type', '=', 'assessmentTodo')
      .where('refType', '=', 'employee')
      .where('refId', '=', employeeId)
      .where('status', '=', 'open')
      .execute();
    const stamp = new Date();
    // A to-do addressed to someone who no longer heads the employee, or with nothing left, is done.
    const stale = existing.filter(
      (row) => !missing.size || str(row.recipientUserId) !== head,
    );
    if (stale.length)
      await database
        .query()
        .updateTable('workItems')
        .set({ status: 'done', doneAt: stamp, updatedAt: stamp })
        .where(
          'id',
          'in',
          stale.map((row) => str(row.id)),
        )
        .execute();
    if (!missing.size || !head) return false;
    const current = existing.some((row) => str(row.recipientUserId) === head);
    if (!current && !options.create) return false;
    const catalog = await competencyCatalog([...missing]);
    const titles = [...missing]
      .map((id) => catalog.competencies.get(id)?.title ?? id)
      .sort((a, b) => a.localeCompare(b));
    const title = (
      await translate('competency.assessmentTodo.title', {
        name: employee.name,
      })
    ).slice(0, 255);
    const summary = (
      await translate('competency.assessmentTodo.summary', {
        competencies: titles.join('、'),
        count: String(titles.length),
      })
    ).slice(0, 500);
    await database.transaction(async (connection) => {
      // Reopening: a to-do an earlier refresh closed is replaced by a fresh one.
      await connection.query
        .deleteFrom('workItems')
        .where('type', '=', 'assessmentTodo')
        .where('refType', '=', 'employee')
        .where('refId', '=', employeeId)
        .where('recipientUserId', '=', head)
        .where('status', '!=', 'open')
        .execute();
      await createWorkItemStore(connection).put({
        recipientUserId: head,
        type: 'assessmentTodo',
        refType: 'employee',
        refId: employeeId,
        title,
        summary,
        link: `/talent/employees/${encodeURIComponent(employeeId)}/abilities`,
        sourceKind: 'rule',
      });
    });
    return true;
  }

  async function refreshTodos(
    employeeIds: readonly string[],
    options: { create: boolean },
  ): Promise<number> {
    let raised = 0;
    for (const id of [...new Set(employeeIds)])
      if (await refreshTodo(id, options)) raised += 1;
    return raised;
  }

  async function readPosition(positionId: string) {
    const row = await database
      .query()
      .selectFrom('positions')
      .select(['id', 'title', 'active'])
      .where('id', '=', positionId)
      .executeTakeFirst();
    return row
      ? { id: str(row.id), title: str(row.title), active: bool(row.active) }
      : undefined;
  }

  /** Reads one requirement sheet into rows; the header row is matched by name. */
  function readSheet(bytes: Uint8Array): Record<string, unknown>[] {
    let book: XLSX.WorkBook;
    try {
      book = XLSX.read(bytes, { type: 'array', cellDates: true });
    } catch {
      throw new HrError('IMPORT_FILE_UNREADABLE', 400);
    }
    const sheet = book.Sheets[book.SheetNames[0] ?? ''];
    if (!sheet) throw new HrError('IMPORT_FILE_EMPTY', 400);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: '',
      raw: true,
    });
    if (!rows.length) throw new HrError('IMPORT_FILE_EMPTY', 400);
    if (rows.length > IMPORT_ROW_LIMIT)
      throw new HrError('IMPORT_TOO_MANY_ROWS', 400, {
        limit: IMPORT_ROW_LIMIT,
      });
    const header = Object.keys(rows[0] ?? {});
    for (const column of ASSESSMENT_IMPORT_HEADER.slice(0, 3))
      if (!header.includes(column))
        throw new HrError('IMPORT_HEADER_INVALID', 400, {
          expected: [...ASSESSMENT_IMPORT_HEADER],
        });
    return rows;
  }

  async function validateImport(
    ctx: ActorContext,
    bytes: Uint8Array,
  ): Promise<ImportPreviewRow[]> {
    const sheet = readSheet(bytes);
    const employees = new Map(
      (
        await database
          .query()
          .selectFrom('employees')
          .select(['id', 'employeeNo', 'name', 'userId', 'status'])
          .execute()
      ).map((row) => [str(row.employeeNo), row]),
    );
    const competencies = new Map(
      (
        await database
          .query()
          .selectFrom('competencies')
          .select(['id', 'code', 'title', 'maxLevel', 'reviewStatus', 'active'])
          .execute()
      ).map((row) => [str(row.code), row]),
    );
    const todayDate = platform.currentDate();
    return sheet.map((raw, index) => {
      const errors: string[] = [];
      const employeeNo = str(raw['工号'] ?? '').trim();
      const competencyCode = str(raw['能力项编码'] ?? '').trim();
      const employee = employees.get(employeeNo);
      const competency = competencies.get(competencyCode);
      if (!employee) errors.push('employeeNotFound');
      else if (employee.userId && str(employee.userId) === ctx.userId)
        errors.push('self');
      if (!competency) errors.push('competencyNotFound');
      else if (!bool(competency.active)) errors.push('competencyInactive');
      else if (competency.reviewStatus !== 'confirmed')
        errors.push('competencyDraft');
      const rawLevel = raw['等级'];
      const level =
        rawLevel === '' || rawLevel == null ? Number.NaN : Number(rawLevel);
      if (!Number.isInteger(level) || level < 0) errors.push('levelInvalid');
      else if (competency && level > Number(competency.maxLevel))
        errors.push('levelAboveMax');
      const { date, invalid } = parseImportDate(raw['评定日期']);
      if (invalid) errors.push('dateInvalid');
      else if (date && date > todayDate) errors.push('dateInFuture');
      const evidence = str(raw['依据'] ?? '').trim();
      if (evidence.length > 4000) errors.push('evidenceTooLong');
      return {
        row: index + 2,
        employeeNo,
        employeeId: employee ? str(employee.id) : null,
        employeeName: employee ? str(employee.name) : null,
        competencyCode,
        competencyId: competency ? str(competency.id) : null,
        competencyTitle: competency ? str(competency.title) : null,
        level: Number.isInteger(level) ? level : null,
        evidence: evidence || null,
        assessedAt: date,
        errors,
      };
    });
  }

  const service = {
    computeGapRows,

    /** 能力 Tab: the current position's gaps, the assessment-free extras, and every active target. */
    async employeeView(
      ctx: ActorContext,
      employeeId: string,
    ): Promise<EmployeeCompetencyView> {
      const employee = await visibleEmployee(ctx, employeeId);
      const targetPolicies = await tryAuthorizeAction(
        ctx.authz,
        TARGET,
        'view',
      );
      const targets = targetPolicies
        ? (
            await database
              .repository('developmentTargets')
              .withPolicy(policyOf(targetPolicies, 'developmentTargets'))
              .findMany({
                filter: { employeeId, status: 'active' },
                sort: (s) => [s.field('createdAt').asc()],
              })
          ).map((r) => toTarget(r as Record<string, unknown>))
        : [];
      const gaps = await gapsFor(
        [
          { employeeId, positionId: employee.positionId },
          ...targets.map((t) => ({
            employeeId,
            positionId: t.targetPositionId,
          })),
        ],
        false,
      );
      const withExtras = await gapsFor(
        [{ employeeId, positionId: employee.positionId }],
        true,
      );
      const rows =
        withExtras.get(`${employeeId}:${employee.positionId ?? ''}`) ?? [];
      const titles = await positionTitles([
        employee.positionId,
        ...targets.map((t) => t.targetPositionId),
      ]);
      return {
        employee: {
          id: employee.id,
          name: employee.name,
          positionId: employee.positionId,
        },
        positionTitle: employee.positionId
          ? (titles.get(employee.positionId) ?? null)
          : null,
        rows,
        summary: summarize(rows),
        targets: targets.map((target) => {
          const targetRows =
            gaps.get(`${employeeId}:${target.targetPositionId}`) ?? [];
          return {
            ...target,
            targetPositionTitle:
              titles.get(target.targetPositionId) ?? target.targetPositionId,
            rows: targetRows,
            summary: summarize(targetRows),
          };
        }),
      };
    },

    /** 待补能力数 for a set of employees: confirmed mandatory requirements of their position with a gap. */
    async pendingCounts(
      employees: readonly { id: string; positionId: string | null }[],
    ): Promise<Map<string, number>> {
      const gaps = await gapsFor(
        employees.map((e) => ({ employeeId: e.id, positionId: e.positionId })),
        false,
      );
      return new Map(
        employees.map((e) => [
          e.id,
          summarize(gaps.get(`${e.id}:${e.positionId ?? ''}`) ?? [])
            .mandatoryGaps,
        ]),
      );
    },

    /**
     * 新岗位的必备能力与当前差距 for a transfer or promotion: the target
     * position's confirmed mandatory requirements, with the employee's levels
     * when the caller may read their assessments. Reference only.
     */
    async actionGap(
      ctx: ActorContext,
      actionId: string,
    ): Promise<PositionGapBlock | null> {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.personnelAction',
        'view',
      );
      const action = (await database
        .repository('personnelActions')
        .withPolicy(policyOf(policies, 'personnelActions'))
        .findOne({ filter: { id: actionId } })) as Record<
        string,
        unknown
      > | null;
      if (!action) throw new HrError('ACTION_NOT_FOUND', 404);
      if (
        !['transfer', 'promote'].includes(str(action.actionType)) ||
        !action.toPositionId ||
        !action.employeeId
      )
        return null;
      return service.positionGap(
        ctx,
        str(action.employeeId),
        str(action.toPositionId),
        { trustedEmployee: true },
      );
    },

    /** The same block for an employee and a position the caller picked (the transfer form). */
    async positionGap(
      ctx: ActorContext,
      employeeId: string,
      positionId: string,
      options: { trustedEmployee?: boolean } = {},
    ): Promise<PositionGapBlock> {
      if (!options.trustedEmployee) await visibleEmployee(ctx, employeeId);
      const position = await readPosition(positionId);
      if (!position) throw new HrError('POSITION_NOT_FOUND', 404);
      const requirements = (
        (await confirmedRequirements([positionId])).get(positionId) ?? []
      ).filter((r) => r.mandatory);
      // Levels only for a caller who may read this employee's assessments.
      const assessmentPolicies = await tryAuthorizeAction(
        ctx.authz,
        ASSESSMENT,
        'view',
      );
      let levelsVisible = false;
      if (assessmentPolicies) {
        const own = await database
          .query()
          .selectFrom('employeeCompetencies')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .limit(1)
          .execute();
        if (!own.length) levelsVisible = true;
        else {
          const visible = await database
            .repository('employeeCompetencies')
            .withPolicy(policyOf(assessmentPolicies, 'employeeCompetencies'))
            .findMany({ filter: { employeeId }, limit: 1 });
          levelsVisible = visible.length > 0;
        }
      }
      const levels = levelsVisible
        ? ((await currentLevels([employeeId])).get(employeeId) ??
          new Map<string, number>())
        : new Map<string, number>();
      const catalog = await competencyCatalog(
        requirements.map((r) => r.competencyId),
      );
      const rows = requirements
        .map((r) => {
          const competency = catalog.competencies.get(r.competencyId);
          const assessed = levels.has(r.competencyId);
          const current = levels.get(r.competencyId) ?? 0;
          return {
            competencyId: r.competencyId,
            title: competency?.title ?? r.competencyId,
            category: competency?.category ?? 'skill',
            requiredLevel: r.requiredLevel,
            currentLevel: levelsVisible ? current : null,
            assessed: levelsVisible ? assessed : null,
            gap: levelsVisible ? Math.max(r.requiredLevel - current, 0) : null,
          };
        })
        .sort(
          (a, b) =>
            (b.gap ?? 0) - (a.gap ?? 0) || a.title.localeCompare(b.title),
        );
      return {
        positionId,
        positionTitle: position.title,
        levelsVisible,
        rows,
      };
    },

    // ---------- 发展目标岗位 ----------

    /** 拟任人员 Tab: the active targets for a position the caller may see, smallest 对标差距 first. */
    async listCandidates(
      ctx: ActorContext,
      positionId: string,
    ): Promise<{ items: CandidateRow[]; canManage: boolean }> {
      const policies = await authorizeAction(ctx.authz, TARGET, 'view');
      const targets = (
        await database
          .repository('developmentTargets')
          .withPolicy(policyOf(policies, 'developmentTargets'))
          .findMany({
            filter: { targetPositionId: positionId, status: 'active' },
          })
      ).map((r) => toTarget(r as Record<string, unknown>));
      const employees = targets.length
        ? await database
            .query()
            .selectFrom('employees')
            .select(['id', 'name', 'employeeNo', 'positionId', 'departmentId'])
            .where(
              'id',
              'in',
              targets.map((t) => t.employeeId),
            )
            .execute()
        : [];
      const byId = new Map(employees.map((e) => [str(e.id), e]));
      const gaps = await gapsFor(
        targets.map((t) => ({ employeeId: t.employeeId, positionId })),
        false,
      );
      const titles = await positionTitles(
        employees.map((e) => (e.positionId == null ? null : str(e.positionId))),
      );
      const items: CandidateRow[] = [];
      for (const target of targets) {
        const employee = byId.get(target.employeeId);
        const department = employee
          ? await organization.getDepartment(str(employee.departmentId))
          : undefined;
        items.push({
          ...target,
          employeeName: employee ? str(employee.name) : target.employeeId,
          employeeNo: employee ? str(employee.employeeNo) : '',
          currentPositionTitle:
            employee?.positionId == null
              ? null
              : (titles.get(str(employee.positionId)) ?? null),
          departmentTitle: department
            ? organization.titleText(department.title)
            : '',
          createdByName:
            (await platform.userName(target.createdBy)) ?? target.createdBy,
          summary: summarize(
            gaps.get(`${target.employeeId}:${positionId}`) ?? [],
          ),
        });
      }
      items.sort(
        (a, b) =>
          a.summary.mandatoryGaps - b.summary.mandatoryGaps ||
          a.summary.totalGap - b.summary.totalGap ||
          a.employeeName.localeCompare(b.employeeName),
      );
      return { items, canManage: await can(ctx, TARGET, 'manage') };
    },

    async setTarget(
      ctx: ActorContext,
      input: unknown,
    ): Promise<DevelopmentTarget & { todoRaised: boolean }> {
      const policies = await authorizeAction(ctx.authz, TARGET, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const employeeId = requireString(
        input.employeeId,
        'TARGET_EMPLOYEE_REQUIRED',
        {
          max: 64,
        },
      )!;
      const targetPositionId = requireString(
        input.targetPositionId,
        'TARGET_POSITION_REQUIRED',
        { max: 64 },
      )!;
      const reason = requireString(input.reason, 'INVALID_INPUT', {
        optional: true,
        max: 200,
      });
      const employee = await platform.employee(employeeId);
      if (!employee || employee.status === 'leave')
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const position = await readPosition(targetPositionId);
      if (!position || !position.active)
        throw new HrError('POSITION_NOT_FOUND', 404);
      if (employee.positionId === targetPositionId)
        throw new HrError('TARGET_IS_CURRENT_POSITION', 409);
      const now = new Date();
      // Scope (the employee is in a managed department, or the target position is held in one) is the
      // developmentTargets record scope; the new row is checked against it below, out of scope reading as not found.
      const { record } = await database
        .repository('developmentTargets')
        .withPolicy(policyOf(policies, 'developmentTargets'))
        .createOne({
          values: {
            id: newId(),
            employeeId,
            targetPositionId,
            reason,
            status: 'active',
            createdBy: ctx.userId,
            achievedAt: null,
            cancelledAt: null,
            cancelledBy: null,
            decisionActionId: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      const created = toTarget(record);
      // Read it back through the same scope: a target outside the caller's departments is taken back.
      const visible = await database
        .repository('developmentTargets')
        .withPolicy(policyOf(policies, 'developmentTargets'))
        .findOne({ filter: { id: created.id } });
      if (!visible) {
        await database
          .query()
          .deleteFrom('developmentTargets')
          .where('id', '=', created.id)
          .execute();
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      }
      // One active target per employee and position: a second one (also a concurrent twin) is taken back.
      const active = await database
        .query()
        .selectFrom('developmentTargets')
        .select(['id', 'createdAt'])
        .where('employeeId', '=', employeeId)
        .where('targetPositionId', '=', targetPositionId)
        .where('status', '=', 'active')
        .execute();
      const mine = now.getTime();
      const earlier = active.some((row) => {
        if (str(row.id) === created.id) return false;
        const at = new Date(str(row.createdAt)).getTime();
        // Of two twins created at once, the one with the smaller id stays.
        return at < mine || (at === mine && str(row.id) < created.id);
      });
      if (earlier) {
        await database
          .query()
          .deleteFrom('developmentTargets')
          .where('id', '=', created.id)
          .execute();
        throw new HrError('TARGET_EXISTS', 409);
      }
      const todoRaised = await refreshTodo(employeeId, { create: true });
      return { ...created, todoRaised };
    },

    async cancelTarget(
      ctx: ActorContext,
      id: string,
    ): Promise<DevelopmentTarget> {
      const policies = await authorizeAction(ctx.authz, TARGET, 'manage');
      const repo = database
        .repository('developmentTargets')
        .withPolicy(policyOf(policies, 'developmentTargets'));
      const current = (await repo.findOne({ filter: { id } })) as Record<
        string,
        unknown
      > | null;
      if (!current) throw new HrError('TARGET_NOT_FOUND', 404);
      if (current.status !== 'active')
        throw new HrError('TARGET_NOT_ACTIVE', 409);
      const now = new Date();
      const { record } = await repo.updateOne({
        filter: { id },
        values: {
          status: 'cancelled',
          cancelledAt: now,
          cancelledBy: ctx.userId,
          updatedAt: now,
        },
      });
      await refreshTodo(str(current.employeeId), { create: false });
      return toTarget(record);
    },

    // ---------- 评定 ----------

    /** Adds an assessment through the talent service's rule, then updates the employee's to-do. */
    async assess(ctx: ActorContext, employeeId: string, input: unknown) {
      const result = await deps.createAssessment(ctx, employeeId, input);
      await refreshTodo(employeeId, { create: false });
      return result;
    },

    async authorizeImport(ctx: ActorContext): Promise<void> {
      await authorizeAction(ctx.authz, ASSESSMENT, 'import');
    },

    async previewImport(ctx: ActorContext, bytes: Uint8Array) {
      await authorizeAction(ctx.authz, ASSESSMENT, 'import');
      const rows = await validateImport(ctx, bytes);
      return {
        rows,
        valid: rows.filter((r) => !r.errors.length).length,
        invalid: rows.filter((r) => r.errors.length).length,
      };
    },

    /** Adds every row as `source=import` in one transaction; any invalid row refuses the whole file. */
    async commitImport(
      ctx: ActorContext,
      bytes: Uint8Array,
    ): Promise<{ created: number }> {
      const policies = await authorizeAction(ctx.authz, ASSESSMENT, 'import');
      const policy = policyOf(policies, 'employeeCompetencies');
      const rows = await validateImport(ctx, bytes);
      const invalid = rows.filter((r) => r.errors.length);
      if (invalid.length)
        throw new HrError('IMPORT_HAS_ERRORS', 400, {
          rows: invalid.map((r) => ({ row: r.row, errors: r.errors })),
        });
      const now = new Date();
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('employeeCompetencies')
          .withPolicy(policy);
        for (const row of rows) {
          await repo.createOne({
            values: {
              id: newId(),
              employeeId: row.employeeId!,
              competencyId: row.competencyId!,
              level: row.level!,
              source: 'import',
              evidence: row.evidence,
              assessedBy: ctx.userId,
              // A file date is the day it was assessed; noon keeps it on that day in every time zone.
              assessedAt: row.assessedAt
                ? new Date(`${row.assessedAt}T12:00:00Z`)
                : now,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
      });
      await refreshTodos(
        rows.map((r) => r.employeeId!),
        { create: false },
      );
      return { created: rows.length };
    },

    importTemplate(): Buffer {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([[...ASSESSMENT_IMPORT_HEADER]]),
        'assessments',
      );
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    },

    // ---------- 岗位说明书 ----------

    /** Attaches an uploaded file as the position's job description and extracts its text in the background. */
    async attachJobDescription(
      ctx: ActorContext,
      positionId: string,
      input: unknown,
    ) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const fileId = requireString(input.fileId, 'JD_FILE_REQUIRED', {
        max: 64,
      })!;
      const file = await database
        .query()
        .selectFrom('hrFiles')
        .select(['id', 'filename', 'mimeType'])
        .where('id', '=', fileId)
        .executeTakeFirst();
      if (!file) throw new HrError('JD_FILE_REQUIRED', 404);
      if (!documentKind(str(file.filename), str(file.mimeType)))
        throw new HrError('DOCUMENT_TYPE_UNSUPPORTED', 400);
      const { record } = await database
        .repository('positions')
        .withPolicy(policyOf(policies, 'positions'))
        .updateOne({
          filter: { id: positionId },
          values: {
            jdFileId: fileId,
            jdFilename: str(file.filename).slice(0, 255),
            jdText: null,
            jdStatus: 'pending',
            jdError: null,
            updatedAt: new Date(),
          },
        });
      deps.background('framework.extractJobDescription', () =>
        service.extractJobDescription(positionId),
      );
      return {
        id: str((record as Record<string, unknown>).id),
        jdFileId: fileId,
        jdFilename: str(file.filename),
        jdStatus: 'pending' as const,
      };
    },

    /** Extracts a pending job description; a replaced file in the meantime wins. */
    async extractJobDescription(
      positionId: string,
    ): Promise<'ready' | 'failed' | 'skipped'> {
      const position = await database
        .query()
        .selectFrom('positions')
        .select(['id', 'jdFileId', 'jdStatus'])
        .where('id', '=', positionId)
        .executeTakeFirst();
      if (!position?.jdFileId || position.jdStatus !== 'pending')
        return 'skipped';
      const fileId = str(position.jdFileId);
      const finish = async (values: Record<string, unknown>) =>
        database
          .query()
          .updateTable('positions')
          .set({ ...values, updatedAt: new Date() })
          .where('id', '=', positionId)
          .where('jdFileId', '=', fileId)
          .where('jdStatus', '=', 'pending')
          .execute();
      try {
        const file = await database
          .query()
          .selectFrom('hrFiles')
          .select(['disk', 'key', 'filename', 'mimeType'])
          .where('id', '=', fileId)
          .executeTakeFirst();
        if (!file) throw new HrError('DOCUMENT_FILE_MISSING', 400);
        const kind = documentKind(str(file.filename), str(file.mimeType));
        if (!kind) throw new HrError('DOCUMENT_TYPE_UNSUPPORTED', 400);
        const bytes = await deps
          .drive()
          .use(str(file.disk))
          .getBytes(str(file.key));
        const text = await extractDocumentText(bytes, kind);
        await finish({
          jdText: text.slice(0, JD_TEXT_LIMIT),
          jdStatus: 'ready',
          jdError: null,
        });
        return 'ready';
      } catch (error) {
        await finish({
          jdStatus: 'failed',
          jdError:
            error instanceof HrError ? error.code : 'DOCUMENT_UNREADABLE',
        });
        return 'failed';
      }
    },

    // ---------- Events ----------

    /** 岗位要求首次整体确认: to-dos for the incumbents and candidates of each position. */
    async onRequirementsFirstConfirmed(positionIds: readonly string[]) {
      if (!positionIds.length) return 0;
      const incumbents = await database
        .query()
        .selectFrom('employees')
        .select(['id'])
        .where('positionId', 'in', [...positionIds])
        .where('status', '!=', 'leave')
        .execute();
      const candidates = await database
        .query()
        .selectFrom('developmentTargets')
        .select(['employeeId'])
        .where('targetPositionId', 'in', [...positionIds])
        .where('status', '=', 'active')
        .execute();
      return refreshTodos(
        [
          ...incumbents.map((r) => str(r.id)),
          ...candidates.map((r) => str(r.employeeId)),
        ],
        { create: true },
      );
    },

    /**
     * 员工岗位变化: an active target for the new position is achieved, linked
     * to the action that decided it; the to-do follows the new position.
     */
    async onJobEvent(event: JobEvent): Promise<void> {
      if (!event.toPositionId || event.eventType === 'offboard') {
        if (event.eventType === 'offboard')
          await refreshTodo(event.employeeId, { create: false });
        return;
      }
      if (event.toPositionId === event.fromPositionId) return;
      const now = new Date();
      await database
        .query()
        .updateTable('developmentTargets')
        .set({
          status: 'achieved',
          achievedAt: now,
          decisionActionId: event.actionId,
          updatedAt: now,
        })
        .where('employeeId', '=', event.employeeId)
        .where('targetPositionId', '=', event.toPositionId)
        .where('status', '=', 'active')
        .execute();
      await refreshTodo(event.employeeId, { create: false });
    },

    /** 变动影响清单 · 能力差距: the new position's mandatory requirements with a gap or no assessment. */
    checklistProvider(): ChecklistProvider {
      return {
        key: 'competencyGap',
        kinds: ['change'],
        items: async (context: ProviderContext) => {
          const positionId =
            context.action?.toPositionId ?? context.event?.toPositionId;
          const employeeId = context.employee?.id;
          if (!positionId || !employeeId) return [];
          if (context.employee?.positionId === positionId && !context.effective)
            return [];
          const requirements = (
            (await confirmedRequirements([positionId])).get(positionId) ?? []
          ).filter((r) => r.mandatory);
          if (!requirements.length) return [];
          const levels =
            (await currentLevels([employeeId])).get(employeeId) ?? new Map();
          const catalog = await competencyCatalog(
            requirements.map((r) => r.competencyId),
          );
          return requirements
            .filter(
              (r) =>
                !levels.has(r.competencyId) ||
                (levels.get(r.competencyId) ?? 0) < r.requiredLevel,
            )
            .map((r) => {
              const title =
                catalog.competencies.get(r.competencyId)?.title ??
                r.competencyId;
              const assessed = levels.has(r.competencyId);
              return {
                key: `competencyGap:${r.competencyId}`,
                code: assessed ? 'competencyGap' : 'competencyGapUnassessed',
                params: {
                  competency: title,
                  required: String(r.requiredLevel),
                  current: assessed ? String(levels.get(r.competencyId)) : '',
                },
                status: 'todo' as const,
                link: `/talent/employees/${encodeURIComponent(employeeId)}/abilities`,
              };
            });
        },
      };
    },
  };
  return service;
}

export type CompetencyService = ReturnType<typeof createCompetencyService>;

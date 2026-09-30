/**
 * V3-11 画像、找人与看板:
 *
 * - AI 画像摘要: at most 150 characters, certificates and position fit
 *   first, then recent changes; every sentence cites the facts behind it
 *   (`aiSummaryEvidence`). Built from counts and categories only — never a
 *   quality issue's description. The talent analyst words it when a model is
 *   available; otherwise a template does. Readers: oneself, heads within
 *   scope, HR; regenerating: heads within scope and HR.
 * - 成长时间线 with business data (quality issues, tickets, projects).
 * - 自然语言找人: a sentence becomes structured conditions (shown and
 *   editable), searched within the caller's scope, each result with why it
 *   matched; with no result, the strictest condition is named.
 * - 团队能力看板: certificate matrix, gap heat map, problem-record trend and
 *   learning progress, within scope, exportable.
 */
import * as XLSX from 'xlsx';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { json } from '../platform.js';
import { addDays, HrError, str } from '../shared.js';
import {
  dateOnly,
  daysBefore,
  iso,
  isActive,
  nullable,
  onOrAfter,
  toPerson,
  type LevelRow,
  type PersonRow,
  type ProfileDeps,
  type ProfileReads,
} from './context.js';
import { PROBLEM_TYPES, type SignalService } from './signals.js';

const SUMMARY = 'talent.profileSummary';
const DASHBOARD = 'talent.teamDashboard';
const FIND = 'talent.findPeople';
export const SUMMARY_MAX = 150;

export interface SummaryFact {
  readonly id: string;
  readonly type:
    | 'position'
    | 'certificate'
    | 'gap'
    | 'assessment'
    | 'course'
    | 'exam'
    | 'signal';
  readonly refId: string;
  readonly label: string;
}

export interface SummarySentence {
  readonly text: string;
  readonly evidence: readonly SummaryFact[];
}

export interface ProfileSummaryView {
  readonly employeeId: string;
  readonly summary: string | null;
  readonly generatedAt: string | null;
  readonly sentences: readonly SummarySentence[];
  readonly canRegenerate: boolean;
}

export interface FindConditions {
  departmentIds: string[];
  positionIds: string[];
  certifications: { certificationId: string; status: 'valid' | 'any' }[];
  competencies: {
    competencyId: string;
    minLevel: number | null;
    maxLevel: number | null;
  }[];
  signals: {
    mode: 'none' | 'some';
    types: string[];
    withinDays: number;
  } | null;
  activeOnly: boolean;
}

export type CertState = 'valid' | 'expiring' | 'expired' | 'missing';

/** A certification's state for one person: the stored status, with an expiry already past counted as expired. */
export function certState(
  certificates: readonly {
    certificationId: string;
    status: string;
    expiresAt: string | null;
    id: string;
  }[],
  certificationId: string,
  today: string,
): {
  state: CertState;
  certificateId: string | null;
  expiresAt: string | null;
} {
  const own = certificates.filter((c) => c.certificationId === certificationId);
  const holding = own.find(
    (c) =>
      (c.status === 'valid' || c.status === 'expiring') &&
      (!c.expiresAt || c.expiresAt >= today),
  );
  if (holding)
    return {
      state: holding.status === 'expiring' ? 'expiring' : 'valid',
      certificateId: holding.id,
      expiresAt: holding.expiresAt,
    };
  const last = own[0];
  if (last)
    return {
      state: 'expired',
      certificateId: last.id,
      expiresAt: last.expiresAt,
    };
  return { state: 'missing', certificateId: null, expiresAt: null };
}

const TYPE_LABEL: Record<string, string> = {
  qualityIssue: '质量问题',
  correctiveAction: '纠正措施',
  ticketResolved: '工单解决',
  ticketReopened: '工单重开',
  ticketEscalated: '工单升级',
  taskDelivered: '按期交付',
  taskDelayed: '任务延期',
};

export function createProfileInsights(
  deps: ProfileDeps,
  reads: ProfileReads,
  signals: SignalService,
) {
  const { platform } = deps;
  const { database, organization } = platform;

  async function scopedEmployee(
    ctx: ActorContext,
    resource: string,
    action: string,
    employeeId: string,
  ): Promise<PersonRow> {
    const policies = await authorizeAction(ctx.authz, resource, action);
    const row = (await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id: employeeId } })) as
      Record<string, unknown> | undefined;
    if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    return toPerson(row);
  }

  async function scopedEmployees(
    ctx: ActorContext,
    resource: string,
    action: string,
  ): Promise<PersonRow[]> {
    const policies = await authorizeAction(ctx.authz, resource, action);
    return (
      (await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({})) as Record<string, unknown>[]
    ).map(toPerson);
  }

  /** The facts a summary may cite: rule reads, no descriptions. */
  async function facts(employee: PersonRow): Promise<SummaryFact[]> {
    const out: SummaryFact[] = [];
    const today = platform.currentDate();
    const positions = await reads.positions();
    const competencies = await reads.competencies();
    if (employee.positionId)
      out.push({
        id: 'position',
        type: 'position',
        refId: employee.positionId,
        label: `岗位：${positions.get(employee.positionId) ?? ''}`,
      });
    const required =
      (await reads.requiredCertifications()).get(employee.positionId ?? '') ??
      [];
    const certificates = await reads.certificates([employee.id]);
    for (const [i, certification] of required.entries()) {
      const state = certState(certificates, certification.id, today);
      const word = {
        valid: '有效',
        expiring: '即将到期',
        expired: '已过期',
        missing: '未取得',
      }[state.state];
      out.push({
        id: `cert${i + 1}`,
        type: 'certificate',
        refId: state.certificateId ?? certification.id,
        label: `${certification.title}：${word}${state.expiresAt && state.state !== 'missing' ? `（${state.expiresAt} 到期）` : ''}`,
      });
    }
    const levels =
      (await reads.levels([employee.id])).get(employee.id) ??
      new Map<string, LevelRow>();
    const requirements =
      (await reads.requirements()).get(employee.positionId ?? '') ?? [];
    let gapIndex = 0;
    for (const requirement of requirements) {
      const current = levels.get(requirement.competencyId)?.level ?? 0;
      if (current >= requirement.requiredLevel) continue;
      gapIndex += 1;
      out.push({
        id: `gap${gapIndex}`,
        type: 'gap',
        refId: requirement.competencyId,
        label: `${competencies.get(requirement.competencyId)?.title ?? ''} 当前 ${current} 级，岗位要求 ${requirement.requiredLevel} 级`,
      });
    }
    const since = daysBefore(90);
    let index = 0;
    for (const [competencyId, level] of levels)
      if (level.assessedAt && new Date(level.assessedAt) >= since)
        out.push({
          id: `assess${(index += 1)}`,
          type: 'assessment',
          refId: level.id,
          label: `${competencies.get(competencyId)?.title ?? ''} 评定为 ${level.level} 级（${level.assessedAt.slice(0, 10)}）`,
        });
    const courses = await database
      .query()
      .selectFrom('assignments')
      .innerJoin('courses', 'courses.id', 'assignments.courseId')
      .select([
        'assignments.id as id',
        'courses.title as title',
        'assignments.completedAt as completedAt',
      ])
      .where('assignments.employeeId', '=', employee.id)
      .where('assignments.status', '=', 'completed')
      .execute();
    index = 0;
    for (const course of courses)
      if (course.completedAt && new Date(iso(course.completedAt)!) >= since)
        out.push({
          id: `course${(index += 1)}`,
          type: 'course',
          refId: str(course.id),
          label: `完成课程《${str(course.title)}》（${dateOnly(course.completedAt)}）`,
        });
    const exams = await database
      .query()
      .selectFrom('examAttempts')
      .innerJoin('exams', 'exams.id', 'examAttempts.examId')
      .select([
        'examAttempts.id as id',
        'exams.title as title',
        'examAttempts.status as status',
        'examAttempts.score as score',
        'examAttempts.submittedAt as submittedAt',
      ])
      .where('examAttempts.employeeId', '=', employee.id)
      .where('examAttempts.status', 'in', ['passed', 'failed'])
      .execute();
    index = 0;
    for (const exam of exams)
      if (exam.submittedAt && new Date(iso(exam.submittedAt)!) >= since)
        out.push({
          id: `exam${(index += 1)}`,
          type: 'exam',
          refId: str(exam.id),
          label: `《${str(exam.title)}》${exam.status === 'passed' ? '通过' : '未通过'}（${dateOnly(exam.submittedAt)}）`,
        });
    // Business data of the last 12 months: counts and categories only.
    const rows = await database
      .query()
      .selectFrom('businessSignals')
      .select(['id', 'signalType', 'category', 'occurredAt'])
      .where('employeeId', '=', employee.id)
      .where('matchStatus', '!=', 'ignored')
      .execute();
    const groups = new Map<string, string[]>();
    for (const row of rows) {
      if (!onOrAfter(row.occurredAt, daysBefore(365))) continue;
      const key = `${str(row.signalType)}|${str(row.category ?? '')}`;
      groups.set(key, [...(groups.get(key) ?? []), str(row.id)]);
    }
    index = 0;
    for (const [key, ids] of groups) {
      const [type, category] = key.split('|');
      out.push({
        id: `signal${(index += 1)}`,
        type: 'signal',
        refId: ids.join(','),
        label: `${TYPE_LABEL[type] ?? type}${category ? `（${category}）` : ''} ${ids.length} 条`,
      });
    }
    return out;
  }

  /** The rule-based summary: certificates and fit, then recent changes. */
  function templateSummary(list: readonly SummaryFact[]): SummarySentence[] {
    const sentences: SummarySentence[] = [];
    const certs = list.filter((f) => f.type === 'certificate');
    const gaps = list.filter((f) => f.type === 'gap');
    const position = list.find((f) => f.type === 'position');
    const fit: SummaryFact[] = [
      ...(position ? [position] : []),
      ...certs,
      ...gaps,
    ];
    if (fit.length) {
      const parts: string[] = [];
      if (certs.length)
        parts.push(
          certs.map((c) => c.label.replace(/（.*?）/u, '')).join('，'),
        );
      parts.push(
        gaps.length
          ? `岗位要求中 ${gaps.length} 项未达标（${gaps
              .slice(0, 2)
              // The label is `<competency> 当前 N 级，…`; a competency name may itself contain spaces (安全生产与 5S).
              .map((g) => g.label.replace(/ 当前 .*$/u, ''))
              .join('、')}）`
          : '岗位要求的能力均已达标',
      );
      sentences.push({ text: `${parts.join('；')}。`, evidence: fit });
    }
    const recent = list.filter((f) =>
      ['assessment', 'course', 'exam'].includes(f.type),
    );
    if (recent.length) {
      const courses = recent.filter((f) => f.type === 'course').length;
      const exams = recent.filter((f) => f.type === 'exam').length;
      const assessments = recent.filter((f) => f.type === 'assessment').length;
      const bits = [
        courses ? `完成课程 ${courses} 门` : '',
        exams ? `参加考试 ${exams} 次` : '',
        assessments ? `新增能力评定 ${assessments} 项` : '',
      ].filter(Boolean);
      sentences.push({
        text: `近 90 天${bits.join('，')}。`,
        evidence: recent,
      });
    }
    const signalFacts = list.filter((f) => f.type === 'signal');
    if (signalFacts.length)
      sentences.push({
        text: `近 12 个月业务数据：${signalFacts
          .slice(0, 3)
          .map((f) => f.label)
          .join('，')}。`,
        evidence: signalFacts,
      });
    // Keep within the limit: drop trailing sentences first.
    while (
      sentences.length > 1 &&
      sentences.map((s) => s.text).join('').length > SUMMARY_MAX
    )
      sentences.pop();
    if (sentences.length === 1 && sentences[0].text.length > SUMMARY_MAX)
      sentences[0] = {
        ...sentences[0],
        text: `${sentences[0].text.slice(0, SUMMARY_MAX - 1)}…`,
      };
    return sentences;
  }

  async function save(
    employeeId: string,
    sentences: readonly SummarySentence[],
  ): Promise<void> {
    const stamp = new Date();
    await database
      .query()
      .updateTable('employees')
      .set({
        aiSummary: sentences.map((s) => s.text).join(''),
        aiSummaryAt: stamp,
        aiSummaryEvidence: sentences.map((s) => ({
          sentence: s.text,
          evidence: s.evidence.map((e) => ({
            type: e.type,
            id: e.refId,
            label: e.label,
          })),
        })),
      })
      .where('id', '=', employeeId)
      .execute();
  }

  async function readSummary(employeeId: string): Promise<{
    summary: string | null;
    at: string | null;
    sentences: SummarySentence[];
  }> {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['aiSummary', 'aiSummaryAt', 'aiSummaryEvidence'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    const evidence = json<
      {
        sentence: string;
        evidence: { type: string; id: string; label: string }[];
      }[]
    >(row?.aiSummaryEvidence, []);
    return {
      summary: nullable(row?.aiSummary),
      at: iso(row?.aiSummaryAt),
      sentences: evidence.map((s, i) => ({
        text: s.sentence,
        evidence: s.evidence.map((e, j) => ({
          id: `${i}-${j}`,
          type: e.type as SummaryFact['type'],
          refId: e.id,
          label: e.label,
        })),
      })),
    };
  }

  const service = {
    facts,
    templateSummary,

    /**
     * Writes a summary: every sentence must cite at least one of the facts
     * (by id) and the whole stays within 150 characters, else refused.
     */
    async saveSummary(
      employeeId: string,
      input: readonly { text: string; evidenceIds: readonly string[] }[],
      available?: readonly SummaryFact[],
    ): Promise<SummarySentence[]> {
      const employee = (await reads.people([employeeId]))[0];
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const list = available ?? (await facts(employee));
      const byId = new Map(list.map((f) => [f.id, f]));
      const sentences = input.map((s) => {
        const evidence = s.evidenceIds
          .map((id) => byId.get(id))
          .filter((f): f is SummaryFact => Boolean(f));
        if (!s.text.trim() || !evidence.length)
          throw new HrError('SUMMARY_EVIDENCE_REQUIRED', 400);
        return { text: s.text.trim(), evidence };
      });
      if (
        !sentences.length ||
        sentences.map((s) => s.text).join('').length > SUMMARY_MAX
      )
        throw new HrError('SUMMARY_TOO_LONG', 400);
      await save(employeeId, sentences);
      return sentences;
    },

    /** Generates and saves the rule-based summary. */
    async generateTemplate(employeeId: string): Promise<SummarySentence[]> {
      const employee = (await reads.people([employeeId]))[0];
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const sentences = templateSummary(await facts(employee));
      await save(employeeId, sentences);
      return sentences;
    },

    async summary(
      ctx: ActorContext,
      employeeId: string,
    ): Promise<ProfileSummaryView> {
      const employee = await scopedEmployee(ctx, SUMMARY, 'view', employeeId);
      let stored = await readSummary(employee.id);
      // First look: the rule-based summary, so every profile has one; the analyst rewrites it later.
      if (!stored.summary) {
        await service.generateTemplate(employee.id);
        stored = await readSummary(employee.id);
      }
      let canRegenerate = false;
      const regenerate = await tryAuthorizeAction(
        ctx.authz,
        SUMMARY,
        'regenerate',
      );
      if (regenerate?.employees)
        canRegenerate = Boolean(
          await database
            .repository('employees')
            .withPolicy(policyOf(regenerate, 'employees'))
            .findOne({ filter: { id: employee.id } }),
        );
      return {
        employeeId: employee.id,
        summary: stored.summary,
        generatedAt: stored.at,
        sentences: stored.sentences,
        canRegenerate,
      };
    },

    /** Authorizes regenerating one employee's summary; answers the employee. */
    async assertRegenerate(
      ctx: ActorContext,
      employeeId: string,
    ): Promise<PersonRow> {
      return scopedEmployee(ctx, SUMMARY, 'regenerate', employeeId);
    },

    /** Employees with new data in the last `days` days: records, assessments, certificates, learning, exams. */
    async employeesWithNewData(days: number): Promise<string[]> {
      const since = daysBefore(days);
      const query = database.query();
      const ids = new Set<string>();
      const add = (rows: Record<string, unknown>[], column: string) => {
        for (const row of rows)
          if (row.employeeId && onOrAfter(row[column], since))
            ids.add(str(row.employeeId));
      };
      // When the data happened: pushed or updated records, assessments, certificates issued, completions, attempts.
      add(
        await query
          .selectFrom('businessSignals')
          .select(['employeeId', 'updatedAt'])
          .execute(),
        'updatedAt',
      );
      add(
        await query
          .selectFrom('employeeCompetencies')
          .select(['employeeId', 'assessedAt'])
          .execute(),
        'assessedAt',
      );
      add(
        await query
          .selectFrom('employeeCertificates')
          .select(['employeeId', 'issuedAt'])
          .execute(),
        'issuedAt',
      );
      add(
        await query
          .selectFrom('assignments')
          .select(['employeeId', 'completedAt'])
          .where('completedAt', 'is not', null)
          .execute(),
        'completedAt',
      );
      add(
        await query
          .selectFrom('examAttempts')
          .select(['employeeId', 'submittedAt'])
          .where('submittedAt', 'is not', null)
          .execute(),
        'submittedAt',
      );
      const people = await reads.people([...ids]);
      return people.filter(isActive).map((p) => p.id);
    },

    /** 成长时间线 with business data; a record links to its source and carries its competency. */
    async timeline(ctx: ActorContext, employeeId: string) {
      const employee = await scopedEmployee(ctx, SUMMARY, 'view', employeeId);
      let base: {
        kind: string;
        at: string;
        title: string;
        detail: string | null;
      }[] = [];
      try {
        base = [...(await deps.insights().timeline(ctx, employee.id))];
      } catch (error) {
        if (!(error instanceof HrError) || error.status !== 403) throw error;
      }
      const records = await signals.forEmployee(ctx, employee.id);
      return [
        ...base.map((entry) => ({
          ...entry,
          competencyId: null,
          competencyTitle: null,
          link: null,
          signalId: null,
          signalType: null,
        })),
        ...records.map((record) => ({
          kind: 'signal',
          at: record.occurredAt,
          title: `${record.externalId} ${record.title}`,
          detail: [
            TYPE_LABEL[record.signalType] ?? record.signalType,
            record.category,
            record.severity,
          ]
            .filter(Boolean)
            .join(' · '),
          competencyId: record.competencyId,
          competencyTitle: record.competencyTitle,
          link: record.link,
          signalId: record.id,
          signalType: record.signalType,
          sourceSystem: record.sourceSystem,
        })),
      ].sort((a, b) => b.at.localeCompare(a.at));
    },

    // ---------- 找人 ----------

    /** Names the application knows, for turning a sentence into conditions. */
    async lookups() {
      const departments = (await organization.listTree()).filter(
        (d) => d.active,
      );
      const certifications = await database
        .query()
        .selectFrom('certifications')
        .select(['id', 'title'])
        .where('active', '=', true)
        .execute();
      return {
        departments: departments.map((d) => ({
          id: d.id,
          title: organization.titleText(d.title),
        })),
        positions: [...(await reads.positions())].map(([id, title]) => ({
          id,
          title,
        })),
        certifications: certifications.map((c) => ({
          id: str(c.id),
          title: str(c.title),
        })),
        competencies: [...(await reads.competencies()).values()]
          .filter((c) => c.active)
          .map((c) => ({ id: c.id, title: c.title, maxLevel: c.maxLevel })),
      };
    },

    /** The rule parser (used without a model, and to check the model's result). */
    async parseRules(text: string): Promise<FindConditions> {
      const names = await service.lookups();
      const byLength = <T extends { title: string }>(list: T[]) =>
        [...list].sort((a, b) => b.title.length - a.title.length);
      let rest = text;
      const take = <T extends { title: string }>(list: T[]) => {
        const found: T[] = [];
        for (const item of byLength(list))
          if (item.title && rest.includes(item.title)) {
            found.push(item);
            rest = rest.split(item.title).join(' ');
          }
        return found;
      };
      const certifications = take(names.certifications);
      const departments = take(names.departments);
      const positions = take(names.positions);
      const competencies: FindConditions['competencies'] = [];
      for (const competency of byLength(names.competencies)) {
        const at = text.indexOf(competency.title);
        if (at < 0) continue;
        const after = text.slice(
          at + competency.title.length,
          at + competency.title.length + 12,
        );
        const min = /(\d+)\s*级(?:及)?以上|≥\s*(\d+)|不低于\s*(\d+)/u.exec(
          after,
        );
        const max = /(\d+)\s*级(?:及)?以下|≤\s*(\d+)/u.exec(after);
        competencies.push({
          competencyId: competency.id,
          minLevel: min ? Number(min[1] ?? min[2] ?? min[3]) : max ? null : 1,
          maxLevel: max ? Number(max[1] ?? max[2]) : null,
        });
      }
      let signalsCondition: FindConditions['signals'] = null;
      const none = /(没有|无|未发生|零)\s*(质量问题|质量事故)/u.test(text);
      const some = !none && /有\s*(质量问题|质量事故)/u.test(text);
      if (none || some) {
        let withinDays = 180;
        const months = /近\s*(\d+)\s*个?月/u.exec(text);
        const daysMatch = /近\s*(\d+)\s*天/u.exec(text);
        if (/近半年/u.test(text)) withinDays = 180;
        else if (/近一年|近 ?12 ?个月/u.test(text)) withinDays = 365;
        else if (months) withinDays = Number(months[1]) * 30;
        else if (daysMatch) withinDays = Number(daysMatch[1]);
        signalsCondition = {
          mode: none ? 'none' : 'some',
          types: ['qualityIssue'],
          withinDays,
        };
      }
      return {
        departmentIds: departments.map((d) => d.id),
        positionIds: positions.map((p) => p.id),
        certifications: certifications.map((c) => ({
          certificationId: c.id,
          status: 'valid' as const,
        })),
        competencies,
        signals: signalsCondition,
        activeOnly: !/离职/u.test(text),
      };
    },

    /** Checks conditions against the known ids, dropping what does not exist. */
    async cleanConditions(input: unknown): Promise<FindConditions> {
      const names = await service.lookups();
      const value = (input ?? {}) as Partial<FindConditions>;
      const known = (list: { id: string }[], ids: unknown) =>
        (Array.isArray(ids) ? ids : [])
          .map((v) => str(v))
          .filter((id) => list.some((i) => i.id === id));
      const level = (v: unknown) =>
        v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
          ? null
          : Math.round(Number(v));
      return {
        departmentIds: known(names.departments, value.departmentIds),
        positionIds: known(names.positions, value.positionIds),
        certifications: (Array.isArray(value.certifications)
          ? value.certifications
          : []
        )
          .filter((c) =>
            names.certifications.some((n) => n.id === c?.certificationId),
          )
          .map((c) => ({
            certificationId: str(c.certificationId),
            status: c.status === 'any' ? 'any' : 'valid',
          })),
        competencies: (Array.isArray(value.competencies)
          ? value.competencies
          : []
        )
          .filter((c) =>
            names.competencies.some((n) => n.id === c?.competencyId),
          )
          .map((c) => ({
            competencyId: str(c.competencyId),
            minLevel: level(c.minLevel),
            maxLevel: level(c.maxLevel),
          })),
        signals:
          value.signals &&
          (value.signals.mode === 'none' || value.signals.mode === 'some')
            ? {
                mode: value.signals.mode,
                types: (Array.isArray(value.signals.types) &&
                value.signals.types.length
                  ? value.signals.types
                  : ['qualityIssue']
                ).map((t) => str(t)),
                withinDays: Math.min(
                  Math.max(Number(value.signals.withinDays) || 180, 1),
                  3650,
                ),
              }
            : null,
        activeOnly: value.activeOnly !== false,
      };
    },

    /** Searches within the caller's scope; each result says which conditions it met. */
    async search(ctx: ActorContext, conditions: FindConditions) {
      const people = await scopedEmployees(ctx, FIND, 'use');
      const names = await service.lookups();
      const today = platform.currentDate();
      const title = (list: { id: string; title: string }[], id: string) =>
        list.find((i) => i.id === id)?.title ?? id;
      const inDepartments = new Set<string>();
      for (const id of conditions.departmentIds)
        for (const d of await organization.descendantsOf(id))
          inDepartments.add(d);
      const ids = people.map((p) => p.id);
      const certificates = await reads.certificates(ids);
      const levels = await reads.levels(ids);
      const signalRows = conditions.signals
        ? await database
            .query()
            .selectFrom('businessSignals')
            .select(['employeeId', 'signalType', 'occurredAt', 'externalId'])
            .where('matchStatus', '!=', 'ignored')
            .execute()
        : [];
      const signalSince = daysBefore(conditions.signals?.withinDays ?? 180);
      const recentSignals = signalRows.filter((r) =>
        onOrAfter(r.occurredAt, signalSince),
      );
      type Check = {
        key: string;
        label: string;
        test: (p: PersonRow) => string | null;
      };
      const checks: Check[] = [];
      if (conditions.activeOnly)
        checks.push({
          key: 'active',
          label: '在职',
          test: (p) => (isActive(p) ? '在职' : null),
        });
      if (conditions.departmentIds.length)
        checks.push({
          key: 'department',
          label: `部门：${conditions.departmentIds.map((id) => title(names.departments, id)).join('、')}`,
          test: (p) =>
            inDepartments.has(p.departmentId)
              ? `在${title(names.departments, p.departmentId)}`
              : null,
        });
      if (conditions.positionIds.length)
        checks.push({
          key: 'position',
          label: `岗位：${conditions.positionIds.map((id) => title(names.positions, id)).join('、')}`,
          test: (p) =>
            p.positionId && conditions.positionIds.includes(p.positionId)
              ? `岗位为${title(names.positions, p.positionId)}`
              : null,
        });
      for (const c of conditions.certifications)
        checks.push({
          key: `cert:${c.certificationId}`,
          label: `持有${title(names.certifications, c.certificationId)}`,
          test: (p) => {
            const state = certState(
              certificates.filter((x) => x.employeeId === p.id),
              c.certificationId,
              today,
            );
            const ok =
              c.status === 'any'
                ? state.state !== 'missing'
                : state.state === 'valid' || state.state === 'expiring';
            return ok
              ? `持有${title(names.certifications, c.certificationId)}（${state.state === 'expiring' ? '即将到期' : state.state === 'valid' ? '有效' : '已过期'}${state.expiresAt ? `，${state.expiresAt} 到期` : ''}）`
              : null;
          },
        });
      for (const c of conditions.competencies)
        checks.push({
          key: `comp:${c.competencyId}`,
          label: `${title(names.competencies, c.competencyId)}${c.minLevel !== null ? ` ≥ ${c.minLevel} 级` : ''}${c.maxLevel !== null ? ` ≤ ${c.maxLevel} 级` : ''}`,
          test: (p) => {
            const level = levels.get(p.id)?.get(c.competencyId)?.level ?? 0;
            if (c.minLevel !== null && level < c.minLevel) return null;
            if (c.maxLevel !== null && level > c.maxLevel) return null;
            return `${title(names.competencies, c.competencyId)} ${level} 级`;
          },
        });
      if (conditions.signals) {
        const s = conditions.signals;
        const label = s.types.map((t) => TYPE_LABEL[t] ?? t).join('、');
        checks.push({
          key: 'signals',
          label: `近 ${s.withinDays} 天${s.mode === 'none' ? '没有' : '有'}${label}`,
          test: (p) => {
            const own = recentSignals.filter(
              (r) =>
                str(r.employeeId) === p.id &&
                s.types.includes(str(r.signalType)),
            );
            if (s.mode === 'none')
              return own.length
                ? null
                : `近 ${s.withinDays} 天没有${label}记录`;
            return own.length
              ? `近 ${s.withinDays} 天有 ${own.length} 条${label}记录`
              : null;
          },
        });
      }
      const positions = await reads.positions();
      const results = [];
      for (const person of people) {
        const reasons: string[] = [];
        let ok = true;
        for (const check of checks) {
          const reason = check.test(person);
          if (reason === null) {
            ok = false;
            break;
          }
          reasons.push(reason);
        }
        if (ok)
          results.push({
            employeeId: person.id,
            name: person.name,
            employeeNo: person.employeeNo,
            departmentTitle: await deps.departmentTitle(person.departmentId),
            positionTitle: positions.get(person.positionId ?? '') ?? '',
            reasons,
          });
      }
      let strictest: { label: string; passing: number } | null = null;
      if (!results.length && checks.length) {
        for (const check of checks) {
          const passing = people.filter((p) => check.test(p) !== null).length;
          if (!strictest || passing < strictest.passing)
            strictest = { label: check.label, passing };
        }
      }
      return {
        conditions,
        labels: checks.map((c) => c.label),
        results,
        strictest,
      };
    },

    // ---------- 团队看板 ----------

    async dashboard(ctx: ActorContext, filters: { departmentId?: string }) {
      const visible = (await scopedEmployees(ctx, DASHBOARD, 'view')).filter(
        isActive,
      );
      const departmentIds = [...new Set(visible.map((p) => p.departmentId))];
      const departments = [];
      for (const id of departmentIds)
        departments.push({ id, title: await deps.departmentTitle(id) });
      let people = visible;
      if (filters.departmentId) {
        const subtree = new Set(
          await organization.descendantsOf(filters.departmentId),
        );
        people = visible.filter((p) => subtree.has(p.departmentId));
      }
      people.sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
      const ids = people.map((p) => p.id);
      const today = platform.currentDate();
      const positions = await reads.positions();
      const requiredCerts = await reads.requiredCertifications();
      const certificates = await reads.certificates(ids);
      const certColumns = new Map<string, string>();
      for (const person of people)
        for (const c of requiredCerts.get(person.positionId ?? '') ?? [])
          certColumns.set(c.id, c.title);
      const certMatrix = {
        columns: [...certColumns].map(([id, title]) => ({ id, title })),
        rows: people.map((person) => ({
          employeeId: person.id,
          name: person.name,
          positionTitle: positions.get(person.positionId ?? '') ?? '',
          cells: [...certColumns.keys()].map((certificationId) => {
            const required = (
              requiredCerts.get(person.positionId ?? '') ?? []
            ).some((c) => c.id === certificationId);
            if (!required)
              return {
                certificationId,
                state: 'notRequired',
                certificateId: null,
                expiresAt: null,
              };
            return {
              certificationId,
              ...certState(
                certificates.filter((c) => c.employeeId === person.id),
                certificationId,
                today,
              ),
            };
          }),
        })),
      };
      const requirements = await reads.requirements();
      const levels = await reads.levels(ids);
      const competencies = await reads.competencies();
      const gapColumns = new Map<string, string>();
      for (const person of people)
        for (const r of requirements.get(person.positionId ?? '') ?? [])
          gapColumns.set(
            r.competencyId,
            competencies.get(r.competencyId)?.title ?? r.competencyId,
          );
      const heatmap = {
        columns: [...gapColumns].map(([id, title]) => ({ id, title })),
        rows: people.map((person) => ({
          employeeId: person.id,
          name: person.name,
          cells: [...gapColumns.keys()].map((competencyId) => {
            const requirement = (
              requirements.get(person.positionId ?? '') ?? []
            ).find((r) => r.competencyId === competencyId);
            const current =
              levels.get(person.id)?.get(competencyId)?.level ?? null;
            return {
              competencyId,
              requiredLevel: requirement?.requiredLevel ?? null,
              currentLevel: current,
              gap: requirement
                ? Math.max(requirement.requiredLevel - (current ?? 0), 0)
                : null,
            };
          }),
        })),
      };
      // Problem records by month and competency, the last six months.
      const months: string[] = [];
      const start = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      for (let i = 5; i >= 0; i -= 1) {
        const d = new Date(start);
        d.setUTCMonth(d.getUTCMonth() - i);
        months.push(d.toISOString().slice(0, 7));
      }
      const signalRows = ids.length
        ? await database
            .query()
            .selectFrom('businessSignals')
            .select(['employeeId', 'competencyId', 'signalType', 'occurredAt'])
            .where('employeeId', 'in', ids)
            .where('signalType', 'in', [...PROBLEM_TYPES])
            .where('matchStatus', '!=', 'ignored')
            .execute()
        : [];
      const trendCompetencies = [
        ...new Set(signalRows.map((r) => nullable(r.competencyId) ?? '')),
      ];
      const trend = {
        months,
        series: trendCompetencies.map((competencyId) => ({
          competencyId: competencyId || null,
          title: competencyId
            ? (competencies.get(competencyId)?.title ?? competencyId)
            : '未匹配能力项',
          counts: months.map(
            (m) =>
              signalRows.filter(
                (r) =>
                  (nullable(r.competencyId) ?? '') === competencyId &&
                  (iso(r.occurredAt) ?? '').startsWith(m),
              ).length,
          ),
        })),
      };
      const assignments = ids.length
        ? await database
            .query()
            .selectFrom('assignments')
            .select([
              'employeeId',
              'status',
              'dueDate',
              'completedAt',
              'parentAssignmentId',
            ])
            .where('employeeId', 'in', ids)
            .execute()
        : [];
      const month = today.slice(0, 7);
      const learning = {
        inProgress: assignments.filter(
          (a) => a.status === 'inProgress' || a.status === 'notStarted',
        ).length,
        overdue: assignments.filter(
          (a) =>
            a.status === 'overdue' ||
            ((a.status === 'inProgress' || a.status === 'notStarted') &&
              a.dueDate &&
              dateOnly(a.dueDate)! < today),
        ).length,
        completedThisMonth: assignments.filter(
          (a) =>
            a.status === 'completed' &&
            (iso(a.completedAt) ?? '').startsWith(month),
        ).length,
      };
      return {
        departments,
        departmentId: filters.departmentId ?? null,
        people: people.length,
        certMatrix,
        heatmap,
        trend,
        learning,
        canExport: await platform.can(ctx, DASHBOARD, 'export'),
      };
    },

    async dashboardExport(
      ctx: ActorContext,
      filters: { departmentId?: string },
    ) {
      await authorizeAction(ctx.authz, DASHBOARD, 'export');
      const data = await service.dashboard(ctx, filters);
      const state = {
        valid: '有效',
        expiring: '即将到期',
        expired: '已过期',
        missing: '缺失',
        notRequired: '—',
      } as Record<string, string>;
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['员工', '岗位', ...data.certMatrix.columns.map((c) => c.title)],
          ...data.certMatrix.rows.map((r) => [
            r.name,
            r.positionTitle,
            ...r.cells.map(
              (c) =>
                `${state[c.state] ?? c.state}${c.expiresAt ? ` ${c.expiresAt}` : ''}`,
            ),
          ]),
        ]),
        '持证矩阵',
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['员工', ...data.heatmap.columns.map((c) => c.title)],
          ...data.heatmap.rows.map((r) => [
            r.name,
            ...r.cells.map((c) =>
              c.requiredLevel === null
                ? '—'
                : `${c.currentLevel ?? 0}/${c.requiredLevel}（差 ${c.gap}）`,
            ),
          ]),
        ]),
        '能力差距',
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['能力项', ...data.trend.months],
          ...data.trend.series.map((s) => [s.title, ...s.counts]),
        ]),
        '问题记录趋势',
      );
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ['进行中', '逾期', '本月完成'],
          [
            data.learning.inProgress,
            data.learning.overdue,
            data.learning.completedThisMonth,
          ],
        ]),
        '学习进度',
      );
      return XLSX.write(book, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Uint8Array;
    },

    /** The analyst's getTeamOverview: the dashboard in numbers, for a department in scope. */
    async teamOverview(ctx: ActorContext, departmentId?: string) {
      const data = await service.dashboard(ctx, { departmentId });
      const count = (state: string) =>
        data.certMatrix.rows.reduce(
          (n, r) => n + r.cells.filter((c) => c.state === state).length,
          0,
        );
      return {
        people: data.people,
        certificates: {
          valid: count('valid'),
          expiring: count('expiring'),
          expired: count('expired'),
          missing: count('missing'),
        },
        gaps: data.heatmap.columns.map((c, i) => ({
          competency: c.title,
          withGap: data.heatmap.rows.filter((r) => (r.cells[i]?.gap ?? 0) > 0)
            .length,
        })),
        problemTrend: data.trend,
        learning: data.learning,
      };
    },

    /** The analyst's getEmployeeProfile: requirements, history, certificates, learning, exams, practice, 12 months of records. */
    async employeeProfile(ctx: ActorContext, employeeId: string) {
      const employee = await scopedEmployee(
        ctx,
        'talent.talentAnalyst',
        'use',
        employeeId,
      );
      const list = await facts(employee);
      const records = await signals.forEmployee(ctx, employee.id, {
        sinceDays: 365,
      });
      const events = await database
        .query()
        .selectFrom('jobEvents')
        .select([
          'eventType',
          'effectiveDate',
          'toPositionId',
          'toDepartmentId',
        ])
        .where('employeeId', '=', employee.id)
        .execute();
      const practice = await database
        .query()
        .selectFrom('practiceSessions')
        .innerJoin(
          'practiceScenarios',
          'practiceScenarios.id',
          'practiceSessions.scenarioId',
        )
        .select([
          'practiceScenarios.title as title',
          'practiceSessions.score as score',
          'practiceSessions.completedAt as completedAt',
        ])
        .where('practiceSessions.employeeId', '=', employee.id)
        .where('practiceSessions.status', '=', 'completed')
        .execute();
      const positions = await reads.positions();
      return {
        employee: {
          id: employee.id,
          name: employee.name,
          position: positions.get(employee.positionId ?? '') ?? '',
          department: await deps.departmentTitle(employee.departmentId),
        },
        facts: list.map((f) => ({ id: f.id, type: f.type, label: f.label })),
        jobEvents: events.map((e) => ({
          type: str(e.eventType),
          date: dateOnly(e.effectiveDate),
          position: e.toPositionId
            ? (positions.get(str(e.toPositionId)) ?? '')
            : null,
        })),
        practice: practice.map((p) => ({
          title: str(p.title),
          score: p.score == null ? null : Number(p.score),
          at: dateOnly(p.completedAt),
        })),
        // Ids, types, categories and dates only: descriptions stay out of AI runs.
        records: records.map((r) => ({
          id: r.id,
          externalId: r.externalId,
          type: r.signalType,
          category: r.category,
          severity: r.severity,
          competency: r.competencyTitle,
          occurredAt: r.occurredAt.slice(0, 10),
        })),
      };
    },
  };
  void addDays;
  return service;
}

export type ProfileInsights = ReturnType<typeof createProfileInsights>;

import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import * as XLSX from 'xlsx';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import {
  createFrameworkService,
  toCompetency,
  toLevel,
  toPosition,
  toRequirement,
  type ActorContext,
  type Competency,
  type CompetencyLevel,
  type FrameworkService,
  type JobFamily,
  type Position,
  type PositionRequirement,
} from './framework-service.js';
import type { OrganizationService } from './organization-service.js';
import { bool } from './platform.js';
import {
  HrError,
  isRecord,
  newId,
  optionalDate,
  optionalEnum,
  requireString,
  toDateOnly,
  today,
  str,
} from './shared.js';

const IMPORT_COLUMNS = [
  '工号',
  '姓名',
  '部门编码',
  '岗位',
  '上级工号',
  '入职日期',
  '邮箱',
  '手机',
] as const;
/** An import cell that looks like a position code rather than a title. */
const POSITION_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MOBILE = /^\+?\d{6,15}$/u;
/** Titles compare without spacing and letter case: "CNC 操作工" matches "cnc操作工". */
function titleKey(title: string): string {
  return title.replace(/\s+/gu, '').toLowerCase();
}
/** Records that keep an employee from being deleted; later steps add theirs here. */
const EMPLOYEE_REFERENCES: readonly (readonly [string, string])[] = [
  ['employees', 'managerEmployeeId'],
  ['employmentContracts', 'employeeId'],
  ['personnelActions', 'employeeId'],
  ['profileChangeRequests', 'employeeId'],
  ['employeeCompetencies', 'employeeId'],
  ['employeeAttachments', 'employeeId'],
  ['assignments', 'employeeId'],
  ['learningRecords', 'employeeId'],
  ['examAttempts', 'employeeId'],
  ['employeeCertificates', 'employeeId'],
  ['trainingEnrollments', 'employeeId'],
  ['practiceSessions', 'employeeId'],
  ['learningPlans', 'employeeId'],
];
/** Parts of the employee's own record, deleted with it. */
const EMPLOYEE_OWN_TABLES = [
  'employeeEducations',
  'employeeExperiences',
  'employeeEmergencyContacts',
] as const;

/** Manager-chain walks stop here, so a loop in imported data cannot hang the server. */
const MAX_MANAGER_DEPTH = 50;

export const EMPLOYEE_STATUSES = [
  'pending',
  'probation',
  'active',
  'leave',
] as const;
export const EMPLOYMENT_TYPES = [
  'fullTime',
  'partTime',
  'intern',
  'outsourced',
] as const;
export const GENDERS = ['male', 'female', 'other'] as const;
export const ID_TYPES = ['idCard', 'passport', 'other'] as const;
export const LEAVE_REASONS = [
  'resign',
  'dismiss',
  'contractEnd',
  'other',
] as const;

export interface EmployeeRecord {
  id: string;
  employeeNo: string;
  name: string;
  userId: string | null;
  departmentId: string;
  positionId: string | null;
  managerEmployeeId: string | null;
  status: string;
  hireDate: string | null;
  careerStartDate: string | null;
  positionSince: string | null;
  email: string | null;
  gender: string | null;
  idType: string | null;
  employmentType: string;
  workLocation: string | null;
  probationEndDate: string | null;
  regularizedAt: string | null;
  leaveDate: string | null;
  leaveReason: string | null;
  /** The Excel import that last created or updated this employee. */
  lastImportBatchId: string | null;
  // Present only when the caller may read them.
  mobile?: string | null;
  idNumber?: string | null;
  birthDate?: string | null;
  address?: string | null;
  note?: string | null;
}

export interface EmployeeListItem extends EmployeeRecord {
  departmentTitle: string;
  positionTitle: string | null;
  managerName: string | null;
  gapCount: number;
  tenureMonths: number | null;
}

export interface GapRow {
  competencyId: string;
  code: string;
  title: string;
  category: string;
  maxLevel: number;
  requiredLevel: number | null;
  mandatory: boolean;
  currentLevel: number;
  gap: number;
  levels: CompetencyLevel[];
}

export interface AssessmentRow {
  id: string;
  competencyId: string;
  competencyTitle: string;
  level: number;
  source: string;
  evidence: string | null;
  assessedBy: string;
  assessedByName: string;
  assessedAt: string;
}

export interface EmployeeDetail {
  employee: EmployeeRecord;
  departmentTitle: string;
  positionTitle: string | null;
  managerName: string | null;
  userName: string | null;
  /** Department, position and status follow personnel actions once the employee has any event. */
  coreFieldsLocked: boolean;
  can: {
    update: boolean;
    linkUser: boolean;
    markLeave: boolean;
    /** Only an employee without a login account; the server also checks nothing references them. */
    delete: boolean;
    assess: boolean;
    viewAssessments: boolean;
    viewSensitive: boolean;
    viewNotes: boolean;
    viewProfile: boolean;
    viewContacts: boolean;
    manageProfile: boolean;
    viewContracts: boolean;
  };
}

export interface ImportRow {
  line: number;
  employeeNo: string;
  name: string;
  departmentCode: string;
  /** A position code or a position title, as the file has it. */
  position: string;
  managerEmployeeNo: string;
  hireDate: string;
  email: string;
  mobile: string;
  errors: string[];
  action: 'create' | 'update' | 'skip';
  /** A title that matches no enabled position: the import creates it. */
  newPosition: string | null;
}

export interface ImportPreview {
  rows: ImportRow[];
  created: number;
  updated: number;
  /** Titles the import will create as positions; each needs a job family before confirming. */
  newPositions: string[];
  jobFamilies: { id: string; title: string }[];
}

export interface ImportBatchSummary {
  id: string;
  importedByName: string | null;
  createdCount: number;
  updatedCount: number;
  createdPositionIds: string[];
  createdAt: string;
  /** Null until the health check finished (or when it is switched off). */
  check: { mustFix: number; suggested: number; report: string } | null;
}

export interface TalentService extends FrameworkService {
  listEmployees(
    ctx: ActorContext,
    filters: {
      search?: string;
      departmentId?: string;
      positionId?: string;
      status?: string;
      employmentType?: string;
      /** Links from the health-check report: a set of employees, an import batch, a quick filter. */
      ids?: readonly string[];
      batchId?: string;
      quick?: 'noPosition' | 'noManager';
    },
  ): Promise<{
    items: EmployeeListItem[];
    can: {
      create: boolean;
      import: boolean;
      export: boolean;
      reviewChanges: boolean;
    };
  }>;
  getEmployee(
    ctx: ActorContext,
    id: string,
  ): Promise<EmployeeDetail | undefined>;
  getMyEmployee(ctx: ActorContext): Promise<EmployeeDetail | undefined>;
  createEmployee(ctx: ActorContext, input: unknown): Promise<EmployeeRecord>;
  updateEmployee(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<EmployeeRecord>;
  linkUser(
    ctx: ActorContext,
    id: string,
    userId: string | null,
  ): Promise<EmployeeRecord>;
  markLeave(
    ctx: ActorContext,
    id: string,
    input: { leaveDate?: string; leaveReason?: string },
  ): Promise<EmployeeRecord>;
  gaps(
    ctx: ActorContext,
    employeeId: string,
  ): Promise<{ rows: GapRow[]; positionTitle: string | null }>;
  assessments(ctx: ActorContext, employeeId: string): Promise<AssessmentRow[]>;
  createAssessment(
    ctx: ActorContext,
    employeeId: string,
    input: unknown,
  ): Promise<AssessmentRow>;
  importTemplate(): Buffer;
  importPreview(ctx: ActorContext, file: Buffer): Promise<ImportPreview>;
  importCommit(
    ctx: ActorContext,
    rows: readonly ImportRow[],
    newPositionFamilies: Readonly<Record<string, string>>,
  ): Promise<{
    batchId: string;
    created: number;
    updated: number;
    createdPositions: number;
  }>;
  /**
   * The positions page: job families and positions with their headcount.
   * People who cannot manage positions see only enabled ones.
   */
  listPositions(ctx: ActorContext): Promise<{
    jobFamilies: JobFamily[];
    positions: (Position & { headcount: number })[];
    canManage: boolean;
    /** May open the employee list filtered by position (HR administrators and managers). */
    canViewEmployees: boolean;
  }>;
  /** The latest import and its health check, for HR administrators. */
  latestImport(ctx: ActorContext): Promise<ImportBatchSummary | null>;
  importBatch(ctx: ActorContext, id: string): Promise<ImportBatchSummary>;
  /** Deletes an employee without a login account that nothing references (undoing a mistaken import). */
  deleteEmployee(ctx: ActorContext, id: string): Promise<void>;
  exportRoster(
    ctx: ActorContext,
    filters: {
      search?: string;
      departmentId?: string;
      positionId?: string;
      status?: string;
      employmentType?: string;
      /** Links from the health-check report: a set of employees, an import batch, a quick filter. */
      ids?: readonly string[];
      batchId?: string;
      quick?: 'noPosition' | 'noManager';
    },
    locale: string,
  ): Promise<Buffer>;
  /** The employee record of a user, read without authorization; for internal callers. */
  employeeOfUser(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<EmployeeRecord | undefined>;
  /** Applies the consequences of a department, position or status change in the caller's transaction. */
  applyCoreChange(
    connection: DatabaseConnection,
    employee: EmployeeRecord,
    changes: {
      departmentId?: string;
      positionId?: string | null;
      status?: string;
    },
    options?: { positionSince?: string },
  ): Promise<string[]>;
  notifyUsers(userIds: readonly string[]): Promise<void>;
}

const BASE_FIELDS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'managerEmployeeId',
  'status',
  'hireDate',
  'careerStartDate',
  'positionSince',
  'email',
  'gender',
  'idType',
  'employmentType',
  'workLocation',
  'probationEndDate',
  'regularizedAt',
  'leaveDate',
  'leaveReason',
  'lastImportBatchId',
  'mobile',
  'idNumber',
  'birthDate',
  'address',
  'note',
] as const;

export function toEmployee(row: Record<string, unknown>): EmployeeRecord {
  const opt = (key: string): string | null =>
    row[key] == null ? null : str(row[key]);
  const record: EmployeeRecord = {
    id: String(row.id),
    employeeNo: String(row.employeeNo),
    name: String(row.name),
    userId: opt('userId'),
    departmentId: String(row.departmentId),
    positionId: opt('positionId'),
    managerEmployeeId: opt('managerEmployeeId'),
    status: str(row.status ?? 'active'),
    hireDate: toDateOnly(row.hireDate as string | null),
    careerStartDate: toDateOnly(row.careerStartDate as string | null),
    positionSince: toDateOnly(row.positionSince as string | null),
    email: opt('email'),
    gender: opt('gender'),
    idType: opt('idType'),
    employmentType: str(row.employmentType ?? 'fullTime'),
    workLocation: opt('workLocation'),
    probationEndDate: toDateOnly(row.probationEndDate as string | null),
    regularizedAt: toDateOnly(row.regularizedAt as string | null),
    leaveDate: toDateOnly(row.leaveDate as string | null),
    leaveReason: opt('leaveReason'),
    lastImportBatchId: opt('lastImportBatchId'),
  };
  if ('mobile' in row) record.mobile = opt('mobile');
  if ('idNumber' in row) record.idNumber = opt('idNumber');
  if ('birthDate' in row)
    record.birthDate = toDateOnly(row.birthDate as string | null);
  if ('address' in row) record.address = opt('address');
  if ('note' in row) record.note = opt('note');
  return record;
}

export function maskIdNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 7) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`;
}

function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  return (
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth()) -
    (b.getUTCDate() < a.getUTCDate() ? 1 : 0)
  );
}

export interface TalentServiceDeps {
  database: DatabaseManager;
  authz: AppAuthorization;
  organization: OrganizationService;
  users: UserAdministrationService;
  /** Called after an import commits, with its batch number: starts the HR assistant's health check. */
  onEmployeesImported?: () => ((batchId: string) => void) | undefined;
}

export function createTalentService(deps: TalentServiceDeps): TalentService {
  const { database, authz, organization, users } = deps;
  const framework = createFrameworkService(database);
  const EMPLOYEE = 'talent.employee';
  const ASSESSMENT = 'talent.assessment';

  async function can(
    ctx: ActorContext,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return (
      (await tryAuthorizeAction(ctx.authz, resource, action)) !== undefined
    );
  }

  async function userName(
    userId: string | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const user = await users.get(userId).catch(() => undefined);
    return user ? user.name : null;
  }

  async function departmentTitles(
    ids: readonly string[],
    locale = 'zh-CN',
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!ids.length) return map;
    const rows = await database
      .query()
      .selectFrom('departments')
      .select(['id', 'title'])
      .where('id', 'in', [...new Set(ids)])
      .execute();
    for (const row of rows)
      map.set(
        String(row.id),
        organization.titleText(String(row.title), locale),
      );
    return map;
  }

  async function positionTitles(
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const clean = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (!clean.length) return map;
    const rows = await database
      .query()
      .selectFrom('positions')
      .select(['id', 'title'])
      .where('id', 'in', clean)
      .execute();
    for (const row of rows) map.set(String(row.id), String(row.title));
    return map;
  }

  /** The latest assessment level per competency for a set of employees. */
  async function currentLevels(
    employeeIds: readonly string[],
  ): Promise<Map<string, Map<string, number>>> {
    const result = new Map<string, Map<string, number>>();
    if (!employeeIds.length) return result;
    const rows = await database
      .query()
      .selectFrom('employeeCompetencies')
      .select(['employeeId', 'competencyId', 'level', 'assessedAt'])
      .where('employeeId', 'in', [...employeeIds])
      .orderBy('assessedAt', 'asc')
      .execute();
    for (const row of rows) {
      const employeeId = String(row.employeeId);
      const levels = result.get(employeeId) ?? new Map<string, number>();
      // Ascending order: the last write per competency is the latest assessment.
      levels.set(String(row.competencyId), Number(row.level));
      result.set(employeeId, levels);
    }
    return result;
  }

  async function confirmedRequirements(
    positionIds: readonly (string | null)[],
  ): Promise<Map<string, PositionRequirement[]>> {
    const map = new Map<string, PositionRequirement[]>();
    const clean = [
      ...new Set(positionIds.filter((id): id is string => Boolean(id))),
    ];
    if (!clean.length) return map;
    const rows = await database
      .query()
      .selectFrom('positionRequirements')
      .select([
        'id',
        'positionId',
        'competencyId',
        'requiredLevel',
        'mandatory',
        'source',
        'reviewStatus',
      ])
      .where('positionId', 'in', clean)
      .where('reviewStatus', '=', 'confirmed')
      .execute();
    for (const row of rows) {
      const requirement = toRequirement(row);
      const list = map.get(requirement.positionId) ?? [];
      list.push(requirement);
      map.set(requirement.positionId, list);
    }
    return map;
  }

  function gapCount(
    requirements: readonly PositionRequirement[],
    levels: Map<string, number> | undefined,
  ): number {
    return requirements.filter(
      (r) => (levels?.get(r.competencyId) ?? 0) < r.requiredLevel,
    ).length;
  }

  async function readEmployee(
    ctx: ActorContext,
    id: string,
  ): Promise<EmployeeRecord | undefined> {
    const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'view');
    const row = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id } });
    if (!row) return undefined;
    const employee = toEmployee(row);
    const sensitive = await tryAuthorizeAction(
      ctx.authz,
      EMPLOYEE,
      'viewSensitive',
    );
    if (sensitive) {
      const extra = await database
        .repository('employees')
        .withPolicy(policyOf(sensitive, 'employees'))
        .findOne({ filter: { id } });
      if (extra) {
        // The sensitive read returns only its own columns; copy exactly those.
        const row = extra as Record<string, unknown>;
        employee.mobile = row.mobile == null ? null : str(row.mobile);
        employee.idNumber = row.idNumber == null ? null : str(row.idNumber);
        employee.birthDate = toDateOnly(row.birthDate as string | null);
        employee.address = row.address == null ? null : str(row.address);
      }
    }
    const notes = await tryAuthorizeAction(ctx.authz, EMPLOYEE, 'viewNotes');
    if (notes) {
      const extra = await database
        .repository('employees')
        .withPolicy(policyOf(notes, 'employees'))
        .findOne({ filter: { id } });
      if (extra)
        employee.note =
          (extra as Record<string, unknown>).note == null
            ? null
            : String((extra as Record<string, unknown>).note);
    }
    return employee;
  }

  async function detail(
    ctx: ActorContext,
    employee: EmployeeRecord,
  ): Promise<EmployeeDetail> {
    const [departments, positions] = await Promise.all([
      departmentTitles([employee.departmentId]),
      positionTitles([employee.positionId]),
    ]);
    const manager = employee.managerEmployeeId
      ? await database
          .query()
          .selectFrom('employees')
          .select(['name'])
          .where('id', '=', employee.managerEmployeeId)
          .executeTakeFirst()
      : undefined;
    const events = await database
      .query()
      .selectFrom('jobEvents')
      .select(['id'])
      .where('employeeId', '=', employee.id)
      .limit(1)
      .execute();
    const [
      update,
      linkUser,
      markLeave,
      assess,
      viewAssessments,
      viewSensitive,
      viewNotes,
      viewProfile,
      viewContacts,
      manageProfile,
      viewContracts,
      deletable,
    ] = await Promise.all([
      can(ctx, EMPLOYEE, 'update'),
      can(ctx, EMPLOYEE, 'linkUser'),
      can(ctx, EMPLOYEE, 'markLeave'),
      can(ctx, ASSESSMENT, 'create'),
      can(ctx, ASSESSMENT, 'view'),
      can(ctx, EMPLOYEE, 'viewSensitive'),
      can(ctx, EMPLOYEE, 'viewNotes'),
      can(ctx, 'talent.profile', 'view'),
      can(ctx, 'talent.profile', 'viewContacts'),
      can(ctx, 'talent.profile', 'manage'),
      can(ctx, 'talent.contract', 'view'),
      can(ctx, EMPLOYEE, 'delete'),
    ]);
    return {
      employee,
      departmentTitle:
        departments.get(employee.departmentId) ?? employee.departmentId,
      positionTitle: employee.positionId
        ? (positions.get(employee.positionId) ?? null)
        : null,
      managerName: manager ? String(manager.name) : null,
      userName: await userName(employee.userId),
      coreFieldsLocked: events.length > 0,
      can: {
        update,
        linkUser,
        markLeave,
        assess,
        viewAssessments,
        viewSensitive,
        viewNotes,
        viewProfile,
        viewContacts,
        manageProfile,
        viewContracts,
        delete: deletable && !employee.userId,
      },
    };
  }

  function parseEmployeeInput(
    input: unknown,
    partial: boolean,
  ): Record<string, unknown> {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const values: Record<string, unknown> = {};
    const set = (key: string, value: unknown) => {
      if (value !== undefined) values[key] = value;
    };
    if (!partial || input.employeeNo !== undefined)
      set(
        'employeeNo',
        requireString(input.employeeNo, 'EMPLOYEE_NO_REQUIRED', { max: 64 }),
      );
    if (!partial || input.name !== undefined)
      set(
        'name',
        requireString(input.name, 'EMPLOYEE_NAME_REQUIRED', { max: 200 }),
      );
    if (!partial || input.departmentId !== undefined)
      set(
        'departmentId',
        requireString(input.departmentId, 'EMPLOYEE_DEPARTMENT_REQUIRED', {
          max: 64,
        }),
      );
    if (input.positionId !== undefined)
      set(
        'positionId',
        requireString(input.positionId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }),
      );
    if (input.managerEmployeeId !== undefined)
      set(
        'managerEmployeeId',
        requireString(input.managerEmployeeId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }),
      );
    if (input.status !== undefined)
      set(
        'status',
        optionalEnum(
          input.status,
          EMPLOYEE_STATUSES,
          'EMPLOYEE_STATUS_INVALID',
        ) ?? 'active',
      );
    if (input.hireDate !== undefined)
      set('hireDate', optionalDate(input.hireDate, 'EMPLOYEE_DATE_INVALID'));
    if (input.careerStartDate !== undefined)
      set(
        'careerStartDate',
        optionalDate(input.careerStartDate, 'EMPLOYEE_DATE_INVALID'),
      );
    if (input.positionSince !== undefined)
      set(
        'positionSince',
        optionalDate(input.positionSince, 'EMPLOYEE_DATE_INVALID'),
      );
    if (input.email !== undefined)
      set(
        'email',
        requireString(input.email, 'INVALID_INPUT', {
          optional: true,
          max: 320,
        }),
      );
    if (input.mobile !== undefined)
      set(
        'mobile',
        requireString(input.mobile, 'INVALID_INPUT', {
          optional: true,
          max: 32,
        }),
      );
    if (input.note !== undefined)
      set(
        'note',
        requireString(input.note, 'INVALID_INPUT', {
          optional: true,
          max: 4000,
        }),
      );
    if (input.gender !== undefined)
      set('gender', optionalEnum(input.gender, GENDERS, 'INVALID_INPUT'));
    if (input.birthDate !== undefined)
      set('birthDate', optionalDate(input.birthDate, 'EMPLOYEE_DATE_INVALID'));
    if (input.idType !== undefined)
      set('idType', optionalEnum(input.idType, ID_TYPES, 'INVALID_INPUT'));
    if (input.idNumber !== undefined)
      set(
        'idNumber',
        requireString(input.idNumber, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }),
      );
    if (input.employmentType !== undefined)
      set(
        'employmentType',
        optionalEnum(input.employmentType, EMPLOYMENT_TYPES, 'INVALID_INPUT') ??
          'fullTime',
      );
    if (input.workLocation !== undefined)
      set(
        'workLocation',
        requireString(input.workLocation, 'INVALID_INPUT', {
          optional: true,
          max: 200,
        }),
      );
    if (input.probationEndDate !== undefined)
      set(
        'probationEndDate',
        optionalDate(input.probationEndDate, 'EMPLOYEE_DATE_INVALID'),
      );
    if (input.regularizedAt !== undefined)
      set(
        'regularizedAt',
        optionalDate(input.regularizedAt, 'EMPLOYEE_DATE_INVALID'),
      );
    if (input.address !== undefined)
      set(
        'address',
        requireString(input.address, 'INVALID_INPUT', {
          optional: true,
          max: 500,
        }),
      );
    return values;
  }

  /**
   * Walks up the manager chain from `managerId`; when it reaches `selfId`,
   * answers the names on the loop (starting with the employee being saved).
   * Imported data may already contain loops elsewhere, so the walk is bounded
   * and stops at any repeated employee.
   */
  async function managerCycle(
    connection: DatabaseConnection,
    selfId: string,
    managerId: string,
  ): Promise<string[] | undefined> {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = managerId;
    for (let depth = 0; cursor && depth < MAX_MANAGER_DEPTH; depth += 1) {
      if (cursor === selfId) break;
      if (seen.has(cursor)) return undefined;
      seen.add(cursor);
      chain.push(cursor);
      const next: { managerEmployeeId?: unknown } | undefined =
        await connection.query
          .selectFrom('employees')
          .select(['managerEmployeeId'])
          .where('id', '=', cursor)
          .executeTakeFirst();
      cursor = next?.managerEmployeeId ? str(next.managerEmployeeId) : null;
    }
    if (cursor !== selfId) return undefined;
    const rows = await connection.query
      .selectFrom('employees')
      .select(['id', 'name'])
      .where('id', 'in', [selfId, ...chain])
      .execute();
    const names = new Map(rows.map((r) => [str(r.id), str(r.name)]));
    return [selfId, ...chain].map((id) => names.get(id) ?? id);
  }

  async function assertReferences(
    values: Record<string, unknown>,
    connection: DatabaseConnection,
    selfId: string | null,
    current?: EmployeeRecord,
  ): Promise<void> {
    const careerDate =
      values.careerStartDate === undefined
        ? current?.careerStartDate
        : values.careerStartDate;
    const hireDate =
      values.hireDate === undefined ? current?.hireDate : values.hireDate;
    if (
      typeof careerDate === 'string' &&
      typeof hireDate === 'string' &&
      careerDate > hireDate
    )
      throw new HrError('EMPLOYEE_CAREER_DATE_INVALID');
    if (typeof values.departmentId === 'string') {
      const department = await organization.getDepartment(
        values.departmentId,
        connection,
      );
      if (!department) throw new HrError('EMPLOYEE_DEPARTMENT_NOT_FOUND', 404);
    }
    if (typeof values.positionId === 'string') {
      const position = await connection.query
        .selectFrom('positions')
        .select(['id', 'active'])
        .where('id', '=', values.positionId)
        .executeTakeFirst();
      if (!position) throw new HrError('EMPLOYEE_POSITION_NOT_FOUND', 404);
      // A disabled position keeps the people already on it but cannot be chosen again.
      if (!bool(position.active) && current?.positionId !== values.positionId)
        throw new HrError('EMPLOYEE_POSITION_INACTIVE', 409);
    }
    if (typeof values.managerEmployeeId === 'string') {
      if (values.managerEmployeeId === selfId)
        throw new HrError('EMPLOYEE_MANAGER_SELF', 400);
      const manager = await connection.query
        .selectFrom('employees')
        .select(['id'])
        .where('id', '=', values.managerEmployeeId)
        .executeTakeFirst();
      if (!manager) throw new HrError('EMPLOYEE_MANAGER_NOT_FOUND', 404);
      if (selfId) {
        const cycle = await managerCycle(
          connection,
          selfId,
          values.managerEmployeeId,
        );
        if (cycle)
          throw new HrError('EMPLOYEE_MANAGER_CYCLE', 409, { names: cycle });
      }
    }
    if (typeof values.employeeNo === 'string') {
      const existing = await connection.query
        .selectFrom('employees')
        .select(['id'])
        .where('employeeNo', '=', values.employeeNo)
        .executeTakeFirst();
      if (existing && String(existing.id) !== selfId)
        throw new HrError('EMPLOYEE_NO_TAKEN', 409);
    }
    if (typeof values.userId === 'string') {
      const user = await users.get(values.userId).catch(() => undefined);
      if (!user) throw new HrError('USER_NOT_FOUND', 404);
      const existing = await connection.query
        .selectFrom('employees')
        .select(['id'])
        .where('userId', '=', values.userId)
        .executeTakeFirst();
      if (existing && String(existing.id) !== selfId)
        throw new HrError('EMPLOYEE_USER_TAKEN', 409);
    }
  }

  async function applyCoreChange(
    connection: DatabaseConnection,
    employee: EmployeeRecord,
    changes: {
      departmentId?: string;
      positionId?: string | null;
      status?: string;
    },
    options: { positionSince?: string } = {},
  ): Promise<string[]> {
    const affected = new Set<string>();
    const values: Record<string, unknown> = {};
    const nextStatus = changes.status ?? employee.status;
    if (
      changes.departmentId !== undefined &&
      changes.departmentId !== employee.departmentId
    )
      values.departmentId = changes.departmentId;
    if (
      changes.positionId !== undefined &&
      changes.positionId !== employee.positionId
    ) {
      values.positionId = changes.positionId;
      values.positionSince = options.positionSince ?? today();
      if (employee.userId) affected.add(employee.userId);
    }
    if (changes.status !== undefined && changes.status !== employee.status)
      values.status = changes.status;
    if (Object.keys(values).length) {
      values.updatedAt = new Date();
      await connection.query
        .updateTable('employees')
        .set(values)
        .where('id', '=', employee.id)
        .execute();
    }
    if (nextStatus === 'leave') {
      // Leaving ends the learning the employee had not finished, locked path steps and session enrollments included.
      const stamp = new Date();
      await connection.query
        .updateTable('assignments')
        .set({ status: 'cancelled', cancelledAt: stamp, updatedAt: stamp })
        .where('employeeId', '=', employee.id)
        .where('status', 'in', [
          'notStarted',
          'inProgress',
          'overdue',
          'locked',
        ])
        .execute();
      await connection.query
        .updateTable('trainingEnrollments')
        .set({ status: 'cancelled', updatedAt: stamp })
        .where('employeeId', '=', employee.id)
        .where('status', '=', 'enrolled')
        .execute();
    }
    if (employee.userId) {
      if (nextStatus === 'leave') {
        await organization.deactivateMemberships(employee.userId, connection);
        affected.add(employee.userId);
      } else if (
        values.departmentId !== undefined ||
        changes.status !== undefined
      ) {
        await organization.syncPrimaryMembership(
          employee.userId,
          changes.departmentId ?? employee.departmentId,
          connection,
        );
        affected.add(employee.userId);
      }
    }
    return [...affected];
  }

  async function notifyUsers(userIds: readonly string[]): Promise<void> {
    for (const id of new Set(userIds))
      await authz.permissionSets.notifyAssignmentsChanged({ type: 'user', id });
  }

  async function listWithPolicy(
    ctx: ActorContext,
    action: string,
    filters: {
      search?: string;
      departmentId?: string;
      positionId?: string;
      status?: string;
      employmentType?: string;
      /** Links from the health-check report: a set of employees, an import batch, a quick filter. */
      ids?: readonly string[];
      batchId?: string;
      quick?: 'noPosition' | 'noManager';
    },
  ) {
    const policies = await authorizeAction(
      ctx.authz,
      action === 'export' ? 'talent.roster' : EMPLOYEE,
      action === 'export' ? 'export' : 'list',
    );
    const departmentIds = filters.departmentId
      ? await organization.descendantsOf(filters.departmentId)
      : undefined;
    if (departmentIds && !departmentIds.length) return [] as EmployeeRecord[];
    const rows = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findMany({
        filter: (f) =>
          f.and([
            ...(filters.search
              ? [
                  f.or([
                    f
                      .string('name')
                      .includes(filters.search, { mode: 'insensitive' }),
                    f
                      .string('employeeNo')
                      .includes(filters.search, { mode: 'insensitive' }),
                  ]),
                ]
              : []),
            ...(departmentIds
              ? [
                  f.or(
                    departmentIds.map((id) => f.string('departmentId').eq(id)),
                  ),
                ]
              : []),
            ...(filters.positionId
              ? [f.string('positionId').eq(filters.positionId)]
              : []),
            ...(filters.status ? [f.string('status').eq(filters.status)] : []),
            ...(filters.employmentType
              ? [f.string('employmentType').eq(filters.employmentType)]
              : []),
            ...(filters.ids
              ? [
                  filters.ids.length
                    ? f.or(filters.ids.map((id) => f.string('id').eq(id)))
                    : f.string('id').eq('-'),
                ]
              : []),
            ...(filters.batchId
              ? [f.string('lastImportBatchId').eq(filters.batchId)]
              : []),
            ...(filters.quick === 'noPosition'
              ? [f.string('positionId').eq(null)]
              : filters.quick === 'noManager'
                ? [f.string('managerEmployeeId').eq(null)]
                : []),
          ]),
        sort: (s) => [s.field('employeeNo').asc()],
      });
    return rows.map((r) => toEmployee(r as Record<string, unknown>));
  }

  /** Checks rows against the organisation; errors block the import, new position titles only need a job family. */
  async function validateImport(rows: ImportRow[]): Promise<ImportPreview> {
    const [departments, positions, employees, families] = await Promise.all([
      database
        .query()
        .selectFrom('departments')
        .select(['id', 'code', 'active', 'parentId'])
        .execute(),
      database
        .query()
        .selectFrom('positions')
        .select(['id', 'code', 'title', 'active'])
        .execute(),
      database
        .query()
        .selectFrom('employees')
        .select(['id', 'employeeNo'])
        .execute(),
      database
        .query()
        .selectFrom('jobFamilies')
        .select(['id', 'title', 'active', 'sortOrder'])
        .orderBy('sortOrder', 'asc')
        .execute(),
    ]);
    const byId = new Map(departments.map((d) => [String(d.id), d]));
    // A department is usable only when it and every ancestor are enabled.
    const usable = (id: string): boolean => {
      let cursor: string | null = id;
      for (let depth = 0; cursor && depth < 64; depth += 1) {
        const department = byId.get(cursor);
        if (!department || !bool(department.active)) return false;
        cursor = department.parentId ? str(department.parentId) : null;
      }
      return true;
    };
    const departmentByCode = new Map(
      departments.filter((d) => d.code).map((d) => [String(d.code), d]),
    );
    const positionByCode = new Map(positions.map((p) => [String(p.code), p]));
    const activeTitles = new Set(
      positions
        .filter((p) => bool(p.active))
        .map((p) => titleKey(str(p.title))),
    );
    const existingNos = new Set(employees.map((e) => String(e.employeeNo)));
    const seen = new Set<string>();
    const newPositions: string[] = [];
    for (const row of rows) {
      if (!row.employeeNo) row.errors.push('IMPORT_EMPLOYEE_NO_REQUIRED');
      if (!row.name) row.errors.push('IMPORT_NAME_REQUIRED');
      if (!row.departmentCode) row.errors.push('IMPORT_DEPARTMENT_REQUIRED');
      else {
        const department = departmentByCode.get(row.departmentCode);
        if (!department) row.errors.push('IMPORT_DEPARTMENT_NOT_FOUND');
        else if (!usable(String(department.id)))
          row.errors.push('IMPORT_DEPARTMENT_INACTIVE');
      }
      if (row.position) {
        const byCode = positionByCode.get(row.position);
        if (byCode) {
          if (!bool(byCode.active)) row.errors.push('IMPORT_POSITION_INACTIVE');
        } else if (POSITION_CODE.test(row.position)) {
          // Looks like a code but none exists: a typo, not a new position.
          row.errors.push('IMPORT_POSITION_NOT_FOUND');
        } else if (!activeTitles.has(titleKey(row.position))) {
          const title = row.position.replace(/\s+/gu, ' ').trim();
          row.newPosition = title;
          if (!newPositions.some((t) => titleKey(t) === titleKey(title)))
            newPositions.push(title);
        }
      }
      if (row.managerEmployeeNo) {
        if (row.managerEmployeeNo === row.employeeNo)
          row.errors.push('IMPORT_MANAGER_SELF');
        else if (
          !existingNos.has(row.managerEmployeeNo) &&
          !rows.some((r) => r.employeeNo === row.managerEmployeeNo && r !== row)
        )
          row.errors.push('IMPORT_MANAGER_NOT_FOUND');
      }
      if (row.hireDate && !/^\d{4}-\d{2}-\d{2}$/u.test(row.hireDate))
        row.errors.push('IMPORT_HIRE_DATE_INVALID');
      if (row.email && !EMAIL.test(row.email))
        row.errors.push('IMPORT_EMAIL_INVALID');
      if (row.mobile && !MOBILE.test(row.mobile.replace(/[\s-]/gu, '')))
        row.errors.push('IMPORT_MOBILE_INVALID');
      if (row.employeeNo) {
        if (seen.has(row.employeeNo))
          row.errors.push('IMPORT_EMPLOYEE_NO_DUPLICATE');
        seen.add(row.employeeNo);
      }
      row.action = row.errors.length
        ? 'skip'
        : existingNos.has(row.employeeNo)
          ? 'update'
          : 'create';
    }
    return {
      rows,
      created: rows.filter((r) => r.action === 'create').length,
      updated: rows.filter((r) => r.action === 'update').length,
      newPositions,
      jobFamilies: families
        .filter((f) => bool(f.active))
        .map((f) => ({ id: String(f.id), title: str(f.title) })),
    };
  }

  async function toBatchSummary(
    row: Record<string, unknown>,
  ): Promise<ImportBatchSummary> {
    const summary = row.checkSummary
      ? (JSON.parse(
          typeof row.checkSummary === 'string'
            ? row.checkSummary
            : JSON.stringify(row.checkSummary),
        ) as { mustFix?: number; suggested?: number })
      : null;
    const ids = (value: unknown): string[] => {
      const parsed: unknown =
        typeof value === 'string' ? JSON.parse(value) : value;
      return Array.isArray(parsed) ? parsed.map((v) => str(v)) : [];
    };
    return {
      id: str(row.id),
      importedByName: await userName(str(row.importedByUserId)),
      createdCount: Number(row.createdCount ?? 0),
      updatedCount: Number(row.updatedCount ?? 0),
      createdPositionIds: ids(row.createdPositionIds),
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(str(row.createdAt)).toISOString(),
      check: summary
        ? {
            mustFix: Number(summary.mustFix ?? 0),
            suggested: Number(summary.suggested ?? 0),
            report: str(row.checkReport ?? ''),
          }
        : null,
    };
  }

  const service: TalentService = {
    ...framework,

    async listEmployees(ctx, filters) {
      const employees = await listWithPolicy(ctx, 'view', filters);
      const [departments, positions, requirements, levels] = await Promise.all([
        departmentTitles(employees.map((e) => e.departmentId)),
        positionTitles(employees.map((e) => e.positionId)),
        confirmedRequirements(employees.map((e) => e.positionId)),
        currentLevels(employees.map((e) => e.id)),
      ]);
      const now = today();
      const managerIds = [
        ...new Set(
          employees
            .map((e) => e.managerEmployeeId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const managers = new Map(
        managerIds.length
          ? (
              await database
                .query()
                .selectFrom('employees')
                .select(['id', 'name'])
                .where('id', 'in', managerIds)
                .execute()
            ).map((m) => [str(m.id), str(m.name)])
          : [],
      );
      const items: EmployeeListItem[] = employees.map((employee) => ({
        ...employee,
        managerName: employee.managerEmployeeId
          ? (managers.get(employee.managerEmployeeId) ?? null)
          : null,
        departmentTitle:
          departments.get(employee.departmentId) ?? employee.departmentId,
        positionTitle: employee.positionId
          ? (positions.get(employee.positionId) ?? null)
          : null,
        gapCount: employee.positionId
          ? gapCount(
              requirements.get(employee.positionId) ?? [],
              levels.get(employee.id),
            )
          : 0,
        tenureMonths: employee.hireDate
          ? monthsBetween(employee.hireDate, employee.leaveDate ?? now)
          : null,
      }));
      const [create, importAllowed, exportAllowed, reviewChanges] =
        await Promise.all([
          can(ctx, EMPLOYEE, 'create'),
          can(ctx, EMPLOYEE, 'import'),
          can(ctx, 'talent.roster', 'export'),
          can(ctx, 'talent.profileChange', 'review'),
        ]);
      return {
        items,
        can: {
          create,
          import: importAllowed,
          export: exportAllowed,
          reviewChanges,
        },
      };
    },

    async getEmployee(ctx, id) {
      const employee = await readEmployee(ctx, id);
      return employee ? detail(ctx, employee) : undefined;
    },

    async getMyEmployee(ctx) {
      const own = await service.employeeOfUser(ctx.userId);
      if (!own) return undefined;
      return service.getEmployee(ctx, own.id);
    },

    async createEmployee(ctx, input) {
      const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'create');
      const values = parseEmployeeInput(input, false);
      const { record, affected } = await database.transaction(
        async (connection) => {
          await assertReferences(values, connection, null);
          const now = new Date();
          const id = newId();
          const { record } = await connection
            .repository('employees')
            .withPolicy(policyOf(policies, 'employees'))
            .createOne({
              values: {
                id,
                status: 'active',
                employmentType: 'fullTime',
                ...values,
                positionSince:
                  values.positionSince ??
                  (values.positionId ? (values.hireDate ?? today()) : null),
                createdAt: now,
                updatedAt: now,
              },
            });
          const employee = toEmployee(record);
          const affected: string[] = [];
          if (employee.userId && employee.status !== 'leave') {
            await organization.syncPrimaryMembership(
              employee.userId,
              employee.departmentId,
              connection,
            );
            affected.push(employee.userId);
          }
          return { record: employee, affected };
        },
      );
      await notifyUsers(affected);
      return record;
    },

    async updateEmployee(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'update');
      const values = parseEmployeeInput(input, true);
      const { record, affected } = await database.transaction(
        async (connection) => {
          const currentRow = await connection.query
            .selectFrom('employees')
            .select([...BASE_FIELDS])
            .where('id', '=', id)
            .executeTakeFirst();
          if (!currentRow) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
          const current = toEmployee(currentRow);
          const events = await connection.query
            .selectFrom('jobEvents')
            .select(['id'])
            .where('employeeId', '=', id)
            .limit(1)
            .execute();
          if (events.length) {
            // Once a personnel action has taken effect, department, position and status belong to the action flow.
            for (const key of [
              'departmentId',
              'positionId',
              'status',
            ] as const) {
              if (values[key] !== undefined && values[key] !== current[key])
                throw new HrError('EMPLOYEE_CORE_FIELDS_LOCKED', 409);
            }
          }
          await assertReferences(values, connection, id, current);
          const core = {
            ...(typeof values.departmentId === 'string'
              ? { departmentId: values.departmentId }
              : {}),
            ...(values.positionId !== undefined
              ? { positionId: values.positionId as string | null }
              : {}),
            ...(typeof values.status === 'string'
              ? { status: values.status }
              : {}),
          };
          const {
            departmentId: _d,
            positionId: _p,
            status: _s,
            ...rest
          } = values;
          const repo = connection
            .repository('employees')
            .withPolicy(policyOf(policies, 'employees'));
          if (Object.keys(rest).length)
            await repo.updateOne({
              filter: { id },
              values: { ...rest, updatedAt: new Date() },
            });
          const affected = await applyCoreChange(connection, current, core, {
            positionSince:
              typeof values.positionSince === 'string'
                ? values.positionSince
                : undefined,
          });
          const updated = await connection.query
            .selectFrom('employees')
            .select([...BASE_FIELDS])
            .where('id', '=', id)
            .executeTakeFirst();
          return {
            record: toEmployee(updated as Record<string, unknown>),
            affected,
          };
        },
      );
      await notifyUsers(affected);
      const visible = await readEmployee(ctx, id);
      return visible ?? record;
    },

    async linkUser(ctx, id, userId) {
      const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'linkUser');
      const affected = await database.transaction(async (connection) => {
        const row = await connection.query
          .selectFrom('employees')
          .select([...BASE_FIELDS])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        const current = toEmployee(row);
        if (userId) await assertReferences({ userId }, connection, id);
        await connection
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .updateOne({
            filter: { id },
            values: { userId, updatedAt: new Date() },
          });
        const affected: string[] = [];
        if (current.userId && current.userId !== userId) {
          await organization.deactivateMemberships(current.userId, connection);
          affected.push(current.userId);
        }
        if (userId && current.status !== 'leave') {
          await organization.syncPrimaryMembership(
            userId,
            current.departmentId,
            connection,
          );
          affected.push(userId);
        }
        return affected;
      });
      await notifyUsers(affected);
      return (await readEmployee(ctx, id))!;
    },

    async markLeave(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'markLeave');
      const leaveDate =
        optionalDate(input.leaveDate, 'EMPLOYEE_DATE_INVALID') ?? today();
      const leaveReason = optionalEnum(
        input.leaveReason,
        LEAVE_REASONS,
        'INVALID_INPUT',
      );
      const affected = await database.transaction(async (connection) => {
        const row = await connection.query
          .selectFrom('employees')
          .select([...BASE_FIELDS])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        const current = toEmployee(row);
        if (current.status === 'leave')
          throw new HrError('EMPLOYEE_ALREADY_LEFT', 409);
        await connection
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .updateOne({
            filter: { id },
            values: {
              status: 'leave',
              leaveDate,
              leaveReason,
              updatedAt: new Date(),
            },
          });
        // Contracts in force end with the employment.
        await connection.query
          .updateTable('employmentContracts')
          .set({ status: 'terminated', updatedAt: new Date() })
          .where('employeeId', '=', id)
          .where('status', '=', 'active')
          .execute();
        return applyCoreChange(
          connection,
          { ...current, status: 'leave' },
          { status: 'leave' },
        );
      });
      await notifyUsers(affected);
      return (await readEmployee(ctx, id))!;
    },

    async gaps(ctx, employeeId) {
      const employee = await readEmployee(ctx, employeeId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const competencyPolicies = await tryAuthorizeAction(
        ctx.authz,
        'talent.competency',
        'view',
      );
      const requirements = employee.positionId
        ? ((await confirmedRequirements([employee.positionId])).get(
            employee.positionId,
          ) ?? [])
        : [];
      const levels =
        (await currentLevels([employeeId])).get(employeeId) ??
        new Map<string, number>();
      const competencyIds = [
        ...new Set([
          ...requirements.map((r) => r.competencyId),
          ...levels.keys(),
        ]),
      ];
      const competencies = competencyIds.length
        ? competencyPolicies
          ? await database
              .repository('competencies')
              .withPolicy(policyOf(competencyPolicies, 'competencies'))
              .findMany({
                filter: (f) =>
                  f.or(competencyIds.map((id) => f.string('id').eq(id))),
              })
          : await database
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
              .where('id', 'in', competencyIds)
              .execute()
        : [];
      const byId = new Map(
        competencies.map((row) => {
          const c = toCompetency(row);
          return [c.id, c] as const;
        }),
      );
      const levelRows = competencyIds.length
        ? await database
            .query()
            .selectFrom('competencyLevels')
            .select(['id', 'competencyId', 'level', 'title', 'behaviors'])
            .where('competencyId', 'in', competencyIds)
            .orderBy('level', 'asc')
            .execute()
        : [];
      const levelsByCompetency = new Map<string, CompetencyLevel[]>();
      for (const row of levelRows) {
        const level = toLevel(row);
        levelsByCompetency.set(level.competencyId, [
          ...(levelsByCompetency.get(level.competencyId) ?? []),
          level,
        ]);
      }
      const rows: GapRow[] = [];
      for (const requirement of requirements) {
        const competency: Competency | undefined = byId.get(
          requirement.competencyId,
        );
        if (!competency) continue;
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
          gap: Math.max(requirement.requiredLevel - currentLevel, 0),
          levels: levelsByCompetency.get(competency.id) ?? [],
        });
      }
      for (const [competencyId, level] of levels) {
        if (requirements.some((r) => r.competencyId === competencyId)) continue;
        const competency = byId.get(competencyId);
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
          gap: 0,
          levels: levelsByCompetency.get(competencyId) ?? [],
        });
      }
      // Mandatory requirements first, then the biggest gaps.
      rows.sort(
        (a, b) =>
          Number(b.requiredLevel !== null) - Number(a.requiredLevel !== null) ||
          Number(b.mandatory) - Number(a.mandatory) ||
          b.gap - a.gap ||
          a.title.localeCompare(b.title),
      );
      const positions = await positionTitles([employee.positionId]);
      return {
        rows,
        positionTitle: employee.positionId
          ? (positions.get(employee.positionId) ?? null)
          : null,
      };
    },

    async assessments(ctx, employeeId) {
      const policies = await authorizeAction(ctx.authz, ASSESSMENT, 'view');
      const rows = await database
        .repository('employeeCompetencies')
        .withPolicy(policyOf(policies, 'employeeCompetencies'))
        .findMany({
          filter: { employeeId },
          sort: (s) => [s.field('assessedAt').desc()],
        });
      const competencyIds = [
        ...new Set(
          rows.map((r) => String((r as Record<string, unknown>).competencyId)),
        ),
      ];
      const competencies = competencyIds.length
        ? await database
            .query()
            .selectFrom('competencies')
            .select(['id', 'title'])
            .where('id', 'in', competencyIds)
            .execute()
        : [];
      const titles = new Map(
        competencies.map((c) => [String(c.id), String(c.title)]),
      );
      const names = new Map<string, string>();
      const result: AssessmentRow[] = [];
      for (const raw of rows) {
        const row = raw as Record<string, unknown>;
        const assessedBy = String(row.assessedBy);
        if (!names.has(assessedBy))
          names.set(assessedBy, (await userName(assessedBy)) ?? assessedBy);
        result.push({
          id: String(row.id),
          competencyId: String(row.competencyId),
          competencyTitle:
            titles.get(String(row.competencyId)) ?? String(row.competencyId),
          level: Number(row.level),
          source: String(row.source),
          evidence: row.evidence == null ? null : str(row.evidence),
          assessedBy,
          assessedByName: names.get(assessedBy) ?? assessedBy,
          assessedAt: new Date(String(row.assessedAt)).toISOString(),
        });
      }
      return result;
    },

    async createAssessment(ctx, employeeId, input) {
      const policies = await authorizeAction(ctx.authz, ASSESSMENT, 'create');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const competencyId = requireString(
        input.competencyId,
        'ASSESSMENT_COMPETENCY_REQUIRED',
        { max: 64 },
      )!;
      const level = Number(input.level);
      const evidence = requireString(input.evidence, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
      // Assessing within scope is proven by reading the employee through the view policy.
      const employee = await readEmployee(ctx, employeeId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      if (employee.userId && employee.userId === ctx.userId)
        throw new HrError('ASSESSMENT_SELF', 403);
      const competency = await database
        .query()
        .selectFrom('competencies')
        .select(['id', 'title', 'maxLevel', 'reviewStatus', 'active'])
        .where('id', '=', competencyId)
        .executeTakeFirst();
      if (!competency || !competency.active)
        throw new HrError('COMPETENCY_NOT_FOUND', 404);
      if (competency.reviewStatus !== 'confirmed')
        throw new HrError('COMPETENCY_NOT_CONFIRMED', 409);
      if (
        !Number.isInteger(level) ||
        level < 0 ||
        level > Number(competency.maxLevel)
      )
        throw new HrError('ASSESSMENT_LEVEL_INVALID', 400);
      const now = new Date();
      const { record } = await database
        .repository('employeeCompetencies')
        .withPolicy(policyOf(policies, 'employeeCompetencies'))
        .createOne({
          values: {
            id: newId(),
            employeeId,
            competencyId,
            level,
            source: 'assessment',
            evidence,
            assessedBy: ctx.userId,
            assessedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
      const row = record as Record<string, unknown>;
      return {
        id: String(row.id),
        competencyId,
        competencyTitle: String(competency.title),
        level,
        source: 'assessment',
        evidence,
        assessedBy: ctx.userId,
        assessedByName: (await userName(ctx.userId)) ?? ctx.userId,
        assessedAt: now.toISOString(),
      };
    },

    importTemplate() {
      const sheet = XLSX.utils.aoa_to_sheet([
        [...IMPORT_COLUMNS],
        [
          'QH2999',
          '张三',
          'SZ-MC',
          'prod-cnc-operator',
          'QH1003',
          '2026-01-15',
          'zhangsan@example.test',
          '13800000000',
        ],
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'employees');
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    },

    async importPreview(ctx, file) {
      await authorizeAction(ctx.authz, EMPLOYEE, 'import');
      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(file, { type: 'buffer', cellDates: true });
      } catch {
        throw new HrError('IMPORT_FILE_INVALID', 400);
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
      if (!sheet) throw new HrError('IMPORT_FILE_INVALID', 400);
      const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: false,
        defval: '',
      });
      const [, ...body] = rawRows;
      const cell = (row: unknown[], index: number): string =>
        str(row[index] ?? '').trim();
      const rows: ImportRow[] = body
        .map((row, index) => ({ row, line: index + 2 }))
        .filter(({ row }) =>
          row.some((value) => str(value ?? '').trim() !== ''),
        )
        .map(({ row, line }) => ({
          line,
          employeeNo: cell(row, 0),
          name: cell(row, 1),
          departmentCode: cell(row, 2),
          position: cell(row, 3),
          managerEmployeeNo: cell(row, 4),
          hireDate: normalizeDate(cell(row, 5)),
          email: cell(row, 6),
          mobile: cell(row, 7),
          errors: [] as string[],
          action: 'create' as const,
          newPosition: null,
        }));
      if (rows.length > 2000) throw new HrError('IMPORT_TOO_MANY_ROWS', 400);
      return validateImport(rows);
    },

    async importCommit(ctx, rows, newPositionFamilies) {
      const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'import');
      const preview = await validateImport(
        rows.map((row) => ({
          ...row,
          errors: [],
          action: 'create' as const,
          newPosition: null,
        })),
      );
      if (preview.rows.some((row) => row.errors.length))
        throw new HrError('IMPORT_HAS_ERRORS', 400, { rows: preview.rows });
      const families = new Map(preview.jobFamilies.map((f) => [f.id, f]));
      const missing = preview.newPositions.filter(
        (title) => !families.has(newPositionFamilies[title] ?? ''),
      );
      if (missing.length)
        throw new HrError('IMPORT_NEW_POSITION_FAMILY_REQUIRED', 400, {
          titles: missing,
        });
      const stamp = new Date();
      const batchId = `IMP-${today().replace(/-/gu, '')}-${newId()
        .replace(/[^a-z0-9]/giu, '')
        .slice(-4)
        .toUpperCase()}`;
      const result = await database.transaction(async (connection) => {
        const [departments, positions] = await Promise.all([
          connection.query
            .selectFrom('departments')
            .select(['id', 'code'])
            .execute(),
          connection.query
            .selectFrom('positions')
            .select(['id', 'code', 'title', 'active'])
            .execute(),
        ]);
        const departmentByCode = new Map(
          departments.map((d) => [String(d.code), String(d.id)]),
        );
        const positionByCode = new Map(
          positions.map((p) => [String(p.code), String(p.id)]),
        );
        const positionByTitle = new Map(
          positions
            .filter((p) => bool(p.active))
            .map((p) => [titleKey(str(p.title)), String(p.id)]),
        );
        // New positions first, so the rows can refer to them.
        const createdPositionIds: string[] = [];
        for (const [index, title] of preview.newPositions.entries()) {
          const id = newId();
          await connection.query
            .insertInto('positions')
            .values({
              id,
              code: `${batchId.toLowerCase()}-${index + 1}`,
              title,
              jobFamilyId: newPositionFamilies[title],
              grade: null,
              responsibilities: null,
              aiDraftedAt: null,
              importBatchId: batchId,
              active: true,
              sortOrder: 100 + index,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
          positionByTitle.set(titleKey(title), id);
          createdPositionIds.push(id);
        }
        const positionOf = (row: ImportRow): string | null =>
          !row.position
            ? null
            : (positionByCode.get(row.position) ??
              positionByTitle.get(titleKey(row.position)) ??
              null);
        const repo = connection
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'));
        const affected: string[] = [];
        const createdIds: string[] = [];
        const updatedIds: string[] = [];
        // Two passes: employees first, managers once every employee number exists.
        for (const row of preview.rows) {
          const existing = await connection.query
            .selectFrom('employees')
            .select([...BASE_FIELDS])
            .where('employeeNo', '=', row.employeeNo)
            .executeTakeFirst();
          const values = {
            name: row.name,
            departmentId: departmentByCode.get(row.departmentCode)!,
            positionId: positionOf(row),
            hireDate: row.hireDate || null,
            email: row.email || null,
            mobile: row.mobile || null,
          };
          if (existing) {
            const current = toEmployee(existing);
            const { departmentId, positionId, ...rest } = values;
            await repo.updateOne({
              filter: { id: current.id },
              values: {
                ...rest,
                lastImportBatchId: batchId,
                updatedAt: stamp,
              },
            });
            affected.push(
              ...(await applyCoreChange(connection, current, {
                departmentId,
                positionId,
              })),
            );
            if (
              departmentId !== current.departmentId ||
              positionId !== current.positionId
            ) {
              await connection.query
                .insertInto('jobEvents')
                .values({
                  id: newId(),
                  employeeId: current.id,
                  eventType: 'transfer',
                  fromDepartmentId: current.departmentId,
                  toDepartmentId: departmentId,
                  fromPositionId: current.positionId,
                  toPositionId: positionId,
                  effectiveDate: today(),
                  actionId: null,
                  createdAt: stamp,
                  updatedAt: stamp,
                })
                .execute();
            }
            updatedIds.push(current.id);
          } else {
            const id = newId();
            await repo.createOne({
              values: {
                id,
                employeeNo: row.employeeNo,
                status: 'active',
                employmentType: 'fullTime',
                ...values,
                positionSince: values.positionId
                  ? (values.hireDate ?? today())
                  : null,
                lastImportBatchId: batchId,
                createdAt: stamp,
                updatedAt: stamp,
              },
            });
            await connection.query
              .insertInto('jobEvents')
              .values({
                id: newId(),
                employeeId: id,
                eventType: 'onboard',
                fromDepartmentId: null,
                toDepartmentId: values.departmentId,
                fromPositionId: null,
                toPositionId: values.positionId,
                effectiveDate: values.hireDate ?? today(),
                actionId: null,
                createdAt: stamp,
                updatedAt: stamp,
              })
              .execute();
            createdIds.push(id);
          }
        }
        for (const row of preview.rows) {
          if (!row.managerEmployeeNo) continue;
          const manager = await connection.query
            .selectFrom('employees')
            .select(['id'])
            .where('employeeNo', '=', row.managerEmployeeNo)
            .executeTakeFirst();
          if (!manager) continue;
          await connection.query
            .updateTable('employees')
            .set({ managerEmployeeId: String(manager.id), updatedAt: stamp })
            .where('employeeNo', '=', row.employeeNo)
            .execute();
        }
        await connection.query
          .insertInto('employeeImportBatches')
          .values({
            id: batchId,
            importedByUserId: ctx.userId,
            createdCount: createdIds.length,
            updatedCount: updatedIds.length,
            createdEmployeeIds: JSON.stringify(createdIds),
            updatedEmployeeIds: JSON.stringify(updatedIds),
            createdPositionIds: JSON.stringify(createdPositionIds),
            checkSummary: null,
            checkReport: null,
            checkRunId: null,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        return {
          affected,
          created: createdIds.length,
          updated: updatedIds.length,
          createdPositions: createdPositionIds.length,
        };
      });
      await notifyUsers(result.affected);
      // After the commit: the HR assistant's health check runs in the background.
      deps.onEmployeesImported?.()?.(batchId);
      return {
        batchId,
        created: result.created,
        updated: result.updated,
        createdPositions: result.createdPositions,
      };
    },

    async listPositions(ctx) {
      const data = await framework.listFramework(ctx);
      const counts = new Map<string, number>();
      for (const row of await database
        .query()
        .selectFrom('employees')
        .select(['positionId'])
        .where('status', '!=', 'leave')
        .where('positionId', 'is not', null)
        .execute())
        counts.set(
          str(row.positionId),
          (counts.get(str(row.positionId)) ?? 0) + 1,
        );
      const families = data.canManage
        ? data.jobFamilies
        : data.jobFamilies.filter((f) => f.active);
      const visibleFamilies = new Set(families.map((f) => f.id));
      return {
        jobFamilies: families,
        positions: data.positions
          .filter(
            (p) =>
              data.canManage ||
              (p.active && visibleFamilies.has(p.jobFamilyId)),
          )
          .map((p) => ({ ...p, headcount: counts.get(p.id) ?? 0 })),
        canManage: data.canManage,
        canViewEmployees: await can(ctx, EMPLOYEE, 'list'),
      };
    },

    async latestImport(ctx) {
      if (!(await can(ctx, EMPLOYEE, 'import'))) return null;
      const row = await database
        .query()
        .selectFrom('employeeImportBatches')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .limit(1)
        .executeTakeFirst();
      return row ? toBatchSummary(row) : null;
    },

    async importBatch(ctx, id) {
      await authorizeAction(ctx.authz, EMPLOYEE, 'import');
      const row = await database
        .query()
        .selectFrom('employeeImportBatches')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('IMPORT_BATCH_NOT_FOUND', 404);
      return toBatchSummary(row);
    },

    async deleteEmployee(ctx, id) {
      const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'delete');
      await database.transaction(async (connection) => {
        const row = await connection.query
          .selectFrom('employees')
          .select(['id', 'userId'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        if (row.userId) throw new HrError('EMPLOYEE_DELETE_HAS_USER', 409);
        for (const [table, column] of EMPLOYEE_REFERENCES) {
          const hit = await connection.query
            .selectFrom(table)
            .select(['id'])
            .where(column, '=', id)
            .limit(1)
            .executeTakeFirst();
          if (hit) throw new HrError('EMPLOYEE_DELETE_REFERENCED', 409);
        }
        // Only the records an import itself wrote go with the employee.
        const events = await connection.query
          .selectFrom('jobEvents')
          .select(['id', 'actionId'])
          .where('employeeId', '=', id)
          .execute();
        if (events.some((e) => e.actionId))
          throw new HrError('EMPLOYEE_DELETE_REFERENCED', 409);
        await connection.query
          .deleteFrom('jobEvents')
          .where('employeeId', '=', id)
          .execute();
        for (const table of EMPLOYEE_OWN_TABLES)
          await connection.query
            .deleteFrom(table)
            .where('employeeId', '=', id)
            .execute();
        await connection
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .deleteOne({ filter: { id } });
      });
    },

    async exportRoster(ctx, filters, locale) {
      const employees = await listWithPolicy(ctx, 'export', filters);
      const sensitive = await can(ctx, EMPLOYEE, 'viewSensitive');
      const [departments, positions] = await Promise.all([
        departmentTitles(
          employees.map((e) => e.departmentId),
          locale,
        ),
        positionTitles(employees.map((e) => e.positionId)),
      ]);
      const sensitiveRows = sensitive
        ? await database
            .query()
            .selectFrom('employees')
            .select(['id', 'mobile', 'idNumber'])
            .where(
              'id',
              'in',
              employees.length ? employees.map((e) => e.id) : ['-'],
            )
            .execute()
        : [];
      const sensitiveById = new Map(
        sensitiveRows.map((r) => [String(r.id), r]),
      );
      const zh = locale.startsWith('zh');
      const header = zh
        ? [
            '工号',
            '姓名',
            '部门',
            '岗位',
            '状态',
            '用工类型',
            '入职日期',
            '邮箱',
            ...(sensitive ? ['手机', '证件号'] : []),
          ]
        : [
            'Employee no',
            'Name',
            'Department',
            'Position',
            'Status',
            'Employment type',
            'Hire date',
            'Email',
            ...(sensitive ? ['Mobile', 'ID number'] : []),
          ];
      const data = employees.map((e) => [
        e.employeeNo,
        e.name,
        departments.get(e.departmentId) ?? '',
        e.positionId ? (positions.get(e.positionId) ?? '') : '',
        e.status,
        e.employmentType,
        e.hireDate ?? '',
        e.email ?? '',
        ...(sensitive
          ? [
              str(sensitiveById.get(e.id)?.mobile ?? ''),
              maskIdNumber(
                sensitiveById.get(e.id)?.idNumber == null
                  ? null
                  : String(sensitiveById.get(e.id)?.idNumber),
              ) ?? '',
            ]
          : []),
      ]);
      const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'roster');
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    },

    async employeeOfUser(userId, connection) {
      const row = await (connection ? connection.query : database.query())
        .selectFrom('employees')
        .select([...BASE_FIELDS])
        .where('userId', '=', userId)
        .executeTakeFirst();
      return row ? toEmployee(row) : undefined;
    },

    applyCoreChange,
    notifyUsers,
  };

  return service;
}

function normalizeDate(value: string): string {
  if (!value) return '';
  const trimmed = value.trim();
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/u.exec(trimmed);
  if (iso)
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime())
    ? trimmed
    : parsed.toISOString().slice(0, 10);
}

export { toPosition };

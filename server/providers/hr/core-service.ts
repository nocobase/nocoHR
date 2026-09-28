import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { OrganizationService } from './organization-service.js';
import type { PersonnelSettingsService } from './personnel-settings.js';
import {
  addDays,
  daysBetween,
  HrError,
  isRecord,
  newId,
  optionalDate,
  optionalEnum,
  requireEnum,
  requireString,
  toDateOnly,
  today,
  str,
} from './shared.js';
import {
  EMPLOYMENT_TYPES,
  LEAVE_REASONS,
  toEmployee,
  type EmployeeRecord,
  type TalentService,
} from './talent-service.js';

export const ACTION_TYPES = [
  'onboard',
  'regularize',
  'transfer',
  'promote',
  'offboard',
] as const;
export const ACTION_STATUSES = [
  'draft',
  'pending',
  'approved',
  'effective',
  'rejected',
  'cancelled',
] as const;
export const CONTRACT_TYPES = [
  'fixedTerm',
  'openEnded',
  'internship',
  'labor',
] as const;
export const CONTRACT_STATUSES = [
  'active',
  'expired',
  'renewed',
  'terminated',
] as const;
export const DEGREES = [
  'highSchool',
  'associate',
  'bachelor',
  'master',
  'doctor',
  'other',
] as const;
export const ATTACHMENT_CATEGORIES = [
  'diploma',
  'idCard',
  'contract',
  'other',
] as const;
export const PROFILE_CHANGE_FIELDS = [
  'mobile',
  'email',
  'address',
  'educations',
  'experiences',
  'emergencyContacts',
] as const;

/** The settings item HR administrators hold; the second approval level. */
export const HR_ADMIN_SETTINGS = 'talent.hr';

export interface ApprovalStep {
  level: number;
  kind: 'departmentHead' | 'hrAdmin';
  approverUserId: string | null;
  departmentId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'auto';
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface PersonnelAction {
  id: string;
  actionType: (typeof ACTION_TYPES)[number];
  employeeId: string | null;
  employeeName: string | null;
  candidate: Record<string, unknown> | null;
  fromDepartmentId: string | null;
  fromPositionId: string | null;
  toDepartmentId: string | null;
  toPositionId: string | null;
  effectiveDate: string;
  reason: string | null;
  leaveReason: string | null;
  status: (typeof ACTION_STATUSES)[number];
  applicantUserId: string;
  applicantName: string | null;
  approvals: ApprovalStep[];
  currentApproverUserId: string | null;
  currentLevel: number | null;
  effectiveAt: string | null;
  createdAt: string;
  can: { approve: boolean; cancel: boolean };
}

export interface Contract {
  id: string;
  employeeId: string;
  employeeName: string;
  contractNo: string;
  type: string;
  startDate: string;
  endDate: string | null;
  signedAt: string | null;
  status: string;
  previousContractId: string | null;
  fileId: string | null;
  /** The content path of the archived scan, relative to the application. */
  filePath: string | null;
  note: string | null;
  remainingDays: number | null;
}

export interface ProfileChangeRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  changes: Record<string, unknown>;
  current: Record<string, unknown>;
  status: string;
  reviewerUserId: string | null;
  reviewedAt: string | null;
  comment: string | null;
  createdAt: string;
}

export interface EmployeeProfile {
  educations: Record<string, unknown>[];
  experiences: Record<string, unknown>[];
  emergencyContacts: Record<string, unknown>[];
  attachments: Record<string, unknown>[];
  can: { manage: boolean; viewContacts: boolean };
}

export interface HrReport {
  headcount: number;
  probation: number;
  joined: number;
  left: number;
  turnoverRate: number;
  monthly: { month: string; joined: number; left: number }[];
  byDepartment: { departmentId: string; title: string; count: number }[];
  tenure: { bucket: string; count: number }[];
  employmentTypes: { type: string; count: number }[];
  probationEnding: {
    employeeId: string;
    name: string;
    probationEndDate: string;
    departmentTitle: string;
  }[];
  contractsEnding: {
    contractId: string;
    employeeId: string;
    name: string;
    endDate: string;
    contractNo: string;
  }[];
}

export interface OrgChartNode {
  id: string;
  title: string;
  parentId: string | null;
  managerName: string | null;
  headcount: number;
  children: OrgChartNode[];
}

export interface DailyRunReport {
  effectiveActions: number;
  probationReminders: number;
  contractReminders: number;
  expiredContracts: number;
}

export interface HrCoreService {
  listActions(
    ctx: ActorContext,
    view: 'inbox' | 'mine' | 'all',
  ): Promise<{ items: PersonnelAction[]; can: { create: boolean } }>;
  getAction(
    ctx: ActorContext,
    id: string,
  ): Promise<PersonnelAction | undefined>;
  createAction(ctx: ActorContext, input: unknown): Promise<PersonnelAction>;
  decideAction(
    ctx: ActorContext,
    id: string,
    decision: 'approve' | 'reject',
    comment: string | null,
  ): Promise<PersonnelAction>;
  cancelAction(ctx: ActorContext, id: string): Promise<PersonnelAction>;
  listContracts(
    ctx: ActorContext,
    filters: { employeeId?: string; quick?: 'expiring' | 'overdue' | '' },
  ): Promise<{ items: Contract[]; can: { manage: boolean } }>;
  saveContract(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<Contract>;
  renewContract(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<Contract>;
  terminateContract(ctx: ActorContext, id: string): Promise<Contract>;
  attachContractFile(
    ctx: ActorContext,
    id: string,
    fileId: string | null,
  ): Promise<Contract>;
  getProfile(ctx: ActorContext, employeeId: string): Promise<EmployeeProfile>;
  saveProfileItem(
    ctx: ActorContext,
    employeeId: string,
    kind: 'educations' | 'experiences' | 'emergencyContacts' | 'attachments',
    id: string | null,
    input: unknown,
  ): Promise<Record<string, unknown>>;
  deleteProfileItem(
    ctx: ActorContext,
    employeeId: string,
    kind: 'educations' | 'experiences' | 'emergencyContacts' | 'attachments',
    id: string,
  ): Promise<void>;
  /** Whether the caller may read the attachment's file content. */
  canReadAttachmentFile(ctx: ActorContext, fileId: string): Promise<boolean>;
  requestProfileChange(
    ctx: ActorContext,
    changes: unknown,
  ): Promise<ProfileChangeRequest>;
  listProfileChanges(
    ctx: ActorContext,
    status: string | undefined,
  ): Promise<ProfileChangeRequest[]>;
  reviewProfileChange(
    ctx: ActorContext,
    id: string,
    decision: 'approve' | 'reject',
    comment: string | null,
  ): Promise<ProfileChangeRequest>;
  myProfileChange(ctx: ActorContext): Promise<ProfileChangeRequest | undefined>;
  report(
    ctx: ActorContext,
    filters: { departmentId?: string; from?: string; to?: string },
    locale: string,
  ): Promise<HrReport>;
  orgChart(
    ctx: ActorContext,
    locale: string,
  ): Promise<{ tree: OrgChartNode[]; canOpenEmployees: boolean }>;
  orgChartMembers(
    ctx: ActorContext,
    departmentId: string,
  ): Promise<{ id: string; name: string; positionTitle: string | null }[]>;
  myEvents(
    ctx: ActorContext,
    employeeId: string,
    locale: string,
  ): Promise<Record<string, unknown>[]>;
  /** The daily maintenance: due actions, reminders and contract expiry. Idempotent per day. */
  runDaily(options?: { asOf?: string }): Promise<DailyRunReport>;
}

export interface HrCoreServiceDeps {
  settings: PersonnelSettingsService;
  database: DatabaseManager;
  authz: AppAuthorization;
  organization: OrganizationService;
  talent: TalentService;
  users: UserAdministrationService;
  /** Sends an in-app notification; `message` names a `notifications.<message>` entry in the server locales. */
  notify: (input: {
    key: string;
    userIds: readonly string[];
    message: string;
    params: Record<string, string>;
    path?: string;
  }) => Promise<void>;
  createAccount: (
    input: { name: string; email: string; username?: string; password: string },
    connection: DatabaseConnection,
  ) => Promise<{ id: string }>;
  timeZone: string;
}

const ACTION_FIELDS = [
  'id',
  'actionType',
  'employeeId',
  'candidate',
  'toDepartmentId',
  'toPositionId',
  'effectiveDate',
  'reason',
  'leaveReason',
  'status',
  'applicantUserId',
  'approvals',
  'effectiveAt',
  'createdAt',
  'updatedAt',
] as const;
const EMPLOYEE_FIELDS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'managerEmployeeId',
  'status',
  'hireDate',
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
  'mobile',
  'idNumber',
  'birthDate',
  'address',
  'note',
] as const;

/**
 * Reads a JSON column. Rows written through the query builder hold a JSON
 * string inside the JSON value, rows written through a Repository hold the
 * value itself; both decode to the same shape here.
 */
export function parseJson<T>(value: unknown, fallback: T): T {
  let current: unknown = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      return fallback;
    }
  }
  return current == null || typeof current === 'string'
    ? fallback
    : (current as T);
}

export function createHrCoreService(deps: HrCoreServiceDeps): HrCoreService {
  const {
    database,
    authz,
    organization,
    talent,
    users,
    notify,
    createAccount,
    timeZone,
  } = deps;
  const ACTION = 'talent.personnelAction';
  const CONTRACT = 'talent.contract';
  const PROFILE = 'talent.profile';
  const CHANGE = 'talent.profileChange';

  const now = () => new Date();
  const currentDate = () => today(timeZone);

  async function can(
    ctx: ActorContext,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return (
      (await tryAuthorizeAction(ctx.authz, resource, action)) !== undefined
    );
  }
  async function isHrAdmin(ctx: ActorContext): Promise<boolean> {
    return ctx.authz.can({
      resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
      action: 'administer',
    });
  }
  async function userName(
    userId: string | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const user = await users.get(userId).catch(() => undefined);
    return user ? user.name : null;
  }

  /** Every user who holds the HR administration settings item, directly or through an organisation subject. */
  async function hrAdministrators(): Promise<string[]> {
    const sets = await authz.permissionSets.list();
    const result = new Set<string>();
    for (const set of sets) {
      const grantsIt = set.grants.some(
        (grant) =>
          grant.resource.type === 'settings' &&
          grant.resource.id === HR_ADMIN_SETTINGS &&
          grant.actions.some((a) => a.action === 'administer'),
      );
      if (!grantsIt) continue;
      for (const assignment of await authz.permissionSets.listAssignments(
        set.key,
      )) {
        const { type, id } = assignment.subject;
        if (type === 'user') result.add(id);
        else if (type === 'org.position') {
          // hr.admin is assigned to the "HR 专员" position: everyone currently on it.
          for (const row of await database
            .query()
            .selectFrom('employees')
            .select(['userId'])
            .where('positionId', '=', id)
            .where('status', '!=', 'leave')
            .execute())
            if (row.userId) result.add(str(row.userId));
        } else if (type === 'org.department') {
          for (const departmentId of await organization.descendantsOf(id)) {
            for (const member of await organization.directMembers(departmentId))
              result.add(member.userId);
          }
        }
      }
    }
    return [...result];
  }

  async function loadEmployee(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<EmployeeRecord | undefined> {
    const row = await (connection ? connection.query : database.query())
      .selectFrom('employees')
      .select([...EMPLOYEE_FIELDS])
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? toEmployee(row) : undefined;
  }

  async function toAction(
    ctx: ActorContext | undefined,
    row: Record<string, unknown>,
  ): Promise<PersonnelAction> {
    const approvals = parseJson<ApprovalStep[]>(row.approvals, []);
    const current = approvals.find((step) => step.status === 'pending');
    const employeeId = row.employeeId == null ? null : str(row.employeeId);
    const employee = employeeId ? await loadEmployee(employeeId) : undefined;
    const candidate = parseJson<Record<string, unknown> | null>(
      row.candidate,
      null,
    );
    const status = String(row.status) as PersonnelAction['status'];
    const applicantUserId = String(row.applicantUserId);
    let approve = false;
    let cancel = false;
    if (ctx && current && status === 'pending') {
      const eligible =
        current.kind === 'hrAdmin'
          ? await isHrAdmin(ctx)
          : current.approverUserId === ctx.userId;
      approve =
        eligible &&
        (await can(ctx, ACTION, 'approve')) &&
        !(employee?.userId && employee.userId === ctx.userId);
    }
    if (ctx && (status === 'pending' || status === 'approved'))
      cancel =
        applicantUserId === ctx.userId && (await can(ctx, ACTION, 'cancel'));
    return {
      id: String(row.id),
      actionType: String(row.actionType) as PersonnelAction['actionType'],
      employeeId,
      employeeName: employee
        ? employee.name
        : candidate && typeof candidate.name === 'string'
          ? candidate.name
          : null,
      candidate,
      fromDepartmentId: employee?.departmentId ?? null,
      fromPositionId: employee?.positionId ?? null,
      toDepartmentId:
        row.toDepartmentId == null ? null : str(row.toDepartmentId),
      toPositionId: row.toPositionId == null ? null : str(row.toPositionId),
      effectiveDate: toDateOnly(row.effectiveDate as string) ?? '',
      reason: row.reason == null ? null : str(row.reason),
      leaveReason: row.leaveReason == null ? null : str(row.leaveReason),
      status,
      applicantUserId,
      applicantName: await userName(applicantUserId),
      approvals,
      currentApproverUserId: current?.approverUserId ?? null,
      currentLevel: current?.level ?? null,
      effectiveAt:
        row.effectiveAt == null
          ? null
          : new Date(str(row.effectiveAt)).toISOString(),
      createdAt: new Date(String(row.createdAt)).toISOString(),
      can: { approve, cancel },
    };
  }

  async function buildChain(input: {
    actionType: string;
    employee?: EmployeeRecord;
    toDepartmentId: string | null;
    applicantUserId: string;
  }): Promise<ApprovalStep[]> {
    const departmentId =
      input.actionType === 'onboard' || input.actionType === 'transfer'
        ? input.toDepartmentId
        : (input.employee?.departmentId ?? null);
    let head = departmentId
      ? await organization.resolveHead(departmentId)
      : undefined;
    // Nobody approves an action about themselves: escalate to the next head up.
    if (
      head &&
      input.employee?.userId &&
      head.userId === input.employee.userId
    ) {
      const parent = (await organization.getDepartment(head.departmentId))
        ?.parentId;
      head = parent ? await organization.resolveHead(parent) : undefined;
      if (head && head.userId === input.employee.userId) head = undefined;
    }
    const first: ApprovalStep = {
      level: 1,
      kind: 'departmentHead',
      approverUserId: head?.userId ?? null,
      departmentId: head?.departmentId ?? departmentId,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
    };
    if (!head || head.userId === input.applicantUserId) {
      // No head to ask, or the applicant is the head: this level passes by itself.
      first.status = 'auto';
      first.decidedAt = now().toISOString();
    }
    const second: ApprovalStep = {
      level: 2,
      kind: 'hrAdmin',
      approverUserId: null,
      departmentId: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
    };
    return [first, second];
  }

  async function notifyApprovers(
    action: PersonnelAction,
    level: ApprovalStep,
  ): Promise<void> {
    const recipients =
      level.kind === 'hrAdmin'
        ? await hrAdministrators()
        : level.approverUserId
          ? [level.approverUserId]
          : [];
    if (!recipients.length) return;
    await notify({
      key: `action:${action.id}:level:${level.level}`,
      userIds: recipients,
      message: 'actionPending',
      params: { type: action.actionType, name: action.employeeName ?? '' },
      path: `/talent/actions/${action.id}`,
    });
  }

  async function takeEffect(
    connection: DatabaseConnection,
    row: Record<string, unknown>,
  ): Promise<{ affected: string[]; recipients: string[]; employeeId: string }> {
    const actionId = String(row.id);
    const type = String(row.actionType);
    const effectiveDate =
      toDateOnly(row.effectiveDate as string) ?? currentDate();
    const stamp = now();
    const affected: string[] = [];
    let employee: EmployeeRecord | undefined = row.employeeId
      ? await loadEmployee(str(row.employeeId), connection)
      : undefined;
    if (type === 'onboard') {
      const candidate = parseJson<Record<string, unknown>>(row.candidate, {});
      const probationMonths = Number(candidate.probationMonths ?? 0);
      const probationEndDate =
        probationMonths > 0 ? addMonths(effectiveDate, probationMonths) : null;
      let userId: string | null = null;
      if (
        candidate.createAccount === true &&
        typeof candidate.email === 'string' &&
        candidate.email
      ) {
        const password =
          typeof candidate.initialPassword === 'string' &&
          candidate.initialPassword
            ? candidate.initialPassword
            : `Welcome#${Math.random().toString(36).slice(2, 10)}`;
        const account = await createAccount(
          {
            name: String(candidate.name),
            email: String(candidate.email),
            password,
          },
          connection,
        );
        userId = account.id;
      }
      const id = newId();
      await connection.query
        .insertInto('employees')
        .values({
          id,
          employeeNo: String(candidate.employeeNo),
          name: String(candidate.name),
          userId,
          departmentId: String(row.toDepartmentId),
          positionId: row.toPositionId == null ? null : str(row.toPositionId),
          managerEmployeeId: null,
          status: probationEndDate ? 'probation' : 'active',
          hireDate: effectiveDate,
          positionSince: row.toPositionId ? effectiveDate : null,
          email: typeof candidate.email === 'string' ? candidate.email : null,
          mobile:
            typeof candidate.mobile === 'string' ? candidate.mobile : null,
          employmentType:
            typeof candidate.employmentType === 'string'
              ? candidate.employmentType
              : 'fullTime',
          probationEndDate,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      if (userId) {
        await organization.syncPrimaryMembership(
          userId,
          String(row.toDepartmentId),
          connection,
        );
        affected.push(userId);
      }
      await connection.query
        .updateTable('personnelActions')
        .set({ employeeId: id })
        .where('id', '=', actionId)
        .execute();
      employee = (await loadEmployee(id, connection))!;
      await connection.query
        .insertInto('jobEvents')
        .values({
          id: newId(),
          employeeId: id,
          eventType: 'onboard',
          fromDepartmentId: null,
          toDepartmentId: employee.departmentId,
          fromPositionId: null,
          toPositionId: employee.positionId,
          effectiveDate,
          actionId,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
    } else {
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const from = {
        departmentId: employee.departmentId,
        positionId: employee.positionId,
      };
      if (type === 'regularize') {
        await connection.query
          .updateTable('employees')
          .set({
            status: 'active',
            regularizedAt: effectiveDate,
            updatedAt: stamp,
          })
          .where('id', '=', employee.id)
          .execute();
        affected.push(
          ...(await talent.applyCoreChange(connection, employee, {
            status: 'active',
          })),
        );
      } else if (type === 'transfer' || type === 'promote') {
        affected.push(
          ...(await talent.applyCoreChange(
            connection,
            employee,
            {
              departmentId:
                row.toDepartmentId == null
                  ? employee.departmentId
                  : str(row.toDepartmentId),
              positionId:
                row.toPositionId == null
                  ? employee.positionId
                  : str(row.toPositionId),
            },
            { positionSince: effectiveDate },
          )),
        );
      } else if (type === 'offboard') {
        await connection.query
          .updateTable('employees')
          .set({
            leaveDate: effectiveDate,
            leaveReason: row.leaveReason == null ? null : str(row.leaveReason),
            updatedAt: stamp,
          })
          .where('id', '=', employee.id)
          .execute();
        await connection.query
          .updateTable('employmentContracts')
          .set({ status: 'terminated', updatedAt: stamp })
          .where('employeeId', '=', employee.id)
          .where('status', '=', 'active')
          .execute();
        affected.push(
          ...(await talent.applyCoreChange(connection, employee, {
            status: 'leave',
          })),
        );
      }
      const after = (await loadEmployee(employee.id, connection))!;
      await connection.query
        .insertInto('jobEvents')
        .values({
          id: newId(),
          employeeId: employee.id,
          eventType: type,
          fromDepartmentId: from.departmentId,
          toDepartmentId: after.departmentId,
          fromPositionId: from.positionId,
          toPositionId: after.positionId,
          effectiveDate,
          actionId,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      employee = after;
    }
    await connection.query
      .updateTable('personnelActions')
      .set({ status: 'effective', effectiveAt: stamp, updatedAt: stamp })
      .where('id', '=', actionId)
      .execute();
    const recipients = new Set<string>([String(row.applicantUserId)]);
    if (employee?.userId) recipients.add(employee.userId);
    const head = employee
      ? await organization.resolveHead(employee.departmentId, connection)
      : undefined;
    if (head) recipients.add(head.userId);
    return { affected, recipients: [...recipients], employeeId: employee.id };
  }

  async function reloadAction(
    ctx: ActorContext | undefined,
    id: string,
  ): Promise<PersonnelAction> {
    const row = await database
      .query()
      .selectFrom('personnelActions')
      .select([...ACTION_FIELDS])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('ACTION_NOT_FOUND', 404);
    return toAction(ctx, row);
  }

  async function toContract(
    row: Record<string, unknown>,
    nameOf: (id: string) => Promise<string>,
  ): Promise<Contract> {
    const endDate = toDateOnly(row.endDate as string | null);
    const fileId = row.fileId == null ? null : str(row.fileId);
    const file = fileId
      ? await database
          .query()
          .selectFrom('hrFiles')
          .select(['id', 'ext'])
          .where('id', '=', fileId)
          .executeTakeFirst()
      : undefined;
    return {
      filePath: file
        ? `/uploads/hr-files/${String(file.id)}${file.ext ? `.${str(file.ext).replace(/^\./u, '')}` : ''}`
        : null,
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: await nameOf(String(row.employeeId)),
      contractNo: String(row.contractNo),
      type: String(row.type),
      startDate: toDateOnly(row.startDate as string) ?? '',
      endDate,
      signedAt: toDateOnly(row.signedAt as string | null),
      status: String(row.status),
      previousContractId:
        row.previousContractId == null ? null : str(row.previousContractId),
      fileId: row.fileId == null ? null : str(row.fileId),
      note: row.note == null ? null : str(row.note),
      remainingDays: endDate ? daysBetween(currentDate(), endDate) : null,
    };
  }

  function employeeNames(): (id: string) => Promise<string> {
    const cache = new Map<string, string>();
    return async (id) => {
      if (!cache.has(id)) {
        const row = await database
          .query()
          .selectFrom('employees')
          .select(['name'])
          .where('id', '=', id)
          .executeTakeFirst();
        cache.set(id, row ? String(row.name) : id);
      }
      return cache.get(id)!;
    };
  }

  function parseContractInput(
    input: unknown,
    partial: boolean,
  ): Record<string, unknown> {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const values: Record<string, unknown> = {};
    if (!partial || input.employeeId !== undefined)
      values.employeeId = requireString(
        input.employeeId,
        'CONTRACT_EMPLOYEE_REQUIRED',
        { max: 64 },
      );
    if (!partial || input.contractNo !== undefined)
      values.contractNo = requireString(
        input.contractNo,
        'CONTRACT_NO_REQUIRED',
        { max: 64 },
      );
    if (!partial || input.type !== undefined)
      values.type = requireEnum(
        input.type,
        CONTRACT_TYPES,
        'CONTRACT_TYPE_INVALID',
      );
    if (!partial || input.startDate !== undefined) {
      const start = optionalDate(input.startDate, 'CONTRACT_DATE_INVALID');
      if (!start) throw new HrError('CONTRACT_START_REQUIRED', 400);
      values.startDate = start;
    }
    if (input.endDate !== undefined)
      values.endDate = optionalDate(input.endDate, 'CONTRACT_DATE_INVALID');
    if (input.signedAt !== undefined)
      values.signedAt = optionalDate(input.signedAt, 'CONTRACT_DATE_INVALID');
    if (input.note !== undefined)
      values.note = requireString(input.note, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
    if (values.type === 'openEnded') values.endDate = null;
    if (
      typeof values.startDate === 'string' &&
      typeof values.endDate === 'string' &&
      values.endDate < values.startDate
    )
      throw new HrError('CONTRACT_DATE_INVALID', 400);
    return values;
  }

  async function assertSingleActive(
    connection: DatabaseConnection,
    employeeId: string,
    exceptId: string | null,
  ): Promise<void> {
    const rows = await connection.query
      .selectFrom('employmentContracts')
      .select(['id'])
      .where('employeeId', '=', employeeId)
      .where('status', '=', 'active')
      .execute();
    if (rows.some((row) => String(row.id) !== exceptId))
      throw new HrError('CONTRACT_ACTIVE_EXISTS', 409);
  }

  async function assertContractNoFree(
    connection: DatabaseConnection,
    contractNo: string,
    exceptId: string | null,
  ): Promise<void> {
    const existing = await connection.query
      .selectFrom('employmentContracts')
      .select(['id'])
      .where('contractNo', '=', contractNo)
      .executeTakeFirst();
    if (existing && String(existing.id) !== exceptId)
      throw new HrError('CONTRACT_NO_TAKEN', 409);
  }

  const PROFILE_COLLECTIONS = {
    educations: 'employeeEducations',
    experiences: 'employeeExperiences',
    emergencyContacts: 'employeeEmergencyContacts',
    attachments: 'employeeAttachments',
  } as const;

  function parseProfileItem(
    kind: keyof typeof PROFILE_COLLECTIONS,
    input: unknown,
  ): Record<string, unknown> {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    switch (kind) {
      case 'educations':
        return {
          school: requireString(input.school, 'PROFILE_SCHOOL_REQUIRED', {
            max: 200,
          }),
          degree: requireEnum(input.degree, DEGREES, 'PROFILE_DEGREE_INVALID'),
          major: requireString(input.major, 'INVALID_INPUT', {
            optional: true,
            max: 200,
          }),
          startDate: optionalDate(input.startDate, 'PROFILE_DATE_INVALID'),
          endDate: optionalDate(input.endDate, 'PROFILE_DATE_INVALID'),
        };
      case 'experiences':
        return {
          company: requireString(input.company, 'PROFILE_COMPANY_REQUIRED', {
            max: 200,
          }),
          title: requireString(input.title, 'INVALID_INPUT', {
            optional: true,
            max: 200,
          }),
          startDate: optionalDate(input.startDate, 'PROFILE_DATE_INVALID'),
          endDate: optionalDate(input.endDate, 'PROFILE_DATE_INVALID'),
          description: requireString(input.description, 'INVALID_INPUT', {
            optional: true,
            max: 4000,
          }),
        };
      case 'emergencyContacts':
        return {
          name: requireString(input.name, 'PROFILE_CONTACT_NAME_REQUIRED', {
            max: 200,
          }),
          relation: requireString(input.relation, 'INVALID_INPUT', {
            optional: true,
            max: 64,
          }),
          phone: requireString(input.phone, 'PROFILE_CONTACT_PHONE_REQUIRED', {
            max: 32,
          }),
        };
      case 'attachments':
        return {
          fileId: requireString(input.fileId, 'PROFILE_FILE_REQUIRED', {
            max: 64,
          }),
          category:
            optionalEnum(
              input.category,
              ATTACHMENT_CATEGORIES,
              'INVALID_INPUT',
            ) ?? 'other',
          title: requireString(input.title, 'INVALID_INPUT', {
            optional: true,
            max: 200,
          }),
        };
      default:
        throw new HrError('INVALID_INPUT', 400);
    }
  }

  function serialize(row: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date)
        out[key] = key.endsWith('At') ? value.toISOString() : toDateOnly(value);
      else out[key] = value;
    }
    for (const key of ['startDate', 'endDate'])
      if (typeof out[key] === 'string') out[key] = toDateOnly(out[key]);
    return out;
  }

  async function applyProfileChanges(
    connection: DatabaseConnection,
    employeeId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    const stamp = now();
    const scalar: Record<string, unknown> = {};
    for (const key of ['mobile', 'email', 'address'] as const)
      if (key in changes)
        scalar[key] = changes[key] == null ? null : str(changes[key]);
    if (Object.keys(scalar).length)
      await connection.query
        .updateTable('employees')
        .set({ ...scalar, updatedAt: stamp })
        .where('id', '=', employeeId)
        .execute();
    for (const kind of [
      'educations',
      'experiences',
      'emergencyContacts',
    ] as const) {
      if (!(kind in changes) || !Array.isArray(changes[kind])) continue;
      const collection = PROFILE_COLLECTIONS[kind];
      await connection.query
        .deleteFrom(collection)
        .where('employeeId', '=', employeeId)
        .execute();
      for (const item of changes[kind] as unknown[]) {
        const values = parseProfileItem(kind, item);
        await connection.query
          .insertInto(collection)
          .values({
            id: newId(),
            employeeId,
            ...values,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      }
    }
  }

  async function toChangeRequest(
    row: Record<string, unknown>,
  ): Promise<ProfileChangeRequest> {
    const employee = await loadEmployee(String(row.employeeId));
    const changes = parseJson<Record<string, unknown>>(row.changes, {});
    const current: Record<string, unknown> = {};
    if (employee) {
      for (const key of ['mobile', 'email', 'address'] as const)
        if (key in changes) current[key] = employee[key] ?? null;
      for (const kind of [
        'educations',
        'experiences',
        'emergencyContacts',
      ] as const) {
        if (!(kind in changes)) continue;
        const rows = await database
          .query()
          .selectFrom(PROFILE_COLLECTIONS[kind])
          .selectAll()
          .where('employeeId', '=', employee.id)
          .execute();
        current[kind] = rows.map((r) =>
          serialize(r as Record<string, unknown>),
        );
      }
    }
    return {
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: employee?.name ?? '',
      changes,
      current,
      status: String(row.status),
      reviewerUserId:
        row.reviewerUserId == null ? null : str(row.reviewerUserId),
      reviewedAt:
        row.reviewedAt == null
          ? null
          : new Date(str(row.reviewedAt)).toISOString(),
      comment: row.comment == null ? null : str(row.comment),
      createdAt: new Date(String(row.createdAt)).toISOString(),
    };
  }

  async function reminderOnce(
    key: string,
    send: () => Promise<void>,
  ): Promise<boolean> {
    const existing = await database
      .query()
      .selectFrom('hrReminderLog')
      .select(['id'])
      .where('reminderKey', '=', key)
      .executeTakeFirst();
    if (existing) return false;
    await send();
    const stamp = now();
    await database
      .query()
      .insertInto('hrReminderLog')
      .values({
        id: newId(),
        reminderKey: key,
        sentAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    return true;
  }

  const service: HrCoreService = {
    async listActions(ctx, view) {
      const policies = await authorizeAction(ctx.authz, ACTION, 'view');
      const rows = await database
        .repository('personnelActions')
        .withPolicy(policyOf(policies, 'personnelActions'))
        .findMany({ sort: (s) => [s.field('createdAt').desc()] });
      const hrAdmin = await isHrAdmin(ctx);
      const items: PersonnelAction[] = [];
      for (const raw of rows) {
        const action = await toAction(ctx, raw);
        if (view === 'mine' && action.applicantUserId !== ctx.userId) continue;
        if (view === 'inbox') {
          const current = action.approvals.find((s) => s.status === 'pending');
          const eligible =
            action.status === 'pending' &&
            current &&
            (current.kind === 'hrAdmin'
              ? hrAdmin
              : current.approverUserId === ctx.userId);
          if (!eligible) continue;
        }
        items.push(action);
      }
      return { items, can: { create: await can(ctx, ACTION, 'create') } };
    },

    async getAction(ctx, id) {
      const policies = await authorizeAction(ctx.authz, ACTION, 'view');
      const row = await database
        .repository('personnelActions')
        .withPolicy(policyOf(policies, 'personnelActions'))
        .findOne({ filter: { id } });
      return row ? toAction(ctx, row) : undefined;
    },

    async createAction(ctx, input) {
      const policies = await authorizeAction(ctx.authz, ACTION, 'create');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const actionType = requireEnum(
        input.actionType,
        ACTION_TYPES,
        'ACTION_TYPE_INVALID',
      );
      const effectiveDate = optionalDate(
        input.effectiveDate,
        'ACTION_DATE_INVALID',
      );
      if (!effectiveDate) throw new HrError('ACTION_DATE_REQUIRED', 400);
      const reason = requireString(input.reason, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
      const hrAdmin = await isHrAdmin(ctx);
      const managed = hrAdmin
        ? []
        : await organization.managedDepartments(ctx.userId);
      const canRaiseFor = (departmentId: string | null | undefined) =>
        hrAdmin || (departmentId ? managed.includes(departmentId) : false);
      let employee: EmployeeRecord | undefined;
      let candidate: Record<string, unknown> | null = null;
      let toDepartmentId: string | null = null;
      let toPositionId: string | null = null;
      let leaveReason: string | null = null;
      if (actionType === 'onboard') {
        toDepartmentId = requireString(
          input.toDepartmentId,
          'ACTION_DEPARTMENT_REQUIRED',
          { max: 64 },
        );
        toPositionId = requireString(
          input.toPositionId,
          'ACTION_POSITION_REQUIRED',
          { max: 64 },
        );
        const probationMonths = Number(input.probationMonths ?? 0);
        if (
          !Number.isInteger(probationMonths) ||
          probationMonths < 0 ||
          probationMonths >
            (await deps.settings.read('probation')).value.maxMonths
        )
          throw new HrError('ACTION_PROBATION_INVALID', 400);
        const employeeNo = requireString(
          input.employeeNo,
          'EMPLOYEE_NO_REQUIRED',
          { max: 64 },
        )!;
        const existing = await database
          .query()
          .selectFrom('employees')
          .select(['id'])
          .where('employeeNo', '=', employeeNo)
          .executeTakeFirst();
        if (existing) throw new HrError('EMPLOYEE_NO_TAKEN', 409);
        candidate = {
          name: requireString(input.name, 'EMPLOYEE_NAME_REQUIRED', {
            max: 200,
          }),
          employeeNo,
          mobile: requireString(input.mobile, 'INVALID_INPUT', {
            optional: true,
            max: 32,
          }),
          email: requireString(input.email, 'INVALID_INPUT', {
            optional: true,
            max: 320,
          }),
          employmentType:
            optionalEnum(
              input.employmentType,
              EMPLOYMENT_TYPES,
              'INVALID_INPUT',
            ) ?? 'fullTime',
          probationMonths,
          createAccount: input.createAccount === true,
        };
        if (candidate.createAccount && !candidate.email)
          throw new HrError('ACTION_ACCOUNT_EMAIL_REQUIRED', 400);
        if (!canRaiseFor(toDepartmentId))
          throw new HrError('ACTION_NOT_ELIGIBLE', 403);
      } else {
        const employeeId = requireString(
          input.employeeId,
          'ACTION_EMPLOYEE_REQUIRED',
          { max: 64 },
        )!;
        employee = await loadEmployee(employeeId);
        if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        if (employee.status === 'leave')
          throw new HrError('EMPLOYEE_ALREADY_LEFT', 409);
        if (!canRaiseFor(employee.departmentId))
          throw new HrError('ACTION_NOT_ELIGIBLE', 403);
        const open = await database
          .query()
          .selectFrom('personnelActions')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('status', 'in', ['pending', 'approved'])
          .executeTakeFirst();
        if (open) throw new HrError('ACTION_ALREADY_OPEN', 409);
        if (actionType === 'regularize') {
          if (employee.status !== 'probation')
            throw new HrError('ACTION_NOT_ON_PROBATION', 409);
        } else if (actionType === 'transfer' || actionType === 'promote') {
          toDepartmentId =
            requireString(input.toDepartmentId, 'ACTION_DEPARTMENT_REQUIRED', {
              optional: actionType === 'promote',
              max: 64,
            }) ?? employee.departmentId;
          toPositionId = requireString(
            input.toPositionId,
            'ACTION_POSITION_REQUIRED',
            { max: 64 },
          );
          if (
            toDepartmentId === employee.departmentId &&
            toPositionId === employee.positionId
          )
            throw new HrError('ACTION_NO_CHANGE', 400);
        } else if (actionType === 'offboard') {
          leaveReason = requireEnum(
            input.leaveReason,
            LEAVE_REASONS,
            'ACTION_LEAVE_REASON_REQUIRED',
          );
        }
      }
      if (toDepartmentId && !(await organization.getDepartment(toDepartmentId)))
        throw new HrError('EMPLOYEE_DEPARTMENT_NOT_FOUND', 404);
      if (toPositionId) {
        const position = await database
          .query()
          .selectFrom('positions')
          .select(['id'])
          .where('id', '=', toPositionId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (!position) throw new HrError('EMPLOYEE_POSITION_NOT_FOUND', 404);
      }
      const approvals = await buildChain({
        actionType,
        employee,
        toDepartmentId,
        applicantUserId: ctx.userId,
      });
      const stamp = now();
      const id = newId();
      await database
        .repository('personnelActions')
        .withPolicy(policyOf(policies, 'personnelActions'))
        .createOne({
          values: {
            id,
            actionType,
            employeeId: employee?.id ?? null,
            candidate,
            toDepartmentId,
            toPositionId,
            effectiveDate,
            reason,
            leaveReason,
            status: 'pending',
            applicantUserId: ctx.userId,
            approvals,
            effectiveAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      const action = await reloadAction(ctx, id);
      const pending = action.approvals.find((s) => s.status === 'pending');
      if (pending) await notifyApprovers(action, pending);
      return action;
    },

    async decideAction(ctx, id, decision, comment) {
      const policies = await authorizeAction(ctx.authz, ACTION, 'approve');
      if (decision === 'reject' && !comment?.trim())
        throw new HrError('ACTION_REJECT_COMMENT_REQUIRED', 400);
      const hrAdmin = await isHrAdmin(ctx);
      const outcome = await database.transaction(async (connection) => {
        const repo = connection
          .repository('personnelActions')
          .withPolicy(policyOf(policies, 'personnelActions'));
        const row = (await repo.findOne({ filter: { id } })) as
          Record<string, unknown> | undefined;
        if (!row) throw new HrError('ACTION_NOT_FOUND', 404);
        if (row.status !== 'pending')
          throw new HrError('ACTION_NOT_PENDING', 409);
        const approvals = parseJson<ApprovalStep[]>(row.approvals, []);
        const step = approvals.find((s) => s.status === 'pending');
        if (!step) throw new HrError('ACTION_NOT_PENDING', 409);
        const eligible =
          step.kind === 'hrAdmin'
            ? hrAdmin
            : step.approverUserId === ctx.userId;
        if (!eligible) throw new HrError('ACTION_NOT_APPROVER', 403);
        const employee = row.employeeId
          ? await loadEmployee(str(row.employeeId), connection)
          : undefined;
        if (employee?.userId && employee.userId === ctx.userId)
          throw new HrError('ACTION_SELF_APPROVAL', 403);
        step.status = decision === 'approve' ? 'approved' : 'rejected';
        step.decidedBy = ctx.userId;
        step.decidedAt = now().toISOString();
        step.comment = comment?.trim() || null;
        let status: string = 'pending';
        if (decision === 'reject') status = 'rejected';
        else if (!approvals.some((s) => s.status === 'pending'))
          status = 'approved';
        await repo.updateOne({
          filter: { id, status: 'pending' },
          values: { approvals, status, updatedAt: now() },
        });
        await connection.repository('workItems').updateMany({
          filter: {
            refType: 'personnelAction',
            refId: id,
            sourceKind: 'approval',
            status: 'open',
          },
          values: { status: 'done', doneAt: now(), updatedAt: now() },
        });
        let effect: { affected: string[]; recipients: string[] } | undefined;
        if (
          status === 'approved' &&
          (toDateOnly(row.effectiveDate as string) ?? '') <= currentDate()
        ) {
          const fresh = (await connection.query
            .selectFrom('personnelActions')
            .select([...ACTION_FIELDS])
            .where('id', '=', id)
            .executeTakeFirst()) as Record<string, unknown>;
          effect = await takeEffect(connection, fresh);
        }
        return {
          status,
          effect,
          applicant: String(row.applicantUserId),
          next: approvals.find((s) => s.status === 'pending'),
        };
      });
      if (outcome.effect) await talent.notifyUsers(outcome.effect.affected);
      const action = await reloadAction(ctx, id);
      if (outcome.status === 'rejected') {
        await notify({
          key: `action:${id}:rejected`,
          userIds: [outcome.applicant],
          message: 'actionRejected',
          params: {
            type: action.actionType,
            name: action.employeeName ?? '',
            comment: comment ?? '',
          },
          path: `/talent/actions/${id}`,
        });
      } else if (outcome.effect) {
        await notify({
          key: `action:${id}:effective`,
          userIds: outcome.effect.recipients,
          message: 'actionEffective',
          params: { type: action.actionType, name: action.employeeName ?? '' },
          path: `/talent/actions/${id}`,
        });
      } else if (outcome.next) {
        await notifyApprovers(action, outcome.next);
      }
      return action;
    },

    async cancelAction(ctx, id) {
      const policies = await authorizeAction(ctx.authz, ACTION, 'cancel');
      const repo = database
        .repository('personnelActions')
        .withPolicy(policyOf(policies, 'personnelActions'));
      const row = (await repo.findOne({ filter: { id } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('ACTION_NOT_FOUND', 404);
      if (String(row.applicantUserId) !== ctx.userId)
        throw new HrError('ACTION_NOT_APPLICANT', 403);
      if (row.status !== 'pending' && row.status !== 'approved')
        throw new HrError('ACTION_NOT_CANCELLABLE', 409);
      await database.transaction(async (connection) => {
        await connection
          .repository('personnelActions')
          .withPolicy(policyOf(policies, 'personnelActions'))
          .updateOne({
            filter: { id, status: String(row.status) },
            values: { status: 'cancelled', updatedAt: now() },
          });
        await connection.repository('workItems').updateMany({
          filter: {
            refType: 'personnelAction',
            refId: id,
            sourceKind: 'approval',
            status: 'open',
          },
          values: { status: 'done', doneAt: now(), updatedAt: now() },
        });
      });
      const action = await reloadAction(ctx, id);
      const pending = action.approvals.find((s) => s.status === 'pending');
      const recipients = pending
        ? pending.kind === 'hrAdmin'
          ? await hrAdministrators()
          : pending.approverUserId
            ? [pending.approverUserId]
            : []
        : [];
      if (recipients.length)
        await notify({
          key: `action:${id}:cancelled`,
          userIds: recipients,
          message: 'actionCancelled',
          params: { type: action.actionType, name: action.employeeName ?? '' },
          path: `/talent/actions/${id}`,
        });
      return action;
    },

    async listContracts(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'view');
      const rows = await database
        .repository('employmentContracts')
        .withPolicy(policyOf(policies, 'employmentContracts'))
        .findMany({
          ...(filters.employeeId
            ? { filter: { employeeId: filters.employeeId } }
            : {}),
          sort: (s) => [s.field('startDate').desc()],
        });
      const nameOf = employeeNames();
      let items: Contract[] = [];
      for (const row of rows) items.push(await toContract(row, nameOf));
      if (filters.quick === 'expiring')
        items = items.filter(
          (c) =>
            c.status === 'active' &&
            c.remainingDays !== null &&
            c.remainingDays >= 0 &&
            c.remainingDays <= 60,
        );
      if (filters.quick === 'overdue')
        items = items.filter(
          (c) =>
            c.status === 'active' &&
            c.remainingDays !== null &&
            c.remainingDays < 0,
        );
      return { items, can: { manage: await can(ctx, CONTRACT, 'manage') } };
    },

    async saveContract(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'manage');
      const values = parseContractInput(input, Boolean(id));
      const result = await database.transaction(async (connection) => {
        const repo = connection
          .repository('employmentContracts')
          .withPolicy(policyOf(policies, 'employmentContracts'));
        const stamp = now();
        if (id) {
          const current = await connection.query
            .selectFrom('employmentContracts')
            .select(['id', 'employeeId', 'status'])
            .where('id', '=', id)
            .executeTakeFirst();
          if (!current) throw new HrError('CONTRACT_NOT_FOUND', 404);
          if (typeof values.contractNo === 'string')
            await assertContractNoFree(connection, values.contractNo, id);
          delete values.employeeId;
          const { record } = await repo.updateOne({
            filter: { id },
            values: { ...values, updatedAt: stamp },
          });
          return record;
        }
        const employeeId = String(values.employeeId);
        if (!(await loadEmployee(employeeId, connection)))
          throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        await assertContractNoFree(connection, String(values.contractNo), null);
        await assertSingleActive(connection, employeeId, null);
        const { record } = await repo.createOne({
          values: {
            id: newId(),
            status: 'active',
            previousContractId: null,
            fileId: null,
            ...values,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
        return record;
      });
      return toContract(result, employeeNames());
    },

    async renewContract(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'manage');
      const values = parseContractInput(
        { ...(isRecord(input) ? input : {}), employeeId: 'x' },
        false,
      );
      const result = await database.transaction(async (connection) => {
        const repo = connection
          .repository('employmentContracts')
          .withPolicy(policyOf(policies, 'employmentContracts'));
        const previous = await connection.query
          .selectFrom('employmentContracts')
          .select(['id', 'employeeId', 'status'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!previous) throw new HrError('CONTRACT_NOT_FOUND', 404);
        if (previous.status !== 'active' && previous.status !== 'expired')
          throw new HrError('CONTRACT_NOT_RENEWABLE', 409);
        const employeeId = String(previous.employeeId);
        await assertContractNoFree(connection, String(values.contractNo), null);
        const stamp = now();
        // The old contract is marked renewed first, so the single-active rule holds when the new one is written.
        await repo.updateOne({
          filter: { id },
          values: { status: 'renewed', updatedAt: stamp },
        });
        await assertSingleActive(connection, employeeId, null);
        const { record } = await repo.createOne({
          values: {
            ...values,
            id: newId(),
            employeeId,
            status: 'active',
            previousContractId: id,
            fileId: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
        return record;
      });
      return toContract(result, employeeNames());
    },

    async terminateContract(ctx, id) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'manage');
      const repo = database
        .repository('employmentContracts')
        .withPolicy(policyOf(policies, 'employmentContracts'));
      const { record } = await repo.updateOne({
        filter: { id },
        values: { status: 'terminated', updatedAt: now() },
      });
      return toContract(record, employeeNames());
    },

    async attachContractFile(ctx, id, fileId) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'manage');
      const repo = database
        .repository('employmentContracts')
        .withPolicy(policyOf(policies, 'employmentContracts'));
      const { record } = await repo.updateOne({
        filter: { id },
        values: { fileId, updatedAt: now() },
      });
      return toContract(record, employeeNames());
    },

    async getProfile(ctx, employeeId) {
      const view = await tryAuthorizeAction(ctx.authz, PROFILE, 'view');
      const contacts = await tryAuthorizeAction(
        ctx.authz,
        PROFILE,
        'viewContacts',
      );
      if (!view && !contacts) throw new HrError('FORBIDDEN', 403);
      const read = async (policies: typeof view, collection: string) =>
        policies
          ? (
              await database
                .repository(collection)
                .withPolicy(policyOf(policies, collection))
                .findMany({
                  filter: { employeeId },
                  sort: (s) => [s.field('createdAt').asc()],
                })
            ).map((r) => serialize(r as Record<string, unknown>))
          : [];
      const attachments = await read(contacts, 'employeeAttachments');
      const fileIds = attachments.map((a) => String(a.fileId));
      const files = fileIds.length
        ? await database
            .query()
            .selectFrom('hrFiles')
            .select([
              'id',
              'filename',
              'ext',
              'mimeType',
              'size',
              'createdAt',
              'updatedAt',
            ])
            .where('id', 'in', fileIds)
            .execute()
        : [];
      const fileById = new Map(files.map((f) => [String(f.id), f]));
      return {
        educations: await read(view, 'employeeEducations'),
        experiences: await read(view, 'employeeExperiences'),
        emergencyContacts: await read(contacts, 'employeeEmergencyContacts'),
        attachments: attachments.map((a) => ({
          ...a,
          file: fileById.get(String(a.fileId))
            ? serialize(
                fileById.get(String(a.fileId)) as Record<string, unknown>,
              )
            : null,
        })),
        can: {
          manage: await can(ctx, PROFILE, 'manage'),
          viewContacts: Boolean(contacts),
        },
      };
    },

    async saveProfileItem(ctx, employeeId, kind, id, input) {
      const policies = await authorizeAction(ctx.authz, PROFILE, 'manage');
      const collection = PROFILE_COLLECTIONS[kind];
      if (!collection) throw new HrError('INVALID_INPUT', 400);
      const values = parseProfileItem(kind, input);
      if (!(await loadEmployee(employeeId)))
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      if (kind === 'attachments') {
        const file = await database
          .query()
          .selectFrom('hrFiles')
          .select(['id'])
          .where('id', '=', String(values.fileId))
          .executeTakeFirst();
        if (!file) throw new HrError('PROFILE_FILE_NOT_FOUND', 404);
      }
      const repo = database
        .repository(collection)
        .withPolicy(policyOf(policies, collection));
      const stamp = now();
      if (id) {
        const { record } = await repo.updateOne({
          filter: { id, employeeId },
          values: { ...values, updatedAt: stamp },
        });
        return serialize(record);
      }
      const { record } = await repo.createOne({
        values: {
          id: newId(),
          employeeId,
          ...values,
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
      return serialize(record);
    },

    async deleteProfileItem(ctx, employeeId, kind, id) {
      const policies = await authorizeAction(ctx.authz, PROFILE, 'manage');
      const collection = PROFILE_COLLECTIONS[kind];
      if (!collection) throw new HrError('INVALID_INPUT', 400);
      await database
        .repository(collection)
        .withPolicy(policyOf(policies, collection))
        .deleteOne({ filter: { id, employeeId } });
    },

    async canReadAttachmentFile(ctx, fileId) {
      const contacts = await tryAuthorizeAction(
        ctx.authz,
        PROFILE,
        'viewContacts',
      );
      if (contacts) {
        const rows = await database
          .repository('employeeAttachments')
          .withPolicy(policyOf(contacts, 'employeeAttachments'))
          .findMany({ filter: { fileId } });
        if (rows.length) return true;
      }
      const contracts = await tryAuthorizeAction(ctx.authz, CONTRACT, 'view');
      if (contracts) {
        const rows = await database
          .repository('employmentContracts')
          .withPolicy(policyOf(contracts, 'employmentContracts'))
          .findMany({ filter: { fileId } });
        if (rows.length) return true;
      }
      return false;
    },

    async requestProfileChange(ctx, changes) {
      const policies = await authorizeAction(ctx.authz, CHANGE, 'request');
      if (!isRecord(changes) || !Object.keys(changes).length)
        throw new HrError('INVALID_INPUT', 400);
      for (const key of Object.keys(changes))
        if (!(PROFILE_CHANGE_FIELDS as readonly string[]).includes(key))
          throw new HrError('PROFILE_CHANGE_FIELD_NOT_ALLOWED', 400, {
            field: key,
          });
      const employee = await talent.employeeOfUser(ctx.userId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      // Validate list items now so the reviewer never sees malformed data.
      for (const kind of [
        'educations',
        'experiences',
        'emergencyContacts',
      ] as const) {
        if (kind in changes) {
          if (!Array.isArray(changes[kind]))
            throw new HrError('INVALID_INPUT', 400);
          for (const item of changes[kind] as unknown[])
            parseProfileItem(kind, item);
        }
      }
      for (const key of ['mobile', 'email', 'address'] as const)
        if (key in changes)
          requireString(changes[key], 'INVALID_INPUT', {
            optional: true,
            max: 320,
          });
      const open = await database
        .query()
        .selectFrom('profileChangeRequests')
        .select(['id'])
        .where('employeeId', '=', employee.id)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (open) throw new HrError('PROFILE_CHANGE_PENDING', 409);
      const stamp = now();
      const { record } = await database
        .repository('profileChangeRequests')
        .withPolicy(policyOf(policies, 'profileChangeRequests'))
        .createOne({
          values: {
            id: newId(),
            employeeId: employee.id,
            changes,
            status: 'pending',
            reviewerUserId: null,
            reviewedAt: null,
            comment: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      const admins = await hrAdministrators();
      if (admins.length)
        await notify({
          key: `profileChange:${String((record as Record<string, unknown>).id)}:pending`,
          userIds: admins,
          message: 'profileChangePending',
          params: { name: employee.name },
          path: '/talent/employees',
        });
      return toChangeRequest(record);
    },

    async listProfileChanges(ctx, status) {
      const policies = await authorizeAction(ctx.authz, CHANGE, 'review');
      const rows = await database
        .repository('profileChangeRequests')
        .withPolicy(policyOf(policies, 'profileChangeRequests'))
        .findMany({
          ...(status ? { filter: { status } } : {}),
          sort: (s) => [s.field('createdAt').desc()],
        });
      const result: ProfileChangeRequest[] = [];
      for (const row of rows) result.push(await toChangeRequest(row));
      return result;
    },

    async reviewProfileChange(ctx, id, decision, comment) {
      const policies = await authorizeAction(ctx.authz, CHANGE, 'review');
      const outcome = await database.transaction(async (connection) => {
        const repo = connection
          .repository('profileChangeRequests')
          .withPolicy(policyOf(policies, 'profileChangeRequests'));
        const row = (await repo.findOne({ filter: { id } })) as
          Record<string, unknown> | undefined;
        if (!row) throw new HrError('PROFILE_CHANGE_NOT_FOUND', 404);
        if (row.status !== 'pending')
          throw new HrError('PROFILE_CHANGE_NOT_PENDING', 409);
        const employeeId = String(row.employeeId);
        if (decision === 'approve')
          await applyProfileChanges(
            connection,
            employeeId,
            parseJson<Record<string, unknown>>(row.changes, {}),
          );
        await repo.updateOne({
          filter: { id, status: 'pending' },
          values: {
            status: decision === 'approve' ? 'approved' : 'rejected',
            reviewerUserId: ctx.userId,
            reviewedAt: now(),
            comment: comment?.trim() || null,
            updatedAt: now(),
          },
        });
        return { employeeId };
      });
      const employee = await loadEmployee(outcome.employeeId);
      if (employee?.userId)
        await notify({
          key: `profileChange:${id}:${decision}`,
          userIds: [employee.userId],
          message:
            decision === 'approve'
              ? 'profileChangeApproved'
              : 'profileChangeRejected',
          params: { comment: comment ?? '' },
          path: '/talent/me',
        });
      const row = await database
        .query()
        .selectFrom('profileChangeRequests')
        .select([
          'id',
          'employeeId',
          'changes',
          'status',
          'reviewerUserId',
          'reviewedAt',
          'comment',
          'createdAt',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      return toChangeRequest(row as Record<string, unknown>);
    },

    async myProfileChange(ctx) {
      const employee = await talent.employeeOfUser(ctx.userId);
      if (!employee) return undefined;
      const row = await database
        .query()
        .selectFrom('profileChangeRequests')
        .select([
          'id',
          'employeeId',
          'changes',
          'status',
          'reviewerUserId',
          'reviewedAt',
          'comment',
          'createdAt',
        ])
        .where('employeeId', '=', employee.id)
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      return row ? toChangeRequest(row) : undefined;
    },

    async report(ctx, filters, locale) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.hrReport',
        'view',
      );
      const departmentIds = filters.departmentId
        ? await organization.descendantsOf(filters.departmentId)
        : undefined;
      const rows =
        departmentIds && !departmentIds.length
          ? []
          : await database
              .repository('employees')
              .withPolicy(policyOf(policies, 'employees'))
              .findMany({
                ...(departmentIds
                  ? {
                      filter: (f) =>
                        f.or(
                          departmentIds.map((id) =>
                            f.string('departmentId').eq(id),
                          ),
                        ),
                    }
                  : {}),
              });
      const employees = rows.map((r) =>
        toEmployee(r as Record<string, unknown>),
      );
      const to = filters.to ?? currentDate();
      const from = filters.from ?? addDays(to, -364);
      const active = employees.filter(
        (e) => e.status !== 'leave' && e.status !== 'pending',
      );
      const joined = employees.filter(
        (e) => e.hireDate && e.hireDate >= from && e.hireDate <= to,
      ).length;
      const left = employees.filter(
        (e) => e.leaveDate && e.leaveDate >= from && e.leaveDate <= to,
      ).length;
      const atStart = employees.filter(
        (e) =>
          e.hireDate &&
          e.hireDate < from &&
          (!e.leaveDate || e.leaveDate >= from),
      ).length;
      const atEnd = active.length;
      const average = (atStart + atEnd) / 2;
      const turnoverRate =
        average > 0 ? Math.round((left / average) * 1000) / 10 : 0;
      const months: { month: string; joined: number; left: number }[] = [];
      const cursor = new Date(`${to.slice(0, 7)}-01T00:00:00Z`);
      for (let i = 11; i >= 0; i -= 1) {
        const d = new Date(
          Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1),
        );
        const month = d.toISOString().slice(0, 7);
        months.push({
          month,
          joined: employees.filter((e) => e.hireDate?.startsWith(month)).length,
          left: employees.filter((e) => e.leaveDate?.startsWith(month)).length,
        });
      }
      const departmentTitles = new Map<string, string>();
      const departments = await database
        .query()
        .selectFrom('departments')
        .select(['id', 'title'])
        .execute();
      for (const d of departments)
        departmentTitles.set(
          String(d.id),
          organization.titleText(String(d.title), locale),
        );
      const byDepartment = new Map<string, number>();
      for (const e of active)
        byDepartment.set(
          e.departmentId,
          (byDepartment.get(e.departmentId) ?? 0) + 1,
        );
      const tenure = { lt1: 0, y1to3: 0, y3to5: 0, gt5: 0 };
      for (const e of active) {
        if (!e.hireDate) continue;
        const years = daysBetween(e.hireDate, to) / 365;
        if (years < 1) tenure.lt1 += 1;
        else if (years < 3) tenure.y1to3 += 1;
        else if (years < 5) tenure.y3to5 += 1;
        else tenure.gt5 += 1;
      }
      const employmentTypes = new Map<string, number>();
      for (const e of active)
        employmentTypes.set(
          e.employmentType,
          (employmentTypes.get(e.employmentType) ?? 0) + 1,
        );
      const probationEnding = active
        .filter(
          (e) =>
            e.status === 'probation' &&
            e.probationEndDate &&
            daysBetween(currentDate(), e.probationEndDate) <= 30,
        )
        .map((e) => ({
          employeeId: e.id,
          name: e.name,
          probationEndDate: e.probationEndDate!,
          departmentTitle: departmentTitles.get(e.departmentId) ?? '',
        }));
      const contractRows = active.length
        ? await database
            .query()
            .selectFrom('employmentContracts')
            .select(['id', 'employeeId', 'contractNo', 'endDate'])
            .where('status', '=', 'active')
            .where(
              'employeeId',
              'in',
              active.map((e) => e.id),
            )
            .execute()
        : [];
      const nameById = new Map(active.map((e) => [e.id, e.name]));
      const contractsEnding = contractRows
        .map((c) => ({
          contractId: String(c.id),
          employeeId: String(c.employeeId),
          name: nameById.get(String(c.employeeId)) ?? '',
          endDate: toDateOnly(c.endDate as string | null),
          contractNo: String(c.contractNo),
        }))
        .filter(
          (c): c is typeof c & { endDate: string } =>
            Boolean(c.endDate) && daysBetween(currentDate(), c.endDate!) <= 60,
        )
        .sort((a, b) => a.endDate.localeCompare(b.endDate));
      return {
        headcount: atEnd,
        probation: active.filter((e) => e.status === 'probation').length,
        joined,
        left,
        turnoverRate,
        monthly: months,
        byDepartment: [...byDepartment.entries()]
          .map(([departmentId, count]) => ({
            departmentId,
            title: departmentTitles.get(departmentId) ?? departmentId,
            count,
          }))
          .sort((a, b) => b.count - a.count),
        tenure: [
          { bucket: 'lt1', count: tenure.lt1 },
          { bucket: 'y1to3', count: tenure.y1to3 },
          { bucket: 'y3to5', count: tenure.y3to5 },
          { bucket: 'gt5', count: tenure.gt5 },
        ],
        employmentTypes: [...employmentTypes.entries()].map(
          ([type, count]) => ({ type, count }),
        ),
        probationEnding: probationEnding.sort((a, b) =>
          a.probationEndDate.localeCompare(b.probationEndDate),
        ),
        contractsEnding,
      };
    },

    async orgChart(ctx, locale) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.orgChart',
        'view',
      );
      const departments = (
        await database
          .repository('departments')
          .withPolicy(policyOf(policies, 'departments'))
          .findMany({ sort: (s) => [s.field('sortOrder').asc()] })
      ).map((r) => r as Record<string, unknown>);
      const employees = (
        await database
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .findMany()
      ).map((r) => r as Record<string, unknown>);
      const counts = new Map<string, number>();
      for (const e of employees) {
        if (e.status === 'leave' || e.status === 'pending') continue;
        counts.set(
          String(e.departmentId),
          (counts.get(String(e.departmentId)) ?? 0) + 1,
        );
      }
      const active = departments.filter((d) => Boolean(d.active));
      const nodes = new Map<string, OrgChartNode>();
      for (const d of active) {
        nodes.set(String(d.id), {
          id: String(d.id),
          title: organization.titleText(String(d.title), locale),
          parentId: d.parentId == null ? null : str(d.parentId),
          managerName: await userName(
            d.managerId == null ? null : str(d.managerId),
          ),
          headcount: counts.get(String(d.id)) ?? 0,
          children: [],
        });
      }
      const roots: OrgChartNode[] = [];
      for (const node of nodes.values()) {
        const parent = node.parentId ? nodes.get(node.parentId) : undefined;
        if (parent) parent.children.push(node);
        else roots.push(node);
      }
      // Roll headcounts up the tree so a parent shows its whole subtree.
      const rollUp = (node: OrgChartNode): number => {
        node.headcount += node.children.reduce(
          (sum, child) => sum + rollUp(child),
          0,
        );
        return node.headcount;
      };
      for (const root of roots) rollUp(root);
      return {
        tree: roots,
        canOpenEmployees: await can(ctx, 'talent.employee', 'list'),
      };
    },

    async orgChartMembers(ctx, departmentId) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.orgChart',
        'view',
      );
      const rows = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({
          filter: { departmentId },
          sort: (s) => [s.field('name').asc()],
        });
      const positionIds = [
        ...new Set(
          rows
            .map((r) => (r as Record<string, unknown>).positionId)
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const positions = positionIds.length
        ? await database
            .query()
            .selectFrom('positions')
            .select(['id', 'title'])
            .where('id', 'in', positionIds)
            .execute()
        : [];
      const titles = new Map(
        positions.map((p) => [String(p.id), String(p.title)]),
      );
      return rows
        .map((r) => r as Record<string, unknown>)
        .filter((r) => r.status !== 'leave' && r.status !== 'pending')
        .map((r) => ({
          id: String(r.id),
          name: String(r.name),
          positionTitle: r.positionId
            ? (titles.get(str(r.positionId)) ?? null)
            : null,
        }));
    },

    async myEvents(ctx, employeeId, locale) {
      // Events are visible to whoever may view the employee record itself.
      const policies = await authorizeAction(
        ctx.authz,
        'talent.employee',
        'view',
      );
      const employee = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findOne({ filter: { id: employeeId } });
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const rows = await database
        .query()
        .selectFrom('jobEvents')
        .selectAll()
        .where('employeeId', '=', employeeId)
        .orderBy('effectiveDate', 'desc')
        .execute();
      const departmentIds = [
        ...new Set(
          rows
            .flatMap((r) => [r.fromDepartmentId, r.toDepartmentId])
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const positionIds = [
        ...new Set(
          rows
            .flatMap((r) => [r.fromPositionId, r.toPositionId])
            .filter((id): id is string => typeof id === 'string'),
        ),
      ];
      const [departments, positions] = await Promise.all([
        departmentIds.length
          ? database
              .query()
              .selectFrom('departments')
              .select(['id', 'title'])
              .where('id', 'in', departmentIds)
              .execute()
          : Promise.resolve([]),
        positionIds.length
          ? database
              .query()
              .selectFrom('positions')
              .select(['id', 'title'])
              .where('id', 'in', positionIds)
              .execute()
          : Promise.resolve([]),
      ]);
      const departmentTitle = new Map(
        departments.map((d) => [
          String(d.id),
          organization.titleText(String(d.title), locale),
        ]),
      );
      const positionTitle = new Map(
        positions.map((p) => [String(p.id), String(p.title)]),
      );
      return rows.map((r) => ({
        id: String(r.id),
        eventType: String(r.eventType),
        effectiveDate: toDateOnly(r.effectiveDate as string),
        fromDepartment: r.fromDepartmentId
          ? (departmentTitle.get(str(r.fromDepartmentId)) ?? null)
          : null,
        toDepartment: r.toDepartmentId
          ? (departmentTitle.get(str(r.toDepartmentId)) ?? null)
          : null,
        fromPosition: r.fromPositionId
          ? (positionTitle.get(str(r.fromPositionId)) ?? null)
          : null,
        toPosition: r.toPositionId
          ? (positionTitle.get(str(r.toPositionId)) ?? null)
          : null,
        actionId: r.actionId == null ? null : str(r.actionId),
      }));
    },

    async runDaily(options = {}) {
      const asOf = options.asOf ?? currentDate();
      const reminders = (await deps.settings.read('reminders')).value;
      const report: DailyRunReport = {
        effectiveActions: 0,
        probationReminders: 0,
        contractReminders: 0,
        expiredContracts: 0,
      };
      // 1. Approved actions whose effective date has arrived.
      const due = await database
        .query()
        .selectFrom('personnelActions')
        .select([...ACTION_FIELDS])
        .where('status', '=', 'approved')
        .where('effectiveDate', '<=', asOf)
        .execute();
      for (const row of due) {
        const effect = await database.transaction(async (connection) =>
          takeEffect(connection, row as Record<string, unknown>),
        );
        await talent.notifyUsers(effect.affected);
        const action = await reloadAction(undefined, String(row.id));
        await notify({
          key: `action:${action.id}:effective`,
          userIds: effect.recipients,
          message: 'actionEffective',
          params: { type: action.actionType, name: action.employeeName ?? '' },
          path: `/talent/actions/${action.id}`,
        });
        report.effectiveActions += 1;
      }
      // 2. Probation ending within 15 days.
      const probation = await database
        .query()
        .selectFrom('employees')
        .select(['id', 'name', 'departmentId', 'probationEndDate'])
        .where('status', '=', 'probation')
        .execute();
      for (const row of probation) {
        const end = toDateOnly(row.probationEndDate as string | null);
        if (!end) continue;
        const days = daysBetween(asOf, end);
        if (days < 0 || days > reminders.probationDays) continue;
        const head = await organization.resolveHead(String(row.departmentId));
        const recipients = new Set<string>(await hrAdministrators());
        if (head) recipients.add(head.userId);
        if (!recipients.size) continue;
        const sent = await reminderOnce(
          `probation:${String(row.id)}:${end}`,
          () =>
            notify({
              key: `probation:${String(row.id)}:${end}`,
              userIds: [...recipients],
              message: 'probationEnding',
              params: { name: String(row.name), date: end },
              path: `/talent/employees/${String(row.id)}`,
            }),
        );
        if (sent) report.probationReminders += 1;
      }
      // 3. Contracts ending in 60 and 30 days, and contracts past their end.
      const contracts = await database
        .query()
        .selectFrom('employmentContracts')
        .select(['id', 'employeeId', 'contractNo', 'endDate'])
        .where('status', '=', 'active')
        .execute();
      const admins = await hrAdministrators();
      for (const row of contracts) {
        const end = toDateOnly(row.endDate as string | null);
        if (!end) continue;
        const days = daysBetween(asOf, end);
        if (days < 0) {
          await database
            .query()
            .updateTable('employmentContracts')
            .set({ status: 'expired', updatedAt: now() })
            .where('id', '=', String(row.id))
            .where('status', '=', 'active')
            .execute();
          report.expiredContracts += 1;
          if (admins.length)
            await reminderOnce(`contract:${String(row.id)}:expired`, () =>
              notify({
                key: `contract:${String(row.id)}:expired`,
                userIds: admins,
                message: 'contractExpired',
                params: { contractNo: String(row.contractNo), date: end },
                path: '/talent/contracts',
              }),
            );
          continue;
        }
        // The reminder schedule is a set of windows, not independent broadcasts:
        // once a contract enters the 30-day window, send the 30-day reminder only.
        const threshold = [...reminders.contractDays]
          .sort((a, b) => a - b)
          .find((value) => days <= value);
        if (threshold === undefined || !admins.length) continue;
        const sent = await reminderOnce(
          `contract:${String(row.id)}:${threshold}`,
          () =>
            notify({
              key: `contract:${String(row.id)}:${threshold}`,
              userIds: admins,
              message: 'contractEnding',
              params: {
                contractNo: String(row.contractNo),
                date: end,
                days: String(threshold),
              },
              path: '/talent/contracts',
            }),
        );
        if (sent) report.contractReminders += 1;
      }
      return report;
    },
  };

  return service;
}

function addMonths(dateOnly: string, months: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

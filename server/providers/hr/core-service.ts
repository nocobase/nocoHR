import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { OrganizationService } from './organization-service.js';
import {
  isPromotion,
  loadPositionGrades,
  recordJobEvent,
  type JobEventProcessor,
  type JobEventType,
} from './job-events.js';
import {
  readValues,
  type CustomFieldDefinition,
  type CustomFieldService,
} from './custom-fields.js';
import type {
  ChainRule,
  PersonnelSettingsService,
} from './personnel-settings.js';
import {
  addDays,
  daysBetween,
  HrError,
  isDateOnly,
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
import { assertUsableHrFile } from './hr-files.js';
import { closeWorkItems } from './work-item-store.js';
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
/** 来自 Offer (V2-07): the offer an onboarding action was raised from and the field names recognized from the ID. */
function offerOrigin(input: Record<string, unknown>): {
  offerId?: string;
  recognizedFields?: string[];
} {
  if (input.offerId === undefined || input.offerId === null) return {};
  if (
    typeof input.offerId !== 'string' ||
    !input.offerId ||
    input.offerId.length > 64
  )
    throw new HrError('INVALID_INPUT', 400);
  const recognized = input.recognizedFields ?? [];
  if (
    !Array.isArray(recognized) ||
    recognized.length > 20 ||
    recognized.some((f) => typeof f !== 'string' || !f || f.length > 32)
  )
    throw new HrError('INVALID_INPUT', 400);
  return {
    offerId: input.offerId,
    recognizedFields: [...new Set(recognized as string[])],
  };
}

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
  // V1-02 V2 增补: the address the employee is reached at after leaving.
  'personalEmail',
  'educations',
  'experiences',
  'emergencyContacts',
] as const;

/** The settings item HR administrators hold; the second approval level. */
export const HR_ADMIN_SETTINGS = 'talent.hr';
/**
 * What the HR assistant may propose from an attachment: identity fields from
 * an ID card, an education from a diploma, the dates and number of the active
 * contract from its scan. They go through HR review like any change request.
 */
export const AI_PROFILE_FIELDS = [
  'idNumber',
  'birthDate',
  'gender',
  'address',
  'education',
  'contract',
] as const;

export interface ApprovalStep {
  level: number;
  /** departmentHead and hrAdmin are the default two levels; extra is a level an administrator added for a department. */
  kind: 'departmentHead' | 'hrAdmin' | 'extra';
  /** The added level's name, such as "厂长审批"; default levels are named by kind. */
  name?: string | null;
  /** The added-level rule this step came from. */
  ruleId?: string | null;
  /** Levels folded into this one because the same person approves them. */
  merged?: { kind: ApprovalStep['kind']; name: string | null }[];
  approverUserId: string | null;
  /** Everyone who may decide this level; empty when any HR administrator decides. */
  approverUserIds?: string[];
  /** Any HR administrator decides: the HR level, or a level whose approver could not be found. */
  anyHrAdmin?: boolean;
  /** Why the level is not decided by its configured approver. */
  fallback?: 'noApprover' | 'selfEscalated' | null;
  departmentId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'auto';
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  /** Where the decision was made; absent when it was made on the page. */
  via?: 'feishuCard' | null;
}

/** Who may decide a step; snapshots written before the chain became configurable carry only kind and approverUserId. */
export function stepApprovers(step: ApprovalStep): {
  anyHrAdmin: boolean;
  userIds: string[];
} {
  const anyHrAdmin = step.anyHrAdmin ?? step.kind === 'hrAdmin';
  const userIds = anyHrAdmin
    ? []
    : (step.approverUserIds ??
      (step.approverUserId ? [step.approverUserId] : []));
  return { anyHrAdmin, userIds };
}

export interface ChainPreviewInput {
  actionType: (typeof ACTION_TYPES)[number];
  /** The department the chain is resolved for: the target for onboard and transfer, the employee's otherwise. */
  approvalDepartmentId: string | null;
  employeeUserId: string | null;
  applicantUserId: string;
  applicantIsHrAdmin: boolean;
  /** V1-02 一句话改配置: rules being drafted, tried on top of the saved ones. */
  extraRules?: readonly ChainRule[];
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
  /** self: the employee's request; assistant: the employee's request through the HR assistant; feishuCard: the employee's request submitted from a Feishu card; ai: the HR assistant's reading of an attachment. */
  source: 'self' | 'assistant' | 'feishuCard' | 'ai';
  attachmentFileId: string | null;
  /** The protected content path of that attachment, for HR to open it beside the suggestion. */
  attachmentPath: string | null;
  /** For ai: each field's confidence (0–1) and the text it was read from. */
  confidence: Record<string, { confidence: number; snippet: string }> | null;
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
  reminderDays: { probation: number; contract: number };
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
  /** The chain an action would get now, for the action form and the settings preview tool. */
  previewChain(
    ctx: ActorContext,
    input: unknown,
  ): Promise<(ApprovalStep & { approverNames: string[] })[]>;
  decideAction(
    ctx: ActorContext,
    id: string,
    decision: 'approve' | 'reject',
    comment: string | null,
    /** feishuCard: decided on a Feishu approval card; shown as 经飞书卡片 on the approval record. */
    via?: 'feishuCard',
  ): Promise<PersonnelAction>;
  cancelAction(ctx: ActorContext, id: string): Promise<PersonnelAction>;
  listContracts(
    ctx: ActorContext,
    filters: { employeeId?: string; quick?: 'expiring' | 'overdue' | '' },
  ): Promise<{
    items: Contract[];
    reminderDays: number;
    can: { manage: boolean };
  }>;
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
    /** assistant: submitted in a conversation with the HR assistant after the employee approved it; feishuCard: submitted from a Feishu card. */
    source?: 'self' | 'assistant' | 'feishuCard',
  ): Promise<ProfileChangeRequest>;
  /** The self-service form: the built-in fields the settings allow, and the added fields placed for self-service. */
  selfServiceFields(): Promise<{
    fields: string[];
    customFields: CustomFieldDefinition[];
  }>;
  listProfileChanges(
    ctx: ActorContext,
    status: string | undefined,
  ): Promise<ProfileChangeRequest[]>;
  reviewProfileChange(
    ctx: ActorContext,
    id: string,
    decision: 'approve' | 'reject',
    comment: string | null,
    /** For a suggestion from the HR assistant: the fields adopted, each with HR's final value. */
    values?: unknown,
  ): Promise<ProfileChangeRequest>;
  /**
   * Writes the HR assistant's reading of an attachment as a pending `source=ai`
   * request with only the fields that differ from the record. Called by the
   * attachment recognition task as its owner, who must hold `extract`.
   */
  createAiSuggestion(
    ctx: ActorContext,
    input: {
      employeeId: string;
      attachmentFileId: string;
      fields: Record<
        string,
        { value: unknown; confidence: number; snippet: string }
      >;
    },
  ): Promise<{ id: string; fields: string[] } | null>;
  /** 岗位变动 (V1-03): events within the viewer's scope, newest first, with filters. */
  listJobEvents(
    ctx: ActorContext,
    filters: {
      eventType?: string;
      source?: string;
      departmentId?: string;
      from?: string;
      to?: string;
      failedOnly?: boolean;
    },
    locale: string,
  ): Promise<{ items: Record<string, unknown>[]; can: { retry: boolean } }>;
  /** Hands a failed event to its handlers again. */
  retryJobEvent(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown>>;
  /** Everyone holding the HR administration settings item: default recipients of HR notices. */
  hrAdministrators(): Promise<string[]>;
  /** Everyone who holds a permission set now, through any subject. */
  holdersOf(setKey: string): Promise<string[]>;
  /** The caller's own record, contracts, probation and job history, for the HR assistant's answers. */
  myHrProfile(
    ctx: ActorContext,
    locale: string,
  ): Promise<Record<string, unknown>>;
  /** What a probation or renewal review needs, read with the viewer's own permissions. */
  hrSummary(
    ctx: ActorContext,
    employeeId: string,
    locale: string,
  ): Promise<Record<string, unknown>>;
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

interface EffectResult {
  affected: string[];
  recipients: string[];
  employeeId: string;
  eventIds: string[];
}

export interface HrCoreServiceDeps {
  settings: PersonnelSettingsService;
  /** 界面追加字段: the onboarding form and self-service carry employee fields placed there. */
  customFields: CustomFieldService;
  /** Resolved lazily: the processor's handlers are registered at boot. */
  jobEvents: () => JobEventProcessor;
  /** V1-03: the data master; in external mode transfers, promotions and offboardings come from the sync. */
  orgMaster?: () => Promise<'nocohr' | 'external'>;
  /** V1-03: pending sync items an action is raised from. */
  syncIssues?: () => {
    assertIssueOpen(key: string): Promise<void>;
    linkAction(key: string, actionId: string): Promise<void>;
  };
  /** V1-02 变动影响清单: an action was raised, decided, cancelled or took effect. */
  onActionChanged?: () => ((actionId: string) => void) | undefined;
  /** V1-02 用工合规检查: a contract was created, renewed, terminated or edited. */
  onContractChanged?: () => ((employeeId: string) => void) | undefined;
  /** After an HR administrator attaches an ID card, diploma or contract scan: starts the HR assistant's recognition. */
  onAttachmentUploaded?: () =>
    | ((input: {
        attachmentId: string;
        employeeId: string;
        uploaderUserId: string;
      }) => void)
    | undefined;
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
  'fromDepartmentId',
  'fromPositionId',
  'approvalDepartmentId',
  'currentApproverUserIds',
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
  'mobile',
  'idNumber',
  'birthDate',
  'address',
  'personalEmail',
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
      const eligible = mayDecide(current, ctx.userId, await isHrAdmin(ctx));
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
      // As raised; actions raised before these columns existed show the employee's current place.
      fromDepartmentId:
        row.fromDepartmentId != null
          ? str(row.fromDepartmentId)
          : String(row.actionType) === 'onboard'
            ? null
            : (employee?.departmentId ?? null),
      fromPositionId:
        row.fromPositionId != null
          ? str(row.fromPositionId)
          : String(row.actionType) === 'onboard'
            ? null
            : (employee?.positionId ?? null),
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

  /**
   * The approval chain for a new action (V1-02 审批与自动化): the head of the
   * approval department, then HR, with the levels administrators added for
   * the department or an ancestor inserted after the first level or after HR
   * in rule order. Nobody approves an action about themselves; a level whose
   * approver cannot be found falls to HR. Adjacent levels with the same
   * approver merge when the setting says so, and a level the applicant would
   * approve passes by itself. The result is the snapshot the action keeps.
   */
  async function buildChain(input: ChainPreviewInput): Promise<ApprovalStep[]> {
    const saved = (await deps.settings.read('approvalChain')).value;
    const chainSettings = input.extraRules?.length
      ? { ...saved, rules: [...saved.rules, ...input.extraRules] }
      : saved;
    const self = input.employeeUserId;
    const blank = (
      kind: ApprovalStep['kind'],
    ): Omit<ApprovalStep, 'approverUserId' | 'approverUserIds'> => ({
      level: 0,
      kind,
      name: null,
      ruleId: null,
      merged: [],
      anyHrAdmin: false,
      fallback: null,
      departmentId: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
    });
    const toHr = (
      step: Omit<ApprovalStep, 'approverUserId' | 'approverUserIds'>,
      fallback: ApprovalStep['fallback'],
    ): ApprovalStep => ({
      ...step,
      approverUserId: null,
      approverUserIds: [],
      anyHrAdmin: true,
      fallback,
    });
    /** The head of a department, escalating past the employee the action is about. */
    async function headFor(
      departmentId: string,
    ): Promise<
      { userId: string; departmentId: string; escalated: boolean } | undefined
    > {
      let head = await organization.resolveHead(departmentId);
      let escalated = false;
      while (head && self && head.userId === self) {
        escalated = true;
        const parent = (await organization.getDepartment(head.departmentId))
          ?.parentId;
        head = parent ? await organization.resolveHead(parent) : undefined;
      }
      return head ? { ...head, escalated } : undefined;
    }

    const first = blank('departmentHead');
    let firstStep: ApprovalStep;
    const head = input.approvalDepartmentId
      ? await headFor(input.approvalDepartmentId)
      : undefined;
    if (head) {
      firstStep = {
        ...first,
        departmentId: head.departmentId,
        approverUserId: head.userId,
        approverUserIds: [head.userId],
        fallback: head.escalated ? 'selfEscalated' : null,
      };
    } else {
      const unescalated = input.approvalDepartmentId
        ? await organization.resolveHead(input.approvalDepartmentId)
        : undefined;
      firstStep = toHr(
        { ...first, departmentId: input.approvalDepartmentId },
        unescalated ? 'selfEscalated' : 'noApprover',
      );
    }
    const hrStep = toHr(blank('hrAdmin'), null);
    hrStep.fallback = null;

    const afterFirst: ApprovalStep[] = [];
    const afterHr: ApprovalStep[] = [];
    if (input.approvalDepartmentId) {
      for (const rule of chainSettings.rules) {
        if (!rule.enabled || !rule.actionTypes.includes(input.actionType))
          continue;
        const scope = await organization.descendantsOf(rule.departmentId);
        if (!scope.includes(input.approvalDepartmentId)) continue;
        const base = { ...blank('extra'), name: rule.name, ruleId: rule.id };
        let userIds: string[] = [];
        let departmentId: string | null = null;
        if (rule.approver.type === 'departmentHead') {
          const ruleHead = await headFor(rule.approver.departmentId);
          if (ruleHead) {
            userIds = [ruleHead.userId];
            departmentId = ruleHead.departmentId;
          }
        } else if (rule.approver.type === 'user') {
          const user = await users
            .get(rule.approver.userId)
            .catch(() => undefined);
          if (user) userIds = [rule.approver.userId];
        } else {
          userIds = await holdersOf(rule.approver.key);
        }
        userIds = userIds.filter((id) => id !== self);
        const step: ApprovalStep = userIds.length
          ? {
              ...base,
              departmentId,
              approverUserId: userIds.length === 1 ? userIds[0] : null,
              approverUserIds: userIds,
            }
          : toHr(base, 'noApprover');
        (rule.position === 'afterHr' ? afterHr : afterFirst).push(step);
      }
    }
    let steps = [firstStep, ...afterFirst, hrStep, ...afterHr];

    if (chainSettings.mergeAdjacent) {
      const identity = (step: ApprovalStep) => {
        const who = stepApprovers(step);
        return who.anyHrAdmin ? 'hr' : [...who.userIds].sort().join(',');
      };
      const merged: ApprovalStep[] = [];
      for (const step of steps) {
        const previous = merged.at(-1);
        if (previous && identity(previous) === identity(step)) {
          previous.merged = [
            ...(previous.merged ?? []),
            { kind: step.kind, name: step.name ?? null },
            ...(step.merged ?? []),
          ];
          continue;
        }
        merged.push(step);
      }
      steps = merged;
    }
    const stamp = now().toISOString();
    for (const [index, step] of steps.entries()) {
      step.level = index + 1;
      const who = stepApprovers(step);
      const applicantDecides = who.anyHrAdmin
        ? input.applicantIsHrAdmin
        : who.userIds.includes(input.applicantUserId);
      // The applicant never approves an action about themselves, so no auto-pass for them either.
      if (applicantDecides && input.applicantUserId !== self) {
        step.status = 'auto';
        step.decidedAt = stamp;
      }
    }
    return steps;
  }

  /** Everyone who currently holds a permission set, through users, positions, departments or department heads. */
  async function holdersOf(setKey: string): Promise<string[]> {
    const result = new Set<string>();
    for (const assignment of await authz.permissionSets
      .listAssignments(setKey)
      .catch(() => [])) {
      await addSubjectUsers(result, assignment.subject);
    }
    return [...result];
  }

  async function addSubjectUsers(
    result: Set<string>,
    subject: { type: string; id: string },
  ): Promise<void> {
    const { type, id } = subject;
    if (type === 'user') result.add(id);
    else if (type === 'org.position') {
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
    } else if (type === 'org.departmentHead') {
      for (const department of await organization.listTree())
        if (department.managerId && department.active)
          result.add(department.managerId);
    }
  }

  function approvalDepartmentOf(
    actionType: string,
    toDepartmentId: string | null,
    employee: EmployeeRecord | undefined,
  ): string | null {
    return actionType === 'onboard' || actionType === 'transfer'
      ? toDepartmentId
      : (employee?.departmentId ?? null);
  }

  async function currentApprovers(
    approvals: ApprovalStep[],
  ): Promise<string[]> {
    const step = approvals.find((s) => s.status === 'pending');
    if (!step) return [];
    const who = stepApprovers(step);
    return who.anyHrAdmin ? await hrAdministrators() : who.userIds;
  }

  function mayDecide(
    step: ApprovalStep | undefined,
    userId: string,
    hrAdmin: boolean,
  ): boolean {
    if (!step) return false;
    const who = stepApprovers(step);
    return who.anyHrAdmin ? hrAdmin : who.userIds.includes(userId);
  }

  async function notifyApprovers(
    action: PersonnelAction,
    level: ApprovalStep,
  ): Promise<void> {
    const who = stepApprovers(level);
    const recipients = who.anyHrAdmin ? await hrAdministrators() : who.userIds;
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
  ): Promise<EffectResult> {
    const actionId = String(row.id);
    const type = String(row.actionType);
    const effectiveDate =
      toDateOnly(row.effectiveDate as string) ?? currentDate();
    const stamp = now();
    const affected: string[] = [];
    const eventIds: string[] = [];
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
          careerStartDate:
            typeof candidate.careerStartDate === 'string' &&
            candidate.careerStartDate <= effectiveDate
              ? candidate.careerStartDate
              : null,
          positionSince: row.toPositionId ? effectiveDate : null,
          email: typeof candidate.email === 'string' ? candidate.email : null,
          mobile:
            typeof candidate.mobile === 'string' ? candidate.mobile : null,
          employmentType:
            typeof candidate.employmentType === 'string'
              ? candidate.employmentType
              : 'fullTime',
          probationEndDate,
          ...(typeof candidate.externalUserId === 'string'
            ? {
                externalProvider: str(candidate.externalProvider ?? 'feishu'),
                externalUserId: candidate.externalUserId,
              }
            : {}),
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      if (isRecord(candidate.customFields))
        await talent.writeCustomFields(connection, id, candidate.customFields);
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
      eventIds.push(
        await recordJobEvent(connection, {
          employeeId: id,
          eventType: 'onboard',
          fromDepartmentId: null,
          toDepartmentId: employee.departmentId,
          fromPositionId: null,
          toPositionId: employee.positionId,
          effectiveDate,
          source: 'action',
          actionId,
          note: null,
        }),
      );
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
        // The HR assistant's 转正准备 is done once the confirmation takes effect.
        await closeWorkItems(connection.query, {
          prefixes: [`hrAssistant:probationPrep:${employee.id}:`],
        });
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
            // The contact address given on the 离职单, kept unless none was given.
            ...(row.personalEmail
              ? { personalEmail: str(row.personalEmail) }
              : {}),
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
      eventIds.push(
        await recordJobEvent(connection, {
          employeeId: employee.id,
          eventType: type as JobEventType,
          fromDepartmentId: from.departmentId,
          toDepartmentId: after.departmentId,
          fromPositionId: from.positionId,
          toPositionId: after.positionId,
          effectiveDate,
          source: 'action',
          actionId,
          note: null,
        }),
      );
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
    return {
      affected,
      recipients: [...recipients],
      employeeId: employee.id,
      eventIds,
    };
  }

  /** After the effect's transaction commits: refresh sessions, then hand the new events to their handlers. */
  async function afterEffect(effect: EffectResult): Promise<void> {
    await talent.notifyUsers(effect.affected);
    await deps
      .jobEvents()
      .process(effect.eventIds)
      .catch(() => 0);
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
    for (const key of ['mobile', 'email', 'address', 'personalEmail'] as const)
      if (key in changes)
        scalar[key] = changes[key] == null ? null : str(changes[key]);
    if (Object.keys(scalar).length)
      await connection.query
        .updateTable('employees')
        .set({ ...scalar, updatedAt: stamp })
        .where('id', '=', employeeId)
        .execute();
    if (isRecord(changes.customFields))
      await talent.writeCustomFields(
        connection,
        employeeId,
        changes.customFields,
      );
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
    const source =
      row.source === 'ai'
        ? 'ai'
        : row.source === 'assistant' || row.source === 'feishuCard'
          ? row.source
          : 'self';
    const current: Record<string, unknown> = {};
    if (employee && isRecord(changes.customFields)) {
      const stored = await database
        .query()
        .selectFrom('employees')
        .select(['customFields'])
        .where('id', '=', employee.id)
        .executeTakeFirst();
      const values = readValues(stored?.customFields);
      current.customFields = Object.fromEntries(
        Object.keys(changes.customFields).map((key) => [
          key,
          values[key] ?? null,
        ]),
      );
    }
    if (employee) {
      for (const key of [
        'mobile',
        'email',
        'address',
        'personalEmail',
        'idNumber',
        'birthDate',
        'gender',
      ] as const)
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
      if ('education' in changes)
        current.education = (
          await database
            .query()
            .selectFrom('employeeEducations')
            .selectAll()
            .where('employeeId', '=', employee.id)
            .execute()
        ).map((r) => serialize(r as Record<string, unknown>));
      if ('contract' in changes) {
        const active = await database
          .query()
          .selectFrom('employmentContracts')
          .select(['contractNo', 'startDate', 'endDate'])
          .where('employeeId', '=', employee.id)
          .where('status', '=', 'active')
          .executeTakeFirst();
        current.contract = active ? serialize(active) : null;
      }
    }
    return {
      id: String(row.id),
      employeeId: String(row.employeeId),
      employeeName: employee?.name ?? '',
      changes,
      current,
      source,
      attachmentFileId:
        row.attachmentFileId == null ? null : str(row.attachmentFileId),
      attachmentPath: await filePath(
        row.attachmentFileId == null ? null : str(row.attachmentFileId),
      ),
      confidence: parseJson<ProfileChangeRequest['confidence']>(
        row.confidence,
        null,
      ),
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

  async function filePath(fileId: string | null): Promise<string | null> {
    if (!fileId) return null;
    const file = await database
      .query()
      .selectFrom('hrFiles')
      .select(['id', 'ext'])
      .where('id', '=', fileId)
      .executeTakeFirst();
    return file
      ? `/uploads/hr-files/${String(file.id)}${file.ext ? `.${str(file.ext).replace(/^\./u, '')}` : ''}`
      : null;
  }

  /** Checks one AI-proposed field; answers the value to store, or throws. */
  function parseAiField(key: string, value: unknown): unknown {
    switch (key) {
      case 'idNumber':
        return requireString(value, 'PROFILE_AI_FIELD_INVALID', { max: 64 });
      case 'address':
        return requireString(value, 'PROFILE_AI_FIELD_INVALID', { max: 320 });
      case 'birthDate': {
        const date = optionalDate(value, 'PROFILE_AI_FIELD_INVALID');
        if (!date) throw new HrError('PROFILE_AI_FIELD_INVALID', 400);
        return date;
      }
      case 'gender':
        return requireEnum(
          value,
          ['male', 'female', 'other'] as const,
          'PROFILE_AI_FIELD_INVALID',
        );
      case 'education':
        return parseProfileItem('educations', value);
      case 'contract': {
        if (!isRecord(value))
          throw new HrError('PROFILE_AI_FIELD_INVALID', 400);
        const out: Record<string, unknown> = {};
        if (value.contractNo !== undefined)
          out.contractNo = requireString(
            value.contractNo,
            'PROFILE_AI_FIELD_INVALID',
            { max: 64 },
          );
        for (const date of ['startDate', 'endDate'] as const)
          if (value[date] !== undefined)
            out[date] = optionalDate(value[date], 'PROFILE_AI_FIELD_INVALID');
        if (!Object.keys(out).length)
          throw new HrError('PROFILE_AI_FIELD_INVALID', 400);
        return out;
      }
      default:
        throw new HrError('PROFILE_CHANGE_FIELD_NOT_ALLOWED', 400, {
          field: key,
        });
    }
  }

  /** Writes adopted AI fields: identity fields on the record, an education row, the active contract's number and dates. */
  async function applyAiChanges(
    connection: DatabaseConnection,
    employeeId: string,
    changes: Record<string, unknown>,
  ): Promise<void> {
    const stamp = now();
    const scalar: Record<string, unknown> = {};
    for (const key of ['idNumber', 'birthDate', 'gender', 'address'] as const)
      if (key in changes) scalar[key] = changes[key];
    if (Object.keys(scalar).length)
      await connection.query
        .updateTable('employees')
        .set({ ...scalar, updatedAt: stamp })
        .where('id', '=', employeeId)
        .execute();
    if (isRecord(changes.education))
      await connection.query
        .insertInto('employeeEducations')
        .values({
          id: newId(),
          employeeId,
          ...changes.education,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
    if (isRecord(changes.contract)) {
      const active = await connection.query
        .selectFrom('employmentContracts')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!active) throw new HrError('CONTRACT_NOT_FOUND', 404);
      if (typeof changes.contract.contractNo === 'string')
        await assertContractNoFree(
          connection,
          changes.contract.contractNo,
          String(active.id),
        );
      await connection.query
        .updateTable('employmentContracts')
        .set({ ...changes.contract, updatedAt: stamp })
        .where('id', '=', String(active.id))
        .execute();
    }
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

  /** Whether an employee attachment or a contract already holds the file. */
  async function fileReferenced(fileId: string): Promise<boolean> {
    const query = database.query();
    return Boolean(
      (await query
        .selectFrom('employeeAttachments')
        .select(['id'])
        .where('fileId', '=', fileId)
        .executeTakeFirst()) ??
      (await query
        .selectFrom('employmentContracts')
        .select(['id'])
        .where('fileId', '=', fileId)
        .executeTakeFirst()),
    );
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
          if (
            action.status !== 'pending' ||
            !mayDecide(current, ctx.userId, hrAdmin)
          )
            continue;
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
      // V1-03: with the office suite as the data master, these three come from the sync only.
      if (
        (actionType === 'transfer' ||
          actionType === 'promote' ||
          actionType === 'offboard') &&
        (await deps.orgMaster?.()) === 'external'
      )
        throw new HrError('ACTION_TYPE_SYNC_MANAGED', 409);
      const syncIssueKey =
        typeof input.syncIssueKey === 'string' && input.syncIssueKey
          ? input.syncIssueKey
          : null;
      if (syncIssueKey) await deps.syncIssues?.().assertIssueOpen(syncIssueKey);
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
      // V1-02 V2 增补: where the employee is reached once they have left (sensitive; never in the action's view).
      let personalEmail: string | null = null;
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
          // 参加工作日期 (年假按累计工作年限): from the onboarding form, or estimated from the resume for an offer.
          careerStartDate: optionalDate(input.careerStartDate, 'INVALID_INPUT'),
          // 界面追加字段 placed on the onboarding form; written to the employee when the action takes effect.
          customFields: deps.customFields.prepare(
            deps.customFields.visible(
              await deps.customFields.list('employees'),
              { sensitive: true, placement: 'onboardForm' },
            ),
            input.customFields ?? {},
            {},
            { enforceRequired: true },
          ),
          // V2-07: raised from an accepted offer, with the fields read from the uploaded ID. The values
          // themselves reach the record through HR's confirmation (an ai profile-change suggestion), not here.
          ...offerOrigin(input),
          // From a sync item: the office-suite member the new employee is bound to on effect.
          ...(typeof input.externalUserId === 'string' && input.externalUserId
            ? {
                externalProvider:
                  typeof input.externalProvider === 'string'
                    ? input.externalProvider
                    : 'feishu',
                externalUserId: input.externalUserId,
              }
            : {}),
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
          if (
            typeof input.personalEmail === 'string' &&
            input.personalEmail.trim()
          ) {
            const email = input.personalEmail.trim().toLowerCase();
            if (
              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) ||
              email.length > 320
            )
              throw new HrError('ACTION_PERSONAL_EMAIL_INVALID', 400);
            personalEmail = email;
          }
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
      if (actionType === 'promote' && employee) {
        // 晋升: same job family, a higher grade in the configured order; otherwise it is a transfer.
        const grades = await loadPositionGrades(database.query(), [
          employee.positionId,
          toPositionId,
        ]);
        const order = (await deps.settings.read('gradeOrder')).value.families;
        if (
          !isPromotion(
            employee.positionId ? grades.get(employee.positionId) : undefined,
            toPositionId ? grades.get(toPositionId) : undefined,
            order,
          )
        )
          throw new HrError('ACTION_PROMOTE_NOT_HIGHER', 400);
      }
      const approvalDepartmentId = approvalDepartmentOf(
        actionType,
        toDepartmentId,
        employee,
      );
      const approvals = await buildChain({
        actionType,
        approvalDepartmentId,
        employeeUserId: employee?.userId ?? null,
        applicantUserId: ctx.userId,
        applicantIsHrAdmin: hrAdmin,
      });
      const allPassed = !approvals.some((s) => s.status === 'pending');
      const linkIssue = async (actionId: string) => {
        if (syncIssueKey)
          await deps.syncIssues?.().linkAction(syncIssueKey, actionId);
      };
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
            fromDepartmentId: employee?.departmentId ?? null,
            fromPositionId: employee?.positionId ?? null,
            approvalDepartmentId,
            toDepartmentId,
            toPositionId,
            effectiveDate,
            reason,
            leaveReason,
            personalEmail,
            status: allPassed ? 'approved' : 'pending',
            applicantUserId: ctx.userId,
            approvals,
            currentApproverUserIds: await currentApprovers(approvals),
            effectiveAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      await linkIssue(id);
      if (allPassed && effectiveDate <= currentDate()) {
        // Every level passed by itself: an action due today takes effect now.
        const effect = await database.transaction(async (connection) => {
          const fresh = (await connection.query
            .selectFrom('personnelActions')
            .select([...ACTION_FIELDS])
            .where('id', '=', id)
            .executeTakeFirst()) as Record<string, unknown>;
          return takeEffect(connection, fresh);
        });
        await afterEffect(effect);
        const action = await reloadAction(ctx, id);
        await notify({
          key: `action:${id}:effective`,
          userIds: effect.recipients,
          message: 'actionEffective',
          params: { type: action.actionType, name: action.employeeName ?? '' },
          path: `/talent/actions/${id}`,
        });
        deps.onActionChanged?.()?.(id);
        return action;
      }
      const action = await reloadAction(ctx, id);
      const pending = action.approvals.find((s) => s.status === 'pending');
      if (pending) await notifyApprovers(action, pending);
      deps.onActionChanged?.()?.(id);
      return action;
    },

    async previewChain(ctx, input) {
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const actionType = requireEnum(
        input.actionType,
        ACTION_TYPES,
        'ACTION_TYPE_INVALID',
      );
      const hrAdmin = await isHrAdmin(ctx);
      let employee: EmployeeRecord | undefined;
      let departmentId: string | null;
      if (typeof input.employeeId === 'string' && input.employeeId) {
        // From the action form: the applicant must be able to raise actions, and sees only what the chain would be.
        await authorizeAction(ctx.authz, ACTION, 'create');
        employee = await loadEmployee(input.employeeId);
        if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        departmentId = approvalDepartmentOf(
          actionType,
          typeof input.toDepartmentId === 'string' && input.toDepartmentId
            ? input.toDepartmentId
            : employee.departmentId,
          employee,
        );
      } else {
        departmentId = requireString(
          input.departmentId,
          'ACTION_DEPARTMENT_REQUIRED',
          { max: 64 },
        );
        // The settings tool previews for any department; the action form previews an onboarding for its target.
        if (!hrAdmin) await authorizeAction(ctx.authz, ACTION, 'create');
      }
      if (departmentId && !(await organization.getDepartment(departmentId)))
        throw new HrError('EMPLOYEE_DEPARTMENT_NOT_FOUND', 404);
      const steps = await buildChain({
        actionType,
        approvalDepartmentId: departmentId,
        employeeUserId: employee?.userId ?? null,
        applicantUserId: ctx.userId,
        applicantIsHrAdmin: hrAdmin,
        // Only HR administrators draft configuration.
        extraRules:
          hrAdmin && Array.isArray(input.extraRules)
            ? (input.extraRules as ChainRule[])
            : undefined,
      });
      const withNames = [];
      for (const step of steps) {
        const who = stepApprovers(step);
        const names: string[] = [];
        for (const userId of who.userIds.slice(0, 5)) {
          const name = await userName(userId);
          if (name) names.push(name);
        }
        withNames.push({ ...step, approverNames: names });
      }
      return withNames;
    },

    async decideAction(ctx, id, decision, comment, via) {
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
        if (!mayDecide(step, ctx.userId, hrAdmin))
          throw new HrError('ACTION_NOT_APPROVER', 403);
        const employee = row.employeeId
          ? await loadEmployee(str(row.employeeId), connection)
          : undefined;
        if (employee?.userId && employee.userId === ctx.userId)
          throw new HrError('ACTION_SELF_APPROVAL', 403);
        step.status = decision === 'approve' ? 'approved' : 'rejected';
        step.decidedBy = ctx.userId;
        step.decidedAt = now().toISOString();
        step.comment = comment?.trim() || null;
        if (via) step.via = via;
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
        let effect: EffectResult | undefined;
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
          approvals,
          applicant: String(row.applicantUserId),
          next: approvals.find((s) => s.status === 'pending'),
        };
      });
      if (outcome.effect) await afterEffect(outcome.effect);
      // Resolved after the commit: finding HR administrators reads outside the transaction's connection.
      await database
        .query()
        .updateTable('personnelActions')
        .set({
          currentApproverUserIds: JSON.stringify(
            outcome.status === 'pending'
              ? await currentApprovers(outcome.approvals)
              : [],
          ),
        })
        .where('id', '=', id)
        .execute();
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
      deps.onActionChanged?.()?.(id);
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
            values: {
              status: 'cancelled',
              currentApproverUserIds: [],
              updatedAt: now(),
            },
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
      const recipients = pending ? await currentApprovers([pending]) : [];
      if (recipients.length)
        await notify({
          key: `action:${id}:cancelled`,
          userIds: recipients,
          message: 'actionCancelled',
          params: { type: action.actionType, name: action.employeeName ?? '' },
          path: `/talent/actions/${id}`,
        });
      deps.onActionChanged?.()?.(id);
      return action;
    },

    async listContracts(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'view');
      const reminderDays = Math.max(
        ...(await deps.settings.read('reminders')).value.contractDays,
      );
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
            c.remainingDays <= reminderDays,
        );
      if (filters.quick === 'overdue')
        items = items.filter(
          (c) =>
            c.status === 'active' &&
            c.remainingDays !== null &&
            c.remainingDays < 0,
        );
      return {
        items,
        reminderDays,
        can: { manage: await can(ctx, CONTRACT, 'manage') },
      };
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
      const contract = await toContract(result, employeeNames());
      deps.onContractChanged?.()?.(contract.employeeId);
      return contract;
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
        // The HR assistant's 续签准备 for the old contract is done once it is renewed.
        await closeWorkItems(connection.query, {
          refIds: [`hrAssistant:renewalPrep:${id}`],
        });
        return record;
      });
      const contract = await toContract(result, employeeNames());
      deps.onContractChanged?.()?.(contract.employeeId);
      return contract;
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
      const contract = await toContract(record, employeeNames());
      deps.onContractChanged?.()?.(contract.employeeId);
      return contract;
    },

    async attachContractFile(ctx, id, fileId) {
      const policies = await authorizeAction(ctx.authz, CONTRACT, 'manage');
      const repo = database
        .repository('employmentContracts')
        .withPolicy(policyOf(policies, 'employmentContracts'));
      const current = (await repo.findOne({ filter: { id } })) as
        Record<string, unknown> | undefined;
      if (!current) throw new HrError('CONTRACT_NOT_FOUND', 404);
      // S5: only a scan the caller uploaded for a contract that no other record holds.
      if (fileId)
        await assertUsableHrFile(database, {
          fileId,
          userId: ctx.userId,
          purpose: 'contract',
          referencedHere:
            current.fileId != null && str(current.fileId) === fileId,
          referencedElsewhere: () => fileReferenced(fileId),
          code: 'CONTRACT_FILE_NOT_FOUND',
        });
      const { record } = await repo.updateOne({
        filter: { id },
        values: { fileId, updatedAt: now() },
      });
      const contract = await toContract(record, employeeNames());
      deps.onContractChanged?.()?.(contract.employeeId);
      return contract;
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
        const fileId = String(values.fileId);
        const current = id
          ? await database
              .query()
              .selectFrom('employeeAttachments')
              .select(['fileId'])
              .where('id', '=', id)
              .where('employeeId', '=', employeeId)
              .executeTakeFirst()
          : undefined;
        // S5: only a file the caller uploaded as an attachment that no other record holds.
        await assertUsableHrFile(database, {
          fileId,
          userId: ctx.userId,
          purpose: 'profileAttachment',
          referencedHere: current != null && str(current.fileId) === fileId,
          referencedElsewhere: () => fileReferenced(fileId),
          code: 'PROFILE_FILE_NOT_FOUND',
        });
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
      if (
        kind === 'attachments' &&
        ['idCard', 'diploma', 'contract'].includes(String(values.category))
      )
        deps.onAttachmentUploaded?.()?.({
          attachmentId: String((record as Record<string, unknown>).id),
          employeeId,
          uploaderUserId: ctx.userId,
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

    async selfServiceFields() {
      return {
        fields: [...(await deps.settings.read('selfService')).value.fields],
        customFields: deps.customFields.visible(
          await deps.customFields.list('employees'),
          { sensitive: false, placement: 'selfService' },
        ),
      };
    },

    async requestProfileChange(ctx, changes, source = 'self') {
      const policies = await authorizeAction(ctx.authz, CHANGE, 'request');
      if (!isRecord(changes) || !Object.keys(changes).length)
        throw new HrError('INVALID_INPUT', 400);
      // 人事设置 · 员工自助: only the fields the administrator ticked.
      const allowed = (await deps.settings.read('selfService')).value
        .fields as readonly string[];
      if ('customFields' in changes) {
        // Added fields placed for self-service; sensitive ones never are.
        const definitions = deps.customFields.visible(
          await deps.customFields.list('employees'),
          { sensitive: false, placement: 'selfService' },
        );
        const submitted = changes.customFields;
        if (!isRecord(submitted) || !Object.keys(submitted).length)
          throw new HrError('INVALID_INPUT', 400);
        for (const key of Object.keys(submitted))
          if (!definitions.some((d) => d.key === key))
            throw new HrError('PROFILE_CHANGE_FIELD_NOT_ALLOWED', 400, {
              field: key,
            });
        const prepared = deps.customFields.prepare(definitions, submitted, {});
        changes.customFields = Object.fromEntries(
          Object.keys(submitted).map((key) => [key, prepared[key] ?? null]),
        );
      }
      for (const key of Object.keys(changes))
        if (key === 'customFields') continue;
        else if (
          !(PROFILE_CHANGE_FIELDS as readonly string[]).includes(key) ||
          !allowed.includes(key)
        )
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
      if (
        'personalEmail' in changes &&
        changes.personalEmail != null &&
        changes.personalEmail !== '' &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(str(changes.personalEmail))
      )
        throw new HrError('INVALID_INPUT', 400);
      const open = await database
        .query()
        .selectFrom('profileChangeRequests')
        .select(['id'])
        .where('employeeId', '=', employee.id)
        .where('status', '=', 'pending')
        // The assistant's suggestions for HR do not block the employee's own request.
        .where('source', 'in', ['self', 'assistant', 'feishuCard'])
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
            source,
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

    async reviewProfileChange(ctx, id, decision, comment, values) {
      const policies = await authorizeAction(ctx.authz, CHANGE, 'review');
      const hrAdmin = await isHrAdmin(ctx);
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
        const proposed = parseJson<Record<string, unknown>>(row.changes, {});
        const fromAi = row.source === 'ai';
        // Suggestions may carry identity fields: only HR administrators decide them.
        if (fromAi && !hrAdmin) throw new HrError('FORBIDDEN', 403);
        let applied = proposed;
        if (decision === 'approve' && fromAi) {
          // Field by field: HR adopts some, edits others, leaves the rest.
          const chosen = values === undefined ? proposed : values;
          if (!isRecord(chosen) || !Object.keys(chosen).length)
            throw new HrError('PROFILE_AI_NOTHING_ADOPTED', 400);
          applied = {};
          for (const [key, value] of Object.entries(chosen)) {
            if (!(key in proposed))
              throw new HrError('PROFILE_CHANGE_FIELD_NOT_ALLOWED', 400, {
                field: key,
              });
            applied[key] = parseAiField(key, value);
          }
          await applyAiChanges(connection, employeeId, applied);
        } else if (decision === 'approve') {
          await applyProfileChanges(connection, employeeId, proposed);
        }
        await repo.updateOne({
          filter: { id, status: 'pending' },
          values: {
            status: decision === 'approve' ? 'approved' : 'rejected',
            reviewerUserId: ctx.userId,
            reviewedAt: now(),
            comment: comment?.trim() || null,
            // What was actually written, so adoption (as proposed, edited, discarded) can be told apart.
            ...(fromAi && decision === 'approve' ? { changes: applied } : {}),
            updatedAt: now(),
          },
        });
        const outcomeOf = (): 'adopted' | 'modified' | 'discarded' => {
          if (decision !== 'approve') return 'discarded';
          return JSON.stringify(applied) === JSON.stringify(proposed)
            ? 'adopted'
            : 'modified';
        };
        if (fromAi)
          await connection.query
            .updateTable('aiTaskRunItems')
            .set({
              outcome: outcomeOf(),
              outcomeByUserId: ctx.userId,
              outcomeAt: now(),
              updatedAt: now(),
            })
            .where('entityType', '=', 'profileChangeRequests')
            .where('entityId', '=', id)
            .execute();
        return { employeeId, fromAi };
      });
      if (outcome.fromAi) {
        // The employee did not ask for it: no message to them, only the record changes.
        return toChangeRequest(
          (await database
            .query()
            .selectFrom('profileChangeRequests')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst()) as Record<string, unknown>,
        );
      }
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
          'source',
          'attachmentFileId',
          'confidence',
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
          'source',
          'attachmentFileId',
          'confidence',
          'createdAt',
        ])
        .where('employeeId', '=', employee.id)
        .where('source', 'in', ['self', 'assistant', 'feishuCard'])
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
      const reminders = (await deps.settings.read('reminders')).value;
      const reminderDays = {
        probation: reminders.probationDays,
        contract: Math.max(...reminders.contractDays),
      };
      const to = filters.to ?? currentDate();
      const validReportDate = (value: string) => {
        if (!isDateOnly(value)) return false;
        const parsed = new Date(`${value}T00:00:00Z`);
        return (
          Number.isFinite(parsed.getTime()) &&
          parsed.toISOString().slice(0, 10) === value
        );
      };
      if (!validReportDate(to)) throw new HrError('INVALID_INPUT');
      const from = filters.from ?? addDays(to, -364);
      if (!validReportDate(from) || from > to)
        throw new HrError('INVALID_INPUT');
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
      const active = employees.filter(
        (e) => e.status !== 'leave' && e.status !== 'pending',
      );
      // Scope events to the already authorized employee set; a historical event
      // must never widen the caller's current employee visibility.
      const eventRows = employees.length
        ? await database
            .query()
            .selectFrom('jobEvents')
            .select(['employeeId', 'eventType', 'effectiveDate'])
            .where(
              'employeeId',
              'in',
              employees.map((e) => e.id),
            )
            .where('eventType', 'in', ['onboard', 'offboard'])
            .where('effectiveDate', '<=', to)
            .execute()
        : [];
      const events = eventRows.map((event) => ({
        employeeId: String(event.employeeId),
        type: String(event.eventType),
        date: toDateOnly(event.effectiveDate as string)!,
      }));
      const peopleInPeriod = (type: string, start: string, end: string) =>
        new Set(
          events
            .filter((e) => e.type === type && e.date >= start && e.date <= end)
            .map((e) => e.employeeId),
        ).size;
      const joined = peopleInPeriod('onboard', from, to);
      const left = peopleInPeriod('offboard', from, to);
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
          joined: peopleInPeriod(
            'onboard',
            `${month}-01`,
            month === to.slice(0, 7) ? to : `${month}-31`,
          ),
          left: peopleInPeriod(
            'offboard',
            `${month}-01`,
            month === to.slice(0, 7) ? to : `${month}-31`,
          ),
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
            daysBetween(currentDate(), e.probationEndDate) >= 0 &&
            daysBetween(currentDate(), e.probationEndDate) <=
              reminderDays.probation,
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
            Boolean(c.endDate) &&
            daysBetween(currentDate(), c.endDate!) >= 0 &&
            daysBetween(currentDate(), c.endDate!) <= reminderDays.contract,
        )
        .sort((a, b) => a.endDate.localeCompare(b.endDate));
      return {
        headcount: atEnd,
        reminderDays,
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
      // talent.jobEvent.view, scoped like the employee record (self, managed departments, all).
      const policies = await authorizeAction(
        ctx.authz,
        'talent.jobEvent',
        'view',
      );
      const rows = (await database
        .repository('jobEvents')
        .withPolicy(policyOf(policies, 'jobEvents'))
        .findMany({
          filter: { employeeId },
          sort: (s) => [
            s.field('effectiveDate').desc(),
            s.field('createdAt').desc(),
          ],
        })) as Record<string, unknown>[];
      if (!rows.length) {
        const employee = await loadEmployee(employeeId);
        if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      }
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
        source: r.source == null ? 'import' : str(r.source),
        note: r.note == null ? null : str(r.note),
      }));
    },

    hrAdministrators,
    holdersOf,

    async listJobEvents(ctx, filters, locale) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.jobEvent',
        'view',
      );
      const rows = (
        (await database
          .repository('jobEvents')
          .withPolicy(policyOf(policies, 'jobEvents'))
          .findMany({
            sort: (s) => [
              s.field('effectiveDate').desc(),
              s.field('createdAt').desc(),
            ],
          })) as Record<string, unknown>[]
      )
        .filter(
          (r) =>
            (!filters.eventType || r.eventType === filters.eventType) &&
            (!filters.source || (r.source ?? 'import') === filters.source),
        )
        .slice(0, 500);
      const scope = filters.departmentId
        ? new Set(await organization.descendantsOf(filters.departmentId))
        : null;
      const filtered = rows.filter((r) => {
        const date = toDateOnly(r.effectiveDate as string) ?? '';
        if (filters.from && date < filters.from) return false;
        if (filters.to && date > filters.to) return false;
        if (filters.failedOnly && (r.processedAt || !r.processError))
          return false;
        if (
          scope &&
          !scope.has(str(r.fromDepartmentId ?? '')) &&
          !scope.has(str(r.toDepartmentId ?? ''))
        )
          return false;
        return true;
      });
      const employees = new Map<string, string>();
      for (const id of new Set(filtered.map((r) => str(r.employeeId)))) {
        const e = await loadEmployee(id);
        if (e) employees.set(id, e.name);
      }
      const titles = await database
        .query()
        .selectFrom('positions')
        .select(['id', 'title'])
        .execute();
      const positionTitle = new Map(
        titles.map((p) => [str(p.id), str(p.title)]),
      );
      const departments = await organization.listTree();
      const departmentTitle = new Map(
        departments.map((d) => [d.id, organization.titleText(d.title, locale)]),
      );
      const title = (map: Map<string, string>, id: unknown) =>
        id == null ? null : (map.get(str(id)) ?? null);
      return {
        items: filtered.map((r) => ({
          id: str(r.id),
          employeeId: str(r.employeeId),
          employeeName: employees.get(str(r.employeeId)) ?? null,
          eventType: str(r.eventType),
          effectiveDate: toDateOnly(r.effectiveDate as string),
          fromDepartment: title(departmentTitle, r.fromDepartmentId),
          toDepartment: title(departmentTitle, r.toDepartmentId),
          fromPosition: title(positionTitle, r.fromPositionId),
          toPosition: title(positionTitle, r.toPositionId),
          source: r.source == null ? 'import' : str(r.source),
          actionId: r.actionId == null ? null : str(r.actionId),
          syncRunId: r.syncRunId == null ? null : str(r.syncRunId),
          note: r.note == null ? null : str(r.note),
          processedAt:
            r.processedAt == null
              ? null
              : new Date(str(r.processedAt)).toISOString(),
          processError: r.processError == null ? null : str(r.processError),
        })),
        can: { retry: await can(ctx, 'talent.jobEvent', 'retry') },
      };
    },

    async retryJobEvent(ctx, id) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.jobEvent',
        'retry',
      );
      const row = await database
        .repository('jobEvents')
        .withPolicy(policyOf(policies, 'jobEvents'))
        .findOne({ filter: { id } });
      if (!row) throw new HrError('JOB_EVENT_NOT_FOUND', 404);
      if (row.processedAt)
        throw new HrError('JOB_EVENT_ALREADY_PROCESSED', 409);
      await deps.jobEvents().process([id]);
      const after = await database
        .query()
        .selectFrom('jobEvents')
        .select(['id', 'processedAt', 'processError'])
        .where('id', '=', id)
        .executeTakeFirst();
      return {
        id,
        processedAt:
          after?.processedAt == null
            ? null
            : new Date(str(after.processedAt)).toISOString(),
        processError:
          after?.processError == null ? null : str(after.processError),
      };
    },

    async createAiSuggestion(ctx, input) {
      await authorizeAction(ctx.authz, 'talent.hrAssistant', 'extract');
      const policies = await authorizeAction(ctx.authz, CHANGE, 'review');
      const employee = await loadEmployee(input.employeeId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const changes: Record<string, unknown> = {};
      const confidence: Record<
        string,
        { confidence: number; snippet: string }
      > = {};
      const activeContract = await database
        .query()
        .selectFrom('employmentContracts')
        .select(['contractNo', 'startDate', 'endDate'])
        .where('employeeId', '=', employee.id)
        .where('status', '=', 'active')
        .executeTakeFirst();
      const educations = await database
        .query()
        .selectFrom('employeeEducations')
        .select(['school', 'degree'])
        .where('employeeId', '=', employee.id)
        .execute();
      for (const [key, proposal] of Object.entries(input.fields)) {
        let value: unknown;
        try {
          value = parseAiField(key, proposal.value);
        } catch {
          continue; // A field the model could not read cleanly is left out, not guessed.
        }
        // Only what differs from the record reaches HR.
        let same: boolean;
        if (key === 'education' && isRecord(value))
          same = educations.some(
            (e) =>
              str(e.school) === value.school && str(e.degree) === value.degree,
          );
        else if (key === 'contract' && isRecord(value))
          same =
            Boolean(activeContract) &&
            Object.entries(value).every(
              ([field, v]) =>
                (field === 'contractNo'
                  ? str(activeContract![field])
                  : toDateOnly(activeContract![field] as string | null)) === v,
            );
        else {
          const currentValue = employee[key as keyof EmployeeRecord];
          same =
            (key === 'birthDate'
              ? toDateOnly(currentValue as string | null)
              : currentValue) === value;
        }
        if (same) continue;
        changes[key] = value;
        confidence[key] = {
          confidence: Math.max(
            0,
            Math.min(1, Number(proposal.confidence) || 0),
          ),
          snippet: String(proposal.snippet ?? '').slice(0, 200),
        };
      }
      if (!Object.keys(changes).length) return null;
      const stamp = now();
      const id = newId();
      // The request is the assistant's, not a self-service one: written by the task
      // after the owner's extract and review permissions were checked above.
      void policies;
      await database
        .query()
        .insertInto('profileChangeRequests')
        .values({
          id,
          employeeId: employee.id,
          changes: JSON.stringify(changes),
          source: 'ai',
          attachmentFileId: input.attachmentFileId,
          confidence: JSON.stringify(confidence),
          status: 'pending',
          reviewerUserId: null,
          reviewedAt: null,
          comment: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return { id, fields: Object.keys(changes) };
    },

    async myHrProfile(ctx, locale) {
      await authorizeAction(ctx.authz, 'talent.hrAssistant', 'use');
      // Never an employee id from the caller: only the signed-in user's own record.
      const employee = await talent.employeeOfUser(ctx.userId);
      if (!employee) return { linked: false };
      const record = (await loadEmployee(employee.id))!;
      const contracts = await database
        .query()
        .selectFrom('employmentContracts')
        .select(['contractNo', 'type', 'startDate', 'endDate', 'status'])
        .where('employeeId', '=', employee.id)
        .orderBy('startDate', 'desc')
        .execute();
      const events = await service
        .myEvents(ctx, employee.id, locale)
        .catch(() => []);
      const department = await organization.getDepartment(record.departmentId);
      const position = record.positionId
        ? await database
            .query()
            .selectFrom('positions')
            .select(['title'])
            .where('id', '=', record.positionId)
            .executeTakeFirst()
        : undefined;
      return {
        linked: true,
        name: record.name,
        employeeNo: record.employeeNo,
        department: department
          ? organization.titleText(department.title, locale)
          : null,
        position: position ? str(position.title) : null,
        status: record.status,
        employmentType: record.employmentType,
        hireDate: toDateOnly(record.hireDate),
        probationEndDate: toDateOnly(record.probationEndDate),
        regularizedAt: toDateOnly(record.regularizedAt),
        contracts: contracts.map((c) => ({
          contractNo: str(c.contractNo),
          type: str(c.type),
          startDate: toDateOnly(c.startDate as string),
          endDate: toDateOnly(c.endDate as string | null),
          status: str(c.status),
        })),
        events: events.map((e) => ({
          eventType: e.eventType,
          effectiveDate: e.effectiveDate,
          toDepartment: e.toDepartment,
          toPosition: e.toPosition,
        })),
      };
    },

    async hrSummary(ctx, employeeId, locale) {
      // Everything here is read with the viewer's own permissions: a department head sees no contracts.
      const detail = await talent.getEmployee(ctx, employeeId);
      if (!detail) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const record = detail.employee;
      const visibleContracts = detail.can.viewContracts
        ? (await service.listContracts(ctx, { employeeId })).items.map((c) => ({
            contractNo: c.contractNo,
            type: c.type,
            startDate: c.startDate,
            endDate: c.endDate,
            status: c.status,
          }))
        : [];
      // A head holds contract access for their own contract only: nothing of this employee's is theirs to see.
      // null means "not for this viewer to see"; an HR administrator gets [] when there really is none.
      const contracts = visibleContracts.length
        ? visibleContracts
        : (await isHrAdmin(ctx))
          ? []
          : null;
      const events = await service
        .myEvents(ctx, employeeId, locale)
        .catch(() => []);
      const pendingActions = (
        await service
          .listActions(ctx, 'all')
          .catch(() => ({ items: [] as PersonnelAction[] }))
      ).items
        .filter(
          (a) =>
            a.employeeId === employeeId &&
            (a.status === 'pending' || a.status === 'approved'),
        )
        .map((a) => ({ type: a.actionType, status: a.status }));
      const toConfirm: string[] = [];
      if (record.status === 'probation') toConfirm.push('probationEvaluation');
      if (pendingActions.length) toConfirm.push('openActions');
      if (detail.can.viewProfile) {
        const profile = await service.getProfile(ctx, employeeId);
        if (!profile.educations.length) toConfirm.push('missingEducation');
        if (detail.can.viewContacts && !profile.emergencyContacts.length)
          toConfirm.push('missingEmergencyContact');
      }
      if (await isHrAdmin(ctx)) {
        const change = await database
          .query()
          .selectFrom('profileChangeRequests')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('status', '=', 'pending')
          .executeTakeFirst();
        if (change) toConfirm.push('pendingProfileChange');
      }
      const hireDate = toDateOnly(record.hireDate);
      return {
        name: record.name,
        employeeNo: record.employeeNo,
        department: detail.departmentTitle,
        position: detail.positionTitle,
        hireDate,
        tenureDays: hireDate ? daysBetween(hireDate, currentDate()) : null,
        probationEndDate: toDateOnly(record.probationEndDate),
        eventsDuringProbation: events
          .filter(
            (e) =>
              e.eventType !== 'onboard' &&
              hireDate &&
              String(e.effectiveDate) >= hireDate,
          )
          .map((e) => ({
            eventType: e.eventType,
            effectiveDate: e.effectiveDate,
            toPosition: e.toPosition,
          })),
        contracts,
        fixedTermContracts: contracts
          ? contracts.filter((c) => c.type === 'fixedTerm').length
          : null,
        pendingActions,
        toConfirm,
      };
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
        await afterEffect(effect);
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

import {
  RepositoryError,
  type DatabaseConnection,
  type DatabaseManager,
} from '@nocobase/db';
import { z } from 'zod';
import {
  authorizeAction,
  tryAuthorizeAction,
  policyOf,
  type CollectionPolicies,
} from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { AttendanceEngine } from './attendance-engine.js';
import type { OrganizationService } from './organization-service.js';
import type { Notify } from './platform.js';
import { planAttendanceApproval } from './attendance-approval.js';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
  decodeSetting,
} from './attendance-config.js';
import {
  readValues,
  type CustomFieldDefinition,
  type CustomFieldService,
} from './custom-fields.js';
import {
  calculateLeaveDuration,
  leaveRangeDates,
  zonedInstant,
} from './leave-duration.js';
import { shiftInterval } from './attendance-compute.js';
import { leaveBalanceAmounts } from './leave-policy.js';
import { HrError, addDays, newId, str } from './shared.js';
import { lockAttendanceSettings } from './attendance-settings.js';

const dateTime = z.iso.datetime({ local: true });
const requestInstant = z.iso.datetime({ offset: true });
const source = z.enum(['self', 'hrAssistant', 'hr']);
const writable = z
  .object({
    employeeId: z.string().min(1).max(64).optional(),
    leaveTypeId: z.string().min(1).max(64),
    startAt: requestInstant,
    endAt: requestInstant,
    reason: z.string().trim().max(1000).nullable().optional(),
    attachmentFileId: z.string().min(1).max(128).nullable().optional(),
    source: source.optional(),
    // 界面追加字段 (e.g. 工作交接人): validated against the definitions by the
    // custom-field service, which also rejects a non-object.
    customFields: z.unknown().optional(),
  })
  .strict();
const draftUpdate = writable.extend({ expectedUpdatedAt: dateTime });
const draftCreate = writable.extend({ clientRequestId: z.uuid().optional() });
const tracksBalance = (rule: unknown) =>
  rule === 'annualBySeniority' || rule === 'earned';
function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HrError('INVALID_INPUT', 400, {
      fields: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
  return parsed.data;
}

function json<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value) || (value && typeof value === 'object'))
    return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/** Stored custom values: null rather than an empty object. */
function storedValues(values: Record<string, unknown>) {
  return Object.keys(values).length ? values : null;
}

/** Order-independent comparison of two value objects (jsonb may reorder keys). */
function sameValues(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const canonical = (values: Record<string, unknown>) =>
    JSON.stringify(
      Object.entries(values)
        .filter(([, value]) => value != null)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  return canonical(left) === canonical(right);
}

function stampAfter(value: unknown): Date {
  const previous = value == null ? 0 : new Date(str(value)).getTime();
  return new Date(Math.max(Date.now(), previous + 1));
}

interface Approval {
  kind: string;
  approverUserId: string | null;
  departmentId: string | null;
  status: 'pending' | 'waiting' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  submittedBy?: string;
  /** 经飞书卡片: submitted or decided on an office-suite card. */
  submittedVia?: 'feishuCard';
  via?: 'feishuCard';
  leaveDates?: string[];
  balanceDays?: number;
  /** Earlier requests kept a restore snapshot; recalculation replaced it. */
  attendanceSnapshots?: unknown[];
}

function isCurrentApprover(
  row: Record<string, unknown>,
  userId: string,
  isHr: boolean,
): boolean {
  const approvals = json<Approval[]>(row.approvals, []);
  if (row.status !== 'pending' || approvals[0]?.submittedBy === userId)
    return false;
  const current = approvals.find((step) => step.status === 'pending');
  return Boolean(
    current &&
    (current.approverUserId
      ? current.approverUserId === userId
      : current.kind === 'hrAdmin' && isHr),
  );
}

export interface LeaveRequestServiceDeps {
  readonly database: DatabaseManager;
  readonly currentDate: () => string;
  readonly organization: OrganizationService;
  readonly timeZone: string;
  readonly engine: () => AttendanceEngine;
  /** Published cells an approved leave now blocks: notify the scheduler, ask for cover. */
  readonly onLeaveConflict?: () => (input: {
    requestId: string;
    scheduleIds: string[];
  }) => void;
  /**
   * V2-05 (realigned): the approver of each pending level is told (an 审批卡片
   * in Feishu through the push), and the employee when it is decided.
   */
  readonly notify?: Notify;
  /** hr.admin holders, for the hr.admin level. */
  readonly hrRecipients?: () => Promise<string[]>;
  /** 界面追加字段 on 请假单 (V2-05): definitions, validation and projection. */
  readonly customFields: () => CustomFieldService;
}

export function createLeaveRequestService(deps: LeaveRequestServiceDeps) {
  const { database, organization, timeZone, currentDate } = deps;
  const scoped = (
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    name: string,
  ) => connection.repository(name).withPolicy(policyOf(policies, name));
  const lock = (
    ctx: ActorContext,
    fn: (connection: DatabaseConnection) => Promise<unknown>,
  ) =>
    database.transaction(async (connection) => {
      // Request/approval grants intentionally keep personnelSettings read-only.
      // The internal catalog mutex serializes balance and request transitions;
      // it is not exposed as a configuration write to the caller.
      await lockAttendanceSettings(connection, ctx.userId);
      return fn(connection);
    });

  /**
   * The table's field definitions. Read outside `lock()` (or with its
   * connection): SQLite has one connection and would deadlock otherwise.
   */
  const fieldDefinitions = () => deps.customFields().list('leaveRequests');

  /**
   * Validates written values: only fields placed on the form are writable
   * (and required), whoever writes — the applicant or HR entering for them.
   */
  function prepareValues(
    definitions: readonly CustomFieldDefinition[],
    input: unknown,
    existing: Record<string, unknown>,
    options: { enforceRequired?: boolean },
  ): Record<string, unknown> {
    const service = deps.customFields();
    return service.prepare(
      service.visible(definitions, { sensitive: true, placement: 'form' }),
      input,
      existing,
      options,
    );
  }

  /**
   * The values a reader sees on a detail response: the detail placement, plus
   * the form placement for whoever may edit the draft. Sensitive fields only
   * for HR administrators and the applicant.
   */
  function projectValues(
    definitions: readonly CustomFieldDefinition[],
    row: Record<string, unknown>,
    options: { sensitive: boolean; editor: boolean },
  ): Record<string, unknown> {
    const service = deps.customFields();
    const read = (placement: 'detail' | 'form') =>
      service.project(definitions, row.customFields, {
        sensitive: options.sensitive,
        placement,
        includeInactive: true,
      });
    return options.editor
      ? { ...read('form'), ...read('detail') }
      : read('detail');
  }

  async function config(connection: DatabaseConnection) {
    const row = await connection
      .repository('personnelSettings')
      .findOne({ filter: { id: 'attendance.calendar' } });
    const configured = attendanceConfigSchemas.calendar.parse(
      decodeSetting(row?.value) ?? attendanceConfigDefaults.calendar,
    );
    const holidays = configured.years.flatMap((entry) => entry.holidays);
    const adjustedWorkdays = configured.years.flatMap(
      (entry) => entry.adjustedWorkdays,
    );
    return { holidays, adjustedWorkdays };
  }

  async function leaveUnits(connection: DatabaseConnection) {
    const row = await connection.query
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', 'attendance.leaveUnits')
      .executeTakeFirst();
    return attendanceConfigSchemas.leaveUnits.parse(
      json(row?.value, attendanceConfigDefaults.leaveUnits),
    );
  }

  async function leaveApprovalThreshold(connection: DatabaseConnection) {
    const row = await connection.repository('personnelSettings').findOne({
      filter: { id: 'attendance.limits' },
    });
    return attendanceConfigSchemas.limits.parse(
      decodeSetting(row?.value) ?? attendanceConfigDefaults.limits,
    ).leaveSecondLevelDays;
  }

  async function assertMonthsOpen(
    connection: DatabaseConnection,
    row: Record<string, unknown>,
    eligibleDates: readonly string[] = requestDates(row),
  ) {
    const months = [
      ...new Set(
        [
          ...leaveRangeDates(str(row.startAt), str(row.endAt), timeZone),
          ...eligibleDates,
        ].map((date) => date.slice(0, 7)),
      ),
    ];
    const locked = await connection.query
      .selectFrom('attendanceMonthlySummaries')
      .select(['id'])
      .where('employeeId', '=', str(row.employeeId))
      .where('status', '=', 'locked')
      .where('month', 'in', months)
      .executeTakeFirst();
    if (locked) throw new HrError('MONTH_LOCKED', 409);
  }

  function requestDates(row: Record<string, unknown>): string[] {
    // Freeze eligible dates at submission, so a later holiday/settings change
    // cannot expand approved leave into weekends or change cancellation dates.
    return (
      json<Approval[]>(row.approvals, [])[0]?.leaveDates ??
      leaveRangeDates(str(row.startAt), str(row.endAt), timeZone)
    );
  }

  async function employeeForUser(
    connection: DatabaseConnection,
    userId: string,
  ) {
    return connection.query
      .selectFrom('employees')
      .select([
        'id',
        'userId',
        'departmentId',
        'status',
        'hireDate',
        'leaveDate',
      ])
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  async function compute(
    connection: DatabaseConnection,
    row: {
      employeeId: string;
      leaveTypeId: string;
      startAt: string;
      endAt: string;
    },
  ) {
    const type = await connection.query
      .selectFrom('leaveTypes')
      .select([
        'id',
        'title',
        'unit',
        'countBy',
        'balanceRule',
        'fixedDays',
        'requiresAttachment',
        'active',
      ])
      .where('id', '=', row.leaveTypeId)
      .executeTakeFirst();
    if (!type || !type.active) throw new HrError('LEAVE_TYPE_NOT_FOUND', 404);
    const dates = leaveRangeDates(row.startAt, row.endAt, timeZone);
    const schedules =
      type.countBy === 'schedule'
        ? await connection.repository('shiftSchedules').findMany({
            filter: (f) =>
              f.and([
                f.string('employeeId').eq(row.employeeId),
                f.date('date').notBefore(addDays(dates[0], -1)),
                f.date('date').notAfter(dates[dates.length - 1]),
              ]),
          })
        : [];
    const shiftIds = [
      ...new Set(
        schedules.map((item) => str(item.shiftId ?? '')).filter(Boolean),
      ),
    ];
    const shifts = shiftIds.length
      ? await connection.repository('shifts').findMany({
          filter: (f) => f.or(shiftIds.map((id) => f.string('id').eq(id))),
        })
      : [];
    const shiftById = new Map(shifts.map((shift) => [str(shift.id), shift]));
    const result = calculateLeaveDuration({
      startAt: row.startAt,
      endAt: row.endAt,
      unit: String(type.unit) as 'day' | 'halfDay' | 'hour',
      countBy: String(type.countBy) as 'workdays' | 'schedule' | 'calendar',
      timeZone,
      calendar: await config(connection),
      units: await leaveUnits(connection),
      schedules: schedules.map((item) => {
        const shift = shiftById.get(str(item.shiftId ?? ''));
        return {
          date: str(item.date),
          shiftId: item.shiftId == null ? null : str(item.shiftId),
          shift: shift
            ? {
                startTime: str(shift.startTime),
                endTime: str(shift.endTime),
                breakMinutes: Number(shift.breakMinutes ?? 0),
              }
            : null,
        };
      }),
    });
    if (new Set(result.dates.map((date) => date.slice(0, 4))).size > 1)
      throw new HrError('CROSS_YEAR_REQUEST', 409);
    return { type, result };
  }

  async function assertAttachment(
    connection: DatabaseConnection,
    id: string | null | undefined,
    employeeId: string,
    userId: string,
    requestId?: string,
  ) {
    if (!id) return;
    const proof = await connection.repository('leaveProofFiles').findOne({
      filter: { id },
    });
    if (proof) {
      const references = await connection.repository('leaveRequests').findMany({
        filter: { attachmentFileId: id },
      });
      // Upload ownership cannot authorize moving a proof to another employee.
      // An authorized editor may retain the proof already bound to this draft.
      if (
        references.some((row) => row.employeeId !== employeeId) ||
        (proof.uploadedByUserId !== userId &&
          !references.some(
            (row) => row.id === requestId && row.employeeId === employeeId,
          ))
      )
        throw new HrError('ATTACHMENT_NOT_FOUND', 404);
      return;
    }
    const file = await connection.query
      .selectFrom('hrFiles')
      .select(['id'])
      .where('id', '=', id)
      .executeTakeFirst();
    // Preserve legacy personnel links; a guessed generic file is still invalid.
    const owned =
      file &&
      (await connection
        .repository('employeeAttachments')
        .findOne({ filter: { fileId: id, employeeId } }));
    if (!owned) throw new HrError('ATTACHMENT_NOT_FOUND', 404);
  }

  async function visibleProofRequest(ctx: ActorContext, id: string) {
    const isHr = Boolean(
      await tryAuthorizeAction(ctx.authz, 'talent.leaveRequest', 'manageTypes'),
    );
    const ownPolicies = await tryAuthorizeAction(
      ctx.authz,
      'talent.leaveRequest',
      'request',
    );
    if (ownPolicies) {
      const own = await database
        .repository('leaveRequests')
        .withPolicy(policyOf(ownPolicies, 'leaveRequests'))
        .findOne({ filter: { id } });
      if (
        own &&
        (isHr ||
          (await database.repository('employees').exists({
            filter: { id: str(own.employeeId), userId: ctx.userId },
          })))
      )
        return own;
    }
    const approvals = await tryAuthorizeAction(
      ctx.authz,
      'talent.leaveRequest',
      'approve',
    );
    if (approvals) {
      const row = await database
        .repository('leaveRequests')
        .withPolicy(policyOf(approvals, 'leaveRequests'))
        .findOne({ filter: { id } });
      if (
        row &&
        (isHr ||
          isCurrentApprover(row, ctx.userId, isHr) ||
          json<Approval[]>(row.approvals, []).some(
            (step) => step.decidedBy === ctx.userId,
          ))
      )
        return row;
    }
    return null;
  }

  async function requestPolicies(
    ctx: ActorContext,
    action: 'request' | 'approve',
  ) {
    return authorizeAction(ctx.authz, 'talent.leaveRequest', action);
  }

  function serialize(row: Record<string, unknown>) {
    // Custom values are projected per reader by the caller, never passed raw.
    const { customFields: _customFields, ...fields } = row;
    return {
      ...fields,
      // The Repository's datetime is host-local wall time; send actual
      // instants so browsers in another time zone do not reinterpret it.
      startAt: new Date(str(row.startAt)).toISOString(),
      endAt: new Date(str(row.endAt)).toISOString(),
      duration: Number(row.duration),
      approvals: json<Approval[]>(row.approvals, []).map((step) => {
        const { attendanceSnapshots: _snapshots, ...visible } = step;
        return visible;
      }),
    };
  }

  async function present(
    rows: Record<string, unknown>[],
    policies: CollectionPolicies,
  ) {
    if (!rows.length) return [];
    // Read labels under the same business action as the parent requests.
    // Do not expose personnel records or widen their scope for display.
    const employeeIds = [...new Set(rows.map((row) => str(row.employeeId)))];
    const typeIds = [...new Set(rows.map((row) => str(row.leaveTypeId)))];
    const [employees, types] = await Promise.all([
      database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({
          filter: (f) => f.or(employeeIds.map((id) => f.string('id').eq(id))),
          select: (s) => s.fields('id', 'name'),
        }),
      database
        .repository('leaveTypes')
        .withPolicy(policyOf(policies, 'leaveTypes'))
        .findMany({
          filter: (f) => f.or(typeIds.map((id) => f.string('id').eq(id))),
          select: (s) => s.fields('id', 'title', 'unit'),
        }),
    ]);
    const employeeNames = new Map(
      employees.map((row) => [str(row.id), str(row.name)]),
    );
    const leaveTypes = new Map(types.map((row) => [str(row.id), row]));
    return rows.map((row) => ({
      ...serialize(row),
      employeeName: employeeNames.get(str(row.employeeId)) ?? null,
      leaveTypeTitle: leaveTypes.get(str(row.leaveTypeId))?.title ?? null,
      leaveUnit: leaveTypes.get(str(row.leaveTypeId))?.unit ?? null,
    }));
  }

  async function loadBalances(
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    employeeId: string,
    leaveTypeId: string,
    dates: readonly string[],
  ) {
    const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
    const balances = [] as Record<string, unknown>[];
    for (const year of years) {
      const balance = await scoped(
        connection,
        policies,
        'leaveBalances',
      ).findOne({ filter: { employeeId, leaveTypeId, year } });
      if (balance) balances.push(balance);
    }
    return balances;
  }
  async function updateBalances(
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    balances: readonly Record<string, unknown>[],
    deltaPending: number,
    deltaUsed: number,
  ) {
    for (const balance of balances) {
      const amounts = leaveBalanceAmounts(
        balance as {
          entitled: unknown;
          carriedOver: unknown;
          used: unknown;
          pending: unknown;
          expiresAt?: unknown;
          adjustments?: unknown;
        },
        currentDate(),
      );
      const pending = Number(balance.pending) + deltaPending;
      const used = Number(balance.used) + deltaUsed;
      if (pending < 0 || used < 0)
        throw new HrError('BALANCE_STATE_INVALID', 409);
      if (deltaPending > 0 && amounts.available < deltaPending)
        throw new HrError('INSUFFICIENT_LEAVE_BALANCE', 409);
      try {
        await scoped(connection, policies, 'leaveBalances').updateOne({
          // Keep the read/modify/write atomic even when two submissions race.
          filter: {
            id: String(balance.id),
            pending: Number(balance.pending),
            used: Number(balance.used),
          },
          values: { pending, used, updatedAt: stampAfter(balance.updatedAt) },
        });
      } catch (error) {
        if (
          error instanceof RepositoryError &&
          error.code === 'RECORD_NOT_FOUND'
        )
          throw new HrError('BALANCE_CONFLICT', 409);
        throw error;
      }
    }
  }

  /**
   * 请假生效 / 撤销: the covered days are recalculated from the request's
   * current status (leave while approved), and every scheduled cell on those
   * days carries — or loses — this request's leaveConflict block. Returns the
   * published cells newly flagged, for the scheduler notice and the HR
   * assistant's cover suggestion.
   */
  async function applyAttendance(
    connection: DatabaseConnection,
    employeeId: string,
    requestId: string,
    dates: readonly string[],
    attach: boolean,
  ): Promise<string[]> {
    if (!dates.length) return [];
    const sorted = [...dates].sort();
    await deps.engine().recompute(connection, {
      employeeIds: [employeeId],
      from: sorted[0],
      to: sorted.at(-1)!,
    });
    const flagged: string[] = [];
    const rows = await connection.query
      .selectFrom('shiftSchedules')
      .select(['id', 'date', 'shiftId', 'status', 'checkResult'])
      .where('employeeId', '=', employeeId)
      .where('date', 'in', [...dates])
      .execute();
    for (const schedule of rows) {
      const checks = json<
        {
          rule?: string;
          level?: string;
          leaveRequestId?: string;
          message?: string;
        }[]
      >(schedule.checkResult, []);
      const filtered = checks.filter(
        (item) =>
          item.rule !== 'leaveConflict' || item.leaveRequestId !== requestId,
      );
      const conflict = attach && Boolean(schedule.shiftId);
      if (conflict)
        filtered.push({
          rule: 'leaveConflict',
          level: 'block',
          message: 'LEAVE_CONFLICT',
          leaveRequestId: requestId,
        });
      await connection.query
        .updateTable('shiftSchedules')
        .set({
          checkResult: filtered.length ? filtered : null,
          // The conflict is gone: so is the cover suggestion made for it.
          ...(attach ? {} : { replacementSuggestion: null }),
          updatedAt: new Date(),
        })
        .where('id', '=', str(schedule.id))
        .execute();
      if (conflict && schedule.status === 'published')
        flagged.push(str(schedule.id));
    }
    return flagged;
  }

  /** A pending leave's preflight flags on cells go when it does. */
  async function clearConflicts(
    connection: DatabaseConnection,
    employeeId: string,
    requestId: string,
    dates: readonly string[],
  ) {
    if (!dates.length) return;
    const rows = await connection.query
      .selectFrom('shiftSchedules')
      .select(['id', 'checkResult'])
      .where('employeeId', '=', employeeId)
      .where('date', 'in', [...dates])
      .execute();
    for (const row of rows) {
      const checks = json<{ rule?: string; leaveRequestId?: string }[]>(
        row.checkResult,
        [],
      );
      const kept = checks.filter(
        (c) => c.rule !== 'leaveConflict' || c.leaveRequestId !== requestId,
      );
      if (kept.length !== checks.length)
        await connection.query
          .updateTable('shiftSchedules')
          .set({
            checkResult: kept.length ? kept : null,
            replacementSuggestion: null,
          })
          .where('id', '=', str(row.id))
          .execute();
    }
  }

  /**
   * After a submit or decision (outside the transaction): the current level's
   * approvers get the to-do, or the employee the result.
   */
  async function notifyStep(id: string) {
    if (!deps.notify) return;
    const row = await database
      .query()
      .selectFrom('leaveRequests')
      .innerJoin('employees', 'employees.id', 'leaveRequests.employeeId')
      .innerJoin('leaveTypes', 'leaveTypes.id', 'leaveRequests.leaveTypeId')
      .select([
        'leaveRequests.status as status',
        'leaveRequests.approvals as approvals',
        'leaveRequests.startAt as startAt',
        'leaveRequests.endAt as endAt',
        'leaveRequests.duration as duration',
        'employees.name as name',
        'employees.userId as userId',
        'leaveTypes.title as typeTitle',
        'leaveTypes.unit as unit',
      ])
      .where('leaveRequests.id', '=', id)
      .executeTakeFirst();
    if (!row) return;
    const approvals = json<Approval[]>(row.approvals, []);
    const local = (value: unknown) =>
      new Intl.DateTimeFormat('en-CA', { timeZone }).format(
        new Date(str(value)),
      );
    const params = {
      name: str(row.name),
      leaveType: str(row.typeTitle),
      from: local(row.startAt),
      to: local(new Date(new Date(str(row.endAt)).getTime() - 1)),
      duration: String(Number(row.duration)),
      // i18next context: hourly leave is counted in hours, day and half-day leave in days.
      context: str(row.unit) === 'hour' ? 'hour' : 'day',
    };
    const status = str(row.status);
    if (status === 'pending') {
      const index = approvals.findIndex((step) => step.status === 'pending');
      const current = approvals[index];
      if (!current) return;
      const recipients = current.approverUserId
        ? [current.approverUserId]
        : ((await deps.hrRecipients?.()) ?? []);
      await deps.notify({
        key: `leave:${id}:level:${index + 1}`,
        userIds: recipients,
        message: 'leavePending',
        params,
        path: `/talent/approvals/leave/${id}?tab=leave`,
      });
    } else if ((status === 'approved' || status === 'rejected') && row.userId)
      await deps.notify({
        key: `leaveDecided:${id}`,
        userIds: [str(row.userId)],
        message: status === 'approved' ? 'leaveApproved' : 'leaveRejected',
        params,
        path: '/talent/me#attendance',
      });
  }

  /** The employee's published shifts inside a leave's range, for 与已发布排班冲突 hints. */
  async function publishedConflicts(
    employeeId: string,
    startAt: string,
    endAt: string,
  ) {
    const dates = leaveRangeDates(startAt, endAt, timeZone);
    if (!dates.length) return [];
    const cells = await database
      .query()
      .selectFrom('shiftSchedules')
      .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
      .select([
        'shiftSchedules.date as date',
        'shifts.title as title',
        'shifts.code as code',
        'shifts.startTime as startTime',
        'shifts.endTime as endTime',
      ])
      .where('shiftSchedules.employeeId', '=', employeeId)
      .where('shiftSchedules.status', '=', 'published')
      .where('shiftSchedules.date', 'in', dates)
      .orderBy('shiftSchedules.date', 'asc')
      .execute();
    return cells.map((cell) => ({
      date:
        cell.date instanceof Date
          ? cell.date.toISOString().slice(0, 10)
          : str(cell.date).slice(0, 10),
      shiftTitle: str(cell.title),
      shiftCode: str(cell.code),
      startTime: str(cell.startTime).slice(0, 5),
      endTime: str(cell.endTime).slice(0, 5),
    }));
  }

  /** What the balance moves by, in days (hour leave converts at submission). */
  function debitDays(row: Record<string, unknown>): number {
    const first = json<Approval[]>(row.approvals, [])[0];
    return first?.balanceDays ?? Number(row.duration);
  }

  /** See `wholeDayWindow`: the signed-in employee's, or the given employee's, whole days. */
  async function wholeDays(
    ctx: ActorContext,
    startAt: string,
    endAt: string,
    employeeId?: string,
  ): Promise<{ startAt: string; endAt: string }> {
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    const localDate = (instant: number) =>
      new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(instant));
    const first = localDate(start);
    const afterLast = localDate(end);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      zonedInstant(first, '00:00', timeZone) !== start ||
      zonedInstant(afterLast, '00:00', timeZone) !== end
    )
      return { startAt, endAt };
    const last = addDays(afterLast, -1);
    const own = employeeId
      ? { id: employeeId }
      : await database
          .query()
          .selectFrom('employees')
          .select(['id'])
          .where('userId', '=', ctx.userId)
          .executeTakeFirst();
    if (!own) return { startAt, endAt };
    const cells = await database
      .query()
      .selectFrom('shiftSchedules')
      .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
      .select([
        'shiftSchedules.date as date',
        'shifts.startTime as startTime',
        'shifts.endTime as endTime',
      ])
      .where('shiftSchedules.employeeId', '=', str(own.id))
      .where('shiftSchedules.status', '=', 'published')
      .where('shiftSchedules.date', '>=', addDays(first, -1))
      .where('shiftSchedules.date', '<=', last)
      .execute();
    const window = (date: string) => {
      const cell = cells.find(
        (c) =>
          (c.date instanceof Date
            ? c.date.toISOString().slice(0, 10)
            : str(c.date).slice(0, 10)) === date,
      );
      return cell
        ? shiftInterval(
            date,
            {
              startTime: str(cell.startTime).slice(0, 5),
              endTime: str(cell.endTime).slice(0, 5),
            },
            timeZone,
          )
        : null;
    };
    const firstShift = window(first);
    const previous = window(addDays(first, -1));
    const lastShift = window(last);
    const from = firstShift
      ? firstShift.start
      : Math.max(start, previous?.end ?? start);
    const to = lastShift ? Math.max(lastShift.end, from + 1) : end;
    if (to <= from) return { startAt, endAt };
    return {
      startAt: new Date(from).toISOString(),
      endAt: new Date(to).toISOString(),
    };
  }

  async function snapWholeDays<
    T extends { startAt: string; endAt: string; employeeId?: string },
  >(ctx: ActorContext, body: T, employeeId: string | undefined): Promise<T> {
    const range = await wholeDays(
      ctx,
      body.startAt,
      body.endAt,
      employeeId ?? body.employeeId,
    );
    return { ...body, ...range };
  }

  return {
    /** 与本人已发布排班的冲突 of a leave the user may read (their own draft, or one they approve). */
    /**
     * Whole days as the signed-in employee works them (V2-05: a cross-midnight
     * shift belongs to its start date). A range from local midnight to local
     * midnight becomes the first day's shift start to the last day's shift
     * end; an unscheduled first day still starts after the previous night
     * shift ends. Any other range is returned unchanged.
     */
    async wholeDayWindow(
      ctx: ActorContext,
      startAt: string,
      endAt: string,
      employeeId?: string,
    ): Promise<{ startAt: string; endAt: string }> {
      return wholeDays(ctx, startAt, endAt, employeeId);
    },
    async scheduleConflicts(ctx: ActorContext, id: string) {
      const row = (await this.get(ctx, id)) as unknown as Record<
        string,
        unknown
      >;
      return publishedConflicts(
        str(row.employeeId),
        str(row.startAt),
        str(row.endAt),
      );
    },
    async canReadProof(ctx: ActorContext, fileId: string): Promise<boolean> {
      const file = await database
        .repository('leaveProofFiles')
        .findOne({ filter: { id: fileId } });
      if (!file) return false;
      let linked = false;
      // Internal link lookup only: no proof data is returned until a parent
      // business policy and applicant/actual approver/HR eligibility both pass.
      for await (const row of database
        .repository('leaveRequests')
        .findMany({ filter: { attachmentFileId: fileId } })) {
        linked = true;
        if (await visibleProofRequest(ctx, str(row.id))) return true;
      }
      return (
        !linked &&
        file.uploadedByUserId === ctx.userId &&
        Boolean(
          await tryAuthorizeAction(ctx.authz, 'talent.leaveRequest', 'request'),
        )
      );
    },
    async proof(ctx: ActorContext, requestId: string) {
      const row = await visibleProofRequest(ctx, requestId);
      if (!row) throw new HrError('NOT_FOUND', 404);
      if (!row.attachmentFileId) return null;
      const proof = await database.repository('leaveProofFiles').findOne({
        filter: { id: str(row.attachmentFileId) },
        select: (s) =>
          s.fields(
            'id',
            'ext',
            'filename',
            'mimeType',
            'size',
            'createdAt',
            'updatedAt',
          ),
      });
      if (!proof) throw new HrError('ATTACHMENT_NOT_FOUND', 404);
      return proof;
    },
    async listTypes(ctx: ActorContext) {
      const policies = await requestPolicies(ctx, 'request');
      const rows = await database
        .repository('leaveTypes')
        .withPolicy(policyOf(policies, 'leaveTypes'))
        .findMany({
          filter: { active: true },
          sort: (s) => s.field('code').asc(),
          limit: 501,
        });
      return {
        data: rows.slice(0, 500),
        meta: { limit: 500, truncated: rows.length > 500 },
      };
    },
    async myBalances(ctx: ActorContext, query: unknown) {
      const policies = await requestPolicies(ctx, 'request');
      const parameters = parseInput(
        z
          .object({
            year: z.coerce.number().int().min(1900).max(2200).optional(),
            refresh: z.string().max(128).optional(),
            revision: z.coerce.number().int().min(0).optional(),
          })
          .strict(),
        query,
      );
      const asOf = currentDate();
      const year = parameters.year ?? Number(asOf.slice(0, 4));
      const employee = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findOne({
          filter: { userId: ctx.userId },
          select: (s) => s.fields('id', 'status'),
        });
      if (!employee) throw new HrError('NOT_FOUND', 404);
      const rows = await database
        .repository('leaveBalances')
        .withPolicy(policyOf(policies, 'leaveBalances'))
        .findMany({
          filter: { employeeId: str(employee.id), year },
          sort: (s) => s.field('leaveTypeId').asc(),
          limit: 501,
        });
      if (rows.length > 500) throw new HrError('SCOPE_TOO_LARGE', 409);
      const typeIds = [...new Set(rows.map((row) => str(row.leaveTypeId)))];
      const types = typeIds.length
        ? await database
            .repository('leaveTypes')
            .withPolicy(policyOf(policies, 'leaveTypes'))
            .findMany({
              filter: (f) => f.or(typeIds.map((id) => f.string('id').eq(id))),
              select: (s) => s.fields('id', 'title'),
            })
        : [];
      const names = new Map(types.map((row) => [str(row.id), str(row.title)]));
      return {
        year,
        frozen: employee.status === 'leave',
        items: rows.map((row) => {
          const amounts = {
            entitled: row.entitled,
            carriedOver: row.carriedOver,
            used: row.used,
            pending: row.pending,
            expiresAt: row.expiresAt,
            adjustments:
              row.adjustments == null
                ? []
                : json<unknown>(row.adjustments, 'INVALID'),
          };
          // Reuse the ledger calculation; do not return the HR adjustment
          // reasons, operator identities or timestamps to the self-service UI.
          return {
            id: str(row.id),
            leaveTypeTitle: names.get(str(row.leaveTypeId)) ?? null,
            ...leaveBalanceAmounts(amounts, asOf),
          };
        }),
      };
    },
    async listEntryEmployees(ctx: ActorContext) {
      const policies = await requestPolicies(ctx, 'request');
      await authorizeAction(ctx.authz, 'talent.leaveRequest', 'manageTypes');
      // V2-05: HR entry is for employees without a login account only. Keep
      // the request action's row scope and return only selector labels.
      const rows = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({
          filter: { userId: null },
          select: (s) => s.fields('id', 'employeeNo', 'name'),
          sort: (s) => s.field('employeeNo').asc(),
          limit: 501,
        });
      return {
        data: rows.slice(0, 500),
        meta: { limit: 500, truncated: rows.length > 500 },
      };
    },
    async get(ctx: ActorContext, id: string) {
      const ownPolicies = await tryAuthorizeAction(
        ctx.authz,
        'talent.leaveRequest',
        'request',
      );
      const own = ownPolicies
        ? await database
            .repository('leaveRequests')
            .withPolicy(policyOf(ownPolicies, 'leaveRequests'))
            .findOne({ filter: { id } })
        : undefined;
      const approvals = await tryAuthorizeAction(
        ctx.authz,
        'talent.leaveRequest',
        'approve',
      );
      const approvalRow = approvals
        ? await database
            .repository('leaveRequests')
            .withPolicy(policyOf(approvals, 'leaveRequests'))
            .findOne({ filter: { id } })
        : undefined;
      const hrPolicies = await tryAuthorizeAction(
        ctx.authz,
        'talent.leaveRequest',
        'manageTypes',
      );
      const isHr = Boolean(approvals && hrPolicies);
      const visibleApproval =
        approvalRow &&
        (isHr ||
          isCurrentApprover(approvalRow, ctx.userId, isHr) ||
          json<Approval[]>(approvalRow.approvals, []).some(
            (step) => step.decidedBy === ctx.userId,
          ));
      const row = own ?? (visibleApproval ? approvalRow : undefined);
      const policies = own ? ownPolicies : approvals;
      if (row && policies) {
        const employee = await employeeForUser(
          database.connection(),
          ctx.userId,
        );
        const entryEmployee =
          own && ownPolicies && hrPolicies && row.source === 'hr'
            ? await database
                .repository('employees')
                .withPolicy(policyOf(ownPolicies, 'employees'))
                .findOne({
                  filter: { id: str(row.employeeId) },
                  select: (s) => s.fields('id', 'userId'),
                })
            : undefined;
        const isOwnRequest = Boolean(own && row.employeeId === employee?.id);
        const canEditHr = Boolean(
          entryEmployee && !entryEmployee.userId && row.status === 'draft',
        );
        return {
          ...(await present([row], policies))[0],
          customFields: projectValues(await fieldDefinitions(), row, {
            sensitive: Boolean(hrPolicies) || isOwnRequest,
            editor: isOwnRequest || canEditHr,
          }),
          // Hints for UI visibility only; mutations independently authorize
          // their action, row scope, identity, state and expected version.
          isOwnRequest,
          canEditHr,
          canCancel: Boolean(
            own &&
            row.employeeId === employee?.id &&
            ['pending', 'approved'].includes(str(row.status)),
          ),
          canEdit: Boolean(
            own &&
            row.status === 'draft' &&
            row.employeeId === employee?.id &&
            ['self', 'hrAssistant'].includes(str(row.source)),
          ),
          canApprove: Boolean(
            approvalRow &&
            row.employeeId !== employee?.id &&
            isCurrentApprover(approvalRow, ctx.userId, isHr),
          ),
        };
      }
      throw new HrError(
        ownPolicies || approvals ? 'NOT_FOUND' : 'FORBIDDEN',
        ownPolicies || approvals ? 404 : 403,
      );
    },
    async list(
      ctx: ActorContext,
      query: Record<string, string | undefined>,
      approvalsOnly = false,
    ) {
      const policies = await requestPolicies(
        ctx,
        approvalsOnly ? 'approve' : 'request',
      );
      const hasHr = Boolean(
        await tryAuthorizeAction(
          ctx.authz,
          'talent.leaveRequest',
          'manageTypes',
        ),
      );
      const isHr = approvalsOnly && hasHr;
      const ownEmployee = await employeeForUser(
        database.connection(),
        ctx.userId,
      );
      const filter: Record<string, unknown> = {};
      if (query.source !== undefined) {
        filter.source = parseInput(source, query.source);
        if (filter.source === 'hr')
          await authorizeAction(
            ctx.authz,
            'talent.leaveRequest',
            'manageTypes',
          );
      }
      if (query.status) filter.status = query.status;
      if (query.employeeId) filter.employeeId = query.employeeId;
      const rows: Record<string, unknown>[] = [];
      const candidates = database
        .repository('leaveRequests')
        .withPolicy(policyOf(policies, 'leaveRequests'))
        .findMany({
          filter: filter as never,
          sort: (s) => s.field('createdAt').desc(),
          ...(approvalsOnly ? {} : { limit: 501 }),
        });
      // Apply current-step eligibility before the result cap, without exposing
      // another manager's draft or HR's not-yet-current second-level task.
      for await (const row of candidates) {
        if (
          approvalsOnly &&
          (row.employeeId === ownEmployee?.id ||
            !isCurrentApprover(row, ctx.userId, isHr))
        )
          continue;
        rows.push(row);
        if (rows.length > 500) break;
      }
      const kept = rows.slice(0, 500);
      const definitions = kept.length ? await fieldDefinitions() : [];
      const presented = await present(kept, policies);
      return {
        data: presented.map((item, index) => ({
          ...item,
          customFields: projectValues(definitions, kept[index], {
            sensitive:
              hasHr ||
              Boolean(ownEmployee && kept[index].employeeId === ownEmployee.id),
            editor: false,
          }),
        })),
        meta: { limit: 500, truncated: rows.length > 500 },
      };
    },
    async createDraft(ctx: ActorContext, input: unknown) {
      const policies = await requestPolicies(ctx, 'request');
      // Whole days (local midnight to midnight) become the shifts worked on them, as in the AI assistant's
      // draft: a night shift is one day, not the hours that fall inside the calendar day. Read before the
      // SQLite transaction, which holds the only connection.
      const body = await snapWholeDays(
        ctx,
        parseInput(draftCreate, input),
        undefined,
      );
      // Authorization may load collection metadata from the manager connection.
      // Resolve it before entering the single-connection SQLite transaction.
      if (body.source === 'hr')
        await authorizeAction(ctx.authz, 'talent.leaveRequest', 'manageTypes');
      // Definitions are read before the transaction (SQLite: one connection).
      // A draft may be incomplete: required fields are enforced on submit.
      const definitions = await fieldDefinitions();
      const values = prepareValues(definitions, body.customFields, {}, {});
      return lock(ctx, async (connection) => {
        const own = await employeeForUser(connection, ctx.userId);
        const employeeId =
          body.employeeId ?? (own ? String(own.id) : undefined);
        if (!employeeId) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
        const employee = await scoped(
          connection,
          policies,
          'employees',
        ).findOne({ filter: { id: employeeId } });
        if (!employee) throw new HrError('NOT_FOUND', 404);
        const requestedSource = body.source ?? 'self';
        if (requestedSource === 'hr') {
          if (employee.userId)
            throw new HrError('HR_ENTRY_REQUIRES_NO_ACCOUNT', 409);
        } else if (ctx.userId !== str(employee.userId ?? '')) {
          throw new HrError('FORBIDDEN', 403);
        }
        // A form keeps this UUID across network retries. The primary key and
        // catalog transaction lock prevent concurrent requests creating twice.
        // A reused key is never permission to overwrite another request.
        if (body.clientRequestId) {
          const existing = await scoped(
            connection,
            policies,
            'leaveRequests',
          ).findOne({ filter: { id: body.clientRequestId } });
          if (existing) {
            if (
              existing.employeeId !== employeeId ||
              existing.leaveTypeId !== body.leaveTypeId ||
              new Date(str(existing.startAt)).getTime() !==
                new Date(body.startAt).getTime() ||
              new Date(str(existing.endAt)).getTime() !==
                new Date(body.endAt).getTime() ||
              (existing.reason ?? null) !== (body.reason ?? null) ||
              (existing.attachmentFileId ?? null) !==
                (body.attachmentFileId ?? null) ||
              existing.source !== requestedSource ||
              !sameValues(readValues(existing.customFields), values)
            )
              throw new HrError('IDEMPOTENCY_CONFLICT', 409);
            return {
              ...serialize(existing),
              customFields: projectValues(definitions, existing, {
                sensitive: true,
                editor: true,
              }),
            };
          }
          if (
            await connection
              .repository('leaveRequests')
              .exists({ filter: { id: body.clientRequestId } })
          )
            throw new HrError('IDEMPOTENCY_CONFLICT', 409);
        }
        const { type, result } = await compute(connection, {
          employeeId,
          leaveTypeId: body.leaveTypeId,
          startAt: body.startAt,
          endAt: body.endAt,
        });
        await assertAttachment(
          connection,
          body.attachmentFileId,
          employeeId,
          ctx.userId,
        );
        const now = new Date();
        const created = await scoped(
          connection,
          policies,
          'leaveRequests',
        ).createOne({
          values: {
            id: body.clientRequestId ?? newId(),
            employeeId,
            leaveTypeId: body.leaveTypeId,
            startAt: body.startAt,
            endAt: body.endAt,
            duration: result.duration,
            reason: body.reason ?? null,
            attachmentFileId: body.attachmentFileId ?? null,
            status: 'draft',
            approvals: null,
            source: requestedSource,
            customFields: storedValues(values),
            createdAt: now,
            updatedAt: now,
          },
        });
        return {
          ...serialize(created.record),
          // The writer is the applicant or HR entering for them.
          customFields: projectValues(definitions, created.record, {
            sensitive: true,
            editor: true,
          }),
          estimatedAvailable: type.balanceRule === 'none' ? null : undefined,
        };
      });
    },
    async updateDraft(ctx: ActorContext, id: string, input: unknown) {
      const policies = await requestPolicies(ctx, 'request');
      const parsed = parseInput(draftUpdate, input);
      const owner = await database
        .query()
        .selectFrom('leaveRequests')
        .select(['employeeId'])
        .where('id', '=', id)
        .executeTakeFirst();
      // The draft's own employee: the rule is checked again inside the transaction.
      const body = await snapWholeDays(
        ctx,
        parsed,
        parsed.employeeId ?? (owner ? str(owner.employeeId) : undefined),
      );
      const hrPolicies = await tryAuthorizeAction(
        ctx.authz,
        'talent.leaveRequest',
        'manageTypes',
      );
      const definitions = await fieldDefinitions();
      return lock(ctx, async (connection) => {
        const repo = scoped(connection, policies, 'leaveRequests');
        const previous = await repo.findOne({ filter: { id } });
        if (!previous) throw new HrError('NOT_FOUND', 404);
        if (previous.status !== 'draft')
          throw new HrError('REQUEST_STATE_CONFLICT', 409);
        if (str(previous.updatedAt) !== body.expectedUpdatedAt)
          throw new HrError('CONFLICT', 409);
        const employeeId = body.employeeId ?? str(previous.employeeId);
        if (employeeId !== str(previous.employeeId))
          throw new HrError('FORBIDDEN', 403);
        if (body.source && body.source !== previous.source)
          throw new HrError('FORBIDDEN', 403);
        const employee = await scoped(
          connection,
          policies,
          'employees',
        ).findOne({ filter: { id: employeeId } });
        if (!employee) throw new HrError('NOT_FOUND', 404);
        if (previous.source === 'hr') {
          if (!hrPolicies) throw new HrError('FORBIDDEN', 403);
          if (employee.userId)
            throw new HrError('HR_ENTRY_REQUIRES_NO_ACCOUNT', 409);
        } else if (str(employee.userId ?? '') !== ctx.userId) {
          throw new HrError('FORBIDDEN', 403);
        }
        const { result } = await compute(connection, {
          employeeId,
          leaveTypeId: body.leaveTypeId,
          startAt: body.startAt,
          endAt: body.endAt,
        });
        await assertAttachment(
          connection,
          body.attachmentFileId,
          employeeId,
          ctx.userId,
          id,
        );
        // Omitted customFields keep the stored values; drafts may be incomplete.
        const values = prepareValues(
          definitions,
          body.customFields,
          readValues(previous.customFields),
          {},
        );
        const updated = await repo.updateOne({
          filter: { id },
          values: {
            employeeId,
            leaveTypeId: body.leaveTypeId,
            startAt: body.startAt,
            endAt: body.endAt,
            duration: result.duration,
            reason: body.reason ?? null,
            attachmentFileId: body.attachmentFileId ?? null,
            customFields: storedValues(values),
            updatedAt: stampAfter(previous.updatedAt),
          },
        });
        return {
          ...serialize(updated.record),
          customFields: projectValues(definitions, updated.record, {
            sensitive: true,
            editor: true,
          }),
        };
      });
    },
    async submit(
      ctx: ActorContext,
      id: string,
      input: unknown,
      via?: 'feishuCard',
    ) {
      const policies = await requestPolicies(ctx, 'request');
      const hrPolicies = await tryAuthorizeAction(
        ctx.authz,
        'talent.leaveRequest',
        'manageTypes',
      );
      const { expectedUpdatedAt, customFields } = parseInput(
        z
          .object({
            expectedUpdatedAt: dateTime,
            // Optional last-moment values; the stored ones are re-validated either way.
            customFields: z.unknown().optional(),
          })
          .strict(),
        input,
      );
      const definitions = await fieldDefinitions();
      const submitted = await lock(ctx, async (connection) => {
        const repo = scoped(connection, policies, 'leaveRequests');
        const row = await repo.findOne({ filter: { id } });
        if (!row) throw new HrError('NOT_FOUND', 404);
        if (row.status !== 'draft')
          throw new HrError('REQUEST_STATE_CONFLICT', 409);
        if (str(row.updatedAt) !== expectedUpdatedAt)
          throw new HrError('CONFLICT', 409);
        const employee = await scoped(
          connection,
          policies,
          'employees',
        ).findOne({ filter: { id: str(row.employeeId) } });
        if (str(row.source) === 'hr') {
          if (!hrPolicies) throw new HrError('FORBIDDEN', 403);
          if (employee?.userId)
            throw new HrError('HR_ENTRY_REQUIRES_NO_ACCOUNT', 409);
        } else if (
          !employee ||
          !employee.userId ||
          str(employee.userId) !== ctx.userId
        ) {
          throw new HrError('ONLY_EMPLOYEE_MAY_SUBMIT', 403);
        }
        // Required added fields (e.g. 工作交接人) must be filled to submit.
        // `{}` rather than undefined: prepare() skips every check for undefined.
        const values = prepareValues(
          definitions,
          customFields ?? {},
          readValues(row.customFields),
          { enforceRequired: true },
        );
        const { type, result } = await compute(connection, {
          employeeId: str(row.employeeId),
          leaveTypeId: str(row.leaveTypeId),
          startAt: str(row.startAt),
          endAt: str(row.endAt),
        });
        if (type.requiresAttachment && !row.attachmentFileId)
          throw new HrError('ATTACHMENT_REQUIRED', 400);
        await assertAttachment(
          connection,
          row.attachmentFileId == null ? null : str(row.attachmentFileId),
          str(row.employeeId),
          ctx.userId,
          id,
        );
        if (
          type.balanceRule === 'fixedPerEvent' &&
          result.balanceDays > Number(type.fixedDays)
        )
          throw new HrError('FIXED_LEAVE_LIMIT', 409);
        await assertMonthsOpen(connection, row, result.dates);
        const overlap = await repo.findMany({
          filter: { employeeId: str(row.employeeId) },
        });
        if (
          overlap.some(
            (item) =>
              str(item.id) !== id &&
              ['pending', 'approved'].includes(str(item.status)) &&
              new Date(str(item.startAt)).getTime() <
                new Date(str(row.endAt)).getTime() &&
              new Date(str(item.endAt)).getTime() >
                new Date(str(row.startAt)).getTime(),
          )
        )
          throw new HrError('LEAVE_OVERLAP', 409);
        const balances = !tracksBalance(type.balanceRule)
          ? []
          : await loadBalances(
              connection,
              policies,
              str(row.employeeId),
              str(row.leaveTypeId),
              result.dates,
            );
        if (tracksBalance(type.balanceRule) && !balances.length)
          throw new HrError('BALANCE_NOT_INITIALIZED', 409);
        if (balances.length)
          await updateBalances(
            connection,
            policies,
            balances,
            result.balanceDays,
            0,
          );
        const departments = await organization.listTree(connection);
        if (!employee) throw new HrError('NOT_FOUND', 404);
        const steps = planAttendanceApproval({
          type: 'leave',
          employeeUserId: employee?.userId ? str(employee.userId) : null,
          submittedBy: ctx.userId,
          departmentId: str(employee.departmentId),
          departments,
          leaveDays: result.balanceDays,
          leaveBalanceRule: str(type.balanceRule) as never,
          leaveSecondLevelDays: await leaveApprovalThreshold(connection),
          monthlyOvertimeAlertHours: 36,
        });
        const approvals = steps.map((step, index) => ({
          level: index + 1,
          ...step,
          decidedBy: null,
          decidedAt: null,
          comment: null,
          ...(index === 0
            ? {
                submittedBy: ctx.userId,
                ...(via ? { submittedVia: via } : {}),
                leaveDates: [...result.dates],
                balanceDays: result.balanceDays,
              }
            : {}),
        }));
        const updated = await repo.updateOne({
          filter: { id },
          values: {
            duration: result.duration,
            status: 'pending',
            approvals,
            customFields: storedValues(values),
            updatedAt: stampAfter(row.updatedAt),
          },
        });
        return {
          ...serialize(updated.record),
          customFields: projectValues(definitions, updated.record, {
            sensitive: true,
            editor: true,
          }),
        };
      });
      await notifyStep(id);
      return submitted;
    },
    async decide(
      ctx: ActorContext,
      id: string,
      input: unknown,
      via?: 'feishuCard',
    ) {
      const policies = await requestPolicies(ctx, 'approve');
      const hrPolicies = await tryAuthorizeAction(
        ctx.authz,
        'talent.leaveRequest',
        'manageTypes',
      );
      const body = parseInput(
        z
          .object({
            decision: z.enum(['approved', 'rejected']),
            comment: z.string().trim().max(1000).nullable().optional(),
            expectedUpdatedAt: dateTime,
          })
          .strict(),
        input,
      );
      let flagged: string[] = [];
      const outcome = await lock(ctx, async (connection) => {
        const repo = scoped(connection, policies, 'leaveRequests');
        const row = await repo.findOne({ filter: { id } });
        if (!row) throw new HrError('NOT_FOUND', 404);
        if (row.status !== 'pending')
          throw new HrError('REQUEST_STATE_CONFLICT', 409);
        if (str(row.updatedAt) !== body.expectedUpdatedAt)
          throw new HrError('CONFLICT', 409);
        const approvals = json<Approval[]>(row.approvals, []);
        const index = approvals.findIndex((step) => step.status === 'pending');
        if (index < 0) throw new HrError('REQUEST_STATE_CONFLICT', 409);
        const current = approvals[index];
        if (current.approverUserId && current.approverUserId !== ctx.userId)
          throw new HrError('NOT_CURRENT_APPROVER', 403);
        if (!current.approverUserId) {
          if (!hrPolicies) throw new HrError('NOT_CURRENT_APPROVER', 403);
        }
        const employee = await connection.query
          .selectFrom('employees')
          .select(['userId'])
          .where('id', '=', str(row.employeeId))
          .executeTakeFirst();
        if (
          (employee?.userId && str(employee.userId) === ctx.userId) ||
          approvals[0]?.submittedBy === ctx.userId
        )
          throw new HrError('SELF_APPROVAL_FORBIDDEN', 403);
        await assertMonthsOpen(connection, row);
        approvals[index] = {
          ...current,
          status: body.decision,
          decidedBy: ctx.userId,
          decidedAt: new Date().toISOString(),
          comment: body.comment ?? null,
          ...(via ? { via } : {}),
        };
        const dates = requestDates(row);
        const type = await connection.query
          .selectFrom('leaveTypes')
          .select(['balanceRule', 'unit'])
          .where('id', '=', str(row.leaveTypeId))
          .executeTakeFirst();
        const balances = !tracksBalance(type?.balanceRule)
          ? []
          : await loadBalances(
              connection,
              policies,
              str(row.employeeId),
              str(row.leaveTypeId),
              dates,
            );
        if (body.decision === 'rejected') {
          if (balances.length)
            await updateBalances(
              connection,
              policies,
              balances,
              -debitDays(row),
              0,
            );
          const updated = await repo.updateOne({
            filter: { id },
            values: {
              status: 'rejected',
              approvals,
              updatedAt: stampAfter(row.updatedAt),
            },
          });
          return serialize(updated.record);
        }
        const next = approvals.findIndex(
          (step, i) => i > index && step.status === 'waiting',
        );
        if (next >= 0)
          approvals[next] = { ...approvals[next], status: 'pending' };
        const final = next < 0;
        if (final && balances.length)
          await updateBalances(
            connection,
            policies,
            balances,
            -debitDays(row),
            debitDays(row),
          );
        const updated = await repo.updateOne({
          filter: { id },
          values: {
            status: final ? 'approved' : 'pending',
            approvals,
            updatedAt: stampAfter(row.updatedAt),
          },
        });
        // After the status: recalculation reads approved leave from the request.
        if (final)
          flagged = await applyAttendance(
            connection,
            str(row.employeeId),
            id,
            dates,
            true,
          );
        return serialize(updated.record);
      });
      if (flagged.length)
        deps.onLeaveConflict?.()({ requestId: id, scheduleIds: flagged });
      await notifyStep(id);
      return outcome;
    },
    async cancel(ctx: ActorContext, id: string, input: unknown) {
      const policies = await requestPolicies(ctx, 'request');
      const { expectedUpdatedAt } = parseInput(
        z.object({ expectedUpdatedAt: dateTime }).strict(),
        input,
      );
      return lock(ctx, async (connection) => {
        const repo = scoped(connection, policies, 'leaveRequests');
        const row = await repo.findOne({ filter: { id } });
        if (!row) throw new HrError('NOT_FOUND', 404);
        if (!['pending', 'approved'].includes(str(row.status)))
          throw new HrError('REQUEST_STATE_CONFLICT', 409);
        if (str(row.updatedAt) !== expectedUpdatedAt)
          throw new HrError('CONFLICT', 409);
        await assertMonthsOpen(connection, row);
        const dates = requestDates(row);
        const type = await connection.query
          .selectFrom('leaveTypes')
          .select(['balanceRule'])
          .where('id', '=', str(row.leaveTypeId))
          .executeTakeFirst();
        const balances = !tracksBalance(type?.balanceRule)
          ? []
          : await loadBalances(
              connection,
              policies,
              str(row.employeeId),
              str(row.leaveTypeId),
              dates,
            );
        if (balances.length)
          await updateBalances(
            connection,
            policies,
            balances,
            str(row.status) === 'pending' ? -debitDays(row) : 0,
            str(row.status) === 'approved' ? -debitDays(row) : 0,
          );
        const wasApproved = str(row.status) === 'approved';
        const updated = await repo.updateOne({
          filter: { id },
          values: { status: 'cancelled', updatedAt: stampAfter(row.updatedAt) },
        });
        // 撤销后冲突标记自动清除, and the days are recalculated without the leave.
        if (wasApproved)
          await applyAttendance(
            connection,
            str(row.employeeId),
            id,
            dates,
            false,
          );
        else await clearConflicts(connection, str(row.employeeId), id, dates);
        return serialize(updated.record);
      });
    },

    /** 离职: requests still open are cancelled and their pending days released (system). */
    async cancelOpenFor(connection: DatabaseConnection, employeeId: string) {
      const rows = await connection.query
        .selectFrom('leaveRequests')
        .select(['id', 'status', 'leaveTypeId', 'approvals', 'duration'])
        .where('employeeId', '=', employeeId)
        .where('status', 'in', ['draft', 'pending'])
        .execute();
      for (const row of rows) {
        if (str(row.status) === 'pending') {
          const dates = requestDates(row);
          const balances = await connection.query
            .selectFrom('leaveBalances')
            .select(['id', 'pending'])
            .where('employeeId', '=', employeeId)
            .where('leaveTypeId', '=', str(row.leaveTypeId))
            .where('year', 'in', [
              ...new Set(dates.map((d) => Number(d.slice(0, 4)))),
            ])
            .execute();
          for (const balance of balances)
            await connection.query
              .updateTable('leaveBalances')
              .set({
                pending: Math.max(0, Number(balance.pending) - debitDays(row)),
                updatedAt: new Date(),
              })
              .where('id', '=', str(balance.id))
              .execute();
          await clearConflicts(connection, employeeId, str(row.id), dates);
        }
        await connection.query
          .updateTable('leaveRequests')
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where('id', '=', str(row.id))
          .execute();
      }
      return rows.length;
    },
  };
}

export type LeaveRequestService = ReturnType<typeof createLeaveRequestService>;

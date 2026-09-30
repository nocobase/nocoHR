/**
 * V2-05 补卡、加班、调班 (`attendanceAdjustments`): requested by the employee
 * for themself, approved in the chain the attendance settings define —
 * department head (a shift swap first by the other employee), plus hr.admin
 * for overtime that takes the month past the alert line, plus any extra
 * department level. Nobody approves their own request; the planner skips
 * them upwards.
 *
 * Approval takes effect in the same transaction: a missed punch becomes a
 * punch and the day is recalculated; overtime is counted on its day; a swap
 * exchanges the two schedule cells, re-validated like any schedule save (a
 * block refuses the approval, a warning is recorded on the cell). A locked
 * month refuses every step.
 */
import type { DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';

import { planAttendanceApproval } from './attendance-approval.js';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
} from './attendance-config.js';
import {
  shiftInterval,
  WINDOW_AFTER_MS,
  WINDOW_BEFORE_MS,
} from './attendance-compute.js';
import type { AttendanceEngine } from './attendance-engine.js';
import { lockAttendanceSettings } from './attendance-settings.js';
import { json, monthDays } from './attendance-service.js';
import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import {
  readValues,
  type CustomFieldDefinition,
  type CustomFieldService,
} from './custom-fields.js';
import type { ActorContext } from './framework-service.js';
import type { Platform } from './platform.js';
import { HrError, isRecord, newId, str } from './shared.js';

const RESOURCE = 'talent.adjustment';
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });

/** The policy clause a 考勤异常说明 cites (from the knowledge base), shown to the approver. */
const policySchema = z
  .object({
    documentId: z.string().min(1).max(64),
    documentTitle: z.string().min(1).max(255),
    citation: z.string().min(1).max(500),
    excerpt: z.string().max(500).optional(),
  })
  .strict();

const requestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('missingPunch'),
      date,
      reason: z.string().trim().min(1).max(1000),
      details: z.object({ at: instant }).strict(),
    })
    .strict(),
  z
    .object({
      // 考勤异常说明: why that day's late arrival or early leave happened.
      type: z.literal('exception'),
      date,
      reason: z.string().trim().min(1).max(1000),
      details: z.object({ policy: policySchema.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('overtime'),
      date,
      reason: z.string().trim().min(1).max(1000),
      details: z.object({ startAt: instant, endAt: instant }).strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal('shiftSwap'),
      date,
      reason: z.string().trim().min(1).max(1000),
      details: z
        .object({
          counterpartEmployeeId: z.string().min(1).max(64),
          // The other cell of the swap; the same day when omitted.
          counterpartDate: date.optional(),
        })
        .strict(),
    })
    .strict(),
]);

export interface Step {
  level: number;
  kind: 'counterparty' | 'departmentHead' | 'hrAdmin' | 'extra';
  approverUserId: string | null;
  departmentId: string | null;
  status: 'pending' | 'waiting' | 'approved' | 'rejected';
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
  submittedBy?: string;
  /** 经飞书卡片: the step was submitted or decided on an office-suite card. */
  submittedVia?: 'feishuCard';
  via?: 'feishuCard';
}

const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);

function isWorkday(
  value: string,
  calendar: { holidays: string[]; adjusted: string[] },
) {
  if (calendar.adjusted.includes(value)) return true;
  if (calendar.holidays.includes(value)) return false;
  const weekday = new Date(`${value}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** 加班类型 by the calendar: holiday, else a rest day when unscheduled or off, else a workday. */
export function overtimeTypeOf(input: {
  date: string;
  holidays: readonly string[];
  adjustedWorkdays: readonly string[];
  scheduledShift: boolean | null;
}): 'workday' | 'restDay' | 'holiday' {
  if (input.holidays.includes(input.date)) return 'holiday';
  if (input.scheduledShift === false) return 'restDay';
  if (input.scheduledShift === true) return 'workday';
  return isWorkday(input.date, {
    holidays: [...input.holidays],
    adjusted: [...input.adjustedWorkdays],
  })
    ? 'workday'
    : 'restDay';
}

export function createAdjustmentService(deps: {
  readonly platform: Platform;
  readonly engine: AttendanceEngine;
  readonly hrRecipients: () => Promise<string[]>;
  /** Validates the two swapped cells like a schedule save; returns their checks. */
  readonly validateCells: (
    connection: DatabaseConnection,
    cells: { employeeId: string; date: string; shiftId: string | null }[],
  ) => Promise<{
    hasBlock: boolean;
    checks: Record<string, { rule: string; level: string; message: string }[]>;
  }>;
  /** 界面追加字段 on 补卡/加班/调班/考勤异常说明 (V2-05). */
  readonly customFields: () => CustomFieldService;
}) {
  const { platform, engine } = deps;
  const { database, timeZone } = platform;

  /** Read outside the transaction: SQLite has one connection and would deadlock otherwise. */
  const fieldDefinitions = () =>
    deps.customFields().list('attendanceAdjustments');

  /** Stored as JSON text through the query builder, like the other custom-field writers. */
  const storedValues = (values: Record<string, unknown>) =>
    Object.keys(values).length ? JSON.stringify(values) : null;

  /**
   * What a reader sees: the detail placement, plus the form placement for the
   * applicant. Sensitive fields only for the applicant and HR administrators.
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

  /** hr.admin: whoever may lock attendance. */
  async function isHrAdmin(ctx: ActorContext): Promise<boolean> {
    return Boolean(
      await tryAuthorizeAction(ctx.authz, 'talent.attendanceRecord', 'lock'),
    );
  }

  async function setting<K extends 'limits' | 'calendar' | 'approval'>(
    connection: DatabaseConnection,
    section: K,
  ) {
    const row = await connection.query
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', `attendance.${section}`)
      .executeTakeFirst();
    return attendanceConfigSchemas[section].parse(
      json(row?.value, attendanceConfigDefaults[section]),
    ) as (typeof attendanceConfigDefaults)[K];
  }

  async function ownEmployee(connection: DatabaseConnection, userId: string) {
    return connection.query
      .selectFrom('employees')
      .select(['id', 'userId', 'departmentId', 'status', 'name'])
      .where('userId', '=', userId)
      .executeTakeFirst();
  }

  async function assertMonthOpen(
    connection: DatabaseConnection,
    employeeIds: readonly string[],
    dates: readonly string[],
  ) {
    const locked = await connection.query
      .selectFrom('attendanceMonthlySummaries')
      .select(['id'])
      .where('employeeId', 'in', [...employeeIds])
      .where('month', 'in', [...new Set(dates.map((d) => d.slice(0, 7)))])
      .where('status', '=', 'locked')
      .executeTakeFirst();
    if (locked) throw new HrError('MONTH_LOCKED', 409);
  }

  async function approvedOvertimeHours(
    connection: DatabaseConnection,
    employeeId: string,
    month: string,
  ) {
    const { from, to } = monthDays(month);
    const rows = await connection.query
      .selectFrom('attendanceAdjustments')
      .select(['details'])
      .where('employeeId', '=', employeeId)
      .where('type', '=', 'overtime')
      .where('status', '=', 'approved')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .execute();
    return rows.reduce(
      (total, row) =>
        total + Number(json<{ hours?: number }>(row.details, {}).hours ?? 0),
      0,
    );
  }

  async function alertHours(
    connection: DatabaseConnection,
    departmentId: string,
  ) {
    const rules = await connection.query
      .selectFrom('attendanceRules')
      .select(['departmentIds', 'monthlyOvertimeAlertHours'])
      .where('active', '=', true)
      .execute();
    const tree = await platform.organization.listTree(connection);
    const parent = new Map(tree.map((d) => [d.id, d.parentId]));
    // The nearest department with a rule decides, as for every attendance rule.
    for (
      let cursor: string | null | undefined = departmentId, i = 0;
      cursor && i < 50;
      cursor = parent.get(cursor), i++
    ) {
      const rule = rules.find((r) =>
        json<string[]>(r.departmentIds, []).includes(cursor),
      );
      if (rule) return Number(rule.monthlyOvertimeAlertHours);
    }
    return 36;
  }

  function present(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      type: str(row.type),
      employeeId: str(row.employeeId),
      date: day(row.date),
      details: json<Record<string, unknown>>(row.details, {}),
      reason: str(row.reason),
      status: str(row.status),
      source: row.source ? str(row.source) : 'self',
      approvals: json<Step[]>(row.approvals, []),
      createdAt: new Date(str(row.createdAt)).toISOString(),
      updatedAt: new Date(str(row.updatedAt)).toISOString(),
    };
  }

  /** What the current step is and whether this user may act on it. */
  async function actionable(row: Record<string, unknown>, ctx: ActorContext) {
    const steps = json<Step[]>(row.approvals, []);
    const current = steps.find((s) => s.status === 'pending');
    if (str(row.status) !== 'pending' || !current)
      return { current, may: false };
    if (steps[0]?.submittedBy === ctx.userId) return { current, may: false };
    if (current.approverUserId)
      return { current, may: current.approverUserId === ctx.userId };
    // The hr.admin level: whoever may lock attendance (hr.admin).
    return {
      current,
      may: Boolean(
        await tryAuthorizeAction(ctx.authz, 'talent.attendanceRecord', 'lock'),
      ),
    };
  }

  async function apply(
    connection: DatabaseConnection,
    row: Record<string, unknown>,
  ) {
    const type = str(row.type);
    const employeeId = str(row.employeeId);
    const on = day(row.date);
    const details = json<Record<string, string>>(row.details, {});
    if (type === 'missingPunch') {
      await engine.recompute(connection, {
        employeeIds: [employeeId],
        from: on,
        to: on,
        addPunches: new Map([
          [
            employeeId,
            [
              {
                at: details.at,
                source: 'adjustment',
                adjustmentId: str(row.id),
              },
            ],
          ],
        ]),
      });
      return;
    }
    if (type === 'overtime' || type === 'exception') {
      // An approved 考勤异常说明 marks the day 已说明 (excusedByAdjustmentId) as it is recalculated.
      await engine.recompute(connection, {
        employeeIds: [employeeId],
        from: on,
        to: on,
      });
      return;
    }
    const other = details.counterpartEmployeeId;
    const otherDate = details.counterpartDate ?? on;
    const cell = async (id: string, d: string) =>
      connection.query
        .selectFrom('shiftSchedules')
        .select(['id', 'shiftId', 'status'])
        .where('employeeId', '=', id)
        .where('date', '=', d)
        .executeTakeFirst();
    const mine = await cell(employeeId, on);
    const theirs = await cell(other, otherDate);
    if (!mine || !theirs) throw new HrError('SWAP_SCHEDULE_CHANGED', 409);
    const snapshot = json<{
      myShiftId?: string | null;
      theirShiftId?: string | null;
    }>(row.details, {});
    // The cells changed since the request: the swap no longer means what both agreed to.
    if (
      (mine.shiftId ? str(mine.shiftId) : null) !==
        (snapshot.myShiftId ?? null) ||
      (theirs.shiftId ? str(theirs.shiftId) : null) !==
        (snapshot.theirShiftId ?? null)
    )
      throw new HrError('SWAP_SCHEDULE_CHANGED', 409);
    const cells = [
      {
        employeeId,
        date: on,
        shiftId: theirs.shiftId ? str(theirs.shiftId) : null,
      },
      {
        employeeId: other,
        date: otherDate,
        shiftId: mine.shiftId ? str(mine.shiftId) : null,
      },
    ];
    const result = await deps.validateCells(connection, cells);
    if (result.hasBlock)
      throw new HrError('SCHEDULE_BLOCKED', 409, { checks: result.checks });
    const stamp = new Date();
    for (const [target, value] of [
      [mine, cells[0]],
      [theirs, cells[1]],
    ] as const) {
      const checks = result.checks[`${value.employeeId}:${value.date}`];
      await connection.query
        .updateTable('shiftSchedules')
        .set({
          shiftId: value.shiftId,
          checkResult: checks?.length ? checks : null,
          updatedAt: stamp,
        })
        .where('id', '=', str(target.id))
        .execute();
    }
    await engine.recompute(connection, {
      employeeIds: [employeeId, other],
      from: on < otherDate ? on : otherDate,
      to: on < otherDate ? otherDate : on,
    });
  }

  async function notifyStep(row: Record<string, unknown>, name: string) {
    const steps = json<Step[]>(row.approvals, []);
    const current = steps.find((s) => s.status === 'pending');
    if (!current) return;
    const recipients = current.approverUserId
      ? [current.approverUserId]
      : await deps.hrRecipients();
    await platform.notify({
      key: `adjustment:${str(row.id)}:level:${current.level}`,
      userIds: recipients,
      message:
        current.kind === 'counterparty'
          ? 'shiftSwapConsent'
          : 'adjustmentPending',
      params: { name, kind: str(row.type), date: day(row.date) },
      path: `/talent/approvals?tab=${str(row.type)}`,
    });
  }

  type RequestBody = z.infer<typeof requestSchema>;
  type PersistMode =
    | { kind: 'request' }
    | { kind: 'draft'; source: 'self' | 'hrAssistant' }
    | {
        kind: 'submit';
        id: string;
        previousUpdatedAt: number;
        via?: 'feishuCard';
        /** The draft's stored custom values, re-validated on submit. */
        stored: Record<string, unknown>;
      };

  /**
   * One request's checks and storage: a new request, a draft (drafted for the
   * employee, no approval chain, not counted towards the missed-punch limit),
   * or a draft being submitted — checked again exactly as a new request.
   */
  async function persist(
    ctx: ActorContext,
    body: RequestBody,
    mode: PersistMode,
    customFields?: unknown,
  ) {
    const policies = await authorizeAction(ctx.authz, RESOURCE, 'request');
    const departments = await platform.organization.listTree();
    // Custom values: a request or submission needs its required fields; a
    // draft may be incomplete (its existing values are merged below).
    const service = deps.customFields();
    // Only fields placed on the form are writable (and required).
    const definitions = service.visible(await fieldDefinitions(), {
      sensitive: true,
      placement: 'form',
    });
    const submittedValues =
      mode.kind === 'draft'
        ? undefined
        : service.prepare(
            definitions,
            // `{}` rather than undefined: prepare() skips every check for undefined.
            customFields ?? {},
            mode.kind === 'submit' ? mode.stored : {},
            { enforceRequired: true },
          );
    // The grant decides whether this employee may be reached at all. Checked
    // before the transaction: scope resolution reads through its own connection.
    const self = await ownEmployee(database.connection(), ctx.userId);
    if (!self) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
    const visible = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id: str(self.id) } });
    if (!visible) throw new HrError('NOT_FOUND', 404);
    const created = await database.transaction(async (connection) => {
      await lockAttendanceSettings(connection, ctx.userId);
      const employee = await ownEmployee(connection, ctx.userId);
      if (!employee || str(employee.id) !== str(self.id))
        throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      if (str(employee.status) === 'leave')
        throw new HrError('EMPLOYEE_NOT_ACTIVE', 409);
      const employeeId = str(employee.id);
      const limits = await setting(connection, 'limits');
      const details: Record<string, unknown> = { ...body.details };
      let counterpartyUserId: string | undefined;
      let projected = 0;
      const dates = [body.date];
      const cell = await connection.query
        .selectFrom('shiftSchedules')
        .select(['shiftId'])
        .where('employeeId', '=', employeeId)
        .where('date', '=', body.date)
        .executeTakeFirst();
      const cellShift = cell?.shiftId
        ? await connection.query
            .selectFrom('shifts')
            .select(['startTime', 'endTime'])
            .where('id', '=', str(cell.shiftId))
            .executeTakeFirst()
        : undefined;
      const schedule = cell
        ? {
            shiftId: cell.shiftId,
            startTime: cellShift?.startTime ?? null,
            endTime: cellShift?.endTime ?? null,
          }
        : undefined;
      if (body.type === 'missingPunch') {
        const { from, to } = monthDays(body.date.slice(0, 7));
        const used = await connection.query
          .selectFrom('attendanceAdjustments')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('type', '=', 'missingPunch')
          .where('status', 'in', ['pending', 'approved'])
          .where('date', '>=', from)
          .where('date', '<=', to)
          .execute();
        // A draft does not count towards the monthly limit; submitting it does.
        if (
          mode.kind !== 'draft' &&
          used.length >= limits.monthlyMissingPunchLimit
        )
          throw new HrError('MISSING_PUNCH_LIMIT', 409, {
            limit: limits.monthlyMissingPunchLimit,
          });
        if (!schedule?.shiftId || !schedule.startTime || !schedule.endTime)
          throw new HrError('NO_SHIFT_ON_DATE', 409);
        const window = shiftInterval(
          body.date,
          {
            startTime: str(schedule.startTime).slice(0, 5),
            endTime: str(schedule.endTime).slice(0, 5),
          },
          timeZone,
        );
        const at = Date.parse(body.details.at);
        if (
          at < window.start - WINDOW_BEFORE_MS ||
          at > window.end + WINDOW_AFTER_MS
        )
          throw new HrError('PUNCH_OUTSIDE_SHIFT', 409);
        if (at > Date.now()) throw new HrError('PUNCH_IN_FUTURE', 409);
      } else if (body.type === 'exception') {
        // 考勤异常说明: only for a late arrival or an early leave of that day.
        const record = await connection.query
          .selectFrom('attendanceRecords')
          .select(['id', 'status', 'lateMinutes', 'earlyMinutes'])
          .where('employeeId', '=', employeeId)
          .where('date', '=', body.date)
          .executeTakeFirst();
        const anomaly = record ? str(record.status) : '';
        if (!record || (anomaly !== 'late' && anomaly !== 'earlyLeave'))
          throw new HrError('EXCEPTION_NOT_APPLICABLE', 409);
        details.attendanceRecordId = str(record.id);
        details.anomaly = anomaly;
        details.minutes = Number(
          anomaly === 'late' ? record.lateMinutes : record.earlyMinutes,
        );
      } else if (body.type === 'overtime') {
        const start = Date.parse(body.details.startAt);
        const end = Date.parse(body.details.endAt);
        if (!(end > start) || end - start > 24 * 3_600_000)
          throw new HrError('INVALID_DATE_RANGE', 400);
        const calendar = await setting(connection, 'calendar');
        const hours = Math.round(((end - start) / 3_600_000) * 100) / 100;
        details.hours = hours;
        // 由服务端按日历判定.
        details.overtimeType = overtimeTypeOf({
          date: body.date,
          holidays: calendar.years.flatMap((y) => y.holidays),
          adjustedWorkdays: calendar.years.flatMap((y) => y.adjustedWorkdays),
          scheduledShift: schedule ? Boolean(schedule.shiftId) : null,
        });
        projected =
          (await approvedOvertimeHours(
            connection,
            employeeId,
            body.date.slice(0, 7),
          )) + hours;
      } else {
        const otherId = body.details.counterpartEmployeeId;
        const otherDate = body.details.counterpartDate ?? body.date;
        if (otherId === employeeId)
          throw new HrError('INVALID_COUNTERPARTY', 400);
        const other = await connection.query
          .selectFrom('employees')
          .select(['id', 'userId', 'status', 'departmentId'])
          .where('id', '=', otherId)
          .executeTakeFirst();
        if (!other || str(other.status) === 'leave')
          throw new HrError('INVALID_COUNTERPARTY', 400);
        // The other employee agrees in NocoHR: they need an account.
        if (!other.userId) throw new HrError('COUNTERPARTY_NO_ACCOUNT', 409);
        counterpartyUserId = str(other.userId);
        const theirs = await connection.query
          .selectFrom('shiftSchedules')
          .select(['shiftId', 'status'])
          .where('employeeId', '=', otherId)
          .where('date', '=', otherDate)
          .executeTakeFirst();
        if (!schedule || !theirs) throw new HrError('NO_SHIFT_ON_DATE', 409);
        if (!schedule.shiftId && !theirs.shiftId)
          throw new HrError('SWAP_NOTHING_TO_SWAP', 409);
        details.myShiftId = schedule.shiftId ? str(schedule.shiftId) : null;
        details.theirShiftId = theirs.shiftId ? str(theirs.shiftId) : null;
        details.counterpartDate = otherDate;
        dates.push(otherDate);
        await assertMonthOpen(connection, [otherId], [otherDate]);
      }
      await assertMonthOpen(connection, [employeeId], [body.date]);
      const duplicate = await connection.query
        .selectFrom('attendanceAdjustments')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('type', '=', body.type)
        .where('date', '=', body.date)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (duplicate) throw new HrError('ADJUSTMENT_PENDING_EXISTS', 409);
      const stamp = new Date();
      if (mode.kind === 'draft') {
        // One open draft per type and day: drafting again replaces its content.
        const existing = await connection.query
          .selectFrom('attendanceAdjustments')
          .select(['id', 'customFields'])
          .where('employeeId', '=', employeeId)
          .where('type', '=', body.type)
          .where('date', '=', body.date)
          .where('status', '=', 'draft')
          .executeTakeFirst();
        const draftValues = service.prepare(
          definitions,
          customFields,
          readValues(existing?.customFields),
          {},
        );
        if (existing) {
          await connection.query
            .updateTable('attendanceAdjustments')
            .set({
              details,
              reason: body.reason,
              source: mode.source,
              customFields: storedValues(draftValues),
              updatedAt: stamp,
            })
            .where('id', '=', str(existing.id))
            .execute();
          return { id: str(existing.id), name: str(employee.name) };
        }
        const id = newId();
        await connection.query
          .insertInto('attendanceAdjustments')
          .values({
            id,
            type: body.type,
            employeeId,
            date: body.date,
            details,
            reason: body.reason,
            status: 'draft',
            source: mode.source,
            approvals: null,
            customFields: storedValues(draftValues),
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        return { id, name: str(employee.name) };
      }
      let steps;
      try {
        steps = planAttendanceApproval({
          // A 考勤异常说明 follows the missed-punch chain: the department head.
          type: body.type === 'exception' ? 'missingPunch' : body.type,
          employeeUserId: ctx.userId,
          submittedBy: ctx.userId,
          departmentId: str(employee.departmentId),
          departments,
          leaveSecondLevelDays: limits.leaveSecondLevelDays,
          projectedMonthlyOvertimeHours: projected,
          monthlyOvertimeAlertHours: await alertHours(
            connection,
            str(employee.departmentId),
          ),
          counterpartyUserId,
        });
      } catch (error) {
        throw new HrError(
          error instanceof Error ? error.message : 'APPROVER_NOT_CONFIGURED',
          409,
        );
      }
      const extras = (await setting(connection, 'approval')).extraLevels.filter(
        (level) =>
          level.types.includes(body.type) &&
          level.approverUserId !== ctx.userId &&
          departments.some((d) => d.id === level.departmentId),
      );
      const chain = new Set<string>();
      for (
        let cursor: string | null | undefined = str(employee.departmentId),
          i = 0;
        cursor && i < 50;
        cursor = departments.find((d) => d.id === cursor)?.parentId, i++
      )
        chain.add(cursor);
      const approvals: Step[] = [
        ...steps.map((s) => ({ ...s })),
        ...extras
          .filter((level) => chain.has(level.departmentId))
          .map((level) => ({
            kind: 'extra' as const,
            approverUserId: level.approverUserId,
            departmentId: level.departmentId,
            status: 'waiting' as const,
          })),
      ].map((step, index) => ({
        level: index + 1,
        ...step,
        decidedBy: null,
        decidedAt: null,
        comment: null,
        ...(index === 0
          ? {
              submittedBy: ctx.userId,
              ...(mode.kind === 'submit' && mode.via
                ? { submittedVia: mode.via }
                : {}),
            }
          : {}),
      }));
      if (mode.kind === 'submit') {
        await connection.query
          .updateTable('attendanceAdjustments')
          .set({
            details,
            status: 'pending',
            approvals,
            customFields: storedValues(submittedValues ?? {}),
            updatedAt: new Date(
              Math.max(stamp.getTime(), mode.previousUpdatedAt + 1),
            ),
          })
          .where('id', '=', mode.id)
          .where('status', '=', 'draft')
          .execute();
        return { id: mode.id, name: str(employee.name) };
      }
      const id = newId();
      // The employee was authorized above; the row is the employee's own.
      await connection.query
        .insertInto('attendanceAdjustments')
        .values({
          id,
          type: body.type,
          employeeId,
          date: body.date,
          details,
          reason: body.reason,
          status: 'pending',
          source: 'self',
          approvals,
          customFields: storedValues(submittedValues ?? {}),
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return { id, name: str(employee.name) };
    });
    const row = await database
      .query()
      .selectFrom('attendanceAdjustments')
      .selectAll()
      .where('id', '=', created.id)
      .executeTakeFirstOrThrow();
    if (mode.kind !== 'draft') await notifyStep(row, created.name);
    // The writer is the applicant.
    return {
      ...present(row),
      customFields: projectValues(await fieldDefinitions(), row, {
        sensitive: true,
        editor: true,
      }),
    };
  }

  return {
    async request(ctx: ActorContext, input: unknown) {
      // 界面追加字段 travel beside the typed request; the service validates them.
      const record = isRecord(input) ? input : undefined;
      const { customFields, ...fields } = record ?? {};
      const parsed = requestSchema.safeParse(record ? fields : input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      return persist(ctx, parsed.data, { kind: 'request' }, customFields);
    },

    /**
     * 人事助理起草 (draftMyAttendanceAdjustment): a missed-punch or exception
     * draft for the signed-in employee's own record. A missed punch defaults
     * to the shift's standard time on the side without a punch and must fall
     * inside the shift's window. Only the employee submits it.
     */
    async draftFromRecord(
      ctx: ActorContext,
      input: unknown,
      source: 'self' | 'hrAssistant' = 'hrAssistant',
    ) {
      const parsed = z
        .object({
          attendanceRecordId: z.string().min(1).max(64),
          type: z.enum(['missingPunch', 'exception']),
          at: instant.optional(),
          reason: z.string().trim().min(1).max(1000),
          policy: policySchema.optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const body = parsed.data;
      const own = await ownEmployee(database.connection(), ctx.userId);
      if (!own) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const record = await database
        .query()
        .selectFrom('attendanceRecords')
        .select(['id', 'employeeId', 'date', 'shiftId', 'punches', 'status'])
        .where('id', '=', body.attendanceRecordId)
        .executeTakeFirst();
      // Someone else's record answers as if it did not exist.
      if (!record || str(record.employeeId) !== str(own.id))
        throw new HrError('NOT_FOUND', 404);
      const on = day(record.date);
      let at = body.at;
      if (body.type === 'missingPunch') {
        if (
          str(record.status) !== 'missingPunch' &&
          str(record.status) !== 'absent'
        )
          throw new HrError('MISSING_PUNCH_NOT_APPLICABLE', 409);
        const shift = record.shiftId
          ? await database
              .query()
              .selectFrom('shifts')
              .select(['startTime', 'endTime'])
              .where('id', '=', str(record.shiftId))
              .executeTakeFirst()
          : undefined;
        if (!shift) throw new HrError('NO_SHIFT_ON_DATE', 409);
        const window = shiftInterval(
          on,
          {
            startTime: str(shift.startTime).slice(0, 5),
            endTime: str(shift.endTime).slice(0, 5),
          },
          timeZone,
        );
        if (!at) {
          // The one punch there is tells which side is missing: 下班 after a check-in, else 上班.
          const punches = json<{ at: string }[]>(record.punches, []);
          const first = punches[0] ? Date.parse(punches[0].at) : NaN;
          const missingOut =
            Number.isFinite(first) &&
            Math.abs(first - window.start) <= Math.abs(first - window.end);
          at = new Date(missingOut ? window.end : window.start).toISOString();
        }
      }
      const request: RequestBody =
        body.type === 'missingPunch'
          ? {
              type: 'missingPunch',
              date: on,
              reason: body.reason,
              details: { at: at! },
            }
          : {
              type: 'exception',
              date: on,
              reason: body.reason,
              details: body.policy ? { policy: body.policy } : {},
            };
      const draft = await persist(ctx, request, { kind: 'draft', source });
      // The HR assistant's question about this record now has its draft.
      const current = await database
        .query()
        .selectFrom('attendanceRecords')
        .select(['inquiry'])
        .where('id', '=', str(record.id))
        .executeTakeFirst();
      const inquiry = json<Record<string, unknown> | null>(
        current?.inquiry,
        null,
      );
      if (inquiry && typeof inquiry === 'object')
        await database
          .query()
          .updateTable('attendanceRecords')
          .set({ inquiry: { ...inquiry, draftAdjustmentId: draft.id } })
          .where('id', '=', str(record.id))
          .execute();
      return { ...draft, attendanceRecordId: str(record.id) };
    },

    /** 提交 a draft: the employee's own, checked again as a new request (the limit counts now). */
    async submitDraft(
      ctx: ActorContext,
      id: string,
      via?: 'feishuCard',
      /** Optional `{ customFields }` filled in on the draft before submitting. */
      input?: unknown,
    ) {
      const extra = z
        .object({ customFields: z.unknown().optional() })
        .strict()
        .optional()
        .safeParse(input ?? undefined);
      if (!extra.success) throw new HrError('INVALID_INPUT', 400);
      const row = await database
        .query()
        .selectFrom('attendanceAdjustments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      const own = await ownEmployee(database.connection(), ctx.userId);
      if (!row || !own || str(row.employeeId) !== str(own.id))
        throw new HrError('NOT_FOUND', 404);
      if (str(row.status) !== 'draft')
        throw new HrError('REQUEST_STATE_CONFLICT', 409);
      const details = json<Record<string, unknown>>(row.details, {});
      const type = str(row.type);
      const body = requestSchema.safeParse({
        type,
        date: day(row.date),
        reason: str(row.reason),
        details:
          type === 'missingPunch'
            ? { at: details.at }
            : type === 'exception'
              ? details.policy
                ? { policy: details.policy }
                : {}
              : details,
      });
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      return persist(
        ctx,
        body.data,
        {
          kind: 'submit',
          id,
          previousUpdatedAt: new Date(str(row.updatedAt)).getTime(),
          via,
          stored: readValues(row.customFields),
        },
        extra.data?.customFields,
      );
    },

    /** 放弃 a draft: it is closed as cancelled. */
    async discardDraft(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'request');
      const own = await ownEmployee(database.connection(), ctx.userId);
      const row = await database
        .query()
        .selectFrom('attendanceAdjustments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row || !own || str(row.employeeId) !== str(own.id))
        throw new HrError('NOT_FOUND', 404);
      if (str(row.status) !== 'draft')
        throw new HrError('REQUEST_STATE_CONFLICT', 409);
      await database
        .query()
        .updateTable('attendanceAdjustments')
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return present({ ...row, status: 'cancelled' });
    },

    /**
     * 我的申请 (mine), 待我处理 (todo: requests whose current step is this
     * user's — the other employee sees a swap only at its consent step, the
     * head only after that), or 本范围 (scope: hr.manager / hr.admin reads).
     */
    async list(ctx: ActorContext, input: unknown) {
      const body = z
        .object({
          view: z.enum(['mine', 'todo', 'scope']),
          type: z
            .enum(['missingPunch', 'overtime', 'shiftSwap', 'exception'])
            .optional(),
          status: z
            .enum(['draft', 'pending', 'approved', 'rejected', 'cancelled'])
            .optional(),
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const { view, type, status } = body.data;
      const q = database.query();
      let query = q.selectFrom('attendanceAdjustments').selectAll();
      if (type) query = query.where('type', '=', type);
      if (status) query = query.where('status', '=', status);
      if (view === 'mine') {
        await authorizeAction(ctx.authz, RESOURCE, 'request');
        const own = await ownEmployee(database.connection(), ctx.userId);
        if (!own) return [];
        query = query.where('employeeId', '=', str(own.id));
      } else if (view === 'scope') {
        const policies = await authorizeAction(ctx.authz, RESOURCE, 'approve');
        const employees = await database
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .findMany({ limit: 2001 });
        if (!employees.length) return [];
        // A draft is the employee's own until they submit it.
        query = query
          .where(
            'employeeId',
            'in',
            employees.map((e) => str(e.id)),
          )
          .where('status', '!=', 'draft');
      } else {
        // A pending consent step is the other employee's, so any employee may read their todo list.
        const canRequest = await tryAuthorizeAction(
          ctx.authz,
          RESOURCE,
          'request',
        );
        const canApprove = await tryAuthorizeAction(
          ctx.authz,
          RESOURCE,
          'approve',
        );
        if (!canRequest && !canApprove) throw new HrError('FORBIDDEN', 403);
        query = query.where('status', '=', 'pending');
      }
      const rows = await query
        .orderBy('createdAt', 'desc')
        .limit(1001)
        .execute();
      const visible: Record<string, unknown>[] = [];
      for (const row of rows.slice(0, 1000)) {
        if (view !== 'todo') {
          visible.push(row);
          continue;
        }
        const { current, may } = await actionable(row, ctx);
        if (!may || !current) continue;
        if (
          current.kind !== 'counterparty' &&
          !(await tryAuthorizeAction(ctx.authz, RESOURCE, 'approve'))
        )
          continue;
        visible.push(row);
      }
      const ids = [...new Set(visible.map((r) => str(r.employeeId)))];
      const names = ids.length
        ? await q
            .selectFrom('employees')
            .select(['id', 'name', 'employeeNo', 'departmentId'])
            .where('id', 'in', ids)
            .execute()
        : [];
      const byId = new Map(names.map((n) => [str(n.id), n]));
      const definitions = visible.length ? await fieldDefinitions() : [];
      const sensitive = view === 'mine' || (await isHrAdmin(ctx));
      return visible.map((row) => ({
        ...present(row),
        customFields: projectValues(definitions, row, {
          sensitive,
          editor: false,
        }),
        employeeName: str(byId.get(str(row.employeeId))?.name ?? ''),
        employeeNo: str(byId.get(str(row.employeeId))?.employeeNo ?? ''),
        departmentId: str(byId.get(str(row.employeeId))?.departmentId ?? ''),
      }));
    },

    async get(ctx: ActorContext, id: string) {
      const row = await database
        .query()
        .selectFrom('attendanceAdjustments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('NOT_FOUND', 404);
      const own = await ownEmployee(database.connection(), ctx.userId);
      const { current, may } = await actionable(row, ctx);
      const mine = Boolean(own && str(own.id) === str(row.employeeId));
      if (str(row.status) === 'draft' && !mine)
        throw new HrError('NOT_FOUND', 404);
      let readable = mine || may;
      if (!readable && current?.kind !== 'counterparty') {
        const policies = await tryAuthorizeAction(
          ctx.authz,
          RESOURCE,
          'approve',
        );
        if (policies)
          readable = Boolean(
            await database
              .repository('employees')
              .withPolicy(policyOf(policies, 'employees'))
              .findOne({ filter: { id: str(row.employeeId) } }),
          );
      }
      if (!readable) throw new HrError('NOT_FOUND', 404);
      return {
        ...present(row),
        customFields: projectValues(await fieldDefinitions(), row, {
          sensitive: mine || (await isHrAdmin(ctx)),
          editor: mine,
        }),
        canDecide: may,
        canCancel: Boolean(
          own &&
          str(own.id) === str(row.employeeId) &&
          str(row.status) === 'pending',
        ),
        canSubmit: Boolean(
          own &&
          str(own.id) === str(row.employeeId) &&
          str(row.status) === 'draft',
        ),
      };
    },

    /** 同意 / 批准 or 拒绝 the current step; the final approval takes effect. */
    async decide(
      ctx: ActorContext,
      id: string,
      input: unknown,
      via?: 'feishuCard',
    ) {
      const body = z
        .object({
          decision: z.enum(['approved', 'rejected']),
          comment: z.string().trim().max(1000).nullable().optional(),
          expectedUpdatedAt: z.string().min(1),
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      // Who may act is decided before the transaction: authorization reads through its own connection.
      const before = await database
        .query()
        .selectFrom('attendanceAdjustments')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!before) throw new HrError('NOT_FOUND', 404);
      const check = await actionable(before, ctx);
      const acting = check.current;
      if (!acting || !check.may) throw new HrError('NOT_CURRENT_APPROVER', 403);
      if (acting.kind !== 'counterparty')
        await authorizeAction(ctx.authz, RESOURCE, 'approve');
      const result = await database.transaction(async (connection) => {
        await lockAttendanceSettings(connection, ctx.userId);
        const row = await connection.query
          .selectFrom('attendanceAdjustments')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw new HrError('NOT_FOUND', 404);
        if (str(row.status) !== 'pending')
          throw new HrError('REQUEST_STATE_CONFLICT', 409);
        if (
          new Date(str(row.updatedAt)).toISOString() !==
          body.data.expectedUpdatedAt
        )
          throw new HrError('CONFLICT', 409);
        const steps0 = json<Step[]>(row.approvals, []);
        const current = steps0.find((s) => s.status === 'pending');
        if (!current || current.level !== acting.level)
          throw new HrError('CONFLICT', 409);
        const details = json<Record<string, string>>(row.details, {});
        await assertMonthOpen(
          connection,
          [
            str(row.employeeId),
            ...(details.counterpartEmployeeId
              ? [details.counterpartEmployeeId]
              : []),
          ],
          [
            day(row.date),
            ...(details.counterpartDate ? [details.counterpartDate] : []),
          ],
        );
        const steps = steps0;
        const index = steps.indexOf(current);
        steps[index] = {
          ...current,
          status: body.data.decision,
          decidedBy: ctx.userId,
          decidedAt: new Date().toISOString(),
          comment: body.data.comment ?? null,
          ...(via ? { via } : {}),
        };
        let status = 'pending';
        if (body.data.decision === 'rejected') status = 'rejected';
        else {
          const next = steps.findIndex(
            (s, i) => i > index && s.status === 'waiting',
          );
          if (next >= 0) steps[next] = { ...steps[next], status: 'pending' };
          else status = 'approved';
        }
        const stamp = new Date(
          Math.max(Date.now(), new Date(str(row.updatedAt)).getTime() + 1),
        );
        await connection.query
          .updateTable('attendanceAdjustments')
          .set({ status, approvals: steps, updatedAt: stamp })
          .where('id', '=', id)
          .execute();
        if (status === 'approved')
          await apply(connection, { ...row, status, approvals: steps });
        return connection.query
          .selectFrom('attendanceAdjustments')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
      });
      const employee = await database
        .query()
        .selectFrom('employees')
        .select(['name', 'userId'])
        .where('id', '=', str(result.employeeId))
        .executeTakeFirst();
      if (str(result.status) === 'pending')
        await notifyStep(result, str(employee?.name ?? ''));
      else if (employee?.userId)
        await platform.notify({
          key: `adjustmentDecided:${id}`,
          userIds: [str(employee.userId)],
          message:
            str(result.status) === 'approved'
              ? 'adjustmentApproved'
              : 'adjustmentRejected',
          params: { kind: str(result.type), date: day(result.date) },
          path: '/talent/me#attendance',
        });
      return present(result);
    },

    async cancel(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'request');
      return database.transaction(async (connection) => {
        const own = await ownEmployee(connection, ctx.userId);
        const row = await connection.query
          .selectFrom('attendanceAdjustments')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row || !own || str(row.employeeId) !== str(own.id))
          throw new HrError('NOT_FOUND', 404);
        if (str(row.status) !== 'pending')
          throw new HrError('REQUEST_STATE_CONFLICT', 409);
        await connection.query
          .updateTable('attendanceAdjustments')
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where('id', '=', id)
          .execute();
        return present({ ...row, status: 'cancelled' });
      });
    },

    /**
     * 调班对象: colleagues of the requester's department with an account, and
     * their published shift on the day — names and shifts only, what a swap
     * form needs.
     */
    async swapPeers(ctx: ActorContext, input: unknown) {
      await authorizeAction(ctx.authz, RESOURCE, 'request');
      const body = z.object({ date }).strict().safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const own = await ownEmployee(database.connection(), ctx.userId);
      if (!own) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const q = database.query();
      const peers = await q
        .selectFrom('employees')
        .select(['id', 'name', 'employeeNo'])
        .where('departmentId', '=', str(own.departmentId))
        .where('id', '!=', str(own.id))
        .where('status', '!=', 'leave')
        .where('userId', 'is not', null)
        .orderBy('employeeNo', 'asc')
        .execute();
      const cells = peers.length
        ? await q
            .selectFrom('shiftSchedules')
            .select(['employeeId', 'shiftId'])
            .where(
              'employeeId',
              'in',
              peers.map((p) => str(p.id)),
            )
            .where('date', '=', body.data.date)
            .where('status', '=', 'published')
            .execute()
        : [];
      const shiftIds = [
        ...new Set(cells.flatMap((c) => (c.shiftId ? [str(c.shiftId)] : []))),
      ];
      const shifts = new Map(
        (shiftIds.length
          ? await q
              .selectFrom('shifts')
              .select(['id', 'title', 'code'])
              .where('id', 'in', shiftIds)
              .execute()
          : []
        ).map((row) => [str(row.id), row]),
      );
      return peers.map((peer) => {
        const cell = cells.find((c) => str(c.employeeId) === str(peer.id));
        const shift = cell?.shiftId ? shifts.get(str(cell.shiftId)) : undefined;
        return {
          employeeId: str(peer.id),
          name: str(peer.name),
          employeeNo: str(peer.employeeNo),
          scheduled: Boolean(cell),
          shiftTitle: shift ? str(shift.title) : null,
          shiftCode: shift ? str(shift.code) : null,
        };
      });
    },

    /** 离职: requests still waiting are cancelled (system). */
    async cancelOpenFor(connection: DatabaseConnection, employeeId: string) {
      const open = await connection.query
        .selectFrom('attendanceAdjustments')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('status', '=', 'pending')
        .execute();
      if (open.length)
        await connection.query
          .updateTable('attendanceAdjustments')
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where('employeeId', '=', employeeId)
          .where('status', '=', 'pending')
          .execute();
      return open.length;
    },

    approvedOvertimeHours,
    alertHours,
  };
}

export type AdjustmentService = ReturnType<typeof createAdjustmentService>;

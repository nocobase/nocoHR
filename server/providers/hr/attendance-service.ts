/**
 * V2-05 考勤: daily records, the monthly report, the anomaly list, the device
 * import (考勤机 Excel, matched by employee number with a preview that names
 * every bad row), recalculation, and the monthly summary's life — generated
 * as a draft, confirmed by the employee (HR for one without an account),
 * objected to within the confirmation period, locked by HR and unlocked only
 * by hr.admin with a reason.
 *
 * Every entry authorizes a `talent.attendanceRecord` action first and reads
 * employees through that grant (hr.manager: managed departments; employee:
 * self), then reads those employees' attendance data. Nothing here edits a
 * record by hand: changes go through the engine.
 */
import type { DatabaseConnection } from '@nocobase/db';
import * as XLSX from 'xlsx';
import { z } from 'zod';

import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
} from './attendance-config.js';
import type { AttendanceEngine } from './attendance-engine.js';
import {
  authorizeAction,
  policyOf,
  tryAuthorizeAction,
  type CollectionPolicies,
} from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { lockAttendanceSettings } from './attendance-settings.js';
import type { ComputePunch } from './attendance-compute.js';
import type { Platform } from './platform.js';
import { zonedInstant } from './leave-duration.js';
import { addDays, HrError, newId, str } from './shared.js';

const RESOURCE = 'talent.attendanceRecord';
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const date = z.iso.date();

export function json<T>(value: unknown, fallback: T): T {
  if (Array.isArray(value) || (value && typeof value === 'object'))
    return value as T;
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
const iso = (value: unknown) =>
  value == null ? null : new Date(str(value)).toISOString();

/** 人事助理的追问 on an attendance record; the reply is the employee's own words. */
export interface AttendanceInquiry {
  askedAt: string;
  /** feishu: asked the employee in a bot chat; head: reminded the department head instead. */
  channel: 'feishu' | 'dingtalk' | 'wecom' | 'head';
  reply: string | null;
  repliedAt: string | null;
  draftAdjustmentId: string | null;
  /** The records asked about together (consecutive missed punches merge into one question). */
  recordIds?: string[];
  /** When the no-reply reminder went to the employee and the head. */
  remindedAt?: string | null;
}

export function presentInquiry(value: unknown): AttendanceInquiry | null {
  const inquiry = json<AttendanceInquiry | null>(value, null);
  if (!inquiry || typeof inquiry !== 'object' || !inquiry.askedAt) return null;
  return {
    askedAt: inquiry.askedAt,
    channel: inquiry.channel,
    reply: inquiry.reply ?? null,
    repliedAt: inquiry.repliedAt ?? null,
    draftAdjustmentId: inquiry.draftAdjustmentId ?? null,
    remindedAt: inquiry.remindedAt ?? null,
  };
}

export function monthDays(value: string): { from: string; to: string } {
  const [y, m] = value.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${value}-01`,
    to: `${value}-${String(last).padStart(2, '0')}`,
  };
}

export function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new HrError('INVALID_INPUT', 400, {
      fields: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
  return parsed.data;
}

export interface Objection {
  note: string;
  at: string;
  handledBy: string | null;
  result: string | null;
}

export interface ImportRow {
  row: number;
  employeeNo: string;
  name: string | null;
  at: string | null;
  employeeId: string | null;
  errors: string[];
}

export function createAttendanceService(deps: {
  readonly platform: Platform;
  readonly engine: AttendanceEngine;
  /** hr.admin holders, told about objections. */
  readonly hrRecipients: () => Promise<string[]>;
}) {
  const { platform, engine } = deps;
  const { database, timeZone } = platform;

  async function employeesFor(
    ctx: ActorContext,
    action: string,
    filter?: { departmentId?: string; employeeIds?: readonly string[] },
  ) {
    const policies = await authorizeAction(ctx.authz, RESOURCE, action);
    let departmentIds: string[] | undefined;
    if (filter?.departmentId) {
      // A department includes its sub-departments.
      const tree = await platform.organization.listTree();
      const ids = new Set([filter.departmentId]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const d of tree)
          if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
            ids.add(d.id);
            grew = true;
          }
      }
      departmentIds = [...ids];
    }
    const rows = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findMany({
        filter: (f) =>
          f.and([
            ...(departmentIds
              ? [
                  f.or(
                    departmentIds.map((id) => f.string('departmentId').eq(id)),
                  ),
                ]
              : []),
            ...(filter?.employeeIds
              ? [f.or(filter.employeeIds.map((id) => f.string('id').eq(id)))]
              : []),
          ]),
        sort: (s) => s.field('employeeNo').asc(),
        limit: 2001,
      });
    if (rows.length > 2000) throw new HrError('SCOPE_TOO_LARGE', 400);
    return {
      policies,
      employees: rows.map((row) => ({
        id: str(row.id),
        employeeNo: str(row.employeeNo),
        name: str(row.name),
        departmentId: str(row.departmentId),
        userId: row.userId ? str(row.userId) : null,
        status: str(row.status),
        hireDate: row.hireDate ? day(row.hireDate) : null,
        leaveDate: row.leaveDate ? day(row.leaveDate) : null,
      })),
    };
  }

  async function limits() {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', 'attendance.limits')
      .executeTakeFirst();
    return attendanceConfigSchemas.limits.parse(
      json(row?.value, attendanceConfigDefaults.limits),
    );
  }

  function presentRecord(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      employeeId: str(row.employeeId),
      date: day(row.date),
      shiftId: row.shiftId ? str(row.shiftId) : null,
      punches: json<ComputePunch[]>(row.punches, []).map((p) => ({
        at: p.at,
        source: p.source,
      })),
      checkIn: iso(row.checkIn),
      checkOut: iso(row.checkOut),
      status: str(row.status),
      lateMinutes: row.lateMinutes == null ? null : Number(row.lateMinutes),
      earlyMinutes: row.earlyMinutes == null ? null : Number(row.earlyMinutes),
      workedMinutes:
        row.workedMinutes == null ? null : Number(row.workedMinutes),
      overtimeMinutes:
        row.overtimeMinutes == null ? null : Number(row.overtimeMinutes),
      leaveRequestId: row.leaveRequestId ? str(row.leaveRequestId) : null,
      // 已说明: an approved 考勤异常说明 covers this late / early day.
      excusedByAdjustmentId: row.excusedByAdjustmentId
        ? str(row.excusedByAdjustmentId)
        : null,
      inquiry: presentInquiry(row.inquiry),
      computedAt: iso(row.computedAt),
    };
  }

  function presentSummary(row: Record<string, unknown>, confirmBy: string) {
    return {
      id: str(row.id),
      employeeId: str(row.employeeId),
      month: str(row.month),
      scheduledDays: Number(row.scheduledDays),
      workedDays: Number(row.workedDays),
      lateCount: Number(row.lateCount),
      earlyCount: Number(row.earlyCount),
      missingCount: Number(row.missingCount),
      absentDays: Number(row.absentDays),
      leaveByType: json<Record<string, number>>(row.leaveByType, {}),
      overtimeByType: json<Record<string, number>>(row.overtimeByType, {}),
      nightShiftCount: Number(row.nightShiftCount),
      shiftCounts: json<Record<string, number>>(row.shiftCounts, {}),
      status: str(row.status),
      objection: json<Objection | null>(row.objection, null),
      confirmedAt: iso(row.confirmedAt),
      lockedBy: row.lockedBy ? str(row.lockedBy) : null,
      lockedAt: iso(row.lockedAt),
      lockLog: json<unknown[]>(row.lockLog, []),
      confirmBy,
      updatedAt: iso(row.updatedAt),
    };
  }

  /** Whether the employee's attendance rule excuses an explained late / early day (default true). */
  async function exceptionExcusable(
    connection: DatabaseConnection,
    employeeId: string,
  ): Promise<boolean> {
    const employee = await connection.query
      .selectFrom('employees')
      .select(['departmentId'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!employee?.departmentId) return true;
    const [rules, tree] = await Promise.all([
      connection.query
        .selectFrom('attendanceRules')
        .select(['departmentIds', 'exceptionExcusable'])
        .where('active', '=', true)
        .execute(),
      platform.organization.listTree(connection),
    ]);
    const parent = new Map(tree.map((d) => [d.id, d.parentId]));
    for (
      let cursor: string | null | undefined = str(employee.departmentId), i = 0;
      cursor && i < 50;
      cursor = parent.get(cursor), i++
    ) {
      const rule = rules.find((r) =>
        json<string[]>(r.departmentIds, []).includes(cursor),
      );
      if (rule)
        return rule.exceptionExcusable == null
          ? true
          : Boolean(rule.exceptionExcusable);
    }
    return true;
  }

  /** The figures of one employee's month, from records, schedules, leave and overtime. */
  async function summaryFigures(
    connection: DatabaseConnection,
    employeeId: string,
    value: string,
  ) {
    const { from, to } = monthDays(value);
    const q = connection.query;
    const [records, schedules, leaves, overtime] = await Promise.all([
      q
        .selectFrom('attendanceRecords')
        .select(['status', 'excusedByAdjustmentId'])
        .where('employeeId', '=', employeeId)
        .where('date', '>=', from)
        .where('date', '<=', to)
        .execute(),
      q
        .selectFrom('shiftSchedules')
        .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
        .select(['shifts.code as code', 'shifts.isNight as isNight'])
        .where('shiftSchedules.employeeId', '=', employeeId)
        .where('shiftSchedules.date', '>=', from)
        .where('shiftSchedules.date', '<=', to)
        .execute(),
      q
        .selectFrom('leaveRequests')
        .innerJoin('leaveTypes', 'leaveTypes.id', 'leaveRequests.leaveTypeId')
        .select([
          'leaveTypes.code as code',
          'leaveRequests.duration as duration',
          'leaveRequests.approvals as approvals',
        ])
        .where('leaveRequests.employeeId', '=', employeeId)
        .where('leaveRequests.status', '=', 'approved')
        .execute(),
      q
        .selectFrom('attendanceAdjustments')
        .select(['details'])
        .where('employeeId', '=', employeeId)
        .where('type', '=', 'overtime')
        .where('status', '=', 'approved')
        .where('date', '>=', from)
        .where('date', '<=', to)
        .execute(),
    ]);
    const count = (status: string) =>
      records.filter((r) => str(r.status) === status).length;
    // 允许说明豁免: an approved 考勤异常说明 keeps the day out of the late / early counts.
    const excusable = await exceptionExcusable(connection, employeeId);
    const anomalies = (status: string) =>
      records.filter(
        (r) =>
          str(r.status) === status && !(excusable && r.excusedByAdjustmentId),
      ).length;
    const leaveByType: Record<string, number> = {};
    for (const leave of leaves) {
      const first = json<{ leaveDates?: string[]; balanceDays?: number }[]>(
        leave.approvals,
        [],
      )[0];
      const dates = first?.leaveDates ?? [];
      if (!dates.length) continue;
      const inMonth = dates.filter((d) => d >= from && d <= to).length;
      if (!inMonth) continue;
      const days = first?.balanceDays ?? Number(leave.duration);
      const code = str(leave.code);
      leaveByType[code] =
        Math.round(
          ((leaveByType[code] ?? 0) + (days * inMonth) / dates.length) * 100,
        ) / 100;
    }
    const overtimeByType: Record<string, number> = {};
    for (const row of overtime) {
      const d = json<{ overtimeType?: string; hours?: number }>(
        row.details,
        {},
      );
      const type = d.overtimeType ?? 'workday';
      overtimeByType[type] =
        Math.round(((overtimeByType[type] ?? 0) + Number(d.hours ?? 0)) * 100) /
        100;
    }
    const shiftCounts: Record<string, number> = {};
    for (const s of schedules)
      shiftCounts[str(s.code)] = (shiftCounts[str(s.code)] ?? 0) + 1;
    return {
      scheduledDays: schedules.length,
      workedDays: count('normal') + count('late') + count('earlyLeave'),
      lateCount: anomalies('late'),
      earlyCount: anomalies('earlyLeave'),
      missingCount: count('missingPunch'),
      absentDays: count('absent'),
      leaveByType,
      overtimeByType,
      nightShiftCount: schedules.filter((s) => Boolean(s.isNight)).length,
      shiftCounts,
    };
  }

  async function writeFigures(
    connection: DatabaseConnection,
    employeeId: string,
    value: string,
    existingId: string | null,
  ) {
    const figures = await summaryFigures(connection, employeeId, value);
    const stamp = new Date();
    const values = {
      ...figures,
      leaveByType: figures.leaveByType,
      overtimeByType: figures.overtimeByType,
      shiftCounts: figures.shiftCounts,
      updatedAt: stamp,
    };
    if (existingId)
      await connection.query
        .updateTable('attendanceMonthlySummaries')
        .set(values)
        .where('id', '=', existingId)
        .execute();
    else
      await connection.query
        .insertInto('attendanceMonthlySummaries')
        .values({
          id: newId(),
          employeeId,
          month: value,
          ...values,
          status: 'draft',
          objection: null,
          confirmedAt: null,
          lockedBy: null,
          lockedAt: null,
          lockLog: null,
          createdAt: stamp,
        })
        .execute();
  }

  async function summaryFor(ctx: ActorContext, action: string, id: string) {
    const row = await database
      .query()
      .selectFrom('attendanceMonthlySummaries')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('NOT_FOUND', 404);
    const { employees } = await employeesFor(ctx, action, {
      employeeIds: [str(row.employeeId)],
    });
    if (!employees.length) throw new HrError('NOT_FOUND', 404);
    return { row, employee: employees[0] };
  }

  function parseWorkbook(buffer: Uint8Array): Omit<ImportRow, 'employeeId'>[] {
    let book: XLSX.WorkBook;
    try {
      book = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new HrError('IMPORT_FILE_INVALID', 400);
    }
    const sheet = book.Sheets[book.SheetNames[0] ?? ''];
    if (!sheet) throw new HrError('IMPORT_FILE_INVALID', 400);
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });
    if (rows.length > 20_000) throw new HrError('SCOPE_TOO_LARGE', 400);
    const pick = (row: Record<string, unknown>, ...keys: string[]) => {
      for (const key of keys)
        if (row[key] != null && row[key] !== '') return row[key];
      return null;
    };
    return rows.map((row, index) => {
      const errors: string[] = [];
      const employeeNo = str(pick(row, '工号', 'employeeNo') ?? '').trim();
      if (!employeeNo) errors.push('EMPLOYEE_NO_REQUIRED');
      const raw = pick(row, '打卡时间', 'punchTime', 'at');
      let at: string | null = null;
      if (raw instanceof Date && Number.isFinite(raw.getTime())) {
        // Excel stores wall time; read it in the application's time zone.
        const wall = new Date(raw.getTime() - raw.getTimezoneOffset() * 60_000)
          .toISOString()
          .slice(0, 16);
        at = new Date(
          zonedInstant(wall.slice(0, 10), wall.slice(11, 16), timeZone),
        ).toISOString();
      } else if (typeof raw === 'string') {
        const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/u.exec(raw.trim());
        if (match)
          try {
            at = new Date(
              zonedInstant(match[1], match[2], timeZone),
            ).toISOString();
          } catch {
            at = null;
          }
      }
      if (!at) errors.push('PUNCH_TIME_INVALID');
      const name = pick(row, '姓名', 'name');
      return {
        row: index + 2,
        employeeNo,
        name: name == null ? null : str(name),
        at,
        errors,
      };
    });
  }

  async function preview(ctx: ActorContext, buffer: Uint8Array) {
    const parsed = parseWorkbook(buffer);
    const { employees } = await employeesFor(ctx, 'import');
    const byNo = new Map(employees.map((e) => [e.employeeNo, e]));
    const seen = new Set<string>();
    const rows: ImportRow[] = parsed.map((row) => {
      const employee = byNo.get(row.employeeNo);
      const errors = [...row.errors];
      if (row.employeeNo && !employee) errors.push('EMPLOYEE_NOT_FOUND');
      if (employee && row.name && row.name.trim() !== employee.name)
        errors.push('NAME_MISMATCH');
      const key = `${row.employeeNo}:${row.at}`;
      if (row.at && seen.has(key)) errors.push('DUPLICATE_PUNCH');
      seen.add(key);
      return { ...row, employeeId: employee?.id ?? null, errors };
    });
    return {
      rows,
      valid: rows.filter((r) => !r.errors.length).length,
      invalid: rows.filter((r) => r.errors.length).length,
    };
  }

  return {
    /** Engine access for the automations and approvals. */
    summaryFigures,

    async daily(ctx: ActorContext, input: unknown) {
      const body = parseInput(
        z
          .object({
            from: date,
            to: date,
            departmentId: z.string().min(1).max(64).optional(),
            employeeId: z.string().min(1).max(64).optional(),
            status: z.string().max(20).optional(),
          })
          .strict(),
        input,
      );
      if (body.to < body.from || addDays(body.from, 62) < body.to)
        throw new HrError('INVALID_DATE_RANGE', 400);
      const { employees } = await employeesFor(ctx, 'view', {
        departmentId: body.departmentId,
        employeeIds: body.employeeId ? [body.employeeId] : undefined,
      });
      if (!employees.length) return { employees: [], records: [] };
      let query = database
        .query()
        .selectFrom('attendanceRecords')
        .selectAll()
        .where(
          'employeeId',
          'in',
          employees.map((e) => e.id),
        )
        .where('date', '>=', body.from)
        .where('date', '<=', body.to);
      if (body.status) query = query.where('status', '=', body.status);
      const records = await query
        .orderBy('date', 'asc')
        .limit(20_001)
        .execute();
      return {
        employees,
        records: records.slice(0, 20_000).map(presentRecord),
        truncated: records.length > 20_000,
      };
    },

    async monthly(ctx: ActorContext, input: unknown) {
      const body = parseInput(
        z
          .object({
            month,
            departmentId: z.string().min(1).max(64).optional(),
            status: z.enum(['draft', 'confirmed', 'locked']).optional(),
          })
          .strict(),
        input,
      );
      const { employees } = await employeesFor(ctx, 'view', {
        departmentId: body.departmentId,
      });
      if (!employees.length) return { employees: [], summaries: [] };
      let query = database
        .query()
        .selectFrom('attendanceMonthlySummaries')
        .selectAll()
        .where(
          'employeeId',
          'in',
          employees.map((e) => e.id),
        )
        .where('month', '=', body.month);
      if (body.status) query = query.where('status', '=', body.status);
      const rows = await query.execute();
      const byId = new Map(employees.map((e) => [e.id, e]));
      return {
        employees,
        summaries: rows.map((row) =>
          presentSummary(
            row,
            byId.get(str(row.employeeId))?.userId ? 'employee' : 'hr',
          ),
        ),
      };
    },

    /** 异常列表, and what 月底核对 gathers: unresolved anomalies, open requests, near-limit overtime, unconfirmed summaries. */
    async issues(ctx: ActorContext, input: unknown) {
      const body = parseInput(
        z
          .object({ month, departmentId: z.string().min(1).max(64).optional() })
          .strict(),
        input,
      );
      const { employees } = await employeesFor(ctx, 'view', {
        departmentId: body.departmentId,
      });
      return listIssues(database.connection(), employees, body.month);
    },

    async preview(ctx: ActorContext, buffer: Uint8Array) {
      return preview(ctx, buffer);
    },

    /** Imports the valid rows only when the preview has no errors, unless `skipInvalid`. */
    async importPunches(
      ctx: ActorContext,
      buffer: Uint8Array,
      options: { skipInvalid: boolean },
    ) {
      const result = await preview(ctx, buffer);
      if (result.invalid && !options.skipInvalid)
        throw new HrError('IMPORT_HAS_ERRORS', 400, {
          invalid: result.invalid,
        });
      const byEmployee = new Map<string, ComputePunch[]>();
      let from = '9999-12-31';
      let to = '0000-01-01';
      for (const row of result.rows) {
        if (row.errors.length || !row.employeeId || !row.at) continue;
        const list = byEmployee.get(row.employeeId) ?? [];
        list.push({ at: row.at, source: 'device' });
        byEmployee.set(row.employeeId, list);
        const local = new Intl.DateTimeFormat('en-CA', { timeZone }).format(
          new Date(row.at),
        );
        if (local < from) from = local;
        if (local > to) to = local;
      }
      if (!byEmployee.size)
        return { imported: 0, computed: 0, skippedLocked: 0 };
      // A night shift's morning punch belongs to the day before.
      const outcome = await database.transaction(async (connection) => {
        await lockAttendanceSettings(connection, ctx.userId);
        return engine.recompute(connection, {
          employeeIds: [...byEmployee.keys()],
          from: addDays(from, -1),
          to,
          addPunches: byEmployee,
        });
      });
      return {
        imported: result.valid,
        computed: outcome.computed,
        skippedLocked: outcome.skippedLocked,
      };
    },

    async recompute(ctx: ActorContext, input: unknown) {
      const body = parseInput(
        z
          .object({
            from: date,
            to: date,
            departmentId: z.string().min(1).max(64).optional(),
            employeeIds: z.array(z.string().min(1).max(64)).max(500).optional(),
          })
          .strict(),
        input,
      );
      if (body.to < body.from || addDays(body.from, 62) < body.to)
        throw new HrError('INVALID_DATE_RANGE', 400);
      const { employees } = await employeesFor(ctx, 'recompute', {
        departmentId: body.departmentId,
        employeeIds: body.employeeIds,
      });
      const result = await database.transaction(async (connection) => {
        await lockAttendanceSettings(connection, ctx.userId);
        return engine.recompute(connection, {
          employeeIds: employees.map((e) => e.id),
          from: body.from,
          to: body.to,
        });
      });
      // 重新计算 also refreshes the months' draft summaries (confirmed and locked ones stay as they are).
      const months = [...new Set([body.from.slice(0, 7), body.to.slice(0, 7)])];
      const drafts = employees.length
        ? await database
            .query()
            .selectFrom('attendanceMonthlySummaries')
            .select(['id', 'employeeId', 'month'])
            .where(
              'employeeId',
              'in',
              employees.map((e) => e.id),
            )
            .where('month', 'in', months)
            .where('status', '=', 'draft')
            .execute()
        : [];
      for (const summary of drafts)
        await database.transaction((connection) =>
          writeFigures(
            connection,
            str(summary.employeeId),
            str(summary.month),
            str(summary.id),
          ),
        );
      return { ...result, summariesRefreshed: drafts.length };
    },

    /** 我的考勤: the signed-in employee's month — schedule, records, summary. */
    async mine(ctx: ActorContext, input: unknown) {
      const body = parseInput(z.object({ month }).strict(), input);
      const own = await database
        .query()
        .selectFrom('employees')
        .select(['id'])
        .where('userId', '=', ctx.userId)
        .executeTakeFirst();
      if (!own) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const { employees } = await employeesFor(ctx, 'view', {
        employeeIds: [str(own.id)],
      });
      if (!employees.length) throw new HrError('NOT_FOUND', 404);
      const { from, to } = monthDays(body.month);
      const q = database.query();
      const [schedules, records, summary, adjustments] = await Promise.all([
        q
          .selectFrom('shiftSchedules')
          .select(['date', 'shiftId'])
          .where('employeeId', '=', str(own.id))
          // Employees see published schedules only.
          .where('status', '=', 'published')
          .where('date', '>=', from)
          .where('date', '<=', to)
          .orderBy('date', 'asc')
          .execute(),
        q
          .selectFrom('attendanceRecords')
          .selectAll()
          .where('employeeId', '=', str(own.id))
          .where('date', '>=', from)
          .where('date', '<=', to)
          .orderBy('date', 'asc')
          .execute(),
        q
          .selectFrom('attendanceMonthlySummaries')
          .selectAll()
          .where('employeeId', '=', str(own.id))
          .where('month', '=', body.month)
          .executeTakeFirst(),
        q
          .selectFrom('attendanceAdjustments')
          .select(['type', 'date', 'status'])
          .where('employeeId', '=', str(own.id))
          .where('date', '>=', from)
          .where('date', '<=', to)
          .execute(),
      ]);
      const config = await limits();
      // Rest days have no shift: read shifts on their own (a left join would null non-null columns).
      const shiftIds = [
        ...new Set(
          schedules.flatMap((s) => (s.shiftId ? [str(s.shiftId)] : [])),
        ),
      ];
      const shifts = new Map(
        (shiftIds.length
          ? await q
              .selectFrom('shifts')
              .selectAll()
              .where('id', 'in', shiftIds)
              .execute()
          : []
        ).map((row) => [str(row.id), row]),
      );
      return {
        employee: employees[0],
        schedules: schedules.map((s) => {
          const shift = s.shiftId ? shifts.get(str(s.shiftId)) : undefined;
          return {
            date: day(s.date),
            shiftId: s.shiftId ? str(s.shiftId) : null,
            code: shift ? str(shift.code) : null,
            title: shift ? str(shift.title) : null,
            startTime: shift ? str(shift.startTime).slice(0, 5) : null,
            endTime: shift ? str(shift.endTime).slice(0, 5) : null,
            isNight: Boolean(shift?.isNight),
          };
        }),
        records: records.map(presentRecord),
        summary: summary ? presentSummary(summary, 'employee') : null,
        missingPunchUsed: adjustments.filter(
          (a) =>
            str(a.type) === 'missingPunch' &&
            ['pending', 'approved'].includes(str(a.status)),
        ).length,
        missingPunchLimit: config.monthlyMissingPunchLimit,
        confirmationDays: config.monthlyConfirmationDays,
      };
    },

    /** Generates the month's drafts (每月 1 日); an existing summary is never regenerated here. */
    async generateSummaries(value: string) {
      const { from, to } = monthDays(value);
      const q = database.query();
      const [employees, existing] = await Promise.all([
        q
          .selectFrom('employees')
          .select(['id', 'userId', 'hireDate', 'leaveDate'])
          .execute(),
        q
          .selectFrom('attendanceMonthlySummaries')
          .select(['employeeId'])
          .where('month', '=', value)
          .execute(),
      ]);
      const done = new Set(existing.map((e) => str(e.employeeId)));
      const active = [
        ...(await q
          .selectFrom('shiftSchedules')
          .select(['employeeId'])
          .where('date', '>=', from)
          .where('date', '<=', to)
          .execute()),
        ...(await q
          .selectFrom('attendanceRecords')
          .select(['employeeId'])
          .where('date', '>=', from)
          .where('date', '<=', to)
          .execute()),
      ];
      const withData = new Set(active.map((a) => str(a.employeeId)));
      const created: { employeeId: string; userId: string | null }[] = [];
      for (const employee of employees) {
        const id = str(employee.id);
        if (done.has(id) || !withData.has(id)) continue;
        if (employee.hireDate && day(employee.hireDate) > to) continue;
        if (employee.leaveDate && day(employee.leaveDate) < from) continue;
        await database.transaction((connection) =>
          writeFigures(connection, id, value, null),
        );
        created.push({
          employeeId: id,
          userId: employee.userId ? str(employee.userId) : null,
        });
      }
      const config = await limits();
      for (const item of created)
        if (item.userId)
          await platform.notify({
            key: `attendanceSummary:${item.employeeId}:${value}`,
            userIds: [item.userId],
            message: 'attendanceSummaryReady',
            params: {
              month: value,
              days: String(config.monthlyConfirmationDays),
            },
            path: `/talent/me?month=${value}#attendance`,
          });
      return { created: created.length };
    },

    async confirm(ctx: ActorContext, id: string) {
      const { row, employee } = await summaryFor(ctx, 'view', id);
      const hr = await tryAuthorizeAction(ctx.authz, RESOURCE, 'lock');
      const self = employee.userId === ctx.userId;
      // 无账号员工由 HR 代为确认.
      if (!self && !(hr && !employee.userId))
        throw new HrError('FORBIDDEN', 403);
      if (str(row.status) !== 'draft')
        throw new HrError('SUMMARY_STATE_CONFLICT', 409);
      const objection = json<Objection | null>(row.objection, null);
      if (objection && !objection.handledBy)
        throw new HrError('SUMMARY_OBJECTION_OPEN', 409);
      const stamp = new Date();
      await database
        .query()
        .updateTable('attendanceMonthlySummaries')
        .set({ status: 'confirmed', confirmedAt: stamp, updatedAt: stamp })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .execute();
      return (await summaryFor(ctx, 'view', id)).row;
    },

    /** An objection within the confirmation period, by the employee (or HR for one without an account). */
    async object(ctx: ActorContext, id: string, input: unknown) {
      const { note } = parseInput(
        z.object({ note: z.string().trim().min(1).max(1000) }).strict(),
        input,
      );
      const { row, employee } = await summaryFor(ctx, 'view', id);
      if (employee.userId !== ctx.userId) throw new HrError('FORBIDDEN', 403);
      if (str(row.status) !== 'draft')
        throw new HrError('SUMMARY_STATE_CONFLICT', 409);
      const config = await limits();
      const deadline =
        new Date(str(row.createdAt)).getTime() +
        config.monthlyConfirmationDays * 86_400_000;
      if (Date.now() > deadline)
        throw new HrError('SUMMARY_CONFIRMATION_CLOSED', 409);
      const existing = json<Objection | null>(row.objection, null);
      if (existing && !existing.handledBy)
        throw new HrError('SUMMARY_OBJECTION_OPEN', 409);
      await database
        .query()
        .updateTable('attendanceMonthlySummaries')
        .set({
          objection: {
            note,
            at: new Date().toISOString(),
            handledBy: null,
            result: null,
          },
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      const hrIds = await deps.hrRecipients();
      if (hrIds.length)
        await platform.notify({
          key: `attendanceObjection:${id}:${Date.now()}`,
          userIds: hrIds,
          message: 'attendanceObjection',
          params: { name: employee.name, month: str(row.month) },
          path: `/talent/attendance?tab=monthly&month=${str(row.month)}`,
        });
      return (await summaryFor(ctx, 'view', id)).row;
    },

    /** HR handles an objection: recalculates the month from current records and notes the result. */
    async handleObjection(ctx: ActorContext, id: string, input: unknown) {
      const { result } = parseInput(
        z.object({ result: z.string().trim().min(1).max(1000) }).strict(),
        input,
      );
      await authorizeAction(ctx.authz, RESOURCE, 'lock');
      const { row, employee } = await summaryFor(ctx, 'lock', id);
      if (str(row.status) === 'locked') throw new HrError('MONTH_LOCKED', 409);
      const objection = json<Objection | null>(row.objection, null);
      if (!objection || objection.handledBy)
        throw new HrError('SUMMARY_STATE_CONFLICT', 409);
      await database.transaction(async (connection) => {
        await writeFigures(connection, employee.id, str(row.month), id);
        await connection.query
          .updateTable('attendanceMonthlySummaries')
          .set({
            objection: {
              ...objection,
              handledBy: ctx.userId,
              result,
            },
            updatedAt: new Date(),
          })
          .where('id', '=', id)
          .execute();
      });
      if (employee.userId)
        await platform.notify({
          key: `attendanceObjectionHandled:${id}:${objection.at}`,
          userIds: [employee.userId],
          message: 'attendanceObjectionHandled',
          params: { month: str(row.month), result },
          path: `/talent/me?month=${str(row.month)}#attendance`,
        });
      return (await summaryFor(ctx, 'lock', id)).row;
    },

    /** 锁定: the month's figures are refreshed one last time and frozen for payroll. */
    async lock(ctx: ActorContext, input: unknown) {
      const body = parseInput(
        z
          .object({ ids: z.array(z.string().min(1).max(64)).min(1).max(2000) })
          .strict(),
        input,
      );
      const locked: string[] = [];
      const refused: { id: string; code: string }[] = [];
      for (const id of body.ids) {
        const { row, employee } = await summaryFor(ctx, 'lock', id);
        const objection = json<Objection | null>(row.objection, null);
        if (str(row.status) === 'locked') continue;
        if (objection && !objection.handledBy) {
          refused.push({ id, code: 'SUMMARY_OBJECTION_OPEN' });
          continue;
        }
        const stamp = new Date();
        const log = json<unknown[]>(row.lockLog, []);
        await database.transaction(async (connection) => {
          await writeFigures(connection, employee.id, str(row.month), id);
          await connection.query
            .updateTable('attendanceMonthlySummaries')
            .set({
              status: 'locked',
              lockedBy: ctx.userId,
              lockedAt: stamp,
              lockLog: [
                ...log,
                { action: 'lock', by: ctx.userId, at: stamp.toISOString() },
              ],
              updatedAt: stamp,
            })
            .where('id', '=', id)
            .execute();
        });
        locked.push(id);
      }
      return { locked, refused };
    },

    async unlock(ctx: ActorContext, id: string, input: unknown) {
      const { reason } = parseInput(
        z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
        input,
      );
      const { row } = await summaryFor(ctx, 'unlock', id);
      if (str(row.status) !== 'locked')
        throw new HrError('SUMMARY_STATE_CONFLICT', 409);
      const stamp = new Date();
      await database
        .query()
        .updateTable('attendanceMonthlySummaries')
        .set({
          // Back to draft: it is confirmed and locked again after the correction.
          status: row.confirmedAt ? 'confirmed' : 'draft',
          lockedBy: null,
          lockedAt: null,
          lockLog: [
            ...json<unknown[]>(row.lockLog, []),
            {
              action: 'unlock',
              by: ctx.userId,
              at: stamp.toISOString(),
              reason,
            },
          ],
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      return (await summaryFor(ctx, 'unlock', id)).row;
    },

    /**
     * 模拟考勤机导出 (dev only): the machining workshop's punches for the
     * three days before today, from their schedules (including people who
     * have since transferred out) — 李敏 12 minutes late
     * two days ago, 钱进 without a check-out on the last two days, a night
     * shift punching out the next morning, and a row with an unknown number.
     */
    async demoWorkbook(ctx: ActorContext): Promise<Buffer> {
      if (process.env.NODE_ENV === 'production')
        throw new HrError('NOT_FOUND', 404);
      const today = platform.currentDate();
      // Whoever was in the workshop on those days: its members now, plus
      // anyone who left it since (李敏's transfer runs before this step).
      const movedOut = await database
        .query()
        .selectFrom('jobEvents')
        .select(['employeeId'])
        .where('fromDepartmentId', '=', 'sz-mc')
        .where('effectiveDate', '>=', addDays(today, -3))
        .execute();
      const { employees: current } = await employeesFor(ctx, 'import', {
        departmentId: 'sz-mc',
      });
      const { employees: moved } = movedOut.length
        ? await employeesFor(ctx, 'import', {
            employeeIds: movedOut.map((row) => str(row.employeeId)),
          })
        : { employees: [] };
      const employees = [
        ...current,
        ...moved.filter((m) => !current.some((c) => c.id === m.id)),
      ];
      const rows: (string | null)[][] = [['工号', '姓名', '打卡时间']];
      const wall = (instant: number) =>
        new Intl.DateTimeFormat('sv-SE', {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(instant));
      for (let offset = -3; offset <= -1; offset++) {
        const on = addDays(today, offset);
        for (const employee of employees) {
          const cell = await database
            .query()
            .selectFrom('shiftSchedules')
            .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
            .select([
              'shifts.startTime as startTime',
              'shifts.endTime as endTime',
            ])
            .where('shiftSchedules.employeeId', '=', employee.id)
            .where('shiftSchedules.date', '=', on)
            .executeTakeFirst();
          if (!cell) continue;
          const start = zonedInstant(
            on,
            str(cell.startTime).slice(0, 5),
            timeZone,
          );
          const endTime = str(cell.endTime).slice(0, 5);
          const end = zonedInstant(
            endTime < str(cell.startTime).slice(0, 5) ? addDays(on, 1) : on,
            endTime,
            timeZone,
          );
          const late = employee.employeeNo === 'QH2002' && offset === -2;
          const missingOut = employee.employeeNo === 'QH2003' && offset >= -2;
          rows.push([
            employee.employeeNo,
            employee.name,
            wall(start + (late ? 12 : -6) * 60_000),
          ]);
          if (!missingOut)
            rows.push([
              employee.employeeNo,
              employee.name,
              wall(end + 4 * 60_000),
            ]);
        }
      }
      rows.push(['QH9999', '不存在', `${addDays(today, -1)} 08:00`]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet(rows),
        '打卡记录',
      );
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    },

    presentSummary,
    presentRecord,
  };
}

/** Unresolved anomalies, open requests, overtime near the alert line, unconfirmed or objected summaries. */
export async function listIssues(
  connection: DatabaseConnection,
  employees: readonly {
    id: string;
    name: string;
    departmentId: string;
    userId: string | null;
  }[],
  value: string,
) {
  if (!employees.length)
    return { anomalies: [], openRequests: [], overtime: [], summaries: [] };
  const ids = employees.map((e) => e.id);
  const byId = new Map(employees.map((e) => [e.id, e]));
  const { from, to } = monthDays(value);
  const q = connection.query;
  const [records, adjustments, leaves, summaries, rules] = await Promise.all([
    q
      .selectFrom('attendanceRecords')
      .select([
        'id',
        'employeeId',
        'date',
        'status',
        'lateMinutes',
        'earlyMinutes',
        'excusedByAdjustmentId',
        'inquiry',
      ])
      .where('employeeId', 'in', ids)
      .where('date', '>=', from)
      .where('date', '<=', to)
      .where('status', 'in', ['late', 'earlyLeave', 'missingPunch', 'absent'])
      .execute(),
    q
      .selectFrom('attendanceAdjustments')
      .select(['id', 'employeeId', 'date', 'type', 'status', 'details'])
      .where('employeeId', 'in', ids)
      .where('date', '>=', from)
      .where('date', '<=', to)
      .execute(),
    q
      .selectFrom('leaveRequests')
      .select(['id', 'employeeId', 'startAt', 'status'])
      .where('employeeId', 'in', ids)
      .where('status', '=', 'pending')
      .execute(),
    q
      .selectFrom('attendanceMonthlySummaries')
      .select(['id', 'employeeId', 'status', 'objection'])
      .where('employeeId', 'in', ids)
      .where('month', '=', value)
      .execute(),
    q
      .selectFrom('attendanceRules')
      .select(['departmentIds', 'monthlyOvertimeAlertHours'])
      .where('active', '=', true)
      .execute(),
  ]);
  // A missed punch is settled by a 补卡, a late or early day by a 考勤异常说明.
  const settles = (type: string, status: string) =>
    status === 'missingPunch' ? type === 'missingPunch' : type === 'exception';
  const requestOf = (r: Record<string, unknown>, states: string[]) =>
    adjustments.find(
      (a) =>
        str(a.employeeId) === str(r.employeeId) &&
        day(a.date) === day(r.date) &&
        settles(str(a.type), str(r.status)) &&
        states.includes(str(a.status)),
    );
  const anomalies = records
    .filter((r) => !r.excusedByAdjustmentId && !requestOf(r, ['approved']))
    .map((r) => {
      const inquiry = presentInquiry(r.inquiry);
      const pending = requestOf(r, ['pending']);
      const drafted = requestOf(r, ['draft']);
      // 月底核对: 等待审批 once a request is in; 需要 HR 跟进 when asked and never answered.
      const followUp = pending
        ? ('waitingApproval' as const)
        : drafted
          ? ('drafted' as const)
          : inquiry && !inquiry.reply
            ? ('needsHr' as const)
            : inquiry
              ? ('replied' as const)
              : null;
      return {
        recordId: str(r.id),
        employeeId: str(r.employeeId),
        name: byId.get(str(r.employeeId))?.name ?? '',
        departmentId: byId.get(str(r.employeeId))?.departmentId ?? '',
        date: day(r.date),
        status: str(r.status),
        lateMinutes: r.lateMinutes == null ? null : Number(r.lateMinutes),
        earlyMinutes: r.earlyMinutes == null ? null : Number(r.earlyMinutes),
        inquiry,
        followUp,
      };
    });
  const openRequests = [
    ...adjustments
      .filter((a) => str(a.status) === 'pending')
      .map((a) => ({
        kind: str(a.type),
        id: str(a.id),
        employeeId: str(a.employeeId),
        name: byId.get(str(a.employeeId))?.name ?? '',
        departmentId: byId.get(str(a.employeeId))?.departmentId ?? '',
        date: day(a.date),
      })),
    ...leaves.map((l) => ({
      kind: 'leave',
      id: str(l.id),
      employeeId: str(l.employeeId),
      name: byId.get(str(l.employeeId))?.name ?? '',
      departmentId: byId.get(str(l.employeeId))?.departmentId ?? '',
      date: new Date(str(l.startAt)).toISOString().slice(0, 10),
    })),
  ];
  const hours = new Map<string, number>();
  for (const a of adjustments)
    if (str(a.type) === 'overtime' && str(a.status) === 'approved')
      hours.set(
        str(a.employeeId),
        (hours.get(str(a.employeeId)) ?? 0) +
          Number(json<{ hours?: number }>(a.details, {}).hours ?? 0),
      );
  const alertLine = Math.min(
    ...rules.map((r) => Number(r.monthlyOvertimeAlertHours)),
    36,
  );
  const overtime = [...hours]
    .filter(([, h]) => h >= alertLine * 0.8)
    .map(([employeeId, h]) => ({
      employeeId,
      name: byId.get(employeeId)?.name ?? '',
      departmentId: byId.get(employeeId)?.departmentId ?? '',
      hours: Math.round(h * 100) / 100,
      alertHours: alertLine,
    }));
  const openSummaries = summaries
    .filter((s) => {
      const objection = json<{ handledBy?: string | null } | null>(
        s.objection,
        null,
      );
      return str(s.status) === 'draft' || (objection && !objection.handledBy);
    })
    .map((s) => ({
      id: str(s.id),
      employeeId: str(s.employeeId),
      name: byId.get(str(s.employeeId))?.name ?? '',
      departmentId: byId.get(str(s.employeeId))?.departmentId ?? '',
      status: str(s.status),
      objection: Boolean(json<unknown>(s.objection, null)),
    }));
  return { anomalies, openRequests, overtime, summaries: openSummaries };
}

export type AttendanceService = ReturnType<typeof createAttendanceService>;
export type { CollectionPolicies };

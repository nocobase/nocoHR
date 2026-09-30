/**
 * V2-05 考勤记录计算: rewrites `attendanceRecords` for employees and dates
 * from the schedule, the raw punches kept on the records, approved leave and
 * approved overtime. Records are never edited by hand; approvals (补卡、请假、
 * 加班、调班) and imports call this for the dates they touch.
 *
 * Punches are re-assigned each time, over a day on either side of the range,
 * so a night shift's morning punch lands on its start date even when the
 * schedule changed after the import. Locked months are left untouched.
 * Runs on the caller's connection (inside its transaction): trusted reads,
 * because the caller already authorized the employees it passes.
 */
import type { DatabaseConnection } from '@nocobase/db';

import {
  resolveAttendanceRule,
  attendanceRuleSchema,
  type AttendanceDepartment,
} from './attendance-catalog.js';
import {
  assignPunches,
  computeAttendanceDay,
  shiftInterval,
  WINDOW_AFTER_MS,
  type ComputeLeave,
  type ComputePunch,
  type ComputeShift,
} from './attendance-compute.js';
import { zonedInstant } from './leave-duration.js';
import { addDays, HrError, newId, str } from './shared.js';

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

export function localDateOf(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);

export interface RecomputeInput {
  readonly employeeIds: readonly string[];
  readonly from: string;
  readonly to: string;
  /** Raw punches to add first (imports, approved missed punches). */
  readonly addPunches?: ReadonlyMap<string, readonly ComputePunch[]>;
}

export interface RecomputeResult {
  readonly computed: number;
  readonly removed: number;
  readonly skippedLocked: number;
}

export function createAttendanceEngine(deps: {
  readonly timeZone: string;
  readonly now?: () => Date;
  readonly departments: (
    connection: DatabaseConnection,
  ) => Promise<readonly AttendanceDepartment[]>;
}) {
  const { timeZone } = deps;
  const now = deps.now ?? (() => new Date());

  async function recompute(
    connection: DatabaseConnection,
    input: RecomputeInput,
  ): Promise<RecomputeResult> {
    const employeeIds = [...new Set(input.employeeIds)];
    if (!employeeIds.length || input.to < input.from)
      return { computed: 0, removed: 0, skippedLocked: 0 };
    const q = connection.query;
    const wideFrom = addDays(input.from, -1);
    const wideTo = addDays(input.to, 1);
    const [
      employees,
      schedules,
      records,
      leaves,
      overtime,
      locked,
      ruleRows,
      exceptions,
    ] = await Promise.all([
      q
        .selectFrom('employees')
        .select(['id', 'departmentId', 'hireDate', 'leaveDate', 'status'])
        .where('id', 'in', employeeIds)
        .execute(),
      q
        .selectFrom('shiftSchedules')
        .select(['employeeId', 'date', 'shiftId'])
        .where('employeeId', 'in', employeeIds)
        .where('date', '>=', addDays(wideFrom, -1))
        .where('date', '<=', addDays(wideTo, 1))
        .execute(),
      q
        .selectFrom('attendanceRecords')
        .selectAll()
        .where('employeeId', 'in', employeeIds)
        .where('date', '>=', wideFrom)
        .where('date', '<=', wideTo)
        .execute(),
      q
        .selectFrom('leaveRequests')
        .innerJoin('leaveTypes', 'leaveTypes.id', 'leaveRequests.leaveTypeId')
        .select([
          'leaveRequests.id as id',
          'leaveRequests.employeeId as employeeId',
          'leaveRequests.startAt as startAt',
          'leaveRequests.endAt as endAt',
          'leaveRequests.approvals as approvals',
          'leaveTypes.unit as unit',
        ])
        .where('leaveRequests.employeeId', 'in', employeeIds)
        .where('leaveRequests.status', '=', 'approved')
        .execute(),
      q
        .selectFrom('attendanceAdjustments')
        .select(['employeeId', 'date', 'details'])
        .where('employeeId', 'in', employeeIds)
        .where('type', '=', 'overtime')
        .where('status', '=', 'approved')
        .where('date', '>=', wideFrom)
        .where('date', '<=', wideTo)
        .execute(),
      q
        .selectFrom('attendanceMonthlySummaries')
        .select(['employeeId', 'month'])
        .where('employeeId', 'in', employeeIds)
        .where('status', '=', 'locked')
        .execute(),
      q
        .selectFrom('attendanceRules')
        .selectAll()
        .where('active', '=', true)
        .execute(),
      // Approved 考勤异常说明: the day's late arrival or early leave is 已说明.
      q
        .selectFrom('attendanceAdjustments')
        .select(['id', 'employeeId', 'date'])
        .where('employeeId', 'in', employeeIds)
        .where('type', '=', 'exception')
        .where('status', '=', 'approved')
        .where('date', '>=', wideFrom)
        .where('date', '<=', wideTo)
        .execute(),
    ]);
    const shiftIds = [
      ...new Set(schedules.flatMap((s) => (s.shiftId ? [str(s.shiftId)] : []))),
    ];
    const shiftRows = shiftIds.length
      ? await q
          .selectFrom('shifts')
          .selectAll()
          .where('id', 'in', shiftIds)
          .execute()
      : [];
    const shifts = new Map<string, ComputeShift>(
      shiftRows.map((row) => [
        str(row.id),
        {
          id: str(row.id),
          startTime: str(row.startTime).slice(0, 5),
          endTime: str(row.endTime).slice(0, 5),
          breakMinutes: Number(row.breakMinutes ?? 0),
        },
      ]),
    );
    const departments = await deps.departments(connection);
    const rules = ruleRows.map((row) => ({
      id: str(row.id),
      ...attendanceRuleSchema.strip().parse({
        ...row,
        departmentIds: json<string[]>(row.departmentIds, []),
        active: Boolean(row.active),
        overtimeRequiresApproval: Boolean(row.overtimeRequiresApproval),
        exceptionExcusable:
          row.exceptionExcusable == null
            ? undefined
            : Boolean(row.exceptionExcusable),
      }),
    }));
    const lockedSet = new Set(
      locked.map((row) => `${str(row.employeeId)}:${str(row.month)}`),
    );
    const current = now().getTime();
    let computed = 0;
    let removed = 0;
    let skippedLocked = 0;
    for (const employee of employees) {
      const employeeId = str(employee.id);
      let rule: ReturnType<typeof resolveAttendanceRule> | null = null;
      try {
        rule = resolveAttendanceRule(
          str(employee.departmentId),
          departments,
          rules,
        );
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
      }
      const scheduleByDate = new Map(
        schedules
          .filter((s) => str(s.employeeId) === employeeId)
          .map((s) => [day(s.date), s.shiftId ? str(s.shiftId) : null]),
      );
      const windows = new Map<string, { start: number; end: number }>();
      for (const [date, shiftId] of scheduleByDate) {
        const shift = shiftId ? shifts.get(shiftId) : undefined;
        if (shift) windows.set(date, shiftInterval(date, shift, timeZone));
      }
      const own = records.filter((r) => str(r.employeeId) === employeeId);
      const rawPunches: ComputePunch[] = [
        ...own.flatMap((r) => json<ComputePunch[]>(r.punches, [])),
        ...(input.addPunches?.get(employeeId) ?? []),
      ];
      const assigned = assignPunches({
        punches: rawPunches,
        shifts: windows,
        localDate: (instant) => localDateOf(instant, timeZone),
      });
      const dates = new Set<string>();
      for (let d = wideFrom; d <= wideTo; d = addDays(d, 1)) dates.add(d);
      for (const date of assigned.keys()) dates.add(date);
      const ownLeaves: ComputeLeave[] = leaves
        .filter((l) => str(l.employeeId) === employeeId)
        .map((l) => {
          const approvals = json<{ leaveDates?: string[] }[]>(l.approvals, []);
          return {
            id: str(l.id),
            startAt: new Date(str(l.startAt)).toISOString(),
            endAt: new Date(str(l.endAt)).toISOString(),
            unit: str(l.unit) as ComputeLeave['unit'],
            dates: approvals[0]?.leaveDates ?? [],
          };
        });
      for (const date of [...dates].sort()) {
        const existing = own.find((r) => day(r.date) === date);
        const punches = assigned.get(date) ?? [];
        // Only the requested range is recomputed; the day around it only when punches moved in or out.
        const inRange = date >= input.from && date <= input.to;
        const previousPunches = json<ComputePunch[]>(existing?.punches, []);
        const moved =
          JSON.stringify(previousPunches.map((p) => p.at).sort()) !==
          JSON.stringify(punches.map((p) => p.at).sort());
        if (!inRange && !moved) continue;
        if (lockedSet.has(`${employeeId}:${date.slice(0, 7)}`)) {
          skippedLocked += 1;
          continue;
        }
        const hire = employee.hireDate ? day(employee.hireDate) : null;
        const leaveDate = employee.leaveDate ? day(employee.leaveDate) : null;
        const employed =
          (!hire || date >= hire) && (!leaveDate || date <= leaveDate);
        const shiftId = scheduleByDate.get(date) ?? null;
        const shift = shiftId ? (shifts.get(shiftId) ?? null) : null;
        const dayLeaves = ownLeaves.filter(
          (l) =>
            l.dates.includes(date) ||
            (shift &&
              Date.parse(l.startAt) < windows.get(date)!.end &&
              Date.parse(l.endAt) > windows.get(date)!.start),
        );
        const overtimeMinutes = overtime
          .filter(
            (o) => str(o.employeeId) === employeeId && day(o.date) === date,
          )
          .reduce((total, o) => {
            const d = json<{ startAt?: string; endAt?: string }>(o.details, {});
            const minutes =
              (Date.parse(d.endAt ?? '') - Date.parse(d.startAt ?? '')) /
              60_000;
            return (
              total + (Number.isFinite(minutes) && minutes > 0 ? minutes : 0)
            );
          }, 0);
        const result = computeAttendanceDay({
          date,
          shift,
          punches,
          leaves: dayLeaves,
          approvedOvertimeMinutes: Math.round(overtimeMinutes),
          rule,
          timeZone,
        });
        const end = shift
          ? windows.get(date)!.end + WINDOW_AFTER_MS
          : zonedInstant(addDays(date, 1), '00:00', timeZone);
        const due = end <= current;
        const keep =
          employed &&
          (result.status === 'leave' ||
            (due && (shift !== null || punches.length > 0)));
        if (!keep) {
          if (existing && !punches.length) {
            await q
              .deleteFrom('attendanceRecords')
              .where('id', '=', str(existing.id))
              .execute();
            removed += 1;
          } else if (
            existing &&
            (moved ||
              existing.leaveRequestId ||
              str(existing.status) === 'leave')
          ) {
            // Not due yet, but punches stay: keep them, and drop a leave that no longer applies.
            await q
              .updateTable('attendanceRecords')
              .set({
                punches: punches,
                ...(result.status === 'leave'
                  ? {}
                  : {
                      status: shift ? 'absent' : 'rest',
                      leaveRequestId: null,
                      computedAt: new Date(),
                    }),
                updatedAt: new Date(),
              })
              .where('id', '=', str(existing.id))
              .execute();
          } else if (!existing && punches.length) {
            // Punches with nowhere to go yet (a future shift) wait on a placeholder.
            const stamp = new Date();
            await q
              .insertInto('attendanceRecords')
              .values({
                id: newId(),
                employeeId,
                date,
                shiftId,
                punches: punches,
                checkIn: null,
                checkOut: null,
                status: shift ? 'absent' : 'rest',
                lateMinutes: null,
                earlyMinutes: null,
                workedMinutes: null,
                overtimeMinutes: null,
                leaveRequestId: null,
                computedAt: stamp,
                createdAt: stamp,
                updatedAt: stamp,
              })
              .execute();
          }
          continue;
        }
        const stamp = new Date();
        const excuse =
          result.status === 'late' || result.status === 'earlyLeave'
            ? exceptions.find(
                (e) => str(e.employeeId) === employeeId && day(e.date) === date,
              )
            : undefined;
        const values = {
          excusedByAdjustmentId: excuse ? str(excuse.id) : null,
          shiftId: result.shiftId,
          punches: result.punches.length ? result.punches : null,
          checkIn: result.checkIn,
          checkOut: result.checkOut,
          status: result.status,
          lateMinutes: result.lateMinutes,
          earlyMinutes: result.earlyMinutes,
          workedMinutes: result.workedMinutes,
          overtimeMinutes: result.overtimeMinutes,
          leaveRequestId: result.leaveRequestId,
          computedAt: stamp,
          updatedAt: stamp,
        };
        if (existing)
          await q
            .updateTable('attendanceRecords')
            .set(values)
            .where('id', '=', str(existing.id))
            .execute();
        else
          await q
            .insertInto('attendanceRecords')
            .values({
              id: newId(),
              employeeId,
              date,
              ...values,
              createdAt: stamp,
            })
            .execute();
        computed += 1;
      }
    }
    return { computed, removed, skippedLocked };
  }

  return { recompute };
}

export type AttendanceEngine = ReturnType<typeof createAttendanceEngine>;

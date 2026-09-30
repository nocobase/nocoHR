/**
 * V2-05 每日考勤计算: one employee's attendance day from its schedule, the
 * raw punches, approved leave and approved overtime. Pure; the engine loads
 * the inputs and writes the record. A cross-midnight shift belongs to its
 * start date, and so do the punches inside its window.
 */
import { addDays } from './shared.js';
import { zonedInstant } from './leave-duration.js';

export interface ComputeShift {
  readonly id: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: number;
}

export interface ComputePunch {
  readonly at: string;
  readonly source: string;
  readonly adjustmentId?: string;
}

export interface ComputeLeave {
  readonly id: string;
  readonly startAt: string;
  readonly endAt: string;
  /** Whole-day leave covers the dates it was counted on, shift or not. */
  readonly unit: 'day' | 'halfDay' | 'hour';
  readonly dates: readonly string[];
}

export type AttendanceStatus =
  | 'normal'
  | 'late'
  | 'earlyLeave'
  | 'missingPunch'
  | 'absent'
  | 'leave'
  | 'rest';

export interface ComputedDay {
  readonly shiftId: string | null;
  readonly punches: ComputePunch[];
  readonly checkIn: Date | null;
  readonly checkOut: Date | null;
  readonly status: AttendanceStatus;
  readonly lateMinutes: number | null;
  readonly earlyMinutes: number | null;
  readonly workedMinutes: number | null;
  readonly overtimeMinutes: number | null;
  readonly leaveRequestId: string | null;
}

/** Punches this long before a shift starts or after it ends still belong to it. */
export const WINDOW_BEFORE_MS = 3 * 3_600_000;
export const WINDOW_AFTER_MS = 5 * 3_600_000;

export function shiftInterval(
  date: string,
  shift: Pick<ComputeShift, 'startTime' | 'endTime'>,
  timeZone: string,
): { start: number; end: number } {
  const start = zonedInstant(date, shift.startTime, timeZone);
  const end = zonedInstant(
    shift.endTime < shift.startTime ? addDays(date, 1) : date,
    shift.endTime,
    timeZone,
  );
  return { start, end };
}

/**
 * Assigns punches to attendance dates: to the scheduled shift whose window
 * holds it (the nearest shift start when two windows overlap), otherwise to
 * the punch's local calendar date.
 */
export function assignPunches(input: {
  punches: readonly ComputePunch[];
  shifts: ReadonlyMap<string, { start: number; end: number }>;
  localDate: (instant: number) => string;
}): Map<string, ComputePunch[]> {
  const byDate = new Map<string, ComputePunch[]>();
  for (const punch of input.punches) {
    const at = Date.parse(punch.at);
    if (!Number.isFinite(at)) continue;
    let best: { date: string; distance: number } | undefined;
    for (const [date, window] of input.shifts) {
      if (
        at < window.start - WINDOW_BEFORE_MS ||
        at > window.end + WINDOW_AFTER_MS
      )
        continue;
      const distance = Math.min(
        Math.abs(at - window.start),
        Math.abs(at - window.end),
      );
      if (!best || distance < best.distance) best = { date, distance };
    }
    const date = best?.date ?? input.localDate(at);
    const list = byDate.get(date) ?? [];
    if (!list.some((p) => p.at === punch.at && p.source === punch.source))
      list.push(punch);
    byDate.set(date, list);
  }
  for (const list of byDate.values())
    list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return byDate;
}

export function computeAttendanceDay(input: {
  date: string;
  shift: ComputeShift | null;
  punches: readonly ComputePunch[];
  leaves: readonly ComputeLeave[];
  approvedOvertimeMinutes: number;
  rule: {
    lateGraceMinutes: number;
    overtimeRequiresApproval: boolean;
    workHourSystem: 'standard' | 'comprehensive' | 'flexible';
  } | null;
  timeZone: string;
}): ComputedDay {
  const punches = [...input.punches].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at),
  );
  const overtime = input.approvedOvertimeMinutes || null;
  const base = {
    shiftId: input.shift?.id ?? null,
    punches,
    lateMinutes: null,
    earlyMinutes: null,
    workedMinutes: null,
  };
  const wholeDay = input.leaves.find(
    (leave) => leave.unit === 'day' && leave.dates.includes(input.date),
  );
  if (!input.shift) {
    if (wholeDay)
      return {
        ...base,
        checkIn: null,
        checkOut: null,
        status: 'leave',
        overtimeMinutes: overtime,
        leaveRequestId: wholeDay.id,
      };
    const first = punches[0] ? new Date(punches[0].at) : null;
    const last =
      punches.length > 1 ? new Date(punches[punches.length - 1].at) : null;
    return {
      ...base,
      checkIn: first,
      checkOut: last,
      status: 'rest',
      workedMinutes:
        first && last
          ? Math.round((last.getTime() - first.getTime()) / 60_000)
          : null,
      overtimeMinutes: overtime,
      leaveRequestId: null,
    };
  }
  const window = shiftInterval(input.date, input.shift, input.timeZone);
  if (wholeDay)
    return {
      ...base,
      checkIn: null,
      checkOut: null,
      status: 'leave',
      overtimeMinutes: overtime,
      leaveRequestId: wholeDay.id,
    };
  // A half-day or hourly leave moves the expected start or end.
  let expectedStart = window.start;
  let expectedEnd = window.end;
  let partial: ComputeLeave | undefined;
  for (const leave of input.leaves) {
    const from = Date.parse(leave.startAt);
    const to = Date.parse(leave.endAt);
    if (to <= window.start || from >= window.end) continue;
    partial = leave;
    if (from <= expectedStart && to > expectedStart)
      expectedStart = Math.min(to, window.end);
    if (to >= expectedEnd && from < expectedEnd)
      expectedEnd = Math.max(from, window.start);
  }
  if (partial && expectedEnd <= expectedStart)
    return {
      ...base,
      checkIn: null,
      checkOut: null,
      status: 'leave',
      overtimeMinutes: overtime,
      leaveRequestId: partial.id,
    };
  const leaveRequestId = partial?.id ?? null;
  if (!punches.length)
    return {
      ...base,
      checkIn: null,
      checkOut: null,
      status: 'absent',
      overtimeMinutes: overtime,
      leaveRequestId,
    };
  const checkIn = new Date(punches[0].at);
  if (punches.length < 2)
    return {
      ...base,
      checkIn,
      checkOut: null,
      status: 'missingPunch',
      overtimeMinutes: overtime,
      leaveRequestId,
    };
  const checkOut = new Date(punches[punches.length - 1].at);
  const flexible = input.rule?.workHourSystem === 'flexible';
  const grace = input.rule?.lateGraceMinutes ?? 0;
  const late = Math.max(
    0,
    Math.floor((checkIn.getTime() - expectedStart) / 60_000),
  );
  const early = Math.max(
    0,
    Math.floor((expectedEnd - checkOut.getTime()) / 60_000),
  );
  const worked = Math.max(
    0,
    Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000) -
      input.shift.breakMinutes,
  );
  const scheduled =
    Math.round((window.end - window.start) / 60_000) - input.shift.breakMinutes;
  const lateCounted = !flexible && late > grace;
  const earlyCounted = !flexible && early > 0;
  const overtimeMinutes =
    input.rule && !input.rule.overtimeRequiresApproval
      ? Math.max(input.approvedOvertimeMinutes, worked - scheduled, 0) || null
      : overtime;
  return {
    ...base,
    checkIn,
    checkOut,
    status: lateCounted ? 'late' : earlyCounted ? 'earlyLeave' : 'normal',
    lateMinutes: lateCounted ? late : null,
    earlyMinutes: earlyCounted ? early : null,
    workedMinutes: worked,
    overtimeMinutes,
    leaveRequestId,
  };
}

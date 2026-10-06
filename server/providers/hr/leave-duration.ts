import { HrError, addDays, isDateOnly } from './shared.js';
import { isWeeklyRestDay } from './attendance-config.js';

export type LeaveCountBy = 'workdays' | 'schedule' | 'calendar';
export type LeaveUnit = 'day' | 'halfDay' | 'hour';

export interface LeaveDurationSchedule {
  readonly date: string;
  readonly shiftId?: string | null;
  readonly shift?: {
    readonly startTime: string;
    readonly endTime: string;
    readonly breakMinutes?: number;
  } | null;
}

/** 半天与小时假的口径 (attendance.leaveUnits). */
export interface LeaveUnitPolicy {
  readonly hourStep: number;
  readonly standardDayHours: number;
  readonly dayWindow: { readonly start: string; readonly end: string };
}

export interface LeaveDurationCalendar {
  readonly holidays?: readonly string[];
  readonly adjustedWorkdays?: readonly string[];
  /** 每周休息日 (0 = Sunday … 6 = Saturday); Saturday and Sunday when not given. */
  readonly weeklyRestDays?: readonly number[];
}

export interface LeaveDurationInput {
  readonly startAt: string;
  readonly endAt: string;
  readonly unit: LeaveUnit;
  readonly countBy: LeaveCountBy;
  readonly timeZone: string;
  readonly calendar?: LeaveDurationCalendar;
  readonly schedules?: readonly LeaveDurationSchedule[];
  /** Required for halfDay; for hour, switches from gross hours to work-window hours. */
  readonly units?: LeaveUnitPolicy;
}

export interface LeaveDurationResult {
  /** In the type's unit: days (day, halfDay) or hours. */
  readonly duration: number;
  readonly dates: readonly string[];
  readonly hours: number;
  /** What the balance moves by, always in days. */
  readonly balanceDays: number;
}

function leaveLocalDate(value: string, timeZone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new HrError('INVALID_DATE_RANGE');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  const result = `${get('year')}-${get('month')}-${get('day')}`;
  if (!isDateOnly(result)) throw new HrError('INVALID_DATE_RANGE');
  return result;
}

function datesBetween(start: string, end: string): string[] {
  const result: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1))
    result.push(date);
  return result;
}

/** End instants are exclusive: midnight does not consume the following day. */
export function leaveRangeDates(
  startAt: string,
  endAt: string,
  timeZone: string,
): string[] {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 366 * 86_400_000
  )
    throw new HrError('INVALID_DATE_RANGE');
  return datesBetween(
    leaveLocalDate(startAt, timeZone),
    leaveLocalDate(new Date(end - 1).toISOString(), timeZone),
  );
}

function shiftClock(clock: string): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/u.test(clock))
    throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
  return `${clock.slice(0, 5)}:${clock.length > 5 ? clock.slice(6, 8) : '00'}.${(clock.split('.')[1] ?? '').padEnd(3, '0')}`;
}

/** Resolve a wall clock without silently choosing a DST gap or repeated time. */
export function zonedInstant(
  date: string,
  clock: string,
  timeZone: string,
): number {
  if (!isDateOnly(date)) throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
  const canonicalClock = shiftClock(clock);
  const target = `${date}T${clock.slice(0, 5)}:${clock.length > 5 ? clock.slice(6, 8) : '00'}`;
  const wall = Date.parse(`${target}Z`);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const local = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (name: string) =>
      parts.find((value) => value.type === name)?.value;
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}`;
  };
  const offsets = new Set<number>();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const sample = wall + hours * 3_600_000;
    offsets.add(Date.parse(`${local(sample)}Z`) - sample);
  }
  const matches = [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => local(instant) === target);
  if (matches.length !== 1) throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
  return matches[0] + Number(canonicalClock.slice(9));
}

function isWorkday(date: string, calendar: LeaveDurationCalendar): boolean {
  const holidays = new Set(calendar.holidays ?? []);
  const adjusted = new Set(calendar.adjustedWorkdays ?? []);
  return (
    adjusted.has(date) ||
    (!holidays.has(date) && !isWeeklyRestDay(date, calendar.weeklyRestDays))
  );
}

/**
 * Calculates leave duration from instants in the configured application time
 * zone. A cross-midnight shift belongs to its schedule's start date; callers
 * must provide schedules using that same date convention.
 */
export function calculateLeaveDuration(
  input: LeaveDurationInput,
): LeaveDurationResult {
  if (!input.timeZone || !input.startAt || !input.endAt)
    throw new HrError('INVALID_DATE_RANGE');
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end <= start
  )
    throw new HrError('INVALID_DATE_RANGE');
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 366)
    throw new HrError('INVALID_DATE_RANGE');
  const dates = leaveRangeDates(input.startAt, input.endAt, input.timeZone);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const calendar = input.calendar ?? {};
  // Half days and hours need the configured policy (attendance.leaveUnits).
  if (input.unit === 'halfDay' && !input.units)
    throw new HrError('LEAVE_UNIT_POLICY_REQUIRED', 409);
  if (input.units && input.unit !== 'day')
    return partialDayDuration(input, dates, calendar);
  let eligible = dates;
  let eligibleHours = hours;
  if (input.countBy === 'workdays')
    eligible = dates.filter((date) => isWorkday(date, calendar));
  if (input.countBy === 'schedule') {
    const scheduled = new Set<string>();
    eligibleHours = 0;
    for (const row of input.schedules ?? []) {
      if (row.date < addDays(from, -1) || row.date > to || !row.shiftId)
        continue;
      if (!row.shift || scheduled.has(row.date))
        throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
      const shiftStart = zonedInstant(
        row.date,
        row.shift.startTime,
        input.timeZone,
      );
      const endDate =
        shiftClock(row.shift.endTime) < shiftClock(row.shift.startTime)
          ? addDays(row.date, 1)
          : row.date;
      const shiftEnd = zonedInstant(endDate, row.shift.endTime, input.timeZone);
      if (shiftEnd <= shiftStart)
        throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
      const overlap =
        Math.min(end.getTime(), shiftEnd) -
        Math.max(start.getTime(), shiftStart);
      if (overlap > 0) {
        scheduled.add(row.date);
        eligibleHours += overlap / 3_600_000;
      }
    }
    eligible = [...scheduled].sort();
  } else if (input.unit === 'hour') {
    eligibleHours = eligible.reduce((total, date) => {
      const dayStart = zonedInstant(date, '00:00', input.timeZone);
      const dayEnd = zonedInstant(addDays(date, 1), '00:00', input.timeZone);
      return (
        total +
        Math.max(
          0,
          Math.min(end.getTime(), dayEnd) - Math.max(start.getTime(), dayStart),
        ) /
          3_600_000
      );
    }, 0);
  }
  const duration =
    input.unit === 'hour'
      ? Math.round(eligibleHours * 100) / 100
      : eligible.length;
  if (duration <= 0) throw new HrError('NO_ELIGIBLE_LEAVE_DAYS', 409);
  return {
    duration,
    dates: eligible,
    hours: Math.round(eligibleHours * 100) / 100,
    balanceDays: duration,
  };
}

/**
 * Half days and hours against each eligible day's work window: its shift
 * (countBy schedule) or the configured day window. A half day is either half
 * of the window, split at its midpoint, that the leave overlaps; hours are the
 * overlap, rounded up to the configured step, and move the balance by
 * hours ÷ the window's standard hours (duration minus break).
 */
function partialDayDuration(
  input: LeaveDurationInput,
  dates: readonly string[],
  calendar: LeaveDurationCalendar,
): LeaveDurationResult {
  const units = input.units!;
  const start = new Date(input.startAt).getTime();
  const end = new Date(input.endAt).getTime();
  const windows: { date: string; from: number; to: number; std: number }[] = [];
  if (input.countBy === 'schedule') {
    const from = dates[0];
    const seen = new Set<string>();
    for (const row of input.schedules ?? []) {
      if (row.date < addDays(from, -1) || row.date > dates.at(-1)!) continue;
      if (!row.shiftId) continue;
      if (!row.shift || seen.has(row.date))
        throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
      seen.add(row.date);
      const shiftStart = zonedInstant(
        row.date,
        row.shift.startTime,
        input.timeZone,
      );
      const shiftEnd = zonedInstant(
        shiftClock(row.shift.endTime) < shiftClock(row.shift.startTime)
          ? addDays(row.date, 1)
          : row.date,
        row.shift.endTime,
        input.timeZone,
      );
      if (shiftEnd <= shiftStart)
        throw new HrError('LEAVE_SCHEDULE_INVALID', 409);
      const std =
        (shiftEnd - shiftStart) / 3_600_000 -
        (row.shift.breakMinutes ?? 0) / 60;
      windows.push({ date: row.date, from: shiftStart, to: shiftEnd, std });
    }
  } else {
    for (const date of dates) {
      if (input.countBy === 'workdays' && !isWorkday(date, calendar)) continue;
      windows.push({
        date,
        from: zonedInstant(date, units.dayWindow.start, input.timeZone),
        to: zonedInstant(date, units.dayWindow.end, input.timeZone),
        std: units.standardDayHours,
      });
    }
  }
  const overlap = (a: number, b: number) =>
    Math.max(0, Math.min(end, b) - Math.max(start, a));
  const used: string[] = [];
  let duration = 0;
  let balanceDays = 0;
  let hours = 0;
  for (const w of windows) {
    const mid = w.from + (w.to - w.from) / 2;
    if (input.unit === 'halfDay') {
      const halves =
        (overlap(w.from, mid) > 0 ? 0.5 : 0) +
        (overlap(mid, w.to) > 0 ? 0.5 : 0);
      if (!halves) continue;
      used.push(w.date);
      duration += halves;
      balanceDays += halves;
      hours += overlap(w.from, w.to) / 3_600_000;
    } else {
      const h = overlap(w.from, w.to) / 3_600_000;
      if (!h) continue;
      used.push(w.date);
      hours += h;
      balanceDays += h / (w.std > 0 ? w.std : units.standardDayHours);
    }
  }
  if (input.unit === 'hour') {
    duration = Math.ceil(hours / units.hourStep - 1e-9) * units.hourStep;
    // The rounding is part of what the balance moves by.
    balanceDays = hours > 0 ? (balanceDays * duration) / hours : 0;
  }
  if (duration <= 0) throw new HrError('NO_ELIGIBLE_LEAVE_DAYS', 409);
  return {
    duration: Math.round(duration * 100) / 100,
    dates: [...new Set(used)].sort(),
    hours: Math.round(hours * 100) / 100,
    balanceDays: Math.round(balanceDays * 10_000) / 10_000,
  };
}

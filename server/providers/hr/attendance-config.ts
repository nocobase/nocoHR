import { z } from 'zod';

const day = z.iso.date();
const uniqueDates = z
  .array(day)
  .max(366)
  .refine((v) => new Set(v).size === v.length);

/**
 * 每周休息日: the weekdays (0 = Sunday … 6 = Saturday) that are rest days
 * when nobody is scheduled and the calendar names no holiday or adjusted
 * workday. Saturday and Sunday unless HR sets otherwise (a six-day week, or a
 * business that rests mid-week); at least one weekday stays a workday.
 */
export const DEFAULT_WEEKLY_REST_DAYS: readonly number[] = [0, 6];
const weeklyRestDays = z
  .array(z.number().int().min(0).max(6))
  .max(6)
  .refine((v) => new Set(v).size === v.length)
  .default([...DEFAULT_WEEKLY_REST_DAYS]);

/** A stored or submitted rest-day list, or the default when it is not a valid one. */
export function weeklyRestDaysOf(value: unknown): readonly number[] {
  const parsed = weeklyRestDays.safeParse(value ?? undefined);
  return parsed.success ? parsed.data : DEFAULT_WEEKLY_REST_DAYS;
}

/** Whether a YYYY-MM-DD date falls on one of the weekly rest days. */
export function isWeeklyRestDay(
  date: string,
  restDays: readonly number[] = DEFAULT_WEEKLY_REST_DAYS,
): boolean {
  return restDays.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

/** Application configuration, not a tenth attendance business collection. */
export const attendanceConfigSchemas = {
  limits: z
    .object({
      monthlyMissingPunchLimit: z.number().int().min(0).max(31),
      monthlyConfirmationDays: z.number().int().min(1).max(31),
      consecutiveMissingReminderDays: z.number().int().min(1).max(31),
      overtimeReminderRatio: z.number().positive().max(1),
      leaveSecondLevelDays: z.number().positive().max(366).default(3),
    })
    .strict(),
  annualLeave: z
    .object({
      bands: z
        .array(
          z
            .object({
              minimumYears: z.number().int().min(0).max(100),
              days: z.number().int().min(0).max(366),
            })
            .strict(),
        )
        .min(1)
        .max(20)
        .refine((bands) =>
          bands.every(
            (band, i) =>
              i === 0 ||
              (band.minimumYears > bands[i - 1].minimumYears &&
                band.days >= bands[i - 1].days),
          ),
        ),
    })
    .strict(),
  calendar: z
    .object({
      years: z
        .array(
          z
            .object({
              year: z.number().int().min(1900).max(2200),
              holidays: uniqueDates,
              adjustedWorkdays: uniqueDates,
            })
            .strict()
            .refine((entry) => {
              const holidays = new Set(entry.holidays);
              return (
                [...entry.holidays, ...entry.adjustedWorkdays].every((date) =>
                  date.startsWith(`${entry.year}-`),
                ) && entry.adjustedWorkdays.every((date) => !holidays.has(date))
              );
            }),
        )
        .max(50)
        .refine(
          (years) => new Set(years.map((y) => y.year)).size === years.length,
        ),
      weeklyRestDays,
    })
    .strict(),
  /**
   * 轮班模板: a shift order and period. Each period works `workDays` days on
   * one shift, then rests; the next period moves to the next shift in order.
   */
  rotations: z
    .object({
      templates: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u),
              title: z.string().trim().min(1).max(100),
              shiftCodes: z.array(z.string().min(1).max(64)).min(1).max(10),
              periodDays: z.number().int().min(1).max(31),
              workDays: z.number().int().min(1).max(31),
            })
            .strict()
            .refine((t) => t.workDays <= t.periodDays),
        )
        .max(50)
        .refine((rows) => new Set(rows.map((r) => r.key)).size === rows.length),
    })
    .strict(),
  /**
   * 半天与小时假 (user-agreed defaults, 2026-09-29): a half day splits the
   * day's work window at its midpoint; hours round up to `hourStep` and turn
   * into balance days at the shift's standard hours (duration minus break),
   * or `standardDayHours` without a shift. `dayWindow` is the work window of
   * a day that has no shift (countBy workdays / calendar).
   */
  leaveUnits: z
    .object({
      hourStep: z.number().positive().max(8),
      standardDayHours: z.number().positive().max(24),
      dayWindow: z
        .object({
          start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
          end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
        })
        .strict()
        .refine((w) => w.start < w.end),
    })
    .strict(),
  /**
   * 预计当月加班 (user-agreed default): approved overtime plus scheduled
   * hours beyond `standardDayHours` a day (standard hours); comprehensive
   * hours compare the month's scheduled total with its workdays ×
   * `standardDayHours`; flexible hours have no forecast and no lateness.
   */
  overtime: z
    .object({ standardDayHours: z.number().positive().max(24) })
    .strict(),
  /** 按部门追加的审批级别: one more approver after the defaults, for these request types. */
  approval: z
    .object({
      extraLevels: z
        .array(
          z
            .object({
              departmentId: z.string().min(1).max(64),
              approverUserId: z.string().min(1).max(64),
              types: z
                .array(
                  z.enum([
                    'leave',
                    'missingPunch',
                    'overtime',
                    'shiftSwap',
                    'exception',
                  ]),
                )
                .min(1),
            })
            .strict(),
        )
        .max(50),
    })
    .strict(),
} as const;

export type AttendanceConfigSection = keyof typeof attendanceConfigSchemas;
export type AttendanceConfiguration = {
  [K in AttendanceConfigSection]: z.infer<(typeof attendanceConfigSchemas)[K]>;
};

export const attendanceConfigDefaults: AttendanceConfiguration = {
  limits: {
    monthlyMissingPunchLimit: 3,
    monthlyConfirmationDays: 3,
    consecutiveMissingReminderDays: 2,
    overtimeReminderRatio: 0.8,
    leaveSecondLevelDays: 3,
  },
  annualLeave: {
    bands: [
      { minimumYears: 1, days: 5 },
      { minimumYears: 10, days: 10 },
      { minimumYears: 20, days: 15 },
    ],
  },
  // No invented statutory holiday dates: HR supplies the applicable calendar.
  calendar: { years: [], weeklyRestDays: [...DEFAULT_WEEKLY_REST_DAYS] },
  rotations: { templates: [] },
  leaveUnits: {
    hourStep: 0.5,
    standardDayHours: 8,
    dayWindow: { start: '08:30', end: '17:30' },
  },
  overtime: { standardDayHours: 8 },
  approval: { extraLevels: [] },
};

export function isAttendanceConfigSection(
  value: string,
): value is AttendanceConfigSection {
  return Object.hasOwn(attendanceConfigSchemas, value);
}

/**
 * A stored setting value: an object from the Repository, or JSON text when a
 * seed wrote it through the query builder.
 */
export function decodeSetting(value: unknown): unknown {
  let decoded = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
    decoded = JSON.parse(decoded);
  return decoded;
}

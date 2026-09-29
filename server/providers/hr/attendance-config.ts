import { z } from 'zod';

const day = z.iso.date();
const uniqueDates = z
  .array(day)
  .max(366)
  .refine((v) => new Set(v).size === v.length);

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
  calendar: { years: [] },
};

export function isAttendanceConfigSection(
  value: string,
): value is AttendanceConfigSection {
  return Object.hasOwn(attendanceConfigSchemas, value);
}

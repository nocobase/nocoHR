import { describe, expect, it } from 'vitest';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
  isAttendanceConfigSection,
} from '../../server/providers/hr/attendance-config';

describe('V2-05 attendance configuration', () => {
  it('validates the documented defaults without inventing a holiday calendar', () => {
    for (const key of Object.keys(attendanceConfigSchemas)) {
      expect(isAttendanceConfigSection(key)).toBe(true);
      if (isAttendanceConfigSection(key))
        expect(
          attendanceConfigSchemas[key].safeParse(attendanceConfigDefaults[key])
            .success,
        ).toBe(true);
    }
    expect(attendanceConfigDefaults.limits).toEqual({
      leaveSecondLevelDays: 3,
      monthlyMissingPunchLimit: 3,
      monthlyConfirmationDays: 3,
      consecutiveMissingReminderDays: 2,
      overtimeReminderRatio: 0.8,
    });
    expect(attendanceConfigDefaults.calendar.years).toEqual([]);
  });
  it.each(['__proto__', 'constructor', 'reminders', ''])(
    'rejects foreign config section %s',
    (key) => {
      expect(isAttendanceConfigSection(key)).toBe(false);
    },
  );
  it.each([
    { leaveSecondLevelDays: 0 },
    { leaveSecondLevelDays: -1 },
    { leaveSecondLevelDays: 367 },
    { monthlyMissingPunchLimit: -1 },
    { monthlyMissingPunchLimit: 1.5 },
    { monthlyConfirmationDays: 0 },
    { consecutiveMissingReminderDays: 0 },
    { overtimeReminderRatio: 80 },
    { overtimeReminderRatio: 0 },
    { status: 'approved' },
  ])('rejects invalid limits %j', (overrides) => {
    expect(
      attendanceConfigSchemas.limits.safeParse({
        ...attendanceConfigDefaults.limits,
        ...overrides,
      }).success,
    ).toBe(false);
  });
  it.each(
    [
      [
        { minimumYears: 10, days: 10 },
        { minimumYears: 1, days: 5 },
      ],
      [
        { minimumYears: 1, days: 5 },
        { minimumYears: 1, days: 10 },
      ],
      [
        { minimumYears: 1, days: 10 },
        { minimumYears: 10, days: 5 },
      ],
      [],
    ].map((bands) => ({ bands })),
  )('rejects ambiguous seniority bands %j', ({ bands }) => {
    expect(
      attendanceConfigSchemas.annualLeave.safeParse({ bands }).success,
    ).toBe(false);
  });
  it('validates real dates, year boundaries, duplicates and mutually exclusive calendar entries', () => {
    const parse = (holidays: string[], adjustedWorkdays: string[] = []) =>
      attendanceConfigSchemas.calendar.safeParse({
        years: [{ year: 2026, holidays, adjustedWorkdays }],
      }).success;
    expect(parse(['2026-10-01'], ['2026-10-10'])).toBe(true);
    expect(parse(['2026-02-29'])).toBe(false);
    expect(parse(['2027-10-01'])).toBe(false);
    expect(parse(['2026-10-01', '2026-10-01'])).toBe(false);
    expect(parse(['2026-10-01'], ['2026-10-01'])).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import { overtimeTypeOf } from '../../server/providers/hr/adjustment-service.ts';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
  isWeeklyRestDay,
  weeklyRestDaysOf,
} from '../../server/providers/hr/attendance-config.ts';
import { findIssues } from '../../server/providers/hr/compliance.ts';
import { calculateLeaveDuration } from '../../server/providers/hr/leave-duration.ts';
import {
  calculatePayslip,
  type CalculationInput,
} from '../../server/providers/hr/payroll/calc.ts';
import {
  isWorkday,
  payableDaysFor,
} from '../../server/providers/hr/payroll/common.ts';
import { PAYROLL_SETTINGS_DEFAULTS } from '../../server/providers/hr/payroll/config.ts';
import { workdaysIn } from '../../server/providers/hr/schedule-validation.ts';
import { EMPLOYMENT_TYPES } from '../../server/providers/hr/talent-service.ts';
import { EMPLOYMENT_TYPES as CLIENT_EMPLOYMENT_TYPES } from '../../client/pages/talent/employees/types.ts';
import en from '../../client/locales/en-US.ts';
import zh from '../../client/locales/zh-CN.ts';

// Assumptions that held only for a Monday–Friday, 8-hour factory: the standard day behind hourlyRate, the weekly rest
// days behind workday counting, the employment types, and (in industry-generality-api.test.ts) added fields on
// departments and positions.

function payslipInput(
  overrides: Partial<CalculationInput> = {},
): CalculationInput {
  return {
    month: '2026-09',
    departmentChain: ['d1'],
    salary: {
      id: 's1',
      effectiveMonth: '2026-01',
      baseSalary: 8700,
      fixedAllowances: [],
    },
    structure: {
      id: 'st1',
      title: 'Hourly',
      payDaysPerMonth: 21.75,
      params: [],
      items: [
        {
          code: 'hourly',
          title: 'Hourly rate',
          kind: 'reference',
          calc: 'formula',
          formula: 'hourlyRate',
          unit: null,
          departmentIds: [],
          taxable: false,
          includedInSocialBase: false,
          sortOrder: 10,
        },
      ],
    },
    payableDays: 21.75,
    attendance: {
      nightShiftCount: 0,
      absentDays: 0,
      shiftCounts: {},
      overtimeByType: {},
      leaveByType: {},
    },
    importedValues: {},
    manualItems: [],
    insurance: null,
    specialDeductionYtd: 0,
    specialDeductionMonth: 0,
    prior: {
      months: 0,
      incomeYtd: 0,
      insuranceYtd: 0,
      withheldYtd: 0,
      startMonth: '2026-09',
    },
    tax: PAYROLL_SETTINGS_DEFAULTS.tax,
    ...overrides,
  };
}

const hourly = (input: CalculationInput) =>
  calculatePayslip(input).lines.find((l) => l.code === 'hourly')!.value;

describe('hourlyRate uses the configured standard day', () => {
  it('stays daily rate ÷ 8 when no standard day is given', () => {
    // 8700 ÷ 21.75 = 400 a day.
    expect(hourly(payslipInput())).toBe(50);
    expect(hourly(payslipInput({ standardDayHours: null }))).toBe(50);
  });

  it('divides by the configured hours (a 7.5-hour office day, a 10-hour shift)', () => {
    expect(hourly(payslipInput({ standardDayHours: 7.5 }))).toBeCloseTo(
      53.3333,
      4,
    );
    expect(hourly(payslipInput({ standardDayHours: 10 }))).toBe(40);
  });

  it('keeps the configurable 月计薪天数 for the daily rate', () => {
    expect(
      hourly(
        payslipInput({
          standardDayHours: 8,
          structure: { ...payslipInput().structure, payDaysPerMonth: 26 },
        }),
      ),
    ).toBeCloseTo(8700 / 26 / 8, 4);
  });
});

describe('weekly rest days', () => {
  it('defaults to Saturday and Sunday, and stored calendars without them still parse', () => {
    expect(attendanceConfigDefaults.calendar.weeklyRestDays).toEqual([0, 6]);
    expect(
      attendanceConfigSchemas.calendar.parse({ years: [] }).weeklyRestDays,
    ).toEqual([0, 6]);
    expect(weeklyRestDaysOf(undefined)).toEqual([0, 6]);
    expect(weeklyRestDaysOf([1])).toEqual([1]);
    // Every day a rest day, an out-of-range weekday or a duplicate is refused.
    for (const invalid of [[0, 1, 2, 3, 4, 5, 6], [7], [0, 0]])
      expect(
        attendanceConfigSchemas.calendar.safeParse({
          years: [],
          weeklyRestDays: invalid,
        }).success,
      ).toBe(false);
  });

  it('counts a month’s workdays by the configured rest days', () => {
    const calendar = { holidays: [], adjustedWorkdays: [] };
    // September 2026: 30 days, 4 Saturdays and 4 Sundays.
    expect(workdaysIn('2026-09', calendar)).toBe(22);
    // A six-day week resting on Sunday.
    expect(workdaysIn('2026-09', { ...calendar, weeklyRestDays: [0] })).toBe(
      26,
    );
    // A shop resting on Monday and Tuesday (5 Tuesdays in September 2026).
    expect(workdaysIn('2026-09', { ...calendar, weeklyRestDays: [1, 2] })).toBe(
      21,
    );
    // Holidays and adjusted workdays still win: Thursday the 3rd off, Monday the 7th worked.
    expect(
      workdaysIn('2026-09', {
        holidays: ['2026-09-03'],
        adjustedWorkdays: ['2026-09-07'],
        weeklyRestDays: [1, 2],
      }),
    ).toBe(21);
  });

  it('types unscheduled overtime by the configured rest days', () => {
    const base = { holidays: [], adjustedWorkdays: [], scheduledShift: null };
    // 2026-10-10 is a Saturday, 2026-10-12 a Monday.
    expect(overtimeTypeOf({ ...base, date: '2026-10-10' })).toBe('restDay');
    expect(overtimeTypeOf({ ...base, date: '2026-10-12' })).toBe('workday');
    expect(
      overtimeTypeOf({ ...base, date: '2026-10-10', weeklyRestDays: [1] }),
    ).toBe('workday');
    expect(
      overtimeTypeOf({ ...base, date: '2026-10-12', weeklyRestDays: [1] }),
    ).toBe('restDay');
    // A schedule still decides when there is one.
    expect(
      overtimeTypeOf({
        ...base,
        date: '2026-10-12',
        weeklyRestDays: [1],
        scheduledShift: true,
      }),
    ).toBe('workday');
  });

  it('applies to leave counted in workdays and to the payable days of a partial month', () => {
    const leave = (weeklyRestDays?: number[]) =>
      calculateLeaveDuration({
        startAt: '2026-10-10T00:00:00+08:00',
        endAt: '2026-10-12T23:59:00+08:00',
        unit: 'day',
        countBy: 'workdays',
        timeZone: 'Asia/Shanghai',
        calendar: { weeklyRestDays },
      }).duration;
    expect(leave()).toBe(1);
    expect(leave([0])).toBe(2);
    const calendar = {
      holidays: new Set<string>(),
      adjustedWorkdays: new Set<string>(),
    };
    expect(isWorkday('2026-10-10', calendar)).toBe(false);
    expect(isWorkday('2026-10-10', { ...calendar, weeklyRestDays: [0] })).toBe(
      true,
    );
    // Joined on Thursday 2026-09-24: Thu–Wed is 5 workdays, 6 on a Sunday-only week.
    const joiner = { hireDate: '2026-09-24', leaveDate: null };
    expect(payableDaysFor(joiner, '2026-09', 21.75, calendar).payableDays).toBe(
      5,
    );
    expect(
      payableDaysFor(joiner, '2026-09', 26, {
        ...calendar,
        weeklyRestDays: [0],
      }).payableDays,
    ).toBe(6);
    expect(isWeeklyRestDay('2026-10-11')).toBe(true);
  });
});

describe('employment types for every industry', () => {
  const added = ['seasonal', 'temporary', 'retiredRehire', 'flexible'];

  it('accepts 季节工, 临时工, 退休返聘 and 灵活用工 on both sides, labelled in both languages', () => {
    expect(EMPLOYMENT_TYPES).toEqual(expect.arrayContaining(added));
    expect([...CLIENT_EMPLOYMENT_TYPES]).toEqual([...EMPLOYMENT_TYPES]);
    for (const type of EMPLOYMENT_TYPES) {
      // The employees.employmentType column is a string of 16.
      expect(type.length).toBeLessThanOrEqual(16);
      expect(
        (en.talent.employmentType as Record<string, string>)[type],
      ).toBeTruthy();
      expect(
        (zh.talent.employmentType as Record<string, string>)[type],
      ).toBeTruthy();
    }
    expect(zh.talent.employmentType.seasonal).toBe('季节工');
    expect(zh.talent.employmentType.retiredRehire).toBe('退休返聘');
  });

  it('checks the labour contract of 季节工 and 临时工, not of 退休返聘 or 灵活用工', () => {
    const settings = {
      enabled: true,
      checks: {
        secondFixedTerm: true,
        probationLimit: true,
        noContract: true,
        expiredContract: true,
      },
      noContractDays: 30,
      probationLimits: {
        underThreeMonths: 0,
        underOneYear: 1,
        underThreeYears: 2,
        threeYearsOrOpen: 6,
      },
    };
    const kinds = (employmentType: string) =>
      findIssues(
        {
          id: 'e1',
          name: '郭凡',
          status: 'active',
          hireDate: '2026-08-01',
          probationEndDate: null,
          employmentType,
        },
        [],
        settings,
        30,
        '2026-09-29',
      ).map((f) => f.kind);
    expect(kinds('seasonal')).toEqual(['noContract']);
    expect(kinds('temporary')).toEqual(['noContract']);
    expect(kinds('retiredRehire')).toEqual([]);
    expect(kinds('flexible')).toEqual([]);
  });
});

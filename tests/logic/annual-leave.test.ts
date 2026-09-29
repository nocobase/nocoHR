// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  calculateAnnualLeave,
  DEFAULT_ANNUAL_LEAVE_BANDS,
} from '../../server/providers/hr/annual-leave.ts';

describe('V2-05 annual leave entitlement', () => {
  it.each([
    [0, 0],
    [1, 5],
    [9, 5],
    [10, 10],
    [19, 10],
    [20, 15],
    [30, 15],
  ])('uses the documented bracket for %i completed years', (years, days) => {
    const date = `${2026 - years}-01-01`;
    expect(
      calculateAnnualLeave({
        asOf: '2026-01-01',
        hireDate: date,
        careerStartDate: date,
      }).entitled,
    ).toBe(days);
  });
  it('matches Qian Jin, Li Min and Chen Chen from the specification', () => {
    expect(
      calculateAnnualLeave({
        asOf: '2026-09-28',
        hireDate: '2020-01-01',
        careerStartDate: '2014-01-01',
      }).entitled,
    ).toBe(10);
    expect(
      calculateAnnualLeave({ asOf: '2026-09-28', hireDate: '2021-01-01' })
        .entitled,
    ).toBe(5);
    expect(
      calculateAnnualLeave({
        asOf: '2026-09-28',
        hireDate: '2026-07-01',
        careerStartDate: '2023-01-01',
      }),
    ).toMatchObject({
      entitled: 2,
      eligibleCalendarDays: 184,
      calendarDaysInYear: 365,
    });
  });
  it('uses completed anniversaries, not calendar-year subtraction alone', () => {
    const input = { hireDate: '2020-01-01', careerStartDate: '2016-09-28' };
    expect(
      calculateAnnualLeave({ ...input, asOf: '2026-09-27' }).entitled,
    ).toBe(5);
    expect(
      calculateAnnualLeave({ ...input, asOf: '2026-09-28' }).entitled,
    ).toBe(10);
  });
  it('uses actual leap-year length and includes the hire date in prorating', () => {
    expect(
      calculateAnnualLeave({
        asOf: '2024-07-01',
        hireDate: '2024-07-01',
        careerStartDate: '2020-01-01',
      }),
    ).toMatchObject({
      entitled: 2,
      eligibleCalendarDays: 184,
      calendarDaysInYear: 366,
    });
    expect(
      calculateAnnualLeave({
        asOf: '2026-12-31',
        hireDate: '2026-12-31',
        careerStartDate: '2020-01-01',
      }),
    ).toMatchObject({ entitled: 0, eligibleCalendarDays: 1 });
  });
  it('signals missing career date, rejects future hires for current entitlement', () => {
    expect(
      calculateAnnualLeave({ asOf: '2026-01-01', hireDate: '2025-01-01' }),
    ).toMatchObject({ needsCareerStartDate: true, entitled: 5 });
    expect(
      calculateAnnualLeave({
        asOf: '2026-01-01',
        hireDate: '2026-07-01',
        careerStartDate: '2020-01-01',
      }).entitled,
    ).toBe(0);
  });
  it('accepts configurable unordered bands without mutating configuration', () => {
    const bands = [
      { minimumYears: 10, days: 20 },
      { minimumYears: 1, days: 7 },
    ];
    const input = {
      asOf: '2026-01-01',
      hireDate: '2020-01-01',
      careerStartDate: '2010-01-01',
      bands,
    };
    expect(calculateAnnualLeave(input).entitled).toBe(20);
    expect(calculateAnnualLeave(input)).toEqual(calculateAnnualLeave(input));
    expect(bands[0].minimumYears).toBe(10);
    expect(DEFAULT_ANNUAL_LEAVE_BANDS[0].days).toBe(5);
  });
  it.each(['2026-02-30', 'invalid', '2026-13-01'])(
    'rejects invalid dates: %s',
    (asOf) => {
      expect(() =>
        calculateAnnualLeave({ asOf, hireDate: '2020-01-01' }),
      ).toThrow('INVALID_INPUT');
    },
  );
  it('rejects inconsistent dates and invalid policy values', () => {
    const input = { asOf: '2026-01-01', hireDate: '2020-01-01' };
    expect(() =>
      calculateAnnualLeave({ ...input, careerStartDate: '2021-01-01' }),
    ).toThrow();
    for (const bands of [
      [],
      [{ minimumYears: -1, days: 5 }],
      [{ minimumYears: 1, days: NaN }],
      [
        { minimumYears: 1, days: 5 },
        { minimumYears: 1, days: 10 },
      ],
    ])
      expect(() => calculateAnnualLeave({ ...input, bands })).toThrow(
        'INVALID_INPUT',
      );
  });
});

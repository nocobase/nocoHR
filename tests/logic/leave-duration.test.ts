import { describe, expect, it } from 'vitest';
import {
  calculateLeaveDuration,
  leaveRangeDates,
} from '../../server/providers/hr/leave-duration.js';

describe('leave duration', () => {
  it('counts workdays while excluding holidays and adding adjusted workdays', () => {
    const result = calculateLeaveDuration({
      startAt: '2026-10-01T00:00:00+08:00',
      endAt: '2026-10-05T23:59:00+08:00',
      unit: 'day',
      countBy: 'workdays',
      timeZone: 'Asia/Shanghai',
      calendar: {
        holidays: ['2026-10-01', '2026-10-02'],
        adjustedWorkdays: ['2026-10-04'],
      },
    });
    expect(result.duration).toBe(2);
    expect(result.dates).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('counts only scheduled dates and keeps a cross-midnight range on start dates', () => {
    const result = calculateLeaveDuration({
      startAt: '2026-10-05T22:00:00+08:00',
      endAt: '2026-10-07T06:00:00+08:00',
      unit: 'day',
      countBy: 'schedule',
      timeZone: 'Asia/Shanghai',
      schedules: [
        {
          date: '2026-10-05',
          shiftId: 'night',
          shift: { startTime: '22:00', endTime: '06:00' },
        },
        { date: '2026-10-06', shiftId: null },
      ],
    });
    expect(result.duration).toBe(1);
    expect(result.dates).toEqual(['2026-10-05']);
  });

  it('treats midnight as an exclusive endpoint, including a year boundary', () => {
    expect(
      leaveRangeDates(
        '2026-12-31T00:00:00+08:00',
        '2027-01-01T00:00:00+08:00',
        'Asia/Shanghai',
      ),
    ).toEqual(['2026-12-31']);
    expect(
      calculateLeaveDuration({
        startAt: '2026-10-05T00:00:00+08:00',
        endAt: '2026-10-06T00:00:00+08:00',
        unit: 'day',
        countBy: 'calendar',
        timeZone: 'Asia/Shanghai',
      }).duration,
    ).toBe(1);
  });

  it('uses the application date even when input dates are UTC', () => {
    expect(
      leaveRangeDates(
        '2026-10-04T16:30:00Z',
        '2026-10-04T17:30:00Z',
        'Asia/Shanghai',
      ),
    ).toEqual(['2026-10-05']);
  });

  it('attributes an after-midnight request to the preceding night shift, not the next shift', () => {
    const result = calculateLeaveDuration({
      startAt: '2026-11-01T01:00:00+08:00',
      endAt: '2026-11-01T05:00:00+08:00',
      unit: 'day',
      countBy: 'schedule',
      timeZone: 'Asia/Shanghai',
      schedules: [
        {
          date: '2026-10-31',
          shiftId: 'night',
          shift: { startTime: '22:00', endTime: '06:00' },
        },
        {
          date: '2026-11-01',
          shiftId: 'day',
          shift: { startTime: '09:00', endTime: '17:00' },
        },
      ],
    });
    expect(result).toEqual({
      duration: 1,
      dates: ['2026-10-31'],
      hours: 4,
      balanceDays: 1,
    });
  });

  it('does not count a shift that only touches the request boundary', () => {
    expect(() =>
      calculateLeaveDuration({
        startAt: '2026-10-05T17:00:00+08:00',
        endAt: '2026-10-05T20:00:00+08:00',
        unit: 'day',
        countBy: 'schedule',
        timeZone: 'Asia/Shanghai',
        schedules: [
          {
            date: '2026-10-05',
            shiftId: 'day',
            shift: { startTime: '09:00', endTime: '17:00' },
          },
        ],
      }),
    ).toThrowError('NO_ELIGIBLE_LEAVE_DAYS');
  });

  it('does not charge weekends as workday hours', () => {
    const result = calculateLeaveDuration({
      startAt: '2026-10-09T23:00:00+08:00',
      endAt: '2026-10-12T01:00:00+08:00',
      unit: 'hour',
      countBy: 'workdays',
      timeZone: 'Asia/Shanghai',
    });
    expect(result).toEqual({
      duration: 2,
      hours: 2,
      dates: ['2026-10-09', '2026-10-12'],
      balanceDays: 2,
    });
    expect(() =>
      calculateLeaveDuration({
        startAt: '2026-10-10T09:00:00+08:00',
        endAt: '2026-10-10T17:00:00+08:00',
        unit: 'hour',
        countBy: 'workdays',
        timeZone: 'Asia/Shanghai',
      }),
    ).toThrowError('NO_ELIGIBLE_LEAVE_DAYS');
  });

  it('does not assume every covered date is half a day', () => {
    expect(() =>
      calculateLeaveDuration({
        startAt: '2026-10-05T09:00:00+08:00',
        endAt: '2026-10-05T17:00:00+08:00',
        unit: 'halfDay',
        countBy: 'calendar',
        timeZone: 'Asia/Shanghai',
      }),
    ).toThrowError('LEAVE_UNIT_POLICY_REQUIRED');
  });

  it('rejects missing or invalid shift times instead of charging a guessed day', () => {
    for (const shift of [
      undefined,
      { startTime: '09:00', endTime: '09:00' },
      { startTime: '25:00', endTime: '06:00' },
    ]) {
      expect(() =>
        calculateLeaveDuration({
          startAt: '2026-10-05T00:00:00Z',
          endAt: '2026-10-06T00:00:00Z',
          unit: 'day',
          countBy: 'schedule',
          timeZone: 'UTC',
          schedules: [{ date: '2026-10-05', shiftId: 'bad', shift }],
        }),
      ).toThrowError('LEAVE_SCHEDULE_INVALID');
    }
  });

  it('counts a normal DST-crossing night once, using actual elapsed shift hours', () => {
    expect(
      calculateLeaveDuration({
        startAt: '2026-11-01T02:00:00Z',
        endAt: '2026-11-01T11:00:00Z',
        unit: 'day',
        countBy: 'schedule',
        timeZone: 'America/New_York',
        schedules: [
          {
            date: '2026-10-31',
            shiftId: 'night',
            shift: { startTime: '22:00', endTime: '06:00' },
          },
        ],
      }),
    ).toEqual({
      duration: 1,
      dates: ['2026-10-31'],
      hours: 9,
      balanceDays: 1,
    });
  });

  it.each([
    ['2026-03-08', '02:30'],
    ['2026-11-01', '01:30'],
  ])(
    'rejects nonexistent or ambiguous shift boundaries on %s',
    (date, startTime) => {
      expect(() =>
        calculateLeaveDuration({
          startAt: `${date}T00:00:00Z`,
          endAt: `${date}T23:00:00Z`,
          unit: 'day',
          countBy: 'schedule',
          timeZone: 'America/New_York',
          schedules: [
            { date, shiftId: 'dst', shift: { startTime, endTime: '06:00' } },
          ],
        }),
      ).toThrowError('LEAVE_SCHEDULE_INVALID');
    },
  );

  it('returns actual hours for hourly leave and rejects an empty range', () => {
    expect(
      calculateLeaveDuration({
        startAt: '2026-10-05T09:00:00+08:00',
        endAt: '2026-10-05T12:30:00+08:00',
        unit: 'hour',
        countBy: 'calendar',
        timeZone: 'Asia/Shanghai',
      }).duration,
    ).toBe(3.5);
    expect(() =>
      calculateLeaveDuration({
        startAt: '2026-10-05T12:00:00+08:00',
        endAt: '2026-10-05T12:00:00+08:00',
        unit: 'day',
        countBy: 'calendar',
        timeZone: 'Asia/Shanghai',
      }),
    ).toThrowError('INVALID_DATE_RANGE');
  });
});

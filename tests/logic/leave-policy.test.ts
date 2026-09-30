import { describe, expect, it } from 'vitest';
import {
  balanceAdjustmentSchema,
  leaveBalanceAmounts,
  leaveTypeSchema,
  readAdjustmentHistory,
} from '../../server/providers/hr/leave-policy.ts';

const type = {
  code: 'annual',
  title: 'Annual leave',
  payType: 'paid',
  unit: 'day',
  balanceRule: 'annualBySeniority',
  requiresAttachment: false,
  countBy: 'schedule',
  active: true,
};
const balance = {
  entitled: 10,
  carriedOver: 2,
  used: 3,
  pending: 1,
  adjustments: [],
};
describe('V2-05 leave policy', () => {
  it('validates all document fields and rejects unknown or inconsistent fields', () => {
    expect(leaveTypeSchema.parse(type).fixedDays).toBeNull();
    expect(
      leaveTypeSchema.safeParse({ ...type, balanceRule: 'fixedPerEvent' })
        .success,
    ).toBe(false);
    expect(leaveTypeSchema.safeParse({ ...type, fixedDays: 3 }).success).toBe(
      false,
    );
    expect(
      leaveTypeSchema.safeParse({
        ...type,
        balanceRule: 'fixedPerEvent',
        fixedDays: 3,
      }).success,
    ).toBe(true);
    expect(leaveTypeSchema.safeParse({ ...type, entitled: 100 }).success).toBe(
      false,
    );
    expect(
      leaveTypeSchema.safeParse({ ...type, countBy: 'automatic' }).success,
    ).toBe(false);
  });
  it('keeps entitlement, carry, used, pending and manual adjustments separate', () => {
    const input = {
      ...balance,
      adjustments: [
        { delta: -0.1, reason: 'Correction', by: 'hr', at: '2026-09-28' },
        { delta: 0.2, reason: 'Correction', by: 'hr', at: '2026-09-28' },
      ],
    };
    expect(leaveBalanceAmounts(input, '2026-09-28')).toEqual({
      entitled: 10,
      carriedOver: 2,
      used: 3,
      pending: 1,
      adjusted: 0.1,
      available: 8.1,
    });
    expect(input.adjustments).toHaveLength(2);
  });
  it('returns negative availability for the caller to reject rather than silently clamping', () => {
    expect(
      leaveBalanceAmounts({ ...balance, pending: 20 }, '2026-09-28').available,
    ).toBe(-11);
  });
  it.each([-1, NaN, Infinity, null, {}, 'unknown'])(
    'rejects corrupt balance values: %s',
    (entitled) => {
      expect(() =>
        leaveBalanceAmounts({ ...balance, entitled }, '2026-09-28'),
      ).toThrow('INVALID_BALANCE');
    },
  );
  it('rejects malformed history; carryover is used first and its unused rest lapses after expiry', () => {
    expect(() => readAdjustmentHistory({ delta: 1 })).toThrow(
      'INVALID_BALANCE',
    );
    // Used and pending (4) exceed the carried 2: nothing of it is left to lapse.
    expect(
      leaveBalanceAmounts({ ...balance, expiresAt: '2026-03-31' }, '2026-09-28')
        .available,
    ).toBe(8);
    // Nothing used: the carried 2 lapse after 03-31, but count before it.
    expect(
      leaveBalanceAmounts(
        { ...balance, used: 0, pending: 0, expiresAt: '2026-03-31' },
        '2026-09-28',
      ),
    ).toMatchObject({ carriedOver: 0, available: 10 });
    expect(
      leaveBalanceAmounts(
        { ...balance, used: 0, pending: 0, expiresAt: '2026-03-31' },
        '2026-03-31',
      ).available,
    ).toBe(12);
    expect(
      leaveBalanceAmounts(
        { ...balance, carriedOver: 0, expiresAt: '2026-03-31' },
        '2026-09-28',
      ).available,
    ).toBe(6);
  });
  it('requires an audit reason, a local repository version and a bounded precise delta', () => {
    const input = {
      idempotencyKey: 'test-adjustment',
      expectedUpdatedAt: '2026-09-28T12:00:00.123',
      delta: 0.0001,
      reason: ' Reconciliation ',
    };
    expect(balanceAdjustmentSchema.parse(input).reason).toBe('Reconciliation');
    for (const delta of [0, 0.00001, 367, -367, Infinity])
      expect(
        balanceAdjustmentSchema.safeParse({ ...input, delta }).success,
      ).toBe(false);
    expect(
      balanceAdjustmentSchema.safeParse({ ...input, reason: '  ' }).success,
    ).toBe(false);
    expect(
      balanceAdjustmentSchema.safeParse({ ...input, used: 0 }).success,
    ).toBe(false);
  });
});

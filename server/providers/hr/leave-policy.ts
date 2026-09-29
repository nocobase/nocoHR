import { z } from 'zod';
import { HrError } from './shared.js';

export const leaveTypeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/u),
    title: z.string().trim().min(1).max(255),
    payType: z.enum(['paid', 'partial', 'unpaid']),
    unit: z.enum(['day', 'halfDay', 'hour']),
    balanceRule: z.enum([
      'annualBySeniority',
      'fixedPerEvent',
      'earned',
      'none',
    ]),
    fixedDays: z.number().positive().max(366).nullable().default(null),
    requiresAttachment: z.boolean(),
    countBy: z.enum(['workdays', 'schedule', 'calendar']),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.balanceRule === 'fixedPerEvent') !== (value.fixedDays !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['fixedDays'],
        message: 'INVALID_FIXED_DAYS',
      });
  });

export const balanceAdjustmentSchema = z
  .object({
    idempotencyKey: z.string().min(8).max(128),
    expectedUpdatedAt: z.iso.datetime({ local: true }),
    delta: z
      .number()
      .min(-366)
      .max(366)
      .refine(
        (n) => n !== 0 && Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-7,
      ),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();

export interface LeaveBalanceAdjustment {
  idempotencyKey: string;
  delta: number;
  reason: string;
  by: string;
  at: string;
}
const adjustmentHistorySchema = z.array(
  z
    .object({
      idempotencyKey: z.string().optional(),
      delta: z.number().finite(),
      reason: z.string(),
      by: z.string(),
      at: z.string(),
    })
    .passthrough(),
);

/** Balance units are days, as specified by V2-05, independently of the request display unit. */
export function leaveBalanceAmounts(
  input: {
    entitled: unknown;
    carriedOver: unknown;
    used: unknown;
    pending: unknown;
    expiresAt?: unknown;
    adjustments?: unknown;
  },
  asOf: string,
) {
  if (!z.iso.date().safeParse(asOf).success) throw new HrError('INVALID_INPUT');
  const numeric = (value: unknown) => {
    if (typeof value !== 'number' && typeof value !== 'string')
      throw new HrError('INVALID_BALANCE', 409);
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0)
      throw new HrError('INVALID_BALANCE', 409);
    return Math.round(number * 10000);
  };
  const history = adjustmentHistorySchema.safeParse(input.adjustments ?? []);
  if (!history.success) throw new HrError('INVALID_BALANCE', 409);
  const entitled = numeric(input.entitled);
  const carriedOver = numeric(input.carriedOver);
  const used = numeric(input.used);
  const pending = numeric(input.pending);
  // Expiry consumption needs a dated ledger; do not silently discard carryover that may already be used.
  // Existing nonzero expiring carryover is refused until that policy is supported by the balance lifecycle.
  if (carriedOver > 0 && input.expiresAt != null)
    throw new HrError('CARRYOVER_POLICY_REQUIRED', 409);
  const adjusted = history.data.reduce(
    (sum, entry) => sum + Math.round(entry.delta * 10000),
    0,
  );
  return {
    entitled: entitled / 10000,
    carriedOver: carriedOver / 10000,
    used: used / 10000,
    pending: pending / 10000,
    adjusted: adjusted / 10000,
    available: (entitled + carriedOver + adjusted - used - pending) / 10000,
  };
}

export function readAdjustmentHistory(value: unknown) {
  const parsed = adjustmentHistorySchema.safeParse(value ?? []);
  if (!parsed.success) throw new HrError('INVALID_BALANCE', 409);
  return parsed.data;
}

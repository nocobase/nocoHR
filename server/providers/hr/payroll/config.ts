/**
 * V2-06 薪酬设置: the administrator-adjustable rules of payroll, stored as
 * one `personnelSettings` row (`payroll.settings`). Every rule the spec
 * leaves to configuration has a default here:
 *
 * - `tax`: the cumulative withholding table (综合所得预扣率表一) and the monthly
 *   basic deduction (5,000). 上线前由财务核对.
 * - `minimumWage`: per city, 示例 values.
 * - `thresholds`: net pay change vs last month (20 %), a manual item's amount
 *   (2,000), an imported value's spike factor over the last three months (3×).
 * - `approval`: the levels after the payroll specialist submits; each names
 *   the permission set whose holders decide it. Default: one level,
 *   hr.payrollApprover.
 * - `bankExport`: the columns of the bank payment CSV.
 * - `vendorBill.aiEmployee`: the AI employee called after a bill is
 *   uploaded (账单上传后处理); null notifies hr.payroll only.
 * - `socialInsurance`: the month of the yearly base adjustment (7), the day
 *   of month up to which a new hire is insured that month (15), and the city
 *   each department's employees are insured in (walking up the tree).
 * - `proration`: `workdays` counts the working days (Mon–Fri, holidays and
 *   make-up days from the attendance calendar) of the employed part of the
 *   month; a full month is the structure's payDaysPerMonth.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { json } from '../platform.js';

export const PAYROLL_SETTINGS_ID = 'payroll.settings';

const money = z.number().finite().min(0).max(100_000_000);
const percent = z.number().finite().min(0).max(100);

export const payrollSettingsSchema = z
  .object({
    tax: z
      .object({
        monthlyDeduction: money,
        brackets: z
          .array(
            z
              .object({
                upTo: money.nullable(),
                rate: percent,
                quickDeduction: money,
              })
              .strict(),
          )
          .min(1)
          .max(12),
      })
      .strict(),
    minimumWage: z
      .array(
        z
          .object({ city: z.string().trim().min(1).max(64), amount: money })
          .strict(),
      )
      .max(50),
    thresholds: z
      .object({
        netChangePercent: percent,
        manualItemAmount: money,
        importSpikeFactor: z.number().finite().min(1).max(100),
      })
      .strict(),
    approval: z
      .object({
        levels: z
          .array(
            z
              .object({
                title: z.string().trim().min(1).max(64),
                permissionSet: z.string().trim().min(1).max(64),
              })
              .strict(),
          )
          .min(1)
          .max(5),
      })
      .strict(),
    bankExport: z
      .object({
        columns: z
          .array(
            z.enum([
              'employeeNo',
              'name',
              'bankName',
              'accountNo',
              'net',
              'month',
              'department',
            ]),
          )
          .min(1)
          .max(10),
      })
      .strict(),
    vendorBill: z
      .object({ aiEmployee: z.string().trim().min(1).max(64).nullable() })
      .strict(),
    socialInsurance: z
      .object({
        baseAdjustMonth: z.number().int().min(1).max(12),
        cutoffDay: z.number().int().min(1).max(31),
        cityByDepartment: z
          .array(
            z
              .object({
                departmentId: z.string().min(1).max(64),
                city: z.string().trim().min(1).max(64),
              })
              .strict(),
          )
          .max(100),
      })
      .strict(),
    proration: z.enum(['workdays']),
  })
  .strict();

export type PayrollSettings = z.infer<typeof payrollSettingsSchema>;

export const PAYROLL_SETTINGS_DEFAULTS: PayrollSettings = {
  tax: {
    monthlyDeduction: 5000,
    brackets: [
      { upTo: 36_000, rate: 3, quickDeduction: 0 },
      { upTo: 144_000, rate: 10, quickDeduction: 2520 },
      { upTo: 300_000, rate: 20, quickDeduction: 16_920 },
      { upTo: 420_000, rate: 25, quickDeduction: 31_920 },
      { upTo: 660_000, rate: 30, quickDeduction: 52_920 },
      { upTo: 960_000, rate: 35, quickDeduction: 85_920 },
      { upTo: null, rate: 45, quickDeduction: 181_920 },
    ],
  },
  minimumWage: [],
  thresholds: {
    netChangePercent: 20,
    manualItemAmount: 2000,
    importSpikeFactor: 3,
  },
  approval: {
    levels: [{ title: '财务审批', permissionSet: 'hr.payrollApprover' }],
  },
  bankExport: {
    columns: ['employeeNo', 'name', 'bankName', 'accountNo', 'net'],
  },
  vendorBill: { aiEmployee: null },
  socialInsurance: { baseAdjustMonth: 7, cutoffDay: 15, cityByDepartment: [] },
  proration: 'workdays',
};

/** The stored settings merged over the defaults, section by section. */
export async function readPayrollSettings(
  database: DatabaseManager,
): Promise<{ value: PayrollSettings; revision: number }> {
  const row = await database
    .query()
    .selectFrom('personnelSettings')
    .select(['value', 'revision'])
    .where('id', '=', PAYROLL_SETTINGS_ID)
    .executeTakeFirst();
  const stored = json<Record<string, unknown>>(row?.value, {});
  const merged: Record<string, unknown> = { ...PAYROLL_SETTINGS_DEFAULTS };
  for (const key of Object.keys(PAYROLL_SETTINGS_DEFAULTS))
    if (stored[key] !== undefined) merged[key] = stored[key];
  const parsed = payrollSettingsSchema.safeParse(merged);
  return {
    value: parsed.success ? parsed.data : PAYROLL_SETTINGS_DEFAULTS,
    revision: Number(row?.revision ?? 0),
  };
}

/** Withholding for a cumulative taxable income under the table. */
export function withholdingFor(
  taxable: number,
  brackets: PayrollSettings['tax']['brackets'],
): { rate: number; quickDeduction: number; tax: number } {
  const amount = Math.max(0, taxable);
  const bracket =
    brackets.find((b) => b.upTo === null || amount <= b.upTo) ??
    brackets[brackets.length - 1];
  return {
    rate: bracket.rate,
    quickDeduction: bracket.quickDeduction,
    tax: Math.max(0, (amount * bracket.rate) / 100 - bracket.quickDeduction),
  };
}

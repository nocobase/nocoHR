/**
 * 上线准备 · 本年个税累计期初: how an imported opening balance enters the
 * cumulative withholding (累计预扣法) of the months NocoHR calculates.
 *
 * An opening row holds, for one employee and year, the cumulative figures of
 * the months the previous system withheld for, from `startMonth` (January,
 * or the hiring month of that year) up to and including `throughMonth`.
 *
 * The rule (never double counting):
 * - The opening covers the months up to `throughMonth`. A NocoHR payslip of
 *   such a month (a parallel run, say) is never added to it: for the months
 *   after `throughMonth` the cumulative figures start from the opening, not
 *   from that payslip.
 * - For a month M after `throughMonth`: when a counted NocoHR payslip of the
 *   year exists after `throughMonth` and before M, M continues from that
 *   payslip's snapshot, which already contains the opening (it was
 *   calculated from it); otherwise M starts from the opening itself. Months
 *   without a payslip in between still count a basic deduction each, as
 *   without an opening.
 * - 累计专项附加扣除 is the opening's amount plus the employee's declared
 *   deductions of the months after `throughMonth` only, so a declaration
 *   entered from January is not counted again for the opening's months.
 * - A month up to `throughMonth` that NocoHR calculates ignores the opening.
 * - The importer refuses an opening for an employee whose payslip after
 *   `throughMonth` is already approved or further (pendingApproval, approved,
 *   published, closed): those payslips were calculated without it and cannot
 *   change. A cycle still being worked on (calculated, reviewing) goes back
 *   to draft and is calculated again.
 */
import { str } from '../shared.js';
import type { PriorTax } from './calc.js';
import { addMonths, num, type Query } from './common.js';

export interface TaxOpening {
  id: string;
  employeeId: string;
  year: number;
  startMonth: string;
  throughMonth: string;
  incomeYtd: number;
  basicDeductionYtd: number;
  insuranceYtd: number;
  specialDeductionYtd: number;
  otherDeductionYtd: number;
  withheldYtd: number;
  updatedAt: string | null;
}

export function toTaxOpening(row: Record<string, unknown>): TaxOpening {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    year: Number(row.year),
    startMonth: str(row.startMonth),
    throughMonth: str(row.throughMonth),
    incomeYtd: num(row.incomeYtd),
    basicDeductionYtd: num(row.basicDeductionYtd),
    insuranceYtd: num(row.insuranceYtd),
    specialDeductionYtd: num(row.specialDeductionYtd),
    otherDeductionYtd: num(row.otherDeductionYtd),
    withheldYtd: num(row.withheldYtd),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : row.updatedAt
          ? str(row.updatedAt)
          : null,
  };
}

/** The employee's opening of the year, if one was imported. */
export async function taxOpeningFor(
  query: Query,
  employeeId: string,
  year: number,
): Promise<TaxOpening | null> {
  const row = await query
    .selectFrom('payrollTaxOpenings')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .where('year', '=', year)
    .executeTakeFirst();
  return row ? toTaxOpening(row) : null;
}

export function monthIndex(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + m - 1;
}

/** Where the opening's cumulative period began: the hiring month of the year, else January. */
export function openingStartMonth(
  year: number,
  hireDate: string | null,
  throughMonth: string,
): string {
  const hired = hireDate?.slice(0, 7);
  return hired && hired.startsWith(`${year}-`) && hired <= throughMonth
    ? hired
    : `${year}-01`;
}

/** The months the opening covers (its 累计月数). */
export function openingMonths(opening: TaxOpening): number {
  return monthIndex(opening.throughMonth) - monthIndex(opening.startMonth) + 1;
}

/**
 * The prior figures of a month after the opening's `throughMonth`, when no
 * counted NocoHR payslip lies between them.
 */
export function priorFromOpening(
  opening: TaxOpening,
  month: string,
  monthlyDeduction: number,
): PriorTax {
  const gap = Math.max(
    0,
    monthIndex(month) - monthIndex(opening.throughMonth) - 1,
  );
  return {
    months: openingMonths(opening) + gap,
    incomeYtd: opening.incomeYtd,
    insuranceYtd: opening.insuranceYtd,
    withheldYtd: opening.withheldYtd,
    startMonth: opening.startMonth,
    basicDeductionYtd: opening.basicDeductionYtd + monthlyDeduction * gap,
    otherDeductionYtd: opening.otherDeductionYtd,
  };
}

/** The first month whose declared special deductions count on top of the opening. */
export function afterOpening(opening: TaxOpening): string {
  return addMonths(opening.throughMonth, 1);
}

/** The opening as the payslip snapshot (inputs.tax.opening) records it. */
export function openingSnapshot(opening: TaxOpening) {
  return {
    id: opening.id,
    throughMonth: opening.throughMonth,
    startMonth: opening.startMonth,
    incomeYtd: opening.incomeYtd,
    basicDeductionYtd: opening.basicDeductionYtd,
    insuranceYtd: opening.insuranceYtd,
    specialDeductionYtd: opening.specialDeductionYtd,
    otherDeductionYtd: opening.otherDeductionYtd,
    withheldYtd: opening.withheldYtd,
    updatedAt: opening.updatedAt,
  };
}

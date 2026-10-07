// 上线准备 · 本年个税累计期初: the cumulative withholding of the first month NocoHR calculates after an imported
// opening balance (server/providers/hr/payroll/tax-opening.ts), as a worked example of 累计预扣法.
import { describe, expect, it } from 'vitest';

import {
  calculatePayslip,
  type CalculationInput,
  type PriorTax,
} from '../../server/providers/hr/payroll/calc.ts';
import { PAYROLL_SETTINGS_DEFAULTS } from '../../server/providers/hr/payroll/config.ts';
import {
  openingMonths,
  openingStartMonth,
  priorFromOpening,
  type TaxOpening,
} from '../../server/providers/hr/payroll/tax-opening.ts';

/** January–September with another system: 20,000 a month, 2,000 insurance, 1,000 special deductions. */
const OPENING: TaxOpening = {
  id: 'o1',
  employeeId: 'e1',
  year: 2026,
  startMonth: '2026-01',
  throughMonth: '2026-09',
  incomeYtd: 180_000,
  basicDeductionYtd: 45_000,
  insuranceYtd: 18_000,
  specialDeductionYtd: 9_000,
  otherDeductionYtd: 0,
  // (180,000 − 45,000 − 18,000 − 9,000) = 108,000 × 10% − 2,520
  withheldYtd: 8_280,
  updatedAt: null,
};

/** October: a 20,000 base salary, no enrolment in this example, 1,000 special deductions this month. */
function october(prior: PriorTax, specialYtd: number): CalculationInput {
  return {
    month: '2026-10',
    departmentChain: [],
    salary: {
      id: 's1',
      effectiveMonth: '2026-10',
      baseSalary: 20_000,
      fixedAllowances: [],
    },
    structure: {
      id: 'st1',
      title: 'Monthly',
      payDaysPerMonth: 21.75,
      params: [],
      items: [
        {
          code: 'base',
          title: 'Base salary',
          kind: 'earning',
          calc: 'fixed',
          formula: null,
          unit: null,
          departmentIds: [],
          taxable: true,
          includedInSocialBase: false,
          sortOrder: 0,
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
    specialDeductionYtd: specialYtd,
    specialDeductionMonth: 1_000,
    prior,
    tax: PAYROLL_SETTINGS_DEFAULTS.tax,
  };
}

describe('tax opening balance', () => {
  it('withholds October by the cumulative method on top of an imported January–September', () => {
    const prior = priorFromOpening(OPENING, '2026-10', 5_000);
    expect(prior).toMatchObject({
      months: 9,
      incomeYtd: 180_000,
      basicDeductionYtd: 45_000,
      insuranceYtd: 18_000,
      withheldYtd: 8_280,
      otherDeductionYtd: 0,
      startMonth: '2026-01',
    });
    // 累计专项附加扣除 = the opening's 9,000 + October's 1,000.
    const result = calculatePayslip(october(prior, 10_000));
    // Cumulative: 200,000 − 50,000 − 18,000 − 10,000 = 122,000 → 10% − 2,520 = 9,680; minus 8,280 withheld = 1,400.
    expect(result.taxDetail).toMatchObject({
      months: 10,
      incomeYtd: 200_000,
      basicDeductionYtd: 50_000,
      insuranceYtd: 18_000,
      specialDeductionYtd: 10_000,
      otherDeductionYtd: 0,
      taxableYtd: 122_000,
      rate: 10,
      quickDeduction: 2_520,
      taxYtd: 9_680,
      withheldBefore: 8_280,
    });
    expect(result.tax).toBe(1_400);
    expect(result.taxWithheldYtd).toBe(9_680);
    expect(result.net).toBe(18_600);
  });

  it('subtracts 累计其他扣除 and keeps an imported 累计减除费用 that is not 5,000 × months', () => {
    const prior = priorFromOpening(
      { ...OPENING, otherDeductionYtd: 2_000, basicDeductionYtd: 40_000 },
      '2026-10',
      5_000,
    );
    const result = calculatePayslip(october(prior, 10_000));
    // 200,000 − 45,000 − 18,000 − 10,000 − 2,000 = 125,000 → 12,500 − 2,520 = 9,980; − 8,280 = 1,700.
    expect(result.taxDetail.basicDeductionYtd).toBe(45_000);
    expect(result.taxDetail.taxableYtd).toBe(125_000);
    expect(result.tax).toBe(1_700);
  });

  it('counts a month without a payslip between the opening and the month calculated', () => {
    const prior = priorFromOpening(OPENING, '2026-11', 5_000);
    expect(prior.months).toBe(10);
    expect(prior.basicDeductionYtd).toBe(50_000);
    expect(prior.incomeYtd).toBe(180_000);
  });

  it('starts the opening period at the hiring month of the year', () => {
    expect(openingStartMonth(2026, '2026-03-15', '2026-09')).toBe('2026-03');
    expect(openingStartMonth(2026, '2024-07-01', '2026-09')).toBe('2026-01');
    expect(openingStartMonth(2026, null, '2026-09')).toBe('2026-01');
    expect(
      openingMonths({
        ...OPENING,
        startMonth: '2026-03',
        throughMonth: '2026-09',
      }),
    ).toBe(7);
  });

  it('leaves the calculation unchanged without an opening', () => {
    const prior: PriorTax = {
      months: 0,
      incomeYtd: 0,
      insuranceYtd: 0,
      withheldYtd: 0,
      startMonth: '2026-10',
    };
    const result = calculatePayslip(october(prior, 1_000));
    // 20,000 − 5,000 − 1,000 = 14,000 × 3% = 420.
    expect(result.taxDetail.basicDeductionYtd).toBe(5_000);
    expect(result.tax).toBe(420);
  });
});

/**
 * V2-06 月度算薪: the pure calculation of one payslip. Everything it needs is
 * passed in — the salary file, the structure, the locked attendance figures,
 * the month's imported values and manual items, the employee's enrolment and
 * plan, the special deductions and last month's cumulative tax figures — and
 * everything it used is returned as the payslip's `inputs` snapshot, so an
 * approved payslip keeps the formulas and values it was computed with.
 *
 * Rules:
 * - Items run in `sortOrder`; an item limited to departments runs only for
 *   employees in them (sub-departments included, resolved by the caller).
 * - fixed: `base` for the code `base`, otherwise the salary file's allowance
 *   with the item's code. imported: the month's value, 0 when missing.
 *   manual: the sum of the month's manual entries with the item's code.
 *   formula: the safe evaluator over the whitelisted variables.
 * - Money is rounded half-up to two decimals per item; reference items keep
 *   their value (four decimals) and never count towards pay.
 * - Gross (应发) = earnings − deductions of the structure, plus manual
 *   corrections that name no item (补发 when positive, 补扣 when negative;
 *   both taxable).
 * - Social insurance per plan item: the enrolment's base clamped to the
 *   item's range × the rate (rates are percentages).
 * - Tax: cumulative withholding. This month = (cumulative taxable income −
 *   5,000 × months − cumulative insurance − cumulative special deductions) ×
 *   rate − quick deduction − withheld so far, never below zero.
 * - Net (实发) = gross − personal insurance − tax.
 */
import {
  checkFormula,
  evaluateFormula,
  formulaVariables,
  parseFormula,
  roundTo,
  type FormulaNode,
} from './formula.js';
import { withholdingFor, type PayrollSettings } from './config.js';

export const ITEM_KINDS = ['earning', 'deduction', 'reference'] as const;
export const ITEM_CALCS = ['fixed', 'formula', 'manual', 'imported'] as const;
export const INSURANCE_CODES = [
  'pension',
  'medical',
  'unemployment',
  'injury',
  'maternity',
  'housingFund',
] as const;

export interface StructureItem {
  code: string;
  title: string;
  kind: (typeof ITEM_KINDS)[number];
  calc: (typeof ITEM_CALCS)[number];
  formula: string | null;
  unit: string | null;
  departmentIds: string[];
  taxable: boolean;
  includedInSocialBase: boolean;
  sortOrder: number;
}

export interface StructureParam {
  code: string;
  title: string;
  value: number;
  unit: string | null;
}

export interface StructureInput {
  id: string;
  title: string;
  items: StructureItem[];
  params: StructureParam[];
  payDaysPerMonth: number;
}

export interface SalaryFileInput {
  id: string;
  effectiveMonth: string;
  baseSalary: number;
  fixedAllowances: { code: string; amount: number }[];
  /** V4-12: 绩效奖金基数. */
  bonusBase?: number | null;
}

export interface AttendanceInput {
  nightShiftCount: number;
  absentDays: number;
  shiftCounts: Record<string, number>;
  overtimeByType: Record<string, number>;
  leaveByType: Record<string, number>;
}

export interface PlanItem {
  code: (typeof INSURANCE_CODES)[number];
  employerRate: number;
  employeeRate: number;
  baseMin: number;
  baseMax: number;
}

export interface InsuranceInput {
  planCity: string;
  socialBase: number;
  housingFundBase: number;
  items: PlanItem[];
}

export interface ManualEntry {
  code: string;
  amount: number;
  reason: string;
  by: string;
}

export interface PriorTax {
  /** Months counted before this one in the cumulative period. */
  months: number;
  incomeYtd: number;
  insuranceYtd: number;
  withheldYtd: number;
  /** The first month of the cumulative period (YYYY-MM). */
  startMonth: string;
}

export interface CalculationInput {
  month: string;
  departmentChain: readonly string[];
  salary: SalaryFileInput;
  structure: StructureInput;
  payableDays: number;
  attendance: AttendanceInput;
  importedValues: Record<string, number>;
  manualItems: ManualEntry[];
  insurance: InsuranceInput | null;
  /** 累计专项附加扣除 over the cumulative period, this month included. */
  specialDeductionYtd: number;
  specialDeductionMonth: number;
  prior: PriorTax;
  tax: PayrollSettings['tax'];
  /** V4-12: perf.coefficient (0 without a bonus cycle, a published result or coefficients). */
  perf?: { coefficient: number } | null;
}

export interface VariableSource {
  name: string;
  value: number;
  source:
    | 'salary'
    | 'computed'
    | 'attendance'
    | 'import'
    | 'param'
    | 'item'
    // V4-12
    | 'performance';
}

export interface PayslipLine {
  code: string;
  title: string;
  kind: StructureItem['kind'] | 'adjustment';
  calc: StructureItem['calc'];
  amount: number | null;
  value: number | null;
  unit: string | null;
  formula: string | null;
  /** The formula with the values it used, such as "12 × 50". */
  expression: string | null;
  sources: VariableSource[];
  taxable: boolean;
  includedInSocialBase: boolean;
}

export interface InsuranceLine {
  code: PlanItem['code'];
  base: number;
  employeeRate: number;
  employerRate: number;
  employee: number;
  employer: number;
}

export interface CalculationResult {
  lines: PayslipLine[];
  gross: number;
  taxableIncome: number;
  socialEmployee: number;
  housingFundEmployee: number;
  insuranceLines: InsuranceLine[];
  /** The base was outside a plan item's range and was clamped. */
  baseClamped: { code: string; base: number; clamped: number }[];
  tax: number;
  taxableIncomeYtd: number;
  taxWithheldYtd: number;
  taxDetail: {
    months: number;
    startMonth: string;
    incomeYtd: number;
    basicDeductionYtd: number;
    insuranceYtd: number;
    specialDeductionYtd: number;
    specialDeductionMonth: number;
    taxableYtd: number;
    rate: number;
    quickDeduction: number;
    taxYtd: number;
    withheldBefore: number;
  };
  net: number;
  employerCost: {
    items: Record<string, number>;
    social: number;
    housingFund: number;
    total: number;
  };
}

/** Whether an item applies to an employee whose department chain (self first) is given. */
export function itemApplies(
  item: Pick<StructureItem, 'departmentIds'>,
  departmentChain: readonly string[],
): boolean {
  return (
    !item.departmentIds.length ||
    item.departmentIds.some((id) => departmentChain.includes(id))
  );
}

function variableValue(
  name: string,
  input: CalculationInput,
  results: Map<string, number>,
): { value: number; source: VariableSource['source'] } {
  const base = input.salary.baseSalary;
  const dailyRate = base / (input.structure.payDaysPerMonth || 21.75);
  const [head, second, third] = name.split('.');
  switch (head) {
    case 'base':
      return { value: base, source: 'salary' };
    case 'dailyRate':
      return { value: dailyRate, source: 'computed' };
    case 'hourlyRate':
      return { value: dailyRate / 8, source: 'computed' };
    case 'payableDays':
      return { value: input.payableDays, source: 'computed' };
    case 'payDaysPerMonth':
      return { value: input.structure.payDaysPerMonth, source: 'computed' };
    case 'allowance':
      return {
        value:
          input.salary.fixedAllowances.find((a) => a.code === second)?.amount ??
          0,
        source: 'salary',
      };
    case 'att': {
      const a = input.attendance;
      if (second === 'nightShiftCount')
        return { value: a.nightShiftCount, source: 'attendance' };
      if (second === 'absentDays')
        return { value: a.absentDays, source: 'attendance' };
      const table =
        second === 'shift'
          ? a.shiftCounts
          : second === 'overtime'
            ? a.overtimeByType
            : a.leaveByType;
      return { value: Number(table[third] ?? 0), source: 'attendance' };
    }
    case 'imp':
      return { value: input.importedValues[second] ?? 0, source: 'import' };
    case 'param':
      return {
        value:
          input.structure.params.find((p) => p.code === second)?.value ?? 0,
        source: 'param',
      };
    case 'item':
      return { value: results.get(second) ?? 0, source: 'item' };
    // V4-12
    case 'bonusBase':
      return { value: input.salary.bonusBase ?? 0, source: 'salary' };
    case 'perf':
      return { value: input.perf?.coefficient ?? 0, source: 'performance' };
    default:
      return { value: 0, source: 'computed' };
  }
}

function show(value: number): string {
  return String(roundTo(value, 4));
}

/** The formula with each variable replaced by the value it had, e.g. "12 × 50". */
function substitute(
  formula: string,
  node: FormulaNode,
  values: Map<string, number>,
): string {
  let text = formula;
  // Longest names first, so `att.overtime.workday` is not cut by a shorter one.
  for (const name of formulaVariables(node).sort((a, b) => b.length - a.length))
    text = text.split(name).join(show(values.get(name) ?? 0));
  return text.replace(/\*/gu, '×').replace(/\//gu, '÷');
}

export function calculatePayslip(input: CalculationInput): CalculationResult {
  const results = new Map<string, number>();
  const lines: PayslipLine[] = [];
  const items = [...input.structure.items].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  for (const item of items) {
    if (!itemApplies(item, input.departmentChain)) continue;
    const sources: VariableSource[] = [];
    let raw = 0;
    let expression: string | null = null;
    if (item.calc === 'fixed') {
      raw =
        item.code === 'base'
          ? input.salary.baseSalary
          : (input.salary.fixedAllowances.find((a) => a.code === item.code)
              ?.amount ?? 0);
      sources.push({
        name: item.code === 'base' ? 'base' : `allowance.${item.code}`,
        value: raw,
        source: 'salary',
      });
    } else if (item.calc === 'imported') {
      raw = input.importedValues[item.code] ?? 0;
      sources.push({ name: `imp.${item.code}`, value: raw, source: 'import' });
    } else if (item.calc === 'manual') {
      raw = input.manualItems
        .filter((m) => m.code === item.code)
        .reduce((sum, m) => sum + m.amount, 0);
    } else if (item.formula) {
      const node = parseFormula(item.formula);
      const values = new Map<string, number>();
      for (const name of formulaVariables(node)) {
        const { value, source } = variableValue(name, input, results);
        values.set(name, value);
        sources.push({ name, value: roundTo(value, 4), source });
      }
      raw = evaluateFormula(node, (name) => values.get(name));
      expression = substitute(item.formula, node, values);
    }
    const isMoney = item.kind !== 'reference';
    const amount = isMoney ? roundTo(raw, 2) : null;
    const value = isMoney ? null : roundTo(raw, 4);
    results.set(item.code, isMoney ? amount! : value!);
    lines.push({
      code: item.code,
      title: item.title,
      kind: item.kind,
      calc: item.calc,
      amount,
      value,
      unit: item.unit,
      formula: item.calc === 'formula' ? item.formula : null,
      expression,
      sources,
      taxable: item.taxable,
      includedInSocialBase: item.includedInSocialBase,
    });
  }
  // Manual corrections naming no item of the structure: 补发 / 补扣, both taxable.
  const itemCodes = new Set(items.map((i) => i.code));
  for (const entry of input.manualItems.filter((m) => !itemCodes.has(m.code)))
    lines.push({
      code: entry.code,
      title: entry.reason,
      kind: 'adjustment',
      calc: 'manual',
      amount: roundTo(entry.amount, 2),
      value: null,
      unit: null,
      formula: null,
      expression: null,
      sources: [],
      taxable: true,
      includedInSocialBase: false,
    });

  const signed = (line: PayslipLine) =>
    line.kind === 'earning' || line.kind === 'adjustment'
      ? (line.amount ?? 0)
      : line.kind === 'deduction'
        ? -(line.amount ?? 0)
        : 0;
  const gross = roundTo(
    lines.reduce((sum, line) => sum + signed(line), 0),
    2,
  );
  const taxableIncome = roundTo(
    lines
      .filter((line) => line.taxable)
      .reduce((sum, line) => sum + signed(line), 0),
    2,
  );

  // Social insurance and housing fund.
  const insuranceLines: InsuranceLine[] = [];
  const baseClamped: CalculationResult['baseClamped'] = [];
  if (input.insurance)
    for (const planItem of input.insurance.items) {
      const declared =
        planItem.code === 'housingFund'
          ? input.insurance.housingFundBase
          : input.insurance.socialBase;
      const base = Math.min(
        Math.max(declared, planItem.baseMin),
        planItem.baseMax > 0 ? planItem.baseMax : declared,
      );
      if (base !== declared)
        baseClamped.push({
          code: planItem.code,
          base: declared,
          clamped: base,
        });
      insuranceLines.push({
        code: planItem.code,
        base,
        employeeRate: planItem.employeeRate,
        employerRate: planItem.employerRate,
        employee: roundTo((base * planItem.employeeRate) / 100, 2),
        employer: roundTo((base * planItem.employerRate) / 100, 2),
      });
    }
  const sumOf = (
    filter: (l: InsuranceLine) => boolean,
    pick: 'employee' | 'employer',
  ) =>
    roundTo(
      insuranceLines.filter(filter).reduce((s, l) => s + l[pick], 0),
      2,
    );
  const socialEmployee = sumOf((l) => l.code !== 'housingFund', 'employee');
  const housingFundEmployee = sumOf(
    (l) => l.code === 'housingFund',
    'employee',
  );
  const socialEmployer = sumOf((l) => l.code !== 'housingFund', 'employer');
  const housingFundEmployer = sumOf(
    (l) => l.code === 'housingFund',
    'employer',
  );

  // Cumulative withholding.
  const months = input.prior.months + 1;
  const incomeYtd = roundTo(input.prior.incomeYtd + taxableIncome, 2);
  const basicDeductionYtd = roundTo(input.tax.monthlyDeduction * months, 2);
  const insuranceYtd = roundTo(
    input.prior.insuranceYtd + socialEmployee + housingFundEmployee,
    2,
  );
  const taxableYtd = roundTo(
    Math.max(
      0,
      incomeYtd - basicDeductionYtd - insuranceYtd - input.specialDeductionYtd,
    ),
    2,
  );
  const withholding = withholdingFor(taxableYtd, input.tax.brackets);
  const taxYtd = roundTo(withholding.tax, 2);
  const tax = roundTo(Math.max(0, taxYtd - input.prior.withheldYtd), 2);
  const taxWithheldYtd = roundTo(input.prior.withheldYtd + tax, 2);
  const net = roundTo(gross - socialEmployee - housingFundEmployee - tax, 2);

  return {
    lines,
    gross,
    taxableIncome,
    socialEmployee,
    housingFundEmployee,
    insuranceLines,
    baseClamped,
    tax,
    taxableIncomeYtd: taxableYtd,
    taxWithheldYtd,
    taxDetail: {
      months,
      startMonth: input.prior.startMonth,
      incomeYtd,
      basicDeductionYtd,
      insuranceYtd,
      specialDeductionYtd: roundTo(input.specialDeductionYtd, 2),
      specialDeductionMonth: roundTo(input.specialDeductionMonth, 2),
      taxableYtd,
      rate: withholding.rate,
      quickDeduction: withholding.quickDeduction,
      taxYtd,
      withheldBefore: input.prior.withheldYtd,
    },
    net,
    employerCost: {
      items: Object.fromEntries(
        insuranceLines.map((l) => [l.code, l.employer]),
      ),
      social: socialEmployer,
      housingFund: housingFundEmployer,
      total: roundTo(gross + socialEmployer + housingFundEmployer, 2),
    },
  };
}

/**
 * Checks a structure's items and parameters: codes unique and well-formed,
 * every formula parses and reads only whitelisted variables, `item.<code>`
 * only of earlier items. Answers the first problem as `{ code, item, detail }`.
 */
export function structureProblem(structure: {
  items: StructureItem[];
  params: StructureParam[];
}): { code: string; item: string | null; detail: string | null } | null {
  const CODE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/u;
  const params = new Set<string>();
  for (const param of structure.params) {
    if (!CODE.test(param.code) || params.has(param.code))
      return {
        code: 'STRUCTURE_PARAM_INVALID',
        item: null,
        detail: param.code,
      };
    params.add(param.code);
  }
  const sorted = [...structure.items].sort((a, b) => a.sortOrder - b.sortOrder);
  const importedItems = new Set(
    sorted.filter((i) => i.calc === 'imported').map((i) => i.code),
  );
  const seen = new Set<string>();
  for (const item of sorted) {
    if (!CODE.test(item.code) || seen.has(item.code))
      return { code: 'STRUCTURE_ITEM_INVALID', item: item.code, detail: null };
    if (item.calc === 'formula') {
      try {
        checkFormula(item.formula ?? '', {
          params,
          earlierItems: seen,
          importedItems,
        });
      } catch (error) {
        const reason =
          error && typeof error === 'object' && 'reason' in error
            ? String(error.reason)
            : 'FORMULA_SYNTAX';
        const detail =
          error && typeof error === 'object' && 'detail' in error
            ? ((error as { detail: string | null }).detail ?? null)
            : null;
        return { code: reason, item: item.code, detail };
      }
    }
    seen.add(item.code);
  }
  return null;
}

/**
 * 上线准备 · 薪酬期初导入: four Excel importers a customer going live uses in
 * the browser to load what its previous system holds.
 *
 * - salaryFiles (薪资档案 · 导入期初档案, talent.salary import): one opening
 *   salary file per employee and effective month, without the adjustment
 *   approval, recorded with source `opening` (期初导入). The amount columns
 *   are those the salary structures read from a file: 基本工资, every
 *   allowance (`allowance.<code>` or a fixed item) and 绩效奖金基数 when a
 *   structure uses it. 银行卡号 / 开户行 only when the grant lets the bank
 *   account be read.
 * - enrolments (社保公积金 · 参保 · 导入, talent.socialInsurance import): the
 *   employee's open enrolment, by plan city, with the bases (clamped to the
 *   plan, reported as a warning) and the personal account numbers.
 * - deductions (专项附加扣除 · 导入, talent.socialInsurance import): the rows of
 *   an employee and year replace that year's declared items.
 * - taxOpenings (本年个税累计期初, talent.payroll importOpening): see
 *   tax-opening.ts for how they enter the calculation.
 *
 * Each importer: a template with the columns and one example row → a
 * preview naming every bad cell (row, column, code) and writing nothing →
 * a commit of the same file that re-checks it, refuses any error, writes all
 * rows in one transaction and records a batch (payrollImportBatches). People
 * are matched by 工号, and only those the action's grant reaches: anyone else
 * is an error of their row. Importing again updates the same key (employee
 * and month, employee, employee and year) instead of adding a row.
 */
import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  addMonths,
  iso,
  json,
  loadEmployees,
  maskAccount,
  MONTH,
  num,
  type PayrollEmployee,
  type Query,
} from './common.js';
import type { PayrollContext } from './context.js';
import { storeUpload } from './context.js';
import { numberCell, readSheet, textCell, writeSheet } from './excel.js';
import { formulaVariables, parseFormula } from './formula.js';
import {
  clampBases,
  planFor,
  toEnrolment,
  toPlan,
  type Enrolment,
} from './insurance.js';
import { payrollScopes, type PayrollScopes } from './scope.js';
import type { StructureService, StructureView } from './structures.js';
import { monthIndex, openingStartMonth, toTaxOpening } from './tax-opening.js';

export const IMPORT_KINDS = [
  'salaryFiles',
  'enrolments',
  'deductions',
  'taxOpenings',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** The URL segment of each kind (/api/talent/payroll-imports/<segment>/…). */
export const IMPORT_SEGMENTS: Readonly<Record<string, ImportKind>> = {
  'salary-files': 'salaryFiles',
  enrolments: 'enrolments',
  deductions: 'deductions',
  'tax-openings': 'taxOpenings',
};

/** Cycles whose payslips can no longer change. */
const LOCKED = ['pendingApproval', 'approved', 'published', 'closed'];
/** Cycles that go back to draft when an opening changes their inputs. */
const RECALCULATE = ['calculated', 'reviewing'];

const MAX_AMOUNT = 100_000_000;

export interface RowProblem {
  /** The column title of the cell, or null for the row as a whole. */
  column: string | null;
  code: string;
  params?: Record<string, string | number>;
}

export interface PreviewRow {
  row: number;
  employeeNo: string;
  name: string;
  action: 'create' | 'update' | null;
  /** What will be written, by column title (bank accounts masked). */
  values: Record<string, string | number | null>;
  errors: RowProblem[];
  warnings: RowProblem[];
}

export interface ImportPreview {
  kind: ImportKind;
  columns: string[];
  unknownColumns: string[];
  rows: PreviewRow[];
  validRows: number;
  errorRows: number;
  createRows: number;
  updateRows: number;
}

interface CheckedRow<P> extends PreviewRow {
  plan: P | null;
}

interface Importer<P> {
  resource: string;
  action: string;
  template(
    scopes: PayrollScopes,
    query: Record<string, string | undefined>,
  ): Promise<{ filename: string; sheet: string; rows: unknown[][] }>;
  check(
    scopes: PayrollScopes,
    sheet: ReturnType<typeof readSheet>,
  ): Promise<{
    columns: string[];
    rows: CheckedRow<P>[];
    /** Other column titles the check read (an allowance named by its title alone). */
    recognized?: string[];
  }>;
  write(
    query: Query,
    plans: P[],
    meta: { actor: ActorContext; batchId: string; now: Date },
  ): Promise<{ created: number; updated: number }>;
  count(scopes: PayrollScopes): Promise<number>;
}

// ---------------------------------------------------------------- cells

const EXAMPLE_NO = 'A0001';
const EXAMPLE_NAME = '张三';

/** The cell under the first of these column titles present in the sheet. */
function cell(values: Record<string, unknown>, titles: readonly string[]) {
  for (const title of titles) if (title in values) return values[title];
  return null;
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || textCell(value) === '';
}

/** A month cell: 2026-10, 2026/10, 2026年10月, 202610, or an Excel date. */
export function monthCell(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime()))
    return value.toISOString().slice(0, 7);
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 190001 && value <= 210012 && Number.isInteger(value))
      return monthCell(String(value));
    if (value > 20_000 && value < 80_000) {
      // An Excel date serial (days since 1899-12-30).
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
      return date.toISOString().slice(0, 7);
    }
    return null;
  }
  const text = textCell(value);
  const match =
    /^(\d{4})\s*(?:[-/.年])\s*(\d{1,2})\s*(?:月|[-/.]\d{1,2}日?)?$/u.exec(
      text,
    ) ?? /^(\d{4})(\d{2})$/u.exec(text);
  if (!match) return null;
  const month = `${match[1]}-${match[2].padStart(2, '0')}`;
  return MONTH.test(month) ? month : null;
}

function yearCell(value: unknown): number | null {
  const n = numberCell(value);
  return n !== null && Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

/** A required or optional non-negative amount; records the problem on the row. */
function amountCell(
  value: unknown,
  column: string,
  errors: RowProblem[],
  required: boolean,
): number | null {
  if (blank(value)) {
    if (required) errors.push({ column, code: 'VALUE_REQUIRED' });
    return null;
  }
  const n = numberCell(value);
  if (n === null || n < 0 || n > MAX_AMOUNT) {
    errors.push({ column, code: 'AMOUNT_INVALID' });
    return null;
  }
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------- service

export function createOpeningImportService(
  ctx: PayrollContext,
  structures: StructureService,
) {
  const { platform } = ctx;
  const { database } = platform;

  /** The employees by 工号, and whether the action's grant reaches each. */
  async function people(scopes: PayrollScopes) {
    const all = await loadEmployees(database.query());
    const byNo = new Map(all.map((e) => [e.employeeNo, e]));
    return {
      byNo,
      async inScope(employee: PayrollEmployee) {
        return scopes.employee(employee.id);
      },
    };
  }

  /** The common start of every row: 工号 matched, in scope, not repeated. */
  async function matchEmployee(
    values: Record<string, unknown>,
    lookup: Awaited<ReturnType<typeof people>>,
    errors: RowProblem[],
  ): Promise<{
    employeeNo: string;
    name: string;
    employee: PayrollEmployee | null;
  }> {
    const employeeNo = textCell(cell(values, ['工号', 'employeeNo']));
    const name = textCell(cell(values, ['姓名', 'name']));
    if (!employeeNo) {
      errors.push({ column: '工号', code: 'EMPLOYEE_NO_REQUIRED' });
      return { employeeNo, name, employee: null };
    }
    const employee = lookup.byNo.get(employeeNo) ?? null;
    if (!employee) {
      errors.push({ column: '工号', code: 'EMPLOYEE_NOT_FOUND' });
      return { employeeNo, name, employee: null };
    }
    if (!(await lookup.inScope(employee))) {
      errors.push({ column: '工号', code: 'EMPLOYEE_OUT_OF_SCOPE' });
      return { employeeNo, name, employee: null };
    }
    if (name && name !== employee.name)
      errors.push({
        column: '姓名',
        code: 'NAME_MISMATCH',
        params: { name: employee.name },
      });
    return { employeeNo, name: name || employee.name, employee };
  }

  /** Marks the second and later rows with the same key as errors. */
  function markDuplicates<P>(
    rows: CheckedRow<P>[],
    keyOf: (row: CheckedRow<P>) => string | null,
  ) {
    const first = new Map<string, number>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const seen = first.get(key);
      if (seen === undefined) first.set(key, row.row);
      else
        row.errors.push({
          column: null,
          code: 'DUPLICATE_ROW',
          params: { row: seen },
        });
    }
  }

  /** The latest month of a locked (approved or further) payslip of the employee, at or after `from`. */
  async function lockedPayslipMonth(
    employeeId: string,
    from: string,
    to?: string,
  ): Promise<string | null> {
    let select = database
      .query()
      .selectFrom('payslips')
      .innerJoin('payrollCycles', 'payrollCycles.id', 'payslips.cycleId')
      .select(['payrollCycles.month as month'])
      .where('payslips.employeeId', '=', employeeId)
      .where('payrollCycles.month', '>=', from)
      .where('payrollCycles.status', 'in', LOCKED)
      .where('payslips.calculatedAt', 'is not', null);
    if (to) select = select.where('payrollCycles.month', '<=', to);
    const rows = await select.orderBy('payrollCycles.month', 'desc').execute();
    return rows.length ? str(rows[0].month) : null;
  }

  // -------------------------------------------------------- 薪资档案

  interface SalaryPlan {
    employeeId: string;
    existingId: string | null;
    effectiveMonth: string;
    salaryStructureId: string;
    baseSalary: number;
    fixedAllowances: { code: string; amount: number }[];
    bonusBase: number | null;
    bankAccount: {
      bankName: string | null;
      accountNo: string;
      accountName: string;
    } | null;
  }

  /** The amounts a structure reads from the salary file: allowance codes and whether it uses 绩效奖金基数. */
  function fileReads(structure: StructureView) {
    const allowances = new Map<string, string>();
    let bonusBase = false;
    for (const item of structure.items) {
      if (item.calc === 'fixed' && item.code !== 'base')
        allowances.set(item.code, item.title);
      if (item.calc !== 'formula' || !item.formula) continue;
      let names: string[];
      try {
        names = formulaVariables(parseFormula(item.formula));
      } catch {
        continue;
      }
      for (const name of names) {
        if (name === 'bonusBase') bonusBase = true;
        const [head, code] = name.split('.');
        if (head !== 'allowance' || !code) continue;
        const own = item.formula.trim() === name ? item.title : null;
        if (!allowances.has(code) || own)
          allowances.set(
            code,
            own ??
              structure.items.find((i) => i.code === code)?.title ??
              allowances.get(code) ??
              code,
          );
      }
    }
    return { allowances, bonusBase };
  }

  const BASE_COLUMN = '基本工资（base）';
  const BONUS_COLUMN = '绩效奖金基数（bonusBase）';
  const BANK_NO = '银行卡号';
  const BANK_NAME = '开户行';

  async function salaryColumns(scopes: PayrollScopes, only?: StructureView) {
    const all = (await structures.list()).filter((s) => s.active);
    const used = only ? [only] : all;
    const allowances = new Map<string, string>();
    let bonus = false;
    for (const structure of used) {
      const reads = fileReads(structure);
      for (const [code, title] of reads.allowances)
        if (!allowances.has(code)) allowances.set(code, title);
      bonus ||= reads.bonusBase;
    }
    const bank = (await scopes.of('employeeSalaries')).readable('bankAccount');
    return {
      structures: all,
      allowances,
      bonus,
      bank,
      columns: [
        '工号',
        '姓名',
        '薪资结构',
        '生效月份',
        BASE_COLUMN,
        ...[...allowances].map(([code, title]) => `${title}（${code}）`),
        ...(bonus ? [BONUS_COLUMN] : []),
        ...(bank ? [BANK_NO, BANK_NAME] : []),
      ],
    };
  }

  /** The allowance code a column title names: `标题（code）`, the code itself, or a title. */
  function allowanceOf(header: string, allowances: Map<string, string>) {
    const code = /[（(]([A-Za-z][A-Za-z0-9_]*)[)）]\s*$/u.exec(header)?.[1];
    if (code && allowances.has(code)) return code;
    if (allowances.has(header)) return header;
    for (const [c, title] of allowances) if (title === header) return c;
    return null;
  }

  const salaryFiles: Importer<SalaryPlan> = {
    resource: 'talent.salary',
    action: 'import',
    async template(scopes, query) {
      const only = query.structureId
        ? await structures.get(query.structureId)
        : undefined;
      const {
        columns,
        allowances,
        bonus,
        bank,
        structures: all,
      } = await salaryColumns(scopes, only);
      const example = only ?? all[0];
      const reads = example ? fileReads(example) : null;
      const month = platform.currentDate().slice(0, 7);
      return {
        filename: `salary-files-opening${only ? `-${only.id}` : ''}.xlsx`,
        sheet: '薪资档案',
        rows: [
          columns,
          [
            EXAMPLE_NO,
            EXAMPLE_NAME,
            example?.title ?? '',
            month,
            6000,
            ...[...allowances.keys()].map((code) =>
              reads?.allowances.has(code) ? 500 : null,
            ),
            ...(bonus ? [reads?.bonusBase ? 2000 : null] : []),
            ...(bank ? ['6222 0000 0000 0000', '招商银行'] : []),
          ],
        ],
      };
    },
    async check(scopes, sheet) {
      const meta = await salaryColumns(scopes);
      const lookup = await people(scopes);
      const columnCodes = new Map<string, string>();
      for (const header of sheet.headers) {
        if (
          !header ||
          [
            '工号',
            '姓名',
            '薪资结构',
            '生效月份',
            BASE_COLUMN,
            '基本工资',
            BONUS_COLUMN,
            '绩效奖金基数',
            BANK_NO,
            BANK_NAME,
          ].includes(header)
        )
          continue;
        const code = allowanceOf(header, meta.allowances);
        if (code) columnCodes.set(header, code);
      }
      const existing = await database
        .query()
        .selectFrom('employeeSalaries')
        .select(['id', 'employeeId', 'effectiveMonth', 'source'])
        .execute();
      const existingOf = new Map(
        existing.map((r) => [
          `${str(r.employeeId)}|${str(r.effectiveMonth)}`,
          r,
        ]),
      );
      const rows: CheckedRow<SalaryPlan>[] = [];
      for (const { row, values } of sheet.rows) {
        const errors: RowProblem[] = [];
        const warnings: RowProblem[] = [];
        const { employeeNo, name, employee } = await matchEmployee(
          values,
          lookup,
          errors,
        );
        const structureText = textCell(cell(values, ['薪资结构']));
        let structure: StructureView | null = null;
        if (structureText) {
          structure =
            meta.structures.find(
              (s) => s.title === structureText || s.id === structureText,
            ) ?? null;
          if (!structure)
            errors.push({ column: '薪资结构', code: 'STRUCTURE_NOT_FOUND' });
        } else if (employee) {
          const id = await structures.defaultFor(employee.id);
          structure = meta.structures.find((s) => s.id === id) ?? null;
          if (!structure)
            errors.push({ column: '薪资结构', code: 'VALUE_REQUIRED' });
        }
        const effectiveMonth = monthCell(cell(values, ['生效月份']));
        if (!effectiveMonth)
          errors.push({
            column: '生效月份',
            code: blank(cell(values, ['生效月份']))
              ? 'VALUE_REQUIRED'
              : 'MONTH_INVALID',
          });
        const base = amountCell(
          cell(values, [BASE_COLUMN, '基本工资']),
          BASE_COLUMN,
          errors,
          true,
        );
        const reads = structure ? fileReads(structure) : null;
        const fixedAllowances: { code: string; amount: number }[] = [];
        for (const [header, code] of columnCodes) {
          const raw = values[header];
          if (blank(raw)) continue;
          const amount = amountCell(raw, header, errors, false);
          if (amount === null) continue;
          if (reads && !reads.allowances.has(code)) {
            errors.push({ column: header, code: 'ITEM_NOT_IN_STRUCTURE' });
            continue;
          }
          fixedAllowances.push({ code, amount });
        }
        const bonusRaw = cell(values, [BONUS_COLUMN, '绩效奖金基数']);
        const bonusBase = amountCell(bonusRaw, BONUS_COLUMN, errors, false);
        if (bonusBase !== null && reads && !reads.bonusBase)
          errors.push({ column: BONUS_COLUMN, code: 'ITEM_NOT_IN_STRUCTURE' });
        const accountNo = textCell(cell(values, [BANK_NO])).replace(
          /\s+/gu,
          ' ',
        );
        const bankName = textCell(cell(values, [BANK_NAME]));
        let bankAccount: SalaryPlan['bankAccount'] = null;
        if (accountNo || bankName) {
          if (!meta.bank)
            errors.push({ column: BANK_NO, code: 'FIELD_NOT_ALLOWED' });
          else if (!/^[0-9 ]{4,40}$/u.test(accountNo))
            errors.push({ column: BANK_NO, code: 'BANK_ACCOUNT_INVALID' });
          else if (bankName.length > 100)
            errors.push({ column: BANK_NAME, code: 'VALUE_TOO_LONG' });
          else
            bankAccount = {
              accountNo,
              bankName: bankName || null,
              accountName: employee?.name ?? name,
            };
        }
        let action: PreviewRow['action'] = null;
        let existingId: string | null = null;
        if (employee && effectiveMonth) {
          const found = existingOf.get(`${employee.id}|${effectiveMonth}`);
          if (found && str(found.source) !== 'opening')
            errors.push({ column: '生效月份', code: 'SALARY_MONTH_TAKEN' });
          else {
            existingId = found ? str(found.id) : null;
            action = found ? 'update' : 'create';
          }
          const locked = await lockedPayslipMonth(employee.id, effectiveMonth);
          if (locked)
            errors.push({
              column: '生效月份',
              code: 'SALARY_MONTH_CALCULATED',
              params: { month: locked },
            });
        }
        const ok = !errors.length && employee && structure && effectiveMonth;
        rows.push({
          row,
          employeeNo,
          name,
          action: ok ? action : null,
          values: {
            薪资结构: structure?.title ?? (structureText || null),
            生效月份: effectiveMonth,
            [BASE_COLUMN]: base,
            ...Object.fromEntries(
              fixedAllowances.map((a) => [
                `${meta.allowances.get(a.code) ?? a.code}（${a.code}）`,
                a.amount,
              ]),
            ),
            ...(bonusBase !== null ? { [BONUS_COLUMN]: bonusBase } : {}),
            ...(bankAccount
              ? {
                  [BANK_NO]: maskAccount(bankAccount.accountNo),
                  [BANK_NAME]: bankAccount.bankName,
                }
              : {}),
          },
          errors,
          warnings,
          plan:
            ok && employee && structure && effectiveMonth
              ? {
                  employeeId: employee.id,
                  existingId,
                  effectiveMonth,
                  salaryStructureId: structure.id,
                  baseSalary: base ?? 0,
                  fixedAllowances,
                  bonusBase,
                  bankAccount,
                }
              : null,
        });
      }
      markDuplicates(rows, (r) =>
        r.plan ? `${r.plan.employeeId}|${r.plan.effectiveMonth}` : null,
      );
      return {
        columns: meta.columns,
        rows,
        recognized: [...columnCodes.keys()],
      };
    },
    async write(query, plans, { actor, now }) {
      let created = 0;
      let updated = 0;
      for (const plan of plans) {
        const values = {
          baseSalary: plan.baseSalary,
          fixedAllowances: plan.fixedAllowances,
          salaryStructureId: plan.salaryStructureId,
          bankAccount: plan.bankAccount,
          bonusBase: plan.bonusBase,
          updatedAt: now,
        };
        if (plan.existingId) {
          await query
            .updateTable('employeeSalaries')
            .set(values)
            .where('id', '=', plan.existingId)
            .execute();
          updated += 1;
        } else {
          await query
            .insertInto('employeeSalaries')
            .values({
              id: newId(),
              employeeId: plan.employeeId,
              effectiveMonth: plan.effectiveMonth,
              ...values,
              source: 'opening',
              adjustmentId: null,
              createdBy: actor.userId,
              createdAt: now,
            })
            .execute();
          created += 1;
        }
        // The 待建档 to-do is done (as for a file created by hand).
        await query
          .updateTable('workItems')
          .set({ status: 'done', doneAt: now, updatedAt: now })
          .where('refId', 'like', `payrollOnboard:%:${plan.employeeId}`)
          .where('status', '=', 'open')
          .execute();
      }
      return { created, updated };
    },
    async count(scopes) {
      const rows = await scopes.rows(
        'employeeSalaries',
        await database
          .query()
          .selectFrom('employeeSalaries')
          .select(['id', 'employeeId'])
          .execute(),
      );
      return new Set(rows.map((r) => str(r.employeeId))).size;
    },
  };

  // -------------------------------------------------------- 参保

  interface EnrolmentPlan {
    employeeId: string;
    existing: Enrolment | null;
    planCity: string;
    socialBase: number;
    housingFundBase: number;
    startMonth: string;
    socialAccountNo: string | null;
    housingFundAccountNo: string | null;
    clamped: string[];
  }

  const ENROLMENT_COLUMNS = [
    '工号',
    '姓名',
    '参保方案',
    '社保基数',
    '公积金基数',
    '参保起始月',
    '社保账号',
    '公积金账号',
  ];
  const ACCOUNT = /^[A-Za-z0-9-]{1,64}$/u;

  async function scopedPlans(scopes: PayrollScopes) {
    return (
      await scopes.rows(
        'socialInsurancePlans',
        await database
          .query()
          .selectFrom('socialInsurancePlans')
          .selectAll()
          .execute(),
      )
    ).map((r) => toPlan(r as Record<string, unknown>));
  }

  const enrolments: Importer<EnrolmentPlan> = {
    resource: 'talent.socialInsurance',
    action: 'import',
    async template(scopes) {
      const plans = await scopedPlans(scopes);
      const month = platform.currentDate().slice(0, 7);
      return {
        filename: 'social-insurance-enrolments.xlsx',
        sheet: '参保',
        rows: [
          ENROLMENT_COLUMNS,
          [
            EXAMPLE_NO,
            EXAMPLE_NAME,
            plans[0]?.city ?? '',
            8000,
            8000,
            month,
            null,
            null,
          ],
        ],
      };
    },
    async check(scopes, sheet) {
      const lookup = await people(scopes);
      const plans = await scopedPlans(scopes);
      const all = (
        await database
          .query()
          .selectFrom('employeeSocialInsurances')
          .selectAll()
          .orderBy('startMonth', 'desc')
          .execute()
      ).map((r) => toEnrolment(r as Record<string, unknown>));
      const reachable = new Set(
        (await scopes.rows('employeeSocialInsurances', all)).map((e) => e.id),
      );
      const rows: CheckedRow<EnrolmentPlan>[] = [];
      for (const { row, values } of sheet.rows) {
        const errors: RowProblem[] = [];
        const warnings: RowProblem[] = [];
        const { employeeNo, name, employee } = await matchEmployee(
          values,
          lookup,
          errors,
        );
        const startRaw = cell(values, ['参保起始月']);
        const startMonth = monthCell(startRaw);
        if (!startMonth)
          errors.push({
            column: '参保起始月',
            code: blank(startRaw) ? 'VALUE_REQUIRED' : 'MONTH_INVALID',
          });
        const planText = textCell(cell(values, ['参保方案']));
        let city: string | null = null;
        if (!planText)
          errors.push({ column: '参保方案', code: 'VALUE_REQUIRED' });
        else {
          const named = plans.find(
            (p) => p.city === planText || p.id === planText,
          );
          if (!named)
            errors.push({ column: '参保方案', code: 'PLAN_NOT_FOUND' });
          else city = named.city;
        }
        const plan =
          city && startMonth ? planFor(plans, city, startMonth) : null;
        if (city && startMonth && !plan)
          errors.push({
            column: '参保起始月',
            code: 'PLAN_NOT_IN_FORCE',
            params: { month: startMonth },
          });
        const social = amountCell(
          cell(values, ['社保基数']),
          '社保基数',
          errors,
          true,
        );
        const housing = amountCell(
          cell(values, ['公积金基数']),
          '公积金基数',
          errors,
          true,
        );
        const socialAccountNo = textCell(cell(values, ['社保账号'])) || null;
        const housingFundAccountNo =
          textCell(cell(values, ['公积金账号'])) || null;
        if (socialAccountNo && !ACCOUNT.test(socialAccountNo))
          errors.push({ column: '社保账号', code: 'ACCOUNT_INVALID' });
        if (housingFundAccountNo && !ACCOUNT.test(housingFundAccountNo))
          errors.push({ column: '公积金账号', code: 'ACCOUNT_INVALID' });
        const bases =
          plan && social !== null && housing !== null
            ? clampBases(plan, social, housing)
            : null;
        if (bases?.clamped.includes('socialBase'))
          warnings.push({
            column: '社保基数',
            code: 'BASE_CLAMPED',
            params: { value: bases.socialBase },
          });
        if (bases?.clamped.includes('housingFundBase'))
          warnings.push({
            column: '公积金基数',
            code: 'BASE_CLAMPED',
            params: { value: bases.housingFundBase },
          });
        // The employee's open enrolment (active or a pending start) is updated in place.
        const existing = employee
          ? (all.find(
              (e) =>
                e.employeeId === employee.id &&
                e.status !== 'stopped' &&
                e.pendingAction !== 'stop' &&
                !e.endMonth,
            ) ?? null)
          : null;
        if (existing && !reachable.has(existing.id))
          errors.push({ column: '工号', code: 'EMPLOYEE_OUT_OF_SCOPE' });
        const ok = !errors.length && employee && bases && city && startMonth;
        rows.push({
          row,
          employeeNo,
          name,
          action: ok ? (existing ? 'update' : 'create') : null,
          values: {
            参保方案: city ?? (planText || null),
            社保基数: bases?.socialBase ?? social,
            公积金基数: bases?.housingFundBase ?? housing,
            参保起始月: startMonth,
            社保账号: socialAccountNo,
            公积金账号: housingFundAccountNo,
          },
          errors,
          warnings,
          plan:
            ok && employee && bases && city && startMonth
              ? {
                  employeeId: employee.id,
                  existing,
                  planCity: city,
                  socialBase: bases.socialBase,
                  housingFundBase: bases.housingFundBase,
                  startMonth,
                  socialAccountNo,
                  housingFundAccountNo,
                  clamped: bases.clamped,
                }
              : null,
        });
      }
      markDuplicates(rows, (r) => r.plan?.employeeId ?? null);
      return { columns: ENROLMENT_COLUMNS, rows };
    },
    async write(query, plans, { actor, now }) {
      let created = 0;
      let updated = 0;
      for (const plan of plans) {
        const entry = {
          at: now.toISOString(),
          by: actor.userId,
          summary: plan.clamped.length
            ? `期初导入，基数按方案上下限截取（${plan.clamped.join('、')}）`
            : '期初导入',
        };
        const values = {
          planCity: plan.planCity,
          socialBase: plan.socialBase,
          housingFundBase: plan.housingFundBase,
          startMonth: plan.startMonth,
          socialAccountNo: plan.socialAccountNo,
          housingFundAccountNo: plan.housingFundAccountNo,
          status: 'active',
          pendingAction: null,
          updatedAt: now,
        };
        if (plan.existing) {
          await query
            .updateTable('employeeSocialInsurances')
            .set({
              ...values,
              changeLog: [...plan.existing.changeLog, entry],
            })
            .where('id', '=', plan.existing.id)
            .execute();
          updated += 1;
        } else {
          await query
            .insertInto('employeeSocialInsurances')
            .values({
              id: newId(),
              employeeId: plan.employeeId,
              ...values,
              endMonth: null,
              changeLog: [entry],
              sourceEventId: null,
              createdAt: now,
            })
            .execute();
          created += 1;
        }
      }
      return { created, updated };
    },
    async count(scopes) {
      const rows = await scopes.rows(
        'employeeSocialInsurances',
        await database
          .query()
          .selectFrom('employeeSocialInsurances')
          .select(['id', 'employeeId', 'status'])
          .where('status', '!=', 'stopped')
          .execute(),
      );
      return new Set(rows.map((r) => str(r.employeeId))).size;
    },
  };

  // -------------------------------------------------------- 专项附加扣除

  const DEDUCTION_TYPES: Readonly<Record<string, string>> = {
    子女教育: 'children',
    继续教育: 'continuingEducation',
    大病医疗: 'seriousIllness',
    住房贷款利息: 'housingLoan',
    住房租金: 'housingRent',
    赡养老人: 'elderly',
    '3岁以下婴幼儿照护': 'infantCare',
    三岁以下婴幼儿照护: 'infantCare',
    婴幼儿照护: 'infantCare',
  };
  const DEDUCTION_CODES = new Set(Object.values(DEDUCTION_TYPES));
  const DEDUCTION_COLUMNS = [
    '工号',
    '姓名',
    '年度',
    '扣除类型',
    '每月金额',
    '起始月',
    '结束月',
  ];

  interface DeductionItem {
    type: string;
    monthlyAmount: number;
    startMonth: string;
    endMonth: string | null;
  }
  interface DeductionPlan {
    employeeId: string;
    year: number;
    existingId: string | null;
    item: DeductionItem;
  }

  const deductions: Importer<DeductionPlan> = {
    resource: 'talent.socialInsurance',
    action: 'import',
    async template() {
      const year = Number(platform.currentDate().slice(0, 4));
      return {
        filename: `special-deductions-${year}.xlsx`,
        sheet: '专项附加扣除',
        rows: [
          DEDUCTION_COLUMNS,
          [
            EXAMPLE_NO,
            EXAMPLE_NAME,
            year,
            '子女教育',
            2000,
            `${year}-01`,
            null,
          ],
        ],
      };
    },
    async check(scopes, sheet) {
      const lookup = await people(scopes);
      const existingRows = await database
        .query()
        .selectFrom('employeeTaxDeductions')
        .select(['id', 'employeeId', 'year', 'items'])
        .execute();
      const reachable = new Set(
        (await scopes.rows('employeeTaxDeductions', existingRows)).map((r) =>
          str(r.id),
        ),
      );
      const existingOf = new Map(
        existingRows.map((r) => [`${str(r.employeeId)}|${Number(r.year)}`, r]),
      );
      const rows: CheckedRow<DeductionPlan>[] = [];
      for (const { row, values } of sheet.rows) {
        const errors: RowProblem[] = [];
        const warnings: RowProblem[] = [];
        const { employeeNo, name, employee } = await matchEmployee(
          values,
          lookup,
          errors,
        );
        const yearRaw = cell(values, ['年度']);
        const year = yearCell(yearRaw);
        if (year === null)
          errors.push({
            column: '年度',
            code: blank(yearRaw) ? 'VALUE_REQUIRED' : 'YEAR_INVALID',
          });
        const typeText = textCell(cell(values, ['扣除类型']));
        const type =
          DEDUCTION_TYPES[typeText] ??
          (DEDUCTION_CODES.has(typeText) ? typeText : null);
        if (!type)
          errors.push({
            column: '扣除类型',
            code: typeText ? 'DEDUCTION_TYPE_UNKNOWN' : 'VALUE_REQUIRED',
          });
        const amountRaw = cell(values, ['每月金额']);
        let monthlyAmount = amountCell(amountRaw, '每月金额', errors, true);
        if (monthlyAmount !== null && monthlyAmount > 100_000) {
          errors.push({ column: '每月金额', code: 'AMOUNT_INVALID' });
          monthlyAmount = null;
        }
        const startRaw = cell(values, ['起始月']);
        const startMonth = monthCell(startRaw);
        if (!startMonth)
          errors.push({
            column: '起始月',
            code: blank(startRaw) ? 'VALUE_REQUIRED' : 'MONTH_INVALID',
          });
        else if (year !== null && !startMonth.startsWith(`${year}-`))
          errors.push({
            column: '起始月',
            code: 'MONTH_NOT_IN_YEAR',
            params: { year },
          });
        const endRaw = cell(values, ['结束月']);
        const endMonth = blank(endRaw) ? null : monthCell(endRaw);
        if (!blank(endRaw) && !endMonth)
          errors.push({ column: '结束月', code: 'MONTH_INVALID' });
        else if (endMonth && startMonth && endMonth < startMonth)
          errors.push({ column: '结束月', code: 'END_BEFORE_START' });
        const found =
          employee && year !== null
            ? existingOf.get(`${employee.id}|${year}`)
            : undefined;
        if (found && !reachable.has(str(found.id)))
          errors.push({ column: '工号', code: 'EMPLOYEE_OUT_OF_SCOPE' });
        if (found && json<unknown[]>(found.items, []).length)
          warnings.push({
            column: null,
            code: 'DEDUCTIONS_REPLACED',
            params: { year: year ?? '' },
          });
        const ok =
          !errors.length &&
          employee &&
          year !== null &&
          type &&
          monthlyAmount !== null &&
          startMonth;
        rows.push({
          row,
          employeeNo,
          name,
          action: ok ? (found ? 'update' : 'create') : null,
          values: {
            年度: year,
            扣除类型: typeText || null,
            每月金额: monthlyAmount,
            起始月: startMonth,
            结束月: endMonth,
          },
          errors,
          warnings,
          plan:
            ok &&
            employee &&
            year !== null &&
            type &&
            monthlyAmount !== null &&
            startMonth
              ? {
                  employeeId: employee.id,
                  year,
                  existingId: found ? str(found.id) : null,
                  item: { type, monthlyAmount, startMonth, endMonth },
                }
              : null,
        });
      }
      return { columns: DEDUCTION_COLUMNS, rows };
    },
    async write(query, plans, { now }) {
      // One row per employee and year: the file's items replace the year's.
      const groups = new Map<string, DeductionPlan[]>();
      for (const plan of plans) {
        const key = `${plan.employeeId}|${plan.year}`;
        groups.set(key, [...(groups.get(key) ?? []), plan]);
      }
      let created = 0;
      let updated = 0;
      for (const group of groups.values()) {
        const [first] = group;
        const items = group.map((p) => p.item);
        if (first.existingId) {
          await query
            .updateTable('employeeTaxDeductions')
            .set({ items, source: 'import', updatedAt: now })
            .where('id', '=', first.existingId)
            .execute();
          updated += 1;
        } else {
          await query
            .insertInto('employeeTaxDeductions')
            .values({
              id: newId(),
              employeeId: first.employeeId,
              year: first.year,
              items,
              source: 'import',
              createdAt: now,
              updatedAt: now,
            })
            .execute();
          created += 1;
        }
      }
      return { created, updated };
    },
    async count(scopes) {
      const year = Number(platform.currentDate().slice(0, 4));
      return (
        await scopes.rows(
          'employeeTaxDeductions',
          await database
            .query()
            .selectFrom('employeeTaxDeductions')
            .select(['id', 'employeeId'])
            .where('year', '=', year)
            .execute(),
        )
      ).length;
    },
  };

  // -------------------------------------------------------- 本年个税累计期初

  const TAX_COLUMNS = [
    '工号',
    '姓名',
    '年度',
    '截至月份',
    '累计收入',
    '累计减除费用',
    '累计专项扣除',
    '累计专项附加扣除',
    '累计其他扣除',
    '累计已预扣税额',
  ] as const;
  const TAX_FIELDS: readonly [
    (typeof TAX_COLUMNS)[number],
    keyof Omit<
      TaxOpeningPlan,
      | 'employeeId'
      | 'existingId'
      | 'year'
      | 'startMonth'
      | 'throughMonth'
      | 'recalculate'
    >,
    boolean,
  ][] = [
    ['累计收入', 'incomeYtd', true],
    ['累计减除费用', 'basicDeductionYtd', true],
    ['累计专项扣除', 'insuranceYtd', false],
    ['累计专项附加扣除', 'specialDeductionYtd', false],
    ['累计其他扣除', 'otherDeductionYtd', false],
    ['累计已预扣税额', 'withheldYtd', true],
  ];

  interface TaxOpeningPlan {
    employeeId: string;
    existingId: string | null;
    year: number;
    startMonth: string;
    throughMonth: string;
    incomeYtd: number;
    basicDeductionYtd: number;
    insuranceYtd: number;
    specialDeductionYtd: number;
    otherDeductionYtd: number;
    withheldYtd: number;
    /** Editable cycles after the opening with this employee's payslip: back to draft. */
    recalculate: string[];
  }

  const taxOpenings: Importer<TaxOpeningPlan> = {
    resource: 'talent.payroll',
    action: 'importOpening',
    async template() {
      const today = platform.currentDate().slice(0, 7);
      const year = Number(today.slice(0, 4));
      // The month before go-live (January when going live in January).
      const through = today.endsWith('-01') ? today : addMonths(today, -1);
      const months = Number(through.slice(5, 7));
      return {
        filename: `tax-opening-${year}.xlsx`,
        sheet: '个税累计期初',
        rows: [
          [...TAX_COLUMNS],
          [
            EXAMPLE_NO,
            EXAMPLE_NAME,
            year,
            through,
            20000 * months,
            5000 * months,
            2000 * months,
            1000 * months,
            0,
            0,
          ],
        ],
      };
    },
    async check(scopes, sheet) {
      const lookup = await people(scopes);
      const settings = await ctx.settings();
      const existing = await database
        .query()
        .selectFrom('payrollTaxOpenings')
        .selectAll()
        .execute();
      const reachable = new Set(
        (await scopes.rows('payrollTaxOpenings', existing)).map((r) =>
          str(r.id),
        ),
      );
      const existingOf = new Map(
        existing.map((r) => {
          const o = toTaxOpening(r);
          return [`${o.employeeId}|${o.year}`, o];
        }),
      );
      const rows: CheckedRow<TaxOpeningPlan>[] = [];
      for (const { row, values } of sheet.rows) {
        const errors: RowProblem[] = [];
        const warnings: RowProblem[] = [];
        const { employeeNo, name, employee } = await matchEmployee(
          values,
          lookup,
          errors,
        );
        const yearRaw = cell(values, ['年度']);
        const year = yearCell(yearRaw);
        if (year === null)
          errors.push({
            column: '年度',
            code: blank(yearRaw) ? 'VALUE_REQUIRED' : 'YEAR_INVALID',
          });
        const throughRaw = cell(values, ['截至月份']);
        const throughMonth = monthCell(throughRaw);
        if (!throughMonth)
          errors.push({
            column: '截至月份',
            code: blank(throughRaw) ? 'VALUE_REQUIRED' : 'MONTH_INVALID',
          });
        else if (year !== null && !throughMonth.startsWith(`${year}-`))
          errors.push({
            column: '截至月份',
            code: 'MONTH_NOT_IN_YEAR',
            params: { year },
          });
        const amounts: Record<string, number | null> = {};
        for (const [column, field, required] of TAX_FIELDS)
          amounts[field] = amountCell(
            cell(values, [column]),
            column,
            errors,
            required,
          );
        let startMonth: string | null = null;
        let recalculate: string[] = [];
        if (employee && year !== null && throughMonth?.startsWith(`${year}-`)) {
          if (employee.hireDate && employee.hireDate.slice(0, 7) > throughMonth)
            errors.push({
              column: '截至月份',
              code: 'HIRED_AFTER_OPENING',
              params: { date: employee.hireDate },
            });
          startMonth = openingStartMonth(year, employee.hireDate, throughMonth);
          const months = monthIndex(throughMonth) - monthIndex(startMonth) + 1;
          const most = settings.tax.monthlyDeduction * months;
          if ((amounts.basicDeductionYtd ?? 0) > most)
            warnings.push({
              column: '累计减除费用',
              code: 'BASIC_DEDUCTION_HIGH',
              params: { months, amount: most },
            });
          const locked = await lockedPayslipMonth(
            employee.id,
            addMonths(throughMonth, 1),
            `${year}-12`,
          );
          if (locked)
            errors.push({
              column: '截至月份',
              code: 'TAX_OPENING_AFTER_LOCKED',
              params: { month: locked },
            });
          recalculate = (
            await database
              .query()
              .selectFrom('payslips')
              .innerJoin(
                'payrollCycles',
                'payrollCycles.id',
                'payslips.cycleId',
              )
              .select([
                'payrollCycles.id as id',
                'payrollCycles.month as month',
              ])
              .where('payslips.employeeId', '=', employee.id)
              .where('payrollCycles.month', '>', throughMonth)
              .where('payrollCycles.month', '<=', `${year}-12`)
              .where('payrollCycles.status', 'in', RECALCULATE)
              .execute()
          ).map((r) => str(r.id));
          if (recalculate.length)
            warnings.push({ column: null, code: 'RECALCULATE_NEEDED' });
        }
        const found =
          employee && year !== null
            ? existingOf.get(`${employee.id}|${year}`)
            : undefined;
        if (found && !reachable.has(found.id))
          errors.push({ column: '工号', code: 'EMPLOYEE_OUT_OF_SCOPE' });
        const ok =
          !errors.length &&
          employee &&
          year !== null &&
          throughMonth &&
          startMonth;
        rows.push({
          row,
          employeeNo,
          name,
          action: ok ? (found ? 'update' : 'create') : null,
          values: {
            年度: year,
            截至月份: throughMonth,
            ...Object.fromEntries(
              TAX_FIELDS.map(([column, field]) => [column, amounts[field]]),
            ),
          },
          errors,
          warnings,
          plan:
            ok && employee && year !== null && throughMonth && startMonth
              ? {
                  employeeId: employee.id,
                  existingId: found?.id ?? null,
                  year,
                  startMonth,
                  throughMonth,
                  incomeYtd: amounts.incomeYtd ?? 0,
                  basicDeductionYtd: amounts.basicDeductionYtd ?? 0,
                  insuranceYtd: amounts.insuranceYtd ?? 0,
                  specialDeductionYtd: amounts.specialDeductionYtd ?? 0,
                  otherDeductionYtd: amounts.otherDeductionYtd ?? 0,
                  withheldYtd: amounts.withheldYtd ?? 0,
                  recalculate,
                }
              : null,
        });
      }
      markDuplicates(rows, (r) =>
        r.plan ? `${r.plan.employeeId}|${r.plan.year}` : null,
      );
      return { columns: [...TAX_COLUMNS], rows };
    },
    async write(query, plans, { actor, batchId, now }) {
      let created = 0;
      let updated = 0;
      const cycles = new Set<string>();
      for (const plan of plans) {
        const values = {
          startMonth: plan.startMonth,
          throughMonth: plan.throughMonth,
          incomeYtd: plan.incomeYtd,
          basicDeductionYtd: plan.basicDeductionYtd,
          insuranceYtd: plan.insuranceYtd,
          specialDeductionYtd: plan.specialDeductionYtd,
          otherDeductionYtd: plan.otherDeductionYtd,
          withheldYtd: plan.withheldYtd,
          batchId,
          updatedAt: now,
        };
        if (plan.existingId) {
          await query
            .updateTable('payrollTaxOpenings')
            .set(values)
            .where('id', '=', plan.existingId)
            .execute();
          updated += 1;
        } else {
          await query
            .insertInto('payrollTaxOpenings')
            .values({
              id: newId(),
              employeeId: plan.employeeId,
              year: plan.year,
              ...values,
              createdBy: actor.userId,
              createdAt: now,
            })
            .execute();
          created += 1;
        }
        for (const id of plan.recalculate) cycles.add(id);
      }
      // The results of those cycles are no longer current (as after a cycle import).
      if (cycles.size)
        await query
          .updateTable('payrollCycles')
          .set({ status: 'draft', updatedAt: now })
          .where('id', 'in', [...cycles])
          .where('status', 'in', RECALCULATE)
          .execute();
      return { created, updated };
    },
    async count(scopes) {
      const year = Number(platform.currentDate().slice(0, 4));
      return (
        await scopes.rows(
          'payrollTaxOpenings',
          await database
            .query()
            .selectFrom('payrollTaxOpenings')
            .select(['id', 'employeeId'])
            .where('year', '=', year)
            .execute(),
        )
      ).length;
    },
  };

  // -------------------------------------------------------- the flow

  const importers: Record<ImportKind, Importer<unknown>> = {
    salaryFiles: salaryFiles,
    enrolments: enrolments,
    deductions: deductions,
    taxOpenings: taxOpenings,
  };

  async function open(actor: ActorContext, kind: ImportKind) {
    const importer = importers[kind];
    const scopes = payrollScopes(
      database,
      await authorizeAction(actor.authz, importer.resource, importer.action),
    );
    return { importer, scopes };
  }

  async function checked(
    importer: Importer<unknown>,
    scopes: PayrollScopes,
    bytes: Uint8Array,
    kind: ImportKind,
  ) {
    const sheet = readSheet(bytes);
    if (!sheet.headers.some((h) => h === '工号' || h === 'employeeNo'))
      throw new HrError('IMPORT_COLUMNS_MISSING', 400, { columns: ['工号'] });
    const result = await importer.check(scopes, sheet);
    const known = new Set([...result.columns, ...(result.recognized ?? [])]);
    const unknownColumns = sheet.headers.filter(
      (h) =>
        h &&
        !known.has(h) &&
        !['employeeNo', 'name', '基本工资', '绩效奖金基数'].includes(h),
    );
    const rows = result.rows;
    const preview: ImportPreview = {
      kind,
      columns: result.columns,
      unknownColumns,
      rows: rows.map(({ plan: _plan, ...row }) => row),
      validRows: rows.filter((r) => !r.errors.length).length,
      errorRows: rows.filter((r) => r.errors.length).length,
      createRows: rows.filter((r) => r.action === 'create').length,
      updateRows: rows.filter((r) => r.action === 'update').length,
    };
    return { preview, rows };
  }

  async function lastBatch(kind: ImportKind) {
    return database
      .query()
      .selectFrom('payrollImportBatches')
      .selectAll()
      .where('kind', '=', kind)
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  function presentBatch(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      kind: str(row.kind),
      fileName: row.fileName ? str(row.fileName) : null,
      rowCount: num(row.rowCount),
      createdCount: num(row.createdCount),
      updatedCount: num(row.updatedCount),
      importedBy: row.importedBy ? str(row.importedBy) : null,
      createdAt: iso(row.createdAt),
    };
  }

  return {
    async template(
      actor: ActorContext,
      kind: ImportKind,
      query: Record<string, string | undefined>,
    ) {
      const { importer, scopes } = await open(actor, kind);
      const { filename, sheet, rows } = await importer.template(scopes, query);
      return { filename, bytes: writeSheet(sheet, rows) };
    },

    /** Checks every row and writes nothing. */
    async preview(actor: ActorContext, kind: ImportKind, bytes: Uint8Array) {
      const { importer, scopes } = await open(actor, kind);
      return (await checked(importer, scopes, bytes, kind)).preview;
    },

    /** Checks the file again; any error refuses it; otherwise one transaction and a batch. */
    async commit(
      actor: ActorContext,
      kind: ImportKind,
      file: { name: string; bytes: Uint8Array },
    ) {
      const { importer, scopes } = await open(actor, kind);
      const { preview, rows } = await checked(
        importer,
        scopes,
        file.bytes,
        kind,
      );
      if (!rows.length) throw new HrError('IMPORT_FILE_EMPTY', 400);
      const bad = rows.filter((r) => r.errors.length);
      if (bad.length)
        throw new HrError('IMPORT_HAS_ERRORS', 400, {
          rows: bad.map((r) => r.row),
        });
      const fileId = await storeUpload(ctx, actor, file);
      const batchId = newId();
      const now = new Date();
      const counts = await database.transaction(async (connection) => {
        const result = await importer.write(
          connection.query,
          rows.map((r) => r.plan),
          { actor, batchId, now },
        );
        await connection.query
          .insertInto('payrollImportBatches')
          .values({
            id: batchId,
            kind,
            fileId,
            fileName: file.name.slice(-200),
            rowCount: rows.length,
            createdCount: result.created,
            updatedCount: result.updated,
            importedBy: actor.userId,
            createdAt: now,
          })
          .execute();
        return result;
      });
      ctx.audit({
        event: 'payroll.openingImport',
        kind,
        batchId,
        fileId,
        rows: rows.length,
        created: counts.created,
        updated: counts.updated,
        by: actor.userId,
      });
      return {
        batchId,
        rows: preview.rows.length,
        created: counts.created,
        updated: counts.updated,
      };
    },

    /** For the 上线准备 checklist: the records there are (in the caller's scope) and the last import. */
    async status(actor: ActorContext, kind: ImportKind) {
      const { importer, scopes } = await open(actor, kind);
      const last = await lastBatch(kind);
      return {
        count: await importer.count(scopes),
        lastImportedAt: last ? iso(last.createdAt) : null,
      };
    },

    async batches(actor: ActorContext, kind: ImportKind) {
      await open(actor, kind);
      const rows = await database
        .query()
        .selectFrom('payrollImportBatches')
        .selectAll()
        .where('kind', '=', kind)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .execute();
      return rows.map((r) => presentBatch(r as Record<string, unknown>));
    },
  };
}

export type OpeningImportService = ReturnType<
  typeof createOpeningImportService
>;

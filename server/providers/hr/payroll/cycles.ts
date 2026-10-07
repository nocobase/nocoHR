/**
 * V2-06 算薪: payroll cycles and payslips.
 *
 * - One cycle per month. Participants: employees on the books that month in
 *   the cycle's departments (all by default), except dispatched workers,
 *   who are paid by their vendor.
 * - 前提检查: every participant's monthly attendance summary must be locked
 *   (V2-05); calculating is refused with the unlocked departments listed.
 *   Enrolment, special deductions and imports are reported, not enforced.
 * - 导入: only items with calc = imported of the structures in use; matched
 *   by employee number; a preview names every bad row; importing writes
 *   `importedValues` and leaves a record in `imports`. A second import of an
 *   item replaces its values.
 * - 计算: entirely on the server, per `calc.ts`; results go to the payslips
 *   and the cycle gets a new calculationId, which the HR assistant checks
 *   once. An import or a manual item after a calculation puts the cycle
 *   back to draft until it is calculated again.
 * - 审批与发放: submit (net pay never negative) → the approval levels of 薪酬设置
 *   (never by the submitter) → approved, locked → published: employees see
 *   their payslips and are notified (no amounts); the bank, tax and
 *   accounting files become available to hr.payroll, every download logged.
 */
import { z } from 'zod';

import { authorizeAction, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  calculatePayslip,
  itemApplies,
  type ManualEntry,
  type PayslipLine,
  type PriorTax,
} from './calc.js';
import {
  addMonths,
  chainOf,
  employedIn,
  iso,
  json,
  loadEmployees,
  MONTH,
  num,
  payableDaysFor,
  readCalendar,
  readStandardDayHours,
  subtreeOf,
  toCsv,
  type PayrollEmployee,
} from './common.js';
import type { PayrollContext } from './context.js';
import { storeUpload } from './context.js';
import { payrollScopes, type PayrollScopes } from './scope.js';
import { numberCell, readSheet, textCell, writeSheet } from './excel.js';
import { enrolmentFor, planFor, type InsuranceService } from './insurance.js';
import {
  approvalSteps,
  decideStep,
  filesForMonth,
  type SalaryFile,
} from './salaries.js';
import {
  asCalcStructure,
  type StructureService,
  type StructureView,
} from './structures.js';
import { sourceLabels, withSourceLabels } from './source-labels.js';

const PAYROLL = 'talent.payroll';
export const EDITABLE = ['draft', 'calculated', 'reviewing'] as const;
export const CYCLE_STATUSES = [
  'draft',
  'calculated',
  'reviewing',
  'pendingApproval',
  'approved',
  'published',
  'closed',
] as const;
/** Cycles whose payslips count towards later months' cumulative tax. */
const COUNTED = [
  'calculated',
  'reviewing',
  'pendingApproval',
  'approved',
  'published',
  'closed',
];
export const EXPORT_KINDS = ['bank', 'tax', 'accounting'] as const;

export interface ImportRecord {
  id: string;
  itemCodes: string[];
  source: 'excel' | 'api';
  fileId: string | null;
  rowCount: number;
  errorRows: number;
  importedBy: string;
  importedAt: string;
  /** Employee numbers present in the file (for 导入缺人: was the employee in it). */
  employeeNos: string[];
}

export interface PayslipIssue {
  key: string;
  type: string;
  severity: 'warn' | 'info';
  facts: Record<string, string | number | boolean | null>;
  note: string | null;
  noteSource: 'ai' | 'rule' | null;
}

export interface CycleView {
  id: string;
  month: string;
  scope: { departmentIds: string[] };
  status: (typeof CYCLE_STATUSES)[number];
  imports: ImportRecord[];
  calculatedAt: string | null;
  calculationId: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvals: Awaited<ReturnType<typeof approvalSteps>>;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  exports: {
    kind: string;
    by: string;
    at: string;
    action: 'generated' | 'downloaded';
  }[];
  review: {
    calculationId: string;
    checkedAt: string;
    total: number;
    added: string[];
    removed: string[];
    runId: string | null;
  } | null;
  /** V4-12: the review cycle whose final ratings this month's perf.coefficient reads. */
  bonusCycleId: string | null;
}

export function toCycle(row: Record<string, unknown>): CycleView {
  return {
    id: str(row.id),
    month: str(row.month),
    scope: {
      departmentIds: [],
      ...json<{ departmentIds?: string[] }>(row.scope, {}),
    },
    status: str(row.status) as CycleView['status'],
    imports: json(row.imports, []),
    calculatedAt: iso(row.calculatedAt),
    calculationId: row.calculationId ? str(row.calculationId) : null,
    submittedBy: row.submittedBy ? str(row.submittedBy) : null,
    submittedAt: iso(row.submittedAt),
    approvals: json(row.approvals, []),
    approvedBy: row.approvedBy ? str(row.approvedBy) : null,
    approvedAt: iso(row.approvedAt),
    publishedAt: iso(row.publishedAt),
    exports: json(row.exports, []),
    review: json(row.review, null),
    bonusCycleId: row.bonusCycleId ? str(row.bonusCycleId) : null,
  };
}

export interface PayslipRow {
  id: string;
  cycleId: string;
  employeeId: string;
  departmentId: string | null;
  importedValues: Record<string, number>;
  inputs: Record<string, unknown> | null;
  lines: PayslipLine[] | null;
  gross: number | null;
  socialEmployee: number | null;
  housingFundEmployee: number | null;
  taxableIncomeYtd: number | null;
  taxWithheldYtd: number | null;
  tax: number | null;
  net: number | null;
  employerCost: Record<string, unknown> | null;
  manualItems: ManualEntry[];
  issues: PayslipIssue[];
  calculatedAt: string | null;
  viewedAt: string | null;
}

export function toPayslip(row: Record<string, unknown>): PayslipRow {
  const n = (value: unknown) =>
    value === null || value === undefined ? null : num(value);
  return {
    id: str(row.id),
    cycleId: str(row.cycleId),
    employeeId: str(row.employeeId),
    departmentId: row.departmentId ? str(row.departmentId) : null,
    importedValues: json(row.importedValues, {}),
    inputs: json(row.inputs, null),
    lines: json(row.lines, null),
    gross: n(row.gross),
    socialEmployee: n(row.socialEmployee),
    housingFundEmployee: n(row.housingFundEmployee),
    taxableIncomeYtd: n(row.taxableIncomeYtd),
    taxWithheldYtd: n(row.taxWithheldYtd),
    tax: n(row.tax),
    net: n(row.net),
    employerCost: json(row.employerCost, null),
    manualItems: json(row.manualItems, []),
    issues: json(row.issues, []),
    calculatedAt: iso(row.calculatedAt),
    viewedAt: iso(row.viewedAt),
  };
}

const createSchema = z
  .object({
    month: z.string().regex(MONTH),
    departmentIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  })
  .strict();
const manualSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    code: z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/u)
      .default('adjustment'),
    amount: z
      .number()
      .finite()
      .min(-1_000_000)
      .max(1_000_000)
      .refine((v) => v !== 0),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
const apiImportSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            employeeNo: z.string().trim().min(1).max(64),
            values: z.record(z.string(), z.number().finite()),
          })
          .strict(),
      )
      .min(1)
      .max(20_000),
  })
  .strict();
const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).nullish(),
  })
  .strict();

/** How long 提交审批 waits for the anomaly check of a calculation (see submit). */
const CHECK_WAIT_MS = 5 * 60_000;

export function createCycleService(
  ctx: PayrollContext,
  structures: StructureService,
  insurance: InsuranceService,
) {
  const { platform } = ctx;
  const { database } = platform;

  /** A cycle; with scopes, one outside the action's grant is not found. */
  async function cycleRow(
    id: string,
    scopes?: PayrollScopes,
  ): Promise<CycleView> {
    const row = await database
      .query()
      .selectFrom('payrollCycles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row || (scopes && !(await scopes.of('payrollCycles')).has(row.id)))
      throw new HrError('PAYROLL_CYCLE_NOT_FOUND', 404);
    return toCycle(row);
  }

  /**
   * A cycle's payslips; with scopes, only those the action's grant reaches
   * (the payslip and its employee), without the fields it does not list.
   */
  async function payslipsOf(
    cycleId: string,
    scopes?: PayrollScopes,
  ): Promise<PayslipRow[]> {
    const rows = await database
      .query()
      .selectFrom('payslips')
      .selectAll()
      .where('cycleId', '=', cycleId)
      .execute();
    if (!scopes)
      return rows.map((row) => toPayslip(row as Record<string, unknown>));
    const slips = [];
    for (const row of await scopes.rows('payslips', rows))
      slips.push(toPayslip(await scopes.fields('payslips', row)));
    return slips;
  }

  /**
   * Whether a non-calculating viewer (the approver) may see this cycle: it
   * waits for a step whose permission set they hold, or they decided a step.
   */
  async function visibleToApprover(
    cycle: CycleView,
    userId: string,
    holders: Map<string, string[]> = new Map(),
  ): Promise<boolean> {
    if (cycle.approvals.some((step) => step.decidedBy === userId)) return true;
    if (cycle.status !== 'pendingApproval') return false;
    const pending = cycle.approvals.find((step) => step.status === 'pending');
    if (!pending) return false;
    if (!holders.has(pending.permissionSet))
      holders.set(
        pending.permissionSet,
        await ctx.holdersOf(pending.permissionSet),
      );
    return holders.get(pending.permissionSet)!.includes(userId);
  }

  async function viewable(actor: ActorContext, id: string) {
    const scopes = payrollScopes(
      database,
      await authorizeAction(actor.authz, PAYROLL, 'view'),
    );
    const cycle = await cycleRow(id, scopes);
    const calculate = await tryAuthorizeAction(
      actor.authz,
      PAYROLL,
      'calculate',
    );
    const full = Boolean(calculate);
    if (!full && !(await visibleToApprover(cycle, actor.userId)))
      throw new HrError('PAYROLL_CYCLE_NOT_FOUND', 404);
    return {
      cycle,
      full,
      scopes,
      calculateScopes: calculate ? payrollScopes(database, calculate) : null,
    };
  }

  function editable(cycle: CycleView) {
    if (!(EDITABLE as readonly string[]).includes(cycle.status))
      throw new HrError('PAYROLL_CYCLE_LOCKED', 409);
  }

  /**
   * The employees a cycle pays, with their files and structures for the
   * month; with scopes, only the employees and files the action's grant reaches.
   */
  async function participants(cycle: CycleView, scopes?: PayrollScopes) {
    const tree = await ctx.tree();
    const scope = cycle.scope.departmentIds.length
      ? new Set(
          cycle.scope.departmentIds.flatMap((id) => [...subtreeOf(id, tree)]),
        )
      : null;
    const onBooks = [];
    for (const e of await loadEmployees(database.query()))
      if (
        e.employmentType !== 'dispatched' &&
        employedIn(e, cycle.month) &&
        (!scope || scope.has(e.departmentId)) &&
        (!scopes || (await scopes.employee(e.id)))
      )
        onBooks.push(e);
    // An action that reads no salary files (import) still needs to know who is
    // paid and by which structure; one that does reads only the files it reaches.
    const files = await filesForMonth(
      ctx,
      cycle.month,
      scopes?.grants('employeeSalaries') ? scopes : undefined,
    );
    const allStructures = new Map(
      (await structures.list()).map((s) => [s.id, s]),
    );
    return {
      tree,
      // 参与员工: on the books with a salary file in force; the rest wait in 待建档 and are reported.
      employees: onBooks.filter((e) => files.has(e.id)),
      withoutFile: onBooks.filter((e) => !files.has(e.id)),
      files,
      structures: allStructures,
      structureOf: (employee: PayrollEmployee): StructureView | null => {
        const file = files.get(employee.id);
        return file
          ? (allStructures.get(file.salaryStructureId) ?? null)
          : null;
      },
    };
  }

  /** The imported items that apply to an employee under their structure. */
  function importedItemsFor(
    structure: StructureView | null,
    chain: readonly string[],
  ): { code: string; title: string; unit: string | null }[] {
    if (!structure) return [];
    return structure.items
      .filter((i) => i.calc === 'imported' && itemApplies(i, chain))
      .map((i) => ({ code: i.code, title: i.title, unit: i.unit }));
  }

  async function prerequisites(cycle: CycleView, scopes?: PayrollScopes) {
    const p = await participants(cycle, scopes);
    const allSummaries = await database
      .query()
      .selectFrom('attendanceMonthlySummaries')
      .select(['id', 'employeeId', 'status'])
      .where('month', '=', cycle.month)
      .execute();
    const summaries = scopes
      ? await scopes.rows('attendanceMonthlySummaries', allSummaries)
      : allSummaries;
    const locked = new Set(
      summaries
        .filter((s) => str(s.status) === 'locked')
        .map((s) => str(s.employeeId)),
    );
    const unlocked = new Map<string, string[]>();
    for (const employee of p.employees)
      if (!locked.has(employee.id)) {
        const list = unlocked.get(employee.departmentId) ?? [];
        list.push(employee.name);
        unlocked.set(employee.departmentId, list);
      }
    const enrolments = await insurance.enrolments(scopes);
    const year = Number(cycle.month.slice(0, 4));
    const allDeductions = await database
      .query()
      .selectFrom('employeeTaxDeductions')
      .select(['id', 'employeeId'])
      .where('year', '=', year)
      .execute();
    const deductions = scopes
      ? await scopes.rows('employeeTaxDeductions', allDeductions)
      : allDeductions;
    const withDeduction = new Set(deductions.map((d) => str(d.employeeId)));
    const slips = new Map(
      (await payslipsOf(cycle.id, scopes)).map((s) => [s.employeeId, s]),
    );
    const imports = new Map<
      string,
      {
        code: string;
        title: string;
        unit: string | null;
        applicable: string[];
        imported: number;
      }
    >();
    for (const employee of p.employees) {
      const chain = chainOf(employee.departmentId, p.tree);
      for (const item of importedItemsFor(p.structureOf(employee), chain)) {
        const entry = imports.get(item.code) ?? {
          ...item,
          applicable: [],
          imported: 0,
        };
        entry.applicable.push(employee.id);
        if (slips.get(employee.id)?.importedValues[item.code] !== undefined)
          entry.imported += 1;
        imports.set(item.code, entry);
      }
    }
    return {
      participants: p.employees.length,
      attendance: {
        ready: unlocked.size === 0,
        unlocked: await Promise.all(
          [...unlocked].map(async ([departmentId, names]) => ({
            departmentId,
            departmentTitle: await ctx.departmentTitle(departmentId),
            count: names.length,
            names: names.slice(0, 20),
          })),
        ),
      },
      salaryFiles: {
        missing: p.withoutFile.map((e) => ({
          employeeId: e.id,
          name: e.name,
          employeeNo: e.employeeNo,
        })),
      },
      insurance: {
        missing: p.employees
          .filter((e) => !enrolmentFor(enrolments, e.id, cycle.month))
          .map((e) => ({
            employeeId: e.id,
            name: e.name,
            employeeNo: e.employeeNo,
          })),
      },
      deductions: {
        count: p.employees.filter((e) => withDeduction.has(e.id)).length,
      },
      imports: [...imports.values()].map((entry) => ({
        code: entry.code,
        title: entry.title,
        unit: entry.unit,
        applicable: entry.applicable.length,
        imported: entry.imported,
      })),
    };
  }

  type PreviewRow = {
    row: number;
    employeeNo: string;
    name: string;
    employeeId: string | null;
    values: Record<string, number>;
    errors: { code: string; item?: string }[];
  };

  /** Matches the rows of an import against the cycle: numbers, scope, applicable items, values. */
  async function matchRows(
    cycle: CycleView,
    input: {
      employeeNo: string;
      name: string;
      row: number;
      cells: Record<string, unknown>;
    }[],
    itemCodes: string[],
    scopes: PayrollScopes,
  ): Promise<PreviewRow[]> {
    const p = await participants(cycle, scopes);
    const all = new Map(
      (await loadEmployees(database.query())).map((e) => [e.employeeNo, e]),
    );
    const inScope = new Set(p.employees.map((e) => e.id));
    return input.map((r) => {
      const errors: PreviewRow['errors'] = [];
      const values: Record<string, number> = {};
      const employee = all.get(r.employeeNo);
      if (!r.employeeNo) errors.push({ code: 'EMPLOYEE_NO_REQUIRED' });
      else if (!employee) errors.push({ code: 'EMPLOYEE_NOT_FOUND' });
      else if (!inScope.has(employee.id))
        errors.push({ code: 'EMPLOYEE_OUT_OF_SCOPE' });
      const applicable = employee
        ? new Set(
            importedItemsFor(
              p.structureOf(employee),
              chainOf(employee.departmentId, p.tree),
            ).map((i) => i.code),
          )
        : new Set<string>();
      for (const code of itemCodes) {
        const raw = r.cells[code];
        if (raw === null || raw === undefined || raw === '') continue;
        const value = numberCell(raw);
        if (value === null) {
          errors.push({ code: 'VALUE_INVALID', item: code });
          continue;
        }
        if (employee && inScope.has(employee.id) && !applicable.has(code)) {
          errors.push({ code: 'ITEM_NOT_APPLICABLE', item: code });
          continue;
        }
        values[code] = value;
      }
      return {
        row: r.row,
        employeeNo: r.employeeNo,
        name: r.name,
        employeeId: employee?.id ?? null,
        values,
        errors,
      };
    });
  }

  /** The importable items of the cycle: calc = imported in any structure its employees use. */
  async function importableItems(cycle: CycleView, scopes?: PayrollScopes) {
    const p = await participants(cycle, scopes);
    const items = new Map<
      string,
      { code: string; title: string; unit: string | null }
    >();
    for (const employee of p.employees)
      for (const item of p.structureOf(employee)?.items ?? [])
        if (item.calc === 'imported' && !items.has(item.code))
          items.set(item.code, {
            code: item.code,
            title: item.title,
            unit: item.unit,
          });
    return [...items.values()];
  }

  function parseImportWorkbook(
    buffer: Uint8Array,
    items: { code: string; title: string }[],
  ) {
    const { headers, rows } = readSheet(buffer);
    const columnOf = new Map<string, string>();
    const unknown: string[] = [];
    for (const header of headers) {
      if (!header || ['工号', '姓名', 'employeeNo', 'name'].includes(header))
        continue;
      const code = /[（(]([A-Za-z][A-Za-z0-9_]*)[)）]\s*$/u.exec(header)?.[1];
      const item = items.find(
        (i) => i.code === code || i.code === header || i.title === header,
      );
      if (item) columnOf.set(header, item.code);
      else unknown.push(header);
    }
    if (!columnOf.size)
      throw new HrError('IMPORT_ITEMS_UNKNOWN', 400, { columns: unknown });
    return {
      itemCodes: [...new Set(columnOf.values())],
      unknownColumns: unknown,
      rows: rows.map((r) => {
        const cells: Record<string, unknown> = {};
        for (const [header, code] of columnOf) cells[code] = r.values[header];
        return {
          row: r.row,
          employeeNo: textCell(r.values['工号'] ?? r.values.employeeNo),
          name: textCell(r.values['姓名'] ?? r.values.name),
          cells,
        };
      }),
    };
  }

  /** Writes matched values; creates the payslip rows imports reach before any calculation. */
  async function writeImport(
    actor: ActorContext,
    cycle: CycleView,
    matched: PreviewRow[],
    record: Omit<
      ImportRecord,
      'id' | 'importedBy' | 'importedAt' | 'rowCount' | 'errorRows'
    >,
    scopes: PayrollScopes,
  ) {
    // Only the payslips the import grant reaches are cleared and written.
    const slips = new Map(
      (await payslipsOf(cycle.id, scopes)).map((s) => [s.employeeId, s]),
    );
    const employees = new Map(
      (await loadEmployees(database.query())).map((e) => [e.id, e]),
    );
    const valid = matched.filter((r) => !r.errors.length && r.employeeId);
    const now = new Date();
    const entry: ImportRecord = {
      id: newId(),
      ...record,
      rowCount: matched.length,
      errorRows: matched.filter((r) => r.errors.length).length,
      importedBy: actor.userId,
      importedAt: now.toISOString(),
    };
    await database.transaction(async (connection) => {
      // Re-importing an item replaces it: clear the item for everyone first.
      for (const slip of slips.values()) {
        const next = { ...slip.importedValues };
        let changed = false;
        for (const code of record.itemCodes)
          if (code in next) {
            delete next[code];
            changed = true;
          }
        if (changed) {
          slip.importedValues = next;
          await connection.query
            .updateTable('payslips')
            .set({ importedValues: next, updatedAt: now })
            .where('id', '=', slip.id)
            .execute();
        }
      }
      for (const row of valid) {
        const slip = slips.get(row.employeeId!);
        if (slip)
          await connection.query
            .updateTable('payslips')
            .set({
              importedValues: { ...slip.importedValues, ...row.values },
              updatedAt: now,
            })
            .where('id', '=', slip.id)
            .execute();
        else
          await connection.query
            .insertInto('payslips')
            .values({
              id: newId(),
              cycleId: cycle.id,
              employeeId: row.employeeId!,
              departmentId:
                employees.get(row.employeeId!)?.departmentId ?? null,
              importedValues: row.values,
              inputs: null,
              lines: null,
              gross: null,
              socialEmployee: null,
              housingFundEmployee: null,
              taxableIncomeYtd: null,
              taxWithheldYtd: null,
              tax: null,
              net: null,
              employerCost: null,
              manualItems: [],
              issues: [],
              calculatedAt: null,
              viewedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
      }
      await connection.query
        .updateTable('payrollCycles')
        .set({
          imports: [...cycle.imports, entry],
          // New inputs: the results are no longer current.
          status: 'draft',
          updatedAt: now,
        })
        .where('id', '=', cycle.id)
        .execute();
    });
    ctx.audit({
      event: 'payroll.import',
      cycleId: cycle.id,
      month: cycle.month,
      items: record.itemCodes,
      source: record.source,
      rows: entry.rowCount,
      errorRows: entry.errorRows,
      by: actor.userId,
    });
    return { imported: valid.length, record: entry };
  }

  /** The cumulative tax figures before a month, from the latest earlier payslip of the year. */
  async function priorTax(
    employee: PayrollEmployee,
    month: string,
  ): Promise<PriorTax> {
    const year = month.slice(0, 4);
    const rows = await database
      .query()
      .selectFrom('payslips')
      .innerJoin('payrollCycles', 'payrollCycles.id', 'payslips.cycleId')
      .select([
        'payslips.inputs as inputs',
        'payslips.taxWithheldYtd as taxWithheldYtd',
        'payrollCycles.month as month',
        'payrollCycles.status as status',
      ])
      .where('payslips.employeeId', '=', employee.id)
      .where('payrollCycles.month', '<', month)
      .where('payrollCycles.month', '>=', `${year}-01`)
      .orderBy('payrollCycles.month', 'desc')
      .execute();
    const previous = rows.find(
      (r) => COUNTED.includes(str(r.status)) && json(r.inputs, null),
    );
    if (previous) {
      const tax = json<{
        tax?: {
          months?: number;
          incomeYtd?: number;
          insuranceYtd?: number;
          startMonth?: string;
        };
      }>(previous.inputs, {}).tax;
      if (tax && typeof tax.months === 'number') {
        // A month without a payslip in between still counts a basic deduction.
        const gap = monthIndex(month) - monthIndex(str(previous.month)) - 1;
        return {
          months: tax.months + Math.max(0, gap),
          incomeYtd: num(tax.incomeYtd),
          insuranceYtd: num(tax.insuranceYtd),
          withheldYtd: num(previous.taxWithheldYtd),
          startMonth: tax.startMonth ?? `${year}-01`,
        };
      }
    }
    // No earlier payslip this year: hired this year, the period starts at the hiring month; otherwise now.
    const hired = employee.hireDate?.slice(0, 7);
    const start =
      hired && hired.startsWith(year) && hired < month ? hired : month;
    return {
      months: monthIndex(month) - monthIndex(start),
      incomeYtd: 0,
      insuranceYtd: 0,
      withheldYtd: 0,
      startMonth: start,
    };
  }

  function monthIndex(month: string): number {
    const [y, m] = month.split('-').map(Number);
    return y * 12 + m - 1;
  }

  /** 累计专项附加扣除 over [start, month], and this month's amount. */
  function specialDeductions(
    items: {
      type: string;
      monthlyAmount: number;
      startMonth: string;
      endMonth?: string | null;
    }[],
    start: string,
    month: string,
  ): { ytd: number; month: number } {
    let ytd = 0;
    let current = 0;
    for (let m = start; m <= month; m = addMonths(m, 1))
      for (const item of items)
        if (item.startMonth <= m && (!item.endMonth || item.endMonth >= m)) {
          ytd += num(item.monthlyAmount);
          if (m === month) current += num(item.monthlyAmount);
        }
    return { ytd, month: current };
  }

  function presentRow(
    slip: PayslipRow,
    employee: PayrollEmployee | undefined,
    title: string,
  ) {
    return {
      id: slip.id,
      employeeId: slip.employeeId,
      employeeNo: employee?.employeeNo ?? '',
      name: employee?.name ?? '',
      departmentId: slip.departmentId,
      departmentTitle: title,
      gross: slip.gross,
      socialEmployee: slip.socialEmployee,
      housingFundEmployee: slip.housingFundEmployee,
      tax: slip.tax,
      net: slip.net,
      calculated: Boolean(slip.lines),
      issues: slip.issues.length,
      manualItems: slip.manualItems.length,
      importedValues: slip.importedValues,
    };
  }

  async function notifyApprovers(cycle: CycleView) {
    const pending = cycle.approvals.find((s) => s.status === 'pending');
    if (!pending) return;
    const holders = (await ctx.holdersOf(pending.permissionSet)).filter(
      (id) => id !== cycle.submittedBy,
    );
    await platform.notify({
      key: `payrollCycle:${cycle.id}:${cycle.submittedAt ?? ''}:level:${pending.level}`,
      userIds: holders,
      message: 'payrollCyclePending',
      params: { month: cycle.month },
      path: `/talent/payroll/${cycle.id}`,
    });
  }

  async function closeWorkItems(prefix: string) {
    const now = new Date();
    await database
      .query()
      .updateTable('workItems')
      .set({ status: 'done', doneAt: now, updatedAt: now })
      .where('refId', 'like', `${prefix}%`)
      .where('status', '=', 'open')
      .execute()
      .catch(() => undefined);
  }

  const service = {
    cycleRow,
    payslipsOf,
    participants,
    prerequisitesOf: prerequisites,

    async list(actor: ActorContext) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'view'),
      );
      const full = Boolean(
        await tryAuthorizeAction(actor.authz, PAYROLL, 'calculate'),
      );
      const rows = await scopes.rows(
        'payrollCycles',
        await database
          .query()
          .selectFrom('payrollCycles')
          .selectAll()
          .orderBy('month', 'desc')
          .execute(),
      );
      const holders = new Map<string, string[]>();
      const cycles = [];
      for (const row of rows) {
        const cycle = toCycle(row);
        if (full || (await visibleToApprover(cycle, actor.userId, holders)))
          cycles.push(cycle);
      }
      const result = [];
      for (const cycle of cycles) {
        const slips = await payslipsOf(cycle.id, scopes);
        result.push({
          ...cycle,
          payslips: slips.filter((s) => s.lines).length,
          issues: slips.reduce((sum, s) => sum + s.issues.length, 0),
          totalNet:
            full || cycle.status !== 'draft'
              ? Math.round(
                  slips.reduce((sum, s) => sum + (s.net ?? 0), 0) * 100,
                ) / 100
              : null,
        });
      }
      return {
        cycles: result,
        can: {
          create: full,
          suggestedMonth: addMonths(platform.currentDate().slice(0, 7), -1),
        },
      };
    },

    async create(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, PAYROLL, 'calculate');
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const exists = await database
        .query()
        .selectFrom('payrollCycles')
        .select(['id'])
        .where('month', '=', parsed.data.month)
        .executeTakeFirst();
      if (exists)
        throw new HrError('PAYROLL_CYCLE_EXISTS', 409, { id: str(exists.id) });
      const now = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('payrollCycles')
        .values({
          id,
          month: parsed.data.month,
          scope: { departmentIds: parsed.data.departmentIds },
          status: 'draft',
          imports: [],
          calculatedAt: null,
          calculationId: null,
          calculatedBy: null,
          submittedBy: null,
          submittedAt: null,
          approvals: [],
          approvedBy: null,
          approvedAt: null,
          publishedAt: null,
          publishedBy: null,
          exports: [],
          review: null,
          // V4-12
          bonusCycleId: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return cycleRow(id);
    },

    /**
     * V4-12 本月发放绩效奖金: sets (or clears, with null) the review cycle whose
     * final ratings perf.coefficient reads — published or closed only — while
     * the cycle is editable. Results are recalculated by the next calculation.
     */
    async setBonusCycle(actor: ActorContext, id: string, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'calculate'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const value =
        input && typeof input === 'object'
          ? (input as { bonusCycleId?: unknown }).bonusCycleId
          : undefined;
      if (value !== null && typeof value !== 'string')
        throw new HrError('INVALID_INPUT', 400);
      let title: string | null = null;
      if (value) {
        if (!ctx.performance)
          throw new HrError('PAYROLL_BONUS_CYCLE_INVALID', 400);
        title = (await ctx.performance().bonusCycle(value)).title;
      }
      await database
        .query()
        .updateTable('payrollCycles')
        .set({ bonusCycleId: value || null, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return { ...(await cycleRow(id)), bonusCycleTitle: title };
    },

    async detail(actor: ActorContext, id: string) {
      const { cycle, full, calculateScopes } = await viewable(actor, id);
      const can = {
        import:
          full &&
          Boolean(await tryAuthorizeAction(actor.authz, PAYROLL, 'import')),
        calculate: full,
        submit: Boolean(
          await tryAuthorizeAction(actor.authz, PAYROLL, 'submit'),
        ),
        approve: false,
        publish: Boolean(
          await tryAuthorizeAction(actor.authz, PAYROLL, 'publish'),
        ),
        export: Boolean(
          await tryAuthorizeAction(actor.authz, PAYROLL, 'export'),
        ),
      };
      const pending = cycle.approvals.find((s) => s.status === 'pending');
      if (
        cycle.status === 'pendingApproval' &&
        pending &&
        cycle.submittedBy !== actor.userId &&
        (await tryAuthorizeAction(actor.authz, PAYROLL, 'approve'))
      )
        can.approve = (await ctx.holdersOf(pending.permissionSet)).includes(
          actor.userId,
        );
      return {
        cycle,
        prerequisites: calculateScopes
          ? await prerequisites(cycle, calculateScopes)
          : null,
        importableItems: calculateScopes
          ? await importableItems(cycle, calculateScopes)
          : [],
        can,
      };
    },

    async payslips(
      actor: ActorContext,
      id: string,
      query: Record<string, string | undefined>,
    ) {
      const { cycle, scopes } = await viewable(actor, id);
      const tree = await ctx.tree();
      const scope = query.departmentId
        ? subtreeOf(query.departmentId, tree)
        : null;
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      const titles = new Map(tree.map((d) => [d.id, d.title]));
      const slips = (await payslipsOf(cycle.id, scopes))
        .filter((s) => !scope || (s.departmentId && scope.has(s.departmentId)))
        .filter((s) => !query.issues || s.issues.length > 0)
        .sort((a, b) =>
          (employees.get(a.employeeId)?.employeeNo ?? '').localeCompare(
            employees.get(b.employeeId)?.employeeNo ?? '',
          ),
        );
      return slips.map((slip) =>
        presentRow(
          slip,
          employees.get(slip.employeeId),
          titles.get(slip.departmentId ?? '') ?? '',
        ),
      );
    },

    async payslip(actor: ActorContext, id: string, payslipId: string) {
      const { cycle, scopes } = await viewable(actor, id);
      const slip = (await payslipsOf(cycle.id, scopes)).find(
        (s) => s.id === payslipId,
      );
      if (!slip) throw new HrError('NOT_FOUND', 404);
      const employee = (await loadEmployees(database.query())).find(
        (e) => e.id === slip.employeeId,
      );
      return {
        ...slip,
        lines: slip.lines
          ? withSourceLabels(slip.lines, await sourceLabels(database))
          : slip.lines,
        employeeNo: employee?.employeeNo ?? '',
        name: employee?.name ?? '',
        departmentTitle: await ctx.departmentTitle(slip.departmentId),
        month: cycle.month,
      };
    },

    async anomalies(actor: ActorContext, id: string) {
      const { cycle, scopes } = await viewable(actor, id);
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      const list = [];
      for (const slip of await payslipsOf(cycle.id, scopes))
        for (const issue of slip.issues)
          list.push({
            ...issue,
            payslipId: slip.id,
            employeeId: slip.employeeId,
            name: employees.get(slip.employeeId)?.name ?? '',
            employeeNo: employees.get(slip.employeeId)?.employeeNo ?? '',
          });
      return {
        review: cycle.review,
        calculationId: cycle.calculationId,
        issues: list,
      };
    },

    async template(actor: ActorContext, id: string, code: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'import'),
      );
      const cycle = await cycleRow(id, scopes);
      const item = (await importableItems(cycle, scopes)).find(
        (i) => i.code === code,
      );
      if (!item) throw new HrError('IMPORT_ITEMS_UNKNOWN', 400);
      const p = await participants(cycle, scopes);
      const rows: unknown[][] = [
        ['工号', '姓名', `${item.title}（${item.code}）`],
      ];
      for (const employee of p.employees) {
        const applies = importedItemsFor(
          p.structureOf(employee),
          chainOf(employee.departmentId, p.tree),
        ).some((i) => i.code === code);
        if (applies) rows.push([employee.employeeNo, employee.name, null]);
      }
      return {
        filename: `${cycle.month}-${item.code}.xlsx`,
        bytes: writeSheet(item.title, rows),
      };
    },

    async previewImport(actor: ActorContext, id: string, buffer: Uint8Array) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'import'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const items = await importableItems(cycle, scopes);
      const parsed = parseImportWorkbook(buffer, items);
      const rows = await matchRows(
        cycle,
        parsed.rows,
        parsed.itemCodes,
        scopes,
      );
      return {
        items: items.filter((i) => parsed.itemCodes.includes(i.code)),
        unknownColumns: parsed.unknownColumns,
        rows,
        validRows: rows.filter((r) => !r.errors.length).length,
        errorRows: rows.filter((r) => r.errors.length).length,
      };
    },

    async commitImport(
      actor: ActorContext,
      id: string,
      file: { name: string; bytes: Uint8Array },
      options: { skipInvalid: boolean },
    ) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'import'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const items = await importableItems(cycle, scopes);
      const parsed = parseImportWorkbook(file.bytes, items);
      const rows = await matchRows(
        cycle,
        parsed.rows,
        parsed.itemCodes,
        scopes,
      );
      const bad = rows.filter((r) => r.errors.length);
      if (bad.length && !options.skipInvalid)
        throw new HrError('IMPORT_HAS_ERRORS', 400, {
          rows: bad.map((r) => r.row),
        });
      const fileId = await storeUpload(ctx, actor, {
        name: file.name,
        bytes: file.bytes,
      });
      return writeImport(
        actor,
        cycle,
        rows,
        {
          itemCodes: parsed.itemCodes,
          source: 'excel',
          fileId,
          employeeNos: rows.map((r) => r.employeeNo).filter(Boolean),
        },
        scopes,
      );
    },

    /** 接口导入: the same checks as Excel, for an API key bound to a holder of talent.payroll:import. */
    async importApi(actor: ActorContext, id: string, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'import'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const parsed = apiImportSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const items = await importableItems(cycle, scopes);
      const codes = [
        ...new Set(parsed.data.rows.flatMap((r) => Object.keys(r.values))),
      ];
      const unknown = codes.filter((c) => !items.some((i) => i.code === c));
      if (unknown.length)
        throw new HrError('IMPORT_ITEMS_UNKNOWN', 400, { columns: unknown });
      const rows = await matchRows(
        cycle,
        parsed.data.rows.map((r, index) => ({
          row: index + 1,
          employeeNo: r.employeeNo,
          name: '',
          cells: r.values,
        })),
        codes,
        scopes,
      );
      const bad = rows.filter((r) => r.errors.length);
      if (bad.length)
        throw new HrError('IMPORT_HAS_ERRORS', 400, {
          rows: bad.map((r) => ({ row: r.row, errors: r.errors })),
        });
      return writeImport(
        actor,
        cycle,
        rows,
        {
          itemCodes: codes,
          source: 'api',
          fileId: null,
          employeeNos: rows.map((r) => r.employeeNo),
        },
        scopes,
      );
    },

    async addManualItem(actor: ActorContext, id: string, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'calculate'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const parsed = manualSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      const slip = (await payslipsOf(cycle.id, scopes)).find(
        (s) => s.employeeId === parsed.data.employeeId,
      );
      if (!slip) throw new HrError('PAYSLIP_NOT_FOUND', 404);
      const entry: ManualEntry = {
        code: parsed.data.code,
        amount: parsed.data.amount,
        reason: parsed.data.reason,
        by: actor.userId,
      };
      await database
        .query()
        .updateTable('payslips')
        .set({
          manualItems: [...slip.manualItems, entry],
          updatedAt: new Date(),
        })
        .where('id', '=', slip.id)
        .execute();
      await database
        .query()
        .updateTable('payrollCycles')
        .set({ status: 'draft', updatedAt: new Date() })
        .where('id', '=', cycle.id)
        .execute();
      return { manualItems: [...slip.manualItems, entry] };
    },

    async removeManualItem(actor: ActorContext, id: string, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'calculate'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const body = z
        .object({
          employeeId: z.string().min(1),
          index: z.number().int().min(0),
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const slip = (await payslipsOf(cycle.id, scopes)).find(
        (s) => s.employeeId === body.data.employeeId,
      );
      if (!slip || !slip.manualItems[body.data.index])
        throw new HrError('NOT_FOUND', 404);
      const next = slip.manualItems.filter((_, i) => i !== body.data.index);
      await database
        .query()
        .updateTable('payslips')
        .set({ manualItems: next, updatedAt: new Date() })
        .where('id', '=', slip.id)
        .execute();
      await database
        .query()
        .updateTable('payrollCycles')
        .set({ status: 'draft', updatedAt: new Date() })
        .where('id', '=', cycle.id)
        .execute();
      return { manualItems: next };
    },

    /** 计算: refuses until every participant's summary is locked; may be repeated until submitted. */
    async calculate(actor: ActorContext, id: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'calculate'),
      );
      const cycle = await cycleRow(id, scopes);
      editable(cycle);
      const check = await prerequisites(cycle, scopes);
      if (!check.attendance.ready)
        throw new HrError('PAYROLL_ATTENDANCE_NOT_LOCKED', 409, {
          departments: check.attendance.unlocked.map((d) => d.departmentTitle),
          unlocked: check.attendance.unlocked,
        });
      const p = await participants(cycle, scopes);
      // A calculation grant limited to some employees calculates those and
      // leaves the other payslips of the cycle as they are.
      const allSlips = await payslipsOf(cycle.id);
      const reachable = new Set(
        (await scopes.rows('payslips', allSlips)).map((s) => s.id),
      );
      const outOfScope = new Set(
        allSlips.filter((s) => !reachable.has(s.id)).map((s) => s.employeeId),
      );
      p.employees = p.employees.filter((e) => !outOfScope.has(e.id));
      const query = database.query();
      const settings = await ctx.settings();
      const calendar = await readCalendar(query);
      const standardDayHours = await readStandardDayHours(query);
      const summaries = new Map(
        (
          await scopes.rows(
            'attendanceMonthlySummaries',
            await query
              .selectFrom('attendanceMonthlySummaries')
              .selectAll()
              .where('month', '=', cycle.month)
              .where('status', '=', 'locked')
              .execute(),
          )
        ).map((s) => [str(s.employeeId), s as Record<string, unknown>]),
      );
      const enrolments = await insurance.enrolments(scopes);
      const plans = await insurance.plans(scopes);
      const year = Number(cycle.month.slice(0, 4));
      const deductions = new Map(
        (
          await scopes.rows(
            'employeeTaxDeductions',
            await query
              .selectFrom('employeeTaxDeductions')
              .selectAll()
              .where('year', '=', year)
              .execute(),
          )
        ).map((d) => [
          str(d.employeeId),
          json<
            {
              type: string;
              monthlyAmount: number;
              startMonth: string;
              endMonth?: string | null;
            }[]
          >(d.items, []),
        ]),
      );
      const existing = new Map(
        allSlips
          .filter((s) => reachable.has(s.id))
          .map((s) => [s.employeeId, s]),
      );
      // V4-12: perf.coefficient from the bonus cycle's final ratings (0 without one).
      const perf =
        cycle.bonusCycleId && ctx.performance
          ? await ctx.performance().coefficientsFor(
              cycle.bonusCycleId,
              p.employees.map((e) => e.id),
            )
          : null;
      const calculationId = newId();
      const now = new Date();
      const results: {
        employeeId: string;
        values: Record<string, unknown>;
        existingId: string | null;
      }[] = [];
      const skipped: { employeeId: string; name: string; reason: string }[] =
        [];
      for (const employee of p.employees) {
        const file: SalaryFile | undefined = p.files.get(employee.id);
        const structure = p.structureOf(employee);
        if (!file || !structure) {
          skipped.push({
            employeeId: employee.id,
            name: employee.name,
            reason: 'SALARY_FILE_REQUIRED',
          });
          continue;
        }
        const summary = summaries.get(employee.id)!;
        const slip = existing.get(employee.id);
        const chain = chainOf(employee.departmentId, p.tree);
        const days = payableDaysFor(
          employee,
          cycle.month,
          structure.payDaysPerMonth,
          calendar,
        );
        const enrolment = enrolmentFor(enrolments, employee.id, cycle.month);
        const plan = enrolment
          ? planFor(plans, enrolment.planCity, cycle.month)
          : null;
        const prior = await priorTax(employee, cycle.month);
        const special = specialDeductions(
          deductions.get(employee.id) ?? [],
          prior.startMonth,
          cycle.month,
        );
        const attendance = {
          nightShiftCount: num(summary.nightShiftCount),
          absentDays: num(summary.absentDays),
          shiftCounts: json<Record<string, number>>(summary.shiftCounts, {}),
          overtimeByType: json<Record<string, number>>(
            summary.overtimeByType,
            {},
          ),
          leaveByType: json<Record<string, number>>(summary.leaveByType, {}),
        };
        const importedValues = slip?.importedValues ?? {};
        const manualItems = slip?.manualItems ?? [];
        const performance = perf?.byEmployee.get(employee.id) ?? null;
        const result = calculatePayslip({
          month: cycle.month,
          departmentChain: chain,
          salary: {
            id: file.id,
            effectiveMonth: file.effectiveMonth,
            baseSalary: file.baseSalary,
            fixedAllowances: file.fixedAllowances,
            // V4-12
            bonusBase: file.bonusBase,
          },
          perf: { coefficient: performance?.coefficient ?? 0 },
          structure: asCalcStructure(structure),
          payableDays: days.payableDays,
          attendance,
          importedValues,
          manualItems,
          insurance:
            enrolment && plan
              ? {
                  planCity: enrolment.planCity,
                  socialBase: enrolment.socialBase,
                  housingFundBase: enrolment.housingFundBase,
                  items: plan.items,
                }
              : null,
          specialDeductionYtd: special.ytd,
          specialDeductionMonth: special.month,
          prior,
          tax: settings.tax,
          standardDayHours,
        });
        const inputs = {
          calculationId,
          // The standard day hourlyRate was divided by (attendance settings).
          standardDayHours,
          employee: {
            employeeNo: employee.employeeNo,
            departmentId: employee.departmentId,
            positionId: employee.positionId,
            hireDate: employee.hireDate,
            leaveDate: employee.leaveDate,
          },
          salary: {
            id: file.id,
            effectiveMonth: file.effectiveMonth,
            baseSalary: file.baseSalary,
            fixedAllowances: file.fixedAllowances,
            // V4-12
            bonusBase: file.bonusBase,
          },
          // V4-12: the rating and coefficient perf.coefficient used (the payslip snapshot).
          perf: cycle.bonusCycleId
            ? {
                bonusCycleId: cycle.bonusCycleId,
                cycleTitle: perf?.cycleTitle ?? null,
                status: performance?.status ?? 'noResult',
                rating: performance?.rating ?? null,
                coefficient: performance?.coefficient ?? 0,
                schemeId: performance?.schemeId ?? null,
              }
            : null,
          structure: {
            id: structure.id,
            title: structure.title,
            payDaysPerMonth: structure.payDaysPerMonth,
            params: structure.params,
            items: structure.items.map((i) => ({
              code: i.code,
              title: i.title,
              kind: i.kind,
              calc: i.calc,
              formula: i.formula,
              departmentIds: i.departmentIds,
            })),
          },
          payableDays: days,
          attendance: { summaryId: str(summary.id), ...attendance },
          importedValues,
          insurance: enrolment
            ? {
                enrolmentId: enrolment.id,
                planId: plan?.id ?? null,
                planCity: enrolment.planCity,
                socialBase: enrolment.socialBase,
                housingFundBase: enrolment.housingFundBase,
                lines: result.insuranceLines,
                clamped: result.baseClamped,
              }
            : null,
          deductions: {
            items: deductions.get(employee.id) ?? [],
            ytd: special.ytd,
            month: special.month,
          },
          tax: { ...result.taxDetail, incomeMonth: result.taxableIncome },
        };
        results.push({
          employeeId: employee.id,
          existingId: slip?.id ?? null,
          values: {
            departmentId: employee.departmentId,
            inputs,
            lines: result.lines,
            gross: result.gross,
            socialEmployee: result.socialEmployee,
            housingFundEmployee: result.housingFundEmployee,
            taxableIncomeYtd: result.taxableIncomeYtd,
            taxWithheldYtd: result.taxWithheldYtd,
            tax: result.tax,
            net: result.net,
            employerCost: result.employerCost,
            calculatedAt: now,
            updatedAt: now,
          },
        });
      }
      const participantIds = new Set(results.map((r) => r.employeeId));
      await database.transaction(async (connection) => {
        for (const r of results)
          if (r.existingId)
            await connection.query
              .updateTable('payslips')
              .set(r.values)
              .where('id', '=', r.existingId)
              .execute();
          else
            await connection.query
              .insertInto('payslips')
              .values({
                id: newId(),
                cycleId: cycle.id,
                employeeId: r.employeeId,
                importedValues: {},
                manualItems: [],
                issues: [],
                viewedAt: null,
                createdAt: now,
                ...r.values,
              })
              .execute();
        // Rows of people no longer paid by this cycle: kept only when they hold imported or manual values.
        for (const slip of existing.values())
          if (!participantIds.has(slip.employeeId)) {
            if (
              !Object.keys(slip.importedValues).length &&
              !slip.manualItems.length
            )
              await connection.query
                .deleteFrom('payslips')
                .where('id', '=', slip.id)
                .execute();
            else
              await connection.query
                .updateTable('payslips')
                .set({
                  lines: null,
                  gross: null,
                  net: null,
                  tax: null,
                  updatedAt: now,
                })
                .where('id', '=', slip.id)
                .execute();
          }
        await connection.query
          .updateTable('payrollCycles')
          .set({
            status: 'calculated',
            calculatedAt: now,
            calculationId,
            calculatedBy: actor.userId,
            updatedAt: now,
          })
          .where('id', '=', cycle.id)
          .execute();
      });
      ctx.onCalculated(cycle.id, calculationId);
      return {
        cycle: await cycleRow(cycle.id),
        calculated: results.length,
        skipped,
      };
    },

    async submit(actor: ActorContext, id: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'submit'),
      );
      const cycle = await cycleRow(id, scopes);
      if (cycle.status !== 'calculated' && cycle.status !== 'reviewing')
        throw new HrError(
          cycle.status === 'draft'
            ? 'PAYROLL_RECALCULATE_REQUIRED'
            : 'PAYROLL_CYCLE_LOCKED',
          409,
        );
      const slips = (await payslipsOf(cycle.id)).filter((s) => s.lines);
      if (!slips.length) throw new HrError('PAYROLL_RECALCULATE_REQUIRED', 409);
      // The HR assistant's anomaly check runs in the background after 计算; until it has finished for this
      // calculation the approver would see a cycle without its explanations. A finished run (also a skipped
      // or failed one, e.g. the task switched off) releases it, and so does a calculation older than
      // CHECK_WAIT_MS, so a check that never started cannot hold the cycle.
      if (
        cycle.calculationId &&
        cycle.review?.calculationId !== cycle.calculationId
      ) {
        const finished = await database
          .query()
          .selectFrom('aiTaskRuns')
          .select(['id'])
          .where('task', '=', 'hrAssistant.payrollCheck')
          .where('dedupeKey', '=', `${cycle.id}:${cycle.calculationId}`)
          .where('status', '!=', 'running')
          .executeTakeFirst();
        const calculatedAt = cycle.calculatedAt
          ? Date.parse(cycle.calculatedAt)
          : 0;
        if (!finished && Date.now() - calculatedAt < CHECK_WAIT_MS)
          throw new HrError('PAYROLL_CHECK_PENDING', 409);
      }
      const negative = slips.filter((s) => (s.net ?? 0) < 0);
      if (negative.length) {
        const employees = new Map(
          (await loadEmployees(database.query())).map((e) => [e.id, e]),
        );
        throw new HrError('PAYROLL_NEGATIVE_NET', 409, {
          names: negative.map(
            (s) => employees.get(s.employeeId)?.name ?? s.employeeId,
          ),
        });
      }
      const now = new Date();
      const steps = await approvalSteps(ctx);
      await database
        .query()
        .updateTable('payrollCycles')
        .set({
          status: 'pendingApproval',
          submittedBy: actor.userId,
          submittedAt: now,
          approvals: steps,
          updatedAt: now,
        })
        .where('id', '=', cycle.id)
        .execute();
      const next = await cycleRow(cycle.id);
      await notifyApprovers(next);
      return next;
    },

    async decide(actor: ActorContext, id: string, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'approve'),
      );
      const parsed = decisionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const cycle = await cycleRow(id, scopes);
      if (cycle.status !== 'pendingApproval')
        throw new HrError('PAYROLL_NOT_PENDING', 409);
      const { steps, outcome } = await decideStep(
        ctx,
        actor,
        cycle.approvals,
        cycle.submittedBy,
        parsed.data,
      );
      const now = new Date();
      await database
        .query()
        .updateTable('payrollCycles')
        .set({
          approvals: steps,
          status:
            outcome === 'approved'
              ? 'approved'
              : outcome === 'rejected'
                ? 'reviewing'
                : 'pendingApproval',
          ...(outcome === 'approved'
            ? { approvedBy: actor.userId, approvedAt: now }
            : {}),
          updatedAt: now,
        })
        .where('id', '=', cycle.id)
        .execute();
      const next = await cycleRow(cycle.id);
      await closeWorkItems(`payrollCycle:${cycle.id}:`);
      if (outcome === 'pending') await notifyApprovers(next);
      else if (cycle.submittedBy)
        await platform.notify({
          key: `payrollCycle:${cycle.id}:${cycle.submittedAt ?? ''}:${outcome}`,
          userIds: [cycle.submittedBy],
          message:
            outcome === 'approved'
              ? 'payrollCycleApproved'
              : 'payrollCycleRejected',
          params: { month: cycle.month },
          path: `/talent/payroll/${cycle.id}`,
        });
      return next;
    },

    /** 发布: employees see their payslips and are told, without amounts; the export files become available. */
    async publish(actor: ActorContext, id: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'publish'),
      );
      const cycle = await cycleRow(id, scopes);
      if (cycle.status !== 'approved')
        throw new HrError('PAYROLL_NOT_APPROVED', 409);
      const now = new Date();
      const generated = EXPORT_KINDS.map((kind) => ({
        kind,
        by: actor.userId,
        at: now.toISOString(),
        action: 'generated' as const,
      }));
      await database
        .query()
        .updateTable('payrollCycles')
        .set({
          status: 'published',
          publishedAt: now,
          publishedBy: actor.userId,
          exports: [...cycle.exports, ...generated],
          updatedAt: now,
        })
        .where('id', '=', cycle.id)
        .execute();
      ctx.audit({
        event: 'payroll.publish',
        cycleId: cycle.id,
        month: cycle.month,
        by: actor.userId,
      });
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      for (const slip of await payslipsOf(cycle.id)) {
        const userId = employees.get(slip.employeeId)?.userId;
        if (!userId || !slip.lines) continue;
        await platform.notify({
          key: `payslipPublished:${cycle.id}:${slip.employeeId}`,
          userIds: [userId],
          message: 'payslipPublished',
          params: { month: cycle.month },
          path: `/talent/my-payslips?month=${cycle.month}`,
        });
      }
      ctx.onPublished?.(cycle.id);
      return cycleRow(cycle.id);
    },

    async close(actor: ActorContext, id: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'publish'),
      );
      const cycle = await cycleRow(id, scopes);
      if (cycle.status !== 'published')
        throw new HrError('PAYROLL_NOT_PUBLISHED', 409);
      await database
        .query()
        .updateTable('payrollCycles')
        .set({ status: 'closed', updatedAt: new Date() })
        .where('id', '=', cycle.id)
        .execute();
      return cycleRow(cycle.id);
    },

    /** 银行代发 / 个税申报明细 / 记账汇总, as CSV; only after publishing; every download is logged. */
    async exportFile(actor: ActorContext, id: string, kind: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, PAYROLL, 'export'),
      );
      if (!(EXPORT_KINDS as readonly string[]).includes(kind))
        throw new HrError('NOT_FOUND', 404);
      const cycle = await cycleRow(id, scopes);
      if (cycle.status !== 'published' && cycle.status !== 'closed')
        throw new HrError('PAYROLL_NOT_PUBLISHED', 409);
      const settings = await ctx.settings();
      // Only the payslips, salary files and fields the export grant reaches.
      const slips = (await payslipsOf(cycle.id, scopes)).filter((s) => s.lines);
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      const tree = await ctx.tree();
      const titles = new Map(tree.map((d) => [d.id, d.title]));
      const files = await filesForMonth(ctx, cycle.month, scopes);
      const ordered = slips.sort((a, b) =>
        (employees.get(a.employeeId)?.employeeNo ?? '').localeCompare(
          employees.get(b.employeeId)?.employeeNo ?? '',
        ),
      );
      let rows: unknown[][];
      if (kind === 'bank') {
        const labels: Record<string, string> = {
          employeeNo: '工号',
          name: '姓名',
          bankName: '开户行',
          accountNo: '银行账号',
          net: '实发金额',
          month: '所属月份',
          department: '部门',
        };
        rows = [settings.bankExport.columns.map((c) => labels[c])];
        for (const slip of ordered) {
          const employee = employees.get(slip.employeeId);
          const bank = files.get(slip.employeeId)?.bankAccount ?? null;
          const value: Record<string, unknown> = {
            employeeNo: employee?.employeeNo ?? '',
            name: bank?.accountName || employee?.name || '',
            bankName: bank?.bankName ?? '',
            accountNo: bank?.accountNo?.replace(/\s/gu, '') ?? '',
            net: (slip.net ?? 0).toFixed(2),
            month: cycle.month,
            department: titles.get(slip.departmentId ?? '') ?? '',
          };
          rows.push(settings.bankExport.columns.map((c) => value[c]));
        }
      } else if (kind === 'tax') {
        const people = await scopes.of('employees');
        const idRows = await database
          .query()
          .selectFrom('employees')
          .select(['id', 'idType', 'idNumber'])
          .execute();
        const ids = new Map(
          idRows.map((r) => [
            str(r.id),
            {
              idType: people.readable('idType') ? r.idType : null,
              idNumber: people.readable('idNumber') ? r.idNumber : null,
            },
          ]),
        );
        rows = [
          [
            '工号',
            '姓名',
            '证件类型',
            '证件号码',
            '所得期间',
            '本期收入',
            '基本养老保险',
            '基本医疗保险',
            '失业保险',
            '住房公积金',
            '累计月数',
            '累计收入',
            '累计减除费用',
            '累计专项扣除',
            '累计专项附加扣除',
            '累计应纳税所得额',
            '税率(%)',
            '速算扣除数',
            '累计应纳税额',
            '累计已预扣预缴税额',
            '本期应预扣预缴税额',
          ],
        ];
        for (const slip of ordered) {
          const employee = employees.get(slip.employeeId);
          const inputs = slip.inputs as {
            tax?: Record<string, number | string>;
            insurance?: { lines?: { code: string; employee: number }[] } | null;
          } | null;
          const t = inputs?.tax ?? {};
          const line = (code: string) =>
            inputs?.insurance?.lines?.find((l) => l.code === code)?.employee ??
            0;
          const idRow = ids.get(slip.employeeId);
          rows.push([
            employee?.employeeNo ?? '',
            employee?.name ?? '',
            idRow?.idType === 'passport' ? '护照' : '居民身份证',
            idRow?.idNumber ? str(idRow.idNumber) : '',
            cycle.month,
            num(t.incomeMonth).toFixed(2),
            line('pension').toFixed(2),
            line('medical').toFixed(2),
            line('unemployment').toFixed(2),
            line('housingFund').toFixed(2),
            num(t.months),
            num(t.incomeYtd).toFixed(2),
            num(t.basicDeductionYtd).toFixed(2),
            num(t.insuranceYtd).toFixed(2),
            num(t.specialDeductionYtd).toFixed(2),
            num(t.taxableYtd).toFixed(2),
            num(t.rate),
            num(t.quickDeduction).toFixed(2),
            num(t.taxYtd).toFixed(2),
            num(t.withheldBefore).toFixed(2),
            (slip.tax ?? 0).toFixed(2),
          ]);
        }
      } else {
        // 记账汇总: per department and item, then the insurance, tax and net totals.
        const totals = new Map<string, number>();
        const add = (
          department: string,
          code: string,
          title: string,
          kindLabel: string,
          amount: number,
        ) => {
          const key = [department, code, title, kindLabel].join('\u0000');
          totals.set(key, (totals.get(key) ?? 0) + amount);
        };
        for (const slip of ordered) {
          const department = titles.get(slip.departmentId ?? '') ?? '';
          for (const line of slip.lines ?? []) {
            if (line.kind === 'reference' || line.amount === null) continue;
            add(
              department,
              line.code,
              line.title,
              line.kind === 'deduction' ? '扣款' : '收入',
              line.amount,
            );
          }
          add(
            department,
            'socialEmployee',
            '个人社保',
            '代扣',
            slip.socialEmployee ?? 0,
          );
          add(
            department,
            'housingFundEmployee',
            '个人公积金',
            '代扣',
            slip.housingFundEmployee ?? 0,
          );
          add(department, 'tax', '个人所得税', '代扣', slip.tax ?? 0);
          add(department, 'net', '实发工资', '合计', slip.net ?? 0);
          const cost = (slip.employerCost ?? {}) as {
            social?: number;
            housingFund?: number;
            total?: number;
          };
          add(
            department,
            'employerSocial',
            '单位社保',
            '单位成本',
            num(cost.social),
          );
          add(
            department,
            'employerHousingFund',
            '单位公积金',
            '单位成本',
            num(cost.housingFund),
          );
          add(
            department,
            'employerTotal',
            '人工总成本',
            '单位成本',
            num(cost.total),
          );
        }
        rows = [['所属月份', '部门', '项目编码', '项目名称', '类别', '金额']];
        for (const [key, amount] of [...totals].sort(([a], [b]) =>
          a.localeCompare(b),
        )) {
          const [department, code, title, kindLabel] = key.split('\u0000');
          rows.push([
            cycle.month,
            department,
            code,
            title,
            kindLabel,
            (Math.round(amount * 100) / 100).toFixed(2),
          ]);
        }
      }
      const now = new Date();
      await database
        .query()
        .updateTable('payrollCycles')
        .set({
          exports: [
            ...cycle.exports,
            {
              kind,
              by: actor.userId,
              at: now.toISOString(),
              action: 'downloaded',
            },
          ],
          updatedAt: now,
        })
        .where('id', '=', cycle.id)
        .execute();
      ctx.audit({
        event: 'payroll.export',
        kind,
        cycleId: cycle.id,
        month: cycle.month,
        by: actor.userId,
        rows: rows.length - 1,
      });
      return { filename: `${cycle.month}-${kind}.csv`, content: toCsv(rows) };
    },
  };
  return service;
}

export type CycleService = ReturnType<typeof createCycleService>;

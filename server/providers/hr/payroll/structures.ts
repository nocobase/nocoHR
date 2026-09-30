/**
 * V2-06 薪资结构 and 薪酬设置. A structure is data: items (kind, calculation,
 * formula, unit, departments, taxable), formula parameters, pay ranges and the
 * pay days per month. Saving checks every formula against the whitelist
 * (`formula.ts`), runs a trial calculation for one employee, and appends a
 * change-log entry describing what changed. Cycles read structures when they
 * calculate, so a change reaches every cycle not yet submitted, and approved
 * payslips keep the formulas they were computed with in their snapshot.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, isRecord, newId, str } from '../shared.js';
import {
  calculatePayslip,
  ITEM_CALCS,
  ITEM_KINDS,
  structureProblem,
  type StructureInput,
  type StructureItem,
  type StructureParam,
} from './calc.js';
import {
  addMonths,
  chainOf,
  iso,
  json,
  num,
  payableDaysFor,
  readCalendar,
  toEmployee,
  EMPLOYEE_COLUMNS,
} from './common.js';
import {
  PAYROLL_SETTINGS_DEFAULTS,
  PAYROLL_SETTINGS_ID,
  payrollSettingsSchema,
  readPayrollSettings,
} from './config.js';
import type { PayrollContext } from './context.js';

const SETTINGS = 'talent.payrollSettings';
const CODE = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/u);

const itemSchema = z
  .object({
    code: CODE,
    title: z.string().trim().min(1).max(64),
    kind: z.enum(ITEM_KINDS),
    calc: z.enum(ITEM_CALCS),
    formula: z.string().trim().max(500).nullish(),
    unit: z.string().trim().max(16).nullish(),
    departmentIds: z.array(z.string().min(1).max(64)).max(50).nullish(),
    taxable: z.boolean().default(true),
    includedInSocialBase: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
const paramSchema = z
  .object({
    code: CODE,
    title: z.string().trim().min(1).max(64),
    value: z.number().finite(),
    unit: z.string().trim().max(16).nullish(),
  })
  .strict();
const payRangeSchema = z
  .object({
    positionId: z.string().min(1).max(64).nullish(),
    grade: z.string().min(1).max(16).nullish(),
    min: z.number().finite().min(0),
    max: z.number().finite().min(0),
  })
  .strict()
  .refine((r) => r.max >= r.min && Boolean(r.positionId || r.grade));
const appliesToSchema = z
  .object({
    jobFamilyIds: z.array(z.string().min(1).max(64)).max(50).default([]),
    departmentIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  })
  .strict();
const structureSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    appliesTo: appliesToSchema,
    items: z.array(itemSchema).min(1).max(80),
    params: z.array(paramSchema).max(80).default([]),
    payRanges: z.array(payRangeSchema).max(200).default([]),
    payDaysPerMonth: z.number().finite().min(1).max(31).default(21.75),
    active: z.boolean().default(true),
    /** Why the change is made, kept in the change log. */
    note: z.string().trim().max(500).nullish(),
    trialEmployeeId: z.string().min(1).max(64).nullish(),
  })
  .strict();

export interface StructureView {
  id: string;
  title: string;
  appliesTo: { jobFamilyIds: string[]; departmentIds: string[] };
  items: StructureItem[];
  params: StructureParam[];
  payRanges: z.infer<typeof payRangeSchema>[];
  payDaysPerMonth: number;
  changeLog: {
    by: string;
    byName: string | null;
    at: string;
    summary: string;
  }[];
  active: boolean;
  updatedAt: string | null;
}

export function toStructure(row: Record<string, unknown>): StructureView {
  const items = json<StructureItem[]>(row.items, []).map((item, index) => ({
    code: str(item.code),
    title: str(item.title),
    kind: item.kind,
    calc: item.calc,
    formula: item.formula ?? null,
    unit: item.unit ?? null,
    departmentIds: Array.isArray(item.departmentIds) ? item.departmentIds : [],
    taxable: item.taxable !== false,
    includedInSocialBase: item.includedInSocialBase === true,
    sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : index * 10,
  }));
  return {
    id: str(row.id),
    title: str(row.title),
    appliesTo: {
      jobFamilyIds: [],
      departmentIds: [],
      ...json<Record<string, string[]>>(row.appliesTo, {}),
    },
    items: items.sort((a, b) => a.sortOrder - b.sortOrder),
    params: json<StructureParam[]>(row.params, []).map((p) => ({
      code: str(p.code),
      title: str(p.title),
      value: num(p.value),
      unit: p.unit ?? null,
    })),
    payRanges: json(row.payRanges, []),
    payDaysPerMonth: num(row.payDaysPerMonth, 21.75),
    changeLog: json(row.changeLog, []),
    active: row.active === true || row.active === 1 || row.active === '1',
    updatedAt: iso(row.updatedAt),
  };
}

export function asCalcStructure(structure: StructureView): StructureInput {
  return {
    id: structure.id,
    title: structure.title,
    items: structure.items,
    params: structure.params,
    payDaysPerMonth: structure.payDaysPerMonth,
  };
}

/** What changed between two versions, in one line for the change log. */
function describeChange(
  before: StructureView | null,
  after: z.infer<typeof structureSchema>,
): string {
  if (!before) return `新建结构，${after.items.length} 个项目`;
  const parts: string[] = [];
  const beforeItems = new Map(before.items.map((i) => [i.code, i]));
  const afterItems = new Map(after.items.map((i) => [i.code, i]));
  for (const [code, item] of afterItems) {
    const old = beforeItems.get(code);
    if (!old) parts.push(`新增项目 ${item.title}（${code}）`);
    else if ((old.formula ?? '') !== (item.formula ?? ''))
      parts.push(
        `修改 ${item.title} 公式：${old.formula ?? '—'} → ${item.formula ?? '—'}`,
      );
    else if (
      old.calc !== item.calc ||
      old.kind !== item.kind ||
      JSON.stringify(old.departmentIds) !==
        JSON.stringify(item.departmentIds ?? []) ||
      old.taxable !== item.taxable
    )
      parts.push(`修改项目 ${item.title}（${code}）`);
  }
  for (const [code, item] of beforeItems)
    if (!afterItems.has(code)) parts.push(`删除项目 ${item.title}（${code}）`);
  const beforeParams = new Map(before.params.map((p) => [p.code, p]));
  for (const param of after.params) {
    const old = beforeParams.get(param.code);
    if (!old) parts.push(`新增参数 ${param.code} = ${param.value}`);
    else if (old.value !== param.value)
      parts.push(`参数 ${param.code}：${old.value} → ${param.value}`);
  }
  for (const [code] of beforeParams)
    if (!after.params.some((p) => p.code === code))
      parts.push(`删除参数 ${code}`);
  const order = (items: readonly { code: string }[]) =>
    items.map((i) => i.code).join(',');
  if (!parts.length && order(before.items) !== order(after.items))
    parts.push('调整项目顺序');
  if (before.payDaysPerMonth !== after.payDaysPerMonth)
    parts.push(
      `月计薪天数：${before.payDaysPerMonth} → ${after.payDaysPerMonth}`,
    );
  if (before.title !== after.title)
    parts.push(`名称：${before.title} → ${after.title}`);
  if (JSON.stringify(before.payRanges) !== JSON.stringify(after.payRanges))
    parts.push('修改薪资区间');
  if (JSON.stringify(before.appliesTo) !== JSON.stringify(after.appliesTo))
    parts.push('修改适用范围');
  if (before.active !== after.active)
    parts.push(after.active ? '启用' : '停用');
  return parts.join('；') || '无内容变化';
}

export function createStructureService(ctx: PayrollContext) {
  const { platform } = ctx;
  const { database } = platform;

  async function list(): Promise<StructureView[]> {
    const rows = await database
      .query()
      .selectFrom('salaryStructures')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .execute();
    return rows.map((row) => toStructure(row as Record<string, unknown>));
  }

  async function get(id: string): Promise<StructureView> {
    const row = await database
      .query()
      .selectFrom('salaryStructures')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('STRUCTURE_NOT_FOUND', 404);
    return toStructure(row);
  }

  /** A trial payslip for one employee, with the latest locked (or any) summary of the month before this one. */
  async function trial(
    structure: z.infer<typeof structureSchema> & { id: string },
    employeeId?: string | null,
  ) {
    const query = database.query();
    const salaryRows = await query
      .selectFrom('employeeSalaries')
      .selectAll()
      .orderBy('effectiveMonth', 'desc')
      .execute();
    const latest = new Map<string, Record<string, unknown>>();
    for (const row of salaryRows)
      if (!latest.has(str(row.employeeId)))
        latest.set(str(row.employeeId), row);
    let target = employeeId ? latest.get(employeeId) : undefined;
    if (!target)
      target = [...latest.values()].find(
        (row) => str(row.salaryStructureId) === structure.id,
      );
    if (!target) target = [...latest.values()][0];
    if (!target) return null;
    const employeeRow = await query
      .selectFrom('employees')
      .select([...EMPLOYEE_COLUMNS])
      .where('id', '=', str(target.employeeId))
      .executeTakeFirst();
    if (!employeeRow) return null;
    const employee = toEmployee(employeeRow);
    const month = addMonths(platform.currentDate().slice(0, 7), -1);
    const summary = await query
      .selectFrom('attendanceMonthlySummaries')
      .selectAll()
      .where('employeeId', '=', employee.id)
      .where('month', '=', month)
      .executeTakeFirst();
    const settings = await ctx.settings();
    const items = structure.items.map((item, index) => ({
      ...item,
      formula: item.formula ?? null,
      unit: item.unit ?? null,
      departmentIds: item.departmentIds ?? [],
      sortOrder: item.sortOrder ?? index * 10,
    }));
    const tree = await ctx.tree();
    const result = calculatePayslip({
      month,
      departmentChain: chainOf(employee.departmentId, tree),
      salary: {
        id: str(target.id),
        effectiveMonth: str(target.effectiveMonth),
        baseSalary: num(target.baseSalary),
        fixedAllowances: json(target.fixedAllowances, []),
      },
      structure: {
        id: structure.id,
        title: structure.title,
        items,
        params: structure.params.map((p) => ({ ...p, unit: p.unit ?? null })),
        payDaysPerMonth: structure.payDaysPerMonth,
      },
      payableDays: payableDaysFor(
        employee,
        month,
        structure.payDaysPerMonth,
        await readCalendar(query),
      ).payableDays,
      attendance: {
        nightShiftCount: num(summary?.nightShiftCount),
        absentDays: num(summary?.absentDays),
        shiftCounts: json(summary?.shiftCounts, {}),
        overtimeByType: json(summary?.overtimeByType, {}),
        leaveByType: json(summary?.leaveByType, {}),
      },
      importedValues: {},
      manualItems: [],
      insurance: null,
      specialDeductionYtd: 0,
      specialDeductionMonth: 0,
      prior: {
        months: 0,
        incomeYtd: 0,
        insuranceYtd: 0,
        withheldYtd: 0,
        startMonth: month,
      },
      tax: settings.tax,
    });
    return {
      employeeId: employee.id,
      employeeName: employee.name,
      month,
      lines: result.lines.map((line) => ({
        code: line.code,
        title: line.title,
        kind: line.kind,
        amount: line.amount,
        value: line.value,
        unit: line.unit,
        expression: line.expression,
      })),
      gross: result.gross,
    };
  }

  async function save(actor: ActorContext, id: string | null, input: unknown) {
    await authorizeAction(actor.authz, SETTINGS, 'manage');
    const parsed = structureSchema.safeParse(input);
    if (!parsed.success)
      throw new HrError('INVALID_INPUT', 400, {
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
    const data = parsed.data;
    const items: StructureItem[] = data.items.map((item, index) => ({
      code: item.code,
      title: item.title,
      kind: item.kind,
      calc: item.calc,
      formula: item.calc === 'formula' ? (item.formula ?? '') : null,
      unit: item.unit ?? null,
      departmentIds: item.departmentIds ?? [],
      taxable: item.kind === 'reference' ? false : item.taxable,
      includedInSocialBase: item.includedInSocialBase,
      // The editor's order is the calculation order.
      sortOrder: index * 10,
    }));
    const params: StructureParam[] = data.params.map((p) => ({
      code: p.code,
      title: p.title,
      value: p.value,
      unit: p.unit ?? null,
    }));
    const problem = structureProblem({ items, params });
    if (problem) throw new HrError(problem.code, 400, problem);
    const before = id ? await get(id) : null;
    const structureId = id ?? newId();
    const preview = await trial(
      { ...data, id: structureId, items, params },
      data.trialEmployeeId,
    ).catch(() => {
      throw new HrError('STRUCTURE_TRIAL_FAILED', 400);
    });
    const now = new Date();
    const summary = describeChange(before, { ...data, items, params });
    const entry = {
      by: actor.userId,
      byName: await platform.userName(actor.userId),
      at: now.toISOString(),
      summary: data.note ? `${summary}（${data.note}）` : summary,
    };
    const values = {
      title: data.title,
      appliesTo: data.appliesTo,
      items,
      params,
      payRanges: data.payRanges,
      payDaysPerMonth: data.payDaysPerMonth,
      changeLog: [...(before?.changeLog ?? []), entry],
      active: data.active,
      updatedAt: now,
    };
    if (before)
      await database
        .query()
        .updateTable('salaryStructures')
        .set(values)
        .where('id', '=', structureId)
        .execute();
    else
      await database
        .query()
        .insertInto('salaryStructures')
        .values({ id: structureId, ...values, createdAt: now })
        .execute();
    return { structure: await get(structureId), trial: preview };
  }

  /** The default structure for an employee: the first active one whose departments or job family match. */
  async function defaultFor(employeeId: string): Promise<string | null> {
    const employee = await database
      .query()
      .selectFrom('employees')
      .select(['departmentId', 'positionId'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!employee) return null;
    const position = employee.positionId
      ? await database
          .query()
          .selectFrom('positions')
          .select(['jobFamilyId'])
          .where('id', '=', str(employee.positionId))
          .executeTakeFirst()
      : undefined;
    const chain = chainOf(str(employee.departmentId), await ctx.tree());
    const structures = (await list()).filter((s) => s.active);
    const family = position?.jobFamilyId ? str(position.jobFamilyId) : null;
    const matches = (s: StructureView) => {
      const departments = s.appliesTo.departmentIds ?? [];
      const families = s.appliesTo.jobFamilyIds ?? [];
      const departmentOk =
        !departments.length || departments.some((d) => chain.includes(d));
      const familyOk =
        !families.length || (family !== null && families.includes(family));
      return (
        departmentOk &&
        familyOk &&
        (departments.length > 0 || families.length > 0)
      );
    };
    // The most specific match: the one naming the nearest department.
    const ranked = structures
      .filter(matches)
      .map((s) => ({
        s,
        rank: Math.min(
          ...(s.appliesTo.departmentIds.length
            ? s.appliesTo.departmentIds.map((d) =>
                chain.includes(d) ? chain.indexOf(d) : 99,
              )
            : [50]),
        ),
      }))
      .sort((a, b) => a.rank - b.rank);
    return ranked[0]?.s.id ?? null;
  }

  return {
    list,
    get,
    defaultFor,

    async listFor(actor: ActorContext) {
      await authorizeAction(actor.authz, SETTINGS, 'manage');
      return list();
    },

    create: (actor: ActorContext, input: unknown) => save(actor, null, input),
    update: (actor: ActorContext, id: string, input: unknown) =>
      save(actor, id, input),

    async trialRun(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, SETTINGS, 'manage');
      const structure = await get(id);
      const employeeId =
        isRecord(input) && typeof input.employeeId === 'string'
          ? input.employeeId
          : null;
      return trial(
        {
          ...structure,
          note: null,
          trialEmployeeId: employeeId,
          payRanges: structure.payRanges,
        },
        employeeId,
      );
    },

    /** The variables a formula may use, for the editor's picker. */
    async variables(actor: ActorContext) {
      await authorizeAction(actor.authz, SETTINGS, 'manage');
      const query = database.query();
      const leaveTypes = await query
        .selectFrom('leaveTypes')
        .select(['code', 'title'])
        .execute();
      const shifts = await query
        .selectFrom('shifts')
        .select(['code', 'title'])
        .execute();
      return {
        fixed: [
          'base',
          'dailyRate',
          'hourlyRate',
          'payableDays',
          'payDaysPerMonth',
        ],
        attendance: [
          'att.nightShiftCount',
          'att.absentDays',
          'att.overtime.workday',
          'att.overtime.restDay',
          'att.overtime.holiday',
          ...leaveTypes.map((l) => `att.leave.${str(l.code)}`),
          ...shifts.map((s) => `att.shift.${str(s.code)}`),
        ],
        labels: Object.fromEntries<string>([
          ...leaveTypes.map((l): [string, string] => [
            `att.leave.${str(l.code)}`,
            str(l.title),
          ]),
          ...shifts.map((s): [string, string] => [
            `att.shift.${str(s.code)}`,
            str(s.title),
          ]),
        ]),
        prefixes: ['allowance.', 'imp.', 'param.', 'item.'],
      };
    },

    async readSettings(actor: ActorContext) {
      await authorizeAction(actor.authz, SETTINGS, 'manage');
      return readPayrollSettings(database);
    },

    async updateSettings(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, SETTINGS, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const current = await readPayrollSettings(database);
      const merged = { ...current.value };
      for (const key of Object.keys(PAYROLL_SETTINGS_DEFAULTS))
        if (input[key] !== undefined)
          (merged as Record<string, unknown>)[key] = input[key];
      const parsed = payrollSettingsSchema.safeParse(merged);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      const brackets = parsed.data.tax.brackets;
      if (brackets[brackets.length - 1].upTo !== null)
        throw new HrError('PAYROLL_TAX_TABLE_INVALID', 400);
      const now = new Date();
      if (current.revision)
        await database
          .query()
          .updateTable('personnelSettings')
          .set({
            value: parsed.data,
            revision: current.revision + 1,
            updatedBy: actor.userId,
            updatedAt: now,
          })
          .where('id', '=', PAYROLL_SETTINGS_ID)
          .execute();
      else
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id: PAYROLL_SETTINGS_ID,
            value: parsed.data,
            revision: 1,
            updatedBy: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      return readPayrollSettings(database);
    },
  };
}

export type StructureService = ReturnType<typeof createStructureService>;

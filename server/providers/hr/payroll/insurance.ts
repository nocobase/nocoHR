/**
 * V2-06 社保公积金 and 专项附加扣除.
 *
 * - Plans per city and month range; items carry the employer and employee
 *   rates (percent) and the base range. Values in the seed are 示例; the
 *   payroll specialist maintains the published local standards.
 * - Enrolments: a base outside the plan's range is clamped when saved, and
 *   the answer says so. Every base change is written to the change log.
 * - 增减员: pending suggestions from onboarding and offboarding events, which
 *   the payroll specialist confirms (start → active, stop → stopped).
 * - 年度基数调整: each July (configurable) the new base is the previous
 *   year's average monthly gross over the items marked 计入社保基数 (all
 *   earnings when none is marked), clamped to the plan; suggestions are
 *   stored until confirmed, then written with a change-log entry.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import { INSURANCE_CODES, type PlanItem } from './calc.js';
import {
  addMonths,
  chainOf,
  iso,
  json,
  loadEmployees,
  MONTH,
  num,
  toCsv,
  type PayrollEmployee,
} from './common.js';
import type { PayrollContext } from './context.js';
import { payrollScopes, type PayrollScopes } from './scope.js';

const INSURANCE = 'talent.socialInsurance';
const SUGGESTIONS_ID = 'payroll.baseSuggestions';

const planItemSchema = z
  .object({
    code: z.enum(INSURANCE_CODES),
    employerRate: z.number().finite().min(0).max(100),
    employeeRate: z.number().finite().min(0).max(100),
    baseMin: z.number().finite().min(0),
    baseMax: z.number().finite().min(0),
  })
  .strict()
  .refine((item) => item.baseMax >= item.baseMin);
const planSchema = z
  .object({
    city: z.string().trim().min(1).max(64),
    effectiveFrom: z.string().regex(MONTH),
    effectiveTo: z.string().regex(MONTH).nullish(),
    items: z.array(planItemSchema).min(1).max(6),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();
const enrolmentSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    planCity: z.string().trim().min(1).max(64),
    socialBase: z.number().finite().min(0).max(10_000_000),
    housingFundBase: z.number().finite().min(0).max(10_000_000),
    startMonth: z.string().regex(MONTH),
    endMonth: z.string().regex(MONTH).nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .strict();
const deductionItemSchema = z
  .object({
    type: z.enum([
      'children',
      'continuingEducation',
      'housingLoan',
      'housingRent',
      'elderly',
      'infantCare',
      'seriousIllness',
    ]),
    monthlyAmount: z.number().finite().min(0).max(100_000),
    startMonth: z.string().regex(MONTH),
    endMonth: z.string().regex(MONTH).nullish(),
  })
  .strict();
const deductionSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    year: z.number().int().min(2000).max(2100),
    items: z.array(deductionItemSchema).max(20),
    source: z.enum(['manual', 'import']).default('manual'),
  })
  .strict();

export interface Plan {
  id: string;
  city: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: PlanItem[];
  note: string | null;
}

export interface Enrolment {
  id: string;
  employeeId: string;
  planCity: string;
  socialBase: number;
  housingFundBase: number;
  startMonth: string;
  endMonth: string | null;
  status: 'pending' | 'active' | 'stopped';
  pendingAction: 'start' | 'stop' | null;
  changeLog: { at: string; by: string | null; summary: string }[];
  sourceEventId: string | null;
  updatedAt: string | null;
}

export function toPlan(row: Record<string, unknown>): Plan {
  return {
    id: str(row.id),
    city: str(row.city),
    effectiveFrom: str(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? str(row.effectiveTo) : null,
    items: json<PlanItem[]>(row.items, []).map((i) => ({
      code: i.code,
      employerRate: num(i.employerRate),
      employeeRate: num(i.employeeRate),
      baseMin: num(i.baseMin),
      baseMax: num(i.baseMax),
    })),
    note: row.note ? str(row.note) : null,
  };
}

export function toEnrolment(row: Record<string, unknown>): Enrolment {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    planCity: str(row.planCity),
    socialBase: num(row.socialBase),
    housingFundBase: num(row.housingFundBase),
    startMonth: str(row.startMonth),
    endMonth: row.endMonth ? str(row.endMonth) : null,
    status: str(row.status) as Enrolment['status'],
    pendingAction: row.pendingAction
      ? (str(row.pendingAction) as 'start' | 'stop')
      : null,
    changeLog: json(row.changeLog, []),
    sourceEventId: row.sourceEventId ? str(row.sourceEventId) : null,
    updatedAt: iso(row.updatedAt),
  };
}

export function planFor(
  plans: readonly Plan[],
  city: string,
  month: string,
): Plan | null {
  return (
    plans
      .filter(
        (p) =>
          p.city === city &&
          p.effectiveFrom <= month &&
          (!p.effectiveTo || p.effectiveTo >= month),
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null
  );
}

/** The enrolment in force in a month (active, or stopped after it). */
export function enrolmentFor(
  enrolments: readonly Enrolment[],
  employeeId: string,
  month: string,
): Enrolment | null {
  return (
    enrolments
      .filter(
        (e) =>
          e.employeeId === employeeId &&
          e.status !== 'pending' &&
          // A confirmed 减员 suggestion is a record of the stop, not an enrolment.
          e.pendingAction !== 'stop' &&
          e.startMonth <= month &&
          (!e.endMonth || e.endMonth >= month),
      )
      .sort((a, b) => b.startMonth.localeCompare(a.startMonth))[0] ?? null
  );
}

/** Clamps the two bases to the plan: social items by the pension range, housing fund by its own. */
export function clampBases(
  plan: Plan | null,
  socialBase: number,
  housingFundBase: number,
): { socialBase: number; housingFundBase: number; clamped: string[] } {
  if (!plan) return { socialBase, housingFundBase, clamped: [] };
  const clamped: string[] = [];
  const social =
    plan.items.find((i) => i.code === 'pension') ??
    plan.items.find((i) => i.code !== 'housingFund');
  const housing = plan.items.find((i) => i.code === 'housingFund');
  const clamp = (value: number, item: PlanItem | undefined, name: string) => {
    if (!item) return value;
    const max = item.baseMax > 0 ? item.baseMax : value;
    const next = Math.min(Math.max(value, item.baseMin), max);
    if (next !== value) clamped.push(name);
    return next;
  };
  return {
    socialBase: clamp(socialBase, social, 'socialBase'),
    housingFundBase: clamp(housingFundBase, housing, 'housingFundBase'),
    clamped,
  };
}

/** The city an employee is insured in: work location naming a plan city, then the department mapping. */
export async function cityFor(
  ctx: PayrollContext,
  employee: PayrollEmployee,
  plans: readonly Plan[],
): Promise<string | null> {
  const cities = [...new Set(plans.map((p) => p.city))];
  const byLocation = cities.find((city) =>
    employee.workLocation?.includes(city),
  );
  if (byLocation) return byLocation;
  const settings = await ctx.settings();
  const chain = chainOf(employee.departmentId, await ctx.tree());
  for (const id of chain) {
    const mapped = settings.socialInsurance.cityByDepartment.find(
      (m) => m.departmentId === id,
    );
    if (mapped) return mapped.city;
  }
  return cities.length === 1 ? cities[0] : null;
}

export function createInsuranceService(ctx: PayrollContext) {
  const { platform } = ctx;
  const { database } = platform;

  /** The plans; with scopes, those the action's grant reaches. */
  async function plans(scopes?: PayrollScopes): Promise<Plan[]> {
    const rows = await database
      .query()
      .selectFrom('socialInsurancePlans')
      .selectAll()
      .orderBy('city', 'asc')
      .execute();
    return (
      scopes ? await scopes.rows('socialInsurancePlans', rows) : rows
    ).map((row) => toPlan(row as Record<string, unknown>));
  }

  /** The enrolments; with scopes, those the action's grant reaches (and their employees). */
  async function enrolments(scopes?: PayrollScopes): Promise<Enrolment[]> {
    const rows = await database
      .query()
      .selectFrom('employeeSocialInsurances')
      .selectAll()
      .orderBy('startMonth', 'asc')
      .execute();
    return (
      scopes ? await scopes.rows('employeeSocialInsurances', rows) : rows
    ).map((row) => toEnrolment(row as Record<string, unknown>));
  }

  async function enrolment(
    id: string,
    scopes?: PayrollScopes,
  ): Promise<Enrolment> {
    const row = await database
      .query()
      .selectFrom('employeeSocialInsurances')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (
      !row ||
      (scopes && !(await scopes.rows('employeeSocialInsurances', [row])).length)
    )
      throw new HrError('ENROLMENT_NOT_FOUND', 404);
    return toEnrolment(row);
  }

  const scopesOf = async (actor: ActorContext, action: string) =>
    payrollScopes(
      database,
      await authorizeAction(actor.authz, INSURANCE, action),
    );

  /** 增减员 of a month, as the action's grant reaches them. */
  async function changesFor(scopes: PayrollScopes, month: string) {
    const employees = new Map(
      (await loadEmployees(database.query())).map((e) => [e.id, e]),
    );
    const all = await enrolments(scopes);
    const describe = (e: Enrolment) => ({
      ...e,
      employeeName: employees.get(e.employeeId)?.name ?? '',
      employeeNo: employees.get(e.employeeId)?.employeeNo ?? '',
      departmentId: employees.get(e.employeeId)?.departmentId ?? null,
    });
    return {
      month,
      pending: all.filter((e) => e.status === 'pending').map(describe),
      started: all
        .filter((e) => e.status === 'active' && e.startMonth === month)
        .map(describe),
      stopped: all
        .filter(
          (e) =>
            e.status === 'stopped' && e.endMonth === month && !e.pendingAction,
        )
        .map(describe),
    };
  }

  /** Base suggestions limited to the enrolments the action's grant reaches. */
  async function suggestionsIn<
    T extends { enrolmentId: string; employeeId?: string },
  >(scopes: PayrollScopes, items: readonly T[]): Promise<T[]> {
    const rows = items.map((item) => ({ ...item, id: item.enrolmentId }));
    const kept = new Set(
      (await scopes.rows('employeeSocialInsurances', rows)).map((r) => r.id),
    );
    return items.filter((item) => kept.has(item.enrolmentId));
  }

  function parse<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success)
      throw new HrError('INVALID_INPUT', 400, {
        fields: parsed.error.issues.map((issue) => issue.path.join('.')),
      });
    return parsed.data;
  }

  const service = {
    plans,
    enrolments,

    async overview(actor: ActorContext) {
      const scopes = await scopesOf(actor, 'view');
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      const all = await enrolments(scopes);
      return {
        plans: await plans(scopes),
        enrolments: all.map((e) => ({
          ...e,
          employeeName: employees.get(e.employeeId)?.name ?? '',
          employeeNo: employees.get(e.employeeId)?.employeeNo ?? '',
          departmentId: employees.get(e.employeeId)?.departmentId ?? null,
        })),
      };
    },

    async savePlan(actor: ActorContext, id: string | null, input: unknown) {
      const scopes = await scopesOf(actor, 'manage');
      const data = parse(planSchema, input);
      if (new Set(data.items.map((i) => i.code)).size !== data.items.length)
        throw new HrError('PLAN_ITEM_DUPLICATE', 400);
      const now = new Date();
      const values = {
        city: data.city,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: data.effectiveTo ?? null,
        items: data.items,
        note: data.note ?? null,
        updatedAt: now,
      };
      if (id) {
        const exists = await database
          .query()
          .selectFrom('socialInsurancePlans')
          .select(['id'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (
          !exists ||
          !(await scopes.rows('socialInsurancePlans', [exists])).length
        )
          throw new HrError('NOT_FOUND', 404);
        await database
          .query()
          .updateTable('socialInsurancePlans')
          .set(values)
          .where('id', '=', id)
          .execute();
        return (await plans()).find((p) => p.id === id)!;
      }
      const newIdValue = newId();
      await database
        .query()
        .insertInto('socialInsurancePlans')
        .values({ id: newIdValue, ...values, createdAt: now })
        .execute();
      return (await plans()).find((p) => p.id === newIdValue)!;
    },

    /** Creates an active enrolment; bases outside the plan's range are clamped and reported. */
    async createEnrolment(actor: ActorContext, input: unknown) {
      const scopes = await scopesOf(actor, 'manage');
      const data = parse(enrolmentSchema, input);
      const employee = (await loadEmployees(database.query())).find(
        (e) => e.id === data.employeeId,
      );
      if (!employee || !(await scopes.employee(employee.id)))
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const plan = planFor(await plans(scopes), data.planCity, data.startMonth);
      if (!plan) throw new HrError('PLAN_NOT_FOUND', 400);
      const bases = clampBases(plan, data.socialBase, data.housingFundBase);
      const open = (await enrolments()).find(
        (e) =>
          e.employeeId === employee.id && e.status === 'active' && !e.endMonth,
      );
      if (open) throw new HrError('ENROLMENT_ACTIVE_EXISTS', 409);
      const now = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('employeeSocialInsurances')
        .values({
          id,
          employeeId: employee.id,
          planCity: data.planCity,
          socialBase: bases.socialBase,
          housingFundBase: bases.housingFundBase,
          startMonth: data.startMonth,
          endMonth: data.endMonth ?? null,
          status: 'active',
          pendingAction: null,
          changeLog: [
            {
              at: now.toISOString(),
              by: actor.userId,
              summary: bases.clamped.length
                ? `新建参保，基数按方案上下限截取（${bases.clamped.join('、')}）`
                : '新建参保',
            },
          ],
          sourceEventId: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return { enrolment: await enrolment(id), clamped: bases.clamped };
    },

    /** Changes bases or the end month; clamps and logs the change. */
    async updateEnrolment(actor: ActorContext, id: string, input: unknown) {
      const scopes = await scopesOf(actor, 'manage');
      const data = parse(
        enrolmentSchema.partial().omit({ employeeId: true }).strict(),
        input,
      );
      const current = await enrolment(id, scopes);
      const city = data.planCity ?? current.planCity;
      const plan = planFor(
        await plans(scopes),
        city,
        data.startMonth ?? current.startMonth,
      );
      const bases = clampBases(
        plan,
        data.socialBase ?? current.socialBase,
        data.housingFundBase ?? current.housingFundBase,
      );
      const parts: string[] = [];
      if (bases.socialBase !== current.socialBase)
        parts.push(`社保基数 ${current.socialBase} → ${bases.socialBase}`);
      if (bases.housingFundBase !== current.housingFundBase)
        parts.push(
          `公积金基数 ${current.housingFundBase} → ${bases.housingFundBase}`,
        );
      if (city !== current.planCity)
        parts.push(`参保城市 ${current.planCity} → ${city}`);
      if (
        data.endMonth !== undefined &&
        (data.endMonth ?? null) !== current.endMonth
      )
        parts.push(
          `截止月份 ${current.endMonth ?? '—'} → ${data.endMonth ?? '—'}`,
        );
      if (bases.clamped.length) parts.push('按方案上下限截取');
      if (data.note) parts.push(data.note);
      const now = new Date();
      await database
        .query()
        .updateTable('employeeSocialInsurances')
        .set({
          planCity: city,
          socialBase: bases.socialBase,
          housingFundBase: bases.housingFundBase,
          startMonth: data.startMonth ?? current.startMonth,
          endMonth:
            data.endMonth === undefined
              ? current.endMonth
              : (data.endMonth ?? null),
          changeLog: [
            ...current.changeLog,
            {
              at: now.toISOString(),
              by: actor.userId,
              summary: parts.join('；') || '无变化',
            },
          ],
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      return { enrolment: await enrolment(id), clamped: bases.clamped };
    },

    /** 增减员确认: a pending start becomes active, a pending stop ends the enrolment. */
    async confirm(actor: ActorContext, id: string, input: unknown) {
      const scopes = await scopesOf(actor, 'manage');
      const current = await enrolment(id, scopes);
      if (current.status !== 'pending')
        throw new HrError('ENROLMENT_NOT_PENDING', 409);
      const body = parse(
        z
          .object({
            socialBase: z.number().finite().min(0).optional(),
            housingFundBase: z.number().finite().min(0).optional(),
          })
          .strict(),
        input ?? {},
      );
      const now = new Date();
      if (current.pendingAction === 'stop') {
        // The stop applies to the enrolment it was raised for (kept in the suggestion's change log).
        const target = (await enrolments(scopes)).find(
          (e) => e.employeeId === current.employeeId && e.status === 'active',
        );
        await database.transaction(async (connection) => {
          if (target)
            await connection.query
              .updateTable('employeeSocialInsurances')
              .set({
                endMonth: current.endMonth,
                status: 'stopped',
                changeLog: [
                  ...target.changeLog,
                  {
                    at: now.toISOString(),
                    by: actor.userId,
                    summary: `停保，截止 ${current.endMonth ?? ''}`,
                  },
                ],
                updatedAt: now,
              })
              .where('id', '=', target.id)
              .execute();
          await connection.query
            .updateTable('employeeSocialInsurances')
            .set({
              status: 'stopped',
              changeLog: [
                ...current.changeLog,
                {
                  at: now.toISOString(),
                  by: actor.userId,
                  summary: '确认减员',
                },
              ],
              updatedAt: now,
            })
            .where('id', '=', id)
            .execute();
        });
        return { enrolment: await enrolment(id), clamped: [] };
      }
      const plan = planFor(
        await plans(scopes),
        current.planCity,
        current.startMonth,
      );
      const bases = clampBases(
        plan,
        body.socialBase ?? current.socialBase,
        body.housingFundBase ?? current.housingFundBase,
      );
      await database
        .query()
        .updateTable('employeeSocialInsurances')
        .set({
          status: 'active',
          pendingAction: null,
          socialBase: bases.socialBase,
          housingFundBase: bases.housingFundBase,
          changeLog: [
            ...current.changeLog,
            {
              at: now.toISOString(),
              by: actor.userId,
              summary: bases.clamped.length
                ? '确认增员，基数按方案上下限截取'
                : '确认增员',
            },
          ],
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      return { enrolment: await enrolment(id), clamped: bases.clamped };
    },

    /** 增减员: the pending suggestions, and the starts and stops of a month. */
    async changes(actor: ActorContext, month: string) {
      return changesFor(await scopesOf(actor, 'view'), month);
    },

    /** The 增减员 file is an export of personal data: it needs the export action, like the payroll files. */
    async changesCsv(actor: ActorContext, month: string) {
      const data = await changesFor(await scopesOf(actor, 'export'), month);
      ctx.audit({
        event: 'payroll.export',
        kind: 'insuranceChanges',
        month,
        by: actor.userId,
      });
      const rows: unknown[][] = [
        [
          '类型',
          '工号',
          '姓名',
          '参保城市',
          '社保基数',
          '公积金基数',
          '起始月份',
          '截止月份',
          '状态',
        ],
      ];
      for (const e of data.started)
        rows.push([
          '增员',
          e.employeeNo,
          e.employeeName,
          e.planCity,
          e.socialBase,
          e.housingFundBase,
          e.startMonth,
          e.endMonth ?? '',
          e.status,
        ]);
      for (const e of data.stopped)
        rows.push([
          '减员',
          e.employeeNo,
          e.employeeName,
          e.planCity,
          e.socialBase,
          e.housingFundBase,
          e.startMonth,
          e.endMonth ?? '',
          e.status,
        ]);
      for (const e of data.pending)
        rows.push([
          e.pendingAction === 'stop' ? '减员（待确认）' : '增员（待确认）',
          e.employeeNo,
          e.employeeName,
          e.planCity,
          e.socialBase,
          e.housingFundBase,
          e.startMonth,
          e.endMonth ?? '',
          e.status,
        ]);
      return toCsv(rows);
    },

    async deductions(actor: ActorContext, year: number) {
      const scopes = await scopesOf(actor, 'view');
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      const rows = await scopes.rows(
        'employeeTaxDeductions',
        await database
          .query()
          .selectFrom('employeeTaxDeductions')
          .selectAll()
          .where('year', '=', year)
          .execute(),
      );
      return rows.map((row) => ({
        id: str(row.id),
        employeeId: str(row.employeeId),
        employeeName: employees.get(str(row.employeeId))?.name ?? '',
        employeeNo: employees.get(str(row.employeeId))?.employeeNo ?? '',
        year: Number(row.year),
        items: json<z.infer<typeof deductionItemSchema>[]>(row.items, []),
        source: str(row.source),
        updatedAt: iso(row.updatedAt),
      }));
    },

    /** 专项附加扣除 as the employee declared it in the tax app; replaces the year's row. */
    async saveDeduction(actor: ActorContext, input: unknown) {
      const scopes = await scopesOf(actor, 'manage');
      const data = parse(deductionSchema, input);
      if (!(await scopes.employee(data.employeeId)))
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      for (const item of data.items)
        if (
          !item.startMonth.startsWith(String(data.year)) ||
          (item.endMonth && item.endMonth < item.startMonth)
        )
          throw new HrError('DEDUCTION_MONTH_INVALID', 400);
      const exists = await database
        .query()
        .selectFrom('employeeTaxDeductions')
        .select(['id', 'employeeId'])
        .where('employeeId', '=', data.employeeId)
        .where('year', '=', data.year)
        .executeTakeFirst();
      if (
        exists &&
        !(await scopes.rows('employeeTaxDeductions', [exists])).length
      )
        throw new HrError('NOT_FOUND', 404);
      const now = new Date();
      if (exists)
        await database
          .query()
          .updateTable('employeeTaxDeductions')
          .set({ items: data.items, source: data.source, updatedAt: now })
          .where('id', '=', str(exists.id))
          .execute();
      else
        await database
          .query()
          .insertInto('employeeTaxDeductions')
          .values({
            id: newId(),
            employeeId: data.employeeId,
            year: data.year,
            items: data.items,
            source: data.source,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      return (await service.deductions(actor, data.year)).find(
        (d) => d.employeeId === data.employeeId,
      )!;
    },

    /**
     * 年度基数调整建议: last year's average monthly gross (items counted into the
     * social base; all earnings when none is marked), clamped to the plan.
     * Stored until confirmed. `trusted` runs as the scheduled task.
     */
    async generateBaseSuggestions(actor: ActorContext | null, year: number) {
      // The suggestions are one list for the company (the scheduled task
      // writes it too); a caller is answered with the part their grant reaches.
      const scopes = actor ? await scopesOf(actor, 'manage') : null;
      const previous = String(year - 1);
      const slips = await database
        .query()
        .selectFrom('payslips')
        .innerJoin('payrollCycles', 'payrollCycles.id', 'payslips.cycleId')
        .select([
          'payslips.employeeId as employeeId',
          'payslips.lines as lines',
          'payslips.gross as gross',
          'payrollCycles.month as month',
          'payrollCycles.status as status',
        ])
        .where('payrollCycles.month', 'like', `${previous}-%`)
        .execute();
      const totals = new Map<string, { sum: number; months: number }>();
      for (const slip of slips) {
        if (!['approved', 'published', 'closed'].includes(str(slip.status)))
          continue;
        const lines = json<
          {
            kind: string;
            amount: number | null;
            includedInSocialBase?: boolean;
          }[]
        >(slip.lines, []);
        const marked = lines.filter((l) => l.includedInSocialBase);
        const amount = marked.length
          ? marked.reduce(
              (s, l) => s + (l.kind === 'deduction' ? -1 : 1) * (l.amount ?? 0),
              0,
            )
          : num(slip.gross);
        const entry = totals.get(str(slip.employeeId)) ?? { sum: 0, months: 0 };
        entry.sum += amount;
        entry.months += 1;
        totals.set(str(slip.employeeId), entry);
      }
      const month = `${year}-${String((await ctx.settings()).socialInsurance.baseAdjustMonth).padStart(2, '0')}`;
      const allPlans = await plans();
      const items = [];
      for (const current of await enrolments()) {
        if (
          current.status !== 'active' ||
          (current.endMonth && current.endMonth < month)
        )
          continue;
        const total = totals.get(current.employeeId);
        if (!total?.months) continue;
        const average = Math.round((total.sum / total.months) * 100) / 100;
        const plan = planFor(allPlans, current.planCity, month);
        const bases = clampBases(plan, average, average);
        items.push({
          enrolmentId: current.id,
          employeeId: current.employeeId,
          months: total.months,
          averageGross: average,
          currentSocialBase: current.socialBase,
          currentHousingFundBase: current.housingFundBase,
          socialBase: bases.socialBase,
          housingFundBase: bases.housingFundBase,
          clamped: bases.clamped,
          status: 'pending' as 'pending' | 'applied',
        });
      }
      const value = {
        year,
        month,
        generatedAt: new Date().toISOString(),
        items,
      };
      const now = new Date();
      const exists = await database
        .query()
        .selectFrom('personnelSettings')
        .select(['revision'])
        .where('id', '=', SUGGESTIONS_ID)
        .executeTakeFirst();
      if (exists)
        await database
          .query()
          .updateTable('personnelSettings')
          .set({
            value,
            revision: Number(exists.revision) + 1,
            updatedBy: actor?.userId ?? 'system',
            updatedAt: now,
          })
          .where('id', '=', SUGGESTIONS_ID)
          .execute();
      else
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id: SUGGESTIONS_ID,
            value,
            revision: 1,
            updatedBy: actor?.userId ?? 'system',
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      return scopes
        ? { ...value, items: await suggestionsIn(scopes, value.items) }
        : value;
    },

    async baseSuggestions(actor: ActorContext) {
      const scopes = await scopesOf(actor, 'view');
      const row = await database
        .query()
        .selectFrom('personnelSettings')
        .select(['value'])
        .where('id', '=', SUGGESTIONS_ID)
        .executeTakeFirst();
      const value = json<{
        year: number;
        month: string;
        generatedAt: string;
        items: {
          enrolmentId: string;
          employeeId: string;
          status: string;
          socialBase: number;
          housingFundBase: number;
        }[];
      } | null>(row?.value, null);
      if (!value) return null;
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      return {
        ...value,
        items: (await suggestionsIn(scopes, value.items)).map((item) => ({
          ...item,
          employeeName: employees.get(item.employeeId)?.name ?? '',
          employeeNo: employees.get(item.employeeId)?.employeeNo ?? '',
        })),
      };
    },

    /** Writes the confirmed suggestions (all pending when no ids are given), with a change-log entry each. */
    async applyBaseSuggestions(actor: ActorContext, input: unknown) {
      const scopes = await scopesOf(actor, 'manage');
      const body = parse(
        z
          .object({
            enrolmentIds: z
              .array(z.string().min(1).max(64))
              .max(5000)
              .optional(),
          })
          .strict(),
        input ?? {},
      );
      const row = await database
        .query()
        .selectFrom('personnelSettings')
        .select(['value', 'revision'])
        .where('id', '=', SUGGESTIONS_ID)
        .executeTakeFirst();
      const value = json<{
        year: number;
        month: string;
        items: {
          enrolmentId: string;
          socialBase: number;
          housingFundBase: number;
          status: string;
        }[];
      } | null>(row?.value, null);
      if (!value) throw new HrError('BASE_SUGGESTIONS_NOT_FOUND', 404);
      const now = new Date();
      let applied = 0;
      for (const item of value.items) {
        if (item.status !== 'pending') continue;
        if (body.enrolmentIds && !body.enrolmentIds.includes(item.enrolmentId))
          continue;
        const current = await enrolment(item.enrolmentId, scopes).catch(
          () => null,
        );
        if (!current) continue;
        await database
          .query()
          .updateTable('employeeSocialInsurances')
          .set({
            socialBase: item.socialBase,
            housingFundBase: item.housingFundBase,
            changeLog: [
              ...current.changeLog,
              {
                at: now.toISOString(),
                by: actor.userId,
                summary: `${value.year} 年度基数调整：社保基数 ${current.socialBase} → ${item.socialBase}，公积金基数 ${current.housingFundBase} → ${item.housingFundBase}（自 ${value.month} 起）`,
              },
            ],
            updatedAt: now,
          })
          .where('id', '=', item.enrolmentId)
          .execute();
        item.status = 'applied';
        applied += 1;
      }
      await database
        .query()
        .updateTable('personnelSettings')
        .set({
          value,
          revision: Number(row?.revision ?? 1) + 1,
          updatedBy: actor.userId,
          updatedAt: now,
        })
        .where('id', '=', SUGGESTIONS_ID)
        .execute();
      return { applied };
    },

    /** A pending 增员 from an onboarding event, once per event. */
    async suggestStart(event: {
      id: string;
      employeeId: string;
      effectiveDate: string;
    }): Promise<boolean> {
      const employee = (await loadEmployees(database.query())).find(
        (e) => e.id === event.employeeId,
      );
      if (!employee) return false;
      const all = await enrolments();
      if (all.some((e) => e.sourceEventId === `${event.id}:start`))
        return false;
      if (
        all.some(
          (e) =>
            e.employeeId === employee.id &&
            (e.status === 'active' ||
              (e.status === 'pending' && e.pendingAction === 'start')),
        )
      )
        return false;
      const allPlans = await plans();
      const city =
        (await cityFor(ctx, employee, allPlans)) ?? allPlans[0]?.city ?? '';
      const settings = await ctx.settings();
      const date = event.effectiveDate.slice(0, 10);
      // Joined after the cut-off day: insured from the next month.
      const startMonth =
        Number(date.slice(8, 10)) > settings.socialInsurance.cutoffDay
          ? addMonths(date.slice(0, 7), 1)
          : date.slice(0, 7);
      const plan = planFor(allPlans, city, startMonth);
      const minimum =
        plan?.items.find((i) => i.code === 'pension')?.baseMin ?? 0;
      const housingMinimum =
        plan?.items.find((i) => i.code === 'housingFund')?.baseMin ?? minimum;
      const now = new Date();
      try {
        await database
          .query()
          .insertInto('employeeSocialInsurances')
          .values({
            id: newId(),
            employeeId: employee.id,
            planCity: city,
            socialBase: minimum,
            housingFundBase: housingMinimum,
            startMonth,
            endMonth: null,
            status: 'pending',
            pendingAction: 'start',
            changeLog: [
              {
                at: now.toISOString(),
                by: null,
                summary: `入职生成的增员建议（入职日期 ${date}）`,
              },
            ],
            sourceEventId: `${event.id}:start`,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      } catch {
        return false;
      }
      return true;
    },

    /** A pending 减员 from an offboarding event, once per event: insurance stops after the leaving month. */
    async suggestStop(event: {
      id: string;
      employeeId: string;
      effectiveDate: string;
    }): Promise<boolean> {
      const all = await enrolments();
      if (all.some((e) => e.sourceEventId === `${event.id}:stop`)) return false;
      const active = all.find(
        (e) => e.employeeId === event.employeeId && e.status === 'active',
      );
      if (!active) return false;
      const now = new Date();
      try {
        await database
          .query()
          .insertInto('employeeSocialInsurances')
          .values({
            id: newId(),
            employeeId: event.employeeId,
            planCity: active.planCity,
            socialBase: active.socialBase,
            housingFundBase: active.housingFundBase,
            startMonth: active.startMonth,
            endMonth: event.effectiveDate.slice(0, 7),
            status: 'pending',
            pendingAction: 'stop',
            changeLog: [
              {
                at: now.toISOString(),
                by: null,
                summary: `离职生成的减员建议（离职日期 ${event.effectiveDate.slice(0, 10)}）`,
              },
            ],
            sourceEventId: `${event.id}:stop`,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      } catch {
        return false;
      }
      return true;
    },
  };
  return service;
}

export type InsuranceService = ReturnType<typeof createInsuranceService>;

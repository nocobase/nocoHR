/**
 * 用工计划 (V2-07): a business system's demand plan (业务量计划; in the demo
 * the ERP's production plan) becomes a staffing gap and three options, all
 * computed here by rule; the HR assistant only explains them. The quantities
 * count in 招聘设置's unit (`workforce.unitLabel`, 单位 when unset).
 *
 * 测算规则 (招聘设置 · 用工测算参数, per department and position, the nearest
 * department up the tree that has parameters):
 * - on duty = employees of the department (and its sub-departments) in the
 *   position, not left, not dispatched, not leaving before the plan month;
 * - output = on duty × output per shift × shifts per month;
 * - gap = ⌈(planned − output) ÷ (output per shift × shifts per month)⌉, noGap when ≤ 0.
 * Options: overtime converts the gap output into monthly hours per person and
 * compares them with the attendance rule's monthlyOvertimeAlertHours;
 * transfer lists the loan limits of other departments; hire adds the
 * recruiting cycle to the position's onboarding days (a published onboarding
 * path's last step, otherwise the setting).
 *
 * A push with the same numbers and parameters is a no-op (same
 * calculationHash): nothing is recalculated and nobody is told again.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { addDays, daysBetween, HrError, newId, str } from '../shared.js';
import { day, json, num, sha256 } from './common.js';
import type { RecruitingSettings } from './config.js';
import type { RecruitingContext } from './context.js';
import { COMPOSITE } from './resources.js';

const pushSchema = z
  .object({
    department: z.string().trim().min(1).max(64),
    position: z.string().trim().min(1).max(64),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    plannedOutput: z.number().finite().min(0).max(1e12),
    currentOutput: z.number().finite().min(0).max(1e12).nullish(),
  })
  .strict();

const decisionSchema = z
  .object({
    types: z
      .array(z.enum(['overtime', 'transfer', 'hire']))
      .min(1)
      .max(3),
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

const notesSchema = z
  .object({
    aiSummary: z.string().trim().min(1).max(4000),
    optionNotes: z
      .object({
        overtime: z.string().trim().max(1000).nullish(),
        transfer: z.string().trim().max(1000).nullish(),
        hire: z.string().trim().max(1000).nullish(),
      })
      .partial()
      .strict()
      .default({}),
  })
  .strict();

/**
 * The loan option's risks. 借调人员需安排住宿 (housing) only when 招聘设置 says
 * lent staff need accommodation (`workforce.transferHousingRisk`, off by
 * default): an employer without dormitories never sees it.
 */
export function transferRisks(
  available: number,
  gapHeadcount: number,
  workforce: { transferHousingRisk?: boolean },
): string[] {
  return [
    ...(available === 0 ? ['noSource'] : []),
    ...(available > 0 && available < gapHeadcount ? ['partialCover'] : []),
    ...(available > 0 && workforce.transferHousingRisk ? ['housing'] : []),
  ];
}

export interface PlanOption {
  type: 'overtime' | 'transfer' | 'hire';
  feasible: boolean;
  detail: Record<string, unknown>;
  risks: string[];
  costNote: string;
  /** The HR assistant's words for this option. */
  note?: string | null;
}

export interface PlanCalculation {
  headcount: number;
  outputPerShift: number;
  shiftsPerMonth: number;
  hoursPerShift: number;
  capacity: number;
  plannedOutput: number;
  currentOutput: number | null;
  gapOutput: number;
  gapHeadcount: number;
  /** Planned output above capacity, before a small shortfall is absorbed by overtime. */
  shortfall: number;
  absorbedOvertimeHours: number | null;
  overtimeLimitHours: number;
  recruitingCycleDays: number;
  onboardingDays: number;
  sources: {
    parameters: string;
    headcount: string;
    overtimeLimit: 'attendanceRule' | 'default';
    onboarding: 'path' | 'settings';
    onboardingPathId: string | null;
  };
}

export function presentPlan(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    departmentId: str(row.departmentId),
    positionId: str(row.positionId),
    month: str(row.month),
    plannedOutput: num(row.plannedOutput),
    currentOutput:
      row.currentOutput === null || row.currentOutput === undefined
        ? null
        : num(row.currentOutput),
    source: str(row.source),
    calculation: json<PlanCalculation | null>(row.calculation, null),
    options: json<PlanOption[]>(row.options, []),
    aiSummary: row.aiSummary ? str(row.aiSummary) : null,
    aiSummaryCurrent:
      Boolean(row.aiSummaryHash) &&
      str(row.aiSummaryHash) === str(row.calculationHash),
    decision: json<Record<string, unknown> | null>(row.decision, null),
    requisitionId: row.requisitionId ? str(row.requisitionId) : null,
    status: str(row.status),
    calculationHash: str(row.calculationHash),
    updatedAt: row.updatedAt,
  };
}
export type PlanView = ReturnType<typeof presentPlan>;

export function createWorkforceService(
  ctx: RecruitingContext,
  hooks: {
    /** A plan with a gap was calculated anew: the HR assistant explains it (background). */
    onCalculated: (planId: string) => void;
    /** A decision chose hiring: the draft requisition it produced. */
    createDraftRequisition: (input: {
      plan: PlanView;
      actor: ActorContext;
    }) => Promise<string>;
  },
) {
  const { database, platform } = ctx;

  async function resolveDepartment(value: string): Promise<string> {
    const row = await database
      .query()
      .selectFrom('departments')
      .select(['id'])
      .where((eb) => eb.or([eb('id', '=', value), eb('code', '=', value)]))
      .executeTakeFirst();
    if (!row) throw new HrError('WORKFORCE_DEPARTMENT_UNKNOWN', 400);
    return str(row.id);
  }

  async function resolvePosition(value: string): Promise<string> {
    const row = await database
      .query()
      .selectFrom('positions')
      .select(['id'])
      .where((eb) => eb.or([eb('id', '=', value), eb('code', '=', value)]))
      .executeTakeFirst();
    if (!row) throw new HrError('WORKFORCE_POSITION_UNKNOWN', 400);
    return str(row.id);
  }

  async function chainOf(departmentId: string): Promise<string[]> {
    return [
      ...((await platform.organization.activeChain(departmentId)) ?? [
        departmentId,
      ]),
    ];
  }

  function paramsFor(
    settings: RecruitingSettings,
    chain: readonly string[],
    positionId: string,
  ) {
    for (const departmentId of chain) {
      const found = settings.workforce.capacity.find(
        (c) => c.departmentId === departmentId && c.positionId === positionId,
      );
      if (found) return found;
    }
    return undefined;
  }

  async function alertHours(chain: readonly string[]) {
    const rules = await database
      .query()
      .selectFrom('attendanceRules')
      .select(['departmentIds', 'monthlyOvertimeAlertHours'])
      .where('active', '=', true)
      .execute();
    for (const departmentId of chain) {
      const rule = rules.find((r) =>
        json<string[]>(r.departmentIds, []).includes(departmentId),
      );
      if (rule)
        return {
          hours: num(rule.monthlyOvertimeAlertHours, 36),
          source: 'attendanceRule' as const,
        };
    }
    return { hours: 36, source: 'default' as const };
  }

  async function onboardingDays(positionId: string, fallback: number) {
    const path = await database
      .query()
      .selectFrom('learningPaths')
      .select(['id'])
      .where('positionId', '=', positionId)
      .where('purpose', '=', 'onboarding')
      .where('published', '=', true)
      .where('active', '=', true)
      .orderBy('publishedAt', 'desc')
      .executeTakeFirst();
    if (path) {
      const steps = await database
        .query()
        .selectFrom('learningPathSteps')
        .select(['dueOffsetDays'])
        .where('pathId', '=', str(path.id))
        .execute();
      const days = Math.max(0, ...steps.map((s) => num(s.dueOffsetDays)));
      if (days > 0)
        return { days, source: 'path' as const, pathId: str(path.id) };
    }
    return { days: fallback, source: 'settings' as const, pathId: null };
  }

  /** Employees who count: in the department or below, in the position, on the books through the month, not dispatched. */
  async function onDuty(
    departmentId: string,
    positionId: string,
    month: string,
  ): Promise<number> {
    const departments = [
      ...(await platform.organization.descendantsOf(departmentId)),
    ];
    if (!departments.includes(departmentId)) departments.push(departmentId);
    const from = `${month}-01`;
    const rows = await database
      .query()
      .selectFrom('employees')
      .select(['status', 'employmentType', 'leaveDate', 'hireDate'])
      .where('departmentId', 'in', departments)
      .where('positionId', '=', positionId)
      .execute();
    return rows.filter(
      (row) =>
        str(row.status) !== 'leave' &&
        str(row.employmentType ?? 'fullTime') !== 'dispatched' &&
        (!row.leaveDate || (day(row.leaveDate) ?? '') >= from),
    ).length;
  }

  async function calculate(input: {
    departmentId: string;
    positionId: string;
    month: string;
    plannedOutput: number;
    currentOutput: number | null;
  }) {
    const settings = await ctx.settings();
    const chain = await chainOf(input.departmentId);
    const params = paramsFor(settings, chain, input.positionId);
    if (!params) throw new HrError('WORKFORCE_PARAMS_MISSING', 409);
    const headcount = await onDuty(
      input.departmentId,
      input.positionId,
      input.month,
    );
    const perPersonMonth = params.outputPerShift * params.shiftsPerMonth;
    const capacity = headcount * perPersonMonth;
    const shortfall = Math.max(0, input.plannedOutput - capacity);
    // A small shortfall the people on duty absorb with a little overtime (招聘设置 · absorbOvertimeHours) is no gap.
    const absorbHours =
      headcount > 0
        ? ((shortfall / params.outputPerShift) * params.hoursPerShift) / headcount
        : Infinity;
    const absorbed =
      shortfall > 0 && absorbHours <= settings.workforce.absorbOvertimeHours;
    const gapOutput = absorbed ? 0 : shortfall;
    const gapHeadcount =
      gapOutput > 0 ? Math.ceil(gapOutput / perPersonMonth) : 0;
    const limit = await alertHours(chain);
    const onboarding = await onboardingDays(
      input.positionId,
      settings.workforce.onboardingDays,
    );
    const calculation: PlanCalculation = {
      headcount,
      outputPerShift: params.outputPerShift,
      shiftsPerMonth: params.shiftsPerMonth,
      hoursPerShift: params.hoursPerShift,
      capacity,
      plannedOutput: input.plannedOutput,
      currentOutput: input.currentOutput,
      gapOutput,
      gapHeadcount,
      shortfall,
      absorbedOvertimeHours: absorbed ? Math.round(absorbHours * 10) / 10 : null,
      overtimeLimitHours: limit.hours,
      recruitingCycleDays: settings.workforce.recruitingCycleDays,
      onboardingDays: onboarding.days,
      sources: {
        parameters: params.departmentId,
        headcount: 'employees',
        overtimeLimit: limit.source,
        onboarding: onboarding.source,
        onboardingPathId: onboarding.pathId,
      },
    };
    const options: PlanOption[] = [];
    if (gapHeadcount > 0) {
      // 加班: the gap output in shifts, in hours, spread over everyone on duty.
      const hours =
        headcount > 0
          ? Math.round(
              ((gapOutput / params.outputPerShift) * params.hoursPerShift) /
                headcount,
            )
          : null;
      options.push({
        type: 'overtime',
        feasible: hours !== null && hours <= limit.hours,
        detail: {
          hoursPerPerson: hours,
          limitHours: limit.hours,
          people: headcount,
        },
        risks:
          hours === null
            ? ['noStaff']
            : hours > limit.hours
              ? ['overLimit']
              : hours > limit.hours * 0.8
                ? ['nearLimit']
                : [],
        costNote:
          hours === null
            ? '在岗人数为 0，无法通过加班补足'
            : `现有 ${headcount} 人每人每月约加班 ${hours} 小时（上限 ${limit.hours} 小时）`,
      });
      // 借调: the loan limits of other departments, never a choice of people.
      const own = new Set([
        ...(await platform.organization.descendantsOf(input.departmentId)),
        input.departmentId,
      ]);
      const sources = [];
      for (const entry of settings.workforce.transferLimits) {
        if (own.has(entry.departmentId) || entry.maxHeadcount <= 0) continue;
        sources.push({
          departmentId: entry.departmentId,
          title: await ctx.departmentTitle(entry.departmentId),
          maxHeadcount: entry.maxHeadcount,
        });
      }
      const total = sources.reduce((sum, s) => sum + s.maxHeadcount, 0);
      options.push({
        type: 'transfer',
        feasible: total > 0,
        detail: { sources, maxHeadcount: total, covers: total >= gapHeadcount },
        risks: transferRisks(total, gapHeadcount, settings.workforce),
        costNote: total
          ? `最多可借调 ${total} 人，${total >= gapHeadcount ? '可以覆盖' : `不能覆盖 ${gapHeadcount} 人的缺口`}`
          : '招聘设置中没有可借调的部门',
      });
      const days =
        settings.workforce.recruitingCycleDays + onboarding.days;
      const weeks = Math.max(1, Math.round(days / 7));
      options.push({
        type: 'hire',
        feasible: true,
        detail: {
          headcount: gapHeadcount,
          recruitingCycleDays: settings.workforce.recruitingCycleDays,
          onboardingDays: onboarding.days,
          readyInDays: days,
          readyInWeeks: weeks,
          readyDate: addDays(platform.currentDate(), days),
        },
        risks: ['gapBeforeReady'],
        costNote: `招聘约 ${settings.workforce.recruitingCycleDays} 天，加上岗 ${onboarding.days} 天，约 ${weeks} 周后能独立上岗；此前有缺口`,
      });
    }
    const hash = sha256(
      JSON.stringify({ input, calculation, options: options.map((o) => o.detail) }),
    );
    return { calculation, options, hash };
  }


  async function row(id: string) {
    const found = await database
      .query()
      .selectFrom('workforcePlans')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('WORKFORCE_PLAN_NOT_FOUND', 404);
    return found as Record<string, unknown>;
  }

  /** hr.admin sees every plan; a head the plans of departments they manage; a loan coordinator the plans they were asked about. */
  async function visible(actor: ActorContext, plan: PlanView) {
    if (await ctx.isHrAdmin(actor)) return true;
    const managed = await platform.organization.managedDepartments(
      actor.userId,
    );
    if (managed.includes(plan.departmentId)) return true;
    const coordinators = json<string[]>(
      (plan.decision as { coordinatorUserIds?: unknown } | null)
        ?.coordinatorUserIds,
      [],
    );
    return coordinators.includes(actor.userId);
  }

  async function decorate(plan: PlanView) {
    const position = await ctx.position(plan.positionId);
    return {
      ...plan,
      departmentTitle: await ctx.departmentTitle(plan.departmentId),
      positionTitle: position?.title ?? plan.positionId,
    };
  }

  async function writeCalculated(
    existing: Record<string, unknown> | undefined,
    values: {
      departmentId: string;
      positionId: string;
      month: string;
      plannedOutput: number;
      currentOutput: number | null;
      source: string;
      pushedBy: string | null;
    },
  ) {
    const { calculation, options, hash } = await calculate(values);
    if (existing && str(existing.calculationHash) === hash)
      return { id: str(existing.id), changed: false, calculation, options };
    const status = calculation.gapHeadcount > 0 ? 'calculated' : 'noGap';
    const now = new Date();
    let id = existing ? str(existing.id) : newId();
    if (existing) {
      // A decided plan keeps its decision and requisition; new numbers reopen it for a new explanation.
      await database
        .query()
        .updateTable('workforcePlans')
        .set({
          plannedOutput: values.plannedOutput,
          currentOutput: values.currentOutput,
          source: values.source,
          calculation,
          calculationHash: hash,
          options,
          status:
            str(existing.status) === 'decided' && status === 'calculated'
              ? 'decided'
              : status,
          pushedBy: values.pushedBy,
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
    } else {
      try {
        await database
          .query()
          .insertInto('workforcePlans')
          .values({
            id,
            ...values,
            calculation,
            calculationHash: hash,
            options,
            aiSummary: null,
            aiSummaryHash: null,
            decision: null,
            requisitionId: null,
            status,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      } catch {
        // Two pushes of a new plan at once: the other one created it.
        const other = await database
          .query()
          .selectFrom('workforcePlans')
          .select(['id'])
          .where('departmentId', '=', values.departmentId)
          .where('positionId', '=', values.positionId)
          .where('month', '=', values.month)
          .executeTakeFirst();
        if (!other) throw new HrError('WORKFORCE_PLAN_CONFLICT', 409);
        id = str(other.id);
      }
    }
    if (calculation.gapHeadcount > 0) hooks.onCalculated(id);
    return { id, changed: true, calculation, options };
  }

  return {
    calculate,
    present: presentPlan,
    visible,

    /** 业务量计划到达: the integration account (API key) or an HR administrator's import. */
    async push(actor: ActorContext, input: unknown, source: 'api' | 'import') {
      await authorizeAction(actor.authz, COMPOSITE.plan, 'import');
      const parsed = pushSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const data = parsed.data;
      const departmentId = await resolveDepartment(data.department);
      const positionId = await resolvePosition(data.position);
      const existing = (await database
        .query()
        .selectFrom('workforcePlans')
        .selectAll()
        .where('departmentId', '=', departmentId)
        .where('positionId', '=', positionId)
        .where('month', '=', data.month)
        .executeTakeFirst());
      if (existing && str(existing.status) === 'cancelled')
        throw new HrError('WORKFORCE_PLAN_CANCELLED', 409);
      const result = await writeCalculated(existing, {
        departmentId,
        positionId,
        month: data.month,
        plannedOutput: data.plannedOutput,
        currentOutput: data.currentOutput ?? null,
        source,
        pushedBy: actor.userId,
      });
      ctx.audit({
        event: 'recruiting.workforcePush',
        planId: result.id,
        by: actor.userId,
        changed: result.changed,
      });
      // The integration account learns only its own push's outcome: no employee data.
      return {
        id: result.id,
        changed: result.changed,
        status: result.calculation.gapHeadcount > 0 ? 'calculated' : 'noGap',
        gapHeadcount: result.calculation.gapHeadcount,
      };
    },

    /** 重新测算 after the parameters changed (设置 / 招聘设置). */
    async recalculate(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.plan, 'decide');
      const existing = await row(id);
      const plan = presentPlan(existing);
      if (!(await visible(actor, plan)))
        throw new HrError('WORKFORCE_PLAN_NOT_FOUND', 404);
      if (plan.status === 'cancelled')
        throw new HrError('WORKFORCE_PLAN_CANCELLED', 409);
      await writeCalculated(existing, {
        departmentId: plan.departmentId,
        positionId: plan.positionId,
        month: plan.month,
        plannedOutput: plan.plannedOutput,
        currentOutput: plan.currentOutput,
        source: plan.source,
        pushedBy: actor.userId,
      });
      return decorate(presentPlan(await row(id)));
    },

    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.plan, 'view');
      let q = database.query().selectFrom('workforcePlans').selectAll();
      if (query.month) q = q.where('month', '=', query.month);
      if (query.departmentId)
        q = q.where('departmentId', '=', query.departmentId);
      if (query.status) q = q.where('status', '=', query.status);
      const rows = await q.orderBy('month', 'desc').execute();
      const items = [];
      for (const r of rows) {
        const plan = presentPlan(r);
        if (await visible(actor, plan)) items.push(await decorate(plan));
      }
      return {
        items,
        /** 招聘设置's unit of the quantities; null: the client's neutral word. */
        unitLabel: (await ctx.settings()).workforce.unitLabel ?? null,
        can: {
          import: await ctx.can(actor, COMPOSITE.plan, 'import'),
          settings: await ctx.can(actor, COMPOSITE.settings, 'manage'),
        },
      };
    },

    async detail(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.plan, 'view');
      const plan = presentPlan(await row(id));
      if (!(await visible(actor, plan)))
        throw new HrError('WORKFORCE_PLAN_NOT_FOUND', 404);
      const managed = await platform.organization.managedDepartments(
        actor.userId,
      );
      return {
        ...(await decorate(plan)),
        unitLabel: (await ctx.settings()).workforce.unitLabel ?? null,
        can: {
          decide:
            plan.status === 'calculated' &&
            (await ctx.can(actor, COMPOSITE.plan, 'decide')) &&
            ((await ctx.isHrAdmin(actor)) ||
              managed.includes(plan.departmentId)),
          recalculate:
            plan.status !== 'cancelled' &&
            (await ctx.can(actor, COMPOSITE.plan, 'decide')) &&
            ((await ctx.isHrAdmin(actor)) ||
              managed.includes(plan.departmentId)),
          settings: await ctx.can(actor, COMPOSITE.settings, 'manage'),
        },
      };
    },

    /** 用人部门负责人确定方案: 招聘 → a draft requisition; 借调 → a coordination to-do per lending department. */
    async decide(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.plan, 'decide');
      const parsed = decisionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const plan = presentPlan(await row(id));
      const managed = await platform.organization.managedDepartments(
        actor.userId,
      );
      if (
        !(await ctx.isHrAdmin(actor)) &&
        !managed.includes(plan.departmentId)
      )
        throw new HrError('WORKFORCE_PLAN_NOT_FOUND', 404);
      if (plan.status !== 'calculated')
        throw new HrError('WORKFORCE_PLAN_NOT_OPEN', 409);
      const types = [...new Set(parsed.data.types)];
      const overtime = plan.options.find((o) => o.type === 'overtime');
      if (types.includes('overtime') && overtime && !overtime.feasible)
        throw new HrError('WORKFORCE_OPTION_INFEASIBLE', 400);
      const settings = await ctx.settings();
      const coordinators: { departmentId: string; userId: string }[] = [];
      if (types.includes('transfer')) {
        const transfer = plan.options.find((o) => o.type === 'transfer');
        const sources = json<{ departmentId: string; maxHeadcount: number }[]>(
          transfer?.detail.sources,
          [],
        );
        for (const s of sources) {
          const entry = settings.workforce.transferLimits.find(
            (e) => e.departmentId === s.departmentId,
          );
          const userId =
            entry?.coordinatorUserId ??
            (await ctx.headOfDepartment(s.departmentId));
          if (userId) coordinators.push({ departmentId: s.departmentId, userId });
        }
      }
      const now = new Date();
      const decision = {
        types,
        note: parsed.data.note ?? null,
        decidedBy: actor.userId,
        decidedAt: now.toISOString(),
        coordinatorUserIds: coordinators.map((c) => c.userId),
      };
      await database
        .query()
        .updateTable('workforcePlans')
        .set({ decision, status: 'decided', updatedAt: now })
        .where('id', '=', id)
        .where('status', '=', 'calculated')
        .execute();
      const decided = presentPlan(await row(id));
      let requisitionId: string | null = null;
      if (types.includes('hire')) {
        requisitionId = await hooks.createDraftRequisition({
          plan: decided,
          actor,
        });
        await database
          .query()
          .updateTable('workforcePlans')
          .set({ requisitionId, updatedAt: new Date() })
          .where('id', '=', id)
          .execute();
      }
      const title = await ctx.departmentTitle(plan.departmentId);
      const position = (await ctx.position(plan.positionId))?.title ?? '';
      const transfer = plan.options.find((o) => o.type === 'transfer');
      for (const c of coordinators) {
        const limit = json<{ departmentId: string; maxHeadcount: number }[]>(
          transfer?.detail.sources,
          [],
        ).find((s) => s.departmentId === c.departmentId);
        await platform.notify({
          key: `workforceTransfer:${id}:${c.departmentId}`,
          userIds: [c.userId],
          message: 'recruitingTransferCoordination',
          params: {
            department: title,
            position,
            month: plan.month,
            from: await ctx.departmentTitle(c.departmentId),
            count: String(limit?.maxHeadcount ?? ''),
          },
          path: `/talent/workforce-plans/${id}`,
        });
      }
      return { ...(await decorate(presentPlan(await row(id)))), requisitionId };
    },

    /** The HR assistant's words only: the numbers and options stay as calculated. */
    async saveNotes(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.plan, 'decide');
      const parsed = notesSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const existing = await row(id);
      const plan = presentPlan(existing);
      if (!(await visible(actor, plan)))
        throw new HrError('WORKFORCE_PLAN_NOT_FOUND', 404);
      const options = plan.options.map((o) => ({
        ...o,
        note: parsed.data.optionNotes[o.type] ?? o.note ?? null,
      }));
      await database
        .query()
        .updateTable('workforcePlans')
        .set({
          aiSummary: parsed.data.aiSummary,
          aiSummaryHash: plan.calculationHash,
          options,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return { id, saved: true };
    },

    /** Trusted read for the assistant's run, after the run authorized itself. */
    async trustedGet(id: string) {
      return decorate(presentPlan(await row(id)));
    },

    /** How long ago the plan's month started, for the draft requisition's date. */
    targetDateFor(month: string): string {
      const start = `${month}-01`;
      const today = platform.currentDate();
      return daysBetween(today, start) > 0 ? start : addDays(today, 30);
    },
  };
}

export type WorkforceService = ReturnType<typeof createWorkforceService>;
export type WorkforcePlanView = Awaited<
  ReturnType<WorkforceService['trustedGet']>
>;

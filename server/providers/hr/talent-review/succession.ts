/**
 * V4-13 关键岗位与继任 (13A).
 *
 * - 标记关键岗位 (hr.admin, `talent.succession.manage`): `positions.isKey`;
 *   a draft plan is created for each department where someone holds the
 *   position (or the department named), and the talent analyst recommends
 *   successors once per new plan.
 * - `matchSuccessors`: computed on the server — the active people of the
 *   plan's department (with descendants), never the incumbent, against the
 *   position's current requirements: the gap, the latest final rating, the
 *   nine-box position; smallest gap first.
 * - AI candidates carry `source: ai` and no readiness; people choose the
 *   readiness, and a plan is confirmed only when every candidate still in it
 *   has one. Manual candidates are never overwritten by a recommendation.
 * - 离职 (the offboard job event): a candidate is marked left; a leaving
 *   incumbent or candidate starts the risk alert (hr01 and the incumbent's
 *   superior, never the incumbent), once per plan and reason in
 *   `riskCooldownDays`.
 */
import { z } from 'zod';

import { mentionsInternals } from '../ai-text-guard.js';
import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import type { JobEvent } from '../job-events.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { iso, json, num } from './context.js';
import { superiorOf } from './record-access.js';

const RESOURCE = 'talent.succession';
export const READINESS = ['readyNow', 'oneToTwoYears', 'threePlusYears'] as const;
export type Readiness = (typeof READINESS)[number];

export interface Candidate {
  employeeId: string;
  readiness: Readiness | null;
  gaps: { competencyId: string; title: string; required: number; current: number }[];
  developmentPlanId: string | null;
  source: 'ai' | 'manual';
  note: string;
  left: boolean;
  addedAt: string;
}

export interface SuccessorMatch {
  employeeId: string;
  name: string;
  departmentTitle: string;
  positionTitle: string;
  totalGap: number;
  mandatoryGaps: number;
  gaps: Candidate['gaps'];
  latestRating: string | null;
  box: number | null;
  developmentRecords: string[];
  /** False when the position has no confirmed requirements: no gap can be measured, so nobody “meets” them. */
  requirementsSet: boolean;
}

/** A learning plan's status as the 学习计划 page shows it; the model and the notes never see the code. */
const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '待确认',
  approved: '已确认',
  rejected: '已驳回',
  expired: '已过期',
};
export const NO_REQUIREMENTS_NOTE = '该岗位尚未设置要求，无法比较差距';

export function developmentRecordLabel(status: string): string {
  return `学习计划（${PLAN_STATUS_LABELS[status] ?? '状态未知'}）`;
}

/** The rule-based note on a successor, in the words people read (also shown in place of a stored note that leaks codes). */
export function successorNote(input: {
  requirementsSet: boolean;
  gaps: readonly Candidate['gaps'][number][];
  developmentRecords: readonly string[];
}): string {
  const head = !input.requirementsSet
    ? NO_REQUIREMENTS_NOTE
    : input.gaps.length
      ? `与岗位要求的差距：${input.gaps.map((g) => `${g.title}（${g.current}/${g.required}）`).join('、')}`
      : '已达到岗位当前要求';
  return input.developmentRecords.length
    ? `${head}；已有发展记录：${input.developmentRecords.join('、')}`
    : head;
}

const candidatesInput = z
  .object({
    candidates: z
      .array(
        z
          .object({
            employeeId: z.string().min(1).max(64),
            readiness: z.enum(READINESS).nullable().optional(),
            note: z.string().max(500).optional(),
            developmentPlanId: z.string().max(64).nullable().optional(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
const keyInput = z
  .object({
    isKey: z.boolean(),
    keyReason: z.string().trim().max(500).optional(),
    departmentIds: z.array(z.string().min(1).max(64)).max(20).optional(),
  })
  .strict();

export function createSuccessionService(
  ctx: TalentReviewContext,
  hooks: {
    onPlanCreated: (planId: string) => void;
    onRisk: (planId: string, reason: string, ref: string) => void;
  },
) {
  const { database, platform } = ctx;

  async function planRow(id: string) {
    const row = await database
      .query()
      .selectFrom('successionPlans')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('SUCCESSION_PLAN_NOT_FOUND', 404);
    return {
      id: str(row.id),
      positionId: str(row.positionId),
      departmentId: str(row.departmentId),
      incumbentEmployeeId: row.incumbentEmployeeId
        ? str(row.incumbentEmployeeId)
        : null,
      candidates: json<Candidate[]>(row.candidates, []),
      status: str(row.status),
      reviewedBy: row.reviewedBy ? str(row.reviewedBy) : null,
      reviewedAt: iso(row.reviewedAt),
      updatedAt: iso(row.updatedAt),
    };
  }
  type Plan = Awaited<ReturnType<typeof planRow>>;

  async function visiblePlan(
    actor: ActorContext,
    action: 'view' | 'manage' | 'confirm',
    id: string,
  ): Promise<Plan> {
    const policies = await authorizeAction(actor.authz, RESOURCE, action);
    const visible = await database
      .repository('successionPlans')
      .withPolicy(policyOf(policies, 'successionPlans'))
      .findOne({ filter: { id } });
    if (!visible) throw new HrError('SUCCESSION_PLAN_NOT_FOUND', 404);
    const plan = await planRow(id);
    // 现任本人看不到自己岗位的继任计划.
    const own = await platform.employeeOfUser(actor.userId);
    if (own && own.id === plan.incumbentEmployeeId)
      throw new HrError('SUCCESSION_PLAN_NOT_FOUND', 404);
    return plan;
  }

  async function gapsFor(employeeIds: readonly string[], positionId: string) {
    const requirements = await ctx.requirementsOf(positionId);
    const levels = await ctx.currentLevels(employeeIds);
    const titles = await ctx.competencyTitles();
    const result = new Map<
      string,
      {
        gaps: Candidate['gaps'];
        total: number;
        mandatory: number;
        requirementsSet: boolean;
      }
    >();
    for (const id of employeeIds) {
      const map = levels.get(id) ?? new Map<string, number>();
      const gaps: Candidate['gaps'] = [];
      let total = 0;
      let mandatory = 0;
      for (const r of requirements) {
        const current = map.get(r.competencyId) ?? 0;
        if (current >= r.requiredLevel) continue;
        gaps.push({
          competencyId: r.competencyId,
          title: titles.get(r.competencyId) ?? r.competencyId,
          required: r.requiredLevel,
          current,
        });
        total += r.requiredLevel - current;
        if (r.mandatory) mandatory += 1;
      }
      result.set(id, {
        gaps,
        total,
        mandatory,
        requirementsSet: requirements.length > 0,
      });
    }
    return result;
  }

  /** Incumbents of a position in a department (active). */
  async function incumbentOf(positionId: string, departmentId: string) {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('positionId', '=', positionId)
      .where('departmentId', '=', departmentId)
      .where('status', '!=', 'leave')
      .orderBy('hireDate', 'asc')
      .executeTakeFirst();
    return row ? str(row.id) : null;
  }

  async function latestBoxes(employeeIds: readonly string[]) {
    const map = new Map<string, number>();
    if (!employeeIds.length) return map;
    const rows = await database
      .query()
      .selectFrom('talentPlacements')
      .select(['employeeId', 'box', 'decidedAt'])
      .where('employeeId', 'in', [...employeeIds])
      .where('decidedAt', 'is not', null)
      .orderBy('decidedAt', 'desc')
      .execute();
    for (const r of rows)
      if (!map.has(str(r.employeeId)) && r.box) map.set(str(r.employeeId), Number(r.box));
    return map;
  }

  /** Each person's learning plans, labelled for people (`学习计划（待确认）`). */
  async function developmentRecordsOf(employeeIds: readonly string[]) {
    const map = new Map<string, string[]>();
    if (!employeeIds.length) return map;
    const rows = await database
      .query()
      .selectFrom('learningPlans')
      .select(['employeeId', 'status'])
      .where('employeeId', 'in', [...employeeIds])
      .execute();
    for (const r of rows) {
      const id = str(r.employeeId);
      map.set(id, [...(map.get(id) ?? []), developmentRecordLabel(str(r.status))]);
    }
    return map;
  }

  /** 继任候选匹配 (the analyst's `matchSuccessors`): trusted; callers authorize first. */
  async function match(positionId: string, departmentId: string): Promise<SuccessorMatch[]> {
    const departments = new Set(
      await platform.organization.descendantsOf(departmentId),
    );
    const employees = [...(await ctx.employees()).values()].filter(
      (e) => departments.has(e.departmentId) && e.status !== 'leave',
    );
    // Never the incumbent (anyone holding the position in these departments).
    const pool = employees.filter((e) => e.positionId !== positionId);
    const gaps = await gapsFor(
      pool.map((e) => e.id),
      positionId,
    );
    const ratings = await ctx.latestRatings(pool.map((e) => e.id));
    const boxes = await latestBoxes(pool.map((e) => e.id));
    const titles = await ctx.departmentTitles();
    const positions = await ctx.positionTitles();
    const records = await developmentRecordsOf(pool.map((e) => e.id));
    const ratingOrder = ['S', 'A', 'B', 'C', 'D'];
    return pool
      .map((e) => {
        const gap = gaps.get(e.id)!;
        return {
          employeeId: e.id,
          name: e.name,
          departmentTitle: titles.get(e.departmentId) ?? '',
          positionTitle: e.positionId ? (positions.get(e.positionId) ?? '') : '',
          totalGap: gap.total,
          mandatoryGaps: gap.mandatory,
          gaps: gap.gaps,
          latestRating: ratings.get(e.id)?.rating ?? null,
          box: boxes.get(e.id) ?? null,
          developmentRecords: records.get(e.id) ?? [],
          requirementsSet: gap.requirementsSet,
        };
      })
      .sort(
        (a, b) =>
          a.totalGap - b.totalGap ||
          a.mandatoryGaps - b.mandatoryGaps ||
          (a.latestRating ? ratingOrder.indexOf(a.latestRating) : 9) -
            (b.latestRating ? ratingOrder.indexOf(b.latestRating) : 9) ||
          a.name.localeCompare(b.name),
      );
  }

  async function writeCandidates(planId: string, candidates: Candidate[]) {
    await database
      .query()
      .updateTable('successionPlans')
      .set({ candidates, updatedAt: new Date() })
      .where('id', '=', planId)
      .execute();
  }

  async function toView(actor: ActorContext, plan: Plan) {
    const employees = await ctx.employees();
    const titles = await ctx.departmentTitles();
    const positions = await ctx.positionTitles();
    const gaps = await gapsFor(
      plan.candidates.map((c) => c.employeeId),
      plan.positionId,
    );
    const requirements = await ctx.requirementsOf(plan.positionId);
    const competencyTitles = await ctx.competencyTitles();
    const ratings = await ctx.latestRatings(plan.candidates.map((c) => c.employeeId));
    const records = await developmentRecordsOf(
      plan.candidates.map((c) => c.employeeId),
    );
    const incumbent = plan.incumbentEmployeeId
      ? employees.get(plan.incumbentEmployeeId)
      : undefined;
    const active = plan.candidates.filter((c) => !c.left);
    return {
      id: plan.id,
      positionId: plan.positionId,
      positionTitle: positions.get(plan.positionId) ?? '',
      departmentId: plan.departmentId,
      departmentTitle: titles.get(plan.departmentId) ?? '',
      incumbent: incumbent
        ? {
            id: incumbent.id,
            name: incumbent.name,
            left: incumbent.status === 'leave',
          }
        : null,
      status: plan.status,
      reviewedByName: plan.reviewedBy ? await ctx.userName(plan.reviewedBy) : null,
      reviewedAt: plan.reviewedAt,
      requirementsSet: requirements.length > 0,
      requirements: requirements.map((r) => ({
        ...r,
        title: competencyTitles.get(r.competencyId) ?? r.competencyId,
      })),
      candidates: plan.candidates.map((c) => ({
        ...c,
        // A note the analyst stored before the wording check may name fields or status codes
        // (“gaps 为空”, “学习计划（draft）”): show the rule-based note instead.
        note:
          c.source === 'ai' && mentionsInternals(c.note)
            ? successorNote({
                requirementsSet: requirements.length > 0,
                gaps: gaps.get(c.employeeId)?.gaps ?? [],
                developmentRecords: records.get(c.employeeId) ?? [],
              }) + (c.left ? '（已离职）' : '')
            : c.note,
        name: employees.get(c.employeeId)?.name ?? '',
        departmentTitle:
          titles.get(employees.get(c.employeeId)?.departmentId ?? '') ?? '',
        currentGaps: gaps.get(c.employeeId)?.gaps ?? [],
        latestRating: ratings.get(c.employeeId)?.rating ?? null,
      })),
      risk: risk(active),
      can: {
        manage: await ctx.can(actor, RESOURCE, 'manage'),
        confirm: await ctx.can(actor, RESOURCE, 'confirm'),
      },
    };
  }

  function risk(active: readonly Candidate[]): string | null {
    if (!active.length) return 'noCandidates';
    if (!active.some((c) => c.readiness === 'readyNow' || c.readiness === 'oneToTwoYears'))
      return 'noReadySuccessor';
    return null;
  }

  const service = {
    match,
    planRow,
    gapsFor,

    async list(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
      const own = await platform.employeeOfUser(actor.userId);
      const rows = (
        (await database
          .repository('successionPlans')
          .withPolicy(policyOf(policies, 'successionPlans'))
          .findMany({})) as Record<string, unknown>[]
      ).filter((r) => !own || str(r.incumbentEmployeeId ?? '') !== own.id);
      const employees = await ctx.employees();
      const titles = await ctx.departmentTitles();
      const positions = await ctx.positionTitles();
      const order: Record<string, number> = {
        readyNow: 0,
        oneToTwoYears: 1,
        threePlusYears: 2,
      };
      const plans = rows.map((row) => {
        const candidates = json<Candidate[]>(row.candidates, []).filter(
          (c) => !c.left,
        );
        const best = candidates
          .map((c) => c.readiness)
          .filter((r): r is Readiness => Boolean(r))
          .sort((a, b) => order[a] - order[b])[0];
        const incumbent = row.incumbentEmployeeId
          ? employees.get(str(row.incumbentEmployeeId))
          : undefined;
        return {
          id: str(row.id),
          positionId: str(row.positionId),
          positionTitle: positions.get(str(row.positionId)) ?? '',
          departmentTitle: titles.get(str(row.departmentId)) ?? '',
          incumbentName: incumbent?.name ?? null,
          candidateCount: candidates.length,
          bestReadiness: best ?? null,
          status: str(row.status),
          risk: risk(candidates),
        };
      });
      const keyPositions = (await ctx.can(actor, RESOURCE, 'manage'))
        ? (
            await database
              .query()
              .selectFrom('positions')
              .select(['id', 'title', 'isKey', 'keyReason'])
              .where('active', '=', true)
              .orderBy('title', 'asc')
              .execute()
          ).map((p) => ({
            id: str(p.id),
            title: str(p.title),
            isKey: p.isKey === true || p.isKey === 1,
            keyReason: p.keyReason ? str(p.keyReason) : null,
          }))
        : [];
      return {
        plans,
        positions: keyPositions,
        can: { manage: await ctx.can(actor, RESOURCE, 'manage') },
      };
    },

    async detail(actor: ActorContext, id: string) {
      return toView(actor, await visiblePlan(actor, 'view', id));
    },

    /** 标记关键岗位; a new plan for each department where the position is held. */
    async markKey(actor: ActorContext, positionId: string, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const parsed = keyInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const position = await database
        .query()
        .selectFrom('positions')
        .select(['id'])
        .where('id', '=', positionId)
        .executeTakeFirst();
      if (!position) throw new HrError('POSITION_NOT_FOUND', 404);
      await database
        .repository('positions')
        .withPolicy(policyOf(policies, 'positions'))
        .updateOne({
          filter: { id: positionId },
          values: {
            isKey: parsed.data.isKey,
            keyReason: parsed.data.isKey ? (parsed.data.keyReason ?? null) : null,
            updatedAt: new Date(),
          },
        });
      const created: string[] = [];
      if (parsed.data.isKey) {
        const holders = await database
          .query()
          .selectFrom('employees')
          .select(['departmentId'])
          .where('positionId', '=', positionId)
          .where('status', '!=', 'leave')
          .execute();
        const departments = [
          ...new Set([
            ...holders.map((h) => str(h.departmentId)),
            ...(parsed.data.departmentIds ?? []),
          ]),
        ];
        for (const departmentId of departments) {
          const exists = await database
            .query()
            .selectFrom('successionPlans')
            .select(['id'])
            .where('positionId', '=', positionId)
            .where('departmentId', '=', departmentId)
            .executeTakeFirst();
          if (exists) continue;
          const id = newId();
          const now = new Date();
          await database
            .query()
            .insertInto('successionPlans')
            .values({
              id,
              positionId,
              departmentId,
              incumbentEmployeeId: await incumbentOf(positionId, departmentId),
              candidates: [],
              status: 'draft',
              reviewedBy: null,
              reviewedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
          created.push(id);
          hooks.onPlanCreated(id);
        }
      }
      return { positionId, isKey: parsed.data.isKey, createdPlanIds: created };
    },

    /** People add, remove and rate candidates; AI candidates keep their gaps and source. */
    async updateCandidates(actor: ActorContext, id: string, input: unknown) {
      const plan = await visiblePlan(actor, 'manage', id);
      const parsed = candidatesInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      if (
        plan.incumbentEmployeeId &&
        parsed.data.candidates.some((c) => c.employeeId === plan.incumbentEmployeeId)
      )
        throw new HrError('SUCCESSION_INCUMBENT_CANDIDATE', 400);
      const employees = await ctx.employees();
      const gaps = await gapsFor(
        parsed.data.candidates.map((c) => c.employeeId),
        plan.positionId,
      );
      const next: Candidate[] = [];
      for (const input of parsed.data.candidates) {
        if (!employees.has(input.employeeId))
          throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        const current = plan.candidates.find((c) => c.employeeId === input.employeeId);
        next.push({
          employeeId: input.employeeId,
          readiness:
            input.readiness === undefined
              ? (current?.readiness ?? null)
              : input.readiness,
          gaps: current?.gaps ?? gaps.get(input.employeeId)?.gaps ?? [],
          developmentPlanId:
            input.developmentPlanId === undefined
              ? (current?.developmentPlanId ?? null)
              : input.developmentPlanId,
          source: current?.source ?? 'manual',
          note: input.note ?? current?.note ?? '',
          left: current?.left ?? false,
          addedAt: current?.addedAt ?? new Date().toISOString(),
        });
      }
      await database
        .query()
        .updateTable('successionPlans')
        .set({
          candidates: next,
          // A change after confirmation needs confirming again.
          status: 'draft',
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return toView(actor, await planRow(id));
    },

    async confirm(actor: ActorContext, id: string) {
      const plan = await visiblePlan(actor, 'confirm', id);
      const active = plan.candidates.filter((c) => !c.left);
      if (!active.length) throw new HrError('SUCCESSION_NO_CANDIDATES', 409);
      if (active.some((c) => !c.readiness))
        throw new HrError('SUCCESSION_READINESS_REQUIRED', 409);
      await database
        .query()
        .updateTable('successionPlans')
        .set({
          status: 'confirmed',
          reviewedBy: actor.userId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return toView(actor, await planRow(id));
    },

    /** `saveSuccessorSuggestions`: AI candidates without readiness; manual ones stay untouched. */
    async saveSuggestions(
      planId: string,
      suggestions: readonly { employeeId: string; note: string; gaps: Candidate['gaps'] }[],
    ): Promise<number> {
      const plan = await planRow(planId);
      const present = new Set(plan.candidates.map((c) => c.employeeId));
      const added: Candidate[] = [];
      for (const s of suggestions) {
        if (present.has(s.employeeId) || s.employeeId === plan.incumbentEmployeeId)
          continue;
        present.add(s.employeeId);
        added.push({
          employeeId: s.employeeId,
          readiness: null,
          gaps: s.gaps,
          developmentPlanId: null,
          source: 'ai',
          note: s.note.slice(0, 500),
          left: false,
          addedAt: new Date().toISOString(),
        });
      }
      if (added.length)
        await writeCandidates(planId, [...plan.candidates, ...added]);
      return added.length;
    },

    /** The people a risk alert goes to: the automation owner (hr01) and the incumbent's superior — never the incumbent. */
    async riskRecipients(plan: Plan, owner: string | null): Promise<string[]> {
      const recipients = new Set<string>();
      if (owner) recipients.add(owner);
      if (plan.incumbentEmployeeId) {
        const superior = await superiorOf(
          database,
          platform.organization,
          plan.incumbentEmployeeId,
        );
        if (superior) recipients.add(superior);
      }
      if (plan.incumbentEmployeeId) {
        const incumbent = await platform.employee(plan.incumbentEmployeeId);
        if (incumbent?.userId) recipients.delete(incumbent.userId);
      }
      return [...recipients];
    },

    /** The offboard job event: candidates are marked left; the incumbent's or a candidate's leaving is a risk. */
    async onJobEvent(event: JobEvent) {
      if (event.eventType !== 'offboard') return;
      const plans = await database
        .query()
        .selectFrom('successionPlans')
        .select(['id'])
        .execute();
      for (const row of plans) {
        const plan = await planRow(str(row.id));
        const isIncumbent = plan.incumbentEmployeeId === event.employeeId;
        const candidate = plan.candidates.find(
          (c) => c.employeeId === event.employeeId,
        );
        if (!isIncumbent && !candidate) continue;
        if (candidate && !candidate.left)
          await writeCandidates(
            plan.id,
            plan.candidates.map((c) =>
              c.employeeId === event.employeeId
                ? { ...c, left: true, note: c.note ? `${c.note}（已离职）` : '已离职' }
                : c,
            ),
          );
        hooks.onRisk(
          plan.id,
          isIncumbent ? 'incumbentLeft' : 'candidateLeft',
          `${event.id}:${plan.id}`,
        );
      }
    },

    async planIds(): Promise<string[]> {
      return (
        await database
          .query()
          .selectFrom('successionPlans')
          .innerJoin('positions', 'positions.id', 'successionPlans.positionId')
          .select(['successionPlans.id as id'])
          .where('positions.isKey', '=', true)
          .execute()
      ).map((r) => str(r.id));
    },

    risk,
    num,
  };
  return service;
}

export type SuccessionService = ReturnType<typeof createSuccessionService>;

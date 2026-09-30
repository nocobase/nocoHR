/**
 * V4-13 人才盘点 (13A): 盘点活动 and 九宫格落位.
 *
 * - draft → preparing (hr.admin, `manage`): the cycle, if any, must be
 *   published; a placement is created for every active employee in scope with
 *   the performance band converted from the final rating (等级换算表); each
 *   head of the people in scope is told to fill in the potential assessment;
 *   the talent analyst pre-places (once per review — a second advance or a
 *   repeated trigger adds nothing).
 * - preparing: a head fills the potential assessment of the people in scope
 *   (`assessPotential`, three items scored 1–3 with an example each); the band
 *   and, with a performance band, the box follow.
 * - inSession: hr.admin moves cards (`place`) — every move needs a reason
 *   and keeps the analyst's suggestion untouched; sets the performance band
 *   by hand (with a reason) where there is no result; writes the development
 *   actions and confirms the placement, after which the learning coach drafts
 *   a learning plan (trigger = talentReview) for the head to confirm.
 * - concluded (`conclude`): read-only for hr.admin; heads see nothing more.
 *
 * Nothing here starts a promotion or a salary change: those stay with the
 * personnel action (V1-02) and the salary adjustment (V2-06).
 */
import { z } from 'zod';

import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  ACTION_TYPES,
  bandsOfBox,
  boxOf,
  POTENTIAL_KEYS,
  potentialBandOf,
} from './config.js';
import type { TalentReviewContext } from './context.js';
import { iso, json, num } from './context.js';

const RESOURCE = 'talent.talentReview';
export const REVIEW_STATUSES = [
  'draft',
  'preparing',
  'inSession',
  'concluded',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const createInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    departmentIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    reviewCycleId: z.string().max(64).nullable().optional(),
    ownerUserId: z.string().max(64).optional(),
  })
  .strict();
const potentialInput = z
  .object({
    answers: z.object(
      Object.fromEntries(
        POTENTIAL_KEYS.map((key) => [
          key,
          z
            .object({
              score: z.number().int().min(1).max(3),
              example: z.string().trim().min(1).max(500),
            })
            .strict(),
        ]),
      ) as Record<
        (typeof POTENTIAL_KEYS)[number],
        z.ZodObject<{ score: z.ZodNumber; example: z.ZodString }>
      >,
    ),
  })
  .strict();
const moveInput = z
  .object({
    box: z.number().int().min(1).max(9),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const performanceInput = z
  .object({
    band: z.number().int().min(1).max(3),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();
const actionsInput = z
  .object({
    actions: z
      .array(
        z
          .object({
            type: z.enum(ACTION_TYPES),
            note: z.string().trim().max(500).default(''),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export interface PlacementView {
  id: string;
  talentReviewId: string;
  employeeId: string;
  employeeName: string;
  departmentId: string;
  departmentTitle: string;
  positionTitle: string;
  performanceRating: string | null;
  performanceBand: number | null;
  performanceSource: string | null;
  performanceReason: string | null;
  potentialAnswers: Record<string, { score: number; example: string }> | null;
  potentialBand: number | null;
  potentialAssessedAt: string | null;
  box: number | null;
  aiSuggestion: {
    performanceBand: number | null;
    potentialEvidence: string[];
    suggestedBox: number | null;
    notes: string;
    source: 'ai' | 'rule';
    generatedAt: string;
  } | null;
  moves: {
    fromBox: number | null;
    toBox: number;
    reason: string;
    by: string;
    byName: string;
    at: string;
  }[];
  developmentActions: { type: string; note: string }[];
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  learningPlanId: string | null;
}

export function createReviewService(
  ctx: TalentReviewContext,
  hooks: {
    onPreparing: (reviewId: string) => void;
    onPotentialAssessed: (placementId: string) => void;
    onPlacementConfirmed: (placementId: string) => void;
  },
) {
  const { database, platform } = ctx;

  async function reviewRow(id: string) {
    const row = await database
      .query()
      .selectFrom('talentReviews')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('TALENT_REVIEW_NOT_FOUND', 404);
    return {
      id: str(row.id),
      title: str(row.title),
      scope: json<{ departmentIds: string[] }>(row.scope, {
        departmentIds: [],
      }),
      reviewCycleId: row.reviewCycleId ? str(row.reviewCycleId) : null,
      status: str(row.status) as ReviewStatus,
      ownerUserId: str(row.ownerUserId),
      stageLog: json<{ from: string; to: string; at: string; by: string }[]>(
        row.stageLog,
        [],
      ),
      createdAt: iso(row.createdAt),
    };
  }

  async function placementRow(id: string) {
    const row = await database
      .query()
      .selectFrom('talentPlacements')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('PLACEMENT_NOT_FOUND', 404);
    return row as Record<string, unknown>;
  }

  /** The placement, if the caller's action reaches it (its record scope). */
  async function visiblePlacement(
    actor: ActorContext,
    action: 'view' | 'assessPotential' | 'place' | 'conclude',
    id: string,
  ) {
    const policies = await authorizeAction(actor.authz, RESOURCE, action);
    const visible = await database
      .repository('talentPlacements')
      .withPolicy(policyOf(policies, 'talentPlacements'))
      .findOne({ filter: { id } });
    if (!visible) throw new HrError('PLACEMENT_NOT_FOUND', 404);
    const row = await placementRow(id);
    // 员工本人看不到自己的落位, whatever else the caller may hold.
    const own = await platform.employeeOfUser(actor.userId);
    if (own?.id === str(row.employeeId))
      throw new HrError('PLACEMENT_NOT_FOUND', 404);
    return row;
  }

  async function toViews(
    rows: readonly Record<string, unknown>[],
  ): Promise<PlacementView[]> {
    const employees = await ctx.employees();
    const departments = await ctx.departmentTitles();
    const positions = await ctx.positionTitles();
    const out: PlacementView[] = [];
    for (const row of rows) {
      const employee = employees.get(str(row.employeeId));
      const moves = json<
        {
          fromBox: number | null;
          toBox: number;
          reason: string;
          by: string;
          at: string;
        }[]
      >(row.moves, []);
      out.push({
        id: str(row.id),
        talentReviewId: str(row.talentReviewId),
        employeeId: str(row.employeeId),
        employeeName: employee?.name ?? '',
        departmentId: str(row.departmentId),
        departmentTitle: departments.get(str(row.departmentId)) ?? '',
        positionTitle: employee?.positionId
          ? (positions.get(employee.positionId) ?? '')
          : '',
        performanceRating: row.performanceRating
          ? str(row.performanceRating)
          : null,
        performanceBand: num(row.performanceBand),
        performanceSource: row.performanceSource
          ? str(row.performanceSource)
          : null,
        performanceReason: row.performanceReason
          ? str(row.performanceReason)
          : null,
        potentialAnswers: json(row.potentialAnswers, null),
        potentialBand: num(row.potentialBand),
        potentialAssessedAt: iso(row.potentialAssessedAt),
        box: num(row.box),
        aiSuggestion: json(row.aiSuggestion, null),
        moves: await Promise.all(
          moves.map(async (m) => ({ ...m, byName: await ctx.userName(m.by) })),
        ),
        developmentActions: json(row.developmentActions, []),
        decidedBy: row.decidedBy ? str(row.decidedBy) : null,
        decidedByName: row.decidedBy
          ? await ctx.userName(str(row.decidedBy))
          : null,
        decidedAt: iso(row.decidedAt),
        learningPlanId: row.learningPlanId ? str(row.learningPlanId) : null,
      });
    }
    return out.sort(
      (a, b) =>
        a.departmentTitle.localeCompare(b.departmentTitle) ||
        a.employeeName.localeCompare(b.employeeName),
    );
  }

  async function scopedEmployees(departmentIds: readonly string[]) {
    const ids = new Set<string>();
    for (const id of departmentIds)
      for (const d of await platform.organization.descendantsOf(id))
        ids.add(d);
    if (!ids.size) return [];
    return [...(await ctx.employees()).values()].filter(
      (e) => ids.has(e.departmentId) && e.status !== 'leave',
    );
  }

  async function setStatus(
    review: Awaited<ReturnType<typeof reviewRow>>,
    to: ReviewStatus,
    actor: ActorContext,
  ) {
    const now = new Date();
    const log = [
      ...review.stageLog,
      { from: review.status, to, at: now.toISOString(), by: actor.userId },
    ];
    const updated = await database
      .query()
      .updateTable('talentReviews')
      .set({ status: to, stageLog: log, updatedAt: now })
      .where('id', '=', review.id)
      .where('status', '=', review.status)
      .execute();
    if (updated.updatedCount === 0)
      throw new HrError('TALENT_REVIEW_STAGE_CHANGED', 409);
  }

  /** Creates the placements of a review entering preparing; answers how many were created. */
  async function createPlacements(
    review: Awaited<ReturnType<typeof reviewRow>>,
  ): Promise<{ created: number; heads: Map<string, number> }> {
    const settings = await ctx.settings();
    const people = await scopedEmployees(review.scope.departmentIds);
    const ratings = await ctx.latestRatings(
      people.map((p) => p.id),
      review.reviewCycleId,
    );
    const existing = new Set(
      (
        await database
          .query()
          .selectFrom('talentPlacements')
          .select(['employeeId'])
          .where('talentReviewId', '=', review.id)
          .execute()
      ).map((r) => str(r.employeeId)),
    );
    const heads = new Map<string, number>();
    let created = 0;
    const now = new Date();
    for (const person of people) {
      const head = await ctx.headOf(person);
      if (head) heads.set(head, (heads.get(head) ?? 0) + 1);
      if (existing.has(person.id)) continue;
      const rating = ratings.get(person.id)?.rating ?? null;
      const band = rating ? (settings.ratingBands[rating] ?? null) : null;
      await database
        .query()
        .insertInto('talentPlacements')
        .values({
          id: newId(),
          talentReviewId: review.id,
          employeeId: person.id,
          departmentId: person.departmentId,
          performanceBand: band,
          performanceRating: rating,
          performanceSource: band ? 'rating' : null,
          performanceReason: null,
          potentialAnswers: null,
          potentialAssessedBy: null,
          potentialAssessedAt: null,
          potentialBand: null,
          box: null,
          aiSuggestion: null,
          moves: null,
          developmentActions: null,
          decidedBy: null,
          decidedAt: null,
          learningPlanId: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
        .catch((error: unknown) => {
          // A concurrent advance created it first: (talentReviewId, employeeId) is unique.
          if (!/unique|constraint/iu.test(String(error))) throw error;
        });
      created += 1;
    }
    return { created, heads };
  }

  const service = {
    async list(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
      const admin = await ctx.can(actor, RESOURCE, 'manage');
      const reviews = await database
        .query()
        .selectFrom('talentReviews')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .execute();
      const placements = (await database
        .repository('talentPlacements')
        .withPolicy(policyOf(policies, 'talentPlacements'))
        .findMany({})) as Record<string, unknown>[];
      const counts = new Map<string, { total: number; placed: number; potential: number }>();
      for (const p of placements) {
        const c = counts.get(str(p.talentReviewId)) ?? {
          total: 0,
          placed: 0,
          potential: 0,
        };
        c.total += 1;
        if (p.decidedAt) c.placed += 1;
        if (p.potentialBand) c.potential += 1;
        counts.set(str(p.talentReviewId), c);
      }
      const out = [];
      for (const row of reviews) {
        const id = str(row.id);
        if (!admin && !counts.has(id)) continue;
        out.push({
          id,
          title: str(row.title),
          status: str(row.status),
          reviewCycleId: row.reviewCycleId ? str(row.reviewCycleId) : null,
          ownerName: await ctx.userName(str(row.ownerUserId)),
          placements: counts.get(id)?.total ?? 0,
          decided: counts.get(id)?.placed ?? 0,
          potentialDone: counts.get(id)?.potential ?? 0,
          createdAt: iso(row.createdAt),
        });
      }
      return {
        reviews: out,
        can: {
          manage: admin,
        },
      };
    },

    async create(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, RESOURCE, 'manage');
      const parsed = createInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const departments = await ctx.departmentTitles();
      if (parsed.data.departmentIds.some((d) => !departments.has(d)))
        throw new HrError('DEPARTMENT_NOT_FOUND', 404);
      if (parsed.data.reviewCycleId) {
        const cycle = await database
          .query()
          .selectFrom('reviewCycles')
          .select(['id'])
          .where('id', '=', parsed.data.reviewCycleId)
          .executeTakeFirst();
        if (!cycle) throw new HrError('REVIEW_CYCLE_NOT_FOUND', 404);
      }
      const id = newId();
      const now = new Date();
      await database
        .query()
        .insertInto('talentReviews')
        .values({
          id,
          title: parsed.data.title,
          scope: { departmentIds: parsed.data.departmentIds },
          reviewCycleId: parsed.data.reviewCycleId ?? null,
          status: 'draft',
          ownerUserId: parsed.data.ownerUserId || actor.userId,
          stageLog: [],
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return service.detail(actor, id);
    },

    async update(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, RESOURCE, 'manage');
      const review = await reviewRow(id);
      if (review.status !== 'draft')
        throw new HrError('TALENT_REVIEW_NOT_DRAFT', 409);
      const parsed = createInput.partial().safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('talentReviews')
        .set({
          ...(parsed.data.title ? { title: parsed.data.title } : {}),
          ...(parsed.data.departmentIds
            ? { scope: { departmentIds: parsed.data.departmentIds } }
            : {}),
          ...(parsed.data.reviewCycleId !== undefined
            ? { reviewCycleId: parsed.data.reviewCycleId }
            : {}),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async detail(actor: ActorContext, id: string) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
      const review = await reviewRow(id);
      const admin = await ctx.can(actor, RESOURCE, 'manage');
      const own = await platform.employeeOfUser(actor.userId);
      const rows = (
        (await database
          .repository('talentPlacements')
          .withPolicy(policyOf(policies, 'talentPlacements'))
          .findMany({ filter: { talentReviewId: id } })) as Record<
          string,
          unknown
        >[]
      ).filter((r) => str(r.employeeId) !== own?.id);
      if (!admin && !rows.length)
        throw new HrError('TALENT_REVIEW_NOT_FOUND', 404);
      const cycle = review.reviewCycleId
        ? await database
            .query()
            .selectFrom('reviewCycles')
            .select(['id', 'title', 'status'])
            .where('id', '=', review.reviewCycleId)
            .executeTakeFirst()
        : undefined;
      const departments = await ctx.departmentTitles();
      const settings = await ctx.settings();
      return {
        review: {
          ...review,
          ownerName: await ctx.userName(review.ownerUserId),
          departmentTitles: review.scope.departmentIds.map(
            (d) => departments.get(d) ?? d,
          ),
          cycle: cycle
            ? {
                id: str(cycle.id),
                title: str(cycle.title),
                status: str(cycle.status),
              }
            : null,
          stageLog: admin ? review.stageLog : [],
        },
        placements: await toViews(rows),
        potentialQuestions: settings.potentialQuestions,
        boxActions: settings.boxActions,
        can: {
          manage: admin && review.status !== 'concluded',
          assessPotential:
            ['preparing', 'inSession'].includes(review.status) &&
            (await ctx.can(actor, RESOURCE, 'assessPotential')),
          place:
            review.status === 'inSession' &&
            (await ctx.can(actor, RESOURCE, 'place')),
          conclude:
            review.status === 'inSession' &&
            (await ctx.can(actor, RESOURCE, 'conclude')),
        },
      };
    },

    async advance(actor: ActorContext, id: string) {
      const review = await reviewRow(id);
      if (review.status === 'draft') {
        await authorizeAction(actor.authz, RESOURCE, 'manage');
        if (review.reviewCycleId) {
          const cycle = await database
            .query()
            .selectFrom('reviewCycles')
            .select(['status'])
            .where('id', '=', review.reviewCycleId)
            .executeTakeFirst();
          if (!cycle || !['published', 'closed'].includes(str(cycle.status)))
            throw new HrError('TALENT_REVIEW_CYCLE_NOT_PUBLISHED', 409);
        }
        await setStatus(review, 'preparing', actor);
        const { heads } = await createPlacements(review);
        // 通知主管填写潜力评估: once per head and review.
        for (const [head, count] of heads)
          await platform.notify({
            key: `talentReview:${review.id}:potential:${head}`,
            userIds: [head],
            message: 'talentReviewPotential',
            params: { title: review.title, count: String(count) },
            path: `/talent/talent-reviews/${review.id}`,
          });
        hooks.onPreparing(review.id);
        return service.detail(actor, id);
      }
      if (review.status === 'preparing') {
        await authorizeAction(actor.authz, RESOURCE, 'manage');
        await setStatus(review, 'inSession', actor);
        // Every card starts where its two bands put it; the session moves it.
        const rows = await database
          .query()
          .selectFrom('talentPlacements')
          .select(['id', 'performanceBand', 'potentialBand', 'box'])
          .where('talentReviewId', '=', id)
          .execute();
        for (const row of rows) {
          const box = boxOf(num(row.performanceBand), num(row.potentialBand));
          if (box && !row.box)
            await database
              .query()
              .updateTable('talentPlacements')
              .set({ box, updatedAt: new Date() })
              .where('id', '=', str(row.id))
              .execute();
        }
        await ctx.closeWorkItems(`talentReview:${review.id}:potential:`);
        return service.detail(actor, id);
      }
      if (review.status === 'inSession') {
        await authorizeAction(actor.authz, RESOURCE, 'conclude');
        await setStatus(review, 'concluded', actor);
        return service.detail(actor, id);
      }
      throw new HrError('TALENT_REVIEW_CONCLUDED', 409);
    },

    async assessPotential(actor: ActorContext, placementId: string, input: unknown) {
      const row = await visiblePlacement(actor, 'assessPotential', placementId);
      const review = await reviewRow(str(row.talentReviewId));
      if (!['preparing', 'inSession'].includes(review.status))
        throw new HrError('TALENT_REVIEW_STAGE_CLOSED', 409);
      const parsed = potentialInput.safeParse(input);
      if (!parsed.success)
        throw new HrError('TALENT_POTENTIAL_INCOMPLETE', 400);
      const settings = await ctx.settings();
      const potentialBand = potentialBandOf(parsed.data.answers, settings);
      const decided = Boolean(row.decidedAt);
      const box = decided
        ? num(row.box)
        : review.status === 'inSession' && row.box
          ? num(row.box)
          : boxOf(num(row.performanceBand), potentialBand);
      const now = new Date();
      await database
        .query()
        .updateTable('talentPlacements')
        .set({
          potentialAnswers: parsed.data.answers,
          potentialBand,
          potentialAssessedBy: actor.userId,
          potentialAssessedAt: now,
          box: review.status === 'preparing' ? null : box,
          updatedAt: now,
        })
        .where('id', '=', placementId)
        .execute();
      hooks.onPotentialAssessed(placementId);
      return (await toViews([await placementRow(placementId)]))[0];
    },

    /** 绩效维度 by hand (no result, or an adjustment), with a reason. */
    async setPerformance(actor: ActorContext, placementId: string, input: unknown) {
      const row = await visiblePlacement(actor, 'place', placementId);
      const review = await reviewRow(str(row.talentReviewId));
      if (!['preparing', 'inSession'].includes(review.status))
        throw new HrError('TALENT_REVIEW_STAGE_CLOSED', 409);
      const parsed = performanceInput.safeParse(input);
      if (!parsed.success) throw new HrError('TALENT_REASON_REQUIRED', 400);
      await database
        .query()
        .updateTable('talentPlacements')
        .set({
          performanceBand: parsed.data.band,
          performanceSource: 'manual',
          performanceReason: parsed.data.reason,
          box:
            review.status === 'inSession'
              ? boxOf(parsed.data.band, num(row.potentialBand))
              : null,
          updatedAt: new Date(),
        })
        .where('id', '=', placementId)
        .execute();
      return (await toViews([await placementRow(placementId)]))[0];
    },

    /** 拖动卡片: a move needs a reason; the analyst's suggestion stays as it was. */
    async move(actor: ActorContext, placementId: string, input: unknown) {
      const row = await visiblePlacement(actor, 'place', placementId);
      const review = await reviewRow(str(row.talentReviewId));
      if (review.status !== 'inSession')
        throw new HrError('TALENT_REVIEW_NOT_IN_SESSION', 409);
      const parsed = moveInput.safeParse(input);
      if (!parsed.success) throw new HrError('TALENT_REASON_REQUIRED', 400);
      const from = num(row.box);
      if (from === parsed.data.box)
        throw new HrError('TALENT_BOX_UNCHANGED', 409);
      const bands = bandsOfBox(parsed.data.box);
      const moves = [
        ...json<unknown[]>(row.moves, []),
        {
          fromBox: from,
          toBox: parsed.data.box,
          reason: parsed.data.reason,
          by: actor.userId,
          at: new Date().toISOString(),
        },
      ];
      await database
        .query()
        .updateTable('talentPlacements')
        .set({
          box: parsed.data.box,
          performanceBand: bands.performanceBand,
          potentialBand: bands.potentialBand,
          moves,
          // A moved card is decided again.
          decidedBy: null,
          decidedAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', placementId)
        .execute();
      return (await toViews([await placementRow(placementId)]))[0];
    },

    async setActions(actor: ActorContext, placementId: string, input: unknown) {
      const row = await visiblePlacement(actor, 'place', placementId);
      const review = await reviewRow(str(row.talentReviewId));
      if (review.status !== 'inSession')
        throw new HrError('TALENT_REVIEW_NOT_IN_SESSION', 409);
      const parsed = actionsInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('talentPlacements')
        .set({
          developmentActions: parsed.data.actions,
          updatedAt: new Date(),
        })
        .where('id', '=', placementId)
        .execute();
      return (await toViews([await placementRow(placementId)]))[0];
    },

    /** 确认落位: needs a box and at least one development action; the learning coach drafts the plan. */
    async confirm(actor: ActorContext, placementId: string) {
      const row = await visiblePlacement(actor, 'place', placementId);
      const review = await reviewRow(str(row.talentReviewId));
      if (review.status !== 'inSession')
        throw new HrError('TALENT_REVIEW_NOT_IN_SESSION', 409);
      if (!row.box) throw new HrError('TALENT_BOX_REQUIRED', 409);
      if (!json<unknown[]>(row.developmentActions, []).length)
        throw new HrError('TALENT_ACTIONS_REQUIRED', 409);
      await database
        .query()
        .updateTable('talentPlacements')
        .set({ decidedBy: actor.userId, decidedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', placementId)
        .execute();
      hooks.onPlacementConfirmed(placementId);
      return (await toViews([await placementRow(placementId)]))[0];
    },

    reviewRow,
    placementRow,
    toViews,
  };
  return service;
}

export type ReviewService = ReturnType<typeof createReviewService>;

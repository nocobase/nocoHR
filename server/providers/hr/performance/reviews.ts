/**
 * V4-12 评价: self, peer, manager and skip-level review tasks.
 *
 * - A task is written only by its reviewer (`reviewerUserId`), through
 *   talent.review within the caller's scope; nobody reviews themselves as
 *   manager or peer.
 * - The review page (getReviewContext): the person's goals, and — for the
 *   manager and the skip-level reviewer — the evidence snapshot and summary,
 *   the self review, the anonymous peer summary and the position's
 *   requirements; the employee sees their own snapshot on the self review;
 *   peers see the goals only. The assistant's draft (`aiDraft`) is returned
 *   only to the task's reviewer and never enters `items` on its own: the page
 *   copies it into the form when the reviewer clicks 采用到评价表.
 * - Submitting (manager): the overall rating is required; a quality-and-safety
 *   score more than `overrideReasonDelta` (1) from the reference, or an
 *   overall rating `ratingReasonGap` (2) grades or more from the reference
 *   band, needs a reason. The reference score is computed, the draft adoption
 *   is measured by text similarity, and the assistant's deviation check runs
 *   once per submission — it never blocks. A task may be edited and
 *   resubmitted until the stage deadline.
 * - 互评匿名: the person and other peers never see who wrote a peer review;
 *   heads see contents without names; hr.admin sees names.
 * - Peers are nominated by the employee (not their manager, not themselves),
 *   2 to the scheme's count, and confirmed (or changed) by the manager.
 */
import { z } from 'zod';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, str } from '../shared.js';
import {
  adoptionOf,
  bandOf,
  bandRange,
  computeScore,
  dimensionScores,
  gradeGap,
  itemsSchema,
  scoreOf,
  type ReviewItems,
  type SchemeView,
} from './common.js';
import {
  toReview,
  type CycleView,
  type PerformanceContext,
  type ResultRow,
  type ReviewRow,
} from './context.js';

const REVIEW = 'talent.review';
const STAGE_OF_ROLE: Record<ReviewRow['role'], string> = {
  self: 'selfReview',
  peer: 'peerReview',
  manager: 'managerReview',
  skipLevel: 'managerReview',
};

const saveInput = z
  .object({
    items: itemsSchema.optional(),
    overallRating: z.string().trim().max(8).nullish(),
    overallReason: z.string().trim().max(2000).nullish(),
    comment: z.string().trim().max(8000).nullish(),
  })
  .strict();
const peersInput = z
  .object({ userIds: z.array(z.string().min(1).max(64)).min(2).max(5) })
  .strict();

export function createReviewService(
  ctx: PerformanceContext,
  hooks: { onManagerSubmitted: (reviewId: string, submission: number) => void },
) {
  const { database, platform } = ctx;

  /** The task, when the caller is its reviewer and it lies within their talent.review scope. */
  async function ownTask(
    actor: ActorContext,
    reviewId: string,
    action: 'view' | 'write' | 'submit',
  ): Promise<ReviewRow> {
    const policies = await authorizeAction(actor.authz, REVIEW, action);
    const row = (await database
      .repository('reviews')
      .withPolicy(policyOf(policies, 'reviews'))
      .findOne({ filter: { id: reviewId } })) as
      Record<string, unknown> | undefined;
    if (!row) throw new HrError('REVIEW_NOT_FOUND', 404);
    const review = toReview(row);
    if (review.reviewerUserId !== actor.userId)
      throw new HrError('REVIEW_NOT_FOUND', 404);
    if (review.status === 'cancelled')
      throw new HrError('REVIEW_CANCELLED', 409);
    return review;
  }

  async function requirementsFor(
    employeeId: string,
    positionId: string | null,
  ) {
    if (!positionId) return [];
    const rows = await database
      .query()
      .selectFrom('positionRequirements')
      .innerJoin(
        'competencies',
        'competencies.id',
        'positionRequirements.competencyId',
      )
      .select([
        'positionRequirements.competencyId as competencyId',
        'positionRequirements.requiredLevel as requiredLevel',
        'positionRequirements.mandatory as mandatory',
        'competencies.title as title',
        'competencies.maxLevel as maxLevel',
        'competencies.category as category',
      ])
      .where('positionRequirements.positionId', '=', positionId)
      .where('positionRequirements.reviewStatus', '=', 'confirmed')
      .execute();
    const levels = await currentLevels(employeeId);
    return rows
      .filter((r) => str(r.category) !== 'qualification')
      .map((r) => ({
        competencyId: str(r.competencyId),
        title: str(r.title),
        requiredLevel: Number(r.requiredLevel),
        maxLevel: Number(r.maxLevel ?? 5),
        mandatory: r.mandatory === true || r.mandatory === 1,
        currentLevel: levels.get(str(r.competencyId)) ?? null,
      }));
  }

  async function currentLevels(
    employeeId: string,
  ): Promise<Map<string, number>> {
    const rows = await database
      .query()
      .selectFrom('employeeCompetencies')
      .select(['competencyId', 'level', 'assessedAt', 'createdAt'])
      .where('employeeId', '=', employeeId)
      .execute();
    const sorted = [...rows].sort(
      (a, b) =>
        new Date(str(a.assessedAt)).getTime() -
          new Date(str(b.assessedAt)).getTime() ||
        new Date(str(a.createdAt)).getTime() -
          new Date(str(b.createdAt)).getTime(),
    );
    const map = new Map<string, number>();
    for (const row of sorted) map.set(str(row.competencyId), Number(row.level));
    return map;
  }

  /** The anonymous peer summary: ratings and comments without names (sorted by content). */
  function peerSummary(
    reviews: readonly ReviewRow[],
    scheme: SchemeView,
    withIdentity: boolean,
  ) {
    const submitted = reviews.filter(
      (r) => r.role === 'peer' && r.status === 'submitted',
    );
    const scores = submitted
      .map((r) => scoreOf(r.overallRating, scheme.ratingScale))
      .filter((s): s is number => s !== null);
    const entries = submitted
      .map((r) => ({
        ...(withIdentity ? { reviewerUserId: r.reviewerUserId } : {}),
        rating: r.overallRating,
        comment: r.comment ?? '',
      }))
      .sort((a, b) =>
        `${a.rating ?? ''}${a.comment}`.localeCompare(
          `${b.rating ?? ''}${b.comment}`,
        ),
      );
    return {
      count: submitted.length,
      averageScore: scores.length
        ? Math.round(
            (scores.reduce((a, b) => a + b, 0) / scores.length) * 100,
          ) / 100
        : null,
      entries,
    };
  }

  /** The reference score and band a manager's items give (the page's live preview uses it too). */
  async function scoreFor(
    result: ResultRow,
    scheme: SchemeView,
    items: ReviewItems,
    reviews: readonly ReviewRow[],
  ) {
    const goals = (await ctx.goalsOf(result.cycleId)).filter(
      (g) => g.employeeId === result.employeeId && g.status === 'approved',
    );
    const employee = await platform.employee(result.employeeId);
    const requirements = await requirementsFor(
      result.employeeId,
      employee?.positionId ?? result.positionId,
    );
    const peerScores = reviews
      .filter((r) => r.role === 'peer' && r.status === 'submitted')
      .map((r) => scoreOf(r.overallRating, scheme.ratingScale))
      .filter((s): s is number => s !== null);
    const reference = result.evidenceSnapshot?.qualitySafety.score ?? null;
    const dimensions = dimensionScores({
      items,
      goalWeights: new Map(goals.map((g) => [g.id, g.weight])),
      requirements: new Map(
        requirements.map((r) => [r.competencyId, r.requiredLevel]),
      ),
      qualityReference: reference,
      peerScores,
      scoring: scheme.scoring,
    });
    const score = computeScore(scheme, dimensions);
    const band = bandOf(score, scheme.ratingScale);
    return {
      dimensions,
      computedScore: score,
      band,
      bandRange: band ? bandRange(band, scheme.ratingScale) : null,
      qualityReference: reference,
    };
  }

  function stageOpen(
    cycle: CycleView,
    role: ReviewRow['role'],
    today: string,
  ): boolean {
    if (cycle.status !== STAGE_OF_ROLE[role]) return false;
    const deadline = cycle.stageDeadlines[STAGE_OF_ROLE[role]];
    return !deadline || today <= deadline;
  }

  async function write(
    actor: ActorContext,
    reviewId: string,
    input: unknown,
    submit: boolean,
  ) {
    const review = await ownTask(actor, reviewId, submit ? 'submit' : 'write');
    const cycle = await ctx.cycle(review.cycleId);
    if (!stageOpen(cycle, review.role, ctx.today()))
      throw new HrError('REVIEW_STAGE_CLOSED', 409);
    const result = await ctx.result(review.resultId);
    if (result.status === 'closed') throw new HrError('REVIEW_CANCELLED', 409);
    const parsed = saveInput.safeParse(input ?? {});
    if (!parsed.success)
      throw new HrError('INVALID_INPUT', 400, {
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      });
    const data = parsed.data;
    const scheme = await ctx.scheme(result.schemeId);
    const items: ReviewItems = data.items ?? review.items ?? {};
    const rating = data.overallRating ?? null;
    if (rating && !scheme.ratingScale.some((r) => r.code === rating))
      throw new HrError('REVIEW_RATING_INVALID', 400);
    const now = new Date();
    const values: Record<string, unknown> = {
      items,
      overallRating: rating,
      overallReason: data.overallReason ?? null,
      comment: data.comment ?? null,
      status: submit ? 'submitted' : 'draft',
      updatedAt: now,
    };
    let score: Awaited<ReturnType<typeof scoreFor>> | null = null;
    if (submit) {
      const settings = await ctx.settings();
      if ((review.role === 'manager' || review.role === 'skipLevel') && !rating)
        throw new HrError('REVIEW_RATING_REQUIRED', 400);
      if (review.role === 'manager') {
        const reviews = await ctx.reviewsOf(review.cycleId);
        score = await scoreFor(
          result,
          scheme,
          items,
          reviews.filter((r) => r.resultId === result.id),
        );
        const reference = score.qualityReference;
        const qs = items.qualitySafety?.score;
        if (
          typeof qs === 'number' &&
          reference !== null &&
          Math.abs(qs - reference) > scheme.scoring.overrideReasonDelta &&
          !items.qualitySafety?.reason?.trim()
        )
          throw new HrError('REVIEW_QUALITY_REASON_REQUIRED', 400, {
            reference: String(reference),
          });
        if (
          score.band &&
          gradeGap(rating, score.band, scheme.ratingScale) >=
            scheme.scoring.ratingReasonGap &&
          !data.overallReason?.trim()
        )
          throw new HrError('REVIEW_RATING_REASON_REQUIRED', 400, {
            band: score.band,
          });
      }
      values.submittedAt = now;
      values.submissionCount = review.submissionCount + 1;
      values.aiDraftAdoption = adoptionOf(
        review.aiDraft?.comment,
        data.comment,
        {
          asIs: settings.adoptedAsIsSimilarity,
          edited: settings.editedSimilarity,
        },
      );
    }
    await database.transaction(async (connection) => {
      await connection.query
        .updateTable('reviews')
        .set(values)
        .where('id', '=', review.id)
        .execute();
      if (submit && review.role === 'manager' && score)
        await connection.query
          .updateTable('reviewResults')
          .set({
            managerRating: rating,
            computedScore: score.computedScore,
            updatedAt: now,
          })
          .where('id', '=', result.id)
          .execute();
    });
    if (submit) {
      // This task's own to-dos only (the notice keys of cycles.ts and assistant.ts).
      if (review.role === 'self')
        await ctx.closeWorkItems(
          `perf:${review.cycleId}:selfReview:${review.employeeId}`,
        );
      else if (review.role === 'peer')
        await ctx.closeWorkItems(
          `perf:${review.cycleId}:peerReview:${review.resultId}:${review.reviewerUserId}`,
        );
      else await ctx.closeWorkItems(`perf:hints:${review.id}:`);
      if (review.role === 'manager')
        hooks.onManagerSubmitted(review.id, review.submissionCount + 1);
    }
    return service.context(actor, review.id);
  }

  const service = {
    scoreFor,
    peerSummary,
    requirementsFor,
    currentLevels,
    ownTask,

    /** 我的考核 · 评价任务: the caller's own tasks (self and peer), never someone else's. */
    async myTasks(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, REVIEW, 'view');
      const rows = (
        (await database
          .repository('reviews')
          .withPolicy(policyOf(policies, 'reviews'))
          .findMany({ filter: { reviewerUserId: actor.userId } })) as Record<
          string,
          unknown
        >[]
      )
        .map(toReview)
        .filter(
          (r) =>
            r.status !== 'cancelled' &&
            (r.role === 'self' || r.role === 'peer'),
        );
      const employees = await ctx.employees();
      const cycles = new Map<string, CycleView>();
      const out = [];
      for (const r of rows) {
        if (!cycles.has(r.cycleId))
          cycles.set(r.cycleId, await ctx.cycle(r.cycleId));
        const cycle = cycles.get(r.cycleId)!;
        out.push({
          reviewId: r.id,
          cycleId: r.cycleId,
          cycleTitle: cycle.title,
          role: r.role,
          employeeId: r.employeeId,
          employeeName: employees.get(r.employeeId)?.name ?? '',
          status: r.status,
          deadline: cycle.stageDeadlines[STAGE_OF_ROLE[r.role]] ?? null,
          editable: stageOpen(cycle, r.role, ctx.today()),
        });
      }
      return out;
    },

    /** getReviewContext: the review page of the caller's own task. */
    async context(actor: ActorContext, reviewId: string) {
      const review = await ownTask(actor, reviewId, 'view');
      const result = await ctx.result(review.resultId);
      const cycle = await ctx.cycle(review.cycleId);
      const scheme = await ctx.scheme(result.schemeId);
      const employee = await platform.employee(result.employeeId);
      const all = (await ctx.reviewsOf(review.cycleId)).filter(
        (r) => r.resultId === result.id,
      );
      const goals = (await ctx.goalsOf(review.cycleId)).filter(
        (g) =>
          g.employeeId === result.employeeId &&
          (g.status === 'approved' || g.status === 'submitted'),
      );
      const aligned = new Map(
        (await ctx.goalsOf(review.cycleId))
          .filter((g) => !g.employeeId)
          .map((g) => [g.id, g.title]),
      );
      const senior = review.role === 'manager' || review.role === 'skipLevel';
      const self = review.role === 'self';
      const selfReview = all.find(
        (r) => r.role === 'self' && r.status === 'submitted',
      );
      const titles = await ctx.departmentTitles();
      const score =
        senior && review.role === 'manager'
          ? await scoreFor(result, scheme, review.items, all)
          : null;
      return {
        review: {
          id: review.id,
          role: review.role,
          status: review.status,
          items: review.items,
          overallRating: review.overallRating,
          overallReason: review.overallReason,
          comment: review.comment,
          // Only the reviewer of this task gets here; the draft never fills the form by itself.
          aiDraft: senior ? review.aiDraft : null,
          hints: review.hints,
          submissionCount: review.submissionCount,
          submittedAt: review.submittedAt,
          activeSeconds: review.activeSeconds,
          editable: stageOpen(cycle, review.role, ctx.today()),
        },
        cycle: {
          id: cycle.id,
          title: cycle.title,
          status: cycle.status,
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          deadline: cycle.stageDeadlines[STAGE_OF_ROLE[review.role]] ?? null,
        },
        employee: {
          id: result.employeeId,
          name: employee?.name ?? '',
          departmentTitle: titles.get(result.departmentId ?? '') ?? '',
        },
        scheme: {
          id: scheme.id,
          title: scheme.title,
          sections: scheme.sections,
          ratingScale: scheme.ratingScale,
          scoring: scheme.scoring,
        },
        goals: goals.map((g) => ({
          ...g,
          alignedTitle: g.alignedGoalId
            ? (aligned.get(g.alignedGoalId) ?? null)
            : null,
        })),
        // 过程数据快照: the person on their self review, the manager and the skip-level reviewer; not peers.
        evidence:
          senior || self
            ? {
                snapshot: result.evidenceSnapshot,
                summary: result.evidenceSummary,
              }
            : null,
        requirements:
          senior || self
            ? await requirementsFor(
                result.employeeId,
                employee?.positionId ?? result.positionId,
              )
            : [],
        selfReview:
          senior && selfReview
            ? {
                items: selfReview.items,
                comment: selfReview.comment,
                submittedAt: selfReview.submittedAt,
              }
            : null,
        peers: senior ? peerSummary(all, scheme, false) : null,
        reference: score,
      };
    },

    /** The live reference score of unsaved items (manager page). */
    async preview(actor: ActorContext, reviewId: string, input: unknown) {
      const review = await ownTask(actor, reviewId, 'view');
      if (review.role !== 'manager') throw new HrError('REVIEW_NOT_FOUND', 404);
      const parsed = itemsSchema.safeParse(
        input && typeof input === 'object'
          ? ((input as { items?: unknown }).items ?? {})
          : {},
      );
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const result = await ctx.result(review.resultId);
      const scheme = await ctx.scheme(result.schemeId);
      const all = (await ctx.reviewsOf(review.cycleId)).filter(
        (r) => r.resultId === result.id,
      );
      return scoreFor(result, scheme, parsed.data, all);
    },

    save: (actor: ActorContext, reviewId: string, input: unknown) =>
      write(actor, reviewId, input, false),
    submit: (actor: ActorContext, reviewId: string, input: unknown) =>
      write(actor, reviewId, input, true),

    /** 有效编辑时长: the page reports active seconds while the reviewer edits (at most 120 per call). */
    async activity(actor: ActorContext, reviewId: string, input: unknown) {
      const review = await ownTask(actor, reviewId, 'write');
      const seconds =
        input && typeof input === 'object'
          ? Number((input as { seconds?: unknown }).seconds)
          : NaN;
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120)
        throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('reviews')
        .set({
          activeSeconds: review.activeSeconds + seconds,
          updatedAt: new Date(),
        })
        .where('id', '=', review.id)
        .execute();
      return { activeSeconds: review.activeSeconds + seconds };
    },

    /** 团队考核: the people the caller reviews as manager or skip-level reviewer in a cycle. */
    async team(actor: ActorContext, cycleId: string) {
      const policies = await authorizeAction(actor.authz, REVIEW, 'view');
      const cycle = await ctx.cycle(cycleId);
      const visible = (
        (await database
          .repository('reviewResults')
          .withPolicy(policyOf(policies, 'reviewResults'))
          .findMany({ filter: { cycleId } })) as Record<string, unknown>[]
      ).map((row) => str(row.id));
      const results = (await ctx.resultsOf(cycleId)).filter(
        (r) =>
          visible.includes(r.id) &&
          (r.managerUserId === actor.userId ||
            r.skipLevelUserId === actor.userId),
      );
      const reviews = await ctx.reviewsOf(cycleId);
      const goals = await ctx.goalsOf(cycleId);
      const employees = await ctx.employees();
      const titles = await ctx.departmentTitles();
      return {
        cycle: {
          id: cycle.id,
          title: cycle.title,
          status: cycle.status,
          stageDeadlines: cycle.stageDeadlines,
        },
        members: results.map((r) => {
          const own = goals.filter(
            (g) => g.employeeId === r.employeeId && g.status !== 'cancelled',
          );
          const mine = reviews.find(
            (v) =>
              v.resultId === r.id &&
              v.reviewerUserId === actor.userId &&
              (v.role === 'manager' || v.role === 'skipLevel'),
          );
          const self = reviews.find(
            (v) => v.resultId === r.id && v.role === 'self',
          );
          return {
            resultId: r.id,
            employeeId: r.employeeId,
            name: employees.get(r.employeeId)?.name ?? '',
            departmentTitle: titles.get(r.departmentId ?? '') ?? '',
            role: r.managerUserId === actor.userId ? 'manager' : 'skipLevel',
            goalStatus: own.length
              ? own.every((g) => g.status === 'approved')
                ? 'approved'
                : own.some((g) => g.status === 'submitted')
                  ? 'submitted'
                  : 'draft'
              : 'none',
            submittedGoals: own
              .filter((g) => g.status === 'submitted')
              .map((g) => g.id),
            selfStatus: r.noAccount ? 'noAccount' : (self?.status ?? 'none'),
            myReviewId: mine?.id ?? null,
            myReviewStatus: mine?.status ?? 'none',
            computedScore: r.computedScore,
            myRating: mine?.overallRating ?? null,
            peerStatus: r.peerStatus,
            peerUserIds: r.managerUserId === actor.userId ? r.peerUserIds : [],
            resultStatus: r.status,
          };
        }),
      };
    },

    /** 互评人提名 (employee): 2 up to the scheme's count, never oneself or one's manager. */
    async nominatePeers(actor: ActorContext, cycleId: string, input: unknown) {
      await authorizeAction(actor.authz, REVIEW, 'write');
      const parsed = peersInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const employee = await platform.employeeOfUser(actor.userId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const result = (await ctx.resultsOf(cycleId)).find(
        (r) => r.employeeId === employee.id && r.status !== 'closed',
      );
      if (!result) throw new HrError('REVIEW_NOT_PARTICIPANT', 404);
      return setPeers(result, parsed.data.userIds, 'nominated', actor.userId);
    },

    /** Colleagues one may nominate as peers: people with an account in the cycle's scope, not oneself or one's manager. */
    async peerCandidates(actor: ActorContext, cycleId: string) {
      await authorizeAction(actor.authz, REVIEW, 'write');
      const employee = await platform.employeeOfUser(actor.userId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const result = (await ctx.resultsOf(cycleId)).find(
        (r) => r.employeeId === employee.id && r.status !== 'closed',
      );
      if (!result) throw new HrError('REVIEW_NOT_PARTICIPANT', 404);
      const cycle = await ctx.cycle(cycleId);
      const departments = new Set<string>();
      for (const id of cycle.scope.departmentIds)
        for (const d of await platform.organization.descendantsOf(id))
          departments.add(d);
      const titles = await ctx.departmentTitles();
      return [...(await ctx.employees()).values()]
        .filter(
          (e) =>
            e.userId &&
            e.status !== 'leave' &&
            e.id !== employee.id &&
            e.userId !== result.managerUserId &&
            departments.has(e.departmentId),
        )
        .map((e) => ({
          userId: e.userId!,
          name: e.name,
          departmentTitle: titles.get(e.departmentId) ?? '',
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    /** 主管确认互评人: the manager reviewer (or HR) confirms or changes the list. */
    async confirmPeers(actor: ActorContext, resultId: string, input: unknown) {
      await authorizeAction(actor.authz, REVIEW, 'write');
      const policies = await authorizeAction(actor.authz, REVIEW, 'view');
      const result = await ctx.result(resultId);
      const admin = await tryAuthorizeAction(
        actor.authz,
        'talent.reviewCycle',
        'manage',
      );
      const visible = await database
        .repository('reviewResults')
        .withPolicy(policyOf(policies, 'reviewResults'))
        .findOne({ filter: { id: resultId } });
      if (!admin && (!visible || result.managerUserId !== actor.userId))
        throw new HrError('REVIEW_RESULT_NOT_FOUND', 404);
      const parsed = peersInput.safeParse(
        input && typeof input === 'object' && 'userIds' in input
          ? input
          : { userIds: result.peerUserIds },
      );
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      return setPeers(result, parsed.data.userIds, 'confirmed', actor.userId);
    },

    /** Every review of a result, for HR (with peer identities) — the audit view of 互评. */
    async resultReviews(actor: ActorContext, resultId: string) {
      const policies = await authorizeAction(actor.authz, REVIEW, 'view');
      const admin = await tryAuthorizeAction(
        actor.authz,
        'talent.reviewCycle',
        'manage',
      );
      const result = await ctx.result(resultId);
      const visible = await database
        .repository('reviewResults')
        .withPolicy(policyOf(policies, 'reviewResults'))
        .findOne({ filter: { id: resultId } });
      // Nobody reads the reviews written about them here (their own results page shows the published part).
      const own = await platform.employeeOfUser(actor.userId);
      if (!visible || (!admin && own?.id === result.employeeId))
        throw new HrError('REVIEW_RESULT_NOT_FOUND', 404);
      const scheme = await ctx.scheme(result.schemeId);
      const reviews = (await ctx.reviewsOf(result.cycleId)).filter(
        (r) => r.resultId === resultId && r.status !== 'cancelled',
      );
      const named = [];
      for (const r of reviews.filter((r) => r.role !== 'peer'))
        named.push({
          reviewId: r.id,
          role: r.role,
          reviewerName: await ctx.userName(r.reviewerUserId),
          status: r.status,
          overallRating: r.overallRating,
          comment: r.comment,
          items: r.items,
        });
      const peers = peerSummary(reviews, scheme, Boolean(admin));
      return {
        reviews: named,
        peers: {
          ...peers,
          entries: await Promise.all(
            peers.entries.map(async (entry) =>
              'reviewerUserId' in entry
                ? {
                    ...entry,
                    reviewerName: await ctx.userName(
                      entry.reviewerUserId as string,
                    ),
                  }
                : entry,
            ),
          ),
        },
      };
    },
  };

  async function setPeers(
    result: ResultRow,
    userIds: readonly string[],
    status: 'nominated' | 'confirmed',
    by: string,
  ) {
    const scheme = await ctx.scheme(result.schemeId);
    if (!scheme.stages.peerReview.enabled)
      throw new HrError('REVIEW_PEERS_NOT_ENABLED', 409);
    const cycle = await ctx.cycle(result.cycleId);
    if (!['goalSetting', 'selfReview', 'draft'].includes(cycle.status))
      throw new HrError('REVIEW_STAGE_CLOSED', 409);
    const unique = [...new Set(userIds)];
    if (unique.length < 2 || unique.length > scheme.stages.peerReview.count)
      throw new HrError('REVIEW_PEERS_COUNT', 400, {
        max: String(scheme.stages.peerReview.count),
      });
    const employee = await platform.employee(result.employeeId);
    if (unique.includes(employee?.userId ?? ''))
      throw new HrError('REVIEW_PEERS_SELF', 400);
    if (unique.includes(result.managerUserId))
      throw new HrError('REVIEW_PEERS_MANAGER', 400);
    for (const userId of unique) {
      const person = await platform.employeeOfUser(userId);
      if (!person || person.status === 'leave')
        throw new HrError('REVIEW_PEERS_INVALID', 400);
    }
    await database
      .query()
      .updateTable('reviewResults')
      .set({ peerUserIds: unique, peerStatus: status, updatedAt: new Date() })
      .where('id', '=', result.id)
      .execute();
    if (status === 'nominated')
      await platform.notify({
        key: `perf:${result.cycleId}:peersNominated:${result.id}:${Date.now()}`,
        userIds: [result.managerUserId],
        message: 'performancePeersNominated',
        params: { cycle: cycle.title, name: employee?.name ?? '' },
        path: `/talent/team-reviews?cycle=${encodeURIComponent(result.cycleId)}`,
      });
    void by;
    return { resultId: result.id, peerUserIds: unique, peerStatus: status };
  }

  return service;
}

export type ReviewService = ReturnType<typeof createReviewService>;

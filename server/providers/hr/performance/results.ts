/**
 * V4-12 校准、发布、确认与申诉、结果应用.
 *
 * - 校准 (talent.calibration.view): the distribution of current ratings
 *   (calibrated, else the manager's) per department and scheme against the
 *   scheme's guide (a hint, never enforced), and the list with the reference
 *   score, the manager's rating and the assistant's anomalies. Heads read
 *   their own scope only; only hr.admin adjusts (a reason is required, every
 *   adjustment is kept) and publishes.
 * - 发布: every open result gets `finalRating` (= calibrated, else the
 *   manager's) and becomes visible to the employee; in the same transaction,
 *   a manager's competency level that differs from the employee's current
 *   level is written as a new assessment by the manager (source = review,
 *   evidence naming the review). After the commit, employees are told (no
 *   rating in any notice or office-suite push), and a C or D result starts the
 *   learning coach's plan (trigger = reviewResult) for the manager and tells
 *   the cycle's HR owner. Publishing changes no pay.
 * - 员工: sees the final rating, the manager's comment and the anonymous peer
 *   summary of published results; acknowledges, or appeals within
 *   `appealDays` (7). hr.admin handles an appeal (upheld or changed, with a
 *   note); 7 days after publication an unacknowledged, unappealed result is
 *   acknowledged by the daily task.
 * - 离职: an offboard job event closes the employee's unpublished results
 *   (closedReason = offboarded) and cancels their open review tasks.
 */
import { z } from 'zod';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import type { JobEvent } from '../job-events.js';
import { addDays, HrError, newId } from '../shared.js';
import { bandOf, type SchemeView } from './common.js';
import {
  toResult,
  type CycleView,
  type PerformanceContext,
  type ResultRow,
} from './context.js';
import type { AnomalyService } from './anomalies.js';
import type { ReviewService } from './reviews.js';

const CALIBRATION = 'talent.calibration';
const APPEAL = 'talent.reviewAppeal';
const VISIBLE = ['published', 'acknowledged', 'appealed'];

const adjustInput = z
  .object({
    rating: z.string().trim().min(1).max(8),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
const appealInput = z
  .object({ reason: z.string().trim().min(1).max(2000) })
  .strict();
const handleInput = z
  .object({
    result: z.enum(['upheld', 'changed']),
    note: z.string().trim().min(1).max(2000),
    rating: z.string().trim().max(8).nullish(),
  })
  .strict();

export function createResultService(
  ctx: PerformanceContext,
  deps: {
    reviews: ReviewService;
    anomalies: AnomalyService;
    onPublished: (cycleId: string, lowResultIds: string[]) => void;
  },
) {
  const { database, platform } = ctx;

  async function scopedResults(
    actor: ActorContext,
    cycleId: string,
    action: 'view' | 'adjust' | 'publish',
  ): Promise<ResultRow[]> {
    const policies = await authorizeAction(actor.authz, CALIBRATION, action);
    return (
      (await database
        .repository('reviewResults')
        .withPolicy(policyOf(policies, 'reviewResults'))
        .findMany({ filter: { cycleId } })) as Record<string, unknown>[]
    ).map(toResult);
  }

  function distribution(results: readonly ResultRow[], scheme: SchemeView) {
    const rated = results.filter((r) => r.calibratedRating ?? r.managerRating);
    const counts: Record<string, number> = {};
    for (const rating of scheme.ratingScale) counts[rating.code] = 0;
    for (const r of rated) {
      const code = (r.calibratedRating ?? r.managerRating)!;
      counts[code] = (counts[code] ?? 0) + 1;
    }
    const total = rated.length;
    const percent = (n: number) =>
      total ? Math.round((n / total) * 1000) / 10 : 0;
    const guide = Object.entries(scheme.distributionGuide).map(
      ([key, rule]) => {
        const value = percent(
          key.split('+').reduce((sum, code) => sum + (counts[code] ?? 0), 0),
        );
        const outside =
          (rule.max !== undefined && value > rule.max) ||
          (rule.min !== undefined && value < rule.min);
        return {
          key,
          max: rule.max ?? null,
          min: rule.min ?? null,
          actual: value,
          outside,
        };
      },
    );
    return {
      total,
      counts: Object.entries(counts).map(([code, count]) => ({
        code,
        count,
        percent: percent(count),
      })),
      guide,
    };
  }

  async function applyOnPublish(
    cycle: CycleView,
    results: readonly ResultRow[],
  ) {
    // Competency write-back rows, computed before the transaction.
    const reviews = await ctx.reviewsOf(cycle.id);
    const assessments: Record<string, unknown>[] = [];
    const now = new Date();
    for (const result of results) {
      const review = reviews.find(
        (r) =>
          r.resultId === result.id &&
          r.role === 'manager' &&
          r.status === 'submitted',
      );
      if (!review) continue;
      const levels = await deps.reviews.currentLevels(result.employeeId);
      for (const item of review.items.competencies ?? []) {
        if (typeof item.level !== 'number' || item.level < 1) continue;
        if (levels.get(item.competencyId) === item.level) continue;
        assessments.push({
          id: newId(),
          employeeId: result.employeeId,
          competencyId: item.competencyId,
          level: item.level,
          source: 'review',
          evidence: JSON.stringify({
            type: 'review',
            reviewId: review.id,
            cycleId: cycle.id,
            cycleTitle: cycle.title,
          }),
          assessedBy: review.reviewerUserId,
          assessedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return assessments;
  }

  const service = {
    distribution,

    /** 校准页: distribution against the guide per department and scheme, the list and the anomalies. */
    async calibration(
      actor: ActorContext,
      cycleId: string,
      query: { departmentId?: string; schemeId?: string },
    ) {
      const cycle = await ctx.cycle(cycleId);
      let results = (await scopedResults(actor, cycleId, 'view')).filter(
        (r) => r.status !== 'closed',
      );
      if (query.departmentId) {
        const within = new Set(
          await platform.organization.descendantsOf(query.departmentId),
        );
        results = results.filter((r) => within.has(r.departmentId ?? ''));
      }
      if (query.schemeId)
        results = results.filter((r) => r.schemeId === query.schemeId);
      const schemes = new Map((await ctx.schemes()).map((s) => [s.id, s]));
      const employees = await ctx.employees();
      const titles = await ctx.departmentTitles();
      const anomalies = await deps.anomalies(cycleId, {
        resultIds: new Set(results.map((r) => r.id)),
      });
      const groups: {
        schemeId: string;
        schemeTitle: string;
        departmentId: string | null;
        departmentTitle: string;
        distribution: ReturnType<typeof distribution>;
      }[] = [];
      for (const scheme of schemes.values()) {
        const own = results.filter((r) => r.schemeId === scheme.id);
        if (!own.length) continue;
        groups.push({
          schemeId: scheme.id,
          schemeTitle: scheme.title,
          departmentId: null,
          departmentTitle: '',
          distribution: distribution(own, scheme),
        });
        for (const departmentId of [
          ...new Set(own.map((r) => r.departmentId ?? '')),
        ])
          groups.push({
            schemeId: scheme.id,
            schemeTitle: scheme.title,
            departmentId,
            departmentTitle: titles.get(departmentId) ?? '',
            distribution: distribution(
              own.filter((r) => (r.departmentId ?? '') === departmentId),
              scheme,
            ),
          });
      }
      const canAdjust =
        Boolean(await tryAuthorizeAction(actor.authz, CALIBRATION, 'adjust')) &&
        cycle.status === 'calibration';
      return {
        cycle: {
          id: cycle.id,
          title: cycle.title,
          status: cycle.status,
          calibrationPack: cycle.calibrationPack,
        },
        groups,
        results: results.map((r) => {
          const scheme = schemes.get(r.schemeId);
          return {
            resultId: r.id,
            employeeId: r.employeeId,
            name: employees.get(r.employeeId)?.name ?? '',
            departmentTitle: titles.get(r.departmentId ?? '') ?? '',
            schemeId: r.schemeId,
            schemeTitle: scheme?.title ?? '',
            ratingScale: scheme?.ratingScale.map((s) => s.code) ?? [],
            computedScore: r.computedScore,
            referenceBand: scheme
              ? bandOf(r.computedScore, scheme.ratingScale)
              : null,
            managerRating: r.managerRating,
            calibratedRating: r.calibratedRating,
            currentRating: r.calibratedRating ?? r.managerRating,
            adjustments: r.adjustments,
            status: r.status,
            anomalies:
              anomalies.find((a) => a.resultId === r.id)?.anomalies ?? [],
          };
        }),
        can: {
          adjust: canAdjust,
          publish:
            Boolean(
              await tryAuthorizeAction(actor.authz, CALIBRATION, 'publish'),
            ) &&
            (cycle.status === 'calibration' ||
              cycle.status === 'managerReview'),
        },
      };
    },

    /** 校准调整: hr.admin, during calibration, with a reason; kept in `adjustments`. */
    async adjust(actor: ActorContext, resultId: string, input: unknown) {
      const policies = await authorizeAction(
        actor.authz,
        CALIBRATION,
        'adjust',
      );
      const parsed = adjustInput.safeParse(input);
      if (!parsed.success)
        throw new HrError('CALIBRATION_REASON_REQUIRED', 400);
      const visible = await database
        .repository('reviewResults')
        .withPolicy(policyOf(policies, 'reviewResults'))
        .findOne({ filter: { id: resultId } });
      if (!visible) throw new HrError('REVIEW_RESULT_NOT_FOUND', 404);
      const result = await ctx.result(resultId);
      const cycle = await ctx.cycle(result.cycleId);
      if (cycle.status !== 'calibration')
        throw new HrError('REVIEW_STAGE_CLOSED', 409);
      const scheme = await ctx.scheme(result.schemeId);
      if (!scheme.ratingScale.some((r) => r.code === parsed.data.rating))
        throw new HrError('REVIEW_RATING_INVALID', 400);
      const from = result.calibratedRating ?? result.managerRating;
      if (from === parsed.data.rating)
        throw new HrError('CALIBRATION_UNCHANGED', 409);
      await database
        .query()
        .updateTable('reviewResults')
        .set({
          calibratedRating: parsed.data.rating,
          adjustments: [
            ...result.adjustments,
            {
              from,
              to: parsed.data.rating,
              reason: parsed.data.reason,
              by: actor.userId,
              at: new Date().toISOString(),
            },
          ],
          status: 'calibrated',
          updatedAt: new Date(),
        })
        .where('id', '=', resultId)
        .execute();
      return toResult(
        (await database
          .query()
          .selectFrom('reviewResults')
          .selectAll()
          .where('id', '=', resultId)
          .executeTakeFirst()) as Record<string, unknown>,
      );
    },

    /** 发布 (hr.admin). */
    async publish(actor: ActorContext, cycleId: string) {
      const policies = await authorizeAction(
        actor.authz,
        CALIBRATION,
        'publish',
      );
      const cycle = await ctx.cycle(cycleId);
      if (cycle.status !== 'calibration' && cycle.status !== 'managerReview')
        throw new HrError('REVIEW_CYCLE_NOT_READY', 409);
      const all = (
        (await database
          .repository('reviewResults')
          .withPolicy(policyOf(policies, 'reviewResults'))
          .findMany({ filter: { cycleId } })) as Record<string, unknown>[]
      ).map(toResult);
      const open = all.filter((r) => r.status !== 'closed');
      const missing = open.filter(
        (r) => !(r.calibratedRating ?? r.managerRating),
      );
      if (missing.length) {
        const employees = await ctx.employees();
        throw new HrError('REVIEW_PUBLISH_MISSING_RATINGS', 409, {
          names: missing.map(
            (r) => employees.get(r.employeeId)?.name ?? r.employeeId,
          ),
        });
      }
      const assessments = await applyOnPublish(cycle, open);
      const now = new Date();
      await database.transaction(async (connection) => {
        for (const result of open)
          await connection.query
            .updateTable('reviewResults')
            .set({
              finalRating: result.calibratedRating ?? result.managerRating,
              status: 'published',
              publishedAt: now,
              updatedAt: now,
            })
            .where('id', '=', result.id)
            .execute();
        for (const row of assessments)
          await connection.query
            .insertInto('employeeCompetencies')
            .values(row)
            .execute();
        await connection.query
          .updateTable('reviewCycles')
          .set({
            status: 'published',
            publishedAt: now,
            stageLog: [
              ...cycle.stageLog,
              {
                from: cycle.status,
                to: 'published',
                at: now.toISOString(),
                by: actor.userId,
                auto: false,
              },
            ],
            updatedAt: now,
          })
          .where('id', '=', cycleId)
          .execute();
      });
      // Notices after the commit — never with the rating.
      const employees = await ctx.employees();
      for (const result of open) {
        const userId = employees.get(result.employeeId)?.userId;
        if (userId)
          await platform.notify({
            key: `perf:${cycleId}:published:${result.employeeId}`,
            userIds: [userId],
            message: 'performanceResultPublished',
            params: { cycle: cycle.title },
            path: '/talent/my-review?tab=result',
          });
      }
      const low = open.filter((r) => {
        const rating = r.calibratedRating ?? r.managerRating;
        return rating === 'C' || rating === 'D';
      });
      deps.onPublished(
        cycleId,
        low.map((r) => r.id),
      );
      return {
        published: open.length,
        assessments: assessments.length,
        low: low.length,
      };
    },

    /** 我的考核 · 结果: published results only — final rating, the manager's comment, the peer summary. */
    async mine(actor: ActorContext) {
      await authorizeAction(actor.authz, APPEAL, 'submit');
      const employee = await platform.employeeOfUser(actor.userId);
      if (!employee) return [];
      const rows = await database
        .query()
        .selectFrom('reviewResults')
        .selectAll()
        .where('employeeId', '=', employee.id)
        .execute();
      const settings = await ctx.settings();
      const out = [];
      for (const result of rows.map((r) =>
        toResult(r as Record<string, unknown>),
      )) {
        if (
          !result.publishedAt ||
          !(VISIBLE.includes(result.status) || result.status === 'closed')
        )
          continue;
        const cycle = await ctx.cycle(result.cycleId);
        const scheme = await ctx.scheme(result.schemeId);
        const reviews = (await ctx.reviewsOf(result.cycleId)).filter(
          (r) => r.resultId === result.id,
        );
        const manager = reviews.find(
          (r) => r.role === 'manager' && r.status === 'submitted',
        );
        const deadline = addDays(
          result.publishedAt.slice(0, 10),
          settings.appealDays,
        );
        out.push({
          resultId: result.id,
          cycleId: cycle.id,
          cycleTitle: cycle.title,
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          finalRating: result.finalRating,
          ratingDescription:
            scheme.ratingScale.find((r) => r.code === result.finalRating)
              ?.description ?? '',
          managerComment: manager?.comment ?? null,
          peers: deps.reviews.peerSummary(reviews, scheme, false),
          status: result.status,
          publishedAt: result.publishedAt,
          acknowledgedAt: result.acknowledgedAt,
          appeal: result.appeal,
          appealDeadline: deadline,
          can: {
            acknowledge: result.status === 'published',
            appeal: result.status === 'published' && ctx.today() <= deadline,
          },
        });
      }
      return out.sort((a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
      );
    },

    async acknowledge(actor: ActorContext, resultId: string) {
      await authorizeAction(actor.authz, APPEAL, 'submit');
      const result = await ownPublished(actor, resultId);
      if (result.status !== 'published')
        throw new HrError('REVIEW_RESULT_STATE', 409);
      const now = new Date();
      await database
        .query()
        .updateTable('reviewResults')
        .set({ status: 'acknowledged', acknowledgedAt: now, updatedAt: now })
        .where('id', '=', resultId)
        .execute();
      return { resultId, status: 'acknowledged' };
    },

    async appeal(actor: ActorContext, resultId: string, input: unknown) {
      const policies = await authorizeAction(actor.authz, APPEAL, 'submit');
      const parsed = appealInput.safeParse(input);
      if (!parsed.success) throw new HrError('APPEAL_REASON_REQUIRED', 400);
      const result = await ownPublished(actor, resultId);
      const settings = await ctx.settings();
      if (result.status !== 'published')
        throw new HrError('REVIEW_RESULT_STATE', 409);
      if (
        ctx.today() >
        addDays(result.publishedAt!.slice(0, 10), settings.appealDays)
      )
        throw new HrError('APPEAL_WINDOW_CLOSED', 409);
      const now = new Date();
      await database
        .repository('reviewResults')
        .withPolicy(policyOf(policies, 'reviewResults'))
        .updateOne({
          filter: { id: resultId },
          values: {
            status: 'appealed',
            appeal: { reason: parsed.data.reason, at: now.toISOString() },
            updatedAt: now,
          },
        });
      const cycle = await ctx.cycle(result.cycleId);
      const recipients = [
        ...new Set([cycle.ownerUserId, ...(await ctx.hrAdministrators())]),
      ];
      await platform.notify({
        key: `perf:appeal:${resultId}`,
        userIds: recipients,
        message: 'performanceAppealSubmitted',
        params: {
          cycle: cycle.title,
          name: (await platform.employee(result.employeeId))?.name ?? '',
        },
        path: `/talent/review-cycles/${encodeURIComponent(cycle.id)}?tab=appeals`,
      });
      return { resultId, status: 'appealed' };
    },

    /** Appeals of a cycle (hr.admin). */
    async appeals(actor: ActorContext, cycleId: string) {
      await authorizeAction(actor.authz, APPEAL, 'handle');
      const employees = await ctx.employees();
      return (await ctx.resultsOf(cycleId))
        .filter((r) => r.appeal)
        .map((r) => ({
          resultId: r.id,
          name: employees.get(r.employeeId)?.name ?? '',
          finalRating: r.finalRating,
          status: r.status,
          appeal: r.appeal,
        }));
    },

    async handleAppeal(actor: ActorContext, resultId: string, input: unknown) {
      await authorizeAction(actor.authz, APPEAL, 'handle');
      const parsed = handleInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const result = await ctx.result(resultId);
      if (result.status !== 'appealed' || !result.appeal)
        throw new HrError('REVIEW_RESULT_STATE', 409);
      const scheme = await ctx.scheme(result.schemeId);
      const now = new Date();
      const changed = parsed.data.result === 'changed';
      if (
        changed &&
        !scheme.ratingScale.some((r) => r.code === parsed.data.rating)
      )
        throw new HrError('REVIEW_RATING_INVALID', 400);
      await database
        .query()
        .updateTable('reviewResults')
        .set({
          status: 'acknowledged',
          acknowledgedAt: now,
          finalRating: changed ? parsed.data.rating : result.finalRating,
          adjustments: changed
            ? [
                ...result.adjustments,
                {
                  from: result.finalRating,
                  to: parsed.data.rating!,
                  reason: `申诉：${parsed.data.note}`,
                  by: actor.userId,
                  at: now.toISOString(),
                },
              ]
            : result.adjustments,
          appeal: {
            ...result.appeal,
            handledBy: actor.userId,
            handledAt: now.toISOString(),
            result: parsed.data.result,
            note: parsed.data.note,
          },
          updatedAt: now,
        })
        .where('id', '=', resultId)
        .execute();
      const employee = await platform.employee(result.employeeId);
      const cycle = await ctx.cycle(result.cycleId);
      if (employee?.userId)
        await platform.notify({
          key: `perf:appeal:${resultId}:handled`,
          userIds: [employee.userId],
          message: 'performanceAppealHandled',
          params: { cycle: cycle.title },
          path: '/talent/my-review?tab=result',
        });
      await ctx.closeWorkItems(`perf:appeal:${resultId}`);
      return { resultId, status: 'acknowledged', result: parsed.data.result };
    },

    /** 发布后 7 天: unacknowledged, unappealed results become acknowledged. */
    async autoAcknowledge(): Promise<number> {
      const settings = await ctx.settings();
      const cutoff = addDays(ctx.today(), -settings.autoAcknowledgeDays);
      const rows = (
        await database
          .query()
          .selectFrom('reviewResults')
          .selectAll()
          .where('status', '=', 'published')
          .execute()
      ).map((r) => toResult(r as Record<string, unknown>));
      let count = 0;
      for (const result of rows) {
        if (!result.publishedAt || result.publishedAt.slice(0, 10) > cutoff)
          continue;
        const now = new Date();
        await database
          .query()
          .updateTable('reviewResults')
          .set({ status: 'acknowledged', acknowledgedAt: now, updatedAt: now })
          .where('id', '=', result.id)
          .where('status', '=', 'published')
          .execute();
        count += 1;
      }
      return count;
    },

    /** 员工的 offboard 事件: unpublished results closed, open tasks cancelled. */
    async onJobEvent(event: JobEvent): Promise<void> {
      if (event.eventType !== 'offboard') return;
      const rows = (
        await database
          .query()
          .selectFrom('reviewResults')
          .selectAll()
          .where('employeeId', '=', event.employeeId)
          .execute()
      ).map((r) => toResult(r as Record<string, unknown>));
      const open = rows.filter(
        (r) => r.status === 'inProgress' || r.status === 'calibrated',
      );
      if (!open.length) return;
      const now = new Date();
      await database.transaction(async (connection) => {
        for (const result of open) {
          await connection.query
            .updateTable('reviewResults')
            .set({
              status: 'closed',
              closedReason: 'offboarded',
              updatedAt: now,
            })
            .where('id', '=', result.id)
            .execute();
          await connection.query
            .updateTable('reviews')
            .set({ status: 'cancelled', updatedAt: now })
            .where('resultId', '=', result.id)
            .where('status', '!=', 'submitted')
            .execute();
        }
      });
      for (const result of open)
        for (const stage of ['goalSetting', 'selfReview', 'goalDraft'])
          await ctx.closeWorkItems(
            `perf:${result.cycleId}:${stage}:${event.employeeId}`,
          );
    },

    /** HR closes a result by hand (manual). */
    async close(actor: ActorContext, resultId: string) {
      await authorizeAction(actor.authz, 'talent.reviewCycle', 'manage');
      const result = await ctx.result(resultId);
      if (!['inProgress', 'calibrated'].includes(result.status))
        throw new HrError('REVIEW_RESULT_STATE', 409);
      const now = new Date();
      await database.transaction(async (connection) => {
        await connection.query
          .updateTable('reviewResults')
          .set({ status: 'closed', closedReason: 'manual', updatedAt: now })
          .where('id', '=', resultId)
          .execute();
        await connection.query
          .updateTable('reviews')
          .set({ status: 'cancelled', updatedAt: now })
          .where('resultId', '=', resultId)
          .where('status', '!=', 'submitted')
          .execute();
      });
      return { resultId, status: 'closed' };
    },

    /** 员工详情 · 绩效: published final ratings and manager comments (hr.admin, heads within scope). */
    async history(actor: ActorContext, employeeId: string) {
      const policies = await authorizeAction(actor.authz, CALIBRATION, 'view');
      const rows = (
        (await database
          .repository('reviewResults')
          .withPolicy(policyOf(policies, 'reviewResults'))
          .findMany({ filter: { employeeId } })) as Record<string, unknown>[]
      )
        .map(toResult)
        .filter((r) => r.publishedAt);
      const out = [];
      for (const result of rows) {
        const cycle = await ctx.cycle(result.cycleId);
        const manager = (await ctx.reviewsOf(result.cycleId)).find(
          (r) =>
            r.resultId === result.id &&
            r.role === 'manager' &&
            r.status === 'submitted',
        );
        out.push({
          resultId: result.id,
          cycleTitle: cycle.title,
          periodEnd: cycle.periodEnd,
          finalRating: result.finalRating,
          managerComment: manager?.comment ?? null,
          publishedAt: result.publishedAt,
          status: result.status,
        });
      }
      return out.sort((a, b) =>
        (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''),
      );
    },
  };

  async function ownPublished(
    actor: ActorContext,
    resultId: string,
  ): Promise<ResultRow> {
    const employee = await platform.employeeOfUser(actor.userId);
    const result = await ctx.result(resultId);
    if (!employee || result.employeeId !== employee.id || !result.publishedAt)
      throw new HrError('REVIEW_RESULT_NOT_FOUND', 404);
    return result;
  }

  return service;
}

export type ResultService = ReturnType<typeof createResultService>;

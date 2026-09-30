/**
 * V4-12 绩效: the performance services, built once by the provider
 * (server/providers/hr/index.ts, V4-12 block) and resolved through
 * `performanceServicesToken`. The assistant's event work starts in the
 * background after the request that caused it has answered; each run is
 * deduplicated by the automation framework.
 */
import type { AutomationRunContext } from '../automation.js';
import type { ActorContext } from '../framework-service.js';
import { HrError } from '../shared.js';
import { createAnomalyService } from './anomalies.js';
import {
  createPerformanceAssistant,
  PERFORMANCE_AUTOMATIONS,
} from './assistant.js';
import {
  readPerformanceSettings,
  performanceSettingsSchema,
  SETTINGS_ID,
} from './config.js';
import {
  createPerformanceContext,
  toResult,
  type PerformanceDeps,
} from './context.js';
import { createCycleService } from './cycles.js';
import { rescore } from './evidence.js';
import { createGoalService } from './goals.js';
import { createPayrollLink } from './payroll-link.js';
import { createResultService } from './results.js';
import { createReviewService } from './reviews.js';
import { createSchemeService } from './schemes.js';
import { createPerformanceTasks } from './tasks.js';
import { authorizeAction } from '../authorize.js';

export { PERFORMANCE_AUTOMATIONS };

export function createPerformanceServices(deps: PerformanceDeps) {
  const ctx = createPerformanceContext(deps);
  const run = (
    key: string,
    dedupeKey: string,
    triggerRef: Record<string, unknown>,
    work: (run: AutomationRunContext) => Promise<{
      status?: 'succeeded' | 'skipped';
      output?: Record<string, unknown>;
    }>,
  ) => deps.automation().run(key, 'event', { dedupeKey, triggerRef }, work);

  // Created below; the hooks reach them lazily.
  const holder: { assistant?: ReturnType<typeof createPerformanceAssistant> } =
    {};
  const assistant = () => {
    if (!holder.assistant) throw new Error('performance assistant not ready');
    return holder.assistant;
  };

  const schemes = createSchemeService(ctx);
  const goals = createGoalService(ctx);
  const anomalies = createAnomalyService(ctx);
  const reviews = createReviewService(ctx, {
    onManagerSubmitted: (reviewId, submission) =>
      deps.background(PERFORMANCE_AUTOMATIONS.deviationCheck, () =>
        run(
          PERFORMANCE_AUTOMATIONS.deviationCheck,
          `${reviewId}:${submission}`,
          { reviewId, submission },
          (r) => assistant().deviationCheck(r, reviewId, submission),
        ),
      ),
  });
  const cycles = createCycleService(ctx, schemes, {
    onSelfReview: (cycleId) =>
      deps.background(PERFORMANCE_AUTOMATIONS.evidenceSummary, () =>
        run(
          PERFORMANCE_AUTOMATIONS.evidenceSummary,
          cycleId,
          { cycleId },
          (r) => assistant().evidenceSummary(r, cycleId),
        ),
      ),
    onManagerReview: (cycleId) =>
      deps.background(PERFORMANCE_AUTOMATIONS.reviewDrafts, () =>
        run(PERFORMANCE_AUTOMATIONS.reviewDrafts, cycleId, { cycleId }, (r) =>
          assistant().reviewDrafts(r, cycleId),
        ),
      ),
    onCalibration: (cycleId) =>
      deps.background(PERFORMANCE_AUTOMATIONS.calibrationPack, () =>
        run(
          PERFORMANCE_AUTOMATIONS.calibrationPack,
          cycleId,
          { cycleId },
          (r) => assistant().calibrationPack(r, cycleId),
        ),
      ),
  });
  const results = createResultService(ctx, {
    reviews,
    anomalies,
    onPublished: (_cycleId, lowResultIds) => {
      for (const resultId of lowResultIds)
        deps.background(PERFORMANCE_AUTOMATIONS.reviewResultPlans, () =>
          run(
            PERFORMANCE_AUTOMATIONS.reviewResultPlans,
            resultId,
            { resultId },
            (r) => assistant().reviewResultPlan(r, resultId),
          ),
        );
    },
  });
  holder.assistant = createPerformanceAssistant({
    ctx,
    ai: deps.ai,
    goals,
    reviews,
    results,
    anomalies,
  });
  const payroll = createPayrollLink(ctx);
  const tasks = createPerformanceTasks(ctx, cycles, results);

  return {
    context: ctx,
    schemes,
    cycles,
    goals,
    reviews,
    results,
    anomalies,
    payroll,
    tasks,
    get assistant() {
      return assistant();
    },

    /** The work the automation runner (scheduled) and retries start. */
    scheduled: {
      [PERFORMANCE_AUTOMATIONS.goalDrafts]: (r: AutomationRunContext) =>
        assistant().goalDrafts(r),
    } as Record<
      string,
      (r: AutomationRunContext) => Promise<{
        status?: 'succeeded' | 'skipped';
        output?: Record<string, unknown>;
      }>
    >,

    /** Retrying a failed event run with its trigger object. */
    retry(task: string, triggerRef: Record<string, unknown>) {
      const ref = (name: string) => {
        const value = triggerRef[name];
        if (typeof value !== 'string' || !value)
          throw new HrError('AUTOMATION_RETRY_UNSUPPORTED', 400);
        return value;
      };
      switch (task) {
        case PERFORMANCE_AUTOMATIONS.evidenceSummary:
          return (r: AutomationRunContext) =>
            assistant().evidenceSummary(r, ref('cycleId'));
        case PERFORMANCE_AUTOMATIONS.reviewDrafts:
          return (r: AutomationRunContext) =>
            assistant().reviewDrafts(r, ref('cycleId'));
        case PERFORMANCE_AUTOMATIONS.calibrationPack:
          return (r: AutomationRunContext) =>
            assistant().calibrationPack(r, ref('cycleId'));
        case PERFORMANCE_AUTOMATIONS.reviewResultPlans:
          return (r: AutomationRunContext) =>
            assistant().reviewResultPlan(r, ref('resultId'));
        case PERFORMANCE_AUTOMATIONS.deviationCheck:
          return (r: AutomationRunContext) =>
            assistant().deviationCheck(
              r,
              ref('reviewId'),
              Number(triggerRef.submission) || 0,
            );
        default:
          return undefined;
      }
    },

    /** 每日任务 by hand (hr.admin): the 09:00 rules and the goal drafts. */
    async runDailyNow(actor: ActorContext) {
      await authorizeAction(actor.authz, 'talent.reviewCycle', 'advance');
      const rules = await tasks.runDaily();
      const drafts = await deps
        .automation()
        .run(PERFORMANCE_AUTOMATIONS.goalDrafts, 'manual', {}, (r) =>
          assistant().goalDrafts(r),
        );
      return { ...rules, goalDrafts: drafts.status };
    },

    /** The performance defaults (exclusion rules, windows, reminders, adoption thresholds). */
    async readSettings(actor: ActorContext) {
      await authorizeAction(actor.authz, 'talent.reviewCycle', 'view');
      return readPerformanceSettings(ctx.database);
    },

    async writeSettings(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, 'talent.reviewCycle', 'manage');
      const current = await readPerformanceSettings(ctx.database);
      const parsed = performanceSettingsSchema.safeParse({
        ...current.value,
        ...(input && typeof input === 'object' ? input : {}),
      });
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const now = new Date();
      const exists = await ctx.database
        .query()
        .selectFrom('personnelSettings')
        .select(['id'])
        .where('id', '=', SETTINGS_ID)
        .executeTakeFirst();
      if (exists)
        await ctx.database
          .query()
          .updateTable('personnelSettings')
          .set({
            value: parsed.data,
            revision: current.revision + 1,
            updatedBy: actor.userId,
            updatedAt: now,
          })
          .where('id', '=', SETTINGS_ID)
          .execute();
      else
        await ctx.database
          .query()
          .insertInto('personnelSettings')
          .values({
            id: SETTINGS_ID,
            value: parsed.data,
            revision: 1,
            updatedBy: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      return readPerformanceSettings(ctx.database);
    },

    /** 刷新快照 (hr.admin): rebuilds the snapshots of a cycle, e.g. after a quality rule change. */
    async refreshSnapshots(actor: ActorContext, cycleId: string) {
      await authorizeAction(actor.authz, 'talent.reviewCycle', 'manage');
      const cycle = await ctx.cycle(cycleId);
      if (
        !['selfReview', 'peerReview', 'managerReview', 'calibration'].includes(
          cycle.status,
        )
      )
        throw new HrError('REVIEW_CYCLE_STAGE_CLOSED', 409);
      return { refreshed: await cycles.snapshotAll(cycle) };
    },

    /**
     * 我的考核 overview: the cycles one takes part in — stage, deadline, goals,
     * self review, peers — and one's own snapshot and summary once built. No
     * rating, comment or other person's data (the result tab reads results.mine).
     */
    async me(actor: ActorContext) {
      await authorizeAction(actor.authz, 'talent.goal', 'view');
      const employee = await ctx.platform.employeeOfUser(actor.userId);
      if (!employee) return { employeeId: null, cycles: [] };
      const rows = await ctx.database
        .query()
        .selectFrom('reviewResults')
        .selectAll()
        .where('employeeId', '=', employee.id)
        .execute();
      const out = [];
      for (const row of rows) {
        const result = toResult(row);
        const cycle = await ctx.cycle(result.cycleId);
        const scheme = await ctx.scheme(result.schemeId);
        const own = (await ctx.goalsOf(cycle.id)).filter(
          (g) => g.employeeId === employee.id && g.status !== 'cancelled',
        );
        const tasks = (await ctx.reviewsOf(cycle.id)).filter(
          (r) => r.reviewerUserId === actor.userId && r.status !== 'cancelled',
        );
        const self = tasks.find(
          (r) => r.role === 'self' && r.resultId === result.id,
        );
        const snapshotVisible = !['draft', 'goalSetting'].includes(
          cycle.status,
        );
        out.push({
          cycleId: cycle.id,
          cycleTitle: cycle.title,
          cycleStatus: cycle.status,
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          deadline: cycle.stageDeadlines[cycle.status] ?? null,
          resultId: result.id,
          resultStatus: result.status,
          closedReason: result.closedReason,
          published: Boolean(result.publishedAt),
          schemeTitle: scheme.title,
          stages: scheme.stages,
          noAccount: result.noAccount,
          goals: {
            draft: own.filter((g) => g.status === 'draft').length,
            submitted: own.filter((g) => g.status === 'submitted').length,
            approved: own.filter((g) => g.status === 'approved').length,
            aiDrafts: own.filter(
              (g) => g.source === 'ai' && g.status === 'draft',
            ).length,
          },
          selfReview: self ? { reviewId: self.id, status: self.status } : null,
          peerTasks: tasks.filter(
            (r) => r.role === 'peer' && r.status !== 'submitted',
          ).length,
          peers: scheme.stages.peerReview.enabled
            ? {
                status: result.peerStatus,
                userIds: result.peerUserIds,
                count: scheme.stages.peerReview.count,
              }
            : null,
          evidence: snapshotVisible
            ? {
                snapshot: result.evidenceSnapshot,
                summary: result.evidenceSummary,
              }
            : null,
        });
      }
      return {
        employeeId: employee.id,
        cycles: out.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
      };
    },

    /** Recomputes a stored snapshot's reference score under the current rules (no new data). */
    rescore,

    /** The offboard job event (V1-02 处理器). */
    onJobEvent: (event: Parameters<typeof results.onJobEvent>[0]) =>
      results.onJobEvent(event),
  };
}

export type PerformanceServices = ReturnType<typeof createPerformanceServices>;

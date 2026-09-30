/**
 * V4-12 每天 09:00 (scheduler target `app.hr-performance-daily`; hr.admin can
 * start it by hand):
 *
 * - reminders `reminderDays` (3 and 1) days before the current stage's
 *   deadline to everyone whose task in it is not done, once per person, stage
 *   and day count;
 * - cycles with `autoAdvance` whose current stage deadline has passed move to
 *   the next stage, as the cycle's HR owner;
 * - published results 7 days old, neither acknowledged nor appealed, become
 *   acknowledged;
 * - the assistant's goal drafts (`performanceAssistant.goalDrafts`) when
 *   started by hand (on schedule they run through the automation runner at
 *   their own hour).
 */
import { scopeForUser } from '../authorize.js';
import { addDays, HrError, str } from '../shared.js';
import type { CycleService } from './cycles.js';
import type { PerformanceContext } from './context.js';
import type { ResultService } from './results.js';

export function createPerformanceTasks(
  ctx: PerformanceContext,
  cycles: CycleService,
  results: ResultService,
) {
  const { database, platform } = ctx;

  async function reminders(): Promise<number> {
    const settings = await ctx.settings();
    const today = ctx.today();
    let sent = 0;
    const rows = await database
      .query()
      .selectFrom('reviewCycles')
      .select(['id'])
      .where('status', 'in', [
        'goalSetting',
        'selfReview',
        'peerReview',
        'managerReview',
        'calibration',
      ])
      .execute();
    for (const row of rows) {
      const cycle = await ctx.cycle(str(row.id));
      const deadline = cycle.stageDeadlines[cycle.status];
      if (!deadline) continue;
      const days = settings.reminderDays.find(
        (d) => addDays(deadline, -d) === today,
      );
      if (days === undefined) continue;
      const open = await cycles.incomplete(cycle);
      for (const userId of new Set(
        open.map((o) => o.userId).filter((u): u is string => Boolean(u)),
      )) {
        const key = `perf:deadline:${cycle.id}:${cycle.status}:${userId}:${days}`;
        const ok = await platform.reminderOnce(key, () =>
          platform.notify({
            key,
            userIds: [userId],
            message: 'performanceDeadline',
            params: { cycle: cycle.title, days: String(days), deadline },
            path:
              cycle.status === 'managerReview'
                ? '/talent/team-reviews'
                : '/talent/my-review',
          }),
        );
        if (ok) sent += 1;
      }
    }
    return sent;
  }

  async function autoAdvance(): Promise<number> {
    const today = ctx.today();
    let advanced = 0;
    const rows = await database
      .query()
      .selectFrom('reviewCycles')
      .select(['id'])
      .where('autoAdvance', '=', true)
      .execute();
    for (const row of rows) {
      const cycle = await ctx.cycle(str(row.id));
      const deadline = cycle.stageDeadlines[cycle.status];
      if (!deadline || deadline >= today) continue;
      const actor = {
        userId: cycle.ownerUserId,
        authz: await scopeForUser(platform.authz, cycle.ownerUserId),
      };
      try {
        const outcome = await cycles.advance(
          actor,
          cycle.id,
          { confirm: true },
          { auto: true },
        );
        if (outcome.advanced) advanced += 1;
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
      }
    }
    return advanced;
  }

  return {
    reminders,
    autoAdvance,
    async runDaily(): Promise<Record<string, number>> {
      return {
        reminders: await reminders(),
        advanced: await autoAdvance(),
        acknowledged: await results.autoAcknowledge(),
      };
    },
  };
}

export type PerformanceTasks = ReturnType<typeof createPerformanceTasks>;

/**
 * 招聘的定时任务 (V2-07). One scheduler target (`app.hr-recruiting`, hourly)
 * runs the step's rules; the AI employees' daily work (待入职跟进, 新员工回访
 * at 09:00, 招聘汇总 at 18:00) is scheduled through 设置 / AI 员工任务 like
 * every other automation, and the manual trigger runs it with the same code.
 *
 * - hourly: interviews within 24 hours without questions → the assistant drafts them;
 * - daily (09:00): stage reminders (同一阶段停留超过配置天数), expired offers,
 *   anonymization past retentionUntil; with `withAutomations`, also
 *   preboarding and check-ins (the manual 每日任务);
 * - evening (18:00): 面试前一天 reminders for self-booked interviews, from the
 *   template the recruiter confirmed; with `withAutomations`, the digest.
 *
 * `asOf` simulates a date outside production (验收 · 模拟日期).
 */
import type { AutomationRunContext } from '../automation.js';
import { addDays, str } from '../shared.js';
import type { RecruitingAssistant } from './assistant.js';
import { TASKS } from './assistant.js';
import type { CandidateService } from './candidates.js';
import { CHECK_IN_TASK, type CheckIns } from './checkins.js';
import { fill, localDate, localDateTime } from './common.js';
import type { RecruitingContext } from './context.js';
import type { InterviewService } from './interviews.js';
import type { OfferService } from './offers.js';
import type { PostingService } from './postings.js';
import { PREBOARDING_TASK, type PreboardingService } from './preboarding.js';

export type RecruitingTask = 'hourly' | 'daily' | 'evening';

export function createRecruitingTasks(
  ctx: RecruitingContext,
  deps: {
    assistant: RecruitingAssistant;
    candidates: CandidateService;
    interviews: InterviewService;
    offers: OfferService;
    postings: PostingService;
    preboarding: PreboardingService;
    checkIns: CheckIns;
  },
) {
  const { database, platform } = ctx;

  async function staleReminders(asOf: string) {
    const settings = await ctx.settings();
    const stale = await deps.candidates.stale(asOf, settings.reminders.stageStaleDays);
    const byRecruiter = new Map<string, string[]>();
    for (const s of stale) {
      if (!s.recruiterUserId) continue;
      byRecruiter.set(s.recruiterUserId, [...(byRecruiter.get(s.recruiterUserId) ?? []), s.id]);
    }
    for (const [userId, ids] of byRecruiter)
      await platform.notify({
        key: `recruitingStale:${asOf}:${userId}:${settings.reminders.stageStaleDays}`,
        userIds: [userId],
        message: 'recruitingStaleApplications',
        params: { count: String(ids.length), days: String(settings.reminders.stageStaleDays) },
        path: '/talent/candidates?stale=1',
      });
    return stale.length;
  }

  /** 面试前一天 18:00: only self-booked interviews, from the posting's confirmed template. */
  async function bookingReminders(asOf: string) {
    const tomorrow = addDays(asOf, 1);
    const from = new Date(`${tomorrow}T00:00:00+08:00`);
    const to = new Date(`${tomorrow}T23:59:59+08:00`);
    const rows = await database
      .query()
      .selectFrom('interviews')
      .select(['id', 'scheduledAt', 'reminderSentAt'])
      .where('status', '=', 'scheduled')
      .where('selfBooked', '=', true)
      .execute()
      // Compared as instants (SQLite keeps datetimes as text).
      .then((all) =>
        all.filter((r) => {
          const at = new Date(str(r.scheduledAt)).getTime();
          return !r.reminderSentAt && at >= from.getTime() && at <= to.getTime();
        }),
      );
    const sent: string[] = [];
    for (const r of rows) {
      const interview = await deps.interviews.get(str(r.id));
      const application = await deps.candidates.applicationRow(interview.applicationId);
      const posting = await deps.postings.get(application.postingId);
      const candidate = await deps.candidates.candidateRow(application.candidateId);
      if (!posting.bookingTemplate || !candidate.email) continue;
      const token = await deps.candidates.issueBookingToken(application.id);
      const values = {
        name: candidate.name,
        position: posting.title,
        time: localDateTime(interview.scheduledAt, platform.timeZone),
        location: interview.locationOrLink ?? '',
        link: ctx.publicUrl(`/jobs/booking/${token}`),
      };
      const delivery = await ctx.sendEmail({
        key: `interviewReminder:${interview.id}`,
        to: candidate.email,
        subject: fill(posting.bookingTemplate.subject, values),
        body: fill(posting.bookingTemplate.body, values),
      });
      await database
        .query()
        .updateTable('interviews')
        .set({ reminderSentAt: new Date(), updatedAt: new Date() })
        .where('id', '=', interview.id)
        .execute();
      await deps.candidates.addDraftMessage(application.id, {
        type: 'interviewReminder',
        subject: fill(posting.bookingTemplate.subject, values),
        body: fill(posting.bookingTemplate.body, { ...values, link: '（改期链接）' }),
        draftedBy: 'rule',
        interviewId: interview.id,
      });
      // Recorded as sent automatically under the confirmed template.
      const fresh = await deps.candidates.applicationRow(application.id);
      await database
        .query()
        .updateTable('applications')
        .set({
          messages: fresh.messages.map((m) =>
            m.type === 'interviewReminder' && m.interviewId === interview.id && m.status === 'draft'
              ? { ...m, status: 'sent', sentAt: new Date().toISOString(), sentBy: 'template', delivery }
              : m,
          ),
        })
        .where('id', '=', application.id)
        .execute();
      sent.push(interview.id);
    }
    return sent;
  }

  /** 待入职跟进 as the automation's work. */
  async function preboardingWork(run: AutomationRunContext, asOf: string) {
    const result = await deps.preboarding.runDaily(run, asOf);
    return { output: { reminded: result.reminded, escalated: result.escalated } };
  }

  /** 新员工回访 as the automation's work: ids, days and channels only in the output. */
  async function checkInWork(run: AutomationRunContext, asOf: string) {
    const result = await deps.checkIns.runDaily(asOf, async (checkInId) => {
      const checkIn = await deps.checkIns.get(checkInId);
      const employee = await platform.employee(checkIn.employeeId);
      if (!employee?.userId) return 'notBound';
      return ctx.im().sendText(employee.userId, await deps.checkIns.questionText(checkInId));
    });
    run.summarize(`${asOf}: ${result.created.length} check-ins, ${result.closed} closed`);
    return { output: result };
  }

  const tasks = {
    preboardingWork,
    checkInWork,

    async run(
      task: RecruitingTask,
      options: { asOf?: string; now?: Date; withAutomations?: boolean; trigger?: 'schedule' | 'manual' } = {},
    ) {
      const now = options.now ?? new Date();
      const asOf = options.asOf ?? localDate(now, platform.timeZone);
      const trigger = options.trigger ?? 'schedule';
      const automation = ctx.automation();
      if (task === 'hourly') {
        const ids = await deps.interviews.needingPlans(now);
        const outcomes: Record<string, string> = {};
        for (const id of ids) outcomes[id] = (await deps.assistant.onInterviewDue(id)).status;
        return { interviews: outcomes };
      }
      if (task === 'daily') {
        const stale = await staleReminders(asOf);
        const expired = await deps.offers.expire(options.asOf ? new Date(`${asOf}T09:00:00+08:00`) : now);
        const owner = (await ctx.ownerOf(TASKS.dailyDigest)) ?? 'system';
        const anonymized = await deps.candidates.anonymizeExpired(asOf, owner);
        const result: Record<string, unknown> = { stale, expired, anonymized };
        if (options.withAutomations) {
          result.preboarding = (
            await automation.run(PREBOARDING_TASK, trigger, { triggerRef: { asOf }, ...(trigger === 'schedule' ? { dedupeKey: `schedule:${asOf}` } : {}) }, (run) => preboardingWork(run, asOf))
          ).status;
          result.checkIns = (
            await automation.run(CHECK_IN_TASK, trigger, { triggerRef: { asOf }, ...(trigger === 'schedule' ? { dedupeKey: `schedule:${asOf}` } : {}) }, (run) => checkInWork(run, asOf))
          ).status;
        }
        return result;
      }
      const reminders = await bookingReminders(asOf);
      const result: Record<string, unknown> = { reminders: reminders.length };
      if (options.withAutomations)
        result.digest = (
          await automation.run(TASKS.dailyDigest, trigger, { triggerRef: { asOf }, ...(trigger === 'schedule' ? { dedupeKey: `schedule:${asOf}` } : {}) }, (run) => deps.assistant.dailyDigest(run, asOf))
        ).status;
      return result;
    },
  };
  return tasks;
}

export type RecruitingTasks = ReturnType<typeof createRecruitingTasks>;

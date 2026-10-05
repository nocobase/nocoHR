/**
 * 面试 (V2-07). The recruiter schedules a round (the interviewers' interviews
 * and shifts are checked), or the candidate books an open slot. Interviewers
 * are told in the inbox and the office suite with the title and a link only;
 * the invitation to the candidate is a draft until the recruiter sends it.
 *
 * - The question plan is the assistant's draft (one question per
 *   requirement); the recruiter or an interviewer may edit it.
 * - An interviewer sees the candidate's profile without contact data, and no
 *   other interviewer's scorecard until their own is submitted.
 * - When every interviewer has submitted, the round completes and the
 *   assistant summarizes it for the hiring manager and the recruiter.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import { closeWorkItems } from '../work-item-store.js';
import type { Calendar } from './calendar.js';
import type { CandidateService } from './candidates.js';
import {
  fill,
  iso,
  json,
  localDate,
  localDateTime,
  num,
  zonedInstant,
} from './common.js';
import type { RecruitingContext } from './context.js';
import type { PostingService } from './postings.js';
import { COMPOSITE } from './resources.js';
import type { Templates } from './templates.js';

const scheduleSchema = z
  .object({
    applicationId: z.string().min(1).max(64),
    mode: z.enum(['onsite', 'video', 'phone']),
    scheduledAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(10).max(480).default(60),
    locationOrLink: z.string().trim().max(500).nullish(),
    interviewerUserIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  })
  .strict();

export const questionPlanSchema = z
  .array(
    z
      .object({
        requirementKey: z.string().min(1).max(40),
        question: z.string().trim().min(1).max(500),
        lookFor: z.string().trim().min(1).max(500),
        followUps: z
          .array(z.string().trim().min(1).max(300))
          .max(3)
          .default([]),
      })
      .strict(),
  )
  .min(1)
  .max(20);

const scorecardSchema = z
  .object({
    requirementScores: z
      .array(
        z
          .object({
            requirementKey: z.string().min(1).max(40),
            score: z.number().int().min(1).max(5),
            evidence: z.string().trim().max(1000).nullish(),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    recommendation: z.enum(['strongYes', 'yes', 'no', 'strongNo']),
    notes: z.string().trim().max(4000).nullish(),
  })
  .strict();

export interface Scorecard {
  userId: string;
  requirementScores: {
    requirementKey: string;
    score: number;
    evidence?: string | null;
  }[];
  recommendation: 'strongYes' | 'yes' | 'no' | 'strongNo';
  notes?: string | null;
  submittedAt: string;
}

export function presentInterview(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    applicationId: str(row.applicationId),
    round: num(row.round, 1),
    mode: str(row.mode),
    scheduledAt: iso(row.scheduledAt)!,
    durationMinutes: num(row.durationMinutes, 60),
    locationOrLink: row.locationOrLink ? str(row.locationOrLink) : null,
    interviewerUserIds: json<string[]>(row.interviewerUserIds, []),
    questionPlan: json<
      | {
          requirementKey: string;
          question: string;
          lookFor: string;
          followUps: string[];
        }[]
      | null
    >(row.questionPlan, null),
    questionPlanAt: iso(row.questionPlanAt),
    scorecards: json<Scorecard[]>(row.scorecards, []),
    aiSummary: json<Record<string, unknown> | null>(row.aiSummary, null),
    summaryAt: iso(row.summaryAt),
    status: str(row.status),
    slotKey: row.slotKey ? str(row.slotKey) : null,
    selfBooked: row.selfBooked === true || row.selfBooked === 1,
    changesUsed: num(row.changesUsed),
    reminderSentAt: iso(row.reminderSentAt),
    consentAt: iso(row.consentAt),
    transcript: json<unknown[] | null>(row.transcript, null),
    aiReport: json<Record<string, unknown> | null>(row.aiReport, null),
  };
}
export type InterviewView = ReturnType<typeof presentInterview>;

export function createInterviewService(
  ctx: RecruitingContext,
  deps: {
    candidates: CandidateService;
    calendar: Calendar;
    templates: Templates;
    postings: PostingService;
    /** Every interviewer submitted: the assistant summarizes (background, once). */
    onAllScored: (interviewId: string) => void;
  },
) {
  const { database, platform } = ctx;
  const { candidates, calendar } = deps;

  async function row(id: string): Promise<InterviewView> {
    const found = await database
      .query()
      .selectFrom('interviews')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('INTERVIEW_NOT_FOUND', 404);
    return presentInterview(found);
  }

  async function access(actor: ActorContext, interview: InterviewView) {
    const application = await candidates.applicationRow(
      interview.applicationId,
    );
    const a = await candidates.access(actor, application);
    const interviewer = interview.interviewerUserIds.includes(actor.userId);
    return { application, ...a, interviewer };
  }

  async function notifyInterviewers(interview: InterviewView, name: string) {
    await platform.notify({
      key: `interview:${interview.id}:scheduled:${interview.scheduledAt}`,
      userIds: interview.interviewerUserIds,
      message: 'recruitingInterviewScheduled',
      params: {
        name,
        time: localDateTime(interview.scheduledAt, platform.timeZone),
      },
      path: `/talent/interviews/${interview.id}`,
    });
  }

  async function present(actor: ActorContext, interview: InterviewView) {
    const a = await access(actor, interview);
    const candidate = await candidates.candidateRow(a.application.candidateId);
    const mine = interview.scorecards.find((s) => s.userId === actor.userId);
    // 面试官提交自己的评分前看不到其他面试官的评分.
    const seeAll = a.recruiter || Boolean(mine);
    const names = await Promise.all(
      interview.interviewerUserIds.map(async (id) => ({
        userId: id,
        name: (await platform.userName(id)) ?? id,
        submitted: interview.scorecards.some((s) => s.userId === id),
      })),
    );
    return {
      ...interview,
      transcript: a.recruiter ? interview.transcript : null,
      scorecards: seeAll
        ? interview.scorecards
        : interview.scorecards.filter((s) => s.userId === actor.userId),
      interviewers: names,
      aiSummary: a.recruiter || a.manager || mine ? interview.aiSummary : null,
      candidate: {
        name: candidate.name,
        parsedProfile: candidate.parsedProfile,
        // Never contact data here: the interview page is for interviewers.
      },
      application: {
        id: a.application.id,
        stage: a.application.stage,
        knockoutAnswers: a.application.knockoutAnswers,
      },
      posting: {
        id: a.posting.id,
        title: a.posting.title,
        requirements: a.posting.requirements,
      },
      can: {
        manage: a.recruiter,
        editPlan: a.recruiter || a.interviewer,
        score:
          a.interviewer &&
          interview.status === 'scheduled' &&
          (await ctx.can(actor, COMPOSITE.interview, 'score')),
      },
      mine: mine ?? null,
    };
  }

  /** 改期回信 (招聘邮箱): the part of the day a candidate asks for. */
  const PERIODS = {
    morning: [9, 12],
    afternoon: [13, 18],
    evening: [18, 21],
  } as const;

  const service = {
    get: row,

    /** The application's next interview with people (not the AI interview), if any. */
    async upcomingFor(applicationId: string): Promise<InterviewView | null> {
      const rows = await database
        .query()
        .selectFrom('interviews')
        .selectAll()
        .where('applicationId', '=', applicationId)
        .where('status', '=', 'scheduled')
        .where('mode', '!=', 'ai')
        .where('scheduledAt', '>', new Date())
        .orderBy('scheduledAt', 'asc')
        .execute();
      return rows[0] ? presentInterview(rows[0]) : null;
    },

    /**
     * Times an interview could move to, for a candidate's wish: the weekday
     * they name (the interview's own day when it is that weekday) and the part
     * of the day. Open self-booking slots of the posting first; otherwise the
     * hours within that part of the day when every interviewer is free. At most
     * three; never the current time.
     */
    async rescheduleOptions(
      interviewId: string,
      wish: {
        weekday: number | null;
        period: keyof typeof PERIODS | null;
      },
    ) {
      const interview = await row(interviewId);
      const application = await candidates.applicationRow(
        interview.applicationId,
      );
      const tz = platform.timeZone;
      const today = localDate(new Date(), tz);
      const current = localDate(interview.scheduledAt, tz);
      const weekdayOf = (date: string) =>
        new Date(`${date}T00:00:00Z`).getUTCDay();
      let date = current;
      if (wish.weekday !== null && weekdayOf(current) !== wish.weekday) {
        const d = new Date(`${today}T00:00:00Z`);
        do d.setUTCDate(d.getUTCDate() + 1);
        while (d.getUTCDay() !== wish.weekday);
        date = d.toISOString().slice(0, 10);
      }
      const [fromHour, toHour] = wish.period ? PERIODS[wish.period] : [9, 18];
      const from = zonedInstant(date, fromHour, 0, tz).getTime();
      const to = zonedInstant(date, toHour, 0, tz).getTime();
      const duration = interview.durationMinutes * 60_000;
      const now = Date.now();
      const currentAt = new Date(interview.scheduledAt).getTime();
      const posting = await deps.postings.get(application.postingId);
      const counts = await deps.postings.bookedCounts(posting.id);
      const fromSlots = posting.interviewSlots
        .filter((s) => {
          const at = new Date(s.start).getTime();
          return (
            at >= from &&
            at < to &&
            at > now &&
            at !== currentAt &&
            (counts.get(s.start) ?? 0) < s.capacity
          );
        })
        .map((s) => ({
          start: s.start,
          end: s.end,
          slotKey: s.start,
          location: s.location ?? interview.locationOrLink,
        }));
      const options: {
        start: string;
        end: string;
        slotKey: string | null;
        location: string | null;
      }[] = [...fromSlots];
      if (!options.length)
        for (
          let at = from;
          at + duration <= to && options.length < 3;
          at += 3_600_000
        ) {
          if (at <= now || at === currentAt) continue;
          const start = new Date(at).toISOString();
          const end = new Date(at + duration).toISOString();
          const conflicts = await calendar.conflicts({
            interviewerUserIds: interview.interviewerUserIds,
            start,
            end,
            ignoreInterviewId: interview.id,
          });
          if (!conflicts.length)
            options.push({
              start,
              end,
              slotKey: null,
              location: interview.locationOrLink,
            });
        }
      return {
        interview,
        date,
        options: options.slice(0, 3).map((o) => ({
          ...o,
          label: localDateTime(o.start, tz),
        })),
      };
    },

    /**
     * Moves an interview to a confirmed time: still free for every
     * interviewer (and the slot still open), then the interviewers hear of it.
     */
    async rescheduleTrusted(
      interviewId: string,
      option: {
        start: string;
        end: string;
        slotKey: string | null;
        location: string | null;
      },
      /** Only check that the time is still free (before the reply goes out). */
      check = false,
    ): Promise<InterviewView> {
      const interview = await row(interviewId);
      if (interview.status !== 'scheduled')
        throw new HrError('INTERVIEW_NOT_SCHEDULED', 409);
      const conflicts = await calendar.conflicts({
        interviewerUserIds: interview.interviewerUserIds,
        start: option.start,
        end: option.end,
        ignoreInterviewId: interview.id,
      });
      if (conflicts.length)
        throw new HrError('INTERVIEW_CALENDAR_CONFLICT', 409, {
          names: [...new Set(conflicts.map((c) => c.name ?? c.userId))].join(
            '、',
          ),
        });
      if (option.slotKey) {
        const application = await candidates.applicationRow(
          interview.applicationId,
        );
        const posting = await deps.postings.get(application.postingId);
        const slot = posting.interviewSlots.find(
          (s) => s.start === option.slotKey,
        );
        const counts = await deps.postings.bookedCounts(posting.id);
        if (!slot || (counts.get(slot.start) ?? 0) >= slot.capacity)
          throw new HrError('BOOKING_SLOT_FULL', 409);
      }
      if (check) return interview;
      const previous = interview.scheduledAt;
      await database
        .query()
        .updateTable('interviews')
        .set({
          scheduledAt: new Date(option.start),
          durationMinutes: Math.max(
            10,
            Math.round(
              (new Date(option.end).getTime() -
                new Date(option.start).getTime()) /
                60_000,
            ),
          ),
          slotKey: option.slotKey,
          locationOrLink: option.location,
          // The reminder the day before goes out again for the new time.
          reminderSentAt: null,
          updatedAt: new Date(),
        })
        .where('id', '=', interview.id)
        .execute();
      const moved = await row(interview.id);
      const application = await candidates.applicationRow(moved.applicationId);
      const candidate = await candidates.candidateRow(application.candidateId);
      await platform.notify({
        key: `interview:${moved.id}:rescheduled:${moved.scheduledAt}`,
        userIds: moved.interviewerUserIds,
        message: 'recruitingInterviewRescheduled',
        params: {
          name: candidate.name,
          from: localDateTime(previous, platform.timeZone),
          time: localDateTime(moved.scheduledAt, platform.timeZone),
        },
        path: `/talent/interviews/${moved.id}`,
      });
      return moved;
    },

    /** 我的面试 (mine=1), or the recruiter's rounds. */
    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'view');
      const rows = await database
        .query()
        .selectFrom('interviews')
        .innerJoin(
          'applications',
          'applications.id',
          'interviews.applicationId',
        )
        .innerJoin('candidates', 'candidates.id', 'applications.candidateId')
        .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
        .innerJoin(
          'jobRequisitions',
          'jobRequisitions.id',
          'jobPostings.requisitionId',
        )
        .select([
          'interviews.id as id',
          'interviews.round as round',
          'interviews.mode as mode',
          'interviews.scheduledAt as scheduledAt',
          'interviews.status as status',
          'interviews.interviewerUserIds as interviewerUserIds',
          'interviews.scorecards as scorecards',
          'interviews.questionPlan as questionPlan',
          'interviews.selfBooked as selfBooked',
          'candidates.name as name',
          'jobPostings.title as postingTitle',
          'jobRequisitions.recruiterUserId as recruiterUserId',
        ])
        .orderBy('interviews.scheduledAt', 'asc')
        .execute();
      const recruiter = await ctx.can(actor, COMPOSITE.interview, 'schedule');
      const mineOnly = query.mine === '1' || !recruiter;
      return {
        items: rows
          .filter((r) => {
            const mine = json<string[]>(r.interviewerUserIds, []).includes(
              actor.userId,
            );
            return mineOnly
              ? mine
              : mine || str(r.recruiterUserId) === actor.userId;
          })
          .map((r) => ({
            id: str(r.id),
            round: num(r.round, 1),
            mode: str(r.mode),
            scheduledAt: iso(r.scheduledAt),
            status: str(r.status),
            candidateName: str(r.name),
            postingTitle: str(r.postingTitle),
            selfBooked: r.selfBooked === true || r.selfBooked === 1,
            hasQuestions: Boolean(json(r.questionPlan, null)),
            interviewerCount: json<string[]>(r.interviewerUserIds, []).length,
            submittedCount: json<Scorecard[]>(r.scorecards, []).length,
            mine: json<string[]>(r.interviewerUserIds, []).includes(
              actor.userId,
            ),
          })),
        can: { schedule: recruiter },
      };
    },

    async detail(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'view');
      const interview = await row(id);
      const a = await access(actor, interview);
      if (!a.recruiter && !a.interviewer && !a.manager)
        throw new HrError('INTERVIEW_NOT_FOUND', 404);
      return present(actor, interview);
    },

    /** Checks the interviewers' calendars before scheduling. */
    async checkCalendar(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'schedule');
      const parsed = z
        .object({
          interviewerUserIds: z.array(z.string().min(1).max(64)).min(1).max(10),
          scheduledAt: z.string().datetime({ offset: true }),
          durationMinutes: z.number().int().min(10).max(480).default(60),
          ignoreInterviewId: z.string().max(64).nullish(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const start = new Date(parsed.data.scheduledAt);
      return {
        conflicts: await calendar.conflicts({
          interviewerUserIds: parsed.data.interviewerUserIds,
          start: start.toISOString(),
          end: new Date(
            start.getTime() + parsed.data.durationMinutes * 60_000,
          ).toISOString(),
          ignoreInterviewId: parsed.data.ignoreInterviewId,
        }),
      };
    },

    async schedule(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'schedule');
      const parsed = scheduleSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const data = parsed.data;
      const application = await candidates.applicationRow(data.applicationId);
      const a = await candidates.access(actor, application);
      if (!a.recruiter) throw new HrError('APPLICATION_NOT_FOUND', 404);
      if (['rejected', 'withdrawn', 'hired'].includes(application.stage))
        throw new HrError('APPLICATION_STAGE_INVALID', 409);
      const start = new Date(data.scheduledAt);
      const conflicts = await calendar.conflicts({
        interviewerUserIds: data.interviewerUserIds,
        start: start.toISOString(),
        end: new Date(
          start.getTime() + data.durationMinutes * 60_000,
        ).toISOString(),
      });
      if (conflicts.length)
        throw new HrError('INTERVIEW_CALENDAR_CONFLICT', 409, {
          names: [...new Set(conflicts.map((c) => c.name ?? c.userId))].join(
            '、',
          ),
          conflicts,
        });
      const id = await service.createTrusted({
        applicationId: application.id,
        mode: data.mode,
        scheduledAt: start.toISOString(),
        durationMinutes: data.durationMinutes,
        locationOrLink: data.locationOrLink ?? null,
        interviewerUserIds: data.interviewerUserIds,
        slotKey: null,
        selfBooked: false,
        by: actor.userId,
      });
      // 给候选人的面试邀请须招聘负责人确认后发送: a draft from the template.
      const interview = await row(id);
      const candidate = await candidates.candidateRow(application.candidateId);
      const template = await deps.templates.get('invitation');
      const values = {
        name: candidate.name,
        position: a.posting.title,
        time: localDateTime(interview.scheduledAt, platform.timeZone),
        location: interview.locationOrLink ?? '',
      };
      await candidates.addDraftMessage(application.id, {
        type: 'invitation',
        subject: fill(template.subject, values),
        body: fill(template.body, values),
        draftedBy: 'rule',
        interviewId: id,
      });
      return service.detail(actor, id);
    },

    /** Shared by scheduling and self-booking; outside any transaction. */
    async createTrusted(input: {
      applicationId: string;
      mode: 'onsite' | 'video' | 'phone' | 'ai';
      scheduledAt: string;
      durationMinutes: number;
      locationOrLink: string | null;
      interviewerUserIds: string[];
      slotKey: string | null;
      selfBooked: boolean;
      by: string;
    }): Promise<string> {
      const application = await candidates.applicationRow(input.applicationId);
      const rounds = await database
        .query()
        .selectFrom('interviews')
        .select(['round'])
        .where('applicationId', '=', input.applicationId)
        .execute();
      const round = Math.max(0, ...rounds.map((r) => num(r.round))) + 1;
      const id = newId();
      const now = new Date();
      await database
        .query()
        .insertInto('interviews')
        .values({
          id,
          applicationId: input.applicationId,
          round,
          mode: input.mode,
          scheduledAt: new Date(input.scheduledAt),
          durationMinutes: input.durationMinutes,
          locationOrLink: input.locationOrLink,
          interviewerUserIds: input.interviewerUserIds,
          questionPlan: null,
          questionPlanAt: null,
          scorecards: [],
          aiSummary: null,
          summaryAt: null,
          status: 'scheduled',
          slotKey: input.slotKey,
          selfBooked: input.selfBooked,
          changesUsed: 0,
          reminderSentAt: null,
          scheduledBy: input.by,
          consentAt: null,
          transcript: null,
          aiReport: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      if (
        input.mode !== 'ai' &&
        ['applied', 'screening'].includes(application.stage)
      )
        await candidates.stamp(
          input.applicationId,
          application.stage,
          'interview',
          input.by,
        );
      const candidate = await candidates.candidateRow(application.candidateId);
      if (input.mode !== 'ai')
        await notifyInterviewers(await row(id), candidate.name);
      return id;
    },

    async cancel(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'schedule');
      const interview = await row(id);
      if (!(await access(actor, interview)).recruiter)
        throw new HrError('INTERVIEW_NOT_FOUND', 404);
      await database
        .query()
        .updateTable('interviews')
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async markNoShow(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'schedule');
      const interview = await row(id);
      if (!(await access(actor, interview)).recruiter)
        throw new HrError('INTERVIEW_NOT_FOUND', 404);
      if (interview.status !== 'scheduled')
        throw new HrError('INTERVIEW_NOT_SCHEDULED', 409);
      await database
        .query()
        .updateTable('interviews')
        .set({ status: 'noShow', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /** 面试题: the recruiter or an interviewer edits the plan; each question names a requirement. */
    async savePlan(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'view');
      const interview = await row(id);
      const a = await access(actor, interview);
      if (!a.recruiter && !a.interviewer)
        throw new HrError('INTERVIEW_NOT_FOUND', 404);
      await service.savePlanTrusted(id, input, a.posting.requirements);
      return service.detail(actor, id);
    },

    async savePlanTrusted(
      id: string,
      input: unknown,
      requirements: readonly { key: string }[],
    ) {
      const parsed = questionPlanSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const keys = new Set(requirements.map((r) => r.key));
      if (parsed.data.some((q) => !keys.has(q.requirementKey)))
        throw new HrError('INTERVIEW_PLAN_REQUIREMENT_INVALID', 400);
      const now = new Date();
      await database
        .query()
        .updateTable('interviews')
        .set({ questionPlan: parsed.data, questionPlanAt: now, updatedAt: now })
        .where('id', '=', id)
        .execute();
    },

    /** 面试官提交评分 (only for this interview, as one of its interviewers). */
    async submitScorecard(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.interview, 'score');
      const interview = await row(id);
      if (!interview.interviewerUserIds.includes(actor.userId))
        throw new HrError('INTERVIEW_NOT_INTERVIEWER', 403);
      if (interview.status !== 'scheduled')
        throw new HrError('INTERVIEW_NOT_SCHEDULED', 409);
      const parsed = scorecardSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const application = await candidates.applicationRow(
        interview.applicationId,
      );
      const posting = (await candidates.access(actor, application)).posting;
      const keys = new Set(posting.requirements.map((r) => r.key));
      if (
        parsed.data.requirementScores.some((s) => !keys.has(s.requirementKey))
      )
        throw new HrError('INTERVIEW_PLAN_REQUIREMENT_INVALID', 400);
      const card: Scorecard = {
        userId: actor.userId,
        requirementScores: parsed.data.requirementScores,
        recommendation: parsed.data.recommendation,
        notes: parsed.data.notes ?? null,
        submittedAt: new Date().toISOString(),
      };
      const scorecards = [
        ...interview.scorecards.filter((s) => s.userId !== actor.userId),
        card,
      ];
      const complete = interview.interviewerUserIds.every((u) =>
        scorecards.some((s) => s.userId === u),
      );
      await database
        .query()
        .updateTable('interviews')
        .set({
          scorecards,
          ...(complete ? { status: 'completed' } : {}),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      // This interviewer has scored: their 面试安排 and 面试题 to-dos are done;
      // once everyone has, nobody's are left open.
      await closeWorkItems(database.query(), {
        refIds: [`interviewQuestions:${id}`],
        prefixes: [`interview:${id}:scheduled:`],
        ...(complete ? {} : { recipientUserId: actor.userId }),
      });
      if (complete) deps.onAllScored(id);
      return service.detail(actor, id);
    },

    async saveSummaryTrusted(id: string, summary: Record<string, unknown>) {
      const now = new Date();
      await database
        .query()
        .updateTable('interviews')
        .set({ aiSummary: summary, summaryAt: now, updatedAt: now })
        .where('id', '=', id)
        .execute();
    },

    /** Interviews starting within the next 24 hours without a question plan (每小时). */
    async needingPlans(now: Date) {
      const until = new Date(now.getTime() + 24 * 3_600_000);
      const rows = await database
        .query()
        .selectFrom('interviews')
        .select(['id', 'scheduledAt', 'questionPlan'])
        .where('status', '=', 'scheduled')
        .where('mode', '!=', 'ai')
        .execute();
      // Compared as instants, and the JSON column read as a value (a stored null may be the text "null").
      return rows
        .filter((r) => {
          const at = new Date(str(r.scheduledAt)).getTime();
          return (
            !json(r.questionPlan, null) &&
            at >= now.getTime() &&
            at <= until.getTime()
          );
        })
        .map((r) => str(r.id));
    },
  };
  return service;
}

export type InterviewService = ReturnType<typeof createInterviewService>;

/**
 * 招聘报表 (V2-07): conversion by stage, days from publishing to joining,
 * channels, the screening agreement rate, interview attendance and the AI
 * initial interview's scores against the later human verdicts.
 *
 * A recruiter (`detail`) sees their own requisitions, each with its numbers;
 * hr.admin (`view` only) sees the totals — never a candidate row.
 */
import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { daysBetween, str } from '../shared.js';
import { agrees } from './candidates.js';
import { day, json, type ScreeningSuggestion } from './common.js';
import type { RecruitingContext } from './context.js';
import type { Scorecard } from './interviews.js';
import { COMPOSITE } from './resources.js';

const FUNNEL = ['applied', 'screening', 'interview', 'offer', 'hired'] as const;

export function createReports(ctx: RecruitingContext) {
  const { database } = ctx;

  return {
    async report(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.report, 'view');
      const detail = await ctx.can(actor, COMPOSITE.report, 'detail');
      const rows = await database
        .query()
        .selectFrom('applications')
        .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
        .innerJoin('jobRequisitions', 'jobRequisitions.id', 'jobPostings.requisitionId')
        .select([
          'applications.id as id',
          'applications.stage as stage',
          'applications.stageHistory as stageHistory',
          'applications.sourceChannel as sourceChannel',
          'applications.screeningSuggestion as screeningSuggestion',
          'applications.screeningDecision as screeningDecision',
          'applications.createdAt as createdAt',
          'jobPostings.publishedAt as publishedAt',
          'jobRequisitions.id as requisitionId',
          'jobRequisitions.recruiterUserId as recruiterUserId',
        ])
        .execute();
      // A recruiter's report covers their requisitions; the summary everything (numbers only).
      const scoped = detail
        ? rows.filter((r) => str(r.recruiterUserId) === actor.userId)
        : rows;
      const filtered = query.requisitionId
        ? scoped.filter((r) => str(r.requisitionId) === query.requisitionId)
        : scoped;
      const reached = (r: (typeof rows)[number]) => {
        const history = json<{ to: string }[]>(r.stageHistory, []);
        const set = new Set(history.map((h) => h.to));
        set.add(str(r.stage));
        // Reaching a later stage means the earlier ones were passed.
        const index = Math.max(...FUNNEL.map((s, i) => (set.has(s) ? i : -1)));
        return FUNNEL.filter((_s, i) => i <= index);
      };
      const funnel = FUNNEL.map((stage) => ({
        stage,
        count: filtered.filter((r) => reached(r).includes(stage)).length,
      }));
      const conversion = funnel.map((f, i) => ({
        ...f,
        rate: i === 0 || !funnel[i - 1].count ? null : Math.round((f.count / funnel[i - 1].count) * 1000) / 10,
      }));
      // 从发布到入职: the posting's publication to the offer's start date, for onboarded hires.
      const hires = await database
        .query()
        .selectFrom('offers')
        .innerJoin('applications', 'applications.id', 'offers.applicationId')
        .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
        .select([
          'offers.startDate as startDate',
          'offers.preboarding as preboarding',
          'jobPostings.publishedAt as publishedAt',
          'applications.id as applicationId',
        ])
        .where('offers.status', '=', 'accepted')
        .execute();
      const ids = new Set(filtered.map((r) => str(r.id)));
      const cycle = hires
        .filter((h) => ids.has(str(h.applicationId)) && h.publishedAt)
        .filter((h) => json<{ onboardedAt?: string | null }>(h.preboarding, {}).onboardedAt)
        .map((h) => daysBetween(day(h.publishedAt)!, day(h.startDate)!));
      const channels = new Map<string, { applications: number; hired: number }>();
      for (const r of filtered) {
        const c = channels.get(str(r.sourceChannel)) ?? { applications: 0, hired: 0 };
        c.applications += 1;
        if (str(r.stage) === 'hired') c.hired += 1;
        channels.set(str(r.sourceChannel), c);
      }
      const decided = filtered.filter(
        (r) => r.screeningDecision && json<ScreeningSuggestion | null>(r.screeningSuggestion, null),
      );
      const agreed = decided.filter((r) =>
        agrees(
          json<ScreeningSuggestion>(r.screeningSuggestion, { matchLevel: 'medium' } as ScreeningSuggestion).matchLevel,
          str(r.screeningDecision) as 'advance' | 'hold' | 'reject',
        ),
      );
      const interviews = await database
        .query()
        .selectFrom('interviews')
        .select(['applicationId', 'status', 'mode', 'aiReport', 'scorecards'])
        .execute();
      const mine = interviews.filter((i) => ids.has(str(i.applicationId)));
      const held = mine.filter((i) => ['completed', 'noShow'].includes(str(i.status)) && str(i.mode) !== 'ai');
      const attended = held.filter((i) => str(i.status) === 'completed');
      // AI 初面建议分 against the later human interview's recommendation.
      const ai = mine
        .filter((i) => str(i.mode) === 'ai' && json(i.aiReport, null))
        .map((i) => {
          const report = json<{ items?: { score?: number }[] }>(i.aiReport, {});
          const scores = (report.items ?? []).map((x) => Number(x.score ?? 0)).filter(Boolean);
          const average = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
          const human = mine.find(
            (h) => str(h.applicationId) === str(i.applicationId) && str(h.mode) !== 'ai' && str(h.status) === 'completed',
          );
          const cards = human ? json<Scorecard[]>(human.scorecards, []) : [];
          const positive = cards.length
            ? cards.filter((c) => c.recommendation === 'yes' || c.recommendation === 'strongYes').length / cards.length >= 0.5
            : null;
          return { average, positive };
        })
        .filter((x) => x.average !== null && x.positive !== null);
      return {
        scope: detail ? 'mine' : 'summary',
        funnel: conversion,
        averageDaysToHire: cycle.length ? Math.round((cycle.reduce((a, b) => a + b, 0) / cycle.length) * 10) / 10 : null,
        hires: cycle.length,
        channels: [...channels.entries()].map(([name, c]) => ({ name, ...c })),
        screening: {
          decided: decided.length,
          agreed: agreed.length,
          agreementRate: decided.length ? Math.round((agreed.length / decided.length) * 1000) / 10 : null,
        },
        interviews: {
          held: held.length,
          attended: attended.length,
          attendanceRate: held.length ? Math.round((attended.length / held.length) * 1000) / 10 : null,
        },
        aiInterview: {
          compared: ai.length,
          averageScoreWhenAdvanced: avg(ai.filter((x) => x.positive).map((x) => x.average!)),
          averageScoreWhenNot: avg(ai.filter((x) => !x.positive).map((x) => x.average!)),
        },
        // Requisition rows for the recruiter only.
        requisitions: detail
          ? [...new Set(scoped.map((r) => str(r.requisitionId)))].map((id) => ({
              id,
              applications: scoped.filter((r) => str(r.requisitionId) === id).length,
              hired: scoped.filter((r) => str(r.requisitionId) === id && str(r.stage) === 'hired').length,
            }))
          : [],
      };
    },
  };
}

function avg(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}

export type Reports = ReturnType<typeof createReports>;

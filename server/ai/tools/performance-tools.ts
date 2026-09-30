/**
 * V4-12 绩效助理 tools. Every tool runs as the person in the conversation,
 * through the same authorization and reviewer relation as the pages. No tool
 * writes `items`, `overallRating`, `finalRating` or a calibration: the
 * assistant drafts, checks and explains; people score, rate and calibrate.
 * No tool returns a bonus coefficient, another person's rating or a peer's
 * identity.
 */
import { defineTools } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import {
  authorizeAction,
  scopeForUser,
  tryAuthorizeAction,
} from '../../providers/hr/authorize.js';
import { teamEmployeeIds } from '../../providers/hr/performance/record-access.js';
import { HrError, str } from '../../providers/hr/shared.js';
import { performanceServicesToken } from '../../providers/hr/tokens.js';

const I18N = { namespace: 'hr' };
const ASSISTANT = 'talent.performanceAssistant';

async function actorOf(ctx: {
  actor: { id: string | number };
  deps: { authz: Parameters<typeof scopeForUser>[0] };
}) {
  const userId = String(ctx.actor.id);
  return { userId, authz: await scopeForUser(ctx.deps.authz, userId) };
}

function failure(error: unknown) {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
}

const deps = {
  performance: performanceServicesToken,
  authz: authorizationToken,
};

export const getReviewContext = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read a review task',
    about:
      'The goals and progress, evidence snapshot and summary, self review, anonymous peer summary and position requirements of a review the caller writes.',
  },
  definition: {
    name: 'getReviewContext',
    description:
      "Read one review task of the caller (they must be its reviewer): the person's goals and progress, the evidence snapshot (counts and record numbers, never issue descriptions) and summary, the self review, the anonymous peer summary, the position requirements and the reference score. Peers see the goals only.",
    schema: z.object({ reviewId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { reviewId: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      return {
        status: 'success',
        content: await ctx.deps.performance.reviews.context(
          actor,
          args.reviewId,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const getSchemeRules = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read scheme rules',
    about:
      'Dimensions, weights, the rating scale and the quality and safety rules of a scheme.',
  },
  definition: {
    name: 'getSchemeRules',
    description:
      'Read a review scheme: dimensions and weights, the rating scale, the enabled stages, the quality and safety rules and the scoring parameters, to answer rule questions. Bonus coefficients are never returned.',
    schema: z.object({ schemeId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { schemeId: string }) => {
    try {
      const actor = await actorOf(ctx);
      return {
        status: 'success',
        content: await ctx.deps.performance.schemes.rules(actor, args.schemeId),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const getMyReviewProgress = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'My review progress',
    about: "The caller's own review cycles: stage, deadline, goals and tasks.",
  },
  definition: {
    name: 'getMyReviewProgress',
    description:
      'Answer "我的考核到哪一步了": the caller\'s own cycles with the current stage and its deadline, how many goals are drafted / submitted / approved, the self review status, open peer tasks and whether the result is published. Contains no comment and no rating.',
    schema: z.object({}),
  },
  dependencies: deps,
  invoke: async (ctx) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      const me = await ctx.deps.performance.me(actor);
      return {
        status: 'success',
        content: {
          cycles: me.cycles.map((c) => ({
            cycleTitle: c.cycleTitle,
            stage: c.cycleStatus,
            deadline: c.deadline,
            resultStatus: c.resultStatus,
            goals: c.goals,
            selfReview:
              c.selfReview?.status ?? (c.noAccount ? 'noAccount' : 'none'),
            openPeerTasks: c.peerTasks,
            published: c.published,
            link: '/talent/my-review',
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveEvidenceSummary = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Save an evidence summary',
    about: "Writes a participant's evidence summary (at most 150 characters).",
  },
  definition: {
    name: 'saveEvidenceSummary',
    description:
      "Write the evidence summary of a review result (at most 150 characters: attendance, learning and certificates, quality issues by number, competency changes). Only HR administrators or the person's manager reviewer.",
    schema: z.object({
      resultId: z.string().min(1).max(64),
      summary: z.string().trim().min(1).max(150),
    }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { resultId: string; summary: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      const services = ctx.deps.performance;
      const result = await services.context.result(args.resultId);
      const admin = await tryAuthorizeAction(
        actor.authz,
        'talent.reviewCycle',
        'manage',
      );
      if (!admin && result.managerUserId !== actor.userId)
        throw new HrError('FORBIDDEN', 403);
      await services.context.database
        .query()
        .updateTable('reviewResults')
        .set({ evidenceSummary: args.summary, updatedAt: new Date() })
        .where('id', '=', args.resultId)
        .execute();
      return {
        status: 'success',
        content: { resultId: args.resultId, saved: true },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveReviewDraft = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Save a comment draft',
    about:
      'Writes the AI draft of a review the caller writes; never the form itself.',
  },
  definition: {
    name: 'saveReviewDraft',
    description:
      "Write the AI draft card of a manager or skip-level review the caller writes: the comment (facts with their sources, no overall rating), per-item suggestions and the evidence references. It does not change the review's items, overall rating or status; the reviewer adopts it into the form themselves.",
    schema: z.object({
      reviewId: z.string().min(1).max(64),
      comment: z.string().trim().min(1).max(2000),
      itemSuggestions: z
        .object({
          goals: z
            .array(
              z.object({ goalId: z.string(), comment: z.string().max(500) }),
            )
            .max(20)
            .default([]),
          competencies: z
            .array(
              z.object({
                competencyId: z.string(),
                comment: z.string().max(500),
              }),
            )
            .max(40)
            .default([]),
          qualitySafety: z
            .object({
              score: z.number().min(1).max(5).nullable(),
              comment: z.string().max(500),
            })
            .nullable()
            .default(null),
        })
        .default({ goals: [], competencies: [], qualitySafety: null }),
      evidenceRefs: z
        .array(
          z.object({
            type: z.string().max(32),
            id: z.string().max(64),
            label: z.string().max(100),
          }),
        )
        .max(50)
        .default([]),
    }),
  },
  dependencies: deps,
  invoke: async (
    ctx,
    args: {
      reviewId: string;
      comment: string;
      itemSuggestions: unknown;
      evidenceRefs: unknown;
    },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      const review = await ctx.deps.performance.reviews.ownTask(
        actor,
        args.reviewId,
        'write',
      );
      if (review.role !== 'manager' && review.role !== 'skipLevel')
        throw new HrError('REVIEW_NOT_FOUND', 404);
      await ctx.deps.performance.assistant.saveDraft(review.id, {
        comment: args.comment,
        itemSuggestions: args.itemSuggestions,
        evidenceRefs: args.evidenceRefs,
      });
      return {
        status: 'success',
        content: { reviewId: review.id, saved: true },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const suggestGoalDrafts = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Draft goals',
    about: 'Creates up to four AI goal drafts for an employee without goals.',
  },
  definition: {
    name: 'suggestGoalDrafts',
    description:
      'Create up to four measurable goal drafts (source ai, status draft) for oneself or a team member in the review cycle now setting goals, aligned to department goals where possible. Refused when the employee already has a goal. The employee edits and submits them; the manager approves.',
    schema: z.object({
      employeeId: z.string().min(1).max(64),
      cycleId: z.string().min(1).max(64).optional(),
      goals: z
        .array(
          z.object({
            title: z.string().trim().min(1).max(300),
            measure: z.string().trim().min(1).max(2000),
            weight: z.number().int().min(0).max(100).nullish(),
            alignedGoalId: z.string().min(1).max(64).nullish(),
          }),
        )
        .min(1)
        .max(4),
    }),
  },
  dependencies: deps,
  invoke: async (
    ctx,
    args: {
      employeeId: string;
      cycleId?: string;
      goals: {
        title: string;
        measure: string;
        weight?: number | null;
        alignedGoalId?: string | null;
      }[];
    },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      const services = ctx.deps.performance;
      const own = await services.context.platform.employeeOfUser(actor.userId);
      const team = await teamEmployeeIds(
        services.context.database,
        services.context.platform.organization,
        actor.userId,
      );
      if (own?.id !== args.employeeId && !team.includes(args.employeeId))
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      let cycleId = args.cycleId;
      if (!cycleId) {
        const rows = await services.context.database
          .query()
          .selectFrom('reviewResults')
          .innerJoin('reviewCycles', 'reviewCycles.id', 'reviewResults.cycleId')
          .select(['reviewCycles.id as id'])
          .where('reviewResults.employeeId', '=', args.employeeId)
          .where('reviewCycles.status', '=', 'goalSetting')
          .execute();
        cycleId = rows[0] ? str(rows[0].id) : undefined;
      }
      if (!cycleId) throw new HrError('REVIEW_NOT_PARTICIPANT', 404);
      const created = await services.goals.createAiDrafts(
        cycleId,
        args.employeeId,
        args.goals,
      );
      return {
        status: 'success',
        content: {
          cycleId,
          goals: created.map((g) => ({
            id: g.id,
            title: g.title,
            weight: g.weight,
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const listRatingAnomalies = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List rating anomalies',
    about:
      'The server-computed inconsistencies of a cycle within the caller’s calibration scope.',
  },
  definition: {
    name: 'listRatingAnomalies',
    description:
      'Rating anomalies of a review cycle within the caller’s calibration scope, computed on the server: rating two or more grades from the reference score; a high rating with a quality-and-safety reference of 2 or less; one reviewer giving the same rating to everyone; a comment citing no concrete fact; peers and manager far apart. Numbers and record numbers only.',
    schema: z.object({
      cycleId: z.string().min(1).max(64),
      departmentId: z.string().min(1).max(64).optional(),
    }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { cycleId: string; departmentId?: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      const view = await ctx.deps.performance.results.calibration(
        actor,
        args.cycleId,
        {
          departmentId: args.departmentId,
        },
      );
      return {
        status: 'success',
        content: view.results
          .filter((r) => r.anomalies.length)
          .map((r) => ({
            resultId: r.resultId,
            name: r.name,
            departmentTitle: r.departmentTitle,
            anomalies: r.anomalies,
          })),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const sendReviewHints = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Send review hints',
    about:
      'An in-app message to the reviewer with a link to the review; once per submission.',
  },
  definition: {
    name: 'sendReviewHints',
    description:
      'Send the reviewer of a submitted review an in-app message with the hints and a link to the review page, at most once per submission. Hints point out inconsistencies and missing evidence only — never a rating to give. The caller must be the reviewer or an HR administrator.',
    schema: z.object({
      reviewId: z.string().min(1).max(64),
      hints: z
        .array(
          z.object({
            type: z.string().max(32),
            text: z.string().trim().min(1).max(300),
          }),
        )
        .min(1)
        .max(10),
    }),
  },
  dependencies: deps,
  invoke: async (
    ctx,
    args: { reviewId: string; hints: { type: string; text: string }[] },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      const services = ctx.deps.performance;
      const review = await services.context.review(args.reviewId);
      const admin = await tryAuthorizeAction(
        actor.authz,
        'talent.reviewCycle',
        'manage',
      );
      if (!admin && review.reviewerUserId !== actor.userId)
        throw new HrError('REVIEW_NOT_FOUND', 404);
      if (review.status !== 'submitted')
        throw new HrError('REVIEW_NOT_SUBMITTED', 409);
      const sent = await services.assistant.sendHints(review, args.hints);
      return { status: 'success', content: { reviewId: review.id, sent } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveCalibrationPack = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Save the calibration pack',
    about: 'The calibration material shown at the top of the calibration page.',
  },
  definition: {
    name: 'saveCalibrationPack',
    description:
      'Save the calibration material of a cycle (distribution against the guide per department and scheme, the anomaly list and reasons). It changes no rating. HR administrators only.',
    schema: z.object({
      cycleId: z.string().min(1).max(64),
      content: z.string().trim().min(1).max(4000),
    }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { cycleId: string; content: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, ASSISTANT, 'use');
      await authorizeAction(actor.authz, 'talent.calibration', 'adjust');
      const services = ctx.deps.performance;
      await services.context.cycle(args.cycleId);
      await services.context.database
        .query()
        .updateTable('reviewCycles')
        .set({
          calibrationPack: {
            content: args.content,
            generatedAt: new Date().toISOString(),
            source: 'ai',
            runId: null,
          },
          updatedAt: new Date(),
        })
        .where('id', '=', args.cycleId)
        .execute();
      return {
        status: 'success',
        content: { cycleId: args.cycleId, saved: true },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const PERFORMANCE_TOOLS = [
  getReviewContext,
  getSchemeRules,
  getMyReviewProgress,
  saveEvidenceSummary,
  saveReviewDraft,
  suggestGoalDrafts,
  listRatingAnomalies,
  sendReviewHints,
  saveCalibrationPack,
];

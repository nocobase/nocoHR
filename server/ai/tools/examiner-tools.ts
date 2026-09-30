import { defineTools } from '@nocobase/ai-employee';
import {
  authorizationToken,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { authorizeAction, scopeForUser } from '../../providers/hr/authorize.js';
import { HrError } from '../../providers/hr/shared.js';
import { examServiceToken } from '../../providers/hr/tokens.js';

/**
 * V3-10 考官 tools. Grading material and suggestions are for the exam's
 * graders (its instructor or HR); a candidate reads only their own result,
 * with answers only as the exam's `showAnswersAfter` allows. None of these
 * voids an attempt or resets attempts: only people do that.
 */
const I18N = { namespace: 'hr' };
const EXAMINER = 'talent.examiner';

async function actorContext(
  deps: { authz: AppAuthorization },
  actor: { id: string | number },
) {
  const userId = String(actor.id);
  const context = { authz: await scopeForUser(deps.authz, userId), userId };
  await authorizeAction(context.authz, EXAMINER, 'use');
  return context;
}

function failure(error: unknown) {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
}

export const getAttemptForGrading = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read an attempt for grading',
    about:
      'Reads the short answers of an attempt with the reference answers and grading points, for its grader.',
  },
  definition: {
    name: 'getAttemptForGrading',
    description:
      'For the exam’s grader only: the short-answer questions of one attempt with the reference answer, grading points, the candidate’s answer and any saved suggestion.',
    schema: z.object({ attemptId: z.string() }),
  },
  dependencies: { exams: examServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { attemptId: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.exams.gradingMaterial(
          await actorContext(ctx.deps, ctx.actor),
          args.attemptId,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveGradingSuggestion = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Save a suggested score',
    about:
      'Saves a suggested score for one short answer; it does not change the attempt’s status or score.',
  },
  definition: {
    name: 'saveGradingSuggestion',
    description:
      'Save the suggested score for one short answer: score (not above the question’s points), matched and missing grading points, rationale. The instructor still submits the final score. An answer that already has a suggestion keeps it.',
    schema: z.object({
      attemptId: z.string(),
      questionId: z.string(),
      score: z.number().min(0),
      matchedPoints: z.array(z.string()).max(20),
      missingPoints: z.array(z.string()).max(20),
      rationale: z.string().min(1).max(1500),
    }),
  },
  dependencies: { exams: examServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      attemptId: string;
      questionId: string;
      score: number;
      matchedPoints: string[];
      missingPoints: string[];
      rationale: string;
    },
  ) => {
    try {
      const { attemptId, ...suggestion } = args;
      return {
        status: 'success',
        content: await ctx.deps.exams.saveGradingSuggestion(
          await actorContext(ctx.deps, ctx.actor),
          attemptId,
          suggestion,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const explainMyResult = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Explain my exam result',
    about:
      'Reads the current user’s own attempt: points lost by competency and, when allowed, answers and explanations.',
  },
  definition: {
    name: 'explainMyResult',
    description:
      'The current user’s own attempt result: score, pass line, points lost by competency with courses, and per question the points earned. Correct answers and explanations appear only when the exam allows showing them (answersVisible); otherwise never reveal or guess them. Without attemptId, the latest scored attempt is used.',
    schema: z.object({ attemptId: z.string().optional() }),
  },
  dependencies: { exams: examServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { attemptId?: string }) => {
    try {
      const context = await actorContext(ctx.deps, ctx.actor);
      let attemptId = args.attemptId;
      if (!attemptId) {
        const mine = await ctx.deps.exams.myExams(context);
        attemptId =
          mine.find((exam) => exam.latestAttemptId && !exam.inProgressAttemptId)
            ?.latestAttemptId ?? undefined;
        if (!attemptId) throw new HrError('ATTEMPT_NOT_FOUND', 404);
      }
      const result = await ctx.deps.exams.explainResult(context, attemptId);
      return {
        status: 'success',
        content: {
          examTitle: result.examTitle,
          status: result.status,
          score: result.score,
          passScore: result.passScore,
          answersVisible: result.answersVisible,
          lossByCompetency: result.lossByCompetency,
          weakAreas: result.wrongByCompetency,
          items: result.items.map((item) => ({
            stem: item.stem,
            score: item.score,
            earned: item.earned,
            ...(result.answersVisible
              ? {
                  correct: item.correct,
                  answer: item.answer,
                  explanation: item.explanation,
                  comment: item.comment,
                }
              : {}),
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

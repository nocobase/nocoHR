import { defineTools } from '@nocobase/ai-employee';
import {
  authorizationToken,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { MACHINE_START } from '../../providers/hr/industry-packs/manufacturing.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  demoBatchServiceToken,
  industryPackServiceToken,
  examServiceToken,
  insightServiceToken,
  learningServiceToken,
} from '../../providers/hr/tokens.js';
import { PACK_DISABLED_NOTE } from './licensed-tools.js';

const I18N = { namespace: 'hr' };

async function actorContext(
  deps: { authz: AppAuthorization },
  actor: { id: string | number },
) {
  const userId = String(actor.id);
  return { authz: await scopeForUser(deps.authz, userId), userId };
}

function failure(error: unknown) {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
}

/** Reads a course's lessons and cited sources, for writing questions from it. */
export const getCourse = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read a course',
    about: 'Reads the lessons of a course the current user manages.',
  },
  definition: {
    name: 'getCourse',
    description:
      'Read one course the current user may manage: title, source document id and every lesson with its content and cited source excerpt.',
    schema: z.object({ courseId: z.string() }),
  },
  dependencies: { learning: learningServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { courseId: string }) => {
    try {
      const course = await ctx.deps.learning.getCourse(
        await actorContext(ctx.deps, ctx.actor),
        args.courseId,
      );
      if (!course) throw new HrError('COURSE_NOT_FOUND', 404);
      return {
        status: 'success',
        content: {
          id: course.id,
          title: course.title,
          sourceDocumentId: course.sourceDocumentId,
          competencies: course.competencies,
          lessons: course.lessons.map((l) => ({
            title: l.title,
            content: l.content,
            sourceExcerpt: l.sourceExcerpt,
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Lists existing questions so new ones do not duplicate them. */
export const listQuestions = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List questions',
    about:
      'Lists existing questions of a document or competency, to avoid duplicates.',
  },
  definition: {
    name: 'listQuestions',
    description:
      'List existing questions (id, type, stem summary, review status, drafts included) by source document, source course or competency, and their number. Call it before proposing new questions to avoid duplicates and to judge how many a course already has.',
    schema: z.object({
      sourceDocumentId: z.string().optional(),
      sourceCourseId: z.string().optional(),
      competencyId: z.string().optional(),
    }),
  },
  dependencies: { exams: examServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      sourceDocumentId?: string;
      sourceCourseId?: string;
      competencyId?: string;
    },
  ) => {
    try {
      const questions = await ctx.deps.exams.questionSummaries(
        await actorContext(ctx.deps, ctx.actor),
        args,
      );
      return {
        status: 'success',
        content: { count: questions.length, questions },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

const questionSchema = z.object({
  type: z.enum(['single', 'multiple', 'judge', 'blank', 'short']),
  stem: z.string().min(1).describe('For blanks, mark each blank with ____.'),
  options: z
    .array(z.object({ key: z.string().describe('A, B, C…'), text: z.string() }))
    .optional()
    .describe('Required for single and multiple choice: 2–8 options.'),
  answer: z
    .union([
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.array(z.array(z.string())),
    ])
    .describe(
      'single: "B"; multiple: ["A","C"]; judge: true/false; blank: [["accepted","alternative"], ...] one list per blank; short: the reference answer.',
    ),
  explanation: z.string().optional(),
  gradingNotes: z
    .string()
    .optional()
    .describe('For short answers: the points a grader looks for.'),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  competencyIds: z.array(z.string()).optional(),
  sourceExcerpt: z
    .string()
    .min(1)
    .describe('The source passage the question is based on.'),
});

/** Writes draft questions. Needs the user's approval; drafts never reach a paper until confirmed. */
export const createQuestionDrafts = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Create question drafts',
    about: 'Creates draft questions from a document or course for review.',
  },
  definition: {
    name: 'createQuestionDrafts',
    description:
      'Create draft questions (source=ai, reviewStatus=draft). The answer format must match the type. Every question needs sourceExcerpt. Call only after the user approved the question list. A question with the same stem is not created twice.',
    schema: z.object({
      sourceDocumentId: z.string().optional(),
      sourceCourseId: z
        .string()
        .optional()
        .describe(
          'The course the questions were written from, when writing from a course.',
        ),
      questions: z.array(questionSchema).min(1).max(30),
    }),
  },
  dependencies: { exams: examServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: unknown) => {
    try {
      const result = await ctx.deps.exams.createQuestionDrafts(
        await actorContext(ctx.deps, ctx.actor),
        args,
      );
      return {
        status: 'success',
        content: { ...result, href: '/talent/questions?review=mine' },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Certificates in the caller's scope, ordered by expiry. */
export const listCertificates = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List certificates',
    about: 'Lists certificates in the current user’s scope.',
  },
  definition: {
    name: 'listCertificates',
    description:
      'List certificates of employees in the current user’s scope, ordered by expiry date (soonest first). Filter by certificationId, status (valid, expiring, expired, revoked, superseded), departmentId, or expiresWithinDays.',
    schema: z.object({
      certificationId: z.string().optional(),
      status: z
        .enum(['valid', 'expiring', 'expired', 'revoked', 'superseded'])
        .optional(),
      departmentId: z.string().optional(),
      expiresWithinDays: z.number().int().min(0).max(3650).optional(),
    }),
  },
  dependencies: { insights: insightServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      certificationId?: string;
      status?: string;
      departmentId?: string;
      expiresWithinDays?: number;
    },
  ) => {
    try {
      return {
        status: 'success',
        content: {
          certificates: await ctx.deps.insights.stewardCertificates(
            await actorContext(ctx.deps, ctx.actor),
            args,
          ),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Required-certification holding by position for a department. */
export const teamCertificationSummary = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Team certification summary',
    about: 'Summarizes required certifications by position for a team.',
  },
  definition: {
    name: 'teamCertificationSummary',
    description:
      'Summarize required certifications by position: how many should hold each, valid, expiring, expired, and who is missing. departmentId defaults to the department the current user heads.',
    schema: z.object({ departmentId: z.string().optional() }),
  },
  dependencies: { insights: insightServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { departmentId?: string }) => {
    try {
      return {
        status: 'success',
        content: {
          rows: await ctx.deps.insights.teamSummary(
            await actorContext(ctx.deps, ctx.actor),
            args.departmentId,
          ),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Sends in-app reminders. Needs approval; one reminder per person in 24 hours. */
export const sendCertificationReminder = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Send certification reminders',
    about: 'Sends in-app reminders about certificates to employees in scope.',
  },
  definition: {
    name: 'sendCertificationReminder',
    description:
      'Send an in-app reminder (with a link to learning and exams) to employees in the current user’s scope. List the recipients to the user and get approval first. A person reminded in the last 24 hours is skipped.',
    schema: z.object({
      employeeIds: z.array(z.string()).min(1).max(100),
      note: z.string().max(500).optional(),
    }),
  },
  dependencies: { insights: insightServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { employeeIds: string[]; note?: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.insights.sendReminders(
          await actorContext(ctx.deps, ctx.actor),
          args.employeeIds,
          args.note ?? null,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Who recorded a machine start on a demonstration work order operation, holding which certificate, for audits. */
export const traceBatchSignoffs = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Trace machine start logs',
    about:
      'Shows who started a work order operation and whether their certificate was valid then.',
  },
  definition: {
    name: 'traceBatchSignoffs',
    description:
      'For a demonstration work order (batchNo, such as MO-24031) and optionally an operation (step: op10 粗车, op20 精车, op30 钻孔攻丝; the number alone, such as 20, also works), list each machine start log: operator, time, the certificate number and its status when starting, the certificate status now, and when the operator completed the courses the certification requires. Each entry carries links to the underlying records. Only people in the current user data range are returned. While the manufacturing industry content pack is off the result is packDisabled: true with a note to pass on.',
    schema: z.object({
      batchNo: z.string().min(1).max(32),
      step: z.string().max(32).optional(),
    }),
  },
  dependencies: {
    demoBatch: demoBatchServiceToken,
    industryPacks: industryPackServiceToken,
    authz: authorizationToken,
  },
  invoke: async (ctx, args: { batchNo: string; step?: string }) => {
    try {
      // Machine start logs are the manufacturing pack's (行业内容包).
      if (!(await ctx.deps.industryPacks.catalog()).kinds.has(MACHINE_START))
        return {
          status: 'success',
          content: {
            packDisabled: true,
            signoffs: [],
            note: PACK_DISABLED_NOTE,
          },
        };
      return {
        status: 'success',
        content: {
          signoffs: await ctx.deps.demoBatch.traceSignoffs(
            await actorContext(ctx.deps, ctx.actor),
            args.batchNo,
            args.step,
          ),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

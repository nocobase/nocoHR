import { defineTools } from '@nocobase/ai-employee';
import {
  authorizationToken,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  knowledgeServiceToken,
  learningServiceToken,
} from '../../providers/hr/tokens.js';

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

/**
 * Searches the documents the current user may read. The visibility scope is
 * computed on the server from the caller's identity; the tool takes no scope
 * argument, so neither the model nor the page can widen it.
 */
export const searchKnowledge = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Search the knowledge base',
    about: 'Finds passages in the documents the current user may read.',
  },
  definition: {
    name: 'searchKnowledge',
    description:
      'Search the knowledge base for passages that answer a question. Only documents the current user may read are searched. Returns up to topK passages (default 5), each with the document id and title, section title, excerpt, a relevance score (higher is closer), a citation label and an href that opens the document at that section. Call this for every question before answering, and answer only from the returned passages.',
    schema: z.object({
      query: z
        .string()
        .min(1)
        .describe('The question or the key words to search for.'),
      topK: z.number().int().min(1).max(8).optional(),
    }),
  },
  dependencies: { knowledge: knowledgeServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { query: string; topK?: number }) => {
    try {
      const passages = await ctx.deps.knowledge.search(
        await actorContext(ctx.deps, ctx.actor),
        args.query,
        args.topK ?? 5,
      );
      return {
        status: 'success',
        content: { found: passages.length > 0, passages },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Records a question the knowledge base could not answer. Low risk, so it runs without asking. */
export const recordKnowledgeGap = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Record a knowledge gap',
    about: 'Records a question the knowledge base could not answer.',
  },
  definition: {
    name: 'recordKnowledgeGap',
    description:
      'Record a question that searchKnowledge found no answer for, so the people responsible for the knowledge base can add material. Pass the user question as asked, and the id of the closest document searchKnowledge returned (its relevance was not enough to answer), so its owner is told.',
    schema: z.object({
      question: z
        .string()
        .min(1)
        .max(1000)
        .describe('The unanswered question, in the words the user used.'),
      relatedDocumentId: z
        .string()
        .optional()
        .describe('The closest document searchKnowledge returned, if any.'),
    }),
  },
  dependencies: { knowledge: knowledgeServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: { question: string; relatedDocumentId?: string },
  ) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.knowledge.recordGap(
          await actorContext(ctx.deps, ctx.actor),
          args.question,
          args.relatedDocumentId ?? null,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Suggests published courses the current user may open. */
export const recommendCourses = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Recommend courses',
    about: 'Suggests published courses the current user may open.',
  },
  definition: {
    name: 'recommendCourses',
    description:
      'Find up to 3 published courses the current user may open that relate to a topic or to competencies. Returns id, title, description and href. Use it when a question is better learned systematically than answered once.',
    schema: z.object({
      query: z.string().optional().describe('The topic, in a few words.'),
      competencyIds: z
        .array(z.string())
        .optional()
        .describe('Competency ids the course should cover.'),
    }),
  },
  dependencies: { learning: learningServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { query?: string; competencyIds?: string[] }) => {
    try {
      const courses = await ctx.deps.learning.recommendCourses(
        await actorContext(ctx.deps, ctx.actor),
        args,
      );
      return { status: 'success', content: { courses } };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Reads the course the learner has open, so questions asked while studying have its context. */
export const getCourseContext = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read the current course',
    about: 'Reads the lessons of a course the current user may open.',
  },
  definition: {
    name: 'getCourseContext',
    description:
      'Read the title and lessons of a course the current user may open (the page context names its courseId). Use it to understand what the learner is studying; still answer factual questions from searchKnowledge.',
    schema: z.object({
      courseId: z
        .string()
        .describe('The id of the course the learner has open.'),
    }),
  },
  dependencies: { learning: learningServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { courseId: string }) => {
    try {
      const course = await ctx.deps.learning.openCourse(
        await actorContext(ctx.deps, ctx.actor),
        args.courseId,
      );
      return {
        status: 'success',
        content: {
          course: course.course,
          lessons: course.lessons.map((lesson) => ({
            title: lesson.title,
            completed: lesson.completed,
            content: lesson.content.slice(0, 1500),
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Reads one knowledge document by section, for the content writer. */
export const getDocument = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read a document',
    about:
      'Reads the sections of a knowledge document the current user may read.',
  },
  definition: {
    name: 'getDocument',
    description:
      'Read the full text of one knowledge document, split into sections (index, title, text). The page context names the documentId. Read it before planning a course or questions.',
    schema: z.object({
      documentId: z.string().describe('The id of the knowledge document.'),
    }),
  },
  dependencies: { knowledge: knowledgeServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { documentId: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.knowledge.readDocument(
          await actorContext(ctx.deps, ctx.actor),
          args.documentId,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

const lessonSchema = z.object({
  title: z.string().min(1).max(200),
  content: z
    .string()
    .min(1)
    .describe('Markdown lesson body that ends with a "本节要点" list.'),
  sourceExcerpt: z
    .string()
    .min(1)
    .describe('The source passage or section title this lesson is based on.'),
  estimatedMinutes: z.number().int().min(1).max(60).optional(),
});

/** Writes a draft course with its lessons. Needs the user's approval; the course stays a draft until confirmed. */
export const createCourseDraft = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Create a course draft',
    about: 'Creates a draft course from a knowledge document for review.',
  },
  definition: {
    name: 'createCourseDraft',
    description:
      'Create a draft course (source=ai, reviewStatus=draft) from one knowledge document, with 3–8 lessons. Every lesson must cite its sourceExcerpt. Call it only after the user has approved the outline. Calling it again with the same title returns the existing draft.',
    schema: z.object({
      documentId: z.string(),
      title: z.string().min(1).max(200),
      description: z.string().max(2000).optional(),
      competencyIds: z
        .array(z.string())
        .optional()
        .describe(
          'Competency ids the course covers; find them with searchCompetencies.',
        ),
      lessons: z.array(lessonSchema).min(1).max(12),
    }),
  },
  dependencies: { learning: learningServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: unknown) => {
    try {
      const result = await ctx.deps.learning.createCourseDraft(
        await actorContext(ctx.deps, ctx.actor),
        args,
      );
      return {
        status: 'success',
        content: { ...result, href: `/talent/courses/${result.id}` },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Courses written from a document, drafts included, so a document is not turned into a second course. */
export const listCoursesByDocument = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List courses from a document',
    about: 'Lists the courses written from a knowledge document.',
  },
  definition: {
    name: 'listCoursesByDocument',
    description:
      'List the courses (id, title, source, review status, published) written from a knowledge document, drafts included. Call it before drafting a course from a document to avoid a duplicate.',
    schema: z.object({ documentId: z.string().min(1) }),
  },
  dependencies: { knowledge: knowledgeServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { documentId: string }) => {
    try {
      const document = await ctx.deps.knowledge.getDocument(
        await actorContext(ctx.deps, ctx.actor),
        args.documentId,
      );
      if (!document)
        return { status: 'error', content: { code: 'DOCUMENT_NOT_FOUND' } };
      return { status: 'success', content: { courses: document.courses } };
    } catch (error) {
      return failure(error);
    }
  },
});

/**
 * Chat tools of the learning coach and the practice coach (V2 step 5). Each
 * acts as the person chatting: the services apply that person's data scope,
 * so an employee asking about a colleague is refused by the service, not by
 * the prompt. The scheduled parts of their work (lagging lists, manager
 * notices, exam recommendations) run in the automations, not through tools,
 * and practice conversations are driven by the practice service.
 */
import { defineTools } from '@nocobase/ai-employee';
import {
  authorizationToken,
  type AppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import {
  authorizeAction,
  policyOf,
  scopeForUser,
} from '../../providers/hr/authorize.js';
import { HrError, str } from '../../providers/hr/shared.js';
import {
  learningServiceToken,
  planServiceToken,
  platformToken,
  practiceServiceToken,
  talentServiceToken,
} from '../../providers/hr/tokens.js';

const I18N = { namespace: 'hr' };
const NUDGE_INTERVAL_MS = 3 * 24 * 60 * 60_000;

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

/** A person's position requirements, gaps, tasks and certificates, within the caller's scope. */
export const getEmployeeLearningProfile = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read a learning profile',
    about:
      'Reads position requirements, competency gaps, learning tasks and certificates.',
  },
  definition: {
    name: 'getEmployeeLearningProfile',
    description:
      'Read an employee’s position requirements with current and required levels, the gaps, open and completed learning tasks, and certificate status. Omit employeeId to read your own. Refused for people outside your scope.',
    schema: z.object({ employeeId: z.string().optional() }),
  },
  dependencies: {
    talent: talentServiceToken,
    learning: learningServiceToken,
    platform: platformToken,
    authz: authorizationToken,
  },
  invoke: async (ctx, args: { employeeId?: string }) => {
    try {
      const actor = await actorContext(ctx.deps, ctx.actor);
      const own = await ctx.deps.platform.employeeOfUser(actor.userId);
      const employeeId = args.employeeId ?? own?.id;
      if (!employeeId) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      // Scoped by the employee view: an employee reads only their own record.
      const gaps = await ctx.deps.talent.gaps(actor, employeeId);
      const tasks =
        own?.id === employeeId
          ? await ctx.deps.learning.myAssignments(actor)
          : (await ctx.deps.learning.listAssignments(actor, {})).items.filter(
              (a) => a.employeeId === employeeId,
            );
      const certificates = await ctx.deps.platform.database
        .query()
        .selectFrom('employeeCertificates')
        .innerJoin(
          'certifications',
          'certifications.id',
          'employeeCertificates.certificationId',
        )
        .select([
          'certifications.title as name',
          'employeeCertificates.status as status',
          'employeeCertificates.expiresAt as expiresAt',
        ])
        .where('employeeCertificates.employeeId', '=', employeeId)
        .execute();
      return {
        status: 'success',
        content: {
          position: gaps.positionTitle,
          requirements: gaps.rows.map((r) => ({
            competencyId: r.competencyId,
            title: r.title,
            category: r.category,
            required: r.requiredLevel,
            current: r.currentLevel,
            gap: r.gap,
            mandatory: r.mandatory,
          })),
          openTasks: tasks
            .filter((t) =>
              ['notStarted', 'inProgress', 'overdue', 'locked'].includes(
                t.status,
              ),
            )
            .map((t) => ({
              id: t.id,
              title: t.targetTitle,
              kind: t.kind,
              status: t.status,
              progress: t.progress,
              dueDate: t.dueDate,
              optional: t.optional,
            })),
          completedTasks: tasks
            .filter((t) => t.status === 'completed')
            .map((t) => ({
              title: t.targetTitle,
              kind: t.kind,
              completedAt: t.completedAt,
            })),
          certificates: certificates.map((c) => ({
            name: str(c.name),
            status: str(c.status),
            expiresAt: c.expiresAt ? str(c.expiresAt).slice(0, 10) : null,
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Published courses, paths and exams, and confirmed scenarios, for a plan or a self-study suggestion. */
export const searchLearningContent = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Search learning content',
    about:
      'Finds published courses, learning paths, exams and confirmed practice scenarios.',
  },
  definition: {
    name: 'searchLearningContent',
    description:
      'Find learning content that can be assigned now — published courses, published learning paths, published exams and confirmed practice scenarios — by competency ids or a keyword, with estimated minutes. A plan may reference only content returned here.',
    schema: z.object({
      competencyIds: z.array(z.string()).max(20).optional(),
      keyword: z.string().max(100).optional(),
    }),
  },
  dependencies: { plans: planServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { competencyIds?: string[]; keyword?: string }) => {
    try {
      await authorizeAction(
        (await actorContext(ctx.deps, ctx.actor)).authz,
        'talent.learningCoach',
        'use',
      );
      const items = await ctx.deps.plans.searchContent({
        competencyIds: args.competencyIds,
        q: args.keyword,
      });
      return { status: 'success', content: { items: items.slice(0, 30) } };
    } catch (error) {
      return failure(error);
    }
  },
});

/** Drafts a plan for a manager to approve; it assigns nothing by itself. */
export const createLearningPlanDraft = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Draft a learning plan',
    about:
      'Creates a draft learning plan that the employee’s department head approves.',
  },
  definition: {
    name: 'createLearningPlanDraft',
    description:
      'Create a draft learning plan for an employee (at most 5 items, each tied to a competency with a reason). The department head approves it before any task is assigned; the employee does not see the draft. Refused when the employee already has a draft plan, or when an item was not returned by searchLearningContent.',
    schema: z.object({
      employeeId: z.string(),
      summary: z.string().min(1).max(1000),
      competencyIds: z.array(z.string()).max(10).optional(),
      items: z
        .array(
          z.object({
            type: z.enum(['course', 'learningPath', 'exam', 'practice']),
            refId: z.string(),
            competencyId: z.string(),
            reason: z.string().min(1).max(300),
            dueDate: z.string().optional(),
          }),
        )
        .min(1)
        .max(5),
    }),
  },
  dependencies: { plans: planServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      employeeId: string;
      summary: string;
      competencyIds?: string[];
      items: {
        type: string;
        refId: string;
        competencyId: string;
        reason: string;
        dueDate?: string;
      }[];
    },
  ) => {
    try {
      const actor = await actorContext(ctx.deps, ctx.actor);
      const plan = await ctx.deps.plans.createDraft(
        actor,
        {
          employeeId: args.employeeId,
          trigger: 'request',
          triggerRef: {
            competencyIds: args.competencyIds ?? [
              ...new Set(args.items.map((i) => i.competencyId)),
            ],
          },
          summary: args.summary,
          items: args.items,
        },
        { source: 'ai', fallbackReviewerUserId: actor.userId },
      );
      return {
        status: 'success',
        content: {
          planId: plan.id,
          reviewer: plan.reviewerName,
          items: plan.items.length,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

/** A friendly, specific reminder about one learning task. */
export const sendLearningNudge = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Send a learning reminder',
    about:
      'Sends an in-app reminder about one learning task, at most once in 3 days.',
  },
  definition: {
    name: 'sendLearningNudge',
    description:
      'Send the learner an in-app reminder about one learning task in your scope: which lessons remain, about how long, and the due date. A task reminded in the last 3 days is refused. Show the message to the user and get approval first.',
    schema: z.object({
      assignmentId: z.string(),
      message: z.string().min(1).max(300),
    }),
  },
  dependencies: { platform: platformToken, authz: authorizationToken },
  invoke: async (ctx, args: { assignmentId: string; message: string }) => {
    try {
      const actor = await actorContext(ctx.deps, ctx.actor);
      const policies = await authorizeAction(
        actor.authz,
        'talent.assignment',
        'remind',
      );
      const { platform } = ctx.deps;
      const row = (await platform.database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .findOne({ filter: { id: args.assignmentId } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('ASSIGNMENT_NOT_FOUND', 404);
      if (!['notStarted', 'inProgress', 'overdue'].includes(str(row.status)))
        throw new HrError('ASSIGNMENT_CLOSED', 409);
      const last = row.lastRemindedAt
        ? new Date(
            row.lastRemindedAt instanceof Date
              ? row.lastRemindedAt
              : str(row.lastRemindedAt),
          ).getTime()
        : 0;
      if (Date.now() - last < NUDGE_INTERVAL_MS)
        throw new HrError('ASSIGNMENT_RECENTLY_REMINDED', 409);
      const employee = await platform.employee(str(row.employeeId));
      if (!employee?.userId) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const stamp = new Date();
      await platform.notify({
        key: `learningNudge:${args.assignmentId}:${stamp.getTime()}`,
        userIds: [employee.userId],
        message: 'learningNudge',
        params: { message: args.message, title: '' },
        path: row.courseId
          ? `/talent/learning/${str(row.courseId)}`
          : '/talent/my-learning',
      });
      await platform.database
        .query()
        .updateTable('assignments')
        .set({
          lastRemindedAt: stamp,
          reminderCount: (Number(row.reminderCount) || 0) + 1,
          updatedAt: stamp,
        })
        .where('id', '=', args.assignmentId)
        .execute();
      return { status: 'success', content: { sent: true, to: employee.name } };
    } catch (error) {
      return failure(error);
    }
  },
});

/** A practice scenario draft for an instructor to confirm. */
export const createScenarioDraft = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Draft a practice scenario',
    about:
      'Creates a draft practice scenario an instructor confirms before use.',
  },
  definition: {
    name: 'createScenarioDraft',
    description:
      'Create a draft practice scenario from a source document. Every rubric point needs a verbatim sourceExcerpt from the document; weights are integers totalling 100. The draft cannot be used until an instructor confirms it.',
    schema: z.object({
      title: z.string().min(1).max(200),
      persona: z.string().min(1).max(1000),
      situation: z.string().min(1).max(1500),
      openingLine: z.string().min(1).max(500),
      sourceDocumentId: z.string(),
      maxTurns: z.number().int().min(2).max(40).optional(),
      passScore: z.number().int().min(1).max(100).optional(),
      rubric: z
        .array(
          z.object({
            point: z.string().min(1).max(300),
            weight: z.number().int().min(1).max(100),
            competencyId: z.string().optional(),
            sourceExcerpt: z.string().min(1).max(1000),
          }),
        )
        .min(1)
        .max(10),
    }),
  },
  dependencies: { practice: practiceServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: Record<string, unknown>) => {
    try {
      const scenario = await ctx.deps.practice.createScenarioDraft(
        await actorContext(ctx.deps, ctx.actor),
        args,
      );
      return {
        status: 'success',
        content: {
          scenarioId: scenario.id,
          title: scenario.title,
          path: `/talent/practice-scenarios?scenario=${scenario.id}`,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

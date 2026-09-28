/**
 * Learning plans (V2 step 5): the learning coach drafts a plan for an
 * employee with a competency gap; the employee's department head (or the
 * automation's owner when there is none) approves it — possibly after removing
 * items or moving due dates — and only then are learning tasks created. A plan
 * adds work to someone's week, so nothing is assigned before a person agrees.
 * The employee never sees a draft, only the tasks an approved plan created.
 */
import { authorizeAction, policyOf } from './authorize.js';
import { recordDraftOutcome } from './draft-snapshots.js';
import type { ActorContext } from './framework-service.js';
import type { PathService } from './path-service.js';
import { bool, json, type Platform } from './platform.js';
import {
  addDays,
  HrError,
  isDateOnly,
  isRecord,
  newId,
  requireString,
  str,
} from './shared.js';

const PLAN = 'talent.learningPlan';
const COACH = 'talent.learningCoach';
const OPEN_ASSIGNMENT = ['notStarted', 'inProgress', 'overdue'] as const;
const MAX_ITEMS = 5;
/** A draft nobody decided on within this many days expires. */
export const PLAN_EXPIRY_DAYS = 14;

export type PlanItemType = 'course' | 'learningPath' | 'exam' | 'practice';

export interface PlanItem {
  readonly type: PlanItemType;
  readonly refId: string;
  readonly competencyId: string | null;
  readonly reason: string;
  readonly dueDate: string;
  readonly estimatedMinutes: number | null;
}

export interface PlanView {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly trigger: string;
  readonly triggerRef: unknown;
  readonly summary: string;
  readonly items: readonly (PlanItem & {
    title: string;
    competencyTitle: string | null;
  })[];
  readonly totalMinutes: number;
  readonly reviewerUserId: string;
  readonly reviewerName: string | null;
  readonly status: string;
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly assignmentIds: readonly string[];
  readonly source: string;
  readonly createdAt: string;
  readonly can: { approve: boolean; reject: boolean };
}

export interface LearningContent {
  readonly type: PlanItemType;
  readonly id: string;
  readonly title: string;
  readonly estimatedMinutes: number;
  readonly competencyIds: readonly string[];
}

export interface PlanService {
  listPlans(
    ctx: ActorContext,
    filters: { status?: string; mine?: boolean },
  ): Promise<{
    items: PlanView[];
    adoption: { approved: number; decided: number; rate: number | null };
  }>;
  getPlan(ctx: ActorContext, id: string): Promise<PlanView>;
  approve(ctx: ActorContext, id: string, input: unknown): Promise<PlanView>;
  reject(ctx: ActorContext, id: string, input: unknown): Promise<PlanView>;
  /**
   * Creates a draft plan and tells its reviewer. `fallbackReviewerUserId`
   * decides for an employee whose department has no head.
   */
  createDraft(
    ctx: ActorContext,
    input: unknown,
    options: { source: 'ai' | 'manual'; fallbackReviewerUserId: string },
  ): Promise<PlanView>;
  /** Published courses, paths and exams, and confirmed scenarios, optionally for some competencies. */
  searchContent(filters: {
    competencyIds?: readonly string[];
    q?: string;
  }): Promise<LearningContent[]>;
  expireStale(): Promise<number>;
}

export interface PlanServiceDeps {
  readonly platform: Platform;
  readonly paths: PathService;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

export function createPlanService(deps: PlanServiceDeps): PlanService {
  const { platform, paths } = deps;
  const { database, notify } = platform;

  async function contentIndex(): Promise<Map<string, LearningContent>> {
    const query = database.query();
    const index = new Map<string, LearningContent>();
    const courseTags = await query
      .selectFrom('courseCompetencies')
      .select(['courseId', 'competencyId'])
      .execute();
    const lessons = await query
      .selectFrom('lessons')
      .select(['courseId', 'estimatedMinutes'])
      .execute();
    for (const c of await query
      .selectFrom('courses')
      .select(['id', 'title', 'published', 'active'])
      .execute()) {
      if (!bool(c.published) || !bool(c.active)) continue;
      const id = str(c.id);
      index.set(`course:${id}`, {
        type: 'course',
        id,
        title: str(c.title),
        estimatedMinutes: lessons
          .filter((l) => str(l.courseId) === id)
          .reduce((sum, l) => sum + (Number(l.estimatedMinutes) || 0), 0),
        competencyIds: courseTags
          .filter((t) => str(t.courseId) === id)
          .map((t) => str(t.competencyId)),
      });
    }
    const examQuestionTags = await query
      .selectFrom('examQuestions')
      .innerJoin(
        'questionCompetencies',
        'questionCompetencies.questionId',
        'examQuestions.questionId',
      )
      .select([
        'examQuestions.examId as examId',
        'questionCompetencies.competencyId as competencyId',
      ])
      .execute();
    for (const e of await query
      .selectFrom('exams')
      .select([
        'id',
        'title',
        'published',
        'active',
        'durationMinutes',
        'randomRules',
      ])
      .execute()) {
      if (!bool(e.published) || !bool(e.active)) continue;
      const id = str(e.id);
      const ruleTags = json<{ competencyId?: string | null }[]>(
        e.randomRules,
        [],
      )
        .map((r) => r.competencyId)
        .filter((v): v is string => Boolean(v));
      index.set(`exam:${id}`, {
        type: 'exam',
        id,
        title: str(e.title),
        estimatedMinutes: Number(e.durationMinutes) || 0,
        competencyIds: [
          ...new Set([
            ...ruleTags,
            ...examQuestionTags
              .filter((t) => str(t.examId) === id)
              .map((t) => str(t.competencyId)),
          ]),
        ],
      });
    }
    const scenarioTags = await query
      .selectFrom('practiceScenarioCompetencies')
      .select(['scenarioId', 'competencyId'])
      .execute();
    for (const s of await query
      .selectFrom('practiceScenarios')
      .select(['id', 'title', 'reviewStatus', 'active'])
      .execute()) {
      if (s.reviewStatus !== 'confirmed' || !bool(s.active)) continue;
      const id = str(s.id);
      index.set(`practice:${id}`, {
        type: 'practice',
        id,
        title: str(s.title),
        estimatedMinutes: 15,
        competencyIds: scenarioTags
          .filter((t) => str(t.scenarioId) === id)
          .map((t) => str(t.competencyId)),
      });
    }
    const steps = await query
      .selectFrom('learningPathSteps')
      .select([
        'pathId',
        'stepType',
        'courseId',
        'examId',
        'practiceScenarioId',
      ])
      .execute();
    for (const p of await query
      .selectFrom('learningPaths')
      .select(['id', 'title', 'published', 'active'])
      .execute()) {
      if (!bool(p.published) || !bool(p.active)) continue;
      const id = str(p.id);
      const own = steps.filter((st) => str(st.pathId) === id);
      const parts = own
        .map((st) =>
          st.stepType === 'course'
            ? index.get(`course:${str(st.courseId)}`)
            : st.stepType === 'exam'
              ? index.get(`exam:${str(st.examId)}`)
              : index.get(`practice:${str(st.practiceScenarioId)}`),
        )
        .filter((v): v is LearningContent => Boolean(v));
      index.set(`learningPath:${id}`, {
        type: 'learningPath',
        id,
        title: str(p.title),
        estimatedMinutes: parts.reduce((sum, v) => sum + v.estimatedMinutes, 0),
        competencyIds: [...new Set(parts.flatMap((v) => v.competencyIds))],
      });
    }
    return index;
  }

  async function toView(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<PlanView> {
    const employee = await platform.employee(str(row.employeeId));
    const index = await contentIndex();
    const items = json<PlanItem[]>(row.items, []);
    const competencyIds = [
      ...new Set(items.map((i) => i.competencyId).filter(Boolean)),
    ] as string[];
    const titles = new Map(
      competencyIds.length
        ? (
            await database
              .query()
              .selectFrom('competencies')
              .select(['id', 'title'])
              .where('id', 'in', competencyIds)
              .execute()
          ).map((c) => [str(c.id), str(c.title)])
        : [],
    );
    const refTitle = async (item: PlanItem) => {
      const known = index.get(`${item.type}:${item.refId}`);
      if (known) return known.title;
      const table =
        item.type === 'course'
          ? 'courses'
          : item.type === 'exam'
            ? 'exams'
            : item.type === 'practice'
              ? 'practiceScenarios'
              : 'learningPaths';
      const found = await database
        .query()
        .selectFrom(table)
        .select(['title'])
        .where('id', '=', item.refId)
        .executeTakeFirst();
      return found ? str(found.title) : item.refId;
    };
    const decorated = [];
    for (const item of items)
      decorated.push({
        ...item,
        title: await refTitle(item),
        competencyTitle: item.competencyId
          ? (titles.get(item.competencyId) ?? null)
          : null,
      });
    const draft = row.status === 'draft';
    return {
      id: str(row.id),
      employeeId: str(row.employeeId),
      employeeName: employee?.name ?? '',
      departmentId: employee?.departmentId ?? '',
      trigger: str(row.trigger),
      triggerRef: json(row.triggerRef, null),
      summary: str(row.summary),
      items: decorated,
      totalMinutes: items.reduce(
        (sum, i) => sum + (Number(i.estimatedMinutes) || 0),
        0,
      ),
      reviewerUserId: str(row.reviewerUserId),
      reviewerName: await platform.userName(str(row.reviewerUserId)),
      status: str(row.status),
      reviewedByName: await platform.userName(nullable(row.reviewedBy)),
      reviewedAt: iso(row.reviewedAt),
      reviewNote: nullable(row.reviewNote),
      assignmentIds: json<string[]>(row.assignmentIds, []),
      source: str(row.source),
      createdAt: iso(row.createdAt)!,
      can: {
        approve: draft && (await platform.can(ctx, PLAN, 'approve')),
        reject: draft && (await platform.can(ctx, PLAN, 'reject')),
      },
    };
  }

  async function scopedPlan(
    ctx: ActorContext,
    action: 'view' | 'approve' | 'reject',
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, PLAN, action);
    const row = (await database
      .repository('learningPlans')
      .withPolicy(policyOf(policies, 'learningPlans'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('PLAN_NOT_FOUND', 404);
    return row;
  }

  function parseItems(
    value: unknown,
    index: Map<string, LearningContent>,
  ): PlanItem[] {
    if (!Array.isArray(value) || !value.length || value.length > MAX_ITEMS)
      throw new HrError('PLAN_ITEMS_INVALID', 400);
    const today = platform.currentDate();
    return value.map((item) => {
      if (!isRecord(item)) throw new HrError('PLAN_ITEMS_INVALID', 400);
      const type = item.type as PlanItemType;
      const refId = requireString(item.refId, 'PLAN_ITEMS_INVALID', {
        max: 64,
      })!;
      // Only content that may be assigned now: published, or a confirmed scenario.
      const known = index.get(`${type}:${refId}`);
      if (!known) throw new HrError('PLAN_ITEM_NOT_ASSIGNABLE', 409, { refId });
      const dueDate =
        typeof item.dueDate === 'string' && isDateOnly(item.dueDate)
          ? item.dueDate
          : addDays(today, 14);
      if (dueDate < today) throw new HrError('PLAN_ITEMS_INVALID', 400);
      return {
        type,
        refId,
        competencyId: requireString(item.competencyId, 'PLAN_ITEMS_INVALID', {
          optional: true,
          max: 64,
        }),
        reason: requireString(item.reason, 'PLAN_ITEM_REASON_REQUIRED', {
          max: 500,
        })!,
        dueDate,
        estimatedMinutes:
          item.estimatedMinutes === undefined || item.estimatedMinutes === null
            ? known.estimatedMinutes
            : Math.max(0, Math.round(Number(item.estimatedMinutes) || 0)),
      };
    });
  }

  /** Creates one learning task of an approved plan, or reuses an open one for the same content. */
  async function assignItem(
    employeeId: string,
    item: PlanItem,
    reviewerUserId: string,
    planId: string,
  ): Promise<string | undefined> {
    if (item.type === 'learningPath')
      return paths.assignFor(employeeId, item.refId, {
        assignedByUserId: reviewerUserId,
        source: 'plan',
        learningPlanId: planId,
        dueDate: item.dueDate,
      });
    const field =
      item.type === 'course'
        ? 'courseId'
        : item.type === 'exam'
          ? 'examId'
          : 'practiceScenarioId';
    const open = await database
      .query()
      .selectFrom('assignments')
      .select(['id'])
      .where('employeeId', '=', employeeId)
      .where(field, '=', item.refId)
      .where('status', 'in', [...OPEN_ASSIGNMENT, 'locked'])
      .executeTakeFirst();
    if (open) return str(open.id);
    const id = newId();
    const stamp = new Date();
    await database
      .query()
      .insertInto('assignments')
      .values({
        id,
        employeeId,
        courseId: item.type === 'course' ? item.refId : null,
        examId: item.type === 'exam' ? item.refId : null,
        certificateId: null,
        learningPathId: null,
        parentAssignmentId: null,
        pathStepId: null,
        practiceScenarioId: item.type === 'practice' ? item.refId : null,
        learningPlanId: planId,
        optional: false,
        reminderCount: 0,
        assignedByUserId: reviewerUserId,
        dueDate: item.dueDate,
        status: 'notStarted',
        progress: 0,
        source: 'plan',
        completedAt: null,
        cancelledAt: null,
        lastRemindedAt: null,
        escalatedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    return id;
  }

  const service: PlanService = {
    async listPlans(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, PLAN, 'view');
      let rows = (await database
        .repository('learningPlans')
        .withPolicy(policyOf(policies, 'learningPlans'))
        .findMany({ sort: (s) => [s.field('createdAt').desc()] })) as Record<
        string,
        unknown
      >[];
      if (filters.status)
        rows = rows.filter((r) => r.status === filters.status);
      if (filters.mine)
        rows = rows.filter((r) => str(r.reviewerUserId) === ctx.userId);
      const items: PlanView[] = [];
      for (const row of rows) items.push(await toView(ctx, row));
      const all = (await database
        .repository('learningPlans')
        .withPolicy(policyOf(policies, 'learningPlans'))
        .findMany({})) as Record<string, unknown>[];
      const decided = all.filter(
        (r) => r.status === 'approved' || r.status === 'rejected',
      ).length;
      const approved = all.filter((r) => r.status === 'approved').length;
      return {
        items,
        adoption: {
          approved,
          decided,
          rate: decided ? Math.round((approved / decided) * 1000) / 10 : null,
        },
      };
    },

    async getPlan(ctx, id) {
      return toView(ctx, await scopedPlan(ctx, 'view', id));
    },

    async approve(ctx, id, input) {
      const row = await scopedPlan(ctx, 'approve', id);
      if (row.status !== 'draft') throw new HrError('PLAN_NOT_DRAFT', 409);
      const current = json<PlanItem[]>(row.items, []);
      let items = current;
      let note: string | null = null;
      if (isRecord(input)) {
        note = requireString(input.note, 'INVALID_INPUT', {
          optional: true,
          max: 1000,
        });
        if (input.items !== undefined) {
          // A reviewer may remove items and move due dates, never add content the coach did not propose.
          if (!Array.isArray(input.items))
            throw new HrError('PLAN_ITEMS_INVALID', 400);
          const today = platform.currentDate();
          items = input.items.map((edit) => {
            if (!isRecord(edit)) throw new HrError('PLAN_ITEMS_INVALID', 400);
            const original = current.find(
              (c) => c.type === edit.type && c.refId === edit.refId,
            );
            if (!original) throw new HrError('PLAN_ITEMS_INVALID', 400);
            const dueDate =
              typeof edit.dueDate === 'string' && isDateOnly(edit.dueDate)
                ? edit.dueDate
                : original.dueDate;
            if (dueDate < today) throw new HrError('PLAN_ITEMS_INVALID', 400);
            return { ...original, dueDate };
          });
          if (!items.length) throw new HrError('PLAN_ITEMS_INVALID', 400);
        }
      }
      const employeeId = str(row.employeeId);
      const assignmentIds: string[] = [];
      for (const item of items) {
        const created = await assignItem(employeeId, item, ctx.userId, id);
        if (created) assignmentIds.push(created);
      }
      const stamp = new Date();
      const policies = await authorizeAction(ctx.authz, PLAN, 'approve');
      await database
        .repository('learningPlans')
        .withPolicy(policyOf(policies, 'learningPlans'))
        .updateOne({
          filter: { id },
          values: {
            items: JSON.stringify(items),
            status: 'approved',
            reviewedBy: ctx.userId,
            reviewedAt: stamp,
            reviewNote: note,
            assignmentIds: JSON.stringify(assignmentIds),
            updatedAt: stamp,
          },
        });
      await recordDraftOutcome(
        database,
        'learningPlan',
        id,
        'confirmed',
        ctx.userId,
      );
      await paths.syncEmployee(employeeId);
      const employee = await platform.employee(employeeId);
      if (employee?.userId)
        await notify({
          key: `learningPlan:${id}:approved`,
          userIds: [employee.userId],
          message: 'learningPlanApproved',
          params: {
            count: String(items.length),
            name: (await platform.userName(ctx.userId)) ?? '',
          },
          path: '/talent/my-learning',
        });
      return service.getPlan(ctx, id);
    },

    async reject(ctx, id, input) {
      const row = await scopedPlan(ctx, 'reject', id);
      if (row.status !== 'draft') throw new HrError('PLAN_NOT_DRAFT', 409);
      const note = requireString(
        isRecord(input) ? input.note : undefined,
        'PLAN_REJECT_REASON_REQUIRED',
        {
          max: 1000,
        },
      )!;
      const policies = await authorizeAction(ctx.authz, PLAN, 'reject');
      const stamp = new Date();
      await database
        .repository('learningPlans')
        .withPolicy(policyOf(policies, 'learningPlans'))
        .updateOne({
          filter: { id },
          values: {
            status: 'rejected',
            reviewedBy: ctx.userId,
            reviewedAt: stamp,
            reviewNote: note,
            updatedAt: stamp,
          },
        });
      await recordDraftOutcome(
        database,
        'learningPlan',
        id,
        'discarded',
        ctx.userId,
      );
      return service.getPlan(ctx, id);
    },

    async createDraft(ctx, input, options) {
      const policies = await authorizeAction(ctx.authz, COACH, 'use');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const employeeId = requireString(input.employeeId, 'INVALID_INPUT', {
        max: 64,
      })!;
      // The coach plans only for people the caller may see.
      if (
        !(await database
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .findOne({ filter: { id: employeeId } }))
      )
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const employee = await platform.employee(employeeId);
      if (!employee || employee.status === 'leave')
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const existing = await database
        .query()
        .selectFrom('learningPlans')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (existing) throw new HrError('PLAN_DRAFT_EXISTS', 409);
      const trigger = input.trigger === 'request' ? 'request' : 'gap';
      const summary = requireString(input.summary, 'PLAN_SUMMARY_REQUIRED', {
        max: 4000,
      })!;
      const items = parseItems(input.items, await contentIndex());
      const reviewerUserId =
        (await platform.headOf(employee)) ?? options.fallbackReviewerUserId;
      const id = newId();
      const stamp = new Date();
      await database
        .query()
        .insertInto('learningPlans')
        .values({
          id,
          employeeId,
          trigger,
          triggerRef:
            input.triggerRef === undefined
              ? null
              : JSON.stringify(input.triggerRef),
          summary,
          items: JSON.stringify(items),
          reviewerUserId,
          status: 'draft',
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          assignmentIds: null,
          source: options.source,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      await notify({
        key: `learningPlan:${id}:drafted`,
        userIds: [reviewerUserId],
        message: 'learningPlanDrafted',
        params: { name: employee.name, count: String(items.length) },
        path: `/talent/learning-plans?plan=${encodeURIComponent(id)}`,
      });
      // Built directly: whoever drafts (an automation's owner, a manager in chat) may not hold plan viewing.
      return toView(
        ctx,
        (await database
          .query()
          .selectFrom('learningPlans')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst()) as Record<string, unknown>,
      );
    },

    async searchContent(filters) {
      const index = await contentIndex();
      const wanted = new Set(filters.competencyIds ?? []);
      const q = filters.q?.trim().toLowerCase();
      return [...index.values()].filter(
        (item) =>
          (!wanted.size || item.competencyIds.some((c) => wanted.has(c))) &&
          (!q || item.title.toLowerCase().includes(q)),
      );
    },

    async expireStale() {
      const cutoff = new Date(Date.now() - PLAN_EXPIRY_DAYS * 24 * 60 * 60_000);
      const stale = await database
        .query()
        .selectFrom('learningPlans')
        .select(['id'])
        .where('status', '=', 'draft')
        .where('createdAt', '<', cutoff)
        .execute();
      const stamp = new Date();
      for (const row of stale) {
        await database
          .query()
          .updateTable('learningPlans')
          .set({ status: 'expired', updatedAt: stamp })
          .where('id', '=', str(row.id))
          .where('status', '=', 'draft')
          .execute();
        await recordDraftOutcome(
          database,
          'learningPlan',
          str(row.id),
          'discarded',
          'system',
        );
      }
      return stale.length;
    },
  };
  return service;
}

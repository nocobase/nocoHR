/**
 * Learning paths (V2 step 5): an ordered set of steps — courses, exams and
 * practice scenarios — that brings a person to a position.
 *
 * Assigning a path creates a parent assignment and one child per step. A
 * child whose content the person already finished counts as completed when
 * the path says so (`skipCompleted`); an open assignment for the same content
 * is attached to the path instead of duplicated. In a sequential path every
 * unfinished step after the first unfinished one is `locked`: never reminded,
 * never overdue. `syncEmployee` is the one place that moves a path on — it is
 * called whenever a course, exam, session or practice completes, and it
 * unlocks the next step, updates the parent's progress and completes it.
 */
import type { DatabaseConnection } from '@nocobase/db';

import {
  authorizeAction,
  policyOf,
  tryAuthorizeAction,
  type CollectionPolicies,
} from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { bool, type EmployeeSummary, type Platform } from './platform.js';
import {
  addDays,
  HrError,
  isRecord,
  newId,
  optionalDate,
  requireString,
  str,
} from './shared.js';

const PATH = 'talent.learningPath';
const ASSIGNMENT = 'talent.assignment';
const LEARNING = 'talent.learning';
const OPEN = ['notStarted', 'inProgress', 'overdue'] as const;
const PURPOSES = ['onboarding', 'development', 'other'] as const;
const STEP_TYPES = ['course', 'exam', 'practice'] as const;
/** A practice step's time estimate, for the path total. */
const PRACTICE_MINUTES = 15;

export type StepType = (typeof STEP_TYPES)[number];

export interface PathStepView {
  readonly id: string;
  readonly sortOrder: number;
  readonly stepType: StepType;
  readonly courseId: string | null;
  readonly examId: string | null;
  readonly practiceScenarioId: string | null;
  readonly targetTitle: string;
  /** For a course step: online or offline. */
  readonly deliveryMode: 'online' | 'offline' | null;
  readonly dueOffsetDays: number;
  readonly required: boolean;
  readonly estimatedMinutes: number;
  /** Whether the referenced content is published (or, for a scenario, confirmed) and active. */
  readonly targetReady: boolean;
}

export interface PathView {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly positionId: string | null;
  readonly positionTitle: string | null;
  readonly purpose: string;
  readonly sequential: boolean;
  readonly skipCompleted: boolean;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly published: boolean;
  readonly active: boolean;
  readonly steps: readonly PathStepView[];
  readonly estimatedMinutes: number;
  readonly learnerCount: number;
  /** Completed ÷ assigned path assignments, excluding cancelled ones. */
  readonly completionRate: number | null;
  readonly can: { manage: boolean; publish: boolean };
}

export interface PathAssignmentPreview {
  /** The path's steps, for naming the ones that complete at once or take over a task. */
  readonly steps: readonly { id: string; title: string; stepType: StepType }[];
  readonly included: readonly {
    employeeId: string;
    name: string;
    departmentId: string;
    /** Steps that will count as completed at once. */
    completedStepIds: readonly string[];
    /** Steps that take over an open assignment the person already has. */
    attachedStepIds: readonly string[];
  }[];
  readonly excluded: readonly {
    employeeId: string;
    name: string;
    reason: 'left' | 'outOfScope' | 'hasOpenAssignment';
  }[];
}

export interface PathTimeline {
  readonly assignmentId: string;
  readonly pathId: string;
  readonly title: string;
  readonly status: string;
  readonly progress: number;
  readonly dueDate: string | null;
  readonly steps: readonly {
    readonly step: PathStepView;
    readonly assignmentId: string | null;
    readonly status: string;
    readonly progress: number;
    readonly dueDate: string | null;
  }[];
}

export interface PathService {
  listPaths(ctx: ActorContext, filters: { q?: string }): Promise<PathView[]>;
  getPath(ctx: ActorContext, id: string): Promise<PathView>;
  savePath(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<PathView>;
  publishPath(
    ctx: ActorContext,
    id: string,
    published: boolean,
  ): Promise<PathView>;
  setPathActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<PathView>;
  previewAssignment(
    ctx: ActorContext,
    input: unknown,
  ): Promise<PathAssignmentPreview>;
  assign(
    ctx: ActorContext,
    input: unknown,
  ): Promise<{ created: number; preview: PathAssignmentPreview }>;
  /**
   * Assigns a path to one person without an audience check, for a learning
   * plan a manager approved; the caller has authorized it. Returns the parent
   * assignment id, or undefined when the person already follows the path.
   */
  assignFor(
    employeeId: string,
    pathId: string,
    options: {
      assignedByUserId: string;
      source: string;
      learningPlanId?: string;
      dueDate?: string;
    },
  ): Promise<string | undefined>;
  /** Moves every open path of an employee on: completes steps done elsewhere, unlocks, updates progress. */
  syncEmployee(employeeId: string): Promise<void>;
  /** The caller's own paths as timelines, for "my learning". */
  myTimelines(ctx: ActorContext): Promise<PathTimeline[]>;
  /** A timeline of any path assignment the caller may view (for the assignments page and profiles). */
  timeline(
    ctx: ActorContext,
    parentAssignmentId: string,
  ): Promise<PathTimeline>;
  /** Cancels the unfinished children of a cancelled parent. */
  cancelChildren(parentAssignmentId: string): Promise<void>;
  assignableTargets(): Promise<{ id: string; title: string }[]>;
}

export interface PathServiceDeps {
  readonly platform: Platform;
}

interface StepInput {
  stepType: StepType;
  courseId: string | null;
  examId: string | null;
  practiceScenarioId: string | null;
  dueOffsetDays: number;
  required: boolean;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}
function ids(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 64)
  )
    throw new HrError('INVALID_INPUT', 400);
  return [...new Set(value as string[])];
}
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

export function createPathService(deps: PathServiceDeps): PathService {
  const { platform } = deps;
  const { database, organization, notify } = platform;

  // ---------- Reading ----------

  async function targetInfo(step: {
    stepType: string;
    courseId: string | null;
    examId: string | null;
    practiceScenarioId: string | null;
  }): Promise<{
    title: string;
    ready: boolean;
    minutes: number;
    deliveryMode: 'online' | 'offline' | null;
  }> {
    const query = database.query();
    if (step.stepType === 'course' && step.courseId) {
      const course = await query
        .selectFrom('courses')
        .select(['title', 'published', 'active', 'deliveryMode'])
        .where('id', '=', step.courseId)
        .executeTakeFirst();
      const lessons = await query
        .selectFrom('lessons')
        .select(['estimatedMinutes'])
        .where('courseId', '=', step.courseId)
        .execute();
      return {
        title: course ? str(course.title) : '',
        ready: Boolean(course && bool(course.published) && bool(course.active)),
        minutes: lessons.reduce(
          (sum, l) => sum + (Number(l.estimatedMinutes) || 0),
          0,
        ),
        deliveryMode: course?.deliveryMode === 'offline' ? 'offline' : 'online',
      };
    }
    if (step.stepType === 'exam' && step.examId) {
      const exam = await query
        .selectFrom('exams')
        .select(['title', 'published', 'active', 'durationMinutes'])
        .where('id', '=', step.examId)
        .executeTakeFirst();
      return {
        title: exam ? str(exam.title) : '',
        ready: Boolean(exam && bool(exam.published) && bool(exam.active)),
        minutes: Number(exam?.durationMinutes) || 0,
        deliveryMode: null,
      };
    }
    if (step.stepType === 'practice' && step.practiceScenarioId) {
      const scenario = await query
        .selectFrom('practiceScenarios')
        .select(['title', 'reviewStatus', 'active'])
        .where('id', '=', step.practiceScenarioId)
        .executeTakeFirst();
      return {
        title: scenario ? str(scenario.title) : '',
        ready: Boolean(
          scenario &&
          scenario.reviewStatus === 'confirmed' &&
          bool(scenario.active),
        ),
        minutes: PRACTICE_MINUTES,
        deliveryMode: null,
      };
    }
    return { title: '', ready: false, minutes: 0, deliveryMode: null };
  }

  async function stepsOf(pathId: string, connection?: DatabaseConnection) {
    return await (connection ? connection.query : database.query())
      .selectFrom('learningPathSteps')
      .selectAll()
      .where('pathId', '=', pathId)
      .orderBy('sortOrder', 'asc')
      .execute();
  }

  async function stepViews(pathId: string): Promise<PathStepView[]> {
    const result: PathStepView[] = [];
    for (const row of await stepsOf(pathId)) {
      const step = {
        stepType: str(row.stepType) as StepType,
        courseId: nullable(row.courseId),
        examId: nullable(row.examId),
        practiceScenarioId: nullable(row.practiceScenarioId),
      };
      const info = await targetInfo(step);
      result.push({
        id: str(row.id),
        sortOrder: Number(row.sortOrder),
        ...step,
        targetTitle: info.title,
        deliveryMode: info.deliveryMode,
        dueOffsetDays: Number(row.dueOffsetDays),
        required: bool(row.required),
        estimatedMinutes: info.minutes,
        targetReady: info.ready,
      });
    }
    return result;
  }

  async function toView(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<PathView> {
    const id = str(row.id);
    const steps = await stepViews(id);
    const parents = await database
      .query()
      .selectFrom('assignments')
      .select(['status'])
      .where('learningPathId', '=', id)
      .where('status', '!=', 'cancelled')
      .execute();
    const positionTitle = row.positionId
      ? str(
          (
            await database
              .query()
              .selectFrom('positions')
              .select(['title'])
              .where('id', '=', str(row.positionId))
              .executeTakeFirst()
          )?.title ?? '',
        ) || null
      : null;
    const manage = await tryAuthorizeAction(ctx.authz, PATH, 'manage');
    const canManage = manage
      ? Boolean(
          await database
            .repository('learningPaths')
            .withPolicy(policyOf(manage, 'learningPaths'))
            .findOne({ filter: { id } }),
        )
      : false;
    return {
      id,
      code: str(row.code),
      title: str(row.title),
      description: nullable(row.description),
      positionId: nullable(row.positionId),
      positionTitle,
      purpose: str(row.purpose),
      sequential: bool(row.sequential),
      skipCompleted: bool(row.skipCompleted),
      ownerUserId: str(row.ownerUserId),
      ownerName: await platform.userName(str(row.ownerUserId)),
      published: bool(row.published),
      active: bool(row.active),
      steps,
      estimatedMinutes: steps.reduce((sum, s) => sum + s.estimatedMinutes, 0),
      learnerCount: parents.filter((p) =>
        (OPEN as readonly string[]).includes(str(p.status)),
      ).length,
      completionRate: parents.length
        ? Math.round(
            (parents.filter((p) => p.status === 'completed').length /
              parents.length) *
              1000,
          ) / 10
        : null,
      can: {
        manage: canManage,
        publish: await platform.can(ctx, PATH, 'publish'),
      },
    };
  }

  async function loadVisible(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, PATH, 'view');
    const row = (await database
      .repository('learningPaths')
      .withPolicy(policyOf(policies, 'learningPaths'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('PATH_NOT_FOUND', 404);
    return row;
  }

  // ---------- Writing ----------

  function parseSteps(value: unknown): StepInput[] {
    if (!Array.isArray(value) || value.length > 20)
      throw new HrError('PATH_STEPS_INVALID', 400);
    return value.map((item) => {
      if (!isRecord(item)) throw new HrError('PATH_STEPS_INVALID', 400);
      const stepType = item.stepType as StepType;
      if (!(STEP_TYPES as readonly string[]).includes(stepType))
        throw new HrError('PATH_STEPS_INVALID', 400);
      const ref = (field: string) =>
        requireString(item[field], 'PATH_STEP_TARGET_REQUIRED', { max: 64 })!;
      const offset = Number(item.dueOffsetDays);
      if (!Number.isInteger(offset) || offset < 1 || offset > 365)
        throw new HrError('PATH_STEP_DUE_INVALID', 400);
      return {
        stepType,
        courseId: stepType === 'course' ? ref('courseId') : null,
        examId: stepType === 'exam' ? ref('examId') : null,
        practiceScenarioId:
          stepType === 'practice' ? ref('practiceScenarioId') : null,
        dueOffsetDays: offset,
        required: item.required === undefined ? true : item.required === true,
      };
    });
  }

  async function assertTargetsExist(
    steps: readonly StepInput[],
  ): Promise<void> {
    for (const step of steps) {
      const [table, id] =
        step.stepType === 'course'
          ? ['courses', step.courseId!]
          : step.stepType === 'exam'
            ? ['exams', step.examId!]
            : ['practiceScenarios', step.practiceScenarioId!];
      const found = await database
        .query()
        .selectFrom(table)
        .select(['id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!found) throw new HrError('PATH_STEP_TARGET_NOT_FOUND', 404, { id });
    }
  }

  // ---------- Assigning ----------

  type Candidate = EmployeeSummary;

  async function audience(
    policies: CollectionPolicies,
    input: {
      employeeIds: string[];
      departmentIds: string[];
      positionIds: string[];
    },
  ): Promise<{ candidates: Candidate[]; inScope: Set<string> }> {
    const query = database.query();
    const columns = [
      'id',
      'name',
      'userId',
      'departmentId',
      'positionId',
      'status',
    ] as const;
    const found = new Map<string, Candidate>();
    const add = (rows: readonly Record<string, unknown>[]) => {
      for (const row of rows)
        found.set(str(row.id), {
          id: str(row.id),
          name: str(row.name),
          userId: nullable(row.userId),
          departmentId: str(row.departmentId),
          positionId: str(row.positionId),
          status: str(row.status),
        });
    };
    if (input.employeeIds.length)
      add(
        await query
          .selectFrom('employees')
          .select([...columns])
          .where('id', 'in', input.employeeIds)
          .execute(),
      );
    if (input.departmentIds.length) {
      const departments = new Set<string>();
      for (const id of input.departmentIds)
        for (const d of await organization.descendantsOf(id))
          departments.add(d);
      if (departments.size)
        add(
          await query
            .selectFrom('employees')
            .select([...columns])
            .where('departmentId', 'in', [...departments])
            .execute(),
        );
    }
    if (input.positionIds.length)
      add(
        await query
          .selectFrom('employees')
          .select([...columns])
          .where('positionId', 'in', input.positionIds)
          .execute(),
      );
    const candidateIds = [...found.keys()];
    const inScope = new Set<string>();
    if (candidateIds.length) {
      const visible = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({
          filter: (f) => f.or(candidateIds.map((id) => f.string('id').eq(id))),
        });
      for (const row of visible)
        inScope.add(str((row as Record<string, unknown>).id));
    }
    return {
      candidates: [...found.values()].sort((a, b) =>
        a.name.localeCompare(b.name, 'zh-CN'),
      ),
      inScope,
    };
  }

  async function courseCompleted(
    employeeId: string,
    courseId: string,
  ): Promise<boolean> {
    const query = database.query();
    const done = await query
      .selectFrom('assignments')
      .select(['id'])
      .where('employeeId', '=', employeeId)
      .where('courseId', '=', courseId)
      .where('status', '=', 'completed')
      .executeTakeFirst();
    if (done) return true;
    const course = await query
      .selectFrom('courses')
      .select(['deliveryMode'])
      .where('id', '=', courseId)
      .executeTakeFirst();
    if (course?.deliveryMode === 'offline') {
      const attended = await query
        .selectFrom('trainingEnrollments')
        .innerJoin(
          'trainingSessions',
          'trainingSessions.id',
          'trainingEnrollments.sessionId',
        )
        .select(['trainingEnrollments.id as id'])
        .where('trainingEnrollments.employeeId', '=', employeeId)
        .where('trainingSessions.courseId', '=', courseId)
        .where('trainingEnrollments.status', '=', 'attended')
        .executeTakeFirst();
      return Boolean(attended);
    }
    const lessons = await query
      .selectFrom('lessons')
      .select(['id'])
      .where('courseId', '=', courseId)
      .execute();
    if (!lessons.length) return false;
    const records = await query
      .selectFrom('learningRecords')
      .select(['lessonId', 'completedAt'])
      .where('employeeId', '=', employeeId)
      .where('courseId', '=', courseId)
      .execute();
    const done2 = new Set(
      records.filter((r) => r.completedAt).map((r) => str(r.lessonId)),
    );
    return lessons.every((l) => done2.has(str(l.id)));
  }

  async function examPassed(
    employeeId: string,
    examId: string,
  ): Promise<boolean> {
    return Boolean(
      await database
        .query()
        .selectFrom('examAttempts')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('examId', '=', examId)
        .where('status', '=', 'passed')
        .executeTakeFirst(),
    );
  }

  async function practicePassed(
    employeeId: string,
    scenarioId: string,
  ): Promise<boolean> {
    const scenario = await database
      .query()
      .selectFrom('practiceScenarios')
      .select(['passScore'])
      .where('id', '=', scenarioId)
      .executeTakeFirst();
    if (!scenario) return false;
    return Boolean(
      await database
        .query()
        .selectFrom('practiceSessions')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('scenarioId', '=', scenarioId)
        .where('status', '=', 'completed')
        .where('rehearsal', '=', false)
        .where('score', '>=', Number(scenario.passScore))
        .executeTakeFirst(),
    );
  }

  async function stepDone(
    employeeId: string,
    step: Record<string, unknown>,
  ): Promise<boolean> {
    if (step.stepType === 'course' && step.courseId)
      return courseCompleted(employeeId, str(step.courseId));
    if (step.stepType === 'exam' && step.examId)
      return examPassed(employeeId, str(step.examId));
    if (step.stepType === 'practice' && step.practiceScenarioId)
      return practicePassed(employeeId, str(step.practiceScenarioId));
    return false;
  }

  /** An open assignment for the same content, not already part of another path. */
  async function openStandalone(
    employeeId: string,
    step: Record<string, unknown>,
  ) {
    const field =
      step.stepType === 'course'
        ? 'courseId'
        : step.stepType === 'exam'
          ? 'examId'
          : 'practiceScenarioId';
    const value = nullable(step[field]);
    if (!value) return undefined;
    return await database
      .query()
      .selectFrom('assignments')
      .selectAll()
      .where('employeeId', '=', employeeId)
      .where(field, '=', value)
      .where('status', 'in', [...OPEN])
      .where('parentAssignmentId', 'is', null)
      // A recommendation stays a recommendation; the path gets its own required step.
      .where('optional', '=', false)
      .executeTakeFirst();
  }

  async function planFor(
    employeeId: string,
    path: Record<string, unknown>,
  ): Promise<{ completed: string[]; attached: string[] }> {
    const completed: string[] = [];
    const attached: string[] = [];
    for (const step of await stepsOf(str(path.id))) {
      if (bool(path.skipCompleted) && (await stepDone(employeeId, step)))
        completed.push(str(step.id));
      else if (await openStandalone(employeeId, step))
        attached.push(str(step.id));
    }
    return { completed, attached };
  }

  async function hasOpenPath(
    employeeId: string,
    pathId: string,
  ): Promise<boolean> {
    return Boolean(
      await database
        .query()
        .selectFrom('assignments')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('learningPathId', '=', pathId)
        .where('status', 'in', [...OPEN])
        .executeTakeFirst(),
    );
  }

  function parseAssignInput(input: unknown) {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const learningPathId = requireString(
      input.learningPathId,
      'ASSIGNMENT_TARGET_REQUIRED',
      {
        max: 64,
      },
    )!;
    const dueDate = optionalDate(input.dueDate, 'ASSIGNMENT_DUE_INVALID');
    if (dueDate && dueDate < platform.currentDate())
      throw new HrError('ASSIGNMENT_DUE_INVALID', 400);
    const result = {
      learningPathId,
      dueDate,
      employeeIds: ids(input.employeeIds),
      departmentIds: ids(input.departmentIds),
      positionIds: ids(input.positionIds),
    };
    if (
      !result.employeeIds.length &&
      !result.departmentIds.length &&
      !result.positionIds.length
    )
      throw new HrError('ASSIGNMENT_AUDIENCE_REQUIRED', 400);
    return result;
  }

  async function publishedPath(id: string): Promise<Record<string, unknown>> {
    const path = await database
      .query()
      .selectFrom('learningPaths')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!path || !bool(path.published) || !bool(path.active))
      throw new HrError('PATH_NOT_PUBLISHED', 409);
    return path;
  }

  async function buildPreview(
    ctx: ActorContext,
    parsed: ReturnType<typeof parseAssignInput>,
  ): Promise<PathAssignmentPreview> {
    const policies = await authorizeAction(ctx.authz, ASSIGNMENT, 'create');
    const path = await publishedPath(parsed.learningPathId);
    const { candidates, inScope } = await audience(policies, parsed);
    const included: PathAssignmentPreview['included'][number][] = [];
    const excluded: PathAssignmentPreview['excluded'][number][] = [];
    for (const person of candidates) {
      if (person.status === 'leave')
        excluded.push({
          employeeId: person.id,
          name: person.name,
          reason: 'left',
        });
      else if (!inScope.has(person.id))
        excluded.push({
          employeeId: person.id,
          name: person.name,
          reason: 'outOfScope',
        });
      else if (await hasOpenPath(person.id, parsed.learningPathId))
        excluded.push({
          employeeId: person.id,
          name: person.name,
          reason: 'hasOpenAssignment',
        });
      else {
        const plan = await planFor(person.id, path);
        included.push({
          employeeId: person.id,
          name: person.name,
          departmentId: person.departmentId,
          completedStepIds: plan.completed,
          attachedStepIds: plan.attached,
        });
      }
    }
    const steps = (await stepViews(parsed.learningPathId)).map((s) => ({
      id: s.id,
      title: s.targetTitle,
      stepType: s.stepType,
    }));
    return { steps, included, excluded };
  }

  /** Creates the parent and its children for one person; the caller has checked the audience. */
  async function createPathAssignment(
    employee: EmployeeSummary,
    path: Record<string, unknown>,
    options: {
      assignedByUserId: string | null;
      source: string;
      learningPlanId?: string | null;
      dueDate?: string | null;
    },
  ): Promise<string> {
    const today = platform.currentDate();
    const steps = await stepsOf(str(path.id));
    const maxOffset = Math.max(...steps.map((s) => Number(s.dueOffsetDays)), 1);
    const parentDue = options.dueDate ?? addDays(today, maxOffset);
    const parentId = newId();
    const stamp = new Date();
    const decisions: {
      step: Record<string, unknown>;
      done: boolean;
      existing?: Record<string, unknown>;
    }[] = [];
    for (const step of steps) {
      const done =
        bool(path.skipCompleted) && (await stepDone(employee.id, step));
      decisions.push({
        step,
        done,
        existing: done ? undefined : await openStandalone(employee.id, step),
      });
    }
    await database.transaction(async (connection) => {
      const query = connection.query;
      await query
        .insertInto('assignments')
        .values({
          id: parentId,
          employeeId: employee.id,
          courseId: null,
          examId: null,
          certificateId: null,
          learningPathId: str(path.id),
          parentAssignmentId: null,
          pathStepId: null,
          practiceScenarioId: null,
          learningPlanId: options.learningPlanId ?? null,
          optional: false,
          reminderCount: 0,
          assignedByUserId: options.assignedByUserId,
          dueDate: parentDue,
          status: 'notStarted',
          progress: 0,
          source: options.source,
          completedAt: null,
          cancelledAt: null,
          lastRemindedAt: null,
          escalatedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      let blocked = false;
      for (const { step, done, existing } of decisions) {
        let due = addDays(today, Number(step.dueOffsetDays));
        if (due > parentDue) due = parentDue;
        const locked = bool(path.sequential) && blocked && !done;
        if (!done) blocked = true;
        if (existing) {
          await query
            .updateTable('assignments')
            .set({
              parentAssignmentId: parentId,
              pathStepId: str(step.id),
              status: locked ? 'locked' : str(existing.status),
              updatedAt: stamp,
            })
            .where('id', '=', str(existing.id))
            .execute();
          continue;
        }
        await query
          .insertInto('assignments')
          .values({
            id: newId(),
            employeeId: employee.id,
            courseId:
              step.stepType === 'course' ? nullable(step.courseId) : null,
            examId: step.stepType === 'exam' ? nullable(step.examId) : null,
            certificateId: null,
            learningPathId: null,
            parentAssignmentId: parentId,
            pathStepId: str(step.id),
            practiceScenarioId:
              step.stepType === 'practice'
                ? nullable(step.practiceScenarioId)
                : null,
            learningPlanId: null,
            optional: false,
            reminderCount: 0,
            assignedByUserId: options.assignedByUserId,
            dueDate: due,
            status: done ? 'completed' : locked ? 'locked' : 'notStarted',
            progress: done ? 100 : 0,
            source: 'path',
            completedAt: done ? stamp : null,
            cancelledAt: null,
            lastRemindedAt: null,
            escalatedAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      }
    });
    await syncParent(parentId, { notifyUnlock: false });
    if (employee.userId)
      await notify({
        key: `assignment:${parentId}:assigned`,
        userIds: [employee.userId],
        message: 'pathAssigned',
        params: { title: str(path.title), date: parentDue },
        path: '/talent/my-learning',
      });
    return parentId;
  }

  /** Recomputes one path assignment: completes steps done elsewhere, unlocks the next, sets progress. */
  async function syncParent(
    parentId: string,
    options: { notifyUnlock: boolean } = { notifyUnlock: true },
  ): Promise<void> {
    const query = database.query();
    const parent = await query
      .selectFrom('assignments')
      .selectAll()
      .where('id', '=', parentId)
      .executeTakeFirst();
    if (!parent || !(OPEN as readonly string[]).includes(str(parent.status)))
      return;
    const path = await query
      .selectFrom('learningPaths')
      .selectAll()
      .where('id', '=', str(parent.learningPathId))
      .executeTakeFirst();
    if (!path) return;
    const employeeId = str(parent.employeeId);
    const steps = await stepsOf(str(path.id));
    const children = await query
      .selectFrom('assignments')
      .selectAll()
      .where('parentAssignmentId', '=', parentId)
      .where('status', '!=', 'cancelled')
      .execute();
    const byStep = new Map(children.map((c) => [str(c.pathStepId), c]));
    const stamp = new Date();
    const unlocked: string[] = [];
    let blocked = false;
    let requiredTotal = 0;
    let requiredDone = 0;
    for (const step of steps) {
      const child = byStep.get(str(step.id));
      if (!child) continue;
      let status = str(child.status);
      // A locked step whose content was finished elsewhere (or before the path) completes on its own.
      if (
        status === 'locked' &&
        bool(path.skipCompleted) &&
        (await stepDone(employeeId, step))
      ) {
        status = 'completed';
        await query
          .updateTable('assignments')
          .set({ status, progress: 100, completedAt: stamp, updatedAt: stamp })
          .where('id', '=', str(child.id))
          .execute();
      }
      if (status === 'locked' && (!bool(path.sequential) || !blocked)) {
        status = 'notStarted';
        await query
          .updateTable('assignments')
          .set({ status, updatedAt: stamp })
          .where('id', '=', str(child.id))
          .execute();
        unlocked.push(str(step.id));
      }
      if (status !== 'completed') blocked = true;
      if (bool(step.required)) {
        requiredTotal += 1;
        if (status === 'completed') requiredDone += 1;
      }
    }
    const progress = requiredTotal
      ? Math.round((requiredDone / requiredTotal) * 100)
      : 100;
    const complete = requiredTotal > 0 ? requiredDone === requiredTotal : true;
    await query
      .updateTable('assignments')
      .set({
        progress,
        status: complete
          ? 'completed'
          : parent.status === 'overdue'
            ? 'overdue'
            : progress > 0
              ? 'inProgress'
              : 'notStarted',
        completedAt: complete ? stamp : null,
        updatedAt: stamp,
      })
      .where('id', '=', parentId)
      .execute();
    const employee = await platform.employee(employeeId);
    if (!employee?.userId) return;
    if (options.notifyUnlock)
      for (const stepId of unlocked) {
        const view = (await stepViews(str(path.id))).find(
          (s) => s.id === stepId,
        );
        await notify({
          key: `assignment:${parentId}:unlock:${stepId}`,
          userIds: [employee.userId],
          message: 'pathStepUnlocked',
          params: { path: str(path.title), title: view?.targetTitle ?? '' },
          path: '/talent/my-learning',
        });
      }
    if (complete)
      await notify({
        key: `assignment:${parentId}:completed`,
        userIds: [employee.userId],
        message: 'pathCompleted',
        params: { title: str(path.title) },
        path: '/talent/my-learning',
      });
  }

  async function timelineOf(
    parent: Record<string, unknown>,
  ): Promise<PathTimeline> {
    const pathId = str(parent.learningPathId);
    const path = await database
      .query()
      .selectFrom('learningPaths')
      .select(['title'])
      .where('id', '=', pathId)
      .executeTakeFirst();
    const children = await database
      .query()
      .selectFrom('assignments')
      .selectAll()
      .where('parentAssignmentId', '=', str(parent.id))
      .where('status', '!=', 'cancelled')
      .execute();
    const byStep = new Map(children.map((c) => [str(c.pathStepId), c]));
    return {
      assignmentId: str(parent.id),
      pathId,
      title: str(path?.title ?? ''),
      status: str(parent.status),
      progress: Number(parent.progress) || 0,
      dueDate: dateOnly(parent.dueDate),
      steps: (await stepViews(pathId)).map((step) => {
        const child = byStep.get(step.id);
        return {
          step,
          assignmentId: child ? str(child.id) : null,
          status: child ? str(child.status) : 'cancelled',
          progress: Number(child?.progress) || 0,
          dueDate: dateOnly(child?.dueDate),
        };
      }),
    };
  }

  const service: PathService = {
    async listPaths(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, PATH, 'view');
      const rows = (await database
        .repository('learningPaths')
        .withPolicy(policyOf(policies, 'learningPaths'))
        .findMany({
          filter: (f) =>
            f.and(
              filters.q
                ? [
                    f
                      .string('title')
                      .includes(filters.q, { mode: 'insensitive' }),
                  ]
                : [],
            ),
          sort: (s) => [s.field('updatedAt').desc()],
        })) as Record<string, unknown>[];
      const result: PathView[] = [];
      for (const row of rows) result.push(await toView(ctx, row));
      return result;
    },

    async getPath(ctx, id) {
      return toView(ctx, await loadVisible(ctx, id));
    },

    async savePath(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, PATH, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const existing = id
        ? ((await database
            .repository('learningPaths')
            .withPolicy(policyOf(policies, 'learningPaths'))
            .findOne({ filter: { id } })) as
            Record<string, unknown> | undefined)
        : undefined;
      if (id && !existing) throw new HrError('PATH_NOT_FOUND', 404);
      if (existing && bool(existing.published))
        throw new HrError('PATH_PUBLISHED_LOCKED', 409);
      const code = requireString(input.code, 'PATH_CODE_REQUIRED', {
        max: 64,
      })!;
      if (!/^[A-Za-z0-9._-]+$/u.test(code))
        throw new HrError('PATH_CODE_INVALID', 400);
      const title = requireString(input.title, 'PATH_TITLE_REQUIRED', {
        max: 200,
      })!;
      const description = requireString(input.description, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
      const positionId = requireString(input.positionId, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      });
      const purpose = (input.purpose ?? 'onboarding') as string;
      if (!(PURPOSES as readonly string[]).includes(purpose))
        throw new HrError('INVALID_INPUT', 400);
      const steps =
        input.steps === undefined ? undefined : parseSteps(input.steps);
      if (steps) await assertTargetsExist(steps);
      if (
        positionId &&
        !(await database
          .query()
          .selectFrom('positions')
          .select(['id'])
          .where('id', '=', positionId)
          .executeTakeFirst())
      )
        throw new HrError('POSITION_NOT_FOUND', 404);
      const clash = await database
        .query()
        .selectFrom('learningPaths')
        .select(['id'])
        .where('code', '=', code)
        .executeTakeFirst();
      if (clash && str(clash.id) !== id)
        throw new HrError('PATH_CODE_TAKEN', 409);
      const pathId = id ?? newId();
      const stamp = new Date();
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('learningPaths')
          .withPolicy(policyOf(policies, 'learningPaths'));
        const values = {
          code,
          title,
          description,
          positionId,
          purpose,
          sequential:
            input.sequential === undefined ? true : input.sequential === true,
          skipCompleted:
            input.skipCompleted === undefined
              ? true
              : input.skipCompleted === true,
          updatedAt: stamp,
        };
        if (existing) await repo.updateOne({ filter: { id: pathId }, values });
        else
          await repo.createOne({
            values: {
              id: pathId,
              ...values,
              ownerUserId: ctx.userId,
              published: false,
              publishedAt: null,
              active: true,
              createdAt: stamp,
            },
          });
        if (steps) {
          const stepRepo = connection
            .repository('learningPathSteps')
            .withPolicy(policyOf(policies, 'learningPathSteps'));
          await stepRepo.deleteMany({ filter: { pathId } });
          let order = 0;
          for (const step of steps)
            await stepRepo.createOne({
              values: {
                id: newId(),
                pathId,
                sortOrder: order++,
                ...step,
                createdAt: stamp,
                updatedAt: stamp,
              },
            });
        }
      });
      return service.getPath(ctx, pathId);
    },

    async publishPath(ctx, id, published) {
      const policies = await authorizeAction(ctx.authz, PATH, 'publish');
      const row = await loadVisible(ctx, id);
      if (published) {
        if (!bool(row.active)) throw new HrError('PATH_INACTIVE', 409);
        const steps = await stepViews(id);
        if (!steps.length) throw new HrError('PATH_HAS_NO_STEPS', 409);
        const notReady = steps.filter((s) => !s.targetReady);
        if (notReady.length)
          throw new HrError('PATH_STEP_NOT_READY', 409, {
            titles: notReady.map((s) => s.targetTitle),
          });
        for (let i = 1; i < steps.length; i += 1)
          if (steps[i].dueOffsetDays < steps[i - 1].dueOffsetDays)
            throw new HrError('PATH_DUE_NOT_INCREASING', 409);
        if (row.positionId) {
          const other = await database
            .query()
            .selectFrom('learningPaths')
            .select(['id'])
            .where('positionId', '=', str(row.positionId))
            .where('purpose', '=', str(row.purpose))
            .where('published', '=', true)
            .where('id', '!=', id)
            .executeTakeFirst();
          if (other) throw new HrError('PATH_POSITION_TAKEN', 409);
        }
      }
      await database
        .repository('learningPaths')
        .withPolicy(policyOf(policies, 'learningPaths'))
        .updateOne({
          filter: { id },
          values: {
            published,
            publishedAt: published ? new Date() : null,
            updatedAt: new Date(),
          },
        });
      return service.getPath(ctx, id);
    },

    async setPathActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, PATH, 'manage');
      await loadVisible(ctx, id);
      await database
        .repository('learningPaths')
        .withPolicy(policyOf(policies, 'learningPaths'))
        .updateOne({
          filter: { id },
          values: active
            ? { active, updatedAt: new Date() }
            : { active, published: false, updatedAt: new Date() },
        });
      return service.getPath(ctx, id);
    },

    async previewAssignment(ctx, input) {
      return buildPreview(ctx, parseAssignInput(input));
    },

    async assign(ctx, input) {
      const parsed = parseAssignInput(input);
      const preview = await buildPreview(ctx, parsed);
      const path = await publishedPath(parsed.learningPathId);
      let created = 0;
      for (const person of preview.included) {
        const employee = await platform.employee(person.employeeId);
        if (!employee) continue;
        await createPathAssignment(employee, path, {
          assignedByUserId: ctx.userId,
          source: 'manual',
          dueDate: parsed.dueDate,
        });
        created += 1;
      }
      return { created, preview };
    },

    async assignFor(employeeId, pathId, options) {
      const path = await publishedPath(pathId);
      if (await hasOpenPath(employeeId, pathId)) return undefined;
      const employee = await platform.employee(employeeId);
      if (!employee || employee.status === 'leave') return undefined;
      return createPathAssignment(employee, path, {
        assignedByUserId: options.assignedByUserId,
        source: options.source,
        learningPlanId: options.learningPlanId ?? null,
        dueDate: options.dueDate ?? null,
      });
    },

    async syncEmployee(employeeId) {
      const parents = await database
        .query()
        .selectFrom('assignments')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('learningPathId', 'is not', null)
        .where('status', 'in', [...OPEN])
        .execute();
      for (const parent of parents) await syncParent(str(parent.id));
    },

    async myTimelines(ctx) {
      const policies = await authorizeAction(ctx.authz, LEARNING, 'study');
      const rows = (await database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .findMany({
          filter: (f) => f.string('status').ne('cancelled'),
          sort: (s) => [s.field('createdAt').desc()],
        })) as Record<string, unknown>[];
      const result: PathTimeline[] = [];
      for (const row of rows.filter((r) => r.learningPathId))
        result.push(await timelineOf(row));
      return result;
    },

    async timeline(ctx, parentAssignmentId) {
      const view =
        (await tryAuthorizeAction(ctx.authz, ASSIGNMENT, 'view')) ??
        (await authorizeAction(ctx.authz, LEARNING, 'study'));
      const row = (await database
        .repository('assignments')
        .withPolicy(policyOf(view, 'assignments'))
        .findOne({ filter: { id: parentAssignmentId } })) as
        Record<string, unknown> | undefined;
      if (!row?.learningPathId) throw new HrError('ASSIGNMENT_NOT_FOUND', 404);
      return timelineOf(row);
    },

    async cancelChildren(parentAssignmentId) {
      const stamp = new Date();
      await database
        .query()
        .updateTable('assignments')
        .set({ status: 'cancelled', cancelledAt: stamp, updatedAt: stamp })
        .where('parentAssignmentId', '=', parentAssignmentId)
        .where('status', 'in', [...OPEN, 'locked'])
        .execute();
    },

    async assignableTargets() {
      const rows = await database
        .query()
        .selectFrom('learningPaths')
        .select(['id', 'title', 'published', 'active'])
        .execute();
      return rows
        .filter((r) => bool(r.published) && bool(r.active))
        .map((r) => ({ id: str(r.id), title: str(r.title) }));
    },
  };
  return service;
}

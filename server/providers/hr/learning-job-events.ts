/**
 * V3-09 岗位变动触发学习, registered as a job-event handler (总纲 rule 2:
 * learning reacts to `jobEvents`, never to the employees table):
 *
 * - onboard / transfer / promote: the new position's published onboarding
 *   path is assigned (source=path, `jobEventId` = the event), its due dates
 *   counted from the effective date, or from today when that has passed;
 *   finished courses count as completed (the path's `skipCompleted`) and open
 *   tasks for the same content are attached. A transfer or promotion first
 *   cancels the unfinished path of the old position's onboarding path
 *   (cancelReason=jobChange; its own steps parentCancelled; tasks that were
 *   attached from elsewhere are detached and kept). The employee and the
 *   department head are told.
 * - offboard: every unfinished task is cancelled (cancelReason=offboard),
 *   locked path steps included, and enrollments in sessions not yet started.
 * - regularize: nothing.
 *
 * Each rule is idempotent: a retried event finds its path assignment by
 * `jobEventId` and assigns nothing again; cancelling is a no-op the second
 * time. `outcome` lists what an event did, for the event's 学习处理 block and
 * the change checklist's learning item.
 */
import { authorizeAction, policyOf } from './authorize.js';
import type {
  ChecklistProvider,
  ProviderContext,
  ProviderItem,
} from './change-checklists.js';
import type { ActorContext } from './framework-service.js';
import type { JobEvent } from './job-events.js';
import type { PathService } from './path-service.js';
import { bool, json, type Platform } from './platform.js';
import { daysBetween, HrError, str } from './shared.js';

const OPEN = ['notStarted', 'inProgress', 'overdue', 'locked'] as const;

export interface LearningEventTask {
  readonly assignmentId: string;
  readonly title: string;
  readonly kind: 'course' | 'learningPath' | 'exam' | 'practice';
  readonly status: string;
  readonly cancelReason: string | null;
}

export interface LearningEventOutcome {
  readonly eventId: string;
  readonly eventType: string;
  readonly processed: boolean;
  /** The path assignment the event created, if any. */
  readonly assignedPath: {
    readonly assignmentId: string;
    readonly title: string;
    readonly dueDate: string | null;
    /** Steps counted as completed because the content was finished before. */
    readonly completedSteps: readonly string[];
    /** Steps that took over an open task instead of a new one. */
    readonly attachedSteps: readonly string[];
  } | null;
  readonly cancelled: readonly LearningEventTask[];
  /** Learning plans the coach drafted for the event. */
  readonly plans: readonly {
    readonly id: string;
    readonly status: string;
    readonly items: number;
  }[];
}

export interface LearningJobEvents {
  handle(
    event: JobEvent,
  ): Promise<{ assigned: string | null; cancelled: number }>;
  /** What an event did; no authorization — for the checklist provider and the service below. */
  outcome(eventId: string): Promise<LearningEventOutcome>;
  /** The open tasks an offboarding would cancel, for a checklist before it takes effect. */
  openTasks(employeeId: string): Promise<LearningEventTask[]>;
  /** The event's 学习处理 block, for whoever may view the event (talent.jobEvent view, its scope). */
  view(ctx: ActorContext, eventId: string): Promise<LearningEventOutcome>;
  /** The change checklist's 学习 item (V1-02 provider `learning`). */
  checklistProvider(): ChecklistProvider;
}

export interface LearningJobEventsDeps {
  readonly platform: Platform;
  readonly paths: () => PathService;
  /** Who counts as the assigner of automatic tasks: the learning coach task's owner. */
  readonly owner: () => Promise<string | null>;
  /** 学习规则: an onboarding effective longer ago than this is a backfill and assigns no path. */
  readonly backfillDays?: () => Promise<number>;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}

export function createLearningJobEvents(
  deps: LearningJobEventsDeps,
): LearningJobEvents {
  const { platform } = deps;
  const { database } = platform;

  async function taskTitle(row: Record<string, unknown>) {
    const query = database.query();
    const pick = async (table: string, id: unknown) =>
      str(
        (
          await query
            .selectFrom(table)
            .select(['title'])
            .where('id', '=', str(id))
            .executeTakeFirst()
        )?.title ?? '',
      );
    if (row.courseId)
      return {
        kind: 'course' as const,
        title: await pick('courses', row.courseId),
      };
    if (row.learningPathId)
      return {
        kind: 'learningPath' as const,
        title: await pick('learningPaths', row.learningPathId),
      };
    if (row.examId)
      return { kind: 'exam' as const, title: await pick('exams', row.examId) };
    return {
      kind: 'practice' as const,
      title: await pick('practiceScenarios', row.practiceScenarioId),
    };
  }

  async function toTask(
    row: Record<string, unknown>,
  ): Promise<LearningEventTask> {
    const { kind, title } = await taskTitle(row);
    return {
      assignmentId: str(row.id),
      title,
      kind,
      status: str(row.status),
      cancelReason: row.cancelReason == null ? null : str(row.cancelReason),
    };
  }

  /** The published, active onboarding path of a position. */
  async function onboardingPath(positionId: string | null) {
    if (!positionId) return undefined;
    const rows = await database
      .query()
      .selectFrom('learningPaths')
      .select(['id', 'title', 'published', 'active'])
      .where('positionId', '=', positionId)
      .where('purpose', '=', 'onboarding')
      .execute();
    return rows.find((r) => bool(r.published) && bool(r.active));
  }

  async function cancelOnOffboard(event: JobEvent): Promise<number> {
    const query = database.query();
    const open = await query
      .selectFrom('assignments')
      .select(['id'])
      .where('employeeId', '=', event.employeeId)
      .where('status', 'in', [...OPEN])
      .execute();
    // Enrollments in sessions that have not started; attended and past ones stay as records.
    const now = new Date();
    const enrollments = (
      await query
        .selectFrom('trainingEnrollments')
        .innerJoin(
          'trainingSessions',
          'trainingSessions.id',
          'trainingEnrollments.sessionId',
        )
        .select([
          'trainingEnrollments.id as id',
          'trainingSessions.startAt as startAt',
        ])
        .where('trainingEnrollments.employeeId', '=', event.employeeId)
        .where('trainingEnrollments.status', '=', 'enrolled')
        .execute()
    )
      .filter(
        (r) => new Date(r.startAt as string | Date).getTime() > now.getTime(),
      )
      .map((r) => str(r.id));
    if (!open.length && !enrollments.length) return 0;
    const stamp = new Date();
    // Only the connection's own query builder inside the transaction (SQLite has one connection).
    await database.transaction(async (connection) => {
      if (open.length)
        await connection.query
          .updateTable('assignments')
          .set({
            status: 'cancelled',
            cancelledAt: stamp,
            cancelReason: 'offboard',
            cancelJobEventId: event.id,
            updatedAt: stamp,
          })
          .where(
            'id',
            'in',
            open.map((r) => str(r.id)),
          )
          .where('status', 'in', [...OPEN])
          .execute();
      if (enrollments.length)
        await connection.query
          .updateTable('trainingEnrollments')
          .set({ status: 'cancelled', updatedAt: stamp })
          .where('id', 'in', enrollments)
          .where('status', '=', 'enrolled')
          .execute();
    });
    return open.length;
  }

  /** A transfer or promotion ends the old position's onboarding path; other tasks stay. */
  async function cancelOldPath(event: JobEvent): Promise<number> {
    if (!event.fromPositionId || event.fromPositionId === event.toPositionId)
      return 0;
    const query = database.query();
    const oldPaths = (
      await query
        .selectFrom('learningPaths')
        .select(['id'])
        .where('positionId', '=', event.fromPositionId)
        .where('purpose', '=', 'onboarding')
        .execute()
    ).map((r) => str(r.id));
    if (!oldPaths.length) return 0;
    const parents = (
      await query
        .selectFrom('assignments')
        .select(['id'])
        .where('employeeId', '=', event.employeeId)
        .where('learningPathId', 'in', oldPaths)
        .where('status', 'in', [...OPEN])
        .execute()
    ).map((r) => str(r.id));
    if (!parents.length) return 0;
    const children = await query
      .selectFrom('assignments')
      .select(['id', 'source', 'status'])
      .where('parentAssignmentId', 'in', parents)
      .where('status', 'in', [...OPEN])
      .execute();
    const own = children
      .filter((c) => str(c.source) === 'path')
      .map((c) => str(c.id));
    const attached = children.filter((c) => str(c.source) !== 'path');
    const stamp = new Date();
    await database.transaction(async (connection) => {
      await connection.query
        .updateTable('assignments')
        .set({
          status: 'cancelled',
          cancelledAt: stamp,
          cancelReason: 'jobChange',
          cancelJobEventId: event.id,
          updatedAt: stamp,
        })
        .where('id', 'in', parents)
        .execute();
      if (own.length)
        await connection.query
          .updateTable('assignments')
          .set({
            status: 'cancelled',
            cancelledAt: stamp,
            cancelReason: 'parentCancelled',
            cancelJobEventId: event.id,
            updatedAt: stamp,
          })
          .where('id', 'in', own)
          .execute();
      // A task someone assigned before the path is the person's own again, unlocked.
      for (const task of attached)
        await connection.query
          .updateTable('assignments')
          .set({
            parentAssignmentId: null,
            pathStepId: null,
            status:
              str(task.status) === 'locked' ? 'notStarted' : str(task.status),
            updatedAt: stamp,
          })
          .where('id', '=', str(task.id))
          .execute();
    });
    return parents.length;
  }

  async function assignOnboarding(event: JobEvent): Promise<string | null> {
    const query = database.query();
    const done = await query
      .selectFrom('assignments')
      .select(['id'])
      .where('jobEventId', '=', event.id)
      .executeTakeFirst();
    // A retried event: the path was assigned the first time.
    if (done) return null;
    const employee = await platform.employee(event.employeeId);
    if (!employee || employee.status === 'leave') return null;
    const path = await onboardingPath(
      event.toPositionId ?? employee.positionId,
    );
    if (!path) return null;
    const effective = event.effectiveDate.slice(0, 10);
    const today = platform.currentDate();
    // Recording someone already at work (an import, a 补录) is not a start in the position.
    if (
      event.eventType === 'onboard' &&
      effective &&
      daysBetween(effective, today) > ((await deps.backfillDays?.()) ?? 30)
    )
      return null;
    const parentId = await deps.paths().assignFor(employee.id, str(path.id), {
      assignedByUserId: await deps.owner(),
      source: 'path',
      jobEventId: event.id,
      startDate: effective > today ? effective : today,
    });
    if (!parentId) return null;
    // The employee hears through the path assignment itself; the head is told here.
    const head = await platform.headOf(employee);
    if (head) {
      const parent = await query
        .selectFrom('assignments')
        .select(['dueDate'])
        .where('id', '=', parentId)
        .executeTakeFirst();
      await platform.notify({
        key: `assignment:${parentId}:assigned:head`,
        userIds: [head],
        message: 'pathAutoAssignedHead',
        params: {
          name: employee.name,
          title: str(path.title),
          date: dateOnly(parent?.dueDate) ?? '',
        },
        path: '/talent/assignments',
      });
    }
    return parentId;
  }

  const service: LearningJobEvents = {
    async handle(event) {
      if (event.eventType === 'offboard')
        return { assigned: null, cancelled: await cancelOnOffboard(event) };
      if (
        event.eventType !== 'onboard' &&
        event.eventType !== 'transfer' &&
        event.eventType !== 'promote'
      )
        return { assigned: null, cancelled: 0 };
      const cancelled =
        event.eventType === 'onboard' ? 0 : await cancelOldPath(event);
      const assigned = await assignOnboarding(event);
      return { assigned, cancelled };
    },

    async outcome(eventId) {
      const query = database.query();
      const event = await query
        .selectFrom('jobEvents')
        .select(['id', 'eventType', 'processedAt'])
        .where('id', '=', eventId)
        .executeTakeFirst();
      if (!event) throw new HrError('NOT_FOUND', 404);
      const parent = await query
        .selectFrom('assignments')
        .selectAll()
        .where('jobEventId', '=', eventId)
        .where('learningPathId', 'is not', null)
        .executeTakeFirst();
      let assignedPath: LearningEventOutcome['assignedPath'] = null;
      if (parent) {
        const children = await query
          .selectFrom('assignments')
          .selectAll()
          .where('parentAssignmentId', '=', str(parent.id))
          .execute();
        const completed: string[] = [];
        const attached: string[] = [];
        const created = new Date(parent.createdAt as string | Date).getTime();
        for (const child of children) {
          const { title } = await taskTitle(child);
          // Counted as completed at assignment: finished at the moment the path was created.
          if (
            str(child.source) === 'path' &&
            child.completedAt &&
            Math.abs(
              new Date(child.completedAt as string | Date).getTime() - created,
            ) < 60_000
          )
            completed.push(title);
          else if (str(child.source) !== 'path') attached.push(title);
        }
        assignedPath = {
          assignmentId: str(parent.id),
          title: (await taskTitle(parent)).title,
          dueDate: dateOnly(parent.dueDate),
          completedSteps: completed,
          attachedSteps: attached,
        };
      }
      const cancelledRows = await query
        .selectFrom('assignments')
        .selectAll()
        .where('cancelJobEventId', '=', eventId)
        // A path's own steps are listed through the path.
        .where('cancelReason', '!=', 'parentCancelled')
        .execute();
      const cancelled: LearningEventTask[] = [];
      const cancelledIds = new Set(cancelledRows.map((r) => str(r.id)));
      for (const row of cancelledRows)
        // A path's steps cancelled with it are listed through the path.
        if (
          !row.parentAssignmentId ||
          !cancelledIds.has(str(row.parentAssignmentId))
        )
          cancelled.push(await toTask(row));
      const plans = (
        await query
          .selectFrom('learningPlans')
          .select(['id', 'status', 'items', 'triggerRef', 'trigger'])
          .where('trigger', '=', 'jobEvent')
          .execute()
      )
        .filter(
          (p) =>
            json<{ jobEventId?: string }>(p.triggerRef, {}).jobEventId ===
            eventId,
        )
        .map((p) => ({
          id: str(p.id),
          status: str(p.status),
          items: json<unknown[]>(p.items, []).length,
        }));
      return {
        eventId,
        eventType: str(event.eventType),
        processed: Boolean(event.processedAt),
        assignedPath,
        cancelled,
        plans,
      };
    },

    async openTasks(employeeId) {
      const rows = await database
        .query()
        .selectFrom('assignments')
        .selectAll()
        .where('employeeId', '=', employeeId)
        .where('status', 'in', [...OPEN])
        // Path steps go with their path.
        .where('parentAssignmentId', 'is', null)
        .execute();
      const result: LearningEventTask[] = [];
      for (const row of rows) result.push(await toTask(row));
      return result;
    },

    checklistProvider() {
      const titles = (tasks: readonly LearningEventTask[]) =>
        tasks
          .slice(0, 5)
          .map((t) => `《${t.title}》`)
          .join('、');
      const eventOf = async (context: ProviderContext) => {
        if (context.event) return context.event.id;
        if (!context.action) return null;
        const row = await database
          .query()
          .selectFrom('jobEvents')
          .select(['id'])
          .where('actionId', '=', context.action.id)
          .orderBy('createdAt', 'desc')
          .executeTakeFirst();
        return row ? str(row.id) : null;
      };
      return {
        key: 'learning',
        kinds: ['onboard', 'change', 'offboard'],
        items: async (context: ProviderContext): Promise<ProviderItem[]> => {
          const employeeId = context.employee?.id ?? context.event?.employeeId;
          const eventId = context.effective ? await eventOf(context) : null;
          if (context.kind === 'offboard') {
            if (eventId) {
              const done = await service.outcome(eventId);
              return [
                {
                  key: 'learning',
                  code: 'learningCancelled',
                  params: {
                    count: String(done.cancelled.length),
                    titles: titles(done.cancelled),
                  },
                  status: 'auto',
                },
              ];
            }
            if (!employeeId) return [];
            const open = await service.openTasks(employeeId);
            if (!open.length) return [];
            return [
              {
                key: 'learning',
                code: 'learningCancelPending',
                params: { count: String(open.length), titles: titles(open) },
                status: 'auto',
              },
            ];
          }
          if (eventId) {
            const done = await service.outcome(eventId);
            const items: ProviderItem[] = [];
            if (done.assignedPath)
              items.push({
                key: 'learning',
                code: 'learningPathAssigned',
                params: {
                  path: done.assignedPath.title,
                  completed: done.assignedPath.completedSteps.join('、'),
                  attached: done.assignedPath.attachedSteps.join('、'),
                },
                status: 'auto',
                link: '/talent/assignments',
              });
            if (done.cancelled.length)
              items.push({
                key: 'learningCancelled',
                code: 'learningCancelled',
                params: {
                  count: String(done.cancelled.length),
                  titles: titles(done.cancelled),
                },
                status: 'auto',
              });
            if (!items.length)
              items.push({
                key: 'learning',
                code: 'learningNoPath',
                params: {},
                status: 'auto',
              });
            return items;
          }
          // Before it takes effect: the path the new position will bring.
          const positionId =
            context.action?.toPositionId ?? context.event?.toPositionId ?? null;
          const path = await onboardingPath(positionId);
          if (!path) return [];
          return [
            {
              key: 'learning',
              code: 'learningPathPending',
              params: { path: str(path.title) },
              status: 'auto',
            },
          ];
        },
      };
    },

    async view(ctx, eventId) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.jobEvent',
        'view',
      );
      const visible = await database
        .repository('jobEvents')
        .withPolicy(policyOf(policies, 'jobEvents'))
        .findOne({ filter: { id: eventId } });
      if (!visible) throw new HrError('NOT_FOUND', 404);
      return service.outcome(eventId);
    },
  };
  return service;
}

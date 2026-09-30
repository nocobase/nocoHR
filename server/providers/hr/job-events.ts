/**
 * Job events (总纲 rule 2): every change of an employee's department,
 * position or status is written to `jobEvents`, and every later automation
 * starts from an event rather than watching the employees table.
 *
 * - `recordJobEvent` writes one event inside the caller's transaction;
 * - `classifyJobChange` decides the type of a manual or imported change;
 * - `createJobEventProcessor` runs the registered handlers once per event
 *   after the transaction commits, and stamps `processedAt`. A handler that
 *   fails leaves the event unprocessed, so the daily run retries it.
 */
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import { HrError, newId, str, toDateOnly } from './shared.js';

export const JOB_EVENT_TYPES = [
  'onboard',
  'regularize',
  'transfer',
  'promote',
  'offboard',
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];
export const JOB_EVENT_SOURCES = [
  'action',
  'manual',
  'import',
  'sync',
] as const;
export type JobEventSource = (typeof JOB_EVENT_SOURCES)[number];

export interface JobEvent {
  id: string;
  employeeId: string;
  eventType: JobEventType;
  fromDepartmentId: string | null;
  toDepartmentId: string | null;
  fromPositionId: string | null;
  toPositionId: string | null;
  effectiveDate: string;
  source: JobEventSource;
  actionId: string | null;
  note: string | null;
  /** V1-03: the sync that produced a `source=sync` event. */
  syncRunId?: string | null;
  /** Why the last handler run failed; cleared once handled. */
  processError?: string | null;
}

export interface JobState {
  departmentId: string | null;
  positionId: string | null;
  status: string;
}

export async function recordJobEvent(
  connection: DatabaseConnection,
  input: Omit<JobEvent, 'id' | 'processError'>,
): Promise<string> {
  if (input.source === 'action' && !input.actionId)
    throw new HrError('JOB_EVENT_ACTION_REQUIRED', 400);
  if (input.source === 'sync' && !input.syncRunId)
    throw new HrError('JOB_EVENT_SYNC_RUN_REQUIRED', 400);
  // A correction must say why; backfilling an employee already at work is its own reason.
  if (
    input.source === 'manual' &&
    input.eventType !== 'onboard' &&
    !input.note?.trim()
  )
    throw new HrError('EMPLOYEE_CORRECTION_NOTE_REQUIRED', 400);
  const id = newId();
  const stamp = new Date();
  await connection.query
    .insertInto('jobEvents')
    .values({
      id,
      ...input,
      actionId: input.source === 'action' ? input.actionId : null,
      note: input.note?.trim() || null,
      syncRunId: input.source === 'sync' ? (input.syncRunId ?? null) : null,
      processedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
    })
    .execute();
  return id;
}

/** Compares two grades of one job family: the configured order first, natural order otherwise. */
export function compareGrades(
  a: string,
  b: string,
  order: readonly string[] | undefined,
): number {
  if (order?.length) {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
  }
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export interface PositionGrade {
  jobFamilyId: string;
  grade: string | null;
}

/** Whether moving from one position to another is a promotion: same job family, strictly higher grade. */
export function isPromotion(
  from: PositionGrade | undefined,
  to: PositionGrade | undefined,
  gradeOrder: Readonly<Record<string, readonly string[]>>,
): boolean {
  if (!from || !to || from.jobFamilyId !== to.jobFamilyId) return false;
  if (!from.grade || !to.grade) return false;
  return compareGrades(to.grade, from.grade, gradeOrder[to.jobFamilyId]) > 0;
}

/**
 * The type of a manual or imported change (V1-02 类型判定), in this order:
 * new employee → onboard; to leave → offboard; probation → active →
 * regularize; same family, higher grade → promote; any other department or
 * position change → transfer. Anything else is no event.
 */
export function classifyJobChange(
  before: JobState | null,
  after: JobState,
  positions: {
    from?: PositionGrade;
    to?: PositionGrade;
    gradeOrder: Readonly<Record<string, readonly string[]>>;
  },
): JobEventType | null {
  if (!before) return 'onboard';
  if (after.status === 'leave' && before.status !== 'leave') return 'offboard';
  if (before.status === 'probation' && after.status === 'active')
    return 'regularize';
  const positionChanged = before.positionId !== after.positionId;
  if (
    positionChanged &&
    isPromotion(positions.from, positions.to, positions.gradeOrder)
  )
    return 'promote';
  if (positionChanged || before.departmentId !== after.departmentId)
    return 'transfer';
  return null;
}

export async function loadPositionGrades(
  query: DatabaseConnection['query'],
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, PositionGrade>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!wanted.length) return new Map();
  const rows = await query
    .selectFrom('positions')
    .select(['id', 'jobFamilyId', 'grade'])
    .where('id', 'in', wanted)
    .execute();
  return new Map(
    rows.map((row) => [
      String(row.id),
      {
        jobFamilyId: str(row.jobFamilyId),
        grade: row.grade == null ? null : str(row.grade),
      },
    ]),
  );
}

export interface JobEventHandler {
  /** A stable name, for logs. */
  key: string;
  /** Must be idempotent: a failed run leaves the event to be handled again. */
  handle(event: JobEvent): Promise<void>;
}

export interface JobEventProcessor {
  register(handler: JobEventHandler): () => void;
  /** Handles the given events, or every unprocessed one; returns how many were stamped processed. */
  process(ids?: readonly string[]): Promise<number>;
}

export function createJobEventProcessor(deps: {
  database: DatabaseManager;
  onError: (error: unknown, event: JobEvent, handler: string) => void;
}): JobEventProcessor {
  const handlers: JobEventHandler[] = [];
  let running: Promise<number> = Promise.resolve(0);

  async function run(ids?: readonly string[]): Promise<number> {
    let select = deps.database
      .query()
      .selectFrom('jobEvents')
      .selectAll()
      .where('processedAt', 'is', null);
    if (ids) {
      if (!ids.length) return 0;
      select = select.where('id', 'in', [...ids]);
    }
    const rows = await select.orderBy('createdAt', 'asc').limit(500).execute();
    let processed = 0;
    for (const row of rows) {
      const event = toJobEvent(row);
      const failures: string[] = [];
      for (const handler of handlers) {
        try {
          await handler.handle(event);
        } catch (error) {
          failures.push(
            `${handler.key}: ${error instanceof Error ? error.message : str(error)}`.slice(
              0,
              500,
            ),
          );
          deps.onError(error, event, handler.key);
        }
      }
      if (failures.length) {
        // Shown on the 岗位变动 page with a retry button.
        await deps.database
          .query()
          .updateTable('jobEvents')
          .set({ processError: failures.join('\n'), updatedAt: new Date() })
          .where('id', '=', event.id)
          .execute();
        continue;
      }
      // Stamp only an event still unprocessed: two runs never both claim it.
      const result = await deps.database
        .query()
        .updateTable('jobEvents')
        .set({
          processedAt: new Date(),
          processError: null,
          updatedAt: new Date(),
        })
        .where('id', '=', event.id)
        .where('processedAt', 'is', null)
        .execute();
      if ((result.updatedCount ?? 0) > 0) processed += 1;
    }
    return processed;
  }

  return {
    register(handler) {
      handlers.push(handler);
      return () => {
        const index = handlers.indexOf(handler);
        if (index >= 0) handlers.splice(index, 1);
      };
    },
    process(ids) {
      // One run at a time, so an event is never handled by two runs at once.
      running = running.catch(() => 0).then(() => run(ids));
      return running;
    },
  };
}

export function toJobEvent(row: Record<string, unknown>): JobEvent {
  return {
    id: String(row.id),
    employeeId: String(row.employeeId),
    eventType: String(row.eventType) as JobEventType,
    fromDepartmentId:
      row.fromDepartmentId == null ? null : str(row.fromDepartmentId),
    toDepartmentId: row.toDepartmentId == null ? null : str(row.toDepartmentId),
    fromPositionId: row.fromPositionId == null ? null : str(row.fromPositionId),
    toPositionId: row.toPositionId == null ? null : str(row.toPositionId),
    effectiveDate: toDateOnly(row.effectiveDate as string | Date) ?? '',
    source: (row.source == null ? 'import' : str(row.source)) as JobEventSource,
    actionId: row.actionId == null ? null : str(row.actionId),
    note: row.note == null ? null : str(row.note),
    syncRunId: row.syncRunId == null ? null : str(row.syncRunId),
    processError: row.processError == null ? null : str(row.processError),
  };
}

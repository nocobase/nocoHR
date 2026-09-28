/**
 * Offline training sessions (V2 step 5): scheduling a session of an offline
 * course, enrolling (oneself, or one's team), checking in with a QR code that
 * changes every 30 seconds, recording attendance by hand with a reason, and
 * exporting the attendance sheet as the training record.
 *
 * Check-in is decided on the server alone: the person is enrolled, the time
 * is between 30 minutes before the start and the end, and the code is at most
 * 30 seconds old. The check-in time is the server's clock; a time the client
 * sends is ignored. Attending completes the linked course assignment.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as XLSX from 'xlsx';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { bool, type Platform } from './platform.js';
import { HrError, isRecord, newId, requireString, str } from './shared.js';

const SESSION = 'talent.trainingSession';
const OPEN_ASSIGNMENT = ['notStarted', 'inProgress', 'overdue'] as const;
/** How long a check-in code stays valid; the screen shows a new one every 30 seconds. */
export const CHECK_IN_CODE_TTL_MS = 30_000;
const CHECK_IN_OPENS_BEFORE_MS = 30 * 60_000;
/** Enrollments still open two hours after the end become absences. */
const ABSENT_AFTER_MS = 2 * 60 * 60_000;
const DEFAULT_ENROLL_DEADLINE_MS = 24 * 60 * 60_000;
/** The reminder for tomorrow's sessions goes out from this local hour. */
const REMINDER_HOUR = 18;

export interface SessionView {
  readonly id: string;
  readonly courseId: string;
  readonly courseTitle: string;
  readonly title: string;
  readonly instructorUserId: string;
  readonly instructorName: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly location: string;
  readonly capacity: number;
  readonly enrolledCount: number;
  readonly remaining: number;
  readonly enrollDeadline: string | null;
  readonly status: string;
  readonly ownerUserId: string;
  readonly attendedCount: number;
  readonly absentCount: number;
  /** The caller's own enrollment in this session, if any. */
  readonly myEnrollment: { id: string; status: string } | null;
  readonly can: {
    manage: boolean;
    markAttendance: boolean;
    export: boolean;
    enroll: boolean;
  };
}

export interface EnrollmentView {
  readonly id: string;
  readonly employeeId: string;
  readonly name: string;
  readonly employeeNo: string;
  readonly departmentTitle: string;
  readonly status: string;
  readonly checkedInAt: string | null;
  readonly checkInMethod: string | null;
  readonly markedByName: string | null;
  readonly markReason: string | null;
}

export interface SessionDetail extends SessionView {
  readonly enrollments: readonly EnrollmentView[];
}

export interface SessionService {
  listSessions(
    ctx: ActorContext,
    filters: { courseId?: string; from?: string; to?: string },
  ): Promise<SessionView[]>;
  getSession(ctx: ActorContext, id: string): Promise<SessionDetail>;
  saveSession(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<SessionDetail>;
  cancelSession(ctx: ActorContext, id: string): Promise<SessionDetail>;
  enroll(
    ctx: ActorContext,
    sessionId: string,
    employeeId?: string,
  ): Promise<SessionDetail>;
  cancelEnrollment(
    ctx: ActorContext,
    sessionId: string,
    employeeId?: string,
  ): Promise<SessionDetail>;
  checkInCode(
    ctx: ActorContext,
    sessionId: string,
  ): Promise<{ code: string; expiresAt: string }>;
  checkIn(
    ctx: ActorContext,
    code: string,
  ): Promise<{
    sessionId: string;
    title: string;
    status: 'attended';
    checkedInAt: string;
  }>;
  markAttendance(
    ctx: ActorContext,
    sessionId: string,
    input: unknown,
  ): Promise<SessionDetail>;
  exportAttendance(
    ctx: ActorContext,
    sessionId: string,
  ): Promise<{ filename: string; bytes: Buffer }>;
  /** Sessions a learner can enroll in for the offline courses they are assigned. */
  myOfferings(ctx: ActorContext): Promise<Record<string, SessionView[]>>;
  /** Minutely: finished sessions complete and record absences; tomorrow's sessions are reminded from 18:00. */
  runMaintenance(
    now?: Date,
  ): Promise<{ completed: number; absent: number; reminded: number }>;
}

export interface SessionServiceDeps {
  readonly platform: Platform;
  /** Attending completes a course: certification requirements and paths move on. */
  readonly onCourseCompleted?: () =>
    ((employeeId: string, courseId: string) => Promise<void>) | undefined;
  readonly departmentTitle: (id: string) => Promise<string>;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
function time(value: unknown): number {
  return value instanceof Date
    ? value.getTime()
    : new Date(str(value)).getTime();
}
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

export function createSessionService(deps: SessionServiceDeps): SessionService {
  const { platform } = deps;
  const { database, notify } = platform;
  // Codes live for 30 seconds, so a key that changes on restart invalidates nothing that matters.
  const secret = randomBytes(32);

  function sign(sessionId: string, issuedAt: number): string {
    return createHmac('sha256', secret)
      .update(`${sessionId}.${issuedAt}`)
      .digest('base64url')
      .slice(0, 32);
  }

  async function sessionRow(id: string): Promise<Record<string, unknown>> {
    const row = await database
      .query()
      .selectFrom('trainingSessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('SESSION_NOT_FOUND', 404);
    return row;
  }

  async function visibleSession(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, SESSION, 'view');
    const row = (await database
      .repository('trainingSessions')
      .withPolicy(policyOf(policies, 'trainingSessions'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('SESSION_NOT_FOUND', 404);
    return row;
  }

  /** The caller may act on the session as its owner or instructor (or with an unrestricted grant). */
  async function ownsSession(
    ctx: ActorContext,
    action: string,
    id: string,
  ): Promise<boolean> {
    const policies = await tryAuthorizeAction(ctx.authz, SESSION, action);
    if (!policies) return false;
    if (action === 'manage')
      return Boolean(
        await database
          .repository('trainingSessions')
          .withPolicy(policyOf(policies, 'trainingSessions'))
          .findOne({ filter: { id } }),
      );
    // Attendance and export act on enrollments; the session itself must be one the caller may manage or teaches.
    const session = await sessionRow(id);
    if (
      str(session.instructorUserId) === ctx.userId ||
      str(session.ownerUserId) === ctx.userId
    )
      return true;
    const manage = await tryAuthorizeAction(ctx.authz, SESSION, 'manage');
    if (!manage) return false;
    return Boolean(
      await database
        .repository('trainingSessions')
        .withPolicy(policyOf(manage, 'trainingSessions'))
        .findOne({ filter: { id } }),
    );
  }

  async function counts(sessionIds: readonly string[]) {
    const rows = sessionIds.length
      ? await database
          .query()
          .selectFrom('trainingEnrollments')
          .select(['sessionId', 'status', 'employeeId', 'id'])
          .where('sessionId', 'in', [...sessionIds])
          .execute()
      : [];
    return rows;
  }

  async function toViews(
    ctx: ActorContext,
    rows: readonly Record<string, unknown>[],
  ): Promise<SessionView[]> {
    if (!rows.length) return [];
    const enrollments = await counts(rows.map((r) => str(r.id)));
    const courseIds = [...new Set(rows.map((r) => str(r.courseId)))];
    const courses = new Map(
      (
        await database
          .query()
          .selectFrom('courses')
          .select(['id', 'title'])
          .where('id', 'in', courseIds)
          .execute()
      ).map((c) => [str(c.id), str(c.title)]),
    );
    const own = await platform.employeeOfUser(ctx.userId);
    const canEnroll = await platform.can(ctx, SESSION, 'enroll');
    const result: SessionView[] = [];
    for (const row of rows) {
      const id = str(row.id);
      const mine = enrollments.filter((e) => str(e.sessionId) === id);
      const taken = mine.filter(
        (e) => e.status === 'enrolled' || e.status === 'attended',
      ).length;
      const myRow = own
        ? mine.find(
            (e) => str(e.employeeId) === own.id && e.status !== 'cancelled',
          )
        : undefined;
      result.push({
        id,
        courseId: str(row.courseId),
        courseTitle: courses.get(str(row.courseId)) ?? '',
        title: str(row.title),
        instructorUserId: str(row.instructorUserId),
        instructorName: await platform.userName(str(row.instructorUserId)),
        startAt: iso(row.startAt)!,
        endAt: iso(row.endAt)!,
        location: str(row.location),
        capacity: Number(row.capacity),
        enrolledCount: taken,
        remaining: Math.max(Number(row.capacity) - taken, 0),
        enrollDeadline: iso(row.enrollDeadline),
        status: str(row.status),
        ownerUserId: str(row.ownerUserId),
        attendedCount: mine.filter((e) => e.status === 'attended').length,
        absentCount: mine.filter((e) => e.status === 'absent').length,
        myEnrollment: myRow
          ? { id: str(myRow.id), status: str(myRow.status) }
          : null,
        can: {
          manage: await ownsSession(ctx, 'manage', id),
          markAttendance: await ownsSession(ctx, 'markAttendance', id),
          export: await ownsSession(ctx, 'export', id),
          enroll: canEnroll,
        },
      });
    }
    return result;
  }

  async function detail(ctx: ActorContext, id: string): Promise<SessionDetail> {
    const row = await visibleSession(ctx, id);
    const [view] = await toViews(ctx, [row]);
    const policies = await authorizeAction(ctx.authz, SESSION, 'view');
    const rows = (await database
      .repository('trainingEnrollments')
      .withPolicy(policyOf(policies, 'trainingEnrollments'))
      .findMany({
        filter: { sessionId: id },
        sort: (s) => [s.field('createdAt').asc()],
      })) as Record<string, unknown>[];
    const employees = new Map(
      rows.length
        ? (
            await database
              .query()
              .selectFrom('employees')
              .select(['id', 'name', 'employeeNo', 'departmentId'])
              .where(
                'id',
                'in',
                rows.map((r) => str(r.employeeId)),
              )
              .execute()
          ).map((e) => [str(e.id), e])
        : [],
    );
    const enrollments: EnrollmentView[] = [];
    for (const r of rows) {
      const e = employees.get(str(r.employeeId));
      enrollments.push({
        id: str(r.id),
        employeeId: str(r.employeeId),
        name: e ? str(e.name) : '',
        employeeNo: e ? str(e.employeeNo) : '',
        departmentTitle: e
          ? await deps.departmentTitle(str(e.departmentId))
          : '',
        status: str(r.status),
        checkedInAt: iso(r.checkedInAt),
        checkInMethod: nullable(r.checkInMethod),
        markedByName: await platform.userName(nullable(r.markedBy)),
        markReason: nullable(r.markReason),
      });
    }
    return { ...view, enrollments };
  }

  function parseDateTime(value: unknown, code: string): Date {
    if (typeof value !== 'string' || !value) throw new HrError(code, 400);
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new HrError(code, 400);
    return date;
  }

  /** Completes the linked course assignment of an attended enrollment and moves certification and paths on. */
  async function completeAttendance(
    enrollment: Record<string, unknown>,
    session: Record<string, unknown>,
  ) {
    const employeeId = str(enrollment.employeeId);
    const courseId = str(session.courseId);
    const stamp = new Date();
    // The linked task, or any open task for the course the person holds.
    const target = enrollment.assignmentId
      ? str(enrollment.assignmentId)
      : str(
          (
            await database
              .query()
              .selectFrom('assignments')
              .select(['id'])
              .where('employeeId', '=', employeeId)
              .where('courseId', '=', courseId)
              .where('status', 'in', [...OPEN_ASSIGNMENT])
              .executeTakeFirst()
          )?.id ?? '',
        );
    if (target)
      await database
        .query()
        .updateTable('assignments')
        .set({
          status: 'completed',
          progress: 100,
          completedAt: stamp,
          updatedAt: stamp,
        })
        .where('id', '=', target)
        .where('status', 'in', [...OPEN_ASSIGNMENT])
        .execute();
    await deps.onCourseCompleted?.()?.(employeeId, courseId);
  }

  async function linkAssignment(
    employeeId: string,
    courseId: string,
    query: ReturnType<typeof database.query> = database.query(),
  ): Promise<string | null> {
    // Inside a transaction, read through its own connection: SQLite would block a second one.
    const row = await query
      .selectFrom('assignments')
      .select(['id'])
      .where('employeeId', '=', employeeId)
      .where('courseId', '=', courseId)
      .where('status', 'in', [...OPEN_ASSIGNMENT, 'locked'])
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return row ? str(row.id) : null;
  }

  const service: SessionService = {
    async listSessions(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, SESSION, 'view');
      const rows = (await database
        .repository('trainingSessions')
        .withPolicy(policyOf(policies, 'trainingSessions'))
        .findMany({
          filter: (f) =>
            f.and([
              ...(filters.courseId
                ? [f.string('courseId').eq(filters.courseId)]
                : []),
            ]),
          sort: (s) => [s.field('startAt').asc()],
        })) as Record<string, unknown>[];
      const from = filters.from
        ? new Date(`${filters.from}T00:00:00`).getTime()
        : -Infinity;
      const to = filters.to
        ? new Date(`${filters.to}T23:59:59`).getTime()
        : Infinity;
      return toViews(
        ctx,
        rows.filter((r) => time(r.startAt) >= from && time(r.startAt) <= to),
      );
    },

    async getSession(ctx, id) {
      return detail(ctx, id);
    },

    async saveSession(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, SESSION, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      if (id && !(await ownsSession(ctx, 'manage', id)))
        throw new HrError('SESSION_NOT_FOUND', 404);
      const current = id ? await sessionRow(id) : undefined;
      if (current && current.status !== 'scheduled')
        throw new HrError('SESSION_CLOSED', 409);
      const courseId = requireString(
        input.courseId,
        'SESSION_COURSE_REQUIRED',
        { max: 64 },
      )!;
      const course = await database
        .query()
        .selectFrom('courses')
        .select(['title', 'deliveryMode', 'published', 'active'])
        .where('id', '=', courseId)
        .executeTakeFirst();
      if (!course || course.deliveryMode !== 'offline')
        throw new HrError('SESSION_COURSE_NOT_OFFLINE', 409);
      if (!bool(course.published) || !bool(course.active))
        throw new HrError('COURSE_NOT_PUBLISHED', 409);
      const startAt = parseDateTime(input.startAt, 'SESSION_TIME_INVALID');
      const endAt = parseDateTime(input.endAt, 'SESSION_TIME_INVALID');
      if (endAt <= startAt) throw new HrError('SESSION_TIME_INVALID', 400);
      const enrollDeadline =
        input.enrollDeadline === undefined ||
        input.enrollDeadline === null ||
        input.enrollDeadline === ''
          ? new Date(startAt.getTime() - DEFAULT_ENROLL_DEADLINE_MS)
          : parseDateTime(input.enrollDeadline, 'SESSION_TIME_INVALID');
      if (enrollDeadline > startAt)
        throw new HrError('SESSION_TIME_INVALID', 400);
      const capacity = Number(input.capacity);
      if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000)
        throw new HrError('SESSION_CAPACITY_INVALID', 400);
      if (id) {
        const taken = (await counts([id])).filter(
          (e) => e.status === 'enrolled' || e.status === 'attended',
        ).length;
        if (capacity < taken)
          throw new HrError('SESSION_CAPACITY_INVALID', 400);
      }
      const location = requireString(
        input.location,
        'SESSION_LOCATION_REQUIRED',
        { max: 200 },
      )!;
      const instructorUserId =
        requireString(input.instructorUserId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }) ?? ctx.userId;
      const dateText = new Intl.DateTimeFormat('zh-CN', {
        timeZone: platform.timeZone,
        month: 'numeric',
        day: 'numeric',
      }).format(startAt);
      const title =
        requireString(input.title, 'INVALID_INPUT', {
          optional: true,
          max: 200,
        }) ?? `${str(course.title)} · ${dateText}`;
      const stamp = new Date();
      const values = {
        courseId,
        title,
        instructorUserId,
        startAt,
        endAt,
        location,
        capacity,
        enrollDeadline,
        updatedAt: stamp,
      };
      const repo = database
        .repository('trainingSessions')
        .withPolicy(policyOf(policies, 'trainingSessions'));
      const sessionId = id ?? newId();
      if (id) await repo.updateOne({ filter: { id }, values });
      else
        await repo.createOne({
          values: {
            id: sessionId,
            ...values,
            status: 'scheduled',
            ownerUserId: ctx.userId,
            createdAt: stamp,
          },
        });
      return detail(ctx, sessionId);
    },

    async cancelSession(ctx, id) {
      const policies = await authorizeAction(ctx.authz, SESSION, 'manage');
      if (!(await ownsSession(ctx, 'manage', id)))
        throw new HrError('SESSION_NOT_FOUND', 404);
      const session = await sessionRow(id);
      if (session.status !== 'scheduled')
        throw new HrError('SESSION_CLOSED', 409);
      const stamp = new Date();
      await database
        .repository('trainingSessions')
        .withPolicy(policyOf(policies, 'trainingSessions'))
        .updateOne({
          filter: { id },
          values: { status: 'cancelled', updatedAt: stamp },
        });
      const enrolled = await database
        .query()
        .selectFrom('trainingEnrollments')
        .select(['id', 'employeeId'])
        .where('sessionId', '=', id)
        .where('status', '=', 'enrolled')
        .execute();
      await database
        .query()
        .updateTable('trainingEnrollments')
        .set({ status: 'cancelled', updatedAt: stamp })
        .where('sessionId', '=', id)
        .where('status', '=', 'enrolled')
        .execute();
      // Their course tasks stay open: they enroll in another session.
      const userIds: string[] = [];
      for (const row of enrolled) {
        const employee = await platform.employee(str(row.employeeId));
        if (employee?.userId) userIds.push(employee.userId);
      }
      if (userIds.length)
        await notify({
          key: `session:${id}:cancelled`,
          userIds,
          message: 'sessionCancelled',
          params: { title: str(session.title) },
          path: '/talent/my-learning',
        });
      return detail(ctx, id);
    },

    async enroll(ctx, sessionId, employeeId) {
      const policies = await authorizeAction(ctx.authz, SESSION, 'enroll');
      const own = await platform.employeeOfUser(ctx.userId);
      const targetId = employeeId ?? own?.id;
      if (!targetId) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      // The `employees` scope of `enroll` is whom the caller may enroll.
      const allowed = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findOne({ filter: { id: targetId } });
      if (!allowed) throw new HrError('FORBIDDEN', 403);
      const employee = await platform.employee(targetId);
      if (!employee || employee.status === 'leave')
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const session = await sessionRow(sessionId);
      if (session.status !== 'scheduled')
        throw new HrError('SESSION_CLOSED', 409);
      const deadline = session.enrollDeadline
        ? time(session.enrollDeadline)
        : time(session.startAt);
      // An instructor may still add someone until the start; a learner stops at the deadline.
      const teaches = await ownsSession(ctx, 'markAttendance', sessionId);
      if (Date.now() > (teaches ? time(session.startAt) : deadline))
        throw new HrError('SESSION_ENROLL_CLOSED', 409);
      const existing = await database
        .query()
        .selectFrom('trainingEnrollments')
        .selectAll()
        .where('sessionId', '=', sessionId)
        .where('employeeId', '=', targetId)
        .executeTakeFirst();
      if (
        existing &&
        (existing.status === 'enrolled' || existing.status === 'attended')
      )
        throw new HrError('SESSION_ALREADY_ENROLLED', 409);
      const stamp = new Date();
      await database.transaction(async (connection) => {
        const query = connection.query;
        const taken = await query
          .selectFrom('trainingEnrollments')
          .select(['id'])
          .where('sessionId', '=', sessionId)
          .where('status', 'in', ['enrolled', 'attended'])
          .execute();
        if (taken.length >= Number(session.capacity))
          throw new HrError('SESSION_FULL', 409);
        // Enrolling in another session of the same course is a reschedule: the earlier enrollment is released.
        const others = await query
          .selectFrom('trainingEnrollments')
          .innerJoin(
            'trainingSessions',
            'trainingSessions.id',
            'trainingEnrollments.sessionId',
          )
          .select(['trainingEnrollments.id as id'])
          .where('trainingEnrollments.employeeId', '=', targetId)
          .where('trainingSessions.courseId', '=', str(session.courseId))
          .where('trainingSessions.status', '=', 'scheduled')
          .where('trainingEnrollments.status', '=', 'enrolled')
          .where('trainingEnrollments.sessionId', '!=', sessionId)
          .execute();
        for (const other of others)
          await query
            .updateTable('trainingEnrollments')
            .set({ status: 'cancelled', updatedAt: stamp })
            .where('id', '=', str(other.id))
            .execute();
        const assignmentId = await linkAssignment(
          targetId,
          str(session.courseId),
          query,
        );
        if (existing)
          await query
            .updateTable('trainingEnrollments')
            .set({
              status: 'enrolled',
              assignmentId,
              checkedInAt: null,
              checkInMethod: null,
              markedBy: null,
              markReason: null,
              updatedAt: stamp,
            })
            .where('id', '=', str(existing.id))
            .execute();
        else
          await query
            .insertInto('trainingEnrollments')
            .values({
              id: newId(),
              sessionId,
              employeeId: targetId,
              assignmentId,
              status: 'enrolled',
              checkedInAt: null,
              checkInMethod: null,
              markedBy: null,
              markReason: null,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
      });
      return detail(ctx, sessionId);
    },

    async cancelEnrollment(ctx, sessionId, employeeId) {
      const policies = await authorizeAction(ctx.authz, SESSION, 'enroll');
      const own = await platform.employeeOfUser(ctx.userId);
      const targetId = employeeId ?? own?.id;
      if (!targetId) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const allowed = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findOne({ filter: { id: targetId } });
      if (!allowed) throw new HrError('FORBIDDEN', 403);
      const session = await sessionRow(sessionId);
      if (session.status !== 'scheduled')
        throw new HrError('SESSION_CLOSED', 409);
      const enrolled = await database
        .query()
        .selectFrom('trainingEnrollments')
        .select(['id'])
        .where('sessionId', '=', sessionId)
        .where('employeeId', '=', targetId)
        .where('status', '=', 'enrolled')
        .executeTakeFirst();
      if (!enrolled) throw new HrError('SESSION_NOT_ENROLLED', 409);
      await database
        .query()
        .updateTable('trainingEnrollments')
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where('id', '=', str(enrolled.id))
        .execute();
      return detail(ctx, sessionId);
    },

    async checkInCode(ctx, sessionId) {
      if (!(await ownsSession(ctx, 'markAttendance', sessionId)))
        throw new HrError('FORBIDDEN', 403);
      const session = await sessionRow(sessionId);
      if (session.status !== 'scheduled')
        throw new HrError('SESSION_CLOSED', 409);
      const issuedAt = Date.now();
      return {
        code: `${sessionId}.${issuedAt}.${sign(sessionId, issuedAt)}`,
        expiresAt: new Date(issuedAt + CHECK_IN_CODE_TTL_MS).toISOString(),
      };
    },

    async checkIn(ctx, code) {
      const policies = await authorizeAction(ctx.authz, SESSION, 'checkIn');
      const match =
        /^([A-Za-z0-9-]{1,64})\.(\d{10,16})\.([A-Za-z0-9_-]{32})$/u.exec(
          code.trim(),
        );
      if (!match) throw new HrError('CHECK_IN_CODE_INVALID', 400);
      const [, sessionId, issuedText, signature] = match;
      const issuedAt = Number(issuedText);
      const expected = Buffer.from(sign(sessionId, issuedAt));
      const given = Buffer.from(signature);
      if (expected.length !== given.length || !timingSafeEqual(expected, given))
        throw new HrError('CHECK_IN_CODE_INVALID', 400);
      const now = Date.now();
      if (now - issuedAt > CHECK_IN_CODE_TTL_MS || issuedAt - now > 5_000)
        throw new HrError('CHECK_IN_CODE_EXPIRED', 409);
      const session = await sessionRow(sessionId);
      if (session.status !== 'scheduled')
        throw new HrError('SESSION_CLOSED', 409);
      if (
        now < time(session.startAt) - CHECK_IN_OPENS_BEFORE_MS ||
        now > time(session.endAt)
      )
        throw new HrError('CHECK_IN_OUTSIDE_WINDOW', 409);
      const employee = await platform.employeeOfUser(ctx.userId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      // Only one's own enrollment: the scope of `checkIn` is the caller.
      const enrollment = (await database
        .repository('trainingEnrollments')
        .withPolicy(policyOf(policies, 'trainingEnrollments'))
        .findOne({ filter: { sessionId, employeeId: employee.id } })) as
        Record<string, unknown> | undefined;
      if (
        !enrollment ||
        (enrollment.status !== 'enrolled' && enrollment.status !== 'attended')
      )
        throw new HrError('CHECK_IN_NOT_ENROLLED', 403);
      if (enrollment.status === 'attended')
        return {
          sessionId,
          title: str(session.title),
          status: 'attended',
          checkedInAt: iso(enrollment.checkedInAt)!,
        };
      const stamp = new Date();
      await database
        .repository('trainingEnrollments')
        .withPolicy(policyOf(policies, 'trainingEnrollments'))
        .updateOne({
          filter: { id: str(enrollment.id) },
          values: {
            status: 'attended',
            checkedInAt: stamp,
            checkInMethod: 'qr',
            updatedAt: stamp,
          },
        });
      await completeAttendance(enrollment, session);
      return {
        sessionId,
        title: str(session.title),
        status: 'attended',
        checkedInAt: stamp.toISOString(),
      };
    },

    async markAttendance(ctx, sessionId, input) {
      const policies = await authorizeAction(
        ctx.authz,
        SESSION,
        'markAttendance',
      );
      if (!(await ownsSession(ctx, 'markAttendance', sessionId)))
        throw new HrError('FORBIDDEN', 403);
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const employeeId = requireString(input.employeeId, 'INVALID_INPUT', {
        max: 64,
      })!;
      const status = input.status;
      if (status !== 'attended' && status !== 'absent')
        throw new HrError('INVALID_INPUT', 400);
      const reason = requireString(input.reason, 'ATTENDANCE_REASON_REQUIRED', {
        max: 500,
      })!;
      const session = await sessionRow(sessionId);
      if (session.status === 'cancelled')
        throw new HrError('SESSION_CLOSED', 409);
      if (Date.now() < time(session.startAt))
        throw new HrError('SESSION_NOT_STARTED', 409);
      const enrollment = (await database
        .repository('trainingEnrollments')
        .withPolicy(policyOf(policies, 'trainingEnrollments'))
        .findOne({ filter: { sessionId, employeeId } })) as
        Record<string, unknown> | undefined;
      if (!enrollment || enrollment.status === 'cancelled')
        throw new HrError('SESSION_NOT_ENROLLED', 409);
      const stamp = new Date();
      await database
        .repository('trainingEnrollments')
        .withPolicy(policyOf(policies, 'trainingEnrollments'))
        .updateOne({
          filter: { id: str(enrollment.id) },
          values: {
            status,
            checkedInAt:
              status === 'attended' ? (enrollment.checkedInAt ?? stamp) : null,
            checkInMethod: status === 'attended' ? 'manual' : null,
            markedBy: ctx.userId,
            markReason: reason,
            updatedAt: stamp,
          },
        });
      if (status === 'attended' && enrollment.status !== 'attended')
        await completeAttendance(enrollment, session);
      return detail(ctx, sessionId);
    },

    async exportAttendance(ctx, sessionId) {
      await authorizeAction(ctx.authz, SESSION, 'export');
      if (!(await ownsSession(ctx, 'export', sessionId)))
        throw new HrError('FORBIDDEN', 403);
      const view = await detail(ctx, sessionId);
      const format = (value: string | null) =>
        value
          ? new Intl.DateTimeFormat('zh-CN', {
              timeZone: platform.timeZone,
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false,
            }).format(new Date(value))
          : '';
      const methods: Record<string, string> = {
        qr: '扫码签到',
        manual: '讲师补录',
      };
      const rows = view.enrollments
        .filter((e) => e.status !== 'cancelled')
        .map((e) => [
          e.name,
          e.employeeNo,
          e.departmentTitle,
          format(e.checkedInAt),
          e.status === 'attended'
            ? (methods[e.checkInMethod ?? ''] ?? '')
            : e.status === 'absent'
              ? '缺勤'
              : '未签到',
          view.instructorName ?? '',
          view.courseTitle,
          `${format(view.startAt)} – ${format(view.endAt)}`,
          e.markReason ?? '',
        ]);
      const sheet = XLSX.utils.aoa_to_sheet([
        [
          '姓名',
          '工号',
          '部门',
          '签到时间',
          '签到方式',
          '讲师',
          '课程',
          '班次时间',
          '补录原因',
        ],
        ...rows,
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, '签到表');
      return {
        filename: `attendance-${sessionId}.xlsx`,
        bytes: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
      };
    },

    async myOfferings(ctx) {
      await authorizeAction(ctx.authz, SESSION, 'view');
      const employee = await platform.employeeOfUser(ctx.userId);
      if (!employee) return {};
      const courseIds = (
        await database
          .query()
          .selectFrom('assignments')
          .innerJoin('courses', 'courses.id', 'assignments.courseId')
          .select(['assignments.courseId as courseId'])
          .where('assignments.employeeId', '=', employee.id)
          .where('courses.deliveryMode', '=', 'offline')
          .where('assignments.status', 'in', [...OPEN_ASSIGNMENT, 'locked'])
          .execute()
      ).map((r) => str(r.courseId));
      const result: Record<string, SessionView[]> = {};
      for (const courseId of [...new Set(courseIds)]) {
        const rows = await database
          .query()
          .selectFrom('trainingSessions')
          .selectAll()
          .where('courseId', '=', courseId)
          .where('status', '=', 'scheduled')
          .orderBy('startAt', 'asc')
          .execute();
        result[courseId] = (
          await toViews(
            ctx,
            rows.filter((r) => time(r.endAt) > Date.now()),
          )
        ).filter((s) => s.myEnrollment || s.remaining > 0);
      }
      return result;
    },

    async runMaintenance(now = new Date()) {
      const report = { completed: 0, absent: 0, reminded: 0 };
      const query = database.query();
      const scheduled = await query
        .selectFrom('trainingSessions')
        .selectAll()
        .where('status', '=', 'scheduled')
        .execute();
      for (const session of scheduled) {
        const id = str(session.id);
        if (time(session.endAt) + ABSENT_AFTER_MS <= now.getTime()) {
          const stamp = new Date();
          await query
            .updateTable('trainingSessions')
            .set({ status: 'completed', updatedAt: stamp })
            .where('id', '=', id)
            .where('status', '=', 'scheduled')
            .execute();
          report.completed += 1;
          const missing = await query
            .selectFrom('trainingEnrollments')
            .select(['id', 'employeeId'])
            .where('sessionId', '=', id)
            .where('status', '=', 'enrolled')
            .execute();
          for (const row of missing) {
            await query
              .updateTable('trainingEnrollments')
              .set({ status: 'absent', updatedAt: stamp })
              .where('id', '=', str(row.id))
              .execute();
            report.absent += 1;
            const employee = await platform.employee(str(row.employeeId));
            if (!employee) continue;
            const head = await platform.headOf(employee);
            const recipients = [employee.userId, head].filter(
              (v): v is string => Boolean(v),
            );
            if (recipients.length)
              await notify({
                key: `session:${id}:absent:${employee.id}`,
                userIds: recipients,
                message: 'sessionAbsent',
                params: { name: employee.name, title: str(session.title) },
                path: '/talent/my-learning',
              });
          }
          continue;
        }
        // From 18:00 the day before, once per enrollment.
        const local = (date: Date) =>
          new Intl.DateTimeFormat('en-CA', {
            timeZone: platform.timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(date);
        const hour = Number(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: platform.timeZone,
            hour: '2-digit',
            hour12: false,
          }).format(now),
        );
        const tomorrow = local(new Date(now.getTime() + 24 * 60 * 60_000));
        if (
          hour < REMINDER_HOUR ||
          local(new Date(time(session.startAt))) !== tomorrow
        )
          continue;
        const enrolled = await query
          .selectFrom('trainingEnrollments')
          .select(['employeeId'])
          .where('sessionId', '=', id)
          .where('status', '=', 'enrolled')
          .execute();
        const startText = new Intl.DateTimeFormat('zh-CN', {
          timeZone: platform.timeZone,
          month: 'numeric',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(time(session.startAt)));
        for (const row of enrolled) {
          const employee = await platform.employee(str(row.employeeId));
          if (!employee?.userId) continue;
          const sent = await platform.reminderOnce(
            `session:${id}:reminder:${employee.id}`,
            () =>
              notify({
                key: `session:${id}:reminder:${employee.id}`,
                userIds: [employee.userId!],
                message: 'sessionReminder',
                params: {
                  title: str(session.title),
                  time: startText,
                  location: str(session.location),
                },
                path: '/talent/my-learning',
              }),
          );
          if (sent) report.reminded += 1;
        }
      }
      return report;
    },
  };
  return service;
}

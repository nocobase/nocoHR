/**
 * V4-13 培训评估 (13B): l1 课后满意度 and l3 行为改变 (l2 is the exam, V3-10).
 *
 * - A completed course task or an attended offline session creates the
 *   learner's l1 task (due `l1DueDays` after completion); a learner without
 *   an account gets none.
 * - `l3AfterDays` after the completion the daily task creates the l3 task
 *   for the learner's department head (walking up), due `l3DueDays` later.
 *   The periods are read when the task is created, so a change applies to
 *   what is created next.
 * - Daily 09:00: a reminder `evaluationReminderDays` before the due time,
 *   once; past-due pending tasks become expired.
 * - The questionnaire is the administrator's template (scale 1–5 items and
 *   text items); the score is the average of the scale answers.
 */
import { z } from 'zod';

import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { iso, json, num } from './context.js';

const RESOURCE = 'talent.trainingEvaluation';
const DAY_MS = 86_400_000;

export interface EvaluationView {
  id: string;
  level: 'l1' | 'l3';
  targetType: string;
  targetId: string;
  targetTitle: string;
  courseId: string | null;
  employeeId: string;
  employeeName: string;
  respondentUserId: string;
  answers: Record<string, number | string> | null;
  score: number | null;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  submittedAt: string | null;
  questions: { key: string; title: string; kind: 'scale' | 'text' }[];
  mine: boolean;
}

export function createEvaluationService(ctx: TalentReviewContext) {
  const { database, platform } = ctx;

  async function titleOf(targetType: string, targetId: string): Promise<string> {
    const table = targetType === 'trainingSession' ? 'trainingSessions' : 'courses';
    const row = await database
      .query()
      .selectFrom(table)
      .select(['title'])
      .where('id', '=', targetId)
      .executeTakeFirst();
    return row ? str(row.title) : '';
  }

  async function toView(
    actor: ActorContext,
    row: Record<string, unknown>,
  ): Promise<EvaluationView> {
    const settings = await ctx.settings();
    const level = str(row.level) as 'l1' | 'l3';
    const employee = (await ctx.employees()).get(str(row.employeeId));
    return {
      id: str(row.id),
      level,
      targetType: str(row.targetType),
      targetId: str(row.targetId),
      targetTitle: await titleOf(str(row.targetType), str(row.targetId)),
      courseId: row.courseId ? str(row.courseId) : null,
      employeeId: str(row.employeeId),
      employeeName: employee?.name ?? '',
      respondentUserId: str(row.respondentUserId),
      answers: json(row.answers, null),
      score: num(row.score),
      status: str(row.status),
      dueAt: iso(row.dueAt),
      completedAt: iso(row.completedAt),
      submittedAt: iso(row.submittedAt),
      questions: level === 'l1' ? settings.l1Questions : settings.l3Questions,
      mine: str(row.respondentUserId) === actor.userId,
    };
  }

  /** Creates one task unless it exists; answers the new id. */
  async function create(values: {
    level: 'l1' | 'l3';
    targetType: 'course' | 'trainingSession';
    targetId: string;
    courseId: string;
    employeeId: string;
    respondentUserId: string;
    dueAt: Date;
    completedAt: Date;
  }): Promise<string | null> {
    const exists = await database
      .query()
      .selectFrom('trainingEvaluations')
      .select(['id'])
      .where('level', '=', values.level)
      .where('targetType', '=', values.targetType)
      .where('targetId', '=', values.targetId)
      .where('employeeId', '=', values.employeeId)
      .executeTakeFirst();
    if (exists) return null;
    const id = newId();
    const now = new Date();
    try {
      await database
        .query()
        .insertInto('trainingEvaluations')
        .values({
          id,
          ...values,
          answers: null,
          score: null,
          status: 'pending',
          submittedAt: null,
          remindedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    } catch (error) {
      if (/unique|constraint/iu.test(String(error))) return null;
      throw error;
    }
    return id;
  }

  /** The target a completion evaluates: the attended session of the course, else the course. */
  async function targetOf(employeeId: string, courseId: string) {
    const attended = await database
      .query()
      .selectFrom('trainingEnrollments')
      .innerJoin('trainingSessions', 'trainingSessions.id', 'trainingEnrollments.sessionId')
      .select(['trainingSessions.id as id', 'trainingEnrollments.checkedInAt as checkedInAt'])
      .where('trainingEnrollments.employeeId', '=', employeeId)
      .where('trainingSessions.courseId', '=', courseId)
      .where('trainingEnrollments.status', '=', 'attended')
      .orderBy('trainingEnrollments.checkedInAt', 'desc')
      .executeTakeFirst();
    if (
      attended &&
      attended.checkedInAt &&
      Date.now() - new Date(str(attended.checkedInAt)).getTime() < DAY_MS
    )
      return { targetType: 'trainingSession' as const, targetId: str(attended.id) };
    return { targetType: 'course' as const, targetId: courseId };
  }

  const service = {
    create,

    /** 课程任务完成、线下签到 → the learner's l1 task (none without an account). */
    async onLearningCompleted(employeeId: string, courseId: string) {
      const employee = await platform.employee(employeeId);
      if (!employee?.userId) return null;
      const settings = await ctx.settings();
      const target = await targetOf(employeeId, courseId);
      const completedAt = new Date();
      const id = await create({
        level: 'l1',
        ...target,
        courseId,
        employeeId,
        respondentUserId: employee.userId,
        dueAt: new Date(completedAt.getTime() + settings.l1DueDays * DAY_MS),
        completedAt,
      });
      if (id)
        await platform.notify({
          key: `evaluation:${id}:created`,
          userIds: [employee.userId],
          message: 'trainingEvaluationL1',
          params: { title: await titleOf(target.targetType, target.targetId) },
          path: `/talent/training-evaluations/${id}`,
        });
      return id;
    },

    /**
     * 每天 09:00: missing l1 tasks for recent completions, the l3 tasks due
     * now, reminders before the due time, expiry. Idempotent.
     */
    async runDaily(now: Date = new Date()) {
      const settings = await ctx.settings();
      const report = { l1: 0, l3: 0, reminded: 0, expired: 0 };
      // Completions: course tasks and attended sessions.
      const horizon = new Date(now.getTime() - (settings.l3AfterDays + 60) * DAY_MS);
      const assignments = await database
        .query()
        .selectFrom('assignments')
        .select(['employeeId', 'courseId', 'completedAt'])
        .where('status', '=', 'completed')
        .where('courseId', 'is not', null)
        .where('completedAt', '>=', horizon)
        .execute();
      const enrollments = await database
        .query()
        .selectFrom('trainingEnrollments')
        .innerJoin('trainingSessions', 'trainingSessions.id', 'trainingEnrollments.sessionId')
        .select([
          'trainingEnrollments.employeeId as employeeId',
          'trainingSessions.id as sessionId',
          'trainingSessions.courseId as courseId',
          'trainingEnrollments.checkedInAt as checkedInAt',
          'trainingSessions.endAt as endAt',
        ])
        .where('trainingEnrollments.status', '=', 'attended')
        .execute();
      const sessionCourses = new Set(
        enrollments.map((e) => `${str(e.employeeId)}:${str(e.courseId)}`),
      );
      const completions: {
        employeeId: string;
        courseId: string;
        targetType: 'course' | 'trainingSession';
        targetId: string;
        at: Date;
      }[] = [];
      for (const e of enrollments) {
        const at = new Date(str(e.checkedInAt ?? e.endAt));
        if (at < horizon) continue;
        completions.push({
          employeeId: str(e.employeeId),
          courseId: str(e.courseId),
          targetType: 'trainingSession',
          targetId: str(e.sessionId),
          at,
        });
      }
      for (const a of assignments) {
        // An offline course's task completes with its session: the session is the target.
        if (sessionCourses.has(`${str(a.employeeId)}:${str(a.courseId)}`)) continue;
        completions.push({
          employeeId: str(a.employeeId),
          courseId: str(a.courseId),
          targetType: 'course',
          targetId: str(a.courseId),
          at: new Date(str(a.completedAt)),
        });
      }
      const employees = await ctx.employees();
      for (const c of completions) {
        const employee = employees.get(c.employeeId);
        if (!employee || employee.status === 'leave') continue;
        // l1 for a completion within its answer period (missed by the event).
        if (
          employee.userId &&
          now.getTime() - c.at.getTime() < settings.l1DueDays * DAY_MS
        ) {
          const id = await create({
            level: 'l1',
            targetType: c.targetType,
            targetId: c.targetId,
            courseId: c.courseId,
            employeeId: c.employeeId,
            respondentUserId: employee.userId,
            dueAt: new Date(c.at.getTime() + settings.l1DueDays * DAY_MS),
            completedAt: c.at,
          });
          if (id) report.l1 += 1;
        }
        // l3, l3AfterDays after the completion, to the head.
        if (now.getTime() - c.at.getTime() >= settings.l3AfterDays * DAY_MS) {
          const head = await ctx.headOf(employee);
          if (!head) continue;
          const id = await create({
            level: 'l3',
            targetType: c.targetType,
            targetId: c.targetId,
            courseId: c.courseId,
            employeeId: c.employeeId,
            respondentUserId: head,
            dueAt: new Date(now.getTime() + settings.l3DueDays * DAY_MS),
            completedAt: c.at,
          });
          if (id) {
            report.l3 += 1;
            await platform.notify({
              key: `evaluation:${id}:created`,
              userIds: [head],
              message: 'trainingEvaluationL3',
              params: {
                name: employee.name,
                title: await titleOf(c.targetType, c.targetId),
              },
              path: `/talent/training-evaluations/${id}`,
            });
          }
        }
      }
      // Reminders and expiry.
      const pending = await database
        .query()
        .selectFrom('trainingEvaluations')
        .selectAll()
        .where('status', '=', 'pending')
        .execute();
      for (const row of pending) {
        const due = new Date(str(row.dueAt));
        if (due.getTime() < now.getTime()) {
          await database
            .query()
            .updateTable('trainingEvaluations')
            .set({ status: 'expired', updatedAt: now })
            .where('id', '=', str(row.id))
            .where('status', '=', 'pending')
            .execute();
          await ctx.closeWorkItems(`evaluation:${str(row.id)}:`);
          report.expired += 1;
          continue;
        }
        if (
          !row.remindedAt &&
          due.getTime() - now.getTime() <= settings.evaluationReminderDays * DAY_MS
        ) {
          await platform.notify({
            key: `evaluation:${str(row.id)}:reminder`,
            userIds: [str(row.respondentUserId)],
            message: 'trainingEvaluationDue',
            params: {
              title: await titleOf(str(row.targetType), str(row.targetId)),
              date: due.toISOString().slice(0, 10),
            },
            path: `/talent/training-evaluations/${str(row.id)}`,
          });
          await database
            .query()
            .updateTable('trainingEvaluations')
            .set({ remindedAt: now, updatedAt: now })
            .where('id', '=', str(row.id))
            .execute();
          report.reminded += 1;
        }
      }
      return report;
    },

    /** 待我填写. */
    async mine(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'respond');
      const rows = (await database
        .repository('trainingEvaluations')
        .withPolicy(policyOf(policies, 'trainingEvaluations'))
        .findMany({ filter: { respondentUserId: actor.userId } })) as Record<
        string,
        unknown
      >[];
      const views = await Promise.all(rows.map((r) => toView(actor, r)));
      return views.sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
    },

    async get(actor: ActorContext, id: string) {
      for (const action of ['respond', 'view'] as const) {
        const policies = await authorizeAction(actor.authz, RESOURCE, action).catch(
          () => undefined,
        );
        if (!policies) continue;
        const row = (await database
          .repository('trainingEvaluations')
          .withPolicy(policyOf(policies, 'trainingEvaluations'))
          .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
        if (row) return toView(actor, row);
      }
      throw new HrError('EVALUATION_NOT_FOUND', 404);
    },

    /** 填写: only the respondent, only while pending; the score is computed. */
    async submit(actor: ActorContext, id: string, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'respond');
      const row = (await database
        .repository('trainingEvaluations')
        .withPolicy(policyOf(policies, 'trainingEvaluations'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row || str(row.respondentUserId) !== actor.userId)
        throw new HrError('EVALUATION_NOT_FOUND', 404);
      if (row.status !== 'pending') throw new HrError('EVALUATION_CLOSED', 409);
      const settings = await ctx.settings();
      const questions = str(row.level) === 'l1' ? settings.l1Questions : settings.l3Questions;
      const answers =
        input && typeof input === 'object'
          ? (input as { answers?: unknown }).answers
          : undefined;
      if (!answers || typeof answers !== 'object' || Array.isArray(answers))
        throw new HrError('EVALUATION_ANSWERS_REQUIRED', 400);
      const clean: Record<string, number | string> = {};
      for (const q of questions) {
        const value = (answers as Record<string, unknown>)[q.key];
        if (q.kind === 'scale') {
          const parsed = z.number().int().min(1).max(5).safeParse(value);
          if (!parsed.success) throw new HrError('EVALUATION_ANSWERS_REQUIRED', 400, { key: q.key });
          clean[q.key] = parsed.data;
        } else {
          const parsed = z.string().trim().min(1).max(2000).safeParse(value);
          if (!parsed.success) throw new HrError('EVALUATION_ANSWERS_REQUIRED', 400, { key: q.key });
          clean[q.key] = parsed.data;
        }
      }
      const scale = Object.values(clean).filter((v): v is number => typeof v === 'number');
      const score = scale.length
        ? Math.round((scale.reduce((a, b) => a + b, 0) / scale.length) * 100) / 100
        : null;
      const now = new Date();
      await database
        .query()
        .updateTable('trainingEvaluations')
        .set({ answers: clean, score, status: 'submitted', submittedAt: now, updatedAt: now })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .execute();
      await ctx.closeWorkItems(`evaluation:${id}:`);
      return service.get(actor, id);
    },

    /** 按课程、班次、讲师汇总 (view: all, own courses and sessions, or the head's departments). */
    async summary(actor: ActorContext, filters: { from?: string; to?: string }) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
      const rows = ((await database
        .repository('trainingEvaluations')
        .withPolicy(policyOf(policies, 'trainingEvaluations'))
        .findMany({})) as Record<string, unknown>[]).filter((r) => {
        const at = iso(r.completedAt)?.slice(0, 10) ?? '';
        return (!filters.from || at >= filters.from) && (!filters.to || at <= filters.to);
      });
      return service.aggregate(rows);
    },

    /** Aggregates (trusted) — also the talent analyst's quarterly report. */
    async aggregate(rows: readonly Record<string, unknown>[]) {
      const courses = new Map(
        (
          await database.query().selectFrom('courses').select(['id', 'title', 'ownerUserId']).execute()
        ).map((c) => [str(c.id), { title: str(c.title), ownerUserId: str(c.ownerUserId) }]),
      );
      const sessions = new Map(
        (
          await database
            .query()
            .selectFrom('trainingSessions')
            .select(['id', 'title', 'courseId', 'instructorUserId', 'instructorProfileId'])
            .execute()
        ).map((s) => [str(s.id), s]),
      );
      const profiles = await database
        .query()
        .selectFrom('instructorProfiles')
        .select(['id', 'name', 'userId'])
        .execute();
      const instructorOf = (row: Record<string, unknown>): string | null => {
        if (str(row.targetType) === 'trainingSession') {
          const s = sessions.get(str(row.targetId));
          if (!s) return null;
          if (s.instructorProfileId) return `profile:${str(s.instructorProfileId)}`;
          return s.instructorUserId ? `user:${str(s.instructorUserId)}` : null;
        }
        const owner = courses.get(str(row.courseId ?? row.targetId))?.ownerUserId;
        return owner ? `user:${owner}` : null;
      };
      const nameOf = async (key: string) => {
        const [kind, id] = key.split(':');
        if (kind === 'profile') return str(profiles.find((p) => str(p.id) === id)?.name ?? '');
        const profile = profiles.find((p) => str(p.userId ?? '') === id);
        return profile ? str(profile.name) : await ctx.userName(id);
      };
      type Bucket = { l1: number[]; l3: number[]; l1Total: number; l3Total: number; l1Expired: number };
      const empty = (): Bucket => ({ l1: [], l3: [], l1Total: 0, l3Total: 0, l1Expired: 0 });
      const byCourse = new Map<string, Bucket>();
      const bySession = new Map<string, Bucket>();
      const byInstructor = new Map<string, Bucket>();
      const add = (map: Map<string, Bucket>, key: string | null, row: Record<string, unknown>) => {
        if (!key) return;
        const bucket = map.get(key) ?? empty();
        const level = str(row.level) as 'l1' | 'l3';
        if (level === 'l1') bucket.l1Total += 1;
        else bucket.l3Total += 1;
        if (row.status === 'expired' && level === 'l1') bucket.l1Expired += 1;
        const score = num(row.score);
        if (row.status === 'submitted' && score !== null) bucket[level].push(score);
        map.set(key, bucket);
      };
      for (const row of rows) {
        add(byCourse, str(row.courseId ?? row.targetId), row);
        if (str(row.targetType) === 'trainingSession') add(bySession, str(row.targetId), row);
        add(byInstructor, instructorOf(row), row);
      }
      // l2: the pass rate of the exams a certification requires together with the course.
      const courseExams = new Map<string, string[]>();
      for (const row of await database
        .query()
        .selectFrom('certificationCourses')
        .innerJoin(
          'certificationExams',
          'certificationExams.certificationId',
          'certificationCourses.certificationId',
        )
        .select([
          'certificationCourses.courseId as courseId',
          'certificationExams.examId as examId',
        ])
        .execute())
        courseExams.set(str(row.courseId), [
          ...(courseExams.get(str(row.courseId)) ?? []),
          str(row.examId),
        ]);
      const passRate = async (courseId: string) => {
        const exams = [...new Set(courseExams.get(courseId) ?? [])];
        if (!exams.length) return null;
        const attempts = await database
          .query()
          .selectFrom('examAttempts')
          .select(['status'])
          .where('examId', 'in', exams)
          .where('status', 'in', ['passed', 'failed'])
          .execute();
        if (!attempts.length) return null;
        return Math.round(
          (attempts.filter((a) => a.status === 'passed').length / attempts.length) * 100,
        );
      };
      const avg = (list: number[]) =>
        list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : null;
      const shape = (bucket: Bucket) => ({
        l1Average: avg(bucket.l1),
        l1Responses: bucket.l1.length,
        l1Tasks: bucket.l1Total,
        l1Expired: bucket.l1Expired,
        l3Average: avg(bucket.l3),
        l3Responses: bucket.l3.length,
        l3Tasks: bucket.l3Total,
      });
      return {
        courses: await Promise.all(
          [...byCourse].map(async ([id, bucket]) => ({
            id,
            title: courses.get(id)?.title ?? '',
            ...shape(bucket),
            examPassRate: await passRate(id),
          })),
        ),
        sessions: [...bySession].map(([id, bucket]) => ({
          id,
          title: str(sessions.get(id)?.title ?? ''),
          ...shape(bucket),
        })),
        instructors: await Promise.all(
          [...byInstructor].map(async ([key, bucket]) => ({
            key,
            name: await nameOf(key),
            userId: key.startsWith('user:') ? key.slice(5) : null,
            ...shape(bucket),
          })),
        ),
      };
    },

    questions: async () => {
      const settings = await ctx.settings();
      return { l1: settings.l1Questions, l3: settings.l3Questions };
    },
  };
  return service;
}

export type EvaluationService = ReturnType<typeof createEvaluationService>;

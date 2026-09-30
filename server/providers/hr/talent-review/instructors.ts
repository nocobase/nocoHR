/**
 * V4-13 讲师管理 (13B, hr.admin): instructor profiles (internal with an
 * account, external without) and their statistics, which are computed, never
 * stored: teaching hours and sessions (a session's own instructor — the
 * account for an internal instructor, the profile for an external one), the
 * average l1 satisfaction of those sessions, and the exam pass rate of the
 * people who attended them, in a date range.
 *
 * `trainingSessions.instructorProfileId` is set here (分配讲师): an internal
 * profile writes the account to `instructorUserId` and clears the profile;
 * an external one writes the profile and keeps the session's organizer in
 * `instructorUserId`, which stays required (the framework cannot relax a
 * column's nullability on SQLite). The profile, when set, is the instructor.
 */
import { z } from 'zod';

import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { bool, iso, json } from './context.js';

const RESOURCE = 'talent.instructor';

const profileInput = z
  .object({
    userId: z.string().max(64).nullable().optional(),
    name: z.string().trim().min(1).max(100),
    type: z.enum(['internal', 'external']),
    organization: z.string().trim().max(200).nullable().optional(),
    competencyIds: z.array(z.string().min(1).max(64)).max(30).optional(),
    level: z.enum(['junior', 'senior', 'expert']).nullable().optional(),
    active: z.boolean().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export interface InstructorStats {
  sessions: number;
  hours: number;
  satisfaction: number | null;
  responses: number;
  passRate: number | null;
  attendees: number;
}

export function createInstructorService(ctx: TalentReviewContext) {
  const { database } = ctx;

  function toProfile(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      userId: row.userId ? str(row.userId) : null,
      name: str(row.name),
      type: str(row.type) as 'internal' | 'external',
      organization: row.organization ? str(row.organization) : null,
      competencyIds: json<string[]>(row.competencyIds, []),
      level: row.level ? str(row.level) : null,
      active: bool(row.active),
      customFields: json<Record<string, unknown>>(row.customFields, {}),
      updatedAt: iso(row.updatedAt),
    };
  }
  type Profile = ReturnType<typeof toProfile>;

  async function sessionsOf(profile: Profile, from?: string, to?: string) {
    let query = database
      .query()
      .selectFrom('trainingSessions')
      .select(['id', 'courseId', 'title', 'startAt', 'endAt', 'status', 'location'])
      .where('status', '!=', 'cancelled');
    // An external instructor's session names the profile; its instructorUserId is the organizer.
    query =
      profile.type === 'internal' && profile.userId
        ? query
            .where('instructorUserId', '=', profile.userId)
            .where((eb) =>
              eb.or([
                eb('instructorProfileId', 'is', null),
                eb('instructorProfileId', '=', profile.id),
              ]),
            )
        : query.where('instructorProfileId', '=', profile.id);
    if (from) query = query.where('startAt', '>=', new Date(`${from}T00:00:00Z`));
    if (to) query = query.where('startAt', '<', new Date(`${to}T23:59:59Z`));
    return query.orderBy('startAt', 'desc').execute();
  }

  /** Statistics for a profile in a range (trusted; the callers authorize). */
  async function statsOf(profile: Profile, from?: string, to?: string): Promise<InstructorStats> {
    const sessions = await sessionsOf(profile, from, to);
    const hours =
      Math.round(
        sessions.reduce(
          (sum, s) =>
            sum +
            Math.max(
              0,
              new Date(str(s.endAt)).getTime() - new Date(str(s.startAt)).getTime(),
            ) /
              3_600_000,
          0,
        ) * 10,
      ) / 10;
    const ids = sessions.map((s) => str(s.id));
    const evaluations = ids.length
      ? await database
          .query()
          .selectFrom('trainingEvaluations')
          .select(['score'])
          .where('level', '=', 'l1')
          .where('targetType', '=', 'trainingSession')
          .where('targetId', 'in', ids)
          .where('status', '=', 'submitted')
          .execute()
      : [];
    const scores = evaluations
      .map((e) => Number(e.score))
      .filter((n) => Number.isFinite(n));
    const attendees = ids.length
      ? await database
          .query()
          .selectFrom('trainingEnrollments')
          .select(['employeeId'])
          .where('sessionId', 'in', ids)
          .where('status', '=', 'attended')
          .execute()
      : [];
    const people = [...new Set(attendees.map((a) => str(a.employeeId)))];
    let passed = 0;
    let attempted = 0;
    if (people.length) {
      const attempts = await database
        .query()
        .selectFrom('examAttempts')
        .select(['employeeId', 'status'])
        .where('employeeId', 'in', people)
        .where('status', 'in', ['passed', 'failed'])
        .execute();
      const byPerson = new Map<string, boolean>();
      for (const a of attempts)
        byPerson.set(str(a.employeeId), byPerson.get(str(a.employeeId)) || a.status === 'passed');
      attempted = byPerson.size;
      passed = [...byPerson.values()].filter(Boolean).length;
    }
    return {
      sessions: sessions.length,
      hours,
      satisfaction: scores.length
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10
        : null,
      responses: scores.length,
      passRate: attempted ? Math.round((passed / attempted) * 100) : null,
      attendees: people.length,
    };
  }

  async function profileRow(id: string): Promise<Profile> {
    const row = await database
      .query()
      .selectFrom('instructorProfiles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('INSTRUCTOR_NOT_FOUND', 404);
    return toProfile(row);
  }

  const service = {
    profileRow,
    statsOf,
    sessionsOf,

    async list(actor: ActorContext, filters: { from?: string; to?: string }) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
      const rows = (await database
        .repository('instructorProfiles')
        .withPolicy(policyOf(policies, 'instructorProfiles'))
        .findMany({})) as Record<string, unknown>[];
      const out = [];
      for (const row of rows) {
        const profile = toProfile(row);
        out.push({ ...profile, stats: await statsOf(profile, filters.from, filters.to) });
      }
      return {
        instructors: out.sort((a, b) => a.name.localeCompare(b.name)),
        can: { manage: await ctx.can(actor, RESOURCE, 'manage') },
      };
    },

    async detail(actor: ActorContext, id: string, filters: { from?: string; to?: string }) {
      await authorizeAction(actor.authz, RESOURCE, 'view');
      const profile = await profileRow(id);
      const sessions = await sessionsOf(profile, filters.from, filters.to);
      return {
        ...profile,
        stats: await statsOf(profile, filters.from, filters.to),
        sessions: sessions.map((s) => ({
          id: str(s.id),
          title: str(s.title),
          startAt: iso(s.startAt),
          endAt: iso(s.endAt),
          status: str(s.status),
          location: str(s.location),
        })),
      };
    },

    async save(actor: ActorContext, id: string | null, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const parsed = profileInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const data = parsed.data;
      if (data.type === 'internal' && !data.userId)
        throw new HrError('INSTRUCTOR_ACCOUNT_REQUIRED', 400);
      if (data.type === 'external' && data.userId)
        throw new HrError('INSTRUCTOR_EXTERNAL_ACCOUNT', 400);
      if (data.userId && !(await ctx.userName(data.userId)))
        throw new HrError('INSTRUCTOR_ACCOUNT_REQUIRED', 400);
      const now = new Date();
      const values = {
        userId: data.userId ?? null,
        name: data.name,
        type: data.type,
        organization: data.organization ?? null,
        competencyIds: data.competencyIds ?? [],
        level: data.level ?? null,
        active: data.active ?? true,
        customFields: data.customFields ?? null,
        updatedAt: now,
      };
      const repo = database
        .repository('instructorProfiles')
        .withPolicy(policyOf(policies, 'instructorProfiles'));
      const target = id ?? newId();
      if (id) {
        await profileRow(id);
        await repo.updateOne({ filter: { id }, values });
      } else await repo.createOne({ values: { id: target, ...values, createdAt: now } });
      return profileRow(target);
    },

    /** 分配讲师 to a session: exactly one of instructorUserId and instructorProfileId is set. */
    async assignSession(actor: ActorContext, sessionId: string, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const profileId =
        input && typeof input === 'object'
          ? (input as { instructorProfileId?: unknown }).instructorProfileId
          : undefined;
      if (typeof profileId !== 'string' || !profileId)
        throw new HrError('INVALID_INPUT', 400);
      const profile = await profileRow(profileId);
      const session = await database
        .query()
        .selectFrom('trainingSessions')
        .select(['id', 'ownerUserId'])
        .where('id', '=', sessionId)
        .executeTakeFirst();
      if (!session) throw new HrError('SESSION_NOT_FOUND', 404);
      await database
        .repository('trainingSessions')
        .withPolicy(policyOf(policies, 'trainingSessions'))
        .updateOne({
          filter: { id: sessionId },
          values:
            profile.type === 'internal'
              ? { instructorUserId: profile.userId, instructorProfileId: null, updatedAt: new Date() }
              : {
                  // instructorUserId is required: the organizer stays there, the profile names the instructor.
                  instructorUserId: str(session.ownerUserId),
                  instructorProfileId: profile.id,
                  updatedAt: new Date(),
                },
        });
      return { sessionId, instructorProfileId: profile.id, type: profile.type };
    },

    /** Employees with an account, for an internal instructor's profile. */
    async accountOptions(actor: ActorContext) {
      await authorizeAction(actor.authz, RESOURCE, 'manage');
      return [...(await ctx.employees()).values()]
        .filter((e) => e.userId && e.status !== 'leave')
        .map((e) => ({ userId: e.userId!, name: e.name }));
    },

    /** Sessions without an external profile, for the assignment picker. */
    async sessionOptions(actor: ActorContext) {
      await authorizeAction(actor.authz, RESOURCE, 'manage');
      const rows = await database
        .query()
        .selectFrom('trainingSessions')
        .select(['id', 'title', 'startAt', 'instructorUserId', 'instructorProfileId'])
        .where('status', '!=', 'cancelled')
        .orderBy('startAt', 'desc')
        .execute();
      return rows.map((r) => ({
        id: str(r.id),
        title: str(r.title),
        startAt: iso(r.startAt),
        instructorProfileId: r.instructorProfileId ? str(r.instructorProfileId) : null,
      }));
    },
  };
  return service;
}

export type InstructorService = ReturnType<typeof createInstructorService>;

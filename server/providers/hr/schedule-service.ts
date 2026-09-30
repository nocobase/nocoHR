/**
 * V2-05 排班: the employee × date grid of a department, rule checks on every
 * save and publish (the same for every scheduler, hr.admin included), 轮班模板,
 * publication with notices to the employees whose published shift changed,
 * and the HR assistant's cover suggestions on leave conflicts.
 *
 * A save carries the version each cell was loaded at (`expectedUpdatedAt`,
 * null for a new cell) and is refused when someone saved it in between. A
 * block refuses the whole save; warnings save only when acknowledged. The
 * checks are written to the cells.
 */
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
} from './attendance-config.js';
import type { AttendanceEngine } from './attendance-engine.js';
import { json } from './attendance-service.js';
import { lockAttendanceSettings } from './attendance-settings.js';
import {
  authorizeAction,
  policyOf,
  type CollectionPolicies,
} from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { Notify } from './platform.js';
import type { OrganizationService } from './organization-service.js';
import { replacementCandidates } from './replacement.js';
import { schedulePreflight } from './schedule-preflight.js';
import { HrError, newId, str } from './shared.js';

const date = z.iso.date();
const request = z.object({
  departmentId: z.string().min(1).max(64),
  from: date,
  to: date,
  q: z.string().trim().max(100).optional(),
});
const cell = z
  .object({
    employeeId: z.string().min(1).max(64),
    date,
    shiftId: z.string().max(64).nullable(),
    /** The version this cell was loaded at; null when it had no row. */
    expectedUpdatedAt: z.string().nullable().optional(),
  })
  .strict();
const mutation = z
  .object({
    cells: z.array(cell).min(1).max(2000),
    acknowledgeWarnings: z.boolean().default(false),
  })
  .strict();

const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
const stampOf = (value: unknown) =>
  value == null ? null : new Date(str(value)).toISOString();

/** 顶班邀请 on a conflicted cell (`replacementSuggestion.invitations`). */
export interface Invitation {
  employeeId: string;
  sentAt: string;
  /** null while waiting for an answer. */
  response: 'accepted' | 'declined' | 'expired' | null;
  respondedAt: string | null;
  invitedBy?: string;
}

interface Suggestion {
  candidates?: { employeeId: string; reasons: string[] }[];
  suggestedAt?: string;
  runId?: string | null;
  invitations?: Invitation[];
}

/**
 * A scheduler learns that a leave blocks the cell, not which request: the ids
 * stay on the stored cell for the engine and the HR assistant.
 */
function withoutLeaveIds<
  T extends { checks: Record<string, { leaveRequestId?: string }[]> },
>(result: T): T {
  return {
    ...result,
    checks: Object.fromEntries(
      Object.entries(result.checks).map(([key, list]) => [
        key,
        list.map(({ leaveRequestId: _id, ...check }) => check),
      ]),
    ),
  };
}

function days(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (end < start || (end.getTime() - start.getTime()) / 86_400_000 > 30)
    throw new HrError('INVALID_DATE_RANGE', 400);
  const out: string[] = [];
  for (
    let cursor = start;
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  )
    out.push(cursor.toISOString().slice(0, 10));
  return out;
}

export function createScheduleService(
  database: DatabaseManager,
  context: {
    organization: OrganizationService;
    timeZone: string;
    notify: Notify;
    engine: () => AttendanceEngine;
    /** Called when a leave conflict is flagged, to ask the HR assistant for cover. */
    onConflict?: () => (scheduleId: string) => void;
    /**
     * 发出顶班邀请: sends each invitee a 顶班邀请 card (im-cards, after the
     * commit); answers who could be reached. Unset: nobody can be invited.
     */
    inviteCards?: () => (input: {
      scheduleId: string;
      inviterUserId: string;
      invitees: readonly { employeeId: string; userId: string }[];
    }) => Promise<Record<string, 'sent' | 'duplicate' | 'notBound' | 'failed'>>;
  },
) {
  const scoped = (
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    name: string,
  ) => connection.repository(name).withPolicy(policyOf(policies, name));
  const policy = (ctx: ActorContext, action: 'view' | 'edit' | 'publish') =>
    authorizeAction(ctx.authz, 'talent.schedule', action);
  const preflightContext = {
    organization: context.organization,
    timeZone: context.timeZone,
  };

  async function load(ctx: ActorContext, input: unknown) {
    const policies = await policy(ctx, 'view');
    const result = request.safeParse(input);
    if (!result.success) throw new HrError('INVALID_INPUT', 400);
    const parsed = result.data;
    const connection = database.connection();
    const employeeRows = await scoped(
      connection,
      policies,
      'employees',
    ).findMany({
      filter: { departmentId: parsed.departmentId },
      sort: (s) => s.field('employeeNo').asc(),
      limit: 501,
    });
    const keyword = parsed.q?.toLocaleLowerCase();
    const employees = employeeRows
      .filter(
        (row) =>
          !keyword ||
          `${str(row.name)} ${str(row.employeeNo)}`
            .toLocaleLowerCase()
            .includes(keyword),
      )
      .slice(0, 500)
      .map((row) => ({
        id: str(row.id),
        employeeNo: str(row.employeeNo),
        name: str(row.name),
        status: str(row.status),
        departmentId: str(row.departmentId),
        hireDate: row.hireDate ? day(row.hireDate) : null,
        leaveDate: row.leaveDate ? day(row.leaveDate) : null,
      }));
    const dates = days(parsed.from, parsed.to);
    const schedules = employees.length
      ? await scoped(connection, policies, 'shiftSchedules').findMany({
          filter: (f) =>
            f.and([
              f.or(employees.map((row) => f.string('employeeId').eq(row.id))),
              f.date('date').between([parsed.from, parsed.to]),
            ]),
          limit: 10001,
        })
      : [];
    const shifts = await scoped(connection, policies, 'shifts').findMany({
      limit: 501,
      sort: (s) => s.field('code').asc(),
    });
    const names = new Map(employees.map((e) => [e.id, e.name]));
    return {
      departmentId: parsed.departmentId,
      from: parsed.from,
      to: parsed.to,
      dates,
      employees,
      shifts,
      cells: schedules.map((row) => {
        const suggestion = json<{
          candidates?: { employeeId: string; reasons?: string[] }[];
          invitations?: Invitation[];
        } | null>(row.replacementSuggestion, null);
        return {
          ...row,
          date: day(row.date),
          checkResult:
            json<{ leaveRequestId?: string }[] | null>(
              row.checkResult,
              null,
            )?.map(({ leaveRequestId: _id, ...check }) => check) ?? null,
          updatedAt: stampOf(row.updatedAt),
          replacementSuggestion: suggestion
            ? {
                ...suggestion,
                // Names of candidates the scheduler may already see.
                candidates: (suggestion.candidates ?? []).map((c) => ({
                  ...c,
                  name: names.get(c.employeeId) ?? null,
                })),
                invitations: (suggestion.invitations ?? []).map((i) => ({
                  ...i,
                  name: names.get(i.employeeId) ?? null,
                })),
              }
            : null,
        };
      }),
      meta: {
        employeeTruncated: employeeRows.length > 500,
        scheduleTruncated: schedules.length > 10000,
      },
    };
  }

  /** The published cells whose shift changed, grouped per employee with an account. */
  async function announce(
    connection: DatabaseConnection,
    changed: { employeeId: string; date: string; first: boolean }[],
    publishedAt: Date,
  ) {
    if (!changed.length) return;
    const ids = [...new Set(changed.map((c) => c.employeeId))];
    const users = await connection.query
      .selectFrom('employees')
      .select(['id', 'userId'])
      .where('id', 'in', ids)
      .execute();
    const userOf = new Map(
      users.flatMap((u) => (u.userId ? [[str(u.id), str(u.userId)]] : [])),
    );
    for (const id of ids) {
      const userId = userOf.get(id);
      if (!userId) continue;
      const own = changed.filter((c) => c.employeeId === id);
      const sorted = own.map((c) => c.date).sort();
      const first = own.every((c) => c.first);
      await context.notify({
        // One notice per employee per publication.
        key: `schedule:${id}:${publishedAt.toISOString()}`,
        userIds: [userId],
        message: first ? 'schedulePublished' : 'scheduleChanged',
        params: {
          from: sorted[0],
          to: sorted.at(-1)!,
          count: String(own.length),
        },
        path: `/talent/me?month=${sorted[0].slice(0, 7)}#attendance`,
      });
    }
  }

  async function write(ctx: ActorContext, input: unknown, publish: boolean) {
    const policies = await policy(ctx, publish ? 'publish' : 'edit');
    if (publish) await policy(ctx, 'edit');
    const parsed = mutation.safeParse(input);
    if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
    const body = parsed.data;
    const changed: { employeeId: string; date: string; first: boolean }[] = [];
    const conflicts: string[] = [];
    let publishedAt = new Date();
    const result = await database.transaction(async (connection) => {
      await lockAttendanceSettings(connection, ctx.userId);
      const repo = scoped(connection, policies, 'shiftSchedules');
      const existing = new Map<string, Record<string, unknown>>();
      for (const item of body.cells) {
        const row = await connection.query
          .selectFrom('shiftSchedules')
          .selectAll()
          .where('employeeId', '=', item.employeeId)
          .where('date', '=', item.date)
          .executeTakeFirst();
        if (row) existing.set(`${item.employeeId}:${item.date}`, row);
        if (item.expectedUpdatedAt !== undefined) {
          const current = row ? stampOf(row.updatedAt) : null;
          if (current !== item.expectedUpdatedAt)
            throw new HrError('SCHEDULE_CONFLICT', 409, {
              employeeId: item.employeeId,
              date: item.date,
            });
        }
      }
      const check = await schedulePreflight({
        connection,
        policies,
        cells: body.cells.map(({ employeeId, date: on, shiftId }) => ({
          employeeId,
          date: on,
          shiftId,
        })),
        ...preflightContext,
      });
      if (check.hasBlock || (check.hasWarn && !body.acknowledgeWarnings))
        throw new HrError(
          check.hasBlock ? 'SCHEDULE_BLOCKED' : 'SCHEDULE_WARNING_CONFIRMATION',
          409,
          { checks: withoutLeaveIds(check).checks },
        );
      const now = new Date();
      for (const item of body.cells) {
        const key = `${item.employeeId}:${item.date}`;
        const row = existing.get(key);
        const checks = check.checks[key] ?? [];
        const wasPublished = row?.status === 'published';
        const status = publish || wasPublished ? 'published' : 'draft';
        // A published cell changed in place stays published: its employee is told now.
        if (status === 'published') {
          const before =
            row?.publishedShiftId == null ? null : str(row.publishedShiftId);
          if (!row || !wasPublished || before !== item.shiftId)
            changed.push({
              employeeId: item.employeeId,
              date: item.date,
              first: !wasPublished,
            });
        }
        if (checks.some((c) => c.rule === 'leaveConflict') && row)
          conflicts.push(str(row.id));
        const values = {
          shiftId: item.shiftId,
          status,
          checkResult: checks.length ? checks : null,
          // A changed cell's old suggestion no longer applies.
          ...(row && (row.shiftId ?? null) !== item.shiftId
            ? { replacementSuggestion: null }
            : {}),
          ...(status === 'published'
            ? {
                publishedBy: ctx.userId,
                publishedAt: now,
                publishedShiftId: item.shiftId,
              }
            : {}),
          updatedAt: now,
        };
        if (row) await repo.updateOne({ filter: { id: str(row.id) }, values });
        else
          await repo.createOne({
            values: {
              id: newId(),
              employeeId: item.employeeId,
              date: item.date,
              replacementSuggestion: null,
              createdAt: now,
              ...values,
            },
          });
      }
      // Past days re-read their shift.
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone: context.timeZone,
      }).format(new Date());
      const past = body.cells.filter((c) => c.date <= today);
      if (past.length)
        await context.engine().recompute(connection, {
          employeeIds: past.map((c) => c.employeeId),
          from: past.map((c) => c.date).sort()[0],
          to: past
            .map((c) => c.date)
            .sort()
            .at(-1)!,
        });
      publishedAt = now;
      return {
        saved: body.cells.length,
        published: publish,
        checks: withoutLeaveIds(check).checks,
      };
    });
    // After the commit: SQLite has one connection, and delivery writes elsewhere.
    await announce(database.connection(), changed, publishedAt);
    return result;
  }

  /** listReplacementCandidates: the owner's view of one conflicted cell. */
  async function candidates(ctx: ActorContext, scheduleId: string) {
    const policies = await policy(ctx, 'view');
    const connection = database.connection();
    const visible = await scoped(
      connection,
      policies,
      'shiftSchedules',
    ).findOne({
      filter: { id: scheduleId },
    });
    if (!visible) throw new HrError('NOT_FOUND', 404);
    return replacementCandidates({
      connection,
      scheduleId,
      departments: await context.organization.listTree(connection),
      timeZone: context.timeZone,
    });
  }

  return {
    async list(ctx: ActorContext, input: unknown) {
      return load(ctx, input);
    },

    async validate(ctx: ActorContext, input: unknown) {
      const policies = await policy(ctx, 'edit');
      const parsed = mutation.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const result = await database.transaction(async (connection) =>
        schedulePreflight({
          connection,
          policies,
          cells: parsed.data.cells.map(({ employeeId, date: on, shiftId }) => ({
            employeeId,
            date: on,
            shiftId,
          })),
          ...preflightContext,
        }),
      );
      return withoutLeaveIds(result);
    },

    save: write,

    /** 发布: every draft cell of the department in the range, checked again. */
    async publishRange(ctx: ActorContext, input: unknown) {
      const policies = await policy(ctx, 'publish');
      const parsed = request.omit({ q: true }).strict().safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const { departmentId, from, to } = parsed.data;
      days(from, to);
      const employees = await scoped(
        database.connection(),
        policies,
        'employees',
      ).findMany({ filter: { departmentId }, limit: 501 });
      if (!employees.length) return { saved: 0, published: true, checks: {} };
      const drafts = await database
        .query()
        .selectFrom('shiftSchedules')
        .select(['employeeId', 'date', 'shiftId', 'updatedAt'])
        .where(
          'employeeId',
          'in',
          employees.map((e) => str(e.id)),
        )
        .where('date', '>=', from)
        .where('date', '<=', to)
        .where('status', '=', 'draft')
        .execute();
      if (!drafts.length) return { saved: 0, published: true, checks: {} };
      return write(
        ctx,
        {
          // Publishing confirms the warnings the scheduler already saw when saving.
          acknowledgeWarnings: true,
          cells: drafts.map((d) => ({
            employeeId: str(d.employeeId),
            date: day(d.date),
            shiftId: d.shiftId ? str(d.shiftId) : null,
            expectedUpdatedAt: stampOf(d.updatedAt),
          })),
        },
        true,
      );
    },

    /**
     * 套用轮班模板: the cells a template fills for these employees and days,
     * not saved — the scheduler reviews them in the grid and saves as usual.
     * Employees start one step apart so the shifts stay covered.
     */
    async rotation(ctx: ActorContext, input: unknown) {
      await policy(ctx, 'edit');
      const parsed = z
        .object({
          templateKey: z.string().min(1).max(40),
          employeeIds: z.array(z.string().min(1).max(64)).min(1).max(500),
          from: date,
          to: date,
          stagger: z.boolean().default(true),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const body = parsed.data;
      const range = days(body.from, body.to);
      const row = await database
        .query()
        .selectFrom('personnelSettings')
        .select(['value'])
        .where('id', '=', 'attendance.rotations')
        .executeTakeFirst();
      const { templates } = attendanceConfigSchemas.rotations.parse(
        json(row?.value, attendanceConfigDefaults.rotations),
      );
      const template = templates.find((t) => t.key === body.templateKey);
      if (!template) throw new HrError('ROTATION_TEMPLATE_NOT_FOUND', 404);
      const shifts = await database
        .query()
        .selectFrom('shifts')
        .select(['id', 'code'])
        .where('code', 'in', template.shiftCodes)
        .where('active', '=', true)
        .execute();
      const idOf = new Map(shifts.map((s) => [str(s.code), str(s.id)]));
      if (template.shiftCodes.some((code) => !idOf.has(code)))
        throw new HrError('ROTATION_SHIFT_MISSING', 409);
      const cells = body.employeeIds.flatMap((employeeId, index) =>
        range.map((on, offset) => {
          const period = Math.floor(offset / template.periodDays);
          const position = offset % template.periodDays;
          const step =
            (period + (body.stagger ? index : 0)) % template.shiftCodes.length;
          return {
            employeeId,
            date: on,
            shiftId:
              position < template.workDays
                ? idOf.get(template.shiftCodes[step])!
                : null,
          };
        }),
      );
      return { template, cells };
    },

    candidates,

    /** saveReplacementSuggestion: only candidates the rules returned, at most three; the schedule itself is unchanged. */
    async saveSuggestion(
      ctx: ActorContext,
      scheduleId: string,
      input: {
        candidates: { employeeId: string; reasons: string[] }[];
        runId: string | null;
      },
    ) {
      const { candidates: found } = await candidates(ctx, scheduleId);
      const allowed = new Set(found.map((c) => c.employeeId));
      const chosen = input.candidates
        .filter((c) => allowed.has(c.employeeId))
        .slice(0, 3);
      const current = await database
        .query()
        .selectFrom('shiftSchedules')
        .select(['replacementSuggestion'])
        .where('id', '=', scheduleId)
        .executeTakeFirst();
      const previous = json<Suggestion | null>(
        current?.replacementSuggestion,
        null,
      );
      await database
        .query()
        .updateTable('shiftSchedules')
        .set({
          replacementSuggestion: {
            candidates: chosen,
            suggestedAt: new Date().toISOString(),
            runId: input.runId,
            // Invitations already sent for this conflict stay with it.
            ...(previous?.invitations?.length
              ? { invitations: previous.invitations }
              : {}),
          },
        })
        .where('id', '=', scheduleId)
        .execute();
      return chosen;
    },

    /**
     * 发出顶班邀请 (inviteReplacement), only when the scheduler clicks it: each
     * chosen candidate — still one the rules return, with an account — gets a
     * 顶班邀请 card. Nothing is sent before; someone already invited for this
     * conflict is not invited twice. The schedule itself is unchanged.
     */
    async invite(ctx: ActorContext, scheduleId: string, input: unknown) {
      const parsed = z
        .object({
          candidateIds: z.array(z.string().min(1).max(64)).min(1).max(10),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const policies = await policy(ctx, 'edit');
      const visible = await scoped(
        database.connection(),
        policies,
        'shiftSchedules',
      ).findOne({ filter: { id: scheduleId } });
      if (!visible) throw new HrError('NOT_FOUND', 404);
      const send = context.inviteCards?.();
      if (!send) throw new HrError('IM_TRANSPORT_NOT_CONFIGURED', 409);
      const { candidates: found } = await candidates(ctx, scheduleId);
      const allowed = new Set(found.map((c) => c.employeeId));
      const chosen = [...new Set(parsed.data.candidateIds)].filter((id) =>
        allowed.has(id),
      );
      if (!chosen.length) throw new HrError('NO_ELIGIBLE_CANDIDATE', 409);
      const people = await database
        .query()
        .selectFrom('employees')
        .select(['id', 'userId'])
        .where('id', 'in', chosen)
        .execute();
      const userOf = new Map(
        people.flatMap((p) => (p.userId ? [[str(p.id), str(p.userId)]] : [])),
      );
      const row = await database
        .query()
        .selectFrom('shiftSchedules')
        .select(['replacementSuggestion'])
        .where('id', '=', scheduleId)
        .executeTakeFirstOrThrow();
      const suggestion = json<Suggestion | null>(
        row.replacementSuggestion,
        null,
      ) ?? { candidates: [] };
      const invitations = [...(suggestion.invitations ?? [])];
      if (invitations.some((i) => i.response === 'accepted'))
        throw new HrError('REPLACEMENT_ALREADY_ACCEPTED', 409);
      const results: Record<
        string,
        'sent' | 'duplicate' | 'notBound' | 'failed' | 'noAccount'
      > = {};
      const invitees: { employeeId: string; userId: string }[] = [];
      const now = new Date().toISOString();
      for (const employeeId of chosen) {
        const userId = userOf.get(employeeId);
        if (!userId) {
          results[employeeId] = 'noAccount';
          continue;
        }
        if (invitations.some((i) => i.employeeId === employeeId)) {
          results[employeeId] = 'duplicate';
          continue;
        }
        invitees.push({ employeeId, userId });
        invitations.push({
          employeeId,
          sentAt: now,
          response: null,
          respondedAt: null,
          invitedBy: ctx.userId,
        });
      }
      const write = async (list: Invitation[]) =>
        database
          .query()
          .updateTable('shiftSchedules')
          .set({ replacementSuggestion: { ...suggestion, invitations: list } })
          .where('id', '=', scheduleId)
          .execute();
      // Recorded first, so each card reads its invitation when it is rendered.
      if (invitees.length) await write(invitations);
      const sent = invitees.length
        ? await send({ scheduleId, inviterUserId: ctx.userId, invitees })
        : {};
      Object.assign(results, sent);
      // Someone who cannot be reached in the office suite is not left waiting.
      const kept = invitations.filter(
        (i) =>
          !invitees.some((x) => x.employeeId === i.employeeId) ||
          sent[i.employeeId] === 'sent' ||
          sent[i.employeeId] === 'duplicate',
      );
      if (kept.length !== invitations.length) await write(kept);
      return { results, invitations: kept };
    },

    /**
     * An invitee answers on the card. 接受 by the first one puts them on that
     * shift as a DRAFT of their own cell (the scheduler confirms and
     * publishes it; publishing checks it as usual) and expires the others; a
     * later 接受 finds it expired. Checked against the rules again first.
     */
    async respondInvitation(
      ctx: ActorContext,
      scheduleId: string,
      response: 'accepted' | 'declined',
    ): Promise<{
      outcome: 'accepted' | 'declined' | 'expired' | 'notEligible';
      inviterUserId?: string | null;
      date?: string;
      departmentId?: string;
      employeeName?: string;
    }> {
      const own = await database
        .query()
        .selectFrom('employees')
        .select(['id', 'name', 'departmentId'])
        .where('userId', '=', ctx.userId)
        .executeTakeFirst();
      if (!own) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const employeeId = str(own.id);
      const departments = await context.organization.listTree();
      return database.transaction(async (connection) => {
        await lockAttendanceSettings(connection, ctx.userId);
        const cell = await connection.query
          .selectFrom('shiftSchedules')
          .selectAll()
          .where('id', '=', scheduleId)
          .executeTakeFirst();
        if (!cell) return { outcome: 'expired' as const };
        const suggestion = json<Suggestion | null>(
          cell.replacementSuggestion,
          null,
        );
        const invitations = [...(suggestion?.invitations ?? [])];
        const index = invitations.findIndex(
          (i) => i.employeeId === employeeId && i.response === null,
        );
        if (!suggestion || index < 0) return { outcome: 'expired' as const };
        const stamp = new Date().toISOString();
        const invitation = invitations[index];
        const base = {
          inviterUserId: invitation.invitedBy ?? null,
          date: day(cell.date),
          departmentId: str(own.departmentId),
          employeeName: str(own.name),
        };
        const save = (list: Invitation[]) =>
          connection.query
            .updateTable('shiftSchedules')
            .set({
              replacementSuggestion: { ...suggestion, invitations: list },
            })
            .where('id', '=', scheduleId)
            .execute();
        if (response === 'declined') {
          invitations[index] = {
            ...invitation,
            response: 'declined',
            respondedAt: stamp,
          };
          await save(invitations);
          return { outcome: 'declined' as const, ...base };
        }
        if (invitations.some((i) => i.response === 'accepted'))
          return { outcome: 'expired' as const };
        // The rules decide again: the day may have changed since the invitation.
        let eligible = false;
        try {
          const found = await replacementCandidates({
            connection,
            scheduleId,
            departments,
            timeZone: context.timeZone,
          });
          eligible = found.candidates.some((c) => c.employeeId === employeeId);
        } catch (error) {
          if (!(error instanceof HrError)) throw error;
        }
        if (!eligible) return { outcome: 'notEligible' as const, ...base };
        const date = day(cell.date);
        const shiftId = cell.shiftId ? str(cell.shiftId) : null;
        const check = await schedulePreflight({
          connection,
          policies: null,
          cells: [{ employeeId, date, shiftId }],
          ...preflightContext,
        });
        if (check.hasBlock) return { outcome: 'notEligible' as const, ...base };
        const checks = check.checks[`${employeeId}:${date}`] ?? [];
        const mine = await connection.query
          .selectFrom('shiftSchedules')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('date', '=', date)
          .executeTakeFirst();
        const now = new Date();
        if (mine)
          await connection.query
            .updateTable('shiftSchedules')
            .set({
              shiftId,
              status: 'draft',
              checkResult: checks.length ? checks : null,
              updatedAt: now,
            })
            .where('id', '=', str(mine.id))
            .execute();
        else
          await connection.query
            .insertInto('shiftSchedules')
            .values({
              id: newId(),
              employeeId,
              date,
              shiftId,
              status: 'draft',
              checkResult: checks.length ? checks : null,
              replacementSuggestion: null,
              publishedBy: null,
              publishedAt: null,
              publishedShiftId: null,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        await save(
          invitations.map((i, n) =>
            n === index
              ? { ...i, response: 'accepted' as const, respondedAt: stamp }
              : i.response === null
                ? { ...i, response: 'expired' as const, respondedAt: stamp }
                : i,
          ),
        );
        return { outcome: 'accepted' as const, ...base };
      });
    },

    /** The invitation of one employee on a cell, for rendering their card. */
    async invitationOf(scheduleId: string, employeeId: string) {
      const cell = await database
        .query()
        .selectFrom('shiftSchedules')
        .innerJoin('employees', 'employees.id', 'shiftSchedules.employeeId')
        .select([
          'shiftSchedules.date as date',
          'shiftSchedules.shiftId as shiftId',
          'shiftSchedules.replacementSuggestion as replacementSuggestion',
          'employees.departmentId as departmentId',
        ])
        .where('shiftSchedules.id', '=', scheduleId)
        .executeTakeFirst();
      if (!cell) return undefined;
      const suggestion = json<Suggestion | null>(
        cell.replacementSuggestion,
        null,
      );
      return {
        date: day(cell.date),
        shiftId: cell.shiftId ? str(cell.shiftId) : null,
        departmentId: str(cell.departmentId),
        invitation:
          suggestion?.invitations?.find((i) => i.employeeId === employeeId) ??
          null,
      };
    },

    /**
     * 每天 09:00 / 请假生效: re-checks published cells of the next days with a
     * trusted read, writing the checks. Returns cells with a leave conflict.
     */
    async revalidate(input: {
      from: string;
      to: string;
      employeeIds?: readonly string[];
    }) {
      return database.transaction(async (connection) => {
        let query = connection.query
          .selectFrom('shiftSchedules')
          .select(['id', 'employeeId', 'date', 'shiftId', 'checkResult'])
          .where('status', '=', 'published')
          .where('date', '>=', input.from)
          .where('date', '<=', input.to);
        if (input.employeeIds?.length)
          query = query.where('employeeId', 'in', [...input.employeeIds]);
        const rows = await query.execute();
        const conflicted: {
          id: string;
          employeeId: string;
          date: string;
          blocked: string[];
        }[] = [];
        // In windows of 31 days per employee, as the preflight allows.
        const byEmployee = new Map<string, typeof rows>();
        for (const row of rows) {
          const list = byEmployee.get(str(row.employeeId)) ?? [];
          list.push(row);
          byEmployee.set(str(row.employeeId), list);
        }
        for (const [employeeId, list] of byEmployee) {
          const cells = list.map((row) => ({
            employeeId,
            date: day(row.date),
            shiftId: row.shiftId ? str(row.shiftId) : null,
          }));
          let result;
          try {
            result = await schedulePreflight({
              connection,
              policies: null,
              cells,
              ...preflightContext,
            });
          } catch (error) {
            if (error instanceof HrError) continue;
            throw error;
          }
          for (const row of list) {
            const key = `${employeeId}:${day(row.date)}`;
            const checks = result.checks[key] ?? [];
            const before = JSON.stringify(json(row.checkResult, []));
            if (before !== JSON.stringify(checks))
              await connection.query
                .updateTable('shiftSchedules')
                .set({
                  checkResult: checks.length ? checks : null,
                })
                .where('id', '=', str(row.id))
                .execute();
            const blocked = checks
              .filter((c) => c.level === 'block')
              .map((c) => c.rule);
            if (blocked.length)
              conflicted.push({
                id: str(row.id),
                employeeId,
                date: day(row.date),
                blocked,
              });
          }
        }
        return conflicted;
      });
    },

    /** Trusted validation of cells (a swap being approved), on the caller's transaction. */
    async validateTrusted(
      connection: DatabaseConnection,
      cells: { employeeId: string; date: string; shiftId: string | null }[],
    ) {
      return schedulePreflight({
        connection,
        policies: null,
        cells,
        ...preflightContext,
      });
    },

    /** 离职: cells after the leaving date are removed; returns what was removed. */
    async clearAfter(
      connection: DatabaseConnection,
      employeeId: string,
      after: string,
    ) {
      const rows = await connection.query
        .selectFrom('shiftSchedules')
        .select(['id', 'date', 'status'])
        .where('employeeId', '=', employeeId)
        .where('date', '>', after)
        .execute();
      if (rows.length)
        await connection.query
          .deleteFrom('shiftSchedules')
          .where('employeeId', '=', employeeId)
          .where('date', '>', after)
          .execute();
      return rows.map((r) => day(r.date));
    },

    notifyConflict(scheduleId: string) {
      context.onConflict?.()(scheduleId);
    },
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;

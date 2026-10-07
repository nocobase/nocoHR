/**
 * 上线准备 · 批量开通账号并发激活链接.
 *
 * HR who may link employee accounts (`talent.employee` · linkUser) select
 * employees on 人事 › 员工; each active employee without a login account gets
 * one through the Users plugin's server service (never a password anyone
 * sees: a random one nobody keeps), linked to the record like 开通账号 in the
 * directory sync, and a one-time activation link:
 *
 * - The token is 32 random bytes (256 bits), base64url; only its SHA-256 is
 *   stored. It expires after the configured days (default 7), opens once,
 *   and is revoked when a new link is sent, when HR revokes it, or once the
 *   account is activated.
 * - It goes to the employee's office-suite account (Feishu bot) when bound,
 *   else to their work email through the 人事邮箱; otherwise HR receives it
 *   once to hand over. The stored mail keeps the text without the link.
 * - The person sets a password on `/activate/:token`, through the
 *   authentication plugin's `resetPassword` (its password policy applies; no
 *   hash is written here), and signs in.
 * - Accounts that are root, hold a payroll set, or hold a settings or
 *   administer grant are never activated this way (the account-reset rule of
 *   talent-service `accountTakeoverRisk`), neither when the link is made nor
 *   when it is used: they are set up on the Users page.
 * - Every issue, send, failure, hand-over, revocation, activation and refusal
 *   is written to `accountActivationEvents`; sends are limited per HR user
 *   and per employee by counting it.
 */
import { createHash, randomBytes } from 'node:crypto';

import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import type { ImChannel } from '../im-channel.js';
import type { MailService } from '../mail/service.js';
import type { OrganizationService } from '../organization-service.js';
import { HrError, newId } from '../shared.js';
import type { TalentService } from '../talent-service.js';
import type { GoLiveSettingsStore } from './settings.js';

/** A column value as text; null and undefined are empty (`str` of shared.ts spells them out). */
const text = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'string'
      ? value
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);

const EMPLOYEE = 'talent.employee';
/** Employees one request may open accounts for. */
export const MAX_BATCH = 200;
/** Links one HR user may issue in an hour. */
export const ISSUES_PER_HOUR = 500;
/** Links one employee may be sent in a day, and the pause between two. */
export const SENDS_PER_EMPLOYEE_PER_DAY = 10;
export const RESEND_PAUSE_SECONDS = 60;

type Translate = (key: string, options?: Record<string, unknown>) => string;

export type ActivationOutcome =
  | {
      readonly status: 'sent';
      readonly channel: 'feishu' | 'email';
      readonly sentTo: string;
    }
  | {
      readonly status: 'manual';
      /** Shown once to the HR user who asked; never stored. */
      readonly link: string;
      readonly reason: 'noChannel' | 'deliveryFailed' | 'noPublicAddress';
    }
  | { readonly status: 'skipped'; readonly reason: string };

export interface ActivationResult {
  readonly employeeId: string;
  readonly name: string;
  readonly login: string | null;
  readonly accountCreated: boolean;
  readonly outcome: ActivationOutcome;
  readonly expiresAt: string | null;
}

const hash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

const time = (value: unknown): number =>
  value instanceof Date
    ? value.getTime()
    : typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : 0;

function maskEmail(address: string): string {
  const [local = '', host = ''] = address.split('@');
  return `${local.slice(0, 1)}***@${host}`;
}

/** A login name from the employee number: 3–30 letters, digits, `_` or `.`, lower case. */
export function loginFromEmployeeNo(employeeNo: string): string {
  let base = employeeNo
    .toLowerCase()
    .replace(/[^a-z0-9_.]/gu, '_')
    .replace(/^[_.]+|[_.]+$/gu, '')
    .slice(0, 26);
  if (base.length < 3) base = `emp_${base}`.replace(/_$/u, '');
  if (base.length < 3) base = 'emp';
  return base;
}

export function createAccountActivation(deps: {
  database: DatabaseManager;
  users: () => UserAdministrationService;
  talent: () => TalentService;
  organization: () => OrganizationService;
  im: () => ImChannel;
  mail: () => MailService;
  settings: GoLiveSettingsStore;
  /** The activation page's address for an email or a hand-over. */
  publicUrl: (path: string) => string;
  /** The same for a Feishu message (feishu.linkOrigin first). */
  feishuUrl: (path: string) => string;
  companyName: () => string;
  translate: () => Promise<Translate>;
  passwordLength: () => { min: number; max: number };
  now: () => Date;
}) {
  const { database } = deps;

  async function log(
    event: string,
    values: {
      activationId?: string | null;
      employeeId?: string | null;
      userId?: string | null;
      channel?: string | null;
      actorUserId?: string | null;
      ip?: string | null;
      detail?: string | null;
    },
    connection?: DatabaseConnection,
  ) {
    const query = connection ? connection.query : database.query();
    await query
      .insertInto('accountActivationEvents')
      .values({
        id: newId(),
        activationId: values.activationId ?? null,
        employeeId: values.employeeId ?? null,
        userId: values.userId ?? null,
        event,
        channel: values.channel ?? null,
        actorUserId: values.actorUserId ?? null,
        ip: values.ip ? values.ip.slice(0, 64) : null,
        detail: values.detail ? values.detail.slice(0, 200) : null,
        createdAt: deps.now(),
      })
      .execute();
  }

  async function countEvents(
    column: 'actorUserId' | 'employeeId',
    value: string,
    sinceMs: number,
  ): Promise<{ count: number; latest: number }> {
    const rows = await database
      .query()
      .selectFrom('accountActivationEvents')
      .select(['createdAt'])
      .where(column, '=', value)
      .where('event', '=', 'issued')
      .where('createdAt', '>=', new Date(deps.now().getTime() - sinceMs))
      .execute();
    return {
      count: rows.length,
      latest: Math.max(0, ...rows.map((r) => time(r.createdAt))),
    };
  }

  /** The employee ids of `ids` (or all, when null) the caller may manage accounts of. */
  async function scopedEmployeeIds(
    ctx: ActorContext,
    ids: readonly string[] | null,
  ): Promise<Set<string>> {
    const policies = await authorizeAction(ctx.authz, EMPLOYEE, 'linkUser');
    const repository = database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'));
    // Scoped: an employee outside the caller's linkUser scope is not found.
    const rows = ids
      ? ids.length
        ? await repository.findMany({
            filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
          })
        : []
      : await repository.findMany({});
    return new Set(rows.map((r) => text((r as Record<string, unknown>).id)));
  }

  async function employeeRow(id: string) {
    return database
      .query()
      .selectFrom('employees')
      .select([
        'id',
        'name',
        'employeeNo',
        'userId',
        'status',
        'email',
        'departmentId',
        'externalProvider',
        'externalUserId',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async function freeLogin(employeeNo: string): Promise<string> {
    const base = loginFromEmployeeNo(employeeNo);
    for (let i = 1; i < 50; i++) {
      const candidate = i === 1 ? base : `${base}_${i}`;
      const taken = await database
        .query()
        .selectFrom('user')
        .select(['id'])
        .where('username', '=', candidate)
        .executeTakeFirst();
      if (!taken) return candidate;
    }
    return `${base}_${randomBytes(3).toString('hex')}`;
  }

  /** Creates and links the account; answers why not, when it cannot. */
  async function createAccount(
    employee: NonNullable<Awaited<ReturnType<typeof employeeRow>>>,
  ): Promise<{ userId: string } | { reason: string }> {
    const email = text(employee.email).trim().toLowerCase();
    if (!email) return { reason: 'noEmail' };
    const username = await freeLogin(text(employee.employeeNo));
    try {
      const userId = await database.transaction(async (connection) => {
        const created = await deps
          .users()
          .withConnection(connection)
          .create({
            name: text(employee.name),
            email,
            username,
            // Nobody knows or keeps it: the person sets their own through the link.
            password: `${randomBytes(24).toString('base64url')}#A1`,
          });
        const current = await connection.query
          .selectFrom('employees')
          .select(['userId'])
          .where('id', '=', text(employee.id))
          .executeTakeFirst();
        if (current?.userId) throw new HrError('EMPLOYEE_USER_TAKEN', 409);
        await connection.query
          .updateTable('employees')
          .set({ userId: created.id, updatedAt: deps.now() })
          .where('id', '=', text(employee.id))
          .execute();
        await deps
          .organization()
          .syncPrimaryMembership(
            created.id,
            text(employee.departmentId),
            connection,
          );
        return created.id;
      });
      return { userId };
    } catch (error) {
      const code = text((error as { code?: unknown }).code);
      if (code === 'USER_EMAIL_CONFLICT') return { reason: 'emailTaken' };
      if (
        code === 'USER_USERNAME_CONFLICT' ||
        code === 'USER_IDENTITY_CONFLICT'
      )
        return { reason: 'loginTaken' };
      if (code === 'EMPLOYEE_USER_TAKEN') return { reason: 'hasAccount' };
      throw error;
    }
  }

  async function revokeOpen(
    filter: { employeeId?: string; userId?: string },
    reason: string,
    actorUserId: string | null,
  ): Promise<number> {
    let query = database
      .query()
      .selectFrom('accountActivations')
      .select(['id', 'employeeId', 'userId'])
      .where('usedAt', 'is', null)
      .where('revokedAt', 'is', null);
    if (filter.employeeId)
      query = query.where('employeeId', '=', filter.employeeId);
    if (filter.userId) query = query.where('userId', '=', filter.userId);
    const open = await query.execute();
    for (const row of open) {
      const result = await database
        .query()
        .updateTable('accountActivations')
        .set({
          revokedAt: deps.now(),
          revokedReason: reason,
          updatedAt: deps.now(),
        })
        .where('id', '=', text(row.id))
        .where('revokedAt', 'is', null)
        .where('usedAt', 'is', null)
        .execute();
      if (Number(result.updatedCount ?? 0))
        await log('revoked', {
          activationId: text(row.id),
          employeeId: text(row.employeeId),
          userId: text(row.userId),
          actorUserId,
          detail: reason,
        });
    }
    return open.length;
  }

  /** Issues and delivers a link for an employee whose account exists and may be activated this way. */
  async function issueAndDeliver(
    ctx: ActorContext,
    employee: NonNullable<Awaited<ReturnType<typeof employeeRow>>>,
    userId: string,
  ): Promise<{ outcome: ActivationOutcome; expiresAt: Date }> {
    const days = (await deps.settings.read('accountActivation')).value.linkDays;
    const token = randomBytes(32).toString('base64url');
    const now = deps.now();
    const expiresAt = new Date(now.getTime() + days * 86_400_000);
    const id = newId();
    const employeeId = text(employee.id);
    await revokeOpen({ employeeId }, 'resent', ctx.userId);
    await revokeOpen({ userId }, 'resent', ctx.userId);
    await database
      .query()
      .insertInto('accountActivations')
      .values({
        id,
        employeeId,
        userId,
        tokenHash: hash(token),
        expiresAt,
        usedAt: null,
        revokedAt: null,
        revokedReason: null,
        channel: 'manual',
        deliveryStatus: 'manual',
        sentTo: null,
        createdBy: ctx.userId,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await log('issued', {
      activationId: id,
      employeeId,
      userId,
      actorUserId: ctx.userId,
    });
    const path = `/activate/${token}`;
    const t = await deps.translate();
    const user = await deps.users().get(userId);
    const login = text(user?.username || user?.email);
    const company = deps.companyName() || t('goLive.activation.company');
    const message = (link: string) =>
      t('goLive.activation.text', {
        company,
        name: text(employee.name),
        login,
        days,
        link,
      });
    const record = async (
      channel: 'feishu' | 'email' | 'manual',
      status: 'sent' | 'failed' | 'manual',
      sentTo: string | null,
    ) => {
      await database
        .query()
        .updateTable('accountActivations')
        .set({ channel, deliveryStatus: status, sentTo, updatedAt: deps.now() })
        .where('id', '=', id)
        .execute();
      await log(status, {
        activationId: id,
        employeeId,
        userId,
        channel,
        actorUserId: ctx.userId,
      });
    };

    let failed = false;
    // A message needs an address the person can open: without app.publicOrigin the link is only a path.
    const absolute = (url: string) => /^https?:\/\//u.test(url);
    const reachable = absolute(deps.publicUrl(path));
    // 1. The office-suite bot, when the employee is bound and a transport can deliver.
    const im = deps.im();
    if (
      absolute(deps.feishuUrl(path)) &&
      employee.externalUserId &&
      text(employee.externalProvider) === 'feishu' &&
      im.transport.name !== 'none'
    ) {
      const state = await im.sendText(userId, message(deps.feishuUrl(path)));
      if (state === 'sent') {
        await record('feishu', 'sent', 'feishu');
        return {
          outcome: { status: 'sent', channel: 'feishu', sentTo: 'feishu' },
          expiresAt,
        };
      }
      if (state === 'failed') {
        failed = true;
        await record('feishu', 'failed', 'feishu');
      }
    }
    // 2. The work email, through the 人事邮箱 when it is connected.
    const email = text(employee.email).trim();
    if (email && reachable) {
      const link = deps.publicUrl(path);
      const state = await deps
        .mail()
        .sendDirect({
          purpose: 'hr',
          idempotencyKey: `account-activation-${id}`,
          to: email,
          subject: t('goLive.activation.subject', { company }),
          text: message(link),
          // The thread keeps the text without the link: a stored link would open the account.
          storedText: message(t('goLive.activation.linkRemoved')),
          refType: 'employee',
          refId: employeeId,
          proposal: { kind: 'accountActivation', employeeId },
        })
        .catch(() => 'failed' as const);
      if (state === 'sent') {
        const sentTo = maskEmail(email);
        await record('email', 'sent', sentTo);
        return {
          outcome: { status: 'sent', channel: 'email', sentTo },
          expiresAt,
        };
      }
      if (state === 'failed' || state === 'channelNotConfigured') {
        failed = true;
        await record('email', 'failed', maskEmail(email));
      }
    }
    // 3. Neither: HR hands the link over (shown once, never stored).
    await record('manual', 'manual', null);
    return {
      outcome: {
        status: 'manual',
        link: deps.publicUrl(path),
        reason: failed
          ? 'deliveryFailed'
          : reachable
            ? 'noChannel'
            : 'noPublicAddress',
      },
      expiresAt,
    };
  }

  async function assertSendAllowed(ctx: ActorContext, employeeId: string) {
    const caller = await countEvents('actorUserId', ctx.userId, 3_600_000);
    if (caller.count >= ISSUES_PER_HOUR)
      throw new HrError('ACTIVATION_RATE_LIMITED', 409);
    const employee = await countEvents('employeeId', employeeId, 86_400_000);
    if (employee.count >= SENDS_PER_EMPLOYEE_PER_DAY)
      throw new HrError('ACTIVATION_RATE_LIMITED', 409);
    if (
      employee.latest &&
      deps.now().getTime() - employee.latest < RESEND_PAUSE_SECONDS * 1000
    )
      throw new HrError('ACTIVATION_TOO_SOON', 409);
  }

  /** Why an account may not be activated by link: the caller's rule and the caller-less one. */
  async function risk(
    ctx: ActorContext,
    userId: string,
  ): Promise<string | undefined> {
    const talent = deps.talent();
    return (
      (await talent.activationRisk(ctx, userId)) ??
      (await talent.activationRisk(null, userId))
    );
  }

  async function tokenRow(token: string) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/u.test(token))
      return undefined;
    const row = await database
      .query()
      .selectFrom('accountActivations')
      .selectAll()
      .where('tokenHash', '=', hash(token))
      .executeTakeFirst();
    if (!row || row.usedAt || row.revokedAt) return undefined;
    if (time(row.expiresAt) <= deps.now().getTime()) return undefined;
    // The employee must still be linked to this account and in service.
    const employee = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'name', 'userId', 'status'])
      .where('id', '=', text(row.employeeId))
      .executeTakeFirst();
    if (
      !employee ||
      text(employee.userId) !== text(row.userId) ||
      employee.status === 'leave'
    )
      return undefined;
    const user = await deps.users().get(text(row.userId));
    if (!user || user.disabledAt) return undefined;
    return { row, employee, user };
  }

  return {
    /**
     * 开通账号并发送激活链接 for `employeeIds`, or for every active employee
     * without an account in the caller's scope (`allWithoutAccount`).
     */
    async bulk(ctx: ActorContext, input: unknown): Promise<ActivationResult[]> {
      const body = (input ?? {}) as {
        employeeIds?: unknown;
        allWithoutAccount?: unknown;
      };
      let ids: string[] | null;
      if (body.allWithoutAccount === true) ids = null;
      else if (
        Array.isArray(body.employeeIds) &&
        body.employeeIds.length > 0 &&
        body.employeeIds.every(
          (id) => typeof id === 'string' && id.length <= 64,
        )
      )
        ids = [...new Set(body.employeeIds as string[])];
      else throw new HrError('INVALID_INPUT', 400);
      if (ids && ids.length > MAX_BATCH)
        throw new HrError('ACTIVATION_BATCH_TOO_LARGE', 400, {
          max: MAX_BATCH,
        });
      const scoped = await scopedEmployeeIds(ctx, ids);
      let targets = ids ? ids.filter((id) => scoped.has(id)) : [...scoped];
      if (!ids) {
        const rows = targets.length
          ? await database
              .query()
              .selectFrom('employees')
              .select(['id'])
              .where('id', 'in', targets)
              .where('userId', 'is', null)
              .where('status', '!=', 'leave')
              .orderBy('employeeNo', 'asc')
              .execute()
          : [];
        targets = rows.map((r) => text(r.id)).slice(0, MAX_BATCH);
      }
      const caller = await countEvents('actorUserId', ctx.userId, 3_600_000);
      let budget = ISSUES_PER_HOUR - caller.count;
      const results: ActivationResult[] = [];
      for (const id of targets) {
        const employee = await employeeRow(id);
        if (!employee) continue;
        const base = {
          employeeId: id,
          name: text(employee.name),
          expiresAt: null,
        };
        const skip = (reason: string, login: string | null = null) =>
          results.push({
            ...base,
            login,
            accountCreated: false,
            outcome: { status: 'skipped', reason },
          });
        if (employee.status === 'leave') {
          skip('left');
          continue;
        }
        if (employee.userId) {
          skip('hasAccount');
          continue;
        }
        if (budget <= 0) {
          skip('rateLimited');
          continue;
        }
        const created = await createAccount(employee);
        if ('reason' in created) {
          skip(created.reason);
          continue;
        }
        const user = await deps.users().get(created.userId);
        const login = user ? text(user.username || user.email) : null;
        await log('accountCreated', {
          employeeId: id,
          userId: created.userId,
          actorUserId: ctx.userId,
        });
        // The new account's department and position subjects apply on its first request.
        await deps.talent().notifyUsers([created.userId]);
        const refused = await risk(ctx, created.userId);
        if (refused) {
          await log('refused', {
            employeeId: id,
            userId: created.userId,
            actorUserId: ctx.userId,
            detail: refused,
          });
          results.push({
            ...base,
            login,
            accountCreated: true,
            outcome: { status: 'skipped', reason: 'privileged' },
          });
          continue;
        }
        budget -= 1;
        const delivered = await issueAndDeliver(ctx, employee, created.userId);
        results.push({
          ...base,
          login,
          accountCreated: true,
          outcome: delivered.outcome,
          expiresAt: delivered.expiresAt.toISOString(),
        });
      }
      return results;
    },

    /** 重新发送激活链接: a new link for a linked account not yet activated by link; the old one stops working. */
    async resend(
      ctx: ActorContext,
      employeeId: string,
    ): Promise<ActivationResult> {
      const scoped = await scopedEmployeeIds(ctx, [employeeId]);
      if (!scoped.has(employeeId)) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const employee = await employeeRow(employeeId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      if (employee.status === 'leave')
        throw new HrError('ORG_SYNC_EMPLOYEE_LEFT', 409);
      const userId = text(employee.userId);
      if (!userId) throw new HrError('EMPLOYEE_NO_ACCOUNT', 409);
      if (userId === ctx.userId) throw new HrError('RESET_OWN_PASSWORD', 409);
      const user = await deps.users().get(userId);
      if (!user || user.disabledAt)
        throw new HrError('EMPLOYEE_NO_ACCOUNT', 409);
      const activated = await database
        .query()
        .selectFrom('accountActivations')
        .select(['id'])
        .where('userId', '=', userId)
        .where('usedAt', 'is not', null)
        .executeTakeFirst();
      if (activated) throw new HrError('ACCOUNT_ALREADY_ACTIVATED', 409);
      const refused = await risk(ctx, userId);
      if (refused) {
        await log('refused', {
          employeeId,
          userId,
          actorUserId: ctx.userId,
          detail: refused,
        });
        throw new HrError(refused, 403, { permissionSets: [] });
      }
      await assertSendAllowed(ctx, employeeId);
      const delivered = await issueAndDeliver(ctx, employee, userId);
      return {
        employeeId,
        name: text(employee.name),
        login: text(user.username || user.email),
        accountCreated: false,
        outcome: delivered.outcome,
        expiresAt: delivered.expiresAt.toISOString(),
      };
    },

    /** 作废激活链接: every open link of the employee stops working. */
    async revoke(ctx: ActorContext, employeeId: string) {
      const scoped = await scopedEmployeeIds(ctx, [employeeId]);
      if (!scoped.has(employeeId)) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      return {
        revoked: await revokeOpen({ employeeId }, 'revoked', ctx.userId),
      };
    },

    /** The employee's activation state, for the detail page. */
    async state(ctx: ActorContext, employeeId: string) {
      const scoped = await scopedEmployeeIds(ctx, [employeeId]);
      if (!scoped.has(employeeId)) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const rows = await database
        .query()
        .selectFrom('accountActivations')
        .select([
          'id',
          'userId',
          'expiresAt',
          'usedAt',
          'revokedAt',
          'channel',
          'deliveryStatus',
          'sentTo',
          'createdAt',
        ])
        .where('employeeId', '=', employeeId)
        .orderBy('createdAt', 'desc')
        .execute();
      const now = deps.now().getTime();
      const used = rows.find((r) => r.usedAt);
      const open = rows.find(
        (r) => !r.usedAt && !r.revokedAt && time(r.expiresAt) > now,
      );
      return {
        activatedAt: used ? used.usedAt : null,
        open: open
          ? {
              expiresAt: open.expiresAt,
              channel: text(open.channel),
              deliveryStatus: text(open.deliveryStatus),
              sentTo: open.sentTo ? text(open.sentTo) : null,
              createdAt: open.createdAt,
            }
          : null,
        links: rows.length,
      };
    },

    // ---------- The employee's link (public) ----------

    /** What the activation page shows: the person's name and login, and the password rule. */
    async view(token: string) {
      const found = await tokenRow(token);
      if (!found) throw new HrError('ACTIVATION_LINK_INVALID', 404);
      // A privileged account's link shows nothing either (it is refused when used).
      if (await deps.talent().activationRisk(null, text(found.row.userId)))
        throw new HrError('ACTIVATION_LINK_INVALID', 404);
      const length = deps.passwordLength();
      return {
        name: text(found.employee.name),
        login: text(found.user.username || found.user.email),
        company: deps.companyName(),
        expiresAt: found.row.expiresAt,
        minPasswordLength: length.min,
        maxPasswordLength: length.max,
      };
    },

    /** Sets the password through the authentication plugin and uses the link up. */
    async activate(token: string, input: unknown, ip: string) {
      const found = await tokenRow(token);
      if (!found) {
        await log('refused', { ip, detail: 'invalidLink' });
        throw new HrError('ACTIVATION_LINK_INVALID', 404);
      }
      const { row, user } = found;
      const id = text(row.id);
      const userId = text(row.userId);
      const employeeId = text(row.employeeId);
      const password = (input as { password?: unknown } | null)?.password;
      const length = deps.passwordLength();
      if (typeof password !== 'string') throw new HrError('INVALID_INPUT', 400);
      if (password.length < length.min)
        throw new HrError('PASSWORD_TOO_SHORT', 400, { min: length.min });
      if (password.length > length.max)
        throw new HrError('PASSWORD_TOO_LONG', 400, { max: length.max });
      // The account may have gained a privileged set since the link was made.
      const refused = await deps.talent().activationRisk(null, userId);
      if (refused) {
        await log('refused', {
          activationId: id,
          employeeId,
          userId,
          ip,
          detail: refused,
        });
        throw new HrError('ACTIVATION_LINK_INVALID', 404);
      }
      // Claimed before the password changes: two parallel requests cannot both use the link.
      const claimed = await database
        .query()
        .updateTable('accountActivations')
        .set({ usedAt: deps.now(), updatedAt: deps.now() })
        .where('id', '=', id)
        .where('usedAt', 'is', null)
        .where('revokedAt', 'is', null)
        .execute();
      if (!Number(claimed.updatedCount ?? 0))
        throw new HrError('ACTIVATION_LINK_INVALID', 404);
      try {
        await deps.users().resetPassword(userId, password);
      } catch (error) {
        // Released again: the link stays usable with a password the policy accepts.
        await database
          .query()
          .updateTable('accountActivations')
          .set({ usedAt: null, updatedAt: deps.now() })
          .where('id', '=', id)
          .execute();
        const code = text((error as { code?: unknown }).code);
        if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG')
          throw new HrError(code, 400, {
            min: length.min,
            max: length.max,
          });
        throw error;
      }
      await revokeOpen({ userId }, 'activatedElsewhere', null);
      await log('activated', { activationId: id, employeeId, userId, ip });
      return { login: text(user.username || user.email) };
    },
  };
}

export type AccountActivationService = ReturnType<
  typeof createAccountActivation
>;

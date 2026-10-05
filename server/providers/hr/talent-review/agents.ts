/**
 * V4-13 13C 开放给外部 AI Agent.
 *
 * NocoBase ships no MCP server plugin here, and the API Keys plugin's default
 * configuration turns a key into the owner's full session — every endpoint
 * the user can reach, not only the tools 13C opens (payroll, performance and
 * talent-review pages included). So the step serves its own minimal MCP
 * endpoint (JSON-RPC over HTTP: initialize, tools/list, tools/call) at
 * `POST /api/talent/agent/mcp`, accepting only personal access tokens issued
 * here: a random secret shown once and stored as a SHA-256 hash, bound to one
 * user and one client, at most `agentTokenMaxDays` (90) days, revocable at
 * any time. A token authenticates nothing else.
 *
 * Every call runs as the token's user through the same authorization as the
 * pages: the tools are the AI employees' existing backend tools
 * (searchKnowledge, getEmployeeLearningProfile, getMySchedule,
 * getMyLeaveBalance, draftLeaveRequest, teamCertificationSummary,
 * getTeamOverview, searchEmployees) and the 待我决定 counts, never a new
 * business implementation. No tool reads pay, identity numbers, performance
 * or talent-review data, candidates, or confirms, approves, publishes,
 * issues or grants anything. Each call is written to `agentCallLogs` (user,
 * client, tool, time, a summary without personal data); calls beyond
 * `agentRateLimitPerMinute` per token per minute are refused.
 */
import { createHash, randomBytes } from 'node:crypto';

import { z } from 'zod';

import { authorizeAction, policyOf, scopeForUser } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { iso, json } from './context.js';

const RESOURCE = 'talent.agentClient';

/** The tools 13C opens; `audience` is who may call them, checked before the tool's own authorization. */
export const AGENT_TOOLS = [
  { name: 'askKnowledge', audience: 'everyone' },
  { name: 'getMyLearning', audience: 'everyone' },
  { name: 'getMyCertificates', audience: 'everyone' },
  { name: 'getMySchedule', audience: 'everyone' },
  { name: 'getMyLeaveBalance', audience: 'everyone' },
  { name: 'draftMyLeaveRequest', audience: 'everyone' },
  { name: 'getTeamCertificationSummary', audience: 'manager' },
  { name: 'getTeamLearningProgress', audience: 'manager' },
  { name: 'listMyPendingDecisions', audience: 'managerOrAdmin' },
  { name: 'searchEmployees', audience: 'managerOrAdmin' },
] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number]['name'];

const clientInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    ownerUserId: z.string().max(64).optional(),
    allowedTools: z
      .array(z.enum(AGENT_TOOLS.map((t) => t.name) as [AgentToolName, ...AgentToolName[]]))
      .min(1),
    status: z.enum(['active', 'revoked']).optional(),
  })
  .strict();
const tokenInput = z
  .object({
    clientId: z.string().min(1).max(64),
    name: z.string().trim().max(200).optional(),
    days: z.number().int().min(1).max(90).optional(),
  })
  .strict();

export const hashToken = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** The adapter to the AI employees' tools, supplied by the route (it resolves the tool dependencies). */
export type ToolInvoker = (
  tool: string,
  userId: string,
  args: Record<string, unknown>,
) => Promise<{ status: string; content: unknown }>;

export function createAgentService(ctx: TalentReviewContext) {
  const { database } = ctx;

  function toClient(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      name: str(row.name),
      ownerUserId: str(row.ownerUserId),
      allowedTools: json<string[]>(row.allowedTools, []),
      status: str(row.status),
      createdAt: iso(row.createdAt),
    };
  }

  async function clientRow(id: string) {
    const row = await database
      .query()
      .selectFrom('agentClients')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('AGENT_CLIENT_NOT_FOUND', 404);
    return toClient(row);
  }

  async function log(entry: {
    clientId: string | null;
    tokenId: string | null;
    userId: string | null;
    tool: string;
    status: string;
    summary: string;
  }) {
    const now = new Date();
    await database
      .query()
      .insertInto('agentCallLogs')
      .values({ id: newId(), ...entry, summary: entry.summary.slice(0, 500), calledAt: now, createdAt: now, updatedAt: now })
      .execute();
  }

  async function audienceAllows(actor: ActorContext, audience: string): Promise<boolean> {
    if (audience === 'everyone') return true;
    const manager =
      (await ctx.platform.organization.managedDepartments(actor.userId)).length > 0;
    if (audience === 'manager') return manager;
    return manager || (await ctx.can(actor, 'talent.talentReview', 'manage'));
  }

  /** A short, personal-data-free summary of a tool result for the audit log. */
  function summarize(tool: string, content: unknown): string {
    if (Array.isArray(content)) return `${tool}: ${content.length} 条`;
    if (content && typeof content === 'object') {
      const keys = Object.entries(content as Record<string, unknown>)
        .map(([k, v]) => (Array.isArray(v) ? `${k} ${v.length}` : k))
        .slice(0, 6);
      return `${tool}: ${keys.join('，')}`;
    }
    return tool;
  }

  const service = {
    // ---------- 设置 · 外部 AI 助手 (hr.admin) ----------
    async listClients(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const rows = (await database
        .repository('agentClients')
        .withPolicy(policyOf(policies, 'agentClients'))
        .findMany({})) as Record<string, unknown>[];
      const tokens = await database.query().selectFrom('agentTokens').select(['clientId', 'revokedAt', 'expiresAt']).execute();
      const now = Date.now();
      return {
        clients: await Promise.all(
          rows.map(async (row) => {
            const client = toClient(row);
            return {
              ...client,
              ownerName: await ctx.userName(client.ownerUserId),
              activeTokens: tokens.filter(
                (t) => str(t.clientId) === client.id && !t.revokedAt && new Date(str(t.expiresAt)).getTime() > now,
              ).length,
            };
          }),
        ),
        tools: AGENT_TOOLS,
      };
    },

    async saveClient(actor: ActorContext, id: string | null, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const parsed = clientInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const now = new Date();
      const values = {
        name: parsed.data.name,
        ownerUserId: parsed.data.ownerUserId || actor.userId,
        allowedTools: parsed.data.allowedTools,
        status: parsed.data.status ?? 'active',
        updatedAt: now,
      };
      const repo = database.repository('agentClients').withPolicy(policyOf(policies, 'agentClients'));
      const target = id ?? newId();
      if (id) {
        await clientRow(id);
        await repo.updateOne({ filter: { id }, values });
      } else await repo.createOne({ values: { id: target, ...values, createdAt: now } });
      return clientRow(target);
    },

    /** 调用记录 by client (hr.admin). */
    async callLogs(actor: ActorContext, filters: { clientId?: string; limit?: number }) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const rows = (await database
        .repository('agentCallLogs')
        .withPolicy(policyOf(policies, 'agentCallLogs'))
        .findMany(filters.clientId ? { filter: { clientId: filters.clientId } } : {})) as Record<
        string,
        unknown
      >[];
      const sorted = rows
        .sort((a, b) => str(b.calledAt).localeCompare(str(a.calledAt)))
        .slice(0, Math.min(filters.limit ?? 200, 1000));
      return Promise.all(
        sorted.map(async (r) => ({
          id: str(r.id),
          clientId: r.clientId ? str(r.clientId) : null,
          userName: r.userId ? await ctx.userName(str(r.userId)) : '',
          tool: str(r.tool),
          status: str(r.status),
          summary: r.summary ? str(r.summary) : '',
          calledAt: iso(r.calledAt),
        })),
      );
    },

    /** Every user's tokens (hr.admin revokes any). */
    async allTokens(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'manage');
      const rows = (await database
        .repository('agentTokens')
        .withPolicy(policyOf(policies, 'agentTokens'))
        .findMany({})) as Record<string, unknown>[];
      return Promise.all(
        rows.map(async (r) => ({
          id: str(r.id),
          clientId: str(r.clientId),
          userName: await ctx.userName(str(r.userId)),
          name: r.name ? str(r.name) : '',
          prefix: str(r.prefix),
          expiresAt: iso(r.expiresAt),
          revokedAt: iso(r.revokedAt),
          lastUsedAt: iso(r.lastUsedAt),
        })),
      );
    },

    // ---------- 我的档案 · 连接 AI 助手 (everyone, for oneself) ----------
    async mine(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'issueToken');
      const clients = ((await database
        .repository('agentClients')
        .withPolicy(policyOf(policies, 'agentClients'))
        .findMany({ filter: { status: 'active' } })) as Record<string, unknown>[]).map((r) => ({
        id: str(r.id),
        name: str(r.name),
        allowedTools: json<string[]>(r.allowedTools, []),
      }));
      const tokens = (await database
        .repository('agentTokens')
        .withPolicy(policyOf(policies, 'agentTokens'))
        .findMany({ filter: { userId: actor.userId } })) as Record<string, unknown>[];
      const settings = await ctx.settings();
      return {
        clients,
        tokens: tokens
          .map((r) => ({
            id: str(r.id),
            clientId: str(r.clientId),
            clientName: clients.find((c) => c.id === str(r.clientId))?.name ?? '',
            name: r.name ? str(r.name) : '',
            prefix: str(r.prefix),
            expiresAt: iso(r.expiresAt),
            revokedAt: iso(r.revokedAt),
            lastUsedAt: iso(r.lastUsedAt),
          }))
          .sort((a, b) => (b.expiresAt ?? '').localeCompare(a.expiresAt ?? '')),
        maxDays: settings.agentTokenMaxDays,
      };
    },

    /** 生成个人访问令牌: the secret is answered once; only its hash is kept. */
    async issueToken(actor: ActorContext, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'issueToken');
      const parsed = tokenInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const client = await clientRow(parsed.data.clientId);
      if (client.status !== 'active') throw new HrError('AGENT_CLIENT_REVOKED', 409);
      const settings = await ctx.settings();
      const days = Math.min(parsed.data.days ?? settings.agentTokenMaxDays, settings.agentTokenMaxDays);
      const secret = `nhr_${randomBytes(24).toString('base64url')}`;
      const id = newId();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + days * 86_400_000);
      await database
        .repository('agentTokens')
        .withPolicy(policyOf(policies, 'agentTokens'))
        .createOne({
          values: {
            id,
            clientId: client.id,
            userId: actor.userId,
            name: parsed.data.name ?? client.name,
            tokenHash: hashToken(secret),
            prefix: secret.slice(0, 8),
            expiresAt,
            revokedAt: null,
            revokedBy: null,
            lastUsedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      return { id, secret, expiresAt: expiresAt.toISOString(), clientName: client.name };
    },

    /** 撤销: one's own token, or any token for hr.admin. */
    async revokeToken(actor: ActorContext, id: string) {
      const admin = await ctx.can(actor, RESOURCE, 'manage');
      const policies = await authorizeAction(actor.authz, RESOURCE, admin ? 'manage' : 'issueToken');
      const repo = database.repository('agentTokens').withPolicy(policyOf(policies, 'agentTokens'));
      const row = (await repo.findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row || (!admin && str(row.userId) !== actor.userId))
        throw new HrError('AGENT_TOKEN_NOT_FOUND', 404);
      if (row.revokedAt) return { id, revoked: true };
      await repo.updateOne({
        filter: { id },
        values: { revokedAt: new Date(), revokedBy: actor.userId, updatedAt: new Date() },
      });
      return { id, revoked: true };
    },

    // ---------- MCP ----------
    /** Authenticates a bearer token; answers the token, its client and the caller, or why not. */
    async authenticate(secret: string | undefined) {
      if (!secret) return { error: 'unauthorized' as const };
      const row = await database
        .query()
        .selectFrom('agentTokens')
        .selectAll()
        .where('tokenHash', '=', hashToken(secret))
        .executeTakeFirst();
      if (!row) return { error: 'unauthorized' as const };
      const token = {
        id: str(row.id),
        clientId: str(row.clientId),
        userId: str(row.userId),
      };
      if (row.revokedAt || new Date(str(row.expiresAt)).getTime() <= Date.now())
        return { error: 'unauthorized' as const, token };
      const client = await clientRow(token.clientId).catch(() => undefined);
      if (!client || client.status !== 'active') return { error: 'unauthorized' as const, token };
      const user = await database
        .query()
        .selectFrom('user')
        .select(['id', 'disabledAt'])
        .where('id', '=', token.userId)
        .executeTakeFirst()
        .catch(() => undefined);
      if (!user || (user as { disabledAt?: unknown }).disabledAt) return { error: 'unauthorized' as const, token };
      // 每分钟调用次数上限 (per token).
      const settings = await ctx.settings();
      const recent = await database
        .query()
        .selectFrom('agentCallLogs')
        .select(['id'])
        .where('tokenId', '=', token.id)
        .where('calledAt', '>=', new Date(Date.now() - 60_000))
        .execute();
      if (recent.length >= settings.agentRateLimitPerMinute)
        return { error: 'rateLimited' as const, token, client };
      await database
        .query()
        .updateTable('agentTokens')
        .set({ lastUsedAt: new Date() })
        .where('id', '=', token.id)
        .execute();
      return {
        token,
        client,
        actor: {
          userId: token.userId,
          authz: await scopeForUser(ctx.platform.authz, token.userId),
        } as ActorContext,
      };
    },

    /** tools/list for this caller: allowed by the client and open to the caller's audience. */
    async toolsFor(actor: ActorContext, allowed: readonly string[]) {
      const out: AgentToolName[] = [];
      for (const tool of AGENT_TOOLS)
        if (allowed.includes(tool.name) && (await audienceAllows(actor, tool.audience))) out.push(tool.name);
      return out;
    },

    /** tools/call: the client's list, the audience, then the tool itself (which authorizes again). */
    async call(
      auth: { token: { id: string; clientId: string; userId: string }; client: { allowedTools: string[] }; actor: ActorContext },
      tool: string,
      args: Record<string, unknown>,
      invoke: ToolInvoker,
    ): Promise<{ ok: boolean; content: unknown }> {
      const entry = { clientId: auth.token.clientId, tokenId: auth.token.id, userId: auth.token.userId, tool };
      const definition = AGENT_TOOLS.find((t) => t.name === tool);
      if (!definition || !auth.client.allowedTools.includes(tool)) {
        await log({ ...entry, status: 'denied', summary: `${tool}: 不在允许的工具中` });
        return { ok: false, content: { code: 'TOOL_NOT_ALLOWED' } };
      }
      if (!(await audienceAllows(auth.actor, definition.audience))) {
        await log({ ...entry, status: 'denied', summary: `${tool}: 无权使用` });
        return { ok: false, content: { code: 'FORBIDDEN' } };
      }
      try {
        const result = await invoke(tool, auth.token.userId, args);
        const ok = result.status === 'success';
        await log({ ...entry, status: ok ? 'ok' : 'error', summary: ok ? summarize(tool, result.content) : `${tool}: ${str((result.content as { code?: unknown })?.code ?? 'error')}` });
        return { ok, content: result.content };
      } catch (error) {
        const code = error instanceof HrError ? error.code : 'ERROR';
        await log({ ...entry, status: 'error', summary: `${tool}: ${code}` });
        return { ok: false, content: { code } };
      }
    },

    log,
  };
  return service;
}

export type AgentService = ReturnType<typeof createAgentService>;

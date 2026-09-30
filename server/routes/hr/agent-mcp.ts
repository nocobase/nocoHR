/**
 * V4-13 13C: `POST /api/talent/agent/mcp` — a minimal MCP server (JSON-RPC
 * 2.0 over streamable HTTP, JSON responses) for external AI assistants such
 * as Claude. It takes only a personal access token (`Authorization: Bearer
 * nhr_…`) issued in 我的档案 · 连接 AI 助手; no session cookie, no API key.
 * Why not the API Keys plugin: see talent-review/agents.ts.
 *
 * Every tool call is the AI employees' existing backend tool, invoked as the
 * token's user, so the same authorization and record scopes apply. The
 * client's allowed tools and each tool's audience are checked first; each
 * call, refusal and rate-limited attempt is written to the audit log.
 */
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import type { ServiceToken } from '@nocobase/service-provider';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { profileServicesToken, talentReviewServicesToken } from '../../providers/hr/tokens.js';
import { scopeForUser } from '../../providers/hr/authorize.js';
import { draftLeaveRequest, getMyLeaveBalance, getMySchedule } from '../../ai/tools/attendance-tools.js';
import { teamCertificationSummary } from '../../ai/tools/exam-tools.js';
import { searchKnowledge } from '../../ai/tools/knowledge-tools.js';
import { getTeamOverview, searchEmployees } from '../../ai/tools/profile-tools.js';
import { getEmployeeLearningProfile } from '../../ai/tools/training-tools.js';
import type { AgentToolName } from '../../providers/hr/talent-review/agents.js';

interface ToolLike {
  dependencies?: Record<string, ServiceToken<unknown>>;
  invoke: (ctx: never, args: never, runtime: never) => Promise<unknown>;
}

const PROTOCOL = '2025-06-18';

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

/** The descriptions and input schemas an external assistant sees. */
const DESCRIPTIONS: Record<AgentToolName, { description: string; inputSchema: unknown }> = {
  askKnowledge: {
    description:
      'Search the NocoHR knowledge base the user may read; answer only from the passages, citing them. Uncontrolled documents carry a notice.',
    inputSchema: obj({ question: { type: 'string' } }, ['question']),
  },
  getMyLearning: {
    description: "The user's own learning tasks (required courses, due dates, status) and competency gaps.",
    inputSchema: obj({}),
  },
  getMyCertificates: {
    description: "The user's own certificates and their expiry dates. Never another person's.",
    inputSchema: obj({}),
  },
  getMySchedule: {
    description: "The user's own published shifts between two dates (YYYY-MM-DD, at most two months).",
    inputSchema: obj({ from: { type: 'string' }, to: { type: 'string' } }, ['from', 'to']),
  },
  getMyLeaveBalance: {
    description: "The user's own leave balances and leave types.",
    inputSchema: obj({}),
  },
  draftMyLeaveRequest: {
    description:
      'Create a DRAFT leave request for the user only. It is not submitted: give the user the link; they submit it in NocoHR.',
    inputSchema: obj(
      {
        leaveType: { type: 'string', description: 'Leave type code such as annual, or id.' },
        startAt: { type: 'string', description: 'ISO 8601 with offset; a whole day starts at 00:00.' },
        endAt: { type: 'string', description: 'ISO 8601 with offset; a whole day ends at 00:00 of the next day.' },
        reason: { type: 'string' },
      },
      ['leaveType', 'startAt', 'endAt'],
    ),
  },
  getTeamCertificationSummary: {
    description: 'Department heads: required certificates of the team (valid, expiring, expired, missing).',
    inputSchema: obj({ departmentId: { type: 'string' } }),
  },
  getTeamLearningProgress: {
    description: 'Department heads: the team learning in progress, overdue and completed this month.',
    inputSchema: obj({ departmentId: { type: 'string' } }),
  },
  listMyPendingDecisions: {
    description:
      'Heads and HR: how many items wait for the user in 待我决定, with links. Read only: decisions are made in NocoHR.',
    inputSchema: obj({}),
  },
  searchEmployees: {
    description: 'Heads and HR: find people in scope by a sentence (text) or structured conditions.',
    inputSchema: obj({ text: { type: 'string' } }),
  },
};

export const agentMcpRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const container = app.container;
    const services = () => container.resolve(talentReviewServicesToken);

    async function runTool(tool: ToolLike, userId: string, args: Record<string, unknown>) {
      const deps = Object.fromEntries(
        Object.entries(tool.dependencies ?? {}).map(([name, token]) => [
          name,
          container.resolve(token),
        ]),
      );
      return (await tool.invoke(
        { actor: { id: userId }, deps } as never,
        args as never,
        {} as never,
      )) as { status: string; content: unknown };
    }

    const invoke = async (name: string, userId: string, args: Record<string, unknown>) => {
      switch (name as AgentToolName) {
        case 'askKnowledge':
          return runTool(searchKnowledge, userId, { query: typeof args.question === 'string' ? args.question : '' });
        case 'getMyLearning': {
          const result = await runTool(getEmployeeLearningProfile, userId, {});
          const content = result.content as Record<string, unknown>;
          return { status: result.status, content:
              result.status === 'success'
                ? {
                    openTasks: content.openTasks,
                    completedTasks: content.completedTasks,
                    requirements: content.requirements,
                  }
                : content };
        }
        case 'getMyCertificates': {
          const result = await runTool(getEmployeeLearningProfile, userId, {});
          const content = result.content as Record<string, unknown>;
          return { status: result.status, content: result.status === 'success' ? { certificates: content.certificates } : content };
        }
        case 'getMySchedule':
          return runTool(getMySchedule, userId, args);
        case 'getMyLeaveBalance':
          return runTool(getMyLeaveBalance, userId, {});
        case 'draftMyLeaveRequest':
          return runTool(draftLeaveRequest, userId, args);
        case 'getTeamCertificationSummary':
          return runTool(teamCertificationSummary, userId, args);
        case 'getTeamLearningProgress': {
          const result = await runTool(getTeamOverview, userId, args);
          const content = result.content as Record<string, unknown>;
          return { status: result.status, content: result.status === 'success' ? { learning: content.learning, people: content.people } : content };
        }
        case 'listMyPendingDecisions': {
          const authz = await scopeForUser(container.resolve(authorizationToken), userId);
          const counts = await container
            .resolve(profileServicesToken)
            .decisions.counts({ userId, authz });
          return {
            status: 'success',
            content: { counts, link: '/talent/decisions', note: '确认、审批须在 NocoHR 中完成。' },
          };
        }
        case 'searchEmployees':
          return runTool(searchEmployees, userId, args);
      }
      return { status: 'error', content: { code: 'TOOL_NOT_ALLOWED' } };
    };

    const r = new Hono();
    r.use('/talent/agent/mcp', bodyLimit({ maxSize: 262_144 }));
    r.post('/talent/agent/mcp', async (c) => {
      const header = c.req.header('authorization') ?? '';
      const secret = /^Bearer\s+(\S+)$/iu.exec(header)?.[1];
      const auth = await services().agents.authenticate(secret);
      if ('error' in auth && auth.error) {
        await services().agents.log({
          clientId: auth.token?.clientId ?? null,
          tokenId: auth.token?.id ?? null,
          userId: auth.token?.userId ?? null,
          tool: 'mcp',
          status: auth.error,
          summary: auth.error === 'rateLimited' ? '超过每分钟调用上限' : '令牌无效、过期或已撤销',
        });
        return c.json(
          { jsonrpc: '2.0', id: null, error: { code: auth.error === 'rateLimited' ? -32029 : -32001, message: auth.error } },
          auth.error === 'rateLimited' ? 429 : 401,
        );
      }
      let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
      }
      const id = body.id ?? null;
      const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id, result });
      // A notification (no id) is acknowledged without a body.
      if (body.id === undefined) return c.body(null, 202);
      const authenticated = auth;
      switch (body.method) {
        case 'initialize':
          return reply({
            protocolVersion: PROTOCOL,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'nocohr', version: '1.0.0' },
            instructions:
              'NocoHR tools act as the signed-in employee with their own permissions. Drafts must be submitted in NocoHR; confirmations and approvals happen only in NocoHR.',
          });
        case 'ping':
          return reply({});
        case 'tools/list': {
          const names = await services().agents.toolsFor(
            authenticated.actor,
            authenticated.client.allowedTools,
          );
          return reply({
            tools: names.map((name) => ({ name, ...DESCRIPTIONS[name] })),
          });
        }
        case 'tools/call': {
          const name = typeof body.params?.name === 'string' ? body.params.name : '';
          const args =
            body.params?.arguments && typeof body.params.arguments === 'object'
              ? (body.params.arguments as Record<string, unknown>)
              : {};
          const outcome = await services().agents.call(authenticated, name, args, invoke);
          return reply({
            content: [{ type: 'text', text: JSON.stringify(outcome.content) }],
            structuredContent:
              outcome.content && typeof outcome.content === 'object' && !Array.isArray(outcome.content)
                ? outcome.content
                : { value: outcome.content },
            isError: !outcome.ok,
          });
        }
        default:
          return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      }
    });
    return r;
  });

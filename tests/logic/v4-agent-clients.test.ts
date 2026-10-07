// @vitest-environment node

// Acceptance checks for V4 step 13C (开放给外部 AI Agent): personal access tokens (at most 90 days, the secret once,
// revocable), the MCP endpoint (initialize, tools/list per audience, tools/call as the user through the AI employees'
// own tools), refusals (another person's data, manager tools for employees, no pay / performance / talent-review tool,
// no confirmation tool), the draft leave request, the audit log per client and the per-minute limit.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { shift, startHarness, today, type Harness } from './talent-review-harness.ts';

let h: Harness;
const CLIENT = 'ac-demo-claude';

beforeAll(async () => {
  h = await startHarness('v4-agent-clients');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

let rpcId = 0;
async function mcp(secret: string, method: string, params?: Record<string, unknown>) {
  rpcId += 1;
  const response = await h.server.fetch(
    new Request(`${h.base}/api/talent/agent/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: rpcId, method, params }),
    }),
  );
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : {} };
}
async function tool(secret: string, name: string, args: Record<string, unknown> = {}) {
  const result = await mcp(secret, 'tools/call', { name, arguments: args });
  return {
    status: result.status,
    isError: result.json.result?.isError as boolean,
    content: result.json.result?.structuredContent,
    text: String(result.json.result?.content?.[0]?.text ?? ''),
  };
}
async function issue(username: string, days = 30): Promise<{ id: string; secret: string }> {
  const issued = await h.call(username, 'POST', '/agent-clients/tokens', { clientId: CLIENT, days });
  expect(issued.status).toBe(201);
  return issued.json.data;
}

describe('13C 开放给外部 AI Agent', () => {
  let wang = { id: '', secret: '' };
  let chen = { id: '', secret: '' };

  it('tokens are for oneself, at most 90 days, the secret shown once', async () => {
    expect((await h.call('emp_njl_1', 'POST', '/agent-clients/tokens', { clientId: CLIENT, days: 120 })).status).toBe(400);
    wang = await issue('emp_njl_1');
    expect(wang.secret).toMatch(/^nhr_/u);
    const mine = await h.call('emp_njl_1', 'GET', '/agent-clients/mine');
    expect(mine.json.data.tokens).toHaveLength(1);
    expect(JSON.stringify(mine.json.data)).not.toContain(wang.secret);
    const row = await (await h.db()).query().selectFrom('agentTokens').selectAll().where('id', '=', wang.id).executeTakeFirst();
    expect(String(row!.tokenHash)).not.toContain(wang.secret);
    // Nothing else accepts the token.
    const other = await h.server.fetch(
      new Request(`${h.base}/api/talent/work-items`, { headers: { authorization: `Bearer ${wang.secret}` } }),
    );
    expect(other.status).toBe(401);
    // An unknown application API path is a JSON 404, not the client's index.html.
    const unknown = await h.server.fetch(
      new Request(`${h.base}/api/talent/no-such-route`, { headers: { authorization: `Bearer ${wang.secret}` } }),
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).code).toBe('NOT_FOUND');
    expect((await h.call('emp_njl_1', 'GET', '/agent-clients/clients')).status).toBe(403);
  });

  it('王磊 asks for his required courses and his shifts; 李敏’s certificates are refused', async () => {
    const init = await mcp(wang.secret, 'initialize', { protocolVersion: '2025-06-18', capabilities: {} });
    expect(init.json.result.serverInfo.name).toBe('nocohr');
    const list = await mcp(wang.secret, 'tools/list');
    const names = list.json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['askKnowledge', 'getMyLearning', 'getMySchedule', 'draftMyLeaveRequest']),
    );
    expect(names).not.toContain('searchEmployees');
    expect(names).not.toContain('getTeamCertificationSummary');
    expect(names.join(',')).not.toMatch(/pay|salary|review|placement|succession|candidate|confirm|approve/iu);
    const learning = await tool(wang.secret, 'getMyLearning');
    expect(learning.isError).toBe(false);
    expect(Array.isArray(learning.content.openTasks)).toBe(true);
    const schedule = await tool(wang.secret, 'getMySchedule', { from: today(), to: shift(today(), 13) });
    expect(schedule.isError).toBe(false);
    const people = await tool(wang.secret, 'searchEmployees', { text: '李敏的证书什么时候到期' });
    expect(people.isError).toBe(true);
    expect(people.text).not.toContain('李敏');
    const certificates = await tool(wang.secret, 'getMyCertificates');
    expect(certificates.text).not.toContain('李敏');
  });

  it('陈静 sees only 机加工车间’s certificates and has no tool to confirm a learning plan', async () => {
    chen = await issue('mgr_njl');
    const names = (await mcp(chen.secret, 'tools/list')).json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('getTeamCertificationSummary');
    expect(names).toContain('listMyPendingDecisions');
    const summary = await tool(chen.secret, 'getTeamCertificationSummary');
    expect(summary.isError).toBe(false);
    expect(summary.text).not.toMatch(/赵阳|吴敏|成都/u);
    const pending = await tool(chen.secret, 'listMyPendingDecisions');
    expect(pending.content.link).toBe('/talent/decisions');
    const refused = await tool(chen.secret, 'confirmLearningPlan', { id: 'x' });
    expect(refused.isError).toBe(true);
  });

  it('“帮我请下周五的年假” leaves a draft leave request for 王磊 to submit in NocoHR', async () => {
    const friday = (() => {
      const d = new Date(`${today()}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7) + 7);
      return d.toISOString().slice(0, 10);
    })();
    // Arguments the tool's own schema refuses never reach it: nothing is drafted.
    const leaves = async () =>
      (
        await (await h.db())
          .query()
          .selectFrom('leaveRequests')
          .select(['id'])
          .where('employeeId', '=', 'emp-wanglei')
          .execute()
      ).length;
    const before = await leaves();
    const invalid = await tool(wang.secret, 'draftMyLeaveRequest', {
      leaveType: 'annual',
      startAt: 20261009,
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content.code).toBe('INVALID_ARGUMENTS');
    expect(await leaves()).toBe(before);
    expect(
      (await tool(wang.secret, 'getMySchedule', { from: 'next friday', to: today() })).content.code,
    ).toBe('INVALID_ARGUMENTS');
    const drafted = await tool(wang.secret, 'draftMyLeaveRequest', {
      leaveType: 'annual',
      startAt: `${friday}T00:00:00+08:00`,
      endAt: `${shift(friday, 1)}T00:00:00+08:00`,
      reason: '家中有事',
    });
    expect(drafted.isError).toBe(false);
    const row = await (await h.db())
      .query()
      .selectFrom('leaveRequests')
      .select(['status', 'employeeId'])
      .where('id', '=', String(drafted.content.id))
      .executeTakeFirst();
    expect(row).toMatchObject({ status: 'draft', employeeId: 'emp-wanglei' });
  });

  it('hr01 sees every call per client; a revoked token stops at once; the per-minute limit refuses', async () => {
    const logs = await h.call('hr01', 'GET', `/agent-clients/logs?clientId=${CLIENT}`);
    // The settings page first lists every client's calls, with no filter at all.
    const everything = await h.call('hr01', 'GET', '/agent-clients/logs');
    expect(everything.status).toBe(200);
    expect(Array.isArray(everything.json.data)).toBe(true);
    expect(logs.status).toBe(200);
    const tools = logs.json.data.map((l: { tool: string }) => l.tool);
    expect(tools).toEqual(expect.arrayContaining(['getMyLearning', 'searchEmployees', 'draftMyLeaveRequest']));
    expect(logs.json.data.find((l: { tool: string }) => l.tool === 'searchEmployees').status).toBe('denied');
    expect((await h.call('emp_njl_1', 'POST', `/agent-clients/tokens/${wang.id}/revoke`)).status).toBe(200);
    expect((await mcp(wang.secret, 'tools/list')).status).toBe(401);
    // hr01 limits the calls to 3 a minute.
    expect((await h.call('hr01', 'PUT', '/talent-reviews/settings/agent', { agentRateLimitPerMinute: 3 })).status).toBe(200);
    const fresh = await issue('emp_njl_1');
    for (let i = 0; i < 3; i += 1) expect((await tool(fresh.secret, 'getMyLeaveBalance')).status).toBe(200);
    expect((await tool(fresh.secret, 'getMyLeaveBalance')).status).toBe(429);
    const limited = await h.call('hr01', 'GET', `/agent-clients/logs?clientId=${CLIENT}`);
    expect(limited.json.data.some((l: { status: string }) => l.status === 'rateLimited')).toBe(true);
    // Parallel requests cannot all slip under the limit, and every request counts, not only tools/call.
    const parallel = await issue('emp_njl_1');
    const statuses = (
      await Promise.all(Array.from({ length: 8 }, () => mcp(parallel.secret, 'tools/list')))
    ).map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);
  });

  it('writes refusals of unknown tokens to the audit log at most ten a minute per address', async () => {
    const anonymous = async () =>
      (
        await (await h.db())
          .query()
          .selectFrom('agentCallLogs')
          .select(['id'])
          .where('tokenId', 'is', null)
          .execute()
      ).length;
    const before = await anonymous();
    const peer = { incoming: { socket: { remoteAddress: '192.0.2.44' } } };
    for (let i = 0; i < 25; i += 1) {
      const response = await h.server.fetch(
        new Request(`${h.base}/api/talent/agent/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer nhr_forged_${i}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/list' }),
        }),
        peer,
      );
      expect(response.status).toBe(401);
    }
    expect((await anonymous()) - before).toBe(10);
  });
});

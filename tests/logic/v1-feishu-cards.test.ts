// @vitest-environment node

// Acceptance checks for V1-04 飞书卡片 and per-user push (总纲 AI 员工约定第 10 条): an approval card reaches the
// bound approver when a level becomes pending, a signed press by the current approver decides it (recorded as
// 经飞书卡片), a second press reports it handled, a non-approver or another user changes nothing, a forged or
// unsigned callback does nothing, a 本人提交 card creates a pending request, and 通知设置 turns the push off. Each run
// boots the real standalone server on a throwaway SQLite database with migrations and seeds.
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// The database task runner imports seed files through Node itself, outside Vite. Node strips their types but does
// not map a relative `.js` specifier to its `.ts` source the way `pnpm dev` and the compiled build do, so the seeds'
// imports of `database/seed-data/*` would not resolve here. Map only application sources, only after a miss.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      const parent = (context.parentURL ?? '').replace(/[?#].*$/u, '');
      if (
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        parent.endsWith('.ts') &&
        !parent.includes('/node_modules/')
      ) {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// Test-only values for the demo seed and the callback signature; never real credentials.
const PASSWORD = 'v1-feishu-cards-test-password';
const SECRET = 'test-im-card-secret';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

async function signIn(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached) return cached;
  const response = await server.fetch(
    new Request(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status, `sign in ${username}`).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  cookies.set(username, cookie);
  return cookie;
}

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = {};
  if (username) headers.cookie = await signIn(username);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent${url}`}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-cards-'));
  const config = path.join(directory, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      auth: { secret: 'test-auth-secret-at-least-32-characters' },
      database: {
        default: 'main',
        connections: {
          main: {
            dialect: 'sqlite',
            filename: path.join(directory, 'database.sqlite'),
          },
        },
        migrations: { autoRun: true },
        seeds: { autoRun: true },
      },
      hub: { host: { enabled: false } },
    }),
  );
  process.env.HR_DEMO_PASSWORD = PASSWORD;
  process.env.IM_CALLBACK_SECRET = SECRET;
  const root = path.resolve(import.meta.dirname, '../..');
  server = await createStandaloneServer({
    viteDevUrl: false,
    env: {
      DB_DIALECT: 'sqlite',
      DB_MIGRATIONS_AUTO_RUN: 'true',
      DB_SEEDS_AUTO_RUN: 'true',
      APP_PUBLIC_ORIGIN: 'http://localhost',
      APP_CONFIG_FILE: config,
    },
    paths: {
      rootDir: root,
      serverDir: path.join(root, 'server'),
      databaseDir: path.join(root, 'database'),
      clientDir: path.join(root, 'dist/client'),
      storageDir: path.join(directory, 'storage'),
    },
  });
  base = `http://localhost${server.application.publicBasePath}`;
  // The V1-03 binding, as a Feishu directory sync leaves it.
  const database = await db();
  for (const [username, externalUserId] of Object.entries(BOUND)) {
    const userId = await userIdOf(username);
    await database
      .query()
      .updateTable('employees')
      .set({ externalProvider: 'feishu', externalUserId })
      .where('userId', '=', userId)
      .execute();
  }
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.IM_CALLBACK_SECRET;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const BOUND = {
  hr01: 'fs-u-hr01',
  mgr_east: 'fs-u-mgr-east',
  mgr_njl: 'fs-u-mgr-njl',
  emp_njl_1: 'fs-u-wanglei',
} as const;

const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function channel() {
  const { imChannelToken } =
    await import('../../server/providers/hr/tokens.ts');
  return server.application.container.resolve(imChannelToken);
}

let presses = 0;
/** A card button press as the office suite would post it, signed with `secret` (none: no signature header). */
async function press(
  body: {
    operatorId: string;
    cardId: string;
    button: string;
    comment?: string;
  },
  secret: string | null = SECRET,
): Promise<{ status: number; json: Json }> {
  const raw = JSON.stringify({ callbackId: `cb-${++presses}`, ...body });
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    origin: 'http://localhost',
  };
  if (secret)
    headers['x-nocohr-signature'] = createHmac('sha256', secret)
      .update(raw)
      .digest('hex');
  const response = await server.fetch(
    new Request(`${base}/api/im-callback/feishu/card`, {
      method: 'POST',
      headers,
      body: raw,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

/** What the mock channel holds for one member, as 模拟渠道 shows it. */
async function outbox(senderId: string) {
  const result = await call(
    'hr01',
    'GET',
    `/ai-entry/dev/im-mock/outbox?senderId=${senderId}`,
  );
  expect(result.status).toBe(200);
  return result.json.data as {
    messages: { text: string }[];
    cards: { id: string; kind: string; view: Json }[];
  };
}

const SENSITIVE = /1\d{10}|\d{17}[\dXx]/u;

describe('审批卡片', () => {
  let actionId = '';
  let cardId = '';

  it('sends the pending level to the bound approver as a card with a summary only', async () => {
    const raised = await call('hr01', 'POST', '/actions', {
      actionType: 'transfer',
      employeeId: 'emp-limin',
      toDepartmentId: 'sz-as',
      toPositionId: 'pos-assembler',
      effectiveDate: today(),
      reason: '调入装配车间',
    });
    expect(raised.status).toBe(201);
    actionId = raised.json.data.id;
    const card = (await outbox(BOUND.mgr_east)).cards.find(
      (c) => c.kind === 'personnelActionApproval',
    );
    expect(card).toBeTruthy();
    cardId = card!.id;
    expect(card!.view.state).toBe('open');
    expect(card!.view.lines[0]).toBe('李敏 · 调岗 · 机加工车间 → 装配车间');
    expect(JSON.stringify(card!.view)).not.toMatch(SENSITIVE);
    expect(card!.view.buttons.map((b: Json) => b.key)).toEqual([
      'approve',
      'reject',
    ]);
    expect(card!.view.link.path).toBe(`/talent/actions/${actionId}`);
    // The approver's to-do records the push.
    const item = await (
      await db()
    )
      .query()
      .selectFrom('workItems')
      .select(['pushedAt', 'pushError'])
      .where('recipientUserId', '=', await userIdOf('mgr_east'))
      .where('refId', '=', actionId)
      .executeTakeFirst();
    expect(item?.pushedAt).toBeTruthy();
    expect(item?.pushError).toBeNull();
  });

  it('drops forged, unsigned and unidentified presses without touching the action', async () => {
    const forged = await press(
      { operatorId: BOUND.mgr_east, cardId, button: 'approve' },
      'wrong-secret',
    );
    expect(forged.status).toBe(403);
    const unsigned = await press(
      { operatorId: BOUND.mgr_east, cardId, button: 'approve' },
      null,
    );
    expect(unsigned.status).toBe(403);
    // 唐宁 exists only in Feishu.
    const stranger = await press({
      operatorId: 'fs-u-tangning',
      cardId,
      button: 'approve',
    });
    expect(stranger.json.data).toMatchObject({
      ok: false,
      code: 'unidentified',
    });
    // Someone else pressing the approver's card.
    const other = await press({
      operatorId: BOUND.mgr_njl,
      cardId,
      button: 'approve',
    });
    expect(other.json.data).toMatchObject({ ok: false, code: 'notRecipient' });
    const action = await call('hr01', 'GET', `/actions/${actionId}`);
    expect(action.json.data.approvals[0].status).toBe('pending');
  });

  it('asks for a comment before rejecting', async () => {
    const result = await press({
      operatorId: BOUND.mgr_east,
      cardId,
      button: 'reject',
    });
    expect(result.json.data).toMatchObject({ ok: false, code: 'kept' });
    expect(result.json.data.card.state).toBe('open');
  });

  it('approves on a signed press by the current approver, recorded as 经飞书卡片', async () => {
    const result = await press({
      operatorId: BOUND.mgr_east,
      cardId,
      button: 'approve',
    });
    expect(result.status).toBe(200);
    expect(result.json.data).toMatchObject({ ok: true, code: 'done' });
    expect(result.json.data.card.state).toBe('handled');
    expect(result.json.data.card.buttons).toEqual([]);
    const action = await call('hr01', 'GET', `/actions/${actionId}`);
    const first = action.json.data.approvals[0];
    expect(first).toMatchObject({ status: 'approved', via: 'feishuCard' });
    expect(first.decidedBy).toBe(await userIdOf('mgr_east'));
    // The approval to-do closed with the decision, as it does on the page.
    const item = await (
      await db()
    )
      .query()
      .selectFrom('workItems')
      .select(['status'])
      .where('recipientUserId', '=', await userIdOf('mgr_east'))
      .where('refId', '=', actionId)
      .executeTakeFirst();
    expect(item?.status).toBe('done');
  });

  it('answers a second press with 已处理 and runs nothing', async () => {
    const again = await press({
      operatorId: BOUND.mgr_east,
      cardId,
      button: 'approve',
    });
    expect(again.json.data).toMatchObject({
      ok: false,
      code: 'alreadyHandled',
    });
    expect(again.json.data.message).toContain('已处理');
    expect(again.json.data.card.stateText).toContain('已处理');
  });

  it('refuses a card press by someone who is not the current approver', async () => {
    // 王磊's seeded transfer waits for 周宏; a card reaching 车间主任 anyway does not let him decide it.
    const cards = (await channel()).cards;
    const sent = await cards.send({
      kind: 'personnelActionApproval',
      recipientUserId: await userIdOf('mgr_njl'),
      refType: 'personnelAction',
      refId: 'action-wanglei-transfer',
      dedupeKey: 'test:mgr-njl:wanglei',
      payload: { actionId: 'action-wanglei-transfer', level: 1 },
    });
    expect(sent.status).toBe('sent');
    const result = await press({
      operatorId: BOUND.mgr_njl,
      cardId: (sent as { cardId: string }).cardId,
      button: 'approve',
    });
    expect(result.json.data).toMatchObject({ ok: false, code: 'refused' });
    expect(result.json.data.message).toContain('无权审批');
    const action = await call(
      'hr01',
      'GET',
      '/actions/action-wanglei-transfer',
    );
    expect(action.json.data.approvals[0].status).toBe('pending');
  });
});

describe('本人提交卡片', () => {
  it('creates a pending request from a signed 提交 by the employee, masked on the card', async () => {
    const wanglei = await userIdOf('emp_njl_1');
    // HR first handles anything 王磊 already has pending.
    const open = await call('hr01', 'GET', '/profile-changes?status=pending');
    for (const request of open.json.data as Json[])
      if (request.employeeId === 'emp-wanglei')
        await call('hr01', 'POST', `/profile-changes/${request.id}/reject`, {
          comment: '重新提交',
        });
    const sent = await (
      await channel()
    ).draftProfileChange(wanglei, {
      address: '苏州市工业园区星湖街 88 号 3 栋',
    });
    expect(sent.status).toBe('sent');
    const cardId = (sent as { cardId: string }).cardId;
    const card = (await outbox(BOUND.emp_njl_1)).cards.find(
      (c) => c.id === cardId,
    )!;
    expect(card.view.title).toBe('信息修改申请');
    expect(card.view.lines[0]).toContain('住址');
    expect(JSON.stringify(card.view)).not.toContain('星湖街');
    expect(card.view.buttons.map((b: Json) => b.key)).toEqual([
      'submit',
      'discard',
    ]);
    // Someone else's identity on 王磊's card is dropped.
    const forged = await press({
      operatorId: BOUND.mgr_njl,
      cardId,
      button: 'submit',
    });
    expect(forged.json.data.code).toBe('notRecipient');
    const result = await press({
      operatorId: BOUND.emp_njl_1,
      cardId,
      button: 'submit',
    });
    expect(result.json.data).toMatchObject({ ok: true, code: 'done' });
    const pending = await call(
      'hr01',
      'GET',
      '/profile-changes?status=pending',
    );
    const request = (pending.json.data as Json[]).find(
      (r) => r.employeeId === 'emp-wanglei',
    );
    expect(request).toMatchObject({ source: 'feishuCard', status: 'pending' });
    expect(request?.changes.address).toBe('苏州市工业园区星湖街 88 号 3 栋');
    // The drafted values are cleared from the handled card.
    const stored = await (
      await db()
    )
      .query()
      .selectFrom('imCards')
      .select(['payload', 'status'])
      .where('id', '=', cardId)
      .executeTakeFirst();
    expect(stored?.status).toBe('handled');
    expect(JSON.stringify(stored?.payload)).not.toContain('星湖街');
    const again = await press({
      operatorId: BOUND.emp_njl_1,
      cardId,
      button: 'submit',
    });
    expect(again.json.data.code).toBe('alreadyHandled');
  });

  it('turns the HR assistant pausing on submitMyProfileChange in a bot conversation into the card', async () => {
    const { createImChannel } =
      await import('../../server/providers/hr/im-channel.ts');
    const { AIUnavailableError } =
      await import('../../server/providers/hr/ai-runner.ts');
    const tokens = await import('../../server/providers/hr/tokens.ts');
    const container = server.application.container;
    const turns: { employee: string; text: string }[] = [];
    // No model in tests: routing falls back to keywords, and the turn pauses the way the plugin reports it.
    const ai = {
      structured: () => Promise.reject(new AIUnavailableError('test')),
      reply: async (input: { employee: string; text: string }) => {
        turns.push(input);
        return {
          text: '',
          sessionId: 'test-session',
          paused: true,
          pending: [
            {
              name: 'submitMyProfileChange',
              args: { changes: { address: '苏州市吴中区东吴北路 1 号' } },
            },
          ],
        };
      },
    };
    const bot = createImChannel({
      platform: container.resolve(tokens.platformToken),
      entry: () => container.resolve(tokens.aiEntryServiceToken),
      ai: ai as never,
      core: () => container.resolve(tokens.hrCoreServiceToken),
      publicUrl: (p) => p,
      translate: async () => (await channel()).cards.translate(),
      warn: () => undefined,
      production: false,
    });
    const answer = await bot.handle({
      provider: 'feishu',
      messageId: 'bot-move-1',
      chatType: 'p2p',
      senderExternalId: BOUND.emp_njl_1,
      text: '我搬家了，住址改成苏州市吴中区东吴北路 1 号',
    });
    expect(answer.handledBy).toBe('hrAssistant');
    expect(turns[0]?.text).toContain('submitMyProfileChange');
    expect(answer.cards).toHaveLength(1);
    expect(answer.reply).not.toContain('东吴北路');
    const view = await bot.cards.view(answer.cards![0]!);
    expect(view?.title).toBe('信息修改申请');
    expect(view?.buttons.map((b) => b.key)).toEqual(['submit', 'discard']);
  });

  it('answers pay questions in the bot with a payslip link only (V2-06)', async () => {
    const { createImChannel } =
      await import('../../server/providers/hr/im-channel.ts');
    const { AIUnavailableError } =
      await import('../../server/providers/hr/ai-runner.ts');
    const tokens = await import('../../server/providers/hr/tokens.ts');
    const container = server.application.container;
    const turns: unknown[] = [];
    const bot = createImChannel({
      platform: container.resolve(tokens.platformToken),
      entry: () => container.resolve(tokens.aiEntryServiceToken),
      ai: {
        structured: () => Promise.reject(new AIUnavailableError('test')),
        reply: (input: unknown) => {
          turns.push(input);
          return Promise.resolve({
            text: '',
            sessionId: 's',
            paused: false,
            pending: [],
          });
        },
      } as never,
      core: () => container.resolve(tokens.hrCoreServiceToken),
      publicUrl: (p) => p,
      translate: async () => (await channel()).cards.translate(),
      warn: () => undefined,
      production: false,
    });
    const answer = await bot.handle({
      provider: 'feishu',
      messageId: 'bot-pay-1',
      chatType: 'p2p',
      senderExternalId: BOUND.emp_njl_1,
      text: '这个月工资发了多少',
    });
    expect(answer.reply).toContain('/talent/my-payslips');
    expect(answer.reply).not.toMatch(/\d+\s*元/u);
    // The model is never asked.
    expect(turns).toEqual([]);
  });

  it('refuses to draft a card for a field the employee cannot change', async () => {
    await expect(
      (await channel()).draftProfileChange(await userIdOf('emp_njl_1'), {
        idNumber: '320500199001010011',
      }),
    ).rejects.toMatchObject({ code: 'PROFILE_CHANGE_FIELD_NOT_ALLOWED' });
  });
});

describe('通知推送与通知设置', () => {
  it('pushes title, summary and link to the bound user until they turn Feishu off', async () => {
    const hr01 = await userIdOf('hr01');
    const settings = await call('hr01', 'GET', '/notification-channels');
    expect(settings.status).toBe(200);
    expect(settings.json.data).toMatchObject({
      inbox: true,
      channels: [{ provider: 'feishu', bound: true, enabled: true }],
    });
    const push = (await channel()).push;
    await push.push({
      key: 'test:push:on',
      message: 'automationGapReport',
      userIds: [hr01],
      title: '知识缺口周报',
      summary: '本周 2 个主题',
      path: '/talent/knowledge?tab=gaps',
    });
    const texts = (await outbox(BOUND.hr01)).messages.map((m) => m.text);
    const pushed = texts.find((text) => text.startsWith('知识缺口周报'));
    expect(pushed).toContain('本周 2 个主题');
    expect(pushed).toContain('/talent/knowledge?tab=gaps');
    // Once per key.
    await push.push({
      key: 'test:push:on',
      message: 'automationGapReport',
      userIds: [hr01],
      title: '知识缺口周报',
      summary: '本周 2 个主题',
    });
    expect(
      (await outbox(BOUND.hr01)).messages.filter((m) =>
        m.text.startsWith('知识缺口周报'),
      ),
    ).toHaveLength(1);

    const off = await call('hr01', 'PUT', '/notification-channels', {
      channels: { feishu: false },
    });
    expect(off.json.data.channels[0].enabled).toBe(false);
    await push.push({
      key: 'test:push:off',
      message: 'documentConflictFound',
      userIds: [hr01],
      title: '发现文档冲突',
      summary: null,
    });
    expect(
      (await outbox(BOUND.hr01)).messages.some((m) =>
        m.text.startsWith('发现文档冲突'),
      ),
    ).toBe(false);
    expect(
      (
        await call('hr01', 'PUT', '/notification-channels', {
          channels: { feishu: true, sms: true },
        })
      ).status,
    ).toBe(400);
  });

  it('keeps the settings to the signed-in user', async () => {
    expect((await call(null, 'GET', '/notification-channels')).status).toBe(
      401,
    );
    const unbound = await call('emp_njl_2', 'GET', '/notification-channels');
    expect(unbound.json.data.channels[0]).toMatchObject({
      provider: 'feishu',
      bound: false,
    });
  });
});

describe('自助卡片配置', () => {
  it('lets the entry administrators order and hide cards, and everyone read them', async () => {
    const initial = await call('emp_njl_1', 'GET', '/ai-entry/self-service');
    expect(initial.json.data).toEqual({ value: { cards: [] }, revision: 0 });
    const value = {
      cards: [
        { key: 'orgChart', visible: true },
        { key: 'contracts', visible: false },
      ],
    };
    expect(
      (
        await call('emp_njl_1', 'PUT', '/ai-entry/self-service', {
          revision: 0,
          value,
        })
      ).status,
    ).toBe(403);
    const saved = await call('hr01', 'PUT', '/ai-entry/self-service', {
      revision: 0,
      value,
    });
    expect(saved.json.data).toEqual({ value, revision: 1 });
    expect(
      (await call('emp_njl_1', 'GET', '/ai-entry/self-service')).json.data,
    ).toEqual({ value, revision: 1 });
    expect(
      (
        await call('hr01', 'PUT', '/ai-entry/self-service', {
          revision: 0,
          value,
        })
      ).status,
    ).toBe(409);
  });
});

describe('默认路由表', () => {
  it('routes certificate and exam questions to 认证管家 and 考官 for everyone', async () => {
    const routes = (await call('emp_njl_1', 'GET', '/ai-entry/routes')).json
      .data as Json[];
    expect(routes.map((r) => r.key).slice(0, 4)).toEqual([
      'certificates',
      'examResults',
      'myPay',
      'myRecord',
    ]);
    const pay = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '这个月工资条怎么还没发',
    });
    expect(pay.json.data.key).toBe('myPay');
    const cert = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '我的叉车证什么时候复审',
    });
    expect(cert.json.data.employee).toBe('certificationSteward');
    const exam = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '这次考试为什么扣分',
    });
    expect(exam.json.data.employee).toBe('examiner');
    const contract = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '我的合同什么时候到期',
    });
    expect(contract.json.data.key).toBe('myRecord');
  });
});

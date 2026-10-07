// @vitest-environment node

// Acceptance checks for V2-05 (realigned) 考勤与假期 in Feishu (总纲 AI 员工约定第 10 条), against the development mock
// channel with signed callbacks, as tests/logic/v1-feishu-cards.test.ts does:
//
// - 考勤异常追问: after the device import and the 09:00 task, 钱进 is asked once about both missed check-outs, 李敏
//   about 12 minutes late, 孙丽 (no account) goes to mgr_east; a second run asks nothing. 钱进 answers 忘打了 and
//   gets one 本人提交 card with two missed-punch drafts at the shift's 14:00 (drafts do not count towards the
//   limit); submitting on the card puts them to mgr_njl as 审批 cards, and approving there recalculates both days
//   to normal. 李敏 answers 班车晚点了: the exception explanation cites 《考勤与加班管理制度》; approved, the day is
//   已说明 and the monthly late count leaves it out until 允许说明豁免 is turned off. No reply for two days
//   reminds the employee and the head once; the run records never hold the reply.
// - 钱进 asks the bot for a day-5 personal leave: a 本人提交 card that names the early shift it conflicts with;
//   submitted and approved on cards, the cell is blocked and cover is suggested.
// - 顶班邀请: nothing is sent before 发出顶班邀请; then 李敏 accepts on her card, lands in a schedule draft of
//   that shift, mgr_njl is told, the other invitations expire, and publishing checks the draft as usual.
//
// Each run boots the real standalone server on a throwaway SQLite database with migrations and seeds. No model is
// configured, so the bot's HR assistant answers the inquiry replies by its rules.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';
import { signedHeaders } from '../helpers/callback-signature.ts';

// See tests/logic/v1-feishu-cards.test.ts: map a seed's relative `.js` import to its `.ts` source after a miss.
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
const PASSWORD = 'v2-attendance-feishu-test-password';
const SECRET = 'test-im-attendance-secret';

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

const BOUND = {
  hr01: 'fs-u-hr01',
  mgr_east: 'fs-u-mgr-east',
  mgr_njl: 'fs-u-mgr-njl',
  emp_njl_1: 'fs-u-wanglei',
  emp_njl_2: 'fs-u-limin',
  emp_njl_3: 'fs-u-qianjin',
} as const;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-attendance-feishu-'));
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
  // The payroll demo pre-generates and locks last month's summaries; this suite generates them itself.
  process.env.HR_PAYROLL_DEMO = 'false';
  process.env.ATTENDANCE_PUNCH_MOCK_FILE = path.join(
    directory,
    'feishu-punches.json',
  );
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
  delete process.env.HR_PAYROLL_DEMO;
  delete process.env.ATTENDANCE_PUNCH_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const day = (n: number) => addDays(today(), n);
const local = (date: string, time: string) => `${date}T${time}:00+08:00`;

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function tokens() {
  return import('../../server/providers/hr/tokens.ts');
}

async function actorFor(username: string) {
  const { authorizationToken } =
    await import('@nocobase/app-plugin-authorization/server');
  const { scopeForUser } =
    await import('../../server/providers/hr/authorize.ts');
  const userId = await userIdOf(username);
  return {
    userId,
    authz: await scopeForUser(
      server.application.container.resolve(authorizationToken),
      userId,
    ),
  };
}

async function notified(key: string): Promise<boolean> {
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  const notifications = server.application.container.resolve(
    notificationServiceToken,
  );
  return Boolean(await notifications.getByIdempotencyKey(`hr:${key}`));
}

const decode = (value: unknown): any => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v);
  return v;
};

async function recordOf(employeeId: string, date: string) {
  return (await db())
    .query()
    .selectFrom('attendanceRecords')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .where('date', '=', date)
    .executeTakeFirst();
}

async function scheduleOf(employeeId: string, date: string) {
  return (await db())
    .query()
    .selectFrom('shiftSchedules')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .where('date', '=', date)
    .executeTakeFirst();
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 10_000,
) {
  const start = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

let signed = 0;
async function signedPost(url: string, body: Json) {
  const raw = JSON.stringify(body);
  const response = await server.fetch(
    new Request(`${base}${url}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        ...signedHeaders(SECRET, raw),
      },
      body: raw,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

/** A message from a member to the bot, signed as the office suite would post it. */
function say(senderId: string, text: string) {
  return signedPost('/api/im-callback/feishu', {
    messageId: `msg-${++signed}`,
    chatType: 'p2p',
    senderId,
    text,
  });
}

/** A card button press, signed. */
function press(body: {
  operatorId: string;
  cardId: string;
  button: string;
  comment?: string;
}) {
  return signedPost('/api/im-callback/feishu/card', {
    callbackId: `cb-${++signed}`,
    ...body,
  });
}

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

const openCard = async (senderId: string, kind: string) =>
  (await outbox(senderId)).cards.find(
    (c) => c.kind === kind && c.view.state === 'open',
  );

const SENSITIVE = /1\d{10}|\d{17}[\dXx]/u;

async function importDevicePunches() {
  const file = await server.fetch(
    new Request(`${base}/api/talent/attendance/import/demo-file`, {
      headers: { cookie: await signIn('hr01') },
    }),
  );
  expect(file.status).toBe(200);
  const form = new FormData();
  form.set(
    'file',
    new File([new Uint8Array(await file.arrayBuffer())], 'punches.xlsx'),
  );
  form.set('skipInvalid', 'true');
  const response = await server.fetch(
    new Request(`${base}/api/talent/attendance/import`, {
      method: 'POST',
      headers: { cookie: await signIn('hr01'), origin: 'http://localhost' },
      body: form,
    }),
  );
  expect(response.status).toBe(200);
}

describe('考勤异常追问（人事助理）', () => {
  let sunliRecordId = '';

  it('asks 钱进 once about both missed check-outs, 李敏 about 12 minutes late, and tells mgr_east about 孙丽', async () => {
    await importDevicePunches();
    expect((await recordOf('emp-qianjin', day(-2)))?.status).toBe(
      'missingPunch',
    );
    expect(await recordOf('emp-limin', day(-2))).toMatchObject({
      status: 'late',
      lateMinutes: 12,
    });
    // 孙丽 has no account: an assembly day she came late, as the calculation would leave it.
    const stamp = new Date();
    sunliRecordId = 'rec-test-sunli-late';
    await (
      await db()
    )
      .query()
      .insertInto('attendanceRecords')
      .values({
        id: sunliRecordId,
        employeeId: 'emp-sunli',
        date: day(-1),
        shiftId: 'shift-as-day',
        punches: [
          { at: local(day(-1), '08:20'), source: 'device' },
          { at: local(day(-1), '20:02'), source: 'device' },
        ] as never,
        checkIn: new Date(local(day(-1), '08:20')),
        checkOut: new Date(local(day(-1), '20:02')),
        status: 'late',
        lateMinutes: 20,
        earlyMinutes: null,
        workedMinutes: 700,
        overtimeMinutes: null,
        leaveRequestId: null,
        computedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();

    const daily = await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(daily.status).toBe(200);
    expect(daily.json.data.anomalyReminder).toBe('succeeded');

    const qianjin = (await outbox(BOUND.emp_njl_3)).messages;
    expect(qianjin).toHaveLength(1);
    const d2 = Number(day(-2).slice(8));
    const d1 = Number(day(-1).slice(8));
    expect(qianjin[0].text).toContain(`${d2} 日、${d1} 日`);
    expect(qianjin[0].text).toContain('下班都没有打卡记录');
    const limin = (await outbox(BOUND.emp_njl_2)).messages;
    expect(limin).toHaveLength(1);
    expect(limin[0].text).toContain('晚了 12 分钟');
    // About the employee only.
    for (const text of [qianjin[0].text, limin[0].text]) {
      expect(text).not.toMatch(/王磊|孙丽|陈静/u);
      expect(text).not.toMatch(SENSITIVE);
    }
    const both = [
      decode((await recordOf('emp-qianjin', day(-2)))?.inquiry),
      decode((await recordOf('emp-qianjin', day(-1)))?.inquiry),
    ];
    expect(both[0]).toMatchObject({ channel: 'feishu', reply: null });
    expect(both[1].askedAt).toBe(both[0].askedAt);
    // 孙丽: no account, so her head is told instead.
    expect(await notified(`attendanceInquiry:${sunliRecordId}`)).toBe(true);
    const sunli = await (
      await db()
    )
      .query()
      .selectFrom('attendanceRecords')
      .select(['inquiry'])
      .where('id', '=', sunliRecordId)
      .executeTakeFirst();
    expect(decode(sunli?.inquiry)).toMatchObject({ channel: 'head' });

    const again = await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(again.status).toBe(200);
    expect((await outbox(BOUND.emp_njl_3)).messages).toHaveLength(1);
    expect((await outbox(BOUND.emp_njl_2)).messages).toHaveLength(1);
  });

  it('turns 钱进’s 忘打了 into one 本人提交 card with two drafts at 14:00, outside the limit until submitted', async () => {
    const answer = await say(BOUND.emp_njl_3, '忘打了，两天都是正常下班');
    expect(answer.status).toBe(200);
    expect(answer.json.data.cards).toHaveLength(1);
    expect(answer.json.data.reply).toContain('补卡单');
    const card = (await outbox(BOUND.emp_njl_3)).cards.find(
      (c) => c.id === answer.json.data.cards[0],
    )!;
    expect(card.kind).toBe('attendanceDraftSubmit');
    expect(card.view.title).toBe('考勤申请（人事助理起草）');
    const punches = card.view.lines.filter((l: string) => l.startsWith('补卡'));
    expect(punches).toHaveLength(2);
    for (const line of punches) expect(line).toContain('下班 14:00');
    expect(card.view.buttons.map((b: Json) => b.key)).toEqual([
      'submit',
      'discard',
    ]);
    // The reply is kept on the records only.
    const record = decode((await recordOf('emp-qianjin', day(-2)))?.inquiry);
    expect(record.reply).toBe('忘打了，两天都是正常下班');
    expect(record.draftAdjustmentId).toBeTruthy();
    const drafts = await (
      await db()
    )
      .query()
      .selectFrom('attendanceAdjustments')
      .select(['id', 'status', 'source', 'details'])
      .where('employeeId', '=', 'emp-qianjin')
      .where('status', '=', 'draft')
      .execute();
    expect(drafts).toHaveLength(2);
    for (const d of drafts) {
      expect(d.source).toBe('hrAssistant');
      expect(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: TZ,
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date(decode(d.details).at)),
      ).toBe('14:00');
    }
    // Drafts do not count towards the monthly limit.
    const mine = await call(
      'emp_njl_3',
      'GET',
      `/attendance/me?month=${day(-2).slice(0, 7)}`,
    );
    expect(mine.json.data.missingPunchUsed).toBe(0);
    // A draft is the employee's own: mgr_njl cannot open it.
    expect(
      (await call('mgr_njl', 'GET', `/adjustments/${drafts[0].id}`)).status,
    ).toBe(404);
  });

  it('submits on the card, reaches mgr_njl as 审批 cards, and recalculates both days to normal', async () => {
    const card = await openCard(BOUND.emp_njl_3, 'attendanceDraftSubmit');
    const submitted = await press({
      operatorId: BOUND.emp_njl_3,
      cardId: card!.id,
      button: 'submit',
    });
    expect(submitted.json.data).toMatchObject({ ok: true, code: 'done' });
    const rows = await (
      await db()
    )
      .query()
      .selectFrom('attendanceAdjustments')
      .select(['id', 'status', 'approvals'])
      .where('employeeId', '=', 'emp-qianjin')
      .where('type', '=', 'missingPunch')
      .where('status', '=', 'pending')
      .execute();
    expect(rows).toHaveLength(2);
    for (const row of rows)
      expect(decode(row.approvals)[0].submittedVia).toBe('feishuCard');
    const month = day(-2).slice(0, 7);
    const used = (
      await call('emp_njl_3', 'GET', `/attendance/me?month=${month}`)
    ).json.data.missingPunchUsed;
    expect(used).toBe(
      [day(-2), day(-1)].filter((d) => d.slice(0, 7) === month).length,
    );

    const approvals = (await outbox(BOUND.mgr_njl)).cards.filter(
      (c) =>
        c.kind === 'attendanceAdjustmentApproval' && c.view.state === 'open',
    );
    expect(approvals).toHaveLength(2);
    expect(approvals[0].view.lines[0]).toContain('钱进 · 补卡');
    // Rejecting needs a comment.
    const bare = await press({
      operatorId: BOUND.mgr_njl,
      cardId: approvals[0].id,
      button: 'reject',
    });
    expect(bare.json.data).toMatchObject({ ok: false, code: 'kept' });
    for (const approval of approvals) {
      const done = await press({
        operatorId: BOUND.mgr_njl,
        cardId: approval.id,
        button: 'approve',
      });
      expect(done.json.data).toMatchObject({ ok: true, code: 'done' });
    }
    expect((await recordOf('emp-qianjin', day(-2)))?.status).toBe('normal');
    expect((await recordOf('emp-qianjin', day(-1)))?.status).toBe('normal');
    const decided = await (
      await db()
    )
      .query()
      .selectFrom('attendanceAdjustments')
      .select(['status', 'approvals'])
      .where('id', '=', String(rows[0].id))
      .executeTakeFirst();
    expect(decided?.status).toBe('approved');
    expect(decode(decided?.approvals)[0]).toMatchObject({
      status: 'approved',
      via: 'feishuCard',
    });
  });

  it('drafts 李敏’s 班车晚点了 as an exception citing the policy; approved, it is 已说明 and counted only without 允许说明豁免', async () => {
    const answer = await say(BOUND.emp_njl_2, '班车晚点了');
    expect(answer.status).toBe(200);
    expect(answer.json.data.cards).toHaveLength(1);
    expect(answer.json.data.reply).toContain('考勤与加班管理制度');
    expect(answer.json.data.reply).toContain('班车晚点');
    const card = (await outbox(BOUND.emp_njl_2)).cards.find(
      (c) => c.id === answer.json.data.cards[0],
    )!;
    expect(card.view.lines[0]).toContain('考勤异常说明');
    expect(card.view.lines[0]).toContain('迟到 12 分钟');
    expect(
      card.view.lines.some((l: string) => l.includes('考勤与加班管理制度')),
    ).toBe(true);
    const submitted = await press({
      operatorId: BOUND.emp_njl_2,
      cardId: card.id,
      button: 'submit',
    });
    expect(submitted.json.data.ok).toBe(true);
    const approval = await openCard(
      BOUND.mgr_njl,
      'attendanceAdjustmentApproval',
    );
    expect(approval?.view.title).toBe('考勤异常说明审批');
    const approved = await press({
      operatorId: BOUND.mgr_njl,
      cardId: approval!.id,
      button: 'approve',
    });
    expect(approved.json.data.ok).toBe(true);
    const record = await recordOf('emp-limin', day(-2));
    expect(record?.status).toBe('late');
    expect(record?.excusedByAdjustmentId).toBeTruthy();

    // The month's summary leaves the explained day out of the late count…
    const month = day(-2).slice(0, 7);
    const { attendanceServiceToken } = await tokens();
    await server.application.container
      .resolve(attendanceServiceToken)
      .generateSummaries(month);
    const lateCount = async () =>
      (
        await (
          await db()
        )
          .query()
          .selectFrom('attendanceMonthlySummaries')
          .select(['lateCount'])
          .where('employeeId', '=', 'emp-limin')
          .where('month', '=', month)
          .executeTakeFirst()
      )?.lateCount;
    expect(Number(await lateCount())).toBe(0);
    // …until 允许说明豁免 is turned off and the month recalculated.
    const rule = await call(
      'hr01',
      'GET',
      '/attendance-settings/rules/rule-mc',
    );
    const keys = [
      'title',
      'departmentIds',
      'workHourSystem',
      'punchSource',
      'lateGraceMinutes',
      'overtimeRequiresApproval',
      'monthlyOvertimeAlertHours',
      'minRestHours',
      'maxConsecutiveNights',
      'exceptionExcusable',
      'active',
    ];
    expect(rule.json.data.exceptionExcusable).toBe(true);
    const patched = await call(
      'hr01',
      'PATCH',
      '/attendance-settings/rules/rule-mc',
      {
        value: {
          ...Object.fromEntries(
            Object.entries(rule.json.data).filter(([k]) => keys.includes(k)),
          ),
          exceptionExcusable: false,
        },
        expectedUpdatedAt: rule.json.data.updatedAt,
      },
    );
    expect(patched.status).toBe(200);
    const recomputed = await call('hr01', 'POST', '/attendance/recompute', {
      from: day(-2),
      to: day(-2),
      departmentId: 'sz-mc',
    });
    expect(recomputed.status).toBe(200);
    expect(Number(await lateCount())).toBe(1);
    // Still 已说明 on the day itself.
    expect(
      (await recordOf('emp-limin', day(-2)))?.excusedByAdjustmentId,
    ).toBeTruthy();
  });

  it('reminds the employee and the head once after two days without a reply, and lists it for HR', async () => {
    const asked = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const stamp = new Date();
    const id = 'rec-test-wanglei-late';
    // The demo's attendance can already cover that day (it moves with today): this record replaces it.
    await (
      await db()
    )
      .query()
      .deleteFrom('attendanceRecords')
      .where('employeeId', '=', 'emp-wanglei')
      .where('date', '=', day(-6))
      .execute();
    await (
      await db()
    )
      .query()
      .insertInto('attendanceRecords')
      .values({
        id,
        employeeId: 'emp-wanglei',
        date: day(-6),
        shiftId: 'shift-mc-early',
        punches: [
          { at: local(day(-6), '06:25'), source: 'device' },
          { at: local(day(-6), '14:03'), source: 'device' },
        ] as never,
        checkIn: new Date(local(day(-6), '06:25')),
        checkOut: new Date(local(day(-6), '14:03')),
        status: 'late',
        lateMinutes: 25,
        earlyMinutes: null,
        workedMinutes: 428,
        overtimeMinutes: null,
        leaveRequestId: null,
        inquiry: {
          askedAt: asked,
          channel: 'feishu',
          reply: null,
          repliedAt: null,
          draftAdjustmentId: null,
          recordIds: [id],
        } as never,
        computedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(await notified(`attendanceInquiryOverdue:${id}`)).toBe(true);
    const log = async () =>
      (
        await (
          await db()
        )
          .query()
          .selectFrom('hrReminderLog')
          .select(['reminderKey'])
          .execute()
      ).filter((r) =>
        String(r.reminderKey).startsWith('attendanceInquiryOverdue:'),
      ).length;
    const once = await log();
    await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(await log()).toBe(once);
    const issues = await call(
      'hr01',
      'GET',
      `/attendance/issues?month=${day(-6).slice(0, 7)}`,
    );
    const item = issues.json.data.anomalies.find(
      (a: Json) => a.recordId === id,
    );
    expect(item.followUp).toBe('needsHr');
  });

  it('keeps the replies out of the run records', async () => {
    const runs = await (
      await db()
    )
      .query()
      .selectFrom('aiTaskRuns')
      .selectAll()
      .where('task', '=', 'hrAssistant.attendanceAnomaly')
      .execute();
    expect(runs.length).toBeGreaterThan(0);
    const text = JSON.stringify(runs);
    expect(text).not.toContain('忘打了');
    expect(text).not.toContain('班车晚点了');
    expect(text).not.toContain('没有打卡记录');
  });
});

describe('请假冲突与顶班邀请', () => {
  let leaveId = '';
  let scheduleId = '';

  it('turns 钱进’s day-5 leave drafted in the bot into a 本人提交 card naming the conflicting early shift', async () => {
    const { createImChannel } =
      await import('../../server/providers/hr/im-channel.ts');
    const { AIUnavailableError } =
      await import('../../server/providers/hr/ai-runner.ts');
    const { registerAttendanceCards } =
      await import('../../server/providers/hr/attendance-cards.ts');
    const t = await tokens();
    const container = server.application.container;
    const channel = container.resolve(t.imChannelToken);
    const qianjin = await actorFor('emp_njl_3');
    // No model in tests: the turn does what the HR assistant's draftLeaveRequest tool does.
    const ai = {
      structured: () => Promise.reject(new AIUnavailableError('test')),
      reply: async () => {
        const draft = (await container
          .resolve(t.leaveRequestServiceToken)
          .createDraft(qianjin, {
            leaveTypeId: 'leave-personal',
            startAt: local(day(5), '00:00'),
            endAt: local(day(6), '00:00'),
            reason: '家中有事',
            source: 'hrAssistant',
          })) as { id: string };
        leaveId = draft.id;
        return {
          text: '已为你起草第 5 天的事假，当天有早班。',
          sessionId: 'test-session',
          paused: false,
          pending: [],
        };
      },
    };
    const bot = createImChannel({
      platform: container.resolve(t.platformToken),
      entry: () => container.resolve(t.aiEntryServiceToken),
      ai: ai as never,
      core: () => container.resolve(t.hrCoreServiceToken),
      publicUrl: (p) => p,
      translate: () => channel.cards.translate(),
      warn: () => undefined,
      production: false,
    });
    registerAttendanceCards(container, bot);
    const answer = await bot.handle({
      provider: 'feishu',
      messageId: 'bot-leave-1',
      chatType: 'p2p',
      senderExternalId: BOUND.emp_njl_3,
      text: '第 5 天请一天事假',
    });
    expect(answer.handledBy).toBe('hrAssistant');
    expect(answer.cards).toHaveLength(1);
    const view = await channel.cards.view(answer.cards![0]!);
    expect(view?.title).toBe('请假单（人事助理起草）');
    expect(view?.lines.join('\n')).toContain('与已发布排班冲突');
    expect(view?.lines.join('\n')).toContain('机加工早班');
    expect(view?.buttons.map((b) => b.key)).toEqual(['submit', 'discard']);

    const submitted = await press({
      operatorId: BOUND.emp_njl_3,
      cardId: answer.cards![0]!,
      button: 'submit',
    });
    expect(submitted.json.data).toMatchObject({ ok: true, code: 'done' });
    const request = await call(
      'emp_njl_3',
      'GET',
      `/leave/requests/${leaveId}`,
    );
    expect(request.json.data.status).toBe('pending');
    expect(request.json.data.approvals[0].submittedVia).toBe('feishuCard');
  });

  it('approves on mgr_njl’s 审批 card; the early shift is blocked and cover is suggested, not changed', async () => {
    const approval = await openCard(BOUND.mgr_njl, 'leaveApproval');
    expect(approval?.view.lines[0]).toContain('钱进 · 事假');
    expect(JSON.stringify(approval?.view)).not.toMatch(SENSITIVE);
    const done = await press({
      operatorId: BOUND.mgr_njl,
      cardId: approval!.id,
      button: 'approve',
    });
    expect(done.json.data).toMatchObject({ ok: true, code: 'done' });
    const request = await call(
      'emp_njl_3',
      'GET',
      `/leave/requests/${leaveId}`,
    );
    expect(request.json.data.status).toBe('approved');
    expect(request.json.data.approvals[0].via).toBe('feishuCard');
    const cell = await until(
      () => scheduleOf('emp-qianjin', day(5)),
      (row) => Boolean(row?.replacementSuggestion),
    );
    scheduleId = String(cell?.id);
    expect(cell?.shiftId).toBe('shift-mc-early');
    expect(decode(cell?.checkResult)[0]).toMatchObject({
      rule: 'leaveConflict',
      level: 'block',
    });
    // 钱进's own card now shows the request as decided.
    const own = (await outbox(BOUND.emp_njl_3)).cards.find(
      (c) => c.kind === 'leaveDraftSubmit',
    );
    expect(own?.view.state).toBe('handled');
  });

  it('sends nothing before 发出顶班邀请; then 李敏 accepts, lands in a schedule draft and the others expire', async () => {
    expect(
      (await outbox(BOUND.emp_njl_2)).cards.some(
        (c) => c.kind === 'replacementInvite',
      ),
    ).toBe(false);
    const cell = await scheduleOf('emp-qianjin', day(5));
    const suggested = decode(cell?.replacementSuggestion).candidates.map(
      (c: Json) => c.employeeId,
    ) as string[];
    expect(suggested).toContain('emp-limin');
    // Outside the scheduler's reach: 李敏 cannot invite.
    expect(
      (
        await call(
          'emp_njl_2',
          'POST',
          `/schedules/${scheduleId}/invitations`,
          {
            candidateIds: suggested,
          },
        )
      ).status,
    ).toBe(403);
    const invited = await call(
      'mgr_njl',
      'POST',
      `/schedules/${scheduleId}/invitations`,
      { candidateIds: suggested },
    );
    expect(invited.status).toBe(200);
    expect(invited.json.data.results['emp-limin']).toBe('sent');
    const card = await openCard(BOUND.emp_njl_2, 'replacementInvite');
    expect(card?.view.title).toBe('顶班邀请');
    expect(card?.view.lines[0]).toContain('机加工早班');
    expect(card?.view.buttons.map((b: Json) => b.key)).toEqual([
      'accept',
      'decline',
    ]);
    // Pressing again does not invite twice.
    const again = await call(
      'mgr_njl',
      'POST',
      `/schedules/${scheduleId}/invitations`,
      { candidateIds: ['emp-limin'] },
    );
    expect(again.json.data.results['emp-limin']).toBe('duplicate');

    const accepted = await press({
      operatorId: BOUND.emp_njl_2,
      cardId: card!.id,
      button: 'accept',
    });
    expect(accepted.json.data).toMatchObject({ ok: true, code: 'done' });
    expect(accepted.json.data.message).toContain('已接受');
    const mine = await scheduleOf('emp-limin', day(5));
    expect(mine).toMatchObject({
      shiftId: 'shift-mc-early',
      status: 'draft',
    });
    expect(await notified(`replacementAccepted:${scheduleId}`)).toBe(true);
    const invitations = decode(
      (await scheduleOf('emp-qianjin', day(5)))?.replacementSuggestion,
    ).invitations as Json[];
    expect(
      invitations.find((i) => i.employeeId === 'emp-limin')?.response,
    ).toBe('accepted');
    for (const other of invitations.filter((i) => i.employeeId !== 'emp-limin'))
      expect(other.response).toBe('expired');
    const repeat = await press({
      operatorId: BOUND.emp_njl_2,
      cardId: card!.id,
      button: 'accept',
    });
    expect(repeat.json.data.code).toBe('alreadyHandled');
    // Publishing is the scheduler's, with the usual checks (李敏 has enough rest before her day-6 middle shift).
    const published = await call(
      'mgr_njl',
      'POST',
      '/schedules/publish-range',
      {
        departmentId: 'sz-mc',
        from: day(5),
        to: day(5),
      },
    );
    expect(published.status).toBe(200);
    expect(published.json.data.checks[`emp-limin:${day(5)}`] ?? []).toEqual([]);
    expect((await scheduleOf('emp-limin', day(5)))?.status).toBe('published');
  });
});

describe('界面追加字段 on 审批卡片', () => {
  it('shows 工作交接人 on mgr_njl’s leave card, never a sensitive field', async () => {
    const define = async (input: Json) => {
      const created = await call('hr01', 'POST', '/custom-fields', input);
      expect(created.status).toBe(201);
      return created.json.data as { key: string };
    };
    const handover = await define({
      collection: 'leaveRequests',
      label: { 'zh-CN': '工作交接人' },
      type: 'text',
      placements: ['form', 'detail'],
    });
    const diagnosis = await define({
      collection: 'leaveRequests',
      label: { 'zh-CN': '病情说明' },
      type: 'text',
      placements: ['form', 'detail'],
      sensitive: true,
    });
    let date: string | undefined;
    for (let n = 8; n <= 14 && !date; n++)
      if ((await scheduleOf('emp-qianjin', day(n)))?.shiftId) date = day(n);
    expect(date).toBeDefined();
    const draft = await call('emp_njl_3', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-personal',
      startAt: local(date!, '00:00'),
      endAt: local(addDays(date!, 1), '00:00'),
      reason: '搬家',
      customFields: { [handover.key]: '李敏', [diagnosis.key]: '不宜公开' },
    });
    expect(draft.status).toBe(201);
    const submitted = await call(
      'emp_njl_3',
      'POST',
      `/leave/requests/${draft.json.data.id}/submit`,
      { expectedUpdatedAt: draft.json.data.updatedAt },
    );
    expect(submitted.status).toBe(200);
    const card = await until(
      () => openCard(BOUND.mgr_njl, 'leaveApproval'),
      (found) => Boolean(found),
    );
    expect(card?.view.lines).toContain('工作交接人：李敏');
    expect(JSON.stringify(card?.view)).not.toContain('不宜公开');
    expect(JSON.stringify(card?.view)).not.toContain('病情说明');
  });
});

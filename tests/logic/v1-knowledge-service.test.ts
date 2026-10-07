// @vitest-environment node

// Acceptance checks for V1 step 2 (核心人事) as completed on 2026-09-29: the configurable approval chain (levels added
// per department, merging, auto-pass, snapshots, preview), promotions by grade order, 更正任职信息 with manual job
// events, the import switch, self-service fields and the job history scope. Each run boots the real standalone server
// on a throwaway SQLite database with migrations and seeds, so the demo database stays untouched.
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
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'v1-knowledge-test-password';

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
  // Writes pass the same-origin check a browser request would.
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    // Paths under /api/talent are written short; any other /api path is given in full.
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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-knowledge-'));
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
  process.env.IM_CALLBACK_SECRET = 'test-im-secret';
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
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.IM_CALLBACK_SECRET;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}

/** Writes a text file to the drive and its hrFiles row, as uploaded by `uploader` for the knowledge base; answers the file id. */
async function textFile(
  name: string,
  text: string,
  uploader = 'hr01',
): Promise<string> {
  const { driveManagerToken } = await import('@nocobase/app-server/drive');
  const { databaseManagerToken } = await import('@nocobase/db');
  const container = server.application.container;
  const key = `test/${Date.now()}-${name}`;
  await (
    container.resolve(driveManagerToken) as unknown as {
      use(disk: string): { put(key: string, contents: string): Promise<void> };
    }
  )
    .use('local')
    .put(key, text);
  const id = (await import('node:crypto')).randomUUID();
  const now = new Date();
  await container
    .resolve(databaseManagerToken)
    .query()
    .insertInto('hrFiles')
    .values({
      id,
      disk: 'local',
      key,
      filename: name,
      ext: 'md',
      mimeType: 'text/markdown',
      size: text.length,
      createdAt: now,
      updatedAt: now,
      purpose: 'kbDocument',
      uploadedByUserId: await userIdOf(uploader),
    })
    .execute();
  return id;
}

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  ms = 10000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
}

const SCHEDULE_V1 = `# 机加工车间排班须知\n\n演示资料。\n\n## 1. 排班原则\n\n车间按三班倒排班，每周公布。\n\n## 2. 津贴\n\n夜班津贴每班 40 元，随当月工资发放。\n\n## 3. 交接\n\n交接班须填写记录。\n`;
const SCHEDULE_V11 = SCHEDULE_V1.replace(
  '夜班津贴每班 40 元',
  '夜班津贴每班 50 元',
);

describe('document numbers and conflicts', () => {
  let scheduleId: string;

  it('refuses a second current document with the same number', async () => {
    const list = (await call('hr01', 'GET', '/kb/documents')).json.data
      .items as Json[];
    const attendance = list.find((d) => d.docNo === 'HR-POL-0002')!;
    expect(attendance).toBeTruthy();
    const fileId = await textFile('dup.md', '# 重复\n\n内容');
    const dup = await call('hr01', 'POST', '/kb/documents', {
      title: '考勤制度（重复）',
      category: 'policy',
      fileId,
      visibility: 'all',
      docNo: 'HR-POL-0002',
      version: 'V9.9',
    });
    expect(dup.json.code).toBe('DOCUMENT_NO_ACTIVE_EXISTS');
  });

  it('finds the 40-yuan allowance against the 50-yuan policy and tells the owners', async () => {
    const fileId = await textFile(
      'wi-pr-0101-v1.0.md',
      SCHEDULE_V1.replace(
        '夜班津贴每班 40 元，随当月工资发放。',
        '夜班津贴每班 40 元，按当月实际出勤的夜班数计发，随当月工资发放。',
      ),
    );
    const created = await call('hr01', 'POST', '/kb/documents', {
      title: '机加工车间排班须知',
      category: 'sop',
      fileId,
      visibility: 'all',
      docNo: 'WI-PR-0101',
      version: 'V1.0',
      ownerUserId: await userIdOf('mgr_njl'),
    });
    expect(created.status).toBe(201);
    scheduleId = created.json.data.id;
    expect(
      created.json.data.ownerUserId ?? (await userIdOf('mgr_njl')),
    ).toBeTruthy();
    const conflicts = await waitFor(async () => {
      const rows = (await call('hr01', 'GET', '/kb/conflicts')).json
        .data as Json[];
      return rows.some((c) => c.documentId === scheduleId) ? rows : undefined;
    });
    const conflict = conflicts.find((c) => c.documentId === scheduleId)!;
    expect(String(conflict.description)).toContain('40');
    // The owner of the new document sees it; an employee does not.
    expect(
      (
        (await call('mgr_njl', 'GET', '/kb/conflicts')).json.data as Json[]
      ).some((c) => c.id === conflict.id),
    ).toBe(true);
    expect((await call('emp_njl_1', 'GET', '/kb/conflicts')).status).toBe(403);
    // Answers from that section carry both sayings.
  });

  it('closes the conflict when the owner uploads V1.1', async () => {
    const fileId = await textFile(
      'wi-pr-0101-v1.1.md',
      SCHEDULE_V11,
      'mgr_njl',
    );
    const version = await call(
      'mgr_njl',
      'POST',
      `/kb/documents/${scheduleId}/versions`,
      {
        fileId,
        version: 'V1.1',
      },
    );
    expect(version.status).toBe(201);
    await waitFor(async () => {
      const doc = (await call('hr01', 'GET', `/kb/documents/${scheduleId}`))
        .json.data;
      return doc.supersededById ? doc : undefined;
    });
    const all = (await call('hr01', 'GET', '/kb/conflicts?status=all')).json
      .data as Json[];
    const closed = all.filter((c) => c.documentId === scheduleId);
    expect(closed.length).toBeGreaterThan(0);
    expect(closed.every((c) => c.status === 'resolved')).toBe(true);
    const detail = (
      await call('hr01', 'GET', `/kb/documents/${version.json.data.id}`)
    ).json.data;
    expect(
      JSON.stringify(detail.changeSummary ?? detail.changes ?? []),
    ).toContain('津贴');
    expect(
      (
        await call(
          'emp_njl_1',
          'POST',
          `/kb/documents/${version.json.data.id}/versions`,
          { fileId, version: 'V1.2' },
        )
      ).status,
    ).toBe(403);
  });

  it('requires a note to ignore a conflict', async () => {
    const fileId = await textFile(
      'shift-extra.md',
      SCHEDULE_V1.replace('WI', 'X'),
    );
    const created = await call('hr01', 'POST', '/kb/documents', {
      title: '排班补充说明',
      category: 'sop',
      fileId,
      visibility: 'all',
    });
    const conflict = await waitFor(async () => {
      const rows = (await call('hr01', 'GET', '/kb/conflicts')).json
        .data as Json[];
      return rows.find((c) => c.documentId === created.json.data.id);
    });
    expect(
      (await call('hr01', 'POST', `/kb/conflicts/${conflict.id}/ignore`, {}))
        .json.code,
    ).toBe('CONFLICT_NOTE_REQUIRED');
    const ignored = await call(
      'hr01',
      'POST',
      `/kb/conflicts/${conflict.id}/ignore`,
      { note: '补充说明另行废止' },
    );
    expect(ignored.json.data.status).toBe('ignored');
  });

  it('marks a document reviewed with the configured cycle', async () => {
    const list = (await call('hr01', 'GET', '/kb/documents')).json.data
      .items as Json[];
    const manual = list.find((d) => d.docNo === 'MAN-PR-0007')!;
    const reviewed = await call(
      'hr01',
      'POST',
      `/kb/documents/${manual.id}/reviewed`,
      {},
    );
    expect(reviewed.status).toBe(200);
    expect(
      reviewed.json.data.reviewDate > new Date().toISOString().slice(0, 10),
    ).toBe(true);
  });
});

describe('unified AI entry', () => {
  it('routes by keywords without a model, within the user audience', async () => {
    const mine = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '我的合同什么时候到期',
    });
    expect(mine.json.data).toMatchObject({
      key: 'myRecord',
      employee: 'hrAssistant',
    });
    const policy = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '夜班津贴多少',
    });
    expect(policy.json.data).toMatchObject({
      key: 'policy',
      employee: 'knowledgeAssistant',
    });
    // Someone's own balance goes to the HR assistant even though the policy row names 年假; the rule itself
    // stays with the knowledge assistant.
    const balance = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '我今年的年假还剩几天？',
    });
    expect(balance.json.data.key).toBe('myRecord');
    const rule = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '年假是怎么计算的？',
    });
    expect(rule.json.data.key).toBe('policy');
    // 导入体检 is for hr.admin only: an employee falls back to the knowledge assistant.
    const hrOnly = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '导入体检怎么处理',
    });
    expect(hrOnly.json.data.key).not.toBe('hrData');
    const admin = await call('hr01', 'POST', '/ai-entry/route', {
      question: '导入体检怎么处理',
    });
    expect(admin.json.data.key).toBe('hrData');
  });

  it('keeps the routing table to HR administrators and validates it', async () => {
    expect((await call('mgr_njl', 'GET', '/ai-entry')).status).toBe(403);
    const current = (await call('hr01', 'GET', '/ai-entry')).json.data;
    const bad = await call('hr01', 'PATCH', '/ai-entry', {
      revision: current.revision,
      value: {
        ...current.value,
        routes: [
          ...current.value.routes,
          {
            key: 'dorm',
            description: '宿舍与班车',
            employee: 'nobody',
            permissionSets: [],
            enabled: true,
            keywords: ['宿舍'],
          },
        ],
      },
    });
    expect(bad.json.code).toBe('AI_ENTRY_EMPLOYEE_UNKNOWN');
    const good = await call('hr01', 'PATCH', '/ai-entry', {
      revision: current.revision,
      value: {
        ...current.value,
        routes: [
          {
            key: 'dorm',
            description: '宿舍与班车',
            employee: 'knowledgeAssistant',
            permissionSets: [],
            enabled: true,
            keywords: ['宿舍', '班车'],
          },
          ...current.value.routes,
        ],
      },
    });
    expect(good.status).toBe(200);
    expect(
      (
        await call('emp_njl_1', 'POST', '/ai-entry/route', {
          question: '班车几点发车',
        })
      ).json.data.key,
    ).toBe('dorm');
  });
});

describe('office-suite bot adapter', () => {
  const post = (body: Json, secret = 'test-im-secret', at = Date.now()) => {
    const raw = JSON.stringify(body);
    return server.fetch(
      new Request(`${base}/api/im-callback/feishu`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
          ...signedHeaders(secret, raw, at),
        },
        body: raw,
      }),
    );
  };

  it('drops forged callbacks and answers group mentions with 请私聊', async () => {
    expect(
      (
        await post(
          { messageId: 'm1', chatType: 'p2p', senderId: 'x', text: 'hi' },
          'wrong',
        )
      ).status,
    ).toBe(403);
    // Correctly signed but sent ten minutes ago: a replayed capture, refused before it is read.
    expect(
      (
        await post(
          { messageId: 'm1-old', chatType: 'p2p', senderId: 'x', text: 'hi' },
          'test-im-secret',
          Date.now() - 600_000,
        )
      ).status,
    ).toBe(403);
    const group = await post({
      messageId: 'm2',
      chatType: 'group',
      senderId: 'fs-u-wanglei',
      text: '我的合同',
    });
    expect(((await group.json()) as Json).data.reply).toContain('私聊');
  });

  it('stops unbound senders, and handles a message id once', async () => {
    const unknown = await post({
      messageId: 'm3',
      chatType: 'p2p',
      senderId: 'fs-u-tangning',
      text: '年假怎么算',
    });
    const reply = ((await unknown.json()) as Json).data;
    expect(reply.handledBy).toBeNull();
    expect(reply.reply).toContain('开通账号');
    const again = await post({
      messageId: 'm3',
      chatType: 'p2p',
      senderId: 'fs-u-tangning',
      text: '年假怎么算',
    });
    expect(((await again.json()) as Json).data.duplicate).toBe(true);
  });

  it('masks numbers in replies', async () => {
    const { maskSensitive } =
      await import('../../server/providers/hr/im-channel.ts');
    expect(maskSensitive('手机 13900000004，证件 999999199001010011')).toBe(
      '手机 139****0004，证件 999999********0011',
    );
  });
});

// @vitest-environment node

// Checks for the 2026-09-28 realignment of V1 steps 1 and 3 (组织与员工, 组织同步与岗位变动) on the 启衡精密 demo:
// 邓凯 (emp_th_3) bound by the first sync, the HR assistant's conversation tools (listSyncIssues masked,
// searchPositions, drafts only as someone who manages mappings), 手工指定 for the items the sync cannot decide,
// 开通账号 for 孙丽 from her noAccount item, and the adoption record of a confirmed AI mapping. Each run boots the real
// standalone server on a throwaway SQLite database and a throwaway mock Feishu directory.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'v1-realigned-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
let mockFile: string;
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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-realigned-'));
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
  mockFile = path.join(directory, 'feishu-mock.json');
  process.env.ORG_SYNC_MOCK_FILE = mockFile;
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
  delete process.env.ORG_SYNC_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}
async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}
/** The authorization context a conversation tool runs with: the signed-in user's own. */
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
async function services() {
  const tokens = await import('../../server/providers/hr/tokens.ts');
  return {
    sync: server.application.container.resolve(tokens.orgSyncServiceToken),
    aliases: server.application.container.resolve(
      tokens.positionAliasServiceToken,
    ),
  };
}

type Directory = { departments: Json[]; members: Json[] };
function editDirectory(change: (d: Directory) => void) {
  const d = JSON.parse(readFileSync(mockFile, 'utf8')) as Directory;
  change(d);
  writeFileSync(mockFile, JSON.stringify(d));
}
async function sync() {
  const run = await call('hr01', 'POST', '/org-sync/run');
  expect(run.status).toBe(200);
  return run.json.data as Json;
}
async function issues() {
  return (await call('hr01', 'GET', '/org-sync/issues')).json.data
    .issues as Json[];
}
async function employee(id: string) {
  return (await call('hr01', 'GET', `/employees/${id}`)).json.data
    .employee as Json;
}
async function waitFor<T>(
  check: () => Promise<T | undefined>,
  ms = 8000,
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe('the realigned demo people', () => {
  it('binds 邓凯 (emp_th_3) by employee number on the first sync, without a duplicate', async () => {
    const run = await sync();
    expect(run.status).toBe('succeeded');
    expect((await employee('emp-dengkai')).externalUserId).toBe('fs-u-dengkai');
    const list = (await call('hr01', 'GET', '/employees')).json.data
      .items as Json[];
    expect(list.filter((e) => e.name === '邓凯')).toHaveLength(1);
    expect(
      (await issues()).some(
        (i) => i.externalId === 'fs-u-dengkai' && i.type === 'newMember',
      ),
    ).toBe(false);
  });
});

describe('the HR assistant in a conversation', () => {
  it('reads the items masked, as someone who may view the sync, and never for a head', async () => {
    const { sync: service } = await services();
    const answer = await service.assistantIssues(await actorFor('hr01'));
    const fengtao = answer.issues.find(
      (i) => i.type === 'newMember' && i.externalId === 'fs-u-fengtao',
    )!;
    expect(fengtao.detail.email).toBe('fe***@qiheng.test');
    expect(String(fengtao.detail.mobile)).toContain('****');
    expect(JSON.stringify(answer)).not.toMatch(/1390000\d{4}/u);
    const sunli = answer.issues.find((i) => i.type === 'noAccount')!;
    expect(sunli.employee).toMatchObject({
      name: '孙丽',
      employeeNo: 'QH2101',
    });
    await expect(
      service.assistantIssues(await actorFor('mgr_njl')),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('searches enabled positions with their mappings, and drafts only for mapping managers', async () => {
    const { aliases } = await services();
    const found = await aliases.searchPositions(await actorFor('hr01'), {
      keyword: 'CNC',
    });
    const cnc = found.find((p) => p.id === 'pos-cnc-operator')!;
    expect(cnc.responsibilities).toContain('CNC 岗位上岗证');
    expect(cnc.mappings.some((m) => m.externalTitle === 'CNC 操作工')).toBe(
      true,
    );
    await expect(
      aliases.createDraftsAs(await actorFor('mgr_njl'), [
        {
          provider: 'feishu',
          externalTitle: '组装工',
          positionId: 'pos-assembler',
          draftReason: '同义',
        },
      ]),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('records a confirmed AI mapping as adopted for the adoption rate', async () => {
    const draft = await waitFor(async () => {
      const list = (await call('hr01', 'GET', '/position-aliases')).json
        .data as Json[];
      return list.find((a) => a.externalTitle === '数控机床操作员');
    });
    const database = await db();
    const pending = await database
      .query()
      .selectFrom('aiTaskRunItems')
      .select(['outcome'])
      .where('entityType', '=', 'positionAlias')
      .where('entityId', '=', draft.id)
      .executeTakeFirst();
    expect(pending?.outcome).toBe('pending');
    expect(
      (
        await call('hr01', 'POST', '/position-aliases/confirm', {
          ids: [draft.id],
        })
      ).status,
    ).toBe(200);
    const decided = await database
      .query()
      .selectFrom('aiTaskRunItems')
      .select(['outcome', 'outcomeByUserId'])
      .where('entityType', '=', 'positionAlias')
      .where('entityId', '=', draft.id)
      .executeTakeFirst();
    expect(decided).toMatchObject({
      outcome: 'adopted',
      outcomeByUserId: await userIdOf('hr01'),
    });
  });
});

describe('开通账号 from a noAccount item', () => {
  it('asks for an email when Feishu has none, refuses heads, then links 孙丽 and resolves the item', async () => {
    const item = (await issues()).find(
      (i) => i.type === 'noAccount' && i.employeeId === 'emp-sunli',
    )!;
    expect(item).toBeTruthy();
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/org-sync/employees/emp-sunli/account',
          {},
        )
      ).status,
    ).toBe(403);
    const missing = await call(
      'hr01',
      'POST',
      '/org-sync/employees/emp-sunli/account',
      {},
    );
    expect(missing.json.code).toBe('ORG_SYNC_ACCOUNT_EMAIL_REQUIRED');
    const created = await call(
      'hr01',
      'POST',
      '/org-sync/employees/emp-sunli/account',
      { email: 'sunli@qiheng.test' },
    );
    expect(created.status).toBe(201);
    expect((await employee('emp-sunli')).userId).toBe(created.json.data.userId);
    expect(
      (await issues()).some(
        (i) => i.type === 'noAccount' && i.employeeId === 'emp-sunli',
      ),
    ).toBe(false);
    // Once linked, a second account is refused.
    expect(
      (
        await call('hr01', 'POST', '/org-sync/employees/emp-sunli/account', {
          email: 'sunli2@qiheng.test',
        })
      ).json.code,
    ).toBe('EMPLOYEE_USER_TAKEN');
    // The next sync does not list her again.
    await sync();
    expect(
      (await issues()).some(
        (i) => i.type === 'noAccount' && i.employeeId === 'emp-sunli',
      ),
    ).toBe(false);
  });
});

describe('手工指定', () => {
  it('creates a department with an unknown parent under the one HR chooses', async () => {
    editDirectory((d) => {
      d.departments.push({
        id: 'fs-outsource',
        name: '外协组',
        parentId: 'fs-not-in-scope',
        managerUserId: null,
      });
    });
    await sync();
    const item = (await issues()).find(
      (i) =>
        i.type === 'unknownParentDepartment' && i.externalId === 'fs-outsource',
    )!;
    expect(item).toBeTruthy();
    expect(
      (
        await call('mgr_njl', 'POST', '/org-sync/issues/assign', {
          key: item.key,
          departmentId: 'sz',
        })
      ).status,
    ).toBe(403);
    const assigned = await call('hr01', 'POST', '/org-sync/issues/assign', {
      key: item.key,
      departmentId: 'sz',
    });
    expect(assigned.status).toBe(200);
    expect(assigned.json.data.status).toBe('resolved');
    const database = await db();
    const row = await database
      .query()
      .selectFrom('departments')
      .select(['parentId'])
      .where('externalId', '=', 'fs-outsource')
      .executeTakeFirst();
    expect(row?.parentId).toBe('sz');
    await sync();
    expect(
      (await issues()).some(
        (i) =>
          i.type === 'unknownParentDepartment' &&
          i.externalId === 'fs-outsource',
      ),
    ).toBe(false);
  });

  it('binds the member HR chooses when two members match one employee', async () => {
    editDirectory((d) => {
      for (const userId of ['fs-u-guofan-a', 'fs-u-guofan-b'])
        d.members.push({
          userId,
          name: '郭凡',
          employeeNo: 'QH2105',
          email: null,
          mobile: null,
          departmentId: 'fs-sz-as',
          title: '装配工',
          managerUserId: 'fs-u-mgr-east',
          active: true,
        });
    });
    await sync();
    expect((await employee('emp-guofan')).externalUserId ?? null).toBeNull();
    const item = (await issues()).find((i) => i.type === 'duplicateMatch')!;
    expect(item.detail.members).toEqual(['fs-u-guofan-a', 'fs-u-guofan-b']);
    const wrong = await call('hr01', 'POST', '/org-sync/issues/assign', {
      key: item.key,
      memberId: 'fs-u-wanglei',
    });
    expect(wrong.json.code).toBe('ORG_SYNC_ASSIGN_NOT_CANDIDATE');
    expect(
      (
        await call('hr01', 'POST', '/org-sync/issues/assign', {
          key: item.key,
          memberId: 'fs-u-guofan-a',
        })
      ).status,
    ).toBe(200);
    expect((await employee('emp-guofan')).externalUserId).toBe('fs-u-guofan-a');
  });
});

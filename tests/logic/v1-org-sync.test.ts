// @vitest-environment node

// Acceptance checks for V1 step 3 (组织同步与岗位变动): the first full sync against the mock Feishu directory,
// pending items and their carry-over, the HR assistant's explanations and mapping drafts, both data-master modes,
// switching the master, sync locks, signed callbacks and the permission boundaries. Each run boots the real
// standalone server on a throwaway SQLite database and a throwaway mock directory file.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
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
const PASSWORD = 'v1-org-sync-test-password';

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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-org-sync-'));
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
  process.env.ORG_SYNC_CALLBACK_SECRET = 'test-callback-secret';
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
  delete process.env.ORG_SYNC_CALLBACK_SECRET;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}

type Directory = {
  departments: Json[];
  members: Json[];
};
function editDirectory(change: (d: Directory) => void) {
  const d = JSON.parse(readFileSync(mockFile, 'utf8')) as Directory;
  change(d);
  writeFileSync(mockFile, JSON.stringify(d));
}
const member = (d: Directory, id: string) =>
  d.members.find((m) => m.userId === id)!;

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
async function settings() {
  return (await call('hr01', 'GET', '/org-sync')).json.data.settings as Json;
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

describe('first full sync', () => {
  it('binds departments and employees and lists the three expected people', async () => {
    const before = (await call('hr01', 'GET', '/employees')).json.data.items
      .length as number;
    const run = await sync();
    expect(run.status).toBe('succeeded');
    expect(run.stats.bound).toBeGreaterThanOrEqual(10);
    expect(
      (await call('hr01', 'GET', '/employees')).json.data.items.length,
    ).toBe(before);
    expect((await employee('emp-wanglei')).externalUserId).toBe('fs-u-wanglei');
    const list = await issues();
    const of = (type: string, externalId: string) =>
      list.find((i) => i.type === type && i.externalId === externalId);
    expect(of('newMember', 'fs-u-fengtao')).toBeTruthy();
    expect(of('unmappedTitle', 'fs-u-fengtao')).toBeTruthy();
    expect(of('newMember', 'fs-u-tangning')).toBeTruthy();
    expect(of('unmappedTitle', 'fs-u-tangning')).toBeTruthy();
    expect(of('noAccount', 'fs-u-sunli')).toBeTruthy();
    expect(list.filter((i) => i.type === 'orgMismatch')).toEqual([]);
  });

  it('has the HR assistant explain every item and draft only the clear mapping', async () => {
    const explained = await waitFor(async () => {
      const list = await issues();
      return list.every((i) => i.aiExplanation) ? list : undefined;
    });
    const tangning = explained.find(
      (i) => i.type === 'unmappedTitle' && i.externalId === 'fs-u-tangning',
    )!;
    expect(tangning.aiSuggestedAction).toContain('新建岗位');
    const aliases = (await call('hr01', 'GET', '/position-aliases')).json
      .data as Json[];
    const draft = aliases.find((a) => a.externalTitle === '数控机床操作员')!;
    expect(draft).toMatchObject({
      source: 'ai',
      reviewStatus: 'draft',
      positionId: 'pos-cnc-operator',
    });
    expect(draft.draftReason).toBeTruthy();
    expect(aliases.some((a) => a.externalTitle === '设备工程师')).toBe(false);
    // A draft fills nothing: 冯涛's onboarding has no position yet.
    const fengtao = explained.find(
      (i) => i.type === 'newMember' && i.externalId === 'fs-u-fengtao',
    )!;
    const prefill = await call('hr01', 'POST', '/org-sync/issues/prefill', {
      key: fengtao.key,
    });
    expect(prefill.json.data.toPositionId).toBeNull();
    expect(prefill.json.data.createAccount).toBe(true);
    expect(JSON.stringify(explained)).not.toContain('13900000021');
  });

  it('keeps keys, notes and drafts on a sync with no changes', async () => {
    const first = await issues();
    const run = await sync();
    await new Promise((r) => setTimeout(r, 500));
    const second = await issues();
    expect(second.map((i) => i.key).sort()).toEqual(
      first.map((i) => i.key).sort(),
    );
    for (const item of second)
      expect(item.aiExplainedAt).toBe(
        first.find((f) => f.key === item.key)!.aiExplainedAt,
      );
    const aliases = (await call('hr01', 'GET', '/position-aliases')).json
      .data as Json[];
    expect(
      aliases.filter((a) => a.externalTitle === '数控机床操作员'),
    ).toHaveLength(1);
    expect(run.stats.bound).toBe(0);
  });
});

describe('nocohr mode (default)', () => {
  it('lists a transfer for 李敏 and raises it from the item, once', async () => {
    editDirectory((d) => {
      Object.assign(member(d, 'fs-u-limin'), {
        departmentId: 'fs-sz-as',
        title: '装配工',
      });
    });
    await sync();
    const limin = await employee('emp-limin');
    expect(limin.departmentId).toBe('sz-mc');
    const item = (await issues()).find(
      (i) => i.type === 'orgMismatch' && i.externalId === 'fs-u-limin',
    )!;
    expect(item.detail.suggestedAction).toBe('transfer');
    const prefill = (
      await call('hr01', 'POST', '/org-sync/issues/prefill', { key: item.key })
    ).json.data as Json;
    expect(prefill).toMatchObject({
      actionType: 'transfer',
      employeeId: 'emp-limin',
      toDepartmentId: 'sz-as',
      toPositionId: 'pos-assembler',
    });
    const raised = await call('hr01', 'POST', '/actions', {
      ...prefill,
      syncIssueKey: item.key,
    });
    expect(raised.status).toBe(201);
    expect(raised.json.data.approvals[0].approverUserId).toBe(
      await userIdOf('mgr_east'),
    );
    const again = await call('hr01', 'POST', '/actions', {
      ...prefill,
      syncIssueKey: item.key,
    });
    expect(again.status).toBe(409);
    const after = (await issues()).find((i) => i.key === item.key)!;
    expect(after.status).toBe('inProgress');
    // Rejected: the item opens again.
    await call('mgr_east', 'POST', `/actions/${raised.json.data.id}/reject`, {
      comment: '暂不调整',
    });
    expect((await issues()).find((i) => i.key === item.key)!.status).toBe(
      'open',
    );
  });

  it('lists a deactivated member and pre-fills the leave date', async () => {
    editDirectory((d) => {
      Object.assign(member(d, 'fs-u-qianjin'), {
        active: false,
        deactivatedAt: '2026-09-20',
      });
    });
    await sync();
    expect((await employee('emp-qianjin')).status).not.toBe('leave');
    const item = (await issues()).find(
      (i) => i.type === 'deactivatedMember' && i.externalId === 'fs-u-qianjin',
    )!;
    const prefill = (
      await call('hr01', 'POST', '/org-sync/issues/prefill', { key: item.key })
    ).json.data as Json;
    expect(prefill).toMatchObject({
      actionType: 'offboard',
      effectiveDate: '2026-09-20',
    });
    editDirectory((d) => {
      Object.assign(member(d, 'fs-u-qianjin'), {
        active: true,
        deactivatedAt: null,
      });
    });
  });

  it('ignores an item only with a reason, and keeps it ignored', async () => {
    const item = (await issues()).find((i) => i.type === 'noAccount')!;
    expect(
      (await call('hr01', 'POST', '/org-sync/issues/ignore', { key: item.key }))
        .status,
    ).toBe(400);
    expect(
      (
        await call('hr01', 'POST', '/org-sync/issues/ignore', {
          key: item.key,
          reason: '外部人员',
        })
      ).status,
    ).toBe(200);
    await sync();
    const all = (
      await call('hr01', 'GET', `/org-sync/runs/${(await sync()).id}`)
    ).json.data.issues as Json[];
    expect(all.find((i) => i.key === item.key)!.status).toBe('ignored');
  });

  it('creates a new directory department, and stops when the tree sync is off', async () => {
    editDirectory((d) => {
      d.departments.push({
        id: 'fs-sz-qc',
        name: '质检室',
        parentId: 'fs-sz',
        managerUserId: null,
      });
    });
    await sync();
    const lookups = (await call('hr01', 'GET', '/lookups')).json.data
      .departments as Json[];
    const plain = (title: string) => {
      try {
        return JSON.parse(title) as unknown;
      } catch {
        return title;
      }
    };
    expect(
      lookups.some((d) => plain(d.title) === '质检室' && d.parentId === 'sz'),
    ).toBe(true);
    const current = await call('hr01', 'GET', '/org-sync');
    const s = current.json.data.settings;
    const { orgMaster, masterChangedBy, masterChangedAt, ...rest } = s.value;
    void orgMaster;
    void masterChangedBy;
    void masterChangedAt;
    expect(
      (
        await call('hr01', 'PATCH', '/org-sync/settings', {
          revision: s.revision,
          value: { ...rest, syncDepartmentTree: false },
        })
      ).status,
    ).toBe(200);
    editDirectory((d) => {
      d.departments.push({
        id: 'fs-sz-lab',
        name: '试验室',
        parentId: 'fs-sz',
        managerUserId: null,
      });
    });
    await sync();
    const later = (await call('hr01', 'GET', '/lookups')).json.data
      .departments as Json[];
    expect(later.some((d) => plain(d.title) === '试验室')).toBe(false);
  });

  it('leaves a locked employee alone and lists the change', async () => {
    expect(
      (
        await call('hr01', 'POST', '/org-sync/employees/emp-wanglei/lock', {
          locked: true,
        })
      ).status,
    ).toBe(200);
    editDirectory((d) => {
      member(d, 'fs-u-wanglei').departmentId = 'fs-cd-mc';
    });
    await sync();
    expect((await employee('emp-wanglei')).departmentId).toBe('sz-mc');
    expect(
      (await issues()).some(
        (i) => i.type === 'lockedChange' && i.externalId === 'fs-u-wanglei',
      ),
    ).toBe(true);
    editDirectory((d) => {
      member(d, 'fs-u-wanglei').departmentId = 'fs-sz-mc';
    });
    await call('hr01', 'POST', '/org-sync/employees/emp-wanglei/lock', {
      locked: false,
    });
  });
});

describe('switching the data master', () => {
  it('refuses external while 王磊 has a pending transfer, then switches after it is withdrawn', async () => {
    const s = await settings();
    const refused = await call('hr01', 'POST', '/org-sync/master', {
      revision: s.revision,
      orgMaster: 'external',
    });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('ORG_MASTER_OPEN_ACTIONS');
    expect(
      (refused.json.details.actions as Json[]).some(
        (a) => a.employeeId === 'emp-wanglei',
      ),
    ).toBe(true);
    const open = (await call('hr01', 'GET', '/actions?view=all')).json.data
      .items as Json[];
    for (const action of open.filter(
      (a) =>
        ['transfer', 'promote', 'offboard'].includes(a.actionType) &&
        ['pending', 'approved'].includes(a.status),
    )) {
      // Only the applicant withdraws: 陈静's transfer, 何伟's resignation for 邓凯 (V1-02 demo), HR's own.
      const applicant =
        action.applicantUserId === (await userIdOf('mgr_njl'))
          ? 'mgr_njl'
          : action.applicantUserId === (await userIdOf('mgr_cd'))
            ? 'mgr_cd'
            : 'hr01';
      expect(
        (await call(applicant, 'POST', `/actions/${action.id}/cancel`)).status,
      ).toBe(200);
    }
    const before = await employee('emp-wanglei');
    const switched = await call('hr01', 'POST', '/org-sync/master', {
      revision: s.revision,
      orgMaster: 'external',
    });
    expect(switched.status).toBe(200);
    expect(switched.json.data.value.masterChangedBy).toBe(
      await userIdOf('hr01'),
    );
    expect(await employee('emp-wanglei')).toEqual(before);
  });
});

describe('external mode', () => {
  it('writes 李敏 to 装配车间 as a sync transfer with the run id', async () => {
    const run = await sync();
    const limin = await employee('emp-limin');
    expect(limin.departmentId).toBe('sz-as');
    expect(limin.positionId).toBe('pos-assembler');
    const events = (await call('hr01', 'GET', '/job-events?source=sync')).json
      .data.items as Json[];
    const event = events.find((e) => e.employeeId === 'emp-limin')!;
    expect(event).toMatchObject({
      eventType: 'transfer',
      source: 'sync',
      syncRunId: run.id,
    });
    expect(event.processedAt).toBeTruthy();
  });

  it('records 赵阳 becoming 车间主任 as a promotion', async () => {
    editDirectory((d) => {
      member(d, 'fs-u-zhaoyang').title = '车间主任';
    });
    await sync();
    const events = (await call('hr01', 'GET', '/job-events?source=sync')).json
      .data.items as Json[];
    expect(events.find((e) => e.employeeId === 'emp-zhaoyang')!.eventType).toBe(
      'promote',
    );
  });

  it('sets 钱进 as left, keeps the contract and lists it', async () => {
    editDirectory((d) => {
      Object.assign(member(d, 'fs-u-qianjin'), { active: false });
    });
    await sync();
    expect((await employee('emp-qianjin')).status).toBe('leave');
    expect(
      (await issues()).some(
        (i) => i.type === 'contractPending' && i.externalId === 'fs-u-qianjin',
      ),
    ).toBe(true);
    const contracts = (
      await call('hr01', 'GET', '/contracts?employeeId=emp-qianjin')
    ).json.data.items as Json[];
    expect(contracts.some((c) => c.status === 'active')).toBe(true);
  });

  it('refuses transfers raised by hand, keeps onboarding', async () => {
    const refused = await call('hr01', 'POST', '/actions', {
      actionType: 'transfer',
      employeeId: 'emp-wumin',
      toPositionId: 'pos-assembler',
      toDepartmentId: 'cd-mc',
      effectiveDate: '2099-01-01',
    });
    expect(refused.json.code).toBe('ACTION_TYPE_SYNC_MANAGED');
    const detail = (await call('hr01', 'GET', '/employees/emp-wumin')).json
      .data;
    expect(detail.syncManaged).toBe(true);
  });

  it('creates 冯涛 once his mapping is confirmed', async () => {
    const aliases = (await call('hr01', 'GET', '/position-aliases')).json
      .data as Json[];
    const draft = aliases.find((a) => a.externalTitle === '数控机床操作员')!;
    expect(
      (
        await call('mgr_njl', 'POST', '/position-aliases/confirm', {
          ids: [draft.id],
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('hr01', 'POST', '/position-aliases/confirm', {
          ids: [draft.id],
        })
      ).status,
    ).toBe(200);
    await sync();
    const list = (await call('hr01', 'GET', '/employees')).json.data
      .items as Json[];
    const fengtao = list.filter((e) => e.name === '冯涛');
    expect(fengtao).toHaveLength(1);
    expect(fengtao[0]!.positionId).toBe('pos-cnc-operator');
    await sync();
    expect(
      (
        (await call('hr01', 'GET', '/employees')).json.data.items as Json[]
      ).filter((e) => e.name === '冯涛'),
    ).toHaveLength(1);
  });

  it('stops writing after switching back to nocohr', async () => {
    const s = await settings();
    await call('hr01', 'POST', '/org-sync/master', {
      revision: s.revision,
      orgMaster: 'nocohr',
    });
    editDirectory((d) => {
      member(d, 'fs-u-wumin').departmentId = 'fs-sz-mc';
    });
    await sync();
    expect((await employee('emp-wumin')).departmentId).toBe('cd-mc');
    expect(
      (await issues()).some(
        (i) => i.type === 'orgMismatch' && i.externalId === 'fs-u-wumin',
      ),
    ).toBe(true);
  });
});

describe('boundaries', () => {
  it('refuses the sync to heads and employees, and scopes job events', async () => {
    for (const username of ['mgr_njl', 'emp_njl_1']) {
      expect((await call(username, 'GET', '/org-sync')).status).toBe(403);
      expect((await call(username, 'POST', '/org-sync/run')).status).toBe(403);
      expect(
        (
          await call(username, 'POST', '/org-sync/master', {
            revision: 0,
            orgMaster: 'external',
          })
        ).status,
      ).toBe(403);
    }
    expect(
      (await call('emp_njl_1', 'GET', '/job-events')).json.data.items.every(
        (e: Json) => e.employeeId === 'emp-wanglei',
      ),
    ).toBe(true);
    const east = (await call('mgr_east', 'GET', '/job-events')).json.data
      .items as Json[];
    expect(east.some((e) => e.employeeId === 'emp-zhaoyang')).toBe(false);
  });

  it('drops callbacks with a bad signature and accepts a signed one once', async () => {
    const body = JSON.stringify({ eventId: 'evt-1' });
    const post = (signature: string) =>
      server.fetch(
        new Request(`${base}/api/org-sync-callback/feishu`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-nocohr-signature': signature,
            origin: 'http://localhost',
          },
          body,
        }),
      );
    expect((await post('forged')).status).toBe(403);
    const good = createHmac('sha256', 'test-callback-secret')
      .update(body)
      .digest('hex');
    const first = await post(good);
    expect(first.status).toBe(202);
    expect(((await first.json()) as Json).data.outcome).toBe('accepted');
    expect(((await (await post(good)).json()) as Json).data.outcome).toBe(
      'duplicate',
    );
  });
});

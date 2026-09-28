// @vitest-environment node

// Acceptance checks for V1 of the talent platform (core HR, knowledge and learning, exams and certification). Each run boots the real standalone
// server on a throwaway SQLite database with migrations and seeds, so the demo database stays untouched.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { notificationServiceToken } from '@nocobase/app-plugin-notification';
import { hrCoreServiceToken } from '../../server/providers/hr/tokens.ts';
import { addDays, today } from '../../server/providers/hr/shared.ts';
import { createWorkItemStore } from '../../server/providers/hr/work-item-store.ts';

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
const PASSWORD = 'talent-acceptance-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

async function startAcceptanceServer() {
  if (server) return;
  directory = mkdtempSync(path.join(tmpdir(), 'hr-talent-acceptance-'));
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
}

beforeAll(startAcceptanceServer, 180_000);

describe('work item producer foundation', () => {
  it('enforces recipient scope, rejects manual approval closure, and keeps completion idempotent', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const userId = async (username: string) => {
      const session = await call(username, 'GET', '/api/auth/get-session');
      expect(session.status).toBe(200);
      expect(session.json.user.id).toBeTruthy();
      return String(session.json.user.id);
    };
    const hr = await userId('hr01');
    const employee = await userId('emp_njl_1');
    const rows = await db.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      return Promise.all([
        store.put({
          recipientUserId: hr,
          type: 'testRule',
          refType: 'test',
          refId: 'hr',
          title: 'HR only',
          link: '/talent/me',
          sourceKind: 'rule',
        }),
        store.put({
          recipientUserId: employee,
          type: 'testRule',
          refType: 'test',
          refId: 'employee',
          title: 'Employee only',
          link: '/talent/me',
          sourceKind: 'rule',
        }),
        store.put({
          recipientUserId: employee,
          type: 'approval',
          refType: 'test',
          refId: 'approval',
          title: 'Approval',
          link: '/talent/me',
          sourceKind: 'approval',
        }),
      ]);
    });
    expect((await call(null, 'GET', '/work-items')).status).toBe(401);
    const list = await call('emp_njl_1', 'GET', '/work-items');
    expect(list.status).toBe(200);
    expect(list.json.data.items.map((row: Json) => row.title)).toContain(
      'Employee only',
    );
    expect(list.json.data.items.map((row: Json) => row.title)).not.toContain(
      'HR only',
    );
    expect(
      (await call('emp_njl_1', 'GET', `/work-items?recipientUserId=${hr}`))
        .status,
    ).toBe(400);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[0].id}/complete`))
        .status,
    ).toBe(404);
    expect(
      (await call('hr01', 'POST', `/work-items/${rows[1].id}/complete`)).status,
    ).toBe(404);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[2].id}/complete`))
        .status,
    ).toBe(409);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[2].id}/dismiss`))
        .status,
    ).toBe(409);
    const first = await call(
      'emp_njl_1',
      'POST',
      `/work-items/${rows[1].id}/complete`,
    );
    const second = await call(
      'emp_njl_1',
      'POST',
      `/work-items/${rows[1].id}/complete`,
    );
    expect(first.status).toBe(200);
    expect(second.json.data.doneAt).toBe(first.json.data.doneAt);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[1].id}/dismiss`))
        .status,
    ).toBe(409);
  });
  const item = {
    recipientUserId: 'work-item-test-recipient',
    type: 'approval',
    refType: 'personnelAction',
    refId: 'work-item-test-action',
    title: 'Review personnel action',
    link: '/talent/actions/work-item-test-action',
    sourceKind: 'approval' as const,
  };

  it('converges duplicate producers and never reopens a completed approval', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const first = await db.transaction((connection) =>
      createWorkItemStore(connection).put(item),
    );
    const second = await db.transaction((connection) =>
      createWorkItemStore(connection).put({ ...item, title: 'Updated title' }),
    );
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Updated title');
    expect(second.status).toBe('open');
    const identity = {
      recipientUserId: item.recipientUserId,
      type: item.type,
      refType: item.refType,
      refId: item.refId,
    };
    await db.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      await store.closeApproval(identity);
      await store.closeApproval(identity);
    });
    const closed = await db
      .repository('workItems')
      .findOne({ filter: identity });
    const replay = await db.transaction((connection) =>
      createWorkItemStore(connection).put(item),
    );
    expect(replay.status).toBe('done');
    expect(replay.doneAt).toEqual(closed?.doneAt);
    expect(await db.repository('workItems').count({ filter: identity })).toBe(
      1,
    );
    await expect(
      db
        .repository('workItems')
        .createOne({ values: { ...replay, id: 'duplicate-work-item' } }),
    ).rejects.toThrow();
  });

  it('keeps recipient keys separate and rolls back with the business transaction', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    await db.transaction((connection) =>
      createWorkItemStore(connection).put({
        ...item,
        recipientUserId: 'another-recipient',
      }),
    );
    expect(
      await db.repository('workItems').count({ filter: { refId: item.refId } }),
    ).toBe(2);
    await expect(
      db.transaction(async (connection) => {
        await createWorkItemStore(connection).put({
          ...item,
          refId: 'rolled-back-item',
        });
        throw new Error('Business operation failed');
      }),
    ).rejects.toThrow('Business operation failed');
    expect(
      await db
        .repository('workItems')
        .exists({ filter: { refId: 'rolled-back-item' } }),
    ).toBe(false);
  });

  it('rejects unsafe links and incomplete AI attribution before persisting', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    for (const link of [
      'https://example.com',
      '//example.com',
      '/main/talent/me',
      '/talent/../settings',
      '/talent/%2e%2e/settings',
      '/talent/\\\\example.com',
    ]) {
      await expect(
        db.transaction((connection) =>
          createWorkItemStore(connection).put({ ...item, link }),
        ),
      ).rejects.toThrow('INVALID_WORK_ITEM');
    }
    await expect(
      db.transaction((connection) =>
        createWorkItemStore(connection).put({ ...item, sourceKind: 'ai' }),
      ),
    ).rejects.toThrow('INVALID_WORK_ITEM');
    const rule = { ...item, type: 'docReview', sourceKind: 'rule' as const };
    await db.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      await store.put(rule);
      await store.closeApproval({
        recipientUserId: rule.recipientUserId,
        type: rule.type,
        refType: rule.refType,
        refId: rule.refId,
      });
    });
    expect(
      (
        await db
          .repository('workItems')
          .findOne({ filter: { type: 'docReview', refId: item.refId } })
      )?.status,
    ).toBe('open');
  });
});

describe('contract reminder windows', () => {
  it('restricts settings to HR and applies saved reminder windows immediately', async () => {
    expect((await call(null, 'GET', '/personnel-settings')).status).toBe(401);
    expect((await call('mgr_east', 'GET', '/personnel-settings')).status).toBe(
      403,
    );
    const original = await call('hr01', 'GET', '/personnel-settings');
    expect(original.status).toBe(200);
    const revision = original.json.data.reminders.revision;
    const change = {
      revision,
      value: { probationDays: 20, contractDays: [90, 30] },
    };
    expect(
      (await call('mgr_east', 'PATCH', '/personnel-settings/reminders', change))
        .status,
    ).toBe(403);
    expect(
      (
        await call('hr01', 'PATCH', '/personnel-settings/reminders', {
          revision,
          value: { probationDays: -1, contractDays: [30, 30] },
        })
      ).status,
    ).toBe(400);
    const saved = await call(
      'hr01',
      'PATCH',
      '/personnel-settings/reminders',
      change,
    );
    expect(saved.status).toBe(200);
    expect(
      (await call('hr01', 'PATCH', '/personnel-settings/reminders', change))
        .status,
    ).toBe(409);
    const container = server.application.container;
    const db = container.resolve(databaseManagerToken);
    const date = today();
    await db.repository('employmentContracts').updateOne({
      filter: { id: 'contract-limin' },
      values: { endDate: addDays(date, 80) },
    });
    await container.resolve(hrCoreServiceToken).runDaily({ asOf: date });
    expect(
      await container
        .resolve(notificationServiceToken)
        .getByIdempotencyKey('hr:contract:contract-limin:90'),
    ).toBeTruthy();
    const restore = await call(
      'hr01',
      'PATCH',
      '/personnel-settings/reminders',
      {
        revision: saved.json.data.revision,
        value: original.json.data.reminders.value,
      },
    );
    expect(restore.status).toBe(200);
  });
  it('submits only the nearest window and remains idempotent', async () => {
    const container = server.application.container;
    const db = container.resolve(databaseManagerToken);
    const core = container.resolve(hrCoreServiceToken);
    const notifications = container.resolve(notificationServiceToken);
    const asOf = today();
    await db.repository('employmentContracts').updateOne({
      filter: { id: 'contract-limin' },
      values: { endDate: addDays(asOf, 20) },
    });
    await core.runDaily({ asOf });
    const key = 'hr:contract:contract-limin:30';
    const first = await notifications.getByIdempotencyKey(key);
    expect(first).toBeTruthy();
    expect(
      await notifications.getByIdempotencyKey('hr:contract:contract-limin:60'),
    ).toBeFalsy();
    await core.runDaily({ asOf });
    expect(await notifications.getByIdempotencyKey(key)).toEqual(first);
    const logs = await db
      .query()
      .selectFrom('hrReminderLog')
      .select(['id'])
      .where('reminderKey', '=', 'contract:contract-limin:30')
      .execute();
    expect(logs).toHaveLength(1);
  });
});

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

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('step 1: organization and talent framework', () => {
  it('rejects anonymous requests', async () => {
    expect((await call(null, 'GET', '/employees')).status).toBe(401);
  });

  it('scopes the employee list by role', async () => {
    const hr = await call('hr01', 'GET', '/employees');
    expect(hr.status).toBe(200);
    expect(hr.json.data.items.length).toBeGreaterThanOrEqual(7);

    const manager = await call('mgr_east', 'GET', '/employees');
    expect(manager.status).toBe(200);
    const ids = manager.json.data.items.map((e: Json) => e.id);
    expect(ids).toContain('emp-wanglei');
    expect(ids).not.toContain('emp-zhaoyang');

    expect((await call('emp_njl_1', 'GET', '/employees')).status).toBe(403);
  });

  it('hides out-of-scope records and sensitive fields', async () => {
    expect(
      (await call('mgr_east', 'GET', '/employees/emp-zhaoyang')).status,
    ).toBe(404);
    const manager = await call('mgr_east', 'GET', '/employees/emp-wanglei');
    expect(manager.status).toBe(200);
    expect(manager.json.data.employee.mobile).toBeUndefined();
    const hr = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(hr.json.data.employee.mobile).toBeTruthy();
  });

  it('computes competency gaps for an employee reading their own record', async () => {
    const gaps = await call('emp_njl_2', 'GET', '/employees/emp-limin/gaps');
    expect(gaps.status).toBe(200);
    const byTitle = Object.fromEntries(
      gaps.json.data.rows.map((r: Json) => [r.title, r.gap]),
    );
    // The later of her two assessments counts: CNC 设备操作 3 meets the requirement.
    expect(byTitle['CNC 设备操作']).toBe(0);
    // The training seed assesses her at 1 of 2 (the learning coach's gap) and 1 of 1 for the safety qualification.
    expect(byTitle['安全生产与 5S']).toBe(1);
    expect(byTitle['岗位安全上岗资格']).toBe(0);
    expect(
      (await call('emp_njl_2', 'GET', '/employees/emp-wanglei/gaps')).status,
    ).not.toBe(200);
  });

  it('enforces assessment scope and forbids self-assessment', async () => {
    const self = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-mgr-njl/assessments',
      { competencyId: 'comp-cnc', level: 3 },
    );
    expect(self.status).toBe(403);
    expect(self.json.code).toBe('ASSESSMENT_SELF');
    const outside = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-zhaoyang/assessments',
      { competencyId: 'comp-cnc', level: 3 },
    );
    expect(outside.status).toBe(404);
    const tooHigh = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-limin/assessments',
      { competencyId: 'comp-cnc', level: 9 },
    );
    expect(tooHigh.json.code).toBe('ASSESSMENT_LEVEL_INVALID');
    const ok = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-limin/assessments',
      { competencyId: 'comp-quality-record', level: 2, evidence: 'acceptance' },
    );
    expect(ok.status).toBe(201);
  });

  it('protects framework integrity', async () => {
    const duplicate = await call(
      'hr01',
      'POST',
      '/framework/positions/pos-cnc-operator/requirements',
      { competencyId: 'comp-cnc', requiredLevel: 2, mandatory: true },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.code).toBe('REQUIREMENT_EXISTS');
    const lowered = await call('hr01', 'PATCH', '/competencies/comp-cnc', {
      code: 'cnc-operation',
      title: '灌装设备操作',
      category: 'skill',
      maxLevel: 2,
    });
    expect(lowered.status).toBe(409);
    expect(lowered.json.code).toBe('COMPETENCY_MAX_LEVEL_CONFLICT');
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          '/framework/positions/pos-cnc-operator/requirements',
          { competencyId: 'comp-team', requiredLevel: 1 },
        )
      ).status,
    ).toBe(403);
  });

  it('rejects department cycles and restricts department settings', async () => {
    const cycle = await call('hr01', 'PATCH', '/org/departments/sz', {
      parentId: 'sz-mc',
    });
    expect(cycle.status).toBe(400);
    expect(cycle.json.code).toBe('DEPARTMENT_CYCLE');
    expect((await call('emp_njl_1', 'GET', '/org/departments')).status).toBe(
      403,
    );
  });
});

describe('step 2: core HR', () => {
  it('runs the two-level transfer approval and applies it on the effective date', async () => {
    expect(
      (
        await call(
          'emp_njl_1',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).status,
    ).toBe(403);
    const noComment = await call(
      'mgr_east',
      'POST',
      '/actions/action-wanglei-transfer/reject',
      {},
    );
    expect(noComment.json.code).toBe('ACTION_REJECT_COMMENT_REQUIRED');
    // The HR administrator cannot skip the first level.
    expect(
      (
        await call(
          'hr01',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).json.code,
    ).toBe('ACTION_NOT_APPROVER');

    const first = await call(
      'mgr_east',
      'POST',
      '/actions/action-wanglei-transfer/approve',
      {},
    );
    expect(first.status).toBe(200);
    expect(first.json.data.status).toBe('pending');
    const second = await call(
      'hr01',
      'POST',
      '/actions/action-wanglei-transfer/approve',
      {},
    );
    expect(second.status).toBe(200);
    expect(second.json.data.status).toBe('effective');

    const employee = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(employee.json.data.employee.departmentId).toBe('sz-as');
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).json.code,
    ).toBe('ACTION_NOT_PENDING');
  });

  it('keeps one active contract per employee and chains renewals', async () => {
    const second = await call('hr01', 'POST', '/contracts', {
      employeeId: 'emp-limin',
      contractNo: 'HT-TEST-001',
      type: 'fixedTerm',
      startDate: '2026-01-01',
      endDate: '2027-12-31',
    });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('CONTRACT_ACTIVE_EXISTS');
    const renewed = await call(
      'hr01',
      'POST',
      '/contracts/contract-limin/renew',
      {
        contractNo: 'HT-TEST-002',
        type: 'fixedTerm',
        startDate: '2026-10-17',
        endDate: '2029-10-16',
      },
    );
    expect(renewed.status).toBe(201);
    expect(renewed.json.data.previousContractId).toBe('contract-limin');
    const list = await call('hr01', 'GET', '/contracts?employeeId=emp-limin');
    const statuses = Object.fromEntries(
      list.json.data.items.map((c: Json) => [c.id, c.status]),
    );
    expect(statuses['contract-limin']).toBe('renewed');
    expect(Object.values(statuses).filter((s) => s === 'active')).toHaveLength(
      1,
    );
    expect(
      (await call('mgr_east', 'POST', '/contracts/contract-wanglei/terminate'))
        .status,
    ).toBe(403);
  });

  it('accepts only whitelisted profile changes, one pending at a time', async () => {
    const forbidden = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { name: '改名' },
    });
    expect(forbidden.status).toBe(400);
    expect(forbidden.json.code).toBe('PROFILE_CHANGE_FIELD_NOT_ALLOWED');
    const pending = await call('emp_njl_1', 'POST', '/me/profile-change', {
      changes: { mobile: '13900000000' },
    });
    expect(pending.status).toBe(409);
    expect(pending.json.code).toBe('PROFILE_CHANGE_PENDING');

    const submitted = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { mobile: '13911112222' },
    });
    expect(submitted.status).toBe(201);
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          `/profile-changes/${submitted.json.data.id}/approve`,
          {},
        )
      ).status,
    ).toBe(403);
    const approved = await call(
      'hr01',
      'POST',
      `/profile-changes/${submitted.json.data.id}/approve`,
      {},
    );
    expect(approved.status).toBe(200);
    const employee = await call('hr01', 'GET', '/employees/emp-limin');
    expect(employee.json.data.employee.mobile).toBe('13911112222');
  });
});

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
): Promise<T> {
  // Event automations run in the background after the request has answered.
  for (let i = 0; i < 50; i += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function runsOf(task: string): Promise<Json[]> {
  const runs = await call('hr01', 'GET', `/automations/runs?task=${task}`);
  expect(runs.status).toBe(200);
  return runs.json.data as Json[];
}

describe('knowledge, exams and certification', () => {
  it('shows restricted documents only to the positions they name', async () => {
    const operator = await call('emp_njl_2', 'GET', '/kb/documents');
    expect(operator.status).toBe(200);
    const operatorIds = operator.json.data.items.map((d: Json) => d.id);
    expect(operatorIds).toContain('doc-wi-mc-0231');
    expect(operatorIds).not.toContain('doc-man-pr-0007');
    const head = await call('mgr_njl', 'GET', '/kb/documents');
    expect(head.json.data.items.map((d: Json) => d.id)).toContain(
      'doc-man-pr-0007',
    );
    expect((await call('emp_njl_2', 'GET', '/courses')).status).toBe(403);
  });

  it('lets only valid CNC certificate holders log a machine start', async () => {
    const sign = (username: string) =>
      call(username, 'POST', '/api/demo/batch-record/sign-filling', {});
    expect((await sign('emp_th_1')).status).toBe(200);
    // 王磊 holds a valid CNC 岗位上岗证 (V3-10 seed: issued five months ago).
    expect((await sign('emp_njl_1')).status).toBe(200);
    // 李敏 has no certificate yet: she cannot log a start, nor even see the work order.
    expect((await sign('emp_njl_2')).status).toBe(403);
    expect(
      (await call('emp_njl_2', 'GET', '/api/demo/batch-record')).status,
    ).toBe(403);
  });

  it('expires certificates and escalates stalled renewals in the daily run', async () => {
    const run = await call('hr01', 'POST', '/org/maintenance/run', {});
    expect(run.status).toBe(200);
    // 吴敏's certificate expired yesterday.
    expect(
      (
        await call(
          'emp_th_2',
          'POST',
          '/api/demo/batch-record/sign-filling',
          {},
        )
      ).status,
    ).toBe(403);
    const escalations = await runsOf('certificationSteward.recertEscalation');
    expect(escalations).toHaveLength(1);
    expect(escalations[0].status).toBe('succeeded');
    // No model is configured in tests, so the head receives the template text.
    expect(escalations[0].fallback).toBe(true);
    // Running the daily job again the same day does not escalate twice: the repeat is recorded as skipped.
    await call('hr01', 'POST', '/org/maintenance/run', {});
    const again = await runsOf('certificationSteward.recertEscalation');
    expect(again.filter((r: Json) => r.status === 'succeeded')).toHaveLength(1);
    expect(again.filter((r: Json) => r.status === 'skipped')).toHaveLength(1);
  });

  it('issues the certificate when the last requirement is met, and grants its permissions', async () => {
    // 李敏 finishes 《CNC 岗位操作入门》, then passes 《CNC 上岗考试》.
    for (const lesson of ['l1', 'l2', 'l3']) {
      const progress = await call('emp_njl_2', 'POST', '/learning/progress', {
        courseId: 'course-cnc-intro',
        lessonId: `course-cnc-intro-${lesson}`,
        assignmentId: 'assign-limin-cnc',
        durationSeconds: 300,
      });
      expect(progress.status).toBe(200);
    }
    const { DEMO_QUESTIONS } =
      await import('../../database/seed-data/demo-exams.ts');
    const answerOf = new Map(DEMO_QUESTIONS.map((q) => [q.id, q.answer]));
    const started = await call(
      'emp_njl_2',
      'POST',
      '/my-exams/exam-cnc-cert/start',
    );
    expect(started.status).toBe(200);
    const attempt = started.json.data;
    expect(attempt.items).toHaveLength(10);
    // The paper never carries the answers.
    expect(JSON.stringify(attempt.items)).not.toContain('"answer"');
    const answers = Object.fromEntries(
      attempt.items.map((item: Json) => [
        item.questionId,
        answerOf.get(item.questionId),
      ]),
    );
    const submitted = await call(
      'emp_njl_2',
      'POST',
      `/attempts/${attempt.id}/submit`,
      { answers },
    );
    expect(submitted.status).toBe(200);
    const result = await call(
      'emp_njl_2',
      'GET',
      `/attempts/${attempt.id}/result`,
    );
    expect(result.json.data.status).toBe('passed');
    expect(result.json.data.score).toBe(100);

    const certification = await call(
      'emp_njl_2',
      'GET',
      '/certifications/cert-cnc',
    );
    expect(certification.json.data.mine.certificate.status).toBe('valid');
    expect(certification.json.data.grantedPages).toContain('demo.batchRecord');
    expect(
      (
        await call(
          'emp_njl_2',
          'POST',
          '/api/demo/batch-record/sign-filling',
          {},
        )
      ).status,
    ).toBe(200);
  });

  it('keeps grading to the exam owner', async () => {
    expect((await call('trainer01', 'GET', '/grading')).status).toBe(200);
    expect((await call('emp_njl_1', 'GET', '/grading')).status).toBe(403);
  });

  it('withdraws the permissions of a revoked certificate at once', async () => {
    const noReason = await call(
      'hr01',
      'POST',
      '/certificates/certificate-zhaoyang-cnc/revoke',
      {},
    );
    expect(noReason.json.code).toBe('REVOKE_REASON_REQUIRED');
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/certificates/certificate-zhaoyang-cnc/revoke',
          { reason: 'acceptance' },
        )
      ).status,
    ).toBe(403);
    const revoked = await call(
      'hr01',
      'POST',
      '/certificates/certificate-zhaoyang-cnc/revoke',
      { reason: '无菌更衣确认未通过' },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.json.data.status).toBe('revoked');
    expect(
      (
        await call(
          'emp_th_1',
          'POST',
          '/api/demo/batch-record/sign-filling',
          {},
        )
      ).status,
    ).toBe(403);
  });
});

describe('AI employees working on their own', () => {
  it('keeps the automation settings to HR administrators', async () => {
    const list = await call('hr01', 'GET', '/automations');
    expect(list.status).toBe(200);
    expect(list.json.data.map((a: Json) => a.key)).toContain(
      'frameworkAdvisor.dictionaryReview',
    );
    expect((await call('mgr_njl', 'GET', '/automations')).status).toBe(403);
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/automations/frameworkAdvisor.dictionaryReview/run',
        )
      ).status,
    ).toBe(403);
  });

  it('reviews the dictionary with rule-based suggestions when no model is configured', async () => {
    const run = await call(
      'hr01',
      'POST',
      '/automations/frameworkAdvisor.dictionaryReview/run',
    );
    expect(run.status).toBe(200);
    expect(run.json.data.status).toBe('succeeded');
    const detail = await call(
      'hr01',
      'GET',
      `/automations/runs/${run.json.data.runId}`,
    );
    expect(detail.json.data.fallback).toBe(true);
    const merges = (detail.json.data.output.suggestions as Json[]).filter(
      (s) => s.kind === 'merge',
    );
    expect(
      merges.some(
        (s) =>
          s.competencies.includes('质量记录规范') &&
          s.competencies.includes('过程记录完整性'),
      ),
    ).toBe(true);
  });

  it('reports each knowledge gap once', async () => {
    const first = await call(
      'hr01',
      'POST',
      '/automations/knowledgeAssistant.gapWeeklyReport/run',
    );
    expect(first.json.data.status).toBe('succeeded');
    expect(first.json.data.output.topics.length).toBeGreaterThan(0);
    const gaps = await call('hr01', 'GET', '/kb/gaps');
    expect((gaps.json.data as Json[]).every((gap) => gap.reportedAt)).toBe(
      true,
    );
    // Everything is reported, so a second run the same week has nothing to do.
    const second = await call(
      'hr01',
      'POST',
      '/automations/knowledgeAssistant.gapWeeklyReport/run',
    );
    expect(['skipped', 'duplicate']).toContain(second.json.data.status);
  });

  it('drafts requirements only for new positions, and honours the switch', async () => {
    const key = 'frameworkAdvisor.draftNewPositions';
    // The seeded filler position already has requirements.
    const idle = await call('hr01', 'POST', `/automations/${key}/run`);
    expect(idle.json.data.status).toBe('skipped');

    const created = await call('hr01', 'POST', '/framework/positions', {
      code: 'LYO-OP',
      title: '冻干机操作工',
      jobFamilyId: 'jf-prod',
      responsibilities: '按 SOP 装载、运行和卸载冻干机，记录冻干曲线。',
    });
    expect(created.status).toBe(201);
    // Drafting needs a model; without one the run fails rather than inventing requirements.
    const failed = await call('hr01', 'POST', `/automations/${key}/run`);
    expect(failed.json.data.status).toBe('failed');

    const off = await call('hr01', 'PATCH', `/automations/${key}`, {
      enabled: false,
    });
    expect(off.status).toBe(200);
    const disabled = await call('hr01', 'POST', `/automations/${key}/run`);
    expect(disabled.json.data.status).toBe('disabled');
  });

  it('assigns remedial learning after the last failed renewal attempt', async () => {
    for (let i = 0; i < 3; i += 1) {
      const started = await call(
        'emp_njl_3',
        'POST',
        '/my-exams/exam-cnc-cert/start',
      );
      expect(started.status, `attempt ${i + 1}`).toBe(200);
      const submitted = await call(
        'emp_njl_3',
        'POST',
        `/attempts/${started.json.data.id}/submit`,
        { answers: {} },
      );
      expect(submitted.status).toBe(200);
    }
    const run = await waitFor(async () => {
      const runs = await runsOf('certificationSteward.remedialLearning');
      return runs.find((r) => r.status !== 'running');
    }, 'remedial learning run');
    expect(run.status).toBe('succeeded');
    const assignments = await call('emp_njl_3', 'GET', '/learning/assignments');
    expect(
      (assignments.json.data.items ?? assignments.json.data).some(
        (a: Json) => a.source === 'remedial',
      ),
    ).toBe(true);
  });

  it('tops up questions when a course is published', async () => {
    const confirmed = await call(
      'trainer01',
      'POST',
      '/courses/course-safety-basics/confirm',
    );
    expect(confirmed.status).toBe(200);
    const published = await call(
      'trainer01',
      'POST',
      '/courses/course-safety-basics/publish',
      { published: true },
    );
    expect(published.status).toBe(200);
    const run = await waitFor(async () => {
      const runs = await runsOf('contentWriter.fillCourseQuestions');
      return runs.find(
        (r) =>
          r.status !== 'running' &&
          JSON.stringify(r.triggerRef).includes('course-safety-basics'),
      );
    }, 'question top-up run');
    // Writing questions needs a model; the run is recorded either way.
    expect(['succeeded', 'failed']).toContain(run.status);
  });
});

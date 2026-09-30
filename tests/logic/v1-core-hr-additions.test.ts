// @vitest-environment node

// Acceptance checks for the V1 step 2 additions (2026-09-30): 界面追加字段 on employee records, the onboarding form and
// self-service; 变动影响清单 for transfers, onboardings and offboardings; 用工合规检查; 一句话改配置 drafts; the HR
// assistant's own-change submission and access explanations. The real standalone server runs on a throwaway SQLite
// database with migrations and seeds; no model is configured, so the assistant's wording falls back to its templates.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';

import { scopeForUser } from '../../server/providers/hr/authorize.ts';
import {
  accessExplainerToken,
  customFieldServiceToken,
  hrCoreServiceToken,
  settingsDraftServiceToken,
} from '../../server/providers/hr/tokens.ts';
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
const PASSWORD = 'v1-additions-test-password';

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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-additions-'));
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
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const todayInShanghai = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

async function userIdOf(username: string): Promise<string> {
  const db = server.application.container.resolve(databaseManagerToken);
  const row = await db
    .query()
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', username)
    .executeTakeFirst();
  if (!row) throw new Error(`no user ${username}`);
  return String(row.id);
}

async function actorOf(username: string) {
  const authz = server.application.container.resolve(authorizationToken);
  const userId = await userIdOf(username);
  return { userId, authz: await scopeForUser(authz, userId) };
}

/** Background work (checklists, compliance) runs after the response; wait for it. */
async function eventually<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeout = 10_000,
): Promise<T> {
  const started = Date.now();
  let last = await read();
  while (!ok(last)) {
    if (Date.now() - started > timeout) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
    last = await read();
  }
  return last;
}

async function workbookFrom(buffer: ArrayBuffer): Promise<string[][]> {
  const XLSX = await import('xlsx');
  const book = XLSX.read(new Uint8Array(buffer), { type: 'array' });
  const sheet = book.Sheets[book.SheetNames[0]!]!;
  return XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
}

async function raw(username: string, url: string): Promise<ArrayBuffer> {
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      headers: { cookie: await signIn(username) },
    }),
  );
  expect(response.status).toBe(200);
  return response.arrayBuffer();
}

describe('界面追加字段', () => {
  let dorm: Json;

  it('an HR administrator adds 宿舍号 and it shows in the list, filter, import template and roster', async () => {
    const created = await call('hr01', 'POST', '/custom-fields', {
      collection: 'employees',
      label: { 'zh-CN': '宿舍号', 'en-US': 'Dorm' },
      type: 'text',
      placements: ['detail', 'list', 'filter', 'import', 'export'],
    });
    expect(created.status).toBe(201);
    dorm = created.json.data;
    expect(dorm.key).toMatch(/^cf_[0-9a-f]{8}$/u);

    const patched = await call('hr01', 'PATCH', '/employees/emp-wanglei', {
      customFields: { [dorm.key]: 'A-305', unknownKey: 'dropped' },
    });
    expect(patched.status).toBe(200);
    const detail = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(detail.json.data.employee.customFields).toEqual({
      [dorm.key]: 'A-305',
    });

    const list = await call('hr01', 'GET', `/employees?cf.${dorm.key}=A-3`);
    expect(list.json.data.items.map((e: Json) => e.id)).toEqual([
      'emp-wanglei',
    ]);
    expect(list.json.data.items[0].customFields[dorm.key]).toBe('A-305');

    const template = await workbookFrom(
      await raw('hr01', '/employees/import-template'),
    );
    expect(template[0]).toContain('宿舍号');
    const roster = await workbookFrom(await raw('hr01', '/employees/export'));
    const column = roster[0]!.indexOf('宿舍号');
    expect(column).toBeGreaterThan(0);
    expect(roster.find((row) => row[1] === '王磊')?.[column]).toBe('A-305');
  });

  it('rejects a value of the wrong type, and a manager cannot manage fields', async () => {
    const number = await call('hr01', 'POST', '/custom-fields', {
      collection: 'employees',
      label: { 'zh-CN': '工龄补贴档' },
      type: 'number',
    });
    expect(number.status).toBe(201);
    const bad = await call('hr01', 'PATCH', '/employees/emp-wanglei', {
      customFields: { [number.json.data.key]: 'abc' },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('CUSTOM_FIELD_INVALID');
    expect(
      (
        await call('mgr_njl', 'POST', '/custom-fields', {
          collection: 'employees',
          label: { 'zh-CN': '越权字段' },
          type: 'text',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('mgr_njl', 'GET', '/custom-fields?collection=employees'))
        .status,
    ).toBe(403);
  });

  it('opens the framework tables with only 详情 and 列表 placements', async () => {
    const created = await call('hr01', 'POST', '/custom-fields', {
      collection: 'competencies',
      label: { 'zh-CN': '适用工序' },
      type: 'text',
      placements: ['detail', 'list', 'import', 'selfService'],
    });
    expect(created.status).toBe(201);
    expect(created.json.data.placements).toEqual(['detail', 'list']);
    const listed = await call(
      'hr01',
      'GET',
      '/custom-fields?collection=competencies',
    );
    expect(listed.json.data.map((d: Json) => d.id)).toContain(
      created.json.data.id,
    );
    expect(
      (
        await call('hr01', 'POST', '/custom-fields', {
          collection: 'departments',
          label: { 'zh-CN': '不开放的表' },
          type: 'text',
        })
      ).status,
    ).toBe(400);
  });

  it('opens 请假单 for 工作交接人 with only 填写表单 and 详情', async () => {
    const created = await call('hr01', 'POST', '/custom-fields', {
      collection: 'leaveRequests',
      label: { 'zh-CN': '工作交接人' },
      type: 'text',
      placements: ['form', 'detail', 'list', 'selfService'],
    });
    expect(created.status).toBe(201);
    expect(created.json.data.placements).toEqual(['form', 'detail']);
    const listed = await call(
      'hr01',
      'GET',
      '/custom-fields?collection=leaveRequests',
    );
    expect(listed.status).toBe(200);
    expect(
      listed.json.data.find((d: Json) => d.id === created.json.data.id)?.filled,
    ).toBe(0);
    const definitions = await call(
      'emp_njl_2',
      'GET',
      '/custom-fields/definitions?collection=leaveRequests',
    );
    expect(definitions.json.data.map((d: Json) => d.key)).toContain(
      created.json.data.key,
    );
  });

  it('changes only what a PATCH sends, and checks required fields on a submission without values', async () => {
    const created = await call('hr01', 'POST', '/custom-fields', {
      collection: 'leaveRequests',
      label: { 'zh-CN': '紧急联系人电话' },
      type: 'text',
      placements: ['form', 'detail'],
      aiReadable: true,
    });
    expect(created.status).toBe(201);
    const patched = await call(
      'hr01',
      'PATCH',
      `/custom-fields/${created.json.data.id}`,
      { required: true },
    );
    expect(patched.status).toBe(200);
    expect(patched.json.data.required).toBe(true);
    expect(patched.json.data.placements).toEqual(['form', 'detail']);
    expect(patched.json.data.aiReadable).toBe(true);
    const service = server.application.container.resolve(
      customFieldServiceToken,
    );
    const definitions = await service.list('leaveRequests');
    expect(() =>
      service.prepare(definitions, undefined, {}, { enforceRequired: true }),
    ).toThrow('CUSTOM_FIELD_INVALID');
    expect(service.prepare(definitions, undefined, { kept: 1 })).toEqual({
      kept: 1,
    });
    // Leave it optional again for the other tests.
    await call('hr01', 'PATCH', `/custom-fields/${created.json.data.id}`, {
      required: false,
    });
  });

  it('opens 业务数据 for a 班次 field, without the employee-only placements', async () => {
    const created = await call('hr01', 'POST', '/custom-fields', {
      collection: 'businessSignals',
      label: { 'zh-CN': '班次' },
      type: 'select',
      options: [
        { value: 'day', label: '白班', active: true },
        { value: 'night', label: '夜班', active: true },
      ],
      placements: ['detail', 'list', 'filter', 'import', 'onboardForm'],
    });
    expect(created.status).toBe(201);
    expect(created.json.data.placements).toEqual([
      'detail',
      'list',
      'filter',
      'import',
    ]);
  });

  it('opens 考核方案 with 详情、列表 and 填写表单', async () => {
    const created = await call('hr01', 'POST', '/custom-fields', {
      collection: 'reviewSchemes',
      label: { 'zh-CN': '适用班组' },
      type: 'text',
      placements: ['detail', 'list', 'form', 'import'],
    });
    expect(created.status).toBe(201);
    expect(created.json.data.placements).toEqual(['detail', 'list', 'form']);
  });

  it('lists only employees with a mandatory gap under 待补能力, in the list and the roster', async () => {
    const all = await call('hr01', 'GET', '/employees');
    const gapped = await call('hr01', 'GET', '/employees?quick=hasGaps');
    expect(gapped.status).toBe(200);
    const ids = gapped.json.data.items.map((e: Json) => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(gapped.json.data.items.every((e: Json) => e.gapCount > 0)).toBe(
      true,
    );
    expect(
      all.json.data.items
        .filter((e: Json) => e.gapCount > 0)
        .map((e: Json) => e.id),
    ).toEqual(ids);
    const roster = await workbookFrom(
      await raw('hr01', '/employees/export?quick=hasGaps'),
    );
    expect(roster.length - 1).toBe(ids.length);
  });

  it('hides a sensitive field from a manager, and keeps values of a deactivated field', async () => {
    expect(
      (
        await call('hr01', 'PATCH', `/custom-fields/${dorm.id}`, {
          sensitive: true,
        })
      ).status,
    ).toBe(200);
    const manager = await call('mgr_east', 'GET', '/employees/emp-wanglei');
    expect(manager.json.data.employee.customFields[dorm.key]).toBeUndefined();
    const own = await call('emp_njl_1', 'GET', '/me');
    expect(own.json.data.employee.customFields[dorm.key]).toBe('A-305');
    await call('hr01', 'PATCH', `/custom-fields/${dorm.id}`, {
      sensitive: false,
    });

    expect(
      (
        await call('hr01', 'POST', `/custom-fields/${dorm.id}/active`, {
          active: false,
        })
      ).status,
    ).toBe(200);
    const template = await workbookFrom(
      await raw('hr01', '/employees/import-template'),
    );
    expect(template[0]).not.toContain('宿舍号');
    const detail = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(detail.json.data.employee.customFields[dorm.key]).toBe('A-305');
    await call('hr01', 'POST', `/custom-fields/${dorm.id}/active`, {
      active: true,
    });
  });

  it('carries 工服尺码 from the onboarding form to the new employee, and lets an employee request a change', async () => {
    const size = await call('hr01', 'POST', '/custom-fields', {
      collection: 'employees',
      label: { 'zh-CN': '工服尺码' },
      type: 'select',
      options: [
        { value: 'm', label: 'M' },
        { value: 'l', label: 'L' },
      ],
      placements: ['detail', 'export', 'onboardForm', 'selfService'],
    });
    expect(size.status).toBe(201);
    const key = size.json.data.key as string;
    const action = await call('hr01', 'POST', '/actions', {
      actionType: 'onboard',
      name: '测试新员工',
      employeeNo: 'QH2990',
      toDepartmentId: 'sz-mc',
      toPositionId: 'pos-cnc-operator',
      effectiveDate: todayInShanghai(),
      probationMonths: 2,
      customFields: { [key]: 'L' },
    });
    expect(action.status).toBe(201);
    // 机加工车间: 陈静 then HR (hr01 raised it, so that level passes).
    const decided = await call(
      'mgr_njl',
      'POST',
      `/actions/${action.json.data.id}/approve`,
      {},
    );
    expect(decided.status).toBe(200);
    expect(decided.json.data.status).toBe('effective');
    const employee = await call(
      'hr01',
      'GET',
      `/employees/${decided.json.data.employeeId}`,
    );
    expect(employee.json.data.employee.customFields[key]).toBe('l');

    // 李敏 has no pending request; hers goes through.
    const request = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { customFields: { [key]: 'M' } },
    });
    expect(request.status).toBe(201);
    const reviewed = await call(
      'hr01',
      'POST',
      `/profile-changes/${request.json.data.id}/approve`,
      {},
    );
    expect(reviewed.status).toBe(200);
    const limin = await call('hr01', 'GET', '/employees/emp-limin');
    expect(limin.json.data.employee.customFields[key]).toBe('m');
    // A field not placed for self-service is refused.
    const refused = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { customFields: { [dorm.key]: 'B-101' } },
    });
    expect(refused.status).toBe(400);
  });
});

describe('变动影响清单', () => {
  it('previews 王磊的调岗 for the approver, and hides it from the employee', async () => {
    const preview = await call(
      'mgr_east',
      'GET',
      '/checklists/by-action/action-wanglei-transfer',
    );
    expect(preview.status).toBe(200);
    const checklist = preview.json.data;
    expect(checklist.stage).toBe('preview');
    const byKey = Object.fromEntries(
      checklist.items.map((i: Json) => [i.key, i]),
    );
    expect(byKey.orgAccess.status).toBe('auto');
    expect(byKey.manager.code).toBe('managerChange');
    expect(byKey.manager.params).toMatchObject({
      current: '陈静',
      suggested: '周宏',
    });
    expect(byKey.contract.code).toBe('contractAmend');
    expect(
      (await call('emp_njl_1', 'GET', `/checklists/${checklist.id}`)).status,
    ).toBe(404);
  });

  it('opens the checklist for HR once the transfer takes effect, and adopts the suggested manager', async () => {
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).status,
    ).toBe(200);
    const done = await call(
      'hr01',
      'POST',
      '/actions/action-wanglei-transfer/approve',
      {},
    );
    expect(done.json.data.status).toBe('effective');
    const open = await eventually(
      () =>
        call('hr01', 'GET', '/checklists/by-action/action-wanglei-transfer'),
      (r) => r.json.data?.stage === 'open',
    );
    expect(open.json.data.stage).toBe('open');
    expect(open.json.data.aiSummary).toContain('直属上级');
    const id = open.json.data.id as string;
    expect(
      (
        await call('hr01', 'POST', `/checklists/${id}/items/contract`, {
          status: 'notNeeded',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          'hr01',
          'POST',
          `/checklists/${id}/items/manager/perform`,
          {},
        )
      ).status,
    ).toBe(200);
    const employee = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(employee.json.data.employee.managerEmployeeId).toBe('emp-mgr-east');
    const workbench = await call('hr01', 'GET', '/work-items?group=today');
    expect(JSON.stringify(workbench.json.data)).toContain('changeChecklist');
  });

  it('opens 邓凯的离职交接清单 when HR approves the resignation on a Feishu card', async () => {
    // The Feishu card handler calls decideAction with via=feishuCard.
    const core = server.application.container.resolve(hrCoreServiceToken);
    const decided = await core.decideAction(
      await actorOf('hr01'),
      'action-dengkai-offboard',
      'approve',
      null,
      'feishuCard',
    );
    expect(decided.status).toBe('approved');
    expect(decided.approvals.at(-1)?.via).toBe('feishuCard');
    const approved = await call(
      'hr01',
      'GET',
      '/actions/action-dengkai-offboard',
    );
    expect(approved.json.data.approvals.at(-1).via).toBe('feishuCard');
    const checklist = await eventually(
      () =>
        call('hr01', 'GET', '/checklists/by-action/action-dengkai-offboard'),
      (r) => r.json.data?.stage === 'open',
    );
    const keys = checklist.json.data.items.map((i: Json) => i.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'contract',
        'account',
        'handover',
        'leaveCertificate',
      ]),
    );
    expect(checklist.json.data.kind).toBe('offboard');
    expect(checklist.json.data.dueDate).toBe(approved.json.data.effectiveDate);
  });
});

describe('用工合规检查', () => {
  it('finds 陈晨, 郭凡 and 陈静, not 孙丽, and does not repeat itself', async () => {
    expect(
      (await call('hr01', 'POST', '/org/maintenance/run', {})).status,
    ).toBe(200);
    const list = await call('hr01', 'GET', '/compliance');
    expect(list.status).toBe(200);
    const found = list.json.data.map(
      (i: Json) => `${i.employeeName}:${i.kind}`,
    );
    expect(found).toEqual(
      expect.arrayContaining([
        '陈晨:probationLimit',
        '郭凡:noContract',
        '陈静:secondFixedTerm',
      ]),
    );
    expect(found.some((f: string) => f.startsWith('孙丽'))).toBe(false);
    const chen = list.json.data.find((i: Json) => i.kind === 'probationLimit');
    expect(chen.aiNote).toContain('提示，不是法律意见');
    await call('hr01', 'POST', '/org/maintenance/run', {});
    const again = await call('hr01', 'GET', '/compliance');
    expect(again.json.data.length).toBe(list.json.data.length);
    expect((await call('mgr_njl', 'GET', '/compliance')).status).toBe(403);
  });

  it('closes 郭凡的提示 once he has a contract', async () => {
    const contract = await call('hr01', 'POST', '/contracts', {
      employeeId: 'emp-guofan',
      contractNo: 'HT-TEST-GF',
      type: 'fixedTerm',
      startDate: todayInShanghai(),
      endDate: `${Number(todayInShanghai().slice(0, 4)) + 3}-01-01`,
    });
    expect(contract.status).toBe(201);
    const list = await eventually(
      () => call('hr01', 'GET', '/compliance'),
      (r) => !r.json.data.some((i: Json) => i.employeeName === '郭凡'),
    );
    expect(list.json.data.some((i: Json) => i.employeeName === '郭凡')).toBe(
      false,
    );
  });
});

describe('一句话改配置、对话提交与权限说明', () => {
  it('drafts a 成都工厂 厂长审批 rule with a merge warning, applies it and reverts it', async () => {
    const drafts = server.application.container.resolve(
      settingsDraftServiceToken,
    );
    const change = await drafts.draft(
      await actorOf('hr01'),
      '成都工厂的入职单在部门负责人之后加一级厂长审批',
      [
        {
          type: 'chainRule',
          department: '成都工厂',
          actionTypes: ['onboard'],
          name: '厂长审批',
          approver: { type: 'departmentHead' },
          position: 'afterFirst',
        },
      ],
    );
    expect(change.items[0]!.warnings).toContain('merged');
    const settingsBefore = await call('hr01', 'GET', '/personnel-settings');
    const rulesBefore =
      settingsBefore.json.data.approvalChain.value.rules.length;
    const applied = await call(
      'hr01',
      'POST',
      `/settings-drafts/${change.id}/items/0/apply`,
      {},
    );
    expect(applied.status).toBe(200);
    const settingsAfter = await call('hr01', 'GET', '/personnel-settings');
    expect(settingsAfter.json.data.approvalChain.value.rules.length).toBe(
      rulesBefore + 1,
    );
    const reverted = await call(
      'hr01',
      'POST',
      `/settings-drafts/${change.id}/revert`,
      {},
    );
    expect(reverted.json.data.status).toBe('reverted');
    const settingsFinal = await call('hr01', 'GET', '/personnel-settings');
    expect(settingsFinal.json.data.approvalChain.value.rules.length).toBe(
      rulesBefore,
    );
    await expect(
      drafts.draft(await actorOf('mgr_njl'), 'x', [
        {
          type: 'setting',
          section: 'reminders',
          changes: { probationDays: 5 },
        },
      ]),
    ).rejects.toThrow();
  });

  it('records an employee request made through the HR assistant as source=assistant', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    await db
      .query()
      .updateTable('profileChangeRequests')
      .set({ status: 'rejected' })
      .where('employeeId', '=', 'emp-limin')
      .where('status', '=', 'pending')
      .execute();
    const core = server.application.container.resolve(hrCoreServiceToken);
    const request = await core.requestProfileChange(
      await actorOf('emp_njl_2'),
      { address: '测试市新地址 1 号' },
      'assistant',
    );
    expect(request.source).toBe('assistant');
    await expect(
      core.requestProfileChange(
        await actorOf('emp_njl_2'),
        { positionId: 'x' },
        'assistant',
      ),
    ).rejects.toThrow();
  });

  it('records an employee request submitted from a Feishu card as source=feishuCard', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    await db
      .query()
      .updateTable('profileChangeRequests')
      .set({ status: 'rejected' })
      .where('employeeId', '=', 'emp-limin')
      .where('status', '=', 'pending')
      .execute();
    const core = server.application.container.resolve(hrCoreServiceToken);
    const request = await core.requestProfileChange(
      await actorOf('emp_njl_2'),
      { address: '南京市江宁区新地址 2 号' },
      'feishuCard',
    );
    expect(request.source).toBe('feishuCard');
    // It blocks a second request from the page, like one made on the page.
    await expect(
      core.requestProfileChange(await actorOf('emp_njl_2'), {
        address: '南京市江宁区新地址 3 号',
      }),
    ).rejects.toThrow();
  });

  it('explains why 陈静 cannot see 孙丽, and only lets her ask about herself', async () => {
    const explainer =
      server.application.container.resolve(accessExplainerToken);
    const answer = await explainer.explain(await actorOf('mgr_njl'), {
      employee: '孙丽',
    });
    expect(answer.employee?.viewerCanView).toBe(false);
    expect(answer.employee?.department).toBe('装配车间');
    expect(answer.employee?.departmentHead).toBe('周宏');
    expect(answer.permissionSets.map((s) => s.key)).toContain('hr.manager');
    await expect(
      explainer.explain(await actorOf('mgr_njl'), {
        user: '周宏',
        employee: '王磊',
      }),
    ).rejects.toThrow('ACCESS_EXPLAIN_SELF_ONLY');
  });
});

describe('招聘衔接 (V2-07)', () => {
  it('opens 候选人 for the public form, and refuses 可用于初筛 on a protected characteristic', async () => {
    const date = await call('hr01', 'POST', '/custom-fields', {
      collection: 'candidates',
      label: { 'zh-CN': '可到岗日期' },
      type: 'date',
      placements: ['detail', 'publicApply', 'selfService'],
    });
    expect(date.status).toBe(201);
    expect(date.json.data.placements).toEqual(['detail', 'publicApply']);
    const marked = await call(
      'hr01',
      'PATCH',
      `/custom-fields/${date.json.data.id}`,
      { aiReadable: true },
    );
    expect(marked.status).toBe(200);
    expect(marked.json.data.aiReadable).toBe(true);
    const protectedField = await call('hr01', 'POST', '/custom-fields', {
      collection: 'candidates',
      label: { 'zh-CN': '婚育情况' },
      type: 'text',
      aiReadable: true,
    });
    expect(protectedField.status).toBe(400);
    expect(protectedField.json.code).toBe('CUSTOM_FIELD_PROTECTED_AI');
    // Renaming an AI-readable field into a protected one is refused as well.
    const renamed = await call(
      'hr01',
      'PATCH',
      `/custom-fields/${date.json.data.id}`,
      { label: { 'zh-CN': '出生日期' } },
    );
    expect(renamed.status).toBe(400);
    expect(renamed.json.code).toBe('CUSTOM_FIELD_PROTECTED_AI');
  });

  it('keeps the offer an onboarding action came from and the fields read from the ID', async () => {
    const onboardFields = await call(
      'hr01',
      'GET',
      '/custom-fields/definitions?collection=employees',
    );
    const required = Object.fromEntries(
      (onboardFields.json.data as Json[])
        .filter(
          (d) => d.active && d.required && d.placements.includes('onboardForm'),
        )
        .map((d) => [
          d.key,
          d.options?.find((o: Json) => o.active)?.value ?? '待定',
        ]),
    );
    const action = await call('hr01', 'POST', '/actions', {
      actionType: 'onboard',
      name: '周迪',
      employeeNo: 'QH2991',
      toDepartmentId: 'sz-mc',
      toPositionId: 'pos-cnc-operator',
      effectiveDate: todayInShanghai(),
      probationMonths: 2,
      offerId: 'offer-zhoudi',
      recognizedFields: ['name', 'idNumber', 'name'],
      customFields: required,
    });
    expect(action.status).toBe(201);
    expect(action.json.data.candidate.offerId).toBe('offer-zhoudi');
    expect(action.json.data.candidate.recognizedFields).toEqual([
      'name',
      'idNumber',
    ]);
    const bad = await call('hr01', 'POST', '/actions', {
      actionType: 'onboard',
      name: '周迪',
      employeeNo: 'QH2992',
      toDepartmentId: 'sz-mc',
      toPositionId: 'pos-cnc-operator',
      effectiveDate: todayInShanghai(),
      offerId: 'offer-zhoudi',
      recognizedFields: 'name',
      customFields: required,
    });
    expect(bad.status).toBe(400);
    await call('hr01', 'POST', `/actions/${action.json.data.id}/cancel`, {});
  });
});

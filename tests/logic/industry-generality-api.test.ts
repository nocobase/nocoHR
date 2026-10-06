// @vitest-environment node

// Organisation fields and employment types for every industry, against the real server (启衡精密 demo data): hr01 adds
// fields to departments and positions in 字段管理, fills them on 组织管理 and 岗位, and reads them back; values are
// checked like every other added field, sensitive ones reach only those who manage positions, and a new hire may be a
// 季节工. Boots the standalone server on a throwaway SQLite database, like v2-leave-custom-fields.
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
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'industry-generality-test-password';

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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-industry-api-'));
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
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_PAYROLL_DEMO;
  delete process.env.ATTENDANCE_PUNCH_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function defineField(input: Json) {
  const created = await call('hr01', 'POST', '/custom-fields', input);
  expect(created.status).toBe(201);
  return created.json.data as { id: string; key: string };
}

describe('added fields on departments', () => {
  let area: { key: string };

  beforeAll(async () => {
    area = await defineField({
      collection: 'departments',
      label: { 'zh-CN': '营业面积（㎡）', 'en-US': 'Floor area (m²)' },
      type: 'number',
      placements: ['form', 'detail'],
    });
  });

  it('saves a value on 组织管理 and lists it with the department', async () => {
    const saved = await call('hr01', 'PATCH', '/org/departments/cd-mc', {
      customFields: { [area.key]: '320' },
    });
    expect(saved.status).toBe(200);
    expect(saved.json.data.customFields).toEqual({ [area.key]: 320 });
    const listed = await call('hr01', 'GET', '/org/departments');
    expect(listed.status).toBe(200);
    const department = (listed.json.data as Json[]).find(
      (d) => d.id === 'cd-mc',
    )!;
    expect(department.customFields).toEqual({ [area.key]: 320 });
    // An edit that sends no added fields keeps them.
    const renamed = await call('hr01', 'PATCH', '/org/departments/cd-mc', {
      sortOrder: department.sortOrder,
    });
    expect(renamed.json.data.customFields).toEqual({ [area.key]: 320 });
  });

  it('creates a department with its added fields', async () => {
    const created = await call('hr01', 'POST', '/org/departments', {
      title: '南京东路店',
      code: 'IND-STORE-1',
      parentId: 'cd-mc',
      customFields: { [area.key]: 180 },
    });
    expect(created.status).toBe(201);
    expect(created.json.data.customFields).toEqual({ [area.key]: 180 });
  });

  it('refuses an invalid value before writing anything', async () => {
    const refused = await call('hr01', 'POST', '/org/departments', {
      title: '不应创建',
      code: 'IND-STORE-X',
      customFields: { [area.key]: 'large' },
    });
    expect(refused.status).toBe(400);
    expect(refused.json.error?.code ?? refused.json.code).toBe(
      'CUSTOM_FIELD_INVALID',
    );
    const listed = await call('hr01', 'GET', '/org/departments');
    expect(
      (listed.json.data as Json[]).some((d) => d.code === 'IND-STORE-X'),
    ).toBe(false);
  });

  it('needs a session and the departments settings item', async () => {
    expect(
      (
        await call(null, 'PATCH', '/org/departments/cd-mc', {
          customFields: { [area.key]: 1 },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call('emp_njl_2', 'PATCH', '/org/departments/cd-mc', {
          customFields: { [area.key]: 1 },
        })
      ).status,
    ).toBe(403);
  });
});

describe('added fields on positions', () => {
  let licence: { key: string };
  let secret: { key: string };

  beforeAll(async () => {
    licence = await defineField({
      collection: 'positions',
      label: { 'zh-CN': '执业资格要求', 'en-US': 'Required licence' },
      type: 'text',
      placements: ['form', 'detail'],
    });
    secret = await defineField({
      collection: 'positions',
      label: { 'zh-CN': '岗位津贴上限', 'en-US': 'Allowance cap' },
      type: 'number',
      placements: ['form', 'detail'],
      sensitive: true,
    });
  });

  it('saves values on the position form and returns them with the position', async () => {
    const before = await call('hr01', 'GET', '/positions');
    expect(before.status).toBe(200);
    const position = (before.json.data.positions as Json[]).find(
      (p) => p.id === 'pos-cnc-operator',
    )!;
    const saved = await call(
      'hr01',
      'PATCH',
      '/framework/positions/pos-cnc-operator',
      {
        code: position.code,
        title: position.title,
        jobFamilyId: position.jobFamilyId,
        grade: position.grade,
        responsibilities: position.responsibilities,
        customFields: { [licence.key]: ' 数控车工四级 ', [secret.key]: 800 },
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.json.data.customFields).toEqual({
      [licence.key]: '数控车工四级',
      [secret.key]: 800,
    });
    const after = await call('hr01', 'GET', '/positions');
    expect(
      (after.json.data.positions as Json[]).find(
        (p) => p.id === 'pos-cnc-operator',
      )!.customFields,
    ).toEqual({ [licence.key]: '数控车工四级', [secret.key]: 800 });
    // A save that sends no added fields (an import, an AI tool) keeps them.
    const plain = await call(
      'hr01',
      'PATCH',
      '/framework/positions/pos-cnc-operator',
      {
        code: position.code,
        title: position.title,
        jobFamilyId: position.jobFamilyId,
        grade: position.grade,
        responsibilities: position.responsibilities,
      },
    );
    expect(plain.json.data.customFields).toEqual({
      [licence.key]: '数控车工四级',
      [secret.key]: 800,
    });
  });

  it('shows readers who do not manage positions only the non-sensitive values', async () => {
    // A department head reads positions but does not manage them.
    const read = await call('mgr_njl', 'GET', '/positions');
    expect(read.status).toBe(200);
    expect(read.json.data.canManage).toBe(false);
    expect(
      (read.json.data.positions as Json[]).find(
        (p) => p.id === 'pos-cnc-operator',
      )!.customFields,
    ).toEqual({ [licence.key]: '数控车工四级' });
  });
});

describe('employment types', () => {
  it('hires a 季节工 and refuses an unknown type', async () => {
    const seasonal = await call('hr01', 'POST', '/employees', {
      employeeNo: 'QH9401',
      name: '季小林',
      departmentId: 'cd-mc',
      positionId: 'pos-cnc-operator',
      hireDate: '2026-10-01',
      status: 'probation',
      employmentType: 'seasonal',
    });
    expect(seasonal.status).toBe(201);
    const id = String(seasonal.json.data.id ?? seasonal.json.data.employee?.id);
    const { databaseManagerToken } = await import('@nocobase/db');
    const row = await server.application.container
      .resolve(databaseManagerToken)
      .query()
      .selectFrom('employees')
      .select(['employmentType'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(row.employmentType).toBe('seasonal');
    const unknown = await call('hr01', 'POST', '/employees', {
      employeeNo: 'QH9402',
      name: '未知类型',
      departmentId: 'cd-mc',
      hireDate: '2026-10-01',
      status: 'probation',
      employmentType: 'contractor',
    });
    expect(unknown.status).toBe(400);
  });
});

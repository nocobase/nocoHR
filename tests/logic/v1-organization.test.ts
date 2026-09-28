// @vitest-environment node

// Acceptance checks for V1 step 1 as rewritten on 2026-09-28 (organisation and employees): the Excel import with
// batches, the HR assistant's health check, manager loops, deleting a mistaken import and the positions page. Each
// run boots the real standalone
// server on a throwaway SQLite database with migrations and seeds, so the demo database stays untouched.
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
const PASSWORD = 'v1-organization-test-password';

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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-organization-'));
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

async function upload(
  username: string,
  url: string,
  file: Buffer,
): Promise<{ status: number; json: Json }> {
  const body = new FormData();
  body.append(
    'file',
    new Blob([new Uint8Array(file)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'import.xlsx',
  );
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      method: 'POST',
      headers: {
        cookie: await signIn(username),
        origin: 'http://localhost',
      },
      body,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

async function workbook(rows: readonly (readonly string[])[]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const { DEMO_IMPORT_HEADER } =
    await import('../../database/seed-data/demo.ts');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [...DEMO_IMPORT_HEADER],
      ...rows.map((r) => [...r]),
    ]),
    'employees',
  );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** The health check runs in the background after the commit; wait until its run for the batch has finished. */
async function checkRuns(batchId: string, count = 1): Promise<Json[]> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const runs = await call(
      'hr01',
      'GET',
      '/automations/runs?task=hrAssistant.importCheck',
    );
    const mine = (runs.json.data as Json[]).filter(
      (r) => r.triggerRef?.batchId === batchId && r.status !== 'running',
    );
    if (mine.length >= count) return mine;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no finished health check for ${batchId}`);
}

const shared: { batch?: string; positionId?: string } = {};

describe('Excel import with batches', () => {
  it('tells the importer only "no problems" for a clean file', async () => {
    const { DEMO_IMPORT_SAMPLE } =
      await import('../../database/seed-data/demo.ts');
    const preview = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook(DEMO_IMPORT_SAMPLE.slice(0, 1)),
    );
    const committed = await call('hr01', 'POST', '/employees/import/commit', {
      rows: preview.json.data.rows,
    });
    const [run] = await checkRuns(committed.json.data.batchId);
    const detail = await call('hr01', 'GET', `/automations/runs/${run.id}`);
    expect(detail.json.data.output.report).toBe('本次导入未发现问题。');
  });

  it('previews errors, updates, creations and the positions it would create', async () => {
    const { DEMO_IMPORT_SAMPLE } =
      await import('../../database/seed-data/demo.ts');
    const preview = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook(DEMO_IMPORT_SAMPLE),
    );
    expect(preview.status).toBe(200);
    const rows = preview.json.data.rows as Json[];
    const byLine = new Map(rows.map((r) => [r.line, r]));
    // Row 9 (line 10): unknown department code; row 10 (line 11): the employee number of row 5 again.
    expect(byLine.get(10)!.errors).toContain('IMPORT_DEPARTMENT_NOT_FOUND');
    expect(byLine.get(11)!.errors).toContain('IMPORT_EMPLOYEE_NO_DUPLICATE');
    expect(preview.json.data.newPositions).toEqual(['数控操作工']);
    // A department employee cannot even preview.
    expect(
      (
        await upload(
          'mgr_njl',
          '/employees/import/preview',
          await workbook(DEMO_IMPORT_SAMPLE),
        )
      ).status,
    ).toBe(403);
  });

  it('imports in one transaction: two updates, six new employees, one new position in the batch', async () => {
    const { DEMO_IMPORT_SAMPLE } =
      await import('../../database/seed-data/demo.ts');
    const preview = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook(DEMO_IMPORT_SAMPLE.slice(0, 8)),
    );
    expect(preview.json.data.created).toBe(6);
    expect(preview.json.data.updated).toBe(2);
    const rows = preview.json.data.rows;
    const families = preview.json.data.jobFamilies as Json[];
    // Without a job family for the new position the import is refused.
    const refused = await call('hr01', 'POST', '/employees/import/commit', {
      rows,
    });
    expect(refused.json.code).toBe('IMPORT_NEW_POSITION_FAMILY_REQUIRED');
    const prod = families.find((f) => f.title === '生产序列')!;
    const committed = await call('hr01', 'POST', '/employees/import/commit', {
      rows,
      newPositionFamilies: { 数控操作工: prod.id },
    });
    expect(committed.status).toBe(200);
    expect(committed.json.data).toMatchObject({
      created: 6,
      updated: 2,
      createdPositions: 1,
    });
    shared.batch = committed.json.data.batchId;
    const batch = await call(
      'hr01',
      'GET',
      `/employees?batch=${encodeURIComponent(shared.batch!)}`,
    );
    expect(batch.json.data.items).toHaveLength(8);
    const positions = await call('hr01', 'GET', '/positions');
    const created = (positions.json.data.positions as Json[]).find(
      (p) => p.title === '数控操作工',
    )!;
    expect(created.importBatchId).toBe(shared.batch);
    shared.positionId = created.id;
  });

  it('checks the import as the owner: must-fix and suggested items, no mobile numbers, nothing changed', async () => {
    const before = await call('hr01', 'GET', '/employees');
    const [run] = await checkRuns(shared.batch!);
    expect(run.status).toBe('succeeded');
    const detail = await call('hr01', 'GET', `/automations/runs/${run.id}`);
    // No model is configured in tests: the report comes from the template.
    expect(detail.json.data.fallback).toBe(true);
    // V1-01 expects 3 must-fix and 4 suggested on step-1 data, where 成都工厂 has no head yet. This seed already
    // contains step 2 (何伟 heads 成都工厂), so 成都机加工车间's missing head is only a suggestion and 邓川 gets 何伟 as
    // the candidate manager: 2 must-fix (孙丽, the 张涛/韦青 loop) and 5 suggested.
    expect(detail.json.data.output).toMatchObject({ mustFix: 2, suggested: 5 });
    const report = detail.json.data.output.report as string;
    expect(report).toContain('孙丽');
    expect(report).toContain('张涛');
    expect(report).toContain('邓川');
    expect(report).toContain('刘芳');
    expect(report).toContain('数控操作工');
    expect(report).toContain('/talent/employees?ids=');
    expect(report).not.toMatch(/1\d{10}|139 0000/u);
    expect(JSON.stringify(detail.json.data)).not.toMatch(/1390000\d{4}/u);
    const latest = await call('hr01', 'GET', '/employees/imports/latest');
    expect(latest.json.data.check).toMatchObject({ mustFix: 2, suggested: 5 });
    // Suggestions only: the employee records are the same as before the check.
    const after = await call('hr01', 'GET', '/employees');
    expect(after.json.data.items).toEqual(before.json.data.items);
    // A manager sees no import summary.
    expect(
      (await call('mgr_njl', 'GET', '/employees/imports/latest')).json.data,
    ).toBeNull();
  });

  it('checks a batch once; a replay is recorded as skipped, a manual re-run makes a new report', async () => {
    const platformModule = await import('../../server/providers/hr/tokens.ts');
    const tasks = server.application.container.resolve(
      platformModule.automationTasksToken,
    );
    const replay = await tasks.onEmployeesImported(shared.batch!);
    expect(replay.status).toBe('duplicate');
    const runs = await checkRuns(shared.batch!, 2);
    expect(runs.some((r) => r.status === 'skipped')).toBe(true);
    const rerun = await call(
      'hr01',
      'POST',
      `/automations/import-check/${encodeURIComponent(shared.batch!)}`,
    );
    expect(rerun.json.data.status).toBe('succeeded');
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          `/automations/import-check/${encodeURIComponent(shared.batch!)}`,
        )
      ).status,
    ).toBe(403);
  });

  it('follows the synonym groups administrators edit', async () => {
    const saved = await call(
      'hr01',
      'PATCH',
      '/automations/hrAssistant.importCheck',
      {
        params: {
          synonyms: 'CNC/数控; 操作工/操作员; 班组长/组长; 装配工/组装工',
        },
      },
    );
    expect(saved.status).toBe(200);
    const preview = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook([
        [
          'QH2201',
          '周明',
          'SZ-AS',
          '组装工',
          'QH1002',
          '2026-07-01',
          'zm@qiheng.test',
          '13900002201',
        ],
      ]),
    );
    const families = preview.json.data.jobFamilies as Json[];
    const committed = await call('hr01', 'POST', '/employees/import/commit', {
      rows: preview.json.data.rows,
      newPositionFamilies: { 组装工: families[0].id },
    });
    const [run] = await checkRuns(committed.json.data.batchId);
    const detail = await call('hr01', 'GET', `/automations/runs/${run.id}`);
    expect(detail.json.data.output.report).toMatch(
      /组装工[\s\S]*装配工|装配工[\s\S]*组装工/u,
    );
    // Managers cannot change the configuration.
    expect(
      (
        await call('mgr_njl', 'PATCH', '/automations/hrAssistant.importCheck', {
          enabled: false,
        })
      ).status,
    ).toBe(403);
  });

  it('records a switched-off check as skipped', async () => {
    await call('hr01', 'PATCH', '/automations/hrAssistant.importCheck', {
      enabled: false,
    });
    const { DEMO_IMPORT_SAMPLE } =
      await import('../../database/seed-data/demo.ts');
    const preview = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook(DEMO_IMPORT_SAMPLE.slice(0, 1)),
    );
    const committed = await call('hr01', 'POST', '/employees/import/commit', {
      rows: preview.json.data.rows,
    });
    const [run] = await checkRuns(committed.json.data.batchId);
    expect(run.status).toBe('skipped');
    expect(run.error).toBe('DISABLED');
    await call('hr01', 'PATCH', '/automations/hrAssistant.importCheck', {
      enabled: true,
    });
  });
});

describe('employee rules', () => {
  it('rejects a manager loop and the employee as their own manager', async () => {
    const loop = await call('hr01', 'PATCH', '/employees/emp-mgr-njl', {
      managerEmployeeId: 'emp-wanglei',
    });
    expect(loop.status).toBe(409);
    expect(loop.json.code).toBe('EMPLOYEE_MANAGER_CYCLE');
    expect(loop.json.details.names).toEqual(['陈静', '王磊']);
    const self = await call('hr01', 'PATCH', '/employees/emp-wanglei', {
      managerEmployeeId: 'emp-wanglei',
    });
    expect(self.json.code).toBe('EMPLOYEE_MANAGER_SELF');
  });

  it('deletes a mistakenly imported employee without an account, never one with an account', async () => {
    const list = await call(
      'hr01',
      'GET',
      `/employees?batch=${encodeURIComponent(shared.batch!)}`,
    );
    const weiqing = (list.json.data.items as Json[]).find(
      (e) => e.name === '韦青',
    )!;
    expect(
      (await call('mgr_njl', 'DELETE', `/employees/${weiqing.id}`)).status,
    ).toBe(403);
    // 张涛 reports to 韦青, so 韦青 is referenced until that changes.
    const referenced = await call('hr01', 'DELETE', `/employees/${weiqing.id}`);
    expect(referenced.json.code).toBe('EMPLOYEE_DELETE_REFERENCED');
    const zhangtao = (list.json.data.items as Json[]).find(
      (e) => e.name === '张涛',
    )!;
    expect(
      (
        await call('hr01', 'PATCH', `/employees/${zhangtao.id}`, {
          managerEmployeeId: 'emp-mgr-east',
        })
      ).status,
    ).toBe(200);
    expect(
      (await call('hr01', 'DELETE', `/employees/${weiqing.id}`)).status,
    ).toBe(200);
    const wanglei = await call('hr01', 'DELETE', '/employees/emp-wanglei');
    expect(wanglei.json.code).toBe('EMPLOYEE_DELETE_HAS_USER');
  });

  it('refuses a disabled position for a new choice', async () => {
    const disabled = await call(
      'hr01',
      'POST',
      '/framework/positions/pos-office-trainer/active',
      { active: false },
    );
    expect(disabled.status).toBe(200);
    const choose = await call('hr01', 'PATCH', '/employees/emp-limin', {
      positionId: 'pos-office-trainer',
    });
    expect(choose.json.code).toBe('EMPLOYEE_POSITION_INACTIVE');
  });
});

describe('positions page', () => {
  it('shows employees only enabled positions, read-only, without the headcount link', async () => {
    const employee = await call('emp_njl_1', 'GET', '/positions');
    expect(employee.status).toBe(200);
    const titles = (employee.json.data.positions as Json[]).map((p) => p.title);
    expect(titles).toContain('CNC 操作工');
    expect(titles).not.toContain('培训专员');
    expect(employee.json.data.canManage).toBe(false);
    expect(employee.json.data.canViewEmployees).toBe(false);
    const hr = await call('hr01', 'GET', '/positions');
    expect(
      (hr.json.data.positions as Json[]).some((p) => p.title === '培训专员'),
    ).toBe(true);
    expect(
      (
        await call('emp_njl_1', 'POST', '/framework/positions', {
          code: 'qc',
          title: '质检员',
          jobFamilyId: 'jf-prod',
        })
      ).status,
    ).toBe(403);
    // Employees cannot open the employee list.
    expect((await call('emp_njl_1', 'GET', '/employees')).status).toBe(403);
  });
});

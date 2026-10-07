// @vitest-environment node

// 初始数据导入 (上线准备): the department, position, contract and opening-leave-balance importers under
// /api/talent/data-import/<kind>. Each run boots the real standalone server on a throwaway SQLite database with
// migrations and seeds (the employee import's harness, tests/logic/v1-organization.test.ts).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// Seeds import `database/seed-data/*` with `.js` specifiers; map them to their `.ts` sources after a miss.
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
const PASSWORD = 'data-import-test-password';

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
): Promise<{ status: number; json: Json; bytes?: ArrayBuffer }> {
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
  if (
    response.headers
      .get('content-type')
      ?.includes('spreadsheetml') /* a template */
  )
    return {
      status: response.status,
      json: {},
      bytes: await response.arrayBuffer(),
    };
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

async function upload(
  username: string | null,
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
  const headers: Record<string, string> = { origin: 'http://localhost' };
  if (username) headers.cookie = await signIn(username);
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      method: 'POST',
      headers,
      body,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

function workbook(rows: readonly (readonly (string | number)[])[]): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(rows.map((r) => [...r])),
    'data',
  );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Preview, then commit the previewed rows; asserts the preview was clean. */
async function importRows(
  kind: string,
  rows: readonly (readonly (string | number)[])[],
): Promise<{ preview: Json; commit: { status: number; json: Json } }> {
  const preview = await upload(
    'hr01',
    `/data-import/${kind}/preview`,
    workbook(rows),
  );
  expect(preview.status).toBe(200);
  const errors = (preview.json.data.rows as Json[]).filter(
    (r) => r.errors.length,
  );
  expect(errors).toEqual([]);
  const commit = await call('hr01', 'POST', `/data-import/${kind}/commit`, {
    rows: preview.json.data.rows,
  });
  return { preview: preview.json.data, commit };
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken).query();
}

const errorsOf = (preview: Json, line: number): string[] =>
  ((preview.rows as Json[]).find((r) => r.line === line)?.errors as Json[]).map(
    (e) => `${e.column}:${e.code}`,
  );

const YEAR = new Date().getFullYear();

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-data-import-'));
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

describe('access', () => {
  it.each(['departments', 'positions', 'contracts', 'leave-balances'])(
    '%s: 401 signed out, 403 for employees and managers, 200 for HR',
    async (kind) => {
      expect(
        (await call(null, 'GET', `/data-import/${kind}/status`)).status,
      ).toBe(401);
      expect(
        (await upload(null, `/data-import/${kind}/preview`, workbook([['x']])))
          .status,
      ).toBe(401);
      for (const user of ['emp_njl_1', 'mgr_njl']) {
        expect(
          (await call(user, 'GET', `/data-import/${kind}/status`)).status,
        ).toBe(403);
        expect(
          (await call(user, 'GET', `/data-import/${kind}/template`)).status,
        ).toBe(403);
        expect(
          (
            await upload(
              user,
              `/data-import/${kind}/preview`,
              workbook([['x']]),
            )
          ).status,
        ).toBe(403);
        expect(
          (
            await call(user, 'POST', `/data-import/${kind}/commit`, {
              rows: [],
            })
          ).status,
        ).toBe(403);
      }
      const status = await call('hr01', 'GET', `/data-import/${kind}/status`);
      expect(status.status).toBe(200);
      expect(status.json.data).toMatchObject({ lastImportedAt: null });
      expect(typeof status.json.data.count).toBe('number');
    },
  );

  it('answers 404 for an unknown importer', async () => {
    expect(
      (await call('hr01', 'GET', '/data-import/salaries/status')).status,
    ).toBe(404);
  });
});

describe('templates', () => {
  it.each([
    [
      'departments',
      ['部门编码', '部门名称', '上级部门编码', '负责人工号', '排序'],
    ],
    ['positions', ['岗位编码', '岗位名称', '岗位序列', '职级', '所属部门编码']],
    [
      'contracts',
      [
        '工号',
        '合同编号',
        '合同类型',
        '开始日期',
        '结束日期',
        '签订日期',
        '试用期结束日期',
        '备注',
      ],
    ],
    [
      'leave-balances',
      ['工号', '假期类型', '年度', '期初余额(天)', '已用(天)', '备注'],
    ],
  ])('%s template has the columns and an example row', async (kind, header) => {
    const response = await call('hr01', 'GET', `/data-import/${kind}/template`);
    expect(response.status).toBe(200);
    const book = XLSX.read(new Uint8Array(response.bytes!), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<string[]>(
      book.Sheets[book.SheetNames[0]!]!,
      { header: 1, defval: '' },
    );
    expect(rows[0]).toEqual(header);
    expect(rows.length).toBeGreaterThan(1);
  });

  it('refuses a file without the required columns', async () => {
    const response = await upload(
      'hr01',
      '/data-import/departments/preview',
      workbook([['名称'], ['总部']]),
    );
    expect(response.status).toBe(400);
    expect(response.json.code).toBe('DATA_IMPORT_HEADER_INVALID');
  });
});

const DEPARTMENT_HEADER = [
  '部门编码',
  '部门名称',
  '上级部门编码',
  '负责人工号',
  '排序',
];

describe('departments', () => {
  it('previews unknown parents, cycles, duplicates and bad heads without writing', async () => {
    const before = (
      await call('hr01', 'GET', '/data-import/departments/status')
    ).json.data.count;
    const preview = await upload(
      'hr01',
      '/data-import/departments/preview',
      workbook([
        DEPARTMENT_HEADER,
        ['X-A', '甲部', 'X-B', '', ''], // 2: cycle with 3
        ['X-B', '乙部', 'X-A', '', ''], // 3
        ['X-C', '丙部', 'NOPE', '', ''], // 4: unknown parent
        ['X-D', '丁部', '', 'QH0000', ''], // 5: unknown employee
        ['X-D', '丁部二', '', '', 'x'], // 6: duplicate code, bad sort order
        ['X-E', '', 'X-E', '', ''], // 7: no name, own parent
      ]),
    );
    expect(preview.status).toBe(200);
    const data = preview.json.data;
    expect(errorsOf(data, 2)).toContain('parentCode:DEPARTMENT_CYCLE');
    expect(errorsOf(data, 3)).toContain('parentCode:DEPARTMENT_CYCLE');
    expect(errorsOf(data, 4)).toEqual(['parentCode:PARENT_NOT_FOUND']);
    expect(errorsOf(data, 5)).toEqual(
      expect.arrayContaining([
        'code:DUPLICATE_IN_FILE',
        'managerNo:EMPLOYEE_NOT_FOUND',
      ]),
    );
    expect(errorsOf(data, 6)).toEqual(
      expect.arrayContaining([
        'code:DUPLICATE_IN_FILE',
        'sortOrder:INTEGER_INVALID',
      ]),
    );
    expect(errorsOf(data, 7)).toEqual(
      expect.arrayContaining(['title:REQUIRED', 'parentCode:DEPARTMENT_CYCLE']),
    );
    // A commit of those rows is refused, and nothing was written.
    const refused = await call(
      'hr01',
      'POST',
      '/data-import/departments/commit',
      {
        rows: data.rows,
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('IMPORT_HAS_ERRORS');
    expect(
      (await call('hr01', 'GET', '/data-import/departments/status')).json.data
        .count,
    ).toBe(before);
  });

  it('creates a tree whose parents come after their children, then updates it by code', async () => {
    const { preview, commit } = await importRows('departments', [
      DEPARTMENT_HEADER,
      ['N-SALES-E', '华东销售', 'N-SALES', 'QH1003', '2'],
      ['N-SALES', '销售中心', 'ROOT', '', '5'],
      ['HR', '人力资源部', 'ROOT', '', ''], // stored, same name: unchanged or update only
    ]);
    expect(preview.created).toBe(2);
    expect(commit.status).toBe(200);
    expect(commit.json.data).toMatchObject({ created: 2 });
    const q = await db();
    const rows = await q
      .selectFrom('departments')
      .select(['id', 'code', 'title', 'parentId', 'managerId', 'sortOrder'])
      .where('code', 'in', ['N-SALES', 'N-SALES-E', 'ROOT'])
      .execute();
    const byCode = new Map(rows.map((r) => [String(r.code), r]));
    expect(byCode.get('N-SALES')!.parentId).toBe(byCode.get('ROOT')!.id);
    expect(byCode.get('N-SALES-E')!.parentId).toBe(byCode.get('N-SALES')!.id);
    expect(byCode.get('N-SALES-E')!.managerId).toBeTruthy();
    // Importing again updates instead of creating, and a moved parent is applied.
    const again = await importRows('departments', [
      DEPARTMENT_HEADER,
      ['N-SALES-E', '华东销售部', 'ROOT', '', ''],
      ['N-SALES', '销售中心', 'ROOT', '', '5'],
    ]);
    expect(again.preview).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 1,
    });
    expect(again.commit.json.data).toMatchObject({
      created: 0,
      updated: 1,
      unchanged: 1,
    });
    const moved = await q
      .selectFrom('departments')
      .select(['title', 'parentId'])
      .where('code', '=', 'N-SALES-E')
      .execute();
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({
      title: '华东销售部',
      parentId: byCode.get('ROOT')!.id,
    });
    const status = await call('hr01', 'GET', '/data-import/departments/status');
    expect(status.json.data.lastImportedAt).toEqual(expect.any(String));
    const batches = await q
      .selectFrom('dataImportBatches')
      .select(['kind', 'createdCount', 'updatedCount'])
      .where('kind', '=', 'departments')
      .execute();
    expect(batches.length).toBe(2);
  });

  it('refuses while the office suite directory is the data master', async () => {
    // The data master is a setting of 组织同步; switch it directly for the check, then back.
    const { orgSyncServiceToken } =
      await import('../../server/providers/hr/tokens.ts');
    const sync = server.application.container.resolve(orgSyncServiceToken);
    const original = sync.readSettings;
    sync.readSettings = (async () => {
      const current = await original();
      return { ...current, value: { ...current.value, orgMaster: 'external' } };
    }) as typeof original;
    try {
      const preview = await upload(
        'hr01',
        '/data-import/departments/preview',
        workbook([DEPARTMENT_HEADER, ['N-X', '某部', '', '', '']]),
      );
      expect(preview.status).toBe(409);
      expect(preview.json.code).toBe('IMPORT_ORG_MASTER_EXTERNAL');
    } finally {
      sync.readSettings = original;
    }
  });
});

const POSITION_HEADER = [
  '岗位编码',
  '岗位名称',
  '岗位序列',
  '职级',
  '所属部门编码',
];

describe('positions', () => {
  it('previews duplicates and unknown departments without writing', async () => {
    const before = (await call('hr01', 'GET', '/data-import/positions/status'))
      .json.data.count;
    const preview = await upload(
      'hr01',
      '/data-import/positions/preview',
      workbook([
        POSITION_HEADER,
        ['N-P1', '销售代表', '职能序列', 'P2', 'NOPE'],
        ['N-P1', '销售代表二', '职能序列', '', ''],
        ['bad code', '', '', '', ''],
      ]),
    );
    const data = preview.json.data;
    expect(errorsOf(data, 2)).toEqual(
      expect.arrayContaining([
        'code:DUPLICATE_IN_FILE',
        'departmentCode:DEPARTMENT_NOT_FOUND',
      ]),
    );
    expect(errorsOf(data, 4)).toEqual(
      expect.arrayContaining([
        'code:CODE_INVALID',
        'title:REQUIRED',
        'family:REQUIRED',
      ]),
    );
    expect(
      (await call('hr01', 'GET', '/data-import/positions/status')).json.data
        .count,
    ).toBe(before);
  });

  it('creates positions and a new job family, then updates by code', async () => {
    const { preview, commit } = await importRows('positions', [
      POSITION_HEADER,
      ['N-P-SALES', '销售代表', '客服序列', 'M1', 'N-SALES'],
      ['office-hr', '人事专员', '职能序列', 'P3', ''],
    ]);
    expect(preview.newFamilies).toEqual(['客服序列']);
    expect(commit.status).toBe(200);
    expect(commit.json.data).toMatchObject({
      created: 1,
      updated: 1,
      createdFamilies: 1,
    });
    const again = await importRows('positions', [
      POSITION_HEADER,
      ['N-P-SALES', '高级销售代表', '客服序列', '', ''],
    ]);
    expect(again.preview).toMatchObject({ created: 0, updated: 1 });
    expect(again.preview.newFamilies).toEqual([]);
    const q = await db();
    const rows = await q
      .selectFrom('positions')
      .select(['title', 'grade', 'departmentId'])
      .where('code', '=', 'N-P-SALES')
      .execute();
    expect(rows).toHaveLength(1);
    // Empty optional cells kept the grade and department.
    expect(rows[0]).toMatchObject({ title: '高级销售代表', grade: 'M1' });
    expect(rows[0]!.departmentId).toBeTruthy();
    // The positions page carries the department.
    const page = await call('hr01', 'GET', '/positions');
    const listed = (page.json.data.positions as Json[]).find(
      (p) => p.code === 'N-P-SALES',
    );
    expect(listed?.departmentId).toBe(rows[0]!.departmentId);
  });
});

const CONTRACT_HEADER = [
  '工号',
  '合同编号',
  '合同类型',
  '开始日期',
  '结束日期',
  '签订日期',
  '试用期结束日期',
  '备注',
];

describe('contracts', () => {
  beforeAll(async () => {
    for (const employeeNo of ['T9101', 'T9102']) {
      const created = await call('hr01', 'POST', '/employees', {
        employeeNo,
        name: `导入${employeeNo}`,
        departmentId: 'cd-mc',
        hireDate: '2018-01-01',
        status: 'active',
      });
      if (created.status !== 201)
        throw new Error(
          `employee ${employeeNo}: ${JSON.stringify(created.json)}`,
        );
    }
  });

  it('previews unknown employees, bad dates, overlaps and duplicates without writing', async () => {
    const before = (await call('hr01', 'GET', '/data-import/contracts/status'))
      .json.data.count;
    const preview = await upload(
      'hr01',
      '/data-import/contracts/preview',
      workbook([
        CONTRACT_HEADER,
        ['T0000', 'N-HT-1', '固定期限', '2020-01-01', '2022-12-31', '', '', ''], // 2: unknown employee
        ['T9101', 'N-HT-2', '固定期限', '2020-02-30', '2022-12-31', '', '', ''], // 3: bad date
        ['T9101', 'N-HT-3', '固定期限', '2020-01-01', '2022-12-31', '', '', ''], // 4
        ['T9101', 'N-HT-4', '固定期限', '2022-06-01', '2023-12-31', '', '', ''], // 5: overlaps 4
        [
          'T9101',
          'N-HT-3',
          '无固定期限',
          '2024-01-01',
          '2025-01-01',
          '',
          '',
          '',
        ], // 6: dup, end on open-ended
        ['T9101', 'N-HT-6', '合作', '2024-01-01', '', '', '', ''], // 7: unknown type
        ['T9101', 'N-HT-7', '固定期限', '2026-01-01', '2025-01-01', '', '', ''], // 8: ends before start
      ]),
    );
    const data = preview.json.data;
    expect(errorsOf(data, 2)).toEqual(['employeeNo:EMPLOYEE_NOT_FOUND']);
    expect(errorsOf(data, 3)).toEqual(['startDate:DATE_INVALID']);
    expect(errorsOf(data, 4)).toEqual(['contractNo:DUPLICATE_IN_FILE']);
    expect(errorsOf(data, 5)).toEqual(['startDate:CONTRACT_OVERLAP']);
    expect(errorsOf(data, 6)).toEqual(
      expect.arrayContaining([
        'contractNo:DUPLICATE_IN_FILE',
        'endDate:OPEN_ENDED_HAS_END',
      ]),
    );
    expect(errorsOf(data, 7)).toEqual(['type:CONTRACT_TYPE_INVALID']);
    expect(errorsOf(data, 8)).toEqual(['endDate:END_BEFORE_START']);
    expect(
      (await call('hr01', 'GET', '/data-import/contracts/status')).json.data
        .count,
    ).toBe(before);
  });

  it('imports history: ended contracts as renewed or expired, chained, with no renewal work', async () => {
    const complianceRuns = async () =>
      (
        (
          await call(
            'hr01',
            'GET',
            '/automations/runs?task=hrAssistant.compliance',
          )
        ).json.data as Json[]
      ).length;
    const runsBefore = await complianceRuns();
    const { commit } = await importRows('contracts', [
      CONTRACT_HEADER,
      // The current one first: order in the file does not matter.
      [
        'T9101',
        'N-HT-C',
        '固定期限',
        '2023-01-01',
        `${YEAR + 3}-12-31`,
        '2022-12-20',
        '2023-03-31',
        '',
      ],
      [
        'T9101',
        'N-HT-A',
        '固定期限',
        '2017-01-01',
        '2019-12-31',
        '2016-12-28',
        '2017-03-31',
        '首签',
      ],
      ['T9101', 'N-HT-B', '固定期限', '2020-01-01', '2022-12-31', '', '', ''],
      ['T9102', 'N-HT-D', '劳务', '2018-01-01', '2019-06-30', '', '', ''],
    ]);
    expect(commit.status).toBe(200);
    expect(commit.json.data).toMatchObject({ created: 4, updated: 0 });
    const q = await db();
    const rows = await q
      .selectFrom('employmentContracts')
      .select(['id', 'contractNo', 'status', 'previousContractId', 'note'])
      .where('contractNo', 'in', ['N-HT-A', 'N-HT-B', 'N-HT-C', 'N-HT-D'])
      .execute();
    const byNo = new Map(rows.map((r) => [String(r.contractNo), r]));
    expect(byNo.get('N-HT-A')).toMatchObject({
      status: 'renewed',
      previousContractId: null,
    });
    expect(byNo.get('N-HT-A')!.note).toContain('2017-03-31');
    expect(byNo.get('N-HT-B')).toMatchObject({
      status: 'renewed',
      previousContractId: byNo.get('N-HT-A')!.id,
    });
    expect(byNo.get('N-HT-C')).toMatchObject({
      status: 'active',
      previousContractId: byNo.get('N-HT-B')!.id,
    });
    expect(byNo.get('N-HT-D')).toMatchObject({ status: 'expired' });
    const employee = await q
      .selectFrom('employees')
      .select(['probationEndDate'])
      .where('employeeNo', '=', 'T9101')
      .executeTakeFirst();
    expect(String(employee!.probationEndDate).slice(0, 10)).toBe('2023-03-31');
    // No renewal preparation for history.
    const work = await q
      .selectFrom('workItems')
      .select(['refId'])
      .where(
        'refId',
        'in',
        rows.map((r) => `hrAssistant:renewalPrep:${String(r.id)}`),
      )
      .execute();
    expect(work).toEqual([]);
    // One full compliance check after the import, not one per employee.
    let runsAfter = runsBefore;
    for (let i = 0; i < 100 && runsAfter === runsBefore; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      runsAfter = await complianceRuns();
    }
    expect(runsAfter).toBe(runsBefore + 1);
  });

  it('leaves an identical contract alone and refuses a different one with the same number', async () => {
    const preview = await upload(
      'hr01',
      '/data-import/contracts/preview',
      workbook([
        CONTRACT_HEADER,
        ['T9102', 'N-HT-D', '劳务', '2018-01-01', '2019-06-30', '', '', ''],
        ['T9102', 'N-HT-B', '固定期限', '2020-01-01', '2022-12-31', '', '', ''],
      ]),
    );
    const data = preview.json.data;
    expect((data.rows as Json[])[0]).toMatchObject({
      action: 'unchanged',
      errors: [],
    });
    expect(errorsOf(data, 3)).toEqual(['contractNo:CONTRACT_NO_TAKEN']);
    // A second current contract for T9101 is refused.
    const second = await upload(
      'hr01',
      '/data-import/contracts/preview',
      workbook([
        CONTRACT_HEADER,
        [
          'T9101',
          'N-HT-E',
          '固定期限',
          `${YEAR + 4}-01-01`,
          `${YEAR + 6}-12-31`,
          '',
          '',
          '',
        ],
      ]),
    );
    expect(errorsOf(second.json.data, 2)).toEqual([
      'startDate:CONTRACT_ACTIVE_EXISTS',
    ]);
  });
});

const BALANCE_HEADER = [
  '工号',
  '假期类型',
  '年度',
  '期初余额(天)',
  '已用(天)',
  '备注',
];

describe('opening leave balances', () => {
  it('previews unknown employees, types without balances and bad numbers without writing', async () => {
    const q = await db();
    const before = await q.selectFrom('leaveBalances').select(['id']).execute();
    const preview = await upload(
      'hr01',
      '/data-import/leave-balances/preview',
      workbook([
        BALANCE_HEADER,
        ['T0000', '年假', YEAR, 5, '', ''], // 2
        ['QH1001', '病假', YEAR, 5, '', ''], // 3: no balance
        ['QH1001', '年假', 'abc', -1, '', ''], // 4: bad year and days
        ['QH1001', '探亲', YEAR, 5, '', ''], // 5: unknown type
        ['QH1002', 'annual', YEAR, 5, '', ''], // 6: by code, fine
        ['QH1002', '年假', YEAR, 6, '', ''], // 7: duplicate of 6
      ]),
    );
    const data = preview.json.data;
    expect(errorsOf(data, 2)).toEqual(['employeeNo:EMPLOYEE_NOT_FOUND']);
    expect(errorsOf(data, 3)).toEqual(['leaveType:LEAVE_TYPE_NO_BALANCE']);
    expect(errorsOf(data, 4)).toEqual(
      expect.arrayContaining(['year:YEAR_INVALID', 'opening:DAYS_INVALID']),
    );
    expect(errorsOf(data, 5)).toEqual(['leaveType:LEAVE_TYPE_NOT_FOUND']);
    expect(errorsOf(data, 6)).toEqual(['leaveType:DUPLICATE_IN_FILE']);
    expect(
      (await q.selectFrom('leaveBalances').select(['id']).execute()).length,
    ).toBe(before.length);
  });

  it('writes the opening balance as a 期初导入 adjustment, and corrects it on a second import', async () => {
    const { commit } = await importRows('leave-balances', [
      BALANCE_HEADER,
      ['T9101', '年假', YEAR, 7.5, 2.5, '上线前结余'],
    ]);
    expect(commit.status).toBe(200);
    expect(commit.json.data).toMatchObject({ created: 1, updated: 0 });
    const q = await db();
    const employee = await q
      .selectFrom('employees')
      .select(['id'])
      .where('employeeNo', '=', 'T9101')
      .executeTakeFirst();
    const balanceOf = async () => {
      const list = await call(
        'hr01',
        'GET',
        `/leave/balances?year=${YEAR}&employeeId=${String(employee!.id)}`,
      );
      expect(list.status).toBe(200);
      return (list.json.data as Json[]).find(
        (b) => b.leaveTypeId === 'leave-annual',
      )!;
    };
    const first = await balanceOf();
    expect(first.available).toBe(7.5);
    const detail = await call(
      'hr01',
      'GET',
      `/leave/balances/${String(first.id)}`,
    );
    const history = detail.json.data.adjustments as Json[];
    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toContain('期初导入');
    expect(history[0]!.reason).toContain('已用 2.5 天');
    const again = await importRows('leave-balances', [
      BALANCE_HEADER,
      ['T9101', '年假', YEAR, 6, '', ''],
    ]);
    expect(again.preview).toMatchObject({ created: 0, updated: 1 });
    const second = await balanceOf();
    expect(second.id).toBe(first.id);
    expect(second.available).toBe(6);
    const status = await call(
      'hr01',
      'GET',
      '/data-import/leave-balances/status',
    );
    expect(status.json.data.count).toBeGreaterThan(0);
    expect(status.json.data.lastImportedAt).toEqual(expect.any(String));
  });
});

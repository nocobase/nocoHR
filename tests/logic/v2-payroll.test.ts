// @vitest-environment node

// Acceptance checks for V2 step 6 (薪酬与社保) on the V2 demo data (启衡精密): the prerequisite check, imports,
// formulas and their whitelist, proration, cumulative withholding and rounding, the assembly piece-rate
// customization, the HR assistant's anomaly check (rule fallback: no model in tests), approval and publishing,
// exports, the payslip page's identity check, the vendor bill, job events, social insurance and permissions.
// Each run boots the real standalone server on a throwaway SQLite database with migrations and seeds.
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
import {
  checkFormula,
  evaluateFormula,
  parseFormula,
  roundTo,
} from '../../server/providers/hr/payroll/formula.ts';

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
const PASSWORD = 'v2-payroll-test-password';

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
  expect(response.status).toBe(200);
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
): Promise<{ status: number; json: Json; text: string }> {
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
  let json: Json;
  try {
    json = text ? (JSON.parse(text) as Json) : {};
  } catch {
    json = {};
  }
  return { status: response.status, json, text };
}

async function upload(
  username: string,
  url: string,
  rows: unknown[][],
  fields: Record<string, string> = {},
) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'sheet');
  const bytes = XLSX.write(book, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'upload.xlsx'));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      method: 'POST',
      headers: { cookie: await signIn(username), origin: 'http://localhost' },
      body: form,
    }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-payroll-'));
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
}, 240_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.ATTENDANCE_PUNCH_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
const MONTH = addMonths(today().slice(0, 7), -1);
const NEXT = addMonths(MONTH, 1);
const PREVIOUS = addMonths(MONTH, -1);

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function services() {
  const { payrollServicesToken } =
    await import('../../server/providers/hr/tokens.ts');
  return server.application.container.resolve(payrollServicesToken);
}

async function notification(key: string) {
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  return server.application.container
    .resolve(notificationServiceToken)
    .getByIdempotencyKey(`hr:${key}`);
}

/** The in-app title and body a notification delivered. */
async function inboxText(key: string): Promise<string> {
  const sent = await notification(key);
  if (!sent) return '';
  const rows = await (
    await db()
  )
    .query()
    .selectFrom('notificationInAppItems')
    .select(['title', 'body'])
    .where('notificationId', '=', sent.notificationId)
    .execute();
  return rows.map((r) => `${String(r.title)} ${String(r.body)}`).join('\n');
}

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}

const decode = (value: unknown): any => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v);
  return v;
};

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 15_000,
) {
  const start = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

/** 预扣率表一, written out independently of the application's table. */
function withholding(taxable: number): number {
  const table: [number, number, number][] = [
    [36000, 3, 0],
    [144000, 10, 2520],
    [300000, 20, 16920],
    [420000, 25, 31920],
    [660000, 30, 52920],
    [960000, 35, 85920],
    [Infinity, 45, 181920],
  ];
  const t = Math.max(0, taxable);
  const [, rate, quick] = table.find(([upTo]) => t <= upTo)!;
  return Math.max(0, (t * rate) / 100 - quick);
}

/** Working days from a date to the end of its month, by the attendance calendar (make-up workdays and holidays count). */
async function workdaysFrom(date: string): Promise<number> {
  const { readCalendar, isWorkday } =
    await import('../../server/providers/hr/payroll/common.ts');
  const calendar = await readCalendar((await db()).query());
  let count = 0;
  for (
    let d = new Date(`${date}T00:00:00Z`);
    d.toISOString().slice(0, 7) === date.slice(0, 7);
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (isWorkday(d.toISOString().slice(0, 10), calendar)) count += 1;
  return count;
}

let cycleId = '';
let calculationId = '';

async function slipOf(employeeId: string, cycle = cycleId) {
  const row = await (
    await db()
  )
    .query()
    .selectFrom('payslips')
    .selectAll()
    .where('cycleId', '=', cycle)
    .where('employeeId', '=', employeeId)
    .executeTakeFirst();
  return row
    ? {
        ...row,
        lines: decode(row.lines) as Json[],
        inputs: decode(row.inputs) as Json,
        issues: decode(row.issues) as Json[],
        importedValues: decode(row.importedValues) as Json,
      }
    : undefined;
}
const line = (slip: { lines: Json[] } | undefined, code: string) =>
  slip?.lines.find((l) => l.code === code);

async function calculate(): Promise<Json> {
  const result = await call(
    'payroll01',
    'POST',
    `/payroll/cycles/${cycleId}/calculate`,
  );
  expect(result.status).toBe(200);
  calculationId = result.json.data.cycle.calculationId;
  return result.json.data;
}

async function reviewed() {
  return until(
    async () =>
      (await call('payroll01', 'GET', `/payroll/cycles/${cycleId}/anomalies`))
        .json.data,
    (data) => data?.review?.calculationId === calculationId,
  );
}

describe('formula evaluator', () => {
  it('evaluates the four operations, parentheses, × ÷ and functions safely', () => {
    const node = parseFormula(
      'hourlyRate × (att.overtime.workday × 1.5 + att.overtime.restDay × 2) ÷ 2',
    );
    expect(
      evaluateFormula(
        node,
        (n) =>
          ({
            hourlyRate: 10,
            'att.overtime.workday': 6,
            'att.overtime.restDay': 1,
          })[n],
      ),
    ).toBe(55);
    expect(
      evaluateFormula(
        parseFormula('max(1, 2, 3) - min(4, 5) + round(1.005, 2)'),
        () => 0,
      ),
    ).toBeCloseTo(0.01, 10);
    expect(evaluateFormula(parseFormula('10 / 0'), () => 0)).toBe(0);
    expect(() => parseFormula('process.exit()')).toThrow();
    expect(() => parseFormula('1 +')).toThrow();
    expect(roundTo(2.675, 2)).toBe(2.68);
    expect(roundTo(-1.005, 2)).toBe(-1.01);
  });

  it('accepts only whitelisted variables', () => {
    const context = {
      params: new Set(['nightRate']),
      earlierItems: new Set(['base']),
      importedItems: new Set(['pieceCount']),
    };
    expect(() =>
      checkFormula(
        'att.nightShiftCount × param.nightRate + item.base + imp.pieceCount',
        context,
      ),
    ).not.toThrow();
    expect(() => checkFormula('salary.secret × 2', context)).toThrow(
      /FORMULA_UNKNOWN_VARIABLE/u,
    );
    expect(() => checkFormula('param.pieceRate', context)).toThrow(
      /FORMULA_UNKNOWN_PARAM/u,
    );
    expect(() => checkFormula('item.later', context)).toThrow(
      /FORMULA_ITEM_ORDER/u,
    );
    expect(() => checkFormula('imp.other', context)).toThrow(
      /FORMULA_UNKNOWN_IMPORT/u,
    );
  });
});

describe('V2-06 demo data and permissions', () => {
  it('seeds the structures, files, enrolments and the published previous cycle', async () => {
    const q = (await db()).query();
    const structures = await q
      .selectFrom('salaryStructures')
      .select(['title', 'params'])
      .execute();
    expect(structures.map((s) => s.title).sort()).toEqual(
      ['成都生产一线薪资结构', '生产一线薪资结构', '职能薪资结构'].sort(),
    );
    const previous = await q
      .selectFrom('payrollCycles')
      .selectAll()
      .where('month', '=', PREVIOUS)
      .executeTakeFirst();
    expect(previous?.status).toBe('published');
    const sunli = await q
      .selectFrom('attendanceMonthlySummaries')
      .select(['status'])
      .where('employeeId', '=', 'emp-sunli')
      .where('month', '=', MONTH)
      .executeTakeFirst();
    expect(sunli?.status).not.toBe('locked');
    const dispatched = await q
      .selectFrom('employees')
      .select(['id'])
      .where('employmentType', '=', 'dispatched')
      .execute();
    expect(dispatched).toHaveLength(4);
  });

  it('keeps hr.admin and department heads away from every salary endpoint', async () => {
    for (const url of [
      '/salaries',
      '/payroll/cycles',
      '/social-insurance',
      '/payroll-settings/structures',
      '/payroll/vendor-bills',
      '/salaries/adjustments',
    ])
      expect((await call('hr01', 'GET', url)).status).toBe(403);
    expect((await call('mgr_njl', 'GET', '/payroll/cycles')).status).toBe(403);
    expect((await call('emp_njl_1', 'GET', '/social-insurance')).status).toBe(
      403,
    );
    expect((await call(null, 'GET', '/payroll/cycles')).status).toBe(401);
  });
});

describe('V2-06 calculation', () => {
  it('refuses to calculate until 装配车间 is locked, naming the department', async () => {
    const created = await call('payroll01', 'POST', '/payroll/cycles', {
      month: MONTH,
    });
    expect(created.status).toBe(201);
    cycleId = created.json.data.id;
    const refused = await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${cycleId}/calculate`,
    );
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('PAYROLL_ATTENDANCE_NOT_LOCKED');
    expect(refused.json.details.departments).toEqual(['装配车间']);
    expect(
      (await call('fin01', 'POST', `/payroll/cycles/${cycleId}/calculate`))
        .status,
    ).toBe(403);
    const summary = await (
      await db()
    )
      .query()
      .selectFrom('attendanceMonthlySummaries')
      .select(['id'])
      .where('employeeId', '=', 'emp-sunli')
      .where('month', '=', MONTH)
      .executeTakeFirst();
    const locked = await call('hr01', 'POST', '/attendance/summaries/lock', {
      ids: [String(summary!.id)],
    });
    expect(locked.status).toBe(200);
    expect(locked.json.data.locked).toEqual([String(summary!.id)]);
    const detail = await call('payroll01', 'GET', `/payroll/cycles/${cycleId}`);
    expect(detail.json.data.prerequisites.attendance.ready).toBe(true);
  });

  it('previews the 绩效奖金 import, naming the unknown number, and imports 王磊 600', async () => {
    const rows = [
      ['工号', '姓名', '绩效奖金（perfBonus）'],
      ['QH2001', '王磊', 600],
      ['QH2003', '钱进', 300],
      ['QH9999', '张三', 300],
      ['QH2002', '李敏', 'abc'],
    ];
    const preview = await upload(
      'payroll01',
      `/payroll/cycles/${cycleId}/imports/preview`,
      rows,
    );
    expect(preview.status).toBe(200);
    const bad = preview.json.data.rows.filter((r: Json) => r.errors.length);
    expect(bad.map((r: Json) => [r.employeeNo, r.errors[0].code])).toEqual([
      ['QH9999', 'EMPLOYEE_NOT_FOUND'],
      ['QH2002', 'VALUE_INVALID'],
    ]);
    const refused = await upload(
      'payroll01',
      `/payroll/cycles/${cycleId}/imports`,
      rows,
    );
    expect(refused.json.code).toBe('IMPORT_HAS_ERRORS');
    const imported = await upload(
      'payroll01',
      `/payroll/cycles/${cycleId}/imports`,
      rows,
      { skipInvalid: 'true' },
    );
    expect(imported.status).toBe(200);
    expect(imported.json.data.imported).toBe(2);
    expect((await slipOf('emp-wanglei'))?.importedValues).toEqual({
      perfBonus: 600,
    });
    // The same item imported again replaces it, and the imports keep both records.
    const again = await upload(
      'payroll01',
      `/payroll/cycles/${cycleId}/imports`,
      [rows[0], rows[1]],
    );
    expect(again.status).toBe(200);
    expect((await slipOf('emp-qianjin'))?.importedValues).toEqual({});
    expect(
      (await call('payroll01', 'GET', `/payroll/cycles/${cycleId}`)).json.data
        .cycle.imports,
    ).toHaveLength(2);
  });

  it('calculates 王磊 by the formulas, each line with its calculation and sources', async () => {
    await calculate();
    const slip = await slipOf('emp-wanglei');
    const dailyRate = 6000 / 21.75;
    expect(line(slip, 'base')?.amount).toBe(6000);
    expect(line(slip, 'post')?.amount).toBe(500);
    expect(line(slip, 'night')?.amount).toBe(600);
    expect(line(slip, 'night')?.expression).toBe('12 × 50');
    expect(line(slip, 'overtime')?.amount).toBe(
      roundTo((dailyRate / 8) * 6 * 1.5, 2),
    );
    expect(line(slip, 'personalLeave')?.amount).toBe(roundTo(dailyRate * 1, 2));
    expect(line(slip, 'perfBonus')?.amount).toBe(600);
    expect(line(slip, 'night')?.sources).toEqual([
      { name: 'att.nightShiftCount', value: 12, source: 'attendance' },
      { name: 'param.nightRate', value: 50, source: 'param' },
    ]);
    const gross = roundTo(
      6000 +
        500 +
        600 +
        roundTo((dailyRate / 8) * 9, 2) -
        roundTo(dailyRate, 2) +
        600,
      2,
    );
    expect(Number(slip?.gross)).toBe(gross);
    // The detail endpoint shows the same lines.
    const detail = await call(
      'payroll01',
      'GET',
      `/payroll/cycles/${cycleId}/payslips/${slip!.id}`,
    );
    expect(detail.json.data.lines.map((l: Json) => l.code)).toContain('night');
  });

  it('prorates 杨帆 by the working days since her 15th-of-month start and insures her this month', async () => {
    const slip = await slipOf('emp-yangfan');
    const days = await workdaysFrom(`${MONTH}-15`);
    expect(slip?.inputs.payableDays.payableDays).toBe(days);
    expect(line(slip, 'base')?.amount).toBe(roundTo((5000 * days) / 21.75, 2));
    expect(slip?.inputs.insurance.planCity).toBe('苏州');
    expect(Number(slip?.socialEmployee)).toBeGreaterThan(0);
    // Joining after the 15th of the month: insured from next month. 郭凡's hire date moves with today, so
    // the expectation follows the rule rather than a fixed date.
    const guofan = await (
      await db()
    )
      .query()
      .selectFrom('employees')
      .select(['hireDate'])
      .where('id', '=', 'emp-guofan')
      .executeTakeFirstOrThrow();
    const hired = String(
      guofan.hireDate instanceof Date
        ? guofan.hireDate.toISOString()
        : guofan.hireDate,
    ).slice(0, 10);
    const insurance = (await slipOf('emp-guofan'))?.inputs.insurance;
    if (hired.slice(0, 7) === MONTH && hired.slice(8, 10) > '15')
      expect(insurance).toBeNull();
    else expect(insurance).not.toBeNull();
  });

  it('withholds 王磊 cumulatively, his 子女教育 deduction included', async () => {
    const slip = await slipOf('emp-wanglei');
    const july = await slipOf('emp-wanglei', `payroll-${PREVIOUS}`);
    const t = slip!.inputs.tax;
    const prior = july!.inputs.tax;
    expect(t.months).toBe(prior.months + 1);
    expect(t.specialDeductionYtd).toBe(2000 * t.months);
    const income = roundTo(prior.incomeYtd + t.incomeMonth, 2);
    const insurance = roundTo(
      prior.insuranceYtd +
        Number(slip!.socialEmployee) +
        Number(slip!.housingFundEmployee),
      2,
    );
    const taxable = Math.max(
      0,
      income - 5000 * t.months - insurance - 2000 * t.months,
    );
    expect(t.taxableYtd).toBe(roundTo(taxable, 2));
    expect(Number(slip!.tax)).toBe(
      roundTo(
        Math.max(
          0,
          roundTo(withholding(taxable), 2) - Number(july!.taxWithheldYtd),
        ),
        2,
      ),
    );
  });

  it('rejects a structure whose formula reads a variable outside the whitelist', async () => {
    const structures = (
      await call('payroll01', 'GET', '/payroll-settings/structures')
    ).json.data as Json[];
    const suzhou = structures.find((s) => s.title === '生产一线薪资结构')!;
    const refused = await call(
      'payroll01',
      'PUT',
      `/payroll-settings/structures/${suzhou.id}`,
      {
        title: suzhou.title,
        appliesTo: suzhou.appliesTo,
        items: [
          ...suzhou.items,
          {
            code: 'bad',
            title: '错误',
            kind: 'earning',
            calc: 'formula',
            formula: 'employee.salary × 2',
          },
        ],
        params: suzhou.params,
        payRanges: suzhou.payRanges,
        payDaysPerMonth: 21.75,
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('FORMULA_UNKNOWN_VARIABLE');
    expect(
      (
        await call(
          'fin01',
          'PUT',
          `/payroll-settings/structures/${suzhou.id}`,
          {},
        )
      ).status,
    ).toBe(403);
  });
});

describe('V2-06 customizable: assembly piece wage', () => {
  let suzhou: Json;
  const save = (params: Json[], items: Json[]) =>
    call('payroll01', 'PUT', `/payroll-settings/structures/${suzhou.id}`, {
      title: suzhou.title,
      appliesTo: suzhou.appliesTo,
      items,
      params,
      payRanges: suzhou.payRanges,
      payDaysPerMonth: 21.75,
      trialEmployeeId: 'emp-sunli',
    });

  it('adds 计件数 and 计件工资 for 装配车间 with pieceRate = 0.50; the trial runs and the change is logged', async () => {
    suzhou = (
      (await call('payroll01', 'GET', '/payroll-settings/structures')).json
        .data as Json[]
    ).find((s) => s.title === '生产一线薪资结构')!;
    const items = [
      ...suzhou.items,
      {
        code: 'pieceCount',
        title: '计件数',
        kind: 'reference',
        calc: 'imported',
        unit: '件',
        departmentIds: ['sz-as'],
      },
      {
        code: 'pieceWage',
        title: '计件工资',
        kind: 'earning',
        calc: 'formula',
        formula: 'imp.pieceCount × param.pieceRate',
        departmentIds: ['sz-as'],
      },
    ];
    const saved = await save(
      [
        ...suzhou.params,
        { code: 'pieceRate', title: '计件单价', value: 0.5, unit: '元/件' },
      ],
      items,
    );
    expect(saved.status).toBe(200);
    expect(saved.json.data.trial.employeeName).toBe('孙丽');
    expect(saved.json.data.structure.changeLog.at(-1).summary).toContain(
      '新增项目 计件工资',
    );
    suzhou = saved.json.data.structure;
  });

  it('offers the 计件数 template, imports the MES file and pays 孙丽 1,200.00; 王磊 has neither line', async () => {
    const detail = await call('payroll01', 'GET', `/payroll/cycles/${cycleId}`);
    expect(detail.json.data.importableItems.map((i: Json) => i.code)).toContain(
      'pieceCount',
    );
    const template = await server.fetch(
      new Request(
        `${base}/api/talent/payroll/cycles/${cycleId}/imports/template?item=pieceCount`,
        {
          headers: { cookie: await signIn('payroll01') },
        },
      ),
    );
    expect(template.status).toBe(200);
    const book = XLSX.read(new Uint8Array(await template.arrayBuffer()));
    const header = XLSX.utils.sheet_to_json<unknown[]>(
      book.Sheets[book.SheetNames[0]],
      { header: 1 },
    )[0];
    expect(header).toEqual(['工号', '姓名', '计件数（pieceCount）']);
    // 王磊 is not in 装配车间: the item does not apply to him.
    const refused = await upload(
      'payroll01',
      `/payroll/cycles/${cycleId}/imports/preview`,
      [
        ['工号', '姓名', '计件数（pieceCount）'],
        ['QH2001', '王磊', 100],
      ],
    );
    expect(refused.json.data.rows[0].errors[0].code).toBe(
      'ITEM_NOT_APPLICABLE',
    );
    const imported = await upload(
      'payroll01',
      `/payroll/cycles/${cycleId}/imports`,
      [
        ['工号', '姓名', '计件数（pieceCount）'],
        ['QH2101', '孙丽', 2400],
        ['QH2105', '郭凡', 900],
      ],
    );
    expect(imported.status).toBe(200);
    await calculate();
    const sunli = await slipOf('emp-sunli');
    expect(line(sunli, 'pieceCount')).toMatchObject({
      value: 2400,
      unit: '件',
      amount: null,
    });
    expect(line(sunli, 'pieceWage')?.amount).toBe(1200);
    expect(line(sunli, 'pieceWage')?.taxable).toBe(true);
    const wanglei = await slipOf('emp-wanglei');
    expect(line(wanglei, 'pieceCount')).toBeUndefined();
    expect(line(wanglei, 'pieceWage')).toBeUndefined();
  });

  it('pays 1,320.00 at pieceRate 0.55; the published previous cycle keeps its snapshot', async () => {
    const before = await slipOf('emp-sunli', `payroll-${PREVIOUS}`);
    const saved = await save(
      suzhou.params.map((p: Json) =>
        p.code === 'pieceRate' ? { ...p, value: 0.55 } : p,
      ),
      suzhou.items,
    );
    expect(saved.status).toBe(200);
    expect(saved.json.data.structure.changeLog.at(-1).summary).toContain(
      'pieceRate：0.5 → 0.55',
    );
    await calculate();
    expect(line(await slipOf('emp-sunli'), 'pieceWage')?.amount).toBe(1320);
    const after = await slipOf('emp-sunli', `payroll-${PREVIOUS}`);
    expect(after?.lines).toEqual(before?.lines);
    expect(after?.net).toBe(before?.net);
  });
});

describe('V2-06 HR assistant: anomaly check', () => {
  it('lists 钱进, a large manual item, 杨帆 without 计件数 and the night-rate mismatch, with notes, and tells payroll01', async () => {
    const manual = await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${cycleId}/manual-items`,
      {
        employeeId: 'emp-limin',
        code: 'adjustment',
        amount: 3000,
        reason: '补发上月夜班津贴',
      },
    );
    expect(manual.status).toBe(200);
    // Not submittable until recalculated.
    expect(
      (await call('payroll01', 'POST', `/payroll/cycles/${cycleId}/submit`))
        .json.code,
    ).toBe('PAYROLL_RECALCULATE_REQUIRED');
    await calculate();
    const data = await reviewed();
    const issues = data.issues as Json[];
    const of = (name: string, type: string) =>
      issues.find((i) => i.name === name && i.type === type);
    const qian = of('钱进', 'netChange');
    expect(qian?.facts.personalLeaveDays).toBe(5);
    expect(qian?.facts.direction).toBe('down');
    expect(qian?.note).toContain('本月事假 5 天');
    expect(of('李敏', 'manualLarge')).toBeTruthy();
    const yang = issues.find(
      (i) =>
        i.name === '杨帆' &&
        i.type === 'importMissing' &&
        i.facts.item === 'pieceCount',
    );
    expect(yang?.facts).toMatchObject({
      item: 'pieceCount',
      hiredThisMonth: true,
      inFile: false,
    });
    expect(yang?.note).toContain('入职');
    expect(yang?.note).toContain('没有该工号');
    const zhao = of('赵阳', 'paramMismatch');
    expect(zhao?.facts).toMatchObject({
      param: 'nightRate',
      value: 40,
      referenceValue: 50,
    });
    expect(zhao?.note).toContain('成都生产一线薪资结构');
    expect(zhao?.note).toContain('HR-POL-0002');
    expect(zhao?.note).toContain('赵阳');
    expect(zhao?.note).not.toContain('nightRate');
    expect(of('王磊', 'paramMismatch')).toBeUndefined();
    expect(
      await notification(`payrollCheck:${cycleId}:${calculationId}`),
    ).toBeTruthy();
    // The run record keeps employee ids and issue types, never an amount. The review is saved before the
    // run record is closed, so wait for the run to finish rather than read it mid-flight.
    const readRun = async () =>
      (await db())
        .query()
        .selectFrom('aiTaskRuns')
        .selectAll()
        .where('task', '=', 'hrAssistant.payrollCheck')
        .where('dedupeKey', '=', `${cycleId}:${calculationId}`)
        .executeTakeFirst();
    let run = await readRun();
    for (let i = 0; i < 50 && run?.status === 'running'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      run = await readRun();
    }
    expect(run?.status).toBe('succeeded');
    const references = decode(run?.references) as Json;
    for (const item of references.issues)
      expect(Object.keys(item).sort()).toEqual(['employeeId', 'type']);
    expect(
      JSON.stringify([run?.inputSummary, run?.output, run?.references]),
    ).not.toMatch(/3000|600\.|1320/u);
  });

  it('does not check or notify the same calculation twice, and changes no amount', async () => {
    const nets = await (
      await db()
    )
      .query()
      .selectFrom('payslips')
      .select(['id', 'net'])
      .where('cycleId', '=', cycleId)
      .execute();
    const again = await (
      await services()
    ).assistant.check(cycleId, calculationId);
    expect(again.status).toBe('duplicate');
    const after = await (
      await db()
    )
      .query()
      .selectFrom('payslips')
      .select(['id', 'net'])
      .where('cycleId', '=', cycleId)
      .execute();
    expect(after).toEqual(nets);
  });

  it('clears the mismatch once 成都 is set to 50, reporting it as resolved', async () => {
    const structures = (
      await call('payroll01', 'GET', '/payroll-settings/structures')
    ).json.data as Json[];
    const chengdu = structures.find((s) => s.title === '成都生产一线薪资结构')!;
    const saved = await call(
      'payroll01',
      'PUT',
      `/payroll-settings/structures/${chengdu.id}`,
      {
        title: chengdu.title,
        appliesTo: chengdu.appliesTo,
        items: chengdu.items,
        params: chengdu.params.map((p: Json) =>
          p.code === 'nightRate' ? { ...p, value: 50 } : p,
        ),
        payRanges: chengdu.payRanges,
        payDaysPerMonth: 21.75,
      },
    );
    expect(saved.status).toBe(200);
    await calculate();
    const data = await reviewed();
    expect(
      (data.issues as Json[]).some((i) => i.type === 'paramMismatch'),
    ).toBe(false);
    expect(data.review.removed).toContain(
      'paramMismatch:emp-zhaoyang:nightRate',
    );
    expect(data.review.added).toEqual([]);
    const text = await inboxText(`payrollCheck:${cycleId}:${calculationId}`);
    expect(text).toContain('新增：无');
    expect(text).toContain('赵阳 公式参数在不同结构间取值不同');
  });
});

describe('V2-06 approval and publishing', () => {
  it('waits for the anomaly check of the calculation before it can be submitted', async () => {
    const q = (await db()).query();
    const row = await q
      .selectFrom('payrollCycles')
      .select(['calculationId', 'review', 'calculatedAt'])
      .where('id', '=', cycleId)
      .executeTakeFirstOrThrow();
    const runs = await q
      .selectFrom('aiTaskRuns')
      .selectAll()
      .where('task', '=', 'hrAssistant.payrollCheck')
      .where('dedupeKey', '=', `${cycleId}:${String(row.calculationId)}`)
      .execute();
    // As if the check had not finished yet: no review for this calculation and no finished run.
    await q
      .updateTable('payrollCycles')
      .set({ review: null, calculatedAt: new Date() })
      .where('id', '=', cycleId)
      .execute();
    await q
      .deleteFrom('aiTaskRuns')
      .where('task', '=', 'hrAssistant.payrollCheck')
      .where('dedupeKey', '=', `${cycleId}:${String(row.calculationId)}`)
      .execute();
    const early = await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${cycleId}/submit`,
    );
    expect(early.json.code).toBe('PAYROLL_CHECK_PENDING');
    // Restore the finished check; the next test submits normally.
    for (const run of runs)
      await q.insertInto('aiTaskRuns').values(run).execute();
    await q
      .updateTable('payrollCycles')
      .set({
        review: row.review as never,
        calculatedAt: row.calculatedAt as never,
      })
      .where('id', '=', cycleId)
      .execute();
  });

  it('lets only fin01 approve; the approved sheet is locked', async () => {
    const submitted = await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${cycleId}/submit`,
    );
    expect(submitted.status).toBe(200);
    expect(submitted.json.data.status).toBe('pendingApproval');
    expect(
      (
        await call('payroll01', 'POST', `/payroll/cycles/${cycleId}/decide`, {
          decision: 'approve',
        })
      ).status,
    ).toBe(403);
    const fin = await call('fin01', 'GET', '/payroll/cycles');
    // The approver sees what waits for them and what they decided, not the drafts.
    expect(fin.json.data.cycles.map((c: Json) => c.id).sort()).toEqual(
      [cycleId, `payroll-${PREVIOUS}`].sort(),
    );
    const approved = await call(
      'fin01',
      'POST',
      `/payroll/cycles/${cycleId}/decide`,
      { decision: 'approve' },
    );
    expect(approved.status).toBe(200);
    expect(approved.json.data.status).toBe('approved');
    expect(
      (
        await upload('payroll01', `/payroll/cycles/${cycleId}/imports`, [
          ['工号', '姓名', '绩效奖金（perfBonus）'],
          ['QH2001', '王磊', 1],
        ])
      ).json.code,
    ).toBe('PAYROLL_CYCLE_LOCKED');
    expect(
      (await call('payroll01', 'POST', `/payroll/cycles/${cycleId}/calculate`))
        .json.code,
    ).toBe('PAYROLL_CYCLE_LOCKED');
    expect(
      (
        await call(
          'payroll01',
          'POST',
          `/payroll/cycles/${cycleId}/manual-items`,
          { employeeId: 'emp-limin', amount: 1, reason: 'x' },
        )
      ).json.code,
    ).toBe('PAYROLL_CYCLE_LOCKED');
    expect(
      (await call('fin01', 'GET', `/payroll/cycles/${cycleId}/exports/bank`))
        .status,
    ).toBe(403);
  });

  it('publishes, notifies 王磊 without amounts, and exports complete bank, tax and accounting files', async () => {
    expect(
      (
        await call(
          'payroll01',
          'GET',
          `/payroll/cycles/${cycleId}/exports/bank`,
        )
      ).json.code,
    ).toBe('PAYROLL_NOT_PUBLISHED');
    const published = await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${cycleId}/publish`,
    );
    expect(published.status).toBe(200);
    const slip = await slipOf('emp-wanglei');
    const sent = await inboxText(`payslipPublished:${cycleId}:emp-wanglei`);
    expect(sent).toContain(MONTH);
    expect(sent).not.toMatch(/\d{3,}\.\d{2}|元/u);
    const bank = await call(
      'payroll01',
      'GET',
      `/payroll/cycles/${cycleId}/exports/bank`,
    );
    expect(bank.status).toBe(200);
    expect(bank.text).toContain('工号,姓名,开户行,银行账号,实发金额');
    expect(bank.text).toContain(`QH2001,王磊,金鸡湖银行苏州分行,`);
    expect(bank.text).toContain(Number(slip!.net).toFixed(2));
    const tax = await call(
      'payroll01',
      'GET',
      `/payroll/cycles/${cycleId}/exports/tax`,
    );
    expect(tax.text).toContain('累计专项附加扣除');
    expect(tax.text).toContain('本期应预扣预缴税额');
    const accounting = await call(
      'payroll01',
      'GET',
      `/payroll/cycles/${cycleId}/exports/accounting`,
    );
    expect(accounting.text).toContain('机加工车间,night,夜班津贴,收入');
    const cycle = (await call('payroll01', 'GET', `/payroll/cycles/${cycleId}`))
      .json.data.cycle;
    expect(
      cycle.exports
        .filter((e: Json) => e.action === 'downloaded')
        .map((e: Json) => e.kind),
    ).toEqual(['bank', 'tax', 'accounting']);
  });

  it('shows 王磊 his payslip only after he verifies again, and explains the night allowance', async () => {
    const locked = await call('emp_njl_1', 'GET', `/my-payslips/${MONTH}`);
    expect(locked.status).toBe(403);
    expect(locked.json.code).toBe('PAYSLIP_VERIFY_REQUIRED');
    const list = await call('emp_njl_1', 'GET', '/my-payslips');
    expect(list.json.data.months.map((m: Json) => [m.month, m.net])).toEqual([
      [MONTH, null],
      [PREVIOUS, null],
    ]);
    expect(
      (
        await call('emp_njl_1', 'POST', '/my-payslips/verify', {
          password: 'wrong-password',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('emp_njl_1', 'POST', '/my-payslips/verify', {
          password: PASSWORD,
        })
      ).status,
    ).toBe(200);
    const mine = await call('emp_njl_1', 'GET', `/my-payslips/${MONTH}`);
    expect(mine.status).toBe(200);
    const night = mine.json.data.lines.find((l: Json) => l.code === 'night');
    expect(night).toMatchObject({ amount: 600, expression: '12 × 50' });
    expect(mine.json.data.lines.some((l: Json) => l.code === 'pieceWage')).toBe(
      false,
    );
    expect((await slipOf('emp-wanglei'))?.viewedAt).toBeTruthy();
    const insurance = await call(
      'emp_njl_1',
      'GET',
      '/my-payslips/social-insurance',
    );
    expect(insurance.json.data.enrolment.planCity).toBe('苏州');

    // The HR assistant's tool: the same data after verification; a request to verify first otherwise.
    const { getMyPayslip } =
      await import('../../server/ai/tools/payroll-tools.ts');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const deps = {
      payroll: await services(),
      authz: server.application.container.resolve(authorizationToken),
    };
    const invoke = getMyPayslip.invoke as (
      ctx: unknown,
      args: unknown,
    ) => Promise<Json>;
    const answer = await invoke(
      { actor: { id: await userIdOf('emp_njl_1') }, deps },
      { month: MONTH },
    );
    expect(answer.status).toBe('success');
    expect(
      answer.content.items.find((i: Json) => i.title === '夜班津贴')
        .calculation,
    ).toBe('12 × 50');
    const unverified = await invoke(
      { actor: { id: await userIdOf('emp_njl_2') }, deps },
      { month: MONTH },
    );
    expect(unverified.content.code).toBe('PAYSLIP_VERIFY_REQUIRED');
    // A department head sees no payslip of the team.
    expect(
      (await call('mgr_njl', 'GET', `/payroll/cycles/${cycleId}/payslips`))
        .status,
    ).toBe(403);
  });
});

describe('V2-06 cumulative withholding over two months', () => {
  it('computes the second month from the first by the cumulative method', async () => {
    const database = await db();
    const files = await database
      .query()
      .selectFrom('employeeSalaries')
      .select(['employeeId'])
      .execute();
    const now = new Date();
    for (const employeeId of new Set(files.map((f) => String(f.employeeId)))) {
      const exists = await database
        .query()
        .selectFrom('attendanceMonthlySummaries')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('month', '=', NEXT)
        .executeTakeFirst();
      if (exists)
        await database
          .query()
          .updateTable('attendanceMonthlySummaries')
          .set({ status: 'locked' })
          .where('id', '=', String(exists.id))
          .execute();
      else
        await database
          .query()
          .insertInto('attendanceMonthlySummaries')
          .values({
            id: `test-${employeeId}-${NEXT}`,
            employeeId,
            month: NEXT,
            scheduledDays: 21,
            workedDays: 21,
            lateCount: 0,
            earlyCount: 0,
            missingCount: 0,
            absentDays: 0,
            leaveByType: {},
            overtimeByType: {},
            nightShiftCount: employeeId === 'emp-wanglei' ? 4 : 0,
            shiftCounts: {},
            status: 'locked',
            objection: null,
            confirmedAt: now,
            lockedBy: 'test',
            lockedAt: now,
            lockLog: null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
    }
    const first = cycleId;
    const created = await call('payroll01', 'POST', '/payroll/cycles', {
      month: NEXT,
    });
    expect(created.status).toBe(201);
    cycleId = created.json.data.id;
    await calculate();
    const august = await slipOf('emp-wanglei', first);
    const september = await slipOf('emp-wanglei');
    const t = september!.inputs.tax;
    expect(t.months).toBe(august!.inputs.tax.months + 1);
    const income = roundTo(august!.inputs.tax.incomeYtd + t.incomeMonth, 2);
    const insurance = roundTo(
      august!.inputs.tax.insuranceYtd +
        Number(september!.socialEmployee) +
        Number(september!.housingFundEmployee),
      2,
    );
    const taxable = roundTo(
      Math.max(0, income - 5000 * t.months - insurance - 2000 * t.months),
      2,
    );
    expect(t.taxableYtd).toBe(taxable);
    const expected = roundTo(
      Math.max(
        0,
        roundTo(withholding(taxable), 2) - Number(august!.taxWithheldYtd),
      ),
      2,
    );
    expect(Number(september!.tax)).toBe(expected);
    expect(Number(september!.taxWithheldYtd)).toBe(
      roundTo(Number(august!.taxWithheldYtd) + expected, 2),
    );
  });
});

describe('V2-06 vendor bill (派遣对账员)', () => {
  const bill = [
    ['工号', '姓名', '工时', '金额'],
    ['QH3101', '刘强', 168, 5880],
    ['QH3102', '张伟', 168, 5880],
    ['QH3103', '陈刚', 192, 6720],
    ['QH3104', '黄勇', 192, 6720],
    ['QH3199', '周波', 8, 280],
  ];

  it('previews the unknown number, reconciles 720 against 672 hours, and writes notes as the configured AI employee', async () => {
    const settings = (await call('payroll01', 'GET', '/payroll-settings')).json
      .data.value;
    expect(
      (
        await call('payroll01', 'PUT', '/payroll-settings', {
          vendorBill: {
            ...settings.vendorBill,
            aiEmployee: 'vendorReconciler',
          },
        })
      ).status,
    ).toBe(200);
    const fields = { vendorName: '蓉川人力', month: MONTH };
    const preview = await upload(
      'payroll01',
      '/payroll/vendor-bills/preview',
      bill,
      fields,
    );
    expect(preview.status).toBe(200);
    expect(preview.json.data.unmatched.map((u: Json) => u.employeeNo)).toEqual([
      'QH3199',
    ]);
    const uploaded = await upload(
      'payroll01',
      '/payroll/vendor-bills',
      bill,
      fields,
    );
    expect(uploaded.status).toBe(201);
    expect(uploaded.json.data.totals).toMatchObject({
      billedHours: 720,
      attendanceHours: 672,
      diffHours: 48,
      diffPeople: 2,
      unmatched: 1,
    });
    const id = uploaded.json.data.id;
    const done = await until(
      async () =>
        (await call('payroll01', 'GET', `/payroll/vendor-bills/${id}`)).json
          .data,
      (data) => Boolean(data?.aiNotes),
    );
    expect(done.status).toBe('reconciled');
    expect(done.aiNotes).toContain('差异 48');
    expect(done.aiNotes).not.toMatch(/6720|5880/u);
    expect(
      (await call('hr01', 'GET', `/payroll/vendor-bills/${id}`)).status,
    ).toBe(403);
    const disputed = await call(
      'payroll01',
      'POST',
      `/payroll/vendor-bills/${id}/dispute`,
    );
    expect(disputed.json.data.status).toBe('disputed');
    const exported = await call(
      'payroll01',
      'GET',
      `/payroll/vendor-bills/${id}/export`,
    );
    expect(exported.text).toContain('工时不一致');
    expect(exported.text).not.toMatch(/6720|5880/u);
    // The reconciliation tool returns hours only.
    const reconciliation = await (
      await services()
    ).bills.reconciliationFor(
      {
        userId: await userIdOf('payroll01'),
        authz: await (
          await import('../../server/providers/hr/authorize.ts')
        ).scopeForUser(
          server.application.container.resolve(
            (await import('@nocobase/app-plugin-authorization/server'))
              .authorizationToken,
          ),
          await userIdOf('payroll01'),
        ),
      },
      id,
    );
    expect(JSON.stringify(reconciliation)).not.toMatch(/amount/u);
  });
});

describe('V2-06 job events, adjustments and social insurance', () => {
  it('flags a transfer on the change checklist without amounts, and an approved adjustment resolves it', async () => {
    const raised = await call('hr01', 'POST', '/actions', {
      actionType: 'transfer',
      employeeId: 'emp-limin',
      toDepartmentId: 'sz-as',
      toPositionId: 'pos-assembler',
      effectiveDate: today(),
      reason: '调入装配车间',
    });
    expect(raised.status).toBe(201);
    const actionId = raised.json.data.id;
    let status = raised.json.data.status;
    for (const approver of ['mgr_njl', 'mgr_east', 'hr01']) {
      if (status === 'effective') break;
      const decided = await call(
        approver,
        'POST',
        `/actions/${actionId}/approve`,
        { comment: '同意' },
      );
      if (decided.status === 200) status = decided.json.data.status;
    }
    expect(status).toBe('effective');
    const checklist = await until(
      () =>
        (async () => {
          const row = await (
            await db()
          )
            .query()
            .selectFrom('jobChangeChecklists')
            .selectAll()
            .where('actionId', '=', actionId)
            .executeTakeFirst();
          return row ? (decode(row.items) as Json[]) : [];
        })(),
      (items) => items.some((i) => i.provider === 'salary'),
    );
    const item = checklist.find((i) => i.provider === 'salary')!;
    expect(item).toMatchObject({
      code: 'salaryStructureCheck',
      status: 'todo',
    });
    expect(JSON.stringify(item)).not.toMatch(/6000|6500/u);
    const events = await (
      await db()
    )
      .query()
      .selectFrom('jobEvents')
      .select(['id'])
      .where('actionId', '=', actionId)
      .execute();
    expect(
      await notification(`payrollTransfer:${events[0].id}:emp-limin`),
    ).toBeTruthy();

    const prefill = await call(
      'payroll01',
      'GET',
      `/salaries/adjustments/prefill?actionId=${actionId}`,
    );
    expect(prefill.json.data.relatedActionId).toBe(actionId);
    const adjustment = await call(
      'payroll01',
      'POST',
      '/salaries/adjustments',
      {
        employeeId: 'emp-limin',
        effectiveMonth: addMonths(NEXT, 1),
        baseSalary: 5800,
        fixedAllowances: [{ code: 'post', amount: 300 }],
        salaryStructureId: prefill.json.data.suggestedStructureId,
        reason: '调岗为装配工',
        relatedActionId: actionId,
      },
    );
    expect(adjustment.status).toBe(201);
    const id = adjustment.json.data.id;
    expect(
      (
        await call('payroll01', 'POST', `/salaries/adjustments/${id}/decide`, {
          decision: 'approve',
        })
      ).status,
    ).toBe(403);
    const approved = await call(
      'fin01',
      'POST',
      `/salaries/adjustments/${id}/decide`,
      { decision: 'approve' },
    );
    expect(approved.json.data.status).toBe('approved');
    const history = (await call('payroll01', 'GET', '/salaries/emp-limin')).json
      .data.files as Json[];
    expect(history.map((f) => [f.effectiveMonth, f.source])).toEqual([
      [addMonths(NEXT, 1), 'adjustment'],
      [PREVIOUS, 'import'],
    ]);
    const resolved = await until(
      async () => {
        const row = await (
          await db()
        )
          .query()
          .selectFrom('jobChangeChecklists')
          .selectAll()
          .where('actionId', '=', actionId)
          .executeTakeFirst();
        return (decode(row?.items) as Json[]).find(
          (i) => i.provider === 'salary',
        );
      },
      (i) => i?.status === 'auto',
    );
    expect(resolved?.status).toBe('auto');
  });

  it('puts a new hire on 待建档 with one pending enrolment, even when the event is handled twice', async () => {
    const raised = await call('hr01', 'POST', '/actions', {
      actionType: 'onboard',
      effectiveDate: today(),
      toDepartmentId: 'cd-mc',
      toPositionId: 'pos-cnc-operator',
      name: '周迪',
      employeeNo: 'QH3201',
      probationMonths: 3,
    });
    expect(raised.status).toBe(201);
    let status = raised.json.data.status;
    for (const approver of ['mgr_cd', 'hr01']) {
      if (status === 'effective') break;
      const decided = await call(
        approver,
        'POST',
        `/actions/${raised.json.data.id}/approve`,
        {},
      );
      if (decided.status === 200) status = decided.json.data.status;
    }
    expect(status).toBe('effective');
    const employee = await (
      await db()
    )
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('employeeNo', '=', 'QH3201')
      .executeTakeFirst();
    const employeeId = String(employee!.id);
    const pending = await until(
      async () =>
        (
          await call(
            'payroll01',
            'GET',
            `/social-insurance/changes?month=${today().slice(0, 7)}`,
          )
        ).json.data.pending as Json[],
      (rows) => rows.some((r) => r.employeeId === employeeId),
    );
    expect(pending.filter((r) => r.employeeId === employeeId)).toHaveLength(1);
    const list = await call('payroll01', 'GET', '/salaries');
    expect(
      list.json.data.pendingFiles.map((p: Json) => p.employeeId),
    ).toContain(employeeId);
    const event = await (
      await db()
    )
      .query()
      .selectFrom('jobEvents')
      .selectAll()
      .where('employeeId', '=', employeeId)
      .where('eventType', '=', 'onboard')
      .executeTakeFirst();
    expect(
      await notification(`payrollOnboard:${event!.id}:${employeeId}`),
    ).toBeTruthy();
    const { toJobEvent } =
      await import('../../server/providers/hr/job-events.ts');
    await (
      await services()
    ).onJobEvent(toJobEvent(event as Record<string, unknown>));
    const again = (
      await call(
        'payroll01',
        'GET',
        `/social-insurance/changes?month=${today().slice(0, 7)}`,
      )
    ).json.data.pending as Json[];
    expect(again.filter((r) => r.employeeId === employeeId)).toHaveLength(1);

    // A base below the plan's minimum is clamped when confirmed, and the answer says so.
    const row = again.find((r) => r.employeeId === employeeId)!;
    const confirmed = await call(
      'payroll01',
      'POST',
      `/social-insurance/enrolments/${row.id}/confirm`,
      { socialBase: 3000, housingFundBase: 1000 },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.clamped).toEqual([
      'socialBase',
      'housingFundBase',
    ]);
    expect(confirmed.json.data.enrolment).toMatchObject({
      status: 'active',
      socialBase: 4246,
      housingFundBase: 2100,
    });
  });

  it('generates the yearly base adjustment on demand and writes it with a change log', async () => {
    const year = Number(MONTH.slice(0, 4)) + 1;
    const generated = await call(
      'payroll01',
      'POST',
      '/social-insurance/base-adjustment/generate',
      { year },
    );
    expect(generated.status).toBe(200);
    const wang = generated.json.data.items.find(
      (i: Json) => i.employeeId === 'emp-wanglei',
    );
    expect(wang.months).toBeGreaterThanOrEqual(2);
    const applied = await call(
      'payroll01',
      'POST',
      '/social-insurance/base-adjustment/apply',
      {},
    );
    expect(applied.json.data.applied).toBeGreaterThan(0);
    const enrolment = (
      await call('payroll01', 'GET', '/social-insurance')
    ).json.data.enrolments.find(
      (e: Json) => e.employeeId === 'emp-wanglei' && e.status === 'active',
    );
    expect(enrolment.changeLog.at(-1).summary).toContain(
      `${year} 年度基数调整`,
    );
    expect(enrolment.socialBase).toBe(wang.socialBase);
  });

  it('reminds hr.payroll of last month’s insurance changes once', async () => {
    const run = await call(
      'payroll01',
      'POST',
      '/payroll/tasks/monthly/run',
      {},
    );
    expect(run.status).toBe(200);
    expect(await notification(`payrollInsuranceMonthly:${MONTH}`)).toBeTruthy();
    expect(
      (await call('hr01', 'POST', '/payroll/tasks/monthly/run', {})).status,
    ).toBe(403);
  });
});

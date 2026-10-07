// @vitest-environment node

// 上线准备 · 薪酬期初导入, on the demo data (启衡精密) with the real standalone server: the four importers
// (/api/talent/payroll-imports/{salary-files,enrolments,deductions,tax-openings}/…) — template columns, a
// preview that names every bad cell and writes nothing, a commit that refuses errors and otherwise writes in
// one go, a re-import that updates the same key, permissions (401 / 403 / 200), the record scope of the
// grant, the status endpoint of the 上线准备 checklist, and the first month calculated after an imported
// 个税累计期初 (cumulative method, without counting a month NocoHR already calculated twice).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import {
  decode,
  PASSWORD,
  startHarness,
  today,
  type Harness,
  type Json,
} from './talent-review-harness.ts';

let h: Harness;
const ALL = 'allRecords';
const MANAGED = 'talent.managedDepartments';
const cookies = new Map<string, string>();

function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
/** The demo's published cycle is two months back; the opening goes up to last month; this month is calculated. */
const CURRENT = today().slice(0, 7);
const THROUGH = addMonths(CURRENT, -1);
const PUBLISHED = addMonths(CURRENT, -2);
const YEAR = Number(THROUGH.slice(0, 4));

beforeAll(async () => {
  h = await startHarness('payroll-opening-import');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

async function cookieOf(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached) return cached;
  const response = await h.server.fetch(
    new Request(`${h.base}/api/auth/sign-in/username`, {
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

/** Uploads a workbook to …/<kind>/<step>. */
async function send(
  username: string | null,
  kind: string,
  step: 'preview' | 'commit',
  rows: unknown[][],
): Promise<{ status: number; json: Json }> {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'sheet');
  const bytes = XLSX.write(book, {
    type: 'buffer',
    bookType: 'xlsx',
  }) as Buffer;
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'opening.xlsx'));
  const response = await h.server.fetch(
    new Request(`${h.base}/api/talent/payroll-imports/${kind}/${step}`, {
      method: 'POST',
      headers: {
        ...(username ? { cookie: await cookieOf(username) } : {}),
        origin: 'http://localhost',
      },
      body: form,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

/** The template's first two rows (header and example). */
async function template(kind: string): Promise<unknown[][]> {
  const response = await h.server.fetch(
    new Request(`${h.base}/api/talent/payroll-imports/${kind}/template`, {
      headers: { cookie: await cookieOf('payroll01') },
    }),
  );
  expect(response.status).toBe(200);
  const book = XLSX.read(new Uint8Array(await response.arrayBuffer()), {
    type: 'array',
  });
  return XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], {
    header: 1,
    defval: null,
  });
}

async function db() {
  return (await h.db()).query();
}

async function employeeIdOf(employeeNo: string): Promise<string> {
  const row = await (
    await db()
  )
    .selectFrom('employees')
    .select(['id'])
    .where('employeeNo', '=', employeeNo)
    .executeTakeFirst();
  return String(row!.id);
}

/** The problems of a preview row, as `column:code`. */
function problems(preview: Json, row: number): string[] {
  const found = (preview.rows as Json[]).find((r) => r.row === row)!;
  return (found.errors as Json[]).map((e) => `${e.column ?? ''}:${e.code}`);
}

const KINDS = ['salary-files', 'enrolments', 'deductions', 'tax-openings'];

describe('permissions and status', () => {
  it('lets payroll01 read every status, and refuses hr01, an employee and anonymous callers', async () => {
    for (const kind of KINDS) {
      const ok = await h.call(
        'payroll01',
        'GET',
        `/payroll-imports/${kind}/status`,
      );
      expect(ok.status).toBe(200);
      expect(typeof ok.json.data.count).toBe('number');
      expect(ok.json.data).toHaveProperty('lastImportedAt');
      expect(
        (await h.call('hr01', 'GET', `/payroll-imports/${kind}/status`)).status,
      ).toBe(403);
      expect(
        (await h.call('emp_njl_1', 'GET', `/payroll-imports/${kind}/status`))
          .status,
      ).toBe(403);
      expect(
        (await h.call(null, 'GET', `/payroll-imports/${kind}/status`)).status,
      ).toBe(401);
      expect(
        (await send('hr01', kind, 'preview', [['工号'], ['QH2001']])).status,
      ).toBe(403);
      expect(
        (await send(null, kind, 'commit', [['工号'], ['QH2001']])).status,
      ).toBe(401);
    }
    expect(
      (await h.call('payroll01', 'GET', '/payroll-imports/unknown/status'))
        .status,
    ).toBe(404);
  });
});

describe('templates', () => {
  it('offers the columns of each importer with one example row', async () => {
    const salary = await template('salary-files');
    expect(salary[0]).toEqual([
      '工号',
      '姓名',
      '薪资结构',
      '生效月份',
      '基本工资（base）',
      '岗位津贴（post）',
      '银行卡号',
      '开户行',
    ]);
    expect(salary).toHaveLength(2);
    expect(await template('enrolments')).toMatchObject([
      [
        '工号',
        '姓名',
        '参保方案',
        '社保基数',
        '公积金基数',
        '参保起始月',
        '社保账号',
        '公积金账号',
      ],
      expect.any(Array),
    ]);
    expect((await template('deductions'))[0]).toEqual([
      '工号',
      '姓名',
      '年度',
      '扣除类型',
      '每月金额',
      '起始月',
      '结束月',
    ]);
    const tax = await template('tax-openings');
    expect(tax[0]).toEqual([
      '工号',
      '姓名',
      '年度',
      '截至月份',
      '累计收入',
      '累计减除费用',
      '累计专项扣除',
      '累计专项附加扣除',
      '累计其他扣除',
      '累计已预扣税额',
    ]);
    expect(tax[1]).toHaveLength(10);
  });
});

describe('薪资档案 · 导入期初档案', () => {
  const header = [
    '工号',
    '姓名',
    '薪资结构',
    '生效月份',
    '基本工资（base）',
    '岗位津贴（post）',
    '银行卡号',
    '开户行',
  ];
  const good = (base: number) => [
    'QH2002',
    '李敏',
    '生产一线薪资结构',
    CURRENT,
    base,
    600,
    '6222 1111 2222 3333',
    '中国银行',
  ];

  async function files() {
    return (await db())
      .selectFrom('employeeSalaries')
      .selectAll()
      .where('employeeId', '=', await employeeIdOf('QH2002'))
      .where('effectiveMonth', '=', CURRENT)
      .execute();
  }

  it('names every bad row and writes nothing', async () => {
    const before = await (
      await db()
    )
      .selectFrom('employeeSalaries')
      .select(['id'])
      .execute();
    const preview = await send('payroll01', 'salary-files', 'preview', [
      header,
      good(6600),
      ['QH9999', '张三', '生产一线薪资结构', CURRENT, 6000, 300],
      ['QH2003', '钱进', '不存在的结构', CURRENT, 6000, 300],
      ['QH2201', '陈晨', '生产一线薪资结构', CURRENT, 'abc', 300],
      ['QH3001', '赵阳', '生产一线薪资结构', '2026-13', 6000, 300],
      ['QH2001', '王磊', '生产一线薪资结构', PUBLISHED, 6000, 300],
      ['QH2105', '郭凡', '生产一线薪资结构', CURRENT, 6000, 300, '12ab'],
    ]);
    expect(preview.status).toBe(200);
    const data = preview.json.data;
    expect(data.validRows).toBe(1);
    expect(data.errorRows).toBe(6);
    expect((data.rows as Json[])[0]).toMatchObject({
      row: 2,
      action: 'create',
      errors: [],
    });
    expect(problems(data, 3)).toEqual(['工号:EMPLOYEE_NOT_FOUND']);
    expect(problems(data, 4)).toEqual(['薪资结构:STRUCTURE_NOT_FOUND']);
    expect(problems(data, 5)).toEqual(['基本工资（base）:AMOUNT_INVALID']);
    expect(problems(data, 6)).toEqual(['生效月份:MONTH_INVALID']);
    // The published month: a payslip was approved with this employee's salary (and a file exists for it).
    expect(problems(data, 7)).toContain('生效月份:SALARY_MONTH_CALCULATED');
    expect(problems(data, 8)).toEqual(['银行卡号:BANK_ACCOUNT_INVALID']);
    // The bank account is masked in the preview.
    expect((data.rows as Json[])[0].values['银行卡号']).toBe('**** 3333');
    const refused = await send('payroll01', 'salary-files', 'commit', [
      header,
      good(6600),
      ['QH9999', '张三', '生产一线薪资结构', CURRENT, 6000, 300],
    ]);
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('IMPORT_HAS_ERRORS');
    const after = await (
      await db()
    )
      .selectFrom('employeeSalaries')
      .select(['id'])
      .execute();
    expect(after).toHaveLength(before.length);
  });

  it('creates the opening file, then corrects it on a second import', async () => {
    const first = await send('payroll01', 'salary-files', 'commit', [
      header,
      good(6600),
    ]);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ rows: 1, created: 1, updated: 0 });
    let rows = await files();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'opening' });
    expect(Number(rows[0].baseSalary)).toBe(6600);
    const again = await send('payroll01', 'salary-files', 'commit', [
      header,
      good(6800),
    ]);
    expect(again.json.data).toMatchObject({ created: 0, updated: 1 });
    rows = await files();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].baseSalary)).toBe(6800);
    const status = await h.call(
      'payroll01',
      'GET',
      '/payroll-imports/salary-files/status',
    );
    expect(status.json.data.lastImportedAt).toBeTruthy();
    expect(status.json.data.count).toBeGreaterThan(0);
    const batches = await (
      await db()
    )
      .selectFrom('payrollImportBatches')
      .selectAll()
      .where('kind', '=', 'salaryFiles')
      .execute();
    expect(batches).toHaveLength(2);
  });
});

describe('社保公积金 · 参保 · 导入', () => {
  const header = [
    '工号',
    '姓名',
    '参保方案',
    '社保基数',
    '公积金基数',
    '参保起始月',
    '社保账号',
    '公积金账号',
  ];

  async function open() {
    return (await db())
      .selectFrom('employeeSocialInsurances')
      .selectAll()
      .where('employeeId', '=', await employeeIdOf('QH2002'))
      .where('status', '!=', 'stopped')
      .execute();
  }

  it('previews the problems, then updates the open enrolment instead of adding one', async () => {
    const preview = await send('payroll01', 'enrolments', 'preview', [
      header,
      ['QH2002', '李敏', '苏州', 8000, 8000, CURRENT, 'SB-0001', 'GJJ-0001'],
      ['QH9999', '张三', '苏州', 8000, 8000, CURRENT],
      ['QH2003', '钱进', '火星', 8000, 8000, CURRENT],
      ['QH2201', '陈晨', '苏州', -1, 8000, CURRENT],
      ['QH3001', '赵阳', '苏州', 8000, 8000, 'soon'],
      ['QH2002', '李敏', '苏州', 9000, 9000, CURRENT],
    ]);
    expect(preview.status).toBe(200);
    const data = preview.json.data;
    expect(problems(data, 2)).toEqual([]);
    expect(problems(data, 3)).toEqual(['工号:EMPLOYEE_NOT_FOUND']);
    expect(problems(data, 4)).toEqual(['参保方案:PLAN_NOT_FOUND']);
    expect(problems(data, 5)).toEqual(['社保基数:AMOUNT_INVALID']);
    expect(problems(data, 6)).toEqual(['参保起始月:MONTH_INVALID']);
    expect(problems(data, 7)).toEqual([':DUPLICATE_ROW']);
    const before = await open();
    const committed = await send('payroll01', 'enrolments', 'commit', [
      header,
      ['QH2002', '李敏', '苏州', 8000, 8000, CURRENT, 'SB-0001', 'GJJ-0001'],
    ]);
    expect(committed.status).toBe(200);
    const once = await open();
    expect(once).toHaveLength(Math.max(1, before.length));
    const again = await send('payroll01', 'enrolments', 'commit', [
      header,
      ['QH2002', '李敏', '苏州', 8500, 8500, CURRENT, 'SB-0002', 'GJJ-0001'],
    ]);
    expect(again.json.data).toMatchObject({ created: 0, updated: 1 });
    const twice = await open();
    expect(twice).toHaveLength(once.length);
    const current = twice.find((e) => !e.endMonth)!;
    expect(current).toMatchObject({
      status: 'active',
      socialAccountNo: 'SB-0002',
      housingFundAccountNo: 'GJJ-0001',
      startMonth: CURRENT,
    });
    expect(Number(current.socialBase)).toBe(8500);
  });
});

describe('专项附加扣除 · 导入', () => {
  const header = [
    '工号',
    '姓名',
    '年度',
    '扣除类型',
    '每月金额',
    '起始月',
    '结束月',
  ];

  async function rows() {
    return (await db())
      .selectFrom('employeeTaxDeductions')
      .selectAll()
      .where('employeeId', '=', await employeeIdOf('QH2003'))
      .where('year', '=', YEAR)
      .execute();
  }

  it('maps the types, names bad rows, and replaces the year on a second import', async () => {
    const before = JSON.stringify(await rows());
    const preview = await send('payroll01', 'deductions', 'preview', [
      header,
      ['QH2003', '钱进', YEAR, '子女教育', 2000, `${YEAR}-01`, null],
      ['QH2003', '钱进', YEAR, '赡养老人', 1500, `${YEAR}-03`, `${YEAR}-12`],
      ['QH9999', '张三', YEAR, '子女教育', 2000, `${YEAR}-01`],
      ['QH2201', '陈晨', YEAR, '买房', 2000, `${YEAR}-01`],
      ['QH2201', '陈晨', YEAR, '继续教育', 'x', `${YEAR}-01`],
      ['QH2201', '陈晨', YEAR, '继续教育', 400, `${YEAR - 1}-01`],
      ['QH2201', '陈晨', YEAR, '继续教育', 400, `${YEAR}-05`, `${YEAR}-02`],
    ]);
    const data = preview.json.data;
    expect(data.validRows).toBe(2);
    expect(problems(data, 4)).toEqual(['工号:EMPLOYEE_NOT_FOUND']);
    expect(problems(data, 5)).toEqual(['扣除类型:DEDUCTION_TYPE_UNKNOWN']);
    expect(problems(data, 6)).toEqual(['每月金额:AMOUNT_INVALID']);
    expect(problems(data, 7)).toEqual(['起始月:MONTH_NOT_IN_YEAR']);
    expect(problems(data, 8)).toEqual(['结束月:END_BEFORE_START']);
    expect(JSON.stringify(await rows())).toBe(before);
    const first = await send('payroll01', 'deductions', 'commit', [
      header,
      ['QH2003', '钱进', YEAR, '子女教育', 2000, `${YEAR}-01`, null],
      ['QH2003', '钱进', YEAR, '赡养老人', 1500, `${YEAR}-03`, `${YEAR}-12`],
    ]);
    expect(first.status).toBe(200);
    let stored = await rows();
    expect(stored).toHaveLength(1);
    const items = (v: unknown) => decode(v) as Json[];
    expect(items(stored[0].items)).toEqual([
      {
        type: 'children',
        monthlyAmount: 2000,
        startMonth: `${YEAR}-01`,
        endMonth: null,
      },
      {
        type: 'elderly',
        monthlyAmount: 1500,
        startMonth: `${YEAR}-03`,
        endMonth: `${YEAR}-12`,
      },
    ]);
    const again = await send('payroll01', 'deductions', 'commit', [
      header,
      ['QH2003', '钱进', YEAR, '3岁以下婴幼儿照护', 2000, `${YEAR}-02`],
    ]);
    expect(again.json.data).toMatchObject({ created: 0, updated: 1 });
    stored = await rows();
    expect(stored).toHaveLength(1);
    expect(items(stored[0].items)).toEqual([
      {
        type: 'infantCare',
        monthlyAmount: 2000,
        startMonth: `${YEAR}-02`,
        endMonth: null,
      },
    ]);
    expect(stored[0].source).toBe('import');
  });
});

describe('本年个税累计期初', () => {
  const header = [
    '工号',
    '姓名',
    '年度',
    '截至月份',
    '累计收入',
    '累计减除费用',
    '累计专项扣除',
    '累计专项附加扣除',
    '累计其他扣除',
    '累计已预扣税额',
  ];
  const months = Number(THROUGH.slice(5, 7));
  const opening = (withheld: number) => [
    'QH2001',
    '王磊',
    YEAR,
    THROUGH,
    9000 * months,
    5000 * months,
    800 * months,
    2000 * months,
    100 * months,
    withheld,
  ];

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
  const round = (n: number) => Math.round(n * 100) / 100;

  it('refuses a cut-off before an approved month and other bad rows, writing nothing', async () => {
    const preview = await send('payroll01', 'tax-openings', 'preview', [
      header,
      opening(100),
      // 王磊's payslip of the published month was approved without an opening after this cut-off.
      ['QH2001', '王磊', YEAR, addMonths(PUBLISHED, -1), 1, 1, 0, 0, 0, 0],
      ['QH9999', '张三', YEAR, THROUGH, 1, 1, 0, 0, 0, 0],
      ['QH2002', '李敏', 'abc', THROUGH, 1, 1, 0, 0, 0, 0],
      ['QH2003', '钱进', YEAR, `${YEAR - 1}-06`, 1, 1, 0, 0, 0, 0],
      ['QH2201', '陈晨', YEAR, THROUGH, -5, 1, 0, 0, 0, 0],
    ]);
    const data = preview.json.data;
    expect(problems(data, 2)).toEqual([]);
    expect(problems(data, 3)).toEqual(['截至月份:TAX_OPENING_AFTER_LOCKED']);
    expect(problems(data, 4)).toEqual(['工号:EMPLOYEE_NOT_FOUND']);
    expect(problems(data, 5)).toEqual(['年度:YEAR_INVALID']);
    expect(problems(data, 6)).toEqual(['截至月份:MONTH_NOT_IN_YEAR']);
    expect(problems(data, 7)).toEqual(['累计收入:AMOUNT_INVALID']);
    expect(
      await (await db()).selectFrom('payrollTaxOpenings').selectAll().execute(),
    ).toHaveLength(0);
  });

  it('stores the opening and updates it on a second import', async () => {
    const first = await send('payroll01', 'tax-openings', 'commit', [
      header,
      opening(100),
    ]);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ created: 1, updated: 0 });
    const again = await send('payroll01', 'tax-openings', 'commit', [
      header,
      opening(1234.5),
    ]);
    expect(again.json.data).toMatchObject({ created: 0, updated: 1 });
    const rows = await (
      await db()
    )
      .selectFrom('payrollTaxOpenings')
      .selectAll()
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ year: YEAR, throughMonth: THROUGH });
    expect(Number(rows[0].withheldYtd)).toBe(1234.5);
    const status = await h.call(
      'payroll01',
      'GET',
      '/payroll-imports/tax-openings/status',
    );
    if (YEAR === Number(CURRENT.slice(0, 4)))
      expect(status.json.data.count).toBe(1);
  });

  it.skipIf(CURRENT.endsWith('-01'))(
    'withholds this month from the opening, not adding the month NocoHR already calculated',
    async () => {
      const database = await h.db();
      const now = new Date();
      // Every employee's attendance of this month, locked.
      const employees = await database
        .query()
        .selectFrom('employees')
        .select(['id'])
        .execute();
      for (const { id } of employees) {
        const employeeId = String(id);
        const exists = await database
          .query()
          .selectFrom('attendanceMonthlySummaries')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('month', '=', CURRENT)
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
              id: `test-${employeeId}-${CURRENT}`,
              employeeId,
              month: CURRENT,
              scheduledDays: 21,
              workedDays: 21,
              lateCount: 0,
              earlyCount: 0,
              missingCount: 0,
              absentDays: 0,
              leaveByType: {},
              overtimeByType: {},
              nightShiftCount: 0,
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
      const created = await h.call('payroll01', 'POST', '/payroll/cycles', {
        month: CURRENT,
      });
      expect(created.status).toBe(201);
      const cycleId = created.json.data.id as string;
      const calculated = await h.call(
        'payroll01',
        'POST',
        `/payroll/cycles/${cycleId}/calculate`,
      );
      expect(calculated.status).toBe(200);
      const slip = await database
        .query()
        .selectFrom('payslips')
        .selectAll()
        .where('cycleId', '=', cycleId)
        .where('employeeId', '=', 'emp-wanglei')
        .executeTakeFirstOrThrow();
      const inputs = decode(slip.inputs) as Json;
      const t = inputs.tax as Json;
      const stored = (await database
        .query()
        .selectFrom('payrollTaxOpenings')
        .selectAll()
        .executeTakeFirstOrThrow()) as Json;
      const openingMonthsCount =
        Number(THROUGH.slice(5, 7)) -
        Number(String(stored.startMonth).slice(5, 7)) +
        1;
      expect(t.opening).toMatchObject({ throughMonth: THROUGH });
      expect(t.months).toBe(openingMonthsCount + 1);
      // Only the opening and this month: the published month's NocoHR payslip is not added again.
      expect(t.incomeYtd).toBe(round(Number(stored.incomeYtd) + t.incomeMonth));
      expect(t.basicDeductionYtd).toBe(
        round(Number(stored.basicDeductionYtd) + 5000),
      );
      const insurance = round(
        Number(stored.insuranceYtd) +
          Number(slip.socialEmployee) +
          Number(slip.housingFundEmployee),
      );
      expect(t.insuranceYtd).toBe(insurance);
      expect(t.specialDeductionYtd).toBe(
        round(Number(stored.specialDeductionYtd) + t.specialDeductionMonth),
      );
      expect(t.otherDeductionYtd).toBe(Number(stored.otherDeductionYtd));
      const taxable = round(
        Math.max(
          0,
          t.incomeYtd -
            t.basicDeductionYtd -
            insurance -
            t.specialDeductionYtd -
            t.otherDeductionYtd,
        ),
      );
      expect(t.taxableYtd).toBe(taxable);
      const expected = round(
        Math.max(0, round(withholding(taxable)) - Number(stored.withheldYtd)),
      );
      expect(Number(slip.tax)).toBe(expected);
      expect(Number(slip.taxWithheldYtd)).toBe(
        round(Number(stored.withheldYtd) + expected),
      );
      // The calculated (not yet approved) month goes back to draft when the opening changes.
      const preview = await send('payroll01', 'tax-openings', 'preview', [
        header,
        opening(1234.5),
      ]);
      expect(
        (preview.json.data.rows as Json[])[0].warnings.map((w: Json) => w.code),
      ).toContain('RECALCULATE_NEEDED');
      await send('payroll01', 'tax-openings', 'commit', [
        header,
        opening(1234.5),
      ]);
      const cycle = await h.call(
        'payroll01',
        'GET',
        `/payroll/cycles/${cycleId}`,
      );
      expect(cycle.json.data.cycle.status).toBe('draft');
    },
  );
});

describe('record scope of the grant', () => {
  let release: () => Promise<void>;

  beforeAll(async () => {
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const service = h.server.application.container.resolve(authorizationToken);
    const { salaryResource } =
      await import('../../server/providers/hr/payroll/resources.ts');
    await service.permissionSets.create({
      key: 'test-scoped-opening',
      title: 'test-scoped-opening',
      grants: [
        salaryResource.reference().grant({
          view: {
            employees: MANAGED,
            employeeSalaries: ALL,
            salaryAdjustments: ALL,
            salaryStructures: ALL,
          },
          import: {
            employees: MANAGED,
            employeeSalaries: ALL,
            salaryStructures: ALL,
          },
        }),
      ] as never,
    });
    const assignment = await service.permissionSets.assign({
      permissionSet: 'test-scoped-opening',
      subject: { type: 'user', id: await h.userId('mgr_njl') },
    });
    release = async () => {
      await service.permissionSets.revoke(
        String((assignment as { id: string }).id),
      );
      await service.permissionSets.delete('test-scoped-opening');
    };
  });

  afterAll(async () => {
    await release?.();
  });

  it('makes an employee outside the departments the grant reaches an error of the row', async () => {
    const scoped = await h.call('mgr_njl', 'GET', '/salaries');
    expect(scoped.status).toBe(200);
    const inside = (scoped.json.data.rows as Json[])[0];
    const all = await h.call('payroll01', 'GET', '/salaries');
    const insideNos = new Set(
      (scoped.json.data.rows as Json[]).map((r) => r.employeeNo),
    );
    const outside = (all.json.data.rows as Json[]).find(
      (r) => !insideNos.has(r.employeeNo),
    )!;
    const row = (no: string, name: string) => [
      no,
      name,
      '职能薪资结构',
      addMonths(CURRENT, 1),
      7000,
      300,
    ];
    const preview = await send('mgr_njl', 'salary-files', 'preview', [
      [
        '工号',
        '姓名',
        '薪资结构',
        '生效月份',
        '基本工资（base）',
        '岗位津贴（post）',
      ],
      row(inside.employeeNo, inside.name),
      row(outside.employeeNo, outside.name),
    ]);
    expect(preview.status).toBe(200);
    expect(problems(preview.json.data, 2)).toEqual([]);
    expect(problems(preview.json.data, 3)).toEqual([
      '工号:EMPLOYEE_OUT_OF_SCOPE',
    ]);
    expect(
      (await h.call('mgr_njl', 'GET', '/payroll-imports/salary-files/status'))
        .status,
    ).toBe(200);
    expect(
      (await h.call('mgr_njl', 'GET', '/payroll-imports/tax-openings/status'))
        .status,
    ).toBe(403);
  });
});

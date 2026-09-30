import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { defineSeed, type SeedDefinition } from '@nocobase/db';
import * as XLSX from 'xlsx';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';
import {
  calculatePayslip,
  type PriorTax,
} from '../../../server/providers/hr/payroll/calc.js';
import { payableDaysFor } from '../../../server/providers/hr/payroll/common.js';
import { PAYROLL_SETTINGS_DEFAULTS } from '../../../server/providers/hr/payroll/config.js';
import {
  DEFAULT_SALARY,
  DEMO_BILL_LINES,
  DEMO_BILL_RATE,
  DEMO_DISPATCHED,
  DEMO_PERF_BONUS,
  DEMO_PIECE_COUNTS,
  DEMO_PLANS,
  DEMO_SALARIES,
  DEMO_STRUCTURE_IDS,
  DEMO_VENDOR,
  nightRate,
  officeItems,
  productionItems,
} from '../../../server/providers/hr/payroll/demo-data.js';

/**
 * V2-06 测试数据 (演示案例 · V2 数据), development and demo only: skipped when
 * NODE_ENV=production, HR_DEMO_SEED=false or HR_PAYROLL_DEMO=false, and
 * written once (skipped when any salary structure exists). 算薪月 is the month
 * before the seed runs (Asia/Shanghai); the previous cycle is the month
 * before that. Every amount is an example.
 *
 * - 财务部; payroll01 许婷 (人力资源部, 薪酬专员, hr.payroll) and fin01 韩冬
 *   (财务部, 财务经理, hr.payrollApprover).
 * - Structures: 生产一线 (苏州工厂, nightRate 50, CNC and assembler ranges),
 *   成都生产一线 (成都工厂, nightRate 40 set after 《机加工车间排班须知》, in its
 *   change log), 职能 (no night shift). No piece-rate items: the acceptance
 *   adds them.
 * - Salary files for everyone on the books (post allowance included); plans
 *   for 苏州 and 成都; every file holder is enrolled in the city of their
 *   plant (head office: 苏州); 王磊 has 子女教育.
 * - 算薪月 summaries, all locked except 孙丽's (装配车间), for the
 *   prerequisite check: 王磊 12 nights, 6 h workday overtime, 1 day 事假;
 *   钱进 5 days 事假; 赵阳 10 nights; 孙丽 15 and 杨帆 8 装配白班.
 * - 杨帆 (装配车间, 装配工, no account) joins on the 15th of 算薪月.
 * - 4 dispatched CNC operators of 蓉川人力 in 成都机加工车间, 21 × 8 h of
 *   locked attendance each (672 h).
 * - The previous cycle, published, for "较上月" and the cumulative tax.
 * - storage/demo-materials: 车间月度绩效奖金.xlsx, 装配车间计件数.xlsx and
 *   蓉川人力账单.xlsx for the acceptance.
 */
const TZ = 'Asia/Shanghai';

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
function workdays(month: string): string[] {
  const days: string[] = [];
  for (
    let d = new Date(`${month}-01T00:00:00Z`);
    d.toISOString().slice(0, 7) === month;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
const text = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : '';
const dateOnly = (value: unknown): string | null => {
  const t = text(value);
  return t ? t.slice(0, 10) : null;
};

const seed: SeedDefinition = defineSeed({
  name: '202610010102_demo_payroll',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_PAYROLL_DEMO === 'false'
    )
      return;
    const hasDemo = await query
      .selectFrom('employees')
      .select(['id'])
      .where('id', '=', 'emp-wanglei')
      .executeTakeFirst();
    const anyStructure = await query
      .selectFrom('salaryStructures')
      .select(['id'])
      .executeTakeFirst();
    if (!hasDemo || anyStructure) return;

    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = localToday();
    const month = addMonths(today.slice(0, 7), -1);
    const previous = addMonths(month, -1);
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select(['id'])
          .where('id', '=', id)
          .executeTakeFirst(),
      );

    // ---- 财务部 and the two accounts ----
    if (!(await exists('departments', 'finance')))
      await query
        .insertInto('departments')
        .values({
          id: 'finance',
          code: 'FIN',
          title: '财务部',
          parentId: 'qiheng',
          managerId: null,
          active: true,
          sortOrder: 2,
          ...stamp,
        })
        .execute();
    const people = [
      {
        id: 'emp-payroll01',
        employeeNo: 'QH1007',
        name: '许婷',
        username: 'payroll01',
        departmentId: 'hr',
        positionId: 'pos-office-payroll',
        hireDate: '2022-06-06',
        mobile: '13900000041',
        idNumber: '999999199306060041',
        gender: 'female',
        birthDate: '1993-06-06',
      },
      {
        id: 'emp-fin01',
        employeeNo: 'QH1008',
        name: '韩冬',
        username: 'fin01',
        departmentId: 'finance',
        positionId: 'pos-office-finance-manager',
        hireDate: '2019-09-02',
        mobile: '13900000042',
        idNumber: '999999198509020042',
        gender: 'male',
        birthDate: '1985-09-02',
      },
    ];
    const userIds = new Map<string, string>();
    for (const p of people) {
      const userId = await ensureDemoAccount(query, {
        username: p.username,
        name: p.name,
        email: `${p.username}@demo.test`,
      });
      userIds.set(p.username, userId);
      if (await exists('employees', p.id)) continue;
      await query
        .insertInto('employees')
        .values({
          id: p.id,
          employeeNo: p.employeeNo,
          name: p.name,
          userId,
          departmentId: p.departmentId,
          positionId: p.positionId,
          managerEmployeeId: null,
          status: 'active',
          hireDate: p.hireDate,
          positionSince: p.hireDate,
          email: `${p.username}@demo.test`,
          mobile: p.mobile,
          note: null,
          gender: p.gender,
          birthDate: p.birthDate,
          idType: 'idCard',
          idNumber: p.idNumber,
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '苏州市吴中区东吴南路 216 号 4 幢 1102 室',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('departmentMembers')
        .values({
          id: randomUUID(),
          departmentId: p.departmentId,
          userId,
          primary: true,
          active: true,
          ...stamp,
        })
        .execute();
    }
    const assign = async (permissionSetKey: string, userId: string) => {
      const existing = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select(['id'])
        .where('permissionSetKey', '=', permissionSetKey)
        .where('subjectType', '=', 'user')
        .where('subjectId', '=', userId)
        .executeTakeFirst();
      if (existing) return;
      await query
        .insertInto('authorizationPermissionSetAssignments')
        .values({
          id: randomUUID(),
          permissionSetKey,
          subjectType: 'user',
          subjectId: userId,
          ...stamp,
        })
        .execute();
    };
    await assign('hr.payroll', userIds.get('payroll01')!);
    await assign('hr.payrollApprover', userIds.get('fin01')!);
    for (const key of [
      'hrAssistant.payrollCheck',
      'vendorReconciler.billReview',
    ])
      if (!(await exists('aiAutomationSettings', key)))
        await query
          .insertInto('aiAutomationSettings')
          .values({
            id: key,
            enabled: true,
            ownerUserId: userIds.get('payroll01')!,
            hour: null,
            weekday: null,
            monthDay: null,
            params: null,
            updatedByUserId: null,
            ...stamp,
          })
          .execute();

    // ---- 杨帆 and the dispatched workers ----
    const employeeRow = (values: Record<string, unknown>) => ({
      userId: null,
      managerEmployeeId: null,
      status: 'active',
      email: null,
      note: null,
      idType: 'idCard',
      workLocation: null,
      probationEndDate: null,
      regularizedAt: null,
      leaveDate: null,
      leaveReason: null,
      address: '苏州市吴中区宝带东路 58 号 2 幢 603 室',
      ...stamp,
      ...values,
    });
    const yangfanHire = `${month}-15`;
    if (!(await exists('employees', 'emp-yangfan')))
      await query
        .insertInto('employees')
        .values(
          employeeRow({
            id: 'emp-yangfan',
            employeeNo: 'QH2106',
            name: '杨帆',
            departmentId: 'sz-as',
            positionId: 'pos-assembler',
            managerEmployeeId: 'emp-mgr-east',
            status: 'probation',
            hireDate: yangfanHire,
            positionSince: yangfanHire,
            mobile: '13900000051',
            gender: 'female',
            birthDate: '2003-03-03',
            idNumber: '999999200303030051',
            employmentType: 'fullTime',
            probationEndDate: `${addMonths(month, 3)}-14`,
          }),
        )
        .execute();
    for (const [index, d] of DEMO_DISPATCHED.entries())
      if (!(await exists('employees', d.id)))
        await query
          .insertInto('employees')
          .values(
            employeeRow({
              id: d.id,
              employeeNo: d.employeeNo,
              name: d.name,
              departmentId: 'cd-mc',
              positionId: 'pos-cnc-operator',
              hireDate: `${today.slice(0, 4)}-03-01`,
              positionSince: `${today.slice(0, 4)}-03-01`,
              mobile: `1390000006${index}`,
              gender: 'male',
              birthDate: '1996-01-0' + String(index + 1),
              idNumber: `99999919960101006${index}`,
              employmentType: 'dispatched',
            }),
          )
          .execute();

    // ---- Settings, structures, plans ----
    if (!(await exists('personnelSettings', 'payroll.settings')))
      await query
        .insertInto('personnelSettings')
        .values({
          id: 'payroll.settings',
          value: {
            ...PAYROLL_SETTINGS_DEFAULTS,
            minimumWage: [
              { city: '苏州', amount: 2490 },
              { city: '成都', amount: 2100 },
            ],
            socialInsurance: {
              ...PAYROLL_SETTINGS_DEFAULTS.socialInsurance,
              cityByDepartment: [
                { departmentId: 'cd', city: '成都' },
                { departmentId: 'qiheng', city: '苏州' },
              ],
            },
          },
          revision: 1,
          updatedBy: 'system',
          ...stamp,
        })
        .execute();
    const seededAt = now.toISOString();
    const structures = [
      {
        id: DEMO_STRUCTURE_IDS.suzhou,
        title: '生产一线薪资结构',
        appliesTo: { jobFamilyIds: ['jf-prod'], departmentIds: ['sz'] },
        items: productionItems(),
        params: [nightRate(50)],
        payRanges: [
          { positionId: 'pos-cnc-operator', min: 5000, max: 9000 },
          { positionId: 'pos-assembler', min: 4500, max: 8000 },
        ],
        changeLog: [
          {
            by: 'system',
            byName: null,
            at: seededAt,
            summary:
              '新建结构；设置参数 nightRate = 50（依据《考勤与加班管理制度》）',
          },
        ],
      },
      {
        id: DEMO_STRUCTURE_IDS.chengdu,
        title: '成都生产一线薪资结构',
        appliesTo: { jobFamilyIds: ['jf-prod'], departmentIds: ['cd'] },
        items: productionItems(),
        params: [nightRate(40)],
        payRanges: [{ positionId: 'pos-cnc-operator', min: 4800, max: 8500 }],
        changeLog: [
          { by: 'system', byName: null, at: seededAt, summary: '新建结构' },
          {
            by: 'system',
            byName: null,
            at: seededAt,
            summary:
              '设置参数 nightRate = 40（参照《机加工车间排班须知》设置）',
          },
        ],
      },
      {
        id: DEMO_STRUCTURE_IDS.office,
        title: '职能薪资结构',
        appliesTo: { jobFamilyIds: ['jf-office'], departmentIds: [] },
        items: officeItems(),
        params: [],
        payRanges: [],
        changeLog: [
          { by: 'system', byName: null, at: seededAt, summary: '新建结构' },
        ],
      },
    ];
    for (const s of structures)
      await query
        .insertInto('salaryStructures')
        .values({ ...s, payDaysPerMonth: 21.75, active: true, ...stamp })
        .execute();
    for (const plan of DEMO_PLANS)
      await query
        .insertInto('socialInsurancePlans')
        .values({
          id: plan.id,
          city: plan.city,
          effectiveFrom: `${Number(today.slice(0, 4)) - 1}-07`,
          effectiveTo: null,
          items: plan.items,
          note: '费率与基数上下限由薪酬专员按当地当年公布的标准维护。',
          ...stamp,
        })
        .execute();

    // ---- Salary files and enrolments for everyone on the books ----
    const employees = (
      await query
        .selectFrom('employees')
        .select([
          'id',
          'employeeNo',
          'name',
          'departmentId',
          'positionId',
          'status',
          'hireDate',
          'leaveDate',
          'employmentType',
        ])
        .execute()
    ).map((e) => ({
      id: text(e.id),
      employeeNo: text(e.employeeNo),
      name: text(e.name),
      departmentId: text(e.departmentId),
      positionId: e.positionId ? text(e.positionId) : null,
      status: text(e.status),
      hireDate: dateOnly(e.hireDate),
      leaveDate: dateOnly(e.leaveDate),
      employmentType: text(e.employmentType),
    }));
    const departments = (
      await query.selectFrom('departments').select(['id', 'parentId']).execute()
    ).map((d) => ({
      id: text(d.id),
      parentId: d.parentId ? text(d.parentId) : null,
    }));
    const chain = (id: string) => {
      const result: string[] = [];
      let current = departments.find((d) => d.id === id);
      while (current && !result.includes(current.id)) {
        result.push(current.id);
        current = current.parentId
          ? departments.find((d) => d.id === current!.parentId)
          : undefined;
      }
      return result;
    };
    const families = new Map(
      (
        await query
          .selectFrom('positions')
          .select(['id', 'jobFamilyId'])
          .execute()
      ).map((p) => [text(p.id), text(p.jobFamilyId)]),
    );
    const structureFor = (e: {
      departmentId: string;
      positionId: string | null;
    }) => {
      const c = chain(e.departmentId);
      const family = e.positionId ? families.get(e.positionId) : undefined;
      if (family === 'jf-prod')
        return c.includes('cd') ? structures[1] : structures[0];
      return structures[2];
    };
    const cityFor = (departmentId: string) =>
      chain(departmentId).includes('cd') ? '成都' : '苏州';
    const paid = employees.filter(
      (e) =>
        e.employmentType !== 'dispatched' &&
        e.status !== 'leave' &&
        (!e.leaveDate || e.leaveDate >= `${previous}-01`),
    );
    const files = new Map<
      string,
      {
        base: number;
        post: number;
        structure: (typeof structures)[number];
        effectiveMonth: string;
      }
    >();
    for (const e of paid) {
      const salary = DEMO_SALARIES[e.id] ?? DEFAULT_SALARY;
      const hireMonth = e.hireDate ? e.hireDate.slice(0, 7) : previous;
      const effectiveMonth = hireMonth > previous ? hireMonth : previous;
      const structure = structureFor(e);
      files.set(e.id, { ...salary, structure, effectiveMonth });
      await query
        .insertInto('employeeSalaries')
        .values({
          id: `salary-${e.id}`,
          employeeId: e.id,
          effectiveMonth,
          baseSalary: salary.base,
          fixedAllowances: [{ code: 'post', amount: salary.post }],
          salaryStructureId: structure.id,
          bankAccount: {
            bankName: '金鸡湖银行苏州分行',
            accountNo: `6222 0000 ${e.employeeNo.slice(2)} ${String(1000 + paid.indexOf(e)).slice(-4)}`,
            accountName: e.name,
          },
          source: 'import',
          adjustmentId: null,
          createdBy: 'system',
          ...stamp,
        })
        .execute();
      // Insured from the hiring month, or the next one after the 15th.
      const start =
        e.hireDate && e.hireDate.slice(0, 7) >= previous
          ? Number(e.hireDate.slice(8, 10)) > 15
            ? addMonths(e.hireDate.slice(0, 7), 1)
            : e.hireDate.slice(0, 7)
          : `${Number(today.slice(0, 4)) - 1}-07`;
      const base = salary.base + salary.post;
      await query
        .insertInto('employeeSocialInsurances')
        .values({
          id: `si-${e.id}`,
          employeeId: e.id,
          planCity: cityFor(e.departmentId),
          socialBase: base,
          housingFundBase: base,
          startMonth: start,
          endMonth: null,
          status: 'active',
          pendingAction: null,
          changeLog: [
            { at: seededAt, by: null, summary: '初始化参保记录' },
          ],
          sourceEventId: null,
          ...stamp,
        })
        .execute();
    }
    await query
      .insertInto('employeeTaxDeductions')
      .values({
        id: 'tax-deduction-wanglei',
        employeeId: 'emp-wanglei',
        year: Number(month.slice(0, 4)),
        items: [
          {
            type: 'children',
            monthlyAmount: 2000,
            startMonth: `${month.slice(0, 4)}-01`,
            endMonth: null,
          },
        ],
        source: 'manual',
        ...stamp,
      })
      .execute();

    // ---- 算薪月 attendance summaries ----
    const figures: Record<
      string,
      {
        night?: number;
        overtime?: Record<string, number>;
        leave?: Record<string, number>;
        shifts?: Record<string, number>;
        locked?: boolean;
      }
    > = {
      'emp-wanglei': {
        night: 12,
        overtime: { workday: 6 },
        leave: { personal: 1 },
        shifts: { 'mc-night': 12, 'mc-early': 8 },
      },
      'emp-qianjin': { leave: { personal: 5 }, shifts: { 'mc-early': 17 } },
      'emp-zhaoyang': { night: 10, shifts: { 'mc-night': 10, 'mc-early': 11 } },
      'emp-sunli': { shifts: { 'as-day': 15 }, locked: false },
      'emp-yangfan': { shifts: { 'as-day': 8 } },
    };
    const summaryFor = async (
      employeeId: string,
      value: string,
      f: (typeof figures)[string],
      locked: boolean,
    ) => {
      const existing = await query
        .selectFrom('attendanceMonthlySummaries')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('month', '=', value)
        .executeTakeFirst();
      const worked =
        Object.values(f.shifts ?? {}).reduce((s, v) => s + v, 0) || 21;
      const values = {
        scheduledDays: worked + (f.leave?.personal ?? 0),
        workedDays: worked,
        lateCount: 0,
        earlyCount: 0,
        missingCount: 0,
        absentDays: 0,
        leaveByType: f.leave ?? {},
        overtimeByType: f.overtime ?? {},
        nightShiftCount: f.night ?? 0,
        shiftCounts: f.shifts ?? {},
        status: locked ? 'locked' : 'confirmed',
        objection: null,
        confirmedAt: now,
        lockedBy: locked ? 'system' : null,
        lockedAt: locked ? now : null,
        lockLog: locked
          ? [{ action: 'lock', by: 'system', at: seededAt }]
          : null,
        updatedAt: now,
      };
      if (existing)
        await query
          .updateTable('attendanceMonthlySummaries')
          .set(values)
          .where('id', '=', text(existing.id))
          .execute();
      else
        await query
          .insertInto('attendanceMonthlySummaries')
          .values({
            id: randomUUID(),
            employeeId,
            month: value,
            ...values,
            createdAt: now,
          })
          .execute();
    };
    const monthEndDate = monthEnd(month);
    for (const e of paid) {
      if (e.hireDate && e.hireDate > monthEndDate) continue;
      const f = figures[e.id] ?? {};
      await summaryFor(e.id, month, f, f.locked !== false);
    }
    // The dispatched workers: 21 × 8 h each, locked. The daily records need the attendance demo's early shift;
    // without it (HR_ATTENDANCE_DEMO=false) only the summaries are written and the bill shows no attendance.
    const days = workdays(month).slice(0, 21);
    const earlyShift = await exists('shifts', 'shift-mc-early');
    for (const d of DEMO_DISPATCHED) {
      await summaryFor(
        d.id,
        month,
        { shifts: { 'mc-early': days.length } },
        true,
      );
      if (!earlyShift) continue;
      for (const date of days) {
        const existing = await query
          .selectFrom('attendanceRecords')
          .select(['id'])
          .where('employeeId', '=', d.id)
          .where('date', '=', date)
          .executeTakeFirst();
        if (existing) continue;
        await query
          .insertInto('attendanceRecords')
          .values({
            id: `rec-${d.id}-${date}`,
            employeeId: d.id,
            date,
            shiftId: 'shift-mc-early',
            punches: [],
            checkIn: new Date(`${date}T06:00:00+08:00`),
            checkOut: new Date(`${date}T14:30:00+08:00`),
            status: 'normal',
            lateMinutes: null,
            earlyMinutes: null,
            workedMinutes: 480,
            overtimeMinutes: null,
            leaveRequestId: null,
            computedAt: now,
            ...stamp,
          })
          .execute();
      }
    }

    // ---- The previous cycle, published: January (or the hiring month) up to it, chained for the cumulative tax ----
    const cycleId = `payroll-${previous}`;
    await query
      .insertInto('payrollCycles')
      .values({
        id: cycleId,
        month: previous,
        scope: { departmentIds: [] },
        status: 'published',
        imports: [],
        calculatedAt: now,
        calculationId: randomUUID(),
        calculatedBy: userIds.get('payroll01')!,
        submittedBy: userIds.get('payroll01')!,
        submittedAt: now,
        approvals: [
          {
            level: 1,
            title: '财务审批',
            permissionSet: 'hr.payrollApprover',
            status: 'approved',
            decidedBy: userIds.get('fin01')!,
            decidedByName: '韩冬',
            decidedAt: seededAt,
            comment: null,
          },
        ],
        approvedBy: userIds.get('fin01')!,
        approvedAt: now,
        publishedAt: now,
        publishedBy: userIds.get('payroll01')!,
        exports: [],
        review: null,
        ...stamp,
      })
      .execute();
    const calendar = {
      holidays: new Set<string>(),
      adjustedWorkdays: new Set<string>(),
    };
    const plans = new Map(
      DEMO_PLANS.map((p) => [p.city, p.items.map((i) => ({ ...i }))]),
    );
    const previousFigures: Record<string, { night?: number; bonus?: number }> =
      {
        'emp-wanglei': { night: 10, bonus: 500 },
        'emp-zhaoyang': { night: 10, bonus: 500 },
        'emp-wumin': { night: 8, bonus: 450 },
        'emp-dengkai': { night: 8, bonus: 450 },
      };
    for (const e of paid) {
      const file = files.get(e.id)!;
      if (file.effectiveMonth > previous) continue;
      if (e.hireDate && e.hireDate > monthEnd(previous)) continue;
      const year = previous.slice(0, 4);
      const hired = e.hireDate?.slice(0, 7) ?? `${year}-01`;
      const start = hired > `${year}-01` ? hired : `${year}-01`;
      let prior: PriorTax = {
        months: 0,
        incomeYtd: 0,
        insuranceYtd: 0,
        withheldYtd: 0,
        startMonth: start,
      };
      const pf = previousFigures[e.id] ?? {};
      let result: ReturnType<typeof calculatePayslip> | null = null;
      let payable = null as ReturnType<typeof payableDaysFor> | null;
      for (let m = start; m <= previous; m = addMonths(m, 1)) {
        payable = payableDaysFor(
          { hireDate: e.hireDate, leaveDate: e.leaveDate },
          m,
          21.75,
          calendar,
        );
        const months = Number(m.slice(5, 7)) - Number(start.slice(5, 7)) + 1;
        result = calculatePayslip({
          month: m,
          departmentChain: chain(e.departmentId),
          salary: {
            id: `salary-${e.id}`,
            effectiveMonth: file.effectiveMonth,
            baseSalary: file.base,
            fixedAllowances: [{ code: 'post', amount: file.post }],
          },
          structure: {
            id: file.structure.id,
            title: file.structure.title,
            items: file.structure.items,
            params: file.structure.params,
            payDaysPerMonth: 21.75,
          },
          payableDays: payable.payableDays,
          attendance: {
            nightShiftCount: pf.night ?? 0,
            absentDays: 0,
            shiftCounts: {},
            overtimeByType: {},
            leaveByType: {},
          },
          importedValues: { perfBonus: pf.bonus ?? 0 },
          manualItems: [],
          insurance: {
            planCity: cityFor(e.departmentId),
            socialBase: file.base + file.post,
            housingFundBase: file.base + file.post,
            items: plans.get(cityFor(e.departmentId))!,
          },
          specialDeductionYtd: e.id === 'emp-wanglei' ? 2000 * months : 0,
          specialDeductionMonth: e.id === 'emp-wanglei' ? 2000 : 0,
          prior,
          tax: PAYROLL_SETTINGS_DEFAULTS.tax,
        });
        prior = {
          months: result.taxDetail.months,
          incomeYtd: result.taxDetail.incomeYtd,
          insuranceYtd: result.taxDetail.insuranceYtd,
          withheldYtd: result.taxWithheldYtd,
          startMonth: start,
        };
      }
      if (!result || !payable) continue;
      await query
        .insertInto('payslips')
        .values({
          id: `payslip-${previous}-${e.id}`,
          cycleId,
          employeeId: e.id,
          departmentId: e.departmentId,
          importedValues: { perfBonus: pf.bonus ?? 0 },
          inputs: {
            calculationId: 'seed',
            employee: {
              employeeNo: e.employeeNo,
              departmentId: e.departmentId,
              positionId: e.positionId,
              hireDate: e.hireDate,
              leaveDate: e.leaveDate,
            },
            salary: {
              id: `salary-${e.id}`,
              effectiveMonth: file.effectiveMonth,
              baseSalary: file.base,
              fixedAllowances: [{ code: 'post', amount: file.post }],
            },
            structure: {
              id: file.structure.id,
              title: file.structure.title,
              payDaysPerMonth: 21.75,
              params: file.structure.params,
              items: file.structure.items,
            },
            payableDays: payable,
            attendance: {
              summaryId: null,
              nightShiftCount: pf.night ?? 0,
              absentDays: 0,
              shiftCounts: {},
              overtimeByType: {},
              leaveByType: {},
            },
            importedValues: { perfBonus: pf.bonus ?? 0 },
            insurance: {
              enrolmentId: `si-${e.id}`,
              planId: DEMO_PLANS.find(
                (p) => p.city === cityFor(e.departmentId),
              )!.id,
              planCity: cityFor(e.departmentId),
              socialBase: file.base + file.post,
              housingFundBase: file.base + file.post,
              lines: result.insuranceLines,
              clamped: result.baseClamped,
            },
            deductions: {
              items: [],
              ytd: result.taxDetail.specialDeductionYtd,
              month: result.taxDetail.specialDeductionMonth,
            },
            tax: { ...result.taxDetail, incomeMonth: result.taxableIncome },
          },
          lines: result.lines,
          gross: result.gross,
          socialEmployee: result.socialEmployee,
          housingFundEmployee: result.housingFundEmployee,
          taxableIncomeYtd: result.taxableIncomeYtd,
          taxWithheldYtd: result.taxWithheldYtd,
          tax: result.tax,
          net: result.net,
          employerCost: result.employerCost,
          manualItems: [],
          issues: [],
          calculatedAt: now,
          viewedAt: null,
          ...stamp,
        })
        .execute();
    }

    // ---- The acceptance's sample files (development only) ----
    try {
      const materials = path.resolve(
        process.cwd(),
        'storage',
        'demo-materials',
      );
      mkdirSync(materials, { recursive: true });
      const workbook = (name: string, rows: unknown[][]) => {
        const book = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
        return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
      };
      writeFileSync(
        path.join(materials, '车间月度绩效奖金.xlsx'),
        workbook('绩效奖金', [
          ['工号', '姓名', '绩效奖金（perfBonus）'],
          ...DEMO_PERF_BONUS.map((r) => [...r]),
        ]),
      );
      writeFileSync(
        path.join(materials, '装配车间计件数.xlsx'),
        workbook('计件数', [
          ['工号', '姓名', '计件数（pieceCount）'],
          ...DEMO_PIECE_COUNTS.map((r) => [...r]),
        ]),
      );
      writeFileSync(
        path.join(materials, `${DEMO_VENDOR}账单.xlsx`),
        workbook('账单', [
          ['工号', '姓名', '工时', '金额'],
          ...DEMO_BILL_LINES.map(([no, name, hours]) => [
            no,
            name,
            hours,
            hours * DEMO_BILL_RATE,
          ]),
        ]),
      );
    } catch {
      // The samples are a convenience; the demo data above stands without them.
    }
  },
});
export default seed;

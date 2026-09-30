import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V2-05 测试数据 (演示案例 · V2 数据), development and demo only, written
 * once (skipped when any shift exists). Dates are relative to the day the seed
 * runs, in Asia/Shanghai: "第 N 天" is today + N.
 *
 * - 班次 mc-early / mc-middle / mc-night (机加工车间与成都机加工车间),
 *   as-day / as-night (装配车间), office-day (全部门).
 * - 规则: 机加工车间三班倒、装配车间两班倒 (综合计算工时, 考勤机导入),
 *   职能部门标准工时 (根部门, 飞书打卡).
 * - 轮班模板: 三班倒 · 每周轮换 (早 → 中 → 夜), 两班倒 · 每周轮换 (白 → 夜).
 * - 假期类型: the documented codes; fixed days are examples only — HR checks
 *   them against local rules before going live.
 * - 工作年限: 钱进 12 年, 李敏 5 年, 王磊 8 年; 陈晨 (机加工车间, 当年 7 月 1 日入职,
 *   工作 3 年, 无账号).
 * - 节假日日历: this year's 国庆 (示例).
 * - 排班: the next 14 days published for 机加工车间, 成都机加工车间 and 装配车间;
 *   钱进 day 5 早班, 李敏 day 4 早班 · day 5 休息 · day 6 中班, 王磊 day 3–4
 *   休息 (年假) and working on day 5; the three days before today for
 *   机加工车间 (the device export covers them); 职能部门 office-day on workdays.
 * - 请假: 王磊's approved 2-day annual leave (days 3–4), with his balance.
 * - 加班: 王磊's approved workday overtime this month, 30 hours.
 * - 上月: schedules and computed records of the three workshops, for the
 *   monthly summary and payroll.
 *
 * Balances for everyone else are left to 年度余额初始化, which the acceptance
 * runs by hand. The device export and the Feishu punches are generated on
 * request (dev only), from the schedules above.
 */
const TZ = 'Asia/Shanghai';

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) - years}${date.slice(4)}`;
}
/** A wall-clock time in Asia/Shanghai (UTC+8, no DST) as an instant. */
function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+08:00`);
}
/** A user id column as text (ids are strings or integers). */
function idOf(value: unknown): string {
  return typeof value === 'number'
    ? String(value)
    : typeof value === 'string'
      ? value
      : '';
}
function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

const SHIFTS = [
  {
    id: 'shift-mc-early',
    code: 'mc-early',
    title: '机加工早班',
    startTime: '06:00',
    endTime: '14:00',
    isNight: false,
    departmentIds: ['sz-mc', 'cd-mc'],
  },
  {
    id: 'shift-mc-middle',
    code: 'mc-middle',
    title: '机加工中班',
    startTime: '14:00',
    endTime: '22:00',
    isNight: false,
    departmentIds: ['sz-mc', 'cd-mc'],
  },
  {
    id: 'shift-mc-night',
    code: 'mc-night',
    title: '机加工夜班',
    startTime: '22:00',
    endTime: '06:00',
    isNight: true,
    departmentIds: ['sz-mc', 'cd-mc'],
  },
  {
    id: 'shift-as-day',
    code: 'as-day',
    title: '装配白班',
    startTime: '08:00',
    endTime: '20:00',
    isNight: false,
    departmentIds: ['sz-as'],
  },
  {
    id: 'shift-as-night',
    code: 'as-night',
    title: '装配夜班',
    startTime: '20:00',
    endTime: '08:00',
    isNight: true,
    departmentIds: ['sz-as'],
  },
  {
    id: 'shift-office-day',
    code: 'office-day',
    title: '常日班',
    startTime: '08:30',
    endTime: '17:30',
    isNight: false,
    departmentIds: null,
  },
] as const;

const RULES = [
  {
    id: 'rule-mc',
    title: '机加工车间三班倒',
    departmentIds: ['sz-mc', 'cd-mc'],
    workHourSystem: 'comprehensive',
    punchSource: 'device',
  },
  {
    id: 'rule-as',
    title: '装配车间两班倒',
    departmentIds: ['sz-as'],
    workHourSystem: 'comprehensive',
    punchSource: 'device',
  },
  {
    id: 'rule-office',
    title: '职能部门标准工时',
    departmentIds: ['qiheng'],
    workHourSystem: 'standard',
    punchSource: 'feishu',
  },
] as const;

const LEAVE_TYPES = [
  {
    id: 'leave-annual',
    code: 'annual',
    title: '年假',
    payType: 'paid',
    unit: 'day',
    balanceRule: 'annualBySeniority',
    fixedDays: null,
    requiresAttachment: false,
    countBy: 'schedule',
  },
  {
    id: 'leave-sick',
    code: 'sick',
    title: '病假',
    payType: 'partial',
    unit: 'day',
    balanceRule: 'none',
    fixedDays: null,
    requiresAttachment: true,
    countBy: 'schedule',
  },
  {
    id: 'leave-personal',
    code: 'personal',
    title: '事假',
    payType: 'unpaid',
    unit: 'halfDay',
    balanceRule: 'none',
    fixedDays: null,
    requiresAttachment: false,
    countBy: 'schedule',
  },
  {
    id: 'leave-marriage',
    code: 'marriage',
    title: '婚假',
    payType: 'paid',
    unit: 'day',
    balanceRule: 'fixedPerEvent',
    fixedDays: 3,
    requiresAttachment: true,
    countBy: 'calendar',
  },
  {
    id: 'leave-maternity',
    code: 'maternity',
    title: '产假',
    payType: 'paid',
    unit: 'day',
    balanceRule: 'fixedPerEvent',
    fixedDays: 98,
    requiresAttachment: true,
    countBy: 'calendar',
  },
  {
    id: 'leave-paternity',
    code: 'paternity',
    title: '陪产假',
    payType: 'paid',
    unit: 'day',
    balanceRule: 'fixedPerEvent',
    fixedDays: 15,
    requiresAttachment: true,
    countBy: 'calendar',
  },
  {
    id: 'leave-bereavement',
    code: 'bereavement',
    title: '丧假',
    payType: 'paid',
    unit: 'day',
    balanceRule: 'fixedPerEvent',
    fixedDays: 3,
    requiresAttachment: false,
    countBy: 'calendar',
  },
  {
    id: 'leave-compensatory',
    code: 'compensatory',
    title: '调休',
    payType: 'paid',
    unit: 'hour',
    balanceRule: 'earned',
    fixedDays: null,
    requiresAttachment: false,
    countBy: 'schedule',
  },
] as const;

/** The weekly three-shift pattern: five days on one shift, two off, next shift the next week. */
function mcShift(index: number, offset: number): string | null {
  const week = Math.floor(offset / 7);
  const position = ((offset % 7) + 7) % 7;
  if (position >= 5) return null;
  const order = ['shift-mc-early', 'shift-mc-middle', 'shift-mc-night'];
  return order[(((week + index) % 3) + 3) % 3];
}
function asShift(index: number, offset: number): string | null {
  const week = Math.floor(offset / 7);
  const position = ((offset % 7) + 7) % 7;
  if (position >= 4) return null;
  return (((week + index) % 2) + 2) % 2 === 0
    ? 'shift-as-day'
    : 'shift-as-night';
}

const seed: SeedDefinition = defineSeed({
  name: '202609290121_demo_attendance',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_ATTENDANCE_DEMO === 'false'
    )
      return;
    const hasDemo = await query
      .selectFrom('employees')
      .select(['id'])
      .where('id', '=', 'emp-qianjin')
      .executeTakeFirst();
    const anyShift = await query
      .selectFrom('shifts')
      .select(['id'])
      .executeTakeFirst();
    if (!hasDemo || anyShift) return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = localToday();
    const year = today.slice(0, 4);

    for (const shift of SHIFTS)
      await query
        .insertInto('shifts')
        .values({
          ...shift,
          startTime: `${shift.startTime}:00.000`,
          endTime: `${shift.endTime}:00.000`,
          breakMinutes: 30,
          departmentIds: shift.departmentIds ? shift.departmentIds : null,
          active: true,
          ...stamp,
        })
        .execute();
    for (const rule of RULES)
      await query
        .insertInto('attendanceRules')
        .values({
          ...rule,
          departmentIds: rule.departmentIds,
          lateGraceMinutes: 5,
          overtimeRequiresApproval: true,
          monthlyOvertimeAlertHours: 36,
          minRestHours: 11,
          maxConsecutiveNights: 5,
          active: true,
          ...stamp,
        })
        .execute();
    for (const type of LEAVE_TYPES)
      await query
        .insertInto('leaveTypes')
        .values({ ...type, active: true, ...stamp })
        .execute();

    const setting = async (id: string, value: unknown) => {
      const exists = await query
        .selectFrom('personnelSettings')
        .select(['id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (exists) return;
      await query
        .insertInto('personnelSettings')
        .values({
          id,
          value: value,
          revision: 1,
          updatedBy: 'system',
          ...stamp,
        })
        .execute();
    };
    await setting('attendance.rotations', {
      templates: [
        {
          key: 'three-shift-weekly',
          title: '三班倒 · 每周轮换',
          shiftCodes: ['mc-early', 'mc-middle', 'mc-night'],
          periodDays: 7,
          workDays: 5,
        },
        {
          key: 'two-shift-weekly',
          title: '两班倒 · 每周轮换',
          shiftCodes: ['as-day', 'as-night'],
          periodDays: 7,
          workDays: 4,
        },
      ],
    });
    // 示例: this year's National Day week and its make-up workdays; HR maintains the real calendar.
    await setting('attendance.calendar', {
      years: [
        {
          year: Number(year),
          holidays: [1, 2, 3, 4, 5, 6, 7].map((d) => `${year}-10-0${d}`),
          adjustedWorkdays: [`${year}-09-27`, `${year}-10-10`],
        },
      ],
    });

    // 工作年限 and 陈晨.
    for (const [id, years] of [
      ['emp-qianjin', 12],
      ['emp-limin', 5],
      ['emp-wanglei', 8],
    ] as const)
      await query
        .updateTable('employees')
        .set({ careerStartDate: addYears(today, years), updatedAt: now })
        .where('id', '=', id)
        .execute();
    const chenchen = await query
      .selectFrom('employees')
      .select(['id'])
      .where('id', '=', 'emp-chenchen')
      .executeTakeFirst();
    if (!chenchen && `${year}-07-01` <= today)
      await query
        .insertInto('employees')
        .values({
          id: 'emp-chenchen',
          employeeNo: 'QH2201',
          name: '陈晨',
          userId: null,
          departmentId: 'sz-mc',
          positionId: 'pos-cnc-operator',
          managerEmployeeId: 'emp-mgr-njl',
          status: 'probation',
          hireDate: `${year}-07-01`,
          positionSince: `${year}-07-01`,
          careerStartDate: addYears(today, 3),
          email: null,
          mobile: '13900000031',
          note: null,
          gender: 'male',
          birthDate: '2000-05-05',
          idType: 'idCard',
          idNumber: '999999200005050031',
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: `${year}-12-31`,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '苏州市吴中区迎春南路 92 号 6 幢 201 室',
          ...stamp,
        })
        .execute();

    const employees = await query
      .selectFrom('employees')
      .select(['id', 'departmentId', 'hireDate'])
      .where('status', '!=', 'leave')
      .execute();
    const inDept = (dept: string) =>
      employees
        .filter((e) => String(e.departmentId) === dept)
        .map((e) => String(e.id))
        .sort();
    const mc = inDept('sz-mc').filter((id) => id !== 'emp-mgr-njl');
    const cd = inDept('cd-mc');
    const as = inDept('sz-as');
    const office = inDept('hr');

    const cells = new Map<string, string | null>();
    const put = (employeeId: string, date: string, shiftId: string | null) =>
      cells.set(`${employeeId}|${date}`, shiftId);
    // The next 14 days, and three days back for 机加工车间 (the device export).
    for (let offset = -3; offset <= 14; offset++) {
      if (offset === 0) continue;
      const date = addDays(today, offset);
      mc.forEach((id, i) => put(id, date, mcShift(i, offset)));
      if (offset > 0) {
        cd.forEach((id, i) => put(id, date, mcShift(i + 1, offset)));
        as.forEach((id, i) => put(id, date, asShift(i, offset)));
      }
    }
    for (let offset = -3; offset <= 14; offset++) {
      const date = addDays(today, offset);
      if (!isWeekend(date))
        office.forEach((id) => put(id, date, 'shift-office-day'));
    }
    // The documented cases.
    put('emp-wanglei', addDays(today, 3), null);
    put('emp-wanglei', addDays(today, 4), null);
    put('emp-wanglei', addDays(today, 5), 'shift-mc-middle');
    put('emp-qianjin', addDays(today, 5), 'shift-mc-early');
    put('emp-limin', addDays(today, 4), 'shift-mc-early');
    put('emp-limin', addDays(today, 5), null);
    put('emp-limin', addDays(today, 6), 'shift-mc-middle');
    if (mc.includes('emp-chenchen'))
      put('emp-chenchen', addDays(today, 5), 'shift-mc-night');
    // The device export: early shifts on the three days before today.
    for (const id of ['emp-limin', 'emp-qianjin'])
      for (let offset = -3; offset <= -1; offset++)
        put(id, addDays(today, offset), 'shift-mc-early');
    // A night shift two days back: its morning punch belongs to its start date, and the day is due by now.
    put('emp-wanglei', addDays(today, -2), 'shift-mc-night');
    put('emp-wanglei', addDays(today, -1), null);

    // Last month, for the monthly summary.
    const [y, m] = today.split('-').map(Number);
    const lastMonth =
      m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const lastDays = new Date(
      Date.UTC(Number(lastMonth.slice(0, 4)), Number(lastMonth.slice(5, 7)), 0),
    ).getUTCDate();
    const lastCells: {
      employeeId: string;
      date: string;
      shiftId: string | null;
    }[] = [];
    for (let d = 1; d <= lastDays; d++) {
      const date = `${lastMonth}-${String(d).padStart(2, '0')}`;
      [...mc, ...cd].forEach((id, i) =>
        lastCells.push({ employeeId: id, date, shiftId: mcShift(i, d) }),
      );
      as.forEach((id, i) =>
        lastCells.push({ employeeId: id, date, shiftId: asShift(i, d) }),
      );
    }
    const hire = new Map(
      employees.map((e) => [
        String(e.id),
        e.hireDate
          ? e.hireDate instanceof Date
            ? e.hireDate.toISOString()
            : String(e.hireDate as string).slice(0, 10)
          : null,
      ]),
    );
    const allCells = [
      ...[...cells].map(([key, shiftId]) => {
        const [employeeId, date] = key.split('|');
        return { employeeId, date, shiftId };
      }),
      ...lastCells,
    ].filter(
      (c) => !hire.get(c.employeeId) || c.date >= hire.get(c.employeeId)!,
    );
    for (const cell of allCells)
      await query
        .insertInto('shiftSchedules')
        .values({
          id: `sched-${cell.employeeId}-${cell.date}`,
          employeeId: cell.employeeId,
          date: cell.date,
          shiftId: cell.shiftId,
          publishedShiftId: cell.shiftId,
          status: 'published',
          checkResult: null,
          replacementSuggestion: null,
          publishedBy: 'system',
          publishedAt: now,
          ...stamp,
        })
        .execute();

    // Last month's records, as the daily calculation would have written them.
    const shiftOf = new Map<string, (typeof SHIFTS)[number]>(
      SHIFTS.map((s) => [s.id, s]),
    );
    let n = 0;
    for (const cell of lastCells) {
      if (!cell.shiftId) continue;
      if (hire.get(cell.employeeId) && cell.date < hire.get(cell.employeeId)!)
        continue;
      const shift = shiftOf.get(cell.shiftId)!;
      n += 1;
      // Every 17th shift is 12 minutes late: something for the report to show.
      const late = n % 17 === 0;
      const start = at(cell.date, shift.startTime);
      const end = at(
        shift.endTime < shift.startTime ? addDays(cell.date, 1) : cell.date,
        shift.endTime,
      );
      const checkIn = new Date(start.getTime() + (late ? 12 : -8) * 60_000);
      const checkOut = new Date(end.getTime() + 5 * 60_000);
      await query
        .insertInto('attendanceRecords')
        .values({
          id: `rec-${cell.employeeId}-${cell.date}`,
          employeeId: cell.employeeId,
          date: cell.date,
          shiftId: cell.shiftId,
          punches: [
            { at: checkIn.toISOString(), source: 'device' },
            { at: checkOut.toISOString(), source: 'device' },
          ],
          checkIn,
          checkOut,
          status: late ? 'late' : 'normal',
          lateMinutes: late ? 12 : null,
          earlyMinutes: null,
          workedMinutes:
            Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000) - 30,
          overtimeMinutes: null,
          leaveRequestId: null,
          computedAt: now,
          ...stamp,
        })
        .execute();
    }

    // 王磊: approved annual leave on days 3–4, and 30 hours of approved overtime this month.
    const mgr = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-mgr-njl')
      .executeTakeFirst();
    const wang = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-wanglei')
      .executeTakeFirst();
    const approver = mgr?.userId ? idOf(mgr.userId) : null;
    const leaveDates = [addDays(today, 3), addDays(today, 4)];
    await query
      .insertInto('leaveRequests')
      .values({
        id: 'leave-demo-wanglei',
        employeeId: 'emp-wanglei',
        leaveTypeId: 'leave-annual',
        startAt: at(leaveDates[0], '00:00'),
        endAt: at(addDays(today, 5), '00:00'),
        duration: 2,
        reason: '家中有事',
        attachmentFileId: null,
        status: 'approved',
        approvals: [
          {
            level: 1,
            kind: 'departmentHead',
            approverUserId: approver,
            departmentId: 'sz-mc',
            status: 'approved',
            decidedBy: approver,
            decidedAt: now.toISOString(),
            comment: null,
            submittedBy: wang?.userId ? idOf(wang.userId) : 'system',
            leaveDates,
            balanceDays: 2,
          },
        ],
        source: 'self',
        ...stamp,
      })
      .execute();
    for (const date of leaveDates)
      await query
        .insertInto('attendanceRecords')
        .values({
          id: `rec-emp-wanglei-${date}`,
          employeeId: 'emp-wanglei',
          date,
          shiftId: null,
          punches: null,
          checkIn: null,
          checkOut: null,
          status: 'leave',
          lateMinutes: null,
          earlyMinutes: null,
          workedMinutes: null,
          overtimeMinutes: null,
          leaveRequestId: 'leave-demo-wanglei',
          computedAt: now,
          ...stamp,
        })
        .execute();
    await query
      .insertInto('leaveBalances')
      .values({
        id: 'balance-demo-wanglei-annual',
        employeeId: 'emp-wanglei',
        leaveTypeId: 'leave-annual',
        year: Number(year),
        entitled: 5,
        carriedOver: 0,
        used: 2,
        pending: 0,
        expiresAt: null,
        adjustments: [],
        ...stamp,
      })
      .execute();
    const month = today.slice(0, 7);
    for (let i = 0; i < 6; i++) {
      const date = `${month}-${String(i + 1).padStart(2, '0')}`;
      await query
        .insertInto('attendanceAdjustments')
        .values({
          id: `ot-demo-wanglei-${i + 1}`,
          type: 'overtime',
          employeeId: 'emp-wanglei',
          date,
          details: {
            startAt: at(date, '14:00').toISOString(),
            endAt: at(date, '19:00').toISOString(),
            hours: 5,
            overtimeType: 'workday',
          },
          reason: '订单赶工',
          status: 'approved',
          approvals: [
            {
              level: 1,
              kind: 'departmentHead',
              approverUserId: approver,
              departmentId: 'sz-mc',
              status: 'approved',
              decidedBy: approver,
              decidedAt: now.toISOString(),
              comment: null,
              submittedBy: wang?.userId ? idOf(wang.userId) : 'system',
            },
          ],
          ...stamp,
        })
        .execute();
    }

    // The HR assistant's attendance work is owned by hr01.
    const hr = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-hr01')
      .executeTakeFirst();
    if (hr?.userId)
      for (const id of [
        'hrAssistant.replacementSuggest',
        'hrAssistant.attendanceAnomaly',
        'hrAssistant.monthEndCheck',
      ]) {
        const owned = await query
          .selectFrom('aiAutomationSettings')
          .select(['id'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (owned) continue;
        await query
          .insertInto('aiAutomationSettings')
          .values({
            id,
            enabled: true,
            ownerUserId: hr.userId,
            hour: null,
            weekday: null,
            monthDay: null,
            params: null,
            updatedByUserId: null,
            ...stamp,
          })
          .execute();
      }
  },
});
export default seed;

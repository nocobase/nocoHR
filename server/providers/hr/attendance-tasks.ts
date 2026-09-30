/**
 * V2-05 定时任务, in one place so the scheduler and the "run now" endpoint do
 * the same thing:
 *
 * - pull (每 30 分钟): office-suite punches for rules whose punchSource is an
 *   office suite. No office-suite attendance plugin is installed: outside
 *   production the source is a mock file (storage/attendance/feishu-punches.json),
 *   read and emptied; in production nothing is pulled and nothing is faked.
 * - compute (每天 04:00): the previous day's records.
 * - daily (每天 09:00, inside the HR daily run): published cells of the next 14
 *   days are checked again; an unresolved leave conflict tells the scheduler
 *   (once per conflict) and asks the HR assistant for cover, which suggests
 *   only when the candidates changed. The anomaly reminder runs after it.
 * - monthly (每月 1 日 04:00): last month's summaries, then the month-end check.
 * - yearly (每年 1 月 1 日): the year's balances and carryover expiry.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ServiceContainer } from '@nocobase/service-provider';

import { previousMonth } from './attendance-service.js';
import type { ComputePunch } from './attendance-compute.js';
import { addDays, str, toDateOnly } from './shared.js';
import {
  attendanceEngineToken,
  attendanceServiceToken,
  automationTasksToken,
  leaveServiceToken,
  // V4-14
  licensedServicesToken,
  organizationServiceToken,
  platformToken,
  scheduleServiceToken,
} from './tokens.js';

export type AttendanceTask =
  'pull' | 'compute' | 'daily' | 'monthly' | 'yearly';

export function mockPunchFile(): string {
  return (
    process.env.ATTENDANCE_PUNCH_MOCK_FILE ||
    path.resolve(process.cwd(), 'storage', 'attendance', 'feishu-punches.json')
  );
}

/**
 * The mock Feishu punches for every published office-day cell from `from` to
 * `to`: the demo seed schedules office days before the seed date too, and a
 * day without punches would read 旷工.
 */
async function demoFeishuPunches(
  container: ServiceContainer,
  from: string,
  to: string,
): Promise<{ employeeNo: string; at: string }[]> {
  const platform = container.resolve(platformToken);
  const rows = await platform.database
    .query()
    .selectFrom('shiftSchedules')
    .innerJoin('employees', 'employees.id', 'shiftSchedules.employeeId')
    .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
    .select([
      'employees.employeeNo as employeeNo',
      'shiftSchedules.date as date',
    ])
    .where('shiftSchedules.date', '>=', from)
    .where('shiftSchedules.date', '<=', to)
    .where('shiftSchedules.status', '=', 'published')
    .where('shifts.code', '=', 'office-day')
    .execute();
  return rows.flatMap((row) => {
    const date = toDateOnly(row.date as Date | string | null);
    if (!date) return [];
    return [
      { employeeNo: str(row.employeeNo), at: `${date}T08:24:00+08:00` },
      { employeeNo: str(row.employeeNo), at: `${date}T17:36:00+08:00` },
    ];
  });
}

export async function runAttendanceTask(
  container: ServiceContainer,
  task: AttendanceTask,
  options: { asOf?: string; trigger?: 'schedule' | 'manual' } = {},
): Promise<Record<string, unknown>> {
  const platform = container.resolve(platformToken);
  const database = platform.database;
  const today = options.asOf ?? platform.currentDate();
  if (task === 'pull') {
    if (process.env.NODE_ENV === 'production')
      return { pulled: 0, source: 'none' };
    let entries: { employeeNo: string; at: string }[] = [];
    try {
      entries = JSON.parse(
        await fs.readFile(mockPunchFile(), 'utf8'),
      ) as typeof entries;
    } catch {
      // 一组飞书打卡（职能部门）: the first pull, with no mock file yet, writes
      // the office-day punches of the last 7 days up to yesterday.
      entries = await demoFeishuPunches(
        container,
        addDays(today, -7),
        addDays(today, -1),
      );
    }
    if (!Array.isArray(entries) || !entries.length)
      return { pulled: 0, source: 'mock' };
    const employees = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'employeeNo'])
      .execute();
    const byNo = new Map(employees.map((e) => [str(e.employeeNo), str(e.id)]));
    const punches = new Map<string, ComputePunch[]>();
    let from = today;
    for (const entry of entries) {
      const id = byNo.get(entry.employeeNo);
      if (!id || !Number.isFinite(Date.parse(entry.at))) continue;
      const list = punches.get(id) ?? [];
      list.push({ at: new Date(entry.at).toISOString(), source: 'feishu' });
      punches.set(id, list);
      const local = new Intl.DateTimeFormat('en-CA', {
        timeZone: platform.timeZone,
      }).format(new Date(entry.at));
      if (local < from) from = local;
    }
    const engine = container.resolve(attendanceEngineToken);
    await database.transaction((connection) =>
      engine.recompute(connection, {
        employeeIds: [...punches.keys()],
        from: addDays(from, -1),
        to: today,
        addPunches: punches,
      }),
    );
    // Pulled once: the file is emptied like an acknowledged queue.
    await fs.mkdir(path.dirname(mockPunchFile()), { recursive: true });
    await fs.writeFile(mockPunchFile(), '[]\n');
    return { pulled: entries.length, source: 'mock' };
  }
  if (task === 'compute') {
    const yesterday = addDays(today, -1);
    const employees = await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .execute();
    const engine = container.resolve(attendanceEngineToken);
    const result = await database.transaction((connection) =>
      engine.recompute(connection, {
        employeeIds: employees.map((e) => str(e.id)),
        from: yesterday,
        to: yesterday,
      }),
    );
    return { date: yesterday, ...result };
  }
  if (task === 'daily') {
    const schedules = container.resolve(scheduleServiceToken);
    const conflicted = await schedules.revalidate({
      from: today,
      to: addDays(today, 13),
    });
    const organization = container.resolve(organizationServiceToken);
    let notified = 0;
    let suggested = 0;
    for (const cell of conflicted.filter((c) =>
      c.blocked.includes('leaveConflict'),
    )) {
      const row = await database
        .query()
        .selectFrom('shiftSchedules')
        .innerJoin('employees', 'employees.id', 'shiftSchedules.employeeId')
        .select([
          'employees.name as name',
          'employees.departmentId as departmentId',
          'shiftSchedules.checkResult as checkResult',
        ])
        .where('shiftSchedules.id', '=', cell.id)
        .executeTakeFirst();
      if (!row) continue;
      let checks: unknown = row.checkResult;
      if (typeof checks === 'string') checks = JSON.parse(checks);
      const leaves = (Array.isArray(checks) ? checks : [])
        .filter((c: { rule?: string }) => c.rule === 'leaveConflict')
        .map((c: { leaveRequestId?: string }) => c.leaveRequestId ?? '')
        .sort()
        .join(',');
      const head = await organization.resolveHead(str(row.departmentId));
      if (head) {
        // The notification key makes the same conflict a no-op on the next day.
        await platform.notify({
          key: `leaveConflict:${cell.id}:${leaves}`,
          userIds: [head.userId],
          message: 'scheduleLeaveConflict',
          params: { name: str(row.name), date: cell.date },
          path: `/talent/schedules?department=${str(row.departmentId)}&from=${cell.date}`,
        });
        notified += 1;
      }
      const outcome = await container
        .resolve(automationTasksToken)
        .onLeaveConflict(cell.id);
      if (outcome.status === 'succeeded') suggested += 1;
    }
    // V4-14 排班资质校验: new certificationMissing blocks tell the scheduler and ask for certified cover, once each.
    const qualification = await container
      .resolve(licensedServicesToken)
      .afterDailyRevalidate(today, addDays(today, 13));
    return {
      revalidated: conflicted.length,
      notified: notified + qualification.notified,
      suggested: suggested + qualification.suggested,
      qualificationConflicts: qualification.qualificationConflicts,
    };
  }
  if (task === 'monthly') {
    const month = previousMonth(today);
    const { created } = await container
      .resolve(attendanceServiceToken)
      .generateSummaries(month);
    const check = await container
      .resolve(automationTasksToken)
      .onAttendanceMonthGenerated(month, options.trigger ?? 'schedule');
    return { month, created, monthEndCheck: check.status };
  }
  const year = Number(today.slice(0, 4));
  const leave = container.resolve(leaveServiceToken);
  const initialized = await leave.initializeTrusted({ year, asOf: today });
  const expired = await leave.expireCarryover(today);
  return { year, ...initialized, ...expired };
}

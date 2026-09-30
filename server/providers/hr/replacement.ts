/**
 * V2-05 顶班候选 (`listReplacementCandidates`): for a schedule cell with a
 * leave conflict, the employees of the same department who could take the
 * shift — the shift applies to their department, the day is free (no row or
 * rest), no approved or pending leave overlaps it, the rest before and after
 * meets minRestHours, and it would not exceed the consecutive-night limit.
 * Each comes with the month's approved overtime and night count, fewest
 * overtime hours first. Rules decide; the HR assistant only words reasons.
 */
import type { DatabaseConnection } from '@nocobase/db';

import {
  attendanceDepartmentChain,
  attendanceRuleSchema,
  resolveAttendanceRule,
  type AttendanceDepartment,
} from './attendance-catalog.js';
import { shiftInterval } from './attendance-compute.js';
import { json, monthDays } from './attendance-service.js';
import { addDays, HrError, str } from './shared.js';
// V4-14 排班资质校验: candidates must hold the certifications the shift requires.
import {
  coversShift,
  loadHoldings,
  loadShiftRequirements,
} from './licensed/qualification.js';

export interface ReplacementCandidate {
  employeeId: string;
  name: string;
  employeeNo: string;
  restBeforeHours: number | null;
  restAfterHours: number | null;
  monthOvertimeHours: number;
  monthNightShifts: number;
  reasons: string[];
  /** V4-14: when the shift requires certifications, the earliest expiry among the candidate's (null: never). */
  certificateExpiresAt?: string | null;
}

const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);

export async function replacementCandidates(input: {
  connection: DatabaseConnection;
  scheduleId: string;
  departments: readonly AttendanceDepartment[];
  timeZone: string;
}): Promise<{
  schedule: {
    id: string;
    employeeId: string;
    date: string;
    shiftId: string;
    departmentId: string;
  };
  candidates: ReplacementCandidate[];
}> {
  const q = input.connection.query;
  const cell = await q
    .selectFrom('shiftSchedules')
    .innerJoin('employees', 'employees.id', 'shiftSchedules.employeeId')
    .select([
      'shiftSchedules.id as id',
      'shiftSchedules.employeeId as employeeId',
      'shiftSchedules.date as date',
      'shiftSchedules.shiftId as shiftId',
      'shiftSchedules.checkResult as checkResult',
      'employees.departmentId as departmentId',
    ])
    .where('shiftSchedules.id', '=', input.scheduleId)
    .executeTakeFirst();
  if (!cell) throw new HrError('NOT_FOUND', 404);
  const checks = json<{ rule?: string }[]>(cell.checkResult, []);
  // V4-14: a cell blocked for a missing certification takes cover suggestions too.
  if (
    !cell.shiftId ||
    !checks.some(
      (c) => c.rule === 'leaveConflict' || c.rule === 'certificationMissing',
    )
  )
    throw new HrError('NO_LEAVE_CONFLICT', 409);
  const date = day(cell.date);
  const departmentId = str(cell.departmentId);
  const shift = await q
    .selectFrom('shifts')
    .selectAll()
    .where('id', '=', str(cell.shiftId))
    .executeTakeFirstOrThrow();
  const departmentIds = json<string[] | null>(shift.departmentIds, null);
  const ruleRows = await q
    .selectFrom('attendanceRules')
    .selectAll()
    .where('active', '=', true)
    .execute();
  const rule = resolveAttendanceRule(
    departmentId,
    input.departments,
    ruleRows.map((row) => ({
      id: str(row.id),
      ...attendanceRuleSchema.strip().parse({
        ...row,
        departmentIds: json<string[]>(row.departmentIds, []),
        active: Boolean(row.active),
        overtimeRequiresApproval: Boolean(row.overtimeRequiresApproval),
        exceptionExcusable:
          row.exceptionExcusable == null
            ? undefined
            : Boolean(row.exceptionExcusable),
      }),
    })),
  );
  const chain = attendanceDepartmentChain(departmentId, input.departments);
  if (departmentIds?.length && !departmentIds.some((id) => chain.includes(id)))
    return {
      schedule: {
        id: str(cell.id),
        employeeId: str(cell.employeeId),
        date,
        shiftId: str(cell.shiftId),
        departmentId,
      },
      candidates: [],
    };
  const peers = await q
    .selectFrom('employees')
    .select(['id', 'name', 'employeeNo', 'status', 'hireDate', 'leaveDate'])
    .where('departmentId', '=', departmentId)
    .where('id', '!=', str(cell.employeeId))
    .where('status', '!=', 'leave')
    .execute();
  const window = shiftInterval(
    date,
    {
      startTime: str(shift.startTime).slice(0, 5),
      endTime: str(shift.endTime).slice(0, 5),
    },
    input.timeZone,
  );
  if (!peers.length)
    return {
      schedule: {
        id: str(cell.id),
        employeeId: str(cell.employeeId),
        date,
        shiftId: str(cell.shiftId),
        departmentId,
      },
      candidates: [],
    };
  const ids = peers.map((p) => str(p.id));
  // V4-14: with the industry pack's schedule check on, only holders of every required certification through the shift.
  const required =
    (await loadShiftRequirements(q, [str(cell.shiftId)]))?.get(
      str(cell.shiftId),
    ) ?? [];
  const holdings = required.length
    ? await loadHoldings(
        q,
        ids,
        required.map((c) => c.id),
      )
    : [];
  const span = rule.maxConsecutiveNights + 1;
  const { from, to } = monthDays(date.slice(0, 7));
  const [schedules, leaves, overtime, monthSchedules] = await Promise.all([
    q
      .selectFrom('shiftSchedules')
      .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
      .select([
        'shiftSchedules.employeeId as employeeId',
        'shiftSchedules.date as date',
        'shifts.startTime as startTime',
        'shifts.endTime as endTime',
        'shifts.isNight as isNight',
      ])
      .where('shiftSchedules.employeeId', 'in', ids)
      .where('shiftSchedules.date', '>=', addDays(date, -span))
      .where('shiftSchedules.date', '<=', addDays(date, span))
      .execute(),
    q
      .selectFrom('leaveRequests')
      .select(['employeeId', 'startAt', 'endAt'])
      .where('employeeId', 'in', ids)
      .where('status', 'in', ['pending', 'approved'])
      .execute(),
    q
      .selectFrom('attendanceAdjustments')
      .select(['employeeId', 'details'])
      .where('employeeId', 'in', ids)
      .where('type', '=', 'overtime')
      .where('status', '=', 'approved')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .execute(),
    q
      .selectFrom('shiftSchedules')
      .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
      .select(['shiftSchedules.employeeId as employeeId'])
      .where('shiftSchedules.employeeId', 'in', ids)
      .where('shifts.isNight', '=', true)
      .where('shiftSchedules.date', '>=', from)
      .where('shiftSchedules.date', '<=', to)
      .execute(),
  ]);
  const candidates: ReplacementCandidate[] = [];
  for (const peer of peers) {
    const id = str(peer.id);
    if (peer.hireDate && day(peer.hireDate) > date) continue;
    if (peer.leaveDate && day(peer.leaveDate) < date) continue;
    const covering = required.map((certification) =>
      holdings
        .filter(
          (h) =>
            h.employeeId === id &&
            h.certificationId === certification.id &&
            coversShift(h, window.end, input.timeZone),
        )
        .map((h) => h.expiresAt)
        .sort((a, b) => (a === null ? 1 : b === null ? -1 : b.localeCompare(a)))[0],
    );
    if (covering.some((expiry) => expiry === undefined)) continue;
    const own = schedules
      .filter((s) => str(s.employeeId) === id)
      .map((s) => ({
        date: day(s.date),
        isNight: Boolean(s.isNight),
        ...shiftInterval(
          day(s.date),
          {
            startTime: str(s.startTime).slice(0, 5),
            endTime: str(s.endTime).slice(0, 5),
          },
          input.timeZone,
        ),
      }))
      .sort((a, b) => a.start - b.start);
    // 当天未排班或为休息.
    if (own.some((s) => s.date === date)) continue;
    if (
      leaves.some(
        (l) =>
          str(l.employeeId) === id &&
          new Date(str(l.startAt)).getTime() < window.end &&
          new Date(str(l.endAt)).getTime() > window.start,
      )
    )
      continue;
    const before = own.filter((s) => s.end <= window.start).at(-1);
    const after = own.find((s) => s.start >= window.end);
    const restBefore = before ? (window.start - before.end) / 3_600_000 : null;
    const restAfter = after ? (after.start - window.end) / 3_600_000 : null;
    if (
      (restBefore !== null && restBefore < rule.minRestHours) ||
      (restAfter !== null && restAfter < rule.minRestHours)
    )
      continue;
    if (shift.isNight) {
      let run = 1;
      for (const direction of [-1, 1])
        for (let offset = 1; offset <= span; offset++) {
          const neighbor = own.find(
            (s) => s.date === addDays(date, direction * offset),
          );
          if (!neighbor?.isNight) break;
          run++;
        }
      if (run > rule.maxConsecutiveNights) continue;
    }
    const hours = overtime
      .filter((o) => str(o.employeeId) === id)
      .reduce(
        (total, o) =>
          total + Number(json<{ hours?: number }>(o.details, {}).hours ?? 0),
        0,
      );
    const nights = monthSchedules.filter(
      (s) => str(s.employeeId) === id,
    ).length;
    candidates.push({
      employeeId: id,
      name: str(peer.name),
      employeeNo: str(peer.employeeNo),
      restBeforeHours:
        restBefore === null ? null : Math.round(restBefore * 10) / 10,
      restAfterHours:
        restAfter === null ? null : Math.round(restAfter * 10) / 10,
      monthOvertimeHours: Math.round(hours * 100) / 100,
      monthNightShifts: nights,
      ...(required.length
        ? {
            certificateExpiresAt:
              covering
                .filter((d): d is string => d !== null)
                .sort()[0] ?? null,
          }
        : {}),
      reasons: [
        ...(required.length
          ? [
              `持有${required.map((c) => c.title).join('、')}，有效期至 ${
                covering
                  .filter((d): d is string => d !== null)
                  .sort()[0] ?? '长期'
              }`,
            ]
          : []),
        '当天空闲',
        `前后休息 ${restBefore === null ? '—' : Math.round(restBefore * 10) / 10} / ${restAfter === null ? '—' : Math.round(restAfter * 10) / 10} 小时（不少于 ${rule.minRestHours} 小时）`,
        `本月加班 ${Math.round(hours * 100) / 100} 小时、夜班 ${nights} 次`,
      ],
    });
  }
  candidates.sort(
    (a, b) =>
      a.monthOvertimeHours - b.monthOvertimeHours ||
      a.monthNightShifts - b.monthNightShifts ||
      a.employeeNo.localeCompare(b.employeeNo),
  );
  return {
    schedule: {
      id: str(cell.id),
      employeeId: str(cell.employeeId),
      date,
      shiftId: str(cell.shiftId),
      departmentId,
    },
    candidates,
  };
}

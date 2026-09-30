import { addDays, HrError } from './shared.js';
import { zonedInstant } from './leave-duration.js';
import {
  attendanceDepartmentChain,
  resolveAttendanceRule,
  type AttendanceDepartment,
  type AttendanceRule,
} from './attendance-catalog.js';
// V4-14 排班资质校验 (certificationMissing), fed by the preflight.
import {
  qualificationChecks,
  type QualificationInput,
} from './licensed/qualification.js';

export interface ScheduleCell {
  employeeId: string;
  date: string;
  shiftId: string | null;
}
export interface ScheduleEmployee {
  id: string;
  departmentId: string;
  status: string;
  hireDate: string | null;
  leaveDate: string | null;
}
export interface ScheduleShift {
  id: string;
  startTime: string;
  endTime: string;
  isNight: boolean;
  active: boolean;
  departmentIds: string[] | null;
  breakMinutes?: number;
}

/** 预计当月加班 inputs (attendance.overtime and the calendar). */
export interface OvertimeForecastInput {
  readonly standardDayHours: number;
  /** Approved overtime hours by `${employeeId}:${YYYY-MM}`. */
  readonly approvedHours: ReadonlyMap<string, number>;
  readonly holidays: readonly string[];
  readonly adjustedWorkdays: readonly string[];
}

function workdaysIn(month: string, input: OvertimeForecastInput): number {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let count = 0;
  for (let d = 1; d <= last; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (
      input.adjustedWorkdays.includes(date) ||
      (!input.holidays.includes(date) && weekday !== 0 && weekday !== 6)
    )
      count++;
  }
  return count;
}
export interface ScheduleCheck {
  rule: string;
  level: 'block' | 'warn';
  message: string;
  leaveRequestId?: string;
  /** V4-14: the certification a certificationMissing check is about, and the message's parameters. */
  certificationId?: string;
  params?: Record<string, string>;
}
export const scheduleCellKey = (cell: ScheduleCell) =>
  `${cell.employeeId}:${cell.date}`;

/**
 * V2-05 §排班校验. Evaluate the merged batch and both saved boundaries,
 * never just the first/previous edited cell. No writes, notifications or AI.
 * 预计当月加班 follows the user-agreed policy (see OvertimeForecastInput):
 * approved overtime plus scheduled hours beyond the standard day (standard
 * hours) or the month's total beyond its workdays (comprehensive); flexible
 * hours have none.
 */
export function validateScheduleCells(input: {
  cells: readonly ScheduleCell[];
  existing: readonly ScheduleCell[];
  employees: readonly ScheduleEmployee[];
  shifts: readonly ScheduleShift[];
  departments: readonly AttendanceDepartment[];
  rules: readonly AttendanceRule[];
  leaves: readonly {
    id?: string;
    employeeId: string;
    startAt: string;
    endAt: string;
    status: string;
  }[];
  lockedMonths: readonly { employeeId: string; month: string }[];
  timeZone: string;
  overtime?: OvertimeForecastInput;
  /** V4-14: the shifts' required certifications and the employees' certificates; unset, nothing is checked. */
  qualification?: QualificationInput;
}) {
  const checks: Record<string, ScheduleCheck[]> = {};
  const add = (cell: ScheduleCell, check: ScheduleCheck) => {
    const key = scheduleCellKey(cell);
    checks[key] ??= [];
    if (
      !checks[key].some(
        (old) =>
          old.rule === check.rule &&
          old.message === check.message &&
          // V4-14: one certificationMissing check per required certification.
          old.certificationId === check.certificationId,
      )
    )
      checks[key].push(check);
  };
  const employees = new Map(input.employees.map((row) => [row.id, row]));
  const shifts = new Map(input.shifts.map((row) => [row.id, row]));
  const merged = new Map(
    input.existing.map((row) => [scheduleCellKey(row), row]),
  );
  const proposed = new Set<string>();
  for (const cell of input.cells) {
    const key = scheduleCellKey(cell);
    if (proposed.has(key)) throw new HrError('DUPLICATE_SCHEDULE_CELL', 400);
    proposed.add(key);
    merged.set(key, cell);
  }
  const intervals = new Map<string, { start: number; end: number }>();
  const interval = (cell: ScheduleCell) => {
    const key = scheduleCellKey(cell);
    if (intervals.has(key)) return intervals.get(key)!;
    const shift = cell.shiftId ? shifts.get(cell.shiftId) : undefined;
    if (!shift) throw new HrError('SHIFT_NOT_FOUND', 409);
    if (shift.endTime === shift.startTime)
      throw new HrError('INVALID_SHIFT_DURATION', 409);
    const start = zonedInstant(cell.date, shift.startTime, input.timeZone);
    const end = zonedInstant(
      shift.endTime < shift.startTime ? addDays(cell.date, 1) : cell.date,
      shift.endTime,
      input.timeZone,
    );
    if (end <= start) throw new HrError('INVALID_SHIFT_DURATION', 409);
    const value = { start, end };
    intervals.set(key, value);
    return value;
  };
  for (const cell of input.cells) {
    const employee = employees.get(cell.employeeId);
    if (!employee) {
      add(cell, {
        rule: 'employeeScope',
        level: 'block',
        message: 'EMPLOYEE_NOT_FOUND',
      });
      continue;
    }
    if (
      input.lockedMonths.some(
        (row) =>
          row.employeeId === cell.employeeId &&
          row.month === cell.date.slice(0, 7),
      )
    )
      add(cell, {
        rule: 'monthLocked',
        level: 'block',
        message: 'MONTH_LOCKED',
      });
    if (
      employee.status === 'leave' ||
      (employee.hireDate && cell.date < employee.hireDate) ||
      (employee.leaveDate && cell.date > employee.leaveDate)
    )
      add(cell, {
        rule: 'employmentDate',
        level: 'block',
        message: 'EMPLOYEE_NOT_ACTIVE',
      });
    if (!cell.shiftId) continue;
    const shift = shifts.get(cell.shiftId);
    if (!shift || !shift.active) {
      add(cell, {
        rule: 'shiftScope',
        level: 'block',
        message: 'SHIFT_NOT_FOUND',
      });
      continue;
    }
    try {
      const chain = attendanceDepartmentChain(
        employee.departmentId,
        input.departments,
      );
      if (
        shift.departmentIds?.length &&
        !shift.departmentIds.some((id) => chain.includes(id))
      )
        add(cell, {
          rule: 'departmentScope',
          level: 'block',
          message: 'SHIFT_NOT_APPLICABLE',
        });
      const rule = resolveAttendanceRule(
        employee.departmentId,
        input.departments,
        input.rules,
      );
      const window = interval(cell);
      // V4-14 排班资质校验: each certification the shift requires, held through the shift's end.
      for (const check of qualificationChecks(
        cell,
        window.end,
        input.qualification,
        input.timeZone,
      ))
        add(cell, check);
      for (const leave of input.leaves)
        if (
          leave.employeeId === cell.employeeId &&
          ['pending', 'approved'].includes(leave.status) &&
          Date.parse(leave.startAt) < window.end &&
          Date.parse(leave.endAt) > window.start
        )
          add(cell, {
            rule: 'leaveConflict',
            level: 'block',
            message: 'LEAVE_CONFLICT',
            ...(leave.id ? { leaveRequestId: leave.id } : {}),
          });
      const timeline = [...merged.values()]
        .filter((row) => row.employeeId === cell.employeeId && row.shiftId)
        .sort((a, b) => a.date.localeCompare(b.date));
      const index = timeline.findIndex((row) => row.date === cell.date);
      for (const neighborIndex of [index - 1, index + 1]) {
        const neighbor = timeline[neighborIndex];
        if (!neighbor) continue;
        const other = interval(neighbor);
        const gap =
          neighborIndex < index
            ? window.start - other.end
            : other.start - window.end;
        if (gap < rule.minRestHours * 3_600_000)
          add(cell, {
            rule: 'minRestHours',
            level: 'warn',
            message: 'INSUFFICIENT_REST',
          });
      }
      if (shift.isNight) {
        let count = 1;
        for (const direction of [-1, 1]) {
          for (
            let offset = 1;
            offset <= rule.maxConsecutiveNights + 1;
            offset++
          ) {
            const neighbor = merged.get(
              `${cell.employeeId}:${addDays(cell.date, direction * offset)}`,
            );
            if (!neighbor?.shiftId || !shifts.get(neighbor.shiftId)?.isNight)
              break;
            count++;
          }
        }
        if (count > rule.maxConsecutiveNights)
          add(cell, {
            rule: 'consecutiveNights',
            level: 'warn',
            message: 'CONSECUTIVE_NIGHTS',
          });
      }
      if (input.overtime && rule.workHourSystem !== 'flexible') {
        const month = cell.date.slice(0, 7);
        const std = input.overtime.standardDayHours;
        const hoursOf = (row: ScheduleCell) => {
          const w = interval(row);
          const s = shifts.get(row.shiftId!);
          return (w.end - w.start) / 3_600_000 - (s?.breakMinutes ?? 0) / 60;
        };
        const monthCells = [...merged.values()].filter(
          (row) =>
            row.employeeId === cell.employeeId &&
            row.shiftId &&
            row.date.startsWith(month),
        );
        // 标准工时: each day's hours beyond the standard day; 综合: the month's total beyond its workdays.
        const scheduled =
          rule.workHourSystem === 'standard'
            ? monthCells.reduce(
                (total, row) => total + Math.max(0, hoursOf(row) - std),
                0,
              )
            : Math.max(
                0,
                monthCells.reduce((total, row) => total + hoursOf(row), 0) -
                  workdaysIn(month, input.overtime) * std,
              );
        const projected =
          scheduled +
          (input.overtime.approvedHours.get(`${cell.employeeId}:${month}`) ??
            0);
        if (projected > rule.monthlyOvertimeAlertHours)
          add(cell, {
            rule: 'monthlyOvertime',
            level: 'warn',
            message: 'OVERTIME_FORECAST',
          });
      }
    } catch (error) {
      if (!(error instanceof HrError)) throw error;
      add(cell, { rule: 'configuration', level: 'block', message: error.code });
    }
  }
  const all = Object.values(checks).flat();
  return {
    checks,
    hasBlock: all.some((check) => check.level === 'block'),
    hasWarn: all.some((check) => check.level === 'warn'),
  };
}

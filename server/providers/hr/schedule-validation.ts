import { addDays, HrError } from './shared.js';
import { zonedInstant } from './leave-duration.js';
import {
  attendanceDepartmentChain,
  resolveAttendanceRule,
  type AttendanceDepartment,
  type AttendanceRule,
} from './attendance-catalog.js';

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
}
export interface ScheduleCheck {
  rule: string;
  level: 'block' | 'warn';
  message: string;
}
export const scheduleCellKey = (cell: ScheduleCell) =>
  `${cell.employeeId}:${cell.date}`;

/**
 * V2-05 §排班校验. Evaluate the merged batch and both saved boundaries,
 * never just the first/previous edited cell. No writes, notifications or AI.
 * Monthly overtime forecasting is explicitly NOT inferred from shift hours:
 * the documented work-hour systems need an agreed calculation policy.
 */
export function validateScheduleCells(input: {
  cells: readonly ScheduleCell[];
  existing: readonly ScheduleCell[];
  employees: readonly ScheduleEmployee[];
  shifts: readonly ScheduleShift[];
  departments: readonly AttendanceDepartment[];
  rules: readonly AttendanceRule[];
  leaves: readonly {
    employeeId: string;
    startAt: string;
    endAt: string;
    status: string;
  }[];
  lockedMonths: readonly { employeeId: string; month: string }[];
  timeZone: string;
}) {
  const checks: Record<string, ScheduleCheck[]> = {};
  const add = (cell: ScheduleCell, check: ScheduleCheck) => {
    const key = scheduleCellKey(cell);
    checks[key] ??= [];
    if (
      !checks[key].some(
        (old) => old.rule === check.rule && old.message === check.message,
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
      if (
        input.leaves.some(
          (leave) =>
            leave.employeeId === cell.employeeId &&
            ['pending', 'approved'].includes(leave.status) &&
            Date.parse(leave.startAt) < window.end &&
            Date.parse(leave.endAt) > window.start,
        )
      )
        add(cell, {
          rule: 'leaveConflict',
          level: 'block',
          message: 'LEAVE_CONFLICT',
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

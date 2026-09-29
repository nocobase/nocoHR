import type { DatabaseConnection } from '@nocobase/db';
import type { CollectionPolicies } from './authorize.js';
import { policyOf } from './authorize.js';
import { attendanceRuleSchema } from './attendance-catalog.js';
import type { OrganizationService } from './organization-service.js';
import { addDays, HrError, str } from './shared.js';
import {
  validateScheduleCells,
  type ScheduleCell,
} from './schedule-validation.js';

/** Read-only rule preflight. The result is not an authorization to save later. */
export async function schedulePreflight(input: {
  connection: DatabaseConnection;
  policies: CollectionPolicies;
  cells: ScheduleCell[];
  organization: OrganizationService;
  timeZone: string;
}) {
  const { connection, policies, cells, organization, timeZone } = input;
  const employeeIds = [...new Set(cells.map((cell) => cell.employeeId))];
  const dates = cells.map((cell) => cell.date).sort();
  if (employeeIds.length > 500 || dates.at(-1)! > addDays(dates[0], 30))
    throw new HrError('SCOPE_TOO_LARGE', 400);
  const employees = await connection
    .repository('employees')
    .withPolicy(policyOf(policies, 'employees'))
    .findMany({
      filter: (f) => f.or(employeeIds.map((id) => f.string('id').eq(id))),
    });
  if (employees.length !== employeeIds.length)
    throw new HrError('NOT_FOUND', 404);
  const selectedShiftIds = [
    ...new Set(cells.flatMap((cell) => (cell.shiftId ? [cell.shiftId] : []))),
  ];
  if (selectedShiftIds.length) {
    const visible = await connection
      .repository('shifts')
      .withPolicy(policyOf(policies, 'shifts'))
      .findMany({
        filter: (f) =>
          f.or(selectedShiftIds.map((id) => f.string('id').eq(id))),
      });
    if (visible.length !== selectedShiftIds.length)
      throw new HrError('NOT_FOUND', 404);
  }
  // Trusted invariant reads are restricted to the already-authorized employees.
  // Do not expose underlying leave/monthly/rule records or widen user policies.
  // ±33 days covers the configured maximum 31 nights and 72-hour rest window.
  const existing = await connection.repository('shiftSchedules').findMany({
    filter: (f) =>
      f.and([
        f.or(employeeIds.map((id) => f.string('employeeId').eq(id))),
        f
          .date('date')
          .between([addDays(dates[0], -33), addDays(dates.at(-1)!, 33)]),
      ]),
    limit: 50001,
  });
  if (existing.length > 50000) throw new HrError('SCOPE_TOO_LARGE', 400);
  const allShiftIds = [
    ...new Set([
      ...selectedShiftIds,
      ...existing.flatMap((row) => (row.shiftId ? [str(row.shiftId)] : [])),
    ]),
  ];
  const shifts = allShiftIds.length
    ? await connection.repository('shifts').findMany({
        filter: (f) => f.or(allShiftIds.map((id) => f.string('id').eq(id))),
      })
    : [];
  const leaves = await connection.repository('leaveRequests').findMany({
    filter: (f) =>
      f.and([
        f.or(employeeIds.map((id) => f.string('employeeId').eq(id))),
        f.or(
          ['pending', 'approved'].map((status) =>
            f.string('status').eq(status),
          ),
        ),
      ]),
    limit: 10001,
  });
  if (leaves.length > 10000) throw new HrError('SCOPE_TOO_LARGE', 400);
  const locked = await connection
    .repository('attendanceMonthlySummaries')
    .findMany({
      filter: (f) =>
        f.and([
          f.or(employeeIds.map((id) => f.string('employeeId').eq(id))),
          f.string('status').eq('locked'),
        ]),
    });
  const ruleRows = await connection
    .repository('attendanceRules')
    .findMany({ filter: { active: true } });
  const result = validateScheduleCells({
    cells,
    existing: existing.map((row) => ({
      employeeId: str(row.employeeId),
      date: str(row.date).slice(0, 10),
      shiftId: row.shiftId ? str(row.shiftId) : null,
    })),
    employees: employees.map((row) => ({
      id: str(row.id),
      departmentId: str(row.departmentId),
      status: str(row.status),
      hireDate: row.hireDate ? str(row.hireDate).slice(0, 10) : null,
      leaveDate: row.leaveDate ? str(row.leaveDate).slice(0, 10) : null,
    })),
    shifts: shifts.map((row) => ({
      id: str(row.id),
      startTime: str(row.startTime),
      endTime: str(row.endTime),
      isNight: Boolean(row.isNight),
      active: Boolean(row.active),
      departmentIds: row.departmentIds as string[] | null,
    })),
    departments: await organization.listTree(connection),
    rules: ruleRows.map((row) => ({
      id: str(row.id),
      ...attendanceRuleSchema.strip().parse(row),
    })),
    leaves: leaves.map((row) => ({
      employeeId: str(row.employeeId),
      startAt: str(row.startAt),
      endAt: str(row.endAt),
      status: str(row.status),
    })),
    lockedMonths: locked.map((row) => ({
      employeeId: str(row.employeeId),
      month: str(row.month),
    })),
    timeZone,
  });
  return {
    ...result,
    writesReady: false as const,
    pendingRules: [
      'MONTHLY_OVERTIME_POLICY_REQUIRED',
      'WRITE_CONCURRENCY_NOT_READY',
      'PUBLICATION_DELIVERY_NOT_READY',
    ],
  };
}

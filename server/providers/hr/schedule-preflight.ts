import type { DatabaseConnection } from '@nocobase/db';
import type { CollectionPolicies } from './authorize.js';
import { policyOf } from './authorize.js';
import { attendanceRuleSchema } from './attendance-catalog.js';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
} from './attendance-config.js';
import type { OrganizationService } from './organization-service.js';
import { addDays, HrError, str } from './shared.js';
import {
  validateScheduleCells,
  type ScheduleCell,
} from './schedule-validation.js';
// V4-14 排班资质校验: the required certifications and the certificates, on this connection.
import { loadQualificationInput } from './licensed/qualification.js';

/** Read-only rule preflight. The result is not an authorization to save later. */
export async function schedulePreflight(input: {
  connection: DatabaseConnection;
  /** null: a trusted internal check (a swap being approved) over employees already authorized. */
  policies: CollectionPolicies | null;
  cells: ScheduleCell[];
  organization: OrganizationService;
  timeZone: string;
}) {
  const { connection, policies, cells, organization, timeZone } = input;
  const employeeIds = [...new Set(cells.map((cell) => cell.employeeId))];
  const dates = cells.map((cell) => cell.date).sort();
  if (employeeIds.length > 500 || dates.at(-1)! > addDays(dates[0], 30))
    throw new HrError('SCOPE_TOO_LARGE', 400);
  const scoped = (name: string) =>
    policies
      ? connection.repository(name).withPolicy(policyOf(policies, name))
      : connection.repository(name);
  const employees = await scoped('employees').findMany({
    filter: (f) => f.or(employeeIds.map((id) => f.string('id').eq(id))),
  });
  if (employees.length !== employeeIds.length)
    throw new HrError('NOT_FOUND', 404);
  const selectedShiftIds = [
    ...new Set(cells.flatMap((cell) => (cell.shiftId ? [cell.shiftId] : []))),
  ];
  if (selectedShiftIds.length) {
    const visible = await scoped('shifts').findMany({
      filter: (f) => f.or(selectedShiftIds.map((id) => f.string('id').eq(id))),
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
  const setting = async <K extends 'overtime' | 'calendar'>(section: K) => {
    const row = await connection.query
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', `attendance.${section}`)
      .executeTakeFirst();
    let value: unknown = row?.value ?? attendanceConfigDefaults[section];
    for (let i = 0; i < 2 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    return attendanceConfigSchemas[section].parse(
      value,
    ) as (typeof attendanceConfigDefaults)[K];
  };
  const calendar = await setting('calendar');
  const overtimeRows = await connection.query
    .selectFrom('attendanceAdjustments')
    .select(['employeeId', 'date', 'details'])
    .where('employeeId', 'in', employeeIds)
    .where('type', '=', 'overtime')
    .where('status', '=', 'approved')
    .where('date', '>=', addDays(dates[0], -33))
    .where('date', '<=', addDays(dates.at(-1)!, 33))
    .execute();
  const approvedHours = new Map<string, number>();
  for (const row of overtimeRows) {
    let details: unknown = row.details;
    if (typeof details === 'string') details = JSON.parse(details);
    const key = `${str(row.employeeId)}:${str(row.date).slice(0, 7)}`;
    approvedHours.set(
      key,
      (approvedHours.get(key) ?? 0) +
        Number((details as { hours?: number } | null)?.hours ?? 0),
    );
  }
  const qualification = await loadQualificationInput(
    connection.query,
    selectedShiftIds,
    employeeIds,
  );
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
      breakMinutes: Number(row.breakMinutes ?? 0),
    })),
    departments: await organization.listTree(connection),
    rules: ruleRows.map((row) => ({
      id: str(row.id),
      ...attendanceRuleSchema.strip().parse(row),
    })),
    leaves: leaves.map((row) => ({
      id: str(row.id),
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
    overtime: {
      standardDayHours: (await setting('overtime')).standardDayHours,
      approvedHours,
      holidays: calendar.years.flatMap((y) => y.holidays),
      adjustedWorkdays: calendar.years.flatMap((y) => y.adjustedWorkdays),
    },
    qualification,
  });
  return result;
}

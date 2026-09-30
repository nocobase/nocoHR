/**
 * Helpers the payroll services share: months, stored values, the
 * department tree, working days and the employee rows payroll reads.
 */
import type { DatabaseManager } from '@nocobase/db';

import { json } from '../platform.js';
import { HrError, str } from '../shared.js';

export { json };

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

export function requireMonth(
  value: unknown,
  code = 'PAYROLL_MONTH_INVALID',
): string {
  if (!isMonth(value)) throw new HrError(code, 400);
  return value;
}

export function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function monthOf(date: string | null | undefined): string | null {
  return date ? date.slice(0, 7) : null;
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
  };
}

export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const day = (value: unknown): string | null =>
  value === null || value === undefined || value === ''
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : str(value).slice(0, 10);

export const iso = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(str(value)).toISOString();

export type Query = ReturnType<DatabaseManager['query']>;

export interface PayrollEmployee {
  id: string;
  employeeNo: string;
  name: string;
  userId: string | null;
  departmentId: string;
  positionId: string | null;
  status: string;
  hireDate: string | null;
  leaveDate: string | null;
  employmentType: string;
  workLocation: string | null;
}

export function toEmployee(row: Record<string, unknown>): PayrollEmployee {
  return {
    id: str(row.id),
    employeeNo: str(row.employeeNo),
    name: str(row.name),
    userId: row.userId ? str(row.userId) : null,
    departmentId: str(row.departmentId),
    positionId: row.positionId ? str(row.positionId) : null,
    status: str(row.status),
    hireDate: day(row.hireDate),
    leaveDate: day(row.leaveDate),
    employmentType: str(row.employmentType ?? 'fullTime'),
    workLocation: row.workLocation ? str(row.workLocation) : null,
  };
}

export const EMPLOYEE_COLUMNS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'status',
  'hireDate',
  'leaveDate',
  'employmentType',
  'workLocation',
] as const;

export async function loadEmployees(query: Query): Promise<PayrollEmployee[]> {
  const rows = await query
    .selectFrom('employees')
    .select([...EMPLOYEE_COLUMNS])
    .orderBy('employeeNo', 'asc')
    .execute();
  return rows.map((row) => toEmployee(row as Record<string, unknown>));
}

/** Whether the employee is on the books for some day of the month. */
export function employedIn(employee: PayrollEmployee, month: string): boolean {
  const { from, to } = monthRange(month);
  if (employee.hireDate && employee.hireDate > to) return false;
  if (employee.leaveDate && employee.leaveDate < from) return false;
  if (!employee.hireDate && employee.status === 'leave') return false;
  return true;
}

export interface DepartmentNode {
  id: string;
  parentId: string | null;
  title: string;
}

/** The department and its ancestors, the department first. */
export function chainOf(
  departmentId: string,
  tree: readonly DepartmentNode[],
): string[] {
  const byId = new Map(tree.map((d) => [d.id, d]));
  const chain: string[] = [];
  let current = byId.get(departmentId);
  const seen = new Set<string>();
  if (!current) return [departmentId];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.push(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

/** A department and every department under it. */
export function subtreeOf(
  departmentId: string,
  tree: readonly DepartmentNode[],
): Set<string> {
  const ids = new Set([departmentId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of tree)
      if (d.parentId && ids.has(d.parentId) && !ids.has(d.id)) {
        ids.add(d.id);
        grew = true;
      }
  }
  return ids;
}

export interface WorkCalendar {
  holidays: Set<string>;
  adjustedWorkdays: Set<string>;
}

/** 节假日日历 from the attendance settings (设置 / 考勤设置); empty when not set. */
export async function readCalendar(query: Query): Promise<WorkCalendar> {
  const row = await query
    .selectFrom('personnelSettings')
    .select(['value'])
    .where('id', '=', 'attendance.calendar')
    .executeTakeFirst();
  const value = json<{
    years?: { holidays?: string[]; adjustedWorkdays?: string[] }[];
  }>(row?.value, {});
  const holidays = new Set<string>();
  const adjusted = new Set<string>();
  for (const year of value.years ?? []) {
    for (const d of year.holidays ?? []) holidays.add(d);
    for (const d of year.adjustedWorkdays ?? []) adjusted.add(d);
  }
  return { holidays, adjustedWorkdays: adjusted };
}

export function isWorkday(date: string, calendar: WorkCalendar): boolean {
  if (calendar.holidays.has(date)) return false;
  if (calendar.adjustedWorkdays.has(date)) return true;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/**
 * 计薪天数: the structure's payDaysPerMonth for a full month; for the month of
 * joining or leaving, the working days of the employed part, never more
 * than payDaysPerMonth.
 */
export function payableDaysFor(
  employee: Pick<PayrollEmployee, 'hireDate' | 'leaveDate'>,
  month: string,
  payDaysPerMonth: number,
  calendar: WorkCalendar,
): { payableDays: number; partial: boolean; from: string; to: string } {
  const { from, to } = monthRange(month);
  const start =
    employee.hireDate && employee.hireDate > from ? employee.hireDate : from;
  const end =
    employee.leaveDate && employee.leaveDate < to ? employee.leaveDate : to;
  if (start === from && end === to)
    return { payableDays: payDaysPerMonth, partial: false, from, to };
  let count = 0;
  for (
    let d = new Date(`${start}T00:00:00Z`);
    d.toISOString().slice(0, 10) <= end;
    d.setUTCDate(d.getUTCDate() + 1)
  )
    if (isWorkday(d.toISOString().slice(0, 10), calendar)) count += 1;
  return {
    payableDays: Math.min(count, payDaysPerMonth),
    partial: true,
    from: start,
    to: end,
  };
}

/** Masks an account number to its last four digits. */
export function maskAccount(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const digits = value.replace(/\s/gu, '');
  return digits.length <= 4 ? '****' : `**** ${digits.slice(-4)}`;
}

/** Escapes a CSV cell; a leading formula character is neutralised. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : str(value);
  if (/^[=+\-@]/u.test(text) && !/^-?\d+(\.\d+)?$/u.test(text))
    text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  // A BOM so spreadsheet programs read the Chinese headers as UTF-8.
  return `${String.fromCharCode(0xfeff)}${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

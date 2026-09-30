import type {
  CheckMap,
  ScheduleCell,
  ScheduleCheck,
} from '@/components/talent/attendance/types';

/** A pending edit: a shift id, or `null` for a rest day. */
export type Edits = Record<string, string | null>;

export const REST = '__rest';
export const cellKey = (employeeId: string, date: string) =>
  `${employeeId}:${date}`;
export const splitKey = (key: string) => {
  const at = key.lastIndexOf(':');
  return { employeeId: key.slice(0, at), date: key.slice(at + 1) };
};

/** The checks to show for a cell: the latest response's, else the stored ones. */
export function cellChecks(
  key: string,
  cell: ScheduleCell | undefined,
  checks: CheckMap | undefined,
): ScheduleCheck[] {
  if (checks && key in checks) return checks[key];
  return cell?.checkResult ?? [];
}

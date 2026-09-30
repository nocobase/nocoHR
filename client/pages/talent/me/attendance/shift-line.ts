import type { MySchedule } from '@/components/talent/attendance/types';

/** The shift of a date, in words, for the request dialogs. */
export function shiftLine(
  cell: MySchedule | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!cell) return t('attendance.my.dialogs.noShift');
  if (!cell.shiftId) return t('attendance.my.dialogs.restDay');
  return t('attendance.my.dialogs.shiftLine', {
    shift: cell.title ?? '',
    start: cell.startTime ?? '',
    end: cell.endTime ?? '',
  });
}

/** Whether a shift ends after midnight. */
export const crossesMidnight = (cell: MySchedule | undefined) =>
  Boolean(cell?.startTime && cell.endTime && cell.endTime <= cell.startTime);

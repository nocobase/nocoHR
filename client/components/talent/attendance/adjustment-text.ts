import { clock } from './dates.js';
import type { Adjustment } from './types.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** One line describing what a request asks for, for list rows. */
export function adjustmentSummary(
  row: Adjustment,
  t: Translate,
  locale: string,
  timeZone?: string,
): string {
  const d = row.details;
  if (row.type === 'missingPunch')
    return t('attendance.adjustments.summary.missingPunch', {
      time: clock(d.at, locale, timeZone),
    });
  if (row.type === 'overtime')
    return t('attendance.adjustments.summary.overtime', {
      start: clock(d.startAt, locale, timeZone),
      end: clock(d.endAt, locale, timeZone),
      hours: d.hours ?? '—',
    });
  if (row.type === 'exception')
    return t('attendance.adjustments.summary.exception', {
      anomaly: t(`attendance.recordStatus.${d.anomaly ?? 'late'}`),
      minutes: d.minutes ?? '—',
    });
  return t('attendance.adjustments.summary.shiftSwap', {
    date: d.counterpartDate ?? row.date,
  });
}

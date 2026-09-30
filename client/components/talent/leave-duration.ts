type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * A leave duration with its unit. Day and half-day leave are counted in days
 * (a half day is 0.5), hourly leave in hours — the server's `duration` is in
 * those units, so "1.5 半天" would misstate it.
 */
export function formatLeaveDuration(
  duration: number,
  /** `day`, `halfDay` or `hour`. */
  unit: string | null | undefined,
  t: Translate,
  locale: string,
): string {
  if (!unit) return t('attendance.approvals.unavailable');
  return t('attendance.approvals.durationValue', {
    duration: new Intl.NumberFormat(locale).format(duration),
    unit: t(`attendance.units.${unit === 'hour' ? 'hour' : 'day'}`),
  });
}

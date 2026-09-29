/** V2-05 annual leave calculation only. Callers own authorization, persistence,
 * and the application-time-zone date. Never use the server's local clock here.
 */
export interface SeniorityBand {
  readonly minimumYears: number;
  readonly days: number;
}

export const DEFAULT_ANNUAL_LEAVE_BANDS: readonly SeniorityBand[] =
  Object.freeze([
    Object.freeze({ minimumYears: 1, days: 5 }),
    Object.freeze({ minimumYears: 10, days: 10 }),
    Object.freeze({ minimumYears: 20, days: 15 }),
  ]);

const DAY_MS = 86_400_000;

function calendarDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('INVALID_INPUT');
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(stamp) ||
    new Date(stamp).toISOString().slice(0, 10) !== value
  )
    throw new Error('INVALID_INPUT');
  return stamp;
}

/** Return entitlement, not available balance: used/pending/carriedOver and HR
 * adjustments must remain separate and must not be overwritten by recalculation.
 * Seniority is evaluated on the explicitly supplied calculation date. A later
 * anniversary recalculation policy belongs to the annual balance workflow.
 */
export function calculateAnnualLeave(input: {
  readonly asOf: string;
  readonly hireDate: string;
  readonly careerStartDate?: string | null;
  readonly bands?: readonly SeniorityBand[];
}): {
  year: number;
  entitled: number;
  fullYearDays: number;
  completedYears: number;
  eligibleCalendarDays: number;
  calendarDaysInYear: number;
  needsCareerStartDate: boolean;
} {
  const asOf = calendarDate(input.asOf);
  const hired = calendarDate(input.hireDate);
  const needsCareerStartDate = input.careerStartDate == null;
  const careerDate = input.careerStartDate ?? input.hireDate;
  const career = calendarDate(careerDate);
  if (career > hired) throw new Error('INVALID_INPUT');
  const bands = [...(input.bands ?? DEFAULT_ANNUAL_LEAVE_BANDS)].sort(
    (a, b) => a.minimumYears - b.minimumYears,
  );
  if (
    !bands.length ||
    bands.some(
      (band, index) =>
        !Number.isInteger(band.minimumYears) ||
        band.minimumYears < 0 ||
        !Number.isFinite(band.days) ||
        band.days < 0 ||
        (index > 0 && bands[index - 1].minimumYears === band.minimumYears),
    )
  )
    throw new Error('INVALID_INPUT');

  const year = Number(input.asOf.slice(0, 4));
  if (year < 1 || year > 9998) throw new Error('INVALID_INPUT');
  const start = calendarDate(`${String(year).padStart(4, '0')}-01-01`);
  const end = calendarDate(`${String(year + 1).padStart(4, '0')}-01-01`);
  const calendarDaysInYear = (end - start) / DAY_MS;
  const completedYears = Math.max(
    0,
    year -
      Number(careerDate.slice(0, 4)) -
      (input.asOf.slice(5) < careerDate.slice(5) ? 1 : 0),
  );
  const fullYearDays =
    hired > asOf
      ? 0
      : (bands.filter((band) => completedYears >= band.minimumYears).at(-1)
          ?.days ?? 0);
  const eligibleCalendarDays =
    hired > asOf ? 0 : (end - Math.max(start, hired)) / DAY_MS;
  return {
    year,
    entitled: Math.floor(
      (fullYearDays * eligibleCalendarDays) / calendarDaysInYear,
    ),
    fullYearDays,
    completedYears,
    eligibleCalendarDays,
    calendarDaysInYear,
    needsCareerStartDate,
  };
}

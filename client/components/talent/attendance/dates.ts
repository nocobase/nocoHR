/**
 * Calendar-date and clock helpers for the attendance, schedule and leave
 * screens. Dates are `YYYY-MM-DD` strings and clocks `HH:MM` in the
 * application's business time zone (`talent.timeZone`, served by
 * `GET /api/talent/app-time`), never the browser's: the server computes
 * attendance, shifts and leave in that zone, so a punch at 08:24 in Shanghai
 * reads 08:24 on a laptop in New York too. Date arithmetic runs in UTC so a
 * daylight saving change never shifts a day.
 *
 * The zone is module state: `DEFAULT_TIME_ZONE` until `useAppTimeZone()`
 * (./app-time.ts) has loaded the server's value. Every helper takes an
 * optional `timeZone` that defaults to it.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export const DEFAULT_TIME_ZONE = 'Asia/Shanghai';

let appZone = DEFAULT_TIME_ZONE;
const listeners = new Set<() => void>();

/** The application time zone currently in effect. */
export function appTimeZone(): string {
  return appZone;
}

/** Whether `Intl` knows the IANA zone name. */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Sets the application time zone; an unknown zone name is ignored. */
export function setAppTimeZone(value: unknown): void {
  if (!isTimeZone(value) || value === appZone) return;
  appZone = value;
  for (const listener of listeners) listener();
}

export function subscribeAppTimeZone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

interface WallClock {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const partsFormats = new Map<string, Intl.DateTimeFormat>();

/** The wall clock of an instant in a time zone. */
function wallClockOf(instant: number, timeZone: string): WallClock {
  let format = partsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormats.set(timeZone, format);
  }
  const parts = format.formatToParts(new Date(instant));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    // Some engines print midnight as 24 even with h23.
    hour: get('hour') % 24,
    minute: get('minute'),
    second: get('second'),
  };
}

const utcOf = (w: WallClock) =>
  Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);

/** How far the zone's wall clock is ahead of UTC at an instant, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return utcOf(wallClockOf(whole, timeZone)) - whole;
}

/** Today in the application time zone. */
export function today(timeZone: string = appZone): string {
  const w = wallClockOf(Date.now(), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

export function currentMonth(timeZone: string = appZone): string {
  return today(timeZone).slice(0, 7);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export const isDate = (value: string | null | undefined): value is string =>
  Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value)) &&
  Number.isFinite(Date.parse(`${value}T00:00:00Z`));

export const isMonth = (value: string | null | undefined): value is string =>
  Boolean(value && /^\d{4}-(0[1-9]|1[0-2])$/u.test(value));

/** Every date of a month, first to last. */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: last }, (_, i) => `${month}-${pad(i + 1)}`);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  return (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * The instant of a wall-clock date and `HH:MM[:SS]` in the application time
 * zone, as ISO text. The zone's offset is read at the first guess and again
 * at the result, which settles it across a daylight saving change; a wall
 * clock skipped by one resolves to the instant after the gap.
 */
export function localInstant(
  date: string,
  time: string,
  timeZone: string = appZone,
): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss || 0);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone);
  return new Date(
    second === first ? first : Math.max(first, second),
  ).toISOString();
}

/** The `YYYY-MM-DDTHH:MM` of an instant in the application time zone, for a `datetime-local` input. */
export function wallClockInput(
  value: string,
  timeZone: string = appZone,
): string {
  const w = wallClockOf(Date.parse(value), timeZone);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

/** The instant a `datetime-local` value names in the application time zone. */
export function instantOfWallClock(
  value: string,
  timeZone: string = appZone,
): string {
  const [date, time = '00:00'] = value.split('T');
  return localInstant(date, time, timeZone);
}

/** `HH:MM` of an instant in the application time zone. */
export function clock(
  value: string | null | undefined,
  locale: string,
  timeZone: string = appZone,
) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(new Date(value));
}

export function dayLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function weekdayLabel(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** Date and time of an instant in the application time zone. */
export function dateTimeLabel(
  value: string,
  locale: string,
  timeZone: string = appZone,
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

/** A formatter for instants in the application time zone, with the given fields. */
export function zonedFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string = appZone,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone });
}

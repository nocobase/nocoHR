import { wallClockInput } from '@/components/talent/attendance/dates';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a saved leave is the range this form sent. Whole days (local
 * midnight to midnight) are saved as the shifts worked on them, so the saved
 * range then lies within those days, ending at most a night shift's length
 * after the last one.
 */
export function sameLeaveRange(
  saved: { startAt: string; endAt: string },
  sent: { startAt: string; endAt: string },
  zone: string,
): boolean {
  if (saved.startAt === sent.startAt && saved.endAt === sent.endAt) return true;
  const midnight = (value: string) =>
    wallClockInput(value, zone).endsWith('T00:00');
  if (!midnight(sent.startAt) || !midnight(sent.endAt)) return false;
  const [from, to, start, end] = [
    sent.startAt,
    sent.endAt,
    saved.startAt,
    saved.endAt,
  ].map((value) => Date.parse(value));
  return start >= from && start < to && end > start && end <= to + DAY_MS;
}

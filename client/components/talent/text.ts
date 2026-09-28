/**
 * `String(value)` for a field typed `unknown`. API records hold strings,
 * numbers, booleans or null, so the result is exactly `String(value)`; the
 * signature only tells the linter no object is stringified by accident.
 */
export function str(value: unknown): string {
  return String(value);
}

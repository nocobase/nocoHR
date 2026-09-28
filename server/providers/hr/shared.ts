import { randomUUID } from 'node:crypto';

import type { AuthorizationTitle } from '@nocobase/authorization/core';

/** The application's translation namespace; persisted titles reference it. */
export const HR_NS = 'hr';

export const label = (key: string): AuthorizationTitle => ({ key, ns: HR_NS });

export const newId = (): string => randomUUID();

/**
 * A business rule violation a route answers with a stable code. Services throw
 * it; routes map `status` to the HTTP response and the page translates `code`.
 */
export class HrError extends Error {
  public readonly code: string;
  public readonly status: 400 | 403 | 404 | 409;
  public readonly details?: unknown;

  public constructor(
    code: string,
    status: 400 | 403 | 404 | 409 = 400,
    details?: unknown,
  ) {
    super(code);
    this.name = 'HrError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function toDateOnly(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** The calendar date in the application time zone, as `YYYY-MM-DD`. */
export function today(timeZone: string = 'Asia/Shanghai'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime();
  const b = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

export function requireString(
  value: unknown,
  code: string,
  options: { max?: number; optional?: boolean } = {},
): string | null {
  if (value === undefined || value === null || value === '') {
    if (options.optional) return null;
    throw new HrError(code, 400);
  }
  if (typeof value !== 'string') throw new HrError(code, 400);
  const trimmed = value.trim();
  if (!trimmed && !options.optional) throw new HrError(code, 400);
  if (options.max && trimmed.length > options.max) throw new HrError(code, 400);
  return trimmed || null;
}

export function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  code: string,
): T[number] | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !values.includes(value))
    throw new HrError(code, 400);
  return value;
}

export function requireEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  code: string,
): T[number] {
  const result = optionalEnum(value, values, code);
  if (result === null) throw new HrError(code, 400);
  return result;
}

export function optionalDate(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (!isDateOnly(value)) throw new HrError(code, 400);
  return value;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `String(value)` for a column read as `unknown`. Stored values are strings,
 * numbers, booleans, dates or null, so the result is exactly `String(value)`;
 * the signature only tells the linter no object is stringified by accident.
 */
export function str(value: unknown): string {
  return String(value);
}

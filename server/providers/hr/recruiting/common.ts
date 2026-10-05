/**
 * Shapes and helpers the recruiting services share: stored values, the
 * requirement and stage vocabularies, link tokens and hashes.
 */
import { createHash, randomBytes } from 'node:crypto';

import { json } from '../platform.js';
import { str } from '../shared.js';

export { json };

export const REQUIREMENT_TYPES = [
  'education',
  'experience',
  'certificate',
  'skill',
  'other',
] as const;
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

export const STAGES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export type Stage = (typeof STAGES)[number];

export interface ChecklistItem {
  type: RequirementType;
  text: string;
  mustHave: boolean;
}

export interface Requirement {
  key: string;
  type: RequirementType;
  text: string;
  mustHave: boolean;
  /** responsibilities (from the job description) | checklist (the department's list) | manual (the recruiter) | competency (V3-08 岗位能力要求). */
  origin: 'responsibilities' | 'checklist' | 'manual' | 'competency';
  competencyId?: string | null;
  level?: number | null;
}

export interface KnockoutQuestion {
  key: string;
  question: string;
  answerType: 'yesNo' | 'choice' | 'shortText';
  options?: string[];
  requirementKey: string;
  /** yesNo: 'yes' | 'no'; choice: one of the options; shortText: none. */
  expected?: string | null;
}

const YES = new Set([
  'yes',
  'y',
  'true',
  '是',
  '是的',
  '能',
  '可以',
  '有',
  '接受',
  '愿意',
  '同意',
]);
const NO = new Set([
  'no',
  'n',
  'false',
  '否',
  '不',
  '不是',
  '不能',
  '不可以',
  '没有',
  '无',
  '不接受',
  '不愿意',
]);

/**
 * A yes/no answer or expectation in its stored form. The contract is
 * 'yes' | 'no'; the recruiting assistant or an administrator may have written
 * 是 / 能 / 可以, and a comparison must not fail on the wording.
 */
export function yesNoValue(
  value: string | null | undefined,
): 'yes' | 'no' | null {
  const text = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[。.!！]$/u, '');
  if (YES.has(text)) return 'yes';
  if (NO.has(text)) return 'no';
  return null;
}

export interface InterviewSlot {
  start: string;
  end: string;
  capacity: number;
  location: string | null;
  interviewerUserIds: string[];
}

export interface ScreeningSuggestion {
  matchLevel: 'high' | 'medium' | 'low';
  met: string[];
  missing: string[];
  toVerify: string[];
  reasons: { key: string; text: string }[];
  /** ai | rule */
  by?: 'ai' | 'rule';
}

export interface ApprovalStep {
  level: number;
  kind:
    | 'departmentHead'
    | 'hrAdmin'
    | 'extra'
    | 'hiringManager'
    | 'payrollApprover';
  name?: string | null;
  approverUserIds: string[];
  /** Any holder of the permission set decides. */
  permissionSet?: string | null;
  status: 'pending' | 'waiting' | 'approved' | 'rejected' | 'auto';
  decidedBy: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export interface CandidateMessage {
  id: string;
  type:
    | 'invitation'
    | 'rejection'
    | 'offer'
    | 'aiInterviewInvitation'
    | 'bookingConfirmation'
    | 'interviewReminder'
    | 'preboarding';
  subject: string;
  body: string;
  /** draft: waits for the recruiter; sent: handed to the email channel. */
  status: 'draft' | 'sent' | 'discarded';
  draftedBy: 'ai' | 'rule' | 'recruiter';
  createdAt: string;
  sentAt?: string | null;
  sentBy?: string | null;
  /** The notification result; `channelNotConfigured` when no email channel is set up. */
  delivery?: string | null;
  interviewId?: string | null;
}

export const iso = (value: unknown): string | null =>
  value === null || value === undefined || value === ''
    ? null
    : value instanceof Date
      ? value.toISOString()
      : new Date(str(value)).toISOString();

export const day = (value: unknown): string | null =>
  value === null || value === undefined || value === ''
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : str(value).slice(0, 10);

export function num(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const bool = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** A link token and the hash the database keeps; the token itself is never stored. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: sha256(token) };
}

export function addMonthsToDate(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + m;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** Mobile numbers compare on their digits; emails case-insensitively. */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/gu, '');
  return digits.length >= 6 ? digits.slice(-15) : null;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed) ? trimmed : null;
}

export function maskPhone(value: string | null): string | null {
  if (!value) return null;
  return value.length > 7
    ? `${value.slice(0, 3)}****${value.slice(-4)}`
    : '****';
}

/** Fills `{{name}}` placeholders; unknown placeholders stay empty. */
export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/gu, (_m, name: string) =>
    Object.hasOwn(values, name) ? values[name] : '',
  );
}

export function uniqueKeys<T extends { key: string }>(items: readonly T[]) {
  return new Set(items.map((i) => i.key)).size === items.length;
}

/** Local date and time text in the application time zone. */
export function localDateTime(value: string | Date, timeZone: string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

export function localDate(value: string | Date, timeZone: string): string {
  return localDateTime(value, timeZone).slice(0, 10);
}

/** The instant of a wall-clock time on a date in a time zone (2026-10-08 14:00 Asia/Shanghai). */
export function zonedInstant(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(guess));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const shown = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
  );
  return new Date(guess - (shown - guess));
}

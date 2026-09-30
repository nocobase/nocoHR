import { errorCode, errorDetails, errorMessage } from '../errors.js';
import type { CheckMap, ScheduleCheck } from './types.js';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The message for an attendance, schedule or adjustment failure. The codes of
 * V2-05 are translated under `attendance.errors`; anything else falls back to
 * the shared `talent.errors` wording.
 */
export function attendanceErrorMessage(error: unknown, t: Translate): string {
  const code = errorCode(error);
  if (code) {
    const key = `attendance.errors.${code}`;
    const details = errorDetails(error);
    const values =
      details && typeof details === 'object' && !Array.isArray(details)
        ? (details as Record<string, unknown>)
        : {};
    const message = t(key, { defaultValue: '', ...values });
    if (message && message !== key) return message;
  }
  return errorMessage(error, t);
}

/** The checks a 409 answered with (`SCHEDULE_BLOCKED`, `SCHEDULE_WARNING_CONFIRMATION`). */
export function checksOf(error: unknown): CheckMap | undefined {
  const details = errorDetails(error) as { checks?: CheckMap } | undefined;
  return details && typeof details.checks === 'object'
    ? details.checks
    : undefined;
}

/** One rule result in words: the rule's name and its message. */
export function checkText(check: ScheduleCheck, t: Translate): string {
  // V4-14 排班资质校验: which certification is missing and when the certificate expires.
  if (check.rule === 'certificationMissing')
    return t('attendance.checks.format', {
      rule: t('licensed.checks.rule'),
      message: t(`licensed.checks.${check.message}`, {
        ...(check as { params?: Record<string, string> }).params,
      }),
    });
  const rule = t(`attendance.checks.rules.${check.rule}`, {
    defaultValue: '',
  });
  const messageKey = `attendance.checks.messages.${check.message}`;
  let message = t(messageKey, { defaultValue: '' });
  if (!message || message === messageKey) {
    const errorKey = `attendance.errors.${check.message}`;
    message = t(errorKey, { defaultValue: '' });
    if (!message || message === errorKey) message = check.message;
  }
  return rule && rule !== `attendance.checks.rules.${check.rule}`
    ? t('attendance.checks.format', { rule, message })
    : message;
}

export function worstLevel(
  checks: readonly ScheduleCheck[] | null | undefined,
): 'block' | 'warn' | null {
  if (!checks?.length) return null;
  return checks.some((c) => c.level === 'block') ? 'block' : 'warn';
}

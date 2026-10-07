import { ApiClientError } from '@nocobase/app-client';

type Translate = (key: string, options?: Record<string, unknown>) => string;

function payloadOf(error: unknown): Record<string, unknown> | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  const payload = error.payload;
  return payload && typeof payload === 'object'
    ? (payload as Record<string, unknown>)
    : undefined;
}

/**
 * The code the response body carries: NocoHR endpoints answer `{ code }`, the
 * framework and plugins `{ error: { reason } }` (the client's `reason`).
 */
export function responseCode(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  const payload = payloadOf(error);
  if (payload && typeof payload.code === 'string') return payload.code;
  return error.reason;
}

/** The stable code an endpoint answered with, if any. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiClientError)) return undefined;
  const code = responseCode(error);
  if (code) return code;
  if (error.status === 403) return 'FORBIDDEN';
  if (error.status === 404) return 'NOT_FOUND';
  return undefined;
}

export function errorDetails(error: unknown): unknown {
  return payloadOf(error)?.details;
}

/** A translated message for an endpoint failure; unknown codes fall back to a generic message. */
export function errorMessage(error: unknown, t: Translate): string {
  const code = errorCode(error);
  if (code) {
    const key = `talent.errors.${code}`;
    // Details become interpolation values; lists (such as the people on a manager loop) are joined.
    const details = errorDetails(error);
    const values =
      details && typeof details === 'object' && !Array.isArray(details)
        ? Object.fromEntries(
            Object.entries(details as Record<string, unknown>).map(
              ([name, value]) => [
                name,
                Array.isArray(value) ? value.map(String).join(' → ') : value,
              ],
            ),
          )
        : {};
    const message = t(key, { defaultValue: '', ...values });
    if (message && message !== key) return message;
  }
  return t('talent.errors.generic');
}

/** The page belongs to an industry content pack that is off (server: INDUSTRY_PACK_DISABLED). */
export function isIndustryPackDisabled(error: unknown): boolean {
  return errorCode(error) === 'INDUSTRY_PACK_DISABLED';
}

export function isForbidden(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403;
}

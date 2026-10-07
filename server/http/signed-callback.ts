/**
 * The signature of NocoHR's own callbacks — IM messages and card presses
 * (`/api/im-callback/*`) and directory changes (`/api/org-sync-callback/*`).
 *
 * `x-nocohr-timestamp` is the sending time in Unix seconds and
 * `x-nocohr-signature` the hex HMAC-SHA256 of `<timestamp>.<raw body>` with
 * the callback's secret (`publicEndpoints.imCallbackSecret` /
 * `orgSyncCallbackSecret`). A timestamp further than
 * `publicEndpoints.callbackToleranceSeconds` from the server's clock is
 * refused, so a captured callback cannot be sent again later; within the
 * window the handlers' own dedupe (message, callback or event id, stored in
 * hrReminderLog) runs it at most once (readiness review 2026-10-07: the
 * signature covered the body only and had no time).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_HEADER = 'x-nocohr-signature';
export const TIMESTAMP_HEADER = 'x-nocohr-timestamp';

export function signCallback(
  secret: string,
  timestamp: number | string,
  raw: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${raw}`)
    .digest('hex');
}

export function callbackSignatureValid(input: {
  secret: string | undefined;
  raw: string;
  signature: string | undefined;
  timestamp: string | undefined;
  toleranceSeconds: number;
  now?: number;
}): boolean {
  const { secret, raw, signature, timestamp } = input;
  if (!secret || !signature || !timestamp || !/^\d{1,12}$/u.test(timestamp))
    return false;
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(now - Number(timestamp)) > input.toleranceSeconds) return false;
  const expected = signCallback(secret, timestamp, raw);
  return (
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

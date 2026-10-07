import { signCallback } from '../../server/http/signed-callback.ts';

export { signCallback };

/** The headers of a callback signed now (server/http/signed-callback.ts). */
export function signedHeaders(
  secret: string,
  raw: string,
  at = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.floor(at / 1000));
  return {
    'x-nocohr-timestamp': timestamp,
    'x-nocohr-signature': signCallback(secret, timestamp, raw),
  };
}

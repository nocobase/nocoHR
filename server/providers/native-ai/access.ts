import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';
import { HrError } from '../hr/shared.js';

/** User-only adapters cannot rebuild a restricted entry as an unrestricted user. */
export function assertUnrestrictedNativeAIEntry(
  authorization: AuthorizationContext,
): void {
  if (authorization.identity.keyScope !== undefined)
    throw new HrError('FORBIDDEN', 403);
}

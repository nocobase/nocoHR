import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';
import type { AuthorizationSubject } from '@nocobase/authorization/core';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { RepositoryPolicy } from '@nocobase/db';

import { HrError } from './shared.js';

export type CollectionPolicies = Readonly<
  Record<string, RepositoryPolicy | false | undefined>
>;

/**
 * Authorizes one business action and returns the per-collection policies the
 * decision carries. A denied action, or one whose grants leave a collection
 * without a policy, is a 403 the route answers with `FORBIDDEN`.
 */
export async function authorizeAction(
  authz: AuthorizationContext,
  resource: string,
  action: string,
): Promise<CollectionPolicies> {
  const decision = await authz.authorize({
    resource: { type: 'composite', id: resource },
    action,
  });
  if (decision.effect === 'deny') throw new HrError('FORBIDDEN', 403);
  const database = (
    decision.conditions as { database?: CollectionPolicies } | undefined
  )?.database;
  if (!database) throw new HrError('FORBIDDEN', 403);
  return database;
}

/** Like `authorizeAction`, but answers `undefined` instead of throwing when denied. */
export async function tryAuthorizeAction(
  authz: AuthorizationContext,
  resource: string,
  action: string,
): Promise<CollectionPolicies | undefined> {
  try {
    return await authorizeAction(authz, resource, action);
  } catch (error) {
    if (error instanceof HrError && error.status === 403) return undefined;
    throw error;
  }
}

/** Whether a policy reads every record of its collection (an all-records grant, or an unrestricted identity). */
export function coversAllRecords(policy: RepositoryPolicy): boolean {
  const read = policy.read;
  if (read === true) return true;
  if (read === false) return false;
  return read.scope === true;
}

export function policyOf(
  policies: CollectionPolicies,
  collection: string,
): RepositoryPolicy {
  const policy = policies[collection];
  if (!policy) throw new HrError('FORBIDDEN', 403);
  return policy;
}

/**
 * The principal's user id, or `undefined` for a non-user principal such as an
 * API key bound to nothing.
 */
export function userIdOf(authz: AuthorizationContext): string | undefined {
  const principal = authz.identity.principal;
  return principal.type === 'user' ? String(principal.id) : undefined;
}

/**
 * Builds the same authorization scope the HTTP middleware would install for a
 * user, for callers without a request: AI tools and scheduled work.
 */
export async function scopeForUser(
  authz: AppAuthorization,
  userId: string,
): Promise<AuthorizationContext> {
  const principal = { type: 'user', id: userId } as const;
  const subjects: AuthorizationSubject[] = [
    { type: 'authenticated', id: '*' },
    ...(await authz.subjects.resolveFor(principal)),
  ];
  return authz.for({ principal, subjects });
}

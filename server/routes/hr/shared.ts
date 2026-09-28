import type { AuthorizationEnv } from '@nocobase/app-plugin-authorization/server';
import { AuthorizationDeniedError } from '@nocobase/authorization/core';
import { RepositoryError } from '@nocobase/db';
import type { Context, Hono } from 'hono';

import type { ActorContext } from '../../providers/hr/framework-service.js';
import { HrError, str } from '../../providers/hr/shared.js';

export type HrEnv = AuthorizationEnv;

/** The caller as the services need it; a request without a user principal is refused. */
export function actor(c: Context<HrEnv>): ActorContext {
  const authz = c.get('authz');
  const principal = authz.identity.principal;
  if (principal.type !== 'user') throw new HrError('FORBIDDEN', 403);
  return { authz, userId: String(principal.id) };
}

export async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HrError('INVALID_JSON', 400);
  }
}

export function locale(c: Context): string {
  const header = c.req.header('accept-language') ?? '';
  return header.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
}

/** Maps service and repository failures to stable JSON answers; anything else is rethrown. */
export function installErrorHandler(router: Hono<HrEnv>): void {
  router.onError((error, c) => {
    if (error instanceof HrError) {
      return c.json(
        {
          code: error.code,
          message: error.code,
          details: error.details ?? null,
        },
        error.status,
      );
    }
    if (error instanceof AuthorizationDeniedError) {
      return c.json({ code: 'FORBIDDEN', message: 'FORBIDDEN' }, 403);
    }
    if (error instanceof RepositoryError) {
      const code = str((error as { code?: unknown }).code ?? 'INVALID_INPUT');
      // An out-of-scope row is answered like a missing one, so hidden records stay hidden.
      if (code === 'RECORD_NOT_FOUND' || code === 'RECORD_OUTSIDE_SCOPE')
        return c.json({ code: 'NOT_FOUND', message: 'NOT_FOUND' }, 404);
      if (/FORBIDDEN|SCOPE_VIOLATION|POLICY_REQUIRED/u.test(code))
        return c.json({ code: 'FORBIDDEN', message: 'FORBIDDEN' }, 403);
      if (code === 'VERSION_CONFLICT' || code === 'MULTIPLE_RECORDS_MATCHED')
        return c.json({ code: 'CONFLICT', message: 'CONFLICT' }, 409);
      return c.json({ code, message: code }, 400);
    }
    throw error;
  });
}

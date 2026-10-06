import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';

import { HrError } from '../../providers/hr/shared.js';
import { auditMailToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * V3-11 客户审核问询:
 *
 * - `/api/talent/audit-requests/*` signs in and authorizes: the service checks
 *   talent.auditRequest view / confirm / revoke (and talent.audit
 *   exportAuditPack for the pack). The reply is sent through
 *   `/api/talent/mail/messages/:id/send`, which needs share.
 * - `/api/public/audit-pack/:token` is deliberately public: the customer's
 *   share link. It shows nothing but the customer and the expiry until a
 *   one-time code sent to the requester's address is entered; each address
 *   (IP) is limited to 20 attempts an hour on top of the code's own limit.
 */
const WINDOW_MS = 3_600_000;
const PER_HOUR = 20;

/** The caller's address: the proxy's header, else the socket (Node adapter), else unknown. */
function clientIp(c: Context): string {
  const socket = (
    c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined
  )?.incoming?.socket?.remoteAddress;
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    socket ||
    'unknown'
  );
}

export const auditRequestRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const audit = () => app.container.resolve(auditMailToken);

    const guarded = new Hono<HrEnv>();
    guarded.use(
      '*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    installErrorHandler(guarded);
    guarded.get('/', async (c) =>
      c.json({ data: await audit().service.list(actor(c)) }),
    );
    guarded.post('/', async (c) =>
      c.json(
        { data: await audit().service.create(actor(c), await readJson(c)) },
        201,
      ),
    );
    guarded.get('/:id', async (c) =>
      c.json({ data: await audit().service.get(actor(c), c.req.param('id')) }),
    );
    guarded.patch('/:id', async (c) =>
      c.json({
        data: await audit().service.updateScope(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    guarded.post('/:id/confirm', async (c) =>
      c.json({
        data: await audit().service.confirm(actor(c), c.req.param('id')),
      }),
    );
    guarded.post('/:id/pack', async (c) =>
      c.json({
        data: await audit().service.buildPack(actor(c), c.req.param('id')),
      }),
    );
    guarded.get('/:id/pack', async (c) => {
      const file = await audit().service.pack(actor(c), c.req.param('id'));
      return zip(file);
    });
    guarded.post('/:id/revoke', async (c) =>
      c.json({
        data: await audit().service.revoke(actor(c), c.req.param('id')),
      }),
    );
    guarded.post('/:id/close', async (c) =>
      c.json({
        data: await audit().service.close(actor(c), c.req.param('id')),
      }),
    );

    // ---------- The customer's share link ----------
    const attempts = new Map<string, number[]>();
    const limit = (ip: string) => {
      const now = Date.now();
      const recent = (attempts.get(ip) ?? []).filter(
        (t) => now - t < WINDOW_MS,
      );
      if (recent.length >= PER_HOUR)
        throw new HrError('AUDIT_LINK_LIMITED', 409);
      recent.push(now);
      attempts.set(ip, recent);
    };
    const open = new Hono<HrEnv>();
    installErrorHandler(open);
    open.get('/:token', async (c) =>
      c.json({ data: await audit().share.view(c.req.param('token')) }),
    );
    open.post('/:token/code', async (c) => {
      limit(clientIp(c));
      return c.json({
        data: await audit().share.sendCode(c.req.param('token')),
      });
    });
    open.post('/:token/download', async (c) => {
      const ip = clientIp(c);
      limit(ip);
      const body = (await readJson(c)) as { code?: unknown } | null;
      const file = await audit().share.download(
        c.req.param('token'),
        body?.code,
        ip,
      );
      return zip(file);
    });

    const router = new Hono();
    router.route('/talent/audit-requests', guarded);
    router.route('/public/audit-pack', open);
    return router;
  });

function zip(file: { bytes: Uint8Array; filename: string }): Response {
  return new Response(file.bytes, {
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="audit-pack.zip"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    },
  });
}

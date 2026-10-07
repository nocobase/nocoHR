import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { clientIpResolver } from '../../http/client-ip.js';
import { WindowThrottle } from '../../http/throttle.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  departedMailToken,
  documentSharesToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * V1-02 V2 增补 · 已离职员工的邮件往来:
 *
 * - `/api/talent/departed/template` reads and confirms the separation
 *   certificate template (hr.admin through 人事设置); certificates are mailed
 *   only once it is confirmed.
 * - `/api/talent/departed/income/:employeeId` shows payroll the amounts an
 *   income certificate will carry; the draft's text never holds them.
 * - `/api/public/hr-document/:token` is deliberately public: the link mailed
 *   to a departed employee's personal address. It shows the document's title
 *   and expiry until a one-time code, sent only to that address, is entered;
 *   each address (IP) is limited to 20 attempts an hour on top of the code's
 *   own limit.
 */
const WINDOW_MS = 3_600_000;
const PER_HOUR = 20;

export const departedRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const departed = () => app.container.resolve(departedMailToken);
    const shares = () => app.container.resolve(documentSharesToken);

    const guarded = new Hono<HrEnv>();
    guarded.use(
      '*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    installErrorHandler(guarded);
    guarded.get('/template', async (c) =>
      c.json({ data: await departed().getTemplate(actor(c)) }),
    );
    guarded.put('/template', async (c) =>
      c.json({
        data: await departed().confirmTemplate(actor(c), await readJson(c)),
      }),
    );
    guarded.get('/may-send/:document', async (c) =>
      c.json({
        data: await departed().maySend(actor(c), c.req.param('document')),
      }),
    );
    guarded.get('/income/:employeeId', async (c) =>
      c.json({
        data: await departed().incomePreview(
          actor(c),
          c.req.param('employeeId'),
        ),
      }),
    );

    // ---------- The departed employee's link ----------
    // Per client address (trusted proxies only, see server/http/client-ip.ts), in a bounded table.
    const clientIp = clientIpResolver(app.config);
    const attempts = new WindowThrottle({
      limit: PER_HOUR,
      windowMs: WINDOW_MS,
    });
    const limit = (ip: string) => {
      if (!attempts.hit(ip)) throw new HrError('DOCUMENT_LINK_LIMITED', 409);
    };
    const open = new Hono<HrEnv>();
    installErrorHandler(open);
    open.get('/:token', async (c) =>
      c.json({ data: await shares().view(c.req.param('token')) }),
    );
    open.post('/:token/code', async (c) => {
      limit(clientIp(c));
      return c.json({ data: await shares().sendCode(c.req.param('token')) });
    });
    open.post('/:token/download', async (c) => {
      const ip = clientIp(c);
      limit(ip);
      const body = (await readJson(c)) as { code?: unknown } | null;
      const file = await shares().download(
        c.req.param('token'),
        body?.code,
        ip,
      );
      return new Response(file.bytes, {
        headers: {
          'content-type': 'application/pdf',
          'content-disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
      });
    });

    const router = new Hono();
    router.route('/talent/departed', guarded);
    router.route('/public/hr-document', open);
    return router;
  });

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
import {
  accountActivationToken,
  goLiveSettingsToken,
  goLiveStatusToken,
} from '../../providers/hr/go-live/provider.js';
import { PERSONNEL_SETTINGS_AUTH } from '../../providers/hr/personnel-settings.js';
import { HrError } from '../../providers/hr/shared.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * 上线准备:
 *
 * - `/api/talent/go-live/*`: the checklist's status (each step scoped by
 *   `talent.goLive` · view / viewPayroll), marking a step as not needed, the
 *   first payroll month, and the activation link lifetime (人事设置's
 *   permission, `talent.hr` · administer).
 * - `/api/talent/account-activation/*`: 开通账号并发送激活链接 in bulk, and
 *   re-send / revoke / state for one employee (`talent.employee` · linkUser,
 *   checked by the service).
 * - `/api/public/activation/:token` is deliberately public: the activation
 *   link itself. The token is checked by its hash, expiry, single use and
 *   revocation; each client address (trusted proxies only, see
 *   server/http/client-ip.ts) may open 300 links and set a password 60 times an
 *   hour.
 */
const WINDOW_MS = 3_600_000;
// Generous: a whole shift may activate from one factory network; the tokens themselves cannot be guessed.
const VIEWS_PER_HOUR = 300;
const ATTEMPTS_PER_HOUR = 60;

export const goLiveRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const status = () => app.container.resolve(goLiveStatusToken);
    const settings = () => app.container.resolve(goLiveSettingsToken);
    const activation = () => app.container.resolve(accountActivationToken);
    const guard = [
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    ] as const;

    const goLive = new Hono<HrEnv>();
    goLive.use('*', ...guard);
    installErrorHandler(goLive);
    goLive.get('/status', async (c) =>
      c.json({ data: await status().status(actor(c)) }),
    );
    goLive.put('/steps/:key', async (c) => {
      const body = (await readJson(c)) as { skipped?: unknown } | null;
      return c.json({
        data: await status().setSkipped(
          actor(c),
          c.req.param('key'),
          body?.skipped,
        ),
      });
    });
    goLive.put('/first-payroll-month', async (c) =>
      c.json({
        data: await status().setFirstPayrollMonth(actor(c), await readJson(c)),
      }),
    );
    goLive.get('/activation-settings', async (c) => {
      await actor(c).authz.require(PERSONNEL_SETTINGS_AUTH);
      return c.json({ data: await settings().read('accountActivation') });
    });
    goLive.put('/activation-settings', async (c) => {
      const ctx = actor(c);
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const body = (await readJson(c)) as {
        revision?: unknown;
        value?: unknown;
      } | null;
      if (typeof body?.revision !== 'number')
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await settings().write(
          'accountActivation',
          body.revision,
          body.value,
          ctx.userId,
        ),
      });
    });

    const accounts = new Hono<HrEnv>();
    accounts.use('*', ...guard);
    installErrorHandler(accounts);
    accounts.post('/bulk', async (c) =>
      c.json({ data: await activation().bulk(actor(c), await readJson(c)) }),
    );
    accounts.get('/employees/:id', async (c) =>
      c.json({ data: await activation().state(actor(c), c.req.param('id')) }),
    );
    accounts.post('/employees/:id/resend', async (c) =>
      c.json({ data: await activation().resend(actor(c), c.req.param('id')) }),
    );
    accounts.post('/employees/:id/revoke', async (c) =>
      c.json({ data: await activation().revoke(actor(c), c.req.param('id')) }),
    );

    // ---------- The employee's link ----------
    const clientIp = clientIpResolver(app.config);
    const views = new WindowThrottle({
      limit: VIEWS_PER_HOUR,
      windowMs: WINDOW_MS,
    });
    const attempts = new WindowThrottle({
      limit: ATTEMPTS_PER_HOUR,
      windowMs: WINDOW_MS,
    });
    const open = new Hono<HrEnv>();
    installErrorHandler(open);
    open.get('/:token', async (c) => {
      if (!views.hit(clientIp(c))) throw new HrError('ACTIVATION_LIMITED', 409);
      return c.json(
        { data: await activation().view(c.req.param('token')) },
        200,
        { 'cache-control': 'no-store' },
      );
    });
    open.post('/:token', async (c) => {
      const ip = clientIp(c);
      if (!attempts.hit(ip)) throw new HrError('ACTIVATION_LIMITED', 409);
      return c.json(
        {
          data: await activation().activate(
            c.req.param('token'),
            await readJson(c),
            ip,
          ),
        },
        200,
        { 'cache-control': 'no-store' },
      );
    });

    const router = new Hono();
    router.route('/talent/go-live', goLive);
    router.route('/talent/account-activation', accounts);
    router.route('/public/activation', open);
    return router;
  });

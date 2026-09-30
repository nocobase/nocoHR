import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { HrError, isRecord } from '../../providers/hr/shared.js';
import {
  hrCoreServiceToken,
  orgSyncServiceToken,
  positionAliasServiceToken,
} from '../../providers/hr/tokens.js';
import {
  actor,
  installErrorHandler,
  locale,
  readJson,
  type HrEnv,
} from './shared.js';

const ids = (body: unknown): string[] =>
  isRecord(body) && Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === 'string')
    : [];
const key = (body: unknown): string => {
  if (!isRecord(body) || typeof body.key !== 'string' || !body.key)
    throw new HrError('INVALID_INPUT', 400);
  return body.key;
};

/**
 * V1-03 组织同步 under `/api/talent`: settings, runs, pending items, job-title
 * mappings and the 岗位变动 list. Every path authenticates and each handler
 * authorizes its business action in the service. The directory callback is
 * the one public path: it is accepted only with a valid HMAC signature.
 */
export const orgSyncRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const sync = () => app.container.resolve(orgSyncServiceToken);
    const aliases = () => app.container.resolve(positionAliasServiceToken);
    const core = () => app.container.resolve(hrCoreServiceToken);

    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 64 * 1024 }),
    );
    installErrorHandler(routes);

    routes.get('/org-sync', async (c) =>
      c.json({ data: await sync().getStatus(actor(c)) }),
    );
    routes.patch('/org-sync/settings', async (c) =>
      c.json({
        data: await sync().updateSettings(actor(c), await readJson(c)),
      }),
    );
    routes.post('/org-sync/master', async (c) =>
      c.json({ data: await sync().switchMaster(actor(c), await readJson(c)) }),
    );
    routes.post('/org-sync/run', async (c) =>
      c.json({ data: await sync().runNow(actor(c)) }),
    );
    routes.get('/org-sync/runs', async (c) =>
      c.json({ data: await sync().listRuns(actor(c)) }),
    );
    routes.get('/org-sync/runs/:id', async (c) =>
      c.json({ data: await sync().getRun(actor(c), c.req.param('id')) }),
    );
    routes.get('/org-sync/issues', async (c) =>
      c.json({ data: await sync().listIssues(actor(c)) }),
    );
    routes.post('/org-sync/issues/ignore', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await sync().ignoreIssue(
          actor(c),
          key(body),
          isRecord(body) ? body.reason : undefined,
        ),
      });
    });
    routes.post('/org-sync/issues/adopt-manager', async (c) =>
      c.json({
        data: await sync().adoptManager(actor(c), key(await readJson(c))),
      }),
    );
    // What the personnel action form is pre-filled with for an item.
    routes.post('/org-sync/issues/prefill', async (c) =>
      c.json({ data: await sync().prefill(actor(c), key(await readJson(c))) }),
    );
    // 手工指定: the department or the binding the sync could not decide.
    routes.post('/org-sync/issues/assign', async (c) => {
      const body = await readJson(c);
      const choice = isRecord(body)
        ? Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'key'))
        : {};
      return c.json({
        data: await sync().assignIssue(actor(c), key(body), choice),
      });
    });
    // 开通账号: a login account for an employee bound to an office-suite member.
    routes.post('/org-sync/employees/:id/account', async (c) =>
      c.json(
        {
          data: await sync().createAccountFor(
            actor(c),
            c.req.param('id'),
            await readJson(c).catch(() => ({})),
          ),
        },
        201,
      ),
    );
    routes.post('/org-sync/employees/:id/lock', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await sync().setSyncLock(
          actor(c),
          c.req.param('id'),
          isRecord(body) ? body.locked : undefined,
        ),
      });
    });

    routes.get('/position-aliases', async (c) =>
      c.json({ data: await aliases().list(actor(c)) }),
    );
    routes.post('/position-aliases', async (c) =>
      c.json(
        { data: await aliases().create(actor(c), await readJson(c)) },
        201,
      ),
    );
    routes.patch('/position-aliases/:id', async (c) =>
      c.json({
        data: await aliases().update(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/position-aliases/confirm', async (c) =>
      c.json({
        data: await aliases().confirm(actor(c), ids(await readJson(c))),
      }),
    );
    routes.post('/position-aliases/remove', async (c) =>
      c.json({
        data: await aliases().remove(actor(c), ids(await readJson(c))),
      }),
    );
    // 按新映射重新处理: a full sync compares every member again under the confirmed mappings.
    routes.post('/position-aliases/reprocess', async (c) =>
      c.json({ data: await sync().runNow(actor(c)) }),
    );

    routes.get('/job-events', async (c) =>
      c.json({
        data: await core().listJobEvents(
          actor(c),
          {
            eventType: c.req.query('eventType') || undefined,
            source: c.req.query('source') || undefined,
            departmentId: c.req.query('departmentId') || undefined,
            from: c.req.query('from') || undefined,
            to: c.req.query('to') || undefined,
            failedOnly: c.req.query('failed') === 'true',
          },
          locale(c),
        ),
      }),
    );
    routes.post('/job-events/:id/retry', async (c) =>
      c.json({ data: await core().retryJobEvent(actor(c), c.req.param('id')) }),
    );

    // Public: the office suite's contact-change callbacks, verified by signature.
    const callbacks = new Hono<HrEnv>();
    installErrorHandler(callbacks);
    callbacks.post(
      '/:provider',
      bodyLimit({ maxSize: 64 * 1024 }),
      async (c) => {
        const raw = await c.req.text();
        const outcome = await sync().handleCallback(
          c.req.param('provider'),
          raw,
          c.req.header('x-nocohr-signature'),
        );
        return c.json({ data: { outcome } }, 202);
      },
    );

    const router = new Hono();
    // Outside /talent: routers there authenticate every path they own.
    router.route('/org-sync-callback', callbacks);
    router.route('/talent', routes);
    return router;
  });

import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import { HrError } from '../../providers/hr/shared.js';
import {
  checklistServiceToken,
  complianceServiceToken,
  personnelSettingsToken,
  settingsDraftServiceToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * V1-02: 变动影响清单, 用工合规检查 and 一句话改配置. Each service checks who may
 * read or act: HR administrators; a checklist's owner; an action's current
 * approver for its preview.
 */
export const changeChecklistRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    // Only the prefixes this router owns: it is mounted at /talent, so a
    // `use('*')` would also run for every /api/talent/* route registered after it.
    for (const prefix of ['/checklists', '/compliance', '/settings-drafts'])
      for (const path of [prefix, `${prefix}/*`])
        routes.use(
          path,
          app.container.resolve(authenticationToken).required(),
          app.container.resolve(authorizationToken).middleware(),
        );
    installErrorHandler(routes);
    const checklists = () => app.container.resolve(checklistServiceToken);
    const compliance = () => app.container.resolve(complianceServiceToken);
    const drafts = () => app.container.resolve(settingsDraftServiceToken);

    routes.get('/checklists', async (c) =>
      c.json({ data: await checklists().list(actor(c), c.req.query('stage')) }),
    );
    routes.get('/checklists/by-action/:actionId', async (c) => {
      const ctx = actor(c);
      const actionId = c.req.param('actionId');
      // Brought up to date first (an action written by a seed or before this feature has none yet),
      // but only for a caller who may read the action's checklist: the check comes before the write.
      const settings = (
        await app.container.resolve(personnelSettingsToken).read('checklists')
      ).value;
      return c.json({
        data: await checklists().openForAction(ctx, actionId, settings),
      });
    });
    routes.get('/checklists/:id', async (c) =>
      c.json({ data: await checklists().read(actor(c), c.req.param('id')) }),
    );
    routes.post('/checklists/:id/items/:key', async (c) =>
      c.json({
        data: await checklists().handle(
          actor(c),
          c.req.param('id'),
          c.req.param('key'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/checklists/:id/items/:key/perform', async (c) =>
      c.json({
        data: await checklists().perform(
          actor(c),
          c.req.param('id'),
          c.req.param('key'),
        ),
      }),
    );

    routes.get('/compliance', async (c) =>
      c.json({
        data: await compliance().list(actor(c), c.req.query('status')),
      }),
    );

    routes.get('/settings-drafts', async (c) =>
      c.json({ data: await drafts().list(actor(c)) }),
    );
    routes.post('/settings-drafts/:id/items/:index/:decision', async (c) => {
      const decision = c.req.param('decision');
      const index = Number(c.req.param('index'));
      if (
        (decision !== 'apply' && decision !== 'discard') ||
        !Number.isInteger(index)
      )
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await drafts().decide(
          actor(c),
          c.req.param('id'),
          index,
          decision,
        ),
      });
    });
    routes.post('/settings-drafts/:id/revert', async (c) =>
      c.json({ data: await drafts().revert(actor(c), c.req.param('id')) }),
    );

    const router = new Hono();
    router.route('/talent', routes);
    return router;
  });

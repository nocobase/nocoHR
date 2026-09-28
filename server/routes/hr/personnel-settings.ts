import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { personnelSettingsToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

export const personnelSettingsRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const settings = app.container.resolve(personnelSettingsToken);
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 8192 }),
    );
    installErrorHandler(routes);
    routes.get('/', async (c) =>
      c.json({ data: await settings.get(actor(c)) }),
    );
    routes.patch('/:section', async (c) =>
      c.json({
        data: await settings.update(
          actor(c),
          c.req.param('section'),
          await readJson(c),
        ),
      }),
    );
    const router = new Hono();
    router.route('/talent/personnel-settings', routes);
    return router;
  });

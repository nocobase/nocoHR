import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { attendanceSettingsToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

export const attendanceSettingsRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const settings = app.container.resolve(attendanceSettingsToken);
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 131072 }),
    );
    installErrorHandler(routes);
    routes.get('/', async (c) =>
      c.json({ data: await settings.get(actor(c)) }),
    );
    for (const kind of ['shifts', 'rules'] as const) {
      routes.get(`/${kind}/:id`, async (c) =>
        c.json({
          data: await settings.getCatalog(actor(c), kind, c.req.param('id')),
        }),
      );
      routes.post(`/${kind}`, async (c) =>
        c.json(
          {
            data: await settings.saveCatalog(
              actor(c),
              kind,
              undefined,
              await readJson(c),
            ),
          },
          201,
        ),
      );
      routes.patch(`/${kind}/:id`, async (c) =>
        c.json({
          data: await settings.saveCatalog(
            actor(c),
            kind,
            c.req.param('id'),
            await readJson(c),
          ),
        }),
      );
    }
    routes.get('/config/:section', async (c) =>
      c.json({
        data: await settings.getSection(actor(c), c.req.param('section')),
      }),
    );
    routes.patch('/config/:section', async (c) =>
      c.json({
        data: await settings.update(
          actor(c),
          c.req.param('section'),
          await readJson(c),
        ),
      }),
    );
    const router = new Hono();
    router.route('/talent/attendance-settings', routes);
    return router;
  });

import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { scheduleServiceToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

export const scheduleRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
      bodyLimit({ maxSize: 524288 }),
    );
    installErrorHandler(routes);
    const service = app.container.resolve(scheduleServiceToken);
    routes.get('/', async (c) =>
      c.json({ data: await service.list(actor(c), c.req.query()) }),
    );
    routes.post('/validate', async (c) =>
      c.json({ data: await service.validate(actor(c), await readJson(c)) }),
    );
    routes.post('/save', async (c) =>
      c.json({ data: await service.save(actor(c), await readJson(c), false) }),
    );
    routes.post('/publish', async (c) =>
      c.json({ data: await service.save(actor(c), await readJson(c), true) }),
    );
    const router = new Hono();
    router.route('/talent/schedules', routes);
    return router;
  });

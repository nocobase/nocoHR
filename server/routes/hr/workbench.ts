import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { Hono } from 'hono';
import { createWorkbenchService } from '../../providers/hr/workbench-service.js';
import { actor, installErrorHandler, type HrEnv } from './shared.js';

export const workbenchRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    installErrorHandler(routes);
    const service = createWorkbenchService(
      app.container.resolve(databaseManagerToken),
      app.config.get<string>('talent.timeZone') || 'Asia/Shanghai',
    );
    routes.get('/', async (c) =>
      c.json({ data: await service.list(actor(c), c.req.query()) }),
    );
    routes.post('/:id/complete', async (c) =>
      c.json({
        data: await service.finish(actor(c), c.req.param('id'), 'complete'),
      }),
    );
    routes.post('/:id/dismiss', async (c) =>
      c.json({
        data: await service.finish(actor(c), c.req.param('id'), 'dismiss'),
      }),
    );
    const router = new Hono();
    router.route('/talent/work-items', routes);
    return router;
  });

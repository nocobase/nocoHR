import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { isDateOnly } from '../../providers/hr/shared.js';
import {
  demoBatchServiceToken,
  insightServiceToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, type HrEnv } from './shared.js';

/**
 * The training report, profile read models (certificate wall, growth
 * timeline, gap recommendations) and the demonstration batch record. Every
 * path authenticates and installs the authorization context.
 */
export const insightApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const insights = app.container.resolve(insightServiceToken);
    const demoBatch = app.container.resolve(demoBatchServiceToken);
    const logger = app.container.resolve(loggingToken).getLogger('demo');

    const routes = new Hono<HrEnv>();
    for (const prefix of [
      '/talent/training-report',
      '/talent/people',
      '/demo/batch-record',
    ]) {
      routes.use(
        prefix,
        auth.required(),
        bodyLimit({ maxSize: 64 * 1024 }),
        authz.middleware(),
      );
      routes.use(
        `${prefix}/*`,
        auth.required(),
        bodyLimit({ maxSize: 64 * 1024 }),
        authz.middleware(),
      );
    }
    installErrorHandler(routes);

    routes.get('/talent/training-report', async (c) => {
      const date = (key: string) => {
        const value = c.req.query(key);
        return value && isDateOnly(value) ? value : undefined;
      };
      return c.json({
        data: await insights.trainingReport(actor(c), {
          departmentId: c.req.query('departmentId') || undefined,
          positionId: c.req.query('positionId') || undefined,
          from: date('from'),
          to: date('to'),
        }),
      });
    });
    routes.get('/talent/people/:employeeId/certificate-wall', async (c) =>
      c.json({
        data: await insights.certificateWall(
          actor(c),
          c.req.param('employeeId'),
        ),
      }),
    );
    routes.get('/talent/people/:employeeId/timeline', async (c) =>
      c.json({
        data: await insights.timeline(actor(c), c.req.param('employeeId')),
      }),
    );
    routes.get('/talent/people/:employeeId/recommendations', async (c) => {
      const ids = (c.req.query('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 50);
      return c.json({
        data: await insights.recommendations(
          actor(c),
          c.req.param('employeeId'),
          ids,
        ),
      });
    });

    // 批生产记录（演示）: the batch and its signatures, and signing the filling step; granted only through a certification.
    routes.get('/demo/batch-record', async (c) =>
      c.json({ data: await demoBatch.view(actor(c)) }),
    );
    routes.post('/demo/batch-record/sign-filling', async (c) => {
      const ctx = actor(c);
      const signoff = await demoBatch.signFilling(ctx);
      logger.info(
        { userId: ctx.userId, action: 'demo.batch.signFilling' },
        'Demo: filling step signed',
      );
      return c.json({ data: signoff });
    });

    return routes as unknown as Hono;
  });

import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

/**
 * An unknown path under the application's own API prefixes answers a JSON 404. Without it the request fell
 * through to the client's index.html (200 with HTML in production, 500 where the client is not built), which
 * an API caller cannot tell from an answer. Registered last, and only for the prefixes this application owns,
 * so plugin routes under /api are never shadowed.
 */
export const apiNotFoundRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes(() => {
    const router = new Hono();
    for (const prefix of ['/talent', '/public', '/demo'])
      router.all(`${prefix}/*`, (c) =>
        c.json({ code: 'NOT_FOUND', message: 'NOT_FOUND', details: null }, 404),
      );
    return router;
  });

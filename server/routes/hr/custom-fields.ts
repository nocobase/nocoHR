import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import {
  EXTENSIBLE_COLLECTIONS,
  type ExtensibleCollection,
} from '../../providers/hr/custom-fields.js';
import { HrError } from '../../providers/hr/shared.js';
import { customFieldServiceToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * 界面追加字段 (V1-01 字段管理). Signed-in pages read the definitions they
 * render (sensitive ones only with the table's sensitive capability); only
 * HR administrators (the `talent.hr` settings item) manage them.
 */
export const customFieldRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    installErrorHandler(routes);
    const service = app.container.resolve(customFieldServiceToken);
    const collectionOf = (value: string | undefined): ExtensibleCollection => {
      if (!(EXTENSIBLE_COLLECTIONS as readonly string[]).includes(value ?? ''))
        throw new HrError('INVALID_INPUT', 400);
      return value as ExtensibleCollection;
    };

    // Definitions are labels and types, not values: every signed-in page may read them to render
    // the values the record endpoints already filtered.
    routes.get('/definitions', async (c) => {
      actor(c);
      const collection = collectionOf(c.req.query('collection'));
      return c.json({
        data: await service.forReader(collection, {
          sensitive: true,
          includeInactive: c.req.query('includeInactive') === 'true',
        }),
      });
    });
    routes.get('/', async (c) =>
      c.json({
        data: await service.listForAdmin(
          actor(c),
          c.req.query('collection') ?? '',
        ),
      }),
    );
    routes.post('/', async (c) =>
      c.json({ data: await service.create(actor(c), await readJson(c)) }, 201),
    );
    routes.patch('/:id', async (c) =>
      c.json({
        data: await service.update(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/:id/active', async (c) => {
      const body = (await readJson(c)) as { active?: unknown };
      if (typeof body?.active !== 'boolean')
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await service.setActive(actor(c), c.req.param('id'), body.active),
      });
    });
    routes.post('/reorder', async (c) => {
      const body = (await readJson(c)) as {
        collection?: string;
        ids?: unknown;
      };
      return c.json({
        data: await service.reorder(
          actor(c),
          body?.collection ?? '',
          body?.ids,
        ),
      });
    });

    const router = new Hono();
    router.route('/talent/custom-fields', routes);
    return router;
  });

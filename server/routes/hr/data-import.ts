import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { ImportKind } from '../../providers/hr/data-import/index.js';
import { HrError } from '../../providers/hr/shared.js';
import { dataImportServiceToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/** The URL segment of each importer. */
const KINDS: Record<string, ImportKind> = {
  departments: 'departments',
  positions: 'positions',
  contracts: 'contracts',
  'leave-balances': 'leaveBalances',
};

/**
 * 初始数据导入 under `/api/talent/data-import/<kind>`, kind being departments,
 * positions, contracts or leave-balances:
 *
 * - `GET  …/template` the Excel template with an example row;
 * - `POST …/preview` (multipart `file`) every row's problems, nothing written;
 * - `POST …/commit` (`{ rows }` from the preview) one transaction, refused while a row has a problem;
 * - `GET  …/status` `{ count, lastImportedAt }`, for the go-live checklist.
 *
 * Every path signs in and checks the importer's own import action
 * (providers/hr/data-import/index.ts) before anything else. The prefix is
 * its own: the leave and talent routers' body limits are smaller than a file.
 */
export const dataImportRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const imports = () => app.container.resolve(dataImportServiceToken);

    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      auth.required(),
      bodyLimit({ maxSize: 12 * 1024 * 1024 }),
      authz.middleware(),
    );
    installErrorHandler(routes);

    const kindOf = async (c: Context<HrEnv>): Promise<ImportKind> => {
      const kind = KINDS[c.req.param('kind') ?? ''];
      if (!kind) throw new HrError('NOT_FOUND', 404);
      await imports().authorize(actor(c).authz, kind);
      return kind;
    };
    const fileOf = async (c: Context<HrEnv>): Promise<Buffer> => {
      const body = await c.req.parseBody();
      if (!(body.file instanceof File))
        throw new HrError('IMPORT_FILE_REQUIRED', 400);
      return Buffer.from(await body.file.arrayBuffer());
    };
    /** Session refresh for users whose department-based permissions a department import moved. */
    const refresh = async (userIds: readonly string[]) => {
      for (const id of new Set(userIds))
        await authz.permissionSets.notifyAssignmentsChanged({
          type: 'user',
          id,
        });
    };

    routes.get('/:kind/template', async (c) => {
      const kind = await kindOf(c);
      const buffer = imports()[kind].template();
      return new Response(new Uint8Array(buffer), {
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${c.req.param('kind')}-import-template.xlsx"`,
        },
      });
    });

    routes.post('/:kind/preview', async (c) => {
      const kind = await kindOf(c);
      const file = await fileOf(c);
      return c.json({ data: await imports()[kind].preview(file) });
    });

    routes.post('/:kind/commit', async (c) => {
      const kind = await kindOf(c);
      const body = await readJson(c);
      const { userId } = actor(c);
      const service = imports();
      if (kind === 'departments') {
        const { changedUserIds, ...result } = await service.departments.commit(
          userId,
          body,
        );
        await refresh(changedUserIds);
        return c.json({ data: result });
      }
      return c.json({ data: await service[kind].commit(userId, body) });
    });

    routes.get('/:kind/status', async (c) => {
      const kind = await kindOf(c);
      return c.json({ data: await imports().status(kind) });
    });

    const router = new Hono();
    router.route('/talent/data-import', routes);
    return router;
  });

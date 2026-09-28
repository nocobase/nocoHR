import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { defineFileRepositoryApiRoutes } from '@nocobase/app-plugin-file/server';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';
import { Hono, type MiddlewareHandler } from 'hono';

import { tryAuthorizeAction } from '../../providers/hr/authorize.js';
import { hrCoreServiceToken } from '../../providers/hr/tokens.js';
import type { HrEnv } from './shared.js';

const ACCESS_PATH = '/uploads/hr-files';

/**
 * File storage for employee attachments and contract scans. The file plugin's
 * generated routes are public, so each is wrapped in a router of this module
 * that authenticates and authorizes the exact paths it owns before mounting
 * them: uploads need profile or contract management; reading content needs
 * access to the attachment or contract that references the file.
 */
const fileContributions = defineFileRepositoryApiRoutes({
  repositories: [
    {
      name: 'hrFiles',
      collection: 'hrFiles',
      disk: 'local',
      accessPath: ACCESS_PATH,
      accessMode: 'stream',
      policy: {
        read: {
          scope: true,
          fields: [
            'id',
            'filename',
            'ext',
            'mimeType',
            'size',
            'createdAt',
            'updatedAt',
          ],
        },
        create: { scope: true },
        update: false,
        delete: false,
      },
      // Raised from 20 MB for lesson videos, which the browser plays as MP4 without transcoding.
      actions: { findOne: {}, uploadOne: { maxSize: 200 * 1024 * 1024 } },
    },
  ],
});

function guard(
  app: Application,
  scope: 'api' | 'root',
): MiddlewareHandler<HrEnv>[] {
  const auth = app.container.resolve(authenticationToken);
  const authz = app.container.resolve(authorizationToken);
  const core = app.container.resolve(hrCoreServiceToken);
  const check: MiddlewareHandler<HrEnv> = async (c, next) => {
    const context = c.get('authz');
    const principal = context.identity.principal;
    if (principal.type !== 'user') return c.json({ code: 'FORBIDDEN' }, 403);
    if (scope === 'api') {
      const allowed =
        (await tryAuthorizeAction(context, 'talent.profile', 'manage')) ||
        (await tryAuthorizeAction(context, 'talent.contract', 'manage')) ||
        (await tryAuthorizeAction(context, 'talent.kbDocument', 'manage')) ||
        // Lesson videos (V2 step 5).
        (await tryAuthorizeAction(context, 'talent.course', 'manage'));
      if (!allowed) return c.json({ code: 'FORBIDDEN' }, 403);
    } else {
      const match = /([0-9a-f-]{36})(?:\.[^/]*)?$/iu.exec(c.req.path);
      const fileId = match?.[1];
      if (
        !fileId ||
        !(await core.canReadAttachmentFile(
          { authz: context, userId: String(principal.id) },
          fileId,
        ))
      )
        return c.json({ code: 'NOT_FOUND' }, 404);
    }
    await next();
  };
  return [
    auth.required() as unknown as MiddlewareHandler<HrEnv>,
    authz.middleware(),
    check,
  ];
}

export const hrFileRoutes: readonly AppRouteContribution<Application>[] =
  fileContributions.map((contribution) => ({
    scope: contribution.scope,
    createRouter: async (app: Application) => {
      const router = new Hono<HrEnv>();
      if (contribution.scope === 'api') {
        for (const action of ['uploadOne', 'findOne'])
          router.use(`/hrFiles:${action}`, ...guard(app, 'api'));
      } else {
        router.use(`${ACCESS_PATH}/*`, ...guard(app, 'root'));
      }
      router.route('/', await contribution.createRouter(app));
      return router as unknown as Hono;
    },
  }));

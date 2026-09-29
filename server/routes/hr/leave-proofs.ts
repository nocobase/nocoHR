import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { defineFileRepositoryApiRoutes } from '@nocobase/app-plugin-file/server';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { authorizeAction } from '../../providers/hr/authorize.js';
import { leaveRequestServiceToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, type HrEnv } from './shared.js';

export const LEAVE_PROOF_ACCESS_PATH = '/uploads/leave-proofs';
const FILE_LIMIT = 5 * 1024 * 1024;
const BODY_LIMIT = FILE_LIMIT + 64 * 1024;

const contributions = defineFileRepositoryApiRoutes<string>({
  principal: (c) => actor(c as Context<HrEnv>).userId,
  repositories: [
    {
      name: 'leaveProofFiles',
      collection: 'leaveProofFiles',
      disk: 'local',
      accessPath: LEAVE_PROOF_ACCESS_PATH,
      accessMode: 'stream',
      policy: (userId) => ({
        read: {
          scope: { uploadedByUserId: userId },
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
        create: {
          scope: { uploadedByUserId: userId },
          defaults: { uploadedByUserId: userId },
        },
        update: false,
        delete: false,
      }),
      actions: { findOne: {}, uploadOne: { maxSize: BODY_LIMIT } },
    },
  ],
});

// The native uploader owns storage and metadata. This bounded preflight only
// validates the allowed proof formats; it is not malware scanning or parsing.
const validateUpload: MiddlewareHandler<HrEnv> = async (c, next) => {
  if (
    !c.req
      .header('content-type')
      ?.toLowerCase()
      .startsWith('multipart/form-data;')
  )
    return c.json({ code: 'INVALID_FILE' }, 400);
  let body;
  try {
    // Validate a bounded clone: consuming the original stream would break
    // the native uploader's own body-limit middleware.
    body = await c.req.raw.clone().formData();
  } catch {
    return c.json({ code: 'INVALID_FILE' }, 400);
  }
  const file = body.get('file');
  if (
    body.getAll('file').length !== 1 ||
    !(file instanceof File) ||
    file.size === 0
  )
    return c.json({ code: 'INVALID_FILE' }, 400);
  if (file.size > FILE_LIMIT) return c.json({ code: 'BODY_TOO_LARGE' }, 413);
  const ext = file.name.split('.').pop()?.toLowerCase();
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const valid =
    (ext === 'pdf' &&
      file.type === 'application/pdf' &&
      new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-') ||
    (ext === 'png' &&
      file.type === 'image/png' &&
      [137, 80, 78, 71, 13, 10, 26, 10].every(
        (byte, index) => bytes[index] === byte,
      )) ||
    (['jpg', 'jpeg'].includes(ext ?? '') &&
      file.type === 'image/jpeg' &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255);
  if (!valid) return c.json({ code: 'PROOF_FORMAT_INVALID' }, 400);
  await next();
};

/** Native byte routes are public by default: independently check every read. */
export const leaveProofRoutes: readonly AppRouteContribution<Application>[] =
  contributions.map((contribution) => ({
    scope: contribution.scope,
    createRouter: async (app: Application) => {
      const router = new Hono<HrEnv>();
      const auth = app.container.resolve(authenticationToken);
      const authz = app.container.resolve(authorizationToken);
      const requests = app.container.resolve(leaveRequestServiceToken);
      installErrorHandler(router);
      const authenticated = [
        auth.required() as unknown as MiddlewareHandler<HrEnv>,
        authz.middleware(),
      ];
      const privateResponse: MiddlewareHandler<HrEnv> = async (c, next) => {
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Content-Type-Options', 'nosniff');
        await next();
      };
      if (contribution.scope === 'api') {
        for (const action of ['findOne', 'uploadOne']) {
          router.use(
            `/leaveProofFiles:${action}`,
            privateResponse,
            ...authenticated,
            async (c, next) => {
              await authorizeAction(
                actor(c).authz,
                'talent.leaveRequest',
                'request',
              );
              await next();
            },
          );
        }
        router.use('/leaveProofFiles:findOne', bodyLimit({ maxSize: 16384 }));
        router.use('/leaveProofFiles:findOne', async (c, next) => {
          const input: unknown = await c.req.raw
            .clone()
            .json()
            .catch(() => null);
          const id = (input as { filter?: { id?: unknown } } | null)?.filter
            ?.id;
          if (typeof id !== 'string')
            return c.json({ code: 'INVALID_INPUT' }, 400);
          if (!(await requests.canReadProof(actor(c as Context<HrEnv>), id)))
            return c.json({ code: 'NOT_FOUND' }, 404);
          await next();
        });
        router.use(
          '/leaveProofFiles:uploadOne',
          bodyLimit({ maxSize: BODY_LIMIT }),
          validateUpload,
        );
      } else {
        router.use(
          `${LEAVE_PROOF_ACCESS_PATH}/*`,
          privateResponse,
          ...authenticated,
          async (c, next) => {
            const fileName = c.req.path.split('/').pop() ?? '';
            const fileId = fileName.split('.')[0];
            if (
              !/^[0-9a-f-]{36}$/iu.test(fileId) ||
              !(await requests.canReadProof(actor(c), fileId))
            )
              return c.json({ code: 'NOT_FOUND' }, 404);
            await next();
          },
        );
      }
      router.route('/', await contribution.createRouter(app));
      return router as unknown as Hono;
    },
  }));

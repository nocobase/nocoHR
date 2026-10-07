import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { defineFileRepositoryApiRoutes } from '@nocobase/app-plugin-file/server';
import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { databaseManagerToken } from '@nocobase/db';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { tryAuthorizeAction } from '../../providers/hr/authorize.js';
import {
  acceptsHrFile,
  HR_FILE_PURPOSES,
  isHrFilePurpose,
  SNIFF_BYTES,
  textOf,
  type HrFilePurpose,
} from '../../providers/hr/hr-files.js';
import { hrCoreServiceToken } from '../../providers/hr/tokens.js';
import { actor, type HrEnv } from './shared.js';

const ACCESS_PATH = '/uploads/hr-files';
/** Multipart framing around the file. */
const FORM_OVERHEAD = 64 * 1024;
const LARGEST_UPLOAD = Math.max(
  ...Object.values(HR_FILE_PURPOSES).map((rule) => rule.maxSize),
);

interface UploadPrincipal {
  readonly userId: string;
  readonly purpose: HrFilePurpose | null;
}

/**
 * File storage for employee attachments, contract scans, knowledge documents,
 * job descriptions and lesson videos. The file plugin's generated routes are
 * public, so each is wrapped in a router of this module that authenticates and
 * authorizes the exact paths it owns before mounting them.
 *
 * An upload names its purpose (`?purpose=`, see `hr-files.ts`): the purpose
 * decides the permission it needs, its size and the formats it accepts, and is
 * stamped on the row with the uploader, so a record later accepts only a file
 * its editor uploaded for it. `findOne` reads only the caller's own uploads.
 * Reading content needs access to the attachment or contract that references
 * the file.
 */
const fileContributions = defineFileRepositoryApiRoutes<UploadPrincipal>({
  principal: (c) => {
    const purpose = c.req.query('purpose');
    return {
      userId: actor(c as Context<HrEnv>).userId,
      purpose: isHrFilePurpose(purpose) ? purpose : null,
    };
  },
  repositories: [
    {
      name: 'hrFiles',
      collection: 'hrFiles',
      disk: 'local',
      accessPath: ACCESS_PATH,
      accessMode: 'stream',
      policy: ({ userId, purpose }) => ({
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
        create: purpose
          ? {
              scope: { uploadedByUserId: userId, purpose },
              defaults: { uploadedByUserId: userId, purpose },
            }
          : false,
        update: false,
        delete: false,
      }),
      // The largest purpose (lesson videos); each purpose's own limit is checked first.
      actions: {
        findOne: {},
        uploadOne: { maxSize: LARGEST_UPLOAD + FORM_OVERHEAD },
      },
    },
  ],
});

/** The first bytes of a stored file, read without loading the rest. */
async function readHead(
  app: Application,
  disk: string,
  key: string,
): Promise<Uint8Array> {
  const stream = await app.container
    .resolve(driveManagerToken)
    .use(disk)
    .getStream(key);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
      length += chunk.length;
      if (length >= SNIFF_BYTES) break;
    }
  } finally {
    stream.destroy();
  }
  return new Uint8Array(Buffer.concat(chunks).subarray(0, SNIFF_BYTES));
}

/**
 * Checks an upload against its purpose: the permission and size before the
 * plugin stores it; the extension, stored type and first bytes after, when the
 * stored file can be read without parsing the multipart body twice. A file
 * that does not fit is removed again and refused.
 */
function uploadCheck(app: Application): MiddlewareHandler<HrEnv> {
  const database = app.container.resolve(databaseManagerToken);
  return async (c, next) => {
    const purpose = c.req.query('purpose');
    if (!isHrFilePurpose(purpose))
      return c.json({ code: 'HR_FILE_PURPOSE_REQUIRED' }, 400);
    const rule = HR_FILE_PURPOSES[purpose];
    if (!(await tryAuthorizeAction(c.get('authz'), rule.resource, rule.action)))
      return c.json({ code: 'FORBIDDEN' }, 403);
    let stored = false;
    const response = await bodyLimit({
      maxSize: rule.maxSize + FORM_OVERHEAD,
      onError: (c) => c.json({ code: 'BODY_TOO_LARGE' }, 413),
    })(c, async () => {
      await next();
      stored = true;
    });
    if (response) return response;
    if (!stored || !c.res.ok) return;
    const envelope = (await c.res
      .clone()
      .json()
      .catch(() => null)) as { data?: { record?: { id?: unknown } } } | null;
    const id = envelope?.data?.record?.id;
    const file =
      typeof id === 'string'
        ? await database
            .query()
            .selectFrom('hrFiles')
            .select(['id', 'disk', 'key', 'ext', 'mimeType', 'size'])
            .where('id', '=', id)
            .executeTakeFirst()
        : undefined;
    if (!file) return;
    const disk = String(file.disk);
    const key = String(file.key);
    const accepted = acceptsHrFile(purpose, {
      ext: textOf(file.ext),
      mimeType: textOf(file.mimeType),
      size: Number(file.size),
      head: await readHead(app, disk, key).catch(() => new Uint8Array()),
    });
    if (accepted) return;
    await database.query().deleteFrom('hrFiles').where('id', '=', id).execute();
    await app.container
      .resolve(driveManagerToken)
      .use(disk)
      .delete(key)
      .catch(() => undefined);
    c.res = undefined;
    c.res = c.json({ code: 'HR_FILE_TYPE_INVALID' }, 400);
  };
}

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
    if (scope === 'root') {
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
        router.use('/hrFiles:findOne', ...guard(app, 'api'));
        router.use(
          '/hrFiles:uploadOne',
          ...guard(app, 'api'),
          uploadCheck(app),
        );
      } else {
        router.use(`${ACCESS_PATH}/*`, ...guard(app, 'root'));
      }
      router.route('/', await contribution.createRouter(app));
      return router as unknown as Hono;
    },
  }));

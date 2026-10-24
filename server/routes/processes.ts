import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication/server';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  describeRoute,
  dataResponse,
  listResponse,
  apiErrorResponses,
  apiValidator,
  ApiError,
  apiErrorHandler,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { ProcessesConfig } from '../config/processes.js';
import {
  processServiceToken,
  processHistoryToken,
} from '../providers/processes/provider.js';
import { processRequest } from '../providers/processes/service.js';

export const processRoutes = defineApiRoutes<Application>((app) => {
  const router = new Hono();
  const auth = app.container.resolve(authenticationToken),
    authz = app.container.resolve(authorizationToken);
  const guard = async (c: Context, next: () => Promise<void>) => {
    let authorized: Response | void;
    const authenticated = await auth.required()(
      c as Context<AuthEnv, string>,
      async () => {
        authorized = await authz.middleware()(
          c as Context<AuthorizationEnv, string>,
          async () => {
            if (!app.config.get<ProcessesConfig>('processes')?.enabled)
              throw new ApiError({
                status: 'UNAVAILABLE',
                domain: 'nocohr',
                message: 'Processes are unavailable',
                reason: 'PROCESSES_DISABLED',
              });
            await next();
          },
        );
      },
    );
    return authenticated ?? authorized!;
  };
  const actor = (c: Context) => {
    const principal = (c as Context<AuthorizationEnv, string>).get('authz')
      .identity.principal;
    if (principal.type !== 'user')
      throw new ApiError({
        status: 'PERMISSION_DENIED',
        domain: 'nocohr',
        message: 'Access denied',
        reason: 'PROCESS_FORBIDDEN',
      });
    return String(principal.id);
  };
  router.onError((error, c) => {
    if (error instanceof ApiError) return apiErrorHandler(error, c);
    const code = error.message;
    const status =
      code === 'PROCESS_FORBIDDEN'
        ? 'PERMISSION_DENIED'
        : code.endsWith('NOT_FOUND')
          ? 'NOT_FOUND'
          : error instanceof z.ZodError || code === 'INVALID_PROCESS_INPUT'
            ? 'INVALID_ARGUMENT'
            : 'FAILED_PRECONDITION';
    return apiErrorHandler(
      new ApiError({
        status,
        domain: 'nocohr',
        message: 'Process operation could not be completed',
        reason: /^[A-Z_]{1,80}$/u.test(code)
          ? code
          : 'PROCESS_OPERATION_FAILED',
      }),
      c,
    );
  });
  const doc = (id: string, list = false) =>
    describeRoute({
      tags: ['ApplicationProcesses'],
      operationId: id,
      summary: id,
      responses: {
        [id === 'triggerProcess' ? '202' : '200']: list
          ? listResponse(z.record(z.string(), z.unknown()))
          : dataResponse(z.record(z.string(), z.unknown())),
        ...apiErrorResponses,
      },
    });
  router.use('/processDefinitions', guard);
  router.use('/processRuns', guard);
  router.use('/processRuns/*', guard);
  router.use('/processHistory/*', guard);
  router.get(
    '/processDefinitions',
    doc('listProcessDefinitions', true),
    async (c) => {
      const data = await app.container
        .resolve(processServiceToken)
        .definitions(actor(c));
      return c.json({ data, meta: { total: data.length } });
    },
  );
  router.post(
    '/processRuns',
    bodyLimit({
      maxSize: 262144,
      onError: () => {
        throw new ApiError({
          status: 'INVALID_ARGUMENT',
          domain: 'nocohr',
          reason: 'PROCESS_BODY_TOO_LARGE',
          message: 'Process request is too large',
          httpStatus: 413,
        });
      },
    }),
    doc('triggerProcess'),
    apiValidator('json', processRequest),
    async (c) =>
      c.json(
        {
          data: await app.container
            .resolve(processServiceToken)
            .submit(actor(c), c.req.valid('json')),
        },
        202,
      ),
  );
  router.get('/processRuns/:eventKey', doc('readProcessRun'), async (c) =>
    c.json({
      data: await app.container
        .resolve(processServiceToken)
        .read(actor(c), c.req.param('eventKey')),
    }),
  );
  router.get(
    '/processHistory/definitions/:id',
    doc('readProcessHistoryDefinition'),
    async (c) =>
      c.json({
        data: await app.container
          .resolve(processHistoryToken)
          .definition(actor(c), c.req.param('id')),
      }),
  );
  router.get(
    '/processHistory/runs/:id',
    doc('readProcessHistoryRun'),
    async (c) =>
      c.json({
        data: await app.container
          .resolve(processHistoryToken)
          .run(actor(c), c.req.param('id')),
      }),
  );
  return router;
});

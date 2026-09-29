import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  serverFileRepositoryManagerToken,
  type FileRecord,
} from '@nocobase/app-plugin-file/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  leaveRequestServiceToken,
  leaveServiceToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';
import { LEAVE_PROOF_ACCESS_PATH } from './leave-proofs.js';

export const leaveRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const leave = app.container.resolve(leaveServiceToken);
    const requests = app.container.resolve(leaveRequestServiceToken);
    const proofFiles = app.container
      .resolve(serverFileRepositoryManagerToken)
      .repository('leaveProofFiles', {
        disk: 'local',
        accessPath: LEAVE_PROOF_ACCESS_PATH,
        policy: { read: true, create: false, update: false, delete: false },
      });
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 131072 }),
    );
    installErrorHandler(routes);
    routes.get('/types', async (c) => c.json(await leave.listTypes(actor(c))));
    routes.get('/types/:id', async (c) =>
      c.json({ data: await leave.getType(actor(c), c.req.param('id')) }),
    );
    routes.post('/types', async (c) =>
      c.json(
        { data: await leave.saveType(actor(c), undefined, await readJson(c)) },
        201,
      ),
    );
    routes.patch('/types/:id', async (c) =>
      c.json({
        data: await leave.saveType(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.get('/balances', async (c) =>
      c.json(await leave.listBalances(actor(c), c.req.query())),
    );
    routes.post('/balances/initialize', async (c) =>
      c.json({ data: await leave.initialize(actor(c), await readJson(c)) }),
    );
    routes.get('/balances/:id', async (c) =>
      c.json({ data: await leave.getBalance(actor(c), c.req.param('id')) }),
    );
    routes.post('/balances/:id/adjust', async (c) =>
      c.json({
        data: await leave.adjust(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.get('/requests', async (c) =>
      c.json(await requests.list(actor(c), c.req.query())),
    );
    routes.get('/requests/types', async (c) =>
      c.json(await requests.listTypes(actor(c))),
    );
    routes.get('/requests/my-balances', async (c) => {
      c.header('Cache-Control', 'private, no-store');
      return c.json({
        data: await requests.myBalances(actor(c), c.req.query()),
      });
    });
    routes.get('/requests/entry-employees', async (c) =>
      c.json(await requests.listEntryEmployees(actor(c))),
    );
    routes.get('/requests/:id', async (c) =>
      c.json({ data: await requests.get(actor(c), c.req.param('id')) }),
    );
    routes.get('/requests/:id/proof', async (c) => {
      const proof = await requests.proof(actor(c), c.req.param('id'));
      c.header('Cache-Control', 'private, no-store');
      return c.json({
        data: proof
          ? {
              ...proof,
              contentUrl: `${app.publicBasePath ?? ''}${proofFiles.getUrl(proof as unknown as FileRecord)}`,
            }
          : null,
      });
    });
    routes.post('/requests', async (c) =>
      c.json(
        { data: await requests.createDraft(actor(c), await readJson(c)) },
        201,
      ),
    );
    routes.patch('/requests/:id', async (c) =>
      c.json({
        data: await requests.updateDraft(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/requests/:id/submit', async (c) =>
      c.json({
        data: await requests.submit(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/requests/:id/cancel', async (c) =>
      c.json({
        data: await requests.cancel(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/requests/:id/decide', async (c) =>
      c.json({
        data: await requests.decide(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.get('/approvals', async (c) =>
      c.json(
        await requests.list(
          actor(c),
          { ...c.req.query(), status: 'pending' },
          true,
        ),
      ),
    );
    routes.post('/approvals/leave/:id/decide', async (c) =>
      c.json({
        data: await requests.decide(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    const router = new Hono();
    router.route('/talent/leave', routes);
    return router;
  });

import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { AUTOMATIONS } from '../../providers/hr/automation.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  automationServiceToken,
  automationTasksToken,
  platformToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * The AI employees' proactive work under `/api/talent/automations`: each
 * automation's settings (switch, owner, run time, parameters), starting a
 * scheduled one now, and the run records with their draft outcomes. Every
 * path authenticates and installs the authorization context; the service
 * checks `configure` on the automation's AI employee composite.
 */
export const automationApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const automation = app.container.resolve(automationServiceToken);

    const routes = new Hono<HrEnv>();
    routes.use(
      '/automations',
      auth.required(),
      bodyLimit({ maxSize: 64 * 1024 }),
      authz.middleware(),
    );
    routes.use(
      '/automations/*',
      auth.required(),
      bodyLimit({ maxSize: 64 * 1024 }),
      authz.middleware(),
    );
    installErrorHandler(routes);

    routes.get('/automations', async (c) =>
      c.json({ data: await automation.list(actor(c)) }),
    );
    // People who can own an automation: employees with an account, not left;
    // with `?key=`, only those the caller may make its owner (themselves, or a
    // peer who may configure it too) and its current owner.
    routes.get('/automations/owners', async (c) => {
      const ctx = actor(c);
      const settings = await automation.list(ctx);
      const key = c.req.query('key');
      const setting = key ? settings.find((s) => s.key === key) : undefined;
      if (key && !setting) throw new HrError('AUTOMATION_NOT_FOUND', 404);
      const platform = app.container.resolve(platformToken);
      const rows = await platform.database
        .query()
        .selectFrom('employees')
        .select(['userId', 'name', 'employeeNo'])
        .where('userId', 'is not', null)
        .where('status', '!=', 'leave')
        .orderBy('employeeNo', 'asc')
        .execute();
      const eligible = [];
      for (const r of rows)
        if (
          !setting ||
          String(r.userId) === setting.ownerUserId ||
          (await automation.mayOwn(ctx, setting.key, String(r.userId)))
        )
          eligible.push(r);
      return c.json({
        data: eligible.map((r) => ({
          userId: String(r.userId),
          name: String(r.name),
          employeeNo: String(r.employeeNo),
        })),
      });
    });
    routes.get('/automations/runs', async (c) => {
      const limit = Number(c.req.query('limit') ?? 50);
      return c.json({
        data: await automation.listRuns(actor(c), {
          task: c.req.query('task') || undefined,
          limit: Number.isFinite(limit) ? limit : 50,
        }),
      });
    });
    routes.get('/automations/runs/:id', async (c) =>
      c.json({ data: await automation.getRun(actor(c), c.req.param('id')) }),
    );
    routes.patch('/automations/:key', async (c) =>
      c.json({
        data: await automation.update(
          actor(c),
          c.req.param('key'),
          await readJson(c),
        ),
      }),
    );
    // Starts a scheduled automation now; it still honours its switch, owner and the business-level deduplication.
    routes.post('/automations/:key/run', async (c) => {
      const key = c.req.param('key');
      if (!AUTOMATIONS.some((a) => a.key === key))
        throw new HrError('AUTOMATION_NOT_FOUND', 404);
      await automation.assertCanRun(actor(c), key);
      const outcome = await app.container
        .resolve(automationTasksToken)
        .runScheduled(key, 'manual');
      return c.json({ data: outcome });
    });

    // A failed run of any task, again with the same trigger object.
    routes.post('/automations/runs/:id/retry', async (c) =>
      c.json({
        data: await app.container
          .resolve(automationTasksToken)
          .retryRun(actor(c), c.req.param('id')),
      }),
    );
    // The HR assistant's health check of one import batch, run again: a new run and a new report.
    routes.post('/automations/import-check/:batchId', async (c) =>
      c.json({
        data: await app.container
          .resolve(automationTasksToken)
          .rerunImportCheck(actor(c), c.req.param('batchId')),
      }),
    );

    const router = new Hono();
    router.route('/talent', routes);
    return router;
  });

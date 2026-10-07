/**
 * V4-14 行业方案 · 持证上岗 endpoints. Every sub-router authenticates,
 * installs the authorization context and limits bodies on its own paths;
 * each service call authorizes its own business operation:
 *
 * - /api/talent/licensed/settings — 设置 / 持证上岗 (talent.licensedOperationSettings · manage)
 * - /api/talent/licensed/my-grants — what the caller's own certificates let them do
 * - /api/talent/licensed/shifts — 班次 · 要求的认证 (talent.shift · manageRequiredCertifications)
 * - /api/talent/licensed/audit/* — 持证操作追溯 and 权限变化记录 (talent.audit)
 * - /api/talent/licensed/demo/prepare — the step's acceptance certificates (development and demo only)
 * - /api/demo/forklift-dispatch — 叉车出库登记 (demo.forklift, granted through a certificate)
 */
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { loggingToken } from '@nocobase/app-server/logging';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { authorizeAction } from '../../providers/hr/authorize.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  demoBatchServiceToken,
  licensedServicesToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function download(c: Context<HrEnv>, bytes: Uint8Array, fileName: string) {
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': XLSX_TYPE,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
}

export const licensedRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const licensed = () => app.container.resolve(licensedServicesToken);
    const demo = () => app.container.resolve(demoBatchServiceToken);
    const logger = app.container.resolve(loggingToken).getLogger('demo');
    const sub = () => {
      const router = new Hono<HrEnv>();
      router.use(
        '*',
        auth.required(),
        authz.middleware(),
        bodyLimit({ maxSize: 64 * 1024 }),
      );
      installErrorHandler(router);
      return router;
    };
    const param = (value: string | undefined) => {
      if (!value) throw new HrError('NOT_FOUND', 404);
      return value;
    };
    const router = new Hono();

    const api = sub();
    api.get('/settings', async (c) =>
      c.json({ data: await licensed().settings.get(actor(c)) }),
    );
    api.put('/settings', async (c) =>
      c.json({
        data: await licensed().settings.update(actor(c), await readJson(c)),
      }),
    );
    api.get('/my-grants', async (c) =>
      c.json({ data: await licensed().myGrants(actor(c)) }),
    );
    api.get('/shifts', async (c) =>
      c.json({ data: await licensed().shiftRequirements(actor(c)) }),
    );
    api.put('/shifts/:id/required-certifications', async (c) =>
      c.json({
        data: await licensed().setShiftRequirements(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    api.post('/demo/prepare', async (c) =>
      c.json({ data: await licensed().prepareDemo(actor(c)) }),
    );

    // 审计导出 (talent.audit): JSON previews and the Excel files.
    api.get('/audit/options', async (c) => {
      const ctx = actor(c);
      await authorizeAction(
        ctx.authz,
        'talent.audit',
        'exportPermissionChanges',
      );
      return c.json({
        data: {
          startTraceAvailable: await licensed().exports.startTraceAvailable(),
        },
      });
    });
    const traceInput = (c: Context<HrEnv>) => ({
      workOrderNo: c.req.query('workOrderNo') ?? '',
      step: c.req.query('step') || undefined,
      kind: c.req.query('kind') || undefined,
    });
    api.get('/audit/start-trace', async (c) =>
      c.json({
        data: await licensed().exports.startTrace(actor(c), traceInput(c)),
      }),
    );
    api.get('/audit/start-trace/file', async (c) => {
      const file = await licensed().exports.startTraceFile(
        actor(c),
        traceInput(c),
      );
      return download(c, file.bytes, file.fileName);
    });
    const changesInput = (c: Context<HrEnv>) => ({
      ...(c.req.query('employeeId')
        ? { employeeId: c.req.query('employeeId') }
        : {}),
      ...(c.req.query('certificationId')
        ? { certificationId: c.req.query('certificationId') }
        : {}),
      from: c.req.query('from') ?? '',
      to: c.req.query('to') ?? '',
    });
    api.get('/audit/permission-changes', async (c) =>
      c.json({
        data: await licensed().exports.permissionChanges(
          actor(c),
          changesInput(c),
        ),
      }),
    );
    api.get('/audit/permission-changes/file', async (c) => {
      const file = await licensed().exports.permissionChangesFile(
        actor(c),
        changesInput(c),
      );
      return download(c, file.bytes, file.fileName);
    });
    router.route('/talent/licensed', api);

    // 叉车出库登记: the dispatch note and its registrations; registering is granted only through a certificate.
    const forklift = sub();
    forklift.get('/', async (c) =>
      c.json({ data: await demo().forkliftView(actor(c)) }),
    );
    forklift.post('/dispatch', async (c) => {
      const ctx = actor(c);
      const entry = await demo().forkliftDispatch(ctx);
      logger.info(
        { userId: ctx.userId, action: 'demo.forklift.dispatch' },
        'Forklift dispatch registered',
      );
      return c.json({ data: entry });
    });
    router.route('/demo/forklift-dispatch', forklift);

    return router;
  });

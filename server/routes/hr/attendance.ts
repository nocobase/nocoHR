/**
 * V2-05 考勤 and 考勤调整申请. Every path authenticates and installs the
 * authorization context; each service call then authorizes its own
 * `talent.attendanceRecord` / `talent.adjustment` action. The "run a task
 * now" entry is for hr.admin (attendance lock) and does exactly what the
 * scheduler does.
 */
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { runAttendanceTask } from '../../providers/hr/attendance-tasks.js';
import { authorizeAction } from '../../providers/hr/authorize.js';
import { HrError, today } from '../../providers/hr/shared.js';
import {
  adjustmentServiceToken,
  attendanceServiceToken,
  automationTasksToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/** The query without the client's cache-busting `refresh` parameter; the services validate strictly. */
function query(c: Context<HrEnv>): Record<string, string> {
  const { refresh: _refresh, ...rest } = c.req.query();
  return rest;
}

const TASKS = ['pull', 'compute', 'daily', 'monthly', 'yearly'] as const;

export const attendanceRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const attendance = app.container.resolve(attendanceServiceToken);
    const adjustments = app.container.resolve(adjustmentServiceToken);

    const records = new Hono<HrEnv>();
    records.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 5 * 1024 * 1024 }),
    );
    installErrorHandler(records);
    records.get('/daily', async (c) =>
      c.json({ data: await attendance.daily(actor(c), query(c)) }),
    );
    records.get('/monthly', async (c) =>
      c.json({ data: await attendance.monthly(actor(c), query(c)) }),
    );
    records.get('/issues', async (c) =>
      c.json({ data: await attendance.issues(actor(c), query(c)) }),
    );
    records.get('/me', async (c) =>
      c.json({ data: await attendance.mine(actor(c), query(c)) }),
    );
    const file = async (c: Context<HrEnv>) => {
      const body = await c.req.parseBody();
      if (!(body.file instanceof File))
        throw new HrError('IMPORT_FILE_REQUIRED', 400);
      return {
        buffer: new Uint8Array(await body.file.arrayBuffer()),
        skipInvalid: body.skipInvalid === 'true',
      };
    };
    records.get('/import/demo-file', async (c) => {
      const buffer = await attendance.demoWorkbook(actor(c));
      return new Response(new Uint8Array(buffer), {
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition':
            'attachment; filename="device-punches-demo.xlsx"',
        },
      });
    });
    records.post('/import/preview', async (c) => {
      const { buffer } = await file(c);
      return c.json({ data: await attendance.preview(actor(c), buffer) });
    });
    records.post('/import', async (c) => {
      const { buffer, skipInvalid } = await file(c);
      return c.json({
        data: await attendance.importPunches(actor(c), buffer, { skipInvalid }),
      });
    });
    records.post('/recompute', async (c) =>
      c.json({ data: await attendance.recompute(actor(c), await readJson(c)) }),
    );
    records.post('/summaries/lock', async (c) =>
      c.json({ data: await attendance.lock(actor(c), await readJson(c)) }),
    );
    records.post('/summaries/:id/confirm', async (c) =>
      c.json({ data: await attendance.confirm(actor(c), c.req.param('id')) }),
    );
    records.post('/summaries/:id/objection', async (c) =>
      c.json({
        data: await attendance.object(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    records.post('/summaries/:id/handle', async (c) =>
      c.json({
        data: await attendance.handleObjection(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    records.post('/summaries/:id/unlock', async (c) =>
      c.json({
        data: await attendance.unlock(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    records.post('/tasks/:task/run', async (c) => {
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.attendanceRecord', 'lock');
      const task = c.req.param('task') as (typeof TASKS)[number];
      if (!TASKS.includes(task)) throw new HrError('INVALID_INPUT', 400);
      const body = (await readJson(c).catch(() => ({}))) as { asOf?: unknown };
      const asOf =
        typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(body.asOf)
          ? body.asOf
          : undefined;
      const result: Record<string, unknown> = await runAttendanceTask(
        app.container,
        task,
        { asOf, trigger: 'manual' },
      );
      // 手动触发每日 09:00 任务 also runs the anomaly reminder that follows it.
      if (task === 'daily')
        result.anomalyReminder = (
          await app.container
            .resolve(automationTasksToken)
            .runScheduled('hrAssistant.attendanceAnomaly', 'manual')
        ).status;
      return c.json({ data: result });
    });

    const requests = new Hono<HrEnv>();
    requests.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 65536 }),
    );
    installErrorHandler(requests);
    requests.get('/', async (c) =>
      c.json({ data: await adjustments.list(actor(c), query(c)) }),
    );
    requests.post('/', async (c) =>
      c.json(
        { data: await adjustments.request(actor(c), await readJson(c)) },
        201,
      ),
    );
    requests.get('/swap-peers', async (c) =>
      c.json({ data: await adjustments.swapPeers(actor(c), query(c)) }),
    );
    requests.get('/:id', async (c) =>
      c.json({ data: await adjustments.get(actor(c), c.req.param('id')) }),
    );
    requests.post('/:id/decide', async (c) =>
      c.json({
        data: await adjustments.decide(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    requests.post('/:id/cancel', async (c) =>
      c.json({ data: await adjustments.cancel(actor(c), c.req.param('id')) }),
    );
    // A draft the HR assistant prepared: only its employee submits or discards it.
    requests.post('/:id/submit', async (c) =>
      c.json({
        data: await adjustments.submitDraft(
          actor(c),
          c.req.param('id'),
          undefined,
          // An optional body carries the added fields filled in on the draft.
          c.req.header('content-type')?.includes('application/json')
            ? await readJson(c)
            : undefined,
        ),
      }),
    );
    requests.post('/:id/discard', async (c) =>
      c.json({
        data: await adjustments.discardDraft(actor(c), c.req.param('id')),
      }),
    );

    // The business time zone the server computes attendance, shifts and
    // leave in. The attendance, schedule and leave screens read it once so
    // they show and take wall-clock times in that zone, not the browser's.
    const timeZone =
      app.config.get<string>('talent.timeZone') || 'Asia/Shanghai';
    const appTime = new Hono<HrEnv>();
    appTime.use('*', auth.required());
    installErrorHandler(appTime);
    appTime.get('/', (c) =>
      c.json({ data: { timeZone, today: today(timeZone) } }),
    );

    const router = new Hono();
    router.route('/talent/app-time', appTime);
    router.route('/talent/attendance', records);
    router.route('/talent/adjustments', requests);
    return router;
  });

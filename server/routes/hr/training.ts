import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { authorizeAction } from '../../providers/hr/authorize.js';
import { bool as isTrue } from '../../providers/hr/platform.js';
import { HrError, isRecord, str } from '../../providers/hr/shared.js';
import {
  pathServiceToken,
  planServiceToken,
  platformToken,
  practiceServiceToken,
  sessionServiceToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * Training operations (V2 step 5) under `/api/talent`: learning paths,
 * offline sessions and check-in, practice scenarios and practice
 * conversations, and learning plans. Every prefix authenticates and installs
 * the authorization context itself; each service authorizes its business
 * action. The learner-facing additions under `/learning`, `/assignments` and
 * `/people` live in the learning router, which owns those prefixes.
 */
export const trainingApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const paths = app.container.resolve(pathServiceToken);
    const sessions = app.container.resolve(sessionServiceToken);
    const practice = app.container.resolve(practiceServiceToken);
    const plans = app.container.resolve(planServiceToken);
    const platform = app.container.resolve(platformToken);

    const routes = new Hono<HrEnv>();
    for (const prefix of [
      '/paths',
      '/sessions',
      '/check-in',
      '/practice-scenarios',
      '/practice',
      '/learning-plans',
    ]) {
      for (const path of [prefix, `${prefix}/*`])
        routes.use(
          path,
          auth.required(),
          bodyLimit({ maxSize: 256 * 1024 }),
          authz.middleware(),
        );
    }
    installErrorHandler(routes);

    const flag = (value: unknown, field: string): boolean => {
      if (!isRecord(value) || typeof value[field] !== 'boolean')
        throw new HrError('INVALID_INPUT', 400);
      return value[field];
    };

    // ---------- Learning paths ----------
    routes.get('/paths', async (c) =>
      c.json({
        data: await paths.listPaths(actor(c), {
          q: c.req.query('q') || undefined,
        }),
      }),
    );
    // What a path step may reference, with whether it is ready to be published.
    routes.get('/paths/step-options', async (c) => {
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.learningPath', 'manage');
      const query = platform.database.query();
      const courses = await query
        .selectFrom('courses')
        .select(['id', 'title', 'published', 'active', 'deliveryMode'])
        .where('active', '=', true)
        .execute();
      const exams = await query
        .selectFrom('exams')
        .select(['id', 'title', 'published', 'active'])
        .where('active', '=', true)
        .execute();
      const scenarios = await query
        .selectFrom('practiceScenarios')
        .select(['id', 'title', 'reviewStatus', 'active'])
        .where('active', '=', true)
        .execute();
      return c.json({
        data: {
          courses: courses.map((r) => ({
            id: str(r.id),
            title: str(r.title),
            ready: isTrue(r.published),
            deliveryMode: r.deliveryMode === 'offline' ? 'offline' : 'online',
          })),
          exams: exams.map((r) => ({
            id: str(r.id),
            title: str(r.title),
            ready: isTrue(r.published),
          })),
          scenarios: scenarios.map((r) => ({
            id: str(r.id),
            title: str(r.title),
            ready: r.reviewStatus === 'confirmed',
          })),
        },
      });
    });
    routes.post('/paths', async (c) =>
      c.json(
        { data: await paths.savePath(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.get('/paths/:id', async (c) =>
      c.json({ data: await paths.getPath(actor(c), c.req.param('id')) }),
    );
    routes.patch('/paths/:id', async (c) =>
      c.json({
        data: await paths.savePath(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/paths/:id/publish', async (c) =>
      c.json({
        data: await paths.publishPath(
          actor(c),
          c.req.param('id'),
          flag(await readJson(c), 'published'),
        ),
      }),
    );
    routes.post('/paths/:id/active', async (c) =>
      c.json({
        data: await paths.setPathActive(
          actor(c),
          c.req.param('id'),
          flag(await readJson(c), 'active'),
        ),
      }),
    );

    // ---------- Offline sessions ----------
    routes.get('/sessions', async (c) =>
      c.json({
        data: await sessions.listSessions(actor(c), {
          courseId: c.req.query('courseId') || undefined,
          from: c.req.query('from') || undefined,
          to: c.req.query('to') || undefined,
        }),
      }),
    );
    // Offline courses a session can be scheduled for, and the people who can teach.
    routes.get('/sessions/options', async (c) => {
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.trainingSession', 'manage');
      const query = platform.database.query();
      const courses = await query
        .selectFrom('courses')
        .select(['id', 'title', 'published', 'active'])
        .where('deliveryMode', '=', 'offline')
        .execute();
      const people = await query
        .selectFrom('employees')
        .select(['userId', 'name', 'employeeNo'])
        .where('userId', 'is not', null)
        .where('status', '!=', 'leave')
        .orderBy('employeeNo', 'asc')
        .execute();
      return c.json({
        data: {
          courses: courses
            .filter((r) => isTrue(r.published) && isTrue(r.active))
            .map((r) => ({ id: str(r.id), title: str(r.title) })),
          instructors: people.map((p) => ({
            userId: str(p.userId),
            name: str(p.name),
            employeeNo: str(p.employeeNo),
          })),
        },
      });
    });
    routes.post('/sessions', async (c) =>
      c.json(
        { data: await sessions.saveSession(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.get('/sessions/:id', async (c) =>
      c.json({ data: await sessions.getSession(actor(c), c.req.param('id')) }),
    );
    routes.patch('/sessions/:id', async (c) =>
      c.json({
        data: await sessions.saveSession(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/sessions/:id/cancel', async (c) =>
      c.json({
        data: await sessions.cancelSession(actor(c), c.req.param('id')),
      }),
    );
    const employeeOf = async (c: Context<HrEnv>) => {
      const body: unknown = await c.req.json().catch(() => ({}));
      return isRecord(body) &&
        typeof body.employeeId === 'string' &&
        body.employeeId
        ? body.employeeId
        : undefined;
    };
    routes.post('/sessions/:id/enroll', async (c) =>
      c.json({
        data: await sessions.enroll(
          actor(c),
          c.req.param('id'),
          await employeeOf(c),
        ),
      }),
    );
    routes.post('/sessions/:id/unenroll', async (c) =>
      c.json({
        data: await sessions.cancelEnrollment(
          actor(c),
          c.req.param('id'),
          await employeeOf(c),
        ),
      }),
    );
    routes.get('/sessions/:id/check-in-code', async (c) =>
      c.json({ data: await sessions.checkInCode(actor(c), c.req.param('id')) }),
    );
    routes.post('/sessions/:id/attendance', async (c) =>
      c.json({
        data: await sessions.markAttendance(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.get('/sessions/:id/export', async (c) => {
      const file = await sessions.exportAttendance(actor(c), c.req.param('id'));
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': `attachment; filename="${file.filename}"`,
        },
      });
    });
    // The time recorded is the server's; any time in the body is ignored.
    routes.post('/check-in', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || typeof body.code !== 'string')
        throw new HrError('CHECK_IN_CODE_INVALID', 400);
      return c.json({ data: await sessions.checkIn(actor(c), body.code) });
    });

    // ---------- Practice scenarios ----------
    routes.get('/practice-scenarios', async (c) =>
      c.json({
        data: await practice.listScenarios(actor(c), {
          review: c.req.query('review') || undefined,
        }),
      }),
    );
    routes.post('/practice-scenarios', async (c) =>
      c.json(
        {
          data: await practice.saveScenario(actor(c), null, await readJson(c)),
        },
        201,
      ),
    );
    routes.get('/practice-scenarios/:id', async (c) =>
      c.json({ data: await practice.getScenario(actor(c), c.req.param('id')) }),
    );
    routes.patch('/practice-scenarios/:id', async (c) =>
      c.json({
        data: await practice.saveScenario(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/practice-scenarios/:id/confirm', async (c) =>
      c.json({
        data: await practice.confirmScenario(actor(c), c.req.param('id')),
      }),
    );
    routes.delete('/practice-scenarios/:id', async (c) => {
      await practice.discardScenario(actor(c), c.req.param('id'));
      return c.json({ data: { discarded: true } });
    });
    routes.post('/practice-scenarios/:id/active', async (c) =>
      c.json({
        data: await practice.setScenarioActive(
          actor(c),
          c.req.param('id'),
          flag(await readJson(c), 'active'),
        ),
      }),
    );

    // ---------- Practice ----------
    routes.post('/practice', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || typeof body.scenarioId !== 'string')
        throw new HrError('INVALID_INPUT', 400);
      return c.json(
        {
          data: await practice.start(actor(c), body.scenarioId, {
            assignmentId:
              typeof body.assignmentId === 'string'
                ? body.assignmentId
                : undefined,
            rehearsal: body.rehearsal === true,
          }),
        },
        201,
      );
    });
    routes.get('/practice/:id', async (c) =>
      c.json({ data: await practice.get(actor(c), c.req.param('id')) }),
    );
    routes.post('/practice/:id/reply', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || typeof body.text !== 'string')
        throw new HrError('PRACTICE_REPLY_INVALID', 400);
      return c.json({
        data: await practice.reply(actor(c), c.req.param('id'), body.text),
      });
    });
    routes.post('/practice/:id/finish', async (c) =>
      c.json({ data: await practice.finish(actor(c), c.req.param('id')) }),
    );

    // ---------- Learning plans ----------
    routes.get('/learning-plans', async (c) =>
      c.json({
        data: await plans.listPlans(actor(c), {
          status: c.req.query('status') || undefined,
          mine: c.req.query('mine') === 'true',
        }),
      }),
    );
    routes.get('/learning-plans/:id', async (c) =>
      c.json({ data: await plans.getPlan(actor(c), c.req.param('id')) }),
    );
    routes.post('/learning-plans/:id/approve', async (c) =>
      c.json({
        data: await plans.approve(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/learning-plans/:id/reject', async (c) =>
      c.json({
        data: await plans.reject(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );

    const router = new Hono();
    router.route('/talent', routes);
    return router;
  });

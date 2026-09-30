/**
 * V4-12 绩效 endpoints under /api/talent/performance. The router
 * authenticates, installs the authorization context and limits bodies on its
 * own paths; every service call then authorizes its own talent.* action
 * (talent.reviewScheme, talent.reviewCycle, talent.goal, talent.review,
 * talent.calibration, talent.reviewAppeal, talent.reviewResultRating,
 * talent.performanceAssistant) and checks the record relation.
 */
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { authorizeAction } from '../../providers/hr/authorize.js';
import { HrError, str } from '../../providers/hr/shared.js';
import { performanceServicesToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

export const performanceRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const services = () => app.container.resolve(performanceServicesToken);

    const r = new Hono<HrEnv>();
    r.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 262_144 }),
    );
    installErrorHandler(r);

    const param = (value: string | undefined) => {
      if (!value) throw new HrError('NOT_FOUND', 404);
      return value;
    };

    // ---- 考核方案 ----
    r.get('/schemes', async (c) =>
      c.json({ data: await services().schemes.list(actor(c)) }),
    );
    r.post('/schemes', async (c) =>
      c.json(
        { data: await services().schemes.create(actor(c), await readJson(c)) },
        201,
      ),
    );
    r.get('/schemes/:id', async (c) =>
      c.json({
        data: await services().schemes.get(actor(c), param(c.req.param('id'))),
      }),
    );
    r.put('/schemes/:id', async (c) =>
      c.json({
        data: await services().schemes.update(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.put('/schemes/:id/coefficients', async (c) =>
      c.json({
        data: await services().schemes.setCoefficients(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.get('/schemes/:id/rules', async (c) =>
      c.json({
        data: await services().schemes.rules(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );

    // ---- 默认规则 ----
    r.get('/settings', async (c) =>
      c.json({ data: await services().readSettings(actor(c)) }),
    );
    r.put('/settings', async (c) =>
      c.json({
        data: await services().writeSettings(actor(c), await readJson(c)),
      }),
    );

    // ---- 考核周期 ----
    r.get('/cycles', async (c) =>
      c.json({ data: await services().cycles.list(actor(c)) }),
    );
    r.post('/cycles', async (c) =>
      c.json(
        { data: await services().cycles.create(actor(c), await readJson(c)) },
        201,
      ),
    );
    r.post('/cycles/preview', async (c) =>
      c.json({
        data: await services().cycles.preview(actor(c), await readJson(c)),
      }),
    );
    r.get('/cycles/:id', async (c) =>
      c.json({
        data: await services().cycles.detail(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.patch('/cycles/:id', async (c) =>
      c.json({
        data: await services().cycles.update(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/cycles/:id/advance', async (c) =>
      c.json({
        data: await services().cycles.advance(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/cycles/:id/remind', async (c) =>
      c.json({
        data: await services().cycles.remind(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.get('/cycles/:id/stats', async (c) =>
      c.json({
        data: await services().cycles.stats(
          actor(c),
          param(c.req.param('id')),
          {
            departmentId: c.req.query('departmentId') || undefined,
          },
        ),
      }),
    );
    r.post('/cycles/:id/refresh-snapshots', async (c) =>
      c.json({
        data: await services().refreshSnapshots(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.get('/cycles/:id/appeals', async (c) =>
      c.json({
        data: await services().results.appeals(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.get('/cycles/:id/calibration', async (c) =>
      c.json({
        data: await services().results.calibration(
          actor(c),
          param(c.req.param('id')),
          {
            departmentId: c.req.query('departmentId') || undefined,
            schemeId: c.req.query('schemeId') || undefined,
          },
        ),
      }),
    );
    r.get('/cycles/:id/anomalies', async (c) => {
      const caller = actor(c);
      await authorizeAction(caller.authz, 'talent.calibration', 'view');
      const view = await services().results.calibration(
        caller,
        param(c.req.param('id')),
        {
          departmentId: c.req.query('departmentId') || undefined,
        },
      );
      return c.json({
        data: view.results
          .filter((row) => row.anomalies.length)
          .map((row) => ({
            resultId: row.resultId,
            name: row.name,
            anomalies: row.anomalies,
          })),
      });
    });
    r.post('/cycles/:id/publish', async (c) =>
      c.json({
        data: await services().results.publish(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );

    // ---- 考核结果 ----
    r.patch('/results/:id/scheme', async (c) =>
      c.json({
        data: await services().cycles.setScheme(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/results/:id/close', async (c) =>
      c.json({
        data: await services().results.close(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.post('/results/:id/adjust', async (c) =>
      c.json({
        data: await services().results.adjust(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/results/:id/peers', async (c) =>
      c.json({
        data: await services().reviews.confirmPeers(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.get('/results/:id/reviews', async (c) =>
      c.json({
        data: await services().reviews.resultReviews(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.post('/results/:id/acknowledge', async (c) =>
      c.json({
        data: await services().results.acknowledge(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.post('/results/:id/appeal', async (c) =>
      c.json({
        data: await services().results.appeal(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/results/:id/appeal/handle', async (c) =>
      c.json({
        data: await services().results.handleAppeal(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );

    // ---- 我的考核 ----
    r.get('/me', async (c) => c.json({ data: await services().me(actor(c)) }));
    r.get('/me/results', async (c) =>
      c.json({ data: await services().results.mine(actor(c)) }),
    );
    r.get('/me/tasks', async (c) =>
      c.json({ data: await services().reviews.myTasks(actor(c)) }),
    );
    r.get('/me/goals', async (c) =>
      c.json({
        data: await services().goals.mine(
          actor(c),
          param(c.req.query('cycleId')),
        ),
      }),
    );
    r.get('/me/peer-candidates', async (c) =>
      c.json({
        data: await services().reviews.peerCandidates(
          actor(c),
          param(c.req.query('cycleId')),
        ),
      }),
    );
    r.post('/me/peers', async (c) => {
      const body = (await readJson(c)) as {
        cycleId?: unknown;
        userIds?: unknown;
      };
      return c.json({
        data: await services().reviews.nominatePeers(
          actor(c),
          str(body.cycleId ?? ''),
          {
            userIds: body.userIds,
          },
        ),
      });
    });

    // ---- 目标 ----
    r.post('/goals', async (c) =>
      c.json(
        { data: await services().goals.create(actor(c), await readJson(c)) },
        201,
      ),
    );
    r.post('/goals/submit', async (c) => {
      const body = (await readJson(c)) as { cycleId?: unknown };
      return c.json({
        data: await services().goals.submit(actor(c), str(body.cycleId ?? '')),
      });
    });
    r.post('/goals/department', async (c) =>
      c.json(
        {
          data: await services().goals.createDepartmentGoal(
            actor(c),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    r.get('/goals/team', async (c) =>
      c.json({
        data: await services().goals.team(
          actor(c),
          param(c.req.query('cycleId')),
        ),
      }),
    );
    r.patch('/goals/:id', async (c) =>
      c.json({
        data: await services().goals.update(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/goals/:id/cancel', async (c) =>
      c.json({
        data: await services().goals.cancel(actor(c), param(c.req.param('id'))),
      }),
    );
    r.post('/goals/:id/decide', async (c) =>
      c.json({
        data: await services().goals.decide(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/goals/:id/progress', async (c) =>
      c.json({
        data: await services().goals.progress(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );

    // ---- 评价 ----
    r.get('/reviews/:id', async (c) =>
      c.json({
        data: await services().reviews.context(
          actor(c),
          param(c.req.param('id')),
        ),
      }),
    );
    r.put('/reviews/:id', async (c) =>
      c.json({
        data: await services().reviews.save(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/reviews/:id/submit', async (c) =>
      c.json({
        data: await services().reviews.submit(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/reviews/:id/preview', async (c) =>
      c.json({
        data: await services().reviews.preview(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    r.post('/reviews/:id/activity', async (c) =>
      c.json({
        data: await services().reviews.activity(
          actor(c),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );

    // ---- 团队考核 ----
    r.get('/team', async (c) =>
      c.json({
        data: await services().reviews.team(
          actor(c),
          param(c.req.query('cycleId')),
        ),
      }),
    );
    r.get('/team/cycles', async (c) => {
      const caller = actor(c);
      await authorizeAction(caller.authz, 'talent.review', 'view');
      const ctx = services().context;
      const rows = await ctx.database
        .query()
        .selectFrom('reviewResults')
        .select(['cycleId', 'managerUserId', 'skipLevelUserId'])
        .execute();
      const ids = [
        ...new Set(
          rows
            .filter(
              (row) =>
                str(row.managerUserId) === caller.userId ||
                (row.skipLevelUserId &&
                  str(row.skipLevelUserId) === caller.userId),
            )
            .map((row) => str(row.cycleId)),
        ),
      ];
      const cycles = [];
      for (const id of ids) {
        const cycle = await ctx.cycle(id);
        cycles.push({
          id: cycle.id,
          title: cycle.title,
          status: cycle.status,
          periodEnd: cycle.periodEnd,
        });
      }
      return c.json({
        data: cycles.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)),
      });
    });

    // ---- 员工详情 · 绩效 ----
    r.get('/employees/:employeeId/history', async (c) =>
      c.json({
        data: await services().results.history(
          actor(c),
          param(c.req.param('employeeId')),
        ),
      }),
    );

    // ---- 与薪酬的衔接 (talent.reviewResultRating) ----
    r.get('/ratings', async (c) =>
      c.json({
        data: await services().payroll.ratings(actor(c), {
          cycleId: c.req.query('cycleId') || undefined,
          employeeId: c.req.query('employeeId') || undefined,
        }),
      }),
    );
    r.get('/bonus-cycles', async (c) =>
      c.json({ data: await services().payroll.bonusCycles(actor(c)) }),
    );

    // ---- 每日任务（手动） ----
    r.post('/tasks/daily/run', async (c) =>
      c.json({ data: await services().runDailyNow(actor(c)) }),
    );

    const router = new Hono();
    router.route('/talent/performance', r);
    return router;
  });

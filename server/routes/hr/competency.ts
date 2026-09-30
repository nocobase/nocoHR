import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { HrError } from '../../providers/hr/shared.js';
import { competencyServiceToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/** Assessment import files are small spreadsheets. */
const IMPORT_LIMIT = 5 * 1024 * 1024;

async function readUpload(c: Context<HrEnv>): Promise<Uint8Array> {
  let body: FormData;
  try {
    body = await c.req.formData();
  } catch {
    throw new HrError('INVALID_FILE', 400);
  }
  const file = body.get('file');
  if (!(file instanceof File) || file.size === 0)
    throw new HrError('INVALID_FILE', 400);
  if (file.size > IMPORT_LIMIT) throw new HrError('BODY_TOO_LARGE', 400);
  return new Uint8Array(await file.arrayBuffer());
}

/**
 * V3-08 能力体系 under `/api/talent/competency`: the 能力 Tab (gaps and
 * target-position gaps), assessments with their to-dos, 发展目标岗位,
 * 评定导入, 岗位说明书 and the reference block on transfers and promotions.
 * Every path authenticates; each service call authorizes its own action.
 */
export const competencyApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const competency = app.container.resolve(competencyServiceToken);

    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      auth.required(),
      bodyLimit({ maxSize: IMPORT_LIMIT + 64 * 1024 }),
      authz.middleware(),
    );
    installErrorHandler(routes);

    routes.get('/employees/:id', async (c) =>
      c.json({
        data: await competency.employeeView(actor(c), c.req.param('id')),
      }),
    );
    // The assessor is always the signed-in user: a body `assessedBy` is ignored by the rule.
    routes.post('/employees/:id/assessments', async (c) =>
      c.json(
        {
          data: await competency.assess(
            actor(c),
            c.req.param('id'),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.get('/gap', async (c) => {
      const employeeId = c.req.query('employeeId');
      const positionId = c.req.query('positionId');
      if (!employeeId || !positionId) throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await competency.positionGap(actor(c), employeeId, positionId),
      });
    });
    routes.get('/actions/:id/gap', async (c) =>
      c.json({ data: await competency.actionGap(actor(c), c.req.param('id')) }),
    );

    // ---------- 发展目标岗位 ----------
    routes.get('/positions/:id/candidates', async (c) =>
      c.json({
        data: await competency.listCandidates(actor(c), c.req.param('id')),
      }),
    );
    routes.post('/targets', async (c) =>
      c.json(
        { data: await competency.setTarget(actor(c), await readJson(c)) },
        201,
      ),
    );
    routes.post('/targets/:id/cancel', async (c) =>
      c.json({
        data: await competency.cancelTarget(actor(c), c.req.param('id')),
      }),
    );

    // ---------- 岗位说明书 ----------
    routes.post('/positions/:id/jd', async (c) =>
      c.json({
        data: await competency.attachJobDescription(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );

    // ---------- 评定导入 ----------
    routes.get('/assessments/import/template', async (c) => {
      // Only importers download the template.
      await competency.authorizeImport(actor(c));
      const bytes = competency.importTemplate();
      return c.body(new Uint8Array(bytes), 200, {
        'content-type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('能力评定导入模板.xlsx')}`,
      });
    });
    routes.post('/assessments/import/preview', async (c) =>
      c.json({
        data: await competency.previewImport(actor(c), await readUpload(c)),
      }),
    );
    routes.post('/assessments/import', async (c) =>
      c.json(
        { data: await competency.commitImport(actor(c), await readUpload(c)) },
        201,
      ),
    );

    const router = new Hono();
    router.route('/talent/competency', routes);
    return router;
  });

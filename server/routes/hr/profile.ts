/**
 * V3-11 画像、联动与内容维护: business data (the integration push, Excel
 * import, matching and rules), 待我决定, profile summaries and the timeline,
 * finding people, the team dashboard, audit exports and revisions.
 *
 * Every path authenticates and installs the authorization context in its own
 * sub-router; each service call authorizes its own business action. The push
 * `POST /api/talent/signals:ingest` takes an API key bound to the integration
 * account, whose only permission is `talent.signal.ingest`.
 */
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { ApiKeyService } from '@nocobase/app-plugin-api-keys/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { authorizeAction, policyOf } from '../../providers/hr/authorize.js';
import {
  AIUnavailableError,
  createAIRunner,
} from '../../providers/hr/ai-runner.js';
import { HrError, isRecord, str } from '../../providers/hr/shared.js';
import {
  profileServicesToken,
  revisionServiceToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';
import { z } from 'zod';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function download(
  c: Context<HrEnv>,
  bytes: Uint8Array,
  fileName: string,
  type: string,
) {
  return c.body(new Uint8Array(bytes), 200, {
    'content-type': type,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
  });
}

export const profileApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const profile = () => app.container.resolve(profileServicesToken);
    const revisions = () => app.container.resolve(revisionServiceToken);
    const sub = (maxSize = 256 * 1024) => {
      const router = new Hono<HrEnv>();
      router.use(
        '*',
        auth.required(),
        authz.middleware(),
        bodyLimit({ maxSize }),
      );
      installErrorHandler(router);
      return router;
    };

    const router = new Hono();

    // ---------- 业务数据 ----------
    // `signals:ingest` is one path segment; the colon is literal. Its guard covers that path only.
    const ingest = new Hono<HrEnv>();
    ingest.use(
      '/:action{signals:ingest}',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 4 * 1024 * 1024 }),
    );
    installErrorHandler(ingest);
    ingest.post('/:action{signals:ingest}', async (c) =>
      c.json({
        data: await profile().signals.ingest(actor(c), await readJson(c)),
      }),
    );
    router.route('/talent', ingest);

    const signals = sub(10 * 1024 * 1024);
    signals.get('/', async (c) =>
      c.json({ data: await profile().signals.list(actor(c), c.req.query()) }),
    );
    signals.get('/export', async (c) =>
      download(
        c,
        await profile().signals.exportFile(actor(c), c.req.query()),
        `business-signals-${new Date().toISOString().slice(0, 10)}.xlsx`,
        XLSX_TYPE,
      ),
    );
    signals.get('/import/template', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.signal', 'import');
      return download(
        c,
        profile().signals.importTemplate(),
        '业务数据导入模板.xlsx',
        XLSX_TYPE,
      );
    });
    signals.post('/import', async (c) => {
      const body = await c.req.parseBody();
      if (!(body.file instanceof File))
        throw new HrError('IMPORT_FILE_REQUIRED', 400);
      return c.json({
        data: await profile().signals.importFile(
          actor(c),
          new Uint8Array(await body.file.arrayBuffer()),
        ),
      });
    });
    signals.get('/writeback-failures', async (c) => {
      try {
        return c.json({
          data: await profile().decisions.failedWritebacks(actor(c)),
        });
      } catch (error) {
        if (error instanceof HrError && error.status === 403)
          return c.json({ data: [] });
        throw error;
      }
    });
    /** Development only: issues the integration account's API key once, for the demo. */
    signals.post('/integration-key', async (c) => {
      if (process.env.NODE_ENV === 'production')
        throw new HrError('NOT_FOUND', 404);
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.signal', 'manageRules');
      const users = await app.container
        .resolve(
          (await import('@nocobase/app-plugin-authentication'))
            .userAdministrationServiceToken,
        )
        .list({ search: 'integration_qms', pageSize: 5 });
      const user = users.items.find((u) => u.username === 'integration_qms');
      if (!user) throw new HrError('INTEGRATION_ACCOUNT_MISSING', 404);
      const service = new ApiKeyService(auth, 'default');
      const created = await service.create({
        userId: user.id,
        name: `qms-${new Date().toISOString().slice(0, 10)}`,
      });
      return c.json({ data: { key: created.secret, id: created.key.id } });
    });
    signals.get('/:id', async (c) =>
      c.json({
        data: await profile().signals.get(actor(c), c.req.param('id')),
      }),
    );
    signals.post('/:id/match', async (c) =>
      c.json({
        data: await profile().signals.assignPerson(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    signals.post('/:id/ignore', async (c) =>
      c.json({
        data: await profile().signals.ignore(actor(c), c.req.param('id')),
      }),
    );
    router.route('/talent/signals', signals);

    const rules = sub();
    rules.get('/', async (c) =>
      c.json({ data: await profile().signals.listRules(actor(c)) }),
    );
    rules.post('/', async (c) =>
      c.json(
        { data: await profile().signals.saveRule(actor(c), await readJson(c)) },
        201,
      ),
    );
    rules.post('/:id/confirm', async (c) =>
      c.json({
        data: await profile().signals.confirmRule(
          actor(c),
          c.req.param('id'),
          await readJson(c).catch(() => ({})),
        ),
      }),
    );
    router.route('/talent/signal-rules', rules);

    // ---------- 待我决定 ----------
    const decisions = sub();
    decisions.get('/counts', async (c) =>
      c.json({ data: await profile().decisions.counts(actor(c)) }),
    );
    router.route('/talent/decisions', decisions);

    const suggestions = sub();
    suggestions.get('/', async (c) =>
      c.json({
        data: await profile().decisions.listSuggestions(actor(c), {
          status: c.req.query('status') || undefined,
        }),
      }),
    );
    suggestions.post('/:id/accept', async (c) =>
      c.json({
        data: await profile().decisions.acceptSuggestion(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    suggestions.post('/:id/reject', async (c) =>
      c.json({
        data: await profile().decisions.rejectSuggestion(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    router.route('/talent/competency-suggestions', suggestions);

    const recommendations = sub();
    recommendations.get('/', async (c) =>
      c.json({
        data: await profile().decisions.listRecommendations(actor(c), {
          status: c.req.query('status') || undefined,
        }),
      }),
    );
    recommendations.post('/:id/approve', async (c) =>
      c.json({
        data: await profile().decisions.approve(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    recommendations.post('/:id/reject', async (c) =>
      c.json({
        data: await profile().decisions.rejectRecommendation(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    recommendations.post('/:id/retry-writeback', async (c) =>
      c.json({
        data: await profile().decisions.retryWriteback(
          actor(c),
          c.req.param('id'),
        ),
      }),
    );
    recommendations.get('/:id/proof', async (c) => {
      const file = await profile().decisions.proof(actor(c), c.req.param('id'));
      return download(c, file.bytes, file.filename, 'application/pdf');
    });
    router.route('/talent/training-recommendations', recommendations);

    // ---------- 画像 ----------
    const profiles = sub();
    const ownId = async (c: Context<HrEnv>, id: string) => {
      if (id !== 'me') return id;
      const { platformToken } = await import('../../providers/hr/tokens.js');
      const own = await app.container
        .resolve(platformToken)
        .employeeOfUser(actor(c).userId);
      if (!own) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      return own.id;
    };
    profiles.get('/:employeeId/summary', async (c) =>
      c.json({
        data: await profile().insights.summary(
          actor(c),
          await ownId(c, c.req.param('employeeId')),
        ),
      }),
    );
    profiles.post('/:employeeId/summary/regenerate', async (c) => {
      const ctx = actor(c);
      const employee = await profile().insights.assertRegenerate(
        ctx,
        await ownId(c, c.req.param('employeeId')),
      );
      await profile().analyst.regenerateSummary(ctx.userId, employee.id);
      return c.json({
        data: await profile().insights.summary(ctx, employee.id),
      });
    });
    profiles.get('/:employeeId/timeline', async (c) =>
      c.json({
        data: await profile().insights.timeline(
          actor(c),
          await ownId(c, c.req.param('employeeId')),
        ),
      }),
    );
    router.route('/talent/profiles', profiles);

    // ---------- 找人 ----------
    const find = sub();
    find.get('/lookups', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.findPeople', 'use');
      return c.json({ data: await profile().insights.lookups() });
    });
    /** A sentence to conditions: the analyst's reading when a model is available, the rule parser otherwise. */
    find.post('/parse', async (c) => {
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.findPeople', 'use');
      const body = await readJson(c);
      const text =
        isRecord(body) && typeof body.text === 'string'
          ? body.text.slice(0, 500)
          : '';
      if (!text.trim()) throw new HrError('FIND_TEXT_REQUIRED', 400);
      const insights = profile().insights;
      let conditions = await insights.parseRules(text);
      let parsedBy: 'ai' | 'rules' = 'rules';
      try {
        const lookups = await insights.lookups();
        const { data } = await createAIRunner(app.container).structured({
          employee: 'talentAnalyst',
          userId: ctx.userId,
          title: '找人 · 解析条件',
          prompt: `把这句话转成结构化找人条件，只能使用下列清单中的 id：${JSON.stringify({ text, ...lookups })}`,
          schema: z.object({
            departmentIds: z.array(z.string()),
            positionIds: z.array(z.string()),
            certifications: z.array(
              z.object({
                certificationId: z.string(),
                status: z.enum(['valid', 'any']),
              }),
            ),
            competencies: z.array(
              z.object({
                competencyId: z.string(),
                minLevel: z.number().int().nullable(),
                maxLevel: z.number().int().nullable(),
              }),
            ),
            signals: z
              .object({
                mode: z.enum(['none', 'some']),
                types: z.array(z.string()),
                withinDays: z.number().int(),
              })
              .nullable(),
            activeOnly: z.boolean(),
          }),
          timeZone: 'Asia/Shanghai',
          unattended: false,
        });
        conditions = await insights.cleanConditions(data);
        parsedBy = 'ai';
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
      }
      return c.json({
        data: { ...(await insights.search(ctx, conditions)), parsedBy },
      });
    });
    find.post('/search', async (c) => {
      const body = await readJson(c);
      const insights = profile().insights;
      return c.json({
        data: await insights.search(
          actor(c),
          await insights.cleanConditions(
            isRecord(body) ? body.conditions : null,
          ),
        ),
      });
    });
    router.route('/talent/find-people', find);

    // ---------- 团队看板 ----------
    const dashboard = sub();
    dashboard.get('/', async (c) =>
      c.json({
        data: await profile().insights.dashboard(actor(c), {
          departmentId: c.req.query('departmentId') || undefined,
        }),
      }),
    );
    dashboard.get('/export', async (c) =>
      download(
        c,
        await profile().insights.dashboardExport(actor(c), {
          departmentId: c.req.query('departmentId') || undefined,
        }),
        `team-dashboard-${new Date().toISOString().slice(0, 10)}.xlsx`,
        XLSX_TYPE,
      ),
    );
    router.route('/talent/team-dashboard', dashboard);

    // ---------- 审计导出 ----------
    const audit = sub();
    const scopeOf = async (c: Context<HrEnv>) => {
      const body = await readJson(c);
      return profile().audit.resolveScope(isRecord(body) ? body : {});
    };
    audit.get('/log', async (c) =>
      c.json({ data: await profile().audit.log(actor(c)) }),
    );
    audit.get('/options', async (c) => {
      const ctx = actor(c);
      const policies = await authorizeAction(
        ctx.authz,
        'talent.audit',
        'exportTrainingFile',
      );
      const { databaseManagerToken } = await import('@nocobase/db');
      const database = app.container.resolve(databaseManagerToken);
      const employees = (await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({ sort: (s) => [s.field('employeeNo').asc()] })) as Record<
        string,
        unknown
      >[];
      const insights = profile().insights;
      const lookups = await insights.lookups();
      return c.json({
        data: {
          employees: employees
            .filter((e) => e.status !== 'leave')
            .map((e) => ({
              id: str(e.id),
              name: str(e.name),
              employeeNo: str(e.employeeNo ?? ''),
            })),
          departments: lookups.departments,
          positions: lookups.positions,
        },
      });
    });
    audit.get('/employees/:id/training-file', async (c) => {
      const file = await profile().audit.trainingFile(
        actor(c),
        c.req.param('id'),
      );
      return download(c, file.bytes, file.fileName, 'application/pdf');
    });
    audit.get('/proofs', async (c) =>
      c.json({ data: await profile().audit.proofs(actor(c)) }),
    );
    audit.get('/proofs/:id', async (c) => {
      const ctx = actor(c);
      await authorizeAction(
        ctx.authz,
        'talent.audit',
        'exportRecommendationProof',
      );
      const file = await profile().decisions.proof(ctx, c.req.param('id'));
      await profile().audit.logProof(ctx, c.req.param('id'), file.filename);
      return download(c, file.bytes, file.filename, 'application/pdf');
    });
    audit.get('/ledger', async (c) => {
      const file = await profile().audit.ledger(actor(c), {
        departmentIds: c.req.query('departmentId')
          ? [c.req.query('departmentId')!]
          : [],
        positionIds: c.req.query('positionId')
          ? [c.req.query('positionId')!]
          : [],
      });
      return download(c, file.bytes, file.fileName, XLSX_TYPE);
    });
    audit.post('/risks', async (c) => {
      const scope = await scopeOf(c);
      return c.json({
        data: { scope, risks: await profile().audit.risks(actor(c), scope) },
      });
    });
    audit.post('/pack', async (c) => {
      const pack = await profile().audit.pack(actor(c), await scopeOf(c));
      return download(c, pack.bytes, pack.fileName, 'application/zip');
    });
    // Only the caller's own pack, unless their grant reaches every employee (profile/index.ts auditPackFor).
    audit.get('/packs/:fileId', async (c) => {
      const file = await profile().auditPackFor(
        actor(c),
        c.req.param('fileId'),
      );
      return download(c, file.bytes, file.filename, 'application/zip');
    });
    router.route('/talent/audit', audit);

    // ---------- 修订建议 ----------
    const revision = sub();
    revision.get('/', async (c) =>
      c.json({
        data: await revisions().listRevisions(actor(c), {
          documentId: c.req.query('documentId') || undefined,
          status: c.req.query('status') || undefined,
          reason: c.req.query('reason') || undefined,
        }),
      }),
    );
    revision.get('/briefs', async (c) =>
      c.json({ data: await revisions().listBriefs(actor(c)) }),
    );
    revision.patch('/briefs/:courseId', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await revisions().updateBriefDueDays(
          actor(c),
          c.req.param('courseId'),
          isRecord(body) ? body.revisionDueDays : undefined,
        ),
      });
    });
    revision.post('/courses/:courseId/apply', async (c) =>
      c.json({
        data: await revisions().applyCourse(actor(c), c.req.param('courseId')),
      }),
    );
    revision.get('/courses/:courseId/history', async (c) =>
      c.json({
        data: await revisions().courseHistory(
          actor(c),
          c.req.param('courseId'),
        ),
      }),
    );
    /** The knowledge base's view of a version: its note, brief and suggestions. */
    revision.get('/documents/:documentId', async (c) => {
      const ctx = actor(c);
      const documentId = c.req.param('documentId');
      const { databaseManagerToken } = await import('@nocobase/db');
      const database = app.container.resolve(databaseManagerToken);
      const policies = await authorizeAction(
        ctx.authz,
        'talent.kbDocument',
        'view',
      );
      const row = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id: documentId } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const brief = await database
        .query()
        .selectFrom('courses')
        .select(['id', 'title', 'published', 'reviewStatus'])
        .where('briefForDocumentId', '=', documentId)
        .executeTakeFirst();
      const open = await database
        .query()
        .selectFrom('contentRevisions')
        .select(['id', 'status'])
        .where('documentId', '=', documentId)
        .execute();
      const { platformToken } = await import('../../providers/hr/tokens.js');
      const platform = app.container.resolve(platformToken);
      const canRerun =
        Boolean(row.previousVersionId) &&
        row.parseStatus === 'ready' &&
        (await platform.can(ctx, 'talent.kbDocument', 'uploadVersion'));
      return c.json({
        data: {
          documentId,
          changeNote: row.changeNote == null ? null : str(row.changeNote),
          brief: brief
            ? {
                id: str(brief.id),
                title: str(brief.title),
                status:
                  brief.published === true || brief.published === 1
                    ? 'published'
                    : str(brief.reviewStatus),
              }
            : null,
          revisions: {
            total: open.length,
            open: open.filter((r) => r.status === 'open').length,
          },
          affectedEstimate: row.previousVersionId
            ? (await revisions().estimateAffected(documentId)).total
            : null,
          can: {
            viewRevisions: await platform.can(ctx, 'talent.revision', 'view'),
            rerun: canRerun,
            editNote: await platform.can(
              ctx,
              'talent.kbDocument',
              'uploadVersion',
            ),
          },
        },
      });
    });
    revision.patch('/documents/:documentId/change-note', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await revisions().updateChangeNote(
          actor(c),
          c.req.param('documentId'),
          isRecord(body) ? body.changeNote : undefined,
        ),
      });
    });
    /** 重新发起升版修订: HR or the document's owner; an existing brief and open suggestions are not duplicated. */
    revision.post('/documents/:documentId/rerun', async (c) => {
      const ctx = actor(c);
      const documentId = c.req.param('documentId');
      const { databaseManagerToken } = await import('@nocobase/db');
      const policies = await authorizeAction(
        ctx.authz,
        'talent.kbDocument',
        'uploadVersion',
      );
      const row = (await app.container
        .resolve(databaseManagerToken)
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id: documentId } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      if (!row.previousVersionId || row.parseStatus !== 'ready')
        throw new HrError('REVISION_NOT_A_VERSION', 409);
      return c.json({
        data: await profile().analyst.onVersionReady(documentId, 'manual'),
      });
    });
    revision.post('/:id/accept', async (c) =>
      c.json({
        data: await revisions().accept(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    revision.post('/:id/reject', async (c) =>
      c.json({
        data: await revisions().reject(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    router.route('/talent/revisions', revision);

    return router;
  });

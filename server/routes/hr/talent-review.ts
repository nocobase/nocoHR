/**
 * V4-13 人才盘点与其他 endpoints under /api/talent. Every sub-router
 * authenticates, installs the authorization context and limits bodies on its
 * own paths; each service call authorizes its own talent.* action and checks
 * the record scope (talent.talentReview, talent.succession,
 * talent.competencyModel, talent.practical, talent.instructor,
 * talent.trainingEvaluation, talent.knowledgeCandidate, talent.translation,
 * talent.agentClient).
 *
 * `POST /api/talent/knowledge-candidates:ingest` takes the API key of the
 * integration account `integration_ticket` (only knowledgeCandidate.ingest).
 * The 13C MCP endpoint is in agent-mcp.ts.
 */
import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import { driveManagerToken } from '@nocobase/app-server/drive';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { authorizeAction } from '../../providers/hr/authorize.js';
import {
  PRACTICAL_MEDIA_MAX,
  practicalMedia,
  SNIFF_BYTES,
} from '../../providers/hr/hr-files.js';
import { HrError, newId } from '../../providers/hr/shared.js';
import type { ContentType } from '../../providers/hr/talent-review/translations.js';
import { talentReviewServicesToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

export const talentReviewRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const services = () => app.container.resolve(talentReviewServicesToken);
    const sub = (maxSize = 262_144) => {
      const router = new Hono<HrEnv>();
      router.use('*', auth.required(), authz.middleware(), bodyLimit({ maxSize }));
      installErrorHandler(router);
      return router;
    };
    const param = (value: string | undefined) => {
      if (!value) throw new HrError('NOT_FOUND', 404);
      return value;
    };
    const range = (c: { req: { query: (k: string) => string | undefined } }) => ({
      from: c.req.query('from') || undefined,
      to: c.req.query('to') || undefined,
    });
    const router = new Hono();

    // ---------- 人才盘点 ----------
    const reviews = sub();
    reviews.get('/', async (c) => c.json({ data: await services().reviews.list(actor(c)) }));
    reviews.post('/', async (c) =>
      c.json({ data: await services().reviews.create(actor(c), await readJson(c)) }, 201),
    );
    reviews.get('/settings', async (c) =>
      c.json({ data: await services().readSettings(actor(c)) }),
    );
    reviews.put('/settings/:section', async (c) =>
      c.json({
        data: await services().writeSettings(actor(c), param(c.req.param('section')), await readJson(c)),
      }),
    );
    reviews.get('/:id', async (c) =>
      c.json({ data: await services().reviews.detail(actor(c), param(c.req.param('id'))) }),
    );
    reviews.patch('/:id', async (c) =>
      c.json({
        data: await services().reviews.update(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    reviews.post('/:id/advance', async (c) =>
      c.json({ data: await services().reviews.advance(actor(c), param(c.req.param('id'))) }),
    );
    router.route('/talent/talent-reviews', reviews);

    const placements = sub();
    placements.post('/:id/potential', async (c) =>
      c.json({
        data: await services().reviews.assessPotential(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    placements.post('/:id/performance', async (c) =>
      c.json({
        data: await services().reviews.setPerformance(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    placements.post('/:id/move', async (c) =>
      c.json({
        data: await services().reviews.move(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    placements.put('/:id/actions', async (c) =>
      c.json({
        data: await services().reviews.setActions(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    placements.post('/:id/confirm', async (c) =>
      c.json({ data: await services().reviews.confirm(actor(c), param(c.req.param('id'))) }),
    );
    router.route('/talent/talent-placements', placements);

    // ---------- 继任计划 ----------
    const succession = sub();
    succession.get('/', async (c) => c.json({ data: await services().succession.list(actor(c)) }));
    succession.put('/positions/:positionId/key', async (c) =>
      c.json({
        data: await services().succession.markKey(actor(c), param(c.req.param('positionId')), await readJson(c)),
      }),
    );
    succession.get('/:id', async (c) =>
      c.json({ data: await services().succession.detail(actor(c), param(c.req.param('id'))) }),
    );
    succession.put('/:id/candidates', async (c) =>
      c.json({
        data: await services().succession.updateCandidates(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    succession.get('/:id/matches', async (c) => {
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.succession', 'manage');
      const plan = await services().succession.planRow(param(c.req.param('id')));
      return c.json({ data: await services().succession.match(plan.positionId, plan.departmentId) });
    });
    succession.post('/:id/confirm', async (c) =>
      c.json({ data: await services().succession.confirm(actor(c), param(c.req.param('id'))) }),
    );
    router.route('/talent/succession', succession);

    // ---------- 能力模型版本 ----------
    const versions = sub();
    versions.get('/positions/:positionId', async (c) =>
      c.json({ data: await services().versions.list(actor(c), param(c.req.param('positionId'))) }),
    );
    versions.put('/positions/:positionId/draft', async (c) =>
      c.json({
        data: await services().versions.saveDraft(actor(c), param(c.req.param('positionId')), await readJson(c)),
      }),
    );
    versions.get('/positions/:positionId/at', async (c) =>
      c.json({
        data: await services().versions.requirementsAt(
          actor(c),
          param(c.req.param('positionId')),
          c.req.query('date') ?? '',
        ),
      }),
    );
    versions.post('/:id/publish', async (c) =>
      c.json({
        data: await services().versions.publish(actor(c), param(c.req.param('id')), await readJson(c).catch(() => ({}))),
      }),
    );
    versions.delete('/:id', async (c) =>
      c.json({ data: await services().versions.discardDraft(actor(c), param(c.req.param('id'))) }),
    );
    router.route('/talent/model-versions', versions);

    // ---------- 实操考核 ----------
    const practicals = sub(12 * 1024 * 1024);
    practicals.get('/templates', async (c) =>
      c.json({ data: await services().practicals.listTemplates(actor(c)) }),
    );
    practicals.post('/templates', async (c) =>
      c.json({ data: await services().practicals.saveTemplate(actor(c), null, await readJson(c)) }, 201),
    );
    practicals.post('/templates/draft', async (c) =>
      c.json({ data: await services().draftChecklist(actor(c), await readJson(c)) }, 201),
    );
    practicals.put('/templates/:id', async (c) =>
      c.json({
        data: await services().practicals.saveTemplate(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    practicals.post('/templates/:id/confirm', async (c) =>
      c.json({ data: await services().practicals.confirmTemplate(actor(c), param(c.req.param('id'))) }),
    );
    practicals.get('/employees', async (c) =>
      c.json({ data: await services().practicals.assessableEmployees(actor(c)) }),
    );
    practicals.get('/witnesses', async (c) =>
      c.json({ data: await services().practicals.witnessOptions(actor(c)) }),
    );
    practicals.get('/records', async (c) =>
      c.json({
        data: await services().practicals.listRecords(actor(c), {
          employeeId: c.req.query('employeeId') || undefined,
          assessmentId: c.req.query('assessmentId') || undefined,
        }),
      }),
    );
    practicals.post('/records', async (c) =>
      c.json({ data: await services().practicals.start(actor(c), await readJson(c)) }, 201),
    );
    practicals.get('/records/:id', async (c) =>
      c.json({ data: await services().practicals.getRecord(actor(c), param(c.req.param('id'))) }),
    );
    practicals.patch('/records/:id', async (c) =>
      c.json({
        data: await services().practicals.update(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    practicals.post('/records/:id/structure', async (c) =>
      c.json({ data: await services().structureRecord(actor(c), param(c.req.param('id'))) }),
    );
    practicals.post('/records/:id/sign', async (c) =>
      c.json({ data: await services().practicals.sign(actor(c), param(c.req.param('id'))) }),
    );
    practicals.post('/records/:id/witness', async (c) =>
      c.json({ data: await services().practicals.witnessSign(actor(c), param(c.req.param('id'))) }),
    );
    practicals.post('/records/:id/void', async (c) =>
      c.json({
        data: await services().practicals.void(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    /** 拍照: one image or video per request, stored with the file collection (hrFiles). */
    practicals.post('/records/:id/attachments', async (c) => {
      const ctx = actor(c);
      const id = param(c.req.param('id'));
      // Authorize before the upload is stored.
      await services().practicals.update(ctx, id, {});
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) throw new HrError('UPLOAD_FILE_REQUIRED', 400);
      // A size cap before reading, and the content's own first bytes decide the type: JPEG, PNG or MP4.
      if (file.size > PRACTICAL_MEDIA_MAX)
        throw new HrError('UPLOAD_TOO_LARGE', 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength > PRACTICAL_MEDIA_MAX)
        throw new HrError('UPLOAD_TOO_LARGE', 400);
      const media = practicalMedia(bytes.subarray(0, SNIFF_BYTES));
      if (!media) throw new HrError('UPLOAD_TYPE_INVALID', 400);
      const fileId = newId();
      const stem =
        file.name
          .replace(/\.[^.]*$/u, '')
          .replace(/[^\w\-一-龥]/gu, '_')
          .slice(-100) || 'photo';
      const safe = `${stem}.${media.ext}`;
      const key = `hr-files/practicals/${id}/${fileId}.${media.ext}`;
      await app.container.resolve(driveManagerToken).use('local').put(key, bytes);
      const now = new Date();
      await services()
        .context.database.query()
        .insertInto('hrFiles')
        .values({
          id: fileId,
          disk: 'local',
          key,
          filename: safe,
          ext: media.ext,
          mimeType: media.mimeType,
          size: bytes.byteLength,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return c.json({ data: await services().practicals.addAttachment(ctx, id, fileId) }, 201);
    });
    /** 认证项目 · 实操要求 (hr.admin: talent.certification.manage). */
    practicals.get('/certifications/:id', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.certification', 'view');
      return c.json({
        data: await services().practicals.certificationPracticals(param(c.req.param('id'))),
      });
    });
    practicals.put('/certifications/:id', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.certification', 'manage');
      return c.json({
        data: await services().practicals.setCertificationPracticals(param(c.req.param('id')), await readJson(c)),
      });
    });
    router.route('/talent/practicals', practicals);

    // ---------- 讲师 ----------
    const instructors = sub();
    instructors.get('/', async (c) =>
      c.json({ data: await services().instructors.list(actor(c), range(c)) }),
    );
    instructors.post('/', async (c) =>
      c.json({ data: await services().instructors.save(actor(c), null, await readJson(c)) }, 201),
    );
    instructors.get('/accounts', async (c) =>
      c.json({ data: await services().instructors.accountOptions(actor(c)) }),
    );
    instructors.get('/sessions', async (c) =>
      c.json({ data: await services().instructors.sessionOptions(actor(c)) }),
    );
    instructors.put('/sessions/:sessionId', async (c) =>
      c.json({
        data: await services().instructors.assignSession(actor(c), param(c.req.param('sessionId')), await readJson(c)),
      }),
    );
    instructors.get('/:id', async (c) =>
      c.json({ data: await services().instructors.detail(actor(c), param(c.req.param('id')), range(c)) }),
    );
    instructors.put('/:id', async (c) =>
      c.json({
        data: await services().instructors.save(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    router.route('/talent/instructors', instructors);

    // ---------- 培训评估 ----------
    const evaluations = sub();
    evaluations.get('/mine', async (c) =>
      c.json({ data: await services().evaluations.mine(actor(c)) }),
    );
    evaluations.get('/summary', async (c) =>
      c.json({ data: await services().evaluations.summary(actor(c), range(c)) }),
    );
    evaluations.post('/tasks/daily/run', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.trainingEvaluation', 'configure');
      return c.json({ data: await services().evaluations.runDaily() });
    });
    evaluations.get('/:id', async (c) =>
      c.json({ data: await services().evaluations.get(actor(c), param(c.req.param('id'))) }),
    );
    evaluations.post('/:id/submit', async (c) =>
      c.json({
        data: await services().evaluations.submit(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    router.route('/talent/training-evaluations', evaluations);

    // ---------- 知识沉淀 ----------
    const ingest = new Hono<HrEnv>();
    ingest.use(
      '/:action{knowledge-candidates:ingest}',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 4 * 1024 * 1024 }),
    );
    installErrorHandler(ingest);
    ingest.post('/:action{knowledge-candidates:ingest}', async (c) =>
      c.json({ data: await services().knowledge.ingest(actor(c), await readJson(c)) }),
    );
    router.route('/talent', ingest);

    const candidates = sub();
    candidates.get('/', async (c) =>
      c.json({
        data: await services().knowledge.list(actor(c), { status: c.req.query('status') || undefined }),
      }),
    );
    candidates.post('/:id/ignore', async (c) =>
      c.json({ data: await services().knowledge.ignore(actor(c), param(c.req.param('id'))) }),
    );
    candidates.get('/pending-documents', async (c) =>
      c.json({ data: await services().knowledge.pending(actor(c)) }),
    );
    candidates.post('/pending-documents/:id/confirm', async (c) =>
      c.json({ data: await services().knowledge.decide(actor(c), param(c.req.param('id')), 'confirm') }),
    );
    candidates.post('/pending-documents/:id/discard', async (c) =>
      c.json({ data: await services().knowledge.decide(actor(c), param(c.req.param('id')), 'discard') }),
    );
    router.route('/talent/knowledge-candidates', candidates);

    // ---------- 内容多语言 ----------
    const translations = sub(2 * 1024 * 1024);
    const type = (value: string | undefined): ContentType => {
      if (value === 'course' || value === 'question' || value === 'document' || value === 'scenario')
        return value;
      throw new HrError('INVALID_INPUT', 400);
    };
    translations.get('/', async (c) =>
      c.json({ data: await services().translations.list(actor(c)) }),
    );
    translations.post('/:type/:id/request', async (c) =>
      c.json({
        data: await services().translations.request(actor(c), type(c.req.param('type')), param(c.req.param('id'))),
      }),
    );
    translations.get('/:type/:id', async (c) =>
      c.json({
        data: await services().translations.detail(actor(c), type(c.req.param('type')), param(c.req.param('id'))),
      }),
    );
    translations.put('/:type/:id', async (c) =>
      c.json({
        data: await services().translations.save(
          actor(c),
          type(c.req.param('type')),
          param(c.req.param('id')),
          await readJson(c),
        ),
      }),
    );
    translations.post('/:type/:id/confirm', async (c) =>
      c.json({
        data: await services().translations.confirm(actor(c), type(c.req.param('type')), param(c.req.param('id'))),
      }),
    );
    router.route('/talent/translations', translations);

    // ---------- 外部 AI 助手 ----------
    const agents = sub();
    agents.get('/clients', async (c) => c.json({ data: await services().agents.listClients(actor(c)) }));
    agents.post('/clients', async (c) =>
      c.json({ data: await services().agents.saveClient(actor(c), null, await readJson(c)) }, 201),
    );
    agents.put('/clients/:id', async (c) =>
      c.json({
        data: await services().agents.saveClient(actor(c), param(c.req.param('id')), await readJson(c)),
      }),
    );
    agents.get('/logs', async (c) =>
      c.json({
        data: await services().agents.callLogs(actor(c), {
          clientId: c.req.query('clientId') || undefined,
          limit: Number(c.req.query('limit')) || undefined,
        }),
      }),
    );
    agents.get('/tokens', async (c) => c.json({ data: await services().agents.allTokens(actor(c)) }));
    agents.get('/mine', async (c) => c.json({ data: await services().agents.mine(actor(c)) }));
    agents.post('/tokens', async (c) =>
      c.json({ data: await services().agents.issueToken(actor(c), await readJson(c)) }, 201),
    );
    agents.post('/tokens/:id/revoke', async (c) =>
      c.json({ data: await services().agents.revokeToken(actor(c), param(c.req.param('id'))) }),
    );
    router.route('/talent/agent-clients', agents);

    // ---------- 手动触发 (季度、每周任务) ----------
    const tasks = sub();
    tasks.post('/:task/run', async (c) =>
      c.json({ data: await services().runNow(actor(c), param(c.req.param('task'))) }),
    );
    router.route('/talent/talent-review-tasks', tasks);

    return router;
  });

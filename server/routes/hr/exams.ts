import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { HrError, isRecord } from '../../providers/hr/shared.js';
import {
  certificationServiceToken,
  examServiceToken,
} from '../../providers/hr/tokens.js';
import {
  actor,
  installErrorHandler,
  locale,
  readJson,
  type HrEnv,
} from './shared.js';

/**
 * Exams and certification under `/api/talent`: the question bank, exam
 * management and grading, a candidate's attempts, certification programmes
 * and certificates. Every path authenticates and installs the authorization
 * context; each handler's service authorizes its business action.
 */
export const examApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const exams = app.container.resolve(examServiceToken);
    const certifications = app.container.resolve(certificationServiceToken);

    const routes = new Hono<HrEnv>();
    for (const prefix of [
      '/questions',
      '/exams',
      '/my-exams',
      '/attempts',
      '/grading',
      '/certifications',
      '/certificates',
    ]) {
      routes.use(
        prefix,
        auth.required(),
        bodyLimit({ maxSize: 5 * 1024 * 1024 }),
        authz.middleware(),
      );
      routes.use(
        `${prefix}/*`,
        auth.required(),
        bodyLimit({ maxSize: 5 * 1024 * 1024 }),
        authz.middleware(),
      );
    }
    installErrorHandler(routes);

    const flag = (value: unknown, key: string) => {
      if (!isRecord(value) || typeof value[key] !== 'boolean')
        throw new HrError('INVALID_INPUT', 400);
      return value[key];
    };

    // ---------- Question bank ----------
    routes.get('/questions', async (c) =>
      c.json({
        data: await exams.listQuestions(actor(c), {
          type: c.req.query('type') || undefined,
          competencyId: c.req.query('competencyId') || undefined,
          difficulty: c.req.query('difficulty') || undefined,
          status: c.req.query('status') || undefined,
          q: c.req.query('q') || undefined,
          sourceDocumentId: c.req.query('sourceDocumentId') || undefined,
          sourceCourseId: c.req.query('sourceCourseId') || undefined,
          review: c.req.query('review') || undefined,
        }),
      }),
    );
    routes.post('/questions', async (c) =>
      c.json(
        { data: await exams.saveQuestion(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.post('/questions/bulk', async (c) =>
      c.json({ data: await exams.bulkQuestions(actor(c), await readJson(c)) }),
    );
    routes.get('/questions/import-template', () => {
      return new Response(new Uint8Array(exams.importTemplate()), {
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition':
            'attachment; filename="question-import-template.xlsx"',
        },
      });
    });
    routes.post('/questions/import', async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File))
        throw new HrError('IMPORT_FILE_REQUIRED', 400);
      return c.json({
        data: await exams.importQuestions(
          actor(c),
          new Uint8Array(await file.arrayBuffer()),
        ),
      });
    });
    routes.patch('/questions/:id', async (c) =>
      c.json({
        data: await exams.saveQuestion(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );

    // ---------- Exams ----------
    routes.get('/exams', async (c) =>
      c.json({ data: await exams.listExams(actor(c)) }),
    );
    routes.post('/exams', async (c) =>
      c.json(
        { data: await exams.saveExam(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.post('/exams/rule-availability', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await exams.ruleAvailability(
          actor(c),
          isRecord(body) ? body.rules : undefined,
        ),
      });
    });
    routes.get('/exams/:id', async (c) => {
      const exam = await exams.getExam(actor(c), c.req.param('id'));
      if (!exam) throw new HrError('EXAM_NOT_FOUND', 404);
      return c.json({ data: exam });
    });
    routes.patch('/exams/:id', async (c) =>
      c.json({
        data: await exams.saveExam(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/exams/:id/publish', async (c) =>
      c.json({
        data: await exams.publishExam(
          actor(c),
          c.req.param('id'),
          flag(await readJson(c), 'published'),
        ),
      }),
    );
    routes.get('/exams/:id/preview', async (c) =>
      c.json({ data: await exams.previewPaper(actor(c), c.req.param('id')) }),
    );
    routes.get('/exams/:id/candidates', async (c) =>
      c.json({ data: await exams.examCandidates(actor(c), c.req.param('id')) }),
    );
    routes.post('/exams/:id/reset-attempts', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || typeof body.employeeId !== 'string')
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await exams.resetAttempts(
          actor(c),
          c.req.param('id'),
          body.employeeId,
        ),
      });
    });

    // ---------- Grading ----------
    routes.get('/grading', async (c) =>
      c.json({
        data: await exams.listGrading(
          actor(c),
          c.req.query('examId') || undefined,
        ),
      }),
    );
    routes.post('/grading/:attemptId', async (c) =>
      c.json({
        data: await exams.gradeAttempt(
          actor(c),
          c.req.param('attemptId'),
          await readJson(c),
        ),
      }),
    );

    // ---------- A candidate's own exams ----------
    routes.get('/my-exams', async (c) =>
      c.json({ data: await exams.myExams(actor(c)) }),
    );
    routes.post('/my-exams/:examId/start', async (c) =>
      c.json({
        data: await exams.startAttempt(actor(c), c.req.param('examId')),
      }),
    );
    routes.get('/attempts/:id', async (c) =>
      c.json({ data: await exams.getAttempt(actor(c), c.req.param('id')) }),
    );
    routes.put('/attempts/:id/answers', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await exams.saveAnswers(
          actor(c),
          c.req.param('id'),
          isRecord(body) ? body.answers : undefined,
        ),
      });
    });
    routes.post('/attempts/:id/submit', async (c) => {
      const body = await readJson(c).catch(() => ({}));
      return c.json({
        data: await exams.submitAttempt(
          actor(c),
          c.req.param('id'),
          isRecord(body) ? body.answers : undefined,
        ),
      });
    });
    routes.get('/attempts/:id/result', async (c) =>
      c.json({ data: await exams.attemptResult(actor(c), c.req.param('id')) }),
    );

    // ---------- Certifications and certificates ----------
    routes.get('/certifications', async (c) =>
      c.json({ data: await certifications.listCertifications(actor(c)) }),
    );
    routes.post('/certifications', async (c) =>
      c.json(
        {
          data: await certifications.saveCertification(
            actor(c),
            null,
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.get('/certifications/:id', async (c) => {
      const certification = await certifications.getCertification(
        actor(c),
        c.req.param('id'),
      );
      if (!certification) throw new HrError('CERTIFICATION_NOT_FOUND', 404);
      return c.json({ data: certification });
    });
    routes.patch('/certifications/:id', async (c) =>
      c.json({
        data: await certifications.saveCertification(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/certifications/:id/active', async (c) =>
      c.json({
        data: await certifications.setCertificationActive(
          actor(c),
          c.req.param('id'),
          flag(await readJson(c), 'active'),
        ),
      }),
    );
    routes.get('/certificates', async (c) =>
      c.json({
        data: await certifications.listCertificates(actor(c), {
          employeeId: c.req.query('employeeId') || undefined,
          certificationId: c.req.query('certificationId') || undefined,
          status: c.req.query('status') || undefined,
        }),
      }),
    );
    routes.post('/certificates/:id/revoke', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await certifications.revokeCertificate(
          actor(c),
          c.req.param('id'),
          isRecord(body) ? body.reason : undefined,
        ),
      });
    });
    // A printable certificate: the browser prints it or saves it as PDF.
    routes.get('/certificates/:id/document', async (c) =>
      c.html(
        await certifications.certificateDocument(
          actor(c),
          c.req.param('id'),
          locale(c),
        ),
        200,
        { 'cache-control': 'no-store' },
      ),
    );

    const router = new Hono();
    router.route('/talent', routes);
    return router;
  });

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

import { HrError, isRecord } from '../../providers/hr/shared.js';
import {
  knowledgeServiceToken,
  learningServiceToken,
  pathServiceToken,
  practiceServiceToken,
  sessionServiceToken,
  // V4-13
  talentReviewServicesToken,
} from '../../providers/hr/tokens.js';
import {
  actor,
  installErrorHandler,
  locale,
  readJson,
  type HrEnv,
} from './shared.js';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/gu, '_').replace(/["\\]/gu, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Knowledge and learning under `/api/talent`: the knowledge base and its gaps,
 * course management, learning assignments, and a learner's own study. Every
 * path authenticates and installs the authorization context; each handler's
 * service authorizes its business action.
 */
export const learningApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const knowledge = app.container.resolve(knowledgeServiceToken);
    const learning = app.container.resolve(learningServiceToken);
    const paths = app.container.resolve(pathServiceToken);
    const sessions = app.container.resolve(sessionServiceToken);
    const practice = app.container.resolve(practiceServiceToken);

    const routes = new Hono<HrEnv>();
    for (const prefix of [
      '/kb',
      '/courses',
      '/assignments',
      '/learning',
      '/competency-courses',
      '/people',
    ]) {
      routes.use(
        prefix,
        auth.required(),
        bodyLimit({ maxSize: 2 * 1024 * 1024 }),
        authz.middleware(),
      );
      routes.use(
        `${prefix}/*`,
        auth.required(),
        bodyLimit({ maxSize: 2 * 1024 * 1024 }),
        authz.middleware(),
      );
    }
    installErrorHandler(routes);

    const bool = (value: unknown) => {
      if (!isRecord(value) || typeof value.active !== 'boolean')
        throw new HrError('INVALID_INPUT', 400);
      return value.active;
    };

    // ---------- Knowledge base ----------
    routes.get('/kb/documents', async (c) =>
      c.json({
        data: await knowledge.listDocuments(actor(c), {
          q: c.req.query('q') || undefined,
          category: c.req.query('category') || undefined,
          competencyId: c.req.query('competencyId') || undefined,
          parseStatus: c.req.query('parseStatus') || undefined,
        }),
      }),
    );
    routes.post('/kb/documents', async (c) =>
      c.json(
        { data: await knowledge.createDocument(actor(c), await readJson(c)) },
        201,
      ),
    );
    routes.get('/kb/documents/:id', async (c) => {
      const document = await knowledge.getDocument(actor(c), c.req.param('id'));
      if (!document) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      return c.json({ data: document });
    });
    routes.patch('/kb/documents/:id', async (c) =>
      c.json({
        data: await knowledge.updateDocument(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/kb/documents/:id/active', async (c) =>
      c.json({
        data: await knowledge.setDocumentActive(
          actor(c),
          c.req.param('id'),
          bool(await readJson(c)),
        ),
      }),
    );
    routes.post('/kb/documents/:id/retry', async (c) =>
      c.json({ data: await knowledge.retryParse(actor(c), c.req.param('id')) }),
    );
    routes.get('/kb/documents/:id/download', async (c) => {
      const file = await knowledge.documentFile(actor(c), c.req.param('id'));
      if (!file) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const bytes = await app.container
        .resolve(driveManagerToken)
        .use(file.disk)
        .getBytes(file.key);
      return new Response(new Uint8Array(bytes), {
        headers: {
          'content-type': file.mimeType || 'application/octet-stream',
          'content-disposition': contentDisposition(file.filename),
        },
      });
    });
    routes.get('/kb/gaps', async (c) =>
      c.json({
        data: await knowledge.listGaps(
          actor(c),
          c.req.query('status') || 'open',
        ),
      }),
    );
    routes.post('/kb/gaps/:id', async (c) =>
      c.json({
        data: await knowledge.resolveGap(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );

    // ---------- V1-04: versions, reviews and conflicts ----------
    routes.post('/kb/documents/:id/versions', async (c) =>
      c.json(
        {
          data: await knowledge.uploadVersion(
            actor(c),
            c.req.param('id'),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.post('/kb/documents/:id/reviewed', async (c) =>
      c.json({
        data: await knowledge.markReviewed(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.get('/kb/conflicts', async (c) =>
      c.json({
        data: await knowledge.listConflicts(
          actor(c),
          c.req.query('status') || 'open',
        ),
      }),
    );
    routes.post('/kb/conflicts/:id/:decision', async (c) => {
      const decision = c.req.param('decision');
      if (decision !== 'resolve' && decision !== 'ignore')
        throw new HrError('NOT_FOUND', 404);
      const body = await readJson(c).catch(() => ({}));
      return c.json({
        data: await knowledge.handleConflict(
          actor(c),
          c.req.param('id'),
          decision === 'resolve' ? 'resolved' : 'ignored',
          isRecord(body) && typeof body.note === 'string' ? body.note : null,
        ),
      });
    });

    // ---------- Courses ----------
    routes.get('/courses', async (c) =>
      c.json({
        data: await learning.listCourses(actor(c), {
          q: c.req.query('q') || undefined,
          status: c.req.query('status') || undefined,
          review: c.req.query('review') || undefined,
        }),
      }),
    );
    routes.post('/courses', async (c) =>
      c.json(
        { data: await learning.saveCourse(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.get('/courses/:id', async (c) => {
      const course = await learning.getCourse(actor(c), c.req.param('id'));
      if (!course) throw new HrError('COURSE_NOT_FOUND', 404);
      return c.json({ data: course });
    });
    routes.patch('/courses/:id', async (c) =>
      c.json({
        data: await learning.saveCourse(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.delete('/courses/:id', async (c) => {
      await learning.discardCourse(actor(c), c.req.param('id'));
      return c.body(null, 204);
    });
    routes.post('/courses/:id/confirm', async (c) =>
      c.json({
        data: await learning.confirmCourse(actor(c), c.req.param('id')),
      }),
    );
    routes.post('/courses/:id/publish', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || typeof body.published !== 'boolean')
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await learning.publishCourse(
          actor(c),
          c.req.param('id'),
          body.published,
        ),
      });
    });
    routes.post('/courses/:id/active', async (c) =>
      c.json({
        data: await learning.setCourseActive(
          actor(c),
          c.req.param('id'),
          bool(await readJson(c)),
        ),
      }),
    );

    // ---------- Assignments ----------
    routes.get('/assignments', async (c) =>
      c.json({
        data: await learning.listAssignments(actor(c), {
          courseId: c.req.query('courseId') || undefined,
          examId: c.req.query('examId') || undefined,
          departmentId: c.req.query('departmentId') || undefined,
          status: c.req.query('status') || undefined,
        }),
      }),
    );
    routes.get('/assignments/targets', async (c) =>
      c.json({
        data: {
          ...(await learning.assignableTargets(actor(c))),
          paths: await paths.assignableTargets(),
        },
      }),
    );
    // A learning path is assigned through the same flow as a course or an exam (V2 step 5).
    const isPath = (body: unknown) =>
      isRecord(body) && typeof body.learningPathId === 'string';
    routes.post('/assignments/preview', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: isPath(body)
          ? await paths.previewAssignment(actor(c), body)
          : await learning.previewAssignments(actor(c), body),
      });
    });
    routes.post('/assignments', async (c) => {
      const body = await readJson(c);
      return c.json(
        {
          data: isPath(body)
            ? await paths.assign(actor(c), body)
            : await learning.createAssignments(actor(c), body),
        },
        201,
      );
    });
    routes.get('/assignments/:id/timeline', async (c) =>
      c.json({ data: await paths.timeline(actor(c), c.req.param('id')) }),
    );
    routes.post('/assignments/remind', async (c) => {
      const body = await readJson(c);
      if (
        !isRecord(body) ||
        !Array.isArray(body.ids) ||
        body.ids.some((id) => typeof id !== 'string')
      )
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await learning.remind(actor(c), body.ids as string[]),
      });
    });
    routes.post('/assignments/:id/cancel', async (c) =>
      c.json({
        data: await learning.cancelAssignment(actor(c), c.req.param('id')),
      }),
    );
    routes.patch('/assignments/:id', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await learning.updateDueDate(
          actor(c),
          c.req.param('id'),
          isRecord(body) ? body.dueDate : undefined,
        ),
      });
    });

    // ---------- A learner's own study ----------
    routes.get('/learning/assignments', async (c) =>
      c.json({ data: await learning.myAssignments(actor(c)) }),
    );
    routes.get('/learning/paths', async (c) =>
      c.json({ data: await paths.myTimelines(actor(c)) }),
    );
    routes.get('/learning/offerings', async (c) =>
      c.json({ data: await sessions.myOfferings(actor(c)) }),
    );
    routes.get('/learning/practice-summary', async (c) =>
      c.json({ data: await practice.mySummary(actor(c)) }),
    );
    routes.post('/learning/video-progress', async (c) =>
      c.json({
        data: await learning.reportVideoProgress(actor(c), await readJson(c)),
      }),
    );
    // Streams a lesson video with byte ranges, so the player can seek within what was watched.
    routes.get('/learning/lessons/:id/video', async (c) => {
      const file = await learning.lessonVideo(actor(c), c.req.param('id'));
      const bytes = new Uint8Array(
        await app.container
          .resolve(driveManagerToken)
          .use(file.disk)
          .getBytes(file.key),
      );
      const size = bytes.byteLength;
      const range = /^bytes=(\d*)-(\d*)$/u.exec(c.req.header('range') ?? '');
      const headers: Record<string, string> = {
        'content-type': file.mimeType,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=3600',
      };
      if (!range) return new Response(bytes, { headers });
      const start = range[1]
        ? Number(range[1])
        : Math.max(size - Number(range[2] || 0), 0);
      const end =
        range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end)
        return new Response(null, {
          status: 416,
          headers: { ...headers, 'content-range': `bytes */${size}` },
        });
      return new Response(bytes.slice(start, end + 1), {
        status: 206,
        headers: {
          ...headers,
          'content-range': `bytes ${start}-${end}/${size}`,
          'content-length': String(end - start + 1),
        },
      });
    });
    routes.get('/learning/courses/:id', async (c) =>
      c.json({
        // V4-13: an English reader gets the confirmed translation (ids unchanged, so progress is the same).
        data: await app.container
          .resolve(talentReviewServicesToken)
          .translations.localizeCourseView(
            await learning.openCourse(actor(c), c.req.param('id')),
            locale(c),
          ),
      }),
    );
    routes.post('/learning/progress', async (c) =>
      c.json({
        data: await learning.completeLesson(actor(c), await readJson(c)),
      }),
    );

    // ---------- Profile additions ----------
    routes.get('/people/:employeeId/practice', async (c) =>
      c.json({
        data: await practice.history(actor(c), c.req.param('employeeId')),
      }),
    );
    routes.get('/people/:employeeId/learning', async (c) =>
      c.json({
        data: await learning.learningSummary(
          actor(c),
          c.req.param('employeeId'),
        ),
      }),
    );
    // Published courses tagged with the competencies of a gap table; the course list itself is not sensitive.
    routes.get('/competency-courses', async (c) => {
      actor(c);
      const ids = (c.req.query('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 100);
      return c.json({ data: await learning.coursesForCompetencies(ids) });
    });

    const router = new Hono();
    router.route('/talent', routes);
    return router;
  });

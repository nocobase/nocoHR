/**
 * V2-07 用工计划与招聘入职 endpoints.
 *
 * - `/api/talent/recruiting/*` authenticates (a session, or the ERP account's
 *   API key, which resolves into that account's session), installs the
 *   authorization context and limits bodies; every service call authorizes
 *   its own talent.* recruiting action and checks the record relation
 *   (recruiter, hiring manager, interviewer, approver).
 * - `/api/public/recruiting/*` is deliberately public: the careers page, the
 *   application, self-booking, the offer page, the AI interview and the
 *   deletion request from the resume receipt. Each
 *   call carries only its own slug or link token; applying can only create a
 *   candidate and an application, uploads are checked for type and size, and
 *   the application is rate-limited per address.
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

import { authorizeAction } from '../../providers/hr/authorize.js';
import { COMPOSITE } from '../../providers/hr/recruiting/resources.js';
import { HrError, str } from '../../providers/hr/shared.js';
import { recruitingServicesToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

const MB = 1024 * 1024;

function download(file: { bytes: Uint8Array; filename: string; mimeType: string }, inline = false) {
  return new Response(file.bytes, {
    headers: {
      'content-type': file.mimeType,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      'x-content-type-options': 'nosniff',
      // An uploaded HTML letter never runs scripts in the application's origin.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

async function form(c: Context) {
  const body = await c.req.parseBody({ all: true });
  const files: { name: string; bytes: Uint8Array; mimeType: string }[] = [];
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (v instanceof File)
        files.push({
          name: v.name || 'upload',
          bytes: new Uint8Array(await v.arrayBuffer()),
          mimeType: v.type || 'application/octet-stream',
        });
      else if (typeof v === 'string') fields[key] = v;
    }
  }
  return { files, fields };
}

function clientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

export const recruitingRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const s = () => app.container.resolve(recruitingServicesToken);

    const guarded = new Hono<HrEnv>();
    guarded.use('*', auth.required(), authz.middleware(), bodyLimit({ maxSize: 64 * 1024 * 1024 }));
    installErrorHandler(guarded);
    const j = (c: Context<HrEnv>) => readJson(c);

    // ---- 用工计划 ----
    guarded.get('/workforce-plans', async (c) =>
      c.json({ data: await s().workforce.list(actor(c), c.req.query()) }),
    );
    guarded.post('/workforce-plans', async (c) =>
      c.json({ data: await s().workforce.push(actor(c), await j(c), 'import') }, 201),
    );
    // ERP 经 API 密钥推送排产计划 (integration_mes): writes plan numbers, reads nothing back but its outcome.
    guarded.post('/integration/production-plans', async (c) =>
      c.json({ data: await s().workforce.push(actor(c), await j(c), 'api') }, 201),
    );
    guarded.get('/workforce-plans/:id', async (c) =>
      c.json({ data: await s().workforce.detail(actor(c), c.req.param('id')) }),
    );
    guarded.post('/workforce-plans/:id/decide', async (c) =>
      c.json({ data: await s().workforce.decide(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/workforce-plans/:id/recalculate', async (c) =>
      c.json({ data: await s().workforce.recalculate(actor(c), c.req.param('id')) }),
    );

    // ---- 招聘需求 ----
    guarded.get('/requisitions', async (c) =>
      c.json({ data: await s().requisitions.list(actor(c), c.req.query()) }),
    );
    guarded.post('/requisitions', async (c) =>
      c.json({ data: await s().requisitions.create(actor(c), await j(c)) }, 201),
    );
    guarded.get('/positions/:id/context', async (c) =>
      c.json({ data: await s().requisitions.positionContext(actor(c), c.req.param('id')) }),
    );
    guarded.get('/requisitions/:id', async (c) =>
      c.json({ data: await s().requisitions.detail(actor(c), c.req.param('id')) }),
    );
    guarded.put('/requisitions/:id', async (c) =>
      c.json({ data: await s().requisitions.update(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/requisitions/:id/submit', async (c) =>
      c.json({ data: await s().requisitions.submit(actor(c), c.req.param('id'), await j(c).catch(() => ({}))) }),
    );
    guarded.post('/requisitions/:id/decide', async (c) =>
      c.json({ data: await s().requisitions.decide(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/requisitions/:id/recruiter', async (c) =>
      c.json({ data: await s().requisitions.assignRecruiter(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/requisitions/:id/cancel', async (c) =>
      c.json({ data: await s().requisitions.cancel(actor(c), c.req.param('id')) }),
    );

    // ---- 职位 ----
    guarded.get('/postings', async (c) =>
      c.json({ data: await s().postings.list(actor(c), c.req.query()) }),
    );
    guarded.post('/postings', async (c) => {
      const body = (await j(c)) as { requisitionId?: unknown };
      return c.json({ data: await s().postings.create(actor(c), str(body.requisitionId ?? '')) }, 201);
    });
    guarded.get('/postings/:id', async (c) =>
      c.json({ data: await s().postings.detail(actor(c), c.req.param('id')) }),
    );
    guarded.put('/postings/:id', async (c) =>
      c.json({ data: await s().postings.update(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.patch('/postings/:id', async (c) =>
      c.json({ data: await s().postings.updateOperational(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/postings/:id/booking', async (c) =>
      c.json({ data: await s().postings.setBooking(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/postings/:id/confirm', async (c) =>
      c.json({ data: await s().postings.confirm(actor(c), c.req.param('id')) }),
    );
    guarded.post('/postings/:id/publish', async (c) =>
      c.json({ data: await s().postings.publish(actor(c), c.req.param('id')) }),
    );
    guarded.post('/postings/:id/close', async (c) =>
      c.json({ data: await s().postings.close(actor(c), c.req.param('id')) }),
    );
    guarded.post('/postings/:id/import-competencies', async (c) =>
      c.json({ data: await s().postings.importCompetencies(actor(c), c.req.param('id')) }),
    );
    guarded.post('/postings/:id/ai-interview/draft', async (c) =>
      c.json({ data: await s().aiInterview.draftPlan(actor(c), c.req.param('id')) }),
    );
    guarded.put('/postings/:id/ai-interview', async (c) =>
      c.json({ data: await s().aiInterview.savePlan(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/postings/:id/ai-interview/enable', async (c) =>
      c.json({ data: await s().aiInterview.setEnabled(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/postings/:id/ai-interview/invite', async (c) =>
      c.json({ data: await s().aiInterview.invite(actor(c), c.req.param('id'), await j(c)) }),
    );

    // ---- 候选人 ----
    guarded.get('/candidates', async (c) =>
      c.json({ data: await s().candidates.list(actor(c), c.req.query()) }),
    );
    guarded.get('/candidates/pool', async (c) =>
      c.json({ data: await s().candidates.pool(actor(c), c.req.query()) }),
    );
    guarded.post('/candidates/pool/:candidateId/add', async (c) => {
      const body = (await j(c)) as { postingId?: unknown };
      return c.json({
        data: await s().candidates.addFromPool(actor(c), c.req.param('candidateId'), str(body.postingId ?? '')),
      });
    });
    guarded.post('/candidates/import', async (c) => {
      const { files, fields } = await form(c);
      return c.json({
        data: await s().candidates.importResumes(actor(c), {
          postingId: fields.postingId ?? '',
          sourceChannel: fields.sourceChannel ?? 'import',
          consentConfirmed: fields.consentConfirmed === 'true',
          files,
        }),
      });
    });
    guarded.post('/candidates/:candidateId/anonymize', async (c) =>
      c.json({ data: await s().candidates.anonymize(actor(c), c.req.param('candidateId')) }),
    );
    guarded.get('/candidates/:id', async (c) =>
      c.json({ data: await s().candidates.detail(actor(c), c.req.param('id')) }),
    );
    guarded.get('/candidates/:id/resume', async (c) =>
      download(await s().candidates.resume(actor(c), c.req.param('id'))),
    );
    guarded.put('/candidates/:id/profile', async (c) =>
      c.json({ data: await s().candidates.updateProfile(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.put('/candidates/:id/custom-fields', async (c) =>
      c.json({ data: await s().candidates.updateCustomFields(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/candidates/:id/decide', async (c) =>
      c.json({ data: await s().candidates.decide(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/candidates/:id/stage', async (c) => {
      const body = (await j(c)) as { stage?: unknown };
      return c.json({ data: await s().candidates.setStage(actor(c), c.req.param('id'), str(body.stage ?? '')) });
    });
    guarded.put('/candidates/:id/messages/:messageId', async (c) =>
      c.json({
        data: await s().candidates.editMessage(actor(c), c.req.param('id'), c.req.param('messageId'), await j(c)),
      }),
    );
    guarded.post('/candidates/:id/messages/:messageId/send', async (c) =>
      c.json({ data: await s().candidates.sendMessage(actor(c), c.req.param('id'), c.req.param('messageId')) }),
    );
    guarded.post('/candidates/:id/messages/:messageId/discard', async (c) =>
      c.json({ data: await s().candidates.discardMessage(actor(c), c.req.param('id'), c.req.param('messageId')) }),
    );

    // ---- 面试 ----
    guarded.get('/interviews', async (c) =>
      c.json({ data: await s().interviews.list(actor(c), c.req.query()) }),
    );
    guarded.post('/interviews', async (c) =>
      c.json({ data: await s().interviews.schedule(actor(c), await j(c)) }, 201),
    );
    guarded.post('/interviews/check-calendar', async (c) =>
      c.json({ data: await s().interviews.checkCalendar(actor(c), await j(c)) }),
    );
    guarded.get('/interviews/:id', async (c) =>
      c.json({ data: await s().interviews.detail(actor(c), c.req.param('id')) }),
    );
    guarded.post('/interviews/:id/cancel', async (c) =>
      c.json({ data: await s().interviews.cancel(actor(c), c.req.param('id')) }),
    );
    guarded.post('/interviews/:id/no-show', async (c) =>
      c.json({ data: await s().interviews.markNoShow(actor(c), c.req.param('id')) }),
    );
    guarded.put('/interviews/:id/plan', async (c) =>
      c.json({ data: await s().interviews.savePlan(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/interviews/:id/scorecard', async (c) =>
      c.json({ data: await s().interviews.submitScorecard(actor(c), c.req.param('id'), await j(c)) }),
    );

    // ---- 录用 ----
    guarded.get('/offers', async (c) =>
      c.json({ data: await s().offers.list(actor(c), c.req.query()) }),
    );
    guarded.get('/offers/structures', async (c) =>
      c.json({ data: await s().offers.structures(actor(c), c.req.query('applicationId') ?? '') }),
    );
    guarded.post('/offers', async (c) =>
      c.json({ data: await s().offers.create(actor(c), await j(c)) }, 201),
    );
    guarded.get('/offers/:id', async (c) =>
      c.json({ data: await s().offers.detail(actor(c), c.req.param('id')) }),
    );
    guarded.put('/offers/:id', async (c) =>
      c.json({ data: await s().offers.update(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/offers/:id/submit', async (c) =>
      c.json({ data: await s().offers.submit(actor(c), c.req.param('id')) }),
    );
    guarded.post('/offers/:id/decide', async (c) =>
      c.json({ data: await s().offers.decide(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.get('/offers/:id/preview', async (c) =>
      c.json({ data: await s().offers.preview(actor(c), c.req.param('id')) }),
    );
    guarded.post('/offers/:id/send', async (c) =>
      c.json({ data: await s().offers.send(actor(c), c.req.param('id'), await j(c).catch(() => ({}))) }),
    );
    guarded.post('/offers/:id/record', async (c) =>
      c.json({ data: await s().offers.record(actor(c), c.req.param('id'), await j(c)) }),
    );
    guarded.post('/offers/:id/withdraw', async (c) =>
      c.json({ data: await s().offers.withdraw(actor(c), c.req.param('id')) }),
    );
    guarded.get('/offers/:id/letter', async (c) =>
      download(await s().offers.letter(actor(c), c.req.param('id')), true),
    );
    guarded.get('/offers/:id/onboard', async (c) =>
      c.json({ data: await s().offers.onboardDraft(actor(c), c.req.param('id')) }),
    );
    guarded.post('/offers/:id/onboard', async (c) =>
      c.json({ data: await s().offers.submitOnboard(actor(c), c.req.param('id'), await j(c)) }),
    );

    // ---- 待建档 · 按 Offer 预填 (hr.payroll) ----
    guarded.get('/salary-prefill/:employeeId', async (c) =>
      c.json({ data: await s().onboarding.salaryPrefill(actor(c), c.req.param('employeeId')) }),
    );
    guarded.post('/salary-prefill/:employeeId/confirm', async (c) =>
      c.json({
        data: await s().onboarding.confirmSalaryPrefill(actor(c), c.req.param('employeeId'), await j(c).catch(() => ({}))),
      }),
    );

    // ---- 报表、回访、设置 ----
    guarded.get('/reports', async (c) =>
      c.json({ data: await s().reports.report(actor(c), c.req.query()) }),
    );
    guarded.get('/check-ins', async (c) =>
      c.json({ data: await s().checkIns.list(actor(c), c.req.query()) }),
    );
    guarded.get('/settings', async (c) =>
      c.json({ data: await s().settings.read(actor(c)) }),
    );
    guarded.put('/settings', async (c) =>
      c.json({ data: await s().settings.write(actor(c), await j(c)) }),
    );
    guarded.get('/settings/integration', async (c) =>
      c.json({ data: await s().settings.integration(actor(c)) }),
    );
    guarded.post('/settings/integration/keys', async (c) =>
      c.json({ data: await s().settings.createKey(actor(c), await j(c).catch(() => ({}))) }, 201),
    );
    guarded.post('/settings/integration/keys/:id/disable', async (c) =>
      c.json({ data: await s().settings.disableKey(actor(c), c.req.param('id')) }),
    );
    // The people a recruiter can pick as interviewers or a recruiter; names only.
    guarded.get('/people', async (c) => {
      const a = actor(c);
      await authorizeAction(a.authz, COMPOSITE.requisition, 'view');
      const database = s().context.database;
      const search = (c.req.query('search') ?? '').trim();
      let q = database
        .query()
        .selectFrom('employees')
        .select(['userId', 'name', 'departmentId'])
        .where('userId', 'is not', null)
        .where('status', '!=', 'leave');
      if (search) q = q.where('name', 'like', `%${search.replace(/[%_]/gu, '')}%`);
      const rows = await q.orderBy('name', 'asc').limit(50).execute();
      const recruiters = new Set(await s().context.holdersOf('hr.recruiter'));
      return c.json({
        data: rows.map((r) => ({
          userId: str(r.userId),
          name: str(r.name),
          recruiter: recruiters.has(str(r.userId)),
        })),
      });
    });
    // 手动触发 每小时 / 每日 / 18:00 任务; asOf / now simulate a date outside production.
    guarded.post('/tasks/:task/run', async (c) => {
      const a = actor(c);
      const task = c.req.param('task');
      if (!['hourly', 'daily', 'evening'].includes(task)) throw new HrError('INVALID_INPUT', 400);
      const allowed =
        (await s().context.can(a, COMPOSITE.settings, 'manage')) ||
        (await s().context.can(a, COMPOSITE.assistant, 'configure'));
      if (!allowed) throw new HrError('FORBIDDEN', 403);
      const body = (await j(c).catch(() => ({}))) as { asOf?: unknown; now?: unknown };
      const production = process.env.NODE_ENV === 'production';
      const asOf =
        !production && typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(body.asOf)
          ? body.asOf
          : undefined;
      const now =
        !production && typeof body.now === 'string' && !Number.isNaN(Date.parse(body.now))
          ? new Date(body.now)
          : undefined;
      return c.json({
        data: await s().tasks.run(task as 'hourly' | 'daily' | 'evening', {
          asOf,
          now,
          withAutomations: true,
          trigger: 'manual',
        }),
      });
    });

    // ---- 公开页面 (no sign-in) ----
    const open = new Hono();
    open.use('*', bodyLimit({ maxSize: 12 * MB }));
    installErrorHandler(open as never);
    open.get('/jobs', async (c) => c.json({ data: await s().publicPages.jobs() }));
    open.get('/jobs/:slug', async (c) => c.json({ data: await s().publicPages.job(c.req.param('slug')) }));
    open.post('/jobs/:slug/apply', async (c) => {
      const { files, fields } = await form(c);
      let answers: Record<string, string>;
      let customFields: Record<string, unknown>;
      try {
        answers = JSON.parse(fields.answers ?? '{}') as Record<string, string>;
        customFields = JSON.parse(fields.customFields ?? '{}') as Record<string, unknown>;
      } catch {
        throw new HrError('INVALID_INPUT', 400);
      }
      return c.json(
        {
          data: await s().publicPages.apply(c.req.param('slug'), {
            ip: clientIp(c),
            name: fields.name ?? '',
            phone: fields.phone ?? '',
            email: fields.email ?? '',
            consent: fields.consent === 'true',
            answers,
            customFields,
            file: files[0] ?? null,
            challengeId: fields.challengeId,
            challengeAnswer: fields.challengeAnswer,
          }),
        },
        201,
      );
    });
    // V2-07 删除申请: the link in the resume receipt.
    open.get('/deletion/:token', async (c) => c.json({ data: await s().publicPages.deletion(c.req.param('token')) }));
    open.post('/deletion/:token', async (c) => c.json({ data: await s().publicPages.requestDeletion(c.req.param('token')) }));
    open.get('/booking/:token', async (c) => c.json({ data: await s().publicPages.booking(c.req.param('token')) }));
    open.post('/booking/:token', async (c) => {
      const body = (await readJson(c)) as { start?: unknown };
      return c.json({ data: await s().publicPages.book(c.req.param('token'), str(body.start ?? '')) });
    });
    open.post('/booking/:token/change', async (c) => {
      const body = (await readJson(c)) as { cancel?: unknown; start?: unknown };
      return c.json({
        data: await s().publicPages.change(c.req.param('token'), {
          cancel: body.cancel === true,
          start: typeof body.start === 'string' ? body.start : undefined,
        }),
      });
    });
    open.get('/offer/:token', async (c) => c.json({ data: await s().publicPages.offer(c.req.param('token')) }));
    open.get('/offer/:token/letter', async (c) =>
      download(await s().publicPages.offerLetter(c.req.param('token')), true),
    );
    open.post('/offer/:token/respond', async (c) => {
      const body = (await readJson(c)) as { accept?: unknown; reason?: unknown };
      if (typeof body.accept !== 'boolean') throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await s().publicPages.respond(c.req.param('token'), {
          accept: body.accept,
          reason: typeof body.reason === 'string' ? body.reason.slice(0, 500) : null,
        }),
      });
    });
    open.post('/offer/:token/arrival', async (c) =>
      c.json({ data: await s().publicPages.confirmArrival(c.req.param('token')) }),
    );
    open.post('/offer/:token/upload', async (c) => {
      const { files, fields } = await form(c);
      if (!files[0]) throw new HrError('IMPORT_FILE_REQUIRED', 400);
      return c.json({ data: await s().publicPages.upload(c.req.param('token'), fields.kind ?? '', files[0]) });
    });
    open.get('/ai-interview/:token', async (c) => c.json({ data: await s().aiInterview.view(c.req.param('token')) }));
    open.post('/ai-interview/:token/consent', async (c) => {
      const body = (await readJson(c)) as { accept?: unknown };
      return c.json({ data: await s().aiInterview.consent(c.req.param('token'), body.accept === true) });
    });
    open.post('/ai-interview/:token/turn', async (c) => {
      const body = (await readJson(c)) as { text?: unknown };
      return c.json({ data: await s().aiInterview.turn(c.req.param('token'), str(body.text ?? '')) });
    });

    const router = new Hono();
    router.route('/talent/recruiting', guarded);
    router.route('/public/recruiting', open);
    return router;
  });

/**
 * V2-06 薪酬与社保 endpoints. Every sub-router authenticates, installs the
 * authorization context and limits bodies; each service call then authorizes
 * its own talent.* payroll action (talent.salary, talent.payroll,
 * talent.socialInsurance, talent.payrollSettings, talent.myPayslip,
 * talent.vendorBill). hr.admin holds none of them, so every path answers
 * 403 for it. Exports are CSV downloads for hr.payroll only.
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
import { IMPORT_SEGMENTS } from '../../providers/hr/payroll/opening-imports.js';
import { HrError } from '../../providers/hr/shared.js';
import { payrollServicesToken } from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function attachment(filename: string) {
  return `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function upload(c: Context<HrEnv>) {
  const body = await c.req.parseBody();
  if (!(body.file instanceof File))
    throw new HrError('IMPORT_FILE_REQUIRED', 400);
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(body))
    if (typeof value === 'string') fields[key] = value;
  return {
    file: {
      name: body.file.name || 'upload.xlsx',
      bytes: new Uint8Array(await body.file.arrayBuffer()),
    },
    fields,
  };
}

export const payrollRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const services = () => app.container.resolve(payrollServicesToken);

    const guard = (router: Hono<HrEnv>, maxSize = 65536) => {
      router.use(
        '*',
        auth.required(),
        authz.middleware(),
        bodyLimit({ maxSize }),
      );
      installErrorHandler(router);
      return router;
    };

    // ---- 薪资档案 /talent/salaries ----
    const salaries = guard(new Hono<HrEnv>());
    salaries.get('/', async (c) =>
      c.json({ data: await services().salaries.list(actor(c), c.req.query()) }),
    );
    salaries.post('/', async (c) =>
      c.json(
        {
          data: await services().salaries.createFile(
            actor(c),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    salaries.get('/adjustments', async (c) =>
      c.json({
        data: await services().salaries.listAdjustments(
          actor(c),
          c.req.query(),
        ),
      }),
    );
    salaries.get('/adjustments/prefill', async (c) =>
      c.json({
        data: await services().salaries.prefill(
          actor(c),
          c.req.query('actionId') ?? '',
        ),
      }),
    );
    salaries.post('/adjustments', async (c) =>
      c.json(
        {
          data: await services().salaries.requestAdjustment(
            actor(c),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    salaries.post('/adjustments/:id/submit', async (c) =>
      c.json({
        data: await services().salaries.submitAdjustment(
          actor(c),
          c.req.param('id'),
        ),
      }),
    );
    salaries.post('/adjustments/:id/decide', async (c) =>
      c.json({
        data: await services().salaries.decideAdjustment(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    salaries.get('/:employeeId', async (c) =>
      c.json({
        data: await services().salaries.detail(
          actor(c),
          c.req.param('employeeId'),
        ),
      }),
    );

    // ---- 薪酬设置 /talent/payroll-settings ----
    const settings = guard(new Hono<HrEnv>());
    settings.get('/', async (c) =>
      c.json({ data: await services().structures.readSettings(actor(c)) }),
    );
    settings.put('/', async (c) =>
      c.json({
        data: await services().structures.updateSettings(
          actor(c),
          await readJson(c),
        ),
      }),
    );
    settings.get('/structures', async (c) =>
      c.json({ data: await services().structures.listFor(actor(c)) }),
    );
    settings.get('/variables', async (c) =>
      c.json({ data: await services().structures.variables(actor(c)) }),
    );
    settings.post('/structures', async (c) =>
      c.json(
        {
          data: await services().structures.create(actor(c), await readJson(c)),
        },
        201,
      ),
    );
    settings.put('/structures/:id', async (c) =>
      c.json({
        data: await services().structures.update(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    settings.post('/structures/:id/trial', async (c) =>
      c.json({
        data: await services().structures.trialRun(
          actor(c),
          c.req.param('id'),
          await readJson(c).catch(() => ({})),
        ),
      }),
    );

    // ---- 社保公积金 /talent/social-insurance ----
    const insurance = guard(new Hono<HrEnv>());
    insurance.get('/', async (c) =>
      c.json({ data: await services().insurance.overview(actor(c)) }),
    );
    insurance.post('/plans', async (c) =>
      c.json(
        {
          data: await services().insurance.savePlan(
            actor(c),
            null,
            await readJson(c),
          ),
        },
        201,
      ),
    );
    insurance.put('/plans/:id', async (c) =>
      c.json({
        data: await services().insurance.savePlan(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    insurance.post('/enrolments', async (c) =>
      c.json(
        {
          data: await services().insurance.createEnrolment(
            actor(c),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    insurance.put('/enrolments/:id', async (c) =>
      c.json({
        data: await services().insurance.updateEnrolment(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    insurance.post('/enrolments/:id/confirm', async (c) =>
      c.json({
        data: await services().insurance.confirm(
          actor(c),
          c.req.param('id'),
          await readJson(c).catch(() => ({})),
        ),
      }),
    );
    const monthOf = (c: Context<HrEnv>) => {
      const month = c.req.query('month') ?? '';
      if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month))
        throw new HrError('PAYROLL_MONTH_INVALID', 400);
      return month;
    };
    insurance.get('/changes', async (c) =>
      c.json({
        data: await services().insurance.changes(actor(c), monthOf(c)),
      }),
    );
    insurance.get('/changes/export', async (c) => {
      const month = monthOf(c);
      const csv = await services().insurance.changesCsv(actor(c), month);
      return new Response(csv, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': attachment(
            `${month}-social-insurance-changes.csv`,
          ),
        },
      });
    });
    insurance.get('/deductions', async (c) =>
      c.json({
        data: await services().insurance.deductions(
          actor(c),
          Number(c.req.query('year') ?? new Date().getFullYear()),
        ),
      }),
    );
    insurance.put('/deductions', async (c) =>
      c.json({
        data: await services().insurance.saveDeduction(
          actor(c),
          await readJson(c),
        ),
      }),
    );
    insurance.get('/base-adjustment', async (c) =>
      c.json({ data: await services().insurance.baseSuggestions(actor(c)) }),
    );
    insurance.post('/base-adjustment/generate', async (c) => {
      const body = (await readJson(c).catch(() => ({}))) as { year?: unknown };
      const year =
        typeof body.year === 'number' && Number.isInteger(body.year)
          ? body.year
          : new Date().getFullYear();
      return c.json({
        data: await services().insurance.generateBaseSuggestions(
          actor(c),
          year,
        ),
      });
    });
    insurance.post('/base-adjustment/apply', async (c) =>
      c.json({
        data: await services().insurance.applyBaseSuggestions(
          actor(c),
          await readJson(c).catch(() => ({})),
        ),
      }),
    );

    // ---- 算薪 /talent/payroll ----
    const payroll = guard(new Hono<HrEnv>(), 10 * 1024 * 1024);
    payroll.get('/cycles', async (c) =>
      c.json({ data: await services().cycles.list(actor(c)) }),
    );
    payroll.post('/cycles', async (c) =>
      c.json(
        { data: await services().cycles.create(actor(c), await readJson(c)) },
        201,
      ),
    );
    payroll.post('/tasks/:task/run', async (c) => {
      const ctx = actor(c);
      await authorizeAction(ctx.authz, 'talent.socialInsurance', 'manage');
      const task = c.req.param('task');
      if (task !== 'monthly' && task !== 'yearly')
        throw new HrError('INVALID_INPUT', 400);
      const body = (await readJson(c).catch(() => ({}))) as { asOf?: unknown };
      const asOf =
        typeof body.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(body.asOf)
          ? body.asOf
          : undefined;
      return c.json({
        data: await services().runTask(task, { trigger: 'manual', asOf }),
      });
    });
    // 派遣账单 (a tab of 算薪).
    payroll.get('/vendor-bills', async (c) =>
      c.json({ data: await services().bills.list(actor(c)) }),
    );
    payroll.post('/vendor-bills/preview', async (c) => {
      const { file, fields } = await upload(c);
      return c.json({
        data: await services().bills.preview(actor(c), fields, file.bytes),
      });
    });
    payroll.post('/vendor-bills', async (c) => {
      const { file, fields } = await upload(c);
      return c.json(
        { data: await services().bills.upload(actor(c), fields, file) },
        201,
      );
    });
    payroll.get('/vendor-bills/:id', async (c) =>
      c.json({ data: await services().bills.get(actor(c), c.req.param('id')) }),
    );
    payroll.post('/vendor-bills/:id/confirm', async (c) =>
      c.json({
        data: await services().bills.decide(
          actor(c),
          c.req.param('id'),
          'confirmed',
        ),
      }),
    );
    payroll.post('/vendor-bills/:id/dispute', async (c) =>
      c.json({
        data: await services().bills.decide(
          actor(c),
          c.req.param('id'),
          'disputed',
        ),
      }),
    );
    payroll.get('/vendor-bills/:id/export', async (c) => {
      const { filename, content } = await services().bills.exportCsv(
        actor(c),
        c.req.param('id'),
      );
      return new Response(content, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': attachment(filename),
        },
      });
    });
    payroll.get('/cycles/:id', async (c) =>
      c.json({
        data: await services().cycles.detail(actor(c), c.req.param('id')),
      }),
    );
    payroll.get('/cycles/:id/payslips', async (c) =>
      c.json({
        data: await services().cycles.payslips(
          actor(c),
          c.req.param('id'),
          c.req.query(),
        ),
      }),
    );
    payroll.get('/cycles/:id/payslips/:payslipId', async (c) =>
      c.json({
        data: await services().cycles.payslip(
          actor(c),
          c.req.param('id'),
          c.req.param('payslipId'),
        ),
      }),
    );
    payroll.get('/cycles/:id/anomalies', async (c) =>
      c.json({
        data: await services().cycles.anomalies(actor(c), c.req.param('id')),
      }),
    );
    payroll.get('/cycles/:id/imports/template', async (c) => {
      const { filename, bytes } = await services().cycles.template(
        actor(c),
        c.req.param('id'),
        c.req.query('item') ?? '',
      );
      return new Response(bytes, {
        headers: {
          'content-type': XLSX_TYPE,
          'content-disposition': attachment(filename),
        },
      });
    });
    payroll.post('/cycles/:id/imports/preview', async (c) => {
      const { file } = await upload(c);
      return c.json({
        data: await services().cycles.previewImport(
          actor(c),
          c.req.param('id'),
          file.bytes,
        ),
      });
    });
    payroll.post('/cycles/:id/imports', async (c) => {
      const { file, fields } = await upload(c);
      return c.json({
        data: await services().cycles.commitImport(
          actor(c),
          c.req.param('id'),
          file,
          {
            skipInvalid: fields.skipInvalid === 'true',
          },
        ),
      });
    });
    payroll.post('/cycles/:id/imports/api', async (c) =>
      c.json({
        data: await services().cycles.importApi(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    // V4-12: 本月发放绩效奖金 — the review cycle whose final ratings perf.coefficient reads (published or closed).
    payroll.put('/cycles/:id/bonus-cycle', async (c) =>
      c.json({
        data: await services().cycles.setBonusCycle(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    payroll.post('/cycles/:id/calculate', async (c) =>
      c.json({
        data: await services().cycles.calculate(actor(c), c.req.param('id')),
      }),
    );
    payroll.post('/cycles/:id/manual-items', async (c) =>
      c.json({
        data: await services().cycles.addManualItem(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    payroll.post('/cycles/:id/manual-items/remove', async (c) =>
      c.json({
        data: await services().cycles.removeManualItem(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    payroll.post('/cycles/:id/submit', async (c) =>
      c.json({
        data: await services().cycles.submit(actor(c), c.req.param('id')),
      }),
    );
    payroll.post('/cycles/:id/decide', async (c) =>
      c.json({
        data: await services().cycles.decide(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    payroll.post('/cycles/:id/publish', async (c) =>
      c.json({
        data: await services().cycles.publish(actor(c), c.req.param('id')),
      }),
    );
    payroll.post('/cycles/:id/close', async (c) =>
      c.json({
        data: await services().cycles.close(actor(c), c.req.param('id')),
      }),
    );
    payroll.get('/cycles/:id/exports/:kind', async (c) => {
      const { filename, content } = await services().cycles.exportFile(
        actor(c),
        c.req.param('id'),
        c.req.param('kind'),
      );
      return new Response(content, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': attachment(filename),
        },
      });
    });

    // ---- 上线准备 · 期初导入 /talent/payroll-imports/:kind ----
    // kind: salary-files (talent.salary import), enrolments and deductions
    // (talent.socialInsurance import), tax-openings (talent.payroll importOpening).
    const imports = guard(new Hono<HrEnv>(), 10 * 1024 * 1024);
    const kindOf = (c: Context<HrEnv>) => {
      const kind = IMPORT_SEGMENTS[c.req.param('kind') ?? ''];
      if (!kind) throw new HrError('NOT_FOUND', 404);
      return kind;
    };
    imports.get('/:kind/template', async (c) => {
      const { filename, bytes } = await services().openings.template(
        actor(c),
        kindOf(c),
        c.req.query(),
      );
      return new Response(bytes, {
        headers: {
          'content-type': XLSX_TYPE,
          'content-disposition': attachment(filename),
        },
      });
    });
    imports.post('/:kind/preview', async (c) => {
      const kind = kindOf(c);
      const { file } = await upload(c);
      return c.json({
        data: await services().openings.preview(actor(c), kind, file.bytes),
      });
    });
    imports.post('/:kind/commit', async (c) => {
      const kind = kindOf(c);
      const { file } = await upload(c);
      return c.json({
        data: await services().openings.commit(actor(c), kind, file),
      });
    });
    imports.get('/:kind/status', async (c) =>
      c.json({
        data: await services().openings.status(actor(c), kindOf(c)),
      }),
    );
    imports.get('/:kind/batches', async (c) =>
      c.json({
        data: await services().openings.batches(actor(c), kindOf(c)),
      }),
    );

    // ---- 我的工资条 /talent/my-payslips ----
    const mine = guard(new Hono<HrEnv>());
    mine.get('/status', (c) =>
      c.json({ data: services().mine.status(actor(c)) }),
    );
    mine.post('/verify', async (c) => {
      const body = (await readJson(c)) as { password?: unknown };
      return c.json({
        data: await services().mine.verify(actor(c), body.password),
      });
    });
    mine.get('/', async (c) =>
      c.json({ data: await services().mine.list(actor(c)) }),
    );
    mine.get('/social-insurance', async (c) =>
      c.json({ data: await services().mine.socialInsurance(actor(c)) }),
    );
    mine.get('/:month', async (c) =>
      c.json({
        data: await services().mine.get(actor(c), c.req.param('month')),
      }),
    );

    const router = new Hono();
    router.route('/talent/salaries', salaries);
    router.route('/talent/payroll-settings', settings);
    router.route('/talent/social-insurance', insurance);
    router.route('/talent/payroll', payroll);
    router.route('/talent/my-payslips', mine);
    router.route('/talent/payroll-imports', imports);
    return router;
  });

import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { DEPARTMENTS_SETTINGS } from '../../providers/hr/index.js';
import { HrError, isRecord, requireString } from '../../providers/hr/shared.js';
import {
  hrCoreServiceToken,
  organizationServiceToken,
  personnelSettingsToken,
  talentServiceToken,
} from '../../providers/hr/tokens.js';
import {
  actor,
  installErrorHandler,
  locale,
  readJson,
  type HrEnv,
} from './shared.js';

/**
 * The talent platform API under `/api/talent`. Every path authenticates, then
 * installs the authorization context; each handler authorizes its own business
 * action in the service it calls.
 */
export const talentApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const talent = app.container.resolve(talentServiceToken);
    const core = app.container.resolve(hrCoreServiceToken);
    const organization = app.container.resolve(organizationServiceToken);
    const users = app.container.resolve(userAdministrationServiceToken);

    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      auth.required(),
      bodyLimit({ maxSize: 12 * 1024 * 1024 }),
      authz.middleware(),
    );
    installErrorHandler(routes);

    // ---------- Lookups shared by the pages ----------
    routes.get('/lookups', async (c) => {
      const ctx = actor(c);
      const tree = await organization.listTree();
      const view = await ctx.authz.authorize({
        resource: { type: 'composite', id: 'talent.framework' },
        action: 'view',
      });
      const positions =
        view.effect === 'deny'
          ? []
          : (await talent.listFramework(ctx)).positions.map((p) => ({
              id: p.id,
              code: p.code,
              title: p.title,
              active: p.active,
              jobFamilyId: p.jobFamilyId,
            }));
      // The departments this user works with: those of the employees they may list, with their parents so
      // the tree reads correctly. Department pickers (排班、考勤) offer only these: a head saw all twelve,
      // although the data behind the others was empty. Absent for someone who lists no employees.
      let scopeDepartmentIds: string[] | undefined;
      try {
        const visible = await talent.listEmployees(ctx, {});
        const parentOf = new Map(tree.map((d) => [d.id, d.parentId]));
        const scope = new Set<string>();
        for (const employee of visible.items)
          for (
            let id: string | null | undefined = employee.departmentId;
            id && !scope.has(id);
            id = parentOf.get(id)
          )
            scope.add(id);
        scopeDepartmentIds = [...scope];
      } catch (error) {
        if (!(error instanceof HrError) || error.status !== 403) throw error;
      }
      return c.json({
        data: {
          departments: tree.map((d) => ({
            id: d.id,
            code: d.code,
            title: d.title,
            parentId: d.parentId,
            active: d.active,
          })),
          positions,
          ...(scopeDepartmentIds ? { scopeDepartmentIds } : {}),
        },
      });
    });

    // ---------- Employees ----------
    const filters = (c: {
      req: {
        query: {
          (k: string): string | undefined;
          (): Record<string, string>;
        };
      };
    }) => ({
      // 界面追加字段 filters arrive as `cf.<key>=value`.
      custom: Object.fromEntries(
        Object.entries(c.req.query())
          .filter(([key]) => key.startsWith('cf.'))
          .map(([key, value]) => [key.slice(3), String(value)]),
      ),
      search: c.req.query('search') || undefined,
      departmentId: c.req.query('departmentId') || undefined,
      positionId: c.req.query('positionId') || undefined,
      status: c.req.query('status') || undefined,
      employmentType: c.req.query('employmentType') || undefined,
      ids: c.req.query('ids')
        ? c.req.query('ids')!.split(',').filter(Boolean)
        : undefined,
      batchId: c.req.query('batch') || undefined,
      quick: (['noPosition', 'noManager', 'hasGaps'] as const).find(
        (q) => q === c.req.query('quick'),
      ),
    });

    routes.get('/employees', async (c) =>
      c.json({ data: await talent.listEmployees(actor(c), filters(c)) }),
    );
    routes.post('/employees', async (c) =>
      c.json(
        { data: await talent.createEmployee(actor(c), await readJson(c)) },
        201,
      ),
    );
    routes.get('/employees/import-template', async () => {
      const buffer = await talent.importTemplate();
      return new Response(new Uint8Array(buffer), {
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition':
            'attachment; filename="employee-import-template.xlsx"',
        },
      });
    });
    routes.post('/employees/import/preview', async (c) => {
      const body = await c.req.parseBody();
      const file = body.file;
      if (!(file instanceof File))
        throw new HrError('IMPORT_FILE_REQUIRED', 400);
      const rows = await talent.importPreview(
        actor(c),
        Buffer.from(await file.arrayBuffer()),
      );
      return c.json({ data: rows });
    });
    routes.post('/employees/import/commit', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || !Array.isArray(body.rows))
        throw new HrError('INVALID_INPUT', 400);
      const families = isRecord(body.newPositionFamilies)
        ? Object.fromEntries(
            Object.entries(body.newPositionFamilies).filter(
              (entry): entry is [string, string] =>
                typeof entry[1] === 'string',
            ),
          )
        : {};
      return c.json({
        data: await talent.importCommit(actor(c), body.rows as never, families),
      });
    });
    routes.get('/employees/imports/latest', async (c) =>
      c.json({ data: await talent.latestImport(actor(c)) }),
    );
    routes.get('/employees/imports/:batchId', async (c) =>
      c.json({
        data: await talent.importBatch(actor(c), c.req.param('batchId')),
      }),
    );
    routes.get('/employees/export', async (c) => {
      const buffer = await talent.exportRoster(actor(c), filters(c), locale(c));
      return new Response(new Uint8Array(buffer), {
        headers: {
          'content-type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'content-disposition': 'attachment; filename="roster.xlsx"',
        },
      });
    });
    routes.get('/employees/:id', async (c) => {
      const detail = await talent.getEmployee(actor(c), c.req.param('id'));
      if (!detail) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      return c.json({ data: detail });
    });
    routes.patch('/employees/:id', async (c) =>
      c.json({
        data: await talent.updateEmployee(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.delete('/employees/:id', async (c) => {
      await talent.deleteEmployee(actor(c), c.req.param('id'));
      return c.json({ data: { deleted: true } });
    });
    routes.post('/employees/:id/link-user', async (c) => {
      const body = await readJson(c);
      const userId = isRecord(body)
        ? requireString(body.userId, 'INVALID_INPUT', {
            optional: true,
            max: 64,
          })
        : null;
      return c.json({
        data: await talent.linkUser(actor(c), c.req.param('id'), userId),
      });
    });
    // One-time temporary password for the employee's login (shown once, never stored).
    routes.post('/employees/:id/reset-password', async (c) =>
      c.json({
        data: await talent.resetLoginPassword(actor(c), c.req.param('id')),
      }),
    );
    routes.post('/employees/:id/mark-leave', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await talent.markLeave(
          actor(c),
          c.req.param('id'),
          isRecord(body)
            ? (body as {
                leaveDate?: string;
                leaveReason?: string;
                note?: string;
              })
            : {},
        ),
      });
    });
    // 更正任职信息: department, position or status with a reason; writes a manual job event.
    routes.post('/employees/:id/correct-job', async (c) =>
      c.json({
        data: await talent.correctJob(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.get('/employees/:id/gaps', async (c) =>
      c.json({ data: await talent.gaps(actor(c), c.req.param('id')) }),
    );
    routes.get('/employees/:id/assessments', async (c) =>
      c.json({ data: await talent.assessments(actor(c), c.req.param('id')) }),
    );
    routes.post('/employees/:id/assessments', async (c) =>
      c.json(
        {
          data: await talent.createAssessment(
            actor(c),
            c.req.param('id'),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.get('/employees/:id/profile', async (c) =>
      c.json({ data: await core.getProfile(actor(c), c.req.param('id')) }),
    );
    routes.get('/employees/:id/events', async (c) =>
      c.json({
        data: await core.myEvents(actor(c), c.req.param('id'), locale(c)),
      }),
    );
    const PROFILE_KINDS = [
      'educations',
      'experiences',
      'emergencyContacts',
      'attachments',
    ] as const;
    const kindOf = (value: string) => {
      if (!(PROFILE_KINDS as readonly string[]).includes(value))
        throw new HrError('NOT_FOUND', 404);
      return value as (typeof PROFILE_KINDS)[number];
    };
    routes.post('/employees/:id/profile/:kind', async (c) =>
      c.json(
        {
          data: await core.saveProfileItem(
            actor(c),
            c.req.param('id'),
            kindOf(c.req.param('kind')),
            null,
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.patch('/employees/:id/profile/:kind/:itemId', async (c) =>
      c.json({
        data: await core.saveProfileItem(
          actor(c),
          c.req.param('id'),
          kindOf(c.req.param('kind')),
          c.req.param('itemId'),
          await readJson(c),
        ),
      }),
    );
    routes.delete('/employees/:id/profile/:kind/:itemId', async (c) => {
      await core.deleteProfileItem(
        actor(c),
        c.req.param('id'),
        kindOf(c.req.param('kind')),
        c.req.param('itemId'),
      );
      return c.body(null, 204);
    });

    // ---------- My profile ----------
    routes.get('/me', async (c) => {
      const ctx = actor(c);
      const detail = await talent.getMyEmployee(ctx);
      return c.json({ data: detail ?? null });
    });
    routes.get('/me/profile-change', async (c) =>
      c.json({ data: (await core.myProfileChange(actor(c))) ?? null }),
    );
    // The fields 人事设置 · 员工自助 lets employees change, for the request form.
    routes.get('/me/profile-change/fields', async (c) =>
      c.json({
        data: (
          await app.container
            .resolve(personnelSettingsToken)
            .read('selfService')
        ).value.fields,
      }),
    );
    routes.post('/me/profile-change', async (c) => {
      const body = await readJson(c);
      return c.json(
        {
          data: await core.requestProfileChange(
            actor(c),
            isRecord(body) ? body.changes : undefined,
          ),
        },
        201,
      );
    });

    // ---------- Framework ----------
    routes.get('/positions', async (c) =>
      c.json({ data: await talent.listPositions(actor(c)) }),
    );
    routes.get('/framework', async (c) =>
      c.json({ data: await talent.listFramework(actor(c)) }),
    );
    routes.post('/framework/job-families', async (c) =>
      c.json(
        { data: await talent.saveJobFamily(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.patch('/framework/job-families/:id', async (c) =>
      c.json({
        data: await talent.saveJobFamily(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/framework/job-families/:id/active', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await talent.setJobFamilyActive(
          actor(c),
          c.req.param('id'),
          isRecord(body) && body.active === true,
        ),
      });
    });
    routes.post('/framework/positions', async (c) =>
      c.json(
        { data: await talent.savePosition(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.patch('/framework/positions/:id', async (c) =>
      c.json({
        data: await talent.savePosition(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/framework/positions/:id/active', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await talent.setPositionActive(
          actor(c),
          c.req.param('id'),
          isRecord(body) && body.active === true,
        ),
      });
    });
    routes.post('/framework/positions/:id/requirements', async (c) =>
      c.json(
        {
          data: await talent.saveRequirement(
            actor(c),
            c.req.param('id'),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.patch('/framework/requirements/:id', async (c) => {
      const body = await readJson(c);
      if (!isRecord(body) || typeof body.positionId !== 'string')
        throw new HrError('INVALID_INPUT', 400);
      return c.json({
        data: await talent.saveRequirement(actor(c), body.positionId, {
          ...body,
          id: c.req.param('id'),
        }),
      });
    });
    routes.delete('/framework/requirements/:id', async (c) => {
      await talent.removeRequirement(actor(c), c.req.param('id'));
      return c.body(null, 204);
    });
    routes.post('/framework/requirements/confirm', async (c) => {
      const body = await readJson(c);
      const ids =
        isRecord(body) && Array.isArray(body.ids) ? body.ids.map(String) : [];
      return c.json({ data: await talent.confirmRequirements(actor(c), ids) });
    });
    routes.post('/framework/requirements/discard', async (c) => {
      const body = await readJson(c);
      const ids =
        isRecord(body) && Array.isArray(body.ids) ? body.ids.map(String) : [];
      await talent.discardRequirements(actor(c), ids);
      return c.body(null, 204);
    });

    // ---------- Competency dictionary ----------
    routes.get('/competencies', async (c) =>
      c.json({
        data: await talent.listCompetencies(actor(c), {
          draftOnly: c.req.query('draftOnly') === 'true',
          includeInactive: c.req.query('includeInactive') === 'true',
        }),
      }),
    );
    routes.post('/competencies', async (c) =>
      c.json(
        {
          data: await talent.saveCompetency(actor(c), null, await readJson(c)),
        },
        201,
      ),
    );
    routes.post('/competencies/confirm', async (c) => {
      const body = await readJson(c);
      await talent.confirmCompetencies(
        actor(c),
        isRecord(body) && Array.isArray(body.ids) ? body.ids.map(String) : [],
      );
      return c.body(null, 204);
    });
    routes.post('/competencies/discard', async (c) => {
      const body = await readJson(c);
      await talent.discardCompetencies(
        actor(c),
        isRecord(body) && Array.isArray(body.ids) ? body.ids.map(String) : [],
      );
      return c.body(null, 204);
    });
    routes.get('/competencies/:id', async (c) => {
      const competency = await talent.getCompetency(
        actor(c),
        c.req.param('id'),
      );
      if (!competency) throw new HrError('COMPETENCY_NOT_FOUND', 404);
      return c.json({ data: competency });
    });
    routes.patch('/competencies/:id', async (c) =>
      c.json({
        data: await talent.saveCompetency(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/competencies/:id/active', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await talent.setCompetencyActive(
          actor(c),
          c.req.param('id'),
          isRecord(body) && body.active === true,
        ),
      });
    });

    // ---------- Personnel actions ----------
    routes.get('/actions', async (c) => {
      const view = c.req.query('view');
      return c.json({
        data: await core.listActions(
          actor(c),
          view === 'inbox' || view === 'mine' ? view : 'all',
        ),
      });
    });
    routes.post('/actions', async (c) =>
      c.json(
        { data: await core.createAction(actor(c), await readJson(c)) },
        201,
      ),
    );
    // The chain the action being filled in would get, before it is submitted.
    routes.post('/actions/preview', async (c) =>
      c.json({ data: await core.previewChain(actor(c), await readJson(c)) }),
    );
    routes.get('/actions/:id', async (c) => {
      const action = await core.getAction(actor(c), c.req.param('id'));
      if (!action) throw new HrError('ACTION_NOT_FOUND', 404);
      return c.json({ data: action });
    });
    routes.post('/actions/:id/approve', async (c) => {
      const body = await readJson(c).catch(() => ({}));
      const comment = isRecord(body)
        ? requireString(body.comment, 'INVALID_INPUT', {
            optional: true,
            max: 2000,
          })
        : null;
      return c.json({
        data: await core.decideAction(
          actor(c),
          c.req.param('id'),
          'approve',
          comment,
        ),
      });
    });
    routes.post('/actions/:id/reject', async (c) => {
      const body = await readJson(c);
      const comment = isRecord(body)
        ? requireString(body.comment, 'ACTION_REJECT_COMMENT_REQUIRED', {
            optional: true,
            max: 2000,
          })
        : null;
      return c.json({
        data: await core.decideAction(
          actor(c),
          c.req.param('id'),
          'reject',
          comment,
        ),
      });
    });
    routes.post('/actions/:id/cancel', async (c) =>
      c.json({ data: await core.cancelAction(actor(c), c.req.param('id')) }),
    );

    // ---------- Contracts ----------
    routes.get('/contracts', async (c) => {
      const quick = c.req.query('quick');
      return c.json({
        data: await core.listContracts(actor(c), {
          employeeId: c.req.query('employeeId') || undefined,
          quick: quick === 'expiring' || quick === 'overdue' ? quick : '',
        }),
      });
    });
    routes.post('/contracts', async (c) =>
      c.json(
        { data: await core.saveContract(actor(c), null, await readJson(c)) },
        201,
      ),
    );
    routes.patch('/contracts/:id', async (c) =>
      c.json({
        data: await core.saveContract(
          actor(c),
          c.req.param('id'),
          await readJson(c),
        ),
      }),
    );
    routes.post('/contracts/:id/renew', async (c) =>
      c.json(
        {
          data: await core.renewContract(
            actor(c),
            c.req.param('id'),
            await readJson(c),
          ),
        },
        201,
      ),
    );
    routes.post('/contracts/:id/terminate', async (c) =>
      c.json({
        data: await core.terminateContract(actor(c), c.req.param('id')),
      }),
    );
    routes.post('/contracts/:id/file', async (c) => {
      const body = await readJson(c);
      const fileId = isRecord(body)
        ? requireString(body.fileId, 'INVALID_INPUT', {
            optional: true,
            max: 64,
          })
        : null;
      return c.json({
        data: await core.attachContractFile(
          actor(c),
          c.req.param('id'),
          fileId,
        ),
      });
    });

    // ---------- Profile change review ----------
    routes.get('/profile-changes', async (c) =>
      c.json({
        data: await core.listProfileChanges(
          actor(c),
          c.req.query('status') || undefined,
        ),
      }),
    );
    routes.post('/profile-changes/:id/:decision', async (c) => {
      const decision = c.req.param('decision');
      if (decision !== 'approve' && decision !== 'reject')
        throw new HrError('NOT_FOUND', 404);
      const body = await readJson(c).catch(() => ({}));
      const comment = isRecord(body)
        ? requireString(body.comment, 'INVALID_INPUT', {
            optional: true,
            max: 2000,
          })
        : null;
      return c.json({
        data: await core.reviewProfileChange(
          actor(c),
          c.req.param('id'),
          decision,
          comment,
          // An HR assistant suggestion: the fields HR adopts, with HR's final values.
          isRecord(body) ? body.values : undefined,
        ),
      });
    });

    // ---------- Reports and org chart ----------
    routes.get('/hr-reports', async (c) =>
      c.json({
        data: await core.report(
          actor(c),
          {
            departmentId: c.req.query('departmentId') || undefined,
            from: c.req.query('from') || undefined,
            to: c.req.query('to') || undefined,
          },
          locale(c),
        ),
      }),
    );
    routes.get('/org-chart', async (c) =>
      c.json({ data: await core.orgChart(actor(c), locale(c)) }),
    );
    routes.get('/org-chart/:departmentId/members', async (c) =>
      c.json({
        data: await core.orgChartMembers(actor(c), c.req.param('departmentId')),
      }),
    );

    // ---------- Users picker (for linking an employee) ----------
    routes.get('/users', async (c) => {
      const ctx = actor(c);
      const allowed = await ctx.authz.authorize({
        resource: { type: 'composite', id: 'talent.employee' },
        action: 'linkUser',
      });
      const departments = await ctx.authz.can({
        resource: { type: 'settings', id: DEPARTMENTS_SETTINGS },
        action: 'update',
      });
      if (allowed.effect === 'deny' && !departments)
        throw new HrError('FORBIDDEN', 403);
      const page = await users.list({
        page: 1,
        pageSize: 50,
        search: c.req.query('search') || undefined,
        status: 'enabled',
      });
      // For the link picker (?for=link): accounts the caller may not take over through
      // linking and a password reset (root, or holding sets the caller does not) are marked.
      const blocked =
        c.req.query('for') === 'link' && allowed.effect !== 'deny'
          ? await talent.unmanageableAccounts(
              ctx,
              page.items.map((u) => u.id),
            )
          : undefined;
      return c.json({
        data: page.items.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          username: u.username ?? null,
          ...(blocked
            ? {
                linkable: !blocked.has(u.id),
                ...(blocked.has(u.id) ? { reason: blocked.get(u.id) } : {}),
              }
            : {}),
        })),
      });
    });

    const router = new Hono();
    router.route('/talent', routes);
    return router;
  });

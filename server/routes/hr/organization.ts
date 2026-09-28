import {
  authenticationToken,
  userAdministrationServiceToken,
} from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';

import { DEPARTMENTS_SETTINGS } from '../../providers/hr/index.js';
import { HR_ADMIN_SETTINGS } from '../../providers/hr/core-service.js';
import { runDailyMaintenance } from '../../providers/hr/maintenance.js';
import {
  HrError,
  isDateOnly,
  isRecord,
  requireString,
} from '../../providers/hr/shared.js';
import {
  automationTasksToken,
  organizationServiceToken,
} from '../../providers/hr/tokens.js';
import { installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * Organisation management under `/api/talent/org`, gated by the departments
 * settings item: `read` for lists and details, `update` for writes. Sessions
 * of the users a write affects are refreshed after it commits.
 */
export const organizationApiRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const organization = app.container.resolve(organizationServiceToken);
    const users = app.container.resolve(userAdministrationServiceToken);

    const routes = new Hono<HrEnv>();
    routes.use('*', auth.required(), authz.middleware());
    installErrorHandler(routes);

    const require = (c: Context<HrEnv>, action: 'read' | 'update') =>
      c.get('authz').require({
        resource: { type: 'settings', id: DEPARTMENTS_SETTINGS },
        action,
      });
    const refresh = async (userIds: readonly string[]) => {
      for (const id of new Set(userIds))
        await authz.permissionSets.notifyAssignmentsChanged({
          type: 'user',
          id,
        });
    };
    const checkUser = async (userId: string | null | undefined) => {
      if (!userId) return;
      const user = await users.get(userId).catch(() => undefined);
      if (!user || user.disabledAt) throw new HrError('USER_NOT_FOUND', 404);
    };

    routes.get('/departments', async (c) => {
      await require(c, 'read');
      const tree = await organization.listTree();
      const managerIds = [
        ...new Set(
          tree
            .map((d) => d.managerId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const page = managerIds.length
        ? await users.list({ userIds: managerIds, pageSize: 100 })
        : { items: [] };
      const names = new Map(page.items.map((u) => [u.id, u.name]));
      return c.json({
        data: tree.map((d) => ({
          ...d,
          managerName: d.managerId ? (names.get(d.managerId) ?? null) : null,
        })),
      });
    });

    routes.post('/departments', async (c) => {
      await require(c, 'update');
      const body = await readJson(c);
      if (!isRecord(body)) throw new HrError('INVALID_INPUT', 400);
      const managerId = requireString(body.managerId, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      });
      await checkUser(managerId);
      const department = await organization.createDepartment({
        title: requireString(body.title, 'DEPARTMENT_TITLE_REQUIRED', {
          max: 200,
        })!,
        code: requireString(body.code, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }),
        parentId: requireString(body.parentId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }),
        managerId,
        sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : 0,
      });
      await refresh(managerId ? [managerId] : []);
      return c.json({ data: department }, 201);
    });

    routes.patch('/departments/:id', async (c) => {
      await require(c, 'update');
      const body = await readJson(c);
      if (!isRecord(body)) throw new HrError('INVALID_INPUT', 400);
      const input: Parameters<typeof organization.updateDepartment>[1] = {};
      if (body.title !== undefined)
        input.title = requireString(body.title, 'DEPARTMENT_TITLE_REQUIRED', {
          max: 200,
        })!;
      if (body.code !== undefined)
        input.code = requireString(body.code, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        });
      if (body.parentId !== undefined)
        input.parentId = requireString(body.parentId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        });
      if (body.managerId !== undefined) {
        input.managerId = requireString(body.managerId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        });
        await checkUser(input.managerId);
      }
      if (typeof body.sortOrder === 'number') input.sortOrder = body.sortOrder;
      const { department, changed } = await organization.updateDepartment(
        c.req.param('id'),
        input,
      );
      await refresh(changed);
      return c.json({ data: department });
    });

    routes.post('/departments/:id/active', async (c) => {
      await require(c, 'update');
      const body = await readJson(c);
      const changed = await organization.setActive(
        c.req.param('id'),
        isRecord(body) && body.active === true,
      );
      await refresh(changed);
      return c.json({ data: { changed: changed.length } });
    });

    routes.get('/departments/:id/members', async (c) => {
      await require(c, 'read');
      const members = await organization.directMembers(c.req.param('id'));
      const page = members.length
        ? await users.list({
            userIds: members.map((m) => m.userId),
            pageSize: 100,
          })
        : { items: [] };
      const byId = new Map(page.items.map((u) => [u.id, u]));
      return c.json({
        data: members.map((m) => ({
          ...m,
          name: byId.get(m.userId)?.name ?? m.userId,
          email: byId.get(m.userId)?.email ?? null,
        })),
      });
    });

    routes.post('/departments/:id/members', async (c) => {
      await require(c, 'update');
      const body = await readJson(c);
      if (!isRecord(body)) throw new HrError('INVALID_INPUT', 400);
      const userId = requireString(body.userId, 'MEMBER_USER_REQUIRED', {
        max: 64,
      })!;
      await checkUser(userId);
      const changed = await organization.addMember({
        departmentId: c.req.param('id'),
        userId,
        primary: body.primary === true,
      });
      await refresh(changed);
      return c.json({ data: { changed } }, 201);
    });

    routes.post('/departments/:id/members/:userId/primary', async (c) => {
      await require(c, 'update');
      const changed = await organization.setPrimary(
        c.req.param('id'),
        c.req.param('userId'),
      );
      await refresh(changed);
      return c.json({ data: { changed } });
    });

    routes.delete('/departments/:id/members/:userId', async (c) => {
      await require(c, 'update');
      const changed = await organization.removeMember(
        c.req.param('id'),
        c.req.param('userId'),
      );
      await refresh(changed);
      return c.body(null, 204);
    });

    // Runs the daily HR maintenance now. `asOf` simulates another day, for trying
    // out effective dates and reminders without waiting for the schedule.
    routes.post('/maintenance/run', async (c) => {
      await c.get('authz').require({
        resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
        action: 'administer',
      });
      const body = await readJson(c).catch(() => ({}));
      const asOf =
        isRecord(body) && isDateOnly(body.asOf) ? body.asOf : undefined;
      return c.json({
        data: await runDailyMaintenance(app.container, { asOf }),
      });
    });

    // Sends the certification steward's weekly brief now, for trying it out without waiting for Monday.
    routes.post('/maintenance/weekly-brief', async (c) => {
      await c.get('authz').require({
        resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
        action: 'administer',
      });
      // Through the automation, so the switch, owner and run record apply as on Monday.
      return c.json({
        data: await app.container
          .resolve(automationTasksToken)
          .runScheduled('certificationSteward.weeklyBrief', 'manual'),
      });
    });

    const router = new Hono();
    router.route('/talent/org', routes);
    return router;
  });

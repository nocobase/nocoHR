import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import type { PersonnelSettings } from '../../providers/hr/personnel-settings.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  hrCoreServiceToken,
  organizationServiceToken,
  personnelSettingsToken,
} from '../../providers/hr/tokens.js';
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { databaseManagerToken } from '@nocobase/db';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

export const personnelSettingsRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const routes = new Hono<HrEnv>();
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const settings = app.container.resolve(personnelSettingsToken);
    const container = app.container;

    /** The settings may only name departments, users, permission sets and job families that exist. */
    async function checkReferences(section: string, value: unknown) {
      if (section === 'approvalChain') {
        const organization = container.resolve(organizationServiceToken);
        const users = container.resolve(userAdministrationServiceToken);
        const sets = await authz.permissionSets.list();
        for (const rule of (value as PersonnelSettings['approvalChain'])
          .rules) {
          if (!(await organization.getDepartment(rule.departmentId)))
            throw new HrError('SETTINGS_DEPARTMENT_NOT_FOUND', 400);
          const approver = rule.approver;
          if (
            approver.type === 'departmentHead' &&
            !(await organization.getDepartment(approver.departmentId))
          )
            throw new HrError('SETTINGS_DEPARTMENT_NOT_FOUND', 400);
          if (
            approver.type === 'user' &&
            !(await users.get(approver.userId).catch(() => undefined))
          )
            throw new HrError('USER_NOT_FOUND', 400);
          if (
            approver.type === 'permissionSet' &&
            !sets.some((set) => set.key === approver.key)
          )
            throw new HrError('SETTINGS_PERMISSION_SET_NOT_FOUND', 400);
        }
      }
      if (section === 'gradeOrder') {
        const families = await container
          .resolve(databaseManagerToken)
          .query()
          .selectFrom('jobFamilies')
          .select(['id'])
          .execute();
        const known = new Set(families.map((f) => String(f.id)));
        for (const id of Object.keys(
          (value as PersonnelSettings['gradeOrder']).families,
        ))
          if (!known.has(id))
            throw new HrError('SETTINGS_JOB_FAMILY_NOT_FOUND', 400);
      }
    }
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 8192 }),
    );
    installErrorHandler(routes);
    routes.get('/', async (c) =>
      c.json({ data: await settings.get(actor(c)) }),
    );
    // 审批链预览: any department and action type, under the configuration saved now.
    routes.post('/chain-preview', async (c) => {
      const ctx = actor(c);
      await ctx.authz.require({
        resource: { type: 'settings', id: 'talent.hr' },
        action: 'administer',
      });
      return c.json({
        data: await container
          .resolve(hrCoreServiceToken)
          .previewChain(ctx, await readJson(c)),
      });
    });
    // Choices for the approval-chain editor: permission sets and job families with their grades.
    routes.get('/options', async (c) => {
      const ctx = actor(c);
      await ctx.authz.require({
        resource: { type: 'settings', id: 'talent.hr' },
        action: 'administer',
      });
      const database = container.resolve(databaseManagerToken);
      const [families, positions] = await Promise.all([
        database
          .query()
          .selectFrom('jobFamilies')
          .select(['id', 'title', 'active'])
          .orderBy('sortOrder', 'asc')
          .execute(),
        database
          .query()
          .selectFrom('positions')
          .select(['jobFamilyId', 'grade'])
          .where('grade', 'is not', null)
          .execute(),
      ]);
      return c.json({
        data: {
          permissionSets: (await authz.permissionSets.list()).map((set) => ({
            key: set.key,
            title: set.title,
          })),
          jobFamilies: families.map((family) => ({
            id: String(family.id),
            title: String(family.title),
            active: Boolean(family.active),
            grades: [
              ...new Set(
                positions
                  .filter((p) => String(p.jobFamilyId) === String(family.id))
                  .map((p) => String(p.grade)),
              ),
            ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
          })),
        },
      });
    });
    routes.patch('/:section', async (c) =>
      c.json({
        data: await settings.update(
          actor(c),
          c.req.param('section'),
          await readJson(c),
          checkReferences,
        ),
      }),
    );
    const router = new Hono();
    router.route('/talent/personnel-settings', routes);
    return router;
  });

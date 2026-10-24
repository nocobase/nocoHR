// @vitest-environment node
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import { expect, it } from 'vitest';
import applicationRoutes from '../../client/routes.js';
const flatten = (
  routes: readonly AppClientRegisteredRoute[],
): AppClientRegisteredRoute[] =>
  routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);
it('preserves the former Users, API Keys and Explorer page grants when their target plugins stop owning pages', () => {
  const resolved = resolveAppClientContributions([
    { packageName: 'hr', source: 'application', routes: applicationRoutes },
  ]);
  const pages = flatten(resolved.routes);
  for (const [path, id] of [
    ['/settings/users', 'users'],
    ['/settings/api-keys', 'api-keys'],
    ['/settings/database-explorer', 'database-explorer'],
  ]) {
    expect(pages.find((route) => route.path === path)?.authz).toEqual({
      resource: { type: 'page', id },
      action: 'access',
    });
  }
  expect(
    pages.find(
      (route) => route.path === '/settings/authorization/permission-sets',
    )?.authz,
  ).toEqual({
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    action: 'read',
  });
  expect(
    pages.find(
      (route) => route.path === '/settings/authorization/default-access',
    )?.authz,
  ).toEqual({
    resource: { type: 'settings', id: 'authorization.default-access' },
    action: 'read',
  });
});

it('preserves every existing NocoHR settings URL and resource/action, including deep editors', () => {
  const resolved = flatten(
    resolveAppClientContributions([
      { packageName: 'hr', source: 'application', routes: applicationRoutes },
    ]).routes,
  );
  const expected = [
    {
      path: '/settings/go-live',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.goLive',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/attendance',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.attendanceSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/attendance/:kind/new',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.attendanceSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/attendance/:kind/:recordId/edit',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.attendanceSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/personnel',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.hr',
        },
        action: 'administer',
      },
    },
    {
      path: '/settings/licensed-operation',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.licensedOperationSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/learning',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.hr',
        },
        action: 'administer',
      },
    },
    {
      path: '/settings/custom-fields',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.hr',
        },
        action: 'administer',
      },
    },
    {
      path: '/settings/mail',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.hr',
        },
        action: 'administer',
      },
    },
    {
      path: '/settings/departments',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.departments',
        },
        action: 'read',
      },
    },
    {
      path: '/settings/departments/import',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.departments',
        },
        action: 'read',
      },
    },
    {
      path: '/settings/org-sync',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/connection',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/runs',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/runs/:runId',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/issues',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/aliases',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/aliases/new',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/org-sync/aliases/:aliasId/edit',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.orgSync',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/ai-automations',
      authz: {
        resource: {
          type: 'settings',
          id: 'talent.aiAutomations',
        },
        action: 'read',
      },
    },
    {
      path: '/settings/payroll',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.payrollSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/payroll/structures/:structureId',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.payrollSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/ai-entry',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.aiEntry',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/recruiting',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.recruitingSettings',
        },
        action: 'access',
      },
    },
    {
      path: '/settings/agent-clients',
      authz: {
        resource: {
          type: 'page',
          id: 'talent.agentClients',
        },
        action: 'access',
      },
    },
  ];
  for (const entry of expected)
    expect(
      resolved.find(
        (route) => route.componentLoader && route.path === entry.path,
      )?.authz,
    ).toEqual(entry.authz);
});

it('retains the original inspector path and its native inspect requirement', () => {
  const routes = flatten(
    resolveAppClientContributions([
      { packageName: 'hr', source: 'application', routes: applicationRoutes },
    ]).routes,
  );
  expect(
    routes.find((route) => route.path === '/settings/authorization/inspector'),
  ).toMatchObject({
    auth: 'required',
    authz: {
      resource: { type: 'settings', id: 'authorization.inspector' },
      action: 'inspect',
    },
    componentLoader: expect.any(Function),
  });
});

it('restores the sharing-rules route with separate read, create and update actions', () => {
  const routes = flatten(
    resolveAppClientContributions([
      { packageName: 'hr', source: 'application', routes: applicationRoutes },
    ]).routes,
  );
  for (const [path, action] of [
    ['/settings/authorization/sharing-rules', 'read'],
    ['/settings/authorization/sharing-rules/new', 'create'],
    ['/settings/authorization/sharing-rules/edit/:key', 'update'],
  ]) {
    expect(routes.find((route) => route.path === path)).toMatchObject({
      auth: 'required',
      authz: {
        resource: { type: 'settings', id: 'authorization.sharing-rules' },
        action,
      },
      componentLoader: expect.any(Function),
    });
  }
});

it('restores the restriction-rules route with separate read, create and update actions', () => {
  const routes = flatten(
    resolveAppClientContributions([
      { packageName: 'hr', source: 'application', routes: applicationRoutes },
    ]).routes,
  );
  for (const [path, action] of [
    ['/settings/authorization/restriction-rules', 'read'],
    ['/settings/authorization/restriction-rules/new', 'create'],
    ['/settings/authorization/restriction-rules/edit/:key', 'update'],
  ]) {
    expect(routes.find((route) => route.path === path)).toMatchObject({
      auth: 'required',
      authz: {
        resource: { type: 'settings', id: 'authorization.restriction-rules' },
        action,
      },
      componentLoader: expect.any(Function),
    });
  }
});

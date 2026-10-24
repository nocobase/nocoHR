import { modelsRoute } from '@nocobase/app-plugin-agents/client/routes';
import {
  Database,
  FileClock,
  Settings,
  Users,
  ShieldCheck,
  ScanSearch,
  LockKeyhole,
  Share2,
  ShieldAlert,
} from 'lucide-react';
import {
  defineAppRoutes,
  type AppClientRouteContribution,
} from '@nocobase/app-client/plugins';

/** Client 3 removed plugin-owned management pages. Keep NocoHR's original URLs and page grants. */
const systemSettingsRoutes: AppClientRouteContribution = defineAppRoutes([
  {
    name: 'settings',
    path: '/settings',
    navigation: { title: 'settings.title', icon: Settings, order: 100 },
    children: [
      { ...modelsRoute, navigation: { title: 'nativeAI.models' } },
      {
        name: 'notifications.logs',
        path: '/notifications/logs',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'notification.logs' },
          action: 'access',
        },
        navigation: { title: 'settings.notificationLogs', icon: FileClock },
        componentLoader: () => import('./notification-logs/index.js'),
      },
      {
        name: 'database-explorer',
        path: '/database-explorer',
        auth: 'required',
        authz: {
          resource: { type: 'page', id: 'database-explorer' },
          action: 'access',
        },
        navigation: { title: 'settings.databaseExplorer', icon: Database },
        componentLoader: () =>
          import('./database-explorer/database-explorer-page.js'),
        children: [
          {
            name: 'database-explorer.fields',
            path: 'fields',
            authz: {
              resource: { type: 'page', id: 'database-explorer' },
              action: 'access',
            },
            componentLoader: () =>
              import('./database-explorer/collection-fields.js'),
          },
          {
            name: 'database-explorer.columns',
            path: 'columns',
            authz: {
              resource: { type: 'page', id: 'database-explorer' },
              action: 'access',
            },
            componentLoader: () =>
              import('./database-explorer/collection-columns.js'),
          },
        ],
      },

      {
        name: 'api-keys',
        path: '/api-keys',
        auth: 'required',
        authz: { resource: { type: 'page', id: 'api-keys' }, action: 'access' },
        navigation: { title: 'settings.apiKeys' },
        componentLoader: () => import('./api-keys.js'),
      },
      {
        name: 'settingsUsers',
        path: '/users',
        auth: 'required',
        authz: { resource: { type: 'page', id: 'users' }, action: 'access' },
        navigation: { title: 'settings.users', icon: Users },
        breadcrumb: { title: 'settings.users' },
        componentLoader: () => import('./users.js'),
        children: [
          {
            name: 'settingsUserCreate',
            path: 'create',
            authz: { resource: { type: 'user', id: '*' }, action: 'create' },
            componentLoader: () => import('./user-form.js'),
          },
          {
            name: 'settingsUser',
            path: ':userId',
            componentLoader: () => import('./user-detail.js'),
            children: [
              {
                name: 'settingsUserEdit',
                path: 'edit',
                componentLoader: () => import('./user-form.js'),
              },
            ],
          },
        ],
      },
      {
        name: 'settingsSharingRules',
        path: '/authorization/sharing-rules',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'authorization.sharing-rules' },
          action: 'read',
        },
        navigation: {
          title: 'settings.sharingRules',
          icon: Share2,
          order: 980,
        },
        breadcrumb: { title: 'settings.sharingRules' },
        componentLoader: () => import('./sharing-rules/index.js'),
        children: [
          {
            name: 'settingsSharingRuleCreate',
            path: 'new',
            authz: {
              resource: {
                type: 'settings',
                id: 'authorization.sharing-rules',
              },
              action: 'create',
            },
            breadcrumb: { title: 'sharingRules.actions.new' },
            componentLoader: () => import('./sharing-rules/form.js'),
          },
          {
            name: 'settingsSharingRuleEdit',
            path: 'edit/:key',
            authz: {
              resource: {
                type: 'settings',
                id: 'authorization.sharing-rules',
              },
              action: 'update',
            },
            breadcrumb: { title: 'sharingRules.actions.edit' },
            componentLoader: () => import('./sharing-rules/form.js'),
          },
        ],
      },
      {
        name: 'settingsRestrictionRules',
        path: '/authorization/restriction-rules',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'authorization.restriction-rules' },
          action: 'read',
        },
        navigation: {
          title: 'restrictionRules.page.title',
          icon: ShieldAlert,
          order: 985,
        },
        breadcrumb: { title: 'restrictionRules.page.title' },
        componentLoader: () => import('./restriction-rules/index.js'),
        children: [
          {
            name: 'settingsRestrictionRuleCreate',
            path: 'new',
            authz: {
              resource: {
                type: 'settings',
                id: 'authorization.restriction-rules',
              },
              action: 'create',
            },
            breadcrumb: { title: 'restrictionRules.actions.new' },
            componentLoader: () => import('./restriction-rules/form.js'),
          },
          {
            name: 'settingsRestrictionRuleEdit',
            path: 'edit/:key',
            authz: {
              resource: {
                type: 'settings',
                id: 'authorization.restriction-rules',
              },
              action: 'update',
            },
            breadcrumb: { title: 'restrictionRules.actions.edit' },
            componentLoader: () => import('./restriction-rules/form.js'),
          },
        ],
      },
      {
        name: 'settingsDefaultAccess',
        path: '/authorization/default-access',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'authorization.default-access' },
          action: 'read',
        },
        navigation: {
          title: 'settings.defaultAccess',
          icon: LockKeyhole,
          order: 990,
        },
        breadcrumb: { title: 'settings.defaultAccess' },
        componentLoader: () => import('./default-access/index.js'),
      },
      {
        name: 'settingsAuthorizationInspector',
        path: '/authorization/inspector',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'authorization.inspector' },
          action: 'inspect',
        },
        navigation: {
          title: 'settings.authorizationInspector',
          icon: ScanSearch,
          order: 1000,
        },
        breadcrumb: { title: 'settings.authorizationInspector' },
        componentLoader: () => import('./inspector/index.js'),
      },
      {
        name: 'settingsRoles',
        path: '/authorization/permission-sets',
        auth: 'required',
        authz: {
          resource: { type: 'settings', id: 'authorization.permission-sets' },
          action: 'read',
        },
        navigation: { title: 'settings.roles', icon: ShieldCheck },
        breadcrumb: { title: 'settings.roles' },
        componentLoader: () => import('./roles.js'),
        children: [
          {
            name: 'settingsRoleCreate',
            path: 'new',
            authz: {
              resource: {
                type: 'settings',
                id: 'authorization.permission-sets',
              },
              action: 'read',
            },
            breadcrumb: { title: 'settings.newRole' },
            componentLoader: () => import('./role-form.js'),
          },
          {
            name: 'settingsRoleAssignments',
            path: 'edit/:key/assignments',
            componentLoader: () => import('./role-assignments.js'),
          },
          {
            name: 'settingsRoleDetails',
            path: 'edit/:key/details',
            componentLoader: () => import('./role-form.js'),
          },
          {
            name: 'settingsRoleEdit',
            path: 'edit/:key',
            breadcrumb: { title: 'settings.editRole' },
            componentLoader: () => import('./role-form.js'),
          },
        ],
      },
    ],
  },
]);
export default systemSettingsRoutes;

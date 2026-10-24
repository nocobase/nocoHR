// @vitest-environment node
import {
  resolveAppClientContributions,
  type AppClientRegisteredRoute,
} from '@nocobase/app-client/plugins';
import { describe, expect, it } from 'vitest';
import applicationRoutes from '../../client/routes.js';
const flatten = (
  routes: readonly AppClientRegisteredRoute[],
): AppClientRegisteredRoute[] =>
  routes.flatMap((route) => [route, ...flatten(route.children ?? [])]);
describe('management page authorization', () => {
  const composition = async () => {
    const { default: clientPlugins } = await import('../../client/plugins.js');
    const resolved = resolveAppClientContributions([
      { packageName: 'hr', source: 'application', routes: applicationRoutes },
      ...clientPlugins.plugins.map((plugin) => ({
        packageName: plugin.packageName,
        source: 'plugin' as const,
        routes: plugin.routes,
      })),
    ]);
    return flatten(resolved.routes);
  };
  it('protects native model settings with the official model-service read grant', async () => {
    const models = (await composition()).find(
      (route) => route.name === 'models',
    );
    expect(models?.componentLoader).toBeTypeOf('function');
    expect(models?.auth).toBe('required');
    expect(models?.authz).toEqual({
      resource: { type: 'settings', id: 'agents.services' },
      action: 'read',
    });
  });
  it('retains the notification logs URL and its existing page grant', async () => {
    const logs = (await composition()).find(
      (route) => route.name === 'notifications.logs',
    );
    expect(logs?.path).toBe('/settings/notifications/logs');
    expect(logs?.componentLoader).toBeTypeOf('function');
    expect(logs?.auth).toBe('required');
    expect(logs?.authz).toEqual({
      resource: { type: 'page', id: 'notification.logs' },
      action: 'access',
    });
  });
});

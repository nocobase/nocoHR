// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { resolveAppClientContributions } from '@nocobase/app-client/plugins';

import clientPlugins from '../../client/plugins.js';
import applicationRoutes from '../../client/routes.js';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));

interface AppPackageJson {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

const appPackage = JSON.parse(
  readFileSync(path.join(appRoot, 'package.json'), 'utf8'),
) as AppPackageJson;

const registeredClientPackages = clientPlugins.plugins.map(
  (plugin) => plugin.packageName,
);

describe('client plugin registry consistency', () => {
  it('declares every client plugin as a dependency', () => {
    const undeclared = registeredClientPackages.filter(
      (packageName) =>
        appPackage.devDependencies?.[packageName] === undefined &&
        appPackage.dependencies?.[packageName] === undefined,
    );

    expect(undeclared).toEqual([]);
  });

  it('mounts the standard user and API key pages under Settings', () => {
    const { routes } = resolveAppClientContributions([
      { packageName: 'hr', source: 'application', routes: applicationRoutes },
      ...clientPlugins.plugins.map((plugin) => ({
        packageName: plugin.packageName,
        source: 'plugin' as const,
        routes: plugin.routes,
      })),
    ]);
    const settings = routes.find((route) => route.name === 'settings');
    for (const [routePath, resourceId] of [
      ['/settings/users', 'users'],
      ['/settings/api-keys', 'api-keys'],
    ]) {
      expect(settings?.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: routePath,
            source: 'application',
            componentLoader: expect.any(Function),
            authz: {
              resource: { type: 'page', id: resourceId },
              action: 'access',
            },
          }),
        ]),
      );
    }
  });

  it('registers no package twice', () => {
    expect(new Set(registeredClientPackages).size).toBe(
      registeredClientPackages.length,
    );
  });
});

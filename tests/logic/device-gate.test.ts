// @vitest-environment node
import { expect, it } from 'vitest';
import { resolveAppClientContributions } from '@nocobase/app-client/plugins';
import auth from '../../server/config/auth.js';
import clientAuth from '../../client/config/auth.js';
import routes from '../../client/routes.js';
import { DEVICE_AUTHORIZATION_ENABLED } from '../../shared/device-authorization.js';
it('keeps the server, client and browser device entry closed together while preserving existing sign-in', () => {
  expect(DEVICE_AUTHORIZATION_ENABLED).toBe(false);
  const server = auth({} as never);
  expect(server.plugins?.map((plugin) => plugin.id)).toEqual([
    'username',
    'api-key',
  ]);
  expect(server.emailAndPassword?.disableSignUp).toBe(true);
  const browser = clientAuth({} as never);
  expect(browser.plugins?.map((plugin) => plugin.id)).toEqual([
    'username',
    'api-key',
  ]);
  const registered = resolveAppClientContributions([
    { packageName: 'hr', source: 'application', routes },
  ]).routes;
  expect(registered.some((route) => route.path === '/device')).toBe(false);
});

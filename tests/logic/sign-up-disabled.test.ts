// @vitest-environment node

// Public self-registration is off by default (server/config/auth.ts): `POST /api/auth/sign-up/email` is refused and
// creates nobody, the browser is told sign-up is unavailable, while the initial administrator still signs in and
// the server-side account creation the directory sync and HR's 开通账号 use still works. Boots the real standalone
// server on a throwaway SQLite database without the demo seeds.
import { userAdministrationServiceToken } from '@nocobase/app-plugin-authentication';
import { databaseManagerToken } from '@nocobase/db';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// The database task runner imports seed files through Node itself; map their `.js` imports of application sources
// to the `.ts` files, as the other server tests do.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      const parent = (context.parentURL ?? '').replace(/[?#].*$/u, '');
      if (
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        parent.endsWith('.ts') &&
        !parent.includes('/node_modules/')
      ) {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

// Test-only values; never real credentials.
const ADMIN = {
  username: 'signupadmin',
  email: 'signup-admin@example.test',
  password: 'sign-up-disabled-test-password',
};

let server: StandaloneServer;
let directory: string;
let base: string;
const savedDemoSeed = process.env.HR_DEMO_SEED;

const post = (url: string, body: unknown) =>
  server.fetch(
    new Request(`${base}${url}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    }),
  );

async function userCount(): Promise<number> {
  const rows = await server.application.container
    .resolve(databaseManagerToken)
    .query()
    .selectFrom('user')
    .select(['id'])
    .execute();
  return rows.length;
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-sign-up-'));
  const config = path.join(directory, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      auth: { secret: 'test-auth-secret-at-least-32-characters' },
      users: { initialAdmin: ADMIN },
      database: {
        default: 'main',
        connections: {
          main: {
            dialect: 'sqlite',
            filename: path.join(directory, 'database.sqlite'),
          },
        },
        migrations: { autoRun: true },
        seeds: { autoRun: true },
      },
      hub: { host: { enabled: false } },
    }),
  );
  process.env.HR_DEMO_SEED = 'false';
  const root = path.resolve(import.meta.dirname, '../..');
  server = await createStandaloneServer({
    viteDevUrl: false,
    env: {
      DB_DIALECT: 'sqlite',
      DB_MIGRATIONS_AUTO_RUN: 'true',
      DB_SEEDS_AUTO_RUN: 'true',
      APP_PUBLIC_ORIGIN: 'http://localhost',
      APP_CONFIG_FILE: config,
    },
    paths: {
      rootDir: root,
      serverDir: path.join(root, 'server'),
      databaseDir: path.join(root, 'database'),
      clientDir: path.join(root, 'dist/client'),
      storageDir: path.join(directory, 'storage'),
    },
  });
  base = `http://localhost${server.application.publicBasePath}`;
}, 180_000);

afterAll(async () => {
  await server?.close();
  if (savedDemoSeed === undefined) delete process.env.HR_DEMO_SEED;
  else process.env.HR_DEMO_SEED = savedDemoSeed;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('self-registration', () => {
  it('is published to the browser as unavailable', () => {
    expect(
      server.application.config.get('auth.emailAndPassword'),
    ).toMatchObject({ enabled: true, disableSignUp: true });
  });

  it('refuses a sign-up and creates nobody', async () => {
    const before = await userCount();
    const response = await post('/api/auth/sign-up/email', {
      name: 'Stranger',
      email: 'stranger@example.test',
      password: 'stranger-test-password',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await userCount()).toBe(before);
  });

  it('still signs the initial administrator in', async () => {
    const response = await post('/api/auth/sign-in/username', {
      username: ADMIN.username,
      password: ADMIN.password,
    });
    expect(response.status).toBe(200);
  });

  it('still creates accounts on the server, as the directory sync and 开通账号 do', async () => {
    const users = server.application.container.resolve(
      userAdministrationServiceToken,
    );
    const created = await users.create({
      name: '新同事',
      username: 'synced01',
      email: 'synced01@example.test',
      password: 'synced-account-test-password',
    });
    expect(created.id).toBeTruthy();
    const response = await post('/api/auth/sign-in/username', {
      username: 'synced01',
      password: 'synced-account-test-password',
    });
    expect(response.status).toBe(200);
  });
});

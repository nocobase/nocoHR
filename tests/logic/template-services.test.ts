// @vitest-environment node
import { copyFile, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { verifyMigration } from '@nocobase/app-testing/server';
import { AppConfig, defaultAppConfigs } from '@nocobase/app-server/config';
import { defineAppRuntime } from '@nocobase/app-server/runtime';
import { defineServerPlugins } from '@nocobase/app-server/plugins';
import { resolveStandaloneAppRuntime } from '@nocobase/app-server/node';
import { Application } from '@nocobase/app-server/application';
import {
  SecretsProvider,
  secretsServiceToken,
} from '@nocobase/app-server/secrets';
import { MailerProvider, mailerToken } from '@nocobase/app-server/mailer';
import appConfig from '../../server/config/app.js';
import database from '../../server/config/database.js';
import session from '../../server/config/session.js';
import secrets from '../../server/config/secrets.js';
import users from '../../server/config/users.js';
import assistant from '../../server/config/assistant.js';
import processes from '../../server/config/processes.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function runtime(environment: Record<string, string> = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'template-services-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const resolved = await resolveStandaloneAppRuntime(
    defineAppRuntime({
      createAppConfig: () => new AppConfig(),
      defaultConfigs: defaultAppConfigs({
        app: appConfig,
        database,
        session,
        secrets,
        users,
        assistant,
        processes,
      }),
      plugins: defineServerPlugins([]),
      serviceProviders: [],
      routes: [],
    }),
    {
      rootDir: directory,
      env: { APP_BASE_PATH: '/nocohr-test', ...environment },
    },
  );
  cleanups.push(() => resolved.scope.destroy());
  return resolved;
}

it('isolates the session cookie and resolves database and initial-user environment configuration without publishing it', async () => {
  const r = await runtime({
    DB_FILENAME: 'independent-test.sqlite',
    INITIAL_ADMIN_USERNAME: 'testadmin',
    INITIAL_ADMIN_EMAIL: 'admin@example.test',
    INITIAL_ADMIN_PASSWORD: 'synthetic-password-for-tests-only',
  });
  expect(r.config.get('session.cookie.path')).toBe('/nocohr-test');
  expect(r.config.get('database.connections.main.filename')).toBe(
    'independent-test.sqlite',
  );
  expect(r.config.get('users.initialAdmin.username')).toBe('testadmin');
  expect(r.config.get('assistant.enabled')).toBe(false);
  expect(r.config.get('processes.enabled')).toBe(false);
  expect(r.config.publicValues()).toEqual({});
});

it('boots and shuts down the native secrets and mailer providers using only a synthetic key', async () => {
  const r = await runtime({ SECRETS_KEYS: `1:${'ab'.repeat(32)}` });
  const app = new Application({
    config: r.config,
    paths: r.paths,
    websocket: () => ({}) as never,
    strictStartup: true,
  });
  app.addServiceProvider(SecretsProvider);
  app.addServiceProvider(MailerProvider);
  cleanups.push(() => app.shutdown());
  await app.start();
  const service = app.container.resolve(secretsServiceToken);
  const options = {
    purpose: 'nocohr/template-test',
    aad: ['synthetic-record'],
  };
  const sealed = service.seal('test-only-value', options);
  expect(service.open(sealed, options)).toBe('test-only-value');
  expect(() =>
    service.open(sealed, { ...options, aad: ['another-record'] }),
  ).toThrow();
  expect(app.container.resolve(mailerToken).available('not-configured')).toBe(
    false,
  );
  expect(r.config.publicValues()).toEqual({});
  await app.shutdown();
});

it('loads the actual device migration through the native migrator and preserves preceding rows across rollback and reapply', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'template-migration-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  await symlink(
    path.resolve(import.meta.dirname, '../../node_modules'),
    path.join(directory, 'node_modules'),
    'dir',
  );
  await writeFile(
    path.join(directory, '202609010001_preceding_sentinel.mjs'),
    `import { defineMigration } from '@nocobase/db'; export default defineMigration({
    name: '202609010001_preceding_sentinel',
    async up({builder}) { await builder.createCollection('templateSentinel', c => { c.string('id').primary(); c.string('value').notNull(); }); },
    async down({builder}) { await builder.dropCollection('templateSentinel'); }
  });`,
  );
  await copyFile(
    path.resolve(
      import.meta.dirname,
      '../../database/main/migrations/202610060001_create_device_code.ts',
    ),
    path.join(directory, '202610060001_create_device_code.ts'),
  );
  await verifyMigration('202610060001_create_device_code', {
    sources: [{ packageName: 'isolated-template-migration', directory }],
    before: async ({ connection }) => {
      await connection.query
        .insertInto('templateSentinel')
        .values({ id: 'retained', value: 'original' })
        .execute();
    },
    up: async ({ connection, expectCollection }) => {
      const collection = await expectCollection('deviceCode').toExist();
      expect(collection.primaryKey).toEqual(['id']);
      await expectCollection('deviceCode').toHaveField('userId', {
        nullable: true,
      });
      await expectCollection('deviceCode').toHaveField('expiresAt', {
        nullable: false,
      });
      expect(
        await connection.query
          .selectFrom('templateSentinel')
          .selectAll()
          .execute(),
      ).toEqual([{ id: 'retained', value: 'original' }]);
      const row = {
        id: 'one',
        deviceCode: 'device-test',
        userCode: 'ABCD2345',
        expiresAt: new Date(),
        status: 'pending',
        pollingInterval: 5000,
        clientId: 'test-only',
      };
      await connection.query.insertInto('deviceCode').values(row).execute();
      await expect(
        connection.query
          .insertInto('deviceCode')
          .values({ ...row, id: 'two', userCode: 'WXYZ6789' })
          .execute(),
      ).rejects.toThrow();
      await expect(
        connection.query
          .insertInto('deviceCode')
          .values({ ...row, id: 'three', deviceCode: 'another-device' })
          .execute(),
      ).rejects.toThrow();
    },
    down: async ({ connection, expectCollection }) => {
      await expectCollection('deviceCode').not.toExist();
      expect(
        await connection.query
          .selectFrom('templateSentinel')
          .selectAll()
          .execute(),
      ).toEqual([{ id: 'retained', value: 'original' }]);
    },
  });
});

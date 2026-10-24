import {
  ClientApplication,
  createAppClientConfig,
  defineAppClientRenderConfig,
} from '@nocobase/app-client';
import { defineClientPlugins } from '@nocobase/app-client/plugins';
import {
  defineAppRuntime,
  resolveAppRuntime,
} from '@nocobase/app-client/runtime';
import { describe, expect, it } from 'vitest';

import { DefaultClientServiceProvider } from '../../client/service-provider.ts';
import defaultConfigs from '../../client/config/index.js';

describe('application title', () => {
  it('uses the configured title during the application lifecycle', async () => {
    const previousTitle = 'Host title';
    document.title = previousTitle;
    const app = await createTestApp('Configured application');

    await app.start();

    expect(document.title).toBe('Configured application');

    await app.shutdown();
    expect(document.title).toBe(previousTitle);
  });

  it.each(['   ', '', undefined, null, 42])(
    'falls back to NocoHR for an invalid configured title (%s)',
    async (title) => {
      const previousTitle = 'Host title';
      document.title = previousTitle;
      const app = await createTestApp(title);

      await app.start();

      expect(document.title).toBe('NocoHR');

      await app.shutdown();
      expect(document.title).toBe(previousTitle);
    },
  );

  it('trims a configured title and restores an empty host title', async () => {
    document.title = '';
    const app = await createTestApp('  NocoHR 人力资源  ');

    await app.start();
    expect(document.title).toBe('NocoHR 人力资源');

    await app.shutdown();
    expect(document.title).toBe('');
  });
});

async function createTestApp(title: unknown) {
  const runtime = await resolveAppRuntime(
    defineAppRuntime({
      packageName: '@example/app',
      createAppConfig: createAppClientConfig,
      defaultConfigs,
      serviceProviders: [DefaultClientServiceProvider],
      reactProviders: [],
      routes: [],
      plugins: defineClientPlugins([]),
    }),
    { rawConfig: { app: title === undefined ? {} : { title } } },
  );
  return new ClientApplication({
    runtime,
    createRenderConfig: () => defineAppClientRenderConfig({ routes: null }),
  });
}

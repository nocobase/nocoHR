import { test, expect } from '@playwright/test';
import { createServer as createHttpServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { createTestApp } from '@nocobase/app-testing/server';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { registerNodeWebSocketUpgradeHandler } from '@nocobase/app-server/node';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone';
import { scopeForUser } from '../../server/providers/hr/authorize';
import { automationServiceToken } from '../../server/providers/hr/tokens';
import { MAIL_REPLY_AUDIT } from '../../server/providers/hr/mail/audit';
const loader = registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        (context.parentURL ?? '').replace(/[?#].*$/u, '').endsWith('.ts') &&
        !context.parentURL?.includes('/node_modules/')
      )
        return next(specifier.slice(0, -3) + '.ts', context);
      throw error;
    }
  },
});

test('real audit pack feedback does not promise a disabled reply', async ({
  browser,
}, testInfo) => {
  const root = path.join(testInfo.outputDir, 'evidence');
  await mkdir(root, { recursive: true });
  let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  const server = createHttpServer(async (req, res) => {
    try {
      if (!app) {
        res.writeHead(503).end();
        return;
      }
      if (req.url?.startsWith('/main/api/')) {
        const parts: Buffer[] = [];
        for await (const part of req) parts.push(Buffer.from(part));
        const response = await app.request(req.url.slice('/main/api'.length), {
          method: req.method,
          headers: new Headers(
            Object.entries(req.headers)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key,
                Array.isArray(value) ? value.join(',') : value!,
              ]),
          ),
          ...(parts.length ? { body: Buffer.concat(parts) } : {}),
        });
        res.statusCode = response.status;
        for (const [key, value] of response.headers)
          if (key.toLowerCase() !== 'set-cookie') res.setHeader(key, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (!vite) {
        res.writeHead(503).end();
        return;
      }
      if (req.headers.accept?.includes('text/html')) {
        const response = await app.fetch(new Request(origin + req.url));
        expect(response.status).toBe(200);
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml(req.url!, await response.text()));
        return;
      }
      vite.middlewares(req, res);
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('Missing test listener');
  const origin = `http://127.0.0.1:${address.port}`;
  const saved = {
    base: process.env.APP_BASE_PATH,
    annotations: process.env.AGENT_ANNOTATIONS_ENABLED,
    password: process.env.HR_DEMO_PASSWORD,
  };
  try {
    process.env.HR_DEMO_PASSWORD = 'synthetic-completion-browser-password';
    app = await createTestApp({
      createServer: createStandaloneServer,
      server: {
        env: {
          HR_DEMO_SEED: 'true',
          HR_RECRUITING_DEMO: 'false',
          FEISHU_LONG_CONNECTION: 'false',
          APP_PROCESSES_ENABLED: 'false',
          APP_ASSISTANT_ENABLED: 'false',
        },
      },
      config: {
        auth: {
          secret: randomBytes(32).toString('hex'),
          trustedOrigins: [origin],
        },
        secrets: {
          keys: [{ version: 1, key: randomBytes(32).toString('base64') }],
        },
        i18n: { defaultLocale: 'en-US' },
        processes: { enabled: false, scheduleUsers: {} },
        assistant: { enabled: false },
        feishu: { appId: '', appSecret: '', longConnection: false },
        notification: { channels: {} },
        ai: { services: [] },
        spa: {
          indexPath: path.join(process.cwd(), 'index.html'),
          viteDevUrl: null,
        },
      },
    });
    // Only this disposable browser fixture: no unrelated calendar work or external channels.
    await app.application.container
      .resolve(jobExecutorServiceToken)
      .getScheduleExecutor('@nocobase/app-plugin-scheduler')
      .shutdown();
    registerNodeWebSocketUpgradeHandler(app.server, server);
    context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      locale: 'en-US',
    });
    const blocked: string[] = [],
      errors: string[] = [],
      requests: string[] = [];
    await context.route('**/*', (route) => {
      if (
        !route
          .request()
          .url()
          .startsWith(origin + '/')
      ) {
        blocked.push(route.request().url());
        return route.abort();
      }
      return route.continue();
    });
    const login = await context.request.post(
      origin + '/main/api/auth/sign-in/username',
      {
        headers: { origin },
        data: { username: 'nocobase', password: 'admin123' },
      },
    );
    expect(login.status()).toBe(200);
    const identity = (await login.json()) as { user: { id: string } };
    const container = app.application.container;
    await container.resolve(automationServiceToken).update(
      {
        userId: identity.user.id,
        authz: await scopeForUser(
          container.resolve(authorizationToken),
          identity.user.id,
        ),
      },
      MAIL_REPLY_AUDIT,
      { enabled: false },
    );
    const api = async (method: string, url: string, data?: unknown) => {
      const response = await context!.request.fetch(
        origin + '/main/api/talent' + url,
        {
          method,
          headers: { origin },
          ...(data === undefined ? {} : { data }),
        },
      );
      expect(response.ok()).toBe(true);
      return (await response.json()) as { data: { id: string } };
    };
    const id = (
      await api('POST', '/audit-requests', {
        customerName: 'Synthetic audit customer',
        requesterAddress: 'auditor@completion.test',
        dueDate: '2026-12-20',
      })
    ).data.id;
    await api('PATCH', `/audit-requests/${id}`, {
      departmentIds: ['sz-mc'],
      positionIds: ['pos-cnc-operator'],
      materials: ['certificates'],
    });
    await api('POST', `/audit-requests/${id}/confirm`);
    process.env.APP_BASE_PATH = '/main';
    process.env.AGENT_ANNOTATIONS_ENABLED = 'false';
    vite = await createViteServer({
      configFile: path.join(process.cwd(), 'vite.config.ts'),
      base: '/main/',
      cacheDir: path.join(testInfo.outputDir, 'vite-cache'),
      server: { middlewareMode: true, hmr: false },
    });
    process.stdout.write(
      `Mail completion isolated test application Local: ${origin}/main/\n`,
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().startsWith(origin + '/main/api/'))
        requests.push(
          request.method() + ' ' + request.url().slice(origin.length),
        );
    });
    await page.goto(origin + `/main/talent/audit?tab=requests&request=${id}`);
    const build = page.getByRole('button', {
      name: 'Build the audit pack',
      exact: true,
    });
    await expect(build).toBeVisible({ timeout: 60_000 });
    await build.click();
    await expect(
      page.getByText('Audit pack built', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Download the pack', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(root, 'audit-pack-completion-en.png'),
      fullPage: true,
    });
    const messages = await app.application.container
      .resolve(databaseManagerToken)
      .query()
      .selectFrom('businessMailMessages')
      .select(['id'])
      .where('refId', '=', id)
      .where('direction', '=', 'outbound')
      .execute();
    expect(messages).toHaveLength(0);
    expect(
      requests.filter(
        (request) =>
          request === `POST /main/api/talent/audit-requests/${id}/pack`,
      ),
    ).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(blocked).toEqual([]);
    await writeFile(
      path.join(root, 'browser.json'),
      JSON.stringify(
        {
          testInstance: origin,
          requests,
          blocked,
          errors,
          replyTask: 'disabled',
          drafts: messages.length,
        },
        null,
        2,
      ),
    );
  } finally {
    for (const [name, value] of [
      ['APP_BASE_PATH', saved.base],
      ['AGENT_ANNOTATIONS_ENABLED', saved.annotations],
      ['HR_DEMO_PASSWORD', saved.password],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await context?.close();
    await vite?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app?.close();
    loader.deregister();
  }
});

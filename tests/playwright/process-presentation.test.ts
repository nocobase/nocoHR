import { test, expect } from '@playwright/test';
import { createServer as createHttpServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { randomBytes } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { createTestApp } from '@nocobase/app-testing/server';
import { createStandaloneServer } from '../../server/standalone';

// Historical seed imports run outside the browser runner's TypeScript transform.
const loader = registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_MODULE_NOT_FOUND' &&
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
test('fixed process components render in an authenticated, isolated component host', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const repository = process.cwd();
  const apiCosts: Record<string, unknown>[] = [];
  let app: Awaited<ReturnType<typeof createTestApp>> | undefined;
  let vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  const nativeRequest = async (
    label: string,
    target: string,
    init?: RequestInit,
  ) => {
    if (!app) throw Error('Missing test app');
    const sql: string[] = [];
    const db = await app.connection.client<{
      on(event: string, cb: (q: { sql: string }) => void): void;
      removeListener(event: string, cb: (q: { sql: string }) => void): void;
    }>();
    const query = (q: { sql: string }) => sql.push(q.sql);
    db.on('query', query);
    try {
      const response = await app.request(target, init);
      apiCosts.push({
        path: label,
        status: response.status,
        ...Object.fromEntries(
          ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
            (verb) => [
              verb,
              sql.filter((q) => new RegExp('^' + verb + '\\b', 'i').test(q))
                .length,
            ],
          ),
        ),
      });
      return response;
    } finally {
      db.removeListener('query', query);
    }
  };
  const server = createHttpServer(async (req, res) => {
    try {
      if (!app || !vite) {
        res.writeHead(503).end();
        return;
      }
      const send = async (response: Response) => {
        res.statusCode = response.status;
        for (const [name, value] of response.headers)
          if (name.toLowerCase() !== 'set-cookie') res.setHeader(name, value);
        const cookies = response.headers.getSetCookie();
        if (cookies.length) res.setHeader('set-cookie', cookies);
        res.end(Buffer.from(await response.arrayBuffer()));
      };
      if (req.url?.startsWith('/main/api/')) {
        const parts: Buffer[] = [];
        for await (const part of req) parts.push(Buffer.from(part));
        const response = await nativeRequest(
          req.url,
          req.url.slice('/main/api'.length),
          {
            method: req.method,
            headers: new Headers(
              Object.entries(req.headers)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v!]),
            ),
            ...(parts.length ? { body: Buffer.concat(parts) } : {}),
          },
        );
        await send(response);
        return;
      }
      if (req.url === '/main/') {
        const session = await nativeRequest(
          'component-host admission',
          '/auth/get-session',
          { headers: { cookie: req.headers.cookie ?? '' } },
        );
        const identity = (await session.json()) as { user?: unknown } | null;
        if (!identity?.user) {
          res.writeHead(401).end('Native test sign-in required');
          return;
        }
        const html = await readFile(
          path.join(
            repository,
            'tests/fixtures/process-presentation/index.html',
          ),
          'utf8',
        );
        res.setHeader('content-type', 'text/html');
        res.end(await vite.transformIndexHtml('/', html));
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
    throw Error('Missing host address');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    // A fresh native test configuration is supplied explicitly; no deployment config is loaded.
    app = await createTestApp({
      createServer: createStandaloneServer,
      server: {
        env: {
          NODE_ENV: 'test',
          HR_DEMO_SEED: 'false',
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
        processes: { enabled: false, scheduleUsers: {} },
        assistant: { enabled: false },
        feishu: { appId: '', appSecret: '', longConnection: false },
        mail: { providers: { local: { type: 'local-files', enabled: false } } },
        businessMail: {
          billing: { address: '' },
          recruiting: { address: '' },
          audit: { address: '' },
          hr: { address: '' },
        },
        notification: { channels: {} },
        ai: { services: [] },
        i18n: { defaultLocale: 'en-US' },
      },
    });
    vite = await createViteServer({
      configFile: false,
      root: repository,
      cacheDir: path.join(testInfo.outputDir, 'vite-cache'),
      plugins: [react(), tailwind()],
      server: { middlewareMode: true, hmr: false, fs: { allow: [repository] } },
      resolve: { alias: { '@': path.join(repository, 'client') } },
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1120 },
    });
    const requests: string[] = [];
    const errors: string[] = [];
    const blocked: string[] = [];
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (!url.startsWith(origin + '/')) {
        blocked.push(url);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (req) => {
      if (req.url().startsWith(origin + '/main/api/'))
        requests.push(req.method() + ' ' + req.url().slice(origin.length));
    });
    expect((await page.goto(origin + '/main/'))?.status()).toBe(401);
    const login = await context.request.post(
      origin + '/main/api/auth/sign-in/username',
      {
        headers: { origin },
        data: { username: 'nocobase', password: 'admin123' },
      },
    );
    expect(login.status()).toBe(200);
    await page.goto(origin + '/main/');
    await expect(
      page.getByRole('heading', {
        name: 'Process presentation component host',
      }),
    ).toBeVisible();
    await expect(page.locator('.react-flow__node')).toHaveCount(3);
    await expect(
      page.locator('[data-execution-state="current"]'),
    ).toContainText('Review');
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);
    const root =
      process.env.PROCESS_PRESENTATION_EVIDENCE ?? testInfo.outputDir;
    await mkdir(root, { recursive: true });
    await page.screenshot({
      path: path.join(root, 'process-execution-host-en.png'),
      fullPage: true,
    });
    const apiBefore = requests.length;
    const displaySql: string[] = [];
    const displayDb = await app.connection.client<{
      on(event: string, cb: (q: { sql: string }) => void): void;
      removeListener(event: string, cb: (q: { sql: string }) => void): void;
    }>();
    const displayQuery = (q: { sql: string }) => displaySql.push(q.sql);
    displayDb.on('query', displayQuery);
    await page.getByRole('button', { name: 'Show step 2' }).click();
    await expect(
      page.locator('[data-execution-state="current"]'),
    ).toContainText('Draft');
    await expect(
      page.getByRole('button', { name: 'Show step 2' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await page
      .getByRole('button', { name: 'Definition display', exact: true })
      .click();
    await expect(
      page.getByRole('button', {
        name: 'Parameters',
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Parameters', exact: true }).click();
    await expect(page.getByRole('status')).toContainText(
      'Display callback only: state review; fields: days',
    );
    await expect(page.locator('.react-flow__edge')).toHaveCount(2);
    await page.screenshot({
      path: path.join(root, 'process-definition-host-en.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Exit fullscreen', exact: true }),
    ).toHaveCount(2);
    await expect(
      page
        .getByRole('button', { name: 'Exit fullscreen', exact: true })
        .first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Fullscreen', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    await page
      .getByRole('button', { name: 'Fit to view', exact: true })
      .click();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    const palette = await page
      .getByRole('button', { name: 'Zoom in', exact: true })
      .evaluate((button) => {
        const probe = document.createElement('span');
        probe.style.color = 'var(--card-foreground)';
        probe.style.backgroundColor = 'var(--card)';
        document.body.append(probe);
        const expected = getComputedStyle(probe),
          actual = getComputedStyle(button);
        const result = {
          expectedColor: expected.color,
          expectedBackground: expected.backgroundColor,
          color: actual.color,
          background: actual.backgroundColor,
        };
        probe.remove();
        return result;
      });
    expect(palette.color).toBe(palette.expectedColor);
    expect(palette.background).toBe(palette.expectedBackground);

    await page.screenshot({
      path: path.join(root, 'process-host-dark-en.png'),
      fullPage: true,
    });
    await page.evaluate(() =>
      document.documentElement.classList.remove('dark'),
    );
    await page.setViewportSize({ width: 375, height: 844 });
    await page.screenshot({
      path: path.join(root, 'process-host-mobile-en.png'),
      fullPage: true,
    });
    displayDb.removeListener('query', displayQuery);
    // Existing Mail maintenance can tick while the browser operates. Attribute
    // those reads explicitly; any other query or write would be a regression.
    for (const sql of displaySql)
      expect(sql).toMatch(
        /^select .*\b(?:mail_outbox|mail_account_removals)\b/i,
      );
    expect(requests.length - apiBefore).toBe(0);
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      path.join(root, 'browser-costs.json'),
      JSON.stringify(
        {
          origin,
          hostOnly: true,
          requests,
          apiCosts,
          displayInteractionRequests: requests.length - apiBefore,
          displaySqlCount: displaySql.length,
          existingMailMaintenance: displaySql,
          blocked,
          errors,
        },
        null,
        2,
      ),
    );
    await context.close();
  } finally {
    await vite?.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await app?.close();
    loader.deregister();
  }
});

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
import { knowledgeToken } from '@nocobase/app-plugin-knowledge/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { createStandaloneServer } from '../../server/standalone';
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
test('authorized dual-source search in the real NocoHR application with native document reader', async ({
  browser,
}, testInfo) => {
  const root = path.join(testInfo.outputDir, 'evidence');
  await mkdir(root, { recursive: true });
  let app: Awaited<ReturnType<typeof createTestApp>> | undefined,
    vite: Awaited<ReturnType<typeof createViteServer>> | undefined;
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  const pageSql: string[] = [];
  let stopMeter: (() => void) | undefined;
  const costs: unknown[] = [];
  let embeddings = 0;
  const model = createHttpServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    const value = JSON.parse(raw) as { input: string[] | string };
    const inputs = Array.isArray(value.input) ? value.input : [value.input];
    embeddings++;
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        object: 'list',
        model: 'controlled-embedding',
        data: inputs.map((_, index) => ({
          object: 'embedding',
          index,
          embedding: [1, 0, 0],
        })),
        usage: { prompt_tokens: inputs.length, total_tokens: inputs.length },
      }),
    );
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const modelAddress = model.address();
  if (!modelAddress || typeof modelAddress === 'string')
    throw Error('Missing controlled embedding address');
  const server = createHttpServer(async (req, res) => {
    try {
      if (!app) {
        res.writeHead(503).end();
        return;
      }
      if (req.url?.startsWith('/main/api/')) {
        const parts: Buffer[] = [];
        for await (const part of req) parts.push(Buffer.from(part));
        const sql: string[] = [];
        const db = await app.connection.client<{
          on(event: string, cb: (q: { sql: string }) => void): void;
          removeListener(event: string, cb: (q: { sql: string }) => void): void;
        }>();
        const listener = (q: { sql: string }) => sql.push(q.sql);
        db.on('query', listener);
        const before = embeddings;
        const response = await app.request(req.url.slice('/main/api'.length), {
          method: req.method,
          headers: new Headers(
            Object.entries(req.headers)
              .filter(([, v]) => v !== undefined)
              .map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : v!]),
          ),
          ...(parts.length ? { body: Buffer.concat(parts) } : {}),
        });
        db.removeListener('query', listener);
        costs.push({
          path: req.url,
          method: req.method,
          status: response.status,
          embeddingRequests: embeddings - before,
          ...Object.fromEntries(
            ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
              (v) => [
                v,
                sql.filter((q) => new RegExp('^' + v + '\\b', 'i').test(q))
                  .length,
              ],
            ),
          ),
        });
        res.statusCode = response.status;
        for (const [k, v] of response.headers)
          if (k.toLowerCase() !== 'set-cookie') res.setHeader(k, v);
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
        const native = await app.fetch(new Request(origin + req.url));
        if (native.status !== 200)
          throw Error('Native application bootstrap did not render');
        const html = await vite.transformIndexHtml(
          req.url!,
          await native.text(),
        );
        res.setHeader('content-type', 'text/html');
        res.end(html);
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
  const oldBase = process.env.APP_BASE_PATH,
    oldAnnotations = process.env.AGENT_ANNOTATIONS_ENABLED;
  try {
    app = await createTestApp({
      createServer: createStandaloneServer,
      server: {
        env: {
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
        i18n: { defaultLocale: 'en-US' },
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
        spa: {
          indexPath: path.join(process.cwd(), 'index.html'),
          viteDevUrl: null,
        },
        knowledge: { cleanup: false },
        nativeKnowledge: {
          spaces: [
            {
              scope: 'hr',
              scopeId: 'handbook',
              title: 'HR handbook',
              relatedUserIds: [],
            },
          ],
          embedding: {
            modelService: 'controlled-embedding',
            model: 'controlled-embedding',
          },
        },
      },
    });
    // Stop only this disposable instance's native scheduled consumption before fixture/browser work.
    // Production rules, scheduler state, retry/lease policy and the native vector worker are untouched.
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
      consoleErrors: string[] = [],
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
    const agents = app.application.container.resolve(agentsToken);
    const service = await agents.models.services.create({
      title: 'Controlled embedding',
      provider: 'openai-compatible',
      apiKey: 'synthetic-key',
      baseUrl: `http://127.0.0.1:${modelAddress.port}/v1`,
      models: [
        { value: 'controlled-embedding', kind: 'embedding', dimensions: 3 },
      ],
    });
    expect(service.name).toBe('controlled-embedding');
    const kb = app.application.container.resolve(knowledgeToken);
    const doc = await kb.docs.create(
      { userId: identity.user.id },
      {
        scope: 'hr',
        scopeId: 'handbook',
        title: 'Native holiday handbook',
        content:
          '# Holiday entitlement\n\nEmployees request holiday through their authorized HR manager. Native knowledge keeps a versioned reference.',
      },
    );
    await expect
      .poll(async () => {
        await agents.vectors.drain();
        return (await kb.indexing.doc({ userId: identity.user.id }, doc.id))
          .state;
      })
      .toBe('done');
    await app.connection.repository('kbDocuments').createOne({
      values: {
        id: 'synthetic-legacy-handbook',
        title: 'HR holiday policy',
        docNo: 'HR-LEAVE-001',
        version: '1.0',
        category: 'policy',
        fileId: 'synthetic-no-file',
        contentText:
          '# Holiday entitlement\n\nThe HR handbook retains its existing approval and document reference.',
        parseStatus: 'ready',
        visibility: 'all',
        ownerUserId: identity.user.id,
        active: true,
        reviewStatus: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    process.env.APP_BASE_PATH = '/main';
    process.env.AGENT_ANNOTATIONS_ENABLED = 'false';
    vite = await createViteServer({
      configFile: path.join(process.cwd(), 'vite.config.ts'),
      base: '/main/',
      cacheDir: path.join(testInfo.outputDir, 'vite-cache'),
      server: { middlewareMode: true, hmr: false },
    });
    process.stdout.write(
      `Knowledge isolated test application Local: ${origin}/main/\n`,
    );
    const client = await app.connection.client<{
      on(event: string, callback: (q: { sql: string }) => void): void;
      removeListener(
        event: string,
        callback: (q: { sql: string }) => void,
      ): void;
    }>();
    const listener = (q: { sql: string }) => pageSql.push(q.sql);
    client.on('query', listener);
    stopMeter = () => client.removeListener('query', listener);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('request', (request) => {
      if (request.url().startsWith(origin + '/main/api/'))
        requests.push(
          request.method() + ' ' + request.url().slice(origin.length),
        );
    });
    await page.goto(origin + '/main/');
    await expect(
      page.getByRole('heading', { name: 'Workbench', exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    const baselineErrors = [...errors];
    const baselineConsole = [...consoleErrors];
    errors.length = 0;
    consoleErrors.length = 0;
    await page
      .getByRole('link', { name: 'Knowledge base', exact: true })
      .click();
    await page
      .getByRole('tab', { name: 'Search sources', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Knowledge base', exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('Search knowledge')).toBeVisible();
    await page.getByLabel('Search knowledge').pressSequentially('holiday');
    const before = requests.filter((r) => r.includes('/kb/search?')).length;
    expect(before).toBe(0);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Native holiday handbook', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /HR holiday policy/ }),
    ).toBeVisible();
    expect(
      requests.filter((r) => r.includes('/kb/search?')).length - before,
    ).toBe(1);
    await page.screenshot({
      path: path.join(root, 'knowledge-dual-source-en.png'),
      fullPage: true,
    });
    await page
      .getByRole('link', { name: 'Native holiday handbook', exact: true })
      .click();
    await expect(
      page.getByText('Native knowledge keeps a versioned reference.', {
        exact: false,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(root, 'knowledge-native-reader-en.png'),
      fullPage: true,
    });
    await page.getByText('Back to source search', { exact: true }).click();
    await page.setViewportSize({ width: 375, height: 900 });
    await page.getByLabel('Search knowledge').fill('holiday');
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(
      page.getByRole('link', { name: 'Native holiday handbook', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: path.join(root, 'knowledge-search-mobile-en.png'),
      fullPage: true,
    });
    await writeFile(
      path.join(root, 'browser-record.json'),
      JSON.stringify(
        {
          origin,
          testOnly: true,
          bootstrapServedByApplication: true,
          nativeScheduleConsumptionStopped: true,
          pageWriteTables: Object.fromEntries(
            [
              ...new Set(
                pageSql
                  .filter((sql) => /^(?:insert|update|delete)\b/iu.test(sql))
                  .map(
                    (sql) =>
                      /^(?:insert into|update|delete from)\s+(?:["`]?[\w]+["`]?\.)?["`]?([\w]+)/iu.exec(
                        sql,
                      )?.[1] ?? 'unknown',
                  ),
              ),
            ].map((table) => [
              table,
              pageSql.filter(
                (sql) =>
                  /^(?:insert|update|delete)\b/iu.test(sql) &&
                  new RegExp('(?:^|["` .])' + table + '(?:["` (]|$)', 'i').test(
                    sql,
                  ),
              ).length,
            ]),
          ),
          pageSql: Object.fromEntries(
            ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
              (verb) => [
                verb,
                pageSql.filter((sql) =>
                  new RegExp('^' + verb + '\\b', 'i').test(sql),
                ).length,
              ],
            ),
          ),
          requests,
          costs,
          embeddings,
          blocked,
          errors,
          consoleErrors,
          baselineErrors,
          baselineConsole,
        },
        null,
        2,
      ),
    );
    expect(blocked).toEqual([]);
    expect(errors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    await context.close();
  } finally {
    if (oldBase === undefined) delete process.env.APP_BASE_PATH;
    else process.env.APP_BASE_PATH = oldBase;
    if (oldAnnotations === undefined)
      delete process.env.AGENT_ANNOTATIONS_ENABLED;
    else process.env.AGENT_ANNOTATIONS_ENABLED = oldAnnotations;
    stopMeter?.();
    await context?.close();
    await vite?.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await app?.close();
    model.closeAllConnections();
    await new Promise<void>((resolve) => model.close(() => resolve()));
    loader.deregister();
  }
});

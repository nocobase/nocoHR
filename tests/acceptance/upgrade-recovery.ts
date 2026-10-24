/** Manual integration drill: pnpm exec tsx tests/acceptance/upgrade-recovery.ts.
 * Owns only synthetic temporary databases/storage. Never load a deployment config or send external messages.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { knowledgeToken } from '@nocobase/app-plugin-knowledge/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.js';
import {
  knowledgeAssistantResource,
  kbDocumentResource,
} from '../../server/providers/hr/learning-resources.js';

const root = path.resolve(import.meta.dirname, '../..');
const rootFiles = await readdir(root);
assert(
  !['.env', '.env.local', 'config.yml', 'config.yaml'].some((name) =>
    rootFiles.includes(name),
  ),
  'Use a tracked-source archive without runtime configuration',
);
const output =
  process.env.UPGRADE_ACCEPTANCE_OUTPUT ??
  (await mkdtemp(path.join(tmpdir(), 'upgrade-evidence-')));
await mkdir(output, { recursive: true });
const work = await mkdtemp(path.join(tmpdir(), 'upgrade-recovery-'));
const password = 'synthetic-upgrade-recovery-password';
const sourceStorage = path.join(work, 'source'),
  restoredStorage = sourceStorage;
await mkdir(sourceStorage, { recursive: true });
let embeddingRequests = 0,
  activeEmbeddings = 0;
const model = createServer(async (req, res) => {
  activeEmbeddings++;
  res.once('close', () => activeEmbeddings--);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw) as {
    input: string[] | string;
    dimensions?: number;
  };
  const input = Array.isArray(body.input) ? body.input : [body.input];
  embeddingRequests++;
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      object: 'list',
      model: 'controlled-embedding',
      data: input.map((_, index) => ({
        object: 'embedding',
        index,
        embedding: Array.from({ length: body.dimensions ?? 3 }, (_, i) =>
          i === 0 ? 1 : 0,
        ),
      })),
      usage: { prompt_tokens: input.length, total_tokens: input.length },
    }),
  );
});
await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
const modelAddress = model.address();
assert(modelAddress && typeof modelAddress !== 'string');
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  TMP: process.env.TMP,
  TEMP: process.env.TEMP,
  NODE_ENV: 'development',
  NOCOBASE_STRICT_STARTUP: 'true',
  APP_BASE_PATH: '/main',
  APP_VITE_DEV_URL: 'false',
  APP_SERVER_HOST: '127.0.0.1',
  HR_DEMO_PASSWORD: password,
  HR_DEMO_SEED: 'true',
  HR_PAYROLL_DEMO: 'false',
  FEISHU_LONG_CONNECTION: 'false',
  APP_PROCESSES_ENABLED: 'false',
  APP_ASSISTANT_ENABLED: 'false',
  AGENT_ANNOTATIONS_ENABLED: 'false',
  APP_SHUTDOWN_TIMEOUT_MS: '30000',
  APP_HTTP_DRAIN_TIMEOUT_MS: '29000',
};
// Seeds read their explicit synthetic password from process.env, never a previously generated account file.
const oldDemoPassword = process.env.HR_DEMO_PASSWORD;
process.env.HR_DEMO_PASSWORD = password;
const relatedUserIds: string[] = [];
const config = {
  auth: {
    secret: randomBytes(32).toString('hex'),
    trustedOrigins: ['http://localhost'],
    baseURL: 'http://localhost/main/api/auth',
  },
  secrets: { keys: [{ version: 1, key: randomBytes(32).toString('base64') }] },
  users: {
    initialAdmin: {
      username: 'nocobase',
      email: 'upgrade-admin@example.invalid',
      password,
    },
  },
  database: {
    default: 'main',
    migrations: { autoRun: true },
    seeds: { autoRun: true },
    connections: { main: { dialect: 'sqlite', filename: '' } },
  },
  i18n: { defaultLocale: 'en-US' },
  talent: { companyName: 'Synthetic Recovery HR' },
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
  knowledge: { cleanup: false },
  nativeKnowledge: {
    spaces: [
      {
        scope: 'hr',
        scopeId: 'alpha',
        title: 'Recovery HR handbook',
        relatedUserIds,
      },
      {
        scope: 'hr',
        scopeId: 'beta',
        title: 'Private recovery space',
        relatedUserIds: [] as string[],
      },
    ],
    embedding: {
      modelService: 'controlled-embedding',
      model: 'controlled-embedding',
    },
  },
};
async function configuration(storage: string, label: string) {
  const file = path.join(work, label + '.json');
  await writeFile(
    file,
    JSON.stringify({
      ...config,
      database: {
        ...config.database,
        connections: {
          main: {
            dialect: 'sqlite',
            filename: path.join(storage, 'database.sqlite'),
          },
        },
      },
    }),
  );
  return file;
}
const SQLite = createRequire(
  createRequire(import.meta.url).resolve(
    '@nocobase/app-plugin-agents/package.json',
  ),
)('better-sqlite3') as new (
  file: string,
  options?: { readonly: boolean },
) => {
  prepare(sql: string): {
    all(): Record<string, unknown>[];
    get(): Record<string, unknown>;
  };
  close(): void;
};
const events: unknown[] = [];
function snapshot(storage: string) {
  const db = new SQLite(path.join(storage, 'database.sqlite'), {
    readonly: true,
  });
  try {
    assert.equal(
      Object.values(db.prepare('PRAGMA integrity_check').get())[0],
      'ok',
    );
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => String(r.name));
    const counts: Record<string, number> = {},
      history: Record<string, string> = {};
    for (const name of tables) {
      counts[name] = Number(
        Object.values(
          db
            .prepare(
              'SELECT count(*) FROM "' + name.replaceAll('"', '""') + '"',
            )
            .get(),
        )[0],
      );
      if (name === '__nocobase_migrations' || name === '__nocobase_seeds')
        history[name] = createHash('sha256')
          .update(
            JSON.stringify(
              db.prepare('SELECT * FROM "' + name + '" ORDER BY name').all(),
            ),
          )
          .digest('hex');
    }
    return { counts, history };
  } finally {
    db.close();
  }
}
async function inventory(
  directory: string,
  prefix = '',
): Promise<Record<string, string>> {
  const items: Record<string, string> = {};
  for (const entry of await readdir(path.join(directory, prefix), {
    withFileTypes: true,
  })) {
    const name = path.join(prefix, entry.name);
    if (entry.isDirectory())
      Object.assign(items, await inventory(directory, name));
    else if (entry.isFile())
      items[name] = createHash('sha256')
        .update(await readFile(path.join(directory, name)))
        .digest('hex');
  }
  return items;
}
async function command(
  label: string,
  args: string[],
  file: string,
  storage: string,
  compiled = false,
) {
  const stream = createWriteStream(path.join(output, label + '.log'));
  const child = spawn(
    compiled ? process.execPath : 'pnpm',
    compiled
      ? [path.join(root, 'dist/cli/index.js'), ...args]
      : ['nocobase', ...args],
    {
      cwd: root,
      env: {
        ...env,
        NODE_ENV: compiled ? 'production' : 'development',
        APP_CONFIG_FILE: file,
        APP_STORAGE_DIR: storage,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  stream.end();
  assert.equal(code, 0, label + ' failed; see its log');
  events.push({ command: label, code });
}
let app: StandaloneServer | undefined, live: ChildProcess | undefined;
async function closeApplication() {
  if (app) {
    await app.close();
    app = undefined;
  }
}
async function open(file: string, storage: string) {
  app = await createStandaloneServer({
    configPath: file,
    viteDevUrl: false,
    env: { ...env, APP_STORAGE_DIR: storage },
  });
  // Test-instance schedule isolation only. Real vector consumption remains active.
  await app.application.container
    .resolve(jobExecutorServiceToken)
    .getScheduleExecutor('@nocobase/app-plugin-scheduler')
    .shutdown();
  return app;
}
function localFetch(server: StandaloneServer): typeof fetch {
  return async (input, init) => {
    requests++;
    return server.fetch(new Request(input, init));
  };
}
async function login(fetcher: typeof fetch, base: string, username: string) {
  const response = await fetcher(base + '/api/auth/sign-in/username', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: new URL(base).origin,
    },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(response.status, 200, 'native sign in ' + username);
  const data = (await response.json()) as { user: { id: string } };
  return {
    cookie: response.headers
      .getSetCookie()
      .map((h) => h.split(';')[0])
      .join('; '),
    id: data.user.id,
  };
}
let requests = 0;
const networkFetch: typeof fetch = async (input, init) => {
  requests++;
  return fetch(input, init);
};
async function api<T>(
  fetcher: typeof fetch,
  base: string,
  target: string,
  cookie = '',
  method = 'GET',
  body?: unknown,
) {
  const response = await fetcher(base + '/api' + target, {
    method,
    headers: {
      cookie,
      origin: new URL(base).origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: (await response.json()) as T };
}
async function measured<T>(label: string, action: () => Promise<T>) {
  assert(app);
  const connection = app.application.container
    .resolve(databaseManagerToken)
    .connection();
  const db = await connection.client<{
    on(event: string, fn: (q: { sql: string }) => void): void;
    removeListener(event: string, fn: (q: { sql: string }) => void): void;
  }>();
  const sql: string[] = [],
    prior = embeddingRequests,
    priorRequests = requests;
  const listener = (q: { sql: string }) => sql.push(q.sql);
  db.on('query', listener);
  try {
    return await action();
  } finally {
    db.removeListener('query', listener);
    events.push({
      label,
      writeTables: sql
        .filter((q) => /^(?:insert|update|delete)\b/iu.test(q))
        .map(
          (q) =>
            /^(?:insert\s+into|update|delete\s+from)\s+(?:["`][^"`]+["`]\.)?["`]?([\w]+)/iu.exec(
              q,
            )?.[1] ?? 'other',
        ),
      httpRequests: requests - priorRequests,
      embeddingRequests: embeddingRequests - prior,
      ...Object.fromEntries(
        ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
          (verb) => [
            verb,
            sql.filter((q) => new RegExp('^' + verb + '\\b', 'iu').test(q))
              .length,
          ],
        ),
      ),
    });
  }
}
async function liveStart(
  mode: 'source' | 'build',
  file: string,
  storage: string,
) {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const address = probe.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((r) => probe.close(() => r()));
  const stream = createWriteStream(path.join(output, mode + '-strict.log'));
  let text = '';
  live = spawn(
    process.execPath,
    mode === 'source'
      ? ['--import', 'tsx', path.join(root, 'server/standalone.ts')]
      : [path.join(root, 'dist/server/standalone.js')],
    {
      cwd: root,
      detached: true,
      env: {
        ...env,
        NODE_ENV: mode === 'build' ? 'production' : 'development',
        APP_CONFIG_FILE: file,
        APP_STORAGE_DIR: storage,
        APP_SERVER_PORT: String(address.port),
        APP_PUBLIC_ORIGIN: 'http://127.0.0.1:' + address.port,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  live.stdout?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    stream.write(chunk);
  });
  live.stderr?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
    stream.write(chunk);
  });
  let url = '';
  for (let n = 0; n < 1200; n++) {
    assert.equal(live.exitCode, null, mode + ' exited before ready');
    const match = /App server listening on (http:\/\/[^\s"\\]+)/u.exec(text);
    if (match) {
      url = match[1].replace(/\/$/u, '') + '/main';
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(url, mode + ' did not print a ready URL');
  const health = await networkFetch(url + '/api/healthz');
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { ok: boolean }).ok, true);
  events.push({ startup: mode, url, strict: true });
  return {
    url,
    async stop() {
      assert(live);
      const started = Date.now();
      const code = await stopChild(live);
      const elapsedMs = Date.now() - started;
      assert.equal(code, 0, mode + ' shutdown failed');
      assert(elapsedMs < 30_000, mode + ' shutdown exceeded the budget');
      assert(
        !/forcing exit|HTTP server did not drain|App server shutdown failed/u.test(
          text,
        ),
        mode + ' used a shutdown fallback',
      );
      stream.end();
      live = undefined;
      events.push({ shutdown: mode, code, elapsedMs, fallback: false });
    },
  };
}
async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null)
    return child.exitCode;
  const stopped = new Promise<number | null>((resolve) =>
    child.once('close', resolve),
  );
  if (child.pid) {
    child.kill('SIGTERM');
  }
  return stopped;
}
try {
  const sourceConfig = await configuration(sourceStorage, 'source');
  await command(
    'initial-preview',
    ['db', 'apply', '--dry-run', '--json'],
    sourceConfig,
    sourceStorage,
  );
  await open(sourceConfig, sourceStorage);
  assert(app);
  const fetcher = localFetch(app),
    base = 'http://localhost/main';
  const admin = await login(fetcher, base, 'nocobase');
  const container = app.application.container;
  const initConnection = container.resolve(databaseManagerToken).connection();
  const assignments = await initConnection.query
    .selectFrom('authorizationPermissionSetAssignments')
    .select(['subjectType', 'subjectId', 'permissionSetKey'])
    .execute();
  assert.deepEqual(
    assignments.filter(
      (row) =>
        ['authenticated', 'everyone'].includes(String(row.subjectType)) &&
        row.subjectId === '*' &&
        row.permissionSetKey !== 'member',
    ),
    [],
  );
  const memberSet = await initConnection.query
    .selectFrom('authorizationPermissionSets')
    .select('grants')
    .where('key', '=', 'member')
    .executeTakeFirstOrThrow();
  let memberGrants: unknown = memberSet.grants;
  while (typeof memberGrants === 'string')
    memberGrants = JSON.parse(memberGrants) as unknown;
  assert.deepEqual(memberGrants, []);
  events.push({
    initializedUserAssignments:
      'no global business role; platform member grants empty',
    organizationSubjects:
      'retained department-head assignment, scoped by native subjects',
  });
  const reader = await container.resolve(userManagementServiceToken).create({
    name: 'Recovery reader',
    username: 'upgrade_reader',
    email: 'upgrade-reader@example.invalid',
    password,
  });
  relatedUserIds.push(reader.id);
  const authz = container.resolve(authorizationToken);
  await authz.permissionSets.create({
    key: 'upgrade-knowledge',
    grants: [
      knowledgeAssistantResource
        .reference()
        .grant({ use: { kbDocuments: 'allRecords' } }),
      kbDocumentResource
        .reference()
        .grant({ view: { kbDocuments: 'allRecords' } }),
      {
        resource: { type: 'kb', id: 'kb.knowledge' },
        actions: [{ action: 'read.related' }],
      },
    ],
  });
  const assignment = await authz.permissionSets.assign({
    subject: { type: 'user', id: reader.id },
    permissionSet: 'upgrade-knowledge',
  });
  const agents = container.resolve(agentsToken),
    kb = container.resolve(knowledgeToken);
  const service = await agents.models.services.create({
    title: 'Controlled embedding',
    provider: 'openai-compatible',
    apiKey: 'synthetic-only',
    baseUrl: 'http://127.0.0.1:' + modelAddress.port + '/v1',
    models: [
      { value: 'controlled-embedding', kind: 'embedding', dimensions: 3 },
    ],
  });
  assert.equal(service.name, 'controlled-embedding');
  const document = await kb.docs.create(
    { userId: admin.id },
    {
      scope: 'hr',
      scopeId: 'alpha',
      title: 'Recovery holiday handbook',
      content: '# Recovery\n\nAuthorized holiday recovery content.',
    },
  );
  const privateDoc = await kb.docs.create(
    { userId: admin.id },
    {
      scope: 'hr',
      scopeId: 'beta',
      title: 'Private payroll recovery',
      content: 'Protected beta payroll body.',
    },
  );
  const attachment = await kb.files.upload(
    { userId: admin.id },
    { scope: 'hr', scopeId: 'alpha', title: 'Recovery attachment' },
    new File(['Authorized recovery attachment bytes.'], 'recovery.txt', {
      type: 'text/plain',
    }),
  );
  await kb.files.idle();
  for (let i = 0; i < 250; i++) {
    await agents.vectors.drain();
    if (
      (
        await Promise.all(
          [document.id, privateDoc.id, attachment.id].map((id) =>
            kb.indexing.doc({ userId: admin.id }, id),
          ),
        )
      ).every((state) => state.state === 'done')
    )
      break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.deepEqual(
    await Promise.all(
      [document.id, privateDoc.id, attachment.id].map(
        async (id) => (await kb.indexing.doc({ userId: admin.id }, id)).state,
      ),
    ),
    ['done', 'done', 'done'],
  );
  await measured('legacy-fixture-insert', () =>
    container
      .resolve(databaseManagerToken)
      .connection()
      .repository('kbDocuments')
      .createOne({
        values: {
          id: 'upgrade-legacy-handbook',
          title: 'Legacy recovery handbook',
          docNo: 'RECOVERY-001',
          version: '1.0',
          category: 'policy',
          fileId: 'synthetic-unused',
          contentText: 'Legacy holiday recovery content.',
          parseStatus: 'ready',
          visibility: 'all',
          ownerUserId: admin.id,
          active: true,
          reviewStatus: 'confirmed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      }),
  );
  await closeApplication();
  await configuration(sourceStorage, 'source');
  const initial = snapshot(sourceStorage);
  await command(
    'source-repeat-apply',
    ['db', 'apply', '--json'],
    sourceConfig,
    sourceStorage,
  );
  await command(
    'source-checksum',
    ['db', 'repair', '--dry-run', '--json'],
    sourceConfig,
    sourceStorage,
  );
  assert.deepEqual(snapshot(sourceStorage).history, initial.history);
  await open(sourceConfig, sourceStorage);
  assert(app);
  const read = localFetch(app);
  const employee = await login(read, base, 'emp_njl_3'),
    manager = await login(read, base, 'mgr_njl');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
  }).format(new Date(Date.now() - 2 * 86400000));
  type Adjustment = {
    data: {
      id: string;
      status: string;
      updatedAt: string;
      approvals: { status: string; decidedAt?: string }[];
    };
  };
  const submitted = await measured('attendance-submit', () =>
    api<Adjustment>(
      read,
      base,
      '/talent/adjustments',
      employee.cookie,
      'POST',
      {
        type: 'missingPunch',
        date,
        reason: 'Synthetic recovery evidence',
        details: { at: date + 'T14:03:00+08:00' },
      },
    ),
  );
  assert.equal(submitted.status, 201);
  const adjustment = submitted.data.data;
  const approved = await measured('attendance-approve', () =>
    api<Adjustment>(
      read,
      base,
      '/talent/adjustments/' + adjustment.id + '/decide',
      manager.cookie,
      'POST',
      {
        decision: 'approved',
        expectedUpdatedAt: adjustment.updatedAt,
        comment: 'Recovery drill approval',
      },
    ),
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.data.data.status, 'approved');
  const replay = await measured('attendance-replay', () =>
    api(
      read,
      base,
      '/talent/adjustments/' + adjustment.id + '/decide',
      manager.cookie,
      'POST',
      { decision: 'approved', expectedUpdatedAt: approved.data.data.updatedAt },
    ),
  );
  assert.equal(replay.status, 403);
  const ordinary = await login(read, base, 'upgrade_reader');
  const searched = await measured('source-dual-search', () =>
    api<{
      data: {
        native: { semantic: string; items: { docId: string }[] };
        legacy: { items: unknown[] };
      };
    }>(read, base, '/talent/kb/search?q=recovery', ordinary.cookie),
  );
  assert.equal(searched.status, 200);
  assert.equal(searched.data.data.native.semantic, 'ready');
  assert(searched.data.data.native.items.some((h) => h.docId === document.id));
  assert(searched.data.data.legacy.items.length > 0);
  assert.equal(
    (await api(read, base, '/knowledge/docs/' + privateDoc.id, ordinary.cookie))
      .status,
    404,
  );
  const attached = await read(
    base + '/api/knowledge/docs/' + attachment.id + '/file',
    { headers: { cookie: ordinary.cookie } },
  );
  assert.equal(attached.status, 200);
  assert.equal(await attached.text(), 'Authorized recovery attachment bytes.');
  await closeApplication();
  const source = await liveStart('source', sourceConfig, sourceStorage);
  const sourceUser = await login(networkFetch, source.url, 'upgrade_reader');
  assert.equal(
    (
      await api(
        networkFetch,
        source.url,
        '/knowledge/docs/' + document.id,
        sourceUser.cookie,
      )
    ).status,
    200,
  );
  await source.stop();
  assert.equal(app, undefined);
  assert.equal(live, undefined);
  assert.equal(activeEmbeddings, 0);
  const stable = await inventory(sourceStorage);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(await inventory(sourceStorage), stable);
  events.push({
    backupPrecondition:
      'known file/index work completed; applications closed; child exited naturally; no active controlled model request; storage hashes stable',
    backgroundOverlapDrain: 'not tested: missing public Scheduler lifecycle',
  });
  const beforeBackup = snapshot(sourceStorage),
    beforeFiles = await inventory(sourceStorage);
  assert(
    Object.keys(beforeFiles).some((name) => name.endsWith('vectors.sqlite')),
  );
  await cp(sourceStorage, path.join(work, 'backup'), { recursive: true });
  // Restore the original logical mount: official vector index targets include the store path.
  await rm(sourceStorage, { recursive: true });
  await cp(path.join(work, 'backup'), restoredStorage, { recursive: true });
  assert.deepEqual(await inventory(restoredStorage), beforeFiles);
  assert.deepEqual(snapshot(restoredStorage), beforeBackup);
  events.push({
    backup: 'quiesced DB, vector store, native files and job state',
    files: Object.keys(beforeFiles).length,
    storageHashes: beforeFiles,
    hashesEqual: true,
    restoredOriginalMount: true,
    recordCounts: beforeBackup.counts,
    sqliteIntegrity: 'ok',
    history: beforeBackup.history,
  });
  const restoredConfig = await configuration(restoredStorage, 'restored');
  await command(
    'build-checksum',
    ['db', 'repair', '--dry-run', '--json'],
    restoredConfig,
    restoredStorage,
    true,
  );
  await command(
    'build-repeat-apply',
    ['db', 'apply', '--json'],
    restoredConfig,
    restoredStorage,
    true,
  );
  assert.deepEqual(snapshot(restoredStorage).history, beforeBackup.history);
  const built = await liveStart('build', restoredConfig, restoredStorage);
  const builtUser = await login(networkFetch, built.url, 'upgrade_reader');
  const builtAdmin = await login(networkFetch, built.url, 'nocobase');
  const restored = await api<Adjustment>(
    networkFetch,
    built.url,
    '/talent/adjustments/' + adjustment.id,
    builtAdmin.cookie,
  );
  assert.equal(restored.status, 200);
  assert.equal(restored.data.data.status, 'approved');
  assert(restored.data.data.approvals.some((s) => s.status === 'approved'));
  assert.equal(
    (
      await api(
        networkFetch,
        built.url,
        '/talent/adjustments/' + adjustment.id + '/decide',
        builtAdmin.cookie,
        'POST',
        {
          decision: 'approved',
          expectedUpdatedAt: restored.data.data.updatedAt,
        },
      )
    ).status,
    403,
  );
  const restoredSearch = await api<typeof searched.data>(
    networkFetch,
    built.url,
    '/talent/kb/search?q=recovery',
    builtUser.cookie,
  );
  assert.equal(restoredSearch.status, 200);
  assert.equal(restoredSearch.data.data.native.semantic, 'ready');
  assert(
    restoredSearch.data.data.native.items.some((h) => h.docId === document.id),
  );
  assert(restoredSearch.data.data.legacy.items.length > 0);
  assert.equal(
    (
      await api(
        networkFetch,
        built.url,
        '/knowledge/docs/' + privateDoc.id,
        builtUser.cookie,
      )
    ).status,
    404,
  );
  const download = await networkFetch(
    built.url + '/api/knowledge/docs/' + attachment.id + '/file',
    { headers: { cookie: builtUser.cookie } },
  );
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'Authorized recovery attachment bytes.');
  if (process.env.UPGRADE_ACCEPTANCE_BROWSER !== 'false') {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        locale: 'en-US',
        viewport: { width: 1440, height: 1080 },
      });
      const external: string[] = [];
      let browserApiRequests = 0;
      context.on('request', (request) => {
        if (new URL(request.url()).pathname.startsWith('/main/api/'))
          browserApiRequests++;
      });
      await context.route('**/*', (route) => {
        if (
          !route
            .request()
            .url()
            .startsWith(built.url.replace('/main', '') + '/')
        ) {
          external.push(new URL(route.request().url()).origin);
          return route.abort();
        }
        return route.continue();
      });
      const signin = await context.request.post(
        built.url + '/api/auth/sign-in/username',
        {
          headers: { origin: new URL(built.url).origin },
          data: { username: 'nocobase', password },
        },
      );
      assert.equal(signin.status(), 200);
      const page = await context.newPage();
      await page.goto(
        built.url + '/talent/approvals/adjustments/' + adjustment.id,
      );
      await page
        .getByText('Recovery drill approval', { exact: true })
        .waitFor();
      await page.screenshot({
        path: path.join(output, 'restored-attendance-approval-en.png'),
        fullPage: true,
      });
      await page.goto(built.url + '/talent/knowledge?tab=search');
      await page.getByRole('button', { name: 'Search', exact: true }).waitFor();
      await page.locator('#knowledge-source-query').fill('recovery');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page
        .getByText('Recovery holiday handbook', { exact: true })
        .first()
        .waitFor();
      await page.screenshot({
        path: path.join(output, 'restored-knowledge-en.png'),
        fullPage: true,
      });
      assert.deepEqual(external, []);
      events.push({ browserApiRequests, externalRequests: external.length });
      await context.close();
    } finally {
      await browser.close();
    }
  } else
    events.push({
      browser: 'reused previously reviewed English pages; no UI change',
    });
  await built.stop();
  // Revocation is checked with a new real source application over the restored data, not a mocked decision.
  await open(restoredConfig, restoredStorage);
  assert(app);
  const restoredFetch = localFetch(app),
    restoredReader = await login(restoredFetch, base, 'upgrade_reader');
  await measured('restored-revoke-fixture', () =>
    app!.application.container
      .resolve(authorizationToken)
      .permissionSets.revoke(assignment.id),
  );
  const refused = await measured('restored-revoked-document', () =>
    api(
      restoredFetch,
      base,
      '/knowledge/docs/' + document.id,
      restoredReader.cookie,
    ),
  );
  assert.equal(refused.status, 404);
  const refusedFile = await measured('restored-revoked-file', () =>
    restoredFetch(base + '/api/knowledge/docs/' + attachment.id + '/file', {
      headers: { cookie: restoredReader.cookie },
    }),
  );
  assert.equal(refusedFile.status, 404);
  await closeApplication();
  assert.deepEqual(snapshot(restoredStorage).history, beforeBackup.history);
  events.push({
    result: 'passed',
    requests,
    embeddingRequests,
    cleanup:
      'all child applications stopped; synthetic databases, backups, config and storage removed',
  });
} catch (error) {
  events.push({ failure: String(error) });
  throw error;
} finally {
  await closeApplication();
  if (live) await stopChild(live);
  await new Promise<void>((resolve) => model.close(() => resolve()));
  if (oldDemoPassword === undefined) delete process.env.HR_DEMO_PASSWORD;
  else process.env.HR_DEMO_PASSWORD = oldDemoPassword;
  await rm(work, { recursive: true, force: true });
  await writeFile(
    path.join(output, 'recovery-results.json'),
    JSON.stringify(events, null, 2),
  );
}
console.log('UPGRADE_RECOVERY_PASSED ' + output);

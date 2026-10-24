// @vitest-environment node
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
  databaseManagerToken,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { createJobExecutorService } from '@nocobase/jobs';
import { ServiceContainer } from '@nocobase/service-provider';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import schedulerPlugin, {
  ScheduleTargetRegistry,
  type JsonObject,
  type ScheduleExecutionCompletion,
  type ScheduleTargetHandle,
  type ScheduleTargetReference,
  type ScheduleTargetType,
} from '@nocobase/app-plugin-scheduler/server';
import { schedulerServiceToken } from '@nocobase/app-plugin-scheduler/server/tokens';
import { authenticationToken } from '@nocobase/app-plugin-authentication/server';
import authorizationPlugin, {
  authorizationToken,
  createAppAuthorization,
} from '@nocobase/app-plugin-authorization/server';
import { Application } from '@nocobase/app-server/application';
import { AppConfig, createAppPaths } from '@nocobase/app-server/config';
import { z } from 'zod';
import { afterEach, expect, it, vi } from 'vitest';
import processesConfig from '../../server/config/processes.js';
import ProcessesProvider from '../../server/providers/processes/provider.js';
import { processHandlers } from '../../server/processes/index.js';
import { createWorkItemStore } from '../../server/providers/hr/work-item-store.js';
import { scopeForUser } from '../../server/providers/hr/authorize.js';
import { registerProcessAuthorization } from '../../server/providers/processes/authorization.js';
import workItemsMigration from '../../database/main/migrations/202609290005_create_work_items.js';
import workItemDetailMigration from '../../database/main/migrations/202610150001_add_work_item_detail.js';

// Synthetic contract only. The production registry stays empty until a real definition is supplied.
vi.mock('../../server/processes/index.js', () => ({
  processHandlers: new Map(),
  processDefinitions: [],
  legacyProcessModules: new Map(),
}));
import m31 from '../../database/main/migrations/202610270031_create_capability_migration_state.js';
import m32 from '../../database/main/migrations/202610270032_create_process_execution_state.js';
import m35 from '../../database/main/migrations/202610270035_create_process_history.js';
import {
  ProcessCatalog,
  writeProcessArtifacts,
} from '../../server/providers/processes/catalog.js';
import {
  ProcessService,
  bindProcessJobs,
} from '../../server/providers/processes/service.js';
import { ProcessHistory } from '../../server/providers/processes/history.js';
import {
  processServiceToken,
  processHistoryToken,
} from '../../server/providers/processes/provider.js';
import { processRoutes } from '../../server/routes/processes.js';
import { capabilityRecordDigest } from '../../server/providers/upgrade/digest.js';
import type { ProcessHandler } from '../../server/providers/processes/engine.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  (processHandlers as Map<string, ProcessHandler>).clear();
});
const workflowId = '9223372036854775700',
  oldRunId = '9223372036854775710';

async function traceCosts(db: Awaited<ReturnType<typeof fixture>>['db']) {
  const statements: string[] = [];
  const client = await db.connection().client<{
    on(event: string, fn: (q: { sql: string }) => void): void;
    removeListener(event: string, fn: (q: { sql: string }) => void): void;
  }>();
  const listener = (query: { sql: string }) => statements.push(query.sql);
  client.on('query', listener);
  cleanups.push(async () => {
    client.removeListener('query', listener);
  });
  return async <T>(operation: string, work: () => Promise<T>) => {
    statements.length = 0;
    const result = await work();
    console.log(
      'PROVIDER_SQL_COST',
      JSON.stringify({
        operation,
        selects: statements.filter((s) => /^select\b/iu.test(s)).length,
        inserts: statements.filter((s) => /^insert\b/iu.test(s)).length,
        updates: statements.filter((s) => /^update\b/iu.test(s)).length,
        deletes: statements.filter((s) => /^delete\b/iu.test(s)).length,
        begins: statements.filter((s) => /^begin\b/iu.test(s)).length,
        savepoints: statements.filter((s) => /^savepoint\b/iu.test(s)).length,
      }),
    );
    return result;
  };
}

async function providerFixture(enabled = true, inherited = false) {
  const f = await fixture();
  const runMigration = async (migration: typeof workItemsMigration) =>
    migration.up!({
      builder: f.db.builder(),
      query: f.db.query(),
      repository: (name: string) => f.db.repository(name),
    } as never);
  for (const plugin of [authorizationPlugin, schedulerPlugin]) {
    const directory = path.resolve(
      plugin.baseDir!,
      plugin.database!.migrations as string,
    );
    for (const filename of (await readdir(directory))
      .filter((name) => /^\d.*\.js$/u.test(name))
      .sort()) {
      await runMigration(
        (await import(pathToFileURL(path.join(directory, filename)).href))
          .default,
      );
    }
  }
  for (const migration of [workItemsMigration, workItemDetailMigration])
    await runMigration(migration);
  const authz = createAppAuthorization({
    database: f.db,
    connection: f.db.connection(),
  });
  authz.subjects.add('user', { filterActive: async (ids) => [...ids] });
  if (inherited)
    authz.settings.add({
      id: 'workflow',
      title: 'Existing workflow title',
      actions: [{ name: 'manage', title: 'Existing manage title' }],
    });
  const workItems = createWorkItemStore(f.db.connection());
  f.handlers.set('save', async ({ actorUserId }) => {
    await workItems.put({
      recipientUserId: actorUserId!,
      type: 'process-test',
      refType: 'test',
      refId: 'synthetic-contract',
      title: 'Synthetic reminder',
      link: '/talent/workbench',
      sourceKind: 'rule',
    });
    f.counts.work++;
    return { saved: true };
  });
  for (const [name, handler] of f.handlers)
    (processHandlers as Map<string, ProcessHandler>).set(name, handler);
  const load = ProcessCatalog.prototype.load;
  vi.spyOn(ProcessCatalog.prototype, 'load').mockImplementation(function () {
    return load.call(this, f.artifacts);
  });
  const configPath = path.join(f.directory, 'process-config.json');
  await writeFile(
    configPath,
    JSON.stringify({ processes: { enabled, scheduleUsers: {} } }),
  );
  const config = new AppConfig();
  config.loadFile(configPath);
  await config.loadAll();
  config.mergeDefaults({
    app: { name: 'process-provider-test', publicBasePath: '/main' },
    processes: processesConfig({} as never),
  });
  config.defineSections(new Map([['processes', processesConfig.rules!]]));
  const app = new Application({
    config,
    paths: createAppPaths({ rootDir: f.directory }),
    websocket: () => ({}) as never,
    strictStartup: true,
  });
  const jobs = createJobExecutorService(
    {
      default: 'test',
      test: {
        adapter: 'memory',
        attempts: 1,
        persistence: { path: path.join(f.directory, 'provider-jobs') },
      },
    },
    { appName: app.appName, storagePath: f.directory },
  );
  const scheduled: import('@nocobase/jobs').ScheduleJob[] = [];
  const original = jobs.getScheduleExecutor.bind(jobs);
  vi.spyOn(jobs, 'getScheduleExecutor').mockImplementation((scope, name) => {
    const executor = original(scope, name);
    return new Proxy(executor, {
      get(target, property) {
        if (property === 'addJob')
          return async (job, registerOnly) => {
            scheduled.push(job);
            return target.addJob(job, registerOnly);
          };
        // Drive captured native firings explicitly, without a wall-clock timer.
        if (property === 'setup') return () => target.setup({ consume: false });
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  app.container.instance(databaseManagerToken, f.db);
  app.container.instance(authorizationToken, authz);
  app.container.instance(jobExecutorServiceToken, jobs);
  app.container.instance(authenticationToken, {
    required: () => async (c, next) => {
      const id = c.req.header('x-user');
      if (!id) return c.json({ error: 'AUTHENTICATION_REQUIRED' }, 401);
      c.set('auth', { user: { id } });
      return next();
    },
  } as never);
  app.addServiceProvider(
    schedulerPlugin.serviceProviders!.find(
      (p) => p.name === 'SchedulerProvider',
    )! as never,
  );
  app.addServiceProvider(ProcessesProvider);
  app.addRoutes(processRoutes);
  cleanups.push(async () => {
    await app.shutdown();
    await jobs.shutdown();
  });
  app.registerProviders();
  const scheduler = app.container.resolve(
    schedulerServiceToken,
  ) as import('@nocobase/app-plugin-scheduler/server/tokens').SchedulerService & {
    listOccurrences(id: string): Promise<{ status: string }[]>;
  };
  if (enabled)
    scheduler.defineSchedule({
      key: 'synthetic-only',
      title: 'Synthetic reminder contract',
      schedule: { cron: '0 0 1 1 *', timezone: 'UTC' },
      target: {
        type: 'app.process',
        config: { key: 'approval', hash: f.hash, input: { allow: true } },
      },
    });
  await app.start();
  const executor = jobs.getJobExecutor('@hr/processes');
  const delegate = async (userId?: string, on = enabled) => {
    await writeFile(
      configPath,
      JSON.stringify({
        processes: {
          enabled: on,
          scheduleUsers: userId ? { [scheduled[0]!.name]: userId } : {},
        },
      }),
    );
    await config.reload();
  };
  const grant = async (user = 'manager') => {
    const key = 'workflow-' + user;
    await authz.permissionSets.create({
      key,
      grants: [authz.settings.grant('workflow', ['manage'])],
    });
    return authz.permissionSets.assign({
      subject: { type: 'user', id: user },
      permissionSet: key,
    });
  };
  const fire = async (event: string) => {
    const now = new Date();
    await scheduled[0]!.execute({
      jobId: event,
      scheduledAt: now,
      runAt: now,
      signal: new AbortController().signal,
    });
  };
  const completed = () =>
    new Promise<string>((resolve) => {
      const unsubscribe = executor.subscribe((event) => {
        if (event.name === 'JobEnd' || event.name === 'JobError') {
          unsubscribe();
          resolve(event.name);
        }
      });
    });
  return {
    ...f,
    authz,
    app,
    jobs,
    executor,
    scheduler,
    scheduled,
    config,
    configPath,
    delegate,
    grant,
    fire,
    completed,
  };
}

it('retains workflow/manage without the retired plugin and does not replace its existing catalog item', async () => {
  const f = await providerFixture(false);
  expect(f.app.container.has(processServiceToken)).toBe(false);
  expect(f.authz.settings.grant('workflow', ['manage'])).toMatchObject({
    resource: { type: 'settings', id: 'workflow' },
  });
  expect(f.config.publicValues()).toEqual({});
  await f.grant();
  const before = await f.db
    .repository('authorizationPermissionSets')
    .findMany();
  const provider = new ProcessesProvider(f.app);
  await provider.boot();
  expect(
    await f.db.repository('authorizationPermissionSets').findMany(),
  ).toEqual(before);
  // Rebuild the authorization service and provider using the saved grants; no retired plugin is loaded.
  const authz = createAppAuthorization({
    database: f.db,
    connection: f.db.connection(),
  });
  authz.subjects.add('user', { filterActive: async (ids) => [...ids] });
  const container = new ServiceContainer();
  container.instance(authorizationToken, authz);
  await new ProcessesProvider({
    container,
    config: { get: () => ({ enabled: false }) },
  } as never).boot();
  const scoped = await scopeForUser(authz, 'manager');
  expect(
    (
      await scoped.authorize({
        resource: { type: 'settings', id: 'workflow' },
        action: 'manage',
      })
    ).effect,
  ).toBe('permit');
});

it('preserves the installed workflow authorization definition while exercising native application lifecycle', async () => {
  const f = await providerFixture(false, true);
  expect(
    f.authz.resourceTypes.get('settings').items!.get('workflow')!.title,
  ).toBe('Existing workflow title');
  await f.app.shutdown();
  await f.app.shutdown();
});

it('runs the actual work-item service once through provider Jobs and native concurrent schedule dispatch', async () => {
  const f = await providerFixture();
  await f.grant();
  await f.delegate('manager');
  const measure = await traceCosts(f.db);
  await measure('provider-native-concurrent-success', async () => {
    const completion = f.completed();
    await Promise.all([f.fire('provider-once'), f.fire('provider-once')]);
    expect(await completion).toBe('JobEnd');
  });
  expect(f.counts.work).toBe(1);
  expect(await f.db.repository('workItems').findMany()).toMatchObject([
    { recipientUserId: 'manager', status: 'open' },
  ]);
  expect(await f.scheduler.listOccurrences(f.scheduled[0]!.name)).toMatchObject(
    [{ status: 'succeeded' }],
  );
  const run = (await f.db.repository('processRuns').findMany())[0]!;
  await measure('provider-terminal-duplicate', () =>
    f.app.container
      .resolve(processServiceToken)
      .execute(String(run.eventKey), new AbortController().signal),
  );
  expect(f.counts.work).toBe(1);
});

it('blocks unbound and unpermitted schedule actors with no business or process writes', async () => {
  const f = await providerFixture();
  await f.grant();
  await expect(f.fire('unbound')).rejects.toThrow(
    'PROCESS_SCHEDULE_NOT_AUTHORIZED',
  );
  await f.delegate('outsider');
  await expect(f.fire('not-permitted')).rejects.toThrow('PROCESS_FORBIDDEN');
  expect(f.counts.work).toBe(0);
  expect(await f.db.repository('workItems').count()).toBe(0);
  expect(await f.db.repository('processRuns').count()).toBe(0);
  expect(await f.scheduler.listOccurrences(f.scheduled[0]!.name)).toMatchObject(
    [{ status: 'failed' }, { status: 'failed' }],
  );
});

it('observes delegation removal and disabled configuration on the next native firing', async () => {
  const f = await providerFixture();
  await f.grant();
  await f.delegate('manager');
  await f.delegate();
  await expect(f.fire('delegation-removed')).rejects.toThrow(
    'PROCESS_SCHEDULE_NOT_AUTHORIZED',
  );
  await f.delegate('manager', false);
  await expect(f.fire('runtime-disabled')).rejects.toThrow(
    'PROCESS_SCHEDULE_NOT_AUTHORIZED',
  );
  expect(f.counts.work).toBe(0);
  expect(await f.db.repository('processRuns').count()).toBe(0);
});

it('rechecks real permission-set revocation between nodes and reports native failure without replay', async () => {
  const f = await providerFixture();
  const assignment = await f.grant();
  await f.delegate('manager');
  (processHandlers as Map<string, ProcessHandler>).set('check', async () => {
    await f.authz.permissionSets.revoke(assignment.id);
    return true;
  });
  const completion = f.completed();
  await f.fire('revoke-between-nodes');
  expect(await completion).toBe('JobError');
  expect(f.counts.work).toBe(0);
  expect(await f.db.repository('workItems').count()).toBe(0);
  expect(await f.db.repository('processNodeRuns').count()).toBe(1);
  expect(await f.scheduler.listOccurrences(f.scheduled[0]!.name)).toMatchObject(
    [{ status: 'failed' }],
  );
  await f.fire('revoke-between-nodes');
  expect(await f.db.repository('processNodeRuns').count()).toBe(1);
});

it('protects application routes with the real authorization service after plugin removal', async () => {
  const f = await providerFixture();
  const call = (user?: string) =>
    f.app.fetch(
      new Request('http://localhost/api/processDefinitions', {
        headers: user ? { 'x-user': user } : {},
      }),
    );
  const measure = await traceCosts(f.db);
  expect((await call()).status).toBe(401);
  expect(
    (await measure('provider-api-denied', () => call('manager'))).status,
  ).toBe(403);
  const assignment = await f.grant();
  expect(
    (await measure('provider-api-definitions', () => call('manager'))).status,
  ).toBe(200);
  expect((await call('outsider')).status).toBe(403);
  await f.authz.permissionSets.revoke(assignment.id);
  expect((await call('manager')).status).toBe(403);
});

it('authorizes manual submission as the signed-in actor and blocks revoked or cross-user writes', async () => {
  const f = await providerFixture();
  const submit = (user?: string, extra = {}) =>
    f.app.fetch(
      new Request('http://localhost/api/processRuns', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(user ? { 'x-user': user } : {}),
        },
        body: JSON.stringify({
          key: 'approval',
          hash: f.hash,
          eventKey: 'manual-business',
          input: { allow: true },
          ...extra,
        }),
      }),
    );
  expect((await submit()).status).toBe(401);
  expect((await submit('manager')).status).toBe(403);
  expect(await f.db.repository('processRuns').count()).toBe(0);
  const assignment = await f.grant();
  expect((await submit('outsider')).status).toBe(403);
  expect((await submit('manager', { actorUserId: 'outsider' })).status).toBe(
    400,
  );
  const completion = f.completed();
  expect((await submit('manager')).status).toBe(202);
  expect(await completion).toBe('JobEnd');
  expect(await f.db.repository('workItems').findMany()).toMatchObject([
    { recipientUserId: 'manager', status: 'open' },
  ]);
  expect(f.counts.work).toBe(1);
  expect((await submit('manager')).status).toBe(202);
  expect(f.counts.work).toBe(1);
  await f.authz.permissionSets.revoke(assignment.id);
  expect(
    (await submit('manager', { eventKey: 'after-revocation' })).status,
  ).toBe(403);
  expect(await f.db.repository('processRuns').count()).toBe(1);
  expect(f.counts.work).toBe(1);
});

it('refuses an incompatible pre-existing workflow authorization resource', () => {
  const authz = createAppAuthorization({});
  authz.settings.add({
    id: 'workflow',
    title: 'Existing workflow',
    actions: [{ name: 'read' }],
  });
  expect(() => registerProcessAuthorization(authz)).toThrow(
    'PROCESS_AUTHORIZATION_CONTRACT_MISMATCH',
  );
  expect(
    authz.resourceTypes.get('settings').items!.get('workflow')!.actions,
  ).toEqual([{ name: 'read' }]);
});

it.each([
  null,
  [],
  { wrong: 'manager' },
  { enabled: true, scheduleUsers: { '': 'manager' } },
  { enabled: true, scheduleUsers: { schedule: '' } },
  { enabled: 'true', scheduleUsers: {} },
])(
  'rejects invalid execution-user configuration without exposing its values',
  async (processes) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'process-config-test-'),
    );
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const configPath = path.join(directory, 'config.json');
    await writeFile(configPath, '{}');
    const config = new AppConfig();
    config.loadFile(configPath);
    await config.loadAll();
    config.mergeDefaults({ processes: processesConfig({} as never) });
    config.defineSections(new Map([['processes', processesConfig.rules!]]));
    await writeFile(configPath, JSON.stringify({ processes }));
    await expect(config.reload()).rejects.toThrow();
    expect(config.get('processes.enabled')).toBe(false);
  },
);

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'process-unit-'));
  const metadataStore = new InMemoryCollectionMetadataStore();
  const db = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({
        filename: path.join(directory, 'db.sqlite'),
        schemaManagement: 'managed',
      }),
    },
    metadataStore,
  });
  await db.connect();
  cleanups.push(async () => {
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  });
  for (const migration of [m31, m32, m35])
    await migration.up!({
      builder: db.builder(),
      query: db.query(),
      repository: (name) => db.repository(name),
    } as never);
  const counts = { work: 0 },
    allowed = new Set(['manager']);
  const authorize = async (id: string) => {
    if (!allowed.has(id)) throw new Error('PROCESS_FORBIDDEN');
  };
  const handlers = new Map<string, ProcessHandler>([
    ['check', async ({ input }) => (input as { allow: boolean }).allow],
    [
      'save',
      async ({ actorUserId }) => {
        expect(actorUserId).toBe('manager');
        counts.work++;
        return { saved: true };
      },
    ],
  ]);
  const definitions = [
    {
      key: 'approval',
      enabled: true,
      inputSchema: z.strictObject({ allow: z.boolean() }),
      entry: 'check',
      nodes: [
        {
          key: 'check',
          type: 'condition' as const,
          handler: 'check',
          yes: 'save',
          no: 'stop',
        },
        { key: 'save', type: 'run' as const, handler: 'save', next: 'done' },
        {
          key: 'done',
          type: 'terminate' as const,
          outcome: 'success' as const,
        },
        { key: 'stop', type: 'terminate' as const, outcome: 'failed' as const },
      ],
    },
  ];
  const artifacts = path.join(directory, 'artifacts');
  await writeProcessArtifacts(artifacts, definitions, handlers);
  const catalog = new ProcessCatalog(handlers);
  await catalog.load(artifacts);
  const hash = catalog.list()[0]!.hash;
  const queued: string[] = [];
  const service = new ProcessService(
    db.connection(),
    catalog,
    handlers,
    authorize,
    async (key) => {
      queued.push(key);
    },
  );
  const history = new ProcessHistory(db.connection(), authorize);
  return {
    directory,
    metadataStore,
    db,
    handlers,
    definitions,
    artifacts,
    catalog,
    hash,
    counts,
    allowed,
    authorize,
    service,
    history,
    queued,
  };
}

async function legacy(f: Awaited<ReturnType<typeof fixture>>) {
  const builder = f.db.builder();
  await builder.createCollection('workflows', (c) => {
    c.bigInt('id').primary();
    c.string('key');
    c.string('hash');
    c.boolean('enabled');
    for (const key of [
      'inputSchema',
      'parametersSchema',
      'parameterValues',
      'client',
      'options',
    ])
      c.json(key);
  });
  await builder.createCollection('workflowNodes', (c) => {
    c.bigInt('id').primary();
    c.bigInt('workflowId');
    for (const key of [
      'key',
      'type',
      'upstreamKey',
      'downstreamKey',
      'branchKey',
    ])
      c.string(key).nullable();
    c.json('config');
    c.json('options');
  });
  await builder.createCollection('workflowRuns', (c) => {
    c.bigInt('id').primary();
    c.bigInt('workflowId');
    for (const key of ['workflowKey', 'hash', 'eventKey']) c.string(key);
    c.integer('status').nullable();
    for (const key of ['input', 'parameters', 'stack', 'output'])
      c.json(key).nullable();
  });
  await builder.createCollection('workflowNodeRuns', (c) => {
    c.bigInt('id').primary();
    c.bigInt('workflowRunId');
    c.bigInt('nodeId');
    c.string('nodeKey');
    c.integer('status');
    c.json('result').nullable();
    c.json('meta').nullable();
  });
  await builder.createCollection('workflowStats', (c) => {
    c.string('key').primary();
    c.bigInt('executed');
  });
  await builder.createCollection('workflowVersionStats', (c) => {
    c.bigInt('id').primary();
    c.bigInt('executed');
  });
  await f.db.repository('workflows').createOne({
    values: {
      id: workflowId,
      key: 'approval',
      hash: 'old-hash',
      enabled: true,
      inputSchema: f.catalog.artifact('approval', f.hash).inputSchema,
      parametersSchema: {},
      parameterValues: {},
      client: {},
      options: { timeout: 0 },
    },
  });
  const nodeRows = [
    {
      key: 'check',
      type: 'condition',
      config: { module: './check' },
      upstreamKey: null,
      downstreamKey: null,
      branchKey: null,
    },
    {
      key: 'save',
      type: 'run',
      config: { module: './save', args: {} },
      upstreamKey: 'check',
      downstreamKey: 'done',
      branchKey: 'yes',
    },
    {
      key: 'done',
      type: 'terminate',
      config: { outcome: 'success' },
      upstreamKey: 'save',
      downstreamKey: null,
      branchKey: null,
    },
    {
      key: 'stop',
      type: 'terminate',
      config: { outcome: 'failure' },
      upstreamKey: 'check',
      downstreamKey: null,
      branchKey: 'no',
    },
  ];
  for (const [i, n] of nodeRows.entries())
    await f.db.repository('workflowNodes').createOne({
      values: { id: String(100 + i), workflowId, options: {}, ...n },
    });
  await f.db.repository('workflowRuns').createOne({
    values: {
      id: oldRunId,
      workflowId,
      workflowKey: 'approval',
      hash: 'old-hash',
      eventKey: 'original-event',
      status: 1,
      input: { allow: true },
      parameters: {},
      stack: null,
      output: { original: '旧结果' },
    },
  });
  for (const [i, key] of ['check', 'save', 'done'].entries())
    await f.db.repository('workflowNodeRuns').createOne({
      values: {
        id: String(200 + i),
        workflowRunId: oldRunId,
        nodeId: String(100 + i),
        nodeKey: key,
        status: 1,
        result: i === 0 ? true : i === 1 ? { saved: 'old' } : null,
        meta: { original: true },
      },
    });
  await f.db
    .repository('workflowStats')
    .createOne({ values: { key: 'approval', executed: '1' } });
  await f.db
    .repository('workflowVersionStats')
    .createOne({ values: { id: workflowId, executed: '1' } });
  const snapshot = async () =>
    capabilityRecordDigest(
      await Promise.all(
        [
          'workflows',
          'workflowNodes',
          'workflowRuns',
          'workflowNodeRuns',
          'workflowStats',
          'workflowVersionStats',
        ].map((n) => f.db.repository(n).findMany()),
      ),
    );
  return {
    modules: new Map([
      ['./check', 'check'],
      ['./save', 'save'],
    ]),
    snapshot,
  };
}

it('loads built artifacts without source, validates input, branches, deduplicates and never replays after restart', async () => {
  const f = await fixture();
  await expect(
    f.service.submit('member', {
      key: 'approval',
      hash: f.hash,
      eventKey: 'one',
      input: { allow: true },
    }),
  ).rejects.toThrow('PROCESS_FORBIDDEN');
  await expect(
    f.service.submit('manager', {
      key: 'approval',
      hash: f.hash,
      eventKey: 'one',
      input: { allow: 'yes' },
    }),
  ).rejects.toThrow('INVALID_PROCESS_INPUT');
  const body = {
    key: 'approval',
    hash: f.hash,
    eventKey: 'one',
    input: { allow: true },
  };
  const [a, b] = await Promise.all([
    f.service.submit('manager', body),
    f.service.submit('manager', body),
  ]);
  expect(a.eventKey).toBe(b.eventKey);
  await Promise.all([
    f.service.execute(a.eventKey, new AbortController().signal),
    f.service.execute(b.eventKey, new AbortController().signal),
  ]);
  expect((await f.service.read('manager', a.eventKey)).status).toBe('success');
  expect(f.counts.work).toBe(1);
  const catalog = new ProcessCatalog(f.handlers);
  await catalog.load(f.artifacts);
  const reopened = new ProcessService(
    f.db.connection(),
    catalog,
    f.handlers,
    f.authorize,
    async () => {
      throw new Error('MUST_NOT_ENQUEUE');
    },
  );
  await reopened.submit('manager', body);
  await reopened.execute(a.eventKey, new AbortController().signal);
  expect(f.counts.work).toBe(1);
  const no = await f.service.submit('manager', {
    ...body,
    eventKey: 'no',
    input: { allow: false },
  });
  await f.service.execute(no.eventKey, new AbortController().signal);
  expect((await f.service.read('manager', no.eventKey)).status).toBe('failed');
  expect(f.counts.work).toBe(1);
  await expect(
    reopened.submit('manager', { ...body, input: { allow: false } }),
  ).rejects.toThrow('PROCESS_EVENT_CONFLICT');
});

it('rejects missing, changed and unknown artifacts before accepting work', async () => {
  const f = await fixture();
  const artifact = f.catalog.artifact('approval', f.hash);
  await expect(new ProcessCatalog(new Map()).load(f.artifacts)).rejects.toThrow(
    'PROCESS_HANDLER_NOT_AVAILABLE',
  );
  await writeFile(
    path.join(f.artifacts, `${f.hash}.json`),
    JSON.stringify({ ...artifact, enabled: false }),
  );
  await expect(
    new ProcessCatalog(f.handlers).load(f.artifacts),
  ).rejects.toThrow('DIGEST_MISMATCH');
  await rm(path.join(f.artifacts, `${f.hash}.json`));
  await expect(
    new ProcessCatalog(f.handlers).load(f.artifacts),
  ).rejects.toThrow();
  expect(await f.db.repository('processRuns').count()).toBe(0);
});

it('preserves terminal old results and exact ids, isolates permission, rolls back and replays without overwriting edits', async () => {
  const f = await fixture(),
    old = await legacy(f),
    before = await old.snapshot();
  await expect(f.history.run('member', oldRunId)).rejects.toThrow(
    'PROCESS_FORBIDDEN',
  );
  expect((await f.history.run('manager', oldRunId)).run).toMatchObject({
    id: oldRunId,
    eventKey: 'original-event',
    output: { original: '旧结果' },
  });
  expect(
    await f.history.copy('manager', workflowId, f.hash, f.catalog, old.modules),
  ).toEqual({ copied: 2, unchanged: 0 });
  expect(await old.snapshot()).toBe(before);
  expect(f.counts.work).toBe(0);
  const row = await f.db
    .repository('processRunHistory')
    .findOne({ filter: { id: oldRunId } });
  await f.db.repository('processRunHistory').updateOne({
    filter: { id: oldRunId },
    values: { snapshot: { ...(row!.snapshot as object), reviewed: true } },
  });
  expect(
    await f.history.copy('manager', workflowId, f.hash, f.catalog, old.modules),
  ).toEqual({ copied: 0, unchanged: 2 });
  expect(
    await new ProcessHistory(f.db.connection(), f.authorize).run(
      'manager',
      oldRunId,
    ),
  ).toMatchObject({ reviewed: true });
  await expect(
    m35.down!({
      builder: f.db.builder(),
      repository: (n) => f.db.repository(n),
    } as never),
  ).rejects.toThrow('PROCESS_HISTORY_NOT_EMPTY');
  // A later target collision rolls back the earlier definition copy and its ledger entry.
  const g = await fixture(),
    gold = await legacy(g);
  await g.db.repository('processDefinitions').createOne({
    values: {
      id: 'collision-parent',
      key: 'other',
      hash: 'other',
      artifactHash: g.hash,
      snapshot: {},
    },
  });
  await g.db.repository('processRunHistory').createOne({
    values: {
      id: oldRunId,
      definitionId: 'collision-parent',
      snapshot: { existing: true },
    },
  });
  await expect(
    g.history.copy('manager', workflowId, g.hash, g.catalog, gold.modules),
  ).rejects.toThrow();
  expect(
    await g.db
      .repository('processDefinitions')
      .findOne({ filter: { id: workflowId } }),
  ).toBeUndefined();
  expect(await g.db.repository('capabilityMigrationLedger').count()).toBe(0);
});

it('blocks active runs, history gaps, unknown mappings and missing artifacts without copying', async () => {
  const f = await fixture(),
    old = await legacy(f);
  await expect(
    f.history.copy('manager', workflowId, f.hash, f.catalog, new Map()),
  ).rejects.toThrow('HANDLER_NOT_MAPPED');
  await expect(
    f.history.copy(
      'manager',
      workflowId,
      '0'.repeat(64),
      f.catalog,
      old.modules,
    ),
  ).rejects.toThrow('MISSING_PROCESS_ARTIFACT');
  await f.db
    .repository('workflowRuns')
    .updateOne({ filter: { id: oldRunId }, values: { status: 0 } });
  await expect(
    f.history.copy('manager', workflowId, f.hash, f.catalog, old.modules),
  ).rejects.toThrow('ACTIVE_OR_UNKNOWN');
  await f.db
    .repository('workflowRuns')
    .updateOne({ filter: { id: oldRunId }, values: { status: 1 } });
  await f.db
    .repository('workflowNodeRuns')
    .updateOne({ filter: { id: '200' }, values: { nodeKey: 'unknown' } });
  await expect(
    f.history.copy('manager', workflowId, f.hash, f.catalog, old.modules),
  ).rejects.toThrow('PROCESS_HISTORY_GAP');
  expect(await f.db.repository('processDefinitions').count()).toBe(0);
  expect(await f.db.repository('capabilityMigrationLedger').count()).toBe(0);
});

it('runs through native Jobs and registers the native Scheduler target and terminal observations', async () => {
  const f = await fixture();
  const jobs = createJobExecutorService(
    {
      default: 'test',
      test: {
        adapter: 'memory',
        attempts: 2,
        persistence: { path: path.join(f.directory, 'jobs') },
      },
    },
    { appName: 'process-test', storagePath: f.directory },
  );
  cleanups.push(() => jobs.shutdown());
  const executor = jobs.getJobExecutor('@hr/processes');
  const targets = new ScheduleTargetRegistry();
  const reports: unknown[] = [];
  const service = new ProcessService(
    f.db.connection(),
    f.catalog,
    f.handlers,
    f.authorize,
    async (k, o) => enqueue(k, o),
  );
  const scheduler = {
    registerTarget(target) {
      targets.register(target);
      return {
        type: target.type,
        async reportCompletion(...args) {
          reports.push(args);
        },
      };
    },
    defineSchedule() {},
  };
  const enqueue = (
    await bindProcessJobs(service, executor, scheduler, (id) =>
      id === 'schedule' ? 'manager' : undefined,
    )
  ).enqueue;
  await executor.setup();
  const completed = new Promise<void>((resolve, reject) => {
    executor.subscribe((e) => {
      if (e.name === 'JobEnd') resolve();
      if (e.name === 'JobError') reject(e.error);
    });
  });
  await expect(
    targets.start(
      'app.process',
      { key: 'approval', hash: f.hash, input: { allow: true } },
      { scheduleId: 'untrusted', occurrenceId: 'not-authorized' },
    ),
  ).rejects.toThrow('PROCESS_SCHEDULE_NOT_AUTHORIZED');
  const accepted = await targets.start(
    'app.process',
    { key: 'approval', hash: f.hash, input: { allow: true } },
    { scheduleId: 'schedule', occurrenceId: 'occurrence' },
  );
  expect(accepted.state).toBe('accepted');
  await completed;
  expect(reports).toHaveLength(1);
  expect(reports[0]).toMatchObject([
    'occurrence',
    { type: 'app.process' },
    { status: 'succeeded' },
  ]);
  if (accepted.state !== 'accepted') throw new Error('Expected accepted');
  expect(
    await targets.inspect('app.process', accepted.reference),
  ).toMatchObject({ state: 'completed', completion: { status: 'succeeded' } });
  await targets.start(
    'app.process',
    { key: 'approval', hash: f.hash, input: { allow: true } },
    { scheduleId: 'schedule', occurrenceId: 'occurrence' },
  );
  expect(f.counts.work).toBe(1);
});

it.each([
  { allow: true, status: 'succeeded', work: 1 },
  { allow: false, status: 'failed', work: 0 },
])(
  'reports a real Scheduler occurrence: $status',
  async ({ allow, status, work }) => {
    const f = await fixture();
    // Load the plugin-declared migration sources rather than reimplementing its tables.
    const migrationDir = path.resolve(
      schedulerPlugin.baseDir!,
      schedulerPlugin.database!.migrations as string,
    );
    for (const file of (await readdir(migrationDir))
      .filter((n) => /^\d.*\.js$/u.test(n))
      .sort()) {
      const { default: migration } = await import(
        pathToFileURL(path.join(migrationDir, file)).href
      );
      await migration.up({
        builder: f.db.builder(),
        query: f.db.query(),
        repository: (n) => f.db.repository(n),
      });
    }
    const jobs = createJobExecutorService(
      {
        default: 'test',
        test: {
          adapter: 'memory',
          attempts: 1,
          persistence: { path: path.join(f.directory, 'native-jobs') },
        },
      },
      { appName: 'native-process-test', storagePath: f.directory },
    );
    cleanups.push(() => jobs.shutdown());
    const scheduled: import('@nocobase/jobs').ScheduleJob[] = [];
    const original = jobs.getScheduleExecutor.bind(jobs);
    let nativeSchedule: ReturnType<typeof original>;
    jobs.getScheduleExecutor = (scope, name) => {
      const executor = original(scope, name);
      nativeSchedule = executor;
      return new Proxy(executor, {
        get(target, prop) {
          if (prop === 'addJob')
            return async (job, registerOnly) => {
              scheduled.push(job);
              return target.addJob(job, registerOnly);
            };
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };
    const container = new ServiceContainer();
    container.instance(databaseManagerToken, f.db);
    container.instance(jobExecutorServiceToken, jobs);
    const Provider = schedulerPlugin.serviceProviders!.find(
      (p) => p.name === 'SchedulerProvider',
    )!;
    const provider = new Provider({
      container,
      appName: 'native-process-test',
      config: { get: () => undefined },
    } as never);
    provider.register!();
    const scheduler = container.resolve(
      schedulerServiceToken,
    ) as import('@nocobase/app-plugin-scheduler/server/tokens').SchedulerService & {
      sync(): Promise<void>;
      activate(): Promise<void>;
      listOccurrences(id: string): Promise<{ status: string }[]>;
    };
    const executor = jobs.getJobExecutor('@hr/processes');
    const service = new ProcessService(
      f.db.connection(),
      f.catalog,
      f.handlers,
      f.authorize,
      async (k, o) => enqueue(k, o),
    );
    const enqueue = (
      await bindProcessJobs(service, executor, scheduler, () => 'manager')
    ).enqueue;
    scheduler.defineSchedule({
      key: 'test-process',
      title: 'Synthetic process schedule',
      schedule: { cron: '0 0 1 1 *', timezone: 'UTC' },
      target: {
        type: 'app.process',
        config: { key: 'approval', hash: f.hash, input: { allow } },
      },
    });
    const sql: string[] = [];
    const client = await f.db.connection().client<{
      on(event: string, fn: (q: { sql: string }) => void): void;
      removeListener(event: string, fn: (q: { sql: string }) => void): void;
    }>();
    const listener = (q: { sql: string }) => sql.push(q.sql);
    client.on('query', listener);
    await scheduler.sync();
    await nativeSchedule!.setup({ consume: false });
    await scheduler.activate();
    await executor.setup();
    const completion = new Promise<void>((resolve, reject) => {
      executor.subscribe((event) => {
        if (event.name === 'JobEnd') resolve();
        if (event.name === 'JobError') reject(event.error);
      });
    });
    expect(scheduled).toHaveLength(1);
    const now = new Date();
    await scheduled[0]!.execute({
      jobId: 'native-occurrence',
      scheduledAt: now,
      runAt: now,
      signal: new AbortController().signal,
    });
    await completion;
    expect(await scheduler.listOccurrences(scheduled[0]!.name)).toMatchObject([
      { status },
    ]);
    expect(f.counts.work).toBe(work);
    client.removeListener('query', listener);
    console.log(
      'NATIVE_SCHEDULER_SQL_COST',
      JSON.stringify({
        status,
        selects: sql.filter((s) => /^select\b/iu.test(s)).length,
        inserts: sql.filter((s) => /^insert\b/iu.test(s)).length,
        updates: sql.filter((s) => /^update\b/iu.test(s)).length,
        begins: sql.filter((s) => /^begin\b/iu.test(s)).length,
      }),
    );
  },
);

it.each([
  { allow: true, status: 'succeeded', work: 1 },
  { allow: false, status: 'failed', work: 0 },
])(
  'recovers a lost Scheduler completion after service reconstruction: $status',
  async ({ allow, status, work }) => {
    type SchedulerTestAccess =
      import('@nocobase/app-plugin-scheduler/server/tokens').SchedulerService & {
        sync(): Promise<void>;
        activate(): Promise<void>;
        listOccurrences(id: string): Promise<
          readonly {
            id: string;
            status: string;
            target: { reference?: ScheduleTargetReference | null };
          }[]
        >;
        reconcileOccurrences(): Promise<number>;
      };
    const f = await fixture();
    const schedulerMigrations = path.resolve(
      schedulerPlugin.baseDir!,
      schedulerPlugin.database!.migrations as string,
    );
    for (const filename of (await readdir(schedulerMigrations))
      .filter((name) => /^\d.*\.js$/u.test(name))
      .sort()) {
      const { default: migration } = await import(
        pathToFileURL(path.join(schedulerMigrations, filename)).href
      );
      await migration.up({
        builder: f.db.builder(),
        query: f.db.query(),
        repository: (name: string) => f.db.repository(name),
      });
    }

    const createJobs = (name: string, persistence: string) =>
      createJobExecutorService(
        {
          default: 'test',
          test: {
            adapter: 'memory',
            attempts: 1,
            persistence: { path: path.join(f.directory, persistence) },
          },
        },
        { appName: name, storagePath: f.directory },
      );
    const createScheduler = (
      name: string,
      jobsService: ReturnType<typeof createJobExecutorService>,
    ) => {
      const container = new ServiceContainer();
      container.instance(databaseManagerToken, f.db);
      container.instance(jobExecutorServiceToken, jobsService);
      const Provider = schedulerPlugin.serviceProviders!.find(
        (provider: { name: string }) => provider.name === 'SchedulerProvider',
      )!;
      new Provider({
        container,
        appName: name,
        config: { get: () => undefined },
      } as never).register!();
      return container.resolve(
        schedulerServiceToken,
      ) as unknown as SchedulerTestAccess;
    };

    const appName = 'native-process-recovery-test';
    const jobs = createJobs(appName, 'native-jobs');
    cleanups.push(() => jobs.shutdown());
    const scheduled: import('@nocobase/jobs').ScheduleJob[] = [];
    const originalGetScheduleExecutor = jobs.getScheduleExecutor.bind(jobs);
    let nativeSchedule:
      ReturnType<typeof originalGetScheduleExecutor> | undefined;
    jobs.getScheduleExecutor = (scope, name) => {
      const executor = originalGetScheduleExecutor(scope, name);
      nativeSchedule = executor;
      return new Proxy(executor, {
        get(target, prop) {
          if (prop === 'addJob')
            return async (
              job: import('@nocobase/jobs').ScheduleJob,
              registerOnly?: boolean,
            ) => {
              scheduled.push(job);
              return target.addJob(job, registerOnly);
            };
          const value = Reflect.get(target, prop);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    };

    const scheduler = createScheduler(appName, jobs);
    const executor = jobs.getJobExecutor('@hr/processes');
    const jobEnqueue: {
      current?: (key: string, occurrence?: string) => Promise<void>;
    } = {};
    let originalHandle: ScheduleTargetHandle | undefined;
    let suppressNextCompletion = true;
    let suppressedCompletions = 0;
    const schedulerBinding: import('@nocobase/app-plugin-scheduler/server/tokens').SchedulerService =
      {
        defineSchedule: (definition) => scheduler.defineSchedule(definition),
        registerTarget<TConfig extends JsonObject>(
          target: ScheduleTargetType<TConfig>,
        ) {
          const handle = scheduler.registerTarget(target);
          originalHandle = handle;
          return {
            type: handle.type,
            async reportCompletion(occurrenceId, reference, completion) {
              if (suppressNextCompletion) {
                suppressNextCompletion = false;
                suppressedCompletions += 1;
                return;
              }
              await handle.reportCompletion(
                occurrenceId,
                reference,
                completion,
              );
            },
          };
        },
      };
    const check = f.handlers.get('check')!;
    let checkExecutions = 0;
    let resumeExecution!: () => void;
    const executionGate = new Promise<void>((resolve) => {
      resumeExecution = resolve;
    });
    f.handlers.set('check', async (input) => {
      checkExecutions += 1;
      await executionGate;
      return check(input);
    });
    cleanups.push(async () => resumeExecution());

    const service = new ProcessService(
      f.db.connection(),
      f.catalog,
      f.handlers,
      f.authorize,
      async (eventKey, occurrenceId) => {
        if (!jobEnqueue.current) throw new Error('PROCESS_JOBS_NOT_STARTED');
        await jobEnqueue.current(eventKey, occurrenceId);
      },
    );
    jobEnqueue.current = (
      await bindProcessJobs(
        service,
        executor,
        schedulerBinding,
        () => 'manager',
      )
    ).enqueue;
    scheduler.defineSchedule({
      key: 'test-process',
      title: 'Synthetic process schedule',
      schedule: { cron: '0 0 1 1 *', timezone: 'UTC' },
      target: {
        type: 'app.process',
        config: { key: 'approval', hash: f.hash, input: { allow } },
      },
    });
    await scheduler.sync();
    await nativeSchedule!.setup({ consume: false });
    await scheduler.activate();
    await executor.setup();

    const processJobFinished = new Promise<void>((resolve, reject) => {
      executor.subscribe((event) => {
        if (event.name === 'JobEnd') resolve();
        if (event.name === 'JobError') reject(event.error);
      });
    });
    expect(scheduled).toHaveLength(1);
    const costs = await traceCosts(f.db);
    const occurrenceId = 'native-recovery-occurrence';
    const now = new Date();
    try {
      await scheduled[0]!.execute({
        jobId: occurrenceId,
        scheduledAt: now,
        runAt: now,
        signal: new AbortController().signal,
      });
      const waiting = await costs(
        'waiting occurrence read before restart',
        () => scheduler.listOccurrences(scheduled[0]!.name),
      );
      expect(waiting).toHaveLength(1);
      expect(waiting[0]).toMatchObject({ id: occurrenceId, status: 'waiting' });
      const reference = waiting[0]!.target.reference;
      expect(reference).toMatchObject({
        type: 'app.process',
        id: expect.any(String),
      });
      if (!reference) throw new Error('Expected a persisted process reference');

      // The completion is released only after Scheduler has saved its accepted reference.
      resumeExecution();
      await processJobFinished;
      expect(suppressedCompletions).toBe(1);
      expect(checkExecutions).toBe(1);
      expect(f.counts.work).toBe(work);

      const restartedJobs = createJobs(appName, 'native-jobs-after-restart');
      cleanups.push(() => restartedJobs.shutdown());
      const restartedExecutor = restartedJobs.getJobExecutor('@hr/processes');
      const restartedScheduler = createScheduler(appName, restartedJobs);
      const restartedCatalog = new ProcessCatalog(f.handlers);
      await restartedCatalog.load(f.artifacts);
      let restartedEnqueues = 0;
      const enqueueAfterRestart: {
        current?: (key: string, occurrence?: string) => Promise<void>;
      } = {};
      const restartedService = new ProcessService(
        f.db.connection(),
        restartedCatalog,
        f.handlers,
        f.authorize,
        async (eventKey, scheduledOccurrenceId) => {
          restartedEnqueues += 1;
          if (!enqueueAfterRestart.current)
            throw new Error('PROCESS_JOBS_NOT_STARTED');
          await enqueueAfterRestart.current(eventKey, scheduledOccurrenceId);
        },
      );
      let restartedHandle: ScheduleTargetHandle | undefined;
      const restartedSchedulerBinding: import('@nocobase/app-plugin-scheduler/server/tokens').SchedulerService =
        {
          defineSchedule: (definition) =>
            restartedScheduler.defineSchedule(definition),
          registerTarget<TConfig extends JsonObject>(
            target: ScheduleTargetType<TConfig>,
          ) {
            restartedHandle = restartedScheduler.registerTarget(target);
            return restartedHandle;
          },
        };
      enqueueAfterRestart.current = (
        await bindProcessJobs(
          restartedService,
          restartedExecutor,
          restartedSchedulerBinding,
          () => 'manager',
        )
      ).enqueue;

      const restored = await costs('reconstructed process status query', () =>
        restartedService.inspect(reference.id),
      );
      expect(restored).toMatchObject({
        state: 'completed',
        completion: { status },
      });
      const recoveredCount = await costs(
        'native Scheduler occurrence reconciliation',
        () => restartedScheduler.reconcileOccurrences(),
      );
      expect(recoveredCount).toBe(1);

      const terminalStatus: ScheduleExecutionCompletion['status'] =
        status === 'succeeded' ? 'succeeded' : 'failed';
      const recoveredOccurrences = await costs(
        'native occurrence state immediately after recovery',
        () => restartedScheduler.listOccurrences(scheduled[0]!.name),
      );
      expect(recoveredOccurrences).toHaveLength(1);
      expect(recoveredOccurrences[0]).toMatchObject({
        id: occurrenceId,
        status,
      });
      expect(recoveredOccurrences[0]!.target.reference).toEqual(reference);
      expect(checkExecutions).toBe(1);
      expect(f.counts.work).toBe(work);
      expect(restartedEnqueues).toBe(0);

      const expected: ScheduleExecutionCompletion = {
        status: terminalStatus,
        result: {
          eventKey: reference.id,
          status: allow ? 'success' : 'failed',
        },
      };
      await costs('late completion report from original target', async () => {
        await originalHandle!.reportCompletion(
          occurrenceId,
          reference,
          expected,
        );
      });
      await costs(
        'duplicate completion report from rebuilt target',
        async () => {
          await restartedHandle!.reportCompletion(
            occurrenceId,
            reference,
            expected,
          );
        },
      );

      const wrongTypeError = await costs(
        'completion report with wrong reference type',
        async () =>
          restartedHandle!
            .reportCompletion(
              occurrenceId,
              { type: 'other.process', id: reference.id },
              {
                ...expected,
                status: terminalStatus === 'succeeded' ? 'failed' : 'succeeded',
              },
            )
            .then(
              () => undefined,
              (error: unknown) => error,
            ),
      );
      expect(wrongTypeError).toMatchObject({ code: 'REFERENCE_MISMATCH' });
      const wrongIdError = await costs(
        'completion report with wrong reference id',
        async () =>
          restartedHandle!
            .reportCompletion(
              occurrenceId,
              { type: reference.type, id: 'replacement-reference' },
              expected,
            )
            .then(
              () => undefined,
              (error: unknown) => error,
            ),
      );
      expect(wrongIdError).toMatchObject({ code: 'REFERENCE_MISMATCH' });
      const conflictError = await costs(
        'completion report with conflicting terminal status',
        async () =>
          restartedHandle!
            .reportCompletion(occurrenceId, reference, {
              ...expected,
              status: terminalStatus === 'succeeded' ? 'failed' : 'succeeded',
            })
            .then(
              () => undefined,
              (error: unknown) => error,
            ),
      );
      expect(conflictError).toMatchObject({ code: 'COMPLETION_CONFLICT' });

      const finalOccurrences = await costs(
        'native occurrence state after late and invalid reports',
        () => restartedScheduler.listOccurrences(scheduled[0]!.name),
      );
      expect(finalOccurrences).toHaveLength(1);
      expect(finalOccurrences[0]).toMatchObject({
        id: occurrenceId,
        status,
      });
      expect(finalOccurrences[0]!.target.reference).toEqual(reference);
      expect(restartedEnqueues).toBe(0);
      expect(checkExecutions).toBe(1);
      expect(f.counts.work).toBe(work);
    } finally {
      resumeExecution();
    }
  },
);

it('protects the actual process API contribution and keeps unrelated routes untouched while disabled', async () => {
  const f = await fixture();
  await legacy(f);
  const container = new ServiceContainer();
  container.instance(processServiceToken, f.service);
  container.instance(processHistoryToken, f.history);
  container.instance(authenticationToken, {
    required: () => async (c, next) =>
      c.req.header('x-user')
        ? next()
        : c.json({ error: { reason: 'AUTHENTICATION_REQUIRED' } }, 401),
  } as never);
  container.instance(authorizationToken, {
    middleware: () => async (c, next) => {
      c.set('authz', {
        identity: { principal: { type: 'user', id: c.req.header('x-user') } },
      });
      await next();
    },
  } as never);
  let enabled = true;
  const router = await processRoutes.createRouter({
    container,
    config: { get: () => ({ enabled }) },
  } as never);
  expect((await router.request('/processDefinitions')).status).toBe(401);
  expect(
    (
      await router.request('/processDefinitions', {
        headers: { 'x-user': 'member' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await router.request('/processHistory/runs/' + oldRunId, {
        headers: { 'x-user': 'member' },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await router.request('/processDefinitions', {
        headers: { 'x-user': 'manager' },
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await router.request('/processRuns', {
        method: 'POST',
        headers: { 'x-user': 'manager', 'content-type': 'application/json' },
        body: JSON.stringify({
          key: 'approval',
          hash: f.hash,
          eventKey: 'bad',
          input: { allow: 'bad' },
        }),
      })
    ).status,
  ).toBe(400);
  const response = await router.request('/processRuns', {
    method: 'POST',
    headers: { 'x-user': 'manager', 'content-type': 'application/json' },
    body: JSON.stringify({
      key: 'approval',
      hash: f.hash,
      eventKey: 'manual',
      input: { allow: true },
    }),
  });
  expect(response.status).toBe(202);
  const { data } = (await response.json()) as { data: { eventKey: string } };
  expect(
    (
      await router.request('/processRuns/' + data.eventKey, {
        headers: { 'x-user': 'member' },
      })
    ).status,
  ).toBe(403);
  enabled = false;
  expect(
    (
      await router.request('/processDefinitions', {
        headers: { 'x-user': 'manager' },
      })
    ).status,
  ).toBe(503);
  expect((await router.request('/unrelated')).status).toBe(404);
});

it('rolls back the empty new schema and reads retained history after database restart without legacy metadata', async () => {
  const empty = await fixture();
  await m35.down!({
    builder: empty.db.builder(),
    repository: (n) => empty.db.repository(n),
  } as never);
  expect(await empty.db.builder().hasCollection('processDefinitions')).toBe(
    false,
  );
  await m35.up!({ builder: empty.db.builder() } as never);
  expect(await empty.db.builder().hasCollection('processDefinitions')).toBe(
    true,
  );
  const f = await fixture();
  await legacy(f);
  await f.db.destroy();
  for (const name of [
    'workflows',
    'workflowNodes',
    'workflowRuns',
    'workflowNodeRuns',
    'workflowStats',
    'workflowVersionStats',
  ]) {
    const stored = await f.metadataStore.get(name);
    if (stored)
      await f.metadataStore.delete(name, { expectedRevision: stored.revision });
  }
  const db = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({
        filename: path.join(f.directory, 'db.sqlite'),
        schemaManagement: 'managed',
      }),
    },
    metadataStore: f.metadataStore,
  });
  await db.connect();
  cleanups.push(() => db.destroy());
  const history = new ProcessHistory(db.connection(), f.authorize);
  expect((await history.run('manager', oldRunId)).run).toMatchObject({
    id: oldRunId,
    output: { original: '旧结果' },
  });
  expect(
    (await history.definition('manager', workflowId)).workflow,
  ).toMatchObject({ id: workflowId, key: 'approval' });
});

it('rechecks permission in queued work and leaves an occupied node untouched after restart', async () => {
  const f = await fixture();
  const request = {
    key: 'approval',
    hash: f.hash,
    eventKey: 'permission',
    input: { allow: true },
  };
  const run = await f.service.submit('manager', request);
  f.allowed.clear();
  await expect(
    f.service.execute(run.eventKey, new AbortController().signal),
  ).rejects.toThrow('PROCESS_FORBIDDEN');
  expect(f.counts.work).toBe(0);
  f.allowed.add('manager');
  expect((await f.service.read('manager', run.eventKey)).status).toBe('failed');
  const lost = await f.service.submit('manager', {
    ...request,
    eventKey: 'lost',
  });
  await f.service.store.claim(lost.eventKey, 'check');
  const reopened = new ProcessService(
    f.db.connection(),
    f.catalog,
    f.handlers,
    f.authorize,
    async () => undefined,
  );
  expect(
    (await reopened.execute(lost.eventKey, new AbortController().signal))
      ?.status,
  ).toBe('running');
  expect(f.counts.work).toBe(0);
});

it('records actual SQL costs for process submission, execution, history copy and replay', async () => {
  const f = await fixture(),
    old = await legacy(f);
  const statements: string[] = [];
  const client = await f.db.connection().client<{
    on(event: string, cb: (q: { sql: string }) => void): void;
    removeListener(event: string, cb: (q: { sql: string }) => void): void;
  }>();
  const listener = (q: { sql: string }) => statements.push(q.sql);
  client.on('query', listener);
  const measure = async (name: string, work: () => Promise<unknown>) => {
    statements.length = 0;
    const result = await work();
    console.log(
      'PROCESS_SQL_COST',
      JSON.stringify({
        operation: name,
        selects: statements.filter((s) => /^select\b/iu.test(s)).length,
        inserts: statements.filter((s) => /^insert\b/iu.test(s)).length,
        updates: statements.filter((s) => /^update\b/iu.test(s)).length,
        begins: statements.filter((s) => /^begin\b/iu.test(s)).length,
        savepoints: statements.filter((s) => /^savepoint\b/iu.test(s)).length,
      }),
    );
    return result;
  };
  try {
    await measure('legacy-definition', () =>
      f.history.definition('manager', workflowId),
    );
    await measure('legacy-run', () => f.history.run('manager', oldRunId));
    await measure('history-copy', () =>
      f.history.copy('manager', workflowId, f.hash, f.catalog, old.modules),
    );
    await measure('history-replay', () =>
      f.history.copy('manager', workflowId, f.hash, f.catalog, old.modules),
    );
    expect(
      statements.filter((s) => /^(insert|update|delete)\b/iu.test(s)),
    ).toHaveLength(0);
    await measure('copied-run', () => f.history.run('manager', oldRunId));
    const body = {
      key: 'approval',
      hash: f.hash,
      eventKey: 'measured',
      input: { allow: true },
    };
    const run = (await measure('submit', () =>
      f.service.submit('manager', body),
    )) as { eventKey: string };
    await measure('execute-three-nodes', () =>
      f.service.execute(run.eventKey, new AbortController().signal),
    );
    await measure('duplicate-event', () => f.service.submit('manager', body));
    expect(
      statements.filter((s) => /^(insert|update|delete)\b/iu.test(s)),
    ).toHaveLength(0);
    await measure('run-read', () => f.service.read('manager', run.eventKey));
  } finally {
    client.removeListener('query', listener);
  }
});

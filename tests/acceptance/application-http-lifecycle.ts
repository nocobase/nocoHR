/** Manual real-listener drill; isolated synthetic config only. No production shutdown changes. */
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { databaseManagerToken } from '@nocobase/db';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import {
  createStandaloneRuntimeScope,
  startNodeAppServer,
  type ClosableNodeAppServer,
} from '@nocobase/app-server/node';
import { createPublicBasePathAdapter } from '@nocobase/app-server/runtime';
import { createStandaloneServer } from '../../server/standalone.js';
import { createServer } from '../../server/embedded.js';

const root = path.resolve(import.meta.dirname, '../..');
const rootFiles = await readdir(root);
assert(
  !['.env', '.env.local', 'config.yml', 'config.yaml'].some((name) =>
    rootFiles.includes(name),
  ),
  'Use a tracked-source archive without runtime configuration',
);
const password = 'synthetic-http-lifecycle-password';
const endpoint = '/main/api/talent/me/profile-change';
type Event = { phase: string; at: number; [key: string]: unknown };
function emit(phase: string, detail: Record<string, unknown> = {}) {
  process.send?.({ phase, at: Date.now(), ...detail });
}

async function child(mode: string, work: string) {
  const file = path.join(work, 'synthetic.json');
  await writeFile(
    file,
    JSON.stringify({
      auth: { secret: randomBytes(32).toString('hex') },
      secrets: {
        keys: [{ version: 1, key: randomBytes(32).toString('base64') }],
      },
      users: {
        initialAdmin: {
          username: 'nocobase',
          email: 'http@example.invalid',
          password,
        },
      },
      database: {
        default: 'main',
        migrations: { autoRun: true },
        seeds: { autoRun: true },
        connections: {
          main: { dialect: 'sqlite', filename: path.join(work, 'main.sqlite') },
        },
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
      knowledge: { cleanup: false },
    }),
  );
  const options = {
    rootDir: root,
    configPath: file,
    env: {
      APP_CONFIG_FILE: file,
      APP_STORAGE_DIR: path.join(work, 'storage'),
      APP_BASE_PATH: '/main',
      APP_PUBLIC_ORIGIN: 'http://localhost',
      APP_SHUTDOWN_TIMEOUT_MS: '30000',
      NOCOBASE_STRICT_STARTUP: 'true',
      HR_DEMO_PASSWORD: password,
      HR_DEMO_SEED: 'true',
      HR_PAYROLL_DEMO: 'false',
      FEISHU_LONG_CONNECTION: 'false',
      APP_PROCESSES_ENABLED: 'false',
      APP_ASSISTANT_ENABLED: 'false',
      AGENT_ANNOTATIONS_ENABLED: 'false',
    },
  };
  process.env.HR_DEMO_PASSWORD = password;
  const scope =
    mode === 'embedded-host'
      ? createStandaloneRuntimeScope(options)
      : undefined;
  const standalone = scope
    ? undefined
    : await createStandaloneServer({ ...options, viteDevUrl: false });
  const application = standalone?.application ?? (await createServer(scope!));
  const mounted =
    standalone ??
    createPublicBasePathAdapter(application, application.publicBasePath);
  // Calendar isolation is a fixture prerequisite, not a production drain guarantee. One-off Jobs stay active.
  await application.container
    .resolve(jobExecutorServiceToken)
    .getScheduleExecutor('@nocobase/app-plugin-scheduler')
    .shutdown();
  const connection = application.container
    .resolve(databaseManagerToken)
    .connection();
  const sql = await connection.client<{
    on(event: string, fn: (q: { sql: string }) => void): void;
  }>();
  const verbs: Record<string, number> = {};
  let measuring = false;
  sql.on('query', ({ sql }) => {
    if (!measuring) return;
    const verb = /^\s*(\w+)/u.exec(sql)?.[1].toLowerCase() ?? 'other';
    verbs[verb] = (verbs[verb] ?? 0) + 1;
  });
  let committed = false;
  // Observe only the public server contract; use the unmodified app and official listener/signal handlers.
  const observed: ClosableNodeAppServer = {
    fetch: async (...args) => {
      const response = await mounted.fetch(...args);
      if (
        new URL(args[0].url).pathname === endpoint &&
        args[0].method === 'POST'
      ) {
        if (response.status !== 201)
          emit('business.rejected', {
            status: response.status,
            error: await response.clone().json(),
          });
        assert.equal(response.status, 201);
        const body = (await response.clone().json()) as {
          data: { id: string };
        };
        const row = await connection.query
          .selectFrom('profileChangeRequests')
          .select(['id', 'status'])
          .where('id', '=', body.data.id)
          .executeTakeFirstOrThrow();
        assert.equal(row.status, 'pending');
        committed = true;
        emit('business.committed', { status: row.status });
      }
      return response;
    },
    close: async () => {
      emit('dependencies.begin', { committed, sql: verbs });
      await (standalone ? standalone.close() : scope!.destroy());
      emit('dependencies.done');
      process.disconnect();
      assert(
        committed,
        'dependency cleanup started before the business write completed',
      );
    },
  };
  const listener = await startNodeAppServer(observed, {
    hostname: '127.0.0.1',
    port: 0,
    forceExitTimeoutMs: 30_000,
    httpDrainTimeoutMs: 29_000,
    logger: {
      error: (message) => {
        emit('shutdown.error', { message });
        console.error(message);
      },
    },
  });
  listener.on('request', (req, res) => {
    if (req.url === endpoint && req.method === 'POST') {
      measuring = true;
      emit('business.accepted');
      res.once('finish', () => emit('business.response.finished'));
    }
  });
  process.once('SIGTERM', () => emit('signal.observed'));
  const address = listener.address();
  assert(address && typeof address !== 'string');
  emit('ready', { port: address.port, mode });
}

async function parent() {
  const output =
    process.env.UPGRADE_ACCEPTANCE_OUTPUT ??
    (await mkdtemp(path.join(tmpdir(), 'http-evidence-')));
  await mkdir(output, { recursive: true });
  const results = [];
  for (const mode of ['standalone', 'embedded-host']) {
    const work = await mkdtemp(path.join(tmpdir(), 'http-lifecycle-'));
    const events: Event[] = [];
    const log = createWriteStream(path.join(output, mode + '.log'));
    const env = Object.fromEntries(
      ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP'].map((key) => [
        key,
        process.env[key],
      ]),
    );
    const worker = fork(import.meta.filename, ['--child', mode, work], {
      execArgv: ['--import', 'tsx'],
      cwd: root,
      env: { ...env, NODE_ENV: 'development' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    worker.stdout!.pipe(log, { end: false });
    worker.stderr!.pipe(log, { end: false });
    worker.on('message', (message) => events.push(message as Event));
    let signalled = false;
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      worker.once('close', (code, signal) => resolve({ code, signal }));
    });
    async function wait(phase: string) {
      for (let i = 0; i < 1200; i++) {
        const event = events.find((e) => e.phase === phase);
        if (event) return event;
        assert.equal(worker.exitCode, null, 'child exited before ' + phase);
        await delay(100);
      }
      assert.fail('phase not reached: ' + phase);
    }
    try {
      const ready = await wait('ready');
      const port = Number(ready.port),
        origin = 'http://127.0.0.1:' + port;
      const login = await fetch(origin + '/main/api/auth/sign-in/username', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({ username: 'emp_njl_2', password }),
      });
      assert.equal(login.status, 200);
      await login.json();
      const cookie = login.headers
        .getSetCookie()
        .map((h) => h.split(';')[0])
        .join('; ');
      const schema = await fetch(origin + '/main/api/swagger', {
        headers: { cookie },
      });
      assert.equal(schema.status, 200);
      await schema.json();
      const body = JSON.stringify({ changes: { mobile: '13911112222' } });
      let responseStatus = 0;
      const req = request(origin + endpoint, {
        method: 'POST',
        agent: false,
        headers: {
          cookie,
          origin: 'http://localhost',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      });
      const response = new Promise<void>((resolve, reject) => {
        req.once('error', reject);
        req.once('response', (res) => {
          responseStatus = res.statusCode ?? 0;
          res.resume();
          res.once('end', resolve);
          res.once('error', reject);
        });
      });
      req.write(body.slice(0, -1));
      await wait('business.accepted');
      const signalledAt = Date.now();
      signalled = true;
      assert(worker.kill('SIGTERM')); // Exactly one signal. No escalation on failure.
      await wait('signal.observed');
      let refused = false;
      for (let i = 0; i < 40 && !refused; i++) {
        refused = await new Promise<boolean>((resolve) => {
          const socket = connect(port, '127.0.0.1');
          socket.once('error', (error) =>
            resolve((error as NodeJS.ErrnoException).code === 'ECONNREFUSED'),
          );
          socket.once('connect', () => {
            socket.end();
            resolve(false);
          });
        });
        if (!refused) await delay(25);
      }
      assert(refused, 'listener still admits new connections');
      assert(!events.some((e) => e.phase === 'dependencies.begin'));
      events.push({ phase: 'new.connection.refused', at: Date.now() });
      req.end(body.slice(-1));
      await response;
      assert.equal(responseStatus, 201);
      const exit = await exited;
      assert.equal(exit.code, 0);
      assert.equal(exit.signal, null);
      const phases = events.map((e) => e.phase);
      assert(
        phases.indexOf('business.committed') <
          phases.indexOf('business.response.finished'),
      );
      assert(
        phases.indexOf('business.response.finished') <
          phases.indexOf('dependencies.begin'),
      );
      assert(phases.includes('dependencies.done'));
      assert(!phases.includes('shutdown.error'));
      assert(Date.now() - signalledAt < 30_000);
      results.push({
        mode,
        exit,
        signalCount: 1,
        shutdownMs: Date.now() - signalledAt,
        responseStatus,
        events,
      });
    } finally {
      // Preserve errors; cleanup uses at most the same single signal, never escalation.
      if (!signalled && worker.exitCode === null && worker.signalCode === null)
        worker.kill('SIGTERM');
      await exited;
      log.end();
      await writeFile(
        path.join(output, mode + '-events.json'),
        JSON.stringify(events, null, 2),
      );
      await rm(work, { recursive: true, force: true });
    }
  }
  await writeFile(
    path.join(output, 'http-results.json'),
    JSON.stringify({ passed: true, results }, null, 2),
  );
  console.log('HTTP_LIFECYCLE_PASSED', output);
}
if (process.argv[2] === '--child')
  await child(process.argv[3], process.argv[4]);
else await parent();

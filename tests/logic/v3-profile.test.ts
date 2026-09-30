// @vitest-environment node

// Acceptance checks for V3-11 (画像、联动与内容维护) on the 启衡精密 demo data: business-data ingest and matching,
// training recommendations with the 8D write-back, level suggestions, profile summaries, finding people, the team
// dashboard, monthly reports, rule drafting, version revisions and change training, the question-quality check,
// audit exports and permissions. Each run boots the real standalone server on a throwaway SQLite database with
// migrations and seeds; no model is configured, so every AI job takes its rule-based fallback.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

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

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'v3-profile-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
let writeback: Server;
const received: { body: Json; signature: string | undefined }[] = [];
let failWriteback = true;
const cookies = new Map<string, string>();
let apiKey = '';

async function signIn(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached) return cached;
  const response = await server.fetch(
    new Request(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status, `sign in ${username}`).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  cookies.set(username, cookie);
  return cookie;
}

async function send(
  headers: Record<string, string>,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Json; bytes: Uint8Array; type: string }> {
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent${url}`}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  );
  const type = response.headers.get('content-type') ?? '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  let json: Json = {};
  if (type.includes('json') && bytes.length)
    json = JSON.parse(Buffer.from(bytes).toString('utf8')) as Json;
  return { status: response.status, json, bytes, type };
}

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (username) headers.cookie = await signIn(username);
  return send(headers, method, url, body);
}

async function push(body: unknown) {
  return send({ 'x-api-key': apiKey }, 'POST', '/signals:ingest', body);
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function userId(username: string): Promise<string> {
  const row = await (
    await db()
  )
    .query()
    .selectFrom('user')
    .select('id')
    .where('username', '=', username)
    .executeTakeFirst();
  return String(row?.id);
}

async function notified(key: string) {
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  const notifications = server.application.container.resolve(
    notificationServiceToken,
  );
  return notifications.getByIdempotencyKey(`hr:${key}`);
}

async function profile() {
  const { profileServicesToken } =
    await import('../../server/providers/hr/tokens.ts');
  return server.application.container.resolve(profileServicesToken);
}

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 15_000,
) {
  const start = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    value = await read();
  }
  return value;
}

const decode = (value: unknown): any => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      break;
    }
  }
  return v;
};

const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());

function addWorkingDays(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

async function textFile(name: string, text: string): Promise<string> {
  const { driveManagerToken } = await import('@nocobase/app-server/drive');
  const container = server.application.container;
  const key = `test/${Date.now()}-${name}`;
  await (
    container.resolve(driveManagerToken) as unknown as {
      use(disk: string): { put(key: string, contents: string): Promise<void> };
    }
  )
    .use('local')
    .put(key, text);
  const id = (await import('node:crypto')).randomUUID();
  const now = new Date();
  await (
    await db()
  )
    .query()
    .insertInto('hrFiles')
    .values({
      id,
      disk: 'local',
      key,
      filename: name,
      ext: 'md',
      mimeType: 'text/markdown',
      size: text.length,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

const QI_0457 = {
  sourceSystem: 'qms',
  externalId: 'QI-2026-0457',
  signalType: 'qualityIssue',
  category: '首件检验',
  severity: 'major',
  title: '夜班换刀后首件尺寸超差',
  summary: '夜班换刀后未做首件检验，孔径超差 8 件。',
  occurredAt: new Date().toISOString(),
  personKey: 'QH2003',
  correctiveActionRef: '8D-2026-0088',
  班次: '夜班',
};

beforeAll(async () => {
  writeback = createServer((request, response) => {
    let data = '';
    request.on('data', (chunk) => (data += chunk));
    request.on('end', () => {
      received.push({
        body: JSON.parse(data || '{}') as Json,
        signature: request.headers['x-nocohr-signature'] as string | undefined,
      });
      response.statusCode = failWriteback ? 500 : 200;
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) =>
    writeback.listen(0, '127.0.0.1', resolve),
  );
  const port = (writeback.address() as { port: number }).port;
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v3-profile-'));
  const config = path.join(directory, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      auth: { secret: 'test-auth-secret-at-least-32-characters' },
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
      talentProfile: {
        writebackUrl: `http://127.0.0.1:${port}/8d`,
        writebackSecret: 'test-writeback-secret',
      },
    }),
  );
  process.env.HR_DEMO_PASSWORD = PASSWORD;
  process.env.HR_PAYROLL_DEMO = 'false';
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
  // The integration account's key, issued as an administrator would (never written to the repository).
  const { ApiKeyService } =
    await import('@nocobase/app-plugin-api-keys/server');
  const { authenticationToken } =
    await import('@nocobase/app-plugin-authentication');
  const service = new ApiKeyService(
    server.application.container.resolve(authenticationToken),
    'default',
  );
  apiKey = (
    await service.create({
      userId: await userId('integration_qms'),
      name: 'qms-test',
    })
  ).secret;
  // 班次, added on the interface by hr01 (custom-fields.ts must list businessSignals for the settings page).
  const now = new Date();
  await (
    await db()
  )
    .query()
    .insertInto('customFieldDefinitions')
    .values({
      id: 'cf-signal-shift',
      collection: 'businessSignals',
      key: 'cf_shift',
      label: { 'zh-CN': '班次', 'en-US': 'Shift' },
      type: 'text',
      options: [],
      required: false,
      defaultValue: null,
      placements: ['detail', 'list', 'filter', 'export'],
      sensitive: false,
      aiReadable: true,
      sortOrder: 0,
      active: true,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
}, 240_000);

afterAll(async () => {
  await server?.close();
  await new Promise<void>((resolve) => writeback?.close(() => resolve()));
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_PAYROLL_DEMO;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function signalRow(externalId: string) {
  return (await db())
    .query()
    .selectFrom('businessSignals')
    .selectAll()
    .where('externalId', '=', externalId)
    .execute();
}

async function recommendations() {
  return (await db())
    .query()
    .selectFrom('trainingRecommendations')
    .selectAll()
    .execute();
}

describe('V3-11 data ingest and matching', () => {
  it('matches a pushed record once and updates it on a repeat; no recommendation below the threshold', async () => {
    const setting = await call(
      'hr01',
      'PATCH',
      '/automations/talentAnalyst.trainingCheck',
      {
        params: { clusterMinCount: 3 },
      },
    );
    expect(setting.status).toBe(200);
    const first = await push(QI_0457);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ created: 1, updated: 0 });
    expect(first.json.data.results[0].matchStatus).toBe('matched');
    const [row] = await signalRow('QI-2026-0457');
    expect(row).toMatchObject({
      employeeId: 'emp-qianjin',
      competencyId: 'comp-cnc',
      departmentId: 'sz-mc',
      matchStatus: 'matched',
    });
    expect(decode(row.customFields)).toMatchObject({ cf_shift: '夜班' });
    const again = await push({ items: [QI_0457] });
    expect(again.json.data).toMatchObject({ created: 0, updated: 1 });
    expect(await signalRow('QI-2026-0457')).toHaveLength(1);
    // The training check ran (twice) and found no cluster of three.
    const runs = await until(
      async () =>
        (await db())
          .query()
          .selectFrom('aiTaskRuns')
          .selectAll()
          .where('task', '=', 'talentAnalyst.trainingCheck')
          .execute(),
      (r) => r.filter((x) => x.status !== 'running').length >= 2,
    );
    expect(runs.every((r) => r.status === 'skipped')).toBe(true);
    expect(await recommendations()).toHaveLength(0);
  });

  it('refuses the integration account everything but ingest, and it cannot sign in', async () => {
    expect(
      (await send({ 'x-api-key': apiKey }, 'GET', '/signals')).status,
    ).toBe(403);
    expect(
      (await send({ 'x-api-key': apiKey }, 'GET', '/employees')).status,
    ).toBe(403);
    expect(
      (await send({ 'x-api-key': apiKey }, 'GET', '/team-dashboard')).status,
    ).toBe(403);
    const signInAttempt = await server.fetch(
      new Request(`${base}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: 'integration_qms',
          password: PASSWORD,
        }),
      }),
    );
    expect(signInAttempt.status).not.toBe(200);
    // An employee cannot push.
    expect(
      (await call('emp_njl_1', 'POST', '/signals:ingest', QI_0457)).status,
    ).toBe(403);
    // Validation: the batch limit and a bad record.
    const tooMany = await push(Array.from({ length: 501 }, () => ({})));
    expect(tooMany.status).toBe(400);
    expect(tooMany.json.code).toBe('SIGNAL_BATCH_TOO_LARGE');
    const bad = await push([
      { ...QI_0457, externalId: 'QI-BAD', signalType: 'nope' },
    ]);
    expect(bad.json.data.results[0]).toMatchObject({
      status: 'error',
      error: 'SIGNAL_TYPE_INVALID',
    });
  });

  it('lists an unmatched person for HR, who assigns the employee; the custom field shows in the list and export', async () => {
    const list = await call('hr01', 'GET', '/signals?matchStatus=unmatched');
    const unmatched = list.json.data.items.find(
      (s: Json) => s.externalId === 'QI-2026-0440',
    );
    expect(unmatched).toMatchObject({
      matchStatus: 'unmatchedPerson',
      personKey: 'QH2998',
    });
    expect(list.json.data.fields.map((f: Json) => f.label)).toContain('班次');
    const all = await call('hr01', 'GET', '/signals');
    expect(
      all.json.data.items.find((s: Json) => s.externalId === 'QI-2026-0457')
        .customFields.cf_shift,
    ).toBe('夜班');
    // hr.admin sees the raw payload; a head does not.
    expect(all.json.data.items[0].rawPayload).toBeDefined();
    const head = await call('mgr_njl', 'GET', '/signals');
    expect(head.status).toBe(200);
    expect(
      head.json.data.items.every((s: Json) => s.rawPayload === undefined),
    ).toBe(true);
    expect(
      head.json.data.items.some((s: Json) => s.externalId === 'QI-2026-0463'),
    ).toBe(false);
    expect(
      (
        await call('mgr_njl', 'POST', `/signals/${unmatched.id}/match`, {
          employeeId: 'emp-limin',
        })
      ).status,
    ).toBe(403);
    const assigned = await call(
      'hr01',
      'POST',
      `/signals/${unmatched.id}/match`,
      { employeeId: 'emp-sunli' },
    );
    expect(assigned.json.data).toMatchObject({
      matchStatus: 'matched',
      employeeId: 'emp-sunli',
    });
    const exported = await call('hr01', 'GET', '/signals/export');
    expect(exported.status).toBe(200);
    const XLSX = await import('xlsx');
    const sheet = XLSX.read(exported.bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      sheet.Sheets[sheet.SheetNames[0]],
      { header: 1 },
    );
    expect(rows[0]).toContain('班次');
    expect(
      rows.some((r) => r.includes('QI-2026-0457') && r.includes('夜班')),
    ).toBe(true);
  });
});

describe('V3-11 training recommendations', () => {
  let recommendationId = '';

  it('recommends targeted training for two first-article issues in 90 days, with content by the coach', async () => {
    await call('hr01', 'PATCH', '/automations/talentAnalyst.trainingCheck', {
      params: { clusterMinCount: 2 },
    });
    await push(QI_0457);
    const rows = await until(recommendations, (r) =>
      r.some((x) => x.status === 'draft'),
    );
    const cnc = rows.filter(
      (r) => r.departmentId === 'sz-mc' && r.competencyId === 'comp-cnc',
    );
    expect(cnc).toHaveLength(1);
    recommendationId = String(cnc[0].id);
    expect(cnc[0].status).toBe('draft');
    expect(cnc[0].reviewerUserId).toBe(await userId('mgr_njl'));
    const evidence = decode(cnc[0].evidence) as Json[];
    expect(evidence.map((e) => e.externalId).sort()).toEqual([
      'QI-2026-0412',
      'QI-2026-0457',
    ]);
    expect(decode(cnc[0].correctiveActionRefs)).toEqual(['8D-2026-0088']);
    const audience = (decode(cnc[0].audience) as Json[])
      .map((a) => a.employeeId)
      .sort();
    // 机加工车间's active employees whose position requires CNC 设备操作.
    const expected = await (
      await db()
    )
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('departmentId', '=', 'sz-mc')
      .where('positionId', '=', 'pos-cnc-operator')
      .where('status', '!=', 'leave')
      .execute();
    expect(audience).toEqual(expected.map((e) => String(e.id)).sort());
    expect(audience).toEqual(
      expect.arrayContaining([
        'emp-limin',
        'emp-liuyang',
        'emp-qianjin',
        'emp-wanglei',
      ]),
    );
    const items = decode(cnc[0].items) as Json[];
    expect(items.map((i) => i.id)).toEqual(
      expect.arrayContaining([
        'course-cnc-intro',
        'scenario-first-article-check',
        'exam-cnc-cert',
      ]),
    );
    expect(items.at(-1)!.type).toBe('exam');
    // 成都机加工车间 has one record only (赵阳): nothing there.
    expect(rows.some((r) => r.departmentId === 'cd-mc')).toBe(false);
    expect(
      await notified(`recommendation:${recommendationId}:pending`),
    ).toBeTruthy();
    const mine = await call(
      'mgr_njl',
      'GET',
      '/training-recommendations?status=open',
    );
    expect(mine.json.data.items.map((i: Json) => i.id)).toContain(
      recommendationId,
    );
    const counts = await call('mgr_njl', 'GET', '/decisions/counts');
    expect(counts.json.data.recommendations).toBeGreaterThanOrEqual(1);
    // Another head does not see it.
    const other = await call('mgr_cd', 'GET', '/training-recommendations');
    expect(other.json.data.items.map((i: Json) => i.id)).not.toContain(
      recommendationId,
    );
  });

  it('assigns the items to the remaining people when mgr_njl approves with one removed', async () => {
    const approved = await call(
      'mgr_njl',
      'POST',
      `/training-recommendations/${recommendationId}/approve`,
      {
        removeEmployeeIds: ['emp-liuyang'],
      },
    );
    expect(approved.status).toBe(200);
    expect(approved.json.data.status).toBe('approved');
    const tasks = await (
      await db()
    )
      .query()
      .selectFrom('assignments')
      .selectAll()
      .where('trainingRecommendationId', '=', recommendationId)
      .execute();
    const people = new Set(tasks.map((t) => t.employeeId));
    expect(people.has('emp-liuyang')).toBe(false);
    for (const id of ['emp-limin', 'emp-qianjin', 'emp-wanglei'])
      expect(people.has(id)).toBe(true);
    const created = tasks.filter((t) => t.source === 'recommendation');
    expect(created.length).toBeGreaterThan(0);
    expect(
      created.every(
        (t) => t.assignedByUserId === approved.json.data.reviewerUserId,
      ),
    ).toBe(true);
    // Another record of the same kind while it is open: no second recommendation.
    await push({
      ...QI_0457,
      externalId: 'QI-2026-0470',
      personKey: 'QH2001',
      severity: 'minor',
      班次: '白班',
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(
      (await recommendations()).filter(
        (r) => r.departmentId === 'sz-mc' && r.competencyId === 'comp-cnc',
      ),
    ).toHaveLength(1);
  });

  it('completes with a proof, pushes the 8D write-back and lets HR retry a failure', async () => {
    const database = await db();
    await database
      .query()
      .updateTable('assignments')
      .set({ status: 'completed', progress: 100, completedAt: new Date() })
      .where('trainingRecommendationId', '=', recommendationId)
      .execute();
    const services = await profile();
    expect(
      await services.decisions.checkCompletion([recommendationId]),
    ).toEqual([recommendationId]);
    const [row] = await database
      .query()
      .selectFrom('trainingRecommendations')
      .selectAll()
      .where('id', '=', recommendationId)
      .execute();
    expect(row.status).toBe('completed');
    expect(row.certificateFileId).toBeTruthy();
    expect(row.writebackStatus).toBe('failed');
    expect(received.at(-1)!.body.correctiveActionRefs).toEqual([
      '8D-2026-0088',
    ]);
    expect(String(received.at(-1)!.body.proofUrl)).toContain(
      `/training-recommendations/${recommendationId}/proof`,
    );
    expect(received.at(-1)!.signature).toMatch(/^[0-9a-f]{64}$/u);
    const failures = await call('hr01', 'GET', '/signals/writeback-failures');
    expect(failures.json.data.map((f: Json) => f.id)).toContain(
      recommendationId,
    );
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          `/training-recommendations/${recommendationId}/retry-writeback`,
        )
      ).status,
    ).toBe(403);
    failWriteback = false;
    const retried = await call(
      'hr01',
      'POST',
      `/training-recommendations/${recommendationId}/retry-writeback`,
    );
    expect(retried.json.data.writebackStatus).toBe('succeeded');
    const proof = await call(
      'mgr_njl',
      'GET',
      `/training-recommendations/${recommendationId}/proof`,
    );
    expect(proof.type).toContain('pdf');
    const { pdfText } =
      await import('../../server/providers/hr/profile/pdf.ts');
    const text = pdfText(proof.bytes);
    expect(text).toContain('专项培训证明');
    expect(text).toContain('钱进');
    expect(text).toContain('V1');
  });
});

describe('V3-11 level suggestions', () => {
  it('suggests 钱进 3 → 2 and 高原 2 → 3 with evidence; no duplicates on a second run', async () => {
    const run = await call(
      'hr01',
      'POST',
      '/automations/talentAnalyst.levelSuggestions/run',
    );
    expect(run.json.data.status).toBe('succeeded');
    const rows = await (
      await db()
    )
      .query()
      .selectFrom('competencySuggestions')
      .selectAll()
      .execute();
    const qianjin = rows.find(
      (r) => r.employeeId === 'emp-qianjin' && r.competencyId === 'comp-cnc',
    )!;
    expect(qianjin).toMatchObject({
      currentLevel: 3,
      suggestedLevel: 2,
      status: 'draft',
      reviewerUserId: await userId('mgr_njl'),
    });
    const evidence = (decode(qianjin.evidence) as Json[])
      .map((e) => e.id)
      .sort();
    expect(evidence).toEqual(
      ['signal-qi-2026-0301', (await signalRow('QI-2026-0457'))[0].id].sort(),
    );
    expect(String(qianjin.rationale)).toContain('夜班');
    expect(rows.some((r) => r.employeeId === 'emp-wanglei')).toBe(false);
    const gaoyuan = rows.find((r) => r.employeeId === 'emp-sales-gaoyuan')!;
    expect(gaoyuan).toMatchObject({
      currentLevel: 2,
      suggestedLevel: 3,
      reviewerUserId: await userId('mgr_sales'),
    });
    expect(
      (decode(gaoyuan.evidence) as Json[]).map((e) => e.type).sort(),
    ).toEqual(['examAttempt', 'signal', 'signal']);
    expect(rows.some((r) => r.employeeId === 'emp-sales-linfeng')).toBe(false);
    // The assessments did not change.
    const levels = await (
      await db()
    )
      .query()
      .selectFrom('employeeCompetencies')
      .selectAll()
      .where('employeeId', '=', 'emp-qianjin')
      .where('competencyId', '=', 'comp-cnc')
      .execute();
    expect(levels.every((l) => !l.suggestionId)).toBe(true);
    expect(
      await notified(
        `competencySuggestions:${run.json.data.runId}:${await userId('mgr_njl')}`,
      ),
    ).toBeTruthy();
    await call(
      'hr01',
      'POST',
      '/automations/talentAnalyst.levelSuggestions/run',
    );
    expect(
      await (
        await db()
      )
        .query()
        .selectFrom('competencySuggestions')
        .selectAll()
        .execute(),
    ).toHaveLength(rows.length);
  });

  it('writes the head’s decided level as an assessment in the head’s name', async () => {
    const list = await call(
      'mgr_njl',
      'GET',
      '/competency-suggestions?status=open',
    );
    const suggestion = list.json.data.items.find(
      (i: Json) => i.employeeId === 'emp-qianjin',
    );
    expect(
      list.json.data.items.some(
        (i: Json) => i.employeeId === 'emp-sales-gaoyuan',
      ),
    ).toBe(false);
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          `/competency-suggestions/${suggestion.id}/reject`,
          {},
        )
      ).json.code,
    ).toBe('SUGGESTION_REJECT_REASON_REQUIRED');
    const accepted = await call(
      'mgr_njl',
      'POST',
      `/competency-suggestions/${suggestion.id}/accept`,
      { level: 3, note: '保持 3 级，先观察夜班设备' },
    );
    expect(accepted.json.data).toMatchObject({
      status: 'accepted',
      decidedLevel: 3,
    });
    const [assessment] = await (
      await db()
    )
      .query()
      .selectFrom('employeeCompetencies')
      .selectAll()
      .where('suggestionId', '=', suggestion.id)
      .execute();
    expect(assessment).toMatchObject({
      level: 3,
      source: 'assessment',
      assessedBy: await userId('mgr_njl'),
    });
    const sales = await call(
      'mgr_sales',
      'GET',
      '/competency-suggestions?status=open',
    );
    const gaoyuan = sales.json.data.items.find(
      (i: Json) => i.employeeId === 'emp-sales-gaoyuan',
    );
    expect(
      (
        await call(
          'mgr_sales',
          'POST',
          `/competency-suggestions/${gaoyuan.id}/accept`,
          {},
        )
      ).json.data.decidedLevel,
    ).toBe(3);
    const view = await call(
      'mgr_sales',
      'GET',
      '/competency/employees/emp-sales-gaoyuan',
    );
    const target = (view.json.data.targets as Json[]).find(
      (t) => t.targetPositionTitle === '销售解决方案经理',
    );
    const row = (target?.rows as Json[] | undefined)?.find(
      (r) => r.title === '解决方案设计与报价',
    );
    if (row) expect(row.gap).toBe(0);
    const employee = await (
      await db()
    )
      .query()
      .selectFrom('employees')
      .select(['positionId'])
      .where('id', '=', 'emp-sales-gaoyuan')
      .executeTakeFirst();
    expect(employee?.positionId).toBe('pos-sales-engineer');
  });
});

describe('V3-11 profile, finding people and the dashboard', () => {
  it('shows 王磊 a summary with evidence and no descriptions, and the timeline carries QI-2026-0412', async () => {
    const hr = await call('hr01', 'GET', '/profiles/emp-wanglei/summary');
    expect(hr.status).toBe(200);
    expect(hr.json.data.summary.length).toBeLessThanOrEqual(150);
    expect(hr.json.data.sentences.length).toBeGreaterThan(0);
    expect(
      hr.json.data.sentences.every((s: Json) => s.evidence.length > 0),
    ).toBe(true);
    expect(hr.json.data.summary).not.toContain('端面跳动超差');
    // A gap's competency keeps its full name, spaces included.
    expect(hr.json.data.summary).not.toMatch(/（[^）]*安全生产与）/u);
    if (String(hr.json.data.summary).includes('项未达标'))
      expect(hr.json.data.summary).toMatch(/项未达标（[^）]+）/u);
    expect(hr.json.data.canRegenerate).toBe(true);
    const own = await call('emp_njl_1', 'GET', '/profiles/me/summary');
    expect(own.json.data.summary).toBe(hr.json.data.summary);
    expect(own.json.data.canRegenerate).toBe(false);
    expect(
      (await call('emp_njl_1', 'GET', '/profiles/emp-qianjin/summary')).status,
    ).toBe(404);
    expect(
      (await call('emp_njl_1', 'POST', '/profiles/me/summary/regenerate'))
        .status,
    ).toBe(403);
    const timeline = await call('emp_njl_1', 'GET', '/profiles/me/timeline');
    const record = (timeline.json.data as Json[]).find(
      (e) => e.kind === 'signal' && String(e.title).includes('QI-2026-0412'),
    );
    expect(record).toMatchObject({ competencyTitle: 'CNC 设备操作' });
    expect(JSON.stringify(timeline.json.data)).not.toContain(
      '端面跳动超差 12 件',
    );
    const regenerated = await call(
      'mgr_njl',
      'POST',
      '/profiles/emp-wanglei/summary/regenerate',
    );
    expect(regenerated.status).toBe(200);
  });

  it('refreshes the summaries of people with new data in the last 7 days only', async () => {
    const database = await db();
    const read = async (id: string) =>
      (
        await database
          .query()
          .selectFrom('employees')
          .select(['aiSummaryAt'])
          .where('id', '=', id)
          .executeTakeFirst()
      )?.aiSummaryAt;
    await (await profile()).insights.generateTemplate('emp-wumin');
    const before = await read('emp-wumin');
    const run = await call(
      'hr01',
      'POST',
      '/automations/talentAnalyst.summaryRefresh/run',
    );
    expect(run.json.data.status).toBe('succeeded');
    expect(run.json.data.output.employeeIds).toContain('emp-qianjin');
    expect(await read('emp-qianjin')).toBeTruthy();
    expect(run.json.data.output.employeeIds).not.toContain('emp-wumin');
    expect(String(await read('emp-wumin'))).toBe(String(before));
  });

  it('finds 顾强 for mgr_east from one sentence, with the parsed conditions and reasons', async () => {
    const found = await call('mgr_east', 'POST', '/find-people/parse', {
      text: '苏州工厂持 CNC 岗位上岗证、近半年没有质量问题、CNC 设备操作 4 级以上的人',
    });
    expect(found.status).toBe(200);
    expect(found.json.data.conditions.departmentIds).toContain('sz');
    expect(found.json.data.conditions.certifications[0].certificationId).toBe(
      'cert-cnc',
    );
    expect(found.json.data.conditions.competencies[0]).toMatchObject({
      competencyId: 'comp-cnc',
      minLevel: 4,
    });
    // The demo's hit (the specification names 李敏, whose data other steps' demos keep as it is).
    expect(found.json.data.results.map((r: Json) => r.name)).toEqual(['顾强']);
    expect(found.json.data.results[0].reasons.length).toBeGreaterThanOrEqual(3);
    const strict = await call('mgr_east', 'POST', '/find-people/search', {
      conditions: {
        ...found.json.data.conditions,
        competencies: [
          { competencyId: 'comp-cnc', minLevel: 5, maxLevel: null },
        ],
      },
    });
    expect(strict.json.data.results).toHaveLength(0);
    expect(strict.json.data.strictest.label).toContain('CNC 设备操作');
    expect(
      (await call('emp_njl_1', 'POST', '/find-people/parse', { text: 'CNC' }))
        .status,
    ).toBe(403);
  });

  it('shows mgr_njl his workshop only, matching the profile data', async () => {
    const dashboard = await call('mgr_njl', 'GET', '/team-dashboard');
    expect(dashboard.status).toBe(200);
    const names = (dashboard.json.data.certMatrix.rows as Json[]).map(
      (r) => r.name,
    );
    expect(names).toEqual(
      expect.arrayContaining(['王磊', '李敏', '钱进', '刘洋']),
    );
    expect(names).not.toContain('赵阳');
    const qianjin = (dashboard.json.data.certMatrix.rows as Json[]).find(
      (r) => r.name === '钱进',
    );
    expect(qianjin.cells[0].state).toBe('expiring');
    const liuyang = (dashboard.json.data.certMatrix.rows as Json[]).find(
      (r) => r.name === '刘洋',
    );
    expect(liuyang.cells[0].state).toBe('missing');
    expect(dashboard.json.data.trend.series.length).toBeGreaterThan(0);
    const exported = await call('mgr_njl', 'GET', '/team-dashboard/export');
    expect(exported.status).toBe(200);
    expect((await call('emp_njl_1', 'GET', '/team-dashboard')).status).toBe(
      403,
    );
  });

  it('sends each head one monthly report with group numbers only, and hr01 the company summary', async () => {
    const run = await call(
      'hr01',
      'POST',
      '/automations/talentAnalyst.monthlyReport/run',
    );
    expect(run.json.data.status).toBe('succeeded');
    const reports = run.json.data.output.reports as Json[];
    const byUser = new Map(reports.map((r) => [r.userId, r]));
    const mgrNjl = byUser.get(await userId('mgr_njl'))!;
    expect(mgrNjl.sent).toBe(true);
    expect(mgrNjl.text).toContain('专项培训');
    const cd = byUser.get(await userId('mgr_cd'))!;
    expect(cd.text).toContain('夜班 35%');
    expect(cd.text).toContain('白班 15%');
    expect(cd.text).toContain('“班车”被提到 4 次');
    // Every hire of the cohort has left: nobody extra is on duty in 成都机加工车间.
    const onDuty = await (
      await db()
    )
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('id', 'like', 'emp-cd-new-%')
      .where('status', '!=', 'leave')
      .execute();
    expect(onDuty).toHaveLength(0);
    expect(cd.text).not.toMatch(/赵阳|吴敏/u);
    expect(run.json.data.output.company.sent).toBe(true);
    const month = today().slice(0, 7);
    expect(
      await notified(`talentReport:${month}:${await userId('mgr_cd')}`),
    ).toBeTruthy();
    const second = await call(
      'hr01',
      'POST',
      '/automations/talentAnalyst.monthlyReport/run',
    );
    expect(
      (second.json.data.output.reports as Json[]).every((r) => !r.sent),
    ).toBe(true);
  });

  it('drafts a rule for 设备故障 and re-matches QI-2026-0439 once hr01 confirms it', async () => {
    const run = await call(
      'hr01',
      'POST',
      '/automations/talentAnalyst.ruleDrafting/run',
    );
    expect(run.json.data.status).toBe('succeeded');
    const rules = await call('hr01', 'GET', '/signal-rules');
    const draft = (rules.json.data as Json[]).find(
      (r) => r.category === '设备故障',
    );
    expect(draft).toMatchObject({ reviewStatus: 'draft', source: 'ai' });
    expect(await notified(`signalRules:${run.json.data.runId}`)).toBeTruthy();
    expect(
      (await call('mgr_njl', 'POST', `/signal-rules/${draft.id}/confirm`, {}))
        .status,
    ).toBe(403);
    await call('hr01', 'POST', `/signal-rules/${draft.id}/confirm`, {});
    const [row] = await signalRow('QI-2026-0439');
    expect(row.matchStatus).toBe('matched');
    expect(row.competencyId).toBe(draft.competencyId);
  });
});

describe('V3-11 version revisions and change training', () => {
  let newDocumentId = '';
  let briefId = '';

  it('drafts the change note, a change brief and suggestions for 4.3 and 4.4 when V4.1 is ready', async () => {
    const { DEMO_UPLOAD_MATERIALS } =
      await import('../../database/seed-data/demo-learning.ts');
    const v41 = DEMO_UPLOAD_MATERIALS.find((m) =>
      m.filename.includes('WI-MC-0231'),
    )!;
    const fileId = await textFile('wi-mc-0231-v4.1.md', v41.content);
    const version = await call(
      'trainer01',
      'POST',
      '/kb/documents/doc-wi-mc-0231/versions',
      { fileId, version: 'V4.1' },
    );
    expect(version.status).toBe(201);
    newDocumentId = version.json.data.id;
    const services = await profile();
    void services;
    await until(
      async () =>
        (await db())
          .query()
          .selectFrom('aiTaskRuns')
          .selectAll()
          .where('task', '=', 'contentWriter.versionRevision')
          .execute(),
      (r) => r.some((x) => x.status === 'succeeded'),
      30_000,
    );
    const document = (
      await call('hr01', 'GET', `/revisions/documents/${newDocumentId}`)
    ).json.data;
    expect(document.changeNote).toContain('4.3');
    expect(document.brief).toBeTruthy();
    briefId = document.brief.id;
    const lessons = await (
      await db()
    )
      .query()
      .selectFrom('lessons')
      .select(['title', 'sourceExcerpt'])
      .where('courseId', '=', briefId)
      .orderBy('sortOrder', 'asc')
      .execute();
    expect(lessons).toHaveLength(3);
    expect(lessons[0].title).toContain('4.3');
    expect(lessons[1].title).toContain('4.4');
    expect(lessons[2].title).toContain('自测');
    const groups = (
      await call('trainer01', 'GET', `/revisions?documentId=${newDocumentId}`)
    ).json.data as Json[];
    const revisions = groups.flatMap((g) => g.revisions as Json[]);
    const byTarget = new Map(revisions.map((r) => [r.targetId, r]));
    expect(
      byTarget.get('course-cnc-intro-l2') ??
        revisions.find(
          (r) => r.targetType === 'lesson' && r.courseId === 'course-cnc-intro',
        ),
    ).toBeTruthy();
    expect(byTarget.get('q-cnc-01')?.proposed.answer).toBe('B');
    expect(byTarget.get('q-cnc-08')?.proposed.answer).toBe(false);
    expect(byTarget.get('scenario-first-article-check')).toBeTruthy();
    expect(revisions.every((r) => String(r.explanation).includes('V4.1'))).toBe(
      true,
    );
    expect(revisions.some((r) => String(r.sectionTitle).includes('5.1'))).toBe(
      false,
    );
    expect(groups[0].affectedEstimate).toBeGreaterThanOrEqual(3);
    expect(await notified(`revision:${newDocumentId}:auto`)).toBeTruthy();
  });

  it('refuses a stale suggestion and applies a course’s accepted lessons as version 2', async () => {
    const database = await db();
    const groups = (
      await call('trainer01', 'GET', `/revisions?documentId=${newDocumentId}`)
    ).json.data as Json[];
    const revisions = groups.flatMap((g) => g.revisions as Json[]);
    const stale = revisions.find((r) => r.targetId === 'q-cnc-08')!;
    await database
      .query()
      .updateTable('questions')
      .set({ explanation: '讲师手工修改。', updatedAt: new Date() })
      .where('id', '=', 'q-cnc-08')
      .execute();
    expect(
      (await call('trainer01', 'POST', `/revisions/${stale.id}/accept`, {}))
        .json.code,
    ).toBe('REVISION_STALE');
    const question = revisions.find((r) => r.targetId === 'q-cnc-01')!;
    expect(
      (await call('trainer01', 'POST', `/revisions/${question.id}/accept`, {}))
        .json.data.status,
    ).toBe('applied');
    const answer = await database
      .query()
      .selectFrom('questions')
      .select(['answer', 'reviewStatus', 'sourceDocumentId'])
      .where('id', '=', 'q-cnc-01')
      .executeTakeFirst();
    expect(decode(answer?.answer)).toBe('B');
    expect(answer).toMatchObject({
      reviewStatus: 'confirmed',
      sourceDocumentId: newDocumentId,
    });
    for (const lesson of revisions.filter(
      (r) => r.courseId === 'course-cnc-intro',
    ))
      expect(
        (await call('trainer01', 'POST', `/revisions/${lesson.id}/accept`, {}))
          .status,
      ).toBe(200);
    const applied = await call(
      'trainer01',
      'POST',
      '/revisions/courses/course-cnc-intro/apply',
    );
    expect(applied.json.data.version).toBe(2);
    const course = await database
      .query()
      .selectFrom('courses')
      .selectAll()
      .where('id', '=', 'course-cnc-intro')
      .executeTakeFirst();
    expect(course).toMatchObject({
      version: 2,
      sourceDocumentId: newDocumentId,
      reviewStatus: 'confirmed',
    });
    const lesson = await database
      .query()
      .selectFrom('lessons')
      .select(['content'])
      .where('courseId', '=', 'course-cnc-intro')
      .where('sortOrder', '=', 1)
      .executeTakeFirst();
    expect(String(lesson?.content)).toContain('10 分钟');
    const done = await database
      .query()
      .selectFrom('assignments')
      .select(['id'])
      .where('employeeId', '=', 'emp-wanglei')
      .where('courseId', '=', 'course-cnc-intro')
      .where('status', '=', 'completed')
      .execute();
    expect(done.length).toBeGreaterThan(0);
    const history = await call(
      'trainer01',
      'GET',
      '/revisions/courses/course-cnc-intro/history',
    );
    expect(history.json.data[0].version).toBe(2);
  });

  it('assigns the published brief to the affected people with a working-day deadline; 刘洋 is not one', async () => {
    expect(
      (
        await call('hr01', 'PATCH', `/revisions/briefs/${briefId}`, {
          revisionDueDays: 3,
        })
      ).json.data.revisionDueDays,
    ).toBe(3);
    expect(
      (await call('trainer01', 'POST', `/courses/${briefId}/confirm`)).status,
    ).toBe(200);
    expect(
      (
        await call('trainer01', 'POST', `/courses/${briefId}/publish`, {
          published: true,
        })
      ).status,
    ).toBe(200);
    const tasks = await until(
      async () =>
        (await db())
          .query()
          .selectFrom('assignments')
          .selectAll()
          .where('courseId', '=', briefId)
          .execute(),
      (r) => r.length >= 3,
    );
    const people = tasks.map((t) => t.employeeId);
    expect(people).toEqual(
      expect.arrayContaining(['emp-wanglei', 'emp-qianjin', 'emp-zhaoyang']),
    );
    expect(people).not.toContain('emp-liuyang');
    expect(tasks.every((t) => t.source === 'revision')).toBe(true);
    expect(String(tasks[0].dueDate).slice(0, 10)).toBe(
      addWorkingDays(today(), 3),
    );
  });

  it('does not draft a second brief or duplicate suggestions when the revision runs again', async () => {
    const before = await (
      await db()
    )
      .query()
      .selectFrom('contentRevisions')
      .select(['id'])
      .where('documentId', '=', newDocumentId)
      .execute();
    const rerun = await call(
      'hr01',
      'POST',
      `/revisions/documents/${newDocumentId}/rerun`,
    );
    expect(rerun.status).toBe(200);
    const briefs = await (
      await db()
    )
      .query()
      .selectFrom('courses')
      .select(['id'])
      .where('briefForDocumentId', '=', newDocumentId)
      .execute();
    expect(briefs).toHaveLength(1);
    const after = await (
      await db()
    )
      .query()
      .selectFrom('contentRevisions')
      .select(['id', 'status'])
      .where('documentId', '=', newDocumentId)
      .execute();
    // Targets with an open suggestion are skipped; applied ones may be suggested again only for what still quotes V4.0.
    expect(after.filter((r) => r.status === 'open').length).toBeLessThanOrEqual(
      before.length,
    );
    expect(
      (
        await call(
          'emp_njl_1',
          'POST',
          `/revisions/documents/${newDocumentId}/rerun`,
        )
      ).status,
    ).toBe(403);
  });

  it('finds the 20 % question in the monthly check once, and tells its owner', async () => {
    const run = await call(
      'hr01',
      'POST',
      '/automations/contentWriter.questionQuality/run',
    );
    expect(run.json.data.status).toBe('succeeded');
    const quality = (
      await call('trainer01', 'GET', '/revisions?reason=lowQuality')
    ).json.data as Json[];
    const item = quality
      .flatMap((g) => g.revisions as Json[])
      .find((r) => r.targetId === 'q-profile-quality-01');
    expect(item).toBeTruthy();
    expect(String(item.explanation)).toContain('20%');
    expect(String(item.explanation)).toContain('作答分布');
    const second = await call(
      'hr01',
      'POST',
      '/automations/contentWriter.questionQuality/run',
    );
    expect(second.json.data.output?.created ?? 0).toBe(0);
  });
});

describe('V3-11 audit exports and the customer audit pack', () => {
  const scope = {
    text: '明天整车厂审核，范围是苏州和成都机加工车间的 CNC 操作工',
  };

  it('lists the pre-audit risks for the two machining workshops', async () => {
    const risks = await call('hr01', 'POST', '/audit/risks', scope);
    expect(risks.status).toBe(200);
    expect(risks.json.data.scope.departmentIds.sort()).toEqual([
      'cd-mc',
      'sz-mc',
    ]);
    expect(risks.json.data.scope.positionIds).toEqual(['pos-cnc-operator']);
    const list = risks.json.data.risks as Json[];
    expect(list.find((r) => r.name === '钱进')).toMatchObject({
      kind: 'certExpiringNoRecert',
    });
    expect(list.find((r) => r.name === '刘洋')).toMatchObject({
      kind: 'certMissingScheduled',
    });
    expect(list.find((r) => r.name === '吴敏')?.text).toContain('过期');
  });

  it('builds the pack for hr01 and qa_audit, refuses mgr_njl, and logs every export', async () => {
    const pack = await call('hr01', 'POST', '/audit/pack', scope);
    expect(pack.status).toBe(200);
    expect(pack.type).toContain('zip');
    const XLSX = await import('xlsx');
    const zip = (XLSX as any).CFB.read(pack.bytes, { type: 'buffer' });
    const names = zip.FullPaths.map((p: string) => p.split('/').pop());
    expect(names).toEqual(
      expect.arrayContaining(['cover.pdf', 'audit-pack.xlsx']),
    );
    const auditor = await call('qa_audit', 'POST', '/audit/pack', scope);
    expect(auditor.status).toBe(200);
    const CFB = (XLSX as any).CFB;
    const entry = CFB.find(
      CFB.read(auditor.bytes, { type: 'buffer' }),
      'audit-pack.xlsx',
    );
    const workbook = XLSX.read(entry.content, { type: 'array' });
    const text = JSON.stringify(
      workbook.SheetNames.map((n: string) =>
        XLSX.utils.sheet_to_json(workbook.Sheets[n], { header: 1 }),
      ),
    );
    expect(text).not.toContain('13900000004');
    expect(text).not.toContain('999999199903030044');
    expect((await call('mgr_njl', 'POST', '/audit/pack', scope)).status).toBe(
      403,
    );
    const log = await call('qa_audit', 'GET', '/audit/log');
    expect(
      (log.json.data as Json[]).filter((l) => l.kind === 'auditPack').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('exports 王磊’s training file, the ledger and the proof for qa_audit, who cannot change anything', async () => {
    const file = await call(
      'qa_audit',
      'GET',
      '/audit/employees/emp-wanglei/training-file',
    );
    expect(file.type).toContain('pdf');
    const { pdfText } =
      await import('../../server/providers/hr/profile/pdf.ts');
    const text = pdfText(file.bytes);
    for (const part of [
      '岗位变动记录',
      '学习记录',
      '线下签到',
      '考试答卷',
      '证书历史',
      '能力评定历史',
      'V2',
      'WI-MC-0231 V4.0',
    ])
      expect(text).toContain(part);
    expect(text).not.toContain('13900000004');
    const ledger = await call(
      'qa_audit',
      'GET',
      '/audit/ledger?departmentId=sz-mc',
    );
    expect(ledger.status).toBe(200);
    const XLSX = await import('xlsx');
    const book = XLSX.read(ledger.bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      book.Sheets[book.SheetNames[0]],
      { header: 1 },
    );
    const qianjin = rows.find((r) => r.includes('钱进'))!;
    expect(qianjin).toContain('即将到期');
    const proofs = await call('qa_audit', 'GET', '/audit/proofs');
    expect(proofs.json.data.length).toBeGreaterThan(0);
    const proof = await call(
      'qa_audit',
      'GET',
      `/audit/proofs/${proofs.json.data[0].id}`,
    );
    expect(proof.type).toContain('pdf');
    expect((await call('qa_audit', 'GET', '/signals')).status).toBe(403);
    expect(
      (
        await call('qa_audit', 'POST', '/signal-rules', {
          sourceSystem: 'qms',
          category: 'x',
          competencyId: 'comp-cnc',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('qa_audit', 'GET', '/training-recommendations')).status,
    ).toBe(403);
    const log = await call('hr01', 'GET', '/audit/log');
    const kinds = new Set((log.json.data as Json[]).map((l) => l.kind));
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        'trainingFile',
        'qualificationLedger',
        'recommendationProof',
        'auditPack',
      ]),
    );
  });
});

describe('V3-11 security', () => {
  it('keeps the analyst away from employees and without write tools for assessments or tasks', async () => {
    const { authorizeAction, scopeForUser } =
      await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const authz = server.application.container.resolve(authorizationToken);
    await expect(
      authorizeAction(
        await scopeForUser(authz, await userId('emp_njl_1')),
        'talent.talentAnalyst',
        'use',
      ),
    ).rejects.toThrow();
    await expect(
      authorizeAction(
        await scopeForUser(authz, await userId('mgr_njl')),
        'talent.talentAnalyst',
        'use',
      ),
    ).resolves.toBeTruthy();
    const analyst = (
      await import('../../server/ai/employees/talent-analyst/index.ts')
    ).default as { tools?: { name: string }[] };
    const tools = (analyst.tools ?? []).map((t) => t.name);
    expect(tools).not.toEqual(expect.arrayContaining(['createAssessment']));
    expect(tools.some((t) => /assign|assessment|publish/iu.test(t))).toBe(
      false,
    );
  });
});

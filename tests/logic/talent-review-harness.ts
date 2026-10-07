// Shared harness of the V4-13 server tests: boots the real standalone server on a throwaway SQLite database with the
// demo seeds (no model is configured, so every AI job takes its rule-based fallback), signs demo accounts in and
// calls the API. Not a test file itself.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';
import { eventually } from '../helpers/eventually.ts';

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
      )
        return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// A test-only value for the demo seed; never a real credential.
export const PASSWORD = 'v4-talent-review-test-password';

export type Json = Record<string, any>;

export interface Harness {
  server: StandaloneServer;
  base: string;
  call(
    username: string | null,
    method: string,
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<{ status: number; json: Json }>;
  db(): Promise<import('@nocobase/db').DatabaseManager>;
  services(): Promise<
    import('../../server/providers/hr/talent-review/index.ts').TalentReviewServices
  >;
  userId(username: string): Promise<string>;
  inboxText(key: string): Promise<string>;
  inboxOf(username: string, like: string): Promise<string[]>;
  close(): Promise<void>;
}

export const decode = (value: unknown): any => {
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

export async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 20_000,
) {
  const start = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

export const TZ = 'Asia/Shanghai';
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
export const shift = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function startHarness(name: string): Promise<Harness> {
  const directory = mkdtempSync(path.join(tmpdir(), `hr-${name}-`));
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
    }),
  );
  process.env.HR_DEMO_PASSWORD = PASSWORD;
  process.env.HR_RECRUITING_DEMO = 'false';
  process.env.ATTENDANCE_PUNCH_MOCK_FILE = path.join(
    directory,
    'feishu-punches.json',
  );
  const root = path.resolve(import.meta.dirname, '../..');
  const server = await createStandaloneServer({
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
      databaseDir: path.join(
        root,
        process.env.HR_TEST_DATABASE_DIR ?? 'database',
      ),
      clientDir: path.join(root, 'dist/client'),
      storageDir: path.join(directory, 'storage'),
    },
  });
  const base = `http://localhost${server.application.publicBasePath}`;
  const cookies = new Map<string, string>();

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
    expect(response.status).toBe(200);
    const cookie = response.headers
      .getSetCookie()
      .map((header) => header.split(';')[0])
      .join('; ');
    cookies.set(username, cookie);
    return cookie;
  }

  const harness: Harness = {
    server,
    base,
    async call(username, method, url, body, extra = {}) {
      const headers: Record<string, string> = { ...extra };
      if (username) headers.cookie = await signIn(username);
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
      const text = await response.text();
      let json: Json;
      try {
        json = text ? (JSON.parse(text) as Json) : {};
      } catch {
        json = {};
      }
      return { status: response.status, json };
    },
    async db() {
      const { databaseManagerToken } = await import('@nocobase/db');
      return server.application.container.resolve(databaseManagerToken);
    },
    async services() {
      const { talentReviewServicesToken } =
        await import('../../server/providers/hr/tokens.ts');
      return server.application.container.resolve(talentReviewServicesToken);
    },
    async userId(username) {
      const row = await (
        await harness.db()
      )
        .query()
        .selectFrom('user')
        .select(['id'])
        .where('username', '=', username)
        .executeTakeFirst();
      return String(row!.id);
    },
    async inboxText(key) {
      const { notificationServiceToken } =
        await import('@nocobase/app-plugin-notification');
      const sent = await server.application.container
        .resolve(notificationServiceToken)
        .getByIdempotencyKey(`hr:${key}`);
      if (!sent) return '';
      const rows = await eventually(async () =>
        (await harness.db())
          .query()
          .selectFrom('notificationInAppItems')
          .select(['title', 'body'])
          .where('notificationId', '=', sent.notificationId)
          .execute(),
      );
      return rows.map((r) => `${String(r.title)} ${String(r.body)}`).join('\n');
    },
    async inboxOf(username, like) {
      const userId = await harness.userId(username);
      const rows = await eventually(async () =>
        (await harness.db())
          .query()
          .selectFrom('notificationInAppItems')
          .selectAll()
          .where('title', 'like', `%${like}%`)
          .execute(),
      );
      return rows
        .filter((r) => JSON.stringify(r).includes(userId))
        .map((r) => `${String(r.title)} ${String(r.body)}`);
    },
    async close() {
      await server.close();
      delete process.env.HR_DEMO_PASSWORD;
      delete process.env.HR_RECRUITING_DEMO;
      delete process.env.ATTENDANCE_PUNCH_MOCK_FILE;
      rmSync(directory, { recursive: true, force: true });
    },
  };
  return harness;
}

/** 2026 年度考核 published with the final ratings the V4-13 test data sets (陈静 A、王磊 A、李敏 B、钱进 B). */
export async function publishAnnualCycle(h: Harness): Promise<void> {
  const database = await h.db();
  const now = new Date();
  await database
    .query()
    .updateTable('reviewCycles')
    .set({ status: 'published', publishedAt: now, updatedAt: now })
    .where('id', '=', 'perf-cycle-annual')
    .execute();
  for (const [employeeId, rating] of [
    ['emp-mgr-njl', 'A'],
    ['emp-wanglei', 'A'],
    ['emp-limin', 'B'],
    ['emp-qianjin', 'B'],
  ] as const) {
    await database
      .query()
      .deleteFrom('reviewResults')
      .where('cycleId', '=', 'perf-cycle-annual')
      .where('employeeId', '=', employeeId)
      .execute();
    await database
      .query()
      .insertInto('reviewResults')
      .values({
        id: `tr-test-result-${employeeId}`,
        cycleId: 'perf-cycle-annual',
        employeeId,
        schemeId: 'scheme-test',
        departmentId: 'sz-mc',
        positionId: null,
        managerUserId: await h.userId('mgr_njl'),
        skipLevelUserId: null,
        skipLevelSkipped: false,
        noAccount: false,
        peerUserIds: [],
        peerStatus: 'none',
        evidenceSnapshot: null,
        evidenceSummary: '评语原文：这段文字不得出现在盘点证据中',
        computedScore: 4,
        managerRating: rating,
        calibratedRating: rating,
        finalRating: rating,
        adjustments: [],
        status: 'published',
        closedReason: null,
        appeal: null,
        publishedAt: now,
        acknowledgedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  }
}

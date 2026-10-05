// @vitest-environment node

// V3-10 考试与认证: server checks for the parts added in this step — answers never reaching a candidate, single-device
// answering, blur limits and integrity review, timed-out attempts, the examiner's suggestions, the exam → competency
// rule, external certificates, the industry pack switch, the certificate lifecycle and renewal, 任职资格 material, the
// learning coach's remedial plan and the change checklist's certificate items. Each run boots the real standalone server
// on a throwaway SQLite database with migrations and seeds.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken, type DatabaseManager } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { notificationServiceToken } from '@nocobase/app-plugin-notification';

import { scopeForUser } from '../../server/providers/hr/authorize.ts';
import { certificateChecklistProvider } from '../../server/providers/hr/certificate-hooks.ts';
import {
  computeLoss,
  isFlagged,
  normalizeBlank,
  resolveAntiCheat,
  scoreItem,
} from '../../server/providers/hr/exam-service.ts';
import { addDays, newId, today } from '../../server/providers/hr/shared.ts';
import {
  examServiceToken,
  examSettingsToken,
  insightServiceToken,
  jobEventProcessorToken,
} from '../../server/providers/hr/tokens.ts';
import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// Seeds import `database/seed-data/*.js`; map a missed relative `.js` import of an application source to its `.ts`.
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
const PASSWORD = 'v3-exams-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v3-exams-'));
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
  process.env.HR_ATTENDANCE_DEMO = 'false';
  // The payroll demo builds on the attendance demo, which these checks do not need.
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
}, 240_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_ATTENDANCE_DEMO;
  delete process.env.HR_PAYROLL_DEMO;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

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

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
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
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

const db = (): DatabaseManager =>
  server.application.container.resolve(databaseManagerToken);

async function userIdOf(username: string): Promise<string> {
  const row = await db()
    .query()
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', username)
    .executeTakeFirst();
  return String(row!.id);
}

async function ctxOf(username: string) {
  const userId = await userIdOf(username);
  const authz = server.application.container.resolve(authorizationToken);
  return { authz: await scopeForUser(authz, userId), userId };
}

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
): Promise<T> {
  for (let i = 0; i < 80; i += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function finishedRuns(task: string): Promise<Json[]> {
  const runs = await call('hr01', 'GET', `/automations/runs?task=${task}`);
  expect(runs.status).toBe(200);
  return (runs.json.data as Json[]).filter((r) => r.status !== 'running');
}

async function notification(key: string): Promise<unknown> {
  return server.application.container
    .resolve(notificationServiceToken)
    .getByIdempotencyKey(`hr:${key}`);
}

/** The in-app message body sent under an HR notice key. */
async function inboxBody(key: string): Promise<string> {
  const sent = (await notification(key)) as { notificationId?: string } | null;
  if (!sent?.notificationId) return '';
  const items = await db()
    .query()
    .selectFrom('notificationInAppItems')
    .select(['body'])
    .where('notificationId', '=', sent.notificationId)
    .execute();
  return items.map((i) => String(i.body)).join('\n');
}

async function attemptRow(id: string): Promise<Json> {
  return (await db()
    .query()
    .selectFrom('examAttempts')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst()) as Json;
}

function parse<T>(value: unknown, fallback: T): T {
  let current = value;
  for (let i = 0; i < 3 && typeof current === 'string'; i += 1)
    current = JSON.parse(current);
  return (current ?? fallback) as T;
}

/** A published fixed exam of the given questions, assigned to the given employees. */
async function fixtureExam(
  title: string,
  questionIds: string[],
  employeeIds: string[],
  settings: Json = {},
): Promise<string> {
  const created = await call('hr01', 'POST', '/exams', {
    title,
    paperMode: 'fixed',
    durationMinutes: 30,
    maxAttempts: 3,
    passScore: 60,
    showAnswersAfter: 'afterPass',
    questions: questionIds.map((questionId) => ({ questionId, score: 10 })),
    ...settings,
  });
  expect(created.status).toBe(201);
  const examId = created.json.data.id as string;
  const published = await call('hr01', 'POST', `/exams/${examId}/publish`, {
    published: true,
  });
  expect(published.status).toBe(200);
  const now = new Date();
  for (const employeeId of employeeIds)
    await db()
      .query()
      .insertInto('assignments')
      .values({
        id: newId(),
        employeeId,
        examId,
        dueDate: addDays(today(), 14),
        status: 'notStarted',
        progress: 0,
        source: 'manual',
        optional: false,
        reminderCount: 0,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  return examId;
}

const SINGLES = [
  'q-cnc-01',
  'q-cnc-02',
  'q-cnc-03',
  'q-cnc-04',
  'q-cnc-05',
  'q-record-01',
  'q-record-02',
  'q-record-03',
];

describe('grading rules', () => {
  it('scores multiple choice all-or-nothing and blanks per blank, ignoring spaces and width', () => {
    expect(scoreItem('multiple', ['A', 'C'], ['A'], 10)).toEqual({
      earned: 0,
      correct: false,
    });
    expect(scoreItem('multiple', ['A', 'C'], ['C', 'A'], 10).earned).toBe(10);
    expect(scoreItem('multiple', ['A', 'C'], ['A', 'B', 'C'], 10).earned).toBe(
      0,
    );
    expect(normalizeBlank('  １５ 分钟 ')).toBe('15 分钟');
    expect(
      scoreItem('blank', [['15'], ['首件']], ['  15 ', '首件'], 10),
    ).toEqual({ earned: 10, correct: true });
    expect(scoreItem('blank', [['15'], ['首件']], ['15', ''], 10).earned).toBe(
      5,
    );
  });

  it('computes points lost per competency and applies anti-cheating defaults', () => {
    const items = [
      {
        questionId: 'a',
        type: 'single' as const,
        stem: '',
        options: [],
        blankCount: 0,
        score: 10,
        competencyIds: ['c1'],
      },
      {
        questionId: 'b',
        type: 'single' as const,
        stem: '',
        options: [],
        blankCount: 0,
        score: 20,
        competencyIds: ['c1', 'c2'],
      },
    ];
    expect(computeLoss(items, { a: { score: 10 }, b: { score: 0 } })).toEqual([
      { competencyId: 'c1', lost: 20, total: 30 },
      { competencyId: 'c2', lost: 20, total: 20 },
    ]);
    const defaults = resolveAntiCheat(null);
    expect(defaults).toEqual({
      shuffleOptions: true,
      disableCopy: true,
      maxBlurCount: 3,
      blurAction: 'flag',
      singleDevice: true,
    });
    expect(isFlagged([], 3, defaults)).toBe(false);
    expect(isFlagged([], 4, defaults)).toBe(true);
    expect(
      isFlagged(
        [{ type: 'multiDevice', at: new Date().toISOString(), detail: null }],
        0,
        defaults,
      ),
    ).toBe(true);
  });
});

describe('answering and anti-cheating', () => {
  let attemptId = '';
  let first = '';
  let second = '';

  it('never sends answers or grading points to a candidate', async () => {
    const started = await call(
      'emp_njl_2',
      'POST',
      '/my-exams/exam-cnc-cert/start',
    );
    expect(started.status).toBe(200);
    attemptId = started.json.data.id;
    first = started.json.data.deviceToken;
    expect(first).toBeTruthy();
    for (const body of [
      JSON.stringify(started.json),
      JSON.stringify(
        (
          await call('emp_njl_2', 'GET', `/attempts/${attemptId}`, undefined, {
            'x-exam-device': first,
          })
        ).json,
      ),
      JSON.stringify(
        (
          await call(
            'emp_njl_2',
            'PUT',
            `/attempts/${attemptId}/answers`,
            { answers: {} },
            { 'x-exam-device': first },
          )
        ).json,
      ),
    ]) {
      expect(body).not.toContain('"answer"');
      expect(body).not.toContain('gradingNotes');
      expect(body).not.toContain('gradingPoints');
    }
    // Refreshing on the same device returns the same attempt with the same deadline.
    const again = await call(
      'emp_njl_2',
      'POST',
      '/my-exams/exam-cnc-cert/start',
      undefined,
      { 'x-exam-device': first },
    );
    expect(again.json.data.id).toBe(attemptId);
    expect(again.json.data.deadlineAt).toBe(started.json.data.deadlineAt);
    expect(again.json.data.deviceToken).toBeNull();
  });

  it('lets a second device take over and refuses the first one, recording it', async () => {
    const other = await call('emp_njl_2', 'GET', `/attempts/${attemptId}`);
    second = other.json.data.deviceToken;
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
    const refused = await call(
      'emp_njl_2',
      'POST',
      `/attempts/${attemptId}/submit`,
      { answers: {} },
      { 'x-exam-device': first },
    );
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('ATTEMPT_DEVICE_CHANGED');
    const flags = parse<Json[]>(
      (await attemptRow(attemptId)).integrityFlags,
      [],
    );
    expect(flags.filter((f) => f.type === 'multiDevice')).toHaveLength(2);
    // A blocked paste is recorded too.
    await call(
      'emp_njl_2',
      'POST',
      `/attempts/${attemptId}/integrity`,
      { type: 'pasteAttempt' },
      { 'x-exam-device': second },
    );
    const submitted = await call(
      'emp_njl_2',
      'POST',
      `/attempts/${attemptId}/submit`,
      { answers: {} },
      { 'x-exam-device': second },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.json.data.status).toBe('failed');
    // The result page gets points lost by competency.
    expect(submitted.json.data.lossByCompetency.length).toBeGreaterThan(0);
  });

  it('lists the attempt as flagged for the exam owner, who voids it only with a reason', async () => {
    const list = await call(
      'trainer01',
      'GET',
      '/exams/exam-cnc-cert/integrity',
    );
    expect(list.status).toBe(200);
    const flagged = (list.json.data as Json[]).find((a) => a.id === attemptId);
    expect(flagged?.integrity.flags.length).toBeGreaterThanOrEqual(3);
    expect(
      (await call('emp_njl_2', 'GET', '/exams/exam-cnc-cert/integrity')).status,
    ).toBe(403);
    const noReason = await call(
      'trainer01',
      'POST',
      `/attempts/${attemptId}/integrity-review`,
      { decision: 'void' },
    );
    expect(noReason.json.code).toBe('VOID_REASON_REQUIRED');
    const voided = await call(
      'trainer01',
      'POST',
      `/attempts/${attemptId}/integrity-review`,
      { decision: 'void', reason: '同一账号两台设备作答' },
    );
    expect(voided.status).toBe(200);
    expect(voided.json.data.status).toBe('voided');
    // A voided attempt still uses one of the attempts, and does not count in the pass rate.
    const mine = await call('emp_njl_2', 'GET', '/my-exams');
    const exam = (mine.json.data as Json[]).find(
      (e) => e.examId === 'exam-cnc-cert',
    );
    expect(exam?.attemptsUsed).toBe(1);
  });

  it('counts blurs, flags past the limit and submits when the exam says so', async () => {
    const examId = await fixtureExam(
      'V3-10 切屏自动交卷',
      SINGLES.slice(0, 3),
      ['emp-liuyang'],
      { antiCheat: { maxBlurCount: 1, blurAction: 'submit' } },
    );
    const started = await call(
      'emp_njl_4',
      'POST',
      `/my-exams/${examId}/start`,
    );
    const id = started.json.data.id as string;
    const headers = {
      'x-exam-device': started.json.data.deviceToken as string,
    };
    const one = await call(
      'emp_njl_4',
      'POST',
      `/attempts/${id}/integrity`,
      { type: 'blur' },
      headers,
    );
    expect(one.json.data).toMatchObject({ blurCount: 1, submitted: false });
    const two = await call(
      'emp_njl_4',
      'POST',
      `/attempts/${id}/integrity`,
      { type: 'blur' },
      headers,
    );
    expect(two.json.data).toMatchObject({ blurCount: 2, submitted: true });
    expect((await attemptRow(id)).status).not.toBe('inProgress');
    const detail = await call('hr01', 'GET', `/exams/${examId}`);
    expect(detail.json.data.flagged).toBe(1);
  });

  it('keeps option order when shuffling is off, and shuffles it otherwise', async () => {
    const plain = await fixtureExam('V3-10 不乱序', SINGLES, ['emp-wanglei'], {
      antiCheat: { shuffleOptions: false },
    });
    const shuffled = await fixtureExam('V3-10 乱序', SINGLES, ['emp-wanglei']);
    const keys = (items: Json[]) =>
      items.map((i) => (i.options as Json[]).map((o) => o.key).join(''));
    const a = await call('emp_njl_1', 'POST', `/my-exams/${plain}/start`);
    expect(
      keys(a.json.data.items).every((k) => k === [...k].sort().join('')),
    ).toBe(true);
    const b = await call('emp_njl_1', 'POST', `/my-exams/${shuffled}/start`);
    expect(
      keys(b.json.data.items).some((k) => k !== [...k].sort().join('')),
    ).toBe(true);
  });

  it('submits a timed-out attempt with its saved answers and refuses a later submission', async () => {
    const examId = await fixtureExam('V3-10 限时 1 分钟', SINGLES.slice(0, 2), [
      'emp-qianjin',
    ]);
    const started = await call(
      'emp_njl_3',
      'POST',
      `/my-exams/${examId}/start`,
    );
    const id = started.json.data.id as string;
    const headers = {
      'x-exam-device': started.json.data.deviceToken as string,
    };
    await call(
      'emp_njl_3',
      'PUT',
      `/attempts/${id}/answers`,
      { answers: { 'q-cnc-01': 'C' } },
      headers,
    );
    await db()
      .query()
      .updateTable('examAttempts')
      .set({ deadlineAt: new Date(Date.now() - 60_000) })
      .where('id', '=', id)
      .execute();
    // The minute job may have submitted it already; either way it is no longer open.
    await server.application.container
      .resolve(examServiceToken)
      .autoSubmitExpired();
    const row = await attemptRow(id);
    expect(['passed', 'failed']).toContain(row.status);
    expect(parse<Json>(row.answers, {})['q-cnc-01']).toBe('C');
    const late = await call(
      'emp_njl_3',
      'POST',
      `/attempts/${id}/submit`,
      { answers: {} },
      headers,
    );
    expect(late.status).toBe(409);
  });

  it('drafts one remedial plan after a failed exam and tells the candidate what to study', async () => {
    const run = await waitFor(async () => {
      const runs = await finishedRuns('learningCoach.examFailedPlan');
      return runs.find((r) => JSON.stringify(r.triggerRef).includes(attemptId));
    }, 'exam-failed plan run');
    expect(run.status).toBe('succeeded');
    expect(
      await notification(`automation:examFailed:${attemptId}:candidate`),
    ).toBeTruthy();
    const drafts = await db()
      .query()
      .selectFrom('learningPlans')
      .select(['id'])
      .where('employeeId', '=', 'emp-limin')
      .where('status', '=', 'draft')
      .execute();
    expect(drafts.length).toBeLessThanOrEqual(1);
  });
});

describe('examiner suggestions and manual grading', () => {
  let attemptId = '';

  it('keeps the attempt grading and tells the instructor after the examiner ran', async () => {
    const started = await call(
      'emp_njl_1',
      'POST',
      '/my-exams/exam-safety-practice/start',
    );
    expect(started.status).toBe(200);
    attemptId = started.json.data.id;
    const submitted = await call(
      'emp_njl_1',
      'POST',
      `/attempts/${attemptId}/submit`,
      { answers: { 'q-cnc-10': '先停机再清理铁屑，用铁钩。' } },
      { 'x-exam-device': started.json.data.deviceToken },
    );
    expect(submitted.json.data.status).toBe('grading');
    // No model in tests: the examiner run fails, and the instructor is told without "AI suggestions ready".
    await waitFor(async () => {
      const runs = await finishedRuns('examiner.gradingSuggestion');
      return runs.find((r) => JSON.stringify(r.triggerRef).includes(attemptId));
    }, 'examiner run');
    expect(
      await waitFor(
        async () =>
          (await notification(`attempt:${attemptId}:grading`)) ?? undefined,
        'grading notice',
      ),
    ).toBeTruthy();
    expect((await attemptRow(attemptId)).status).toBe('grading');
  });

  it('saves one suggestion per answer without changing status or score', async () => {
    const exams = server.application.container.resolve(examServiceToken);
    const trainer = await ctxOf('trainer01');
    const suggestion = {
      questionId: 'q-cnc-10',
      score: 20,
      matchedPoints: ['先停机'],
      missingPoints: ['不戴手套和首饰'],
      rationale: '命中“先停机再清理”，未提到不戴手套。',
    };
    expect(
      await exams.saveGradingSuggestion(trainer, attemptId, suggestion),
    ).toEqual({ saved: true });
    expect(
      await exams.saveGradingSuggestion(trainer, attemptId, {
        ...suggestion,
        score: 40,
      }),
    ).toEqual({ saved: false });
    const row = await attemptRow(attemptId);
    expect(row.status).toBe('grading');
    expect(row.score).toBeNull();
    // A candidate never reaches grading material.
    await expect(
      exams.gradingMaterial(await ctxOf('emp_njl_1'), attemptId),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('records the final score as the instructor sets it, next to the suggestion', async () => {
    const list = await call('trainer01', 'GET', '/grading');
    const attempt = (list.json.data as Json[]).find((a) => a.id === attemptId)!;
    const item = (attempt.items as Json[]).find((i) => i.type === 'short')!;
    expect(item.aiSuggestion.score).toBe(20);
    const graded = await call('trainer01', 'POST', `/grading/${attemptId}`, {
      items: [{ questionId: 'q-cnc-10', score: 10, comment: '要点不全' }],
    });
    expect(graded.status).toBe(200);
    expect(graded.json.data.status).toBe('failed');
    expect(
      (graded.json.data.items as Json[]).find((i) => i.type === 'short').earned,
    ).toBe(10);
    const exam = await call('hr01', 'GET', '/exams/exam-safety-practice');
    expect(exam.json.data.aiAgreement).toMatchObject({
      compared: 1,
      withinOne: 0,
    });
    expect(await notification(`attempt:${attemptId}:graded`)).toBeTruthy();
  });

  it('explains a failed result without revealing answers the exam hides', async () => {
    const exams = server.application.container.resolve(examServiceToken);
    const result = await exams.explainResult(
      await ctxOf('emp_njl_1'),
      attemptId,
    );
    expect(result.answersVisible).toBe(false);
    expect(JSON.stringify(result.items)).not.toContain('"answer"');
    expect(result.lossByCompetency.length).toBeGreaterThan(0);
    await expect(
      exams.explainResult(await ctxOf('emp_njl_2'), attemptId),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('the exam → competency rule and the industry pack switch', () => {
  it('lets only HR administrators change the competency rule, which the next scoring reads', async () => {
    expect(
      (
        await call('trainer01', 'PUT', '/exam-settings/examRules', {
          revision: 0,
          value: { minWeight: 0.2, fullRate: 0.95, partialRate: 0.7 },
        })
      ).status,
    ).toBe(403);
    const current = (await call('hr01', 'GET', '/exam-settings')).json.data;
    const saved = await call('hr01', 'PUT', '/exam-settings/examRules', {
      revision: current.examRules.revision,
      value: { minWeight: 0.2, fullRate: 0.95, partialRate: 0.7 },
    });
    expect(saved.status).toBe(200);
    const stale = await call('hr01', 'PUT', '/exam-settings/examRules', {
      revision: current.examRules.revision,
      value: { minWeight: 0.2, fullRate: 0.9, partialRate: 0.7 },
    });
    expect(stale.json.code).toBe('SETTINGS_CONFLICT');
    expect(
      await server.application.container.resolve(examSettingsToken).rules(),
    ).toEqual({ minWeight: 0.2, fullRate: 0.95, partialRate: 0.7 });
  });

  it('grants through certificates only while the industry pack is on', async () => {
    const sign = () =>
      call('emp_njl_1', 'POST', '/api/demo/batch-record/sign-filling', {});
    expect((await sign()).status).toBe(200);
    const current = (await call('hr01', 'GET', '/exam-settings')).json.data;
    const off = await call('hr01', 'PUT', '/exam-settings/licensedOperation', {
      revision: current.licensedOperation.revision,
      value: { enabled: false },
    });
    expect(off.status).toBe(200);
    expect((await sign()).status).toBe(403);
    const detail = await call('emp_njl_1', 'GET', '/certifications/cert-cnc');
    expect(detail.json.data.grantedPages).toEqual([]);
    const on = await call('hr01', 'PUT', '/exam-settings/licensedOperation', {
      revision: off.json.data.revision,
      value: { enabled: true },
    });
    expect(on.status).toBe(200);
    expect((await sign()).status).toBe(200);
  });
});

describe('certificate lifecycle, renewal and external certificates', () => {
  it('assigns renewal, marks expiring and expires once, whatever the repeats', async () => {
    expect(
      (await call('hr01', 'POST', '/org/maintenance/run', {})).status,
    ).toBe(200);
    const zhao = await db()
      .query()
      .selectFrom('employeeCertificates')
      .selectAll()
      .where('id', '=', 'certificate-zhaoyang-cnc')
      .executeTakeFirst();
    expect(zhao?.status).toBe('expiring');
    const renewals = await db()
      .query()
      .selectFrom('assignments')
      .select(['id', 'dueDate'])
      .where('certificateId', '=', 'certificate-zhaoyang-cnc')
      .where('source', '=', 'recertification')
      .execute();
    expect(renewals).toHaveLength(1);
    const wu = await db()
      .query()
      .selectFrom('employeeCertificates')
      .select(['status'])
      .where('id', '=', 'certificate-wumin-cnc')
      .executeTakeFirst();
    expect(wu?.status).toBe('expired');
    expect(
      await inboxBody('certificate:certificate-wumin-cnc:expired'),
    ).toContain('不再计入有效持证');
    await call('hr01', 'POST', '/org/maintenance/run', {});
    expect(
      await db()
        .query()
        .selectFrom('assignments')
        .select(['id'])
        .where('certificateId', '=', 'certificate-zhaoyang-cnc')
        .where('source', '=', 'recertification')
        .execute(),
    ).toHaveLength(1);
  });

  it('renews without a gap: the new certificate runs from the old expiry, the old one is superseded', async () => {
    const { DEMO_QUESTIONS } =
      await import('../../database/seed-data/demo-exams.ts');
    const answerOf = new Map(DEMO_QUESTIONS.map((q) => [q.id, q.answer]));
    const old = (await db()
      .query()
      .selectFrom('employeeCertificates')
      .selectAll()
      .where('id', '=', 'certificate-zhaoyang-cnc')
      .executeTakeFirst()) as Json;
    const mine = await call('emp_th_1', 'GET', '/my-exams');
    const cnc = (mine.json.data as Json[]).find(
      (e) => e.examId === 'exam-cnc-cert',
    );
    // The renewal counts its own attempts, not the earlier ones.
    expect(cnc?.remainingAttempts).toBe(3);
    const started = await call(
      'emp_th_1',
      'POST',
      '/my-exams/exam-cnc-cert/start',
    );
    expect(started.status).toBe(200);
    const answers = Object.fromEntries(
      (started.json.data.items as Json[]).map((i) => [
        i.questionId,
        answerOf.get(i.questionId),
      ]),
    );
    const submitted = await call(
      'emp_th_1',
      'POST',
      `/attempts/${started.json.data.id}/submit`,
      { answers },
      { 'x-exam-device': started.json.data.deviceToken },
    );
    expect(submitted.json.data.status).toBe('passed');
    const replaced = (await db()
      .query()
      .selectFrom('employeeCertificates')
      .selectAll()
      .where('id', '=', 'certificate-zhaoyang-cnc')
      .executeTakeFirst()) as Json;
    expect(replaced.status).toBe('superseded');
    const renewed = (await db()
      .query()
      .selectFrom('employeeCertificates')
      .selectAll()
      .where('id', '=', String(replaced.supersededById))
      .executeTakeFirst()) as Json;
    expect(renewed.status).toBe('valid');
    const oldExpiry = String(old.expiresAt).slice(0, 10);
    const expected = new Date(`${oldExpiry}T00:00:00Z`);
    expected.setUTCMonth(expected.getUTCMonth() + 12);
    expect(String(renewed.expiresAt).slice(0, 10)).toBe(
      expected.toISOString().slice(0, 10),
    );
    // 认证要求 · 你的进度 keeps the passed exam ticked for the holder of the new certificate.
    const detail = await call('emp_th_1', 'GET', '/certifications/cert-cnc');
    expect(
      (detail.json.data.mine.requirements.exams as Json[]).find(
        (e) => e.id === 'exam-cnc-cert',
      )?.done,
    ).toBe(true);
  });

  it('verifies an external certificate only by HR, never by its holder', async () => {
    const pending = await call(
      'hr01',
      'GET',
      '/external-certificates?verifyStatus=pending',
    );
    expect(
      (pending.json.data.items as Json[]).some(
        (c) => c.id === 'certificate-limin-forklift',
      ),
    ).toBe(true);
    // Pending does not count as held.
    const held = await db()
      .query()
      .selectFrom('employeeCertificates')
      .select(['status'])
      .where('id', '=', 'certificate-limin-forklift')
      .executeTakeFirst();
    expect(held?.status).toBe('pending');
    expect(
      (
        await call(
          'emp_njl_2',
          'POST',
          '/external-certificates/certificate-limin-forklift/verify',
          { decision: 'verified' },
        )
      ).status,
    ).toBe(403);
    const verified = await call(
      'hr01',
      'POST',
      '/external-certificates/certificate-limin-forklift/verify',
      { decision: 'verified' },
    );
    expect(verified.status).toBe(200);
    expect(verified.json.data.status).toBe('valid');
    expect(
      await notification('certificate:certificate-limin-forklift:verified'),
    ).toBeTruthy();
  });

  it('follows the administrator’s notice days: expiring reminds only the holder and assigns no renewal', async () => {
    const list = await call('hr01', 'GET', '/certifications');
    const forklift = (list.json.data.items as Json[]).find(
      (c) => c.id === 'cert-forklift',
    )!;
    const saved = await call('hr01', 'PATCH', '/certifications/cert-forklift', {
      code: forklift.code,
      title: forklift.title,
      kind: 'external',
      issuingAuthority: forklift.issuingAuthority,
      validityMonths: 48,
      expiringNoticeDays: 60,
      recertAdvanceDays: 0,
      escalateDays: 0,
      recertMode: 'examOnly',
      courseIds: [],
      examIds: [],
    });
    expect(saved.status).toBe(200);
    await call('hr01', 'POST', '/org/maintenance/run', {});
    const row = await db()
      .query()
      .selectFrom('employeeCertificates')
      .select(['status'])
      .where('id', '=', 'certificate-limin-forklift')
      .executeTakeFirst();
    expect(row?.status).toBe('expiring');
    expect(
      await db()
        .query()
        .selectFrom('assignments')
        .select(['id'])
        .where('certificateId', '=', 'certificate-limin-forklift')
        .execute(),
    ).toHaveLength(0);
    expect(
      await notification('certificate:certificate-limin-forklift:expiring'),
    ).toBeTruthy();
  });

  it('registers with a scan, rejects only with a reason, and accepts a corrected resubmission', async () => {
    const png = new Uint8Array([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    ]);
    const form = new FormData();
    form.append('file', new File([png], 'forklift.png', { type: 'image/png' }));
    const upload = await server.fetch(
      new Request(`${base}/api/certificateScanFiles:uploadOne`, {
        method: 'POST',
        headers: {
          cookie: await signIn('emp_njl_1'),
          origin: 'http://localhost',
        },
        body: form,
      }),
    );
    expect(upload.status).toBeLessThan(300);
    const file = (await upload.json()) as Json;
    const fileId = String(file.data.record.id);
    const noScan = await call('emp_njl_1', 'POST', '/external-certificates', {
      certificationId: 'cert-forklift',
      externalNo: 'T3205',
      issuedAt: addDays(today(), -30),
      expiresAt: addDays(today(), 1400),
    });
    expect(noScan.json.code).toBe('EXTERNAL_SCAN_REQUIRED');
    const registered = await call(
      'emp_njl_1',
      'POST',
      '/external-certificates',
      {
        certificationId: 'cert-forklift',
        externalNo: 'T3205',
        issuedAt: addDays(today(), -30),
        expiresAt: addDays(today(), 1400),
        attachmentFileId: fileId,
      },
    );
    expect(registered.status).toBe(201);
    const id = registered.json.data.id as string;
    expect(registered.json.data.status).toBe('pending');
    const noNote = await call(
      'hr01',
      'POST',
      `/external-certificates/${id}/verify`,
      {
        decision: 'rejected',
      },
    );
    expect(noNote.json.code).toBe('VERIFY_NOTE_REQUIRED');
    const rejected = await call(
      'hr01',
      'POST',
      `/external-certificates/${id}/verify`,
      { decision: 'rejected', note: '扫描件模糊' },
    );
    expect(rejected.json.data.verifyStatus).toBe('rejected');
    const resubmitted = await call(
      'emp_njl_1',
      'PATCH',
      `/external-certificates/${id}`,
      {
        externalNo: 'T3205-01',
        issuedAt: addDays(today(), -30),
        expiresAt: addDays(today(), 1400),
        attachmentFileId: fileId,
      },
    );
    expect(resubmitted.json.data.verifyStatus).toBe('pending');
    const scan = await call(
      'emp_njl_1',
      'GET',
      `/external-certificates/${id}/scan`,
    );
    expect(scan.json.data.id).toBe(fileId);
    expect(
      (await call('emp_njl_2', 'GET', `/external-certificates/${id}/scan`))
        .status,
    ).toBe(404);
  });
});

describe('qualification, the steward and the change checklist', () => {
  it('achieves the development target and prepares the material when a qualification certificate is issued', async () => {
    const created = await call('hr01', 'POST', '/certifications', {
      code: 'QUAL-TRN',
      title: '讲师岗位任职资格（测试）',
      validityMonths: 24,
      qualifiesPositionId: 'pos-office-trainer',
      courseIds: [],
      examIds: ['exam-trainer-basic'],
    });
    expect(created.status).toBe(201);
    const now = new Date();
    await db()
      .query()
      .insertInto('developmentTargets')
      .values({
        id: 'target-wanglei-trainer',
        employeeId: 'emp-wanglei',
        targetPositionId: 'pos-office-trainer',
        reason: '继任培养',
        status: 'active',
        createdBy: await userIdOf('hr01'),
        createdAt: new Date(now.getTime() - 86_400_000),
        updatedAt: now,
      })
      .execute();
    const { DEMO_QUESTIONS } =
      await import('../../database/seed-data/demo-exams.ts');
    const answerOf = new Map(DEMO_QUESTIONS.map((q) => [q.id, q.answer]));
    const started = await call(
      'emp_njl_1',
      'POST',
      '/my-exams/exam-trainer-basic/start',
    );
    expect(started.status).toBe(200);
    const submitted = await call(
      'emp_njl_1',
      'POST',
      `/attempts/${started.json.data.id}/submit`,
      {
        answers: Object.fromEntries(
          (started.json.data.items as Json[]).map((i) => [
            i.questionId,
            answerOf.get(i.questionId),
          ]),
        ),
      },
      { 'x-exam-device': started.json.data.deviceToken },
    );
    expect(submitted.json.data.status).toBe('passed');
    const run = await waitFor(async () => {
      const runs = await finishedRuns('certificationSteward.qualificationPrep');
      return runs[0];
    }, 'qualification run');
    expect(run.status).toBe('succeeded');
    const target = await db()
      .query()
      .selectFrom('developmentTargets')
      .select(['status'])
      .where('id', '=', 'target-wanglei-trainer')
      .executeTakeFirst();
    expect(target?.status).toBe('achieved');
    const certificateId = JSON.parse(JSON.stringify(run.triggerRef))
      .certificateId as string;
    const dossier = await call(
      'hr01',
      'GET',
      `/certificates/${certificateId}/qualification-dossier`,
    );
    expect(dossier.json.data.promotionLink).toContain('type=promote');
    expect(
      (
        await call(
          'emp_njl_2',
          'GET',
          `/certificates/${certificateId}/qualification-dossier`,
        )
      ).status,
    ).toBe(404);
    const items = await db()
      .query()
      .selectFrom('workItems')
      .select(['recipientUserId'])
      .where('type', '=', 'qualificationDossier')
      .where('refId', '=', certificateId)
      .execute();
    expect(items.map((i) => String(i.recipientUserId))).toContain(
      await userIdOf('hr01'),
    );
    // Nothing was started: the position is unchanged.
    const employee = await db()
      .query()
      .selectFrom('employees')
      .select(['positionId'])
      .where('id', '=', 'emp-wanglei')
      .executeTakeFirst();
    expect(employee?.positionId).toBe('pos-cnc-operator');
    // The promotion decided later links the achieved target.
    const eventId = newId();
    await db()
      .query()
      .insertInto('jobEvents')
      .values({
        id: eventId,
        employeeId: 'emp-wanglei',
        eventType: 'promote',
        fromPositionId: 'pos-cnc-operator',
        toPositionId: 'pos-office-trainer',
        effectiveDate: today(),
        source: 'action',
        actionId: 'action-test-promote',
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await server.application.container
      .resolve(jobEventProcessorToken)
      .process([eventId]);
    const linked = await db()
      .query()
      .selectFrom('developmentTargets')
      .select(['decisionActionId'])
      .where('id', '=', 'target-wanglei-trainer')
      .executeTakeFirst();
    expect(linked?.decisionActionId).toBe('action-test-promote');
  });

  it('keeps an employee to their own certificates and team summaries to heads and HR', async () => {
    const insights = server.application.container.resolve(insightServiceToken);
    const own = await insights.stewardCertificates(
      await ctxOf('emp_njl_1'),
      {},
    );
    expect(new Set(own.map((c) => c.employeeId))).toEqual(
      new Set(['emp-wanglei']),
    );
    await expect(
      insights.teamSummary(await ctxOf('emp_njl_1'), undefined),
    ).rejects.toMatchObject({ code: 'STEWARD_TEAM_FORBIDDEN' });
    const east = await insights.stewardCertificates(await ctxOf('mgr_east'), {
      expiresWithinDays: 30,
    });
    expect(east.map((c) => c.name)).toContain('钱进');
    expect(east.map((c) => c.name)).not.toContain('赵阳');
  });

  it('lists missing and no-longer-required certificates on a job change without touching them', async () => {
    const provider = certificateChecklistProvider(db());
    const toCnc = await provider.items({
      kind: 'change',
      stage: 'preview',
      effective: false,
      action: {
        id: 'x',
        actionType: 'transfer',
        status: 'pending',
        employeeId: 'emp-hr01',
        candidate: {},
        fromDepartmentId: 'hr',
        fromPositionId: 'pos-office-hr',
        toDepartmentId: 'sz-mc',
        toPositionId: 'pos-cnc-operator',
        effectiveDate: today(),
      },
      event: null,
      employee: {
        id: 'emp-hr01',
        name: '林晓',
        userId: null,
        departmentId: 'hr',
        positionId: 'pos-office-hr',
        managerEmployeeId: null,
        externalUserId: null,
        status: 'active',
        customFields: {},
      },
      database: db(),
    } as never);
    expect(toCnc.map((i) => i.code)).toContain('certificateMissing');
    const fromCnc = await provider.items({
      kind: 'change',
      stage: 'preview',
      effective: false,
      action: {
        id: 'y',
        actionType: 'transfer',
        status: 'pending',
        employeeId: 'emp-qianjin',
        candidate: {},
        fromDepartmentId: 'sz-mc',
        fromPositionId: 'pos-cnc-operator',
        toDepartmentId: 'hr',
        toPositionId: 'pos-office-hr',
        effectiveDate: today(),
      },
      event: null,
      employee: {
        id: 'emp-qianjin',
        name: '钱进',
        userId: null,
        departmentId: 'sz-mc',
        positionId: 'pos-cnc-operator',
        managerEmployeeId: null,
        externalUserId: null,
        status: 'active',
        customFields: {},
      },
      database: db(),
    } as never);
    expect(fromCnc.map((i) => i.code)).toContain('certificateNoLongerRequired');
  });
});

describe('papers and attempt limits', () => {
  it('keeps drafts out of papers and names the random rule that lacks questions', async () => {
    const draft = await call('hr01', 'POST', '/exams', {
      title: 'V3-10 含草稿题',
      paperMode: 'fixed',
      questions: [{ questionId: 'q-draft-01', score: 10 }],
    });
    expect(draft.json.code).toBe('QUESTION_NOT_CONFIRMED');
    const random = await call('hr01', 'POST', '/exams', {
      title: 'V3-10 题量不足',
      paperMode: 'random',
      randomRules: [
        { questionType: 'single', count: 2, scoreEach: 10 },
        { questionType: 'blank', count: 5, scoreEach: 10 },
      ],
    });
    expect(random.status).toBe(201);
    const published = await call(
      'hr01',
      'POST',
      `/exams/${random.json.data.id}/publish`,
      { published: true },
    );
    expect(published.json.code).toBe('EXAM_RULE_SHORTAGE');
    expect(published.json.details.rules).toEqual([
      expect.objectContaining({ index: 1, count: 5 }),
    ]);
  });

  it('refuses a start once the attempts are used up, until the owner resets them', async () => {
    const examId = await fixtureExam('V3-10 限次', SINGLES.slice(0, 2), [
      'emp-liuyang',
    ]);
    for (let i = 0; i < 3; i += 1) {
      const started = await call(
        'emp_njl_4',
        'POST',
        `/my-exams/${examId}/start`,
      );
      expect(started.status).toBe(200);
      await call(
        'emp_njl_4',
        'POST',
        `/attempts/${started.json.data.id}/submit`,
        { answers: {} },
        { 'x-exam-device': started.json.data.deviceToken },
      );
    }
    const refused = await call(
      'emp_njl_4',
      'POST',
      `/my-exams/${examId}/start`,
    );
    expect(refused.json.code).toBe('EXAM_NO_ATTEMPTS_LEFT');
    expect(
      (
        await call('trainer01', 'POST', `/exams/${examId}/reset-attempts`, {
          employeeId: 'emp-liuyang',
        })
      ).status,
    ).toBe(404);
    const reset = await call(
      'hr01',
      'POST',
      `/exams/${examId}/reset-attempts`,
      {
        employeeId: 'emp-liuyang',
      },
    );
    expect(reset.json.data.reset).toBe(3);
    expect(
      (await call('emp_njl_4', 'POST', `/my-exams/${examId}/start`)).status,
    ).toBe(200);
  });
});

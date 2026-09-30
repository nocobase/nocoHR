// @vitest-environment node

// Acceptance checks for V4 step 12 (绩效) on the V4 demo data (启衡精密): schemes and coefficients, the cycle's
// participant list and exclusions, goals and the assistant's goal drafts, the evidence snapshot and the quality and
// safety reference score, reviews (the AI draft card, adoption, the deviation hints, peer anonymity), calibration,
// publication and its application (competency write-back, the learning plan for a C), appeals and the automatic
// acknowledgement, the offboard close, the payroll link (perf.coefficient, the rating field grant, the adjustment
// link), the customizable quality rule and the permission boundaries. There is no model in tests: every assistant job
// takes its rule-based fallback. Each run boots the real standalone server on a throwaway SQLite database.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const PASSWORD = 'v4-performance-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
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

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = {};
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
}

const perf = (url: string) => `/performance${url}`;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v4-performance-'));
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
  // The recruiting demo hires into other departments and corrects a payroll parameter; not needed here.
  process.env.HR_RECRUITING_DEMO = 'false';
  process.env.ATTENDANCE_PUNCH_MOCK_FILE = path.join(
    directory,
    'feishu-punches.json',
  );
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
  delete process.env.HR_RECRUITING_DEMO;
  delete process.env.ATTENDANCE_PUNCH_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const decode = (value: unknown): any => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v);
  return v;
};

async function until<T>(
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

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function services() {
  const { performanceServicesToken } =
    await import('../../server/providers/hr/tokens.ts');
  return server.application.container.resolve(performanceServicesToken);
}

async function userId(username: string): Promise<string> {
  const row = await (
    await db()
  )
    .query()
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', username)
    .executeTakeFirst();
  return String(row!.id);
}

async function notification(key: string) {
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  return server.application.container
    .resolve(notificationServiceToken)
    .getByIdempotencyKey(`hr:${key}`);
}

async function inboxText(key: string): Promise<string> {
  const sent = await notification(key);
  if (!sent) return '';
  const rows = await (
    await db()
  )
    .query()
    .selectFrom('notificationInAppItems')
    .select(['title', 'body'])
    .where('notificationId', '=', sent.notificationId)
    .execute();
  return rows.map((r) => `${String(r.title)} ${String(r.body)}`).join('\n');
}

async function resultOf(employeeId: string, cycle = CYCLE): Promise<Json> {
  const row = await (
    await db()
  )
    .query()
    .selectFrom('reviewResults')
    .selectAll()
    .where('cycleId', '=', cycle)
    .where('employeeId', '=', employeeId)
    .executeTakeFirst();
  return row
    ? {
        ...row,
        evidenceSnapshot: decode(row.evidenceSnapshot),
        adjustments: decode(row.adjustments),
        peerUserIds: decode(row.peerUserIds),
      }
    : (undefined as unknown as Json);
}

async function reviewOf(
  employeeId: string,
  role: string,
  reviewer?: string,
): Promise<Json> {
  let select = (await db())
    .query()
    .selectFrom('reviews')
    .selectAll()
    .where('cycleId', '=', CYCLE)
    .where('employeeId', '=', employeeId)
    .where('role', '=', role);
  if (reviewer) select = select.where('reviewerUserId', '=', reviewer);
  const row = await select.executeTakeFirst();
  return row
    ? {
        ...row,
        aiDraft: decode(row.aiDraft),
        hints: decode(row.hints),
        items: decode(row.items),
      }
    : (undefined as unknown as Json);
}

const CYCLE = 'perf-cycle-annual';
const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
const PAYROLL_MONTH = addMonths(today().slice(0, 7), -1);
let PAYROLL_CYCLE = '';

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 pure rules', () => {
  it('computes the reference score, the bands, the quality score and the adoption', async () => {
    const common =
      await import('../../server/providers/hr/performance/common.ts');
    const evidence =
      await import('../../server/providers/hr/performance/evidence.ts');
    const scale = [
      { code: 'S', score: 5, description: '' },
      { code: 'A', score: 4, description: '' },
      { code: 'B', score: 3, description: '' },
      { code: 'C', score: 2, description: '' },
      { code: 'D', score: 1, description: '' },
    ];
    expect(common.bandOf(4.6, scale)).toBe('S');
    expect(common.bandOf(3.5, scale)).toBe('A');
    expect(common.bandOf(2.2, scale)).toBe('C');
    expect(common.gradeGap('A', 'C', scale)).toBe(2);
    const sections = [
      { key: 'goals' as const, weight: 30 },
      { key: 'competencies' as const, weight: 40 },
      { key: 'qualitySafety' as const, weight: 30 },
    ];
    expect(
      common.computeScore(
        { sections },
        { goals: 4, competencies: 3, qualitySafety: 2, peer: null },
      ),
    ).toBe(3);
    // A missing dimension renormalizes the weights.
    expect(
      common.computeScore(
        { sections },
        { goals: null, competencies: 3, qualitySafety: 2, peer: null },
      ),
    ).toBe(2.57);
    // 能力维度: 评价等级 ÷ 岗位要求等级 × 3, capped at 5.
    const dims = common.dimensionScores({
      items: { competencies: [{ competencyId: 'c', level: 4 }] },
      goalWeights: new Map(),
      requirements: new Map([['c', 2]]),
      qualityReference: 2,
      peerScores: [],
      scoring: common.DEFAULT_SCORING,
    });
    expect(dims.competencies).toBe(5);
    expect(dims.qualitySafety).toBe(2);
    const snapshot = {
      quality: {
        critical: 0,
        major: 2,
        minor: 1,
        issues: [
          {
            id: '1',
            externalId: 'QI-1',
            severity: 'major',
            category: '首件检验',
            occurredAt: null,
            counted: true,
          },
          {
            id: '2',
            externalId: 'QI-2',
            severity: 'major',
            category: '首件检验',
            occurredAt: null,
            counted: true,
          },
          {
            id: '3',
            externalId: 'QI-3',
            severity: 'minor',
            category: '设备故障',
            occurredAt: null,
            counted: false,
          },
        ],
      },
      learning: { onTimeRate: 100 } as never,
      certificates: [],
      attendance: { absentDays: 0 } as never,
    };
    expect(
      evidence.qualitySafetyScore(
        snapshot as never,
        common.DEFAULT_QUALITY_RULES,
      ).score,
    ).toBe(2);
    expect(
      evidence.qualitySafetyScore(snapshot as never, {
        ...common.DEFAULT_QUALITY_RULES,
        perIssue: { critical: -3, major: -2, minor: -0.5 },
      }).score,
    ).toBe(1);
    expect(
      common.adoptionOf('考核期内两起质量问题。', '考核期内两起质量问题。', {
        asIs: 0.95,
        edited: 0.3,
      }),
    ).toBe('adoptedAsIs');
    expect(
      common.adoptionOf(
        '考核期内两起质量问题，目标完成 80%。',
        '考核期内两起质量问题，目标完成 60%，需改进。',
        { asIs: 0.95, edited: 0.3 },
      ),
    ).toBe('edited');
    expect(
      common.adoptionOf('考核期内两起质量问题。', '表现一般。', {
        asIs: 0.95,
        edited: 0.3,
      }),
    ).toBe('discarded');
  });

  it('accepts bonusBase × perf.coefficient in the payroll formula whitelist', async () => {
    const formula =
      await import('../../server/providers/hr/payroll/formula.ts');
    const context = {
      params: new Set<string>(),
      earlierItems: new Set<string>(),
      importedItems: new Set<string>(),
    };
    const node = formula.checkFormula('bonusBase × perf.coefficient', context);
    expect(
      formula.evaluateFormula(node, (n) => (n === 'bonusBase' ? 3000 : 1.2)),
    ).toBe(3600);
    expect(() => formula.checkFormula('perf.rating × 2', context)).toThrow();
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 schemes and coefficients', () => {
  it('hr01 sees both schemes with the coefficients read-only; payroll01 maintains the coefficients only', async () => {
    const admin = await call('hr01', 'GET', perf('/schemes'));
    expect(admin.status).toBe(200);
    const titles = admin.json.data.schemes.map((s: Json) => s.title);
    expect(titles).toEqual(
      expect.arrayContaining(['生产操作工考核方案', '管理岗考核方案']),
    );
    const operator = admin.json.data.schemes.find(
      (s: Json) => s.title === '生产操作工考核方案',
    );
    expect(operator.ratingCoefficients).toMatchObject({
      S: 1.5,
      A: 1.2,
      B: 1,
      C: 0.7,
      D: 0,
    });
    expect(operator.sections).toEqual([
      { key: 'goals', weight: 30 },
      { key: 'competencies', weight: 40 },
      { key: 'qualitySafety', weight: 30 },
    ]);
    expect(admin.json.data.can).toMatchObject({
      manage: true,
      manageCoefficients: false,
    });
    expect(
      (
        await call(
          'hr01',
          'PUT',
          perf(`/schemes/${operator.id}/coefficients`),
          { coefficients: { A: 2 } },
        )
      ).status,
    ).toBe(403);
    // manage never writes the coefficients.
    const {
      id: _id,
      ratingCoefficients: _c,
      updatedAt: _u,
      customFields: _f,
      ...rest
    } = operator;
    expect(
      (
        await call('hr01', 'PUT', perf(`/schemes/${operator.id}`), {
          ...rest,
          ratingCoefficients: { A: 9 },
        })
      ).status,
    ).toBe(400);
    // 维度与权重合计须为 100.
    const bad = await call('hr01', 'PUT', perf(`/schemes/${operator.id}`), {
      ...rest,
      sections: [
        { key: 'goals', weight: 30 },
        { key: 'competencies', weight: 30 },
      ],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('REVIEW_SCHEME_WEIGHTS_NOT_100');

    const payroll = await call('payroll01', 'GET', perf('/schemes'));
    expect(payroll.status).toBe(200);
    const mine = payroll.json.data.schemes.find(
      (s: Json) => s.title === '生产操作工考核方案',
    );
    expect(mine).not.toHaveProperty('sections');
    expect(mine).not.toHaveProperty('qualitySafetyRules');
    const saved = await call(
      'payroll01',
      'PUT',
      perf(`/schemes/${operator.id}/coefficients`),
      {
        coefficients: { S: 1.6, A: 1.2, B: 1.0, C: 0.7, D: 0 },
      },
    );
    expect(saved.status).toBe(200);
    expect(saved.json.data.ratingCoefficients.S).toBe(1.6);
    await call(
      'payroll01',
      'PUT',
      perf(`/schemes/${operator.id}/coefficients`),
      {
        coefficients: { S: 1.5, A: 1.2, B: 1.0, C: 0.7, D: 0 },
      },
    );
    expect(
      (await call('payroll01', 'PUT', perf(`/schemes/${operator.id}`), rest))
        .status,
    ).toBe(403);
    expect((await call('mgr_njl', 'GET', perf('/schemes'))).status).toBe(403);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 cycle, participants and goals', () => {
  it('previews the expected list with the reasons, and matches the schemes', async () => {
    const preview = await call('hr01', 'POST', perf('/cycles/preview'), {
      departmentIds: ['sz'],
    });
    expect(preview.status).toBe(200);
    const inList = new Map(
      preview.json.data.participants.map((p: Json) => [p.name, p]),
    );
    for (const name of ['陈静', '王磊', '李敏', '钱进'])
      expect(inList.has(name)).toBe(true);
    expect((inList.get('陈静') as Json).schemeTitle).toBe('管理岗考核方案');
    for (const name of ['王磊', '李敏', '钱进'])
      expect((inList.get(name) as Json).schemeTitle).toBe('生产操作工考核方案');
    const excluded = new Map(
      preview.json.data.excluded.map((p: Json) => [p.name, p.reasons]),
    );
    expect(excluded.get('刘洋')).toContain('tenure');
    expect(excluded.get('孙丽')).toContain('probation');
    expect(excluded.get('周宏')).toEqual(['noManager']);
    expect(
      (
        await call('mgr_njl', 'POST', perf('/cycles/preview'), {
          departmentIds: ['sz'],
        })
      ).status,
    ).toBe(403);
  });

  it('starts goal setting: results for the participants, 陈静 reviewed by 周宏 without a skip-level reviewer', async () => {
    const ask = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/advance`),
      {},
    );
    expect(ask.json.data).toMatchObject({
      advanced: false,
      next: 'goalSetting',
    });
    const done = await call('hr01', 'POST', perf(`/cycles/${CYCLE}/advance`), {
      confirm: true,
    });
    expect(done.status).toBe(200);
    expect(done.json.data.advanced).toBe(true);
    const chen = await resultOf('emp-mgr-njl');
    expect(chen.managerUserId).toBe(await userId('mgr_east'));
    expect(chen.skipLevelSkipped === true || chen.skipLevelSkipped === 1).toBe(
      true,
    );
    expect(chen.peerStatus).toBe('nominated');
    expect(chen.peerUserIds).toHaveLength(3);
    expect((await resultOf('emp-qianjin')).managerUserId).toBe(
      await userId('mgr_njl'),
    );
    expect(await resultOf('emp-mgr-east')).toBeUndefined();
    expect(
      await notification(`perf:${CYCLE}:goalSetting:emp-wanglei`),
    ).toBeTruthy();
    const detail = await call('hr01', 'GET', perf(`/cycles/${CYCLE}`));
    expect(detail.json.data.cycle.status).toBe('goalSetting');
    expect(detail.json.data.exclusions.map((e: Json) => e.name)).toEqual(
      expect.arrayContaining(['刘洋', '孙丽', '周宏']),
    );
  });

  it('the daily task drafts 2–4 aligned goals for 王磊 and reminds him once; a second run adds nothing', async () => {
    const first = await call('hr01', 'POST', perf('/tasks/daily/run'), {});
    expect(first.status).toBe(200);
    const goals = (
      await call('emp_njl_1', 'GET', perf(`/me/goals?cycleId=${CYCLE}`))
    ).json.data;
    const drafts = goals.goals.filter((g: Json) => g.source === 'ai');
    expect(drafts.length).toBeGreaterThanOrEqual(2);
    expect(drafts.length).toBeLessThanOrEqual(4);
    expect(drafts.every((g: Json) => g.status === 'draft')).toBe(true);
    expect(
      drafts.some((g: Json) =>
        ['perf-goal-mc-quality', 'perf-goal-mc-onboarding'].includes(
          g.alignedGoalId,
        ),
      ),
    ).toBe(true);
    expect(goals.departmentGoals.map((g: Json) => g.id)).toContain(
      'perf-goal-mc-quality',
    );
    expect(
      await notification(`perf:goalDraft:${CYCLE}:emp-wanglei`),
    ).toBeTruthy();
    await call('hr01', 'POST', perf('/tasks/daily/run'), {});
    const again = (
      await call('emp_njl_1', 'GET', perf(`/me/goals?cycleId=${CYCLE}`))
    ).json.data;
    expect(again.goals).toHaveLength(goals.goals.length);
    const reminders = await (
      await db()
    )
      .query()
      .selectFrom('hrReminderLog')
      .select(['id'])
      .where('reminderKey', '=', `perf:goalDraft:${CYCLE}:emp-wanglei`)
      .execute();
    expect(reminders).toHaveLength(1);
    // 09:00 rule: 3 days before the goal-setting deadline, everyone without submitted goals is reminded once.
    expect(
      await notification(
        `perf:deadline:${CYCLE}:goalSetting:${await userId('emp_njl_3')}:3`,
      ),
    ).toBeTruthy();
    // 一键催办: at most once per person within 24 hours.
    const urged = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/remind`),
      {},
    );
    expect(urged.status).toBe(200);
    expect(urged.json.data.sent).toBeGreaterThan(0);
    const again2 = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/remind`),
      {},
    );
    expect(again2.json.data).toMatchObject({ sent: 0 });
    expect(again2.json.data.skipped).toBe(urged.json.data.sent);
    expect(
      (await call('mgr_njl', 'POST', perf(`/cycles/${CYCLE}/remind`), {}))
        .status,
    ).toBe(403);
  });

  it('王磊 cannot submit goals whose weights do not sum to 100; after fixing them mgr_njl confirms', async () => {
    const goals = (
      await call('emp_njl_1', 'GET', perf(`/me/goals?cycleId=${CYCLE}`))
    ).json.data.goals as Json[];
    const [first, ...others] = goals;
    const edited = await call(
      'emp_njl_1',
      'PATCH',
      perf(`/goals/${first.id}`),
      {
        title: `${first.title}（本人修改）`,
        weight: (first.weight ?? 0) + 10,
      },
    );
    expect(edited.status).toBe(200);
    expect(
      edited.json.data.editedByEmployee === true ||
        edited.json.data.editedByEmployee === 1,
    ).toBe(true);
    const refused = await call('emp_njl_1', 'POST', perf('/goals/submit'), {
      cycleId: CYCLE,
    });
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('GOAL_WEIGHTS_NOT_100');
    await call('emp_njl_1', 'PATCH', perf(`/goals/${first.id}`), {
      weight: first.weight,
    });
    const submitted = await call('emp_njl_1', 'POST', perf('/goals/submit'), {
      cycleId: CYCLE,
    });
    expect(submitted.status).toBe(200);
    // He cannot confirm his own; his manager can.
    expect(
      (
        await call('emp_njl_1', 'POST', perf(`/goals/${first.id}/decide`), {
          decision: 'approve',
        })
      ).status,
    ).toBe(403);
    for (const goal of [first, ...others]) {
      const decided = await call(
        'mgr_njl',
        'POST',
        perf(`/goals/${goal.id}/decide`),
        { decision: 'approve' },
      );
      expect(decided.status).toBe(200);
      expect(decided.json.data.status).toBe('approved');
    }
    // Progress updates are kept.
    const progress = await call(
      'emp_njl_1',
      'POST',
      perf(`/goals/${first.id}/progress`),
      { progress: 60, note: '上半年无 major' },
    );
    expect(progress.json.data.progressNotes).toHaveLength(1);
  });

  it('钱进 and 李敏 set their own goals; 周宏 confirms 陈静’s peers; employees cannot nominate their manager', async () => {
    for (const username of ['emp_njl_3', 'emp_njl_2']) {
      const mine = (
        await call(username, 'GET', perf(`/me/goals?cycleId=${CYCLE}`))
      ).json.data.goals as Json[];
      for (const goal of mine)
        await call(username, 'POST', perf(`/goals/${goal.id}/cancel`), {});
      await call(username, 'POST', perf('/goals'), {
        cycleId: CYCLE,
        title: '首件检验记录完整',
        measure: '首件检验记录完整率 100%',
        weight: 60,
        alignedGoalId: 'perf-goal-mc-quality',
      });
      await call(username, 'POST', perf('/goals'), {
        cycleId: CYCLE,
        title: '按期完成复审',
        measure: '上岗证在考核期内保持有效',
        weight: 40,
      });
      expect(
        (
          await call(username, 'POST', perf('/goals/submit'), {
            cycleId: CYCLE,
          })
        ).status,
      ).toBe(200);
      const team = (
        await call('mgr_njl', 'GET', perf(`/goals/team?cycleId=${CYCLE}`))
      ).json.data as Json[];
      for (const goal of team.filter((g) => g.status === 'submitted'))
        await call('mgr_njl', 'POST', perf(`/goals/${goal.id}/decide`), {
          decision: 'approve',
        });
    }
    const chen = await resultOf('emp-mgr-njl');
    expect(
      (
        await call('mgr_njl', 'POST', perf('/me/peers'), {
          cycleId: CYCLE,
          userIds: [await userId('mgr_east'), await userId('hr01')],
        })
      ).json.code,
    ).toBe('REVIEW_PEERS_MANAGER');
    const confirmed = await call(
      'mgr_east',
      'POST',
      perf(`/results/${chen.id}/peers`),
      {},
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.peerStatus).toBe('confirmed');
  });
});

// ------------------------------------------------------------------------------------------------------------------
/**
 * What earlier steps' walkthroughs leave behind and the V4-12 demo deliberately does not pre-run: V3-11 pushes
 * QI-2026-0457 (钱进, major) and completes 王磊's targeted training for QI-2026-0412; V3-10's renewal leaves 钱进 a
 * completed remedial task.
 */
async function arrangeEarlierScenes() {
  const database = await db();
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(`${today()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const stamp = { createdAt: now, updatedAt: now };
  await database
    .query()
    .insertInto('businessSignals')
    .values({
      id: 'signal-qi-2026-0457',
      sourceSystem: 'qms',
      externalId: 'QI-2026-0457',
      signalType: 'qualityIssue',
      category: '首件检验',
      severity: 'major',
      title: '夜班换刀后首件尺寸超差',
      summary: '夜班换刀后未做首件检验，孔径超差 8 件。',
      occurredAt: new Date(`${day(-10)}T03:00:00Z`),
      employeeId: 'emp-qianjin',
      personKey: 'QH2003',
      departmentId: 'sz-mc',
      competencyId: 'comp-cnc',
      correctiveActionRef: null,
      link: null,
      matchStatus: 'matched',
      rawPayload: null,
      customFields: null,
      channel: 'push',
      ingestedBy: null,
      ...stamp,
    })
    .execute();
  await database
    .query()
    .insertInto('trainingRecommendations')
    .values({
      id: 'test-rec-wanglei',
      departmentId: 'sz-mc',
      competencyId: 'comp-cnc',
      reason: '停机后首件检验类质量问题的专项培训',
      evidence: [
        { signalId: 'signal-qi-2026-0412', externalId: 'QI-2026-0412' },
      ],
      audience: [{ employeeId: 'emp-wanglei', reason: 'QI-2026-0412' }],
      items: [],
      dueDate: day(-20),
      correctiveActionRefs: null,
      reviewerUserId: await userId('mgr_njl'),
      status: 'completed',
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      completedAt: new Date(`${day(-25)}T08:00:00Z`),
      certificateFileId: null,
      writebackStatus: null,
      writebackError: null,
      writebackAt: null,
      source: 'ai',
      ...stamp,
    })
    .execute();
  await database
    .query()
    .insertInto('assignments')
    .values({
      id: 'test-qianjin-remedial',
      employeeId: 'emp-qianjin',
      courseId: 'course-cnc-intro',
      examId: null,
      certificateId: null,
      learningPathId: null,
      parentAssignmentId: null,
      pathStepId: null,
      practiceScenarioId: null,
      learningPlanId: null,
      optional: false,
      reminderCount: 0,
      assignedByUserId: null,
      dueDate: day(-30),
      status: 'completed',
      progress: 100,
      source: 'remedial',
      completedAt: new Date(`${day(-35)}T08:00:00Z`),
      cancelledAt: null,
      lastRemindedAt: null,
      escalatedAt: null,
      ...stamp,
    })
    .execute();
}

describe('V4-12 evidence, self and peer reviews', () => {
  it('builds the snapshots: 钱进 two major issues and a quality score of 2; 王磊’s late count matches the summaries', async () => {
    await arrangeEarlierScenes();
    const advanced = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/advance`),
      { confirm: true },
    );
    expect(advanced.json.data.next).toBe('selfReview');
    const qian = await resultOf('emp-qianjin');
    const snapshot = qian.evidenceSnapshot;
    const counted = snapshot.quality.issues.filter((i: Json) => i.counted);
    expect(counted.map((i: Json) => i.externalId).sort()).toEqual([
      'QI-2026-0301',
      'QI-2026-0457',
    ]);
    expect(counted.every((i: Json) => i.severity === 'major')).toBe(true);
    // 设备故障 (QI-2026-0439) is listed but not counted.
    expect(
      snapshot.quality.issues.find((i: Json) => i.externalId === 'QI-2026-0439')
        ?.counted,
    ).toBe(false);
    expect(snapshot.qualitySafety.score).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain('超差');
    expect(snapshot.learning.remedialCompleted).toBeGreaterThanOrEqual(1);

    const wang = (await resultOf('emp-wanglei')).evidenceSnapshot;
    const year = today().slice(0, 4);
    const summaries = (
      await (
        await db()
      )
        .query()
        .selectFrom('attendanceMonthlySummaries')
        .select(['lateCount', 'status', 'month'])
        .where('employeeId', '=', 'emp-wanglei')
        .execute()
    ).filter(
      (s) => String(s.status) === 'locked' && String(s.month).startsWith(year),
    );
    expect(wang.attendance.lateCount).toBe(
      summaries.reduce((sum, s) => sum + Number(s.lateCount), 0),
    );
    expect(wang.attendance.lateCount).toBeGreaterThanOrEqual(1);
    expect(wang.quality.issues.map((i: Json) => i.externalId)).toContain(
      'QI-2026-0412',
    );
    expect(wang.training.completedRecommendations).toContain(
      'test-rec-wanglei',
    );

    // The assistant's summary (rule fallback): numbers, no description.
    const summary = await until(
      async () =>
        (await resultOf('emp-qianjin')).evidenceSummary as string | null,
      (value) => Boolean(value),
    );
    expect(summary).toContain('QI-2026-0301');
    expect(summary).not.toContain('超差');
    expect(summary!.length).toBeLessThanOrEqual(150);
    // Self tasks for people with an account only.
    const gu = await resultOf('emp-profile-guqiang');
    if (gu) {
      expect(gu.noAccount === true || gu.noAccount === 1).toBe(true);
      expect(await reviewOf('emp-profile-guqiang', 'self')).toBeUndefined();
    }
  });

  it('王磊 sees his own snapshot on the self review and submits it; nobody else reads it', async () => {
    const me = (await call('emp_njl_1', 'GET', perf('/me'))).json.data;
    const cycle = me.cycles.find((c: Json) => c.cycleId === CYCLE);
    expect(cycle.selfReview.status).toBe('notStarted');
    const page = await call(
      'emp_njl_1',
      'GET',
      perf(`/reviews/${cycle.selfReview.reviewId}`),
    );
    expect(page.status).toBe(200);
    expect(
      page.json.data.evidence.snapshot.quality.issues.length,
    ).toBeGreaterThan(0);
    expect(page.json.data.review.aiDraft).toBeNull();
    const submitted = await call(
      'emp_njl_1',
      'POST',
      perf(`/reviews/${cycle.selfReview.reviewId}/submit`),
      {
        comment:
          '上半年完成首件检验记录 100%，一起 major 质量问题已完成专项培训。',
      },
    );
    expect(submitted.status).toBe(200);
    expect(
      (
        await call(
          'emp_njl_2',
          'GET',
          perf(`/reviews/${cycle.selfReview.reviewId}`),
        )
      ).status,
    ).toBe(404);
  });

  it('peer reviews of 陈静 are anonymous to her and the other peers; hr01 sees who wrote them', async () => {
    const advanced = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/advance`),
      { confirm: true },
    );
    expect(advanced.json.data.next).toBe('peerReview');
    const peers: Record<string, string> = {};
    for (const [username, rating] of [
      ['trainer01', 'A'],
      ['hr01', 'B'],
      ['emp_njl_2', 'A'],
    ] as const) {
      const tasks = (await call(username, 'GET', perf('/me/tasks'))).json
        .data as Json[];
      const task = tasks.find(
        (t) => t.role === 'peer' && t.employeeId === 'emp-mgr-njl',
      );
      expect(task).toBeTruthy();
      peers[username] = task!.reviewId;
      const context = (
        await call(username, 'GET', perf(`/reviews/${task!.reviewId}`))
      ).json.data;
      expect(context.evidence).toBeNull();
      expect(context.selfReview).toBeNull();
      const done = await call(
        username,
        'POST',
        perf(`/reviews/${task!.reviewId}/submit`),
        {
          overallRating: rating,
          comment: `${username} 的互评：组织车间质量复盘 3 次。`,
        },
      );
      expect(done.status).toBe(200);
    }
    // 陈静 has no access to the peer tasks about her; peers cannot read each other's.
    expect(
      (await call('mgr_njl', 'GET', perf(`/reviews/${peers.trainer01}`)))
        .status,
    ).toBe(404);
    expect(
      (await call('trainer01', 'GET', perf(`/reviews/${peers.emp_njl_2}`)))
        .status,
    ).toBe(404);
    const chen = await resultOf('emp-mgr-njl');
    const admin = await call(
      'hr01',
      'GET',
      perf(`/results/${chen.id}/reviews`),
    );
    expect(admin.status).toBe(200);
    expect(
      admin.json.data.peers.entries.every(
        (e: Json) => e.reviewerUserId && e.reviewerName,
      ),
    ).toBe(true);
    const manager = await call(
      'mgr_east',
      'GET',
      perf(`/results/${chen.id}/reviews`),
    );
    expect(manager.status).toBe(200);
    expect(manager.json.data.peers.count).toBe(3);
    expect(
      manager.json.data.peers.entries.some((e: Json) => 'reviewerUserId' in e),
    ).toBe(false);
    expect(
      (await call('mgr_njl', 'GET', perf(`/results/${chen.id}/reviews`)))
        .status,
    ).toBe(404);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 manager reviews', () => {
  let qianReview: Json;

  it('the AI draft card is there for mgr_njl, and the form is empty until adopted', async () => {
    const advanced = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/advance`),
      { confirm: true },
    );
    expect(advanced.json.data.next).toBe('managerReview');
    const njl = await userId('mgr_njl');
    qianReview = await until(
      () => reviewOf('emp-qianjin', 'manager', njl),
      (row) => Boolean(row?.aiDraft),
    );
    expect(qianReview.aiDraft.comment).toContain('QI-2026-0301');
    expect(qianReview.aiDraft.source).toBe('rule');
    expect(qianReview.aiDraft).not.toHaveProperty('overallRating');
    const page = (
      await call('mgr_njl', 'GET', perf(`/reviews/${qianReview.id}`))
    ).json.data;
    expect(page.review.aiDraft.comment).toBe(qianReview.aiDraft.comment);
    expect(page.review.items).toEqual({});
    expect(page.review.overallRating).toBeNull();
    expect(page.review.status).toBe('notStarted');
    expect(page.evidence.snapshot.qualitySafety.score).toBe(2);
    expect(page.selfReview).not.toBeUndefined();
    expect(await notification(`perf:${CYCLE}:drafts:${njl}`)).toBeTruthy();
    // Another manager's task stays closed to 王磊 and to mgr_east's peers.
    expect(
      (await call('emp_njl_1', 'GET', perf(`/reviews/${qianReview.id}`)))
        .status,
    ).toBe(404);
    const team = (await call('mgr_njl', 'GET', perf(`/team?cycleId=${CYCLE}`)))
      .json.data.members as Json[];
    expect(team.map((m) => m.name)).toEqual(
      expect.arrayContaining(['王磊', '李敏', '钱进']),
    );
    expect(team.find((m) => m.name === '王磊')?.selfStatus).toBe('submitted');
  });

  it('mgr_njl rates 钱进 A: a reason is required two grades from the reference, the hints arrive once per submission', async () => {
    const page = (
      await call('mgr_njl', 'GET', perf(`/reviews/${qianReview.id}`))
    ).json.data;
    // 采用到评价表: the page copies the draft's comment and item notes into the form.
    const items = {
      goals: page.goals.map((g: Json) => ({
        goalId: g.id,
        score: 2,
        comment: page.review.aiDraft.itemSuggestions.goals.find(
          (x: Json) => x.goalId === g.id,
        )?.comment,
      })),
      competencies: page.requirements.map((r: Json) => ({
        competencyId: r.competencyId,
        level: Math.max(1, r.requiredLevel - 1),
      })),
      qualitySafety: {
        score: page.evidence.snapshot.qualitySafety.score,
        comment: page.review.aiDraft.itemSuggestions.qualitySafety?.comment,
      },
    };
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          perf(`/reviews/${qianReview.id}/activity`),
          { seconds: 95 },
        )
      ).status,
    ).toBe(200);
    const preview = await call(
      'mgr_njl',
      'POST',
      perf(`/reviews/${qianReview.id}/preview`),
      { items },
    );
    expect(preview.json.data.band).toBe('C');
    const refused = await call(
      'mgr_njl',
      'POST',
      perf(`/reviews/${qianReview.id}/submit`),
      {
        items,
        overallRating: 'A',
        comment: page.review.aiDraft.comment,
      },
    );
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('REVIEW_RATING_REASON_REQUIRED');
    const submitted = await call(
      'mgr_njl',
      'POST',
      perf(`/reviews/${qianReview.id}/submit`),
      {
        items,
        overallRating: 'A',
        overallReason: '下半年承担了新人带教',
        comment: page.review.aiDraft.comment,
      },
    );
    expect(submitted.status).toBe(200);
    const row = await until(
      () => reviewOf('emp-qianjin', 'manager'),
      (r) => r?.hints?.submission === 1,
    );
    expect(row.aiDraftAdoption).toBe('adoptedAsIs');
    const types = row.hints.items.map((h: Json) => h.type);
    expect(types).toEqual(
      expect.arrayContaining(['ratingVsScore', 'highRatingLowQuality']),
    );
    expect(row.hints.items.map((h: Json) => h.text).join('')).not.toMatch(
      /建议.*评为/u,
    );
    expect(await notification(`perf:hints:${row.id}:1`)).toBeTruthy();
    const result = await resultOf('emp-qianjin');
    expect(result.managerRating).toBe('A');
    expect(Number(result.computedScore)).toBeLessThan(2.5);
    // The same submission is never checked twice.
    const outcome = await (
      await services()
    ).context
      .automation()
      .run(
        'performanceAssistant.deviationCheck',
        'event',
        { dedupeKey: `${row.id}:1` },
        async () => ({}),
      );
    expect(outcome.status).toBe('duplicate');
    // Resubmitting (the hints do not block) is a new submission.
    const again = await call(
      'mgr_njl',
      'POST',
      perf(`/reviews/${qianReview.id}/submit`),
      {
        items,
        overallRating: 'A',
        overallReason: '下半年承担了新人带教',
        comment: `${page.review.aiDraft.comment}另：下半年带教新人 2 名。`,
      },
    );
    expect(again.status).toBe(200);
    const second = await until(
      () => reviewOf('emp-qianjin', 'manager'),
      (r) => r?.hints?.submission === 2,
    );
    expect(second.aiDraftAdoption).toBe('edited');
    expect(Number(second.activeSeconds)).toBe(95);
  });

  it('mgr_njl rates 王磊 A (with 安全生产与 5S above his level), 李敏 C; 周宏 rates 陈静', async () => {
    const njl = await userId('mgr_njl');
    const rate = async (
      employeeId: string,
      rating: string,
      extra: (page: Json) => Json = () => ({}),
    ) => {
      const review = await reviewOf(employeeId, 'manager', njl);
      const page = (await call('mgr_njl', 'GET', perf(`/reviews/${review.id}`)))
        .json.data;
      const items = {
        goals: page.goals.map((g: Json) => ({
          goalId: g.id,
          score: rating === 'A' ? 4 : 2,
        })),
        competencies: page.requirements.map((r: Json) => ({
          competencyId: r.competencyId,
          level: r.currentLevel ?? r.requiredLevel,
        })),
        qualitySafety: { score: page.evidence.snapshot.qualitySafety.score },
        ...extra(page),
      };
      const done = await call(
        'mgr_njl',
        'POST',
        perf(`/reviews/${review.id}/submit`),
        {
          items,
          overallRating: rating,
          overallReason: '依据目标完成情况和质量记录',
          comment: `目标完成率 ${rating === 'A' ? 90 : 50}%（目标记录）。`,
        },
      );
      expect(done.status).toBe(200);
      return page;
    };
    let safety: Json | undefined;
    await rate('emp-wanglei', 'A', (page) => {
      safety = page.requirements.find(
        (r: Json) => r.competencyId === 'comp-safety',
      );
      return {
        competencies: page.requirements.map((r: Json) => ({
          competencyId: r.competencyId,
          level:
            r.competencyId === 'comp-safety'
              ? 2
              : (r.currentLevel ?? r.requiredLevel),
        })),
      };
    });
    expect(safety).toBeTruthy();
    expect(safety!.currentLevel ?? 0).toBeLessThan(2);
    await rate('emp-limin', 'C');
    // Anyone else of 机加工车间 in the cycle (陈晨, 顾强…) gets a B so the cycle can be published.
    const team = (await call('mgr_njl', 'GET', perf(`/team?cycleId=${CYCLE}`)))
      .json.data.members as Json[];
    for (const member of team)
      if (
        member.myReviewStatus !== 'submitted' &&
        !['emp-wanglei', 'emp-limin', 'emp-qianjin'].includes(member.employeeId)
      )
        await rate(member.employeeId, 'B');
    // 周宏 reviews 陈静 and the 装配车间 / other people he is the manager reviewer of.
    const east = await userId('mgr_east');
    const eastTeam = (
      await call('mgr_east', 'GET', perf(`/team?cycleId=${CYCLE}`))
    ).json.data.members as Json[];
    expect(eastTeam.map((m) => m.name)).toContain('陈静');
    for (const member of eastTeam) {
      const review = await reviewOf(member.employeeId, 'manager', east);
      const page = (
        await call('mgr_east', 'GET', perf(`/reviews/${review.id}`))
      ).json.data;
      if (member.name === '陈静') expect(page.peers.count).toBe(3);
      const done = await call(
        'mgr_east',
        'POST',
        perf(`/reviews/${review.id}/submit`),
        {
          items: {
            goals: page.goals.map((g: Json) => ({ goalId: g.id, score: 3 })),
            competencies: page.requirements.map((r: Json) => ({
              competencyId: r.competencyId,
              level: r.currentLevel ?? r.requiredLevel,
            })),
          },
          overallRating: 'B',
          overallReason: '依据目标完成情况',
          comment: '全年组织质量复盘 3 次（会议记录）。',
        },
      );
      expect(done.status).toBe(200);
    }
  });

  it('the statistics tab shows each manager review’s adoption and active editing time', async () => {
    const stats = await call('hr01', 'GET', perf(`/cycles/${CYCLE}/stats`));
    expect(stats.status).toBe(200);
    const qian = stats.json.data.reviews.find(
      (r: Json) => r.employeeName === '钱进',
    );
    expect(qian).toMatchObject({
      aiDraftAdoption: 'edited',
      activeSeconds: 95,
    });
    expect(stats.json.data.adoption.counts.edited).toBeGreaterThanOrEqual(1);
    expect(
      (await call('mgr_njl', 'GET', perf(`/cycles/${CYCLE}/stats`))).status,
    ).toBe(403);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 calibration and publication', () => {
  it('shows 苏州工厂’s distribution against the guide and 钱进 among the anomalies; mgr_east reads only', async () => {
    const advanced = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/advance`),
      { confirm: true },
    );
    expect(advanced.json.data.next).toBe('calibration');
    const view = (
      await call('hr01', 'GET', perf(`/cycles/${CYCLE}/calibration`))
    ).json.data;
    expect(view.groups.length).toBeGreaterThan(0);
    const operator = view.groups.find(
      (g: Json) => g.schemeTitle === '生产操作工考核方案' && !g.departmentId,
    );
    expect(operator.distribution.guide.map((g: Json) => g.key)).toEqual(
      expect.arrayContaining(['S', 'A', 'C+D']),
    );
    const qian = view.results.find((r: Json) => r.name === '钱进');
    expect(qian.anomalies.map((a: Json) => a.type)).toEqual(
      expect.arrayContaining(['ratingVsScore', 'highRatingLowQuality']),
    );
    expect(view.can.adjust).toBe(true);
    const pack = await until(
      async () =>
        (await call('hr01', 'GET', perf(`/cycles/${CYCLE}/calibration`))).json
          .data.cycle.calibrationPack,
      (value) => Boolean(value),
    );
    expect(pack.content).toContain('钱进');
    const east = await call(
      'mgr_east',
      'GET',
      perf(`/cycles/${CYCLE}/calibration`),
    );
    expect(east.status).toBe(200);
    expect(east.json.data.can.adjust).toBe(false);
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          perf(`/results/${qian.resultId}/adjust`),
          { rating: 'B', reason: 'x' },
        )
      ).status,
    ).toBe(403);
    // 成都工厂 sees nothing of 苏州.
    const cd = await call(
      'mgr_cd',
      'GET',
      perf(`/cycles/${CYCLE}/calibration`),
    );
    expect(cd.status).toBe(200);
    expect(cd.json.data.results).toEqual([]);
    expect(
      (await call('emp_njl_1', 'GET', perf(`/cycles/${CYCLE}/calibration`)))
        .status,
    ).toBe(403);
  });

  it('可定制: major −2 makes 钱进’s quality score 1 after a refresh; reverting restores 2', async () => {
    const schemes = (await call('hr01', 'GET', perf('/schemes'))).json.data
      .schemes as Json[];
    const operator = schemes.find((s) => s.title === '生产操作工考核方案')!;
    const {
      id,
      ratingCoefficients: _c,
      updatedAt: _u,
      customFields: _f,
      ...rest
    } = operator;
    const rules = operator.qualitySafetyRules;
    const save = (major: number) =>
      call('hr01', 'PUT', perf(`/schemes/${id}`), {
        ...rest,
        qualitySafetyRules: {
          ...rules,
          perIssue: { ...rules.perIssue, major },
        },
      });
    expect((await save(-2)).status).toBe(200);
    expect(
      (
        await call(
          'hr01',
          'POST',
          perf(`/cycles/${CYCLE}/refresh-snapshots`),
          {},
        )
      ).status,
    ).toBe(200);
    expect(
      (await resultOf('emp-qianjin')).evidenceSnapshot.qualitySafety.score,
    ).toBe(1);
    expect((await save(-1.5)).status).toBe(200);
    await call('hr01', 'POST', perf(`/cycles/${CYCLE}/refresh-snapshots`), {});
    expect(
      (await resultOf('emp-qianjin')).evidenceSnapshot.qualitySafety.score,
    ).toBe(2);
  });

  it('hr01 moves 钱进 from A to B with a reason; the adjustment is kept', async () => {
    const qian = await resultOf('emp-qianjin');
    const refused = await call(
      'hr01',
      'POST',
      perf(`/results/${qian.id}/adjust`),
      { rating: 'B' },
    );
    expect(refused.status).toBe(400);
    const adjusted = await call(
      'hr01',
      'POST',
      perf(`/results/${qian.id}/adjust`),
      {
        rating: 'B',
        reason: '两起 major 质量问题，与 A 的标准不一致',
      },
    );
    expect(adjusted.status).toBe(200);
    const after = await resultOf('emp-qianjin');
    expect(after.calibratedRating).toBe('B');
    expect(after.adjustments).toEqual([
      expect.objectContaining({ from: 'A', to: 'B', by: await userId('hr01') }),
    ]);
  });

  it('closes 顾强’s result when he leaves before publication (offboard job event)', async () => {
    const gu = await resultOf('emp-profile-guqiang');
    if (!gu) return;
    const database = await db();
    const now = new Date();
    const eventId = `perf-test-offboard-${Date.now()}`;
    await database
      .query()
      .insertInto('jobEvents')
      .values({
        id: eventId,
        employeeId: 'emp-profile-guqiang',
        eventType: 'offboard',
        fromDepartmentId: 'sz-mc',
        toDepartmentId: null,
        fromPositionId: 'pos-cnc-operator',
        toPositionId: null,
        effectiveDate: today(),
        source: 'manual',
        actionId: null,
        note: '测试离职',
        syncRunId: null,
        processedAt: null,
        processError: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const { jobEventProcessorToken } =
      await import('../../server/providers/hr/tokens.ts');
    await server.application.container
      .resolve(jobEventProcessorToken)
      .process([eventId]);
    const closed = await resultOf('emp-profile-guqiang');
    expect(closed.status).toBe('closed');
    expect(closed.closedReason).toBe('offboarded');
    const reviews = await database
      .query()
      .selectFrom('reviews')
      .select(['status'])
      .where('resultId', '=', gu.id)
      .execute();
    for (const review of reviews)
      expect(['submitted', 'cancelled']).toContain(String(review.status));
  });

  it('publishes: 钱进 sees B and the manager’s comment, not the calibration record; the notice carries no rating', async () => {
    const published = await call(
      'hr01',
      'POST',
      perf(`/cycles/${CYCLE}/publish`),
      {},
    );
    expect(published.status).toBe(200);
    const mine = (await call('emp_njl_3', 'GET', perf('/me/results'))).json
      .data as Json[];
    const result = mine.find((r) => r.cycleId === CYCLE)!;
    expect(result.finalRating).toBe('B');
    expect(result.managerComment).toContain('QI-2026-0301');
    expect(result).not.toHaveProperty('adjustments');
    expect(result).not.toHaveProperty('calibratedRating');
    expect(result).not.toHaveProperty('computedScore');
    expect(JSON.stringify(result)).not.toContain(
      '两起 major 质量问题，与 A 的标准不一致',
    );
    const text = await inboxText(`perf:${CYCLE}:published:emp-qianjin`);
    expect(text).toContain('考核结果已发布');
    expect(text).not.toMatch(/(^|[^A-Za-z])[SABCD]([^A-Za-z]|$)/u);
    // No one else's rating reaches 钱进.
    expect(
      mine.every((r) => r.resultId === result.resultId || r.cycleId !== CYCLE),
    ).toBe(true);
  });

  it('writes 王磊’s 安全生产与 5S level 2 as a review assessment by mgr_njl', async () => {
    const rows = await (
      await db()
    )
      .query()
      .selectFrom('employeeCompetencies')
      .selectAll()
      .where('employeeId', '=', 'emp-wanglei')
      .where('competencyId', '=', 'comp-safety')
      .where('source', '=', 'review')
      .execute();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].level)).toBe(2);
    expect(String(rows[0].assessedBy)).toBe(await userId('mgr_njl'));
    expect(decode(rows[0].evidence)).toMatchObject({
      type: 'review',
      cycleId: CYCLE,
    });
  });

  it('a C result starts a reviewResult learning plan for mgr_njl, and hr01 is told', async () => {
    const limin = await resultOf('emp-limin');
    expect(limin.finalRating).toBe('C');
    const plan = await until(
      async () =>
        (await (
          await db()
        )
          .query()
          .selectFrom('learningPlans')
          .selectAll()
          .where('employeeId', '=', 'emp-limin')
          .where('trigger', '=', 'reviewResult')
          .executeTakeFirst()) as Json | undefined,
      (row) => Boolean(row),
    );
    expect(plan).toBeTruthy();
    expect(String(plan!.reviewerUserId)).toBe(await userId('mgr_njl'));
    expect(decode(plan!.triggerRef)).toMatchObject({ resultId: limin.id });
    expect(await notification(`perf:lowResult:${limin.id}`)).toBeTruthy();
    const decisions = await call(
      'mgr_njl',
      'GET',
      '/learning-plans?status=draft',
    );
    if (decisions.status === 200) {
      const items = (decisions.json.data.items ??
        decisions.json.data) as Json[];
      expect(items.some((p) => p.trigger === 'reviewResult')).toBe(true);
    }
  });

  it('钱进 appeals within 7 days and hr01 handles it; 7 days after publication 王磊’s result is acknowledged', async () => {
    const qian = await resultOf('emp-qianjin');
    expect(
      (
        await call('emp_njl_1', 'POST', perf(`/results/${qian.id}/appeal`), {
          reason: '不是我的',
        })
      ).status,
    ).toBe(404);
    const appealed = await call(
      'emp_njl_3',
      'POST',
      perf(`/results/${qian.id}/appeal`),
      { reason: '0457 为设备原因' },
    );
    expect(appealed.status).toBe(200);
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          perf(`/results/${qian.id}/appeal/handle`),
          { result: 'upheld', note: 'x' },
        )
      ).status,
    ).toBe(403);
    const handled = await call(
      'hr01',
      'POST',
      perf(`/results/${qian.id}/appeal/handle`),
      {
        result: 'upheld',
        note: '经质量部核实，QI-2026-0457 为操作原因',
      },
    );
    expect(handled.status).toBe(200);
    const after = await resultOf('emp-qianjin');
    expect(after.status).toBe('acknowledged');
    expect(decode(after.appeal)).toMatchObject({ result: 'upheld' });
    const wang = await resultOf('emp-wanglei');
    await (
      await db()
    )
      .query()
      .updateTable('reviewResults')
      .set({ publishedAt: new Date(Date.now() - 8 * 86_400_000) })
      .where('id', '=', wang.id)
      .execute();
    await call('hr01', 'POST', perf('/tasks/daily/run'), {});
    expect((await resultOf('emp-wanglei')).status).toBe('acknowledged');
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 payroll link', () => {
  it('payroll01 reads published final ratings only — no comment, snapshot or calibration record', async () => {
    const ratings = await call(
      'payroll01',
      'GET',
      perf(`/ratings?cycleId=${CYCLE}`),
    );
    expect(ratings.status).toBe(200);
    const rows = ratings.json.data as Json[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          'cycleId',
          'cycleTitle',
          'employeeId',
          'finalRating',
          'id',
          'publishedAt',
          'schemeId',
          'status',
        ].sort(),
      );
    }
    expect(rows.find((r) => r.employeeId === 'emp-wanglei')?.finalRating).toBe(
      'A',
    );
    for (const url of [
      `/cycles/${CYCLE}/calibration`,
      `/cycles/${CYCLE}`,
      `/results/${(await resultOf('emp-wanglei')).id}/reviews`,
    ])
      expect([403, 404]).toContain(
        (await call('payroll01', 'GET', perf(url))).status,
      );
    expect((await call('hr01', 'GET', perf('/ratings'))).status).toBe(403);
    expect(
      (await call('payroll01', 'GET', perf('/bonus-cycles'))).json.data.map(
        (c: Json) => c.id,
      ),
    ).toContain(CYCLE);
  });

  it('perfBonus = bonusBase × perf.coefficient: 王磊 × 1.2, 钱进 × 1.0; 0 without a bonus cycle; the snapshot keeps rating and coefficient', async () => {
    // payroll01 records the bonus base with a new salary file and opens the payroll month for 机加工车间.
    for (const employeeId of ['emp-wanglei', 'emp-qianjin']) {
      const files = (await call('payroll01', 'GET', `/salaries/${employeeId}`))
        .json.data.files as Json[];
      const latest = files[0];
      const created = await call('payroll01', 'POST', '/salaries', {
        employeeId,
        effectiveMonth: PAYROLL_MONTH,
        baseSalary: Number(latest.baseSalary),
        fixedAllowances: latest.fixedAllowances,
        salaryStructureId: latest.salaryStructureId,
        bonusBase: 3000,
      });
      expect(created.status).toBe(201);
      expect(created.json.data.bonusBase).toBe(3000);
    }
    const opened = await call('payroll01', 'POST', '/payroll/cycles', {
      month: PAYROLL_MONTH,
      departmentIds: ['sz-mc'],
    });
    expect(opened.status).toBe(201);
    PAYROLL_CYCLE = opened.json.data.id;
    const structures = (
      await call('payroll01', 'GET', '/payroll-settings/structures')
    ).json.data as Json[];
    const suzhou = structures.find((s) => s.title === '生产一线薪资结构')!;
    const saved = await call(
      'payroll01',
      'PUT',
      `/payroll-settings/structures/${suzhou.id}`,
      {
        title: suzhou.title,
        appliesTo: suzhou.appliesTo,
        items: suzhou.items.map((item: Json) =>
          item.code === 'perfBonus'
            ? {
                ...item,
                calc: 'formula',
                formula: 'bonusBase × perf.coefficient',
              }
            : item,
        ),
        params: suzhou.params,
        payRanges: suzhou.payRanges,
        payDaysPerMonth: suzhou.payDaysPerMonth ?? 21.75,
      },
    );
    expect(saved.status).toBe(200);
    expect(
      (
        await call(
          'hr01',
          'PUT',
          `/payroll/cycles/${PAYROLL_CYCLE}/bonus-cycle`,
          { bonusCycleId: CYCLE },
        )
      ).status,
    ).toBe(403);
    const set = await call(
      'payroll01',
      'PUT',
      `/payroll/cycles/${PAYROLL_CYCLE}/bonus-cycle`,
      { bonusCycleId: CYCLE },
    );
    expect(set.status).toBe(200);
    expect(set.json.data.bonusCycleTitle).toContain('年度考核');
    const calculated = await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${PAYROLL_CYCLE}/calculate`,
    );
    expect(calculated.status).toBe(200);
    const slip = async (employeeId: string) => {
      const row = await (
        await db()
      )
        .query()
        .selectFrom('payslips')
        .selectAll()
        .where('cycleId', '=', PAYROLL_CYCLE)
        .where('employeeId', '=', employeeId)
        .executeTakeFirst();
      return {
        lines: decode(row!.lines) as Json[],
        inputs: decode(row!.inputs) as Json,
      };
    };
    const wang = await slip('emp-wanglei');
    expect(wang.lines.find((l) => l.code === 'perfBonus')?.amount).toBe(3600);
    expect(wang.inputs.perf).toMatchObject({
      rating: 'A',
      coefficient: 1.2,
      status: 'found',
    });
    const qian = await slip('emp-qianjin');
    expect(qian.lines.find((l) => l.code === 'perfBonus')?.amount).toBe(3000);
    expect(qian.inputs.perf).toMatchObject({ rating: 'B', coefficient: 1 });
    // The anomaly check lists a participant without a published result, by type and cycle name only.
    const calculationId = calculated.json.data.cycle.calculationId;
    const anomalies = await until(
      async () =>
        (
          await call(
            'payroll01',
            'GET',
            `/payroll/cycles/${PAYROLL_CYCLE}/anomalies`,
          )
        ).json.data,
      (data: Json) => data?.review?.calculationId === calculationId,
    );
    const missing = (anomalies.issues as Json[]).filter(
      (i) => i.type === 'perfResultMissing',
    );
    expect(missing.length).toBeGreaterThan(0);
    for (const issue of missing) {
      expect(JSON.stringify(issue.facts)).not.toMatch(
        /"rating"|"finalRating"/u,
      );
      expect(issue.facts.cycleTitle).toContain('年度考核');
    }
    // Without a bonus cycle both coefficients are 0.
    await call(
      'payroll01',
      'PUT',
      `/payroll/cycles/${PAYROLL_CYCLE}/bonus-cycle`,
      { bonusCycleId: null },
    );
    await call(
      'payroll01',
      'POST',
      `/payroll/cycles/${PAYROLL_CYCLE}/calculate`,
    );
    expect(
      (await slip('emp-wanglei')).lines.find((l) => l.code === 'perfBonus')
        ?.amount,
    ).toBe(0);
    expect(
      (await slip('emp-qianjin')).lines.find((l) => l.code === 'perfBonus')
        ?.amount,
    ).toBe(0);
  });

  it('an adjustment for 王磊 cites his published result: fin01 sees “周期名称 · A” only, and the link stays after approval', async () => {
    const wang = await resultOf('emp-wanglei');
    const salary = (await call('payroll01', 'GET', '/salaries/emp-wanglei'))
      .json.data;
    const current = (salary.history ?? salary.files ?? [])[0] ?? salary.current;
    const month = addMonths(today().slice(0, 7), 1);
    const refused = await call('payroll01', 'POST', '/salaries/adjustments', {
      employeeId: 'emp-wanglei',
      effectiveMonth: month,
      baseSalary: Number(current.baseSalary) + 200,
      fixedAllowances: current.fixedAllowances,
      salaryStructureId: current.salaryStructureId,
      reason: '年度考核 A',
      relatedReviewResultId: (await resultOf('emp-qianjin')).id,
    });
    expect(refused.status).toBe(400);
    const created = await call('payroll01', 'POST', '/salaries/adjustments', {
      employeeId: 'emp-wanglei',
      effectiveMonth: month,
      baseSalary: Number(current.baseSalary) + 200,
      fixedAllowances: current.fixedAllowances,
      salaryStructureId: current.salaryStructureId,
      reason: '年度考核 A',
      relatedReviewResultId: wang.id,
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    const list = (await call('fin01', 'GET', '/salaries/adjustments')).json
      .data as Json[];
    const row = list.find((a) => a.id === id)!;
    expect(row.reviewResult).toEqual({
      cycleTitle: expect.stringContaining('年度考核'),
      finalRating: 'A',
    });
    const ratings = (await call('fin01', 'GET', perf('/ratings'))).json
      .data as Json[];
    expect(ratings.map((r) => r.employeeId)).toEqual(['emp-wanglei']);
    expect([403, 404]).toContain(
      (await call('fin01', 'GET', perf(`/results/${wang.id}/reviews`))).status,
    );
    const approved = await call(
      'fin01',
      'POST',
      `/salaries/adjustments/${id}/decide`,
      { decision: 'approve' },
    );
    expect(approved.status).toBe(200);
    const stored = await (
      await db()
    )
      .query()
      .selectFrom('salaryAdjustments')
      .select(['relatedReviewResultId', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();
    expect(String(stored!.relatedReviewResultId)).toBe(wang.id);
  });
});

// ------------------------------------------------------------------------------------------------------------------
describe('V4-12 security and the assistant', () => {
  it('emp_njl_1 cannot read others’ reviews, ratings or snapshots; team scopes stay within the factory', async () => {
    const qianManager = await reviewOf('emp-qianjin', 'manager');
    const qian = await resultOf('emp-qianjin');
    expect(
      (await call('emp_njl_1', 'GET', perf(`/reviews/${qianManager.id}`)))
        .status,
    ).toBe(404);
    expect(
      (await call('emp_njl_1', 'GET', perf(`/results/${qian.id}/reviews`)))
        .status,
    ).toBe(404);
    expect(
      (await call('emp_njl_1', 'GET', perf(`/employees/emp-qianjin/history`)))
        .status,
    ).toBe(403);
    expect(
      (await call('emp_njl_1', 'GET', perf(`/cycles/${CYCLE}`))).status,
    ).toBe(403);
    expect(
      (await call('emp_njl_1', 'GET', perf(`/team?cycleId=${CYCLE}`))).json.data
        ?.members ?? [],
    ).toEqual([]);
    const mine = (await call('emp_njl_1', 'GET', perf('/me'))).json.data;
    expect(JSON.stringify(mine)).not.toContain('emp-qianjin');
    // A 成都 cycle: mgr_njl sees none of it; mgr_cd none of 苏州.
    const created = await call('hr01', 'POST', perf('/cycles'), {
      title: '成都工厂季度考核',
      periodStart: `${today().slice(0, 4)}-07-01`,
      periodEnd: `${today().slice(0, 4)}-09-30`,
      scope: { departmentIds: ['cd'] },
      stageDeadlines: { goalSetting: today() },
    });
    expect(created.status).toBe(201);
    const cdCycle = created.json.data.cycle.id;
    await call('hr01', 'POST', perf(`/cycles/${cdCycle}/advance`), {
      confirm: true,
    });
    expect(
      (await call('mgr_njl', 'GET', perf(`/cycles/${cdCycle}/calibration`)))
        .json.data.results,
    ).toEqual([]);
    expect(
      (await call('mgr_njl', 'GET', perf(`/team?cycleId=${cdCycle}`))).json.data
        .members,
    ).toEqual([]);
    expect(
      (await call('mgr_njl', 'GET', perf(`/goals/team?cycleId=${cdCycle}`)))
        .json.data,
    ).toEqual([]);
    expect(
      (await call('mgr_cd', 'GET', perf(`/team?cycleId=${CYCLE}`))).json.data
        .members,
    ).toEqual([]);
    expect(
      (await call('mgr_cd', 'GET', perf(`/employees/emp-qianjin/history`))).json
        .data,
    ).toEqual([]);
    expect(
      (await call('mgr_njl', 'GET', perf('/employees/emp-qianjin/history')))
        .json.data[0],
    ).toMatchObject({ finalRating: 'B' });
  });

  it('the assistant has no tool that scores, rates or calibrates, and its progress answer holds no comment or rating', async () => {
    const tools = await import('../../server/ai/tools/performance-tools.ts');
    const names = tools.PERFORMANCE_TOOLS.map(
      (t: Json) => t.definition.name,
    ).sort();
    expect(names).toEqual(
      [
        'getMyReviewProgress',
        'getReviewContext',
        'getSchemeRules',
        'listRatingAnomalies',
        'saveCalibrationPack',
        'saveEvidenceSummary',
        'saveReviewDraft',
        'sendReviewHints',
        'suggestGoalDrafts',
      ].sort(),
    );
    const employee = (
      await import('../../server/ai/employees/performance-assistant/index.ts')
    ).default as Json;
    expect(employee.systemPrompt).toContain('不回答奖金金额和绩效系数问题');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const { performanceServicesToken } =
      await import('../../server/providers/hr/tokens.ts');
    const container = server.application.container;
    const invoke = (tools.getMyReviewProgress as Json).invoke as (
      ctx: Json,
      args: Json,
    ) => Promise<Json>;
    const answer = await invoke(
      {
        actor: { id: await userId('emp_njl_3') },
        deps: {
          performance: container.resolve(performanceServicesToken),
          authz: container.resolve(authorizationToken),
        },
      },
      {},
    );
    expect(answer.status).toBe('success');
    const text = JSON.stringify(answer.content);
    expect(text).toContain('年度考核');
    expect(text).not.toMatch(/finalRating|managerRating|comment|"B"/u);
    const schemeRules = await call(
      'emp_njl_1',
      'GET',
      perf(`/schemes/perf-scheme-operator/rules`),
    );
    expect(schemeRules.status).toBe(200);
    expect(schemeRules.json.data).not.toHaveProperty('ratingCoefficients');
  });

  it('the unified entry sends “我的考核到哪一步了” to the performance assistant', async () => {
    const routed = await call('emp_njl_1', 'POST', '/ai-entry/route', {
      question: '我的考核到哪一步了',
    });
    expect(routed.status).toBe(200);
    expect(routed.json.data.employee ?? routed.json.data.route?.employee).toBe(
      'performanceAssistant',
    );
  });
});

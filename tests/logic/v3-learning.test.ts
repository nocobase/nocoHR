// @vitest-environment node

// V3-09 学习与培训, the parts completed in this step: learning that follows job events (onboard / transfer / promote /
// offboard) through the job-event processor, idempotent per event; the learning coach's plans after a job change and for
// a development target; the administrator's learning rules (due-soon days, plan expiry, check-in window, watch share).
// Each run boots the real standalone server on a throwaway SQLite database with migrations and seeds. No model is
// configured, so the coach takes its rule-based fallback.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  LEARNING_RULE_DEFAULTS,
  resolveLearningRules,
} from '../../server/providers/hr/learning-settings.ts';
import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// See training-acceptance.test.ts: seeds import `database/seed-data/*.js`, which Node maps to the `.ts` source here.
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
const PASSWORD = 'v3-learning-test-password';

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
  expect(response.status, `sign in ${username}`).toBe(200);
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
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id ?? me.json.data?.user?.id);
}

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
): Promise<T> {
  for (let i = 0; i < 100; i += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v3-learning-'));
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
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function services() {
  const container = server.application.container;
  const { databaseManagerToken } = await import('@nocobase/db');
  const tokens = await import('../../server/providers/hr/tokens.ts');
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  return {
    db: container.resolve(databaseManagerToken),
    processor: container.resolve(tokens.jobEventProcessorToken),
    learning: container.resolve(tokens.learningJobEventsToken),
    paths: container.resolve(tokens.pathServiceToken),
    automation: container.resolve(tokens.automationTasksToken),
    notifications: container.resolve(notificationServiceToken),
  };
}

async function eventsOf(employeeId: string, type: string): Promise<Json[]> {
  const { db } = await services();
  return (await db
    .query()
    .selectFrom('jobEvents')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .where('eventType', '=', type)
    .orderBy('createdAt', 'desc')
    .execute()) as Json[];
}

async function assignmentsOf(employeeId: string): Promise<Json[]> {
  const { db } = await services();
  return (await db
    .query()
    .selectFrom('assignments')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .execute()) as Json[];
}

async function pathId(code: string): Promise<string> {
  const { db } = await services();
  const row = await db
    .query()
    .selectFrom('learningPaths')
    .select(['id'])
    .where('code', '=', code)
    .executeTakeFirstOrThrow();
  return String(row.id);
}

describe('learning rules (学习规则)', () => {
  it('reads defaults for a missing or out-of-range value', () => {
    expect(resolveLearningRules(undefined)).toEqual(LEARNING_RULE_DEFAULTS);
    expect(
      resolveLearningRules(
        JSON.stringify({ dueSoonDays: 5, planExpiryDays: 0 }),
      ),
    ).toEqual({ ...LEARNING_RULE_DEFAULTS, dueSoonDays: 5 });
  });

  it('lets only an HR administrator change them, at the revision read', async () => {
    expect((await call('mgr_njl', 'GET', '/learning-settings')).status).toBe(
      403,
    );
    expect((await call('trainer01', 'GET', '/learning-settings')).status).toBe(
      403,
    );
    expect((await call(null, 'GET', '/learning-settings')).status).toBe(401);
    const read = await call('hr01', 'GET', '/learning-settings');
    expect(read.status).toBe(200);
    expect(read.json.data.value).toEqual(LEARNING_RULE_DEFAULTS);
    expect(read.json.data.revision).toBe(0);
    const value = { ...LEARNING_RULE_DEFAULTS, dueSoonDays: 5 };
    expect(
      (
        await call('mgr_njl', 'PUT', '/learning-settings', {
          revision: 0,
          value,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('hr01', 'PUT', '/learning-settings', {
          revision: 0,
          value: { ...value, dueSoonDays: 99 },
        })
      ).status,
    ).toBe(400);
    const saved = await call('hr01', 'PUT', '/learning-settings', {
      revision: 0,
      value,
    });
    expect(saved.status).toBe(200);
    expect(saved.json.data.revision).toBe(1);
    expect(saved.json.data.value.dueSoonDays).toBe(5);
    // A second administrator still holding revision 0 is refused rather than overwriting.
    expect(
      (
        await call('hr01', 'PUT', '/learning-settings', {
          revision: 0,
          value: LEARNING_RULE_DEFAULTS,
        })
      ).status,
    ).toBe(409);
  });
});

describe('job events drive learning (总纲 rule 2)', () => {
  it('assigns the new position’s onboarding path on a transfer, counting finished courses, keeping manual tasks', async () => {
    const before = await assignmentsOf('emp-limin');
    const manualCnc = before.find((a) => a.id === 'assign-limin-cnc');
    expect(manualCnc).toBeDefined();
    const moved = await call(
      'hr01',
      'POST',
      '/employees/emp-limin/correct-job',
      {
        departmentId: 'sz-as',
        positionId: 'pos-assembler',
        note: '调往装配车间',
      },
    );
    expect(moved.status).toBe(200);
    const [event] = await eventsOf('emp-limin', 'transfer');
    expect(event.processedAt).toBeTruthy();
    const after = await assignmentsOf('emp-limin');
    const parents = after.filter((a) => a.jobEventId === event.id);
    expect(parents).toHaveLength(1);
    expect(parents[0].learningPathId).toBe(
      await pathId('path-assembler-onboard'),
    );
    expect(parents[0].source).toBe('path');
    // The manual CNC task stays as it was.
    const cnc = after.find((a) => a.id === 'assign-limin-cnc')!;
    expect(cnc.status).not.toBe('cancelled');
    expect(cnc.parentAssignmentId).toBeNull();

    const block = await call('hr01', 'GET', `/learning-job-events/${event.id}`);
    expect(block.status).toBe(200);
    expect(block.json.data.processed).toBe(true);
    expect(block.json.data.assignedPath.title).toBe('装配工上岗路径');
    expect(block.json.data.assignedPath.completedSteps).toContain(
      '质量记录填写规范',
    );
    // Out of the viewer's scope, or no event viewing at all: the block is not there.
    expect(
      (await call('emp_njl_1', 'GET', `/learning-job-events/${event.id}`))
        .status,
    ).toBeGreaterThanOrEqual(403);
  });

  it('assigns the onboarding path to a new hire, due from the effective date, and tells the head; not to a backfill', async () => {
    const { today, addDays } =
      await import('../../server/providers/hr/shared.ts');
    const hire = async (employeeNo: string, name: string, hireDate: string) => {
      const created = await call('hr01', 'POST', '/employees', {
        employeeNo,
        name,
        departmentId: 'cd-mc',
        positionId: 'pos-cnc-operator',
        hireDate,
        status: 'probation',
      });
      expect(created.status).toBe(201);
      return String(created.json.data.id ?? created.json.data.employee?.id);
    };
    const newcomer = await hire('QH9301', '周迪', today());
    const [event] = await eventsOf(newcomer, 'onboard');
    expect(event.processedAt).toBeTruthy();
    const assigned = (await assignmentsOf(newcomer)).filter(
      (a) => a.jobEventId === event.id,
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0].learningPathId).toBe(
      await pathId('path-cnc-operator-onboard'),
    );
    // The last step is due within its offset of the effective date.
    expect(String(assigned[0].dueDate).slice(0, 10) >= today()).toBe(true);
    const { notifications } = await services();
    expect(
      await notifications.getByIdempotencyKey(
        `hr:assignment:${assigned[0].id}:assigned:head`,
      ),
    ).toBeTruthy();
    // Someone already at work, recorded long after the hire date: no onboarding path.
    const backfill = await hire('QH9302', '补录员工', addDays(today(), -120));
    expect(await assignmentsOf(backfill)).toHaveLength(0);
  });

  it('handles a replayed or retried event once: no second path, no second notice', async () => {
    const { db, processor, learning, notifications } = await services();
    const [event] = await eventsOf('emp-limin', 'transfer');
    const { toJobEvent } =
      await import('../../server/providers/hr/job-events.ts');
    const replay = await learning.handle(toJobEvent(event));
    expect(replay.assigned).toBeNull();
    // A failed first run leaves processedAt empty; the retry from 岗位变动 runs every handler again.
    await db
      .query()
      .updateTable('jobEvents')
      .set({ processedAt: null })
      .where('id', '=', String(event.id))
      .execute();
    expect(await processor.process([String(event.id)])).toBe(1);
    const parents = (await assignmentsOf('emp-limin')).filter(
      (a) => a.jobEventId === event.id,
    );
    expect(parents).toHaveLength(1);
    const limin = await userIdOf('emp_njl_2');
    expect(
      await notifications.getByIdempotencyKey(
        `hr:assignment:${parents[0].id}:assigned`,
      ),
    ).toBeTruthy();
    expect(limin).toBeTruthy();
  });

  it('cancels the old onboarding path on a transfer and assigns the new one', async () => {
    const { paths } = await services();
    const cncPath = await pathId('path-cnc-operator-onboard');
    const hr = await userIdOf('hr01');
    const parent = await paths.assignFor('emp-liuyang', cncPath, {
      assignedByUserId: hr,
      source: 'path',
    });
    expect(parent).toBeTruthy();
    const moved = await call(
      'hr01',
      'POST',
      '/employees/emp-liuyang/correct-job',
      {
        departmentId: 'sz-as',
        positionId: 'pos-assembler',
        note: '调往装配车间',
      },
    );
    expect(moved.status).toBe(200);
    const [event] = await eventsOf('emp-liuyang', 'transfer');
    const rows = await assignmentsOf('emp-liuyang');
    const old = rows.find((a) => a.id === parent)!;
    expect(old.status).toBe('cancelled');
    expect(old.cancelReason).toBe('jobChange');
    expect(old.cancelJobEventId).toBe(event.id);
    const steps = rows.filter((a) => a.parentAssignmentId === parent);
    expect(
      steps.every(
        (s) => s.status === 'completed' || s.cancelReason === 'parentCancelled',
      ),
    ).toBe(true);
    const assigned = rows.filter((a) => a.jobEventId === event.id);
    expect(assigned).toHaveLength(1);
    expect(assigned[0].learningPathId).toBe(
      await pathId('path-assembler-onboard'),
    );
    const block = await call('hr01', 'GET', `/learning-job-events/${event.id}`);
    expect(block.json.data.cancelled.map((t: Json) => t.title)).toEqual([
      'CNC 操作工上岗路径',
    ]);
  });

  it('assigns no path on a promotion to a position without one; the coach drafts a plan for the new head', async () => {
    const promoted = await call(
      'hr01',
      'POST',
      '/employees/emp-zhaoyang/correct-job',
      { positionId: 'pos-workshop-lead', note: '晋升为车间主任' },
    );
    expect(promoted.status).toBe(200);
    const [event] = await eventsOf('emp-zhaoyang', 'promote');
    expect(event).toBeDefined();
    expect(
      (await assignmentsOf('emp-zhaoyang')).filter(
        (a) => a.jobEventId === event.id,
      ),
    ).toHaveLength(0);
    const { db } = await services();
    const plan = await waitFor(async () => {
      const rows = (await db
        .query()
        .selectFrom('learningPlans')
        .selectAll()
        .where('employeeId', '=', 'emp-zhaoyang')
        .where('trigger', '=', 'jobEvent')
        .execute()) as Json[];
      return rows[0];
    }, 'the job-change plan');
    expect(plan.status).toBe('draft');
    // 成都机加工车间 has no head: the plan goes up to 成都工厂's head.
    expect(plan.reviewerUserId).toBe(await userIdOf('mgr_cd'));
    const ref =
      typeof plan.triggerRef === 'string'
        ? JSON.parse(plan.triggerRef)
        : plan.triggerRef;
    expect(ref.jobEventId).toBe(event.id);
    const items = (
      typeof plan.items === 'string' ? JSON.parse(plan.items) : plan.items
    ) as Json[];
    expect(items.length).toBeGreaterThan(0);
    expect(
      items.every((i) => i.type === 'course' || i.type === 'practice'),
    ).toBe(true);
    expect(new Set(items.map((i) => i.competencyId))).toContain('comp-team');
    // The head sees it waiting; mgr_njl cannot decide it.
    const mine = await call(
      'mgr_cd',
      'GET',
      '/learning-plans?mine=true&status=draft',
    );
    expect((mine.json.data.items as Json[]).map((p) => p.id)).toContain(
      plan.id,
    );
    expect(
      (await call('mgr_njl', 'POST', `/learning-plans/${plan.id}/approve`, {}))
        .status,
    ).toBeGreaterThanOrEqual(403);
    // Once per event, whatever triggers it again.
    const { automation } = await services();
    const again = await automation.onJobEventProcessed(String(event.id));
    expect(again.status).toBe('skipped');
    const count = (
      await db
        .query()
        .selectFrom('learningPlans')
        .select(['id'])
        .where('employeeId', '=', 'emp-zhaoyang')
        .where('trigger', '=', 'jobEvent')
        .execute()
    ).length;
    expect(count).toBe(1);
  });

  it('cancels unfinished learning on an offboarding, with its reason', async () => {
    const open = (await assignmentsOf('emp-qianjin')).filter((a) =>
      ['notStarted', 'inProgress', 'overdue', 'locked'].includes(a.status),
    );
    expect(open.length).toBeGreaterThan(0);
    const left = await call(
      'hr01',
      'POST',
      '/employees/emp-qianjin/correct-job',
      {
        status: 'leave',
        leaveReason: 'resign',
        note: '个人原因离职',
      },
    );
    expect(left.status).toBe(200);
    const [event] = await eventsOf('emp-qianjin', 'offboard');
    expect(event.processedAt).toBeTruthy();
    const rows = await assignmentsOf('emp-qianjin');
    for (const task of open) {
      const now = rows.find((r) => r.id === task.id)!;
      expect(now.status).toBe('cancelled');
      expect(now.cancelReason).toBe('offboard');
      expect(now.cancelJobEventId).toBe(event.id);
    }
  });
});

describe('the learning coach: a plan for a development target', () => {
  it('drafts once every required competency is assessed, lists missing courses and tells the instructors', async () => {
    const { db, automation, notifications } = await services();
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const assessor = await userIdOf('mgr_cd');
    // A target position of its own: 班组管理 3 (a course exists) and a competency no course covers.
    await db
      .query()
      .insertInto('competencies')
      .values({
        id: 'comp-v309-negotiation',
        code: 'v309-negotiation',
        title: '商务谈判',
        category: 'skill',
        description: null,
        maxLevel: 5,
        source: 'manual',
        reviewStatus: 'confirmed',
        active: true,
        ...stamp,
      })
      .execute();
    await db
      .query()
      .insertInto('positions')
      .values({
        id: 'pos-v309-target',
        code: 'v309-target',
        title: '生产主管',
        jobFamilyId: 'prod',
        grade: 'S4',
        responsibilities: null,
        active: true,
        sortOrder: 99,
        ...stamp,
      })
      .execute();
    for (const [competencyId, level] of [
      ['comp-team', 3],
      ['comp-v309-negotiation', 2],
    ] as const)
      await db
        .query()
        .insertInto('positionRequirements')
        .values({
          id: `req-v309-${competencyId}`,
          positionId: 'pos-v309-target',
          competencyId,
          requiredLevel: level,
          mandatory: true,
          source: 'manual',
          reviewStatus: 'confirmed',
          ...stamp,
        })
        .execute();
    await db
      .query()
      .insertInto('developmentTargets')
      .values({
        id: 'target-v309-wumin',
        employeeId: 'emp-wumin',
        targetPositionId: 'pos-v309-target',
        reason: '继任培养',
        status: 'active',
        createdBy: assessor,
        achievedAt: null,
        cancelledAt: null,
        cancelledBy: null,
        decisionActionId: null,
        ...stamp,
      })
      .execute();
    const assess = async (competencyId: string, level: number, id: string) =>
      db
        .query()
        .insertInto('employeeCompetencies')
        .values({
          id,
          employeeId: 'emp-wumin',
          competencyId,
          level,
          source: 'assessment',
          evidence: null,
          assessedBy: assessor,
          assessedAt: new Date(),
          ...stamp,
        })
        .execute();
    const plansOf = async () =>
      (await db
        .query()
        .selectFrom('learningPlans')
        .selectAll()
        .where('employeeId', '=', 'emp-wumin')
        .where('trigger', '=', 'developmentTarget')
        .execute()) as Json[];
    // One of the two assessed: not yet.
    await assess('comp-team', 1, 'assess-v309-team-1');
    await automation.runScheduled(
      'learningCoach.developmentTargetPlans',
      'manual',
    );
    expect(await plansOf()).toHaveLength(0);
    await assess('comp-v309-negotiation', 1, 'assess-v309-neg-1');
    const run = await automation.runScheduled(
      'learningCoach.developmentTargetPlans',
      'manual',
    );
    expect(run.status).toBe('succeeded');
    const [plan] = await plansOf();
    expect(plan).toBeDefined();
    expect(String(plan.summary)).toContain('需要补充课程');
    expect(String(plan.summary)).toContain('商务谈判');
    const items = (
      typeof plan.items === 'string' ? JSON.parse(plan.items) : plan.items
    ) as Json[];
    expect(items.every((i) => i.competencyId === 'comp-team')).toBe(true);
    expect(
      await notifications.getByIdempotencyKey(
        'hr:learningContentMissing:商务谈判',
      ),
    ).toBeTruthy();
    // The same gaps are not drafted again; the plan must be decided first anyway.
    await db
      .query()
      .updateTable('learningPlans')
      .set({ status: 'rejected' })
      .where('id', '=', String(plan.id))
      .execute();
    await automation.runScheduled(
      'learningCoach.developmentTargetPlans',
      'manual',
    );
    expect(await plansOf()).toHaveLength(1);
    // A changed gap is drafted again.
    await assess('comp-team', 2, 'assess-v309-team-2');
    await automation.runScheduled(
      'learningCoach.developmentTargetPlans',
      'manual',
    );
    expect(await plansOf()).toHaveLength(2);
  });
});

describe('a failed exam’s remedial plan (V3-10) merges into an open draft', () => {
  it('stores examFailed, merges without duplicates and records the added trigger', async () => {
    const { db } = await services();
    const tokens = await import('../../server/providers/hr/tokens.ts');
    const { scopeForUser } =
      await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const container = server.application.container;
    const plans = container.resolve(tokens.planServiceToken);
    const hr = await userIdOf('hr01');
    const ctx = {
      userId: hr,
      authz: await scopeForUser(container.resolve(authorizationToken), hr),
    };
    const [draft] = (await db
      .query()
      .selectFrom('learningPlans')
      .selectAll()
      .where('employeeId', '=', 'emp-wumin')
      .where('status', '=', 'draft')
      .execute()) as Json[];
    expect(draft).toBeDefined();
    const before = (
      typeof draft.items === 'string' ? JSON.parse(draft.items) : draft.items
    ) as Json[];
    const input = {
      employeeId: 'emp-wumin',
      trigger: 'examFailed',
      triggerRef: { attemptId: 'attempt-v309' },
      summary: '考试失分：质量记录规范',
      items: [
        // Already in the draft: skipped.
        { ...before[0] },
        {
          type: 'course',
          refId: 'course-quality-record',
          competencyId: 'comp-quality-record',
          reason: '补齐质量记录规范',
        },
      ],
    };
    const options = {
      source: 'ai' as const,
      fallbackReviewerUserId: hr,
      automated: true,
    };
    await expect(plans.createDraft(ctx, input, options)).rejects.toMatchObject({
      code: 'PLAN_DRAFT_EXISTS',
    });
    const merged = await plans.createDraft(
      ctx,
      { ...input, mergeIntoDraft: true },
      options,
    );
    expect(merged.id).toBe(draft.id);
    expect(merged.reviewerUserId).toBe(draft.reviewerUserId);
    expect(merged.items.map((i) => i.refId)).toEqual([
      ...before.map((i) => i.refId),
      'course-quality-record',
    ]);
    const ref = merged.triggerRef as Json;
    expect(ref.merged).toHaveLength(1);
    expect(ref.merged[0]).toMatchObject({
      trigger: 'examFailed',
      triggerRef: { attemptId: 'attempt-v309' },
      added: ['course:course-quality-record'],
    });
    // Merging the same again adds nothing.
    const again = await plans.createDraft(
      ctx,
      { ...input, mergeIntoDraft: true },
      options,
    );
    expect(again.items).toHaveLength(merged.items.length);
    // Without an open draft the trigger is kept as examFailed.
    const fresh = await plans.createDraft(
      ctx,
      { ...input, employeeId: 'emp-wanglei', items: input.items.slice(1) },
      options,
    );
    expect(fresh.trigger).toBe('examFailed');
  });
});

describe('the HR assistant’s probation summary includes learning', () => {
  it('counts 孙丽’s tasks as the head may see them, and nothing for someone without the view', async () => {
    const { probationLearning, probationLearningText } =
      await import('../../server/providers/hr/learning-summary.ts');
    const { scopeForUser } =
      await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const tokens = await import('../../server/providers/hr/tokens.ts');
    const container = server.application.container;
    const platform = container.resolve(tokens.platformToken);
    const authz = container.resolve(authorizationToken);
    const as = async (username: string) => {
      const userId = await userIdOf(username);
      return { userId, authz: await scopeForUser(authz, userId) };
    };
    const learning = await probationLearning(
      platform,
      await as('mgr_east'),
      'emp-sunli',
    );
    expect(learning).toMatchObject({ total: 2, completed: 1, overdue: 0 });
    expect(probationLearningText(learning!)).toContain(
      '任务 2 条，已完成 1 条，逾期 0 条',
    );
    expect(
      await probationLearning(platform, await as('emp_njl_1'), 'emp-sunli'),
    ).toBeUndefined();
  });
});

describe('the daily run follows the learning rules', () => {
  it('reminds tasks due within the configured days, once a day', async () => {
    const { db } = await services();
    const { today } = await import('../../server/providers/hr/shared.ts');
    const due = new Date(`${today()}T00:00:00Z`);
    due.setUTCDate(due.getUTCDate() + 4);
    const stamp = new Date();
    await db
      .query()
      .insertInto('assignments')
      .values({
        id: 'assign-v309-due-in-4',
        employeeId: 'emp-wanglei',
        courseId: 'course-quality-record',
        examId: null,
        certificateId: null,
        assignedByUserId: null,
        dueDate: due.toISOString().slice(0, 10),
        status: 'notStarted',
        progress: 0,
        source: 'manual',
        completedAt: null,
        cancelledAt: null,
        lastRemindedAt: null,
        escalatedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    // 学习规则 was set to 5 days above: a task due in 4 days is reminded.
    const run = await call('hr01', 'POST', '/org/maintenance/run', {});
    expect(run.status).toBe(200);
    const { notifications } = await services();
    expect(
      await notifications.getByIdempotencyKey(
        `hr:assignment:assign-v309-due-in-4:dueSoon:${today()}`,
      ),
    ).toBeTruthy();
  });
});

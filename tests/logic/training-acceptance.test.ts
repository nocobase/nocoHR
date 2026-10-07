// @vitest-environment node

// Acceptance checks for V2 step 5, training operations: learning paths, offline sessions and check-in, video progress, the learning coach
// and the practice coach. Each run boots the real standalone server on a throwaway SQLite database with migrations and seeds. No model is
// configured, so AI work takes its rule-based fallback or is recorded as failed; the model-written parts are checked by hand.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// The database task runner imports seed files through Node itself, outside Vite. Node strips their types but does
// not map a relative `.js` specifier to its `.ts` source the way `pnpm dev` and the compiled build do, so the seeds'
// imports of `database/seed-data/*` would not resolve here. Map only application sources, only after a miss.
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
const PASSWORD = 'talent-acceptance-test-password';

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
  // Writes pass the same-origin check a browser request would.
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    // Paths under /api/talent are written short; any other /api path is given in full.
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

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-training-acceptance-'));
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

const PATH = 'path-cnc-operator-onboard';
const shared: Record<string, string> = {};

/** Moves the clock the server reads, for code expiry, video pacing and session ends. */
function advance(ms: number): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + ms));
}
afterEach(() => {
  // Keep a moved clock across tests only where a test says so; the default is real time.
});

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
): Promise<T> {
  for (let i = 0; i < 60; i += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function myTimeline(username: string): Promise<Json> {
  const result = await call(username, 'GET', '/learning/paths');
  expect(result.status).toBe(200);
  return (result.json.data as Json[]).find((t) => t.pathId === PATH) as Json;
}

const minutesFromNow = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000).toISOString();

describe('learning paths', () => {
  it('assigns a path as one parent and one task per step, locking the later steps', async () => {
    const preview = await call('hr01', 'POST', '/assignments/preview', {
      learningPathId: PATH,
      employeeIds: ['emp-liuyang'],
    });
    expect(preview.status).toBe(200);
    expect(preview.json.data.included[0].completedStepIds).toEqual([]);
    const assigned = await call('hr01', 'POST', '/assignments', {
      learningPathId: PATH,
      employeeIds: ['emp-liuyang'],
    });
    expect(assigned.status).toBe(201);
    expect(assigned.json.data.created).toBe(1);
    const timeline = await myTimeline('emp_njl_4');
    shared.liuyangParent = timeline.assignmentId;
    expect(timeline.steps.map((s: Json) => s.status)).toEqual([
      'notStarted',
      'locked',
      'locked',
      'locked',
      'locked',
    ]);
    const offsets = timeline.steps.map((s: Json) => s.step.dueOffsetDays);
    expect(offsets).toEqual([3, 7, 10, 12, 14]);
    // Locked steps are never marked overdue by the daily rules; they are excluded from them.
    expect(
      timeline.steps.slice(1).every((s: Json) => s.status === 'locked'),
    ).toBe(true);
  });

  it('counts a video only as far as it was actually watched', async () => {
    const course = await call(
      'emp_njl_4',
      'GET',
      '/learning/courses/course-safety-basics',
    );
    expect(course.status).toBe(200);
    const video = course.json.data.lessons.find(
      (l: Json) => l.contentType === 'video',
    );
    expect(video.videoSeconds).toBe(480);
    // A forged interval covering the whole video counts only what the first report may cover.
    const forged = await call('emp_njl_4', 'POST', '/learning/video-progress', {
      courseId: 'course-safety-basics',
      lessonId: video.id,
      from: 0,
      to: 480,
    });
    expect(forged.status).toBe(200);
    expect(forged.json.data.watchedSeconds).toBeLessThanOrEqual(15);
    expect(forged.json.data.canComplete).toBe(false);
    const early = await call('emp_njl_4', 'POST', '/learning/progress', {
      courseId: 'course-safety-basics',
      lessonId: video.id,
      assignmentId: null,
    });
    expect(early.json.code).toBe('VIDEO_NOT_WATCHED');
    // Watching in real time, reported every 10 seconds, reaches the threshold.
    let position = forged.json.data.maxPositionSeconds;
    let last: Json = forged.json.data;
    try {
      while (!last.canComplete) {
        advance(10_000);
        const report = await call(
          'emp_njl_4',
          'POST',
          '/learning/video-progress',
          {
            courseId: 'course-safety-basics',
            lessonId: video.id,
            from: position,
            to: position + 15,
          },
        );
        last = report.json.data;
        position = last.maxPositionSeconds;
      }
    } finally {
      vi.useRealTimers();
    }
    expect(last.watchedSeconds).toBeGreaterThanOrEqual(432);
  });

  it('unlocks the next step when a step completes', async () => {
    const course = await call(
      'emp_njl_4',
      'GET',
      '/learning/courses/course-safety-basics',
    );
    const assignmentId = course.json.data.assignment.id;
    for (const lesson of course.json.data.lessons) {
      const done = await call('emp_njl_4', 'POST', '/learning/progress', {
        courseId: 'course-safety-basics',
        lessonId: lesson.id,
        assignmentId,
        durationSeconds: 120,
      });
      expect(done.status).toBe(200);
    }
    const timeline = await myTimeline('emp_njl_4');
    expect(timeline.steps[0].status).toBe('completed');
    expect(timeline.steps[1].status).toBe('notStarted');
    expect(timeline.steps[2].status).toBe('locked');
    expect(timeline.progress).toBe(20);
  });

  it('refuses to publish a path that references a draft scenario', async () => {
    const created = await call('trainer01', 'POST', '/paths', {
      code: 'path-draft-check',
      title: '含草稿场景的路径',
      purpose: 'development',
      steps: [
        {
          stepType: 'course',
          courseId: 'course-cnc-intro',
          dueOffsetDays: 5,
        },
        {
          stepType: 'practice',
          practiceScenarioId: 'scenario-customer-audit',
          dueOffsetDays: 7,
        },
      ],
    });
    expect(created.status).toBe(201);
    const publish = await call(
      'trainer01',
      'POST',
      `/paths/${created.json.data.id}/publish`,
      {
        published: true,
      },
    );
    expect(publish.status).toBe(409);
    expect(publish.json.code).toBe('PATH_STEP_NOT_READY');
  });
});

describe('offline training', () => {
  it('enrolls from my learning, and refuses a full session', async () => {
    const offerings = await call('emp_njl_4', 'GET', '/learning/offerings');
    const sessions = offerings.json.data[
      'course-first-article-practical'
    ] as Json[];
    expect(sessions.map((s) => s.id)).toContain('session-gowning-1');
    const enrolled = await call(
      'emp_njl_4',
      'POST',
      '/sessions/session-gowning-1/enroll',
      {},
    );
    expect(enrolled.status).toBe(200);
    expect(enrolled.json.data.remaining).toBe(11);

    // A session starting in 20 minutes, where check-in is open.
    const soon = await call('trainer01', 'POST', '/sessions', {
      courseId: 'course-first-article-practical',
      startAt: minutesFromNow(20),
      endAt: minutesFromNow(140),
      enrollDeadline: minutesFromNow(10),
      location: '苏州基地更衣培训室',
      capacity: 12,
    });
    expect(soon.status).toBe(201);
    shared.soon = soon.json.data.id;
    // Enrolling in another session of the course is a reschedule.
    expect(
      (await call('emp_njl_4', 'POST', `/sessions/${shared.soon}/enroll`, {}))
        .status,
    ).toBe(200);
    const first = await call('hr01', 'GET', '/sessions/session-gowning-1');
    expect(first.json.data.remaining).toBe(12);
    expect(
      (
        await call('trainer01', 'PATCH', `/sessions/${shared.soon}`, {
          courseId: 'course-first-article-practical',
          startAt: soon.json.data.startAt,
          endAt: soon.json.data.endAt,
          enrollDeadline: soon.json.data.enrollDeadline,
          location: '苏州基地更衣培训室',
          capacity: 1,
        })
      ).status,
    ).toBe(200);
    const full = await call(
      'emp_njl_2',
      'POST',
      `/sessions/${shared.soon}/enroll`,
      {},
    );
    expect(full.json.code).toBe('SESSION_FULL');
  });

  it('checks in only inside the window, with a fresh code, for the enrolled', async () => {
    const early = await call(
      'trainer01',
      'GET',
      '/sessions/session-gowning-2/check-in-code',
    );
    expect(early.status).toBe(200);
    expect(
      (
        await call('emp_njl_4', 'POST', '/check-in', {
          code: early.json.data.code,
        })
      ).json.code,
    ).toBe('CHECK_IN_OUTSIDE_WINDOW');

    const code = (
      await call('trainer01', 'GET', `/sessions/${shared.soon}/check-in-code`)
    ).json.data.code;
    expect(
      (await call('emp_njl_2', 'POST', '/check-in', { code })).json.code,
    ).toBe('CHECK_IN_NOT_ENROLLED');
    expect(
      (
        await call('emp_njl_4', 'POST', '/check-in', {
          code: code.replace(/.$/u, 'x'),
        })
      ).json.code,
    ).toBe('CHECK_IN_CODE_INVALID');
    try {
      advance(31_000);
      expect(
        (await call('emp_njl_4', 'POST', '/check-in', { code })).json.code,
      ).toBe('CHECK_IN_CODE_EXPIRED');
    } finally {
      vi.useRealTimers();
    }
    const fresh = (
      await call('trainer01', 'GET', `/sessions/${shared.soon}/check-in-code`)
    ).json.data.code;
    const forgedTime = '2020-01-01T00:00:00.000Z';
    const checked = await call('emp_njl_4', 'POST', '/check-in', {
      code: fresh,
      checkedInAt: forgedTime,
    });
    expect(checked.status).toBe(200);
    expect(checked.json.data.checkedInAt).not.toBe(forgedTime);
    const timeline = await myTimeline('emp_njl_4');
    expect(timeline.steps[1].status).toBe('completed');
    expect(timeline.steps[2].status).toBe('notStarted');
  });

  it('records a manual correction with its reason, and exports the sheet', async () => {
    const session = await call('trainer01', 'POST', '/sessions', {
      courseId: 'course-first-article-practical',
      startAt: minutesFromNow(20),
      endAt: minutesFromNow(50),
      enrollDeadline: minutesFromNow(10),
      location: '苏州基地更衣培训室',
      capacity: 12,
    });
    shared.late = session.json.data.id;
    expect(
      (
        await call('trainer01', 'POST', `/sessions/${shared.late}/enroll`, {
          employeeId: 'emp-limin',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('trainer01', 'POST', `/sessions/${shared.late}/enroll`, {
          employeeId: 'emp-qianjin',
        })
      ).status,
    ).toBe(200);
    try {
      advance(25 * 60_000);
      const noReason = await call(
        'trainer01',
        'POST',
        `/sessions/${shared.late}/attendance`,
        {
          employeeId: 'emp-qianjin',
          status: 'attended',
        },
      );
      expect(noReason.json.code).toBe('ATTENDANCE_REASON_REQUIRED');
      const marked = await call(
        'trainer01',
        'POST',
        `/sessions/${shared.late}/attendance`,
        {
          employeeId: 'emp-qianjin',
          status: 'attended',
          reason: '手机没电，现场签纸质表',
        },
      );
      expect(marked.status).toBe(200);
      const row = (marked.json.data.enrollments as Json[]).find(
        (e) => e.employeeId === 'emp-qianjin',
      );
      expect(row.checkInMethod).toBe('manual');
      expect(row.markReason).toBe('手机没电，现场签纸质表');
    } finally {
      vi.useRealTimers();
    }
    const exported = await server.fetch(
      new Request(`${base}/api/talent/sessions/${shared.late}/export`, {
        headers: { cookie: await signIn('trainer01') },
      }),
    );
    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-type')).toContain('spreadsheetml');
    expect(
      (await call('emp_njl_4', 'GET', `/sessions/${shared.late}/export`))
        .status,
    ).toBe(403);
  });

  it('lets an instructor enroll or remove others only in a session they own or teach', async () => {
    // A session hr01 organizes and teaches: trainer01 has nothing to do with it.
    const created = await call('hr01', 'POST', '/sessions', {
      courseId: 'course-first-article-practical',
      startAt: minutesFromNow(3 * 24 * 60),
      endAt: minutesFromNow(3 * 24 * 60 + 120),
      location: '苏州基地更衣培训室',
      capacity: 12,
    });
    expect(created.status).toBe(201);
    const other = String(created.json.data.id);
    // Enrolling is a reschedule within the course: only people in no other session of it.
    const busy = new Set<string>();
    for (const id of [
      'session-gowning-1',
      'session-gowning-2',
      shared.soon,
      shared.late,
    ])
      for (const e of (await call('hr01', 'GET', `/sessions/${id}`)).json.data
        .enrollments as Json[])
        busy.add(String(e.employeeId));
    const team = (await call('mgr_njl', 'GET', '/employees')).json.data
      .items as Json[];
    const [first, second] = team.filter(
      (e) => e.status !== 'leave' && !busy.has(String(e.id)),
    );
    expect(first && second).toBeTruthy();
    expect(
      (
        await call('trainer01', 'POST', `/sessions/${other}/enroll`, {
          employeeId: first!.id,
        })
      ).status,
    ).toBe(403);
    // HR may; once enrolled, the unrelated instructor still cannot take them out.
    expect(
      (
        await call('hr01', 'POST', `/sessions/${other}/enroll`, {
          employeeId: first!.id,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('trainer01', 'POST', `/sessions/${other}/unenroll`, {
          employeeId: first!.id,
        })
      ).status,
    ).toBe(403);
    // A department head still enrolls a member of their team.
    expect(
      (
        await call('mgr_njl', 'POST', `/sessions/${other}/enroll`, {
          employeeId: second!.id,
        })
      ).status,
    ).toBe(200);
    // HR removes people from it.
    for (const person of [first!, second!])
      expect(
        (
          await call('hr01', 'POST', `/sessions/${other}/unenroll`, {
            employeeId: person.id,
          })
        ).status,
      ).toBe(200);
  });
});

describe('the daily run: learning coach and practice coach', () => {
  it('drafts a plan for the uncovered gap, nudges the lagging course and tells the head', async () => {
    const run = await call('hr01', 'POST', '/org/maintenance/run', {});
    expect(run.status).toBe(200);
    const plans = await call(
      'mgr_njl',
      'GET',
      '/learning-plans?mine=true&status=draft',
    );
    expect(plans.status).toBe(200);
    const plan = (plans.json.data.items as Json[]).find(
      (p) => p.employeeId === 'emp-limin',
    );
    expect(plan).toBeDefined();
    expect(
      plan!.items.every(
        (i: Json) => i.competencyTitle === '安全生产与 5S' && i.reason,
      ),
    ).toBe(true);
    shared.plan = plan!.id;
    // Only people with an uncovered gap in an assessed competency get a plan (V3-09: 未评定的不触发). 陈晨
    // (emp-chenchen, CNC operator of the V1-02 and V2-05 demos) has gaps but no assessment, so none for him.
    expect((plans.json.data.items as Json[]).map((p) => p.employeeId)).toEqual([
      'emp-limin',
    ]);
    // The employee never sees a draft plan.
    expect(
      (await call('emp_njl_2', 'GET', `/learning-plans/${plan!.id}`)).status,
    ).toBe(403);

    const nudges = await call(
      'hr01',
      'GET',
      '/automations/runs?task=learningCoach.progressNudge',
    );
    const nudge = nudges.json.data[0];
    expect(nudge.status).toBe('succeeded');
    const detail = await call('hr01', 'GET', `/automations/runs/${nudge.id}`);
    expect(detail.json.data.output.nudged).toContain(
      '王磊《车间安全与 5S 基础》',
    );
    expect(detail.json.data.output.escalated).toBe(1);
  });

  it('assigns an approved plan without the removed item, as the approver', async () => {
    const plan = (
      await call('mgr_njl', 'GET', `/learning-plans/${shared.plan}`)
    ).json.data;
    expect(plan.items.length).toBeGreaterThan(1);
    const kept = plan.items
      .slice(0, 1)
      .map((i: Json) => ({ type: i.type, refId: i.refId }));
    const approved = await call(
      'mgr_njl',
      'POST',
      `/learning-plans/${shared.plan}/approve`,
      { items: kept },
    );
    expect(approved.status).toBe(200);
    expect(approved.json.data.status).toBe('approved');
    expect(approved.json.data.items).toHaveLength(1);
    const mine = await call('emp_njl_2', 'GET', '/learning/assignments');
    const fromPlan = (mine.json.data as Json[]).filter(
      (a) => a.learningPlanId === shared.plan,
    );
    expect(fromPlan.length).toBeGreaterThan(0);
    expect(
      fromPlan.every((a) => a.source === 'plan' && a.assignedByName === '陈静'),
    ).toBe(true);
  });

  it('recommends a practice before an exam, once', async () => {
    const mine = await call('emp_njl_1', 'GET', '/learning/assignments');
    const recommended = (mine.json.data as Json[]).filter(
      (a) => a.source === 'coach',
    );
    expect(recommended).toHaveLength(1);
    expect(recommended[0].optional).toBe(true);
    expect(recommended[0].practiceScenarioId).toBe(
      'scenario-first-article-check',
    );
    const again = await call(
      'hr01',
      'POST',
      '/automations/practiceCoach.preExamRecommend/run',
    );
    expect(['skipped', 'succeeded']).toContain(again.json.data.status);
    const after = await call('emp_njl_1', 'GET', '/learning/assignments');
    expect(
      (after.json.data as Json[]).filter((a) => a.source === 'coach'),
    ).toHaveLength(1);
  });

  it('honours the plan switch while nudges continue', async () => {
    expect(
      (
        await call('hr01', 'PATCH', '/automations/learningCoach.gapPlans', {
          enabled: false,
        })
      ).status,
    ).toBe(200);
    expect(
      (await call('hr01', 'POST', '/automations/learningCoach.gapPlans/run'))
        .json.data.status,
    ).toBe('disabled');
    expect(
      (
        await call(
          'hr01',
          'POST',
          '/automations/learningCoach.progressNudge/run',
        )
      ).json.data.status,
    ).not.toBe('disabled');
  });

  it('records absences two hours after a session ends', async () => {
    try {
      advance(3 * 60 * 60_000);
      expect(
        (await call('hr01', 'POST', '/org/maintenance/run', {})).status,
      ).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    const session = await call('trainer01', 'GET', `/sessions/${shared.late}`);
    expect(session.json.data.status).toBe('completed');
    const limin = (session.json.data.enrollments as Json[]).find(
      (e) => e.employeeId === 'emp-limin',
    );
    expect(limin.status).toBe('absent');
  });
});

describe('a path for someone who already learned part of it', () => {
  it('counts finished steps as completed and attaches open tasks instead of duplicating them', async () => {
    const preview = await call('hr01', 'POST', '/assignments/preview', {
      learningPathId: PATH,
      employeeIds: ['emp-wanglei'],
    });
    const person = preview.json.data.included[0];
    // 王磊 finished 《CNC 岗位操作入门》 and, holding a valid CNC 岗位上岗证, passed the exam: both steps count.
    expect(person.completedStepIds).toEqual(
      expect.arrayContaining([`${PATH}-s3`]),
    );
    expect(person.attachedStepIds).toEqual(
      expect.arrayContaining([`${PATH}-s1`]),
    );
    expect(
      (
        await call('hr01', 'POST', '/assignments', {
          learningPathId: PATH,
          employeeIds: ['emp-wanglei'],
        })
      ).status,
    ).toBe(201);
    const mine = await call('emp_njl_1', 'GET', '/learning/assignments');
    const cleanroom = (mine.json.data as Json[]).filter(
      (a) => a.courseId === 'course-safety-basics',
    );
    expect(cleanroom).toHaveLength(1);
    expect(cleanroom[0].parentAssignmentId).toBeTruthy();
    const timeline = await myTimeline('emp_njl_1');
    expect(timeline.steps[2].status).toBe('completed');
  });
});

describe('practice', () => {
  it('uses only confirmed scenarios, and refuses a locked step', async () => {
    expect(
      (
        await call('emp_njl_4', 'POST', '/practice', {
          scenarioId: 'scenario-customer-audit',
        })
      ).json.code,
    ).toBe('SCENARIO_NOT_CONFIRMED');
    const timeline = await myTimeline('emp_njl_4');
    const step = timeline.steps[3];
    expect(step.status).toBe('locked');
    expect(
      (
        await call('emp_njl_4', 'POST', '/practice', {
          scenarioId: 'scenario-first-article-check',
          assignmentId: step.assignmentId,
        })
      ).json.code,
    ).toBe('ASSIGNMENT_LOCKED');
  });

  it('opens with the scenario line, and needs a model to answer', async () => {
    const started = await call('emp_njl_4', 'POST', '/practice', {
      scenarioId: 'scenario-first-article-check',
    });
    expect(started.status).toBe(201);
    shared.practice = started.json.data.id;
    expect(started.json.data.transcript[0].role).toBe('coach');
    const reply = await call(
      'emp_njl_4',
      'POST',
      `/practice/${shared.practice}/reply`,
      {
        text: '停了大概 20 分钟，我准备重新开机。',
      },
    );
    expect(reply.status).toBe(409);
    expect(reply.json.code).toBe('AI_UNAVAILABLE');
  });

  it('shows the conversation to the learner and the instructor, only the score to the head', async () => {
    const own = await call('emp_njl_4', 'GET', `/practice/${shared.practice}`);
    expect(own.json.data.transcript).toBeDefined();
    const trainer = await call(
      'trainer01',
      'GET',
      `/practice/${shared.practice}`,
    );
    expect(trainer.json.data.transcript).toBeDefined();
    const head = await call('mgr_njl', 'GET', `/practice/${shared.practice}`);
    expect(head.status).toBe(200);
    expect(head.json.data.transcript).toBeUndefined();
    expect(head.json.data.fullAccess).toBe(false);
    const history = await call(
      'mgr_njl',
      'GET',
      '/people/emp-liuyang/practice',
    );
    expect(history.json.data[0].transcript).toBeUndefined();
    expect(
      (await call('emp_th_1', 'GET', `/practice/${shared.practice}`)).status,
    ).toBe(404);
  });

  it('records a scenario drafting run when a course with an uncovered competency is published', async () => {
    const created = await call('trainer01', 'POST', '/courses', {
      title: '班组交接基础',
      sourceDocumentId: 'doc-saf-0105',
      competencyIds: ['comp-team'],
      lessons: [
        {
          title: '交接要点',
          content: '交接班时核对批记录、设备状态和异常事项。',
        },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.json.data.id;
    expect(
      (await call('trainer01', 'POST', `/courses/${id}/confirm`)).status,
    ).toBe(200);
    expect(
      (
        await call('trainer01', 'POST', `/courses/${id}/publish`, {
          published: true,
        })
      ).status,
    ).toBe(200);
    const run = await waitFor(async () => {
      const runs = await call(
        'hr01',
        'GET',
        '/automations/runs?task=practiceCoach.draftScenarioOnPublish',
      );
      return (runs.json.data as Json[]).find(
        (r) =>
          r.status !== 'running' && JSON.stringify(r.triggerRef).includes(id),
      );
    }, 'scenario drafting run');
    // Drafting needs a model; without one the run fails rather than inventing a scenario.
    expect(run.status).toBe('failed');
  });
});

describe('reports and cancelling', () => {
  it('adds path, attendance, practice and plan figures within the viewer’s scope', async () => {
    const report = await call('hr01', 'GET', '/training-report');
    expect(report.status).toBe(200);
    const metrics = report.json.data.metrics;
    expect(metrics.attendanceRate).not.toBeNull();
    expect(metrics.planAdoptionRate).toBe(100);
    const east = await call('mgr_east', 'GET', '/training-report');
    const names = (east.json.data.details.attendance as Json[]).map(
      (a) => a.employee,
    );
    expect(names).not.toContain('赵阳');
  });

  it('cancels the unfinished steps with the path', async () => {
    const cancelled = await call(
      'hr01',
      'POST',
      `/assignments/${shared.liuyangParent}/cancel`,
    );
    expect(cancelled.status).toBe(200);
    const mine = await call('emp_njl_4', 'GET', '/learning/assignments');
    const children = (mine.json.data as Json[]).filter(
      (a) => a.parentAssignmentId === shared.liuyangParent,
    );
    // Cancelled tasks drop out of "my learning"; only the completed steps remain.
    expect(children.every((a) => a.status === 'completed')).toBe(true);
  });
});

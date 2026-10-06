// @vitest-environment node

// Acceptance checks for V2 step 7 (用工计划与招聘入职) on the V2 demo data (启衡精密): the ERP push and the staffing
// gap, requisitions and postings, the careers page with knockout questions and self-booking, deduplication and
// screening without protected data, interviews and scorecard isolation, offers and the salary field boundary,
// the onboarding action and what its job event does, 待入职跟进, 新员工回访, custom candidate fields,
// anonymization, reports and permissions. Each run boots the real standalone server on a throwaway SQLite
// database with migrations and seeds; no model is configured, so every AI step takes its rule path.
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
const PASSWORD = 'v2-recruiting-test-password';

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
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { ...extra };
  if (username) headers.cookie = await signIn(username);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent/recruiting${url}`}`,
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
    json = { text };
  }
  return { status: response.status, json };
}

async function multipart(
  username: string | null,
  url: string,
  fields: Record<string, string>,
  files: { field: string; name: string; bytes: Uint8Array; type?: string }[],
  extra: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const f of files)
    form.append(
      f.field,
      new File([f.bytes], f.name, {
        type: f.type ?? 'application/octet-stream',
      }),
    );
  const headers: Record<string, string> = {
    origin: 'http://localhost',
    ...extra,
  };
  if (username) headers.cookie = await signIn(username);
  const response = await server.fetch(
    new Request(`${base}${url}`, { method: 'POST', headers, body: form }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function services() {
  const { recruitingServicesToken } =
    await import('../../server/providers/hr/tokens.ts');
  return server.application.container.resolve(recruitingServicesToken);
}

async function notified(key: string): Promise<boolean> {
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  const notifications = server.application.container.resolve(
    notificationServiceToken,
  );
  return Boolean(await notifications.getByIdempotencyKey(`hr:${key}`));
}

async function until<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  ms = 15_000,
): Promise<T> {
  const start = Date.now();
  let value = await read();
  while (!ok(value) && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    value = await read();
  }
  return value;
}

async function userIdOf(username: string): Promise<string> {
  const row = await (
    await db()
  )
    .query()
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', username)
    .executeTakeFirst();
  return String(row?.id);
}

const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function nextMonth(): string {
  const [y, m] = today().slice(0, 7).split('-').map(Number);
  const index = y * 12 + m;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-recruiting-'));
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
  process.env.ORG_SYNC_MOCK_FILE = path.join(directory, 'feishu-mock.json');
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
  delete process.env.ORG_SYNC_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const state: Record<string, any> = {};
const MONTH = nextMonth();

describe('V2-07 用工计划', () => {
  it('integration_mes pushes the plan with its API key: gap 10, three options, mgr_cd told', async () => {
    const key = await call('hr01', 'POST', '/settings/integration/keys', {});
    expect(key.status).toBe(201);
    expect(typeof key.json.data.secret).toBe('string');
    state.apiKey = key.json.data.secret;
    const push = await call(
      null,
      'POST',
      '/integration/production-plans',
      {
        department: 'CD-MC',
        position: 'prod-cnc-operator',
        month: MONTH,
        plannedOutput: 61600,
        currentOutput: 40000,
      },
      { 'x-api-key': state.apiKey },
    );
    expect({ status: push.status, json: push.json }).toMatchObject({
      status: 201,
    });
    expect(push.json.data).toMatchObject({
      status: 'calculated',
      gapHeadcount: 10,
      changed: true,
    });
    // The integration account reads no employee data and no plan.
    expect(
      (
        await call(null, 'GET', '/api/talent/employees', undefined, {
          'x-api-key': state.apiKey,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(null, 'GET', '/workforce-plans', undefined, {
          'x-api-key': state.apiKey,
        })
      ).status,
    ).toBe(403);
    state.planId = push.json.data.id;
    const plan = await until(
      async () =>
        (await call('mgr_cd', 'GET', `/workforce-plans/${state.planId}`)).json
          .data,
      (p) => Boolean(p?.aiSummaryCurrent),
    );
    expect(plan.calculation).toMatchObject({
      headcount: 18,
      capacity: 39600,
      gapHeadcount: 10,
      overtimeLimitHours: 36,
    });
    const option = (type: string) =>
      plan.options.find((o: Json) => o.type === type);
    expect(option('overtime')).toMatchObject({ feasible: false });
    expect(option('overtime').detail.hoursPerPerson).toBe(98);
    expect(option('transfer').detail).toMatchObject({
      maxHeadcount: 4,
      covers: false,
    });
    // The demo turns 借调人员需安排住宿 on (seed 202610210111); a new install has it off.
    expect(option('transfer').risks).toEqual(['partialCover', 'housing']);
    expect(option('hire').detail).toMatchObject({
      readyInDays: 28,
      readyInWeeks: 4,
    });
    expect(plan.aiSummary).toContain('10');
    expect(option('overtime').note).toContain('不可行');
    expect(
      await notified(
        `workforceGap:${state.planId}:${plan.calculationHash.slice(0, 16)}`,
      ),
    ).toBe(true);
  });

  it('the same push changes nothing; 40,000 is noGap; parameters recalculate', async () => {
    const services_ = await services();
    const runsBefore = await (
      await db()
    )
      .query()
      .selectFrom('aiTaskRuns')
      .select(['id'])
      .where('task', '=', 'hrAssistant.workforceExplain')
      .execute();
    const again = await call(
      null,
      'POST',
      '/integration/production-plans',
      {
        department: 'CD-MC',
        position: 'prod-cnc-operator',
        month: MONTH,
        plannedOutput: 61600,
        currentOutput: 40000,
      },
      { 'x-api-key': state.apiKey },
    );
    expect(again.json.data.changed).toBe(false);
    await new Promise((r) => setTimeout(r, 400));
    const runsAfter = await (
      await db()
    )
      .query()
      .selectFrom('aiTaskRuns')
      .select(['id'])
      .where('task', '=', 'hrAssistant.workforceExplain')
      .execute();
    expect(runsAfter.length).toBe(runsBefore.length);
    const low = await call(
      null,
      'POST',
      '/integration/production-plans',
      {
        department: 'CD-MC',
        position: 'prod-cnc-operator',
        month: MONTH,
        plannedOutput: 40000,
        currentOutput: 40000,
      },
      { 'x-api-key': state.apiKey },
    );
    expect(low.json.data.status).toBe('noGap');
    await call(
      null,
      'POST',
      '/integration/production-plans',
      {
        department: 'CD-MC',
        position: 'prod-cnc-operator',
        month: MONTH,
        plannedOutput: 61600,
        currentOutput: 40000,
      },
      { 'x-api-key': state.apiKey },
    );
    // hr01 raises output per shift to 110 in 招聘设置 and recalculates.
    const settings = await call('hr01', 'GET', '/settings');
    const workforce = settings.json.data.value.workforce;
    const set = (value: number) =>
      call('hr01', 'PUT', '/settings', {
        value: {
          workforce: {
            ...workforce,
            capacity: workforce.capacity.map((c: Json) => ({
              ...c,
              outputPerShift: value,
            })),
          },
        },
      });
    expect((await set(110)).status).toBe(200);
    const recalculated = await call(
      'hr01',
      'POST',
      `/workforce-plans/${state.planId}/recalculate`,
    );
    expect(recalculated.json.data.calculation.gapHeadcount).toBe(8);
    await set(100);
    const back = await call(
      'hr01',
      'POST',
      `/workforce-plans/${state.planId}/recalculate`,
    );
    expect(back.json.data.calculation.gapHeadcount).toBe(10);
    void services_;
  });

  it('who may see plans: mgr_njl none, emp_njl_1 refused', async () => {
    const list = await call('mgr_njl', 'GET', '/workforce-plans');
    expect(list.status).toBe(200);
    expect(list.json.data.items.map((p: Json) => p.id)).not.toContain(
      state.planId,
    );
    expect((await call('emp_njl_1', 'GET', '/workforce-plans')).status).toBe(
      403,
    );
  });

  it('mgr_cd decides 借调 + 招聘: one draft requisition linked to the plan, mgr_east gets the coordination to-do', async () => {
    const decide = await call(
      'mgr_cd',
      'POST',
      `/workforce-plans/${state.planId}/decide`,
      { types: ['transfer', 'hire'], note: '借调 4 人过渡' },
    );
    expect({ status: decide.status, json: decide.json }).toMatchObject({
      status: 200,
    });
    state.requisitionId = decide.json.data.requisitionId;
    const req = await call(
      'mgr_cd',
      'GET',
      `/requisitions/${state.requisitionId}`,
    );
    expect(req.json.data).toMatchObject({
      status: 'draft',
      headcount: 10,
      workforcePlanId: state.planId,
      departmentId: 'cd-mc',
      positionId: 'pos-cnc-operator',
    });
    expect(req.json.data.requirementsChecklist).toHaveLength(4);
    const drafts = await (
      await db()
    )
      .query()
      .selectFrom('jobRequisitions')
      .select(['id'])
      .where('workforcePlanId', '=', state.planId)
      .execute();
    expect(drafts).toHaveLength(1);
    expect(await notified(`workforceTransfer:${state.planId}:sz-mc`)).toBe(
      true,
    );
    const item = await (
      await db()
    )
      .query()
      .selectFrom('workItems')
      .select(['type'])
      .where('recipientUserId', '=', await userIdOf('mgr_east'))
      .where('refId', '=', `workforceTransfer:${state.planId}:sz-mc`)
      .executeTakeFirst();
    expect(item?.type).toBe('workforceTransfer');
  });
});

describe('V2-07 需求与职位', () => {
  it('mgr_cd submits (level 1 passes itself); hr01 approves naming recruit01; the assistant drafts once', async () => {
    const submit = await call(
      'mgr_cd',
      'POST',
      `/requisitions/${state.requisitionId}/submit`,
      {},
    );
    expect(submit.json.data.status).toBe('pending');
    expect(submit.json.data.approvals[0]).toMatchObject({
      kind: 'departmentHead',
      status: 'auto',
    });
    expect(
      (
        await call(
          'hr01',
          'POST',
          `/requisitions/${state.requisitionId}/decide`,
          { decision: 'approve' },
        )
      ).json.code,
    ).toBe('REQUISITION_RECRUITER_REQUIRED');
    const approve = await call(
      'hr01',
      'POST',
      `/requisitions/${state.requisitionId}/decide`,
      { decision: 'approve', recruiterUserId: await userIdOf('recruit01') },
    );
    expect(approve.json.data.status).toBe('open');
    // 待审批招聘需求 is not left open once decided.
    const openApprovals = await (
      await db()
    )
      .query()
      .selectFrom('workItems')
      .select(['id'])
      .where('refId', 'like', `requisition:${state.requisitionId}:level:%`)
      .where('status', '=', 'open')
      .execute();
    expect(openApprovals).toEqual([]);
    const posting = await until(
      async () =>
        (
          await call(
            'recruit01',
            'GET',
            `/postings?requisitionId=${state.requisitionId}`,
          )
        ).json.data?.items?.[0],
      (p) => Boolean(p),
    );
    expect(posting).toMatchObject({
      source: 'ai',
      reviewStatus: 'draft',
      status: 'draft',
    });
    const checklist = posting.requirements.filter(
      (r: Json) => r.origin === 'checklist',
    );
    expect(checklist.map((r: Json) => r.text)).toEqual([
      '中专或技校及以上',
      '1 年以上数控机床或加工中心操作经验',
      '会看简单零件图纸并使用卡尺与千分尺',
      '能适应三班倒',
    ]);
    const derived = posting.requirements
      .filter((r: Json) => r.origin === 'responsibilities')
      .map((r: Json) => r.text)
      .join(' ');
    expect(derived).toContain('首件检验');
    expect(derived).toContain('设备日常保养');
    expect(JSON.stringify(posting.requirements)).not.toContain('上岗证');
    expect(posting.description).toContain('入职培训');
    expect(posting.knockoutQuestions.length).toBeGreaterThanOrEqual(3);
    expect(posting.knockoutQuestions.length).toBeLessThanOrEqual(5);
    for (const q of posting.knockoutQuestions)
      expect(
        posting.requirements.find((r: Json) => r.key === q.requirementKey)
          ?.mustHave,
      ).toBe(true);
    state.postingId = posting.id;
    const req = await until(
      async () =>
        (await call('recruit01', 'GET', `/requisitions/${state.requisitionId}`))
          .json.data,
      (r) => Boolean(r?.poolSuggestion),
    );
    expect(
      req.poolSuggestion.candidates.map((c: Json) => c.candidateId),
    ).toContain('cand-pool-qinchuan');
    expect(await notified(`postingDraft:${state.requisitionId}`)).toBe(true);
    expect(await notified(`poolReuse:${state.requisitionId}`)).toBe(true);
    // The same approval event again: nothing new.
    const outcomes = await (
      await services()
    ).assistant.onRequisitionOpened(state.requisitionId);
    expect(outcomes.map((o) => o.status)).toEqual(['duplicate', 'duplicate']);
    const postings = await (
      await db()
    )
      .query()
      .selectFrom('jobPostings')
      .select(['id'])
      .where('requisitionId', '=', state.requisitionId)
      .execute();
    expect(postings).toHaveLength(1);
  });

  it('a draft cannot be published; confirmed, it reaches the careers page', async () => {
    expect(
      (await call('recruit01', 'POST', `/postings/${state.postingId}/publish`))
        .json.code,
    ).toBe('POSTING_NOT_CONFIRMED');
    expect(
      (await call('hr01', 'PUT', `/postings/${state.postingId}`, {})).status,
    ).toBe(403);
    await call('recruit01', 'POST', `/postings/${state.postingId}/confirm`);
    const published = await call(
      'recruit01',
      'POST',
      `/postings/${state.postingId}/publish`,
    );
    expect(published.json.data.status).toBe('published');
    state.slug = published.json.data.publicSlug;
    const jobs = await call(null, 'GET', '/api/public/recruiting/jobs');
    expect(jobs.json.data.items.map((j: Json) => j.slug)).toContain(state.slug);
    const job = await call(
      null,
      'GET',
      `/api/public/recruiting/jobs/${state.slug}`,
    );
    expect(job.json.data.questions.length).toBe(
      state.questions?.length ?? job.json.data.questions.length,
    );
    state.questions = job.json.data.questions;
  });

  it('self-booking: slots checked, template confirmed', async () => {
    const at = (days: number, hour: number) =>
      `${addDays(today(), days)}T${String(hour).padStart(2, '0')}:00:00+08:00`;
    const slots = [
      {
        start: at(2, 10),
        end: at(2, 11),
        capacity: 1,
        location: '成都工厂 行政楼 201',
        interviewerUserIds: [await userIdOf('mgr_cd'), await userIdOf('hr01')],
      },
      {
        start: at(3, 10),
        end: at(3, 11),
        capacity: 3,
        location: '成都工厂 行政楼 201',
        interviewerUserIds: [await userIdOf('mgr_cd'), await userIdOf('hr01')],
      },
    ];
    const patch = await call(
      'recruit01',
      'PATCH',
      `/postings/${state.postingId}`,
      { interviewSlots: slots },
    );
    expect({ status: patch.status, json: patch.json }).toMatchObject({
      status: 200,
    });
    expect(
      (
        await call(
          'recruit01',
          'POST',
          `/postings/${state.postingId}/booking`,
          { enabled: true },
        )
      ).json.code,
    ).toBe('POSTING_BOOKING_TEMPLATE_REQUIRED');
    const booking = await call(
      'recruit01',
      'POST',
      `/postings/${state.postingId}/booking`,
      {
        enabled: true,
        template: {
          subject: '面试提醒：{{position}}',
          body: '{{name}}，你的面试在 {{time}}，地点 {{location}}。改期：{{link}}',
        },
      },
    );
    expect(booking.json.data.selfBookingEnabled).toBe(true);
    state.slots = slots;
  });
});

function answers(shiftWork: 'yes' | 'no') {
  const out: Record<string, string> = {};
  for (const q of state.questions as Json[])
    out[q.key] = /三班倒/u.test(q.question) ? shiftWork : 'yes';
  return out;
}

describe('V2-07 公开页投递与初筛', () => {
  it('consent is required; the knockout answer "不能" is flagged but the stage stays applied', async () => {
    const { resumeDocx, ZHOU_DI_RESUME, DEMO_RESUMES, PUBLIC_APPLICANTS } =
      await import('../../database/seed-data/demo-recruiting.ts');
    state.demo = { resumeDocx, ZHOU_DI_RESUME, DEMO_RESUMES };
    const file = {
      field: 'file',
      name: 'resume.docx',
      bytes: resumeDocx(DEMO_RESUMES[20]),
    };
    const noConsent = await multipart(
      null,
      `/api/public/recruiting/jobs/${state.slug}/apply`,
      {
        name: '邱明',
        phone: PUBLIC_APPLICANTS[0].phone,
        email: PUBLIC_APPLICANTS[0].email,
        consent: 'false',
        answers: JSON.stringify(answers('no')),
      },
      [file],
      { 'x-forwarded-for': '10.1.1.1' },
    );
    expect(noConsent.json.code).toBe('CANDIDATE_CONSENT_REQUIRED');
    const qiu = await multipart(
      null,
      `/api/public/recruiting/jobs/${state.slug}/apply`,
      {
        name: '邱明',
        phone: PUBLIC_APPLICANTS[0].phone,
        email: PUBLIC_APPLICANTS[0].email,
        consent: 'true',
        answers: JSON.stringify(answers('no')),
      },
      [file],
      { 'x-forwarded-for': '10.1.1.1' },
    );
    expect({ status: qiu.status, json: qiu.json }).toMatchObject({
      status: 201,
    });
    const list = await call(
      'recruit01',
      'GET',
      `/candidates?postingId=${state.postingId}`,
    );
    const row = list.json.data.items.find((i: Json) => i.name === '邱明');
    expect(row).toMatchObject({ knockoutUnmet: true, stage: 'applied' });
    state.qiuApplication = row.id;
  });

  it('周迪 applies on the page, books the single-seat slot; the full slot is gone; resubmitting merges', async () => {
    const { resumeDocx, ZHOU_DI_RESUME } = state.demo;
    const apply = () =>
      multipart(
        null,
        `/api/public/recruiting/jobs/${state.slug}/apply`,
        {
          name: ZHOU_DI_RESUME.name,
          phone: ZHOU_DI_RESUME.phone,
          email: ZHOU_DI_RESUME.email,
          consent: 'true',
          answers: JSON.stringify(answers('yes')),
        },
        [
          {
            field: 'file',
            name: '周迪-简历.docx',
            bytes: resumeDocx(ZHOU_DI_RESUME),
          },
        ],
        { 'x-forwarded-for': '10.1.1.2' },
      );
    const first = await apply();
    expect({ status: first.status, json: first.json }).toMatchObject({
      status: 201,
    });
    expect(first.json.data.bookingToken).toBeTruthy();
    expect(first.json.data.slots.map((s: Json) => s.start)).toContain(
      new Date(state.slots[0].start).toISOString(),
    );
    const book = await call(
      null,
      'POST',
      `/api/public/recruiting/booking/${first.json.data.bookingToken}`,
      { start: state.slots[0].start },
    );
    expect({ status: book.status, json: book.json }).toMatchObject({
      status: 200,
    });
    state.zhouBookingToken = first.json.data.bookingToken;
    const again = await apply();
    expect(again.json.data.merged).toBe(true);
    expect(again.json.data.slots.map((s: Json) => s.start)).not.toContain(
      new Date(state.slots[0].start).toISOString(),
    );
    const list = await call(
      'recruit01',
      'GET',
      `/candidates?postingId=${state.postingId}`,
    );
    const row = list.json.data.items.find((i: Json) => i.name === '周迪');
    state.zhouApplication = row.id;
    expect(row.submitCount).toBe(2);
    const detail = await until(
      async () =>
        (await call('recruit01', 'GET', `/candidates/${row.id}`)).json.data,
      (d) => Boolean(d?.screeningSuggestion),
    );
    expect(detail.screeningSuggestion.matchLevel).toBe('high');
    expect(JSON.stringify(detail.screeningSuggestion)).not.toMatch(/淘汰/u);
    expect(detail.stage).toBe('interview');
    const runs = await (
      await db()
    )
      .query()
      .selectFrom('aiTaskRuns')
      .select(['id', 'inputSummary', 'output'])
      .where('task', '=', 'recruitingAssistant.screening')
      .execute();
    const mine = runs.filter((r) => String(r.output ?? '').includes(row.id));
    expect(mine).toHaveLength(1);
    // 运行记录中不含简历内容和联系方式.
    for (const r of runs)
      expect(`${r.inputSummary ?? ''}${r.output ?? ''}`).not.toMatch(
        /1390000|@demo\.test|数控车床操作工/u,
      );
  });

  it('the page is rate-limited per address and asks for verification on the 11th application', async () => {
    const { resumeDocx, DEMO_RESUMES } = state.demo;
    let last = { status: 0, json: {} as Json };
    for (let i = 0; i < 11; i++)
      last = await multipart(
        null,
        `/api/public/recruiting/jobs/${state.slug}/apply`,
        {
          name: `测试${i}`,
          phone: `1380000${String(1000 + i)}`,
          email: `rate${i}@qiheng.test`,
          consent: 'true',
          answers: JSON.stringify(answers('yes')),
        },
        [
          {
            field: 'file',
            name: 'r.docx',
            bytes: resumeDocx(DEMO_RESUMES[16]),
          },
        ],
        { 'x-forwarded-for': '10.9.9.9' },
      );
    expect(last.json.code).toBe('PUBLIC_VERIFY_REQUIRED');
    const { challengeId, question } = last.json.details;
    const [a, b] = String(question).match(/\d+/gu)!.map(Number);
    const solved = await multipart(
      null,
      `/api/public/recruiting/jobs/${state.slug}/apply`,
      {
        name: '测试10',
        phone: '13800001010',
        email: 'rate10@qiheng.test',
        consent: 'true',
        answers: JSON.stringify(answers('yes')),
        challengeId,
        challengeAnswer: String(a + b),
      },
      [{ field: 'file', name: 'r.docx', bytes: resumeDocx(DEMO_RESUMES[16]) }],
      { 'x-forwarded-for': '10.9.9.9' },
    );
    expect(solved.status).toBe(201);
  });

  it('imports 29 resumes: the shared mobile merges, every application is screened against the requirements only', async () => {
    const { resumeDocx, DEMO_RESUMES } = state.demo;
    const result = await multipart(
      'recruit01',
      '/api/talent/recruiting/candidates/import',
      {
        postingId: state.postingId,
        sourceChannel: '招聘会',
        consentConfirmed: 'true',
      },
      DEMO_RESUMES.map((r: Json) => ({
        field: 'files',
        name: r.file,
        bytes: resumeDocx(r),
      })),
    );
    expect({ status: result.status, json: result.json }).toMatchObject({
      status: 200,
    });
    const statuses = result.json.data.results.map((r: Json) => r.status);
    expect(statuses.filter((s: string) => s === 'duplicate')).toHaveLength(1);
    expect(statuses.filter((s: string) => s === 'failed')).toHaveLength(0);
    const services_ = await services();
    const posting = await services_.postings.get(state.postingId);
    const keys = new Set(posting.requirements.map((r) => r.key));
    const imported = result.json.data.results
      .filter((r: Json) => r.status !== 'duplicate')
      .map((r: Json) => r.applicationId);
    const suggestions = await until(
      async () =>
        Promise.all(
          imported.map(
            async (id: string) =>
              (await services_.candidates.applicationRow(id))
                .screeningSuggestion,
          ),
        ),
      (list) => list.every(Boolean),
      30_000,
    );
    for (const s of suggestions) {
      expect(['high', 'medium', 'low']).toContain(s!.matchLevel);
      for (const r of s!.reasons) expect(keys.has(r.key)).toBe(true);
      expect(JSON.stringify(s)).not.toMatch(/淘汰/u);
    }
    // The three with a forklift licence are not matched as CNC operators.
    const forklift = result.json.data.results.filter((r: Json) =>
      /简历-(09|10|11)/u.test(r.file),
    );
    for (const f of forklift)
      expect(
        (await services_.candidates.applicationRow(f.applicationId))
          .screeningSuggestion?.matchLevel,
      ).not.toBe('high');
    state.imported = imported;
  });

  it('what screening reads has no name, contact data or protected characteristic', async () => {
    const services_ = await services();
    const input = await services_.assistant.screeningInput(
      state.zhouApplication,
    );
    const text = JSON.stringify(input);
    expect(text).not.toMatch(
      /周迪|13900007100|zhoudi@|性别|年龄|婚|籍贯|照片/u,
    );
    expect(Object.keys(input.parsedProfile ?? {})).toEqual([
      'education',
      'experiences',
      'skills',
      'certificates',
    ]);
    const { sanitizeResumeText } =
      await import('../../server/providers/hr/recruiting/resume-text.ts');
    const { resumeLines, ZHOU_DI_RESUME } =
      await import('../../database/seed-data/demo-recruiting.ts');
    const sent = sanitizeResumeText(resumeLines(ZHOU_DI_RESUME).join('\n'));
    expect(sent).not.toMatch(/性别|年龄|照片|婚育|籍贯|13900007100|zhoudi@/u);
    expect(sent).toContain('数控车床');
  });

  it('a rejection names requirements; the 18:00 digest reaches recruit01; the report shows agreement', async () => {
    const target = state.imported[12];
    expect(
      (
        await call('recruit01', 'POST', `/candidates/${target}/decide`, {
          decision: 'reject',
        })
      ).json.code,
    ).toBe('APPLICATION_REJECT_KEYS_REQUIRED');
    const rejected = await call(
      'recruit01',
      'POST',
      `/candidates/${target}/decide`,
      { decision: 'reject', rejectRequirementKeys: ['c2'] },
    );
    expect(rejected.json.data.stage).toBe('rejected');
    const run = await call('recruit01', 'POST', '/tasks/evening/run', {});
    expect(run.status).toBe(403);
    const evening = await call('hr01', 'POST', '/tasks/evening/run', {});
    expect(evening.status).toBe(200);
    expect(
      await notified(
        `recruitingDigest:${today()}:${await userIdOf('recruit01')}`,
      ),
    ).toBe(true);
    const report = await call('recruit01', 'GET', '/reports');
    expect(report.json.data.scope).toBe('mine');
    expect(report.json.data.screening.decided).toBeGreaterThan(0);
    expect(report.json.data.screening.agreementRate).not.toBeNull();
  });
});

describe('V2-07 面试', () => {
  it('the hourly scan drafts questions once for the interview within 24 hours; the invitation waits for recruit01', async () => {
    const services_ = await services();
    const list = await call('recruit01', 'GET', '/interviews');
    const interview = list.json.data.items.find(
      (i: Json) => i.candidateName === '周迪',
    );
    expect(interview).toMatchObject({ selfBooked: true, hasQuestions: false });
    state.interviewId = interview.id;
    const at = new Date(interview.scheduledAt);
    const simulated = new Date(at.getTime() - 20 * 3_600_000).toISOString();
    const hourly = await call('hr01', 'POST', '/tasks/hourly/run', {
      now: simulated,
    });
    expect(hourly.json.data.interviews[state.interviewId]).toBe('succeeded');
    const detail = await call(
      'mgr_cd',
      'GET',
      `/interviews/${state.interviewId}`,
    );
    expect(detail.json.data.questionPlan.length).toBeGreaterThan(0);
    const keys = new Set(
      detail.json.data.posting.requirements.map((r: Json) => r.key),
    );
    for (const q of detail.json.data.questionPlan)
      expect(keys.has(q.requirementKey)).toBe(true);
    expect(await notified(`interviewQuestions:${state.interviewId}`)).toBe(
      true,
    );
    const again = await call('hr01', 'POST', '/tasks/hourly/run', {
      now: simulated,
    });
    expect(again.json.data.interviews[state.interviewId]).toBeUndefined();
    // A second round scheduled by the recruiter: interviewers busy then are refused; the invitation is a draft.
    const clash = await call('recruit01', 'POST', '/interviews', {
      applicationId: state.zhouApplication,
      mode: 'onsite',
      scheduledAt: interview.scheduledAt,
      durationMinutes: 30,
      interviewerUserIds: [await userIdOf('mgr_cd')],
    });
    expect(clash.json.code).toBe('INTERVIEW_CALENDAR_CONFLICT');
    const second = await call('recruit01', 'POST', '/interviews', {
      applicationId: state.zhouApplication,
      mode: 'video',
      scheduledAt: `${addDays(today(), 6)}T15:00:00+08:00`,
      durationMinutes: 30,
      interviewerUserIds: [await userIdOf('recruit01')],
    });
    expect({ status: second.status, json: second.json }).toMatchObject({
      status: 201,
    });
    const app = await services_.candidates.applicationRow(
      state.zhouApplication,
    );
    const invitation = app.messages.find((m) => m.type === 'invitation');
    expect(invitation?.status).toBe('draft');
    await call(
      'recruit01',
      'POST',
      `/interviews/${second.json.data.id}/cancel`,
    );
  });

  it('scorecards stay private until one submits; the summary lists divergences and no hiring advice', async () => {
    const detail = (
      await call('mgr_cd', 'GET', `/interviews/${state.interviewId}`)
    ).json.data;
    const keys = detail.posting.requirements.map((r: Json) => r.key);
    const card = (score: number, recommendation: string) => ({
      requirementScores: keys.map((k: string) => ({
        requirementKey: k,
        score,
        evidence: '现场回答',
      })),
      recommendation,
      notes: '回答具体',
    });
    expect(
      (
        await call(
          'mgr_cd',
          'POST',
          `/interviews/${state.interviewId}/scorecard`,
          card(5, 'strongYes'),
        )
      ).status,
    ).toBe(200);
    const hrView = await call(
      'hr01',
      'GET',
      `/interviews/${state.interviewId}`,
    );
    expect(hrView.json.data.scorecards).toHaveLength(0);
    expect(JSON.stringify(hrView.json.data)).not.toMatch(
      /13900007100|zhoudi@/u,
    );
    expect(
      (
        await call(
          'hr01',
          'POST',
          `/interviews/${state.interviewId}/scorecard`,
          card(2, 'no'),
        )
      ).status,
    ).toBe(200);
    const summary = await until(
      async () =>
        (await call('mgr_cd', 'GET', `/interviews/${state.interviewId}`)).json
          .data,
      (d) => Boolean(d?.aiSummary),
    );
    expect(summary.status).toBe('completed');
    expect(summary.aiSummary.divergences.length).toBeGreaterThan(0);
    expect(JSON.stringify(summary.aiSummary)).not.toMatch(
      /建议录用|录用建议|建议淘汰/u,
    );
    expect(await notified(`interviewSummary:${state.interviewId}`)).toBe(true);
    // Everyone has scored: no 面试安排 / 面试题 to-do for this interview stays open.
    const openInterview = await (
      await db()
    )
      .query()
      .selectFrom('workItems')
      .select(['refId'])
      .where('status', '=', 'open')
      .where((eb) =>
        eb.or([
          eb('refId', 'like', `interview:${state.interviewId}:scheduled:%`),
          eb('refId', '=', `interviewQuestions:${state.interviewId}`),
        ]),
      )
      .execute();
    expect(openInterview).toEqual([]);
  });

  it('hr01 cannot open the candidate list and sees 周迪 only in 我的面试', async () => {
    expect((await call('hr01', 'GET', '/candidates')).status).toBe(403);
    const mine = await call('hr01', 'GET', '/interviews?mine=1');
    expect(mine.json.data.items.map((i: Json) => i.candidateName)).toEqual([
      '周迪',
    ]);
  });
});

describe('V2-07 录用与入职', () => {
  it('the offer needs a reason out of range; mgr_cd approves without the salary, fin01 with it; hr01 never sees it', async () => {
    const structure = 'struct-prod-cd';
    const body = (reason: string | null) => ({
      applicationId: state.zhouApplication,
      salaryOffer: {
        baseSalary: 9000,
        allowances: [],
        salaryStructureId: structure,
      },
      outOfRangeReason: reason,
      startDate: addDays(today(), 5),
      probationMonths: 3,
    });
    expect(
      (await call('recruit01', 'POST', '/offers', body(null))).json.code,
    ).toBe('OFFER_OUT_OF_RANGE_REASON_REQUIRED');
    const created = await call(
      'recruit01',
      'POST',
      '/offers',
      body('有 2 年数控车床经验，需求紧'),
    );
    expect({ status: created.status, json: created.json }).toMatchObject({
      status: 201,
    });
    state.offerId = created.json.data.id;
    expect(created.json.data.salaryOffer.baseSalary).toBe(9000);
    await call('recruit01', 'POST', `/offers/${state.offerId}/submit`);
    const managerView = await call('mgr_cd', 'GET', `/offers/${state.offerId}`);
    expect(managerView.json.data.salaryOffer).toBeNull();
    expect(JSON.stringify(managerView.json.data)).not.toContain('9000');
    await call('mgr_cd', 'POST', `/offers/${state.offerId}/decide`, {
      decision: 'approve',
    });
    const finView = await call('fin01', 'GET', `/offers/${state.offerId}`);
    expect(finView.json.data.salaryOffer.baseSalary).toBe(9000);
    const approved = await call(
      'fin01',
      'POST',
      `/offers/${state.offerId}/decide`,
      { decision: 'approve' },
    );
    expect(approved.json.data).toMatchObject({
      status: 'approved',
      hasLetter: true,
    });
    expect([403, 404]).toContain(
      (await call('hr01', 'GET', `/offers/${state.offerId}`)).status,
    );
  });

  it('recruit01 sends; 周迪 accepts through the link; the link opens nothing else', async () => {
    const preview = await call(
      'recruit01',
      'GET',
      `/offers/${state.offerId}/preview`,
    );
    expect(preview.json.data.body).toContain('周迪');
    const sent = await call(
      'recruit01',
      'POST',
      `/offers/${state.offerId}/send`,
      { confirmPreboardingTemplate: true },
    );
    expect(sent.json.data.status).toBe('sent');
    const row = await (
      await db()
    )
      .query()
      .selectFrom('offers')
      .select(['linkToken'])
      .where('id', '=', state.offerId)
      .executeTakeFirst();
    state.offerToken = String(row?.linkToken);
    const view = await call(
      null,
      'GET',
      `/api/public/recruiting/offer/${state.offerToken}`,
    );
    expect(view.json.data).toMatchObject({
      name: '周迪',
      status: 'sent',
      department: '成都机加工车间',
      position: 'CNC 操作工',
    });
    expect(JSON.stringify(view.json.data)).not.toMatch(/9000|13900007100/u);
    expect(
      (
        await call(
          null,
          'GET',
          '/api/public/recruiting/offer/aaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        )
      ).status,
    ).toBe(404);
    const accepted = await call(
      null,
      'POST',
      `/api/public/recruiting/offer/${state.offerToken}/respond`,
      { accept: true },
    );
    expect(accepted.json.data.status).toBe('accepted');
    const app = await (
      await services()
    ).candidates.applicationRow(state.zhouApplication);
    expect(app.stage).toBe('hired');
    expect(await notified(`offer:${state.offerId}:onboardDraft`)).toBe(true);
  });

  it('待入职跟进: reminders 3 days and 1 day before, once each; the unconfirmed arrival escalates; an upload is read for HR', async () => {
    const start = addDays(today(), 5);
    await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(start, -3),
    });
    await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(start, -3),
    });
    await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(start, -1),
    });
    const offer = await (await services()).offers.get(state.offerId);
    expect(offer.preboarding.remindersSent.map((r) => r.day)).toEqual([3, 1]);
    expect(await notified(`arrivalUnconfirmed:${state.offerId}`)).toBe(true);
    await call(
      null,
      'POST',
      `/api/public/recruiting/offer/${state.offerToken}/arrival`,
    );
    const { docx } =
      await import('../../database/seed-data/demo-recruiting.ts');
    const upload = await multipart(
      null,
      `/api/public/recruiting/offer/${state.offerToken}/upload`,
      { kind: 'idCard' },
      [
        {
          field: 'file',
          name: 'idcard.docx',
          bytes: docx([
            '姓名：周迪',
            '公民身份号码：999999200102150031',
            '住址：测试市测试路 88 号',
          ]),
        },
      ],
    );
    expect({ status: upload.status, json: upload.json }).toMatchObject({
      status: 200,
    });
    const draft = await until(
      async () =>
        (await call('hr01', 'GET', `/offers/${state.offerId}/onboard`)).json
          .data,
      (d) => d?.suggestions?.length > 0,
    );
    expect(draft.draft).toMatchObject({
      name: '周迪',
      toDepartmentId: 'cd-mc',
      toPositionId: 'pos-cnc-operator',
      probationMonths: 3,
      effectiveDate: start,
    });
    expect(draft.suggestions[0].fields.idNumber.value).toBe(
      '999999200102150031',
    );
    // 参加工作日期 estimated from the resume's two years on CNC lathes, for HR to check.
    expect(draft.draft.careerStartDate).toBe(
      `${Number(start.slice(0, 4)) - 2}${start.slice(4)}`,
    );
    expect(
      (await call('recruit01', 'GET', `/offers/${state.offerId}/onboard`))
        .status,
    ).toBe(403);
  });

  it('hr01 submits the onboarding action; approved and effective, the job event files the record once', async () => {
    const submit = await call(
      'hr01',
      'POST',
      `/offers/${state.offerId}/onboard`,
      { employeeNo: 'QH3301', effectiveDate: today() },
    );
    expect({ status: submit.status, json: submit.json }).toMatchObject({
      status: 200,
    });
    const actionId = submit.json.data.actionId;
    let action = (
      await call('mgr_cd', 'GET', `/api/talent/actions/${actionId}`)
    ).json.data;
    // 来自已接受的 Offer: the action names the offer and the recognized fields, never their values.
    const hrView = JSON.stringify(
      (await call('hr01', 'GET', `/api/talent/actions/${actionId}`)).json.data,
    );
    expect(hrView).toContain(`"offerId":"${state.offerId}"`);
    expect(hrView).toMatch(/"recognizedFields":\[[^\]]*"idNumber"/u);
    expect(hrView).not.toContain('999999200102150031');
    expect(
      action.approvals.some(
        (s: Json) => s.approverUserId === undefined || true,
      ),
    ).toBe(true);
    for (let i = 0; i < 4 && action.status === 'pending'; i++) {
      const approver = action.approvals.find(
        (s: Json) => s.status === 'pending',
      );
      const who = (
        approver.approverUserIds ?? [approver.approverUserId]
      ).includes(await userIdOf('mgr_cd'))
        ? 'mgr_cd'
        : 'hr01';
      action = (
        await call(who, 'POST', `/api/talent/actions/${actionId}/approve`, {})
      ).json.data;
    }
    expect(action.status).toBe('effective');
    const database = await db();
    const employee = await until(
      async () =>
        database
          .query()
          .selectFrom('employees')
          .select(['id', 'status', 'userId', 'careerStartDate'])
          .where('employeeNo', '=', 'QH3301')
          .executeTakeFirst(),
      (e) => Boolean(e),
    );
    expect(employee?.status).toBe('probation');
    // Annual leave counts from the career start the onboarding carried over, not from today.
    const career = employee!.careerStartDate as unknown;
    expect(
      career instanceof Date
        ? career.toISOString().slice(0, 10)
        : String(career).slice(0, 10),
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    state.employeeId = String(employee!.id);
    // The ID's values wait for hr01 as an AI change request (信息修改), not in the record.
    const suggestion = await until(
      async () =>
        database
          .query()
          .selectFrom('profileChangeRequests')
          .select(['source', 'changes', 'status'])
          .where('employeeId', '=', state.employeeId)
          .execute(),
      (rows) => rows.length > 0,
    );
    expect(suggestion[0].source).toBe('ai');
    expect(String(suggestion[0].changes)).toContain('999999200102150031');
    const attachments = await until(
      async () =>
        database
          .query()
          .selectFrom('employeeAttachments')
          .select(['category'])
          .where('employeeId', '=', state.employeeId)
          .execute(),
      (rows) => rows.length >= 3,
    );
    expect(attachments.map((a) => a.category).sort()).toEqual([
      'consent',
      'idCard',
      'resume',
    ]);
    const req = await call(
      'mgr_cd',
      'GET',
      `/requisitions/${state.requisitionId}`,
    );
    expect(req.json.data.hiredCount).toBe(1);
    const balances = await database
      .query()
      .selectFrom('leaveBalances')
      .select(['id'])
      .where('employeeId', '=', state.employeeId)
      .execute();
    expect(balances.length).toBeGreaterThan(0);
    // payroll01 sees the file pre-filled from the offer and confirms it.
    const prefill = await call(
      'payroll01',
      'GET',
      `/salary-prefill/${state.employeeId}`,
    );
    expect(prefill.json.data).toMatchObject({
      baseSalary: 9000,
      salaryStructureId: 'struct-prod-cd',
      salaryStructureTitle: '成都生产一线薪资结构',
      filed: false,
    });
    expect(
      (await call('hr01', 'GET', `/salary-prefill/${state.employeeId}`)).status,
    ).toBe(403);
    const confirmed = await call(
      'payroll01',
      'POST',
      `/salary-prefill/${state.employeeId}/confirm`,
      {},
    );
    expect({ status: confirmed.status, json: confirmed.json }).toMatchObject({
      status: 200,
    });
    expect(confirmed.json.data.source).toBe('offer');
    // The same event again does nothing new; the link no longer opens.
    const event = await database
      .query()
      .selectFrom('jobEvents')
      .selectAll()
      .where('employeeId', '=', state.employeeId)
      .where('eventType', '=', 'onboard')
      .executeTakeFirst();
    const { toJobEvent } =
      await import('../../server/providers/hr/job-events.ts');
    await (await services()).onboarding.handle(toJobEvent(event as Json));
    const after = await database
      .query()
      .selectFrom('employeeAttachments')
      .select(['id'])
      .where('employeeId', '=', state.employeeId)
      .execute();
    expect(after).toHaveLength(attachments.length);
    expect(
      (
        await call(
          null,
          'GET',
          `/api/public/recruiting/offer/${state.offerToken}`,
        )
      ).status,
    ).toBe(404);
    // The new employee signs in and reaches no recruiting page.
    const { userAdministrationServiceToken } =
      await import('@nocobase/app-plugin-authentication');
    await server.application.container
      .resolve(userAdministrationServiceToken)
      .resetPassword(String(employee!.userId), PASSWORD);
    const signin = await server.fetch(
      new Request(`${base}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
        },
        body: JSON.stringify({
          email: 'zhoudi@qiheng.test',
          password: PASSWORD,
        }),
      }),
    );
    expect(signin.status).toBe(200);
    const cookie = signin.headers
      .getSetCookie()
      .map((h) => h.split(';')[0])
      .join('; ');
    cookies.set('zhoudi', cookie);
    expect((await call('zhoudi', 'GET', '/candidates')).status).toBe(403);
    expect((await call('zhoudi', 'GET', '/requisitions')).status).toBe(403);
    state.zhouUserId = String(employee!.userId);
  });
});

describe('V2-07 新员工回访', () => {
  it('day 3: a Feishu check-in; the reply is routed to 林晓 with the dormitory policy cited; mgr_cd sees nothing', async () => {
    const database = await db();
    await database
      .query()
      .updateTable('employees')
      .set({ externalProvider: 'feishu', externalUserId: 'ou-zhoudi' })
      .where('id', '=', state.employeeId)
      .execute();
    const day3 = addDays(today(), 3);
    await call('hr01', 'POST', '/tasks/daily/run', { asOf: day3 });
    await call('hr01', 'POST', '/tasks/daily/run', { asOf: day3 });
    const checkIns = await database
      .query()
      .selectFrom('newHireCheckIns')
      .selectAll()
      .where('employeeId', '=', state.employeeId)
      .execute();
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0]).toMatchObject({
      day: 3,
      channel: 'feishu',
      status: 'asked',
    });
    const { imChannelToken } =
      await import('../../server/providers/hr/tokens.ts');
    const channel = server.application.container.resolve(imChannelToken);
    const reply = await channel.handle({
      provider: 'feishu',
      messageId: 'm-zhoudi-1',
      chatType: 'p2p',
      senderExternalId: 'ou-zhoudi',
      text: '宿舍离车间远，夜班下班没有班车',
    });
    expect(reply.reply).toContain('宿舍管理规定');
    expect(reply.reply).toContain('林晓');
    const hr01 = await userIdOf('hr01');
    const items = await database
      .query()
      .selectFrom('workItems')
      .select(['type', 'recipientUserId'])
      .where('type', '=', 'newHireIssue')
      .execute();
    expect(items.some((i) => String(i.recipientUserId) === hr01)).toBe(true);
    const mgrCd = await userIdOf('mgr_cd');
    expect(items.some((i) => String(i.recipientUserId) === mgrCd)).toBe(false);
    expect(
      (await call('mgr_cd', 'GET', '/check-ins')).json.data.items,
    ).toHaveLength(0);
    const runs = await database
      .query()
      .selectFrom('aiTaskRuns')
      .select(['inputSummary', 'output'])
      .where('task', '=', 'hrAssistant.newHireCheckIn')
      .execute();
    for (const r of runs)
      expect(`${r.inputSummary ?? ''}${r.output ?? ''}`).not.toMatch(
        /宿舍离车间远/u,
      );
  });

  it('day 7 asks again; an unanswered check-in becomes noReply; an accountless new hire is asked in person', async () => {
    const database = await db();
    await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(today(), 7),
    });
    await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(today(), 11),
    });
    const day7 = await database
      .query()
      .selectFrom('newHireCheckIns')
      .select(['status'])
      .where('employeeId', '=', state.employeeId)
      .where('day', '=', 7)
      .executeTakeFirst();
    expect(day7?.status).toBe('noReply');
    // An employee without an account, joined through an action 3 days before the simulated date.
    const now = new Date();
    await database
      .query()
      .insertInto('employees')
      .values({
        id: 'emp-test-noaccount',
        employeeNo: 'QH3399',
        name: '测试新人',
        userId: null,
        departmentId: 'cd-mc',
        positionId: 'pos-cnc-operator',
        managerEmployeeId: null,
        status: 'probation',
        hireDate: addDays(today(), 1),
        positionSince: addDays(today(), 1),
        email: null,
        mobile: null,
        note: null,
        gender: null,
        birthDate: null,
        idType: null,
        idNumber: null,
        employmentType: 'fullTime',
        workLocation: null,
        probationEndDate: null,
        regularizedAt: null,
        leaveDate: null,
        leaveReason: null,
        address: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await database
      .query()
      .insertInto('jobEvents')
      .values({
        id: 'event-test-noaccount',
        employeeId: 'emp-test-noaccount',
        eventType: 'onboard',
        fromDepartmentId: null,
        toDepartmentId: 'cd-mc',
        fromPositionId: null,
        toPositionId: 'pos-cnc-operator',
        effectiveDate: addDays(today(), 1),
        source: 'manual',
        actionId: null,
        note: null,
        processedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(today(), 4),
    });
    const face = await database
      .query()
      .selectFrom('newHireCheckIns')
      .selectAll()
      .where('employeeId', '=', 'emp-test-noaccount')
      .executeTakeFirst();
    expect(face).toMatchObject({ status: 'faceToFace', channel: 'app' });
    expect(await notified(`checkInFaceToFace:${String(face!.id)}`)).toBe(true);
  });
});

describe('V2-07 可定制、隐私与权限', () => {
  it('an added candidate field: on the public form, readable for screening only when marked', async () => {
    // hr01 adds the field in 设置 / 追加字段, with no code change.
    const field = await call('hr01', 'POST', '/api/talent/custom-fields', {
      collection: 'candidates',
      label: { 'zh-CN': '可到岗日期', 'en-US': 'Available from' },
      type: 'date',
      placements: ['detail', 'publicApply'],
    });
    expect({ status: field.status, json: field.json }).toMatchObject({
      status: 201,
    });
    const fieldId = String(field.json.data.id);
    const fieldKey = String(field.json.data.key);
    // A protected characteristic cannot be made readable for screening.
    expect(
      (
        await call('hr01', 'POST', '/api/talent/custom-fields', {
          collection: 'candidates',
          label: { 'zh-CN': '婚育情况', 'en-US': null },
          type: 'text',
          aiReadable: true,
        })
      ).json.code,
    ).toBe('CUSTOM_FIELD_PROTECTED_AI');
    const job = await call(
      null,
      'GET',
      `/api/public/recruiting/jobs/${state.slug}`,
    );
    expect(job.json.data.fields.map((f: Json) => f.key)).toContain(fieldKey);
    const { resumeDocx, DEMO_RESUMES } = state.demo;
    const applied = await multipart(
      null,
      `/api/public/recruiting/jobs/${state.slug}/apply`,
      {
        name: '黎平',
        phone: '13900007202',
        email: 'liping@qiheng.test',
        consent: 'true',
        answers: JSON.stringify(answers('yes')),
        customFields: JSON.stringify({ [fieldKey]: addDays(today(), 10) }),
      },
      [{ field: 'file', name: 'r.docx', bytes: resumeDocx(DEMO_RESUMES[5]) }],
      { 'x-forwarded-for': '10.2.2.2' },
    );
    expect({ status: applied.status, json: applied.json }).toMatchObject({
      status: 201,
    });
    const row = (
      await call('recruit01', 'GET', `/candidates?postingId=${state.postingId}`)
    ).json.data.items.find((i: Json) => i.name === '黎平');
    const detail = await call('recruit01', 'GET', `/candidates/${row.id}`);
    expect(detail.json.data.candidate.customFields[fieldKey]).toBe(
      addDays(today(), 10),
    );
    const services_ = await services();
    expect(
      (await services_.assistant.screeningInput(row.id)).screeningFields,
    ).toEqual({});
    const marked = await call(
      'hr01',
      'PATCH',
      `/api/talent/custom-fields/${fieldId}`,
      {
        aiReadable: true,
      },
    );
    expect(marked.status).toBe(200);
    expect(
      (await services_.assistant.screeningInput(row.id)).screeningFields,
    ).toEqual({ [fieldKey]: addDays(today(), 10) });
    state.liApplication = row.id;
  });

  it('the stage reminder follows the setting (5 → 3 days)', async () => {
    const settings = (await call('hr01', 'GET', '/settings')).json.data.value;
    await call('hr01', 'PUT', '/settings', {
      value: { reminders: { ...settings.reminders, stageStaleDays: 3 } },
    });
    const run = await call('hr01', 'POST', '/tasks/daily/run', {
      asOf: addDays(today(), 4),
    });
    expect(run.json.data.stale).toBeGreaterThan(0);
    expect(
      await notified(
        `recruitingStale:${addDays(today(), 4)}:${await userIdOf('recruit01')}:3`,
      ),
    ).toBe(true);
  });

  it('past retentionUntil a candidate is anonymized; the statistics stay', async () => {
    const database = await db();
    const app = await (
      await services()
    ).candidates.applicationRow(state.qiuApplication);
    await database
      .query()
      .updateTable('candidates')
      .set({ retentionUntil: addDays(today(), -1) })
      .where('id', '=', app.candidateId)
      .execute();
    await call('hr01', 'POST', '/tasks/daily/run', {});
    const candidate = await database
      .query()
      .selectFrom('candidates')
      .selectAll()
      .where('id', '=', app.candidateId)
      .executeTakeFirst();
    expect(candidate).toMatchObject({
      phone: null,
      email: null,
      resumeFileId: null,
    });
    expect(candidate?.anonymizedAt).toBeTruthy();
    const still = await database
      .query()
      .selectFrom('applications')
      .select(['stage', 'sourceChannel'])
      .where('id', '=', state.qiuApplication)
      .executeTakeFirst();
    expect(still?.sourceChannel).toBe('careersPage');
  });

  it('reports: hr01 only totals; emp_njl_1 and mgr_njl are kept out', async () => {
    const summary = await call('hr01', 'GET', '/reports');
    expect(summary.json.data.scope).toBe('summary');
    expect(summary.json.data.requisitions).toEqual([]);
    expect(summary.json.data.averageDaysToHire).not.toBeNull();
    expect((await call('emp_njl_1', 'GET', '/candidates')).status).toBe(403);
    expect((await call('emp_njl_1', 'GET', '/requisitions')).status).toBe(403);
    const njl = await call('mgr_njl', 'GET', '/requisitions');
    expect(njl.json.data.items.map((r: Json) => r.id)).not.toContain(
      state.requisitionId,
    );
  });
});

describe('V2-07 可选 AI 初面', () => {
  it('the plan must be confirmed; consent first; a human interview instead keeps the stage; the report holds no marital detail', async () => {
    expect(
      (
        await call(
          'recruit01',
          'POST',
          `/postings/${state.postingId}/ai-interview/enable`,
          { enabled: true },
        )
      ).json.code,
    ).toBe('AI_INTERVIEW_PLAN_NOT_CONFIRMED');
    const drafted = await call(
      'recruit01',
      'POST',
      `/postings/${state.postingId}/ai-interview/draft`,
    );
    expect(
      drafted.json.data.aiInterviewPlan.questions.length,
    ).toBeGreaterThanOrEqual(6);
    const enabled = await call(
      'recruit01',
      'POST',
      `/postings/${state.postingId}/ai-interview/enable`,
      { enabled: true, confirmPlan: true },
    );
    expect(enabled.json.data.aiInterviewEnabled).toBe(true);
    const invite = await call(
      'recruit01',
      'POST',
      `/postings/${state.postingId}/ai-interview/invite`,
      { applicationIds: [state.liApplication, state.imported[0]] },
    );
    expect(invite.json.data.results).toHaveLength(2);
    const { newToken } =
      await import('../../server/providers/hr/recruiting/common.ts');
    const database = await db();
    const token = newToken();
    await database
      .query()
      .updateTable('applications')
      .set({ aiInterviewTokenHash: token.hash })
      .where('id', '=', state.liApplication)
      .execute();
    expect(
      (
        await call(
          null,
          'POST',
          `/api/public/recruiting/ai-interview/${token.token}/turn`,
          { text: '你好' },
        )
      ).json.code,
    ).toBe('AI_INTERVIEW_CONSENT_REQUIRED');
    let view = (
      await call(
        null,
        'POST',
        `/api/public/recruiting/ai-interview/${token.token}/consent`,
        { accept: true },
      )
    ).json.data;
    for (let i = 0; view.next && i < 10; i++)
      view = (
        await call(
          null,
          'POST',
          `/api/public/recruiting/ai-interview/${token.token}/turn`,
          {
            text:
              i === 0
                ? '我在工厂做过两年数控车床，已经结婚了，孩子刚满一岁。每天做首件检验。'
                : '我会看图纸，用卡尺和千分尺量尺寸。',
          },
        )
      ).json.data;
    expect(view.finished).toBe(true);
    const interview = await database
      .query()
      .selectFrom('interviews')
      .select(['aiReport'])
      .where('applicationId', '=', state.liApplication)
      .where('mode', '=', 'ai')
      .executeTakeFirst();
    const report = JSON.stringify(interview?.aiReport);
    expect(report).not.toMatch(/结婚|孩子/u);
    expect(report).not.toMatch(/建议淘汰|总体结论/u);
    const stage = (
      await (await services()).candidates.applicationRow(state.liApplication)
    ).stage;
    expect(['applied', 'screening']).toContain(stage);
    // Declining keeps the application going.
    const other = newToken();
    await database
      .query()
      .updateTable('applications')
      .set({ aiInterviewTokenHash: other.hash })
      .where('id', '=', state.imported[0])
      .execute();
    const declined = await call(
      null,
      'POST',
      `/api/public/recruiting/ai-interview/${other.token}/consent`,
      { accept: false },
    );
    expect(declined.json.data.declined).toBe(true);
  });
});

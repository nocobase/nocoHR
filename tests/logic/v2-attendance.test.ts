// @vitest-environment node

// Acceptance checks for V2 step 5 (考勤与假期) on the V2 demo data (启衡精密): scheduling rules, leave conflicts and
// cover suggestions, the device import and daily calculation, missed-punch / overtime / swap requests, balances,
// job-event handling, the HR assistant's attendance work, monthly summaries and permissions. Each run boots the real
// standalone server on a throwaway SQLite database with migrations and seeds, so the demo database stays untouched.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
const PASSWORD = 'v2-attendance-test-password';

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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-attendance-'));
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
  // The payroll demo pre-generates and locks last month's summaries; this suite generates them itself.
  process.env.HR_PAYROLL_DEMO = 'false';
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
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_PAYROLL_DEMO;
  delete process.env.ATTENDANCE_PUNCH_MOCK_FILE;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

const TZ = 'Asia/Shanghai';
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const day = (n: number) => addDays(today(), n);
const local = (date: string, time: string) => `${date}T${time}:00+08:00`;

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id);
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

async function notified(key: string): Promise<boolean> {
  const { notificationServiceToken } =
    await import('@nocobase/app-plugin-notification');
  const notifications = server.application.container.resolve(
    notificationServiceToken,
  );
  return Boolean(await notifications.getByIdempotencyKey(`hr:${key}`));
}

async function upload(
  username: string,
  url: string,
  file: Uint8Array,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  form.set('file', new File([file], 'punches.xlsx'));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      method: 'POST',
      headers: { cookie: await signIn(username), origin: 'http://localhost' },
      body: form,
    }),
  );
  return { status: response.status, json: (await response.json()) as Json };
}

async function scheduleOf(employeeId: string, date: string) {
  return (await db())
    .query()
    .selectFrom('shiftSchedules')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .where('date', '=', date)
    .executeTakeFirst();
}

async function recordOf(employeeId: string, date: string) {
  return (await db())
    .query()
    .selectFrom('attendanceRecords')
    .selectAll()
    .where('employeeId', '=', employeeId)
    .where('date', '=', date)
    .executeTakeFirst();
}

const decode = (value: unknown): any => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v);
  return v;
};

async function until<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  ms = 10_000,
) {
  const start = Date.now();
  let value = await read();
  while (!done(value) && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

describe('V2-05 demo data', () => {
  it('seeds the documented shifts, rules, templates, calendar and working years', async () => {
    const q = (await db()).query();
    const shifts = await q
      .selectFrom('shifts')
      .select(['code', 'startTime', 'endTime', 'isNight'])
      .execute();
    expect(shifts.map((s) => s.code).sort()).toEqual([
      'as-day',
      'as-night',
      'mc-early',
      'mc-middle',
      'mc-night',
      'office-day',
    ]);
    const rules = await q
      .selectFrom('attendanceRules')
      .select(['title'])
      .execute();
    expect(rules.map((r) => r.title).sort()).toEqual(
      ['机加工车间三班倒', '职能部门标准工时', '装配车间两班倒'].sort(),
    );
    const settings = await call('hr01', 'GET', '/attendance-settings');
    expect(settings.status).toBe(200);
    expect(
      settings.json.data.config.rotations.value.templates.map(
        (t: Json) => t.title,
      ),
    ).toEqual(['三班倒 · 每周轮换', '两班倒 · 每周轮换']);
    expect(settings.json.data.config.leaveUnits.value).toMatchObject({
      hourStep: 0.5,
      standardDayHours: 8,
    });
    const chen = await q
      .selectFrom('employees')
      .select(['userId', 'departmentId'])
      .where('id', '=', 'emp-chenchen')
      .executeTakeFirst();
    expect(chen).toMatchObject({ userId: null, departmentId: 'sz-mc' });
  });
});

describe('V2-05 scheduling', () => {
  it('applies the rotation for 机加工车间, saves and publishes it, and hides 成都 from mgr_njl', async () => {
    const rotation = await call('mgr_njl', 'POST', '/schedules/rotation', {
      templateKey: 'three-shift-weekly',
      employeeIds: ['emp-limin', 'emp-qianjin'],
      from: day(20),
      to: day(26),
    });
    expect(rotation.status).toBe(200);
    expect(rotation.json.data.cells).toHaveLength(14);
    const saved = await call('mgr_njl', 'POST', '/schedules/save', {
      cells: rotation.json.data.cells.map((c: Json) => ({
        ...c,
        expectedUpdatedAt: null,
      })),
      acknowledgeWarnings: true,
    });
    expect(saved.status).toBe(200);
    expect((await scheduleOf('emp-limin', day(20)))?.status).toBe('draft');
    const published = await call(
      'mgr_njl',
      'POST',
      '/schedules/publish-range',
      {
        departmentId: 'sz-mc',
        from: day(20),
        to: day(26),
      },
    );
    expect(published.status).toBe(200);
    const row = await scheduleOf('emp-limin', day(20));
    expect(row?.status).toBe('published');
    expect(
      await notified(
        `schedule:emp-limin:${new Date(String(row?.publishedAt)).toISOString()}`,
      ),
    ).toBe(true);
    const chengdu = await call(
      'mgr_njl',
      'GET',
      `/schedules?departmentId=cd-mc&from=${day(1)}&to=${day(7)}`,
    );
    expect(chengdu.status).toBe(200);
    expect(chengdu.json.data.employees).toEqual([]);
  });

  it('blocks leave days and other departments’ shifts, and asks to confirm six nights', async () => {
    const onLeave = await call('mgr_njl', 'POST', '/schedules/save', {
      cells: [
        { employeeId: 'emp-wanglei', date: day(3), shiftId: 'shift-mc-early' },
      ],
    });
    expect(onLeave.json.code).toBe('SCHEDULE_BLOCKED');
    expect(
      onLeave.json.details.checks[`emp-wanglei:${day(3)}`].map(
        (c: Json) => c.rule,
      ),
    ).toContain('leaveConflict');
    const assembly = await call('mgr_njl', 'POST', '/schedules/save', {
      cells: [
        { employeeId: 'emp-wanglei', date: day(30), shiftId: 'shift-as-day' },
      ],
    });
    expect(assembly.json.code).toBe('SCHEDULE_BLOCKED');
    expect(
      assembly.json.details.checks[`emp-wanglei:${day(30)}`].map(
        (c: Json) => c.rule,
      ),
    ).toContain('departmentScope');
    const nights = Array.from({ length: 6 }, (_, i) => ({
      employeeId: 'emp-wanglei',
      date: day(40 + i),
      shiftId: 'shift-mc-night',
    }));
    const warned = await call('mgr_njl', 'POST', '/schedules/save', {
      cells: nights,
    });
    expect(warned.json.code).toBe('SCHEDULE_WARNING_CONFIRMATION');
    const ok = await call('mgr_njl', 'POST', '/schedules/save', {
      cells: nights,
      acknowledgeWarnings: true,
    });
    expect(ok.status).toBe(200);
    // mgr_east schedules 装配车间, which has no head of its own.
    const east = await call('mgr_east', 'POST', '/schedules/save', {
      cells: [
        { employeeId: 'emp-sunli', date: day(30), shiftId: 'shift-as-day' },
      ],
    });
    expect(east.status).toBe(200);
  });
});

describe('V2-05 leave conflicts and cover suggestions', () => {
  let leaveId = '';
  it('flags 钱进’s day-5 early shift on approval and suggests cover without changing the schedule', async () => {
    const draft = await call('emp_njl_3', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-personal',
      startAt: local(day(5), '00:00'),
      endAt: local(day(6), '00:00'),
      reason: '家中有事',
    });
    expect(draft.status).toBe(201);
    const submitted = await call(
      'emp_njl_3',
      'POST',
      `/leave/requests/${draft.json.data.id}/submit`,
      {
        expectedUpdatedAt: draft.json.data.updatedAt,
      },
    );
    expect(submitted.status).toBe(200);
    const approved = await call(
      'mgr_njl',
      'POST',
      `/leave/requests/${draft.json.data.id}/decide`,
      {
        decision: 'approved',
        expectedUpdatedAt: submitted.json.data.updatedAt,
      },
    );
    expect(approved.status).toBe(200);
    expect(approved.json.data.status).toBe('approved');
    leaveId = draft.json.data.id;
    const cell = await scheduleOf('emp-qianjin', day(5));
    expect(cell?.shiftId).toBe('shift-mc-early');
    expect(decode(cell?.checkResult)).toEqual([
      expect.objectContaining({
        rule: 'leaveConflict',
        level: 'block',
        leaveRequestId: leaveId,
      }),
    ]);
    const suggested = await until(
      () => scheduleOf('emp-qianjin', day(5)),
      (row) => Boolean(row?.replacementSuggestion),
    );
    const suggestion = decode(suggested?.replacementSuggestion);
    const ids = suggestion.candidates.map((c: Json) => c.employeeId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(3);
    expect(ids).toContain('emp-limin');
    expect(ids).not.toContain('emp-wanglei');
    for (const c of suggestion.candidates)
      expect(c.reasons.length).toBeGreaterThan(0);
    // The head's notice names each person with the reason, not only a link.
    const notice = await until(
      async () =>
        (await db())
          .query()
          .selectFrom('workItems')
          .select(['summary', 'detail'])
          .where('refId', 'like', `replacement:${String(suggested?.id)}:%`)
          .executeTakeFirst(),
      (row) => Boolean(row),
    );
    expect(`${notice?.detail ?? notice?.summary ?? ''}`).toMatch(/李敏：.+/u);
    // One full stop at the end of the list, never “。。”.
    expect(`${notice?.detail ?? notice?.summary ?? ''}`).not.toContain('。。');
    expect(suggested?.shiftId).toBe('shift-mc-early');
    expect(await notified(`leaveConflict:${String(cell?.id)}:${leaveId}`)).toBe(
      true,
    );
    const candidates = await call(
      'mgr_njl',
      'GET',
      `/schedules/${String(cell?.id)}/candidates`,
    );
    expect(candidates.status).toBe(200);
    const offered = candidates.json.data.candidates as Json[];
    expect(offered.map((c) => c.employeeId)).toContain('emp-limin');
    // Only CNC operators like 钱进, never 车间主任 陈静 (the head, who approves the leave).
    expect(offered.map((c) => c.employeeId)).not.toContain('emp-mgr-njl');
    const positions = await (
      await db()
    )
      .query()
      .selectFrom('employees')
      .select(['positionId'])
      .where(
        'id',
        'in',
        offered.map((c) => String(c.employeeId)),
      )
      .execute();
    expect(new Set(positions.map((p) => p.positionId))).toEqual(
      new Set(['pos-cnc-operator']),
    );
    // A rest that cannot be worked out is left out, never shown as “—”.
    for (const c of offered)
      expect((c.reasons as string[]).join('')).not.toContain('—');
  });

  it('does not suggest or notify again for the same conflict on the 09:00 run', async () => {
    const q = (await db()).query();
    const runs = async () =>
      (
        await q
          .selectFrom('aiTaskRuns')
          .select(['status'])
          .where('task', '=', 'hrAssistant.replacementSuggest')
          .execute()
      ).map((r) => r.status);
    const before = await runs();
    const daily = await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(daily.status).toBe(200);
    const after = await runs();
    expect(after.filter((s) => s === 'succeeded').length).toBe(
      before.filter((s) => s === 'succeeded').length,
    );
  });

  it('lets mgr_njl put 李敏 on the shift and clears the flag when 钱进 cancels', async () => {
    const li = await scheduleOf('emp-limin', day(5));
    const saved = await call('mgr_njl', 'POST', '/schedules/save', {
      cells: [
        {
          employeeId: 'emp-limin',
          date: day(5),
          shiftId: 'shift-mc-early',
          expectedUpdatedAt: li
            ? new Date(String(li.updatedAt)).toISOString()
            : null,
        },
      ],
    });
    expect(saved.status).toBe(200);
    expect(saved.json.data.checks[`emp-limin:${day(5)}`] ?? []).toEqual([]);
    const current = await call(
      'emp_njl_3',
      'GET',
      `/leave/requests/${leaveId}`,
    );
    const cancelled = await call(
      'emp_njl_3',
      'POST',
      `/leave/requests/${leaveId}/cancel`,
      {
        expectedUpdatedAt: current.json.data.updatedAt,
      },
    );
    expect(cancelled.status).toBe(200);
    const cell = await scheduleOf('emp-qianjin', day(5));
    expect(decode(cell?.checkResult) ?? []).toEqual([]);
  });
});

describe('V2-05 punches, calculation and requests', () => {
  it('imports the device export: 12 minutes late is late, a missing check-out is missingPunch, nights stay on their start day', async () => {
    const file = await server.fetch(
      new Request(`${base}/api/talent/attendance/import/demo-file`, {
        headers: { cookie: await signIn('hr01') },
      }),
    );
    expect(file.status).toBe(200);
    const buffer = new Uint8Array(await file.arrayBuffer());
    const preview = await upload('hr01', '/attendance/import/preview', buffer);
    expect(preview.status).toBe(200);
    const unknown = preview.json.data.rows.find(
      (r: Json) => r.employeeNo === 'QH9999',
    );
    expect(unknown.errors).toContain('EMPLOYEE_NOT_FOUND');
    expect((await upload('hr01', '/attendance/import', buffer)).json.code).toBe(
      'IMPORT_HAS_ERRORS',
    );
    const imported = await upload('hr01', '/attendance/import', buffer, {
      skipInvalid: 'true',
    });
    expect(imported.status).toBe(200);
    expect(await recordOf('emp-limin', day(-2))).toMatchObject({
      status: 'late',
      lateMinutes: 12,
    });
    expect((await recordOf('emp-qianjin', day(-2)))?.status).toBe(
      'missingPunch',
    );
    expect((await recordOf('emp-qianjin', day(-1)))?.status).toBe(
      'missingPunch',
    );
    const night = await recordOf('emp-wanglei', day(-2));
    expect(night?.status).toBe('normal');
    expect(decode(night?.punches)).toHaveLength(2);
    // The daily run: the anomalies are asked about (nobody is bound to Feishu in this suite, so 钱进's two missed
    // check-outs go to his head as one reminder), and 王磊’s overtime is near the line.
    const hr01 = await userIdOf('hr01');
    const daily = await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(daily.json.data.anomalyReminder).toBe('succeeded');
    const missed = [
      await recordOf('emp-qianjin', day(-2)),
      await recordOf('emp-qianjin', day(-1)),
    ];
    const inquiries = missed.map((r) => decode(r?.inquiry));
    expect(inquiries[0]).toMatchObject({ channel: 'head', reply: null });
    expect(inquiries[1]?.askedAt).toBe(inquiries[0]?.askedAt);
    expect(await notified(`attendanceInquiry:${String(missed[0]?.id)}`)).toBe(
      true,
    );
    expect(await notified(`attendanceInquiry:${String(missed[1]?.id)}`)).toBe(
      false,
    );
    const log = async (prefix: string) =>
      (
        await (
          await db()
        )
          .query()
          .selectFrom('hrReminderLog')
          .select(['reminderKey'])
          .execute()
      )
        .map((r) => String(r.reminderKey))
        .filter((k) => k.startsWith(prefix));
    expect(await log('attendanceOvertime:emp-wanglei:')).toHaveLength(1);
    expect(
      await notified(`attendanceOvertime:emp-wanglei:${today().slice(0, 7)}`),
    ).toBe(true);
    expect(hr01).toBeTruthy();
    const again = await call('hr01', 'POST', '/attendance/tasks/daily/run', {});
    expect(again.status).toBe(200);
    // Asked once: the second run leaves the question as it was.
    expect(
      decode((await recordOf('emp-qianjin', day(-2)))?.inquiry)?.askedAt,
    ).toBe(inquiries[0]?.askedAt);
    expect(await log('attendanceOvertime:emp-wanglei:')).toHaveLength(1);
  });

  it('turns 15 minutes of grace into normal after a recalculation', async () => {
    const rule = await call(
      'hr01',
      'GET',
      '/attendance-settings/rules/rule-mc',
    );
    expect(rule.status).toBe(200);
    const { id: _id, createdAt: _c, updatedAt, ...values } = rule.json.data;
    const keys = [
      'title',
      'departmentIds',
      'workHourSystem',
      'punchSource',
      'lateGraceMinutes',
      'overtimeRequiresApproval',
      'monthlyOvertimeAlertHours',
      'minRestHours',
      'maxConsecutiveNights',
      'active',
    ];
    const patched = await call(
      'hr01',
      'PATCH',
      '/attendance-settings/rules/rule-mc',
      {
        value: {
          ...Object.fromEntries(
            Object.entries(values).filter(([k]) => keys.includes(k)),
          ),
          lateGraceMinutes: 15,
        },
        expectedUpdatedAt: updatedAt,
      },
    );
    expect(patched.status).toBe(200);
    const recomputed = await call('hr01', 'POST', '/attendance/recompute', {
      from: day(-2),
      to: day(-2),
      departmentId: 'sz-mc',
    });
    expect(recomputed.status).toBe(200);
    expect((await recordOf('emp-limin', day(-2)))?.status).toBe('normal');
  });

  it('recalculates an approved missed punch to normal and refuses the fourth of the month', async () => {
    const request = await call('emp_njl_3', 'POST', '/adjustments', {
      type: 'missingPunch',
      date: day(-2),
      reason: '忘记打卡',
      details: { at: local(day(-2), '14:03') },
    });
    expect(request.status).toBe(201);
    const todo = await call(
      'mgr_njl',
      'GET',
      '/adjustments?view=todo&type=missingPunch',
    );
    expect(todo.json.data.map((r: Json) => r.id)).toContain(
      request.json.data.id,
    );
    const decided = await call(
      'mgr_njl',
      'POST',
      `/adjustments/${request.json.data.id}/decide`,
      {
        decision: 'approved',
        expectedUpdatedAt: request.json.data.updatedAt,
      },
    );
    expect(decided.status).toBe(200);
    expect((await recordOf('emp-qianjin', day(-2)))?.status).toBe('normal');
    // Three in a month is the limit (two more pending, then the fourth).
    for (const date of [day(-1), day(-3)]) {
      const extra = await call('emp_njl_3', 'POST', '/adjustments', {
        type: 'missingPunch',
        date,
        reason: '忘记打卡',
        details: { at: local(date, '14:01') },
      });
      if (date.slice(0, 7) === day(-2).slice(0, 7))
        expect(extra.status).toBe(201);
    }
    const sameMonth = [day(-1), day(-3)].filter(
      (d) => d.slice(0, 7) === day(-2).slice(0, 7),
    ).length;
    if (sameMonth === 2) {
      const fourth = await call('emp_njl_3', 'POST', '/adjustments', {
        type: 'missingPunch',
        date: day(-2),
        reason: '再次补卡',
        details: { at: local(day(-2), '06:01') },
      });
      expect(fourth.json.code).toBe('MISSING_PUNCH_LIMIT');
    }
  });

  it('swaps 钱进 and 李敏 only after 李敏 agrees, then mgr_njl approves', async () => {
    // A day both work different shifts.
    let date = '';
    for (let n = 8; n <= 14 && !date; n++) {
      const a = await scheduleOf('emp-qianjin', day(n));
      const b = await scheduleOf('emp-limin', day(n));
      if (
        a &&
        b &&
        (a.shiftId ?? null) !== (b.shiftId ?? null) &&
        (a.shiftId || b.shiftId)
      )
        date = day(n);
    }
    expect(date).not.toBe('');
    const before = {
      mine: (await scheduleOf('emp-qianjin', date))?.shiftId ?? null,
      theirs: (await scheduleOf('emp-limin', date))?.shiftId ?? null,
    };
    const request = await call('emp_njl_3', 'POST', '/adjustments', {
      type: 'shiftSwap',
      date,
      reason: '家里有事，与李敏换班',
      details: { counterpartEmployeeId: 'emp-limin' },
    });
    expect(request.status).toBe(201);
    const early = await call(
      'mgr_njl',
      'GET',
      '/adjustments?view=todo&type=shiftSwap',
    );
    expect(early.json.data.map((r: Json) => r.id)).not.toContain(
      request.json.data.id,
    );
    const consent = await call(
      'emp_njl_2',
      'GET',
      '/adjustments?view=todo&type=shiftSwap',
    );
    expect(consent.json.data.map((r: Json) => r.id)).toContain(
      request.json.data.id,
    );
    const agreed = await call(
      'emp_njl_2',
      'POST',
      `/adjustments/${request.json.data.id}/decide`,
      {
        decision: 'approved',
        expectedUpdatedAt: request.json.data.updatedAt,
      },
    );
    expect(agreed.status).toBe(200);
    const todo = await call(
      'mgr_njl',
      'GET',
      '/adjustments?view=todo&type=shiftSwap',
    );
    expect(todo.json.data.map((r: Json) => r.id)).toContain(
      request.json.data.id,
    );
    const approved = await call(
      'mgr_njl',
      'POST',
      `/adjustments/${request.json.data.id}/decide`,
      {
        decision: 'approved',
        acknowledgeWarnings: undefined,
        expectedUpdatedAt: agreed.json.data.updatedAt,
      },
    );
    expect(approved.status).toBe(200);
    expect((await scheduleOf('emp-qianjin', date))?.shiftId ?? null).toBe(
      before.theirs,
    );
    expect((await scheduleOf('emp-limin', date))?.shiftId ?? null).toBe(
      before.mine,
    );
  });

  it('types overtime on the National Day holiday as holiday', async () => {
    const date = `${today().slice(0, 4)}-10-02`;
    const request = await call('emp_njl_3', 'POST', '/adjustments', {
      type: 'overtime',
      date,
      reason: '国庆值班',
      details: { startAt: local(date, '08:00'), endAt: local(date, '12:00') },
    });
    expect(request.status).toBe(201);
    expect(request.json.data.details).toMatchObject({
      overtimeType: 'holiday',
      hours: 4,
    });
  });
});

describe('V2-05 balances and leave', () => {
  it('initializes 10, 5 and 2 days once', async () => {
    const year = Number(today().slice(0, 4));
    const first = await call('hr01', 'POST', '/leave/balances/initialize', {
      year,
      asOf: today(),
    });
    expect(first.status).toBe(201 === first.status ? 201 : 200);
    const q = (await db()).query();
    const annual = async (employeeId: string) =>
      Number(
        (
          await q
            .selectFrom('leaveBalances')
            .select(['entitled'])
            .where('employeeId', '=', employeeId)
            .where('leaveTypeId', '=', 'leave-annual')
            .where('year', '=', year)
            .executeTakeFirst()
        )?.entitled,
      );
    expect(await annual('emp-qianjin')).toBe(10);
    expect(await annual('emp-limin')).toBe(5);
    expect(await annual('emp-chenchen')).toBe(2);
    const again = await call('hr01', 'POST', '/leave/balances/initialize', {
      year,
      asOf: today(),
    });
    expect(again.json.data.created).toEqual([]);
  });

  it('gives 李敏 her own balance and sends a four-day annual leave through two levels', async () => {
    const mine = await call('emp_njl_2', 'GET', '/leave/requests/my-balances');
    expect(mine.status).toBe(200);
    expect(
      mine.json.data.items.find((i: Json) => i.leaveTypeTitle === '年假')
        ?.available,
    ).toBe(5);
    const shifts: string[] = [];
    for (let n = 15; n <= 45 && shifts.length < 4; n++) {
      const cell = await scheduleOf('emp-limin', day(n));
      if (cell?.shiftId) shifts.push(day(n));
    }
    if (shifts.length < 4) return;
    const draft = await call('emp_njl_2', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-annual',
      startAt: local(shifts[0], '00:00'),
      endAt: local(addDays(shifts[3], 1), '00:00'),
      reason: '年假',
    });
    expect(draft.status).toBe(201);
    const submitted = await call(
      'emp_njl_2',
      'POST',
      `/leave/requests/${draft.json.data.id}/submit`,
      {
        expectedUpdatedAt: draft.json.data.updatedAt,
      },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.json.data.approvals.map((s: Json) => s.kind)).toEqual([
      'departmentHead',
      'hrAdmin',
    ]);
  });

  it('refuses sick leave without proof', async () => {
    const draft = await call('emp_njl_1', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-sick',
      // Counted by schedule: 王磊 works a middle shift on day 5.
      startAt: local(day(5), '00:00'),
      endAt: local(day(6), '00:00'),
    });
    expect(draft.status).toBe(201);
    const submitted = await call(
      'emp_njl_1',
      'POST',
      `/leave/requests/${draft.json.data.id}/submit`,
      {
        expectedUpdatedAt: draft.json.data.updatedAt,
      },
    );
    expect(submitted.json.code).toBe('ATTACHMENT_REQUIRED');
  });
});

describe('V2-05 job events', () => {
  it('clears 赵阳’s schedule after leaving, tells mgr_cd, and does it once', async () => {
    const { recordJobEvent } =
      await import('../../server/providers/hr/job-events.ts');
    const { jobEventProcessorToken } =
      await import('../../server/providers/hr/tokens.ts');
    const database = await db();
    const date = today();
    const eventId = await database.transaction(async (connection) => {
      await connection.query
        .updateTable('employees')
        .set({ status: 'leave', leaveDate: date, updatedAt: new Date() })
        .where('id', '=', 'emp-zhaoyang')
        .execute();
      return recordJobEvent(connection, {
        employeeId: 'emp-zhaoyang',
        eventType: 'offboard',
        fromDepartmentId: 'cd-mc',
        toDepartmentId: null,
        fromPositionId: 'pos-cnc-operator',
        toPositionId: null,
        effectiveDate: date,
        source: 'manual',
        actionId: null,
        note: '测试离职',
      });
    });
    const processor = server.application.container.resolve(
      jobEventProcessorToken,
    );
    await processor.process();
    const after = await database
      .query()
      .selectFrom('shiftSchedules')
      .select(['id'])
      .where('employeeId', '=', 'emp-zhaoyang')
      .where('date', '>', date)
      .execute();
    expect(after).toEqual([]);
    expect(await notified(`offboardSchedule:${eventId}`)).toBe(true);
    await processor.process();
    expect(await notified(`offboardSchedule:${eventId}`)).toBe(true);
  });
});

describe('V2-05 monthly summary', () => {
  it('generates last month once, with night and shift counts that match the schedule, and a check list for hr01', async () => {
    const run = await call('hr01', 'POST', '/attendance/tasks/monthly/run', {});
    expect(run.status).toBe(200);
    expect(run.json.data.created).toBeGreaterThan(0);
    const month = run.json.data.month as string;
    const q = (await db()).query();
    const summary = await q
      .selectFrom('attendanceMonthlySummaries')
      .selectAll()
      .where('employeeId', '=', 'emp-limin')
      .where('month', '=', month)
      .executeTakeFirstOrThrow();
    const nights = await q
      .selectFrom('shiftSchedules')
      .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
      .select(['shifts.code as code', 'shifts.isNight as isNight'])
      .where('shiftSchedules.employeeId', '=', 'emp-limin')
      .where('shiftSchedules.date', '>=', `${month}-01`)
      .where('shiftSchedules.date', '<=', `${month}-31`)
      .execute();
    expect(Number(summary.nightShiftCount)).toBe(
      nights.filter((n) => Boolean(n.isNight)).length,
    );
    expect(
      Object.values(
        decode(summary.shiftCounts) as Record<string, number>,
      ).reduce((a, b) => a + b, 0),
    ).toBe(nights.length);
    expect(await notified(`attendanceMonthCheck:${month}`)).toBe(true);
    const again = await call(
      'hr01',
      'POST',
      '/attendance/tasks/monthly/run',
      {},
    );
    expect(again.json.data.created).toBe(0);
  });

  it('handles an objection, locks, refuses mgr_njl and unlocks only with a reason; hr01 confirms for 孙丽', async () => {
    const mine = await call(
      'emp_njl_1',
      'GET',
      `/attendance/me?month=${addDays(`${today().slice(0, 7)}-01`, -1).slice(0, 7)}`,
    );
    expect(mine.status).toBe(200);
    const id = mine.json.data.summary.id as string;
    const objection = await call(
      'emp_njl_1',
      'POST',
      `/attendance/summaries/${id}/objection`,
      { note: '12 号的夜班没算上' },
    );
    expect(objection.status).toBe(200);
    expect(
      (await call('hr01', 'POST', '/attendance/summaries/lock', { ids: [id] }))
        .json.data.refused,
    ).toHaveLength(1);
    const handled = await call(
      'hr01',
      'POST',
      `/attendance/summaries/${id}/handle`,
      { result: '已核对，排班无误' },
    );
    expect(handled.status).toBe(200);
    expect(
      (
        await call('mgr_njl', 'POST', '/attendance/summaries/lock', {
          ids: [id],
        })
      ).status,
    ).toBe(403);
    const locked = await call('hr01', 'POST', '/attendance/summaries/lock', {
      ids: [id],
    });
    expect(locked.json.data.locked).toEqual([id]);
    expect(
      (await call('emp_njl_1', 'POST', `/attendance/summaries/${id}/confirm`))
        .json.code,
    ).toBe('SUMMARY_STATE_CONFLICT');
    expect(
      (await call('hr01', 'POST', `/attendance/summaries/${id}/unlock`, {}))
        .status,
    ).toBe(400);
    const unlocked = await call(
      'hr01',
      'POST',
      `/attendance/summaries/${id}/unlock`,
      { reason: '补录加班' },
    );
    expect(unlocked.status).toBe(200);
    const monthly = await call(
      'hr01',
      'GET',
      `/attendance/monthly?month=${mine.json.data.summary.month}&departmentId=sz-as`,
    );
    const sun = monthly.json.data.summaries.find(
      (s: Json) => s.employeeId === 'emp-sunli',
    );
    expect(sun?.confirmBy).toBe('hr');
    const confirmed = await call(
      'hr01',
      'POST',
      `/attendance/summaries/${sun.id}/confirm`,
    );
    expect(confirmed.status).toBe(200);
  });
});

describe('V2-05 permissions', () => {
  it('scopes attendance to the department and the employee themself', async () => {
    const from = day(-3);
    const to = day(-1);
    const chengdu = await call(
      'mgr_njl',
      'GET',
      `/attendance/daily?from=${from}&to=${to}&departmentId=cd-mc`,
    );
    expect(chengdu.status).toBe(200);
    expect(chengdu.json.data.employees).toEqual([]);
    const own = await call(
      'emp_njl_1',
      'GET',
      `/attendance/daily?from=${from}&to=${to}`,
    );
    expect(own.status).toBe(200);
    expect(own.json.data.employees.map((e: Json) => e.id)).toEqual([
      'emp-wanglei',
    ]);
    const other = await call(
      'emp_njl_1',
      'GET',
      `/attendance/daily?from=${from}&to=${to}&employeeId=emp-limin`,
    );
    expect(other.json.data.employees).toEqual([]);
    expect(
      (await call('emp_njl_1', 'POST', '/attendance/recompute', { from, to }))
        .status,
    ).toBe(403);
    expect(
      (await call(null, 'GET', `/attendance/daily?from=${from}&to=${to}`))
        .status,
    ).toBe(401);
  });
});

describe('V2-05 application time and the demo Feishu pull', () => {
  it('serves the business time zone to a signed-in user only', async () => {
    const own = await call('hr01', 'GET', '/app-time');
    expect(own.status).toBe(200);
    expect(own.json.data).toEqual({ timeZone: TZ, today: today() });
    expect((await call(null, 'GET', '/app-time')).status).toBe(401);
  });

  it('fakes Feishu punches for every past office day of the last week, not only yesterday', async () => {
    const run = await call('hr01', 'POST', '/attendance/tasks/pull/run');
    expect(run.status).toBe(200);
    expect(run.json.data.source).toBe('mock');
    const from = addDays(today(), -7);
    const to = addDays(today(), -1);
    const months = [...new Set([from.slice(0, 7), to.slice(0, 7)])];
    const schedules: Json[] = [];
    const records: Json[] = [];
    for (const month of months) {
      const mine = await call('hr01', 'GET', `/attendance/me?month=${month}`);
      expect(mine.status).toBe(200);
      schedules.push(...mine.json.data.schedules);
      records.push(...mine.json.data.records);
    }
    const officeDays = schedules
      .filter((s) => s.code === 'office-day' && s.date >= from && s.date <= to)
      .map((s) => s.date as string);
    // The seed puts office days on the weekdays of the three days before today.
    expect(officeDays.length).toBeGreaterThan(0);
    // Each of them is a normal day now, none 旷工.
    expect(
      officeDays.map((date) => [
        date,
        records.find((r) => r.date === date)?.status,
      ]),
    ).toEqual(officeDays.map((date) => [date, 'normal']));
    // The file is emptied like an acknowledged queue: a second pull adds nothing.
    const again = await call('hr01', 'POST', '/attendance/tasks/pull/run');
    expect(again.json.data.pulled).toBe(0);
  });
});

describe('whole-day leave on a night shift', () => {
  it('turns a whole day into that day’s shift, so one night is one day', async () => {
    const { leaveRequestServiceToken } =
      await import('../../server/providers/hr/tokens.ts');
    const leave = server.application.container.resolve(
      leaveRequestServiceToken,
    );
    const night = await (
      await db()
    )
      .query()
      .selectFrom('shiftSchedules')
      .select(['date'])
      .where('employeeId', '=', 'emp-wanglei')
      .where('shiftId', '=', 'shift-mc-night')
      .where('status', '=', 'published')
      .where('date', '>', day(0))
      .orderBy('date', 'asc')
      .executeTakeFirst();
    expect(night).toBeDefined();
    const date = String(
      night!.date instanceof Date
        ? night!.date.toISOString().slice(0, 10)
        : night!.date,
    ).slice(0, 10);
    const userId = await userIdOf('emp_njl_1');
    const range = await leave.wholeDayWindow(
      { userId } as Parameters<typeof leave.wholeDayWindow>[0],
      local(date, '00:00'),
      local(addDays(date, 1), '00:00'),
    );
    expect(range).toEqual({
      startAt: new Date(local(date, '22:00')).toISOString(),
      endAt: new Date(local(addDays(date, 1), '06:00')).toISOString(),
    });
    // A range that is not whole days is left as it is.
    const partial = await leave.wholeDayWindow(
      { userId } as Parameters<typeof leave.wholeDayWindow>[0],
      local(date, '09:00'),
      local(date, '12:00'),
    );
    expect(partial).toEqual({
      startAt: local(date, '09:00'),
      endAt: local(date, '12:00'),
    });
  });

  it('saves a whole day from the leave page as that day’s shift too, and a retry matches it', async () => {
    const night = await (
      await db()
    )
      .query()
      .selectFrom('shiftSchedules')
      .select(['date'])
      .where('employeeId', '=', 'emp-wanglei')
      .where('shiftId', '=', 'shift-mc-night')
      .where('status', '=', 'published')
      .where('date', '>', day(0))
      .orderBy('date', 'asc')
      .executeTakeFirst();
    const date = String(
      night!.date instanceof Date
        ? night!.date.toISOString().slice(0, 10)
        : night!.date,
    ).slice(0, 10);
    const input = {
      leaveTypeId: 'leave-personal',
      startAt: local(date, '00:00'),
      endAt: local(addDays(date, 1), '00:00'),
      reason: '家里有事',
      clientRequestId: '6f1d6c1e-2b8a-4d4c-9f3e-1a2b3c4d5e6f',
    };
    const created = await call('emp_njl_1', 'POST', '/leave/requests', input);
    expect(created.status).toBe(201);
    const shift = {
      startAt: new Date(local(date, '22:00')).toISOString(),
      endAt: new Date(local(addDays(date, 1), '06:00')).toISOString(),
    };
    expect(created.json.data).toMatchObject({ ...shift, duration: 1 });
    // The form retries with the same request id: the saved draft is returned, not refused.
    const again = await call('emp_njl_1', 'POST', '/leave/requests', input);
    expect(again.status).toBe(201);
    expect(again.json.data.id).toBe(created.json.data.id);
    const { sameLeaveRange } =
      await import('../../client/components/talent/leave-range.ts');
    expect(sameLeaveRange(created.json.data, input, 'Asia/Shanghai')).toBe(
      true,
    );
    // Editing it as a whole day again keeps the shift.
    const updated = await call(
      'emp_njl_1',
      'PATCH',
      `/leave/requests/${created.json.data.id}`,
      {
        leaveTypeId: 'leave-personal',
        startAt: input.startAt,
        endAt: input.endAt,
        reason: '家里有事（改）',
        expectedUpdatedAt: created.json.data.updatedAt,
      },
    );
    expect(updated.status).toBe(200);
    expect(updated.json.data).toMatchObject({ ...shift, duration: 1 });
  });
});

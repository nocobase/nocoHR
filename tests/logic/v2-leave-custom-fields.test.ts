// @vitest-environment node

// V2-05 acceptance for 界面追加字段 on 请假单 and 考勤申请 (启衡精密 demo data): hr01 adds 工作交接人 to leaveRequests and
// puts it on the form; 李敏 fills it on a draft and submits; mgr_njl sees it while approving. A required field refuses
// the submission (not the draft), sensitive fields reach only the applicant and HR, and 补卡/加班/调班 requests carry
// their own fields the same way. Boots the real standalone server on a throwaway SQLite database, like v2-attendance.
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
const PASSWORD = 'v2-leave-custom-fields-test-password';

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
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-leave-cf-'));
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


async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

const decode = (value: unknown): any => {
  let v = value;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v);
  return v;
};

async function scheduledDays(employeeId: string, from: number, to: number) {
  const q = (await db()).query();
  const found: string[] = [];
  for (let n = from; n <= to; n++) {
    const cell = await q
      .selectFrom('shiftSchedules')
      .select(['shiftId'])
      .where('employeeId', '=', employeeId)
      .where('date', '=', day(n))
      .executeTakeFirst();
    if (cell?.shiftId) found.push(day(n));
  }
  return found;
}

async function defineField(input: Json) {
  const created = await call('hr01', 'POST', '/custom-fields', input);
  expect(created.status).toBe(201);
  return created.json.data as { id: string; key: string };
}

describe('V2-05 请假单 with 工作交接人', () => {
  let handover: { id: string; key: string };
  let diagnosis: { id: string; key: string };
  let days: string[];
  let requestId: string;

  beforeAll(async () => {
    handover = await defineField({
      collection: 'leaveRequests',
      label: { 'zh-CN': '工作交接人', 'en-US': 'Handover to' },
      type: 'text',
      placements: ['form', 'detail'],
    });
    diagnosis = await defineField({
      collection: 'leaveRequests',
      label: { 'zh-CN': '病情说明' },
      type: 'text',
      placements: ['form', 'detail'],
      sensitive: true,
    });
    days = await scheduledDays('emp-limin', 7, 14);
    if (days.length < 2) throw new Error('李敏 needs two scheduled days');
  });

  it('keeps 工作交接人 on 李敏’s draft and submits it', async () => {
    const draft = await call('emp_njl_2', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-personal',
      startAt: local(days[0], '00:00'),
      endAt: local(addDays(days[0], 1), '00:00'),
      reason: '家中有事',
      customFields: { [handover.key]: ' 钱进 ', [diagnosis.key]: '不宜公开' },
      clientRequestId: crypto.randomUUID(),
    });
    expect(draft.status).toBe(201);
    requestId = draft.json.data.id;
    expect(draft.json.data.customFields).toEqual({
      [handover.key]: '钱进',
      [diagnosis.key]: '不宜公开',
    });
    const stored = await (await db())
      .query()
      .selectFrom('leaveRequests')
      .select(['customFields'])
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    expect(decode(stored.customFields)).toEqual({
      [handover.key]: '钱进',
      [diagnosis.key]: '不宜公开',
    });
    // An edit without customFields keeps the values.
    const edited = await call(
      'emp_njl_2',
      'PATCH',
      `/leave/requests/${requestId}`,
      {
        leaveTypeId: 'leave-personal',
        startAt: local(days[0], '00:00'),
        endAt: local(addDays(days[0], 1), '00:00'),
        reason: '家中有事，已交接',
        expectedUpdatedAt: draft.json.data.updatedAt,
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.json.data.customFields[handover.key]).toBe('钱进');
    const own = await call('emp_njl_2', 'GET', `/leave/requests/${requestId}`);
    expect(own.json.data.customFields).toEqual({
      [handover.key]: '钱进',
      [diagnosis.key]: '不宜公开',
    });
    const submitted = await call(
      'emp_njl_2',
      'POST',
      `/leave/requests/${requestId}/submit`,
      { expectedUpdatedAt: own.json.data.updatedAt },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.json.data.status).toBe('pending');
  });

  it('shows 工作交接人 to mgr_njl while approving, but not the sensitive field; hr01 sees both', async () => {
    const approver = await call('mgr_njl', 'GET', `/leave/requests/${requestId}`);
    expect(approver.status).toBe(200);
    expect(approver.json.data.canApprove).toBe(true);
    expect(approver.json.data.customFields).toEqual({ [handover.key]: '钱进' });
    const queue = await call('mgr_njl', 'GET', '/leave/approvals');
    const listed = (queue.json.data ?? []).find(
      (row: Json) => row.id === requestId,
    );
    expect(listed?.customFields).toEqual({ [handover.key]: '钱进' });
    const hr = await call('hr01', 'GET', `/leave/requests/${requestId}`);
    if (hr.status === 200)
      expect(hr.json.data.customFields[diagnosis.key]).toBe('不宜公开');
    const decided = await call(
      'mgr_njl',
      'POST',
      `/leave/requests/${requestId}/decide`,
      {
        decision: 'approved',
        expectedUpdatedAt: approver.json.data.updatedAt,
      },
    );
    expect(decided.status).toBe(200);
    expect(decided.json.data.customFields).toBeUndefined();
  });

  it('refuses to submit without a required field, and saves the draft without it', async () => {
    // The patch restates the placements: the definitions API resets omitted ones to their defaults.
    const required = await call('hr01', 'PATCH', `/custom-fields/${handover.id}`, {
      required: true,
      placements: ['form', 'detail'],
    });
    expect(required.status).toBe(200);
    const draft = await call('emp_njl_2', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-personal',
      startAt: local(days[1], '00:00'),
      endAt: local(addDays(days[1], 1), '00:00'),
      reason: '体检',
    });
    expect(draft.status).toBe(201);
    const refused = await call(
      'emp_njl_2',
      'POST',
      `/leave/requests/${draft.json.data.id}/submit`,
      { expectedUpdatedAt: draft.json.data.updatedAt },
    );
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('CUSTOM_FIELD_INVALID');
    expect(refused.json.details.fields).toEqual({
      [handover.key]: 'CUSTOM_FIELD_REQUIRED',
    });
    // Nothing moved: still a draft at the same version.
    const still = await call(
      'emp_njl_2',
      'GET',
      `/leave/requests/${draft.json.data.id}`,
    );
    expect(still.json.data.status).toBe('draft');
    expect(still.json.data.updatedAt).toBe(draft.json.data.updatedAt);
    const filled = await call(
      'emp_njl_2',
      'POST',
      `/leave/requests/${draft.json.data.id}/submit`,
      {
        expectedUpdatedAt: draft.json.data.updatedAt,
        customFields: { [handover.key]: '王磊' },
      },
    );
    expect(filled.status).toBe(200);
    expect(filled.json.data.customFields[handover.key]).toBe('王磊');
  });

  it('rejects a value that is not an object and keys nobody defined', async () => {
    const bad = await call('emp_njl_2', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-personal',
      startAt: local(days[0], '00:00'),
      endAt: local(addDays(days[0], 1), '00:00'),
      customFields: ['钱进'],
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe('INVALID_INPUT');
    const unknown = await call('emp_njl_2', 'POST', '/leave/requests', {
      leaveTypeId: 'leave-personal',
      startAt: local(days[0], '00:00'),
      endAt: local(addDays(days[0], 1), '00:00'),
      customFields: { cf_nobody: 'x', [handover.key]: '钱进' },
    });
    expect(unknown.status).toBe(201);
    expect(unknown.json.data.customFields).toEqual({ [handover.key]: '钱进' });
  });

  it('asks the same idempotency key for the same added values', async () => {
    const clientRequestId = crypto.randomUUID();
    const body = {
      leaveTypeId: 'leave-personal',
      startAt: local(days[1], '00:00'),
      endAt: local(addDays(days[1], 1), '00:00'),
      clientRequestId,
      customFields: { [handover.key]: '钱进' },
    };
    const first = await call('emp_njl_2', 'POST', '/leave/requests', body);
    expect(first.status).toBe(201);
    const again = await call('emp_njl_2', 'POST', '/leave/requests', body);
    expect(again.json.data.id).toBe(first.json.data.id);
    const changed = await call('emp_njl_2', 'POST', '/leave/requests', {
      ...body,
      customFields: { [handover.key]: '王磊' },
    });
    expect(changed.status).toBe(409);
    expect(changed.json.code).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('V2-05 考勤申请 with added fields', () => {
  let project: { id: string; key: string };

  beforeAll(async () => {
    project = await defineField({
      collection: 'attendanceAdjustments',
      label: { 'zh-CN': '加班项目' },
      type: 'select',
      options: [
        { value: 'mo-24031', label: 'MO-24031' },
        { value: 'mo-24032', label: 'MO-24032' },
      ],
      required: true,
      placements: ['form', 'detail'],
    });
  });

  const overtime = (date: string, customFields?: Json) => ({
    type: 'overtime',
    date,
    reason: '赶工',
    details: { startAt: local(date, '18:00'), endAt: local(date, '20:00') },
    ...(customFields ? { customFields } : {}),
  });

  it('refuses 钱进’s overtime without 加班项目 and records it with one', async () => {
    const missing = await call('emp_njl_3', 'POST', '/adjustments', overtime(day(9)));
    expect(missing.status).toBe(400);
    expect(missing.json.code).toBe('CUSTOM_FIELD_INVALID');
    expect(missing.json.details.fields).toEqual({
      [project.key]: 'CUSTOM_FIELD_REQUIRED',
    });
    const wrong = await call(
      'emp_njl_3',
      'POST',
      '/adjustments',
      overtime(day(9), { [project.key]: 'mo-99999' }),
    );
    expect(wrong.status).toBe(400);
    // A required field's wrong option is reported under its key (as required: it stays empty).
    expect(wrong.json.code).toBe('CUSTOM_FIELD_INVALID');
    expect(wrong.json.details.fields[project.key]).toMatch(/^CUSTOM_FIELD_/u);
    const created = await call(
      'emp_njl_3',
      'POST',
      '/adjustments',
      overtime(day(9), { [project.key]: 'mo-24031' }),
    );
    expect(created.status).toBe(201);
    expect(created.json.data.customFields).toEqual({ [project.key]: 'mo-24031' });
    const detail = await call('mgr_njl', 'GET', `/adjustments/${created.json.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.data.canDecide).toBe(true);
    expect(detail.json.data.customFields).toEqual({ [project.key]: 'mo-24031' });
    const todo = await call('mgr_njl', 'GET', '/adjustments?view=todo&type=overtime');
    expect(
      todo.json.data.find((r: Json) => r.id === created.json.data.id)
        ?.customFields,
    ).toEqual({ [project.key]: 'mo-24031' });
  });

  it('submits a draft only once its required field is filled', async () => {
    const q = (await db()).query();
    const id = crypto.randomUUID();
    const stamp = new Date();
    // A draft as the HR assistant leaves one: no added values yet.
    await q
      .insertInto('attendanceAdjustments')
      .values({
        id,
        type: 'overtime',
        employeeId: 'emp-qianjin',
        date: day(10),
        details: JSON.stringify({
          startAt: local(day(10), '18:00'),
          endAt: local(day(10), '19:00'),
        }),
        reason: '设备调试',
        status: 'draft',
        source: 'hrAssistant',
        approvals: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    const refused = await call('emp_njl_3', 'POST', `/adjustments/${id}/submit`);
    expect(refused.status).toBe(400);
    expect(refused.json.code).toBe('CUSTOM_FIELD_INVALID');
    const submitted = await call(
      'emp_njl_3',
      'POST',
      `/adjustments/${id}/submit`,
      { customFields: { [project.key]: 'mo-24032' } },
    );
    expect(submitted.status).toBe(200);
    expect(submitted.json.data.status).toBe('pending');
    expect(submitted.json.data.customFields).toEqual({
      [project.key]: 'mo-24032',
    });
  });
});

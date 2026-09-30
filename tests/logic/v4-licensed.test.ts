// @vitest-environment node

// V4-14 行业方案 · 持证上岗: server checks for the industry pack — its settings and audit trail, permissions obtainable
// only through a certification (the authorization plugin's assignment check), the certification subject's membership
// (holding statuses, employees still employed), session-level revocation, the two-step registration check of both
// demonstration pages, 排班资质校验 (save, swap approval, daily re-check with certified cover), 调岗资质检查 (job-event
// notice and the change checklist's 操作权限 item), the steward's scoped trace and the two audit exports. Each run
// boots the real standalone server on a throwaway SQLite database with migrations and seeds.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken, type DatabaseManager } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { notificationServiceToken } from '@nocobase/app-plugin-notification';

import { scopeForUser } from '../../server/providers/hr/authorize.ts';
import { qualificationChecks } from '../../server/providers/hr/licensed/qualification.ts';
import { addDays, newId, today } from '../../server/providers/hr/shared.ts';
import {
  demoBatchServiceToken,
  jobEventProcessorToken,
  licensedServicesToken,
  scheduleServiceToken,
} from '../../server/providers/hr/tokens.ts';
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
      )
        return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'v4-licensed-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v4-licensed-'));
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
  // The payroll demo pre-builds a locked month these checks do not need.
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
  // The boot-time protection and history baseline run in the background.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await licensed().start();
}, 240_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
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

async function raw(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extra };
  if (username) headers.cookie = await signIn(username);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = 'http://localhost';
  return server.fetch(
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent${url}`}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  );
}

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  const response = await raw(username, method, url, body, extra);
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

const db = (): DatabaseManager =>
  server.application.container.resolve(databaseManagerToken);
const licensed = () =>
  server.application.container.resolve(licensedServicesToken);
const authz = () => server.application.container.resolve(authorizationToken);

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
  return { authz: await scopeForUser(authz(), userId), userId };
}

async function notification(key: string): Promise<unknown> {
  return server.application.container
    .resolve(notificationServiceToken)
    .getByIdempotencyKey(`hr:${key}`);
}

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

function parse<T>(value: unknown, fallback: T): T {
  let current = value;
  for (let i = 0; i < 3 && typeof current === 'string'; i += 1)
    current = JSON.parse(current);
  return (current ?? fallback) as T;
}

async function settings(): Promise<Json> {
  const response = await call('hr01', 'GET', '/licensed/settings');
  expect(response.status).toBe(200);
  return response.json.data;
}

async function saveSettings(
  change: Json,
): Promise<{ status: number; json: Json }> {
  const current = await settings();
  return call('hr01', 'PUT', '/licensed/settings', {
    enabledRevision: current.enabledRevision,
    packRevision: current.packRevision,
    value: { ...current.value, ...change },
  });
}

const sign = (username: string) =>
  call(username, 'POST', '/api/demo/batch-record/sign-filling', {});

describe('设置 / 持证上岗', () => {
  it('shows the defaults to HR administrators only', async () => {
    const data = await settings();
    expect(data.value).toEqual({
      enabled: true,
      certificationOnlyPermissionSets: [
        'prod.cncOperator',
        'equip.forkliftOperator',
      ],
      scheduleCheckEnabled: true,
      transferCheckEnabled: true,
    });
    expect(
      data.permissionSets.find((s: Json) => s.key === 'root').protectedByOther,
    ).toBe(true);
    expect((await call('emp_njl_2', 'GET', '/licensed/settings')).status).toBe(
      403,
    );
    expect((await call('qa_audit', 'GET', '/licensed/settings')).status).toBe(
      403,
    );
    expect(
      (
        await call('qa_audit', 'PUT', '/licensed/settings', {
          enabledRevision: data.enabledRevision,
          packRevision: data.packRevision,
          value: data.value,
        })
      ).status,
    ).toBe(403);
  });

  it('refuses listing a set that is still assigned to something other than a certification', async () => {
    const response = await saveSettings({
      certificationOnlyPermissionSets: [
        'prod.cncOperator',
        'equip.forkliftOperator',
        'hr.practicalAssessor',
      ],
    });
    expect(response.json.code).toBe('CERTIFICATION_ONLY_HAS_OTHER_ASSIGNMENTS');
    expect(
      (await saveSettings({ certificationOnlyPermissionSets: ['root'] })).json
        .code,
    ).toBe('PERMISSION_SET_PROTECTED');
  });
});

describe('认证即权限', () => {
  it('refuses a registration without a certificate, on the page and the API', async () => {
    // 李敏 holds no CNC 岗位上岗证 before the step's acceptance data.
    expect(
      (await call('emp_njl_2', 'GET', '/api/demo/batch-record')).status,
    ).toBe(403);
    expect((await sign('emp_njl_2')).status).toBe(403);
    const mine = await call('emp_njl_2', 'GET', '/licensed/my-grants');
    expect(mine.status).toBe(200);
    expect(mine.json.data.items).toEqual([]);
  });

  it('prepares the step’s acceptance data once, for HR administrators only', async () => {
    expect(
      (await call('emp_njl_2', 'POST', '/licensed/demo/prepare', {})).status,
    ).toBe(403);
    const prepared = await call('hr01', 'POST', '/licensed/demo/prepare', {});
    expect(prepared.status).toBe(200);
    expect(prepared.json.data.created).toEqual(['李敏', '刘洋']);
    expect(prepared.json.data.shifts).toEqual([
      'shift-mc-early',
      'shift-mc-middle',
      'shift-mc-night',
    ]);
    const again = await call('hr01', 'POST', '/licensed/demo/prepare', {});
    expect(again.json.data).toEqual({ created: [], shifts: [] });
  });

  it('grants the machine start through the certificate and records its number', async () => {
    const started = await sign('emp_njl_2');
    expect(started.status).toBe(200);
    expect(started.json.data).toMatchObject({
      kind: 'machineStart',
      step: 'op20',
      machineNo: 'CK6150-05',
      certificateStatusAtSigning: 'valid',
    });
    expect(started.json.data.certificateNo).toMatch(/^CNC-OP-/u);
    const mine = await call('emp_njl_2', 'GET', '/licensed/my-grants');
    expect(mine.json.data.items).toEqual([
      expect.objectContaining({
        certificationId: 'cert-cnc',
        pages: ['demo.batchRecord'],
        permissionSets: ['设备开工登记'],
      }),
    ]);
  });

  it('refuses assigning a certification-only set to anything but a certification', async () => {
    const userId = await userIdOf('emp_njl_2');
    for (const subject of [
      { type: 'user', id: userId },
      { type: 'org.department', id: 'sz-mc' },
      { type: 'org.position', id: 'pos-cnc-operator' },
      { type: 'org.departmentHead', id: '*' },
    ])
      await expect(
        authz().permissionSets.assign({
          permissionSet: 'prod.cncOperator',
          subject,
        }),
      ).rejects.toMatchObject({ name: 'PermissionSetSubjectNotAllowedError' });
    // The plugin's endpoints call the same service, which answers PERMISSION_SET_SUBJECT_NOT_ALLOWED (403).
    // A certification subject is still accepted.
    const certification = await authz().permissionSets.assign({
      permissionSet: 'prod.cncOperator',
      subject: { type: 'hr.certification', id: 'cert-trainer' },
    });
    await authz().permissionSets.revoke(certification.id);
  });

  it('resolves membership on the server only: holding statuses of employed people', async () => {
    const userId = await userIdOf('emp_njl_1');
    const subjects = await authz().subjects.resolveFor({
      type: 'user',
      id: userId,
    });
    expect(subjects).toContainEqual({
      type: 'hr.certification',
      id: 'cert-cnc',
    });
    // A leaving employee's certificates grant nothing.
    await db()
      .query()
      .updateTable('employees')
      .set({ status: 'leave' })
      .where('id', '=', 'emp-wanglei')
      .execute();
    expect(
      await authz().subjects.resolveFor({ type: 'user', id: userId }),
    ).not.toContainEqual({ type: 'hr.certification', id: 'cert-cnc' });
    await db()
      .query()
      .updateTable('employees')
      .set({ status: 'active' })
      .where('id', '=', 'emp-wanglei')
      .execute();
    // A pending external certificate brings nothing.
    expect(
      await authz().subjects.resolveFor({
        type: 'user',
        id: await userIdOf('emp_njl_2'),
      }),
    ).not.toContainEqual({ type: 'hr.certification', id: 'cert-forklift' });
  });

  it('follows the certification subject’s assignments, and records each change', async () => {
    const assignment = (
      await authz().permissionSets.listAssignments('prod.cncOperator')
    ).find(
      (a) =>
        a.subject.type === 'hr.certification' && a.subject.id === 'cert-cnc',
    )!;
    await authz().permissionSets.revoke(assignment.id);
    expect((await sign('emp_njl_2')).status).toBe(403);
    await authz().permissionSets.assign({
      permissionSet: 'prod.cncOperator',
      subject: { type: 'hr.certification', id: 'cert-cnc' },
    });
    expect((await sign('emp_njl_2')).status).toBe(200);
    const history = await waitFor(async () => {
      const value = await licensed().settings.grantHistory();
      return value.entries.filter((e) => e.at).length >= 2 ? value : undefined;
    }, 'grant history');
    expect(
      history.entries
        .filter((e) => e.at && e.certificationId === 'cert-cnc')
        .map((e) => e.change),
    ).toEqual(['revoked', 'assigned']);
  });

  it('turns off with the switch, audited, and back on', async () => {
    expect((await saveSettings({ enabled: false })).status).toBe(200);
    expect((await sign('emp_njl_2')).status).toBe(403);
    const onShift = await call('mgr_cd', 'POST', '/schedules/validate', {
      cells: [
        {
          employeeId: 'emp-wumin',
          date: addDays(today(), 20),
          shiftId: 'shift-mc-early',
        },
      ],
    });
    expect(JSON.stringify(onShift.json.data?.checks ?? {})).not.toContain(
      'certificationMissing',
    );
    expect((await saveSettings({ enabled: true })).status).toBe(200);
    expect((await sign('emp_njl_2')).status).toBe(200);
    const history = (await settings()).history as Json[];
    expect(history.slice(0, 2).map((h) => [h.field, h.to])).toEqual([
      ['enabled', true],
      ['enabled', false],
    ]);
  });
});

describe('排班资质校验', () => {
  it('blocks a shift requiring a certificate the employee does not hold through its end', async () => {
    const day = addDays(today(), 20);
    const blocked = await call('mgr_cd', 'POST', '/schedules/save', {
      cells: [
        { employeeId: 'emp-wumin', date: day, shiftId: 'shift-mc-early' },
      ],
    });
    expect(blocked.json.code).toBe('SCHEDULE_BLOCKED');
    const checks = blocked.json.details.checks[`emp-wumin:${day}`] as Json[];
    expect(checks).toContainEqual(
      expect.objectContaining({
        rule: 'certificationMissing',
        level: 'block',
        certificationId: 'cert-cnc',
        params: expect.objectContaining({ certification: 'CNC 岗位上岗证' }),
      }),
    );
    const office = await call('mgr_cd', 'POST', '/schedules/save', {
      cells: [
        { employeeId: 'emp-wumin', date: day, shiftId: 'shift-office-day' },
      ],
      acknowledgeWarnings: true,
    });
    expect(office.status).toBe(200);
  });

  it('checks a swap before approval like a save', async () => {
    const schedules =
      server.application.container.resolve(scheduleServiceToken);
    const result = await db().transaction((connection) =>
      schedules.validateTrusted(connection, [
        {
          employeeId: 'emp-wumin',
          date: addDays(today(), 21),
          shiftId: 'shift-mc-early',
        },
      ]),
    );
    expect(result.hasBlock).toBe(true);
    expect(
      result.checks[`emp-wumin:${addDays(today(), 21)}`].map((c) => c.rule),
    ).toContain('certificationMissing');
  });

  it('counts a certificate through its expiry date only', () => {
    const input = {
      required: new Map([
        ['s1', [{ id: 'cert-cnc', title: 'CNC 岗位上岗证' }]],
      ]),
      holdings: [
        {
          employeeId: 'e1',
          certificationId: 'cert-cnc',
          certificateId: 'c1',
          certificateNo: 'N1',
          expiresAt: '2026-10-05',
        },
      ],
    };
    const end = (iso: string) => Date.parse(iso);
    expect(
      qualificationChecks(
        { employeeId: 'e1', shiftId: 's1' },
        end('2026-10-05T14:00:00+08:00'),
        input,
        'Asia/Shanghai',
      ),
    ).toEqual([]);
    expect(
      qualificationChecks(
        { employeeId: 'e1', shiftId: 's1' },
        end('2026-10-06T06:00:00+08:00'),
        input,
        'Asia/Shanghai',
      )[0],
    ).toMatchObject({
      rule: 'certificationMissing',
      message: 'CERTIFICATION_EXPIRES_BEFORE_SHIFT_END',
      params: { expiresAt: '2026-10-05' },
    });
    expect(
      qualificationChecks(
        { employeeId: 'e2', shiftId: 's1' },
        end('2026-10-05T14:00:00+08:00'),
        input,
        'Asia/Shanghai',
      )[0],
    ).toMatchObject({ message: 'CERTIFICATION_MISSING' });
  });

  it('marks 钱进’s shifts after his certificate expires, tells the scheduler once and suggests certified cover', async () => {
    expect(
      (await call('hr01', 'POST', '/org/maintenance/run', {})).status,
    ).toBe(200);
    const cells = await db()
      .query()
      .selectFrom('shiftSchedules')
      .select(['id', 'date', 'shiftId', 'checkResult', 'replacementSuggestion'])
      .where('employeeId', '=', 'emp-qianjin')
      .where('status', '=', 'published')
      .where('date', '>', addDays(today(), 5))
      .where('date', '<=', addDays(today(), 13))
      .execute();
    const blocked = cells.filter((cell) =>
      parse<Json[]>(cell.checkResult, []).some(
        (c) => c.rule === 'certificationMissing',
      ),
    );
    expect(blocked.length).toBeGreaterThan(0);
    // The schedule itself is not changed.
    expect(blocked.every((cell) => Boolean(cell.shiftId))).toBe(true);
    const first = blocked[0]!;
    const key = `qualificationConflict:${String(first.id)}:cert-cnc`;
    expect(await inboxBody(key)).toContain('钱进');
    const suggestion = await waitFor(async () => {
      const row = await db()
        .query()
        .selectFrom('shiftSchedules')
        .select(['replacementSuggestion'])
        .where('id', '=', String(first.id))
        .executeTakeFirst();
      const value = parse<Json | null>(row?.replacementSuggestion, null);
      return value?.candidates ? value : undefined;
    }, 'cover suggestion');
    const holders = new Set(
      (
        await db()
          .query()
          .selectFrom('employeeCertificates')
          .select(['employeeId'])
          .where('certificationId', '=', 'cert-cnc')
          .where('status', 'in', ['valid', 'expiring'])
          .execute()
      ).map((r) => String(r.employeeId)),
    );
    for (const candidate of suggestion.candidates as Json[])
      expect(holders.has(candidate.employeeId)).toBe(true);
    // A second run tells nobody again and suggests nothing new.
    const runs = async () =>
      (
        await db()
          .query()
          .selectFrom('aiTaskRuns')
          .select(['id'])
          .where('task', '=', 'hrAssistant.replacementSuggest')
          .where('status', '=', 'succeeded')
          .execute()
      ).length;
    const before = await runs();
    await call('hr01', 'POST', '/org/maintenance/run', {});
    expect(await runs()).toBe(before);
    expect(
      (
        await db()
          .query()
          .selectFrom('hrReminderLog')
          .select(['id'])
          .where('reminderKey', '=', key)
          .execute()
      ).length,
    ).toBe(1);
  });

  it('lists only certified people as cover for a shift requiring a certificate', async () => {
    const cells = await db()
      .query()
      .selectFrom('shiftSchedules')
      .select(['id', 'checkResult'])
      .where('employeeId', '=', 'emp-qianjin')
      .where('date', '>', addDays(today(), 5))
      .execute();
    const cell = cells.find((c) =>
      parse<Json[]>(c.checkResult, []).some(
        (x) => x.rule === 'certificationMissing',
      ),
    )!;
    const found = await call(
      'mgr_njl',
      'GET',
      `/schedules/${String(cell.id)}/candidates`,
    );
    expect(found.status).toBe(200);
    for (const candidate of found.json.data.candidates as Json[]) {
      expect(candidate.certificateExpiresAt).toBeDefined();
      expect(candidate.reasons[0]).toContain('CNC 岗位上岗证');
    }
  });
});

describe('生命周期与演示业务', () => {
  it('writes what an expiring certificate will stop, and what an expired one stopped', async () => {
    expect(
      await inboxBody('certificate:certificate-zhaoyang-cnc:expiring'),
    ).toContain('到期后将不能使用：设备开工登记');
    expect(
      await inboxBody('certificate:certificate-wumin-cnc:expired'),
    ).toContain('设备开工登记');
    expect((await sign('emp_th_1')).status).toBe(200);
    expect((await sign('emp_th_2')).status).toBe(403);
  });

  it('opens 叉车出库登记 only once HR verifies the forklift certificate, never by its holder', async () => {
    expect(
      (await call('emp_njl_2', 'GET', '/api/demo/forklift-dispatch')).status,
    ).toBe(403);
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
    expect(
      await inboxBody('certificate:certificate-limin-forklift:verified'),
    ).toContain('叉车出库登记');
    const view = await call('emp_njl_2', 'GET', '/api/demo/forklift-dispatch');
    expect(view.status).toBe(200);
    expect(view.json.data).toMatchObject({
      orderNo: 'CK-24031',
      canDispatch: true,
    });
    const dispatched = await call(
      'emp_njl_2',
      'POST',
      '/api/demo/forklift-dispatch/dispatch',
      {},
    );
    expect(dispatched.status).toBe(200);
    expect(dispatched.json.data).toMatchObject({
      kind: 'forkliftDispatch',
      machineNo: 'FL-03',
      certificateNo: 'EXT-FORKLIFT-LIMIN',
      certificateStatusAtSigning: 'valid',
    });
    // The machine start page does not open through the forklift certificate.
    expect((await sign('emp_njl_4')).status).toBe(200);
    expect(
      (await call('emp_njl_4', 'GET', '/api/demo/forklift-dispatch')).status,
    ).toBe(403);
  });
});

describe('调岗资质检查', () => {
  it('lists the CNC certificate after a move to 装配工, not the forklift certificate', async () => {
    const judgement = await licensed().transfer.judge(
      'emp-limin',
      'pos-cnc-operator',
      'pos-assembler',
    );
    expect(judgement?.certificates.map((c) => c.certificationId)).toEqual([
      'cert-cnc',
    ]);
    expect(judgement?.certificates[0]?.operations).toEqual(['设备开工登记']);
  });

  it('notifies hr01 and the new department’s head once per event, and not with the check off', async () => {
    const stamp = new Date();
    const eventId = newId();
    await db()
      .query()
      .insertInto('jobEvents')
      .values({
        id: eventId,
        employeeId: 'emp-limin',
        eventType: 'transfer',
        fromDepartmentId: 'sz-mc',
        toDepartmentId: 'sz-as',
        fromPositionId: 'pos-cnc-operator',
        toPositionId: 'pos-assembler',
        effectiveDate: today(),
        actionId: null,
        source: 'manual',
        note: null,
        processedAt: null,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    const processor = server.application.container.resolve(
      jobEventProcessorToken,
    );
    await processor.process([eventId]);
    const body = await waitFor(async () => {
      const text = await inboxBody(`licensed.transferCheck:${eventId}`);
      return text || undefined;
    }, 'transfer check notice');
    expect(body).toContain('CNC 岗位上岗证');
    expect(body).not.toContain('叉车');
    expect(body).not.toMatch(/CNC-OP-\d/u);
    const sent = (await notification(
      `licensed.transferCheck:${eventId}`,
    )) as Json;
    expect(sent).toBeTruthy();
    // The certificate itself did not change.
    expect((await sign('emp_njl_2')).status).toBe(200);
    expect((await licensed().runTransferCheck(eventId))?.status).toBe(
      'duplicate',
    );
    expect((await saveSettings({ transferCheckEnabled: false })).status).toBe(
      200,
    );
    expect(await licensed().runTransferCheck(eventId)).toBeUndefined();
    expect((await saveSettings({ transferCheckEnabled: true })).status).toBe(
      200,
    );
  });

  it('adds 操作权限 to the change checklist', async () => {
    const provider = licensed().transfer.checklistProvider();
    const employee = await db()
      .query()
      .selectFrom('employees')
      .select(['id', 'name', 'userId', 'departmentId', 'positionId', 'status'])
      .where('id', '=', 'emp-limin')
      .executeTakeFirst();
    const items = await provider.items({
      kind: 'change',
      stage: 'preview',
      effective: false,
      action: {
        id: 'a1',
        actionType: 'transfer',
        status: 'draft',
        employeeId: 'emp-limin',
        candidate: {},
        fromDepartmentId: 'sz-mc',
        fromPositionId: 'pos-cnc-operator',
        toDepartmentId: 'sz-as',
        toPositionId: 'pos-assembler',
        effectiveDate: today(),
      },
      event: null,
      employee: {
        id: 'emp-limin',
        name: String(employee!.name),
        userId: String(employee!.userId),
        departmentId: 'sz-mc',
        positionId: 'pos-cnc-operator',
        managerEmployeeId: null,
        externalUserId: null,
        status: 'active',
        customFields: {},
      },
    } as never);
    expect(items).toEqual([
      expect.objectContaining({
        code: 'licensedGrantsRetained',
        status: 'todo',
        params: expect.objectContaining({
          title: 'CNC 岗位上岗证',
          operations: '设备开工登记',
        }),
      }),
    ]);
  });
});

describe('认证管家与审计导出', () => {
  it('traces MO-24031 within the caller’s scope, in registration order', async () => {
    const demo = server.application.container.resolve(demoBatchServiceToken);
    const all = await demo.traceSignoffs(await ctxOf('hr01'), 'MO-24031', '20');
    const names = all.map((t) => t.employeeName);
    expect(names.slice(0, 3).sort()).toEqual(['吴敏', '赵阳', '钱进'].sort());
    const wu = all.find((t) => t.employeeName === '吴敏')!;
    expect(wu).toMatchObject({
      certificateStatusAtSigning: 'valid',
      certificateStatusNow: 'expired',
    });
    expect(wu.requiredCourses[0]?.title).toBe('CNC 岗位操作入门');
    const east = await demo.traceSignoffs(
      await ctxOf('mgr_east'),
      'MO-24031',
      '20',
    );
    expect(east.map((t) => t.employeeName)).not.toContain('吴敏');
    expect(east.map((t) => t.employeeName)).not.toContain('赵阳');
    expect(east.map((t) => t.employeeName)).toContain('钱进');
  });

  it('exports the start trace and permission changes for auditors, logged', async () => {
    const trace = await call(
      'qa_audit',
      'GET',
      '/licensed/audit/start-trace?workOrderNo=MO-24031&step=20',
    );
    expect(trace.status).toBe(200);
    expect((trace.json.data as Json[]).length).toBeGreaterThanOrEqual(3);
    const file = await raw(
      'qa_audit',
      'GET',
      '/licensed/audit/start-trace/file?workOrderNo=MO-24031',
    );
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toContain('spreadsheetml');
    const from = addDays(today(), -30);
    const to = addDays(today(), 1);
    const wu = await call(
      'qa_audit',
      'GET',
      `/licensed/audit/permission-changes?employeeId=emp-wumin&from=${from}&to=${to}`,
    );
    expect(wu.status).toBe(200);
    expect(wu.json.data).toContainEqual(
      expect.objectContaining({
        reason: 'expire',
        change: 'lost',
        permissionSets: ['设备开工登记'],
        link: '/talent/certifications/cert-cnc',
      }),
    );
    const li = await call(
      'qa_audit',
      'GET',
      `/licensed/audit/permission-changes?employeeId=emp-limin&from=${from}&to=${to}`,
    );
    expect(li.json.data).toContainEqual(
      expect.objectContaining({
        date: today(),
        reason: 'verify',
        change: 'gained',
        permissionSets: ['叉车出库登记'],
      }),
    );
    const changes = await raw(
      'qa_audit',
      'GET',
      `/licensed/audit/permission-changes/file?employeeId=emp-wumin&from=${from}&to=${to}`,
    );
    expect(changes.status).toBe(200);
    const logged = await db()
      .query()
      .selectFrom('auditExports')
      .select(['kind'])
      .where('actorUserId', '=', await userIdOf('qa_audit'))
      .execute();
    expect(logged.map((r) => String(r.kind))).toEqual(
      expect.arrayContaining(['startTrace', 'permissionChanges']),
    );
    expect(
      (
        await call(
          'emp_njl_2',
          'GET',
          `/licensed/audit/permission-changes?employeeId=emp-limin&from=${from}&to=${to}`,
        )
      ).status,
    ).toBe(403);
  });

  it('keeps 班次 · 要求的认证 to HR administrators', async () => {
    expect((await call('mgr_njl', 'GET', '/licensed/shifts')).status).toBe(403);
    const list = await call('hr01', 'GET', '/licensed/shifts');
    expect(list.status).toBe(200);
    expect(
      list.json.data.shifts.find((s: Json) => s.id === 'shift-mc-early')
        .requiredCertificationIds,
    ).toEqual(['cert-cnc']);
    const set = await call(
      'hr01',
      'PUT',
      '/licensed/shifts/shift-as-night/required-certifications',
      {
        certificationIds: ['cert-forklift'],
      },
    );
    expect(set.status).toBe(200);
    const blocked = await call('mgr_east', 'POST', '/schedules/validate', {
      cells: [
        {
          employeeId: 'emp-sunli',
          date: addDays(today(), 25),
          shiftId: 'shift-as-night',
        },
      ],
    });
    expect(JSON.stringify(blocked.json.data.checks)).toContain(
      'certificationMissing',
    );
    await call(
      'hr01',
      'PUT',
      '/licensed/shifts/shift-as-night/required-certifications',
      {
        certificationIds: [],
      },
    );
    const open = await call('mgr_east', 'POST', '/schedules/validate', {
      cells: [
        {
          employeeId: 'emp-sunli',
          date: addDays(today(), 25),
          shiftId: 'shift-as-night',
        },
      ],
    });
    expect(JSON.stringify(open.json.data.checks)).not.toContain(
      'certificationMissing',
    );
  });

  it('describes a certification’s grants by display name', async () => {
    const grants = await licensed().certificationGrants('cert-forklift');
    expect(grants.map((g) => g.pages.map((p) => p.title))).toEqual([
      ['叉车出库登记'],
    ]);
  });
});

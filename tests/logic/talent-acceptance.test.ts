// @vitest-environment node

// Acceptance checks for V1 of the talent platform (core HR, knowledge and learning, exams and certification). Each run boots the real standalone
// server on a throwaway SQLite database with migrations and seeds, so the demo database stays untouched.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken, type SeedContext } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import attendanceSettingsSeed from '../../database/main/seeds/202609290105_attendance_settings_permissions.ts';
import leaveManagementSeed from '../../database/main/seeds/202609290106_leave_management_permissions.ts';
import leavePageSeed from '../../database/main/seeds/202609290107_leave_page_permission.ts';
import attendancePageSeed from '../../database/main/seeds/202609290108_attendance_page_permission.ts';
import leaveRequestSeed from '../../database/main/seeds/202609290109_leave_request_permissions.ts';
import approvalPageSeed from '../../database/main/seeds/202609290110_approval_page_permission.ts';
import scheduleSeed from '../../database/main/seeds/202609290111_schedule_permissions.ts';
import { notificationServiceToken } from '@nocobase/app-plugin-notification';
import { hrCoreServiceToken } from '../../server/providers/hr/tokens.ts';
import { addDays, today } from '../../server/providers/hr/shared.ts';
import { createWorkItemStore } from '../../server/providers/hr/work-item-store.ts';
import { registerLeaveRequestAcceptance } from '../helpers/leave-request-acceptance.ts';
import { registerScheduleAcceptance } from '../helpers/schedule-acceptance.ts';
import { registerLeaveProofAcceptance } from '../helpers/leave-proof-acceptance.ts';

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

async function startAcceptanceServer() {
  if (server) return;
  directory = mkdtempSync(path.join(tmpdir(), 'hr-talent-acceptance-'));
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
  // These suites build their own attendance fixtures; the V2-05 demo catalog is tested in v2-attendance.
  process.env.HR_ATTENDANCE_DEMO = 'false';
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
}

beforeAll(startAcceptanceServer, 180_000);

describe('V2-05 leave management', () => {
  const annualType = {
    code: 'acceptance-annual',
    title: 'Annual leave',
    payType: 'paid',
    unit: 'day',
    balanceRule: 'annualBySeniority',
    fixedDays: null,
    requiresAttachment: false,
    countBy: 'schedule',
    active: true,
  };
  let annual: Json;
  let balance: Json;
  const employeeIds = [
    'leave-test-senior',
    'leave-test-regular',
    'leave-test-new',
    'leave-test-pending',
    'leave-test-left',
  ];
  it('rejects anonymous, manager, employee and page-only access', async () => {
    const authz = server.application.container.resolve(authorizationToken);
    const user = await call('emp_njl_2', 'GET', '/api/auth/get-session');
    await authz.permissionSets.create({
      key: 'test-leave-page-only',
      title: 'Test leave page',
      grants: [
        {
          resource: { type: 'page', id: 'talent.leave' },
          actions: [{ action: 'access' }],
        },
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: 'test-leave-page-only',
      subject: { type: 'user', id: String(user.json.user.id) },
    });
    for (const username of [null, 'mgr_njl', 'emp_njl_1', 'emp_njl_2']) {
      for (const [method, url, body] of [
        ['GET', '/leave/types', undefined],
        ['GET', '/leave/types/hidden', undefined],
        ['POST', '/leave/types', { value: annualType }],
        ['PATCH', '/leave/types/hidden', {}],
        ['GET', '/leave/balances?year=2026', undefined],
        ['GET', '/leave/balances/hidden', undefined],
        ['POST', '/leave/balances/initialize', {}],
        ['POST', '/leave/balances/hidden/adjust', {}],
      ] as const)
        expect((await call(username, method, url, body)).status).toBe(
          username ? 403 : 401,
        );
    }
  });
  it('creates and updates types with strict validation and version checks', async () => {
    const created = await call('hr01', 'POST', '/leave/types', {
      value: annualType,
    });
    expect(created.status).toBe(201);
    annual = created.json.data;
    expect(
      (await call('hr01', 'GET', `/leave/types/${annual.id}`)).json.data,
    ).toEqual(annual);
    expect((await call('hr01', 'GET', '/leave/types/not-found')).status).toBe(
      404,
    );
    expect(
      (await call('hr01', 'POST', '/leave/types', { value: annualType }))
        .status,
    ).toBe(409);
    expect(
      (
        await call('hr01', 'POST', '/leave/types', {
          value: {
            ...annualType,
            code: 'bad-fixed',
            balanceRule: 'fixedPerEvent',
          },
        })
      ).status,
    ).toBe(400);
    const edited = await call('hr01', 'PATCH', `/leave/types/${annual.id}`, {
      value: { ...annualType, title: 'Annual leave revised' },
      expectedUpdatedAt: annual.updatedAt,
    });
    expect(edited.status).toBe(200);
    expect(
      (
        await call('hr01', 'PATCH', `/leave/types/${annual.id}`, {
          value: annualType,
          expectedUpdatedAt: annual.updatedAt,
        })
      ).status,
    ).toBe(409);
    annual = edited.json.data;
    for (const [code, balanceRule, fixedDays] of [
      ['earned', 'earned', null],
      ['event', 'fixedPerEvent', 3],
      ['unlimited', 'none', null],
    ] as const) {
      expect(
        (
          await call('hr01', 'POST', '/leave/types', {
            value: {
              ...annualType,
              code: `acceptance-${code}`,
              balanceRule,
              fixedDays,
            },
          })
        ).status,
      ).toBe(201);
    }
  });
  it('initializes the document examples as 10, 5 and 2 days, skips inactive staff and does not duplicate', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const stamp = new Date();
    for (const [index, id] of employeeIds.entries()) {
      await db.repository('employees').createOne({
        values: {
          id,
          employeeNo: id,
          name: id,
          departmentId: 'dept-machining',
          status: index === 3 ? 'pending' : index === 4 ? 'leave' : 'active',
          hireDate: index === 2 ? '2026-07-01' : '2022-01-01',
          careerStartDate: [
            '2014-01-01',
            '2021-01-01',
            '2023-01-01',
            '2020-01-01',
            '2020-01-01',
          ][index],
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
    }
    const initialize = { year: 2026, asOf: '2026-09-28', employeeIds };
    const first = await call(
      'hr01',
      'POST',
      '/leave/balances/initialize',
      initialize,
    );
    expect(first.status).toBe(200);
    expect(first.json.data.created).toHaveLength(6);
    expect(first.json.data.skippedEmployeeIds.sort()).toEqual(
      employeeIds.slice(3).sort(),
    );
    const read = await call('hr01', 'GET', '/leave/balances?year=2026');
    expect(read.status).toBe(200);
    const annualRows = read.json.data.filter(
      (row: Json) => row.leaveTypeId === annual.id,
    );
    expect(
      employeeIds
        .slice(0, 3)
        .map(
          (id) =>
            annualRows.find((row: Json) => row.employeeId === id)?.entitled,
        ),
    ).toEqual([10, 5, 2]);
    balance = annualRows.find((row: Json) => row.employeeId === employeeIds[0]);
    expect(
      (await call('hr01', 'GET', `/leave/balances/${balance.id}`)).json.data,
    ).toEqual(balance);
    expect(
      (await call('hr01', 'POST', '/leave/balances/initialize', initialize))
        .json.data.created,
    ).toEqual([]);
    expect(
      (
        await call('hr01', 'PATCH', `/leave/types/${annual.id}`, {
          value: { ...annualType, countBy: 'calendar' },
          expectedUpdatedAt: annual.updatedAt,
        })
      ).json.code,
    ).toBe('LEAVE_TYPE_IN_USE');
    expect(
      (
        await call(
          'hr01',
          'GET',
          `/leave/balances?year=2026&employeeId=${employeeIds[0]}`,
        )
      ).json.data,
    ).toHaveLength(2);
    expect(
      (
        await call('hr01', 'POST', '/leave/balances/initialize', {
          ...initialize,
          employeeIds: ['not-found'],
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call('hr01', 'POST', '/leave/balances/initialize', {
          ...initialize,
          asOf: '2200-01-01',
          year: 2200,
        })
      ).json.code,
    ).toBe('FUTURE_INITIALIZATION');
  });
  it('requires reasons, rejects stale versions and deduplicates audited adjustments', async () => {
    const url = `/leave/balances/${balance.id}/adjust`;
    const input = {
      idempotencyKey: 'acceptance-adjust-1',
      expectedUpdatedAt: balance.updatedAt,
      delta: 0.5,
      reason: 'Verified opening allowance',
    };
    expect(
      (await call('hr01', 'POST', url, { ...input, reason: ' ' })).status,
    ).toBe(400);
    expect(
      (await call('hr01', 'POST', url, { ...input, used: 0 })).status,
    ).toBe(400);
    const result = await call('hr01', 'POST', url, input);
    expect(result.status).toBe(200);
    expect(result.json.data.available).toBe(10.5);
    expect(result.json.data.adjustments).toHaveLength(1);
    expect(result.json.data.adjustments[0]).toMatchObject({
      delta: 0.5,
      reason: input.reason,
      idempotencyKey: input.idempotencyKey,
    });
    expect((await call('hr01', 'POST', url, input)).json.data.replayed).toBe(
      true,
    );
    expect(
      (await call('hr01', 'POST', url, { ...input, delta: 1 })).json.code,
    ).toBe('IDEMPOTENCY_CONFLICT');
    expect(
      (
        await call('hr01', 'POST', url, {
          ...input,
          idempotencyKey: 'acceptance-adjust-stale',
        })
      ).status,
    ).toBe(409);
    balance = result.json.data;
    const before = balance.adjustments;
    expect(
      (
        await call('hr01', 'POST', url, {
          ...input,
          idempotencyKey: 'acceptance-adjust-negative',
          expectedUpdatedAt: balance.updatedAt,
          delta: -11,
        })
      ).json.code,
    ).toBe('INSUFFICIENT_LEAVE_BALANCE');
    const rows = await call(
      'hr01',
      'GET',
      `/leave/balances?year=2026&employeeId=${employeeIds[0]}`,
    );
    expect(
      rows.json.data.find((row: Json) => row.id === balance.id).adjustments,
    ).toEqual(before);
  });
  it('serializes competing adjustments and preserves used, pending and carry on repeat initialization', async () => {
    const results = await Promise.all(
      [1, 2].map((n) =>
        call('hr01', 'POST', `/leave/balances/${balance.id}/adjust`, {
          idempotencyKey: `acceptance-concurrent-${n}`,
          expectedUpdatedAt: balance.updatedAt,
          delta: n,
          reason: 'Concurrency check',
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const db = server.application.container.resolve(databaseManagerToken);
    await db.repository('leaveBalances').updateOne({
      filter: { id: balance.id },
      values: { used: 2, pending: 1, carriedOver: 1 },
    });
    const before = await db
      .repository('leaveBalances')
      .findOne({ filter: { id: balance.id } });
    expect(
      (
        await call('hr01', 'POST', '/leave/balances/initialize', {
          year: 2026,
          asOf: '2026-09-28',
          employeeIds,
        })
      ).json.data.created,
    ).toEqual([]);
    expect(
      await db
        .repository('leaveBalances')
        .findOne({ filter: { id: balance.id } }),
    ).toEqual(before);
    await db.repository('employees').updateOne({
      filter: { id: employeeIds[0] },
      values: { status: 'leave' },
    });
    expect(
      (
        await call('hr01', 'POST', `/leave/balances/${balance.id}/adjust`, {
          idempotencyKey: 'acceptance-frozen',
          expectedUpdatedAt: before!.updatedAt,
          delta: 1,
          reason: 'Not permitted after offboarding',
        })
      ).json.code,
    ).toBe('BALANCE_FROZEN');
  });
  it('rolls an invalid initialization back and reports missing career dates', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    // A separate year keeps these fixtures independent of already initialized rows.
    await db.repository('employees').updateOne({
      filter: { id: employeeIds[2] },
      values: { hireDate: '2022-01-01', careerStartDate: '2023-01-01' },
    });
    const result = await call('hr01', 'POST', '/leave/balances/initialize', {
      year: 2025,
      asOf: '2025-12-31',
      employeeIds: employeeIds.slice(1, 3),
    });
    expect(result.json.code).toBe('INVALID_EMPLOYEE_DATES');
    expect(
      await db.repository('leaveBalances').count({ filter: { year: 2025 } }),
    ).toBe(0);
    await db.repository('employees').updateOne({
      filter: { id: employeeIds[2] },
      values: { careerStartDate: null },
    });
    const valid = await call('hr01', 'POST', '/leave/balances/initialize', {
      year: 2025,
      asOf: '2025-12-31',
      employeeIds: [employeeIds[2]],
    });
    expect(valid.status).toBe(200);
    expect(valid.json.data.needsCareerStartDate).toEqual([employeeIds[2]]);
  });
  it('allows HR to complete career dates and rejects impossible or unauthorized edits', async () => {
    const path = `/employees/${employeeIds[2]}`;
    expect(
      (await call('mgr_njl', 'PATCH', path, { careerStartDate: '2020-01-01' }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('emp_njl_1', 'PATCH', path, {
          careerStartDate: '2020-01-01',
        })
      ).status,
    ).toBe(403);
    expect(
      (await call('hr01', 'PATCH', path, { careerStartDate: '2023-01-01' }))
        .json.code,
    ).toBe('EMPLOYEE_CAREER_DATE_INVALID');
    const saved = await call('hr01', 'PATCH', path, {
      careerStartDate: '2020-01-01',
    });
    expect(saved.status).toBe(200);
    const db = server.application.container.resolve(databaseManagerToken);
    expect(
      (
        await db
          .repository('employees')
          .findOne({ filter: { id: employeeIds[2] } })
      )?.careerStartDate,
    ).toBe('2020-01-01');
    const balances = await call(
      'hr01',
      'GET',
      `/leave/balances?year=2025&employeeId=${employeeIds[2]}`,
    );
    expect(
      balances.json.data.every(
        (row: Json) => row.needsCareerStartDate === false,
      ),
    ).toBe(true);
    // Completing the date does not silently overwrite already initialized entitlement.
    expect(
      balances.json.data.find((row: Json) => row.leaveTypeId === annual.id)
        ?.entitled,
    ).toBe(5);
  });
  it('leaves existing permission choices and timestamps unchanged on repeat seed runs', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const read = () =>
      db
        .query()
        .selectFrom('authorizationPermissionSets')
        .select(['grants', 'updatedAt'])
        .where('key', '=', 'hr.admin')
        .executeTakeFirst();
    const before = await read();
    await db.transaction(async (connection) => {
      await leaveManagementSeed.run({ query: connection.query } as SeedContext);
      await leaveManagementSeed.run({ query: connection.query } as SeedContext);
      await leavePageSeed.run({ query: connection.query } as SeedContext);
      await leavePageSeed.run({ query: connection.query } as SeedContext);
      for (const seed of [leaveRequestSeed, approvalPageSeed, scheduleSeed]) {
        await seed.run({ query: connection.query } as SeedContext);
        await seed.run({ query: connection.query } as SeedContext);
      }
    });
    expect(await read()).toEqual(before);
  });
});

describe('V2-05 attendance settings', () => {
  it('protects per-card and latest-record reads and preserves the new HR page grant on repeated seeds', async () => {
    for (const path of [
      '/attendance-settings/config/calendar',
      '/attendance-settings/shifts/missing',
      '/attendance-settings/rules/missing',
    ]) {
      expect((await call(null, 'GET', path)).status).toBe(401);
      for (const user of ['mgr_east', 'emp_njl_1'])
        expect((await call(user, 'GET', path)).status).toBe(403);
    }
    expect(
      (await call('hr01', 'GET', '/attendance-settings/shifts/missing')).status,
    ).toBe(404);
    expect(
      (await call('hr01', 'GET', '/attendance-settings/config/not-supported'))
        .status,
    ).toBe(400);
    const all = await call('hr01', 'GET', '/attendance-settings');
    expect(
      (await call('hr01', 'GET', '/attendance-settings/config/calendar')).json
        .data,
    ).toEqual(all.json.data.config.calendar);
    const db = server.application.container.resolve(databaseManagerToken);
    const read = () =>
      db
        .query()
        .selectFrom('authorizationPermissionSets')
        .select(['grants', 'updatedAt'])
        .where('key', '=', 'hr.admin')
        .executeTakeFirst();
    const before = await read();
    expect(JSON.stringify(before?.grants)).toContain(
      'talent.attendanceSettings',
    );
    await db.transaction(async (connection) => {
      await attendancePageSeed.run({ query: connection.query } as SeedContext);
      await attendancePageSeed.run({ query: connection.query } as SeedContext);
    });
    expect(await read()).toEqual(before);
  });
  it('commits only one of two concurrent first saves and keeps the other card unchanged', async () => {
    const original = await call('hr01', 'GET', '/attendance-settings');
    const annual = original.json.data.config.annualLeave;
    const responses = await Promise.all(
      [10, 12].map((days) =>
        call('hr01', 'PATCH', '/attendance-settings/config/annualLeave', {
          revision: annual.revision,
          value: { bands: [{ minimumYears: 1, days }] },
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const readback = await call('hr01', 'GET', '/attendance-settings');
    expect(readback.json.data.config.annualLeave).toEqual(
      responses.find((response) => response.status === 200)!.json.data,
    );
    expect(readback.json.data.config.calendar).toEqual(
      original.json.data.config.calendar,
    );
  });
  it('preserves settings and permission grants on repeated initialization', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const before = await db
      .query()
      .selectFrom('authorizationPermissionSets')
      .select(['grants', 'updatedAt'])
      .where('key', '=', 'hr.admin')
      .executeTakeFirst();
    const lock = await db
      .repository('personnelSettings')
      .findOne({ filter: { id: 'attendance.catalog' } });
    await db.transaction(async (connection) => {
      // Only the seed's documented data dependencies are supplied; no mock database.
      await attendanceSettingsSeed.run({
        query: connection.query,
        repository: connection.repository.bind(connection),
      } as SeedContext);
      await attendanceSettingsSeed.run({
        query: connection.query,
        repository: connection.repository.bind(connection),
      } as SeedContext);
    });
    expect(
      await db
        .query()
        .selectFrom('authorizationPermissionSets')
        .select(['grants', 'updatedAt'])
        .where('key', '=', 'hr.admin')
        .executeTakeFirst(),
    ).toEqual(before);
    expect(
      await db
        .repository('personnelSettings')
        .findOne({ filter: { id: 'attendance.catalog' } }),
    ).toEqual(lock);
  });
  it('a page-only grant cannot access or mutate the settings API', async () => {
    const authz = server.application.container.resolve(authorizationToken);
    const user = await call('emp_njl_2', 'GET', '/api/auth/get-session');
    await authz.permissionSets.create({
      key: 'test-attendance-page-only',
      title: 'Test page only',
      grants: [
        {
          resource: { type: 'page', id: 'talent.attendanceSettings' },
          actions: [{ action: 'access' }],
        },
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: 'test-attendance-page-only',
      subject: { type: 'user', id: String(user.json.user.id) },
    });
    expect(
      (await call('emp_njl_2', 'GET', '/attendance-settings')).status,
    ).toBe(403);
    expect(
      (await call('emp_njl_2', 'GET', '/attendance-settings/config/limits'))
        .status,
    ).toBe(403);
    expect(
      (await call('emp_njl_2', 'GET', '/attendance-settings/shifts/hidden'))
        .status,
    ).toBe(403);
    expect(
      (await call('emp_njl_2', 'POST', '/attendance-settings/rules', {}))
        .status,
    ).toBe(403);
  });
  it('creates and edits catalog data, protects referenced shifts and rejects overlapping department rules', async () => {
    const url = '/attendance-settings';
    const db = server.application.container.resolve(databaseManagerToken);
    const employee = await db
      .repository('employees')
      .findOne({ filter: { id: 'emp-wanglei' } });
    const departmentId = String(employee!.departmentId);
    const shift = {
      code: 'test-night',
      title: 'Test night',
      startTime: '22:00',
      endTime: '06:00',
      isNight: true,
      departmentIds: [departmentId],
    };
    expect(
      (await call('mgr_east', 'POST', `${url}/shifts`, { value: shift }))
        .status,
    ).toBe(403);
    expect(
      (
        await call('hr01', 'POST', `${url}/shifts`, {
          value: { ...shift, breakMinutes: 480 },
        })
      ).status,
    ).toBe(400);
    const created = await call('hr01', 'POST', `${url}/shifts`, {
      value: shift,
    });
    expect(created.status).toBe(201);
    expect(
      (await call('hr01', 'POST', `${url}/shifts`, { value: shift })).status,
    ).toBe(409);
    const saved = await call(
      'hr01',
      'PATCH',
      `${url}/shifts/${created.json.data.id}`,
      {
        value: { ...shift, title: 'Updated night' },
        expectedUpdatedAt: created.json.data.updatedAt,
      },
    );
    expect(saved.status).toBe(200);
    expect(
      (await call('hr01', 'GET', `${url}/shifts/${created.json.data.id}`)).json
        .data,
    ).toEqual(saved.json.data);
    expect(
      (
        await call('hr01', 'PATCH', `${url}/shifts/${created.json.data.id}`, {
          value: shift,
          expectedUpdatedAt: created.json.data.updatedAt,
        })
      ).status,
    ).toBe(409);
    await db.repository('shiftSchedules').createOne({
      values: {
        id: 'test-catalog-reference',
        employeeId: employee!.id,
        date: '2026-10-01',
        shiftId: created.json.data.id,
        status: 'draft',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    expect(
      (
        await call('hr01', 'PATCH', `${url}/shifts/${created.json.data.id}`, {
          value: shift,
          expectedUpdatedAt: saved.json.data.updatedAt,
        })
      ).status,
    ).toBe(409);
    const disabled = await call(
      'hr01',
      'PATCH',
      `${url}/shifts/${created.json.data.id}`,
      {
        value: { ...shift, title: 'Updated night', active: false },
        expectedUpdatedAt: saved.json.data.updatedAt,
      },
    );
    expect(disabled.status).toBe(200);
    const rule = {
      title: 'Workshop',
      departmentIds: [departmentId],
      workHourSystem: 'comprehensive',
      punchSource: 'device',
    };
    const initial = await call('hr01', 'POST', `${url}/rules`, { value: rule });
    expect(initial.status).toBe(201);
    expect(
      (await call('hr01', 'POST', `${url}/rules`, { value: rule })).status,
    ).toBe(409);
    const updated = await call(
      'hr01',
      'PATCH',
      `${url}/rules/${initial.json.data.id}`,
      {
        value: { ...rule, lateGraceMinutes: 15 },
        expectedUpdatedAt: initial.json.data.updatedAt,
      },
    );
    expect(updated.status).toBe(200);
    const readback = await call('hr01', 'GET', url);
    expect(
      readback.json.data.rules.data.find(
        (r: Json) => r.id === initial.json.data.id,
      ).lateGraceMinutes,
    ).toBe(15);
    const department = await db
      .repository('departments')
      .findOne({ filter: { id: departmentId } });
    const retiredIds = [
      departmentId,
      ...(department?.parentId ? [String(department.parentId)] : []),
    ];
    for (const retiredId of retiredIds) {
      const previousDepartment = await db
        .repository('departments')
        .findOne({ filter: { id: retiredId } });
      await db
        .repository('departments')
        .updateOne({ filter: { id: retiredId }, values: { active: false } });
      try {
        const latestShift = await call(
          'hr01',
          'GET',
          `${url}/shifts/${created.json.data.id}`,
        );
        const deactivateShift = await call(
          'hr01',
          'PATCH',
          `${url}/shifts/${created.json.data.id}`,
          {
            value: { ...shift, title: 'Updated night', active: false },
            expectedUpdatedAt: latestShift.json.data.updatedAt,
          },
        );
        expect(deactivateShift.status).toBe(200);
        const latestRule = await call(
          'hr01',
          'GET',
          `${url}/rules/${initial.json.data.id}`,
        );
        expect(
          (
            await call(
              'hr01',
              'PATCH',
              `${url}/rules/${initial.json.data.id}`,
              {
                value: { ...rule, lateGraceMinutes: 15, active: false },
                expectedUpdatedAt: latestRule.json.data.updatedAt,
              },
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await call(
              'hr01',
              'PATCH',
              `${url}/shifts/${created.json.data.id}`,
              {
                value: { ...shift, title: 'Updated night', active: true },
                expectedUpdatedAt: deactivateShift.json.data.updatedAt,
              },
            )
          ).status,
        ).toBe(400);
      } finally {
        await db.repository('departments').updateOne({
          filter: { id: retiredId },
          values: { active: previousDepartment!.active },
        });
      }
    }
  });
  it('enforces HR-only access, validates input, persists changes and rejects stale revisions', async () => {
    const url = '/attendance-settings';
    expect((await call(null, 'GET', url)).status).toBe(401);
    for (const user of ['mgr_east', 'emp_njl_1']) {
      expect((await call(user, 'GET', url)).status).toBe(403);
      expect(
        (await call(user, 'PATCH', `${url}/config/limits`, {})).status,
      ).toBe(403);
    }
    const original = await call('hr01', 'GET', url);
    expect(original.status).toBe(200);
    const { limits, annualLeave, calendar } = original.json.data.config;
    expect(limits).toEqual({
      revision: 0,
      value: {
        monthlyMissingPunchLimit: 3,
        monthlyConfirmationDays: 3,
        consecutiveMissingReminderDays: 2,
        overtimeReminderRatio: 0.8,
        leaveSecondLevelDays: 3,
      },
    });
    const invalid = await call('hr01', 'PATCH', `${url}/config/limits`, {
      revision: 0,
      value: { ...limits.value, overtimeReminderRatio: 80 },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.json.details.fields).toContain(
      'value.overtimeReminderRatio',
    );
    expect(
      (
        await call('hr01', 'PATCH', `${url}/config/reminders`, {
          revision: 0,
          value: {},
        })
      ).status,
    ).toBe(400);
    const change = {
      revision: 0,
      value: { ...limits.value, monthlyMissingPunchLimit: 4 },
    };
    const saved = await call('hr01', 'PATCH', `${url}/config/limits`, change);
    expect(saved.status).toBe(200);
    expect(saved.json.data.revision).toBe(1);
    expect(
      (await call('hr01', 'PATCH', `${url}/config/limits`, change)).status,
    ).toBe(409);
    const reloaded = await call('hr01', 'GET', url);
    expect(reloaded.json.data.config.limits).toEqual(saved.json.data);
    expect(reloaded.json.data.config.annualLeave).toEqual(annualLeave);
    expect(reloaded.json.data.config.calendar).toEqual(calendar);
    const persisted = await server.application.container
      .resolve(databaseManagerToken)
      .repository('personnelSettings')
      .findOne({ filter: { id: 'attendance.limits' } });
    expect(persisted?.value).toEqual(change.value);
    expect(persisted?.updatedBy).toBeTruthy();
  });
});

registerLeaveRequestAcceptance(() => server, call);
registerScheduleAcceptance(() => server, call);
registerLeaveProofAcceptance(
  () => server,
  call,
  async (username, method, url, body) => {
    const headers: Record<string, string> = {};
    if (username) headers.cookie = await signIn(username);
    if (method !== 'GET') headers.origin = 'http://localhost';
    const basePath = server.application.publicBasePath;
    const target = url.startsWith(`${basePath}/`)
      ? `http://localhost${url}`
      : `${base}${url}`;
    return server.fetch(new Request(target, { method, headers, body }));
  },
);

describe('work item producer foundation', () => {
  it('enforces recipient scope, rejects manual approval closure, and keeps completion idempotent', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const userId = async (username: string) => {
      const session = await call(username, 'GET', '/api/auth/get-session');
      expect(session.status).toBe(200);
      expect(session.json.user.id).toBeTruthy();
      return String(session.json.user.id);
    };
    const hr = await userId('hr01');
    const employee = await userId('emp_njl_1');
    const rows = await db.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      return Promise.all([
        store.put({
          recipientUserId: hr,
          type: 'testRule',
          refType: 'test',
          refId: 'hr',
          title: 'HR only',
          link: '/talent/me',
          sourceKind: 'rule',
        }),
        store.put({
          recipientUserId: employee,
          type: 'testRule',
          refType: 'test',
          refId: 'employee',
          title: 'Employee only',
          link: '/talent/me',
          sourceKind: 'rule',
        }),
        store.put({
          recipientUserId: employee,
          type: 'approval',
          refType: 'test',
          refId: 'approval',
          title: 'Approval',
          link: '/talent/me',
          sourceKind: 'approval',
        }),
      ]);
    });
    expect((await call(null, 'GET', '/work-items')).status).toBe(401);
    const list = await call('emp_njl_1', 'GET', '/work-items');
    expect(list.status).toBe(200);
    expect(list.json.data.items.map((row: Json) => row.title)).toContain(
      'Employee only',
    );
    expect(list.json.data.items.map((row: Json) => row.title)).not.toContain(
      'HR only',
    );
    expect(
      (await call('emp_njl_1', 'GET', `/work-items?recipientUserId=${hr}`))
        .status,
    ).toBe(400);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[0].id}/complete`))
        .status,
    ).toBe(404);
    expect(
      (await call('hr01', 'POST', `/work-items/${rows[1].id}/complete`)).status,
    ).toBe(404);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[2].id}/complete`))
        .status,
    ).toBe(409);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[2].id}/dismiss`))
        .status,
    ).toBe(409);
    const first = await call(
      'emp_njl_1',
      'POST',
      `/work-items/${rows[1].id}/complete`,
    );
    const second = await call(
      'emp_njl_1',
      'POST',
      `/work-items/${rows[1].id}/complete`,
    );
    expect(first.status).toBe(200);
    expect(second.json.data.doneAt).toBe(first.json.data.doneAt);
    expect(
      (await call('emp_njl_1', 'POST', `/work-items/${rows[1].id}/dismiss`))
        .status,
    ).toBe(409);
  });
  const item = {
    recipientUserId: 'work-item-test-recipient',
    type: 'approval',
    refType: 'personnelAction',
    refId: 'work-item-test-action',
    title: 'Review personnel action',
    link: '/talent/actions/work-item-test-action',
    sourceKind: 'approval' as const,
  };

  it('converges duplicate producers and never reopens a completed approval', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const first = await db.transaction((connection) =>
      createWorkItemStore(connection).put(item),
    );
    const second = await db.transaction((connection) =>
      createWorkItemStore(connection).put({ ...item, title: 'Updated title' }),
    );
    expect(second.id).toBe(first.id);
    expect(second.title).toBe('Updated title');
    expect(second.status).toBe('open');
    const identity = {
      recipientUserId: item.recipientUserId,
      type: item.type,
      refType: item.refType,
      refId: item.refId,
    };
    await db.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      await store.closeApproval(identity);
      await store.closeApproval(identity);
    });
    const closed = await db
      .repository('workItems')
      .findOne({ filter: identity });
    const replay = await db.transaction((connection) =>
      createWorkItemStore(connection).put(item),
    );
    expect(replay.status).toBe('done');
    expect(replay.doneAt).toEqual(closed?.doneAt);
    expect(await db.repository('workItems').count({ filter: identity })).toBe(
      1,
    );
    await expect(
      db
        .repository('workItems')
        .createOne({ values: { ...replay, id: 'duplicate-work-item' } }),
    ).rejects.toThrow();
  });

  it('keeps recipient keys separate and rolls back with the business transaction', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    await db.transaction((connection) =>
      createWorkItemStore(connection).put({
        ...item,
        recipientUserId: 'another-recipient',
      }),
    );
    expect(
      await db.repository('workItems').count({ filter: { refId: item.refId } }),
    ).toBe(2);
    await expect(
      db.transaction(async (connection) => {
        await createWorkItemStore(connection).put({
          ...item,
          refId: 'rolled-back-item',
        });
        throw new Error('Business operation failed');
      }),
    ).rejects.toThrow('Business operation failed');
    expect(
      await db
        .repository('workItems')
        .exists({ filter: { refId: 'rolled-back-item' } }),
    ).toBe(false);
  });

  it('rejects unsafe links and incomplete AI attribution before persisting', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    for (const link of [
      'https://example.com',
      '//example.com',
      '/main/talent/me',
      '/talent/../settings',
      '/talent/%2e%2e/settings',
      '/talent/\\\\example.com',
    ]) {
      await expect(
        db.transaction((connection) =>
          createWorkItemStore(connection).put({ ...item, link }),
        ),
      ).rejects.toThrow('INVALID_WORK_ITEM');
    }
    await expect(
      db.transaction((connection) =>
        createWorkItemStore(connection).put({ ...item, sourceKind: 'ai' }),
      ),
    ).rejects.toThrow('INVALID_WORK_ITEM');
    const rule = { ...item, type: 'docReview', sourceKind: 'rule' as const };
    await db.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      await store.put(rule);
      await store.closeApproval({
        recipientUserId: rule.recipientUserId,
        type: rule.type,
        refType: rule.refType,
        refId: rule.refId,
      });
    });
    expect(
      (
        await db
          .repository('workItems')
          .findOne({ filter: { type: 'docReview', refId: item.refId } })
      )?.status,
    ).toBe('open');
  });
});

describe('contract reminder windows', () => {
  it('counts scoped job events rather than profile dates and rejects invalid report ranges', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const url = '/hr-reports?from=2001-01-01&to=2001-01-20';
    expect((await call(null, 'GET', url)).status).toBe(401);
    expect((await call('emp_njl_1', 'GET', url)).status).toBe(403);
    const before = await call('hr01', 'GET', url);
    const managerBefore = await call('mgr_east', 'GET', url);
    const eventIds: string[] = [];
    try {
      for (const [index, employeeId, eventType, effectiveDate] of [
        [0, 'emp-limin', 'onboard', '2001-01-01'],
        [1, 'emp-limin', 'onboard', '2001-01-02'],
        [2, 'emp-limin', 'offboard', '2001-01-20'],
        [3, 'emp-zhaoyang', 'onboard', '2001-01-10'],
        [4, 'emp-wanglei', 'onboard', '2001-01-21'],
        [5, 'emp-wanglei', 'transfer', '2001-01-10'],
      ] as const) {
        const id = `report-event-test-${index}`;
        await db.repository('jobEvents').createOne({
          values: {
            id,
            employeeId,
            eventType,
            effectiveDate,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        eventIds.push(id);
      }
      const report = await call('hr01', 'GET', url);
      expect(report.status).toBe(200);
      expect(report.json.data.joined).toBe(before.json.data.joined + 2);
      expect(report.json.data.left).toBe(before.json.data.left + 1);
      expect(report.json.data.monthly.at(-1)).toEqual({
        month: '2001-01',
        joined: 2,
        left: 1,
      });
      const manager = await call('mgr_east', 'GET', url);
      expect(manager.status).toBe(200);
      expect(manager.json.data.joined).toBe(managerBefore.json.data.joined + 1);
      const empty = await call(
        'hr01',
        'GET',
        `${url}&departmentId=missing-department`,
      );
      expect(empty.json.data.joined).toBe(0);
      expect(empty.json.data.left).toBe(0);
      for (const range of [
        'from=2001-02-30',
        'to=not-a-date',
        'from=2001-02-01&to=2001-01-01',
      ])
        expect((await call('hr01', 'GET', `/hr-reports?${range}`)).status).toBe(
          400,
        );
    } finally {
      for (const id of eventIds)
        await db.repository('jobEvents').deleteOne({ filter: { id } });
    }
  });
  it('uses saved windows for contract filters and report reminders, including boundaries', async () => {
    const db = server.application.container.resolve(databaseManagerToken);
    const original = await call('hr01', 'GET', '/personnel-settings');
    const employee = await db
      .repository('employees')
      .findOne({ filter: { id: 'emp-sunli' } });
    const contract = await db
      .repository('employmentContracts')
      .findOne({ filter: { id: 'contract-limin' } });
    expect(employee).toBeTruthy();
    expect(contract).toBeTruthy();
    let revision = original.json.data.reminders.revision;
    const date = today();
    try {
      const saved = await call(
        'hr01',
        'PATCH',
        '/personnel-settings/reminders',
        {
          revision,
          value: { probationDays: 20, contractDays: [30, 90] },
        },
      );
      expect(saved.status).toBe(200);
      revision = saved.json.data.revision;
      for (const [probationDays, contractDays, included] of [
        [20, 90, true],
        [21, 91, false],
        [-1, -1, false],
        [0, 0, true],
      ] as const) {
        await db.repository('employees').updateOne({
          filter: { id: 'emp-sunli' },
          values: {
            status: 'probation',
            probationEndDate: addDays(date, probationDays),
          },
        });
        await db.repository('employmentContracts').updateOne({
          filter: { id: 'contract-limin' },
          values: { status: 'active', endDate: addDays(date, contractDays) },
        });
        const list = await call('hr01', 'GET', '/contracts?quick=expiring');
        expect(list.status).toBe(200);
        expect(list.json.data.reminderDays).toBe(90);
        expect(
          list.json.data.items.some(
            (item: Json) => item.id === 'contract-limin',
          ),
        ).toBe(included);
        const report = await call('hr01', 'GET', '/hr-reports');
        expect(report.status).toBe(200);
        expect(report.json.data.reminderDays).toEqual({
          probation: 20,
          contract: 90,
        });
        expect(
          report.json.data.probationEnding.some(
            (item: Json) => item.employeeId === 'emp-sunli',
          ),
        ).toBe(included);
        expect(
          report.json.data.contractsEnding.some(
            (item: Json) => item.contractId === 'contract-limin',
          ),
        ).toBe(included);
      }
    } finally {
      await db.repository('employees').updateOne({
        filter: { id: 'emp-sunli' },
        values: {
          status: employee!.status,
          probationEndDate: employee!.probationEndDate,
        },
      });
      await db.repository('employmentContracts').updateOne({
        filter: { id: 'contract-limin' },
        values: { status: contract!.status, endDate: contract!.endDate },
      });
      expect(
        (
          await call('hr01', 'PATCH', '/personnel-settings/reminders', {
            revision,
            value: original.json.data.reminders.value,
          })
        ).status,
      ).toBe(200);
    }
  });
  it('restricts settings to HR and applies saved reminder windows immediately', async () => {
    expect((await call(null, 'GET', '/personnel-settings')).status).toBe(401);
    expect((await call('mgr_east', 'GET', '/personnel-settings')).status).toBe(
      403,
    );
    const original = await call('hr01', 'GET', '/personnel-settings');
    expect(original.status).toBe(200);
    const revision = original.json.data.reminders.revision;
    const change = {
      revision,
      value: { probationDays: 20, contractDays: [90, 30] },
    };
    expect(
      (await call('mgr_east', 'PATCH', '/personnel-settings/reminders', change))
        .status,
    ).toBe(403);
    expect(
      (
        await call('hr01', 'PATCH', '/personnel-settings/reminders', {
          revision,
          value: { probationDays: -1, contractDays: [30, 30] },
        })
      ).status,
    ).toBe(400);
    const saved = await call(
      'hr01',
      'PATCH',
      '/personnel-settings/reminders',
      change,
    );
    expect(saved.status).toBe(200);
    expect(
      (await call('hr01', 'PATCH', '/personnel-settings/reminders', change))
        .status,
    ).toBe(409);
    const container = server.application.container;
    const db = container.resolve(databaseManagerToken);
    const date = today();
    await db.repository('employmentContracts').updateOne({
      filter: { id: 'contract-limin' },
      values: { endDate: addDays(date, 80) },
    });
    await container.resolve(hrCoreServiceToken).runDaily({ asOf: date });
    expect(
      await container
        .resolve(notificationServiceToken)
        .getByIdempotencyKey('hr:contract:contract-limin:90'),
    ).toBeTruthy();
    const restore = await call(
      'hr01',
      'PATCH',
      '/personnel-settings/reminders',
      {
        revision: saved.json.data.revision,
        value: original.json.data.reminders.value,
      },
    );
    expect(restore.status).toBe(200);
  });
  it('submits only the nearest window and remains idempotent', async () => {
    const container = server.application.container;
    const db = container.resolve(databaseManagerToken);
    const core = container.resolve(hrCoreServiceToken);
    const notifications = container.resolve(notificationServiceToken);
    const asOf = today();
    await db.repository('employmentContracts').updateOne({
      filter: { id: 'contract-limin' },
      values: { endDate: addDays(asOf, 20) },
    });
    await core.runDaily({ asOf });
    const key = 'hr:contract:contract-limin:30';
    const first = await notifications.getByIdempotencyKey(key);
    expect(first).toBeTruthy();
    expect(
      await notifications.getByIdempotencyKey('hr:contract:contract-limin:60'),
    ).toBeFalsy();
    await core.runDaily({ asOf });
    expect(await notifications.getByIdempotencyKey(key)).toEqual(first);
    const logs = await db
      .query()
      .selectFrom('hrReminderLog')
      .select(['id'])
      .where('reminderKey', '=', 'contract:contract-limin:30')
      .execute();
    expect(logs).toHaveLength(1);
  });
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

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_ATTENDANCE_DEMO;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe('step 1: organization and talent framework', () => {
  it('rejects anonymous requests', async () => {
    expect((await call(null, 'GET', '/employees')).status).toBe(401);
  });

  it('scopes the employee list by role', async () => {
    const hr = await call('hr01', 'GET', '/employees');
    expect(hr.status).toBe(200);
    expect(hr.json.data.items.length).toBeGreaterThanOrEqual(7);

    const manager = await call('mgr_east', 'GET', '/employees');
    expect(manager.status).toBe(200);
    const ids = manager.json.data.items.map((e: Json) => e.id);
    expect(ids).toContain('emp-wanglei');
    expect(ids).not.toContain('emp-zhaoyang');

    expect((await call('emp_njl_1', 'GET', '/employees')).status).toBe(403);
  });

  it('hides out-of-scope records and sensitive fields', async () => {
    expect(
      (await call('mgr_east', 'GET', '/employees/emp-zhaoyang')).status,
    ).toBe(404);
    const manager = await call('mgr_east', 'GET', '/employees/emp-wanglei');
    expect(manager.status).toBe(200);
    expect(manager.json.data.employee.mobile).toBeUndefined();
    const hr = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(hr.json.data.employee.mobile).toBeTruthy();
  });

  it('computes competency gaps for an employee reading their own record', async () => {
    const gaps = await call('emp_njl_2', 'GET', '/employees/emp-limin/gaps');
    expect(gaps.status).toBe(200);
    const byTitle = Object.fromEntries(
      gaps.json.data.rows.map((r: Json) => [r.title, r.gap]),
    );
    // The later of her two assessments counts: CNC 设备操作 3 meets the requirement.
    expect(byTitle['CNC 设备操作']).toBe(0);
    // The training seed assesses her at 1 of 2 (the learning coach's gap) and 1 of 1 for the safety qualification.
    expect(byTitle['安全生产与 5S']).toBe(1);
    expect(byTitle['岗位安全上岗资格']).toBe(0);
    expect(
      (await call('emp_njl_2', 'GET', '/employees/emp-wanglei/gaps')).status,
    ).not.toBe(200);
  });

  it('enforces assessment scope and forbids self-assessment', async () => {
    const self = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-mgr-njl/assessments',
      { competencyId: 'comp-cnc', level: 3 },
    );
    expect(self.status).toBe(403);
    expect(self.json.code).toBe('ASSESSMENT_SELF');
    const outside = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-zhaoyang/assessments',
      { competencyId: 'comp-cnc', level: 3 },
    );
    expect(outside.status).toBe(404);
    const tooHigh = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-limin/assessments',
      { competencyId: 'comp-cnc', level: 9 },
    );
    expect(tooHigh.json.code).toBe('ASSESSMENT_LEVEL_INVALID');
    const ok = await call(
      'mgr_njl',
      'POST',
      '/employees/emp-limin/assessments',
      { competencyId: 'comp-quality-record', level: 2, evidence: 'acceptance' },
    );
    expect(ok.status).toBe(201);
  });

  it('protects framework integrity', async () => {
    const duplicate = await call(
      'hr01',
      'POST',
      '/framework/positions/pos-cnc-operator/requirements',
      { competencyId: 'comp-cnc', requiredLevel: 2, mandatory: true },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.code).toBe('REQUIREMENT_EXISTS');
    const lowered = await call('hr01', 'PATCH', '/competencies/comp-cnc', {
      code: 'cnc-operation',
      title: '灌装设备操作',
      category: 'skill',
      maxLevel: 2,
    });
    expect(lowered.status).toBe(409);
    expect(lowered.json.code).toBe('COMPETENCY_MAX_LEVEL_CONFLICT');
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          '/framework/positions/pos-cnc-operator/requirements',
          { competencyId: 'comp-team', requiredLevel: 1 },
        )
      ).status,
    ).toBe(403);
  });

  it('rejects department cycles and restricts department settings', async () => {
    const cycle = await call('hr01', 'PATCH', '/org/departments/sz', {
      parentId: 'sz-mc',
    });
    expect(cycle.status).toBe(400);
    expect(cycle.json.code).toBe('DEPARTMENT_CYCLE');
    expect((await call('emp_njl_1', 'GET', '/org/departments')).status).toBe(
      403,
    );
  });
});

describe('step 2: core HR', () => {
  it('runs the two-level transfer approval and applies it on the effective date', async () => {
    expect(
      (
        await call(
          'emp_njl_1',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).status,
    ).toBe(403);
    const noComment = await call(
      'mgr_east',
      'POST',
      '/actions/action-wanglei-transfer/reject',
      {},
    );
    expect(noComment.json.code).toBe('ACTION_REJECT_COMMENT_REQUIRED');
    // The HR administrator cannot skip the first level.
    expect(
      (
        await call(
          'hr01',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).json.code,
    ).toBe('ACTION_NOT_APPROVER');

    const first = await call(
      'mgr_east',
      'POST',
      '/actions/action-wanglei-transfer/approve',
      {},
    );
    expect(first.status).toBe(200);
    expect(first.json.data.status).toBe('pending');
    const second = await call(
      'hr01',
      'POST',
      '/actions/action-wanglei-transfer/approve',
      {},
    );
    expect(second.status).toBe(200);
    expect(second.json.data.status).toBe('effective');

    const employee = await call('hr01', 'GET', '/employees/emp-wanglei');
    expect(employee.json.data.employee.departmentId).toBe('sz-as');
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          '/actions/action-wanglei-transfer/approve',
          {},
        )
      ).json.code,
    ).toBe('ACTION_NOT_PENDING');
  });

  it('keeps one active contract per employee and chains renewals', async () => {
    const second = await call('hr01', 'POST', '/contracts', {
      employeeId: 'emp-limin',
      contractNo: 'HT-TEST-001',
      type: 'fixedTerm',
      startDate: '2026-01-01',
      endDate: '2027-12-31',
    });
    expect(second.status).toBe(409);
    expect(second.json.code).toBe('CONTRACT_ACTIVE_EXISTS');
    const renewed = await call(
      'hr01',
      'POST',
      '/contracts/contract-limin/renew',
      {
        contractNo: 'HT-TEST-002',
        type: 'fixedTerm',
        startDate: '2026-10-17',
        endDate: '2029-10-16',
      },
    );
    expect(renewed.status).toBe(201);
    expect(renewed.json.data.previousContractId).toBe('contract-limin');
    const list = await call('hr01', 'GET', '/contracts?employeeId=emp-limin');
    const statuses = Object.fromEntries(
      list.json.data.items.map((c: Json) => [c.id, c.status]),
    );
    expect(statuses['contract-limin']).toBe('renewed');
    expect(Object.values(statuses).filter((s) => s === 'active')).toHaveLength(
      1,
    );
    expect(
      (await call('mgr_east', 'POST', '/contracts/contract-wanglei/terminate'))
        .status,
    ).toBe(403);
  });

  it('accepts only whitelisted profile changes, one pending at a time', async () => {
    const forbidden = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { name: '改名' },
    });
    expect(forbidden.status).toBe(400);
    expect(forbidden.json.code).toBe('PROFILE_CHANGE_FIELD_NOT_ALLOWED');
    const pending = await call('emp_njl_1', 'POST', '/me/profile-change', {
      changes: { mobile: '13900000000' },
    });
    expect(pending.status).toBe(409);
    expect(pending.json.code).toBe('PROFILE_CHANGE_PENDING');

    const submitted = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { mobile: '13911112222' },
    });
    expect(submitted.status).toBe(201);
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          `/profile-changes/${submitted.json.data.id}/approve`,
          {},
        )
      ).status,
    ).toBe(403);
    const approved = await call(
      'hr01',
      'POST',
      `/profile-changes/${submitted.json.data.id}/approve`,
      {},
    );
    expect(approved.status).toBe(200);
    const employee = await call('hr01', 'GET', '/employees/emp-limin');
    expect(employee.json.data.employee.mobile).toBe('13911112222');
  });
});

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  label: string,
): Promise<T> {
  // Event automations run in the background after the request has answered.
  for (let i = 0; i < 50; i += 1) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function runsOf(task: string): Promise<Json[]> {
  const runs = await call('hr01', 'GET', `/automations/runs?task=${task}`);
  expect(runs.status).toBe(200);
  return runs.json.data as Json[];
}

describe('knowledge, exams and certification', () => {
  it('shows restricted documents only to the positions they name', async () => {
    const operator = await call('emp_njl_2', 'GET', '/kb/documents');
    expect(operator.status).toBe(200);
    const operatorIds = operator.json.data.items.map((d: Json) => d.id);
    expect(operatorIds).toContain('doc-wi-mc-0231');
    expect(operatorIds).not.toContain('doc-man-pr-0007');
    const head = await call('mgr_njl', 'GET', '/kb/documents');
    expect(head.json.data.items.map((d: Json) => d.id)).toContain(
      'doc-man-pr-0007',
    );
    expect((await call('emp_njl_2', 'GET', '/courses')).status).toBe(403);
  });

  it('lets only valid CNC certificate holders log a machine start', async () => {
    const sign = (username: string) =>
      call(username, 'POST', '/api/demo/batch-record/sign-filling', {});
    expect((await sign('emp_th_1')).status).toBe(200);
    // 王磊 holds a valid CNC 岗位上岗证 (V3-10 seed: issued five months ago).
    expect((await sign('emp_njl_1')).status).toBe(200);
    // 李敏 has no certificate yet: she cannot log a start, nor even see the work order.
    expect((await sign('emp_njl_2')).status).toBe(403);
    expect(
      (await call('emp_njl_2', 'GET', '/api/demo/batch-record')).status,
    ).toBe(403);
  });

  it('expires certificates and escalates stalled renewals in the daily run', async () => {
    const run = await call('hr01', 'POST', '/org/maintenance/run', {});
    expect(run.status).toBe(200);
    // 吴敏's certificate expired yesterday.
    expect(
      (
        await call(
          'emp_th_2',
          'POST',
          '/api/demo/batch-record/sign-filling',
          {},
        )
      ).status,
    ).toBe(403);
    const escalations = await runsOf('certificationSteward.recertEscalation');
    expect(escalations).toHaveLength(1);
    expect(escalations[0].status).toBe('succeeded');
    // No model is configured in tests, so the head receives the template text.
    expect(escalations[0].fallback).toBe(true);
    // Running the daily job again the same day does not escalate twice: the repeat is recorded as skipped.
    await call('hr01', 'POST', '/org/maintenance/run', {});
    const again = await runsOf('certificationSteward.recertEscalation');
    expect(again.filter((r: Json) => r.status === 'succeeded')).toHaveLength(1);
    expect(again.filter((r: Json) => r.status === 'skipped')).toHaveLength(1);
  });

  it('issues the certificate when the last requirement is met, and grants its permissions', async () => {
    // 李敏 finishes 《CNC 岗位操作入门》, then passes 《CNC 上岗考试》.
    for (const lesson of ['l1', 'l2', 'l3']) {
      const progress = await call('emp_njl_2', 'POST', '/learning/progress', {
        courseId: 'course-cnc-intro',
        lessonId: `course-cnc-intro-${lesson}`,
        assignmentId: 'assign-limin-cnc',
        durationSeconds: 300,
      });
      expect(progress.status).toBe(200);
    }
    const { DEMO_QUESTIONS } =
      await import('../../database/seed-data/demo-exams.ts');
    const answerOf = new Map(DEMO_QUESTIONS.map((q) => [q.id, q.answer]));
    const started = await call(
      'emp_njl_2',
      'POST',
      '/my-exams/exam-cnc-cert/start',
    );
    expect(started.status).toBe(200);
    const attempt = started.json.data;
    expect(attempt.items).toHaveLength(10);
    // The paper never carries the answers.
    expect(JSON.stringify(attempt.items)).not.toContain('"answer"');
    const answers = Object.fromEntries(
      attempt.items.map((item: Json) => [
        item.questionId,
        answerOf.get(item.questionId),
      ]),
    );
    const submitted = await call(
      'emp_njl_2',
      'POST',
      `/attempts/${attempt.id}/submit`,
      { answers },
    );
    expect(submitted.status).toBe(200);
    const result = await call(
      'emp_njl_2',
      'GET',
      `/attempts/${attempt.id}/result`,
    );
    expect(result.json.data.status).toBe('passed');
    expect(result.json.data.score).toBe(100);

    const certification = await call(
      'emp_njl_2',
      'GET',
      '/certifications/cert-cnc',
    );
    expect(certification.json.data.mine.certificate.status).toBe('valid');
    expect(certification.json.data.grantedPages).toContain('demo.batchRecord');
    expect(
      (
        await call(
          'emp_njl_2',
          'POST',
          '/api/demo/batch-record/sign-filling',
          {},
        )
      ).status,
    ).toBe(200);
  });

  it('keeps grading to the exam owner', async () => {
    expect((await call('trainer01', 'GET', '/grading')).status).toBe(200);
    expect((await call('emp_njl_1', 'GET', '/grading')).status).toBe(403);
  });

  it('withdraws the permissions of a revoked certificate at once', async () => {
    const noReason = await call(
      'hr01',
      'POST',
      '/certificates/certificate-zhaoyang-cnc/revoke',
      {},
    );
    expect(noReason.json.code).toBe('REVOKE_REASON_REQUIRED');
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/certificates/certificate-zhaoyang-cnc/revoke',
          { reason: 'acceptance' },
        )
      ).status,
    ).toBe(403);
    const revoked = await call(
      'hr01',
      'POST',
      '/certificates/certificate-zhaoyang-cnc/revoke',
      { reason: '无菌更衣确认未通过' },
    );
    expect(revoked.status).toBe(200);
    expect(revoked.json.data.status).toBe('revoked');
    expect(
      (
        await call(
          'emp_th_1',
          'POST',
          '/api/demo/batch-record/sign-filling',
          {},
        )
      ).status,
    ).toBe(403);
  });
});

describe('AI employees working on their own', () => {
  it('keeps the automation settings to HR administrators', async () => {
    const list = await call('hr01', 'GET', '/automations');
    expect(list.status).toBe(200);
    expect(list.json.data.map((a: Json) => a.key)).toContain(
      'frameworkAdvisor.dictionaryReview',
    );
    expect((await call('mgr_njl', 'GET', '/automations')).status).toBe(403);
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/automations/frameworkAdvisor.dictionaryReview/run',
        )
      ).status,
    ).toBe(403);
  });

  it('reviews the dictionary with rule-based suggestions when no model is configured', async () => {
    const run = await call(
      'hr01',
      'POST',
      '/automations/frameworkAdvisor.dictionaryReview/run',
    );
    expect(run.status).toBe(200);
    expect(run.json.data.status).toBe('succeeded');
    const detail = await call(
      'hr01',
      'GET',
      `/automations/runs/${run.json.data.runId}`,
    );
    expect(detail.json.data.fallback).toBe(true);
    const merges = (detail.json.data.output.suggestions as Json[]).filter(
      (s) => s.kind === 'merge',
    );
    expect(
      merges.some(
        (s) =>
          s.competencies.includes('质量记录规范') &&
          s.competencies.includes('过程记录完整性'),
      ),
    ).toBe(true);
  });

  it('reports each knowledge gap once', async () => {
    const first = await call(
      'hr01',
      'POST',
      '/automations/knowledgeAssistant.gapWeeklyReport/run',
    );
    expect(first.json.data.status).toBe('succeeded');
    expect(first.json.data.output.topics.length).toBeGreaterThan(0);
    const gaps = await call('hr01', 'GET', '/kb/gaps');
    expect((gaps.json.data as Json[]).every((gap) => gap.reportedAt)).toBe(
      true,
    );
    // Everything is reported, so a second run the same week has nothing to do.
    const second = await call(
      'hr01',
      'POST',
      '/automations/knowledgeAssistant.gapWeeklyReport/run',
    );
    expect(['skipped', 'duplicate']).toContain(second.json.data.status);
  });

  it('drafts requirements only for new positions, and honours the switch', async () => {
    const key = 'frameworkAdvisor.draftNewPositions';
    // The seeded filler position already has requirements.
    const idle = await call('hr01', 'POST', `/automations/${key}/run`);
    expect(idle.json.data.status).toBe('skipped');

    const created = await call('hr01', 'POST', '/framework/positions', {
      code: 'LYO-OP',
      title: '冻干机操作工',
      jobFamilyId: 'jf-prod',
      responsibilities: '按 SOP 装载、运行和卸载冻干机，记录冻干曲线。',
    });
    expect(created.status).toBe(201);
    // Drafting needs a model; without one the run fails rather than inventing requirements.
    const failed = await call('hr01', 'POST', `/automations/${key}/run`);
    expect(failed.json.data.status).toBe('failed');

    const off = await call('hr01', 'PATCH', `/automations/${key}`, {
      enabled: false,
    });
    expect(off.status).toBe(200);
    const disabled = await call('hr01', 'POST', `/automations/${key}/run`);
    expect(disabled.json.data.status).toBe('disabled');
  });

  it('assigns remedial learning after the last failed renewal attempt', async () => {
    for (let i = 0; i < 3; i += 1) {
      const started = await call(
        'emp_njl_3',
        'POST',
        '/my-exams/exam-cnc-cert/start',
      );
      expect(started.status, `attempt ${i + 1}`).toBe(200);
      const submitted = await call(
        'emp_njl_3',
        'POST',
        `/attempts/${started.json.data.id}/submit`,
        { answers: {} },
      );
      expect(submitted.status).toBe(200);
    }
    const run = await waitFor(async () => {
      const runs = await runsOf('certificationSteward.remedialLearning');
      return runs.find((r) => r.status !== 'running');
    }, 'remedial learning run');
    expect(run.status).toBe('succeeded');
    const assignments = await call('emp_njl_3', 'GET', '/learning/assignments');
    expect(
      (assignments.json.data.items ?? assignments.json.data).some(
        (a: Json) => a.source === 'remedial',
      ),
    ).toBe(true);
  });

  it('tops up questions when a course is published', async () => {
    const confirmed = await call(
      'trainer01',
      'POST',
      '/courses/course-safety-basics/confirm',
    );
    expect(confirmed.status).toBe(200);
    const published = await call(
      'trainer01',
      'POST',
      '/courses/course-safety-basics/publish',
      { published: true },
    );
    expect(published.status).toBe(200);
    const run = await waitFor(async () => {
      const runs = await runsOf('contentWriter.fillCourseQuestions');
      return runs.find(
        (r) =>
          r.status !== 'running' &&
          JSON.stringify(r.triggerRef).includes('course-safety-basics'),
      );
    }, 'question top-up run');
    // Writing questions needs a model; the run is recorded either way.
    expect(['succeeded', 'failed']).toContain(run.status);
  });
});

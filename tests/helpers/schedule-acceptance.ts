import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { StandaloneServer } from '../../server/standalone.ts';
type Row = Record<string, any>;
type Call = (
  user: string | null,
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; json: Row }>;

export function registerScheduleAcceptance(
  server: () => StandaloneServer,
  call: Call,
) {
  describe('V2-05 read-only scheduling preflight', () => {
    const db = () =>
      server().application.container.resolve(databaseManagerToken);
    let employee: Row;
    const suspended: string[] = [];
    const input = (
      date = '2028-04-02',
      shiftId: string | null = 'schedule-test-day',
    ) => ({ cells: [{ employeeId: employee.id, date, shiftId }] });
    const check = (body: unknown, user: string | null = 'mgr_njl') =>
      call(user, 'POST', '/schedules/validate', body);
    const messages = (result: Row): string[] =>
      Object.values(result.json.data.checks).flatMap((checks) =>
        (checks as Row[]).map((check) => check.message),
      );
    beforeAll(async () => {
      const session = await call('emp_njl_1', 'GET', '/api/auth/get-session');
      employee = (await db()
        .repository('employees')
        .findOne({ filter: { userId: session.json.user.id } }))!;
      for (const row of await db()
        .repository('attendanceRules')
        .findMany({ filter: { active: true } })) {
        if ((row.departmentIds as string[]).includes(employee.departmentId)) {
          suspended.push(String(row.id));
          await db()
            .repository('attendanceRules')
            .updateOne({
              filter: { id: String(row.id) },
              values: { active: false },
            });
        }
      }
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await db()
        .repository('attendanceRules')
        .createOne({
          values: {
            id: 'schedule-test-rule',
            title: 'Test scheduling rule',
            departmentIds: [employee.departmentId],
            workHourSystem: 'standard',
            punchSource: 'device',
            lateGraceMinutes: 5,
            overtimeRequiresApproval: true,
            monthlyOvertimeAlertHours: 36,
            minRestHours: 11,
            maxConsecutiveNights: 5,
            active: true,
            ...stamp,
          },
        });
      for (const [name, startTime, endTime] of [
        ['day', '09:00', '17:00'],
        ['night', '22:00', '06:00'],
      ]) {
        await db()
          .repository('shifts')
          .createOne({
            values: {
              id: `schedule-test-${name}`,
              code: `schedule-test-${name}`,
              title: name,
              startTime: `${startTime}:00.000`,
              endTime: `${endTime}:00.000`,
              breakMinutes: 30,
              isNight: name === 'night',
              departmentIds: null,
              active: true,
              ...stamp,
            },
          });
      }
    });
    afterAll(async () => {
      await db()
        .repository('attendanceRules')
        .updateOne({
          filter: { id: 'schedule-test-rule' },
          values: { active: false },
        });
      for (const id of suspended)
        await db()
          .repository('attendanceRules')
          .updateOne({ filter: { id }, values: { active: true } });
    });
    it('requires authentication and the edit action, not just the page grant', async () => {
      expect((await check(input(), null)).status).toBe(401);
      expect((await check(input(), 'emp_njl_1')).status).toBe(403);
      const authz = server().application.container.resolve(authorizationToken);
      const session = await call('emp_njl_1', 'GET', '/api/auth/get-session');
      await authz.permissionSets.create({
        key: 'schedule-test-page-only',
        title: 'Scheduling page only',
        grants: [
          {
            resource: { type: 'page', id: 'talent.schedules' },
            actions: [{ action: 'access' }],
          },
        ],
      });
      const assignment = await authz.permissionSets.assign({
        permissionSet: 'schedule-test-page-only',
        subject: { type: 'user', id: String(session.json.user.id) },
      });
      try {
        expect((await check(input(), 'emp_njl_1')).status).toBe(403);
      } finally {
        await authz.permissionSets.revoke(assignment.id);
      }
    });
    it('allows scoped managers and HR but does not claim writes are ready or mutate records', async () => {
      const before = await db()
        .repository('shiftSchedules')
        .findMany({ filter: { employeeId: employee.id } });
      const config = await db()
        .repository('personnelSettings')
        .findOne({ filter: { id: 'attendance.catalog' } });
      for (const user of ['hr01', 'mgr_njl']) {
        const result = await check(input(), user);
        expect(result.status).toBe(200);
        expect(result.json.data).toMatchObject({
          checks: {},
          hasBlock: false,
          hasWarn: false,
          writesReady: false,
        });
        expect(result.json.data.pendingRules).toContain(
          'MONTHLY_OVERTIME_POLICY_REQUIRED',
        );
      }
      expect(
        await db()
          .repository('shiftSchedules')
          .findMany({ filter: { employeeId: employee.id } }),
      ).toEqual(before);
      expect(
        await db()
          .repository('personnelSettings')
          .findOne({ filter: { id: 'attendance.catalog' } }),
      ).toEqual(config);
    });
    it('bounds list ranges to 31 inclusive days and returns no cells when no employees match', async () => {
      const path = `/schedules?departmentId=${employee.departmentId}&from=2028-03-01`;
      const full = await call('mgr_njl', 'GET', `${path}&to=2028-03-31`);
      expect(full.status).toBe(200);
      expect(full.json.data.dates).toHaveLength(31);
      expect(
        (await call('mgr_njl', 'GET', `${path}&to=2028-04-01`)).status,
      ).toBe(400);
      const empty = await call(
        'mgr_njl',
        'GET',
        `${path}&to=2028-03-31&q=nonexistent-scheduling-employee`,
      );
      expect(empty.status).toBe(200);
      expect(empty.json.data.employees).toEqual([]);
      expect(empty.json.data.cells).toEqual([]);
      expect((await call(null, 'GET', '/schedules?from=invalid')).status).toBe(
        401,
      );
      expect(
        (await call('mgr_njl', 'GET', '/schedules?from=invalid')).status,
      ).toBe(400);
    });
    it('rejects cross-department employee ids before reading their leave or schedule details', async () => {
      const session = await call('mgr_cd', 'GET', '/api/auth/get-session');
      const foreign = await db()
        .repository('employees')
        .findOne({ filter: { userId: session.json.user.id } });
      expect(foreign).toBeTruthy();
      const result = await check({
        cells: [{ ...input().cells[0], employeeId: foreign!.id }],
      });
      expect(result.status).toBe(404);
      expect(result.json.code).toBe('NOT_FOUND');
      expect(result.json.data).toBeUndefined();
    });
    it('returns stable input errors for duplicates, excessive ranges, empty cells and forged output fields', async () => {
      const sample = input().cells[0];
      for (const body of [
        { cells: [] },
        { cells: [{ ...sample, status: 'published' }] },
        { cells: [{ ...sample, date: '2028-02-30' }] },
        { ...input(), checkResult: [] },
      ])
        expect((await check(body)).status).toBe(400);
      expect((await check({ cells: [sample, sample] })).json.code).toBe(
        'DUPLICATE_SCHEDULE_CELL',
      );
      expect(
        (await check({ cells: [sample, { ...sample, date: '2028-06-01' }] }))
          .json.code,
      ).toBe('SCOPE_TOO_LARGE');
    });
    it('checks the saved preceding and following shift across a month boundary', async () => {
      const values = {
        id: 'schedule-test-boundary',
        employeeId: employee.id,
        date: '2029-03-31',
        shiftId: 'schedule-test-night',
        status: 'published',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db().repository('shiftSchedules').createOne({ values });
      expect(messages(await check(input('2029-04-01')))).toContain(
        'INSUFFICIENT_REST',
      );
      await db()
        .repository('shiftSchedules')
        .updateOne({
          filter: { id: values.id },
          values: { date: '2029-04-02', shiftId: 'schedule-test-day' },
        });
      expect(
        messages(await check(input('2029-04-01', 'schedule-test-night'))),
      ).toContain('INSUFFICIENT_REST');
    });
    it('warns for six actual consecutive nights even when the caller acknowledges warnings', async () => {
      const before = await db()
        .repository('shiftSchedules')
        .findMany({ filter: { employeeId: employee.id } });
      const cells = Array.from(
        { length: 6 },
        (_, i) =>
          input(
            `2028-05-${String(i + 1).padStart(2, '0')}`,
            'schedule-test-night',
          ).cells[0],
      );
      const first = await check({ cells });
      const second = await check({
        cells: [...cells].reverse(),
        acknowledgeWarnings: true,
      });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.json.data.hasWarn).toBe(true);
      expect(first.json.data.hasBlock).toBe(false);
      expect(second.json.data.checks).toEqual(first.json.data.checks);
      expect(messages(second)).toContain('CONSECUTIVE_NIGHTS');
      expect(
        await db()
          .repository('shiftSchedules')
          .findMany({ filter: { employeeId: employee.id } }),
      ).toEqual(before);
    });
    it('rejects a pending leave intersection after midnight without returning private leave content', async () => {
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: 'schedule-test-leave',
            code: 'schedule-test-leave',
            title: 'Private type',
            payType: 'unpaid',
            unit: 'day',
            countBy: 'calendar',
            balanceRule: 'none',
            requiresAttachment: false,
            ...stamp,
          },
        });
      await db()
        .repository('leaveRequests')
        .createOne({
          values: {
            id: 'schedule-test-private',
            employeeId: employee.id,
            leaveTypeId: 'schedule-test-leave',
            startAt: '2028-06-02T21:00:00.000Z',
            endAt: '2028-06-02T23:00:00.000Z',
            duration: 1,
            reason: 'Private medical details',
            status: 'pending',
            source: 'self',
            approvals: [],
            ...stamp,
          },
        });
      const result = await check(input('2028-06-02', 'schedule-test-night'));
      expect(result.status).toBe(200);
      expect(result.json.data.hasBlock).toBe(true);
      expect(messages(result)).toContain('LEAVE_CONFLICT');
      expect(JSON.stringify(result.json)).not.toContain('Private');
      expect(JSON.stringify(result.json)).not.toContain(
        'schedule-test-private',
      );
    });
    it('reports locked months even for a proposed rest day without altering the summary', async () => {
      const summary = {
        id: 'schedule-test-lock',
        employeeId: employee.id,
        month: '2028-07',
        scheduledDays: 0,
        workedDays: 0,
        lateCount: 0,
        earlyCount: 0,
        missingCount: 0,
        absentDays: 0,
        leaveByType: {},
        overtimeByType: {},
        nightShiftCount: 0,
        shiftCounts: {},
        status: 'locked',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await db()
        .repository('attendanceMonthlySummaries')
        .createOne({ values: summary });
      const before = await db()
        .repository('attendanceMonthlySummaries')
        .findOne({ filter: { id: summary.id } });
      const result = await check(input('2028-07-01', null));
      expect(result.status).toBe(200);
      expect(messages(result)).toContain('MONTH_LOCKED');
      expect(
        await db()
          .repository('attendanceMonthlySummaries')
          .findOne({ filter: { id: summary.id } }),
      ).toEqual(before);
    });
  });
}

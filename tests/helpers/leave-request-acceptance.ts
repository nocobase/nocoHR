import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { leaveResource } from '../../server/providers/hr/leave-resources.js';
import { platformToken } from '../../server/providers/hr/tokens.js';
import type { StandaloneServer } from '../../server/standalone.ts';
type Row = Record<string, any>;
type Call = (
  user: string | null,
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; json: Row }>;

export function registerLeaveRequestAcceptance(
  server: () => StandaloneServer,
  call: Call,
) {
  describe('V2-05 leave request transactions', () => {
    let employee: Row;
    const db = () =>
      server().application.container.resolve(databaseManagerToken);
    const data = (start = '2027-02-01', end = start, overrides: Row = {}) => ({
      leaveTypeId: 'request-test-annual',
      startAt: `${start}T01:00:00.000Z`,
      endAt: `${end}T09:00:00.000Z`,
      reason: 'Test leave',
      ...overrides,
    });
    async function draft(body: Row, user = 'emp_njl_1') {
      const r = await call(user, 'POST', '/leave/requests', body);
      expect(r.status).toBe(201);
      return r.json.data as Row;
    }
    const change = (user: string, row: Row, action: string, extras: Row = {}) =>
      call(user, 'POST', `/leave/requests/${row.id}/${action}`, {
        expectedUpdatedAt: row.updatedAt,
        ...extras,
      });
    const balance = async () => {
      const row = await db()
        .repository('leaveBalances')
        .findOne({ filter: { id: 'request-test-balance' } });
      return { pending: Number(row!.pending), used: Number(row!.used) };
    };
    beforeAll(async () => {
      const session = await call('emp_njl_1', 'GET', '/api/auth/get-session');
      employee = (await db()
        .repository('employees')
        .findOne({ filter: { userId: session.json.user.id } }))!;
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: 'request-test-annual',
            code: 'request-test-annual',
            title: 'Test annual',
            payType: 'paid',
            unit: 'day',
            countBy: 'calendar',
            balanceRule: 'annualBySeniority',
            requiresAttachment: false,
            ...stamp,
          },
        });
      await db()
        .repository('leaveBalances')
        .createOne({
          values: {
            id: 'request-test-balance',
            employeeId: employee.id,
            leaveTypeId: 'request-test-annual',
            year: 2027,
            entitled: 40,
            used: 0,
            pending: 0,
            adjustments: [],
            ...stamp,
          },
        });
    });
    it('returns only the signed-in employee balances even to HR and rejects employee overrides', async () => {
      const path = '/leave/requests/my-balances?year=2027';
      expect((await call(null, 'GET', path)).status).toBe(401);
      const own = await call('emp_njl_1', 'GET', path);
      expect(own.status).toBe(200);
      expect(own.json.data).toEqual({
        year: 2027,
        frozen: false,
        items: [
          {
            id: 'request-test-balance',
            leaveTypeTitle: 'Test annual',
            entitled: 40,
            carriedOver: 0,
            used: 0,
            pending: 0,
            adjusted: 0,
            available: 40,
          },
        ],
      });
      for (const user of ['hr01', 'emp_njl_2', 'mgr_cd']) {
        const other = await call(user, 'GET', path);
        expect(other.status).toBe(200);
        expect(
          other.json.data.items.every(
            (item: Row) => item.id !== 'request-test-balance',
          ),
        ).toBe(true);
        expect(
          (await call(user, 'GET', `${path}&employeeId=${employee.id}`)).status,
        ).toBe(400);
      }
    });
    it('requires the request action even when the employee still has page grants', async () => {
      const sets =
        server().application.container.resolve(
          authorizationToken,
        ).permissionSets;
      const original = await sets.get('hr.employee');
      expect(original).toBeTruthy();
      const snapshot = {
        key: original!.key,
        title: original!.title,
        grants: original!.grants,
      };
      const grants = original!.grants.filter(
        (grant) => grant.resource.id !== 'talent.leaveRequest',
      );
      expect(grants.some((grant) => grant.resource.type === 'page')).toBe(true);
      try {
        await sets.update(original!.key, { ...snapshot, grants });
        const denied = await call(
          'emp_njl_1',
          'GET',
          '/leave/requests/my-balances?year=2027',
        );
        expect(denied.status).toBe(403);
        expect(denied.json).not.toHaveProperty('data');
      } finally {
        await sets.update(original!.key, snapshot);
      }
    });
    it('reports a frozen balance and rejects an account with no linked employee', async () => {
      const repo = db().repository('employees');
      const original = (await repo.findOne({ filter: { id: employee.id } }))!;
      try {
        await repo.updateOne({
          filter: { id: employee.id },
          values: { status: 'leave' },
        });
        const frozen = await call(
          'emp_njl_1',
          'GET',
          '/leave/requests/my-balances?year=2027',
        );
        expect(frozen.status).toBe(200);
        expect(frozen.json.data.frozen).toBe(true);
        await repo.updateOne({
          filter: { id: employee.id },
          values: { userId: null },
        });
        expect(
          (
            await call(
              'emp_njl_1',
              'GET',
              '/leave/requests/my-balances?year=2027',
            )
          ).status,
        ).toBe(404);
      } finally {
        await repo.updateOne({
          filter: { id: employee.id },
          values: { status: original.status, userId: original.userId },
        });
      }
    });
    it('defaults to the application business year and distinguishes missing balances from zero', async () => {
      const platform = server().application.container.resolve(platformToken);
      const current = await call(
        'emp_njl_1',
        'GET',
        '/leave/requests/my-balances',
      );
      expect(current.status).toBe(200);
      expect(current.json.data.year).toBe(
        Number(platform.currentDate().slice(0, 4)),
      );
      expect(
        (
          await call(
            'emp_njl_1',
            'GET',
            '/leave/requests/my-balances?year=2199',
          )
        ).json.data.items,
      ).toEqual([]);
      for (const year of ['0', 'abc', '2201', '2027.5', ''])
        expect(
          (
            await call(
              'emp_njl_1',
              'GET',
              `/leave/requests/my-balances?year=${year}`,
            )
          ).status,
        ).toBe(400);
    });
    it('reports precise balances without leaking adjustment history or mutating the ledger', async () => {
      const ledger = db().repository('leaveBalances');
      const fixture = {
        id: 'own-summary-ledger',
        employeeId: employee.id,
        leaveTypeId: 'request-test-annual',
        year: 2035,
        entitled: 12.5,
        carriedOver: 1,
        used: 2.25,
        pending: 1.5,
        adjustments: [
          {
            delta: -0.25,
            reason: 'private ledger reason',
            by: 'private-actor',
            at: '2026-09-29T00:00:00Z',
          },
        ],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await ledger.createOne({ values: fixture });
      const before = await ledger.findOne({ filter: { id: fixture.id } });
      const path = '/leave/requests/my-balances?year=2035';
      const first = await call('emp_njl_1', 'GET', path);
      expect(first.status).toBe(200);
      expect(first.json.data.items).toEqual([
        {
          id: fixture.id,
          leaveTypeTitle: 'Test annual',
          entitled: 12.5,
          carriedOver: 1,
          used: 2.25,
          pending: 1.5,
          adjusted: -0.25,
          available: 9.5,
        },
      ]);
      expect((await call('emp_njl_1', 'GET', path)).json).toEqual(first.json);
      expect(await ledger.findOne({ filter: { id: fixture.id } })).toEqual(
        before,
      );
      expect(JSON.stringify(first.json)).not.toContain('private');
      await ledger.updateOne({
        filter: { id: fixture.id },
        values: { expiresAt: '2035-06-30' },
      });
      // A future expiry: the carried day still counts (used first, lapses after expiry).
      const expiring = await call('emp_njl_1', 'GET', path);
      expect(expiring.status).toBe(200);
      expect(expiring.json.data.items[0]).toMatchObject({
        carriedOver: 1,
        available: 9.5,
      });
      await ledger.updateOne({
        filter: { id: fixture.id },
        values: { expiresAt: null, adjustments: 'malformed ledger' },
      });
      const corrupt = await call('emp_njl_1', 'GET', path);
      expect(corrupt.status).toBe(409);
      expect(corrupt.json.code).toBe('INVALID_BALANCE');
    });
    it('returns scoped labels and draft eligibility without exposing another employee draft', async () => {
      const row = await draft(
        data('2027-12-13', '2027-12-13', { source: 'hrAssistant' }),
      );
      const own = await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`);
      expect(own.status).toBe(200);
      expect(own.json.data).toMatchObject({
        canEdit: true,
        canApprove: false,
        isOwnRequest: true,
        canCancel: false,
        employeeName: employee.name,
        leaveTypeTitle: 'Test annual',
        leaveUnit: 'day',
        source: 'hrAssistant',
      });
      expect(own.json.data).not.toHaveProperty('userId');
      for (const user of ['emp_njl_2', 'mgr_cd', 'mgr_njl']) {
        expect(
          (await call(user, 'GET', `/leave/requests/${row.id}`)).status,
        ).toBe(404);
      }
      const saved = await call(
        'emp_njl_1',
        'PATCH',
        `/leave/requests/${row.id}`,
        {
          ...data('2027-12-13', '2027-12-13'),
          source: 'hrAssistant',
          reason: 'Updated draft',
          expectedUpdatedAt: row.updatedAt,
        },
      );
      expect(saved.status).toBe(200);
      expect(
        (
          await call('emp_njl_1', 'PATCH', `/leave/requests/${row.id}`, {
            ...data('2027-12-13', '2027-12-13'),
            expectedUpdatedAt: row.updatedAt,
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await call('emp_njl_2', 'PATCH', `/leave/requests/${row.id}`, {
            ...data('2027-12-13', '2027-12-13'),
            expectedUpdatedAt: saved.json.data.updatedAt,
          })
        ).status,
      ).toBe(404);
      expect(
        (await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`)).json.data
          .reason,
      ).toBe('Updated draft');
      const submitted = await change('emp_njl_1', saved.json.data, 'submit');
      expect(submitted.status).toBe(200);
      expect(
        (await change('emp_njl_1', submitted.json.data, 'cancel')).status,
      ).toBe(200);
      expect(
        (await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`)).json.data
          .canEdit,
      ).toBe(false);
    });
    it('submits with read-only settings, lists own pending requests and releases pending on cancel', async () => {
      const row = await draft(data());
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
      const r = await change('emp_njl_1', row, 'submit');
      expect(r.status).toBe(200);
      expect(await balance()).toMatchObject({ pending: 1, used: 0 });
      expect(
        (
          await call(
            'emp_njl_1',
            'GET',
            '/leave/requests/my-balances?year=2027',
          )
        ).json.data.items.find(
          (item: Row) => item.id === 'request-test-balance',
        ),
      ).toMatchObject({ pending: 1, used: 0, available: 39 });
      expect(
        (await call('emp_njl_1', 'GET', '/leave/requests?status=pending'))
          .status,
      ).toBe(200);
      expect((await change('emp_njl_1', r.json.data, 'cancel')).status).toBe(
        200,
      );
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
      expect(
        (
          await call(
            'emp_njl_1',
            'GET',
            '/leave/requests/my-balances?year=2027',
          )
        ).json.data.items.find(
          (item: Row) => item.id === 'request-test-balance',
        ),
      ).toMatchObject({ pending: 0, used: 0, available: 40 });
      expect(
        (
          await call(
            'emp_njl_1',
            'PATCH',
            '/attendance-settings/config/limits',
            {},
          )
        ).status,
      ).toBe(403);
    });
    it('requires two approval levels and updates used and attendance only after the final level', async () => {
      const row = await draft(data('2027-02-08', '2027-02-11'));
      const submitted = await change('emp_njl_1', row, 'submit');
      expect(submitted.status).toBe(200);
      expect(submitted.json.data.approvals).toHaveLength(2);
      expect(
        (await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`)).json.data,
      ).toMatchObject({
        canEdit: false,
        canApprove: false,
        isOwnRequest: true,
        canCancel: true,
      });
      expect(
        (await call('hr01', 'GET', `/leave/requests/${row.id}`)).json.data
          .canApprove,
      ).toBe(false);
      expect(
        (await call('mgr_njl', 'GET', `/leave/requests/${row.id}`)).json.data,
      ).toMatchObject({
        canEdit: false,
        canApprove: true,
        isOwnRequest: false,
        canCancel: false,
        employeeName: employee.name,
        leaveTypeTitle: 'Test annual',
      });
      expect(
        (await call('mgr_njl', 'GET', `/leave/requests/${row.id}`)).status,
      ).toBe(200);
      expect(
        (await call('mgr_njl', 'GET', '/leave/approvals')).json.data.some(
          (item: Row) => item.id === row.id,
        ),
      ).toBe(true);
      expect(
        (await call('hr01', 'GET', '/leave/approvals')).json.data.some(
          (item: Row) => item.id === row.id,
        ),
      ).toBe(false);
      expect(
        (await call('mgr_cd', 'GET', '/leave/approvals')).json.data.some(
          (item: Row) => item.id === row.id,
        ),
      ).toBe(false);
      const first = await change('mgr_njl', submitted.json.data, 'decide', {
        decision: 'approved',
      });
      expect(first.status).toBe(200);
      expect(first.json.data.status).toBe('pending');
      expect(
        (await call('mgr_njl', 'GET', `/leave/requests/${row.id}`)).json.data
          .canApprove,
      ).toBe(false);
      expect(
        (await call('hr01', 'GET', `/leave/requests/${row.id}`)).json.data
          .canApprove,
      ).toBe(true);
      expect(
        (await call('mgr_njl', 'GET', '/leave/approvals')).json.data.some(
          (item: Row) => item.id === row.id,
        ),
      ).toBe(false);
      expect(
        (await call('hr01', 'GET', '/leave/approvals')).json.data.some(
          (item: Row) => item.id === row.id,
        ),
      ).toBe(true);
      expect(await balance()).toMatchObject({ pending: 4, used: 0 });
      const final = await change('hr01', first.json.data, 'decide', {
        decision: 'approved',
      });
      expect(final.status).toBe(200);
      expect(
        (await call('hr01', 'GET', `/leave/requests/${row.id}`)).json.data
          .canApprove,
      ).toBe(false);
      expect(await balance()).toMatchObject({ pending: 0, used: 4 });
      expect(
        (await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`)).json.data,
      ).toMatchObject({ isOwnRequest: true, canCancel: true });
      expect(
        await db()
          .repository('attendanceRecords')
          .count({ filter: { leaveRequestId: row.id, status: 'leave' } }),
      ).toBe(4);
      expect(
        (
          await change('hr01', first.json.data, 'decide', {
            decision: 'approved',
          })
        ).status,
      ).toBe(409);
      expect(
        (await change('emp_njl_1', final.json.data, 'cancel')).status,
      ).toBe(200);
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
    });
    it('cancels once under concurrent requests and denies peer or approver cancellation', async () => {
      const before = await balance();
      const row = await draft(data('2027-12-21'));
      expect((await change('emp_njl_1', row, 'cancel')).status).toBe(409);
      const submitted = await change('emp_njl_1', row, 'submit');
      expect(submitted.status).toBe(200);
      expect(
        (await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`)).json.data,
      ).toMatchObject({ isOwnRequest: true, canCancel: true });
      for (const user of ['emp_njl_2', 'mgr_njl', 'mgr_cd']) {
        expect((await change(user, submitted.json.data, 'cancel')).status).toBe(
          404,
        );
      }
      expect(await balance()).toEqual({
        ...before,
        pending: before.pending + 1,
      });
      const results = await Promise.all([
        change('emp_njl_1', submitted.json.data, 'cancel'),
        change('emp_njl_1', submitted.json.data, 'cancel'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (await change('emp_njl_1', submitted.json.data, 'cancel')).status,
      ).toBe(409);
      expect(await balance()).toEqual(before);
      const cancelled = await call(
        'emp_njl_1',
        'GET',
        `/leave/requests/${row.id}`,
      );
      expect(cancelled.json.data).toMatchObject({
        isOwnRequest: true,
        canCancel: false,
        canEdit: false,
        status: 'cancelled',
      });
    });
    it('rejects forged fields and reassignment to another employee', async () => {
      expect((await call(null, 'POST', '/leave/requests', data())).status).toBe(
        401,
      );
      expect(
        (
          await call('emp_njl_1', 'POST', '/leave/requests', {
            ...data(),
            duration: 0,
            status: 'approved',
          })
        ).status,
      ).toBe(400);
      const row = await draft(data('2027-03-01'));
      const session = await call('emp_njl_2', 'GET', '/api/auth/get-session');
      const other = await db()
        .repository('employees')
        .findOne({ filter: { userId: session.json.user.id } });
      expect([403, 404]).toContain(
        (
          await call('emp_njl_1', 'PATCH', `/leave/requests/${row.id}`, {
            ...data('2027-03-01'),
            employeeId: other!.id,
            expectedUpdatedAt: row.updatedAt,
          })
        ).status,
      );
      expect(
        (
          await db()
            .repository('leaveRequests')
            .findOne({ filter: { id: row.id } })
        )?.employeeId,
      ).toBe(employee.id);
      expect(
        (await call('emp_njl_2', 'GET', `/leave/requests/${row.id}`)).status,
      ).toBe(404);
    });
    it('serializes retries, rejects overlap and unauthorized decisions, releases pending on rejection', async () => {
      const row = await draft(data('2027-03-08'));
      const results = await Promise.all([
        change('emp_njl_1', row, 'submit'),
        change('emp_njl_1', row, 'submit'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await balance()).toMatchObject({ pending: 1, used: 0 });
      const submitted = results.find((r) => r.status === 200)!.json.data;
      const duplicate = await draft(data('2027-03-08'));
      expect((await change('emp_njl_1', duplicate, 'submit')).json.code).toBe(
        'LEAVE_OVERLAP',
      );
      expect([403, 404]).toContain(
        (await change('mgr_cd', submitted, 'decide', { decision: 'approved' }))
          .status,
      );
      expect(
        (await change('hr01', submitted, 'decide', { decision: 'approved' }))
          .json.code,
      ).toBe('NOT_CURRENT_APPROVER');
      const rejected = await change('mgr_njl', submitted, 'decide', {
        decision: 'rejected',
        comment: 'Test rejection',
      });
      expect(rejected.status).toBe(200);
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
    });
    it('loads configured approval thresholds immediately and keeps AI drafts employee-submitted', async () => {
      const original = await call(
        'hr01',
        'GET',
        '/attendance-settings/config/limits',
      );
      const saved = await call(
        'hr01',
        'PATCH',
        '/attendance-settings/config/limits',
        {
          revision: original.json.data.revision,
          value: { ...original.json.data.value, leaveSecondLevelDays: 2 },
        },
      );
      expect(saved.status).toBe(200);
      const row = await draft(
        data('2027-04-05', '2027-04-07', { source: 'hrAssistant' }),
      );
      expect((await change('hr01', row, 'submit')).json.code).toBe(
        'ONLY_EMPLOYEE_MAY_SUBMIT',
      );
      const r = await change('emp_njl_1', row, 'submit');
      expect(r.status).toBe(200);
      expect(r.json.data.approvals).toHaveLength(2);
      expect((await change('emp_njl_1', r.json.data, 'cancel')).status).toBe(
        200,
      );
      await call('hr01', 'PATCH', '/attendance-settings/config/limits', {
        revision: saved.json.data.revision,
        value: original.json.data.value,
      });
    });
    it('uses fixed-per-event quota without an annual balance and requires proof only at submission', async () => {
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: 'request-test-fixed',
            code: 'request-test-fixed',
            title: 'Test event',
            payType: 'paid',
            unit: 'day',
            countBy: 'calendar',
            balanceRule: 'fixedPerEvent',
            fixedDays: 3,
            requiresAttachment: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      const row = await draft(
        data('2027-05-03', '2027-05-03', { leaveTypeId: 'request-test-fixed' }),
      );
      const r = await change('emp_njl_1', row, 'submit');
      expect(r.status).toBe(200);
      expect(r.json.data.approvals).toHaveLength(2);
      expect((await change('emp_njl_1', r.json.data, 'cancel')).status).toBe(
        200,
      );
      const excess = await draft(
        data('2027-05-10', '2027-05-13', { leaveTypeId: 'request-test-fixed' }),
      );
      expect((await change('emp_njl_1', excess, 'submit')).json.code).toBe(
        'FIXED_LEAVE_LIMIT',
      );
      await db()
        .repository('leaveTypes')
        .updateOne({
          filter: { id: 'request-test-fixed' },
          values: { requiresAttachment: true },
        });
      const missing = await draft(
        data('2027-05-17', '2027-05-17', { leaveTypeId: 'request-test-fixed' }),
      );
      expect((await change('emp_njl_1', missing, 'submit')).json.code).toBe(
        'ATTACHMENT_REQUIRED',
      );
    });
    async function monthlyLock(month: string) {
      return db()
        .repository('attendanceMonthlySummaries')
        .createOne({
          values: {
            id: `request-test-lock-${month}`,
            employeeId: employee.id,
            month,
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
            lockedBy: 'test',
            lockedAt: new Date(),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
    }
    it('rejects a locked middle month and rolls back approvals and cancellations after locking', async () => {
      await monthlyLock('2027-07');
      const spans = await draft(data('2027-06-30', '2027-08-01'));
      expect((await change('emp_njl_1', spans, 'submit')).json.code).toBe(
        'MONTH_LOCKED',
      );
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
      const row = await draft(data('2027-09-06'));
      const submitted = await change('emp_njl_1', row, 'submit');
      expect(submitted.status).toBe(200);
      const locked = await monthlyLock('2027-09');
      expect(
        (
          await change('mgr_njl', submitted.json.data, 'decide', {
            decision: 'approved',
          })
        ).json.code,
      ).toBe('MONTH_LOCKED');
      expect(
        (await change('emp_njl_1', submitted.json.data, 'cancel')).json.code,
      ).toBe('MONTH_LOCKED');
      expect(await balance()).toMatchObject({ pending: 1, used: 0 });
      expect(
        (
          await db()
            .repository('leaveRequests')
            .findOne({ filter: { id: row.id } })
        )?.status,
      ).toBe('pending');
      await db()
        .repository('attendanceMonthlySummaries')
        .updateOne({
          filter: { id: String(locked.record.id) },
          values: { status: 'draft' },
        });
      const approved = await change('mgr_njl', submitted.json.data, 'decide', {
        decision: 'approved',
      });
      expect(approved.status).toBe(200);
      await db()
        .repository('attendanceMonthlySummaries')
        .updateOne({
          filter: { id: String(locked.record.id) },
          values: { status: 'locked' },
        });
      expect(
        (await change('emp_njl_1', approved.json.data, 'cancel')).json.code,
      ).toBe('MONTH_LOCKED');
      expect(await balance()).toMatchObject({ pending: 0, used: 1 });
      await db()
        .repository('attendanceMonthlySummaries')
        .updateOne({
          filter: { id: String(locked.record.id) },
          values: { status: 'draft' },
        });
      expect(
        (await change('emp_njl_1', approved.json.data, 'cancel')).status,
      ).toBe(200);
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
    });
    it('freezes workday dates at submission and never creates leave attendance for the weekend', async () => {
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: 'request-test-workdays',
            code: 'request-test-workdays',
            title: 'Workday leave',
            payType: 'unpaid',
            unit: 'day',
            countBy: 'workdays',
            balanceRule: 'none',
            requiresAttachment: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      const row = await draft(
        data('2027-10-15', '2027-10-18', {
          leaveTypeId: 'request-test-workdays',
        }),
      );
      const submitted = await change('emp_njl_1', row, 'submit');
      expect(submitted.status).toBe(200);
      expect(submitted.json.data.duration).toBe(2);
      await db()
        .repository('leaveTypes')
        .updateOne({
          filter: { id: 'request-test-workdays' },
          values: { countBy: 'calendar' },
        });
      const approved = await change('mgr_njl', submitted.json.data, 'decide', {
        decision: 'approved',
      });
      expect(approved.status).toBe(200);
      const records = await db()
        .repository('attendanceRecords')
        .findMany({
          filter: { leaveRequestId: row.id },
          sort: (s) => s.field('date').asc(),
        });
      expect(records.map((item) => item.date)).toEqual([
        '2027-10-15',
        '2027-10-18',
      ]);
      expect(
        (await change('emp_njl_1', approved.json.data, 'cancel')).status,
      ).toBe(200);
      expect(
        await db()
          .repository('attendanceRecords')
          .count({ filter: { leaveRequestId: row.id } }),
      ).toBe(0);
    });
    it('recalculates the day on cancellation from the punches it keeps', async () => {
      const now = new Date();
      await db()
        .repository('attendanceRecords')
        .createOne({
          values: {
            id: 'request-test-prior-attendance',
            employeeId: employee.id,
            date: '2027-11-01',
            status: 'late',
            lateMinutes: 12,
            workedMinutes: 468,
            punches: [{ at: '2027-11-01T01:12:00Z', source: 'device' }],
            computedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        });
      const row = await draft(data('2027-11-01'));
      const submitted = await change('emp_njl_1', row, 'submit');
      const approved = await change('mgr_njl', submitted.json.data, 'decide', {
        decision: 'approved',
      });
      expect(approved.status).toBe(200);
      const repo = db().repository('attendanceRecords');
      expect(
        await repo.findOne({ filter: { id: 'request-test-prior-attendance' } }),
      ).toMatchObject({ status: 'leave', leaveRequestId: row.id });
      expect(
        (await change('emp_njl_1', approved.json.data, 'cancel')).status,
      ).toBe(200);
      // No stale restore: the punch stays and the leave is gone.
      const after = await repo.findOne({
        filter: { id: 'request-test-prior-attendance' },
      });
      expect(after).toMatchObject({ leaveRequestId: null });
      expect(after?.status).not.toBe('leave');
      expect(after?.punches).toEqual([
        { at: '2027-11-01T01:12:00Z', source: 'device' },
      ]);
      expect(await balance()).toMatchObject({ pending: 0, used: 0 });
    });
    it('rejects guessed proof ids and only accepts existing attachments belonging to the applicant', async () => {
      const id = randomUUID();
      const now = new Date();
      await db()
        .repository('hrFiles')
        .createOne({
          values: {
            id,
            disk: 'local',
            key: 'test-proof-metadata-only',
            filename: 'Proof.txt',
            ext: 'txt',
            mimeType: 'text/plain',
            size: 0,
            createdAt: now,
            updatedAt: now,
          },
        });
      const input = data('2027-11-08', '2027-11-08', { attachmentFileId: id });
      expect(
        (await call('emp_njl_1', 'POST', '/leave/requests', input)).status,
      ).toBe(404);
      const session = await call('emp_njl_2', 'GET', '/api/auth/get-session');
      const other = (await db()
        .repository('employees')
        .findOne({ filter: { userId: session.json.user.id } }))!;
      await db()
        .repository('employeeAttachments')
        .createOne({
          values: {
            id: 'request-test-proof-link',
            employeeId: other.id,
            fileId: id,
            category: 'other',
            createdAt: now,
            updatedAt: now,
          },
        });
      expect(
        (await call('emp_njl_1', 'POST', '/leave/requests', input)).status,
      ).toBe(404);
      await db()
        .repository('employeeAttachments')
        .updateOne({
          filter: { id: 'request-test-proof-link' },
          values: { employeeId: employee.id },
        });
      expect((await draft(input)).attachmentFileId).toBe(id);
    });
    it('lists only authorized no-account employee selector fields and rejects non-HR entry access', async () => {
      expect(
        (await call(null, 'GET', '/leave/requests/entry-employees')).status,
      ).toBe(401);
      for (const user of ['emp_njl_1', 'emp_njl_2', 'mgr_njl', 'mgr_cd']) {
        expect(
          (await call(user, 'GET', '/leave/requests/entry-employees')).status,
        ).toBe(403);
        expect(
          (await call(user, 'GET', '/leave/requests?source=hr&status=draft'))
            .status,
        ).toBe(403);
      }
      const result = await call(
        'hr01',
        'GET',
        '/leave/requests/entry-employees',
      );
      expect(result.status).toBe(200);
      expect(result.json.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'emp-sunli' })]),
      );
      expect(
        result.json.data.some((item: Row) => item.id === employee.id),
      ).toBe(false);
      for (const row of result.json.data) {
        expect(Object.keys(row).sort()).toEqual(['employeeNo', 'id', 'name']);
        const stored = await db()
          .repository('employees')
          .findOne({ filter: { id: row.id } });
        expect(stored?.userId).toBeNull();
      }
      expect(result.json.meta).toMatchObject({ limit: 500, truncated: false });
      expect(
        (await call('hr01', 'GET', '/leave/requests?source=not-valid')).status,
      ).toBe(400);
    });
    it('does not widen employee scope when the caller additionally holds the HR entry gate', async () => {
      const authz = server().application.container.resolve(authorizationToken);
      const user = await call('emp_njl_1', 'GET', '/api/auth/get-session');
      await authz.permissionSets.create({
        key: 'test-hr-entry-gate',
        title: 'Test HR entry gate only',
        grants: [
          {
            resource: { type: 'composite', id: 'talent.leaveRequest' },
            actions: [{ action: 'manageTypes' }],
          },
        ],
      });
      const assignment = await authz.permissionSets.assign({
        permissionSet: 'test-hr-entry-gate',
        subject: { type: 'user', id: String(user.json.user.id) },
      });
      try {
        const result = await call(
          'emp_njl_1',
          'GET',
          '/leave/requests/entry-employees',
        );
        expect(result.status).toBe(200);
        expect(result.json.data).toEqual([]);
      } finally {
        await authz.permissionSets.revoke(assignment.id);
      }
    });
    it('rejects HR submission when the request is visible but its employee is outside the request scope', async () => {
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: 'request-test-hr-scope',
            code: 'request-test-hr-scope',
            title: 'HR scope test',
            payType: 'unpaid',
            unit: 'day',
            countBy: 'calendar',
            balanceRule: 'none',
            requiresAttachment: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      const input = data('2027-12-10', '2027-12-10', {
        employeeId: 'emp-sunli',
        source: 'hr',
        leaveTypeId: 'request-test-hr-scope',
      });
      const row = await draft(input, 'hr01');
      const authz = server().application.container.resolve(authorizationToken);
      const user = await call('emp_njl_1', 'GET', '/api/auth/get-session');
      await authz.permissionSets.create({
        key: 'test-hr-entry-scoped-employee',
        title: 'Test request visibility without employee visibility',
        grants: [
          leaveResource.reference().grant({
            request: {
              requests: 'allRecords',
              employees: 'talent.self',
              types: 'allRecords',
              balances: 'allRecords',
              schedules: 'allRecords',
              attendance: 'allRecords',
              configuration: 'allRecords',
            },
            manageTypes: true,
          }),
        ],
      });
      const assignment = await authz.permissionSets.assign({
        permissionSet: 'test-hr-entry-scoped-employee',
        subject: { type: 'user', id: String(user.json.user.id) },
      });
      try {
        const read = await call(
          'emp_njl_1',
          'GET',
          `/leave/requests/${row.id}`,
        );
        expect(read.status).toBe(200);
        expect(read.json.data.canEditHr).toBe(false);
        const result = await change('emp_njl_1', row, 'submit');
        expect(result.status).toBe(404);
        expect(result.json.code).toBe('NOT_FOUND');
        expect(
          (
            await db()
              .repository('leaveRequests')
              .findOne({ filter: { id: row.id } })
          )?.status,
        ).toBe('draft');
      } finally {
        await authz.permissionSets.revoke(assignment.id);
      }
    });
    it('supports HR entry only for no-account employees and escalates to the nearest manager', async () => {
      const input = data('2027-12-06', '2027-12-06', {
        employeeId: 'emp-sunli',
        leaveTypeId: 'request-test-workdays',
        source: 'hr',
      });
      expect(
        (await call('emp_njl_1', 'POST', '/leave/requests', input)).status,
      ).toBe(403);
      expect(
        (
          await call('hr01', 'POST', '/leave/requests', {
            ...input,
            employeeId: employee.id,
          })
        ).json.code,
      ).toBe('HR_ENTRY_REQUIRES_NO_ACCOUNT');
      const row = await draft(input, 'hr01');
      expect(row.source).toBe('hr');
      expect(
        (await call('hr01', 'GET', `/leave/requests/${row.id}`)).json.data,
      ).toMatchObject({ canEditHr: true, canEdit: false, isOwnRequest: false });
      const list = await call(
        'hr01',
        'GET',
        '/leave/requests?source=hr&status=draft',
      );
      expect(list.status).toBe(200);
      expect(list.json.data.some((item: Row) => item.id === row.id)).toBe(true);
      expect(
        list.json.data.every(
          (item: Row) => item.source === 'hr' && item.status === 'draft',
        ),
      ).toBe(true);
      const edited = await call('hr01', 'PATCH', `/leave/requests/${row.id}`, {
        ...input,
        reason: 'HR entered for Sun Li',
        expectedUpdatedAt: row.updatedAt,
      });
      expect(edited.status).toBe(200);
      expect(edited.json.data.source).toBe('hr');
      const submitted = await change('hr01', edited.json.data, 'submit');
      expect(submitted.status).toBe(200);
      expect(
        (await call('hr01', 'GET', `/leave/requests/${row.id}`)).json.data
          .canEditHr,
      ).toBe(false);
      const manager = await call('mgr_east', 'GET', '/api/auth/get-session');
      expect(submitted.json.data.approvals[0].approverUserId).toBe(
        manager.json.user.id,
      );
      expect(
        (
          await change('mgr_east', submitted.json.data, 'decide', {
            decision: 'approved',
          })
        ).status,
      ).toBe(200);
    });
    it('rechecks no-account eligibility on HR draft edits and submission without changing the draft', async () => {
      const input = data('2027-12-09', '2027-12-09', {
        employeeId: 'emp-sunli',
        source: 'hr',
        leaveTypeId: 'request-test-workdays',
      });
      const row = await draft(input, 'hr01');
      const repo = db().repository('employees');
      // Disposable database only. userId is an account binding marker (no FK);
      // simulate binding after the form opened, and restore it in finally.
      await repo.updateOne({
        filter: { id: 'emp-sunli' },
        values: { userId: `linked-${randomUUID()}` },
      });
      try {
        const read = await call('hr01', 'GET', `/leave/requests/${row.id}`);
        expect(read.json.data.canEditHr).toBe(false);
        expect(
          (
            await call('hr01', 'GET', '/leave/requests/entry-employees')
          ).json.data.some((item: Row) => item.id === 'emp-sunli'),
        ).toBe(false);
        const edited = await call(
          'hr01',
          'PATCH',
          `/leave/requests/${row.id}`,
          {
            ...input,
            reason: 'Must not save',
            expectedUpdatedAt: row.updatedAt,
          },
        );
        expect(edited.status).toBe(409);
        expect(edited.json.code).toBe('HR_ENTRY_REQUIRES_NO_ACCOUNT');
        expect((await change('hr01', row, 'submit')).json.code).toBe(
          'HR_ENTRY_REQUIRES_NO_ACCOUNT',
        );
        const unchanged = await db()
          .repository('leaveRequests')
          .findOne({ filter: { id: row.id } });
        expect(unchanged).toMatchObject({
          status: 'draft',
          reason: input.reason,
          source: 'hr',
        });
      } finally {
        await repo.updateOne({
          filter: { id: 'emp-sunli' },
          values: { userId: null },
        });
      }
      expect(
        (await call('hr01', 'GET', `/leave/requests/${row.id}`)).json.data
          .canEditHr,
      ).toBe(true);
    });
    it('does not allow HR to rewrite another employee self-service draft', async () => {
      const input = data('2027-12-20');
      const row = await draft(input);
      expect(
        (
          await call('hr01', 'PATCH', `/leave/requests/${row.id}`, {
            ...input,
            expectedUpdatedAt: row.updatedAt,
            reason: 'Must not save',
          })
        ).status,
      ).toBe(403);
      expect(
        (await call('emp_njl_1', 'GET', `/leave/requests/${row.id}`)).json.data
          .reason,
      ).toBe(input.reason);
    });
    it('reuses a draft id for concurrent creation retries and never overwrites a different request', async () => {
      const input = data('2027-12-06', '2027-12-06', {
        clientRequestId: randomUUID(),
      });
      const before = await db().repository('leaveRequests').count();
      const responses = await Promise.all([
        call('emp_njl_1', 'POST', '/leave/requests', input),
        call('emp_njl_1', 'POST', '/leave/requests', input),
      ]);
      for (const response of responses) {
        expect(response.status).toBe(201);
        expect(response.json.data.id).toBe(input.clientRequestId);
      }
      expect(await db().repository('leaveRequests').count()).toBe(before + 1);
      expect(responses[0].json.data.updatedAt).toBe(
        responses[1].json.data.updatedAt,
      );
      expect(
        (
          await call('emp_njl_1', 'POST', '/leave/requests', {
            ...input,
            reason: 'Changed on retry',
          })
        ).json.code,
      ).toBe('IDEMPOTENCY_CONFLICT');
      const other = await call('emp_njl_2', 'POST', '/leave/requests', input);
      expect(other.status).toBe(409);
      expect(other.json.data).toBeUndefined();
      const submitted = await change(
        'emp_njl_1',
        responses[0].json.data,
        'submit',
      );
      expect(submitted.status).toBe(200);
      const retry = await call('emp_njl_1', 'POST', '/leave/requests', input);
      expect(retry.status).toBe(201);
      expect(retry.json.data).toMatchObject({
        id: input.clientRequestId,
        status: 'pending',
      });
      expect(await balance()).toMatchObject({ pending: 1, used: 0 });
      expect(
        (await change('emp_njl_1', submitted.json.data, 'cancel')).status,
      ).toBe(200);
    });

    it('requires timezone-qualified input and returns instants without browser timezone ambiguity', async () => {
      const invalid = await call(
        'emp_njl_1',
        'POST',
        '/leave/requests',
        data('2027-12-08', '2027-12-08', { startAt: '2027-12-08T09:00:00' }),
      );
      expect(invalid.status).toBe(400);
      expect(invalid.json.code).toBe('INVALID_INPUT');
      const row = await draft(
        data('2027-12-08', '2027-12-08', {
          startAt: '2027-12-08T09:00:00+08:00',
          endAt: '2027-12-08T17:00:00+08:00',
        }),
      );
      expect(row.startAt).toBe('2027-12-08T01:00:00.000Z');
      expect(row.endAt).toBe('2027-12-08T09:00:00.000Z');
      const submitted = await change('emp_njl_1', row, 'submit');
      expect(submitted.status).toBe(200);
      expect(submitted.json.data.duration).toBe(1);
      expect(
        (await change('emp_njl_1', submitted.json.data, 'cancel')).status,
      ).toBe(200);
    });

    it('counts half days at the work window midpoint and hours rounded up to the half hour', async () => {
      // Defaults (attendance.leaveUnits): day window 08:30–17:30, standard 8 hours, 0.5-hour steps.
      const cases = [
        {
          unit: 'halfDay',
          startAt: '2028-01-10T08:30:00+08:00',
          endAt: '2028-01-10T13:00:00+08:00',
          duration: 0.5,
        },
        {
          unit: 'hour',
          startAt: '2028-01-11T09:00:00+08:00',
          endAt: '2028-01-11T10:10:00+08:00',
          duration: 1.5,
        },
      ];
      for (const item of cases) {
        const id = `request-test-${item.unit}`;
        await db()
          .repository('leaveTypes')
          .createOne({
            values: {
              id,
              code: id,
              title: id,
              payType: 'unpaid',
              unit: item.unit,
              countBy: 'calendar',
              balanceRule: 'none',
              requiresAttachment: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          });
        const row = await draft({
          leaveTypeId: id,
          startAt: item.startAt,
          endAt: item.endAt,
          reason: 'Test partial leave',
        });
        const submitted = await change('emp_njl_1', row, 'submit');
        expect(submitted.status).toBe(200);
        expect(submitted.json.data.duration).toBe(item.duration);
        const decision = await change(
          'mgr_njl',
          submitted.json.data,
          'decide',
          {
            decision: 'approved',
          },
        );
        expect(decision.status).toBe(200);
        expect(decision.json.data.status).toBe('approved');
        expect(
          (await change('emp_njl_1', decision.json.data, 'cancel')).status,
        ).toBe(200);
      }
    });

    it('uses the previous night shift and protects its month throughout the leave lifecycle', async () => {
      const typeId = 'request-test-night-schedule';
      const shiftId = 'request-test-night-shift';
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id: typeId,
            code: typeId,
            title: 'Night leave',
            payType: 'unpaid',
            unit: 'day',
            countBy: 'schedule',
            balanceRule: 'none',
            requiresAttachment: false,
            ...stamp,
          },
        });
      await db()
        .repository('shifts')
        .createOne({
          values: {
            id: shiftId,
            code: shiftId,
            title: 'Night shift',
            startTime: '22:00:00.000',
            endTime: '06:00:00.000',
            breakMinutes: 30,
            isNight: true,
            active: true,
            ...stamp,
          },
        });
      await db()
        .repository('shiftSchedules')
        .createOne({
          values: {
            id: 'request-test-night-cell',
            employeeId: employee.id,
            date: '2028-03-31',
            shiftId,
            status: 'published',
            ...stamp,
          },
        });
      // UTC date is March 31, but both actual instants are April 1 locally.
      const row = await draft({
        leaveTypeId: typeId,
        startAt: '2028-03-31T17:00:00Z',
        endAt: '2028-03-31T21:00:00Z',
      });
      expect(row.duration).toBe(1);
      const locked = await monthlyLock('2028-03');
      const setLock = async (status: string) =>
        db()
          .repository('attendanceMonthlySummaries')
          .updateOne({
            filter: { id: String(locked.record.id) },
            values: { status },
          });
      expect((await change('emp_njl_1', row, 'submit')).json.code).toBe(
        'MONTH_LOCKED',
      );
      await setLock('draft');
      const submitted = await change('emp_njl_1', row, 'submit');
      expect(submitted.status).toBe(200);
      expect(submitted.json.data.approvals[0].leaveDates).toEqual([
        '2028-03-31',
      ]);
      await setLock('locked');
      expect(
        (
          await change('mgr_njl', submitted.json.data, 'decide', {
            decision: 'approved',
          })
        ).json.code,
      ).toBe('MONTH_LOCKED');
      await setLock('draft');
      const approved = await change('mgr_njl', submitted.json.data, 'decide', {
        decision: 'approved',
      });
      expect(approved.status).toBe(200);
      const records = await db()
        .repository('attendanceRecords')
        .findMany({ filter: { leaveRequestId: row.id } });
      expect(records.map((record) => record.date)).toEqual(['2028-03-31']);
      await setLock('locked');
      expect(
        (await change('emp_njl_1', approved.json.data, 'cancel')).json.code,
      ).toBe('MONTH_LOCKED');
      await setLock('draft');
      expect(
        (await change('emp_njl_1', approved.json.data, 'cancel')).status,
      ).toBe(200);
      expect(
        await db()
          .repository('attendanceRecords')
          .count({ filter: { leaveRequestId: row.id } }),
      ).toBe(0);
    });

    it('does not charge or lock the following month when calendar leave ends at midnight', async () => {
      await monthlyLock('2028-06');
      const id = 'request-test-midnight';
      await db()
        .repository('leaveTypes')
        .createOne({
          values: {
            id,
            code: id,
            title: 'Calendar leave',
            payType: 'unpaid',
            unit: 'day',
            countBy: 'calendar',
            balanceRule: 'none',
            requiresAttachment: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      const valid = await draft({
        leaveTypeId: id,
        startAt: '2028-05-31T09:00:00+08:00',
        endAt: '2028-06-01T00:00:00+08:00',
      });
      expect(valid.duration).toBe(1);
      const submitted = await change('emp_njl_1', valid, 'submit');
      expect(submitted.status).toBe(200);
      expect(submitted.json.data.approvals[0].leaveDates).toEqual([
        '2028-05-31',
      ]);
      expect(
        (await change('emp_njl_1', submitted.json.data, 'cancel')).status,
      ).toBe(200);
    });

    it('saves and publishes schedules for writers only, refusing stale versions', async () => {
      for (const action of ['save', 'publish']) {
        const input = {
          cells: [
            { employeeId: employee.id, date: '2027-12-20', shiftId: null },
          ],
          acknowledgeWarnings: true,
        };
        expect(
          (await call(null, 'POST', `/schedules/${action}`, input)).status,
        ).toBe(401);
        expect(
          (await call('emp_njl_1', 'POST', `/schedules/${action}`, input))
            .status,
        ).toBe(403);
      }
      const saved = await call('mgr_njl', 'POST', '/schedules/save', {
        cells: [
          {
            employeeId: employee.id,
            date: '2027-12-20',
            shiftId: null,
            expectedUpdatedAt: null,
          },
        ],
      });
      expect(saved.status).toBe(200);
      const row = await db()
        .repository('shiftSchedules')
        .findOne({
          filter: (f) =>
            f.and([
              f.string('employeeId').eq(String(employee.id)),
              f.date('date').on('2027-12-20'),
            ]),
        });
      expect(row).toMatchObject({ status: 'draft', shiftId: null });
      // A second writer still holding "no row" is refused.
      const stale = await call('hr01', 'POST', '/schedules/publish', {
        cells: [
          {
            employeeId: employee.id,
            date: '2027-12-20',
            shiftId: null,
            expectedUpdatedAt: null,
          },
        ],
      });
      expect(stale.status).toBe(409);
      expect(stale.json.code).toBe('SCHEDULE_CONFLICT');
      await db()
        .repository('shiftSchedules')
        .deleteOne({ filter: { id: String(row!.id) } });
    });
  });
}

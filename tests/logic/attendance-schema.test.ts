// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const tables = [
  'attendanceRules',
  'shifts',
  'leaveTypes',
  'leaveRequests',
  'shiftSchedules',
  'attendanceRecords',
  'leaveBalances',
  'attendanceAdjustments',
  'attendanceMonthlySummaries',
];
const stamp = {
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

it('applies V2-05 over V1, enforces constraints, converges and reverses without losing employees', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-attendance-schema-'));
  const db = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({
        filename: path.join(directory, 'test.sqlite'),
        schemaManagement: 'managed',
      }),
    },
    metadataStore: new InMemoryCollectionMetadataStore(),
  });
  try {
    const migrator = db.createMigrator({
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
      packageName: 'hr',
    });
    await migrator.upTo('202609290005_create_work_items');
    await db.repository('employees').createOne({
      values: {
        id: 'employee',
        employeeNo: 'TEST-1',
        name: 'Test employee',
        departmentId: 'department',
        ...stamp,
      },
    });
    expect(
      (await migrator.upTo('202609290006_create_attendance_leave')).executed,
    ).toEqual(['202609290006_create_attendance_leave']);
    for (const table of tables) {
      expect(await db.collections().getPhysical(table)).toBeDefined();
      expect(
        (await db.collections().get(table))?.fields?.map((f) => f.name),
      ).toEqual(expect.arrayContaining(['id', 'createdAt', 'updatedAt']));
    }
    expect((await db.collections().get('employees'))?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'careerStartDate',
          type: 'date',
          nullable: true,
        }),
      ]),
    );
    const rule = await db.repository('attendanceRules').createOne({
      values: {
        id: 'rule',
        title: 'Rule',
        departmentIds: ['department'],
        workHourSystem: 'standard',
        punchSource: 'device',
        ...stamp,
      },
    });
    expect(rule.record).toMatchObject({
      lateGraceMinutes: 5,
      monthlyOvertimeAlertHours: 36,
      minRestHours: 11,
      maxConsecutiveNights: 5,
      overtimeRequiresApproval: true,
      active: true,
    });
    const shift = {
      id: 'night',
      code: 'night',
      title: 'Night',
      startTime: '22:00:00',
      endTime: '06:00:00',
      isNight: true,
      ...stamp,
    };
    expect(
      (await db.repository('shifts').createOne({ values: shift })).record,
    ).toMatchObject({ breakMinutes: 30, active: true });
    await expect(
      db
        .repository('shifts')
        .createOne({ values: { ...shift, id: 'duplicate' } }),
    ).rejects.toThrow();
    await db.repository('leaveTypes').createOne({
      values: {
        id: 'annual',
        code: 'annual',
        title: 'Annual',
        payType: 'paid',
        unit: 'day',
        balanceRule: 'annualBySeniority',
        requiresAttachment: false,
        countBy: 'schedule',
        ...stamp,
      },
    });
    const fixtures: Record<string, Record<string, unknown>> = {
      shiftSchedules: {
        employeeId: 'employee',
        date: '2026-09-28',
        shiftId: 'night',
        status: 'draft',
      },
      attendanceRecords: {
        employeeId: 'employee',
        date: '2026-09-28',
        status: 'missingPunch',
        computedAt: stamp.createdAt,
      },
      leaveBalances: {
        employeeId: 'employee',
        leaveTypeId: 'annual',
        year: 2026,
        entitled: 5,
        used: 0,
        pending: 0,
      },
      attendanceMonthlySummaries: {
        employeeId: 'employee',
        month: '2026-09',
        scheduledDays: 1,
        workedDays: 0.5,
        lateCount: 0,
        earlyCount: 0,
        missingCount: 1,
        absentDays: 0,
        leaveByType: {},
        overtimeByType: {},
        nightShiftCount: 1,
        shiftCounts: { night: 1 },
        status: 'draft',
      },
    };
    for (const [table, values] of Object.entries(fixtures)) {
      await db
        .repository(table)
        .createOne({ values: { id: 'first', ...values, ...stamp } });
      await expect(
        db
          .repository(table)
          .createOne({ values: { id: 'duplicate', ...values, ...stamp } }),
      ).rejects.toThrow();
    }
    await expect(
      db.repository('shifts').deleteOne({ filter: { id: 'night' } }),
    ).rejects.toThrow();
    await expect(
      db.repository('shiftSchedules').createOne({
        values: {
          id: 'invalid-employee',
          employeeId: 'missing',
          date: '2026-09-29',
          status: 'draft',
          ...stamp,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.repository('shiftSchedules').createOne({
        values: {
          id: 'invalid-status',
          employeeId: 'employee',
          date: '2026-09-29',
          status: 'bogus',
          ...stamp,
        },
      }),
    ).rejects.toThrow();
    await expect(
      db
        .repository('attendanceRules')
        .createOne({ values: { id: 'missing-required', ...stamp } }),
    ).rejects.toThrow();
    expect(
      (await migrator.upTo('202609290006_create_attendance_leave')).executed,
    ).toEqual([]);
    expect(await db.repository('shiftSchedules').count()).toBe(1);
    expect((await migrator.rollback()).rolledBack).toEqual([
      '202609290006_create_attendance_leave',
    ]);
    for (const table of tables)
      expect(await db.collections().getPhysical(table)).toBeUndefined();
    expect(
      (await db.collections().get('employees'))?.fields?.some(
        (f) => f.name === 'careerStartDate',
      ),
    ).toBe(false);
    expect(await db.repository('employees').count()).toBe(1);
    expect(
      (await migrator.upTo('202609290006_create_attendance_leave')).executed,
    ).toEqual(['202609290006_create_attendance_leave']);
    expect(
      (await migrator.upTo('202609290006_create_attendance_leave')).executed,
    ).toEqual([]);
    expect(await db.repository('employees').count()).toBe(1);
    // Later steps' migrations follow; the leave proof table comes first.
    expect((await migrator.latest()).executed[0]).toBe(
      '202609290007_create_leave_proof_files',
    );
    expect((await db.collections().get('leaveProofFiles'))?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'uploadedByUserId', nullable: false }),
        expect.objectContaining({ name: 'size', type: 'bigInt' }),
      ]),
    );
    expect(await db.collections().getPhysical('leaveProofFiles')).toBeDefined();
    expect((await migrator.latest()).executed).toEqual([]);
    // The latest batch holds the later steps' migrations too; 007 is rolled back last.
    const rolledBack = (await migrator.rollback()).rolledBack;
    expect(rolledBack.at(-1)).toBe('202609290007_create_leave_proof_files');
    expect(rolledBack).toContain('202609290011_extend_attendance');
    expect(
      await db.collections().getPhysical('leaveProofFiles'),
    ).toBeUndefined();
    expect(await db.collections().getPhysical('leaveRequests')).toBeDefined();
    expect(await db.repository('employees').count()).toBe(1);
    // Later steps' migrations follow; the leave proof table comes first.
    expect((await migrator.latest()).executed[0]).toBe(
      '202609290007_create_leave_proof_files',
    );
    expect((await migrator.latest()).executed).toEqual([]);
    expect((await db.collections().diagnose()).issues).toEqual([]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 60_000);

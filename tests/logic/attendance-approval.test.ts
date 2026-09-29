import { describe, expect, it } from 'vitest';
import { planAttendanceApproval } from '../../server/providers/hr/attendance-approval.ts';

const base = {
  type: 'leave' as const,
  employeeUserId: 'employee',
  submittedBy: 'employee',
  departmentId: 'workshop',
  departments: [
    { id: 'workshop', parentId: 'plant', managerId: 'manager' },
    { id: 'plant', parentId: 'root', managerId: 'director' },
    { id: 'root', parentId: null, managerId: 'root-manager' },
  ],
  leaveDays: 3,
  leaveSecondLevelDays: 3,
  monthlyOvertimeAlertHours: 36,
};

describe('V2-05 approval planning', () => {
  it('uses one manager for three days and adds HR above the configured threshold', () => {
    expect(planAttendanceApproval(base).map((s) => s.kind)).toEqual([
      'departmentHead',
    ]);
    expect(
      planAttendanceApproval({ ...base, leaveDays: 4 }).map((s) => s.kind),
    ).toEqual(['departmentHead', 'hrAdmin']);
    expect(
      planAttendanceApproval({ ...base, leaveSecondLevelDays: 2 }).at(-1)
        ?.status,
    ).toBe('waiting');
  });
  it('requires HR for fixed-per-event leave even below the threshold', () => {
    expect(
      planAttendanceApproval({
        ...base,
        leaveDays: 1,
        leaveBalanceRule: 'fixedPerEvent',
      }).at(-1)?.kind,
    ).toBe('hrAdmin');
  });
  it('escalates departments without a manager', () => {
    expect(
      planAttendanceApproval({
        ...base,
        departments: base.departments.map((d) =>
          d.id === 'workshop' ? { ...d, managerId: null } : d,
        ),
      })[0].approverUserId,
    ).toBe('director');
  });
  it('skips every repeated self-approver and the HR submitter', () => {
    expect(
      planAttendanceApproval({
        ...base,
        employeeUserId: 'manager',
        submittedBy: 'director',
      })[0].approverUserId,
    ).toBe('root-manager');
    expect(
      planAttendanceApproval({
        ...base,
        employeeUserId: 'manager',
        submittedBy: 'manager',
        departments: base.departments.map((d) =>
          d.id === 'plant' ? { ...d, managerId: 'manager' } : d,
        ),
      })[0].approverUserId,
    ).toBe('root-manager');
  });
  it('never automatically approves when the hierarchy has no eligible manager', () => {
    expect(() =>
      planAttendanceApproval({
        ...base,
        departments: base.departments.map((d) => ({ ...d, managerId: null })),
      }),
    ).toThrow('APPROVER_NOT_CONFIGURED');
  });
  it('puts the counterparty before the manager for a swap', () => {
    expect(
      planAttendanceApproval({
        ...base,
        type: 'shiftSwap',
        counterpartyUserId: 'colleague',
      }),
    ).toEqual([
      {
        kind: 'counterparty',
        approverUserId: 'colleague',
        departmentId: null,
        status: 'pending',
      },
      {
        kind: 'departmentHead',
        approverUserId: 'manager',
        departmentId: 'workshop',
        status: 'waiting',
      },
    ]);
  });
  it('does not let the swap counterparty also approve as manager', () => {
    expect(
      planAttendanceApproval({
        ...base,
        type: 'shiftSwap',
        counterpartyUserId: 'manager',
      })[1].approverUserId,
    ).toBe('director');
  });
  it.each([undefined, 'employee'])(
    'rejects a missing or self counterparty: %s',
    (counterpartyUserId) => {
      expect(() =>
        planAttendanceApproval({
          ...base,
          type: 'shiftSwap',
          counterpartyUserId,
        }),
      ).toThrow('INVALID_COUNTERPARTY');
    },
  );
  it('adds HR only when projected overtime exceeds the threshold', () => {
    expect(
      planAttendanceApproval({
        ...base,
        type: 'overtime',
        projectedMonthlyOvertimeHours: 36,
      }),
    ).toHaveLength(1);
    expect(
      planAttendanceApproval({
        ...base,
        type: 'overtime',
        projectedMonthlyOvertimeHours: 36.5,
      }),
    ).toHaveLength(2);
  });
  it.each([0, -1, NaN, Infinity])(
    'rejects invalid leave duration %s',
    (leaveDays) => {
      expect(() => planAttendanceApproval({ ...base, leaveDays })).toThrow(
        'INVALID_INPUT',
      );
    },
  );
  it('rejects broken hierarchies rather than hanging or granting approval', () => {
    expect(() =>
      planAttendanceApproval({
        ...base,
        departments: [
          { id: 'workshop', parentId: 'workshop', managerId: null },
        ],
      }),
    ).toThrow('INVALID_DEPARTMENT_TREE');
    expect(() => planAttendanceApproval({ ...base, departments: [] })).toThrow(
      'INVALID_DEPARTMENT_TREE',
    );
  });
});

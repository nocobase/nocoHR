/**
 * V2-05 业务操作: 考勤记录 (`talent.attendanceRecord`) and 考勤调整申请
 * (`talent.adjustment`). Each grant scopes which employees the action reaches
 * (hr.admin all, hr.manager managedDepartments, hr.employee self); the
 * services read the rest of a record's data after that check. Records and
 * summaries are written by the attendance engine, never through a grant.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import { label } from './shared.js';

const employees = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .read([
      'id',
      'employeeNo',
      'name',
      'departmentId',
      'positionId',
      'status',
      'userId',
      'hireDate',
      'leaveDate',
    ]),
);
const records = defineDatabasePermission((p) =>
  p
    .collection('attendanceRecords')
    .read([
      'id',
      'employeeId',
      'date',
      'shiftId',
      'punches',
      'checkIn',
      'checkOut',
      'status',
      'lateMinutes',
      'earlyMinutes',
      'workedMinutes',
      'overtimeMinutes',
      'leaveRequestId',
      'excusedByAdjustmentId',
      'inquiry',
      'computedAt',
    ]),
);
const SUMMARY_FIELDS = [
  'id',
  'employeeId',
  'month',
  'scheduledDays',
  'workedDays',
  'lateCount',
  'earlyCount',
  'missingCount',
  'absentDays',
  'leaveByType',
  'overtimeByType',
  'nightShiftCount',
  'shiftCounts',
  'status',
  'objection',
  'confirmedAt',
  'lockedBy',
  'lockedAt',
  'lockLog',
  'updatedAt',
];
const summaries = defineDatabasePermission((p) =>
  p.collection('attendanceMonthlySummaries').read(SUMMARY_FIELDS),
);
const summaryWrite = defineDatabasePermission((p) =>
  p
    .collection('attendanceMonthlySummaries')
    .read(SUMMARY_FIELDS)
    .update([
      'status',
      'objection',
      'confirmedAt',
      'lockedBy',
      'lockedAt',
      'lockLog',
      'updatedAt',
    ]),
);
const ADJUSTMENT_FIELDS = [
  'id',
  'type',
  'employeeId',
  'date',
  'details',
  'reason',
  'status',
  'approvals',
  'source',
  // 界面追加字段 values (migration 202609300005).
  'customFields',
  'createdAt',
  'updatedAt',
];
const adjustments = defineDatabasePermission((p) =>
  p
    .collection('attendanceAdjustments')
    .read(ADJUSTMENT_FIELDS)
    .create(ADJUSTMENT_FIELDS)
    .update(['status', 'approvals', 'customFields', 'updatedAt']),
);

export const attendanceRecordResource = defineCompositeResource(
  'talent.attendanceRecord',
  (r) =>
    r
      .title(label('attendance.recordActions.title'))
      .action('view', (a) =>
        a
          .title(label('attendance.recordActions.view'))
          .grant('employees', employees)
          .grant('records', records)
          .grant('summaries', summaryWrite),
      )
      .action('import', (a) =>
        a
          .title(label('attendance.recordActions.import'))
          .grant('employees', employees)
          .grant('records', records),
      )
      .action('recompute', (a) =>
        a
          .title(label('attendance.recordActions.recompute'))
          .grant('employees', employees)
          .grant('records', records),
      )
      .action('lock', (a) =>
        a
          .title(label('attendance.recordActions.lock'))
          .grant('employees', employees)
          .grant('summaries', summaryWrite),
      )
      .action('unlock', (a) =>
        a
          .title(label('attendance.recordActions.unlock'))
          .grant('employees', employees)
          .grant('summaries', summaries),
      ),
);

export const adjustmentResource = defineCompositeResource(
  'talent.adjustment',
  (r) =>
    r
      .title(label('attendance.adjustmentActions.title'))
      .action('request', (a) =>
        a
          .title(label('attendance.adjustmentActions.request'))
          .grant('employees', employees)
          .grant('adjustments', adjustments),
      )
      .action('approve', (a) =>
        a
          .title(label('attendance.adjustmentActions.approve'))
          .grant('employees', employees)
          .grant('adjustments', adjustments),
      ),
);

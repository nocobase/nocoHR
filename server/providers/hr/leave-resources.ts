import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { label } from './shared.js';

export const LEAVE_TYPE_FIELDS = [
  'id',
  'code',
  'title',
  'payType',
  'unit',
  'balanceRule',
  'fixedDays',
  'requiresAttachment',
  'countBy',
  'active',
  'createdAt',
  'updatedAt',
];
export const LEAVE_BALANCE_FIELDS = [
  'id',
  'employeeId',
  'leaveTypeId',
  'year',
  'entitled',
  'carriedOver',
  'used',
  'pending',
  'expiresAt',
  'adjustments',
  'createdAt',
  'updatedAt',
];
export const LEAVE_REQUEST_FIELDS = [
  'id',
  'employeeId',
  'leaveTypeId',
  'startAt',
  'endAt',
  'duration',
  'reason',
  'attachmentFileId',
  'status',
  'approvals',
  'source',
  // 界面追加字段 values (migration 202609300005); the service projects them per reader.
  'customFields',
  'createdAt',
  'updatedAt',
];
const types = defineDatabasePermission((p) =>
  p.collection('leaveTypes').read(LEAVE_TYPE_FIELDS),
);
const balances = defineDatabasePermission((p) =>
  p.collection('leaveBalances').read(LEAVE_BALANCE_FIELDS),
);
const employees = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .read([
      'id',
      'employeeNo',
      'name',
      'userId',
      'departmentId',
      'status',
      'hireDate',
      'careerStartDate',
      'leaveDate',
    ]),
);
const settings = defineDatabasePermission((p) =>
  p
    .collection('personnelSettings')
    .read(['id', 'value', 'revision'])
    .update(['revision', 'updatedBy', 'updatedAt']),
);
const requestSettings = defineDatabasePermission((p) =>
  p.collection('personnelSettings').read(['id', 'value', 'revision']),
);
const requests = defineDatabasePermission((p) =>
  p.collection('leaveRequests').read(LEAVE_REQUEST_FIELDS),
);
const requestWrite = defineDatabasePermission((p) =>
  p
    .collection('leaveRequests')
    .read(LEAVE_REQUEST_FIELDS)
    .create(LEAVE_REQUEST_FIELDS)
    .update(LEAVE_REQUEST_FIELDS),
);
const requestEmployee = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .read([
      'id',
      'employeeNo',
      'name',
      'userId',
      'departmentId',
      'status',
      'hireDate',
      'leaveDate',
    ]),
);
const requestTypes = defineDatabasePermission((p) =>
  p.collection('leaveTypes').read(LEAVE_TYPE_FIELDS),
);
const requestBalances = defineDatabasePermission((p) =>
  p
    .collection('leaveBalances')
    .read(LEAVE_BALANCE_FIELDS)
    .update(['pending', 'used', 'updatedAt']),
);
const requestSchedules = defineDatabasePermission((p) =>
  p
    .collection('shiftSchedules')
    .read(['id', 'employeeId', 'date', 'shiftId', 'status', 'checkResult'])
    .update(['checkResult', 'updatedAt']),
);
const requestAttendance = defineDatabasePermission((p) =>
  p
    .collection('attendanceRecords')
    .read(['id', 'employeeId', 'date', 'shiftId', 'status', 'leaveRequestId'])
    .create([
      'id',
      'employeeId',
      'date',
      'shiftId',
      'status',
      'leaveRequestId',
      'computedAt',
      'createdAt',
      'updatedAt',
    ])
    .update(['status', 'leaveRequestId', 'computedAt', 'updatedAt']),
);

export const leaveResource = defineCompositeResource(
  'talent.leaveRequest',
  (r) =>
    r
      .title(label('attendance.leave.title'))
      .action('manageTypes', (a) =>
        a
          .title(label('attendance.leave.manageTypes'))
          .grant(
            'types',
            types
              .create(LEAVE_TYPE_FIELDS)
              .update(
                LEAVE_TYPE_FIELDS.filter(
                  (f) => f !== 'id' && f !== 'createdAt',
                ),
              ),
          )
          .grant('balances', balances)
          .grant('requests', requests)
          .grant('configuration', settings),
      )
      .action('adjustBalance', (a) =>
        a
          .title(label('attendance.leave.adjustBalance'))
          .grant('types', types)
          .grant('employees', employees)
          .grant(
            'balances',
            balances
              .create(LEAVE_BALANCE_FIELDS)
              .update(['adjustments', 'updatedAt']),
          )
          .grant('configuration', settings),
      )
      // 初始数据导入: 期初余额 from Excel, each written as a 期初导入 adjustment (hr.admin, seed 202610270101).
      .action('importBalances', (a) =>
        a
          .title(label('dataImport.authz.importBalances'))
          .grant('types', types)
          .grant('employees', employees)
          .grant(
            'balances',
            balances
              .create(LEAVE_BALANCE_FIELDS)
              .update(['adjustments', 'updatedAt']),
          ),
      )
      .action('request', (a) =>
        a
          .title(label('attendance.leave.request'))
          .grant('requests', requestWrite)
          .grant('employees', requestEmployee)
          .grant('types', requestTypes)
          .grant('balances', requestBalances)
          .grant('schedules', requestSchedules)
          .grant('attendance', requestAttendance)
          .grant('configuration', requestSettings),
      )
      .action('approve', (a) =>
        a
          .title(label('attendance.leave.approve'))
          .grant('requests', requestWrite)
          .grant('employees', requestEmployee)
          .grant('types', requestTypes)
          .grant('balances', requestBalances)
          .grant('schedules', requestSchedules)
          .grant('attendance', requestAttendance)
          .grant('configuration', requestSettings),
      ),
);

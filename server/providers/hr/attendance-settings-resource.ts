import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { label } from './shared.js';

const fields = [
  'id',
  'value',
  'revision',
  'updatedBy',
  'createdAt',
  'updatedAt',
];
const configuration = defineDatabasePermission((p) =>
  p
    .collection('personnelSettings')
    .title(label('attendance.settings.title'))
    .read(fields)
    .create(fields)
    .update(['value', 'revision', 'updatedBy', 'updatedAt']),
);

export const SHIFT_FIELDS = [
  'code',
  'title',
  'startTime',
  'endTime',
  'breakMinutes',
  'isNight',
  'departmentIds',
  'active',
];
export const RULE_FIELDS = [
  'title',
  'departmentIds',
  'workHourSystem',
  'punchSource',
  'lateGraceMinutes',
  'overtimeRequiresApproval',
  'monthlyOvertimeAlertHours',
  'minRestHours',
  'maxConsecutiveNights',
  'exceptionExcusable',
  'active',
];
const catalog = (name: string, editable: string[]) =>
  defineDatabasePermission((p) =>
    p
      .collection(name)
      .read(['id', ...editable, 'createdAt', 'updatedAt'])
      .create(['id', ...editable, 'createdAt', 'updatedAt'])
      .update([...editable, 'updatedAt']),
  );
const departmentData = defineDatabasePermission((p) =>
  p.collection('departments').read(['id', 'title', 'parentId', 'active']),
);
const scheduleData = defineDatabasePermission((p) =>
  p.collection('shiftSchedules').read(['id', 'shiftId']),
);

export const attendanceSettingsResource = defineCompositeResource(
  'talent.attendanceSettings',
  (r) =>
    r
      .title(label('attendance.settings.title'))
      .action('manage', (a) =>
        a
          .title(label('attendance.settings.manage'))
          .grant('configuration', configuration)
          .grant('shifts', catalog('shifts', SHIFT_FIELDS))
          .grant('rules', catalog('attendanceRules', RULE_FIELDS))
          .grant('departments', departmentData)
          .grant('schedules', scheduleData),
      ),
);

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
      'status',
      'hireDate',
      'leaveDate',
    ]),
);
const shifts = defineDatabasePermission((p) =>
  p
    .collection('shifts')
    .read([
      'id',
      'code',
      'title',
      'startTime',
      'endTime',
      'breakMinutes',
      'isNight',
      'departmentIds',
      'active',
    ]),
);
const schedules = defineDatabasePermission((p) =>
  p
    .collection('shiftSchedules')
    .read([
      'id',
      'employeeId',
      'date',
      'shiftId',
      'status',
      'checkResult',
      'replacementSuggestion',
      'publishedBy',
      'publishedAt',
      'publishedShiftId',
      'updatedAt',
    ]),
);
const SCHEDULE_WRITE_FIELDS = [
  'id',
  'employeeId',
  'date',
  'shiftId',
  'status',
  'checkResult',
  'replacementSuggestion',
  'publishedBy',
  'publishedAt',
  'publishedShiftId',
  'createdAt',
  'updatedAt',
];

export const scheduleResource = defineCompositeResource(
  'talent.schedule',
  (r) =>
    r
      .title(label('attendance.schedules.title'))
      .action('view', (a) =>
        a
          .title(label('attendance.schedules.view'))
          .grant('employees', employees)
          .grant('shifts', shifts)
          .grant('schedules', schedules),
      )
      .action('edit', (a) =>
        a
          .title(label('attendance.schedules.edit'))
          .grant('employees', employees)
          .grant('shifts', shifts)
          .grant(
            'schedules',
            schedules
              .create(SCHEDULE_WRITE_FIELDS)
              .update(SCHEDULE_WRITE_FIELDS),
          ),
      )
      .action('publish', (a) =>
        a
          .title(label('attendance.schedules.publish'))
          .grant('employees', employees)
          .grant('shifts', shifts)
          // Publishing a cell that has no row yet creates it (POST /schedules/publish),
          // so publish may create as well as update, within the same record scope.
          .grant(
            'schedules',
            schedules
              .create(SCHEDULE_WRITE_FIELDS)
              .update(SCHEDULE_WRITE_FIELDS),
          ),
      ),
);

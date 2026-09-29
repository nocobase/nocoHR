import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/** V2-05 schema only: no API, permission grants, sample data or approval side effects. */
const migration: MigrationDefinition = defineMigration({
  name: '202609290006_create_attendance_leave',
  async up({ builder }) {
    await builder.alterCollection('employees', (c) => {
      c.date('careerStartDate').nullable();
    });
    await builder.createCollection('attendanceRules', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title').notNull();
      c.json('departmentIds').notNull();
      c.enum('workHourSystem', {
        values: ['standard', 'comprehensive', 'flexible'],
      }).notNull();
      c.enum('punchSource', {
        values: ['feishu', 'dingtalk', 'wecom', 'device'],
      }).notNull();
      c.integer('lateGraceMinutes').notNull().defaultTo(5);
      c.boolean('overtimeRequiresApproval').notNull().defaultTo(true);
      c.integer('monthlyOvertimeAlertHours').notNull().defaultTo(36);
      c.integer('minRestHours').notNull().defaultTo(11);
      c.integer('maxConsecutiveNights').notNull().defaultTo(5);
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('shifts', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code').notNull();
      c.string('title').notNull();
      c.time('startTime').notNull();
      c.time('endTime').notNull();
      c.integer('breakMinutes').notNull().defaultTo(30);
      c.boolean('isNight').notNull();
      c.json('departmentIds').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['code']);
    });
    await builder.createCollection('leaveTypes', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code').notNull();
      c.string('title').notNull();
      c.enum('payType', { values: ['paid', 'partial', 'unpaid'] }).notNull();
      c.enum('unit', { values: ['day', 'halfDay', 'hour'] }).notNull();
      c.enum('balanceRule', {
        values: ['annualBySeniority', 'fixedPerEvent', 'earned', 'none'],
      }).notNull();
      c.decimal('fixedDays', { precision: 12, scale: 4 }).nullable();
      c.boolean('requiresAttachment').notNull();
      c.enum('countBy', {
        values: ['workdays', 'schedule', 'calendar'],
      }).notNull();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['code']);
    });
    await builder.createCollection('leaveRequests', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('leaveTypeId', { length: 64 }).notNull();
      c.foreignKey('leaveTypeId', {
        references: { collection: 'leaveTypes', fields: ['id'] },
      });
      c.datetime('startAt').notNull();
      c.datetime('endAt').notNull();
      c.decimal('duration', { precision: 12, scale: 4 }).notNull();
      c.string('reason').nullable();
      c.string('attachmentFileId').nullable();
      c.enum('status', {
        values: ['draft', 'pending', 'approved', 'rejected', 'cancelled'],
      }).notNull();
      c.json('approvals').nullable();
      c.enum('source', { values: ['self', 'hrAssistant', 'hr'] }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'status', 'startAt']);
    });
    await builder.createCollection('shiftSchedules', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.date('date').notNull();
      c.string('shiftId', { length: 64 }).nullable();
      c.foreignKey('shiftId', {
        references: { collection: 'shifts', fields: ['id'] },
      });
      c.enum('status', { values: ['draft', 'published'] }).notNull();
      c.json('checkResult').nullable();
      c.json('replacementSuggestion').nullable();
      c.string('publishedBy').nullable();
      c.datetime('publishedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'date']);
    });
    await builder.createCollection('attendanceRecords', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.date('date').notNull();
      c.string('shiftId', { length: 64 }).nullable();
      c.foreignKey('shiftId', {
        references: { collection: 'shifts', fields: ['id'] },
      });
      c.json('punches').nullable();
      c.datetime('checkIn').nullable();
      c.datetime('checkOut').nullable();
      c.enum('status', {
        values: [
          'normal',
          'late',
          'earlyLeave',
          'missingPunch',
          'absent',
          'leave',
          'rest',
        ],
      }).notNull();
      c.integer('lateMinutes').nullable();
      c.integer('earlyMinutes').nullable();
      c.integer('workedMinutes').nullable();
      c.integer('overtimeMinutes').nullable();
      c.string('leaveRequestId', { length: 64 }).nullable();
      c.foreignKey('leaveRequestId', {
        references: { collection: 'leaveRequests', fields: ['id'] },
      });
      c.datetime('computedAt').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'date']);
    });
    await builder.createCollection('leaveBalances', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('leaveTypeId', { length: 64 }).notNull();
      c.foreignKey('leaveTypeId', {
        references: { collection: 'leaveTypes', fields: ['id'] },
      });
      c.integer('year').notNull();
      c.decimal('entitled', { precision: 12, scale: 4 }).notNull();
      c.decimal('carriedOver', { precision: 12, scale: 4 })
        .notNull()
        .defaultTo(0);
      c.decimal('used', { precision: 12, scale: 4 }).notNull();
      c.decimal('pending', { precision: 12, scale: 4 }).notNull();
      c.date('expiresAt').nullable();
      c.json('adjustments').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'leaveTypeId', 'year']);
    });
    await builder.createCollection('attendanceAdjustments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.enum('type', {
        values: ['missingPunch', 'overtime', 'shiftSwap'],
      }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.date('date').notNull();
      c.json('details').notNull();
      c.string('reason').notNull();
      c.enum('status', {
        values: ['pending', 'approved', 'rejected', 'cancelled'],
      }).notNull();
      c.json('approvals').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'date', 'status']);
    });
    await builder.createCollection('attendanceMonthlySummaries', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('month').notNull();
      c.decimal('scheduledDays', { precision: 12, scale: 4 }).notNull();
      c.decimal('workedDays', { precision: 12, scale: 4 }).notNull();
      c.integer('lateCount').notNull();
      c.integer('earlyCount').notNull();
      c.integer('missingCount').notNull();
      c.decimal('absentDays', { precision: 12, scale: 4 }).notNull();
      c.json('leaveByType').notNull();
      c.json('overtimeByType').notNull();
      c.integer('nightShiftCount').notNull();
      c.json('shiftCounts').notNull();
      c.enum('status', { values: ['draft', 'confirmed', 'locked'] }).notNull();
      c.json('objection').nullable();
      c.datetime('confirmedAt').nullable();
      c.string('lockedBy').nullable();
      c.datetime('lockedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'month']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('attendanceMonthlySummaries');
    await builder.dropCollection('attendanceAdjustments');
    await builder.dropCollection('leaveBalances');
    await builder.dropCollection('attendanceRecords');
    await builder.dropCollection('shiftSchedules');
    await builder.dropCollection('leaveRequests');
    await builder.dropCollection('leaveTypes');
    await builder.dropCollection('shifts');
    await builder.dropCollection('attendanceRules');
    await builder.dropField('employees', 'careerStartDate');
  },
});

export default migration;

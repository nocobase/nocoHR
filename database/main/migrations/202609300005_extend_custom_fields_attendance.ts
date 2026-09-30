import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 界面追加字段 for V2-05 考勤与假期: `customFields` on `leaveRequests`,
 * `attendanceAdjustments` and `shifts` holds the values of administrator-added
 * fields (总纲 可定制约定, e.g. 请假单的“工作交接人”), keyed by the
 * definition's internal key.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609300005_extend_custom_fields_attendance',
  async up({ builder }) {
    await builder.alterCollection('leaveRequests', (c) => {
      c.json('customFields').nullable();
    });
    await builder.alterCollection('attendanceAdjustments', (c) => {
      c.json('customFields').nullable();
    });
    await builder.alterCollection('shifts', (c) => {
      c.json('customFields').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('shifts', (c) => {
      c.dropFields('customFields');
    });
    await builder.alterCollection('attendanceAdjustments', (c) => {
      c.dropFields('customFields');
    });
    await builder.alterCollection('leaveRequests', (c) => {
      c.dropFields('customFields');
    });
  },
});

export default migration;

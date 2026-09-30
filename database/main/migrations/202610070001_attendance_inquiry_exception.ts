import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-05 (realigned) 考勤异常追问、考勤异常说明与顶班邀请:
 *
 * - `attendanceRules.exceptionExcusable` (允许说明豁免, default true): an
 *   approved 考勤异常说明 keeps that late arrival or early leave out of the
 *   monthly counts;
 * - `attendanceRecords.excusedByAdjustmentId`: the approved 考勤异常说明 of the
 *   day (shown as 已说明); a plain column, no foreign key or index, so the
 *   `down` can drop it on SQLite;
 * - `attendanceRecords.inquiry`: the HR assistant's question about the
 *   anomaly, {askedAt, channel, reply, repliedAt, draftAdjustmentId}; the
 *   employee's reply is kept only here, never in run records;
 * - `attendanceAdjustments`: the type `exception`, the status `draft` (drafted
 *   by the HR assistant, submitted by the employee) and `source` (self /
 *   hrAssistant).
 *
 * `shiftSchedules.replacementSuggestion.invitations` needs no column: it is
 * part of that JSON value.
 *
 * The `down` drops the added columns. Enum members cannot be removed by an
 * ordinary metadata change, so `exception` and `draft` stay allowed values
 * after a rollback; rows using them are removed first, as they did not
 * exist before this migration.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610070001_attendance_inquiry_exception',
  async up({ builder }) {
    await builder.alterCollection('attendanceRules', (c) => {
      c.boolean('exceptionExcusable').notNull().defaultTo(true);
    });
    await builder.alterCollection('attendanceRecords', (c) => {
      c.string('excusedByAdjustmentId', { length: 64 }).nullable();
      c.json('inquiry').nullable();
    });
    await builder.alterCollection('attendanceAdjustments', (c) => {
      c.alterField('type', {
        values: ['missingPunch', 'overtime', 'shiftSwap', 'exception'],
      });
      c.alterField('status', {
        values: ['draft', 'pending', 'approved', 'rejected', 'cancelled'],
      });
      c.enum('source', { values: ['self', 'hrAssistant'] })
        .notNull()
        .defaultTo('self');
    });
  },
  async down({ builder, query }) {
    await query
      .deleteFrom('attendanceAdjustments')
      .where((eb) =>
        eb.or([eb('type', '=', 'exception'), eb('status', '=', 'draft')]),
      )
      .execute();
    await builder.alterCollection('attendanceAdjustments', (c) => {
      c.dropFields('source');
    });
    await builder.alterCollection('attendanceRecords', (c) => {
      c.dropFields('excusedByAdjustmentId', 'inquiry');
    });
    await builder.alterCollection('attendanceRules', (c) => {
      c.dropFields('exceptionExcusable');
    });
  },
});

export default migration;

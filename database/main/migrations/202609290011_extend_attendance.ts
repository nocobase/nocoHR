import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-05 考勤闭环, the fields the first attendance tables left out:
 *
 * - `attendanceMonthlySummaries.lockLog`: every lock and unlock, with who,
 *   when and — for an unlock, which only hr.admin may do — the reason;
 * - `shiftSchedules.publishedShiftId`: the shift employees were last told
 *   about, so a change to a published cell notifies the people it concerns
 *   and a re-publish of the same shift does not.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290011_extend_attendance',
  async up({ builder }) {
    await builder.alterCollection('attendanceMonthlySummaries', (c) => {
      c.json('lockLog').nullable();
    });
    await builder.alterCollection('shiftSchedules', (c) => {
      c.string('publishedShiftId', { length: 64 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('shiftSchedules', (c) => {
      c.dropFields('publishedShiftId');
    });
    await builder.alterCollection('attendanceMonthlySummaries', (c) => {
      c.dropFields('lockLog');
    });
  },
});

export default migration;

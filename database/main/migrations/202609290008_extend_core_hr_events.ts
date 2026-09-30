import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1 step 2, the fields the first implementation left out:
 *
 * - `jobEvents.source` (action | manual | import), `note` for a manual
 *   correction's reason, and `processedAt` for the job-event handler;
 * - `personnelActions.fromDepartmentId` / `fromPositionId` as they were when
 *   the action was raised, `approvalDepartmentId` the chain was resolved for,
 *   and `currentApproverUserIds` for the "awaiting me" inbox;
 * - `profileChangeRequests.source` (self | ai), with the attachment and the
 *   per-field confidence an HR-assistant extraction was based on.
 *
 * Existing events are backfilled: one with an action came from it, the rest
 * were written by an import. They are marked processed, since their only
 * handler — refreshing the employee's session — already ran when they were
 * written.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290008_extend_core_hr_events',
  async up({ builder, query }) {
    await builder.alterCollection('jobEvents', (c) => {
      c.string('source', { length: 16 }).notNull().defaultTo('import');
      c.text('note').nullable();
      c.datetime('processedAt').nullable();
      c.index('processedAt', { name: 'job_events_processed_index' });
    });
    await query
      .updateTable('jobEvents')
      .set({ source: 'action' })
      .where('actionId', 'is not', null)
      .execute();
    await query
      .updateTable('jobEvents')
      .set({ processedAt: new Date() })
      .allowAllRows()
      .execute();
    await builder.alterCollection('personnelActions', (c) => {
      c.string('fromDepartmentId', { length: 64 }).nullable();
      c.string('fromPositionId', { length: 64 }).nullable();
      c.string('approvalDepartmentId', { length: 64 }).nullable();
      c.json('currentApproverUserIds').nullable();
    });
    await builder.alterCollection('profileChangeRequests', (c) => {
      c.string('source', { length: 16 }).notNull().defaultTo('self');
      c.string('attachmentFileId', { length: 64 }).nullable();
      c.json('confidence').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('profileChangeRequests', (c) => {
      c.dropFields('source', 'attachmentFileId', 'confidence');
    });
    await builder.alterCollection('personnelActions', (c) => {
      c.dropFields(
        'fromDepartmentId',
        'fromPositionId',
        'approvalDepartmentId',
        'currentApproverUserIds',
      );
    });
    // Dropping processedAt drops its index; on SQLite the altered table never
    // received the named index, so dropping it by name fails.
    await builder.alterCollection('jobEvents', (c) => {
      c.dropFields('source', 'note', 'processedAt');
    });
  },
});

export default migration;

import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-09 学习与培训, the remaining assignment fields:
 *
 * - `jobEventId`: the job event (onboard, transfer, promote) that assigned an
 *   onboarding path automatically; a retried event finds it and assigns
 *   nothing again.
 * - `cancelReason` (manual | offboard | jobChange | parentCancelled) and
 *   `cancelJobEventId`, the event that cancelled a task, so the event's
 *   学习处理 block and the change checklist list what the change ended.
 * - `lagEscalatedAt`: when the learning coach told the head the task lags;
 *   once per task, separate from the certification steward's `escalatedAt`.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610030001_extend_learning_job_events',
  async up({ builder }) {
    await builder.alterCollection('assignments', (c) => {
      c.string('jobEventId', { length: 64 }).nullable();
      c.string('cancelReason', { length: 16 }).nullable();
      c.string('cancelJobEventId', { length: 64 }).nullable();
      c.datetime('lagEscalatedAt').nullable();
      c.index('jobEventId', { name: 'assignments_job_event_index' });
      c.index('cancelJobEventId', {
        name: 'assignments_cancel_job_event_index',
      });
    });
  },
  async down({ builder }) {
    // Dropping the columns drops their indexes; on SQLite the altered table never
    // received the named indexes, so dropping them by name fails.
    await builder.alterCollection('assignments', (c) => {
      c.dropFields(
        'jobEventId',
        'cancelReason',
        'cancelJobEventId',
        'lagEscalatedAt',
      );
    });
  },
});

export default migration;

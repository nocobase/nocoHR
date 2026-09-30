import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-10 考试与认证, the parts 10A/10B still missed:
 *
 * - `certifications.qualifiesPositionId`: a certification can be the
 *   任职资格认证 of a position. Holding it means "qualified for the position";
 *   it never changes the holder's position.
 * - `examAttempts.resetAt`: when an instructor reset the candidate's
 *   attempts. Attempts voided after an integrity review keep counting
 *   against the limit (they carry `voidReason`) until a reset stamps them;
 *   failed attempts stop counting when a reset voids them, as before.
 * - `certificateScanFiles`: File Repository storage for the scans of
 *   external certificates, kept apart from personnel files and leave proofs.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610040001_extend_exams_certification',
  async up({ builder }) {
    await builder.alterCollection('certifications', (c) => {
      c.string('qualifiesPositionId', { length: 64 }).nullable();
      c.index('qualifiesPositionId', {
        name: 'certifications_qualifies_position_index',
      });
    });
    await builder.alterCollection('examAttempts', (c) => {
      c.datetime('resetAt').nullable();
    });
    await builder.createCollection('certificateScanFiles', (collection) => {
      collection.uuid('id').primary().notNull();
      collection.string('disk', { length: 255 }).notNull();
      collection.text('key').notNull();
      collection.text('filename').notNull();
      collection.string('ext', { length: 32 }).notNull();
      collection.string('mimeType', { length: 255 }).notNull();
      collection.bigInt('size').notNull();
      collection.datetime('createdAt').notNull();
      collection.datetime('updatedAt').notNull();
      collection.string('uploadedByUserId', { length: 255 }).notNull();
      collection.index('uploadedByUserId', {
        name: 'certificate_scan_files_uploader_index',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('certificateScanFiles');
    await builder.alterCollection('examAttempts', (c) => {
      c.dropField('resetAt');
    });
    // Dropping the column drops its index; on SQLite the index added in alterCollection has no stable name to drop.
    await builder.alterCollection('certifications', (c) => {
      c.dropField('qualifiesPositionId');
    });
  },
});

export default migration;

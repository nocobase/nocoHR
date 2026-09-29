import { defineMigration, type MigrationDefinition } from '@nocobase/db';

// Sensitive leave evidence must not share hrFiles' personnel/course/KB paths.
// This is File Repository infrastructure, not another attendance business entity.
const migration: MigrationDefinition = defineMigration({
  name: '202609290007_create_leave_proof_files',
  async up({ builder }) {
    await builder.createCollection('leaveProofFiles', (collection) => {
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
      collection.index('uploadedByUserId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('leaveProofFiles');
  },
});

export default migration;

import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1-02 一句话改配置: the HR assistant turns an administrator's sentence into
 * configuration drafts; an HR administrator confirms or discards each, and a
 * confirmed change can be reverted. The row keeps the sentence, the drafts,
 * who confirmed and what was there before.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609300004_create_settings_change_log',
  async up({ builder }) {
    await builder.createCollection('settingsChangeLog', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.text('utterance').notNull();
      c.string('status', { length: 16 }).notNull();
      c.json('items').notNull();
      c.string('createdBy', { length: 64 }).notNull();
      c.string('appliedBy', { length: 64 }).nullable();
      c.datetime('appliedAt').nullable();
      c.string('revertedBy', { length: 64 }).nullable();
      c.datetime('revertedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['status', 'createdAt']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('settingsChangeLog');
  },
});

export default migration;

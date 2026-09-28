import { defineMigration, type MigrationDefinition } from '@nocobase/db';

// Application-owned administrator settings, separate from deployment secrets.
const migration: MigrationDefinition = defineMigration({
  name: '202609290004_add_personnel_settings',
  async up({ builder }) {
    await builder.createCollection('personnelSettings', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.json('value').notNull();
      c.integer('revision').notNull();
      c.string('updatedBy', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
  },
  async down({ builder }) {
    await builder.dropCollection('personnelSettings');
  },
});

export default migration;

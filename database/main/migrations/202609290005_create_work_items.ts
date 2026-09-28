import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/** Workbench entries are reminders; the source business record owns its lifecycle. */
const migration: MigrationDefinition = defineMigration({
  name: '202609290005_create_work_items',
  async up({ builder }) {
    await builder.createCollection('workItems', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('recipientUserId', { length: 64 }).notNull();
      c.string('type', { length: 64 }).notNull();
      c.string('title', { length: 255 }).notNull();
      c.string('summary', { length: 500 }).nullable();
      c.string('link', { length: 1000 }).notNull();
      c.string('sourceKind', { length: 16 }).notNull();
      c.string('aiEmployee', { length: 64 }).nullable();
      c.string('refType', { length: 64 }).notNull();
      c.string('refId', { length: 128 }).notNull();
      c.datetime('dueAt').nullable();
      c.string('status', { length: 16 }).notNull().defaultTo('open');
      c.datetime('doneAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['recipientUserId', 'type', 'refType', 'refId']);
      c.index(['recipientUserId', 'status', 'dueAt']);
      c.index(['refType', 'refId']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('workItems');
  },
});

export default migration;

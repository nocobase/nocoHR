import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1-02 变动影响清单: one checklist per onboarding, transfer / promotion or
 * offboarding, listing what the change touches. Items are computed by rule
 * providers; the HR assistant only writes the summary and per-item notes.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609300002_create_change_checklists',
  async up({ builder }) {
    await builder.createCollection('jobChangeChecklists', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).nullable();
      c.string('employeeName', { length: 200 }).notNull();
      c.string('kind', { length: 16 }).notNull();
      c.string('actionId', { length: 64 }).nullable();
      c.string('jobEventId', { length: 64 }).nullable();
      c.string('stage', { length: 16 }).notNull();
      c.json('items').notNull();
      c.string('itemsHash', { length: 64 }).nullable();
      c.text('aiSummary').nullable();
      c.string('notesHash', { length: 64 }).nullable();
      c.string('ownerUserId', { length: 64 }).nullable();
      c.date('dueDate').nullable();
      c.datetime('openedAt').nullable();
      c.datetime('doneAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['actionId']);
      c.unique(['jobEventId']);
      c.index(['stage', 'dueDate']);
      c.index(['employeeId']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('jobChangeChecklists');
  },
});

export default migration;

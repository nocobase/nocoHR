import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1-02 用工合规检查: one row per employee and kind of issue while it is open.
 * A resolved issue is closed; if it comes back, a new row is opened so it is
 * raised again.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609300003_create_compliance_issues',
  async up({ builder }) {
    await builder.createCollection('complianceIssues', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('kind', { length: 32 }).notNull();
      c.string('status', { length: 16 }).notNull();
      c.json('detail').notNull();
      c.text('aiNote').nullable();
      c.datetime('detectedAt').notNull();
      c.datetime('notifiedAt').nullable();
      c.datetime('closedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'kind', 'status']);
      c.index(['status']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('complianceIssues');
  },
});

export default migration;

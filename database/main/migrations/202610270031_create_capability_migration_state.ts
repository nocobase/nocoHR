import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202610270031_create_capability_migration_state',
  async up({ builder }) {
    await builder.createCollection('assistantToolCalls', (c) => {
      c.string('id').primary().notNull();
      c.string('userId').notNull();
      c.string('sessionId').notNull();
      c.string('employee').notNull();
      c.string('tool').notNull();
      c.string('messageId').nullable();
      c.string('modelCallId').nullable();
      c.json('arguments').notNull();
      c.string('argumentDigest').notNull();
      c.string('status').notNull();
      c.json('result').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['userId', 'sessionId']);
      c.index(['status']);
    });
    await builder.createCollection('capabilityMigrationLedger', (c) => {
      c.string('id').primary().notNull();
      c.string('sourcePackage').notNull();
      c.string('sourceVersion').notNull();
      c.string('sourceCollection').notNull();
      c.string('sourceKey').notNull();
      c.string('targetCollection').notNull();
      c.string('targetKey').notNull();
      c.integer('formatVersion').notNull();
      c.string('sourceDigest').notNull();
      c.datetime('createdAt').notNull();
      c.unique(['sourcePackage', 'sourceCollection', 'sourceKey']);
    });
  },
  async down(context) {
    if (
      (await context.repository('assistantToolCalls').count()) ||
      (await context.repository('capabilityMigrationLedger').count())
    )
      throw new Error('CAPABILITY_STATE_NOT_EMPTY');
    await context.builder.dropCollection('capabilityMigrationLedger');
    await context.builder.dropCollection('assistantToolCalls');
  },
});

export default migration;

import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202610270032_create_process_execution_state',
  async up({ builder }) {
    await builder.createCollection('processRuns', (c) => {
      c.string('id').primary().notNull();
      c.string('eventKey').notNull();
      c.string('definitionKey').notNull();
      c.string('definitionHash').notNull();
      c.string('definitionDigest').notNull();
      c.json('input').notNull();
      c.json('output').notNull();
      c.string('next').nullable();
      c.string('status').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['eventKey']);
      c.index(['definitionKey', 'definitionHash']);
      c.index(['status']);
    });
    await builder.createCollection('processNodeRuns', (c) => {
      c.string('id').primary().notNull();
      c.string('runId').notNull();
      c.string('nodeKey').notNull();
      c.string('status').notNull();
      c.json('result').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.foreignKey('runId', {
        references: { collection: 'processRuns', fields: ['id'] },
      });
      c.unique(['runId', 'nodeKey']);
    });
  },
  async down(context) {
    if (
      (await context.repository('processRuns').count()) ||
      (await context.repository('processNodeRuns').count())
    )
      throw new Error('PROCESS_STATE_NOT_EMPTY');
    await context.builder.dropCollection('processNodeRuns');
    await context.builder.dropCollection('processRuns');
  },
});

export default migration;

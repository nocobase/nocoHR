import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610270035_create_process_history',
  async up({ builder }) {
    await builder.alterCollection('processRuns', (c) => {
      c.string('actorUserId').nullable();
    });
    await builder.createCollection('processDefinitions', (c) => {
      c.string('id').primary().notNull();
      c.string('key').notNull();
      c.string('hash').notNull();
      c.string('artifactHash').notNull();
      c.json('snapshot').notNull();
      c.index(['key', 'hash']);
    });
    await builder.createCollection('processRunHistory', (c) => {
      c.string('id').primary().notNull();
      c.string('definitionId').notNull();
      c.json('snapshot').notNull();
      c.index(['definitionId']);
      c.foreignKey('definitionId', {
        references: { collection: 'processDefinitions', fields: ['id'] },
      });
    });
  },
  async down(context) {
    if (
      (await context.repository('processDefinitions').count()) ||
      (await context.repository('processRunHistory').count()) ||
      (await context.repository('processRuns').count())
    )
      throw new Error('PROCESS_HISTORY_NOT_EMPTY');
    await context.builder.dropCollection('processRunHistory');
    await context.builder.dropCollection('processDefinitions');
    await context.builder.alterCollection('processRuns', (c) => {
      c.dropField('actorUserId');
    });
  },
});

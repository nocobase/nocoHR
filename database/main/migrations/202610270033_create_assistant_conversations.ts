import { defineMigration, type MigrationDefinition } from '@nocobase/db';

const migration: MigrationDefinition = defineMigration({
  name: '202610270033_create_assistant_conversations',
  async up({ builder }) {
    await builder.alterCollection('assistantToolCalls', (c) => {
      c.boolean('auto').nullable();
    });
    await builder.createCollection('assistantConversations', (c) => {
      c.string('id').primary().notNull();
      c.string('userId').notNull();
      c.string('employee').notNull();
      c.string('title').notNull();
      c.json('model').notNull();
      c.string('mode').notNull();
      c.string('state').notNull();
      c.integer('revision').notNull();
      c.string('activeRequest').nullable();
      c.json('pendingCallIds').notNull();
      c.boolean('read').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['userId', 'updatedAt']);
    });
    await builder.createCollection('assistantMessages', (c) => {
      c.increments('sequence').primary();
      c.string('id').notNull().unique();
      c.string('sessionId').notNull();
      c.json('message').notNull();
      c.datetime('createdAt').notNull();
      c.index(['sessionId', 'sequence']);
    });
  },
  async down({ query, builder }) {
    if (
      (await query
        .selectFrom('assistantToolCalls')
        .select('id')
        .limit(1)
        .executeTakeFirst()) ||
      (await query
        .selectFrom('assistantMessages')
        .select('id')
        .limit(1)
        .executeTakeFirst()) ||
      (await query
        .selectFrom('assistantConversations')
        .select('id')
        .limit(1)
        .executeTakeFirst())
    )
      throw new Error('ASSISTANT_HISTORY_NOT_EMPTY');
    await builder.dropCollection('assistantMessages');
    await builder.dropCollection('assistantConversations');
    await builder.alterCollection('assistantToolCalls', (c) => {
      c.dropField('auto');
    });
  },
});
export default migration;

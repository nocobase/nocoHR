import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/** Application-owned copies only; retired plugin tables and migration namespaces are untouched. */
const migration: MigrationDefinition = defineMigration({
  name: '202610270034_create_assistant_history_configuration',
  async up({ builder }) {
    await builder.createCollection('assistantEmployees', (c) => {
      c.string('id').primary().notNull();
      c.json('profile').notNull();
    });
    await builder.createCollection('assistantEmployeePreferences', (c) => {
      c.string('id').primary().notNull();
      c.string('userId').notNull();
      c.string('employee').notNull();
      c.text('prompt').nullable();
      c.integer('sort').nullable();
      c.unique(['userId', 'employee']);
    });
    await builder.createCollection('assistantModelServices', (c) => {
      c.string('id').primary().notNull();
      c.json('settings').notNull();
    });
    await builder.createCollection('assistantFiles', (c) => {
      c.string('id').primary().notNull();
      c.string('userId').notNull();
      c.json('reference').notNull();
      c.index(['userId']);
    });
  },
  async down({ query, builder }) {
    for (const name of [
      'assistantEmployees',
      'assistantEmployeePreferences',
      'assistantModelServices',
      'assistantFiles',
    ]) {
      if (await query.selectFrom(name).select('id').limit(1).executeTakeFirst())
        throw new Error('ASSISTANT_HISTORY_NOT_EMPTY');
    }
    for (const name of [
      'assistantFiles',
      'assistantModelServices',
      'assistantEmployeePreferences',
      'assistantEmployees',
    ])
      await builder.dropCollection(name);
  },
});
export default migration;

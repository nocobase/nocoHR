import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 界面追加字段 (总纲 可定制约定, V1-01): an administrator adds fields to a
 * business table in the UI. Definitions and values are data, not schema, so
 * migrations never touch them and they survive upgrades.
 *
 * - `customFieldDefinitions`: one row per added field, keyed by an immutable
 *   internal key generated on creation;
 * - `employees.customFields`: the values, keyed by that internal key. Later
 *   steps add the same column to the tables they open for extension.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609300001_create_custom_fields',
  async up({ builder }) {
    await builder.createCollection('customFieldDefinitions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('collection', { length: 64 }).notNull();
      c.string('key', { length: 32 }).notNull();
      c.json('label').notNull();
      c.string('type', { length: 16 }).notNull();
      c.json('options').nullable();
      c.boolean('required').notNull().defaultTo(false);
      c.json('defaultValue').nullable();
      c.json('placements').notNull();
      c.boolean('sensitive').notNull().defaultTo(false);
      c.boolean('aiReadable').notNull().defaultTo(false);
      c.integer('sortOrder').notNull().defaultTo(0);
      c.boolean('active').notNull().defaultTo(true);
      c.string('createdBy', { length: 64 }).nullable();
      c.string('updatedBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['collection', 'key']);
      c.index(['collection', 'active', 'sortOrder']);
    });
    await builder.alterCollection('employees', (c) => {
      c.json('customFields').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('employees', (c) => {
      c.dropFields('customFields');
    });
    await builder.dropCollection('customFieldDefinitions');
  },
});

export default migration;

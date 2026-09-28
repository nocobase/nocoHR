import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * The organisation dimension: a department tree whose members inherit the
 * permission sets assigned to their departments, plus the department head.
 * Departments are disabled, never deleted, because assignments and history
 * keep referring to their ids.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609270001_create_organization',
  async up({ builder }) {
    await builder.createCollection('departments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // Import matching key; optional and unique when present.
      c.string('code', { length: 64 }).nullable();
      c.string('title').notNull();
      c.string('parentId', { length: 64 }).nullable();
      // The head of the department: a user id, who need not be a member.
      c.string('managerId', { length: 64 }).nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.integer('sortOrder').notNull().defaultTo(0);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('code');
      c.index('parentId');
      c.index('managerId');
    });
    await builder.createCollection('departmentMembers', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('departmentId', { length: 64 }).notNull();
      c.string('userId', { length: 64 }).notNull();
      c.boolean('primary').notNull().defaultTo(false);
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['departmentId', 'userId']);
      c.index('userId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('departmentMembers');
    await builder.dropCollection('departments');
  },
});

export default migration;

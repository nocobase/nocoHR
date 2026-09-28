import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Employee records and their competency assessments. An employee may exist
 * without a login user; assessments are append-only history, and the current
 * level of a competency is the latest assessment.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609270003_create_employees',
  async up({ builder }) {
    await builder.createCollection('employees', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeNo', { length: 64 }).notNull();
      c.string('name').notNull();
      // The login user, when the employee has one.
      c.string('userId', { length: 64 }).nullable();
      c.string('departmentId', { length: 64 }).notNull();
      c.string('positionId', { length: 64 }).nullable();
      c.string('managerEmployeeId', { length: 64 }).nullable();
      // active | leave (extended by a later step)
      c.string('status', { length: 16 }).notNull().defaultTo('active');
      c.date('hireDate').nullable();
      c.date('positionSince').nullable();
      c.string('email', { length: 320 }).nullable();
      // Sensitive: only HR administrators and the person.
      c.string('mobile', { length: 32 }).nullable();
      // Sensitive: only HR administrators.
      c.text('note').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('employeeNo');
      c.unique('userId');
      c.index('departmentId');
      c.index('positionId');
      c.index('managerEmployeeId');
      c.index('status');
    });
    await builder.createCollection('employeeCompetencies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.integer('level').notNull();
      // assessment | import (later: exam | certificate)
      c.string('source', { length: 16 }).notNull().defaultTo('assessment');
      c.text('evidence').nullable();
      c.string('assessedBy', { length: 64 }).notNull();
      c.datetime('assessedAt').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'competencyId', 'assessedAt']);
      c.index('competencyId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('employeeCompetencies');
    await builder.dropCollection('employees');
  },
});

export default migration;

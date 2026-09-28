import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1 step 1 as rewritten on 2026-09-28: every Excel import is a batch.
 *
 * - `employees.lastImportBatchId` and `positions.importBatchId` tie records to
 *   the import that last created or updated them, for the HR assistant's
 *   health check and the employee list's batch filter;
 * - `employeeImportBatches` keeps what one import did — who ran it, which
 *   employees it created and updated, which positions it created — and the
 *   health check's result, which the employee list shows as "最近一次导入".
 *   The specification only names the two fields; the batch summary needs a
 *   row of its own because the health check may be switched off or fail, and
 *   the list must still say what the import did.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290003_add_employee_import_batches',
  async up({ builder }) {
    await builder.alterCollection('employees', (c) => {
      c.string('lastImportBatchId', { length: 64 }).nullable();
      c.index('lastImportBatchId', {
        name: 'employees_last_import_batch_index',
      });
    });
    await builder.alterCollection('positions', (c) => {
      c.string('importBatchId', { length: 64 }).nullable();
    });
    await builder.createCollection('employeeImportBatches', (c) => {
      // The batch number, such as IMP-20260928-4F2A.
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('importedByUserId', { length: 64 }).notNull();
      c.integer('createdCount').notNull().defaultTo(0);
      c.integer('updatedCount').notNull().defaultTo(0);
      // Employee and position ids, for the health check and the batch filter.
      c.json('createdEmployeeIds').notNull();
      c.json('updatedEmployeeIds').notNull();
      c.json('createdPositionIds').notNull();
      // The latest health check: { mustFix, suggested } counts, the report text, its run.
      c.json('checkSummary').nullable();
      c.text('checkReport').nullable();
      c.string('checkRunId', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('createdAt', { name: 'employee_import_batches_created_index' });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('employeeImportBatches');
    await builder.alterCollection('positions', (c) => {
      c.dropFields('importBatchId');
    });
    await builder.alterCollection('employees', (c) => {
      c.dropIndex('employees_last_import_batch_index');
      c.dropFields('lastImportBatchId');
    });
  },
});

export default migration;

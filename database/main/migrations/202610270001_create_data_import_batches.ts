import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 初始数据导入 (上线准备): a new customer loads its departments, positions,
 * labour contracts and opening leave balances from Excel in the browser.
 *
 * - `dataImportBatches` keeps what one import did, like
 *   `employeeImportBatches` does for employees: its kind, who ran it, how
 *   many records it created and updated, and their ids, for audit and the
 *   go-live checklist's "last imported" date.
 * - `positions.departmentId`: the department a position belongs to, which the
 *   position import's 所属部门编码 column fills. Optional; a position without
 *   one is shared across departments, as every position was until now.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610270001_create_data_import_batches',
  async up({ builder }) {
    await builder.createCollection('dataImportBatches', (c) => {
      // The batch number, such as IMP-DEP-20261027-4F2A.
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // departments | positions | contracts | leaveBalances
      c.string('kind', { length: 32 }).notNull();
      c.string('importedByUserId', { length: 64 }).notNull();
      c.integer('createdCount').notNull().defaultTo(0);
      c.integer('updatedCount').notNull().defaultTo(0);
      c.integer('unchangedCount').notNull().defaultTo(0);
      // { created: string[], updated: string[] } record ids.
      c.json('recordIds').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['kind', 'createdAt'], {
        name: 'data_import_batches_kind_created_index',
      });
    });
    await builder.alterCollection('positions', (c) => {
      c.string('departmentId', { length: 64 }).nullable();
      c.index('departmentId', { name: 'positions_department_index' });
    });
  },
  async down({ builder }) {
    // The index first, in its own step: SQLite refuses to drop an indexed column.
    await builder.alterCollection('positions', (c) => {
      c.dropIndex('positions_department_index');
    });
    await builder.alterCollection('positions', (c) => {
      c.dropFields('departmentId');
    });
    await builder.dropCollection('dataImportBatches');
  },
});

export default migration;

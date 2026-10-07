import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 上线准备 · 薪酬期初数据: what a customer going live loads from its previous
 * system in the browser.
 *
 * - `payrollTaxOpenings`: 本年个税累计期初, one row per employee and year. The
 *   cumulative figures of the months before NocoHR calculates (累计收入,
 *   累计减除费用, 累计专项扣除, 累计专项附加扣除, 累计其他扣除, 累计已预扣税额) up to
 *   and including `throughMonth`; `startMonth` is where that cumulative
 *   period began (January, or the hiring month of the year). Amounts
 *   decimal(14, 2), like the payslips.
 * - `payrollImportBatches`: one row per committed import of the four payroll
 *   importers (`kind`: salaryFiles, enrolments, deductions, taxOpenings),
 *   with the stored upload and the counts.
 * - `employeeSocialInsurances.socialAccountNo` / `housingFundAccountNo`: the
 *   personal 社保 and 公积金 account numbers, imported with the enrolment.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610270011_payroll_opening_imports',
  async up({ builder }) {
    await builder.createCollection('payrollTaxOpenings', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.integer('year').notNull();
      c.string('startMonth', { length: 7 }).notNull();
      c.string('throughMonth', { length: 7 }).notNull();
      c.decimal('incomeYtd', { precision: 14, scale: 2 }).notNull();
      c.decimal('basicDeductionYtd', { precision: 14, scale: 2 }).notNull();
      c.decimal('insuranceYtd', { precision: 14, scale: 2 }).notNull();
      c.decimal('specialDeductionYtd', { precision: 14, scale: 2 }).notNull();
      c.decimal('otherDeductionYtd', { precision: 14, scale: 2 }).notNull();
      c.decimal('withheldYtd', { precision: 14, scale: 2 }).notNull();
      c.string('batchId', { length: 64 }).nullable();
      c.string('createdBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'year']);
    });
    await builder.createCollection('payrollImportBatches', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('kind', { length: 32 }).notNull();
      c.string('fileId', { length: 64 }).nullable();
      c.string('fileName', { length: 200 }).nullable();
      c.integer('rowCount').notNull().defaultTo(0);
      c.integer('createdCount').notNull().defaultTo(0);
      c.integer('updatedCount').notNull().defaultTo(0);
      c.string('importedBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.index(['kind', 'createdAt']);
    });
    await builder.alterCollection('employeeSocialInsurances', (c) => {
      c.string('socialAccountNo', { length: 64 }).nullable();
      c.string('housingFundAccountNo', { length: 64 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('employeeSocialInsurances', (c) => {
      c.dropFields('socialAccountNo', 'housingFundAccountNo');
    });
    await builder.dropCollection('payrollImportBatches');
    await builder.dropCollection('payrollTaxOpenings');
  },
});

export default migration;

import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-06 薪酬与社保: the nine tables of 总纲 step 6.
 *
 * - `salaryStructures`: items (earning / deduction / reference; fixed,
 *   formula, manual or imported), formula parameters, pay ranges and the
 *   change log. Items, parameters and formulas are data the payroll
 *   specialist edits, never code.
 * - `employeeSalaries`: history only, never updated; the file a month uses is
 *   the latest one whose effectiveMonth is not after it.
 * - `salaryAdjustments`: 调薪申请, approved into a new employeeSalaries row;
 *   extensible (`customFields`).
 * - `socialInsurancePlans` / `employeeSocialInsurances`: city plans and each
 *   employee's enrolment; `sourceEventId` makes a job event's suggestion
 *   idempotent.
 * - `employeeTaxDeductions`: 专项附加扣除 per employee and year.
 * - `payrollCycles` / `payslips`: one cycle per month, one payslip per
 *   employee and cycle; `departmentId` is the department at calculation time.
 * - `laborVendorBills`: 派遣账单 per vendor and month; `uploads` keeps every
 *   upload when a bill is uploaded again.
 *
 * Amounts use decimal(14, 2); rates and values up to four decimals.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610010001_create_payroll',
  async up({ builder }) {
    await builder.createCollection('salaryStructures', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title', { length: 200 }).notNull();
      c.json('appliesTo').notNull();
      c.json('items').notNull();
      c.json('params').nullable();
      c.json('payRanges').nullable();
      c.decimal('payDaysPerMonth', { precision: 8, scale: 2 })
        .notNull()
        .defaultTo(21.75);
      c.json('changeLog').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('employeeSalaries', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('effectiveMonth', { length: 7 }).notNull();
      c.decimal('baseSalary', { precision: 14, scale: 2 }).notNull();
      c.json('fixedAllowances').nullable();
      c.string('salaryStructureId', { length: 64 }).notNull();
      c.foreignKey('salaryStructureId', {
        references: { collection: 'salaryStructures', fields: ['id'] },
      });
      // Sensitive: bank name and account number; masked in lists.
      c.json('bankAccount').nullable();
      // import | adjustment | manual
      c.string('source', { length: 16 }).notNull();
      c.string('adjustmentId', { length: 64 }).nullable();
      c.string('createdBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'effectiveMonth']);
      c.index(['salaryStructureId']);
    });
    await builder.createCollection('salaryAdjustments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('effectiveMonth', { length: 7 }).notNull();
      c.json('changes').notNull();
      c.text('reason').notNull();
      c.string('relatedActionId', { length: 64 }).nullable();
      // draft | pending | approved | rejected
      c.string('status', { length: 16 }).notNull();
      c.json('approvals').nullable();
      c.string('applicantUserId', { length: 64 }).notNull();
      c.json('customFields').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId']);
      c.index(['status']);
      c.index(['relatedActionId']);
    });
    await builder.createCollection('socialInsurancePlans', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('city', { length: 64 }).notNull();
      c.string('effectiveFrom', { length: 7 }).notNull();
      c.string('effectiveTo', { length: 7 }).nullable();
      c.json('items').notNull();
      c.text('note').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['city']);
    });
    await builder.createCollection('employeeSocialInsurances', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('planCity', { length: 64 }).notNull();
      c.decimal('socialBase', { precision: 14, scale: 2 }).notNull();
      c.decimal('housingFundBase', { precision: 14, scale: 2 }).notNull();
      c.string('startMonth', { length: 7 }).notNull();
      c.string('endMonth', { length: 7 }).nullable();
      // pending | active | stopped
      c.string('status', { length: 16 }).notNull();
      // start (增员) | stop (减员), for a pending suggestion.
      c.string('pendingAction', { length: 16 }).nullable();
      c.json('changeLog').nullable();
      c.string('sourceEventId', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId']);
      c.index(['status']);
      c.unique(['sourceEventId']);
    });
    await builder.createCollection('employeeTaxDeductions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.integer('year').notNull();
      c.json('items').notNull();
      // manual | import
      c.string('source', { length: 16 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'year']);
    });
    await builder.createCollection('payrollCycles', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('month', { length: 7 }).notNull();
      c.json('scope').nullable();
      // draft | calculated | reviewing | pendingApproval | approved | published | closed
      c.string('status', { length: 16 }).notNull();
      c.json('imports').nullable();
      c.datetime('calculatedAt').nullable();
      // Changes on every calculation: the HR assistant checks each one once.
      c.string('calculationId', { length: 64 }).nullable();
      c.string('calculatedBy', { length: 64 }).nullable();
      c.string('submittedBy', { length: 64 }).nullable();
      c.datetime('submittedAt').nullable();
      c.json('approvals').nullable();
      c.string('approvedBy', { length: 64 }).nullable();
      c.datetime('approvedAt').nullable();
      c.datetime('publishedAt').nullable();
      c.string('publishedBy', { length: 64 }).nullable();
      c.json('exports').nullable();
      c.json('review').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['month']);
    });
    await builder.createCollection('payslips', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('cycleId', { length: 64 }).notNull();
      c.foreignKey('cycleId', {
        references: { collection: 'payrollCycles', fields: ['id'] },
      });
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.string('departmentId', { length: 64 }).nullable();
      c.json('importedValues').nullable();
      c.json('inputs').nullable();
      c.json('lines').nullable();
      c.decimal('gross', { precision: 14, scale: 2 }).nullable();
      c.decimal('socialEmployee', { precision: 14, scale: 2 }).nullable();
      c.decimal('housingFundEmployee', { precision: 14, scale: 2 }).nullable();
      c.decimal('taxableIncomeYtd', { precision: 14, scale: 2 }).nullable();
      c.decimal('taxWithheldYtd', { precision: 14, scale: 2 }).nullable();
      c.decimal('tax', { precision: 14, scale: 2 }).nullable();
      c.decimal('net', { precision: 14, scale: 2 }).nullable();
      c.json('employerCost').nullable();
      c.json('manualItems').nullable();
      c.json('issues').nullable();
      c.datetime('calculatedAt').nullable();
      c.datetime('viewedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['cycleId', 'employeeId']);
      c.index(['employeeId']);
    });
    await builder.createCollection('laborVendorBills', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('vendorName', { length: 200 }).notNull();
      c.string('month', { length: 7 }).notNull();
      c.string('fileId', { length: 64 }).notNull();
      c.json('lines').notNull();
      c.json('reconciliation').nullable();
      c.text('aiNotes').nullable();
      // uploaded | reconciled | confirmed | disputed
      c.string('status', { length: 16 }).notNull();
      c.string('confirmedBy', { length: 64 }).nullable();
      c.datetime('confirmedAt').nullable();
      c.json('uploads').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['vendorName', 'month']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('laborVendorBills');
    await builder.dropCollection('payslips');
    await builder.dropCollection('payrollCycles');
    await builder.dropCollection('employeeTaxDeductions');
    await builder.dropCollection('employeeSocialInsurances');
    await builder.dropCollection('socialInsurancePlans');
    await builder.dropCollection('salaryAdjustments');
    await builder.dropCollection('employeeSalaries');
    await builder.dropCollection('salaryStructures');
  },
});

export default migration;

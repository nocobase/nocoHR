/**
 * V2-06 权限配置: the payroll business operations, their field grants, and the
 * two permission sets the step introduces (薪酬专员 hr.payroll, 薪酬审批
 * hr.payrollApprover). Salary data lives only in the payroll tables, and only
 * these composites grant them: hr.admin holds none, so it reads no salary,
 * payslip, adjustment, imported value or bank account — not in a page and not
 * through the API. Employees reach their own payslips and enrolment through
 * `talent.myPayslip` with the self scope. The services authorize the action
 * first and read through the grant's policies for the scoped collections.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import { label } from '../shared.js';

const EMPLOYEE_FIELDS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'status',
  'hireDate',
  'leaveDate',
  'employmentType',
  'workLocation',
];
const employees = defineDatabasePermission((p) =>
  p.collection('employees').read(EMPLOYEE_FIELDS),
);
/** 个税申报明细 needs the ID document; only the export action reads it. */
const employeesForTax = defineDatabasePermission((p) =>
  p.collection('employees').read([...EMPLOYEE_FIELDS, 'idType', 'idNumber']),
);
const SALARY_FIELDS = [
  'id',
  'employeeId',
  'effectiveMonth',
  'baseSalary',
  'fixedAllowances',
  'salaryStructureId',
  'bankAccount',
  'source',
  'adjustmentId',
  // V4-12
  'bonusBase',
  'createdBy',
  'createdAt',
  'updatedAt',
];
const salaries = defineDatabasePermission((p) =>
  p.collection('employeeSalaries').read(SALARY_FIELDS),
);
const salariesWrite = defineDatabasePermission((p) =>
  p.collection('employeeSalaries').read(SALARY_FIELDS).create(SALARY_FIELDS),
);
/** 导入期初档案: a re-import corrects the opening file of the same month in place. */
const salariesImport = defineDatabasePermission((p) =>
  p
    .collection('employeeSalaries')
    .read(SALARY_FIELDS)
    .create(SALARY_FIELDS)
    .update([
      'baseSalary',
      'fixedAllowances',
      'salaryStructureId',
      'bankAccount',
      'bonusBase',
      'updatedAt',
    ]),
);
const ADJUSTMENT_FIELDS = [
  'id',
  'employeeId',
  'effectiveMonth',
  'changes',
  'reason',
  'relatedActionId',
  // V4-12
  'relatedReviewResultId',
  'status',
  'approvals',
  'applicantUserId',
  'customFields',
  'createdAt',
  'updatedAt',
];
const adjustments = defineDatabasePermission((p) =>
  p.collection('salaryAdjustments').read(ADJUSTMENT_FIELDS),
);
const adjustmentsWrite = defineDatabasePermission((p) =>
  p
    .collection('salaryAdjustments')
    .read(ADJUSTMENT_FIELDS)
    .create(ADJUSTMENT_FIELDS)
    .update([
      'status',
      'approvals',
      'changes',
      'reason',
      'customFields',
      'updatedAt',
    ]),
);
const STRUCTURE_FIELDS = [
  'id',
  'title',
  'appliesTo',
  'items',
  'params',
  'payRanges',
  'payDaysPerMonth',
  'changeLog',
  'active',
  'createdAt',
  'updatedAt',
];
const structures = defineDatabasePermission((p) =>
  p.collection('salaryStructures').read(STRUCTURE_FIELDS),
);
const structuresWrite = defineDatabasePermission((p) =>
  p
    .collection('salaryStructures')
    .read(STRUCTURE_FIELDS)
    .create(STRUCTURE_FIELDS)
    .update(STRUCTURE_FIELDS),
);
const CYCLE_FIELDS = [
  'id',
  'month',
  'scope',
  'status',
  'imports',
  'calculatedAt',
  'calculationId',
  'calculatedBy',
  'submittedBy',
  'submittedAt',
  'approvals',
  'approvedBy',
  'approvedAt',
  'publishedAt',
  'publishedBy',
  'exports',
  'review',
  // V4-12
  'bonusCycleId',
  'createdAt',
  'updatedAt',
];
const cycles = defineDatabasePermission((p) =>
  p.collection('payrollCycles').read(CYCLE_FIELDS),
);
const cyclesWrite = defineDatabasePermission((p) =>
  p
    .collection('payrollCycles')
    .read(CYCLE_FIELDS)
    .create(CYCLE_FIELDS)
    .update(CYCLE_FIELDS),
);
const PAYSLIP_FIELDS = [
  'id',
  'cycleId',
  'employeeId',
  'departmentId',
  'importedValues',
  'inputs',
  'lines',
  'gross',
  'socialEmployee',
  'housingFundEmployee',
  'taxableIncomeYtd',
  'taxWithheldYtd',
  'tax',
  'net',
  'employerCost',
  'manualItems',
  'issues',
  'calculatedAt',
  'viewedAt',
  'createdAt',
  'updatedAt',
];
const payslips = defineDatabasePermission((p) =>
  p.collection('payslips').read(PAYSLIP_FIELDS),
);
const payslipsWrite = defineDatabasePermission((p) =>
  p
    .collection('payslips')
    .read(PAYSLIP_FIELDS)
    .create(PAYSLIP_FIELDS)
    .update(PAYSLIP_FIELDS),
);
/** The employee's own payslip: no calculation snapshot beyond the lines, no issues. */
const ownPayslips = defineDatabasePermission((p) =>
  p
    .collection('payslips')
    .read([
      'id',
      'cycleId',
      'employeeId',
      'lines',
      'gross',
      'socialEmployee',
      'housingFundEmployee',
      'taxableIncomeYtd',
      'taxWithheldYtd',
      'tax',
      'net',
      'viewedAt',
    ])
    .update(['viewedAt', 'updatedAt']),
);
const PLAN_FIELDS = [
  'id',
  'city',
  'effectiveFrom',
  'effectiveTo',
  'items',
  'note',
  'createdAt',
  'updatedAt',
];
const plans = defineDatabasePermission((p) =>
  p.collection('socialInsurancePlans').read(PLAN_FIELDS),
);
const plansWrite = defineDatabasePermission((p) =>
  p
    .collection('socialInsurancePlans')
    .read(PLAN_FIELDS)
    .create(PLAN_FIELDS)
    .update(PLAN_FIELDS),
);
const ENROLMENT_FIELDS = [
  'id',
  'employeeId',
  'planCity',
  'socialBase',
  'housingFundBase',
  'startMonth',
  'endMonth',
  'status',
  'pendingAction',
  'changeLog',
  'sourceEventId',
  // 上线准备: the personal account numbers, imported with the enrolment.
  'socialAccountNo',
  'housingFundAccountNo',
  'createdAt',
  'updatedAt',
];
const enrolments = defineDatabasePermission((p) =>
  p.collection('employeeSocialInsurances').read(ENROLMENT_FIELDS),
);
const enrolmentsWrite = defineDatabasePermission((p) =>
  p
    .collection('employeeSocialInsurances')
    .read(ENROLMENT_FIELDS)
    .create(ENROLMENT_FIELDS)
    .update(ENROLMENT_FIELDS),
);
const ownEnrolments = defineDatabasePermission((p) =>
  p
    .collection('employeeSocialInsurances')
    .read([
      'id',
      'employeeId',
      'planCity',
      'socialBase',
      'housingFundBase',
      'startMonth',
      'endMonth',
      'status',
    ]),
);
const DEDUCTION_FIELDS = [
  'id',
  'employeeId',
  'year',
  'items',
  'source',
  'createdAt',
  'updatedAt',
];
const deductions = defineDatabasePermission((p) =>
  p.collection('employeeTaxDeductions').read(DEDUCTION_FIELDS),
);
const deductionsWrite = defineDatabasePermission((p) =>
  p
    .collection('employeeTaxDeductions')
    .read(DEDUCTION_FIELDS)
    .create(DEDUCTION_FIELDS)
    .update(DEDUCTION_FIELDS),
);
// 上线准备 · 本年个税累计期初 (payroll only).
const TAX_OPENING_FIELDS = [
  'id',
  'employeeId',
  'year',
  'startMonth',
  'throughMonth',
  'incomeYtd',
  'basicDeductionYtd',
  'insuranceYtd',
  'specialDeductionYtd',
  'otherDeductionYtd',
  'withheldYtd',
  'batchId',
  'createdBy',
  'createdAt',
  'updatedAt',
];
const taxOpeningsWrite = defineDatabasePermission((p) =>
  p
    .collection('payrollTaxOpenings')
    .read(TAX_OPENING_FIELDS)
    .create(TAX_OPENING_FIELDS)
    .update(TAX_OPENING_FIELDS),
);
const summaries = defineDatabasePermission((p) =>
  p
    .collection('attendanceMonthlySummaries')
    .read([
      'id',
      'employeeId',
      'month',
      'absentDays',
      'leaveByType',
      'overtimeByType',
      'nightShiftCount',
      'shiftCounts',
      'status',
      'lockedAt',
    ]),
);
const BILL_FIELDS = [
  'id',
  'vendorName',
  'month',
  'fileId',
  'lines',
  'reconciliation',
  'aiNotes',
  'status',
  'confirmedBy',
  'confirmedAt',
  'uploads',
  // V2-06 邮件往来: the billing mailbox message the bill came from (read with the bill).
  'sourceMailId',
  'createdAt',
  'updatedAt',
];
const bills = defineDatabasePermission((p) =>
  p.collection('laborVendorBills').read(BILL_FIELDS),
);
const billsWrite = defineDatabasePermission((p) =>
  p
    .collection('laborVendorBills')
    .read(BILL_FIELDS)
    .create(BILL_FIELDS)
    .update(BILL_FIELDS),
);

export const salaryResource = defineCompositeResource('talent.salary', (r) =>
  r
    .title(label('payroll.authz.salary.title'))
    .action('view', (a) =>
      a
        .title(label('payroll.authz.actions.view'))
        .grant('employees', employees)
        .grant('employeeSalaries', salaries)
        .grant('salaryAdjustments', adjustments)
        .grant('salaryStructures', structures),
    )
    .action('manage', (a) =>
      a
        .title(label('payroll.authz.salary.manage'))
        .grant('employees', employees)
        .grant('employeeSalaries', salariesWrite)
        .grant('salaryStructures', structures),
    )
    .action('adjust', (a) =>
      a
        .title(label('payroll.authz.salary.adjust'))
        .grant('employees', employees)
        .grant('employeeSalaries', salaries)
        .grant('salaryAdjustments', adjustmentsWrite),
    )
    .action('approveAdjustment', (a) =>
      a
        .title(label('payroll.authz.salary.approveAdjustment'))
        .grant('employees', employees)
        .grant('employeeSalaries', salariesWrite)
        .grant('salaryAdjustments', adjustmentsWrite),
    )
    // 上线准备: 导入期初档案 (opening files, without the adjustment approval).
    .action('import', (a) =>
      a
        .title(label('payroll.opening.authz.salaryImport'))
        .grant('employees', employees)
        .grant('employeeSalaries', salariesImport)
        .grant('salaryStructures', structures),
    ),
);

export const payrollResource = defineCompositeResource('talent.payroll', (r) =>
  r
    .title(label('payroll.authz.payroll.title'))
    .action('view', (a) =>
      a
        .title(label('payroll.authz.actions.view'))
        .grant('employees', employees)
        .grant('payrollCycles', cycles)
        .grant('payslips', payslips),
    )
    .action('import', (a) =>
      a
        .title(label('payroll.authz.payroll.import'))
        .grant('employees', employees)
        .grant('payrollCycles', cyclesWrite)
        .grant('payslips', payslipsWrite),
    )
    .action('calculate', (a) =>
      a
        .title(label('payroll.authz.payroll.calculate'))
        .grant('employees', employees)
        .grant('payrollCycles', cyclesWrite)
        .grant('payslips', payslipsWrite)
        .grant('employeeSalaries', salaries)
        .grant('salaryStructures', structures)
        .grant('employeeSocialInsurances', enrolments)
        .grant('socialInsurancePlans', plans)
        .grant('employeeTaxDeductions', deductions)
        .grant('attendanceMonthlySummaries', summaries),
    )
    .action('submit', (a) =>
      a
        .title(label('payroll.authz.payroll.submit'))
        .grant('payrollCycles', cyclesWrite),
    )
    .action('approve', (a) =>
      a
        .title(label('payroll.authz.payroll.approve'))
        .grant('payrollCycles', cyclesWrite),
    )
    .action('publish', (a) =>
      a
        .title(label('payroll.authz.payroll.publish'))
        .grant('payrollCycles', cyclesWrite)
        .grant('payslips', payslips),
    )
    .action('export', (a) =>
      a
        .title(label('payroll.authz.payroll.export'))
        .grant('employees', employeesForTax)
        .grant('payrollCycles', cyclesWrite)
        .grant('payslips', payslips)
        .grant('employeeSalaries', salaries),
    )
    // 上线准备: 导入个税累计期初 (the cumulative tax figures before go-live).
    .action('importOpening', (a) =>
      a
        .title(label('payroll.opening.authz.taxOpeningImport'))
        .grant('employees', employees)
        .grant('payrollTaxOpenings', taxOpeningsWrite),
    ),
);

export const socialInsuranceResource = defineCompositeResource(
  'talent.socialInsurance',
  (r) =>
    r
      .title(label('payroll.authz.socialInsurance.title'))
      .action('view', (a) =>
        a
          .title(label('payroll.authz.actions.view'))
          .grant('employees', employees)
          .grant('socialInsurancePlans', plans)
          .grant('employeeSocialInsurances', enrolments)
          .grant('employeeTaxDeductions', deductions),
      )
      .action('manage', (a) =>
        a
          .title(label('payroll.authz.actions.manage'))
          .grant('employees', employees)
          .grant('socialInsurancePlans', plansWrite)
          .grant('employeeSocialInsurances', enrolmentsWrite)
          .grant('employeeTaxDeductions', deductionsWrite)
          .grant('payslips', payslips),
      )
      // The 增减员 file (personal data with bases) is an export, granted on its own like the payroll files.
      .action('export', (a) =>
        a
          .title(label('payroll.authz.payroll.export'))
          .grant('employees', employees)
          .grant('employeeSocialInsurances', enrolments),
      )
      // 上线准备: 导入参保 and 导入专项附加扣除.
      .action('import', (a) =>
        a
          .title(label('payroll.opening.authz.insuranceImport'))
          .grant('employees', employees)
          .grant('socialInsurancePlans', plans)
          .grant('employeeSocialInsurances', enrolmentsWrite)
          .grant('employeeTaxDeductions', deductionsWrite),
      ),
);

export const payrollSettingsResource = defineCompositeResource(
  'talent.payrollSettings',
  (r) =>
    r
      .title(label('payroll.authz.settings.title'))
      .action('manage', (a) =>
        a
          .title(label('payroll.authz.actions.manage'))
          .grant('salaryStructures', structuresWrite)
          .grant('employees', employees),
      )
      // The payroll AI work (算薪异常检查) is configured by its owner's peers, not by hr.admin.
      .action('configure', (a) =>
        a
          .title(label('payroll.authz.actions.configure'))
          .grant('salaryStructures', structures),
      ),
);

export const myPayslipResource = defineCompositeResource(
  'talent.myPayslip',
  (r) =>
    r
      .title(label('payroll.authz.myPayslip.title'))
      .action('view', (a) =>
        a
          .title(label('payroll.authz.actions.view'))
          .grant('employees', employees)
          .grant('payslips', ownPayslips)
          .grant('employeeSocialInsurances', ownEnrolments),
      ),
);

export const vendorBillResource = defineCompositeResource(
  'talent.vendorBill',
  (r) =>
    r
      .title(label('payroll.authz.vendorBill.title'))
      .action('view', (a) =>
        a
          .title(label('payroll.authz.actions.view'))
          .grant('laborVendorBills', bills),
      )
      .action('upload', (a) =>
        a
          .title(label('payroll.authz.vendorBill.upload'))
          .grant('laborVendorBills', billsWrite)
          .grant('employees', employees)
          .grant('attendanceMonthlySummaries', summaries),
      )
      .action('confirm', (a) =>
        a
          .title(label('payroll.authz.vendorBill.confirm'))
          .grant('laborVendorBills', billsWrite),
      )
      .action('export', (a) =>
        a
          .title(label('payroll.authz.payroll.export'))
          .grant('laborVendorBills', bills),
      ),
);

export const PAYROLL_COMPOSITES = [
  salaryResource,
  payrollResource,
  socialInsuranceResource,
  payrollSettingsResource,
  myPayslipResource,
  vendorBillResource,
] as const;

export const PAYROLL_COLLECTIONS: readonly { name: string; title: string }[] = [
  { name: 'salaryStructures', title: 'payroll.collections.salaryStructures' },
  { name: 'employeeSalaries', title: 'payroll.collections.employeeSalaries' },
  { name: 'salaryAdjustments', title: 'payroll.collections.salaryAdjustments' },
  {
    name: 'socialInsurancePlans',
    title: 'payroll.collections.socialInsurancePlans',
  },
  {
    name: 'employeeSocialInsurances',
    title: 'payroll.collections.employeeSocialInsurances',
  },
  {
    name: 'employeeTaxDeductions',
    title: 'payroll.collections.employeeTaxDeductions',
  },
  { name: 'payrollCycles', title: 'payroll.collections.payrollCycles' },
  { name: 'payslips', title: 'payroll.collections.payslips' },
  { name: 'laborVendorBills', title: 'payroll.collections.laborVendorBills' },
  // 上线准备
  {
    name: 'payrollTaxOpenings',
    title: 'payroll.opening.collections.payrollTaxOpenings',
  },
];

/** The pages of the step. */
export const PAYROLL_PAGES = {
  salaries: 'talent.salaries',
  payroll: 'talent.payroll',
  socialInsurance: 'talent.socialInsurance',
  settings: 'talent.payrollSettings',
  myPayslips: 'talent.myPayslips',
} as const;

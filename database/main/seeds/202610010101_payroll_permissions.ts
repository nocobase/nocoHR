import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  myPayslipResource,
  payrollResource,
  payrollSettingsResource,
  salaryResource,
  socialInsuranceResource,
  vendorBillResource,
} from '../../../server/providers/hr/payroll/resources.js';

/**
 * V2-06 权限配置. Creates 薪酬专员 hr.payroll and 薪酬审批 hr.payrollApprover
 * when missing, and gives every employee (hr.employee) their own payslips
 * and enrolment (talent.myPayslip, self scope) and the 工资条 page. hr.admin
 * gets nothing here: it sees no salary data by default. Adds what is
 * missing; an administrator's edits stay.
 */
type Grant = {
  resource: { type: string; id: string };
  actions: { action: string }[];
};

const ALL = 'allRecords';
const SELF = 'talent.self';

const everything = (parts: readonly string[]) =>
  Object.fromEntries(parts.map((part) => [part, ALL]));

const SALARY_PARTS = {
  view: [
    'employees',
    'employeeSalaries',
    'salaryAdjustments',
    'salaryStructures',
  ],
  manage: ['employees', 'employeeSalaries', 'salaryStructures'],
  adjust: ['employees', 'employeeSalaries', 'salaryAdjustments'],
  approveAdjustment: ['employees', 'employeeSalaries', 'salaryAdjustments'],
} as const;
const PAYROLL_PARTS = {
  view: ['employees', 'payrollCycles', 'payslips'],
  import: ['employees', 'payrollCycles', 'payslips'],
  calculate: [
    'employees',
    'payrollCycles',
    'payslips',
    'employeeSalaries',
    'salaryStructures',
    'employeeSocialInsurances',
    'socialInsurancePlans',
    'employeeTaxDeductions',
    'attendanceMonthlySummaries',
  ],
  submit: ['payrollCycles'],
  approve: ['payrollCycles'],
  publish: ['payrollCycles', 'payslips'],
  export: ['employees', 'payrollCycles', 'payslips', 'employeeSalaries'],
} as const;
const INSURANCE_PARTS = {
  view: [
    'employees',
    'socialInsurancePlans',
    'employeeSocialInsurances',
    'employeeTaxDeductions',
  ],
  manage: [
    'employees',
    'socialInsurancePlans',
    'employeeSocialInsurances',
    'employeeTaxDeductions',
    'payslips',
  ],
} as const;
const BILL_PARTS = {
  view: ['laborVendorBills'],
  upload: ['laborVendorBills', 'employees', 'attendanceMonthlySummaries'],
  confirm: ['laborVendorBills'],
  export: ['laborVendorBills'],
} as const;

function pick<T extends Record<string, readonly string[]>>(
  parts: T,
  actions: readonly (keyof T)[],
) {
  return Object.fromEntries(
    actions.map((action) => [action, everything(parts[action])]),
  );
}

const composites = [
  {
    resource: salaryResource,
    grants: {
      'hr.payroll': pick(SALARY_PARTS, ['view', 'manage', 'adjust']),
      // The approver reads the adjustments waiting for them, not every salary file.
      'hr.payrollApprover': pick(SALARY_PARTS, ['approveAdjustment']),
    },
  },
  {
    resource: payrollResource,
    grants: {
      'hr.payroll': pick(PAYROLL_PARTS, [
        'view',
        'import',
        'calculate',
        'submit',
        'publish',
        'export',
      ]),
      'hr.payrollApprover': pick(PAYROLL_PARTS, ['view', 'approve']),
    },
  },
  {
    resource: socialInsuranceResource,
    grants: { 'hr.payroll': pick(INSURANCE_PARTS, ['view', 'manage']) },
  },
  {
    resource: payrollSettingsResource,
    grants: {
      'hr.payroll': {
        manage: { salaryStructures: ALL, employees: ALL },
        configure: { salaryStructures: ALL },
      },
    },
  },
  {
    resource: vendorBillResource,
    grants: {
      'hr.payroll': pick(BILL_PARTS, ['view', 'upload', 'confirm', 'export']),
      'hr.payrollApprover': pick(BILL_PARTS, ['view']),
    },
  },
  {
    resource: myPayslipResource,
    grants: {
      'hr.employee': {
        view: {
          employees: SELF,
          payslips: SELF,
          employeeSocialInsurances: SELF,
        },
      },
    },
  },
] as const;

const pages: Record<string, readonly string[]> = {
  'hr.payroll': [
    'talent.salaries',
    'talent.payroll',
    'talent.socialInsurance',
    'talent.payrollSettings',
  ],
  'hr.payrollApprover': ['talent.salaries', 'talent.payroll'],
  'hr.employee': ['talent.myPayslips'],
};

const NEW_SETS: Record<string, string> = {
  'hr.payroll': 'payroll.permissionSets.hrPayroll',
  'hr.payrollApprover': 'payroll.permissionSets.hrPayrollApprover',
};

function decode(value: unknown): Grant[] {
  let decoded: unknown = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
    decoded = JSON.parse(decoded);
  if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
  return decoded as Grant[];
}

const seed: SeedDefinition = defineSeed({
  name: '202610010101_payroll_permissions',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    for (const key of ['hr.payroll', 'hr.payrollApprover', 'hr.employee']) {
      let row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row && NEW_SETS[key]) {
        await query
          .insertInto('authorizationPermissionSets')
          .values({
            id: key,
            key,
            title: encodeAuthorizationTitle({ key: NEW_SETS[key], ns: 'hr' }),
            grants: JSON.stringify([]),
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        row = { id: key, grants: '[]' };
      }
      if (!row) throw new Error(`Missing required permission set: ${key}`);
      const list = decode(row.grants);
      const before = JSON.stringify(list);
      for (const composite of composites) {
        const addition = (composite.grants as Record<string, unknown>)[key];
        if (!addition) continue;
        const reference = composite.resource.reference() as unknown as {
          grant(assignments: unknown): Grant;
        };
        const grant = reference.grant(addition);
        const existing = list.find(
          (item) =>
            item.resource.type === grant.resource.type &&
            item.resource.id === grant.resource.id,
        );
        if (!existing) list.push(grant);
        else
          for (const action of grant.actions)
            if (!existing.actions.some((item) => item.action === action.action))
              existing.actions.push(action);
      }
      for (const id of pages[key]) {
        const page = list.find(
          (item) => item.resource.type === 'page' && item.resource.id === id,
        );
        if (!page)
          list.push({
            resource: { type: 'page', id },
            actions: [{ action: 'access' }],
          });
        else if (!page.actions.some((a) => a.action === 'access'))
          page.actions.push({ action: 'access' });
      }
      if (JSON.stringify(list) !== before)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(list), updatedAt: now })
          .where('id', '=', String(row.id))
          .execute();
    }
  },
});
export default seed;

/** V2-06 payroll API shapes, as `server/routes/hr/payroll.ts` answers them. */
import type { ApprovalStepView } from '@/components/talent/payroll-shared';
import type { PayslipLineView } from '@/components/talent/payroll-payslip';

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/u;

export interface Allowance {
  code: string;
  amount: number;
}

export interface SalaryRow {
  employeeId: string;
  employeeNo: string;
  name: string;
  departmentId: string;
  status: string;
  hireDate: string | null;
  baseSalary: number | null;
  fixedAllowances: Allowance[];
  effectiveMonth: string | null;
  salaryStructureId: string | null;
  structureTitle: string | null;
  bankAccount: string | null;
  lastAdjustment: { id: string; status: string; effectiveMonth: string } | null;
}

export interface SalaryList {
  month: string;
  rows: SalaryRow[];
  pendingFiles: {
    employeeId: string;
    employeeNo: string;
    name: string;
    departmentId: string;
    hireDate: string | null;
  }[];
  can: { manage: boolean; adjust: boolean };
}

export interface SalaryFile {
  id: string;
  employeeId: string;
  effectiveMonth: string;
  baseSalary: number;
  fixedAllowances: Allowance[];
  salaryStructureId: string;
  bankAccount: {
    bankName?: string | null;
    accountNo?: string | null;
    accountName?: string | null;
  } | null;
  source: string;
  createdAt: string | null;
}

export interface Adjustment {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeNo?: string;
  effectiveMonth: string;
  changes: {
    before?: {
      baseSalary: number;
      fixedAllowances: Allowance[];
      salaryStructureId: string;
    };
    after?: {
      baseSalary: number;
      fixedAllowances: Allowance[];
      salaryStructureId: string;
    };
    payRange?: { min: number; max: number; outOfRange: boolean } | null;
  };
  reason: string;
  relatedActionId: string | null;
  status: string;
  approvals: ApprovalStepView[];
  applicantUserId: string;
  canDecide?: boolean;
  createdAt: string | null;
}

export interface StructureItem {
  code: string;
  title: string;
  kind: 'earning' | 'deduction' | 'reference';
  calc: 'fixed' | 'formula' | 'manual' | 'imported';
  formula: string | null;
  unit: string | null;
  departmentIds: string[];
  taxable: boolean;
  includedInSocialBase: boolean;
  sortOrder?: number;
}

export interface StructureParam {
  code: string;
  title: string;
  value: number;
  unit: string | null;
}

export interface Structure {
  id: string;
  title: string;
  appliesTo: { jobFamilyIds: string[]; departmentIds: string[] };
  items: StructureItem[];
  params: StructureParam[];
  payRanges: {
    positionId?: string | null;
    grade?: string | null;
    min: number;
    max: number;
  }[];
  payDaysPerMonth: number;
  changeLog: {
    by: string;
    byName: string | null;
    at: string;
    summary: string;
  }[];
  active: boolean;
}

export interface Cycle {
  id: string;
  month: string;
  status: string;
  imports: {
    id: string;
    itemCodes: string[];
    source: string;
    rowCount: number;
    errorRows: number;
    importedAt: string;
  }[];
  calculatedAt: string | null;
  calculationId: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvals: ApprovalStepView[];
  approvedAt: string | null;
  publishedAt: string | null;
  exports: { kind: string; at: string; action: string }[];
  review: {
    calculationId: string;
    checkedAt: string;
    total: number;
    added: string[];
    removed: string[];
    summary?: string | null;
  } | null;
}

export interface CycleListItem extends Cycle {
  payslips: number;
  issues: number;
  totalNet: number | null;
}

export interface Prerequisites {
  participants: number;
  attendance: {
    ready: boolean;
    unlocked: {
      departmentId: string;
      departmentTitle: string;
      count: number;
      names: string[];
    }[];
  };
  salaryFiles: {
    missing: { employeeId: string; name: string; employeeNo: string }[];
  };
  insurance: {
    missing: { employeeId: string; name: string; employeeNo: string }[];
  };
  deductions: { count: number };
  imports: {
    code: string;
    title: string;
    unit: string | null;
    applicable: number;
    imported: number;
  }[];
}

export interface CycleDetail {
  cycle: Cycle;
  prerequisites: Prerequisites | null;
  importableItems: { code: string; title: string; unit: string | null }[];
  can: {
    import: boolean;
    calculate: boolean;
    submit: boolean;
    approve: boolean;
    publish: boolean;
    export: boolean;
  };
}

export interface PayslipRowView {
  id: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  departmentId: string | null;
  departmentTitle: string;
  gross: number | null;
  socialEmployee: number | null;
  housingFundEmployee: number | null;
  tax: number | null;
  net: number | null;
  calculated: boolean;
  issues: number;
  manualItems: number;
  importedValues: Record<string, number>;
}

export interface Issue {
  key: string;
  type: string;
  severity: string;
  facts: Record<string, string | number | boolean | null>;
  note: string | null;
  noteSource: 'ai' | 'rule' | null;
  payslipId: string;
  employeeId: string;
  name: string;
  employeeNo: string;
}

export interface PayslipDetail {
  id: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  departmentTitle: string;
  month: string;
  lines: PayslipLineView[] | null;
  gross: number | null;
  socialEmployee: number | null;
  housingFundEmployee: number | null;
  tax: number | null;
  net: number | null;
  importedValues: Record<string, number>;
  manualItems: { code: string; amount: number; reason: string; by: string }[];
  issues: Omit<Issue, 'payslipId' | 'employeeId' | 'name' | 'employeeNo'>[];
  inputs: Record<string, unknown> | null;
}

export interface ImportPreview {
  items: { code: string; title: string }[];
  unknownColumns: string[];
  rows: {
    row: number;
    employeeNo: string;
    name: string;
    values: Record<string, number>;
    errors: { code: string; item?: string }[];
  }[];
  validRows: number;
  errorRows: number;
}

export interface ReconciliationLine {
  employeeId: string | null;
  employeeNo: string;
  name: string;
  billedHours: number;
  attendanceHours: number | null;
  diffHours: number | null;
  reason: 'notMatched' | 'diff' | 'notInAttendance' | null;
}

export interface VendorBill {
  id: string;
  vendorName: string;
  month: string;
  lines: {
    row: number;
    employeeNo: string;
    name: string;
    billedHours: number;
    amount: number | null;
  }[];
  reconciliation: ReconciliationLine[];
  aiNotes: string | null;
  status: string;
  uploads: { at: string; rows: number }[];
  totals: {
    billedHours: number;
    attendanceHours: number;
    diffHours: number;
    diffPeople: number;
    unmatched: number;
    notInAttendance: number;
  };
}

export type { ApprovalStepView, PayslipLineView };

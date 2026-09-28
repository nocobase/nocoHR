export interface EmployeesOutletContext {
  /** Refreshes the list behind an overlay. */
  readonly reload: () => void;
}

export interface EmployeeDetailOutletContext {
  readonly reload: () => void;
}

export const EMPLOYEE_STATUSES = [
  'pending',
  'probation',
  'active',
  'leave',
] as const;
export const EMPLOYMENT_TYPES = [
  'fullTime',
  'partTime',
  'intern',
  'outsourced',
] as const;
export const GENDERS = ['male', 'female', 'other'] as const;
export const ID_TYPES = ['idCard', 'passport', 'other'] as const;
export const LEAVE_REASONS = [
  'resign',
  'dismiss',
  'contractEnd',
  'other',
] as const;

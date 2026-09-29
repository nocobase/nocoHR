/** V2-05 approval planning only. Submission persists the returned steps in a
 * transaction; authorization and the current-step predicate still gate decisions.
 * Unlike the older personnel-action path, a missing manager never auto-approves.
 */
export interface AttendanceApprovalDepartment {
  readonly id: string;
  readonly parentId: string | null;
  readonly managerId: string | null;
}

export interface AttendanceApprovalStep {
  readonly kind: 'counterparty' | 'departmentHead' | 'hrAdmin';
  readonly approverUserId: string | null;
  readonly departmentId: string | null;
  readonly status: 'pending' | 'waiting';
}

export function planAttendanceApproval(input: {
  readonly type: 'leave' | 'missingPunch' | 'overtime' | 'shiftSwap';
  readonly employeeUserId: string | null;
  readonly submittedBy: string;
  readonly departmentId: string;
  readonly departments: readonly AttendanceApprovalDepartment[];
  readonly leaveDays?: number;
  readonly leaveBalanceRule?:
    'annualBySeniority' | 'fixedPerEvent' | 'earned' | 'none';
  readonly leaveSecondLevelDays: number;
  readonly projectedMonthlyOvertimeHours?: number;
  readonly monthlyOvertimeAlertHours: number;
  readonly counterpartyUserId?: string;
}): AttendanceApprovalStep[] {
  const nonnegative = (value: number | undefined): value is number =>
    value !== undefined && Number.isFinite(value) && value >= 0;
  if (
    !input.submittedBy ||
    !nonnegative(input.leaveSecondLevelDays) ||
    !nonnegative(input.monthlyOvertimeAlertHours) ||
    (input.type === 'leave' &&
      (!nonnegative(input.leaveDays) || input.leaveDays === 0)) ||
    (input.type === 'overtime' &&
      !nonnegative(input.projectedMonthlyOvertimeHours))
  )
    throw new Error('INVALID_INPUT');

  const departments = new Map(input.departments.map((d) => [d.id, d]));
  if (departments.size !== input.departments.length)
    throw new Error('INVALID_DEPARTMENT_TREE');
  const excluded = new Set([input.employeeUserId, input.submittedBy]);
  const steps: AttendanceApprovalStep[] = [];
  if (input.type === 'shiftSwap') {
    if (!input.counterpartyUserId || excluded.has(input.counterpartyUserId))
      throw new Error('INVALID_COUNTERPARTY');
    excluded.add(input.counterpartyUserId);
    steps.push({
      kind: 'counterparty',
      approverUserId: input.counterpartyUserId,
      departmentId: null,
      status: 'pending',
    });
  }

  let departmentId: string | null = input.departmentId;
  const seen = new Set<string>();
  let manager: AttendanceApprovalDepartment | undefined;
  while (departmentId) {
    if (seen.has(departmentId)) throw new Error('INVALID_DEPARTMENT_TREE');
    seen.add(departmentId);
    const department = departments.get(departmentId);
    if (!department) throw new Error('INVALID_DEPARTMENT_TREE');
    if (department.managerId && !excluded.has(department.managerId)) {
      manager = department;
      break;
    }
    departmentId = department.parentId;
  }
  if (!manager) throw new Error('APPROVER_NOT_CONFIGURED');
  steps.push({
    kind: 'departmentHead',
    approverUserId: manager.managerId,
    departmentId: manager.id,
    status: steps.length ? 'waiting' : 'pending',
  });

  const needsHr =
    (input.type === 'leave' &&
      (input.leaveDays! > input.leaveSecondLevelDays ||
        input.leaveBalanceRule === 'fixedPerEvent')) ||
    (input.type === 'overtime' &&
      input.projectedMonthlyOvertimeHours! > input.monthlyOvertimeAlertHours);
  if (needsHr)
    steps.push({
      kind: 'hrAdmin',
      approverUserId: null,
      departmentId: null,
      status: 'waiting',
    });
  return steps;
}

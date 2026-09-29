export interface LeaveType {
  id: string;
  code: string;
  title: string;
  payType: 'paid' | 'partial' | 'unpaid';
  unit: 'day' | 'halfDay' | 'hour';
  balanceRule: 'annualBySeniority' | 'fixedPerEvent' | 'earned' | 'none';
  fixedDays: number | null;
  requiresAttachment: boolean;
  countBy: 'workdays' | 'schedule' | 'calendar';
  active: boolean;
  updatedAt: string;
}
export interface LeaveBalance {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  leaveTypeTitle: string;
  year: number;
  entitled: number;
  carriedOver: number;
  used: number;
  pending: number;
  adjusted: number;
  available: number;
  needsCareerStartDate: boolean;
  frozen: boolean;
  updatedAt: string;
  adjustments: {
    idempotencyKey?: string;
    delta: number;
    reason: string;
    by: string;
    at: string;
  }[];
}
export interface LeaveListContext<T> {
  saved: (row: T) => void;
  reload: () => void;
}

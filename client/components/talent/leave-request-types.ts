export interface LeaveRequestDetail {
  id: string;
  employeeId: string;
  employeeName: string | null;
  leaveTypeId: string;
  leaveTypeTitle: string | null;
  leaveUnit: 'day' | 'halfDay' | 'hour' | null;
  startAt: string;
  endAt: string;
  duration: number;
  reason: string | null;
  attachmentFileId: string | null;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  updatedAt: string;
  canApprove: boolean;
  canEdit: boolean;
  isOwnRequest: boolean;
  canCancel: boolean;
  approvals: {
    kind: string;
    approverUserId: string | null;
    departmentId: string | null;
    status: 'waiting' | 'pending' | 'approved' | 'rejected';
    decidedAt: string | null;
    comment: string | null;
  }[];
}

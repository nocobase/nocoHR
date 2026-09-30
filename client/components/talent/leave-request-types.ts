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
  /** 界面追加字段 values this reader may see (e.g. 工作交接人). */
  customFields?: Record<string, unknown>;
  approvals: {
    kind: string;
    approverUserId: string | null;
    departmentId: string | null;
    status: 'waiting' | 'pending' | 'approved' | 'rejected';
    decidedAt: string | null;
    comment: string | null;
  }[];
}

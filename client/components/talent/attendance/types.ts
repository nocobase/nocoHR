/** V2-05 考勤与假期: the shapes the attendance, schedule and adjustment endpoints answer with. */

export interface ScheduleCheck {
  readonly rule: string;
  readonly level: 'block' | 'warn';
  readonly message: string;
}

/** Checks keyed `employeeId:date`, as validate, save and their 409 details return them. */
export type CheckMap = Record<string, ScheduleCheck[]>;

export interface ScheduleEmployee {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly status: string;
  readonly departmentId: string;
  readonly hireDate: string | null;
  readonly leaveDate: string | null;
}

export interface ShiftOption {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly startTime: string;
  readonly endTime: string;
  readonly breakMinutes: number;
  readonly isNight: boolean;
  readonly departmentIds: string[] | null;
  readonly active: boolean;
}

export interface CoverCandidate {
  readonly employeeId: string;
  readonly name: string | null;
  readonly reasons?: string[];
}

/** 顶班邀请 sent from the cover dialog; `response` is null while waiting. */
export interface CoverInvitation {
  readonly employeeId: string;
  readonly name?: string | null;
  readonly sentAt: string;
  readonly response: 'accepted' | 'declined' | 'expired' | null;
  readonly respondedAt: string | null;
}

export interface ScheduleCell {
  readonly id: string;
  readonly employeeId: string;
  readonly date: string;
  readonly shiftId: string | null;
  readonly status: 'draft' | 'published';
  readonly checkResult: ScheduleCheck[] | null;
  readonly replacementSuggestion: {
    readonly candidates: CoverCandidate[];
    readonly suggestedAt?: string;
    readonly invitations?: CoverInvitation[];
  } | null;
  readonly publishedAt: string | null;
  readonly updatedAt: string | null;
}

export interface ScheduleBoard {
  readonly departmentId: string;
  readonly from: string;
  readonly to: string;
  readonly dates: string[];
  readonly employees: ScheduleEmployee[];
  readonly shifts: ShiftOption[];
  readonly cells: ScheduleCell[];
  readonly meta: { employeeTruncated?: boolean; scheduleTruncated?: boolean };
}

export interface RotationTemplate {
  readonly key: string;
  readonly title: string;
  readonly shiftCodes: string[];
  readonly periodDays: number;
  readonly workDays: number;
}

export interface AttendanceEmployee {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly departmentId: string;
  readonly userId?: string | null;
  readonly status?: string;
}

export type RecordStatus =
  | 'normal'
  | 'late'
  | 'earlyLeave'
  | 'missingPunch'
  | 'absent'
  | 'leave'
  | 'rest';

export interface AttendanceRecord {
  readonly id: string;
  readonly employeeId: string;
  readonly date: string;
  readonly shiftId: string | null;
  readonly punches: { at: string; source: string }[];
  readonly checkIn: string | null;
  readonly checkOut: string | null;
  /** A `RecordStatus`; unknown future values are shown as they come. */
  readonly status: string;
  readonly lateMinutes: number | null;
  readonly earlyMinutes: number | null;
  readonly workedMinutes: number | null;
  readonly overtimeMinutes: number | null;
  readonly leaveRequestId: string | null;
  /** 已说明: the approved 考勤异常说明 of the day. */
  readonly excusedByAdjustmentId?: string | null;
  /** 人事助理的追问 about this anomaly. */
  readonly inquiry?: AttendanceInquiry | null;
}

export interface AttendanceInquiry {
  readonly askedAt: string;
  readonly channel: string;
  readonly reply: string | null;
  readonly repliedAt: string | null;
  readonly draftAdjustmentId: string | null;
  readonly remindedAt?: string | null;
}

export interface Objection {
  readonly note: string;
  readonly at: string;
  readonly handledBy: string | null;
  readonly result: string | null;
}

export interface MonthlySummary {
  readonly id: string;
  readonly employeeId: string;
  readonly month: string;
  readonly scheduledDays: number;
  readonly workedDays: number;
  readonly lateCount: number;
  readonly earlyCount: number;
  readonly missingCount: number;
  readonly absentDays: number;
  readonly leaveByType: Record<string, number>;
  readonly overtimeByType: Record<string, number>;
  readonly nightShiftCount: number;
  readonly shiftCounts: Record<string, number>;
  readonly status: 'draft' | 'confirmed' | 'locked';
  readonly objection: Objection | null;
  readonly confirmedAt: string | null;
  readonly lockedBy: string | null;
  readonly lockedAt: string | null;
  readonly lockLog: unknown[];
  readonly confirmBy: 'employee' | 'hr';
  readonly updatedAt: string | null;
}

export interface MySchedule {
  readonly date: string;
  readonly shiftId: string | null;
  readonly code: string | null;
  readonly title: string | null;
  readonly startTime: string | null;
  readonly endTime: string | null;
  readonly isNight: boolean;
}

export interface MyAttendance {
  readonly employee: AttendanceEmployee;
  readonly schedules: MySchedule[];
  readonly records: AttendanceRecord[];
  readonly summary: MonthlySummary | null;
  readonly missingPunchUsed: number;
  readonly missingPunchLimit: number;
  readonly confirmationDays: number;
}

export type AdjustmentType =
  'missingPunch' | 'overtime' | 'shiftSwap' | 'exception';
export const ADJUSTMENT_TYPES: readonly AdjustmentType[] = [
  'missingPunch',
  'overtime',
  'shiftSwap',
  'exception',
];

export interface AdjustmentStep {
  readonly level: number;
  readonly kind: 'counterparty' | 'departmentHead' | 'hrAdmin' | 'extra';
  readonly approverUserId: string | null;
  readonly status: 'pending' | 'waiting' | 'approved' | 'rejected';
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly comment: string | null;
  /** 经飞书卡片: submitted (first step) or decided on an office-suite card. */
  readonly submittedVia?: 'feishuCard';
  readonly via?: 'feishuCard';
}

export interface Adjustment {
  readonly id: string;
  readonly type: AdjustmentType;
  readonly employeeId: string;
  readonly employeeName?: string;
  readonly employeeNo?: string;
  readonly departmentId?: string;
  readonly date: string;
  readonly details: {
    readonly at?: string;
    readonly startAt?: string;
    readonly endAt?: string;
    readonly hours?: number;
    readonly overtimeType?: 'workday' | 'restDay' | 'holiday';
    readonly counterpartEmployeeId?: string;
    readonly counterpartDate?: string;
    readonly myShiftId?: string | null;
    readonly theirShiftId?: string | null;
    /** 考勤异常说明: the explained anomaly and the policy clause it cites. */
    readonly anomaly?: 'late' | 'earlyLeave';
    readonly minutes?: number;
    readonly policy?: {
      readonly documentId: string;
      readonly documentTitle: string;
      readonly citation: string;
    };
  };
  readonly reason: string;
  readonly status: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  /** hrAssistant: drafted by the HR assistant, submitted by the employee. */
  readonly source?: 'self' | 'hrAssistant';
  readonly approvals: AdjustmentStep[];
  /** 界面追加字段 values this reader may see, keyed by the definition's key. */
  readonly customFields?: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly canDecide?: boolean;
  readonly canCancel?: boolean;
  /** The employee's own draft: submit or discard it. */
  readonly canSubmit?: boolean;
}

export interface SwapPeer {
  readonly employeeId: string;
  readonly name: string;
  readonly employeeNo: string;
  readonly scheduled: boolean;
  readonly shiftTitle: string | null;
  readonly shiftCode: string | null;
}

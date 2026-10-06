export interface LookupDepartment {
  readonly id: string;
  readonly code: string | null;
  readonly title: string;
  readonly parentId: string | null;
  readonly active: boolean;
}

export interface LookupPosition {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly active: boolean;
  readonly jobFamilyId: string;
}

export interface Lookups {
  readonly departments: LookupDepartment[];
  readonly positions: LookupPosition[];
}

export interface CompetencyLevel {
  readonly id: string;
  readonly competencyId: string;
  readonly level: number;
  readonly title: string;
  readonly behaviors: string;
}

export interface GapRow {
  readonly competencyId: string;
  readonly code: string;
  readonly title: string;
  readonly category: string;
  readonly maxLevel: number;
  readonly requiredLevel: number | null;
  readonly mandatory: boolean;
  readonly currentLevel: number;
  readonly gap: number;
  readonly levels: CompetencyLevel[];
}

export interface AssessmentRow {
  readonly id: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly level: number;
  readonly source: string;
  readonly evidence: string | null;
  readonly assessedBy: string;
  readonly assessedByName: string;
  readonly assessedAt: string;
}

export interface Employee {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly userId: string | null;
  readonly departmentId: string;
  readonly positionId: string | null;
  readonly managerEmployeeId: string | null;
  readonly status: string;
  readonly hireDate: string | null;
  readonly careerStartDate: string | null;
  readonly positionSince: string | null;
  readonly email: string | null;
  readonly gender: string | null;
  readonly idType: string | null;
  readonly employmentType: string;
  readonly workLocation: string | null;
  readonly probationEndDate: string | null;
  readonly regularizedAt: string | null;
  readonly leaveDate: string | null;
  readonly leaveReason: string | null;
  readonly mobile?: string | null;
  readonly idNumber?: string | null;
  readonly birthDate?: string | null;
  readonly address?: string | null;
  /** V1-02 V2 增补: where the employee is reached after leaving (HR administrators and the person). */
  readonly personalEmail?: string | null;
  readonly note?: string | null;
  /** 界面追加字段: values the viewer may read, keyed by internal key. */
  readonly customFields?: Record<string, unknown>;
  /** V1-03: the office-suite identity this employee is bound to. */
  readonly externalProvider?: string | null;
  readonly externalUserId?: string | null;
  /** A sync leaves this employee's department, position, manager and status alone. */
  readonly syncLocked?: boolean;
}

export interface EmployeeListItem extends Employee {
  readonly departmentTitle: string;
  readonly positionTitle: string | null;
  readonly managerName: string | null;
  readonly gapCount: number;
  readonly tenureMonths: number | null;
}

export interface EmployeeDetail {
  readonly employee: Employee;
  readonly departmentTitle: string;
  readonly positionTitle: string | null;
  readonly managerName: string | null;
  readonly userName: string | null;
  readonly coreFieldsLocked: boolean;
  /** V1-03: the office suite is the data master and this employee is bound to it. */
  readonly syncManaged?: boolean;
  readonly can: {
    readonly update: boolean;
    readonly linkUser: boolean;
    readonly markLeave: boolean;
    /** 更正任职信息: HR only, in service, and not switched off in 人事设置. */
    readonly correctJob: boolean;
    readonly delete: boolean;
    readonly assess: boolean;
    readonly viewAssessments: boolean;
    readonly viewSensitive: boolean;
    readonly viewNotes: boolean;
    readonly viewProfile: boolean;
    readonly viewContacts: boolean;
    readonly manageProfile: boolean;
    readonly viewContracts: boolean;
  };
}

export interface EmployeeProfile {
  readonly educations: Record<string, unknown>[];
  readonly experiences: Record<string, unknown>[];
  readonly emergencyContacts: Record<string, unknown>[];
  readonly attachments: (Record<string, unknown> & {
    file: Record<string, unknown> | null;
  })[];
  readonly can: { readonly manage: boolean; readonly viewContacts: boolean };
}

export interface Contract {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly contractNo: string;
  readonly type: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly signedAt: string | null;
  readonly status: string;
  readonly previousContractId: string | null;
  readonly fileId: string | null;
  readonly filePath: string | null;
  readonly note: string | null;
  readonly remainingDays: number | null;
}

export interface JobEvent {
  readonly id: string;
  readonly eventType: string;
  readonly effectiveDate: string | null;
  readonly fromDepartment: string | null;
  readonly toDepartment: string | null;
  readonly fromPosition: string | null;
  readonly toPosition: string | null;
  readonly actionId: string | null;
  /** action: a personnel action; manual: 更正任职信息 or a backfilled employee; import: an Excel import. */
  readonly source?: 'action' | 'manual' | 'import' | 'sync';
  /** The reason a manual correction gave. */
  readonly note?: string | null;
}

export interface ApprovalStep {
  readonly level: number;
  /** extra: a level an administrator added for a department in 人事设置 · 审批链. */
  readonly kind: 'departmentHead' | 'hrAdmin' | 'extra';
  /** An added level's name; default levels are named by kind. */
  readonly name?: string | null;
  /** Levels folded into this one because the same person approves them. */
  readonly merged?: readonly {
    readonly kind: 'departmentHead' | 'hrAdmin' | 'extra';
    readonly name: string | null;
  }[];
  readonly approverUserIds?: readonly string[];
  /** Any HR administrator decides this level. */
  readonly anyHrAdmin?: boolean;
  /** Why the configured approver does not decide: none found, or the employee themselves. */
  readonly fallback?: 'noApprover' | 'selfEscalated' | null;
  /** Filled in by the chain previews only. */
  readonly approverNames?: readonly string[];
  readonly approverUserId: string | null;
  readonly departmentId: string | null;
  readonly status: 'pending' | 'approved' | 'rejected' | 'auto';
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly comment: string | null;
  /** feishuCard: decided on a Feishu approval card. */
  readonly via?: 'feishuCard' | null;
}

export interface PersonnelAction {
  readonly id: string;
  readonly actionType: string;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly candidate: Record<string, unknown> | null;
  readonly fromDepartmentId: string | null;
  readonly fromPositionId: string | null;
  readonly toDepartmentId: string | null;
  readonly toPositionId: string | null;
  readonly effectiveDate: string;
  readonly reason: string | null;
  readonly leaveReason: string | null;
  /** V1-02 V2 增补: the contact address given on a 离职单; present only when the viewer may read it. */
  readonly personalEmail?: string | null;
  readonly status: string;
  readonly applicantUserId: string;
  readonly applicantName: string | null;
  readonly approvals: ApprovalStep[];
  readonly currentApproverUserId: string | null;
  readonly currentLevel: number | null;
  readonly effectiveAt: string | null;
  readonly createdAt: string;
  readonly can: { readonly approve: boolean; readonly cancel: boolean };
}

export interface ProfileChangeRequest {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly changes: Record<string, unknown>;
  readonly current: Record<string, unknown>;
  /** self: the employee's own request; ai: the HR assistant's reading of an attachment. */
  readonly source?: 'self' | 'assistant' | 'feishuCard' | 'ai';
  readonly attachmentFileId?: string | null;
  /** The protected content path of that attachment. */
  readonly attachmentPath?: string | null;
  readonly confidence?: Record<
    string,
    { readonly confidence: number; readonly snippet: string }
  > | null;
  readonly status: string;
  readonly reviewerUserId: string | null;
  readonly reviewedAt: string | null;
  readonly comment: string | null;
  readonly createdAt: string;
}

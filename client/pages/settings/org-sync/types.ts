/** V1-03 组织同步: what `talent/org-sync*` and `talent/position-aliases*` answer with. */

export type Provider = 'feishu' | 'dingtalk' | 'wecom';
export type OrgMaster = 'nocohr' | 'external';

export const PROVIDERS: readonly Provider[] = ['feishu', 'dingtalk', 'wecom'];

export interface OrgSyncSettings {
  readonly provider: Provider;
  readonly scopeRootDepartments: string[];
  readonly orgMaster: OrgMaster;
  readonly syncDepartmentTree: boolean;
  readonly fullSyncTime: string;
  readonly syncedProbationMonths: number;
  readonly masterChangedBy: string | null;
  readonly masterChangedAt: string | null;
}

export interface SettingsSnapshot {
  readonly value: OrgSyncSettings;
  readonly revision: number;
}

export interface SyncStats {
  readonly departmentsCreated: number;
  readonly departmentsUpdated: number;
  readonly departmentsDeactivated: number;
  readonly membersCreated: number;
  readonly membersUpdated: number;
  readonly membersDeactivated: number;
  readonly bound: number;
  readonly jobEvents: number;
  readonly issues: number;
}

export type RunStatus = 'running' | 'succeeded' | 'partial' | 'failed';

export interface SyncRun {
  readonly id: string;
  readonly provider: string;
  readonly mode: 'full' | 'incremental';
  readonly orgMaster: OrgMaster;
  readonly triggeredBy: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly status: RunStatus;
  readonly stats: SyncStats | null;
  readonly error: string | null;
}

export interface OrgSyncStatus {
  readonly settings: SettingsSnapshot;
  readonly source: {
    readonly label: string;
    readonly configured: boolean;
  } | null;
  readonly lastRun: SyncRun | null;
}

export const ISSUE_TYPES = [
  'unmappedTitle',
  'unknownParentDepartment',
  'departmentRemoved',
  'departmentAmbiguous',
  'duplicateMatch',
  'managerOutOfScope',
  'noAccount',
  'lockedChange',
  'newMember',
  'deactivatedMember',
  'orgMismatch',
  'managerMismatch',
  'departmentManagerMismatch',
  'contractPending',
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];
export type IssueStatus = 'open' | 'inProgress' | 'resolved' | 'ignored';

export interface SyncIssue {
  readonly key: string;
  readonly type: IssueType;
  readonly externalId: string;
  readonly employeeId?: string | null;
  readonly departmentId?: string | null;
  readonly detail: Record<string, unknown>;
  readonly status: IssueStatus;
  readonly actionId?: string | null;
  readonly aiExplanation?: string | null;
  readonly aiSuggestedAction?: string | null;
  readonly aiExplainedAt?: string | null;
}

export interface IssuesResponse {
  readonly runId: string | null;
  readonly orgMaster: OrgMaster;
  readonly issues: SyncIssue[];
}

export interface PositionAlias {
  readonly id: string;
  readonly provider: string;
  readonly externalTitle: string;
  readonly positionId: string;
  readonly positionTitle: string | null;
  readonly source: 'manual' | 'ai' | 'import';
  readonly reviewStatus: 'draft' | 'confirmed';
  readonly draftReason: string | null;
  readonly confirmedBy: string | null;
  readonly confirmedAt: string | null;
  readonly headcount: number;
}

export interface OrgSyncOutletContext {
  readonly status: OrgSyncStatus | undefined;
  readonly statusError: unknown;
  readonly reloadStatus: () => void;
  /** Bumped after 立即同步 so the tabs reload what the run changed. */
  readonly epoch: number;
  readonly bump: () => void;
  /** 问人事助理 with the current tab and, optionally, one item; absent without the permission. */
  readonly askAssistant?: (issue: SyncIssue | null) => void;
}

export const ORG_SYNC_TABS = [
  'connection',
  'runs',
  'issues',
  'aliases',
] as const;

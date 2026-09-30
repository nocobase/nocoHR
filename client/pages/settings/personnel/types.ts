/** The 人事设置 sections as `GET talent/personnel-settings` answers them (server/providers/hr/personnel-settings.ts). */
export interface Snapshot<T> {
  revision: number;
  value: T;
}

export const ACTION_TYPES = [
  'onboard',
  'regularize',
  'transfer',
  'promote',
  'offboard',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const SELF_SERVICE_FIELDS = [
  'mobile',
  'email',
  'address',
  'educations',
  'experiences',
  'emergencyContacts',
] as const;

export type ChainApprover =
  | { type: 'departmentHead'; departmentId: string }
  | { type: 'user'; userId: string }
  | { type: 'permissionSet'; key: string };

export interface ChainRule {
  id: string;
  departmentId: string;
  actionTypes: ActionType[];
  name: string;
  approver: ChainApprover;
  position: 'afterFirst' | 'afterHr';
  enabled: boolean;
}

export interface Settings {
  reminders: {
    probationDays: number;
    contractDays: number[];
    dailyTime: string;
  };
  probation: { maxMonths: number };
  approvalChain: { rules: ChainRule[]; mergeAdjacent: boolean };
  selfService: { fields: string[] };
  gradeOrder: { families: Record<string, string[]> };
  jobInfo: { importMayChangeJob: boolean; allowCorrection: boolean };
  /** V1-04 制度复核: advance notice, overdue reminder interval and default review cycle. */
  knowledge: {
    reviewNoticeDays: number;
    overdueIntervalDays: number;
    defaultReviewMonths: number;
  };
  /** V1-02 变动影响清单. */
  checklists: {
    onboard: boolean;
    change: boolean;
    offboard: boolean;
    reminderIntervalDays: number;
  };
  /** V1-02 用工合规检查. */
  compliance: {
    enabled: boolean;
    checks: {
      secondFixedTerm: boolean;
      probationLimit: boolean;
      noContract: boolean;
      expiredContract: boolean;
    };
    noContractDays: number;
    probationLimits: {
      underThreeMonths: number;
      underOneYear: number;
      underThreeYears: number;
      threeYearsOrOpen: number;
    };
  };
}
export type Section = keyof Settings;
export type AllSettings = { [K in Section]: Snapshot<Settings[K]> };

export interface SettingsOptions {
  permissionSets: { key: string; title: unknown }[];
  jobFamilies: {
    id: string;
    title: string;
    active: boolean;
    grades: string[];
  }[];
}

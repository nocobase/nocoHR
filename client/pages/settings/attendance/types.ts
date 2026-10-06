export const SETTINGS_API = 'talent/attendance-settings';
export interface CatalogContext {
  saved: (kind: 'shifts' | 'rules', record: Shift | Rule) => void;
  gone: (kind: 'shifts' | 'rules', id: string) => void;
}
export interface CatalogRecord {
  id: string;
  title: string;
  updatedAt: string;
  active: boolean;
  departmentIds: string[] | null;
}
export interface Shift extends CatalogRecord {
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  isNight: boolean;
}
export interface Rule extends CatalogRecord {
  workHourSystem: 'standard' | 'comprehensive' | 'flexible';
  punchSource: 'feishu' | 'dingtalk' | 'wecom' | 'device';
  lateGraceMinutes: number;
  overtimeRequiresApproval: boolean;
  /** 允许说明豁免 (V2-05 realigned); absent on rules saved before it existed. */
  exceptionExcusable?: boolean;
  monthlyOvertimeAlertHours: number;
  minRestHours: number;
  maxConsecutiveNights: number;
}
export interface Configuration {
  limits: {
    leaveSecondLevelDays: number;
    monthlyMissingPunchLimit: number;
    monthlyConfirmationDays: number;
    consecutiveMissingReminderDays: number;
    overtimeReminderRatio: number;
  };
  annualLeave: { bands: { minimumYears: number; days: number }[] };
  calendar: {
    years: { year: number; holidays: string[]; adjustedWorkdays: string[] }[];
    /** 每周休息日 (0 = Sunday … 6 = Saturday); the server answers [0, 6] when not set. */
    weeklyRestDays?: number[];
  };
  /** V2-05 轮班模板. */
  rotations: {
    templates: {
      key: string;
      title: string;
      shiftCodes: string[];
      periodDays: number;
      workDays: number;
    }[];
  };
  /** V2-05 半天与小时假. */
  leaveUnits: {
    hourStep: number;
    standardDayHours: number;
    dayWindow: { start: string; end: string };
  };
  /** V2-05 预计当月加班. */
  overtime: { standardDayHours: number };
  /** V2-05 按部门追加审批级别. */
  approval: {
    extraLevels: {
      departmentId: string;
      approverUserId: string;
      types: ('leave' | 'missingPunch' | 'overtime' | 'shiftSwap')[];
    }[];
  };
}
export type Section = keyof Configuration;
export interface Versioned<T> {
  value: T;
  revision: number;
}
export interface SettingsData {
  shifts: { data: Shift[]; meta: { truncated: boolean } };
  rules: { data: Rule[]; meta: { truncated: boolean } };
  departments: {
    data: { id: string; title: string; active: boolean }[];
    meta: { truncated: boolean };
  };
}

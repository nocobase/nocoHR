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

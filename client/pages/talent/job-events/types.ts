export const EVENT_TYPES = [
  'onboard',
  'regularize',
  'transfer',
  'promote',
  'offboard',
] as const;

export const EVENT_SOURCES = ['action', 'sync', 'import', 'manual'] as const;

/** The endpoint returns at most this many events and no total. */
export const JOB_EVENT_CAP = 500;

export interface JobEventRow {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string | null;
  readonly eventType: string;
  readonly effectiveDate: string | null;
  readonly fromDepartment: string | null;
  readonly toDepartment: string | null;
  readonly fromPosition: string | null;
  readonly toPosition: string | null;
  readonly source: (typeof EVENT_SOURCES)[number];
  readonly actionId: string | null;
  readonly syncRunId: string | null;
  readonly note: string | null;
  readonly processedAt: string | null;
  readonly processError: string | null;
}

export interface JobEventsResponse {
  readonly items: JobEventRow[];
  readonly can: { readonly retry: boolean };
}

export interface JobEventsOutletContext {
  readonly reload: () => void;
  readonly canViewRuns: boolean;
}

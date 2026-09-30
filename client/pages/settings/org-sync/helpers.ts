import type { useLookups } from '@/components/talent/use-lookups';

import type { RunStatus, SyncIssue, SyncRun } from './types.js';

type Lookups = Pick<ReturnType<typeof useLookups>, 'departmentTitle'>;
type FullLookups = ReturnType<typeof useLookups>;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The toast after a run: counts on success, the reason on failure. */
export function runToast(
  run: SyncRun,
  t: Translate,
): {
  type: 'success' | 'warning' | 'error';
  title: string;
  description?: string;
} {
  if (run.status === 'failed')
    return {
      type: 'error',
      title: t('orgSync.run.failed'),
      description: run.error ?? undefined,
    };
  return {
    type: run.status === 'partial' ? 'warning' : 'success',
    title: t(
      run.status === 'partial' ? 'orgSync.run.partial' : 'orgSync.run.done',
    ),
    description: t('orgSync.run.summary', {
      ...runCounts(run),
      issues: run.stats?.issues ?? 0,
    }),
  };
}

/** New, updated and deactivated counts across departments and members. */
export function runCounts(run: SyncRun): {
  created: number;
  updated: number;
  deactivated: number;
} {
  const s = run.stats;
  return {
    created: (s?.departmentsCreated ?? 0) + (s?.membersCreated ?? 0),
    updated: (s?.departmentsUpdated ?? 0) + (s?.membersUpdated ?? 0),
    deactivated:
      (s?.departmentsDeactivated ?? 0) + (s?.membersDeactivated ?? 0),
  };
}

export function runStatusVariant(
  status: RunStatus,
): 'secondary' | 'outline' | 'destructive' {
  return status === 'failed'
    ? 'destructive'
    : status === 'succeeded'
      ? 'secondary'
      : 'outline';
}

export function formatDateTime(
  value: string | null | undefined,
  locale: string,
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

/** The item's name as a heading: the person or department it is about. */
export function issueSubject(issue: SyncIssue, lookups: Lookups): string {
  const d = issue.detail;
  if (text(d.name)) return text(d.name);
  if (issue.departmentId) return lookups.departmentTitle(issue.departmentId);
  if (text(d.title)) return text(d.title);
  return issue.externalId;
}

/** The item types an administrator settles by choosing a department or a binding. */
export const ASSIGNABLE_TYPES = [
  'departmentAmbiguous',
  'unknownParentDepartment',
  'duplicateMatch',
] as const;

interface Choice {
  readonly field: 'departmentId' | 'employeeId' | 'memberId';
  readonly options: readonly { value: string; label: string }[];
}

/** What the dialog offers for an item: its candidates, or every department for a missing parent. */
export function choiceOf(
  issue: SyncIssue,
  lookups: Pick<FullLookups, 'departments' | 'departmentTitle'>,
  employeeName: (id: string) => string | undefined,
): Choice {
  const d = issue.detail;
  if (issue.type === 'departmentAmbiguous')
    return {
      field: 'departmentId',
      options: (Array.isArray(d.candidates) ? d.candidates : []).map((id) => ({
        value: text(id),
        label: lookups.departmentTitle(text(id)),
      })),
    };
  if (issue.type === 'unknownParentDepartment')
    return {
      field: 'departmentId',
      options: lookups.departments.map((dept) => ({
        value: dept.id,
        label: `${'  '.repeat(dept.depth)}${dept.label}`,
      })),
    };
  if (Array.isArray(d.candidates))
    return {
      field: 'employeeId',
      options: (d.candidates as Record<string, unknown>[]).map((c) => ({
        value: text(c.id),
        label: `${text(c.name) || employeeName(text(c.id)) || text(c.id)}${
          text(c.employeeNo) ? ` · ${text(c.employeeNo)}` : ''
        }`,
      })),
    };
  return {
    field: 'memberId',
    options: (Array.isArray(d.members) ? d.members : []).map((id) => ({
      value: text(id),
      label: text(id),
    })),
  };
}

export interface AssistantContext {
  /** The tab the administrator asked from. */
  readonly tab: string;
  /** The pending item selected when asking, if any. */
  readonly issue: SyncIssue | null;
}

/** The work context the chat carries: the tab, and the item without anything personal beyond what the page shows. */
export function workContextOf(
  context: AssistantContext,
  t: (key: string) => string,
) {
  return [
    {
      type: 'orgSyncTab',
      id: context.tab,
      title: `${t('orgSync.title')} / ${t(`orgSync.tabs.${context.tab}`)}`,
      content: { tab: context.tab },
    },
    ...(context.issue
      ? [
          {
            type: 'orgSyncIssue',
            id: context.issue.key,
            title: t(`orgSync.issueType.${context.issue.type}.title`),
            content: {
              key: context.issue.key,
              type: context.issue.type,
              status: context.issue.status,
              externalId: context.issue.externalId,
              employeeId: context.issue.employeeId ?? null,
              departmentId: context.issue.departmentId ?? null,
            },
          },
        ]
      : []),
  ];
}

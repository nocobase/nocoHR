import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { useLookups } from '@/components/talent/use-lookups';

import { text } from './helpers.js';
import type { SyncIssue } from './types.js';

type Lookups = ReturnType<typeof useLookups>;

interface Row {
  readonly label: string;
  /** What NocoHR holds, when the item compares the two sides. */
  readonly nocohr?: string;
  /** What the office suite says. */
  readonly external: string;
}

function place(
  lookups: Lookups,
  value: unknown,
): { department: string; position: string } {
  const v = (value ?? {}) as Record<string, unknown>;
  return {
    department: lookups.departmentTitle(text(v.departmentId)) || '—',
    position: lookups.positionTitle(text(v.positionId)) || '—',
  };
}

function rowsOf(
  issue: SyncIssue,
  lookups: Lookups,
  t: (key: string, options?: Record<string, unknown>) => string,
  employeeName: (id: string) => string | undefined,
): Row[] {
  const d = issue.detail;
  const label = (field: string) => t(`orgSync.issueField.${field}`);
  switch (issue.type) {
    case 'unmappedTitle':
      return [{ label: label('title'), external: text(d.title) || '—' }];
    case 'unknownParentDepartment':
    case 'departmentAmbiguous':
      return [
        { label: label('department'), external: text(d.name) || '—' },
        { label: label('path'), external: text(d.path) || '—' },
        ...(Array.isArray(d.candidates)
          ? [
              {
                label: label('candidates'),
                external: d.candidates
                  .map((id) => lookups.departmentTitle(text(id)))
                  .join('、'),
              },
            ]
          : []),
      ];
    case 'departmentRemoved':
      return [
        {
          label: label('inService'),
          nocohr: text(d.inService) || '0',
          external: t('orgSync.issueField.removed'),
        },
      ];
    case 'duplicateMatch': {
      const candidates = Array.isArray(d.candidates)
        ? (d.candidates as Record<string, unknown>[])
        : [];
      const employee = d.employee as Record<string, unknown> | undefined;
      return candidates.length
        ? [
            {
              label: label('candidates'),
              nocohr: candidates
                .map((c) => `${text(c.name)} (${text(c.employeeNo)})`)
                .join('、'),
              external: text(d.name),
            },
          ]
        : [
            {
              label: label('members'),
              nocohr: employee
                ? `${text(employee.name)} (${text(employee.employeeNo)})`
                : '—',
              external: Array.isArray(d.members)
                ? d.members.map(text).join('、')
                : '—',
            },
          ];
    }
    case 'managerOutOfScope':
      return [
        { label: label('manager'), external: text(d.managerUserId) || '—' },
      ];
    case 'noAccount':
      return [
        {
          label: label('account'),
          nocohr: t('orgSync.issueField.noAccount'),
          external: text(d.name) || '—',
        },
      ];
    case 'lockedChange': {
      const want = place(lookups, d.want);
      return [
        { label: label('department'), external: want.department },
        { label: label('position'), external: want.position },
      ];
    }
    case 'newMember':
      return [
        { label: label('employeeNo'), external: text(d.employeeNo) || '—' },
        {
          label: label('department'),
          external: lookups.departmentTitle(text(d.departmentId)) || '—',
        },
        { label: label('title'), external: text(d.title) || '—' },
        {
          label: label('position'),
          external:
            lookups.positionTitle(text(d.positionId)) ||
            t('orgSync.issueField.unmapped'),
        },
        { label: label('mobile'), external: text(d.mobile) || '—' },
        { label: label('email'), external: text(d.email) || '—' },
      ];
    case 'deactivatedMember':
      return [
        {
          label: label('state'),
          nocohr: t('orgSync.issueField.employed'),
          external: t('orgSync.issueField.deactivatedAt', {
            date: text(d.deactivatedAt) || '—',
          }),
        },
      ];
    case 'orgMismatch': {
      const from = place(lookups, d.from);
      const to = place(lookups, d.to);
      return [
        {
          label: label('department'),
          nocohr: from.department,
          external: to.department,
        },
        {
          label: label('position'),
          nocohr: from.position,
          external: to.position,
        },
      ];
    }
    case 'managerMismatch':
      return [
        {
          label: label('manager'),
          nocohr:
            text(d.fromName) ||
            (d.from ? (employeeName(text(d.from)) ?? text(d.from)) : '—'),
          external: text(d.toName) || '—',
        },
      ];
    case 'departmentManagerMismatch':
      return [
        {
          label: label('head'),
          nocohr: text(d.fromName) || (d.from ? text(d.from) : '—'),
          external: text(d.toName) || '—',
        },
      ];
    case 'contractPending':
      return [
        { label: label('contract'), external: text(d.contractNo) || '—' },
      ];
    default:
      return [];
  }
}

/** Both sides of an item: NocoHR's value and the office suite's. */
export function IssueDetails({
  issue,
  lookups,
  provider,
  employeeName = () => undefined,
}: {
  issue: SyncIssue;
  lookups: Lookups;
  provider: string;
  /** Resolves a NocoHR employee id to a name, where the caller has the list. */
  employeeName?: (id: string) => string | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  const rows = rowsOf(issue, lookups, t, employeeName);
  if (!rows.length) return null;
  const compared = rows.some((r) => r.nocohr !== undefined);
  return (
    <dl
      className={
        compared
          ? 'grid grid-cols-[6rem_1fr_1fr] gap-x-3 gap-y-1 text-sm'
          : 'grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm'
      }
    >
      {compared ? (
        <>
          <span aria-hidden='true' />
          <span className='text-xs text-muted-foreground'>
            {t('orgSync.issueField.nocohrSide')}
          </span>
          <span className='text-xs text-muted-foreground'>{provider}</span>
        </>
      ) : null}
      {rows.map((row) => (
        <div key={row.label} className='contents'>
          <dt className='text-muted-foreground'>{row.label}</dt>
          {compared ? (
            <dd className='break-words'>{row.nocohr ?? '—'}</dd>
          ) : null}
          <dd className='break-words font-medium'>{row.external}</dd>
        </div>
      ))}
    </dl>
  );
}

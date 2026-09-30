import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { errorCode } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

import { formatDateTime, issueSubject, runStatusVariant } from './helpers.js';
import { IssueDetails } from './issue-details.js';
import type { SyncIssue, SyncRun, SyncStats } from './types.js';

const STAT_KEYS: readonly (keyof SyncStats)[] = [
  'departmentsCreated',
  'departmentsUpdated',
  'departmentsDeactivated',
  'membersCreated',
  'membersUpdated',
  'membersDeactivated',
  'bound',
  'jobEvents',
  'issues',
];

/** Route `/settings/org-sync/runs/:runId`: one run's statistics and the items it found. */
export default function OrgSyncRunDetail(): ReactElement {
  const { t } = useTranslation();
  return (
    <RouteDrawer
      title={t('orgSync.runs.detailTitle')}
      description={t('orgSync.runs.detailDescription')}
      className='sm:max-w-2xl'
    >
      <RunBody />
    </RouteDrawer>
  );
}

function RunBody(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { runId = '' } = useParams();
  const lookups = useLookups();
  const run = useRemote<SyncRun & { issues: SyncIssue[] }>(
    `talent/org-sync/runs/${encodeURIComponent(runId)}`,
  );
  if (run.error)
    return errorCode(run.error) === 'ORG_SYNC_RUN_NOT_FOUND' ||
      errorCode(run.error) === 'NOT_FOUND' ? (
      <Alert>
        <AlertDescription>{t('orgSync.runs.notFound')}</AlertDescription>
      </Alert>
    ) : (
      <LoadError error={run.error} onRetry={run.reload} />
    );
  if (!run.data) return <BlockSkeleton rows={6} />;
  const data = run.data;
  const issues = data.issues ?? [];
  const number = new Intl.NumberFormat(locale);
  const provider = t(`orgSync.provider.${data.provider}`, {
    defaultValue: data.provider,
  });
  return (
    <div className='space-y-6'>
      <dl className='grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm'>
        <dt className='text-muted-foreground'>{t('orgSync.runs.time')}</dt>
        <dd className='tabular-nums'>
          {formatDateTime(data.startedAt, locale)} –{' '}
          {formatDateTime(data.finishedAt, locale)}
        </dd>
        <dt className='text-muted-foreground'>{t('orgSync.runs.provider')}</dt>
        <dd>{provider}</dd>
        <dt className='text-muted-foreground'>{t('orgSync.runs.mode')}</dt>
        <dd>{t(`orgSync.mode.${data.mode}`)}</dd>
        <dt className='text-muted-foreground'>{t('orgSync.runs.master')}</dt>
        <dd>{t(`orgSync.master.short.${data.orgMaster}`)}</dd>
        <dt className='text-muted-foreground'>{t('orgSync.runs.status')}</dt>
        <dd>
          <Badge variant={runStatusVariant(data.status)}>
            {t(`orgSync.runStatus.${data.status}`)}
          </Badge>
        </dd>
      </dl>
      {data.error ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('orgSync.runs.error', { error: data.error })}
          </AlertDescription>
        </Alert>
      ) : null}
      <section className='space-y-2'>
        <h3 className='text-base font-medium'>{t('orgSync.runs.stats')}</h3>
        <dl className='grid grid-cols-2 gap-2 text-sm sm:grid-cols-3'>
          {STAT_KEYS.map((key) => (
            <div key={key} className='rounded-md border p-3'>
              <dt className='text-muted-foreground'>
                {t(`orgSync.stats.${key}`)}
              </dt>
              <dd className='text-base font-medium tabular-nums'>
                {number.format(data.stats?.[key] ?? 0)}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section className='space-y-2'>
        <h3 className='text-base font-medium'>
          {t('orgSync.runs.itemsTitle')}
        </h3>
        {!issues.length ? (
          <EmptyState title={t('orgSync.runs.noItems')} />
        ) : (
          <ul className='space-y-3'>
            {issues.map((issue) => (
              <li key={issue.key} className='space-y-2 rounded-md border p-3'>
                <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                  {issueSubject(issue, lookups)}
                  <Badge variant='outline'>
                    {t(`orgSync.issueType.${issue.type}.title`)}
                  </Badge>
                  <Badge variant='secondary'>
                    {t(`orgSync.issueStatus.${issue.status}`)}
                  </Badge>
                </p>
                <IssueDetails
                  issue={issue}
                  lookups={lookups}
                  provider={provider}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, Outlet, useLocation, useOutletContext } from 'react-router';

import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { formatDateTime, runCounts, runStatusVariant } from './helpers.js';
import type { OrgSyncOutletContext, SyncRun } from './types.js';

/** Tab 同步记录: the latest 100 runs; a row opens its detail drawer (`runs/:runId`). */
export default function OrgSyncRunsTab(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const location = useLocation();
  const context = useOutletContext<OrgSyncOutletContext>();
  const runs = useRemote<SyncRun[]>('talent/org-sync/runs', {
    refresh: context.epoch,
  });
  const number = new Intl.NumberFormat(locale);
  return (
    <>
      {runs.error && !runs.data ? (
        <LoadError error={runs.error} onRetry={runs.reload} />
      ) : !runs.data ? (
        <BlockSkeleton rows={5} />
      ) : !runs.data.length ? (
        <EmptyState
          title={t('orgSync.runs.empty')}
          description={t('orgSync.runs.emptyDescription')}
        />
      ) : (
        <div className='space-y-2'>
          {runs.loading ? <Spinner aria-label={t('status.loading')} /> : null}
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('orgSync.runs.time')}</TableHead>
                  <TableHead>{t('orgSync.runs.provider')}</TableHead>
                  <TableHead>{t('orgSync.runs.mode')}</TableHead>
                  <TableHead>{t('orgSync.runs.master')}</TableHead>
                  <TableHead>{t('orgSync.runs.status')}</TableHead>
                  <TableHead className='text-right'>
                    {t('orgSync.runs.created')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('orgSync.runs.updated')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('orgSync.runs.deactivated')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('orgSync.runs.events')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('orgSync.runs.issues')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.data.map((run) => {
                  const counts = runCounts(run);
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          className='font-medium tabular-nums hover:underline'
                          to={{
                            pathname: encodeURIComponent(run.id),
                            search: location.search,
                          }}
                        >
                          {formatDateTime(run.startedAt, locale)}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {t(`orgSync.provider.${run.provider}`, {
                          defaultValue: run.provider,
                        })}
                      </TableCell>
                      <TableCell>{t(`orgSync.mode.${run.mode}`)}</TableCell>
                      <TableCell>
                        {t(`orgSync.master.short.${run.orgMaster}`)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={runStatusVariant(run.status)}>
                          {t(`orgSync.runStatus.${run.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {number.format(counts.created)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {number.format(counts.updated)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {number.format(counts.deactivated)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {number.format(run.stats?.jobEvents ?? 0)}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {number.format(run.stats?.issues ?? 0)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      <Outlet context={context} />
    </>
  );
}

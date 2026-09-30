/**
 * V2-07 招聘 / 招聘需求 (`talent.requisitions`): requisitions the viewer may
 * see (hr.admin all; a recruiter theirs; a head their departments'), with
 * their approval state. New and detail open as child pages.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type { Requisition } from '@/components/talent/recruiting-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function RequisitionsPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ items: Requisition[]; can: { create: boolean } }>(
    'talent/recruiting/requisitions',
  );
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('recruiting.requisitions.title')}
          description={t('recruiting.requisitions.description')}
          actions={
            list.data?.can.create ? (
              <Button nativeButton={false} render={<Link to='new' />}>
                <PlusIcon />
                {t('recruiting.requisitions.new')}
              </Button>
            ) : null
          }
        />
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={4} />
        ) : !list.data.items.length ? (
          <EmptyState title={t('recruiting.requisitions.empty')} />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('recruiting.common.position')}</TableHead>
                  <TableHead>{t('recruiting.common.department')}</TableHead>
                  <TableHead className='text-right'>
                    {t('recruiting.common.headcount')}
                  </TableHead>
                  <TableHead>
                    {t('recruiting.requisitions.targetDate')}
                  </TableHead>
                  <TableHead>
                    {t('recruiting.requisitions.recruiter')}
                  </TableHead>
                  <TableHead>{t('recruiting.common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link
                        className='underline-offset-4 hover:underline'
                        to={r.id}
                      >
                        {r.positionTitle}
                      </Link>
                      {r.workforcePlanId ? (
                        <span className='ml-2 text-xs text-muted-foreground'>
                          {t('recruiting.navigation.workforcePlans')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.departmentTitle}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {t('recruiting.requisitions.hired', {
                        hired: r.hiredCount,
                        headcount: r.headcount,
                      })}
                    </TableCell>
                    <TableCell>{r.targetDate}</TableCell>
                    <TableCell>{r.recruiterName ?? '—'}</TableCell>
                    <TableCell>
                      <StatusBadge kind='requisition' value={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageContainer>
      <Outlet context={{ reload: list.reload }} />
    </>
  );
}

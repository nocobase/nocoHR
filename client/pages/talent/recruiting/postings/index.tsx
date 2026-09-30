/**
 * V2-07 招聘 / 职位 (`talent.postings`): postings of the recruiter's
 * requisitions (hr.admin reads them all). A posting opens as a child page.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type { Posting } from '@/components/talent/recruiting-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function PostingsPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ items: Posting[] }>('talent/recruiting/postings');
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('recruiting.postings.title')}
          description={t('recruiting.postings.description')}
        />
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={4} />
        ) : !list.data.items.length ? (
          <EmptyState title={t('recruiting.postings.empty')} />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('recruiting.navigation.postings')}</TableHead>
                  <TableHead>{t('recruiting.common.department')}</TableHead>
                  <TableHead>{t('recruiting.postings.location')}</TableHead>
                  <TableHead className='text-right'>
                    {t('recruiting.reports.applications')}
                  </TableHead>
                  <TableHead>{t('recruiting.common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        className='underline-offset-4 hover:underline'
                        to={p.id}
                      >
                        {p.title}
                      </Link>
                    </TableCell>
                    <TableCell>{p.requisition?.departmentTitle}</TableCell>
                    <TableCell>{p.location}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {p.applicationCount}
                    </TableCell>
                    <TableCell className='space-x-1'>
                      <StatusBadge kind='posting' value={p.status} />
                      <StatusBadge kind='review' value={p.reviewStatus} />
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

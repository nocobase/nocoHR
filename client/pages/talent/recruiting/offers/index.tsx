/**
 * V2-07 招聘 / 录用 (`talent.offers`): the offers the viewer drafts, approves
 * or turns into onboarding actions. Salary appears only for the recruiter and
 * payroll; hr.admin sees accepted offers waiting for the onboarding action.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type { Offer } from '@/components/talent/recruiting-types';
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

export default function OffersPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ items: Offer[] }>('talent/recruiting/offers');
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('recruiting.offers.title')}
          description={t('recruiting.offers.description')}
        />
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={4} />
        ) : !list.data.items.length ? (
          <EmptyState title={t('recruiting.offers.empty')} />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('recruiting.public.name')}</TableHead>
                  <TableHead>{t('recruiting.common.position')}</TableHead>
                  <TableHead>{t('recruiting.offers.startDate')}</TableHead>
                  <TableHead className='text-right'>
                    {t('recruiting.offers.baseSalary')}
                  </TableHead>
                  <TableHead>{t('recruiting.common.status')}</TableHead>
                  <TableHead>{t('recruiting.common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link
                        className='underline-offset-4 hover:underline'
                        to={o.id}
                      >
                        {o.candidateName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {o.departmentTitle} · {o.positionTitle}
                    </TableCell>
                    <TableCell>{o.startDate}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {o.salaryOffer
                        ? Number(o.salaryOffer.baseSalary).toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind='offer' value={o.status} />
                    </TableCell>
                    <TableCell>
                      {o.can.onboard ? (
                        <Link
                          className='underline underline-offset-4'
                          to={`${o.id}/onboard`}
                        >
                          {t('recruiting.offers.onboard')}
                        </Link>
                      ) : null}
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

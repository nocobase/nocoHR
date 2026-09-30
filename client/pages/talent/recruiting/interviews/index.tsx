/**
 * V2-07 招聘 / 面试 (`talent.interviews`): 我的面试 for interviewers, and the
 * rounds of the recruiter's requisitions. An interview opens as a child page.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { formatDateTime } from '@/components/talent/recruiting-lib';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type { InterviewListItem } from '@/components/talent/recruiting-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function InterviewsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const mine = params.get('view') !== 'all';
  const list = useRemote<{
    items: InterviewListItem[];
    can: { schedule: boolean };
  }>('talent/recruiting/interviews', mine ? { mine: '1' } : undefined);
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('recruiting.interviews.title')}
          description={t('recruiting.interviews.description')}
        />
        {list.data?.can.schedule || !mine ? (
          <Tabs
            value={mine ? 'mine' : 'all'}
            onValueChange={(value) => {
              const next = new URLSearchParams(params);
              next.set('view', String(value));
              setParams(next, { replace: true });
            }}
          >
            <TabsList>
              <TabsTrigger value='mine'>
                {t('recruiting.interviews.mine')}
              </TabsTrigger>
              <TabsTrigger value='all'>
                {t('recruiting.interviews.all')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : null}
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={4} />
        ) : !list.data.items.length ? (
          <EmptyState title={t('recruiting.interviews.empty')} />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('recruiting.interviews.scheduledAt')}
                  </TableHead>
                  <TableHead>{t('recruiting.public.name')}</TableHead>
                  <TableHead>{t('recruiting.candidates.posting')}</TableHead>
                  <TableHead>{t('recruiting.interviews.mode')}</TableHead>
                  <TableHead>{t('recruiting.interviews.scorecards')}</TableHead>
                  <TableHead>{t('recruiting.common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link
                        className='underline-offset-4 hover:underline'
                        to={i.id}
                      >
                        {formatDateTime(i.scheduledAt)}
                      </Link>
                    </TableCell>
                    <TableCell>{i.candidateName}</TableCell>
                    <TableCell>{i.postingTitle}</TableCell>
                    <TableCell>
                      {t(`recruiting.labels.mode.${i.mode}`)}
                      {i.selfBooked ? (
                        <Badge className='ml-2' variant='secondary'>
                          {t('recruiting.interviews.selfBooked')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {t('recruiting.interviews.progress', {
                        submitted: i.submittedCount,
                        total: i.interviewerCount,
                      })}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind='interview' value={i.status} />
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

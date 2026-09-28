import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import type { ExamSummary } from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { ExamsOutletContext } from './types.js';

/** 考试管理 — exams an instructor is responsible for: papers, publishing, grading and attempts. */
export default function ExamsPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ items: ExamSummary[]; canCreate: boolean }>(
    'talent/exams',
  );
  const context = useMemo<ExamsOutletContext>(
    () => ({ reload: list.reload }),
    [list.reload],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentExams')}
        description={t('talent.exams.description')}
        actions={
          list.data?.canCreate ? (
            <Link to='new' className={buttonVariants()}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.exams.create')}
            </Link>
          ) : null
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.items.length ? (
        <EmptyState title={t('talent.exams.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talent.exams.fields.title')}</TableHead>
                <TableHead>{t('talent.exams.fields.paperMode')}</TableHead>
                <TableHead className='text-right'>
                  {t('talent.exams.fields.questions')}
                </TableHead>
                <TableHead className='hidden text-right sm:table-cell'>
                  {t('talent.exams.fields.duration')}
                </TableHead>
                <TableHead className='hidden text-right sm:table-cell'>
                  {t('talent.exams.fields.passScore')}
                </TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                <TableHead className='hidden text-right md:table-cell'>
                  {t('talent.exams.fields.candidates')}
                </TableHead>
                <TableHead className='hidden text-right md:table-cell'>
                  {t('talent.exams.fields.passRate')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((exam) => (
                <TableRow key={exam.id}>
                  <TableCell className='font-medium'>
                    <Link
                      to={encodeURIComponent(exam.id)}
                      className='hover:underline'
                    >
                      {exam.title}
                    </Link>
                    {exam.grading ? (
                      <Badge variant='default' className='ml-2'>
                        {t('talent.exams.gradingCount', {
                          count: exam.grading,
                        })}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {t(`talent.exams.paperModes.${exam.paperMode}`)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {exam.questionCount} / {exam.totalScore}
                  </TableCell>
                  <TableCell className='hidden text-right tabular-nums sm:table-cell'>
                    {t('talent.learning.minutes', {
                      count: exam.durationMinutes,
                    })}
                  </TableCell>
                  <TableCell className='hidden text-right tabular-nums sm:table-cell'>
                    {exam.passScore}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        !exam.active
                          ? 'outline'
                          : exam.published
                            ? 'secondary'
                            : 'outline'
                      }
                    >
                      {!exam.active
                        ? t('talent.common.disabled')
                        : exam.published
                          ? t('talent.exams.published')
                          : t('talent.exams.unpublished')}
                    </Badge>
                  </TableCell>
                  <TableCell className='hidden text-right tabular-nums md:table-cell'>
                    {exam.candidates}
                  </TableCell>
                  <TableCell className='hidden text-right tabular-nums md:table-cell'>
                    {exam.passRate === null ? '—' : `${exam.passRate}%`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

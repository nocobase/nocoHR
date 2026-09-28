import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { ClipboardCheckIcon, PlayIcon, TrophyIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import type { Attempt, MyExam } from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

import type { MyExamsOutletContext } from './types.js';

const BUCKETS = ['todo', 'grading', 'passed', 'failed'] as const;

/** 我的考试 — exams to take (from assignments or certification requirements), awaiting grading, passed and failed. */
export default function MyExamsPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<MyExam[]>('talent/my-exams');
  const context = useMemo<MyExamsOutletContext>(
    () => ({ reload: list.reload }),
    [list.reload],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentMyExams')}
        description={t('talent.myExams.description')}
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.length ? (
        <EmptyState
          title={t('talent.myExams.empty')}
          description={t('talent.myExams.emptyDescription')}
        />
      ) : (
        <div className='space-y-6'>
          {BUCKETS.map((bucket) => {
            const items = list.data!.filter((e) => e.bucket === bucket);
            if (!items.length) return null;
            return (
              <section
                key={bucket}
                className='space-y-3'
                aria-labelledby={`exam-${bucket}`}
              >
                <h2
                  id={`exam-${bucket}`}
                  className='flex items-center gap-2 font-heading text-base font-semibold'
                >
                  {t(`talent.myExams.buckets.${bucket}`)}
                  <span className='text-sm font-normal text-muted-foreground'>
                    {items.length}
                  </span>
                </h2>
                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                  {items.map((exam) => (
                    <ExamCard key={exam.examId} exam={exam} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

function ExamCard({ exam }: { exam: MyExam }): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.request<{ data: Attempt }>({
        path: `talent/my-exams/${encodeURIComponent(exam.examId)}/start`,
        method: 'POST',
      });
      void navigate(`attempts/${encodeURIComponent(result.data.id)}`);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className='space-y-3'>
        <div className='flex items-start justify-between gap-2'>
          <span className='flex items-center gap-2 font-medium'>
            {exam.bucket === 'passed' ? (
              <TrophyIcon className='size-4 text-primary' />
            ) : (
              <ClipboardCheckIcon className='size-4 text-primary' />
            )}
            {exam.title}
          </span>
          {exam.sources.includes('certification') ? (
            <Badge variant='outline'>
              {t('talent.myExams.forCertification')}
            </Badge>
          ) : null}
        </div>
        <dl className='grid grid-cols-3 gap-2 text-xs'>
          <div>
            <dt className='text-muted-foreground'>
              {t('talent.myExams.duration')}
            </dt>
            <dd className='font-medium tabular-nums'>
              {t('talent.learning.minutes', { count: exam.durationMinutes })}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>
              {t('talent.myExams.remaining')}
            </dt>
            <dd className='font-medium tabular-nums'>
              {exam.remainingAttempts} / {exam.maxAttempts}
            </dd>
          </div>
          <div>
            <dt className='text-muted-foreground'>
              {t('talent.exams.bestScore')}
            </dt>
            <dd className='font-medium tabular-nums'>
              {exam.bestScore ?? '—'}
            </dd>
          </div>
        </dl>
        {exam.dueDate ? (
          <p className='text-xs text-muted-foreground'>
            {t('talent.learning.due', {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
              }).format(new Date(`${exam.dueDate}T00:00:00`)),
            })}
          </p>
        ) : null}
        <div className='flex flex-wrap gap-2'>
          {exam.inProgressAttemptId ? (
            <Link
              to={`attempts/${encodeURIComponent(exam.inProgressAttemptId)}`}
              className={buttonVariants({ size: 'sm' })}
            >
              <PlayIcon data-icon='inline-start' />
              {t('talent.myExams.resume')}
            </Link>
          ) : exam.bucket === 'todo' ||
            (exam.bucket === 'failed' && exam.remainingAttempts > 0) ? (
            <Button size='sm' disabled={busy} onClick={() => void start()}>
              <PlayIcon data-icon='inline-start' />
              {exam.attemptsUsed
                ? t('talent.myExams.retake')
                : t('talent.myExams.start')}
            </Button>
          ) : null}
          {exam.latestAttemptId && !exam.inProgressAttemptId ? (
            <Link
              to={`attempts/${encodeURIComponent(exam.latestAttemptId)}`}
              className={buttonVariants({ size: 'sm', variant: 'outline' })}
            >
              {t('talent.myExams.viewResult')}
            </Link>
          ) : null}
        </div>
        {exam.bucket === 'failed' && exam.remainingAttempts === 0 ? (
          <p className='text-xs text-destructive'>
            {t('talent.myExams.noAttemptsLeft')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

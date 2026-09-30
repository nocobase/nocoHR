/**
 * V4-13 填写培训评估 (`/talent/training-evaluations/:evaluationId`): the l1
 * questionnaire of a learner or the l3 of a head, usable at phone width.
 * Answered, expired or someone else's tasks are shown read-only.
 */
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import {
  EvaluationForm,
  type EvaluationQuestion,
} from '@/components/talent/talent-review-evaluation-form';
import { formatDate, useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface Evaluation {
  id: string;
  level: 'l1' | 'l3';
  targetTitle: string;
  employeeName: string;
  status: string;
  dueAt: string | null;
  answers: Record<string, number | string> | null;
  score: number | null;
  questions: EvaluationQuestion[];
  mine: boolean;
}

export default function EvaluationRespondPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { evaluationId = '' } = useParams();
  const path = `talent/training-evaluations/${encodeURIComponent(evaluationId)}`;
  const evaluation = useRemote<Evaluation>(path);
  const action = useTrAction();
  const data = evaluation.data;
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {evaluation.error ? (
          <LoadError error={evaluation.error} onRetry={evaluation.reload} />
        ) : !data ? (
          <BlockSkeleton rows={4} />
        ) : (
          <>
            <PageHeader
              title={data.targetTitle}
              description={
                data.level === 'l3'
                  ? t('talentReview.evaluations.l3Intro', { name: data.employeeName })
                  : t('talentReview.evaluations.l1Intro')
              }
              actions={<TrStatusBadge status={data.status} />}
            />
            <p className='text-muted-foreground text-sm'>
              {t('talentReview.evaluations.due', { date: formatDate(locale, data.dueAt) })}
            </p>
            {action.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{action.error}</AlertDescription>
              </Alert>
            ) : null}
            <EvaluationForm
              questions={data.questions}
              initial={data.answers}
              disabled={!data.mine || data.status !== 'pending'}
              busy={action.busy}
              onSubmit={(answers) => { void (async () => {
                const done = await action.run(
                  { method: 'POST', path: `${path}/submit`, json: { answers } },
                  t('talentReview.evaluations.thanks'),
                );
                if (done) evaluation.reload();
              })(); }}
            />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

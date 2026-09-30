/**
 * V4-12 评价页 — `/talent/team-reviews/:reviewId` (manager and skip-level
 * reviews) and `/talent/my-review/reviews/:reviewId` (self and peer reviews).
 * The left column holds what the reviewer may see: for managers the evidence
 * snapshot and summary, the goals, the self review and the anonymous peer
 * summary; for the person their own snapshot; for peers the goals only. The
 * right column is the form (performance-review-form.tsx).
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { PerformanceReviewForm } from '@/components/talent/performance-review-form';
import { useDateText } from '@/components/talent/performance-hooks';
import {
  EvidenceView,
  PeerSummaryView,
  TaskStatusBadge,
  type ReviewContext,
} from '@/components/talent/performance-shared';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export default function PerformanceReviewPage(): ReactElement {
  const { t } = useTranslation();
  const { reviewId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const date = useDateText();
  const context = useRemote<ReviewContext>(
    `talent/performance/reviews/${encodeURIComponent(reviewId)}`,
  );
  const data = context.data;
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {context.error ? (
          <LoadError error={context.error} onRetry={context.reload} />
        ) : !data ? (
          <BlockSkeleton rows={8} />
        ) : (
          <>
            <PageHeader
              title={t(`performance.review.title.${data.review.role}`, {
                name: data.employee.name,
              })}
              description={t('performance.review.subtitle', {
                cycle: data.cycle.title,
                deadline: date(data.cycle.deadline),
              })}
              actions={<TaskStatusBadge status={data.review.status} />}
            />
            <div className='grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]'>
              <div className='space-y-4'>
                {data.evidence ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('performance.evidence.title')}</CardTitle>
                      <CardDescription>
                        {t('performance.evidence.description')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <EvidenceView
                        snapshot={data.evidence.snapshot}
                        summary={data.evidence.summary}
                      />
                    </CardContent>
                  </Card>
                ) : null}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('performance.goals.title')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data.goals.length ? (
                      <ul className='space-y-2 text-sm'>
                        {data.goals.map((goal) => (
                          <li key={goal.id} className='rounded-md border p-2'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <span className='font-medium break-words'>
                                {goal.title}
                              </span>
                              {goal.source === 'ai' ? (
                                <Badge variant='outline'>
                                  {t('performance.goals.aiSource')}
                                </Badge>
                              ) : null}
                            </div>
                            <p className='text-muted-foreground break-words'>
                              {goal.measure}
                            </p>
                            <p className='text-xs text-muted-foreground'>
                              {t('performance.goals.weightProgress', {
                                weight: goal.weight ?? '—',
                                progress: goal.progress,
                              })}
                              {goal.alignedTitle
                                ? ` · ${t('performance.goals.alignedTo', { title: goal.alignedTitle })}`
                                : ''}
                            </p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className='text-sm text-muted-foreground'>
                        {t('performance.goals.none')}
                      </p>
                    )}
                  </CardContent>
                </Card>
                {data.selfReview ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>
                        {t('performance.review.selfReview')}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className='text-sm break-words whitespace-pre-wrap'>
                      {data.selfReview.comment || '—'}
                    </CardContent>
                  </Card>
                ) : null}
                {data.peers ? (
                  <Card>
                    <CardHeader>
                      <CardTitle>{t('performance.peers.title')}</CardTitle>
                      <CardDescription>
                        {t('performance.peers.anonymous')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <PeerSummaryView peers={data.peers} />
                    </CardContent>
                  </Card>
                ) : null}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>{t('performance.review.form')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <PerformanceReviewForm
                    key={`${data.review.id}:${data.review.submissionCount}:${data.review.status}`}
                    context={data}
                    onSaved={() => {
                      context.reload();
                      outlet?.reload?.();
                    }}
                  />
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

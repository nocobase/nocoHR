/**
 * Offer 详情 (child page): the approvals (the hiring manager sees no
 * salary), the letter, previewing and sending the email (the recruiter
 * confirms the arrival reminder template at the same time), recording an
 * answer by hand, and 待入职跟进 once accepted.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { downloadFile } from '@/components/talent/download';
import { formatDateTime, useAction } from '@/components/talent/recruiting-lib';
import {
  ApprovalList,
  StatusBadge,
} from '@/components/talent/recruiting-shared';
import type { Offer, OfferPreview } from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

export default function OfferDetail(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { offerId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/recruiting/offers/${encodeURIComponent(offerId)}`;
  const detail = useRemote<Offer>(path);
  const { busy, run } = useAction();
  const [comment, setComment] = useState('');
  const [preview, setPreview] = useState<OfferPreview | null>(null);
  const [confirmTemplate, setConfirmTemplate] = useState(true);
  const data = detail.data;
  const refresh = () => {
    detail.reload();
    outlet?.reload?.();
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={
            data
              ? `${data.candidateName} · ${data.positionTitle}`
              : t('recruiting.offers.title')
          }
          description={
            data ? <StatusBadge kind='offer' value={data.status} /> : undefined
          }
          actions={
            data ? (
              <div className='flex flex-wrap gap-2'>
                {data.can?.submit ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => {
                      void (async () => {
                        if (
                          await run(
                            'submit',
                            { path: `${path}/submit` },
                            t('recruiting.common.saved'),
                          )
                        )
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.offers.submit')}
                  </Button>
                ) : null}
                {data.can?.send ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      void run<OfferPreview>('preview', {
                        path: `${path}/preview`,
                        method: 'GET',
                      }).then((p) => setPreview(p ?? null))
                    }
                  >
                    {t('recruiting.offers.preview')}
                  </Button>
                ) : null}
                {data.can?.onboard ? (
                  <Button nativeButton={false} render={<Link to='onboard' />}>
                    {t('recruiting.offers.onboard')}
                  </Button>
                ) : null}
                {data.onboardActionId ? (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={
                      <Link to={`/talent/actions/${data.onboardActionId}`} />
                    }
                  >
                    {t('recruiting.offers.openAction')}
                  </Button>
                ) : null}
                {data.hasLetter && data.can?.salary ? (
                  <Button
                    variant='outline'
                    onClick={() =>
                      void downloadFile(
                        api,
                        `${path}/letter`,
                        `offer-${offerId}.html`,
                      )
                    }
                  >
                    {t('recruiting.offers.letter')}
                  </Button>
                ) : null}
                {data.can?.withdraw ? (
                  <Button
                    variant='ghost'
                    disabled={busy !== null}
                    onClick={() => {
                      void (async () => {
                        if (await run('withdraw', { path: `${path}/withdraw` }))
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.offers.withdraw')}
                  </Button>
                ) : null}
              </div>
            ) : null
          }
        />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <div className='space-y-4'>
            <Card>
              <CardContent className='grid gap-3 pt-6 text-sm sm:grid-cols-2'>
                <p>
                  {t('recruiting.offers.startDate')}：{data.startDate}
                </p>
                <p>
                  {t('recruiting.offers.probation')}：{data.probationMonths}
                </p>
                {data.salaryOffer ? (
                  <>
                    <p>
                      {t('recruiting.offers.baseSalary')}：
                      {Number(data.salaryOffer.baseSalary).toLocaleString()}
                    </p>
                    {data.payRange?.range ? (
                      <p>
                        {t('recruiting.offers.range', {
                          min: data.payRange.range.min,
                          max: data.payRange.range.max,
                        })}
                      </p>
                    ) : null}
                    {data.outOfRangeReason ? (
                      <p className='sm:col-span-2'>
                        {t('recruiting.offers.reason')}：{data.outOfRangeReason}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className='text-muted-foreground sm:col-span-2'>
                    {t('recruiting.offers.salaryHidden')}
                  </p>
                )}
                {data.respondBy ? (
                  <p>
                    {t('recruiting.offers.respondBy', {
                      date: formatDateTime(data.respondBy),
                    })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
            {data.approvals.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('recruiting.requisitions.approvals')}
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <ApprovalList steps={data.approvals} />
                  {data.can?.approve ? (
                    <>
                      <Field>
                        <FieldLabel htmlFor='of-comment'>
                          {t('recruiting.offers.comment')}
                        </FieldLabel>
                        <Textarea
                          id='of-comment'
                          value={comment}
                          onChange={(e) => setComment(e.target.value)}
                        />
                      </Field>
                      <div className='flex gap-2'>
                        <Button
                          disabled={busy !== null}
                          onClick={() => {
                            void (async () => {
                              if (
                                await run(
                                  'approve',
                                  {
                                    path: `${path}/decide`,
                                    json: {
                                      decision: 'approve',
                                      comment: comment || null,
                                    },
                                  },
                                  t('recruiting.requisitions.decided'),
                                )
                              )
                                refresh();
                            })();
                          }}
                        >
                          {t('recruiting.offers.approve')}
                        </Button>
                        <Button
                          variant='outline'
                          disabled={busy !== null}
                          onClick={() => {
                            void (async () => {
                              if (
                                await run(
                                  'reject',
                                  {
                                    path: `${path}/decide`,
                                    json: {
                                      decision: 'reject',
                                      comment: comment || null,
                                    },
                                  },
                                  t('recruiting.requisitions.decided'),
                                )
                              )
                                refresh();
                            })();
                          }}
                        >
                          {t('recruiting.offers.reject')}
                        </Button>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {preview ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.offers.previewTitle')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.offers.to')}：{preview.to ?? '—'}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3 text-sm'>
                  <p className='font-medium'>{preview.subject}</p>
                  <p className='whitespace-pre-wrap'>{preview.body}</p>
                  <div className='rounded-lg border p-3 text-muted-foreground'>
                    <p className='font-medium text-foreground'>
                      {preview.preboardingTemplate.subject}
                    </p>
                    <p className='whitespace-pre-wrap'>
                      {preview.preboardingTemplate.body}
                    </p>
                  </div>
                  <label className='flex items-center gap-2'>
                    <Checkbox
                      checked={confirmTemplate}
                      onCheckedChange={(checked) =>
                        setConfirmTemplate(Boolean(checked))
                      }
                    />
                    {t('recruiting.offers.confirmTemplate')}
                  </label>
                  <Button
                    disabled={busy !== null}
                    onClick={() => {
                      void (async () => {
                        const sent = await run('send', {
                          path: `${path}/send`,
                          json: { confirmPreboardingTemplate: confirmTemplate },
                        });
                        if (sent) {
                          setPreview(null);
                          refresh();
                        }
                      })();
                    }}
                  >
                    {t('recruiting.candidates.send')}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {data.can?.record ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.offers.record')}</CardTitle>
                </CardHeader>
                <CardContent className='flex gap-2'>
                  <Button
                    variant='outline'
                    disabled={busy !== null}
                    onClick={() => {
                      void (async () => {
                        if (
                          await run('accept', {
                            path: `${path}/record`,
                            json: { accept: true },
                          })
                        )
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.offers.recordAccept')}
                  </Button>
                  <Button
                    variant='outline'
                    disabled={busy !== null}
                    onClick={() => {
                      void (async () => {
                        if (
                          await run('decline', {
                            path: `${path}/record`,
                            json: { accept: false },
                          })
                        )
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.offers.recordDecline')}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {data.status === 'accepted' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.offers.preboarding')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-1 text-sm'>
                  <p>
                    {t('recruiting.offers.reminders')}：
                    {data.preboarding.remindersSent
                      .map((r) => `${r.day}`)
                      .join('、') || '—'}
                  </p>
                  <p>
                    {data.preboarding.arrivalConfirmedAt
                      ? `${t('recruiting.offers.arrival')} · ${formatDateTime(data.preboarding.arrivalConfirmedAt)}`
                      : t('recruiting.offers.arrivalPending')}
                  </p>
                  <p>
                    {t('recruiting.offers.uploads')}：
                    {data.preboarding.uploads
                      .map((u) => t(`recruiting.labels.upload.${u.kind}`))
                      .join('、') || '—'}
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

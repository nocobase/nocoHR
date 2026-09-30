/**
 * 招聘需求详情 (child page): the position's job description and the
 * checklist, the approval record, submitting (a missing job description is
 * pointed out first), approving — hr.admin names the recruiter — and the
 * postings and pool suggestions once it opens.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { RequisitionForm } from '@/components/talent/recruiting-requisition-form';
import { errorCode } from '@/components/talent/errors';
import {
  useAction,
  useRecruitingError,
} from '@/components/talent/recruiting-lib';
import {
  ApprovalList,
  PeoplePicker,
  StatusBadge,
} from '@/components/talent/recruiting-shared';
import type { Requisition } from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { useApiClient } from '@nocobase/app-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

export default function RequisitionDetail(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const { requisitionId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const detail = useRemote<Requisition>(
    `talent/recruiting/requisitions/${encodeURIComponent(requisitionId)}`,
  );
  const { busy, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const [recruiter, setRecruiter] = useState<string[]>([]);
  const [missing, setMissing] = useState(false);
  const data = detail.data;
  const refresh = () => {
    detail.reload();
    outlet?.reload?.();
  };
  const path = `talent/recruiting/requisitions/${encodeURIComponent(requisitionId)}`;
  async function submit(confirmMissingResponsibilities = false) {
    try {
      await api.request({
        path: `${path}/submit`,
        method: 'POST',
        json: { confirmMissingResponsibilities },
      });
      toast.add({
        type: 'success',
        title: t('recruiting.requisitions.submitted'),
      });
      setMissing(false);
      refresh();
    } catch (error) {
      if (errorCode(error) === 'REQUISITION_RESPONSIBILITIES_MISSING')
        setMissing(true);
      else toast.add({ type: 'error', title: failure(error) });
    }
  }
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={
            data
              ? `${data.departmentTitle} · ${data.positionTitle} × ${data.headcount}`
              : t('recruiting.requisitions.title')
          }
          description={
            data ? (
              <StatusBadge kind='requisition' value={data.status} />
            ) : undefined
          }
          actions={
            data?.can?.edit ? (
              <div className='flex gap-2'>
                <Button variant='outline' onClick={() => setEditing((v) => !v)}>
                  {t('recruiting.common.edit')}
                </Button>
                <Button disabled={busy !== null} onClick={() => void submit()}>
                  {t('recruiting.requisitions.submit')}
                </Button>
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
            {missing ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('recruiting.requisitions.responsibilitiesMissing')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Button variant='outline' onClick={() => void submit(true)}>
                    {t('recruiting.requisitions.confirmMissing')}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
            {editing ? (
              <Card>
                <CardContent className='pt-6'>
                  <RequisitionForm
                    initial={data}
                    busy={busy !== null}
                    onSubmit={(values) => {
                      void (async () => {
                        if (
                          await run(
                            'update',
                            { path, method: 'PUT', json: values },
                            t('recruiting.common.saved'),
                          )
                        ) {
                          setEditing(false);
                          refresh();
                        }
                      })();
                    }}
                  />
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('recruiting.requisitions.responsibilities')}
                </CardTitle>
                <CardDescription>
                  {[data.jobFamily, data.grade].filter(Boolean).join(' · ')}
                  {data.workforcePlanId ? (
                    <>
                      {' · '}
                      <Link
                        className='underline underline-offset-4'
                        to={`/talent/workforce-plans/${data.workforcePlanId}`}
                      >
                        {t('recruiting.navigation.workforcePlans')}
                      </Link>
                    </>
                  ) : null}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <p className='whitespace-pre-wrap'>
                  {data.responsibilities ??
                    t('recruiting.requisitions.responsibilitiesMissing')}
                </p>
                <dl className='grid gap-2 sm:grid-cols-2'>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('recruiting.requisitions.targetDate')}
                    </dt>
                    <dd>{data.targetDate}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('recruiting.requisitions.reason')}
                    </dt>
                    <dd>{t(`recruiting.labels.reason.${data.reason}`)}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('recruiting.requisitions.hiringManager')}
                    </dt>
                    <dd>{data.hiringManagerName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className='text-muted-foreground'>
                      {t('recruiting.requisitions.recruiter')}
                    </dt>
                    <dd>{data.recruiterName ?? '—'}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('recruiting.requisitions.checklist')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className='space-y-2 text-sm'>
                  {data.requirementsChecklist.map((item) => (
                    <li
                      key={`${item.type}:${item.text}`}
                      className='flex flex-wrap items-center gap-2'
                    >
                      <Badge variant='secondary'>
                        {t(`recruiting.labels.requirementType.${item.type}`)}
                      </Badge>
                      <span>{item.text}</span>
                      <Badge variant={item.mustHave ? 'default' : 'outline'}>
                        {item.mustHave
                          ? t('recruiting.common.mustHave')
                          : t('recruiting.common.optional')}
                      </Badge>
                    </li>
                  ))}
                </ul>
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
                    <div className='space-y-3'>
                      {data.can.pickRecruiter ? (
                        <Field>
                          <FieldLabel>
                            {t('recruiting.requisitions.pickRecruiter')}
                          </FieldLabel>
                          <PeoplePicker
                            value={recruiter}
                            onChange={setRecruiter}
                            recruitersOnly
                            single
                          />
                        </Field>
                      ) : null}
                      <Field>
                        <FieldLabel htmlFor='rq-comment'>
                          {t('recruiting.requisitions.rejectComment')}
                        </FieldLabel>
                        <Textarea
                          id='rq-comment'
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
                                      recruiterUserId: recruiter[0] ?? null,
                                    },
                                  },
                                  t('recruiting.requisitions.decided'),
                                )
                              )
                                refresh();
                            })();
                          }}
                        >
                          {t('recruiting.requisitions.approve')}
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
                          {t('recruiting.requisitions.reject')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
            {data.postings?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.requisitions.postings')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className='space-y-1 text-sm'>
                    {data.postings.map((p) => (
                      <li key={p.id} className='flex items-center gap-2'>
                        <Link
                          className='underline underline-offset-4'
                          to={`/talent/postings/${p.id}`}
                        >
                          {p.title}
                        </Link>
                        <StatusBadge kind='posting' value={p.status} />
                        <StatusBadge kind='review' value={p.reviewStatus} />
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            {data.poolSuggestion?.candidates?.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.requisitions.pool')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.requisitions.poolHint')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className='space-y-1 text-sm'>
                    {data.poolSuggestion.candidates.map((c) => (
                      <li key={c.candidateId}>
                        <span className='font-medium'>{c.name}</span>
                        <span className='ml-2 text-muted-foreground'>
                          {c.reason}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ) : null}
            {data.can?.assignRecruiter ? (
              <Card>
                <CardHeader>
                  <CardTitle>
                    {t('recruiting.requisitions.pickRecruiter')}
                  </CardTitle>
                </CardHeader>
                <CardContent className='space-y-2'>
                  <PeoplePicker
                    value={recruiter}
                    onChange={setRecruiter}
                    recruitersOnly
                    single
                  />
                  <Button
                    size='sm'
                    disabled={!recruiter.length || busy !== null}
                    onClick={() => {
                      void (async () => {
                        if (
                          await run(
                            'assign',
                            {
                              path: `${path}/recruiter`,
                              json: { recruiterUserId: recruiter[0] },
                            },
                            t('recruiting.common.saved'),
                          )
                        )
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.common.save')}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

/**
 * 由 Offer 生成的入职单 (hr.admin, child page): the pre-filled content from the
 * accepted offer and what the HR assistant read from the candidate's
 * documents (written to the record only after HR confirms it once the
 * onboarding takes effect). HR enters the employee number and submits; core
 * HR's onboarding approvals apply.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { useAction } from '@/components/talent/recruiting-lib';
import type { OnboardDraft } from '@/components/talent/recruiting-types';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

export default function OfferOnboardPage(): ReactElement {
  const { t } = useTranslation();
  const { offerId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/recruiting/offers/${encodeURIComponent(offerId)}/onboard`;
  const draft = useRemote<OnboardDraft>(path);
  const { busy, run } = useAction();
  const [employeeNo, setEmployeeNo] = useState('');
  // 参加工作日期: prefilled from the resume estimate until HR edits it.
  const [careerStart, setCareerStart] = useState<string>();
  const [result, setResult] = useState<{ actionId: string } | null>(null);
  const data = draft.data;
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={t('recruiting.offers.onboardTitle')}
          description={t('recruiting.offers.onboardDescription')}
        />
        {draft.error ? (
          <LoadError error={draft.error} onRetry={draft.reload} />
        ) : !data ? (
          <BlockSkeleton rows={5} />
        ) : (
          <div className='space-y-4'>
            <Card>
              <CardContent className='grid gap-2 pt-6 text-sm sm:grid-cols-2'>
                <p>
                  {t('recruiting.public.name')}：{data.draft.name}
                </p>
                <p>
                  {t('recruiting.public.phone')}：{data.draft.mobile ?? '—'}
                </p>
                <p>
                  {t('recruiting.public.email')}：{data.draft.email ?? '—'}
                </p>
                <p>
                  {t('recruiting.common.department')}：{data.departmentTitle}
                </p>
                <p>
                  {t('recruiting.common.position')}：{data.positionTitle}
                </p>
                <p>
                  {t('recruiting.offers.startDate')}：{data.draft.effectiveDate}
                </p>
                <p>
                  {t('recruiting.offers.probation')}：
                  {data.draft.probationMonths}
                </p>
              </CardContent>
            </Card>
            {data.suggestions.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.offers.recognized')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.offers.recognizedHint')}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-2 text-sm'>
                  {data.suggestions.map((s) => (
                    <div key={s.id} className='rounded-lg border p-3'>
                      <p className='font-medium'>
                        {t(`recruiting.labels.upload.${s.kind}`)}
                      </p>
                      {s.status === 'failed' ? (
                        <p className='text-muted-foreground'>{s.reason}</p>
                      ) : (
                        <ul>
                          {Object.entries(s.fields).map(([name, f]) => (
                            <li key={name}>
                              {name}：{String(f.value)}{' '}
                              <span className='text-xs text-muted-foreground'>
                                {t('recruiting.offers.confidence', {
                                  value: Math.round(Number(f.confidence) * 100),
                                })}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {data.onboardActionId || result ? (
              <Button
                nativeButton={false}
                render={
                  <Link
                    to={`/talent/actions/${result?.actionId ?? data.onboardActionId}`}
                  />
                }
              >
                {t('recruiting.offers.openAction')}
              </Button>
            ) : (
              <form
                className='flex flex-wrap items-end gap-2'
                onSubmit={(event) => {
                  void (async () => {
                    event.preventDefault();
                    const done = await run<{ actionId: string }>(
                      'onboard',
                      {
                        path,
                        json: {
                          employeeNo,
                          careerStartDate:
                            (careerStart ?? data.draft.careerStartDate) || null,
                        },
                      },
                      t('recruiting.offers.onboarded'),
                    );
                    if (done) {
                      setResult(done);
                      outlet?.reload?.();
                    }
                  })();
                }}
              >
                <Field>
                  <FieldLabel htmlFor='ob-no'>
                    {t('recruiting.offers.employeeNo')}
                  </FieldLabel>
                  <Input
                    id='ob-no'
                    required
                    value={employeeNo}
                    onChange={(e) => setEmployeeNo(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='ob-career'>
                    {t('recruiting.offers.careerStartDate')}
                  </FieldLabel>
                  <Input
                    id='ob-career'
                    type='date'
                    max={data.draft.effectiveDate}
                    value={careerStart ?? data.draft.careerStartDate ?? ''}
                    onChange={(e) => setCareerStart(e.target.value)}
                  />
                </Field>
                <Button type='submit' disabled={busy !== null}>
                  {t('recruiting.offers.submitOnboard')}
                </Button>
              </form>
            )}
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

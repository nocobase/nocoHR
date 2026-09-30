/**
 * 面试详情 (child page): the question plan (editable by the recruiter and the
 * interviewers), the candidate's parsed resume without contact data, my
 * scorecard — other interviewers' appear only once mine is submitted — and
 * the recruiting assistant's summary (divergences and what to verify; no
 * hiring advice).
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import {
  formatDateTime,
  useAction,
  type Requirement,
} from '@/components/talent/recruiting-lib';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type {
  InterviewDetailData,
  QuestionPlanItem,
  Scorecard,
} from '@/components/talent/recruiting-types';
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export default function InterviewDetail(): ReactElement {
  const { t } = useTranslation();
  const { interviewId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/recruiting/interviews/${encodeURIComponent(interviewId)}`;
  const detail = useRemote<InterviewDetailData>(path);
  const { busy, run } = useAction();
  const data = detail.data;
  const refresh = () => {
    detail.reload();
    outlet?.reload?.();
  };
  const requirements = data?.posting.requirements ?? [];
  const text = (key: string) =>
    requirements.find((r) => r.key === key)?.text ?? key;
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={
            data
              ? `${data.candidate.name} · ${data.posting.title}`
              : t('recruiting.interviews.title')
          }
          description={
            data ? (
              <span className='flex flex-wrap items-center gap-2'>
                <StatusBadge kind='interview' value={data.status} />
                <span>
                  #{data.round} · {t(`recruiting.labels.mode.${data.mode}`)} ·{' '}
                  {formatDateTime(data.scheduledAt)}{' '}
                  {data.locationOrLink ? `· ${data.locationOrLink}` : ''}
                </span>
              </span>
            ) : undefined
          }
          actions={
            data?.can.manage && data.status === 'scheduled' ? (
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  disabled={busy !== null}
                  onClick={() => {
                    void (async () => {
                      if (await run('noShow', { path: `${path}/no-show` }))
                        refresh();
                    })();
                  }}
                >
                  {t('recruiting.interviews.noShow')}
                </Button>
                <Button
                  variant='outline'
                  disabled={busy !== null}
                  onClick={() => {
                    void (async () => {
                      if (await run('cancel', { path: `${path}/cancel` }))
                        refresh();
                    })();
                  }}
                >
                  {t('recruiting.interviews.cancel')}
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
            <p className='text-sm text-muted-foreground'>
              {t('recruiting.interviews.interviewers')}:{' '}
              {data.interviewers
                .map(
                  (i) =>
                    `${i.name}${i.submitted ? ` (${t('recruiting.interviews.submitted')})` : ''}`,
                )
                .join('、')}
            </p>
            <PlanCard
              key={JSON.stringify(data.questionPlan)}
              plan={data.questionPlan}
              requirements={requirements}
              editable={Boolean(data.can.editPlan)}
              onSave={(plan) => {
                void (async () => {
                  if (
                    await run(
                      'plan',
                      { path: `${path}/plan`, method: 'PUT', json: plan },
                      t('recruiting.common.saved'),
                    )
                  )
                    refresh();
                })();
              }}
            />
            <Card>
              <CardHeader>
                <CardTitle>{t('recruiting.candidates.profile')}</CardTitle>
              </CardHeader>
              <CardContent className='space-y-1 text-sm'>
                {(data.candidate.parsedProfile?.experiences ?? []).map((e) => (
                  <p key={e.summary}>{e.summary}</p>
                ))}
                <p className='text-muted-foreground'>
                  {(data.candidate.parsedProfile?.skills ?? []).join('、')}
                </p>
              </CardContent>
            </Card>
            {data.can.score ? (
              <ScoreCard
                requirements={requirements}
                mine={data.mine}
                busy={busy !== null}
                onSubmit={(card) => {
                  void (async () => {
                    if (
                      await run(
                        'score',
                        { path: `${path}/scorecard`, json: card },
                        t('recruiting.interviews.submitted'),
                      )
                    )
                      refresh();
                  })();
                }}
              />
            ) : null}
            {data.scorecards.length ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.interviews.scorecards')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.interviews.scorecardHint')}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3 text-sm'>
                  {data.scorecards.map((card) => (
                    <div key={card.userId} className='rounded-lg border p-3'>
                      <p className='font-medium'>
                        {
                          data.interviewers.find(
                            (i) => i.userId === card.userId,
                          )?.name
                        }{' '}
                        ·{' '}
                        {t(
                          `recruiting.labels.recommendation.${card.recommendation}`,
                        )}
                      </p>
                      <ul className='mt-1 space-y-1'>
                        {card.requirementScores.map((s) => (
                          <li key={s.requirementKey}>
                            {text(s.requirementKey)}：{s.score}
                            {s.evidence ? ` · ${s.evidence}` : ''}
                          </li>
                        ))}
                      </ul>
                      {card.notes ? (
                        <p className='mt-1 text-muted-foreground'>
                          {card.notes}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {data.aiSummary ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.interviews.summary')}</CardTitle>
                </CardHeader>
                <CardContent className='space-y-2 text-sm'>
                  {data.aiSummary.text ? (
                    <p className='whitespace-pre-wrap'>{data.aiSummary.text}</p>
                  ) : null}
                  {data.aiSummary.byRequirement?.map((r) => (
                    <p key={r.requirementKey}>
                      {r.text}：
                      {r.scores.map((s) => `${s.name} ${s.score}`).join('，')}
                    </p>
                  ))}
                  {data.aiSummary.divergences?.length ? (
                    <div>
                      <p className='font-medium'>
                        {t('recruiting.interviews.divergences')}
                      </p>
                      <ul className='list-disc pl-5'>
                        {data.aiSummary.divergences.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {data.aiSummary.toVerify?.length ? (
                    <div>
                      <p className='font-medium'>
                        {t('recruiting.interviews.toVerify')}
                      </p>
                      <ul className='list-disc pl-5'>
                        {data.aiSummary.toVerify.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

/** Remounted (keyed by the saved plan) when a new plan arrives, so the draft starts from it. */
function PlanCard({
  plan,
  requirements,
  editable,
  onSave,
}: {
  plan: QuestionPlanItem[] | null;
  requirements: readonly Requirement[];
  editable: boolean;
  onSave: (plan: QuestionPlanItem[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() =>
    (plan ?? []).map((q, index) => ({ ...q, uid: `q-${index}` })),
  );
  const set = (uid: string, patch: Partial<QuestionPlanItem>) =>
    setDraft((list) =>
      list.map((q) => (q.uid === uid ? { ...q, ...patch } : q)),
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.interviews.questions')}</CardTitle>
        {!plan ? (
          <CardDescription>
            {t('recruiting.interviews.questionsPending')}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-3'>
        {draft.map((q) => (
          <div key={q.uid} className='space-y-1 rounded-lg border p-3 text-sm'>
            <p className='text-xs text-muted-foreground'>
              {requirements.find((r) => r.key === q.requirementKey)?.text ??
                q.requirementKey}
            </p>
            {editable ? (
              <>
                <Textarea
                  aria-label={t('recruiting.interviews.questions')}
                  value={q.question}
                  onChange={(e) => set(q.uid, { question: e.target.value })}
                />
                <Input
                  aria-label={t('recruiting.interviews.lookFor')}
                  value={q.lookFor}
                  onChange={(e) => set(q.uid, { lookFor: e.target.value })}
                />
              </>
            ) : (
              <>
                <p>{q.question}</p>
                <p className='text-muted-foreground'>
                  {t('recruiting.interviews.lookFor')}：{q.lookFor}
                </p>
              </>
            )}
            {q.followUps?.length ? (
              <p className='text-muted-foreground'>
                {t('recruiting.interviews.followUps')}：{q.followUps.join('；')}
              </p>
            ) : null}
          </div>
        ))}
        {editable && draft.length ? (
          <Button
            size='sm'
            onClick={() =>
              onSave(
                draft.map((q) => ({
                  requirementKey: q.requirementKey,
                  question: q.question,
                  lookFor: q.lookFor,
                  followUps: q.followUps ?? [],
                })),
              )
            }
          >
            {t('recruiting.common.save')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ScoreCard({
  requirements,
  mine,
  busy,
  onSubmit,
}: {
  requirements: readonly Requirement[];
  mine: Scorecard | null;
  busy: boolean;
  onSubmit: (card: Omit<Scorecard, 'userId'>) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [scores, setScores] = useState<
    Record<string, { score: number; evidence: string }>
  >(() =>
    Object.fromEntries(
      requirements.map((r) => {
        const existing = mine?.requirementScores.find(
          (s) => s.requirementKey === r.key,
        );
        return [
          r.key,
          { score: existing?.score ?? 3, evidence: existing?.evidence ?? '' },
        ];
      }),
    ),
  );
  const [recommendation, setRecommendation] = useState<string>(
    mine?.recommendation ?? 'yes',
  );
  const [notes, setNotes] = useState<string>(mine?.notes ?? '');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.interviews.scorecard')}</CardTitle>
        <CardDescription>
          {t('recruiting.interviews.scorecardHint')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {requirements.map((r) => (
          <div
            key={r.key}
            className='grid gap-2 sm:grid-cols-[2fr_6rem_2fr] sm:items-center'
          >
            <span className='text-sm'>{r.text}</span>
            <NativeSelect
              aria-label={t('recruiting.interviews.score')}
              value={String(scores[r.key]?.score ?? 3)}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  [r.key]: { ...s[r.key], score: Number(e.target.value) },
                }))
              }
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <NativeSelectOption key={n} value={String(n)}>
                  {n}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label={t('recruiting.interviews.evidence')}
              placeholder={t('recruiting.interviews.evidence')}
              value={scores[r.key]?.evidence ?? ''}
              onChange={(e) =>
                setScores((s) => ({
                  ...s,
                  [r.key]: { ...s[r.key], evidence: e.target.value },
                }))
              }
            />
          </div>
        ))}
        <Field>
          <FieldLabel htmlFor='sc-rec'>
            {t('recruiting.interviews.recommendation')}
          </FieldLabel>
          <NativeSelect
            id='sc-rec'
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
          >
            {(['strongYes', 'yes', 'no', 'strongNo'] as const).map((r) => (
              <NativeSelectOption key={r} value={r}>
                {t(`recruiting.labels.recommendation.${r}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='sc-notes'>
            {t('recruiting.interviews.notes')}
          </FieldLabel>
          <Textarea
            id='sc-notes'
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
        <Button
          disabled={busy}
          onClick={() =>
            onSubmit({
              requirementScores: requirements.map((r) => ({
                requirementKey: r.key,
                score: scores[r.key]?.score ?? 3,
                evidence: scores[r.key]?.evidence || null,
              })),
              recommendation,
              notes: notes || null,
            })
          }
        >
          {t('recruiting.interviews.submitScore')}
        </Button>
      </CardContent>
    </Card>
  );
}

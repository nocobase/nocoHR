/**
 * V4-12 评价表: the form of a self, peer, manager or skip-level review.
 *
 * - The assistant's draft appears as the “AI 初稿” card; the form stays as the
 *   reviewer left it (empty for a new task) until they click 采用到评价表,
 *   which copies the comment and the item notes in, to be edited item by item.
 * - For a manager review the reference score and its band are recomputed on
 *   the server as the items change; reasons are asked for where the server
 *   requires them (a quality score more than 1 from the reference, a rating two
 *   grades from the band).
 * - The active editing time is reported while the reviewer types or clicks
 *   (at most once every 30 seconds); a submitted review may be revised and
 *   resubmitted until the deadline; the assistant's hints show after a
 *   submission.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

import { useAction } from './performance-hooks.js';
import {
  RatingBadge,
  type ReferenceScore,
  type ReviewContext,
  type ReviewItems,
} from './performance-shared.js';

const ACTIVITY_FLUSH_MS = 30_000;

function emptyItems(context: ReviewContext): Required<ReviewItems> {
  const stored = context.review.items ?? {};
  return {
    goals: context.goals.map((g) => {
      const item = stored.goals?.find((x) => x.goalId === g.id);
      return {
        goalId: g.id,
        score: item?.score ?? null,
        comment: item?.comment ?? '',
      };
    }),
    competencies: context.requirements.map((r) => {
      const item = stored.competencies?.find(
        (x) => x.competencyId === r.competencyId,
      );
      return {
        competencyId: r.competencyId,
        level: item?.level ?? null,
        comment: item?.comment ?? '',
      };
    }),
    qualitySafety: stored.qualitySafety ?? {
      score: null,
      comment: '',
      reason: '',
    },
  };
}

export function PerformanceReviewForm({
  context,
  onSaved,
}: {
  context: ReviewContext;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const action = useAction();
  const { review } = context;
  const senior = review.role === 'manager' || review.role === 'skipLevel';
  const manager = review.role === 'manager';
  const [items, setItems] = useState<Required<ReviewItems>>(() =>
    emptyItems(context),
  );
  const [comment, setComment] = useState(review.comment ?? '');
  const [rating, setRating] = useState(review.overallRating ?? '');
  const [reason, setReason] = useState(review.overallReason ?? '');
  const [reference, setReference] = useState<ReferenceScore | null>(
    context.reference,
  );
  const [adopted, setAdopted] = useState(false);
  const editable = review.editable;

  // 有效编辑时长: seconds with input or clicks in the form, flushed at most every 30 seconds.
  const activeRef = useRef(0);
  const lastTickRef = useRef(0);
  const touch = () => {
    const now = Date.now();
    if (now - lastTickRef.current >= 1000) {
      activeRef.current += Math.min(
        10,
        Math.round((now - (lastTickRef.current || now)) / 1000) || 1,
      );
      lastTickRef.current = now;
    }
  };
  useEffect(() => {
    if (!editable) return undefined;
    const timer = setInterval(() => {
      const seconds = Math.min(120, activeRef.current);
      if (seconds < 1) return;
      activeRef.current = 0;
      void api
        .request({
          method: 'POST',
          path: `talent/performance/reviews/${encodeURIComponent(review.id)}/activity`,
          json: { seconds },
        })
        .catch(() => undefined);
    }, ACTIVITY_FLUSH_MS);
    return () => clearInterval(timer);
  }, [api, editable, review.id]);

  // The reference score of the items as they are (manager review).
  useEffect(() => {
    if (!manager) return undefined;
    const timer = setTimeout(() => {
      void api
        .request<{ data: ReferenceScore }>({
          method: 'POST',
          path: `talent/performance/reviews/${encodeURIComponent(review.id)}/preview`,
          json: { items },
        })
        .then((response) => setReference(response.data))
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [api, items, manager, review.id]);

  function adopt(): void {
    const draft = review.aiDraft;
    if (!draft) return;
    setComment(draft.comment);
    setItems((current) => ({
      goals: current.goals.map((g) => ({
        ...g,
        comment:
          draft.itemSuggestions.goals.find((x) => x.goalId === g.goalId)
            ?.comment ?? g.comment,
      })),
      competencies: current.competencies.map((c) => ({
        ...c,
        comment:
          draft.itemSuggestions.competencies.find(
            (x) => x.competencyId === c.competencyId,
          )?.comment ?? c.comment,
      })),
      qualitySafety: {
        ...current.qualitySafety,
        score:
          current.qualitySafety?.score ??
          draft.itemSuggestions.qualitySafety?.score ??
          null,
        comment:
          draft.itemSuggestions.qualitySafety?.comment ??
          current.qualitySafety?.comment ??
          '',
      },
    }));
    setAdopted(true);
    touch();
  }

  const payload = () => ({
    items: senior
      ? items
      : { goals: items.goals, competencies: [], qualitySafety: null },
    overallRating: rating || null,
    overallReason: reason || null,
    comment: comment || null,
  });

  async function save(submit: boolean): Promise<void> {
    const done = await action.run(
      {
        method: submit ? 'POST' : 'PUT',
        path: `talent/performance/reviews/${encodeURIComponent(review.id)}${submit ? '/submit' : ''}`,
        json: payload(),
      },
      t(submit ? 'performance.review.submitted' : 'performance.review.saved'),
    );
    if (done) onSaved();
  }

  const qualityReference =
    context.evidence?.snapshot?.qualitySafety.score ?? null;
  const qualityChanged =
    typeof items.qualitySafety?.score === 'number' &&
    qualityReference !== null &&
    Math.abs(items.qualitySafety.score - qualityReference) >
      (context.scheme.scoring?.overrideReasonDelta ?? 1);

  return (
    <div className='space-y-4' onInput={touch} onClick={touch}>
      {review.hints && review.hints.submission === review.submissionCount ? (
        <Alert>
          <SparklesIcon />
          <AlertTitle>{t('performance.review.hintsTitle')}</AlertTitle>
          <AlertDescription>
            <ul className='list-disc space-y-1 ps-4'>
              {review.hints.items.map((hint) => (
                <li key={hint.type}>{hint.text}</li>
              ))}
            </ul>
            <p className='mt-1 text-xs'>{t('performance.review.hintsHint')}</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {senior && review.aiDraft ? (
        <Card className='border-primary/40'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <SparklesIcon className='size-4 text-primary' />
              {t('performance.review.aiDraft')}
            </CardTitle>
            <CardDescription>
              {t('performance.review.aiDraftHint')}
            </CardDescription>
            {editable ? (
              <CardAction>
                <Button
                  size='sm'
                  variant={adopted ? 'outline' : 'default'}
                  onClick={adopt}
                >
                  {t(
                    adopted
                      ? 'performance.review.adoptedAgain'
                      : 'performance.review.adopt',
                  )}
                </Button>
              </CardAction>
            ) : null}
          </CardHeader>
          <CardContent className='space-y-2 text-sm'>
            <p className='leading-6 break-words whitespace-pre-wrap'>
              {review.aiDraft.comment}
            </p>
            {review.aiDraft.evidenceRefs.length ? (
              <div className='flex flex-wrap gap-1.5'>
                {review.aiDraft.evidenceRefs.slice(0, 12).map((ref) => (
                  <Badge key={`${ref.type}:${ref.id}`} variant='outline'>
                    {ref.label}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {manager && reference ? (
        <Card size='sm'>
          <CardContent className='flex flex-wrap items-center gap-x-4 gap-y-1 text-sm'>
            <span>
              {t('performance.review.reference')}{' '}
              <span className='font-semibold tabular-nums'>
                {reference.computedScore ?? '—'}
              </span>
            </span>
            <span className='flex items-center gap-1'>
              {t('performance.review.band')}{' '}
              <RatingBadge rating={reference.band} />
              {reference.bandRange ? (
                <span className='text-muted-foreground tabular-nums'>
                  ({reference.bandRange.from}–{reference.bandRange.to})
                </span>
              ) : null}
            </span>
          </CardContent>
        </Card>
      ) : null}

      {context.goals.length ? (
        <section className='space-y-3' aria-labelledby='review-goals'>
          <h3 id='review-goals' className='font-medium'>
            {t('performance.review.goals')}
          </h3>
          {context.goals.map((goal, index) => (
            <div key={goal.id} className='space-y-2 rounded-lg border p-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <p className='font-medium break-words'>{goal.title}</p>
                <span className='text-xs text-muted-foreground'>
                  {t('performance.goals.weightProgress', {
                    weight: goal.weight ?? '—',
                    progress: goal.progress,
                  })}
                </span>
              </div>
              <p className='text-sm text-muted-foreground break-words'>
                {goal.measure}
              </p>
              {review.role !== 'peer' ? (
                <div className='grid gap-2 sm:grid-cols-[8rem_1fr]'>
                  <Field>
                    <FieldLabel htmlFor={`goal-score-${goal.id}`}>
                      {t('performance.review.score')}
                    </FieldLabel>
                    <NativeSelect
                      id={`goal-score-${goal.id}`}
                      disabled={!editable}
                      value={items.goals[index]?.score ?? ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        setItems((current) => ({
                          ...current,
                          goals: current.goals.map((g, i) =>
                            i === index
                              ? { ...g, score: value ? Number(value) : null }
                              : g,
                          ),
                        }));
                      }}
                    >
                      <NativeSelectOption value=''>—</NativeSelectOption>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <NativeSelectOption key={n} value={n}>
                          {n}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`goal-comment-${goal.id}`}>
                      {t('performance.review.itemComment')}
                    </FieldLabel>
                    <Textarea
                      id={`goal-comment-${goal.id}`}
                      disabled={!editable}
                      rows={2}
                      value={items.goals[index]?.comment ?? ''}
                      onChange={(event) => {
                        const value = event.target.value;
                        setItems((current) => ({
                          ...current,
                          goals: current.goals.map((g, i) =>
                            i === index ? { ...g, comment: value } : g,
                          ),
                        }));
                      }}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {senior && context.requirements.length ? (
        <section className='space-y-3' aria-labelledby='review-competencies'>
          <h3 id='review-competencies' className='font-medium'>
            {t('performance.review.competencies')}
          </h3>
          {context.requirements.map((requirement, index) => (
            <div
              key={requirement.competencyId}
              className='grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem]'
            >
              <div className='min-w-0'>
                <p className='font-medium'>{requirement.title}</p>
                <p className='text-xs text-muted-foreground'>
                  {t('performance.review.levels', {
                    current: requirement.currentLevel ?? '—',
                    required: requirement.requiredLevel,
                  })}
                </p>
                <Textarea
                  aria-label={t('performance.review.itemComment')}
                  className='mt-2'
                  disabled={!editable}
                  rows={2}
                  value={items.competencies[index]?.comment ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setItems((current) => ({
                      ...current,
                      competencies: current.competencies.map((c, i) =>
                        i === index ? { ...c, comment: value } : c,
                      ),
                    }));
                  }}
                />
              </div>
              <Field>
                <FieldLabel
                  htmlFor={`competency-level-${requirement.competencyId}`}
                >
                  {t('performance.review.level')}
                </FieldLabel>
                <NativeSelect
                  id={`competency-level-${requirement.competencyId}`}
                  disabled={!editable}
                  value={items.competencies[index]?.level ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setItems((current) => ({
                      ...current,
                      competencies: current.competencies.map((c, i) =>
                        i === index
                          ? { ...c, level: value ? Number(value) : null }
                          : c,
                      ),
                    }));
                  }}
                >
                  <NativeSelectOption value=''>—</NativeSelectOption>
                  {Array.from(
                    { length: requirement.maxLevel },
                    (_, i) => i + 1,
                  ).map((n) => (
                    <NativeSelectOption key={n} value={n}>
                      L{n}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          ))}
        </section>
      ) : null}

      {manager &&
      context.scheme.sections.some((s) => s.key === 'qualitySafety') ? (
        <section
          className='space-y-2 rounded-lg border p-3'
          aria-labelledby='review-quality'
        >
          <h3 id='review-quality' className='font-medium'>
            {t('performance.review.qualitySafety')}
          </h3>
          <div className='grid gap-2 sm:grid-cols-[8rem_1fr]'>
            <Field>
              <FieldLabel htmlFor='quality-score'>
                {t('performance.review.score')}
              </FieldLabel>
              <Input
                id='quality-score'
                type='number'
                min={1}
                max={5}
                step={0.5}
                disabled={!editable}
                value={items.qualitySafety?.score ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setItems((current) => ({
                    ...current,
                    qualitySafety: {
                      ...current.qualitySafety,
                      score: value === '' ? null : Number(value),
                    },
                  }));
                }}
              />
              <FieldDescription>
                {t('performance.review.qualityReference', {
                  score: qualityReference ?? '—',
                })}
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor='quality-comment'>
                {t('performance.review.itemComment')}
              </FieldLabel>
              <Textarea
                id='quality-comment'
                rows={2}
                disabled={!editable}
                value={items.qualitySafety?.comment ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setItems((current) => ({
                    ...current,
                    qualitySafety: {
                      score: current.qualitySafety?.score ?? null,
                      ...current.qualitySafety,
                      comment: value,
                    },
                  }));
                }}
              />
            </Field>
          </div>
          {qualityChanged ? (
            <Field>
              <FieldLabel htmlFor='quality-reason'>
                {t('performance.review.qualityReason')}
              </FieldLabel>
              <Input
                id='quality-reason'
                disabled={!editable}
                value={items.qualitySafety?.reason ?? ''}
                onChange={(event) => {
                  const value = event.target.value;
                  setItems((current) => ({
                    ...current,
                    qualitySafety: {
                      score: current.qualitySafety?.score ?? null,
                      ...current.qualitySafety,
                      reason: value,
                    },
                  }));
                }}
              />
            </Field>
          ) : null}
        </section>
      ) : null}

      <section className='space-y-3'>
        {review.role !== 'self' ? (
          <Field>
            <FieldLabel htmlFor='overall-rating'>
              {t(
                senior
                  ? 'performance.review.overallRatingRequired'
                  : 'performance.review.overallRating',
              )}
            </FieldLabel>
            <NativeSelect
              id='overall-rating'
              disabled={!editable}
              value={rating}
              onChange={(event) => setRating(event.target.value)}
            >
              <NativeSelectOption value=''>—</NativeSelectOption>
              {context.scheme.ratingScale.map((option) => (
                <NativeSelectOption key={option.code} value={option.code}>
                  {option.code} · {option.description}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ) : null}
        {manager ? (
          <Field>
            <FieldLabel htmlFor='overall-reason'>
              {t('performance.review.overallReason')}
            </FieldLabel>
            <Input
              id='overall-reason'
              disabled={!editable}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <FieldDescription>
              {t('performance.review.overallReasonHint')}
            </FieldDescription>
          </Field>
        ) : null}
        <Field>
          <FieldLabel htmlFor='overall-comment'>
            {t('performance.review.comment')}
          </FieldLabel>
          <Textarea
            id='overall-comment'
            rows={5}
            disabled={!editable}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
          <FieldDescription>
            {t(
              review.role === 'peer'
                ? 'performance.review.peerCommentHint'
                : 'performance.review.commentHint',
            )}
          </FieldDescription>
        </Field>
      </section>

      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {editable ? (
        <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
          <Button
            variant='outline'
            disabled={action.busy}
            onClick={() => void save(false)}
          >
            {t('performance.review.saveDraft')}
          </Button>
          <Button disabled={action.busy} onClick={() => void save(true)}>
            {t(
              review.status === 'submitted'
                ? 'performance.review.resubmit'
                : 'performance.review.submit',
            )}
          </Button>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('performance.review.closed')}
        </p>
      )}
    </div>
  );
}

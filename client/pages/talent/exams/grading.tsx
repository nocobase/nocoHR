import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { RotateCcwIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { AttemptResult } from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { AnswerText } from '@/components/talent/answer-text';
import { str } from '@/components/talent/text';

/** 待批改: attempts with short answers; each answer shows the reference answer and grading notes. */
export function GradingPanel({
  examId,
  onGraded,
}: {
  examId: string;
  onGraded: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<AttemptResult[]>('talent/grading', { examId });
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={3} />;
  if (!list.data.length)
    return <EmptyState title={t('talent.exams.noGrading')} />;
  return (
    <div className='space-y-4'>
      {list.data.map((attempt) => (
        <GradeCard
          key={attempt.id}
          attempt={attempt}
          onGraded={() => {
            list.reload();
            onGraded();
          }}
        />
      ))}
    </div>
  );
}

function GradeCard({
  attempt,
  onGraded,
}: {
  attempt: AttemptResult;
  onGraded: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const shorts = attempt.items.filter((item) => item.type === 'short');
  const [scores, setScores] = useState<
    Record<string, { score: string; comment: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const objective = attempt.items
    .filter((i) => i.type !== 'short')
    .reduce((sum, i) => sum + (i.earned ?? 0), 0);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: `talent/grading/${encodeURIComponent(attempt.id)}`,
        method: 'POST',
        json: {
          items: shorts.map((item) => ({
            questionId: item.questionId,
            score: Number(scores[item.questionId]?.score ?? ''),
            comment: scores[item.questionId]?.comment || null,
          })),
        },
      });
      toast.add({ type: 'success', title: t('talent.exams.graded') });
      onGraded();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {attempt.employeeName} ·{' '}
          {t('talent.exams.attemptNo', { no: attempt.attemptNo })}
        </CardTitle>
        <CardDescription>
          {attempt.submittedAt
            ? new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(attempt.submittedAt))
            : ''}{' '}
          · {t('talent.exams.objectiveScore', { score: objective })}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {shorts.map((item) => (
          <div
            key={item.questionId}
            className='space-y-2 rounded-md border p-3'
          >
            <p className='font-medium'>{item.stem}</p>
            <div className='grid gap-3 md:grid-cols-2'>
              <div>
                <p className='text-xs text-muted-foreground'>
                  {t('talent.exams.candidateAnswer')}
                </p>
                <p className='text-sm whitespace-pre-wrap'>
                  {typeof item.response === 'string' && item.response
                    ? item.response
                    : t('talent.exams.noAnswer')}
                </p>
              </div>
              <div>
                <p className='text-xs text-muted-foreground'>
                  {t('talent.questions.fields.referenceAnswer')}
                </p>
                <p className='text-sm whitespace-pre-wrap'>
                  {str(item.answer ?? '')}
                </p>
                {item.gradingNotes ? (
                  <>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      {t('talent.questions.fields.gradingNotes')}
                    </p>
                    <p className='text-sm whitespace-pre-wrap'>
                      {item.gradingNotes}
                    </p>
                  </>
                ) : null}
              </div>
            </div>
            {item.aiSuggestion ? (
              // V3-10 考官: the suggestion and why; the instructor adopts it or changes it, then submits.
              <div className='space-y-1 rounded-md border border-dashed bg-muted/40 p-3 text-sm'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <span className='font-medium'>
                    {t('talent.examiner.suggested', {
                      score: item.aiSuggestion.score,
                      max: item.score,
                    })}
                  </span>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      setScores((s) => ({
                        ...s,
                        [item.questionId]: {
                          score: String(item.aiSuggestion!.score),
                          comment:
                            s[item.questionId]?.comment ??
                            item.aiSuggestion!.rationale,
                        },
                      }))
                    }
                  >
                    {t('talent.examiner.adopt')}
                  </Button>
                </div>
                {item.aiSuggestion.matchedPoints.length ? (
                  <p>
                    <span className='text-muted-foreground'>
                      {t('talent.examiner.matched')}
                    </span>{' '}
                    {item.aiSuggestion.matchedPoints.join('；')}
                  </p>
                ) : null}
                {item.aiSuggestion.missingPoints.length ? (
                  <p>
                    <span className='text-muted-foreground'>
                      {t('talent.examiner.missing')}
                    </span>{' '}
                    {item.aiSuggestion.missingPoints.join('；')}
                  </p>
                ) : null}
                <p className='whitespace-pre-wrap text-muted-foreground'>
                  {item.aiSuggestion.rationale}
                </p>
              </div>
            ) : null}
            <div className='grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]'>
              <Field>
                <FieldLabel htmlFor={`score-${attempt.id}-${item.questionId}`}>
                  {t('talent.exams.scoreOutOf', { max: item.score })}
                </FieldLabel>
                <Input
                  id={`score-${attempt.id}-${item.questionId}`}
                  type='number'
                  min={0}
                  max={item.score}
                  value={scores[item.questionId]?.score ?? ''}
                  onChange={(e) =>
                    setScores((s) => ({
                      ...s,
                      [item.questionId]: {
                        score: e.target.value,
                        comment: s[item.questionId]?.comment ?? '',
                      },
                    }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel
                  htmlFor={`comment-${attempt.id}-${item.questionId}`}
                >
                  {t('talent.exams.comment')}
                </FieldLabel>
                <Textarea
                  id={`comment-${attempt.id}-${item.questionId}`}
                  rows={1}
                  value={scores[item.questionId]?.comment ?? ''}
                  onChange={(e) =>
                    setScores((s) => ({
                      ...s,
                      [item.questionId]: {
                        score: s[item.questionId]?.score ?? '',
                        comment: e.target.value,
                      },
                    }))
                  }
                />
              </Field>
            </div>
          </div>
        ))}
        <details className='text-sm'>
          <summary className='cursor-pointer text-muted-foreground'>
            {t('talent.exams.objectiveDetails')}
          </summary>
          <ul className='mt-2 space-y-1'>
            {attempt.items
              .filter((i) => i.type !== 'short')
              .map((item) => (
                <li key={item.questionId} className='flex gap-2'>
                  <Badge variant={item.correct ? 'secondary' : 'destructive'}>
                    {item.correct
                      ? t('talent.exams.correct')
                      : t('talent.exams.wrong')}
                  </Badge>
                  <span className='line-clamp-1'>{item.stem}</span>
                  <span className='ml-auto text-muted-foreground'>
                    <AnswerText
                      type={item.type}
                      value={item.response}
                      options={item.options}
                    />
                  </span>
                </li>
              ))}
          </ul>
        </details>
        <div className='flex justify-end'>
          <Button
            disabled={
              busy ||
              shorts.some(
                (item) =>
                  scores[item.questionId]?.score === undefined ||
                  scores[item.questionId]?.score === '',
              )
            }
            onClick={() => void submit()}
          >
            {t('talent.exams.submitGrade')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 考生: candidates with counted attempts; failed candidates can have their attempts reset. */
export function CandidatesPanel({
  examId,
  canReset,
}: {
  examId: string;
  canReset: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const list = useRemote<
    {
      employeeId: string;
      name: string;
      attempts: number;
      bestScore: number | null;
      status: string;
      latestAttemptId: string;
    }[]
  >(`talent/exams/${encodeURIComponent(examId)}/candidates`);

  async function reset(employeeId: string): Promise<void> {
    try {
      await api.request({
        path: `talent/exams/${encodeURIComponent(examId)}/reset-attempts`,
        method: 'POST',
        json: { employeeId },
      });
      toast.add({ type: 'success', title: t('talent.exams.resetDone') });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={3} />;
  if (!list.data.length)
    return <EmptyState title={t('talent.exams.noCandidates')} />;
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talent.assignments.fields.employee')}</TableHead>
            <TableHead className='text-right'>
              {t('talent.exams.attemptsUsed')}
            </TableHead>
            <TableHead className='text-right'>
              {t('talent.exams.bestScore')}
            </TableHead>
            <TableHead>{t('talent.fields.status')}</TableHead>
            <TableHead className='text-right'>
              {t('talent.common.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell className='font-medium'>{row.name}</TableCell>
              <TableCell className='text-right tabular-nums'>
                {row.attempts}
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {row.bestScore ?? '—'}
              </TableCell>
              <TableCell>{t(`talent.attemptStatus.${row.status}`)}</TableCell>
              <TableCell className='text-right'>
                {canReset && row.status === 'failed' ? (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => void reset(row.employeeId)}
                  >
                    <RotateCcwIcon data-icon='inline-start' />
                    {t('talent.exams.resetAttempts')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

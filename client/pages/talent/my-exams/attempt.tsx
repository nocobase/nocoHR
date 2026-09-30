import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BookOpenIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  FlagIcon,
  SendIcon,
  XCircleIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { AnswerText } from '@/components/talent/answer-text';
import { errorCode, errorMessage } from '@/components/talent/errors';
import type {
  Attempt,
  AttemptResult,
  PaperItem,
} from '@/components/talent/exam-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { deviceHeaders, rememberDevice } from '@/components/talent/exam-device';
import { useRemote } from '@/components/talent/use-remote';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import type { MyExamsOutletContext } from './types.js';

const AUTOSAVE_MS = 30_000;

/** Route `/talent/my-exams/attempts/:attemptId`: answer an open attempt, or read its result. */
export default function AttemptPage(): ReactElement {
  const { attemptId = '' } = useParams();
  const attempt = useAttempt(attemptId);
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {attempt.error ? (
          <LoadError error={attempt.error} onRetry={attempt.reload} />
        ) : !attempt.data ? (
          <BlockSkeleton rows={6} />
        ) : attempt.data.status === 'inProgress' ? (
          <Answering
            key={attempt.data.id}
            attempt={attempt.data}
            onFinished={attempt.reload}
          />
        ) : (
          <Result attemptId={attempt.data.id} />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

/** Loads the attempt with this browser's device token, and keeps a token the server issues (V3-10 单设备作答). */
function useAttempt(attemptId: string): {
  data: Attempt | undefined;
  error: unknown;
  reload: () => void;
} {
  const api = useApiClient();
  const [count, setCount] = useState(0);
  const [state, setState] = useState<{
    key: string;
    data?: Attempt;
    error?: unknown;
  }>();
  const key = `${attemptId}|${count}`;
  useEffect(() => {
    const controller = new AbortController();
    api
      .request<{ data: Attempt }>({
        path: `talent/attempts/${encodeURIComponent(attemptId)}`,
        headers: deviceHeaders(attemptId),
        signal: controller.signal,
      })
      .then((result) => {
        rememberDevice(result.data);
        setState({ key, data: result.data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ key, error });
      });
    return () => controller.abort();
  }, [api, attemptId, key]);
  const reload = useCallback(() => setCount((n) => n + 1), []);
  const current = state?.key === key ? state : undefined;
  return {
    data: current?.data ?? (current ? undefined : state?.data),
    error: current?.error,
    reload,
  };
}

function useCountdown(deadlineAt: string, serverNow: string): number {
  // The server's clock decides the deadline; correct for this device's clock offset.
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const compute = useCallback(
    () => Math.max(0, new Date(deadlineAt).getTime() - (Date.now() + offset)),
    [deadlineAt, offset],
  );
  const [left, setLeft] = useState(compute);
  useEffect(() => {
    const timer = window.setInterval(() => setLeft(compute()), 1000);
    return () => window.clearInterval(timer);
  }, [compute]);
  return left;
}

function isAnswered(item: PaperItem, value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value))
    return item.type === 'blank'
      ? value.some((v) => String(v ?? '').trim())
      : value.length > 0;
  return true;
}

function Answering({
  attempt,
  onFinished,
}: {
  attempt: Attempt;
  onFinished: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const outlet = useOutletContext<MyExamsOutletContext | undefined>();
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    attempt.answers,
  );
  const [index, setIndex] = useState(0);
  const [flags, setFlags] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [deviceChanged, setDeviceChanged] = useState(false);
  const dirtyRef = useRef(false);
  const latestRef = useRef(answers);
  useEffect(() => {
    latestRef.current = answers;
  }, [answers]);
  const left = useCountdown(attempt.deadlineAt, attempt.serverNow);
  const item = attempt.items[index];
  const unanswered = attempt.items.filter(
    (i) => !isAnswered(i, answers[i.questionId]),
  ).length;

  const save = useCallback(async () => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    try {
      const result = await api.request<{ data: { savedAt: string } }>({
        path: `talent/attempts/${encodeURIComponent(attempt.id)}/answers`,
        method: 'PUT',
        json: { answers: latestRef.current },
        headers: deviceHeaders(attempt.id),
      });
      setSavedAt(result.data.savedAt);
    } catch (cause) {
      dirtyRef.current = true;
      if (errorCode(cause) === 'ATTEMPT_DEVICE_CHANGED') {
        setDeviceChanged(true);
        return;
      }
      if (
        errorCode(cause) === 'ATTEMPT_EXPIRED' ||
        errorCode(cause) === 'ATTEMPT_CLOSED'
      )
        onFinished();
    }
  }, [api, attempt.id, onFinished]);

  // Saved every 30 seconds, and whenever the candidate moves to another question.
  useEffect(() => {
    const timer = window.setInterval(() => void save(), AUTOSAVE_MS);
    return () => window.clearInterval(timer);
  }, [save]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.request({
        path: `talent/attempts/${encodeURIComponent(attempt.id)}/submit`,
        method: 'POST',
        json: { answers: latestRef.current },
        headers: deviceHeaders(attempt.id),
      });
      toast.add({ type: 'success', title: t('talent.myExams.submitted') });
    } catch (cause) {
      if (errorCode(cause) === 'ATTEMPT_DEVICE_CHANGED') {
        setDeviceChanged(true);
        setSubmitting(false);
        return;
      }
      toast.add({
        type: errorCode(cause) === 'ATTEMPT_EXPIRED' ? 'warning' : 'error',
        title: errorMessage(cause, t),
      });
    } finally {
      setSubmitting(false);
      outlet?.reload();
      onFinished();
    }
  }, [api, attempt.id, onFinished, outlet, t]);

  // Time is up: submit what is on screen; the server scores what arrived in time.
  const expiredHandledRef = useRef(false);
  useEffect(() => {
    if (left === 0 && !expiredHandledRef.current) {
      expiredHandledRef.current = true;
      void submit();
    }
  }, [left, submit]);

  // V3-10 防作弊: leaving the page is counted by the server; past the limit it may submit the attempt.
  const report = useCallback(
    async (type: 'blur' | 'pasteAttempt') => {
      try {
        const result = await api.request<{
          data: { blurCount: number; maxBlurCount: number; submitted: boolean };
        }>({
          path: `talent/attempts/${encodeURIComponent(attempt.id)}/integrity`,
          method: 'POST',
          json: { type },
          headers: deviceHeaders(attempt.id),
        });
        if (type === 'blur')
          toast.add({
            type: 'warning',
            title: t('talent.examIntegrity.blurRecorded', {
              count: result.data.blurCount,
            }),
          });
        if (result.data.submitted) {
          outlet?.reload();
          onFinished();
        }
      } catch (cause) {
        if (errorCode(cause) === 'ATTEMPT_DEVICE_CHANGED')
          setDeviceChanged(true);
      }
    },
    [api, attempt.id, onFinished, outlet, t],
  );
  useEffect(() => {
    let away = false;
    const leave = () => {
      if (away) return;
      away = true;
      void report('blur');
    };
    const back = () => {
      if (!document.hidden) away = false;
    };
    const onVisibility = () => (document.hidden ? leave() : back());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', back);
    };
  }, [report]);
  const noCopy = attempt.antiCheat?.disableCopy ?? true;
  const block = (event: { preventDefault: () => void }) => {
    if (noCopy) event.preventDefault();
  };
  const blockPaste = (event: { preventDefault: () => void }) => {
    if (!noCopy) return;
    event.preventDefault();
    toast.add({ type: 'warning', title: t('talent.examIntegrity.noPaste') });
    void report('pasteAttempt');
  };

  const setAnswer = (value: unknown) => {
    setAnswers((a) => ({ ...a, [item.questionId]: value }));
    dirtyRef.current = true;
  };
  const go = (next: number) => {
    void save();
    setIndex(next);
  };
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  const response = answers[item.questionId];

  return (
    <>
      <PageHeader
        title={attempt.examTitle}
        description={t('talent.exams.attemptNo', { no: attempt.attemptNo })}
        actions={
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 font-mono text-lg tabular-nums',
              left < 60_000 && 'border-destructive text-destructive',
            )}
            role='timer'
            aria-live='off'
          >
            <ClockIcon className='size-4' />
            {String(minutes).padStart(2, '0')}:
            {String(seconds).padStart(2, '0')}
          </span>
        }
      />
      {deviceChanged ? (
        <Alert variant='destructive'>
          <AlertTitle>
            {t('talent.examIntegrity.deviceChangedTitle')}
          </AlertTitle>
          <AlertDescription>
            {t('talent.examIntegrity.deviceChanged')}
          </AlertDescription>
        </Alert>
      ) : null}
      <div
        className={cn(
          'grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]',
          noCopy && 'select-none',
        )}
        onCopy={block}
        onCut={block}
        onContextMenu={block}
        onPasteCapture={blockPaste}
      >
        <Card>
          <CardHeader>
            <CardDescription>
              {t('talent.myExams.questionOf', {
                index: index + 1,
                total: attempt.items.length,
              })}{' '}
              · {t(`talent.questionType.${item.type}`)} ·{' '}
              {t('talent.exams.points', { score: item.score })}
            </CardDescription>
            <CardTitle className='text-base leading-relaxed font-medium whitespace-pre-wrap'>
              {item.stem}
            </CardTitle>
          </CardHeader>
          <CardContent className='space-y-4'>
            {item.type === 'single' ? (
              <RadioGroup
                value={typeof response === 'string' ? response : ''}
                onValueChange={(v) => setAnswer(v)}
                className='space-y-2'
              >
                {item.options.map((option) => (
                  <label
                    key={option.key}
                    className='flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50'
                  >
                    <RadioGroupItem value={option.key} className='mt-0.5' />
                    <span>
                      <span className='font-medium'>{option.key}.</span>{' '}
                      {option.text}
                    </span>
                  </label>
                ))}
              </RadioGroup>
            ) : item.type === 'multiple' ? (
              <div className='space-y-2'>
                {item.options.map((option) => {
                  const current = Array.isArray(response)
                    ? (response as string[])
                    : [];
                  return (
                    <label
                      key={option.key}
                      className='flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/50'
                    >
                      <Checkbox
                        className='mt-0.5'
                        checked={current.includes(option.key)}
                        onCheckedChange={(checked) =>
                          setAnswer(
                            checked === true
                              ? [...current, option.key]
                              : current.filter((k) => k !== option.key),
                          )
                        }
                      />
                      <span>
                        <span className='font-medium'>{option.key}.</span>{' '}
                        {option.text}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : item.type === 'judge' ? (
              <RadioGroup
                value={
                  response === true ? 'true' : response === false ? 'false' : ''
                }
                onValueChange={(v) => setAnswer(v === 'true')}
                className='grid grid-cols-2 gap-2'
              >
                {(['true', 'false'] as const).map((v) => (
                  <label
                    key={v}
                    className='flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-muted/50'
                  >
                    <RadioGroupItem value={v} />
                    {t(`talent.questions.judge.${v}`)}
                  </label>
                ))}
              </RadioGroup>
            ) : item.type === 'blank' ? (
              <div className='space-y-2'>
                {Array.from({ length: item.blankCount }, (_, i) => {
                  const current = Array.isArray(response)
                    ? (response as string[])
                    : [];
                  return (
                    <label key={i} className='flex items-center gap-3 text-sm'>
                      <span className='w-16 shrink-0 text-muted-foreground'>
                        {t('talent.questions.blankN', { index: i + 1 })}
                      </span>
                      <Input
                        value={current[i] ?? ''}
                        onChange={(e) => {
                          const next = Array.from(
                            { length: item.blankCount },
                            (_, j) => current[j] ?? '',
                          );
                          next[i] = e.target.value;
                          setAnswer(next);
                        }}
                      />
                    </label>
                  );
                })}
              </div>
            ) : (
              <Textarea
                rows={6}
                value={typeof response === 'string' ? response : ''}
                onChange={(e) => setAnswer(e.target.value)}
                aria-label={t('talent.myExams.yourAnswer')}
              />
            )}
            <div className='flex flex-wrap items-center justify-between gap-2 border-t pt-4'>
              <Button
                variant='outline'
                disabled={index === 0}
                onClick={() => go(index - 1)}
              >
                <ChevronLeftIcon data-icon='inline-start' />
                {t('talent.myExams.previous')}
              </Button>
              <Button
                variant={
                  flags.includes(item.questionId) ? 'secondary' : 'ghost'
                }
                onClick={() =>
                  setFlags((f) =>
                    f.includes(item.questionId)
                      ? f.filter((id) => id !== item.questionId)
                      : [...f, item.questionId],
                  )
                }
              >
                <FlagIcon data-icon='inline-start' />
                {flags.includes(item.questionId)
                  ? t('talent.myExams.unflag')
                  : t('talent.myExams.flag')}
              </Button>
              {index < attempt.items.length - 1 ? (
                <Button variant='outline' onClick={() => go(index + 1)}>
                  {t('talent.myExams.next')}
                  <ChevronRightIcon data-icon='inline-end' />
                </Button>
              ) : (
                <Button
                  onClick={() => setConfirming(true)}
                  disabled={submitting}
                >
                  <SendIcon data-icon='inline-start' />
                  {t('talent.myExams.submit')}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
        <Card className='self-start'>
          <CardHeader>
            <CardTitle>{t('talent.myExams.navigator')}</CardTitle>
            <CardDescription>
              {savedAt
                ? t('talent.myExams.savedAt', {
                    time: new Date(savedAt).toLocaleTimeString(),
                  })
                : t('talent.myExams.autosave')}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            <div className='grid grid-cols-6 gap-1.5 lg:grid-cols-5'>
              {attempt.items.map((q, i) => (
                <button
                  key={q.questionId}
                  type='button'
                  onClick={() => go(i)}
                  aria-label={t('talent.myExams.goTo', { index: i + 1 })}
                  aria-current={i === index ? 'step' : undefined}
                  className={cn(
                    'relative flex size-9 items-center justify-center rounded-md border text-sm tabular-nums transition-colors',
                    isAnswered(q, answers[q.questionId])
                      ? 'border-primary/40 bg-primary/10 text-foreground'
                      : 'text-muted-foreground',
                    i === index && 'ring-2 ring-ring',
                  )}
                >
                  {i + 1}
                  {flags.includes(q.questionId) ? (
                    <FlagIcon className='absolute -top-1 -right-1 size-3 text-destructive' />
                  ) : null}
                </button>
              ))}
            </div>
            <Button
              className='w-full'
              disabled={submitting}
              onClick={() => setConfirming(true)}
            >
              <SendIcon data-icon='inline-start' />
              {t('talent.myExams.submit')}
            </Button>
          </CardContent>
        </Card>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.myExams.confirmTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {unanswered
                ? t('talent.myExams.confirmUnanswered', { count: unanswered })
                : t('talent.myExams.confirmAll')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('talent.myExams.keepAnswering')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit()}>
              {t('talent.myExams.submit')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Result({ attemptId }: { attemptId: string }): ReactElement {
  const { t } = useTranslation();
  const result = useRemote<AttemptResult>(
    `talent/attempts/${encodeURIComponent(attemptId)}/result`,
  );
  if (result.error)
    return <LoadError error={result.error} onRetry={result.reload} />;
  if (!result.data) return <BlockSkeleton rows={5} />;
  const data = result.data;
  const passed = data.status === 'passed';
  return (
    <>
      <PageHeader
        title={data.examTitle}
        description={t('talent.exams.attemptNo', { no: data.attemptNo })}
      />
      <Card>
        <CardContent className='flex flex-wrap items-center gap-6'>
          {data.status === 'grading' ? (
            <p className='text-sm text-muted-foreground'>
              {t('talent.myExams.awaitingGrading')}
            </p>
          ) : (
            <>
              <div>
                <p className='text-sm text-muted-foreground'>
                  {t('talent.myExams.score')}
                </p>
                <p
                  className={cn(
                    'font-heading text-4xl font-semibold tabular-nums',
                    passed ? 'text-primary' : 'text-destructive',
                  )}
                >
                  {data.score ?? '—'}
                </p>
              </div>
              <Badge
                variant={passed ? 'secondary' : 'destructive'}
                className='text-sm'
              >
                {passed ? <CheckCircle2Icon /> : <XCircleIcon />}
                {passed
                  ? t('talent.myExams.passed')
                  : t('talent.myExams.failed')}
              </Badge>
              <p className='text-sm text-muted-foreground'>
                {t('talent.myExams.passLine', { score: data.passScore })}
              </p>
            </>
          )}
        </CardContent>
      </Card>
      {data.lossByCompetency.some((l) => l.lost > 0) ? (
        // V3-10 失分分析: points lost per competency.
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.examiner.lossTitle')}</CardTitle>
            <CardDescription>{t('talent.examiner.askHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className='space-y-1 text-sm'>
              {data.lossByCompetency
                .filter((l) => l.lost > 0)
                .map((l) => (
                  <li
                    key={l.competencyId}
                    className='flex justify-between gap-2'
                  >
                    <span>{l.title}</span>
                    <span className='text-muted-foreground tabular-nums'>
                      {t('talent.examiner.lost', {
                        lost: l.lost,
                        total: l.total,
                      })}
                    </span>
                  </li>
                ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {data.wrongByCompetency.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.myExams.weakAreas')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='space-y-2 text-sm'>
              {data.wrongByCompetency.map((area) => (
                <li
                  key={area.competencyId}
                  className='flex flex-wrap items-center gap-2'
                >
                  <span className='font-medium'>{area.title}</span>
                  <span className='text-muted-foreground'>
                    {t('talent.myExams.wrongCount', {
                      wrong: area.wrong,
                      total: area.total,
                    })}
                  </span>
                  {area.courses.map((course) => (
                    <Link
                      key={course.id}
                      to={`/talent/learning/${encodeURIComponent(course.id)}`}
                      className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
                    >
                      <BookOpenIcon className='size-3.5' />
                      {course.title}
                    </Link>
                  ))}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {data.items.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.myExams.review')}</CardTitle>
            {!data.answersVisible ? (
              <CardDescription>
                {t('talent.myExams.answersHidden')}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <ol className='space-y-3'>
              {data.items.map((item, i) => (
                <li
                  key={item.questionId}
                  className='rounded-md border p-3 text-sm'
                >
                  <div className='flex items-start gap-2'>
                    <span className='font-medium'>{i + 1}.</span>
                    <span className='flex-1 whitespace-pre-wrap'>
                      {item.stem}
                    </span>
                    {item.correct === true ? (
                      <CheckCircle2Icon className='size-4 shrink-0 text-primary' />
                    ) : item.correct === false ? (
                      <XCircleIcon className='size-4 shrink-0 text-destructive' />
                    ) : null}
                    <span className='shrink-0 text-muted-foreground tabular-nums'>
                      {item.earned ?? '—'} / {item.score}
                    </span>
                  </div>
                  <p className='mt-1 text-muted-foreground'>
                    {t('talent.myExams.yourAnswer')}：
                    <AnswerText
                      type={item.type}
                      value={item.response}
                      options={item.options}
                    />
                  </p>
                  {data.answersVisible ? (
                    <>
                      <p className='text-muted-foreground'>
                        {t('talent.questions.fields.answer')}：
                        <AnswerText
                          type={item.type}
                          value={item.answer}
                          options={item.options}
                        />
                      </p>
                      {item.explanation ? (
                        <p className='mt-1'>{item.explanation}</p>
                      ) : null}
                      {item.comment ? (
                        <p className='mt-1 text-muted-foreground'>
                          {t('talent.exams.comment')}：{item.comment}
                        </p>
                      ) : null}
                    </>
                  ) : null}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

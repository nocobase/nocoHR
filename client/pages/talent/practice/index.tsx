import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BotIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FlagIcon,
  QuoteIcon,
  RotateCcwIcon,
  SendIcon,
  UserIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { Practice } from '@/components/talent/training-types';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

/**
 * Route `/talent/practice/:practiceId` — a practice conversation with the
 * practice coach playing a team leader or a customer auditor, then its score: each
 * rubric point with the learner's own words and a suggestion tied to the source document.
 * A manager opening it sees only the score.
 */
export default function PracticePage(): ReactElement {
  const { practiceId = '' } = useParams();
  const practice = useRemote<Practice>(
    `talent/practice/${encodeURIComponent(practiceId)}`,
  );
  return (
    <PageContainer>
      <Breadcrumbs />
      {practice.error ? (
        <LoadError error={practice.error} onRetry={practice.reload} />
      ) : !practice.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <PracticeBody key={practiceId} initial={practice.data} />
      )}
    </PageContainer>
  );
}

function PracticeBody({ initial }: { initial: Practice }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const [data, setData] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'reply' | 'finish' | 'again' | null>(null);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const inProgress = data.status === 'inProgress';

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [data.transcript?.length]);

  async function send(): Promise<void> {
    const message = text.trim();
    if (!message) return;
    setBusy('reply');
    try {
      const result = await api.request<{ data: Practice }>({
        path: `talent/practice/${encodeURIComponent(data.id)}/reply`,
        method: 'POST',
        json: { text: message },
      });
      setData(result.data);
      setText('');
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  async function finish(): Promise<void> {
    setConfirmFinish(false);
    setBusy('finish');
    try {
      const result = await api.request<{ data: Practice }>({
        path: `talent/practice/${encodeURIComponent(data.id)}/finish`,
        method: 'POST',
      });
      setData(result.data);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  async function again(): Promise<void> {
    setBusy('again');
    try {
      const result = await api.request<{ data: Practice }>({
        path: 'talent/practice',
        method: 'POST',
        json: {
          scenarioId: data.scenarioId,
          assignmentId: data.assignmentId ?? undefined,
          rehearsal: data.rehearsal,
        },
      });
      await navigate(`/talent/practice/${encodeURIComponent(result.data.id)}`);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <PageHeader
      title={data.scenarioTitle}
      description={
        data.rehearsal
          ? t('talent.practice.rehearsalHint')
          : t('talent.practice.description')
      }
      actions={
        inProgress && data.fullAccess ? (
          <Button
            variant='outline'
            disabled={busy !== null || data.turnCount === 0}
            onClick={() => setConfirmFinish(true)}
          >
            <FlagIcon data-icon='inline-start' />
            {t('talent.practice.finish')}
          </Button>
        ) : !inProgress && data.fullAccess ? (
          <Button
            variant='outline'
            disabled={busy !== null}
            onClick={() => void again()}
          >
            <RotateCcwIcon data-icon='inline-start' />
            {t('talent.practice.again')}
          </Button>
        ) : null
      }
    />
  );

  if (!data.fullAccess)
    return (
      <>
        {header}
        <Card>
          <CardContent className='space-y-2'>
            <p className='text-sm'>
              {data.employeeName} · {t(`talent.practice.status.${data.status}`)}
            </p>
            {data.score !== null ? (
              <p className='font-heading text-3xl font-semibold tabular-nums'>
                {data.score}
              </p>
            ) : null}
            <p className='text-sm text-muted-foreground'>
              {t('talent.practice.scoresOnly')}
            </p>
          </CardContent>
        </Card>
      </>
    );

  return (
    <>
      {header}
      <div className='grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]'>
        <Briefing data={data} />
        <div className='space-y-4'>
          {data.status === 'completed' ? <Result data={data} /> : null}
          <Card>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
              <CardTitle>{t('talent.practice.conversation')}</CardTitle>
              <span className='text-xs text-muted-foreground tabular-nums'>
                {t('talent.practice.turns', {
                  used: data.turnCount,
                  max: data.maxTurns,
                })}
              </span>
            </CardHeader>
            <CardContent className='space-y-4'>
              <div
                className='max-h-[55svh] space-y-3 overflow-y-auto pr-1'
                aria-live='polite'
              >
                {(data.transcript ?? []).map((turn, index) => (
                  <div
                    key={`${turn.at}-${index}`}
                    className={cn(
                      'flex gap-2',
                      turn.role === 'employee' && 'flex-row-reverse',
                    )}
                  >
                    <span
                      className='mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground'
                      aria-hidden
                    >
                      {turn.role === 'coach' ? (
                        <BotIcon className='size-4' />
                      ) : (
                        <UserIcon className='size-4' />
                      )}
                    </span>
                    <p
                      className={cn(
                        'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap',
                        turn.role === 'coach'
                          ? 'bg-muted'
                          : 'bg-primary text-primary-foreground',
                      )}
                    >
                      <span className='sr-only'>
                        {turn.role === 'coach'
                          ? t('talent.practice.coach')
                          : t('talent.practice.you')}
                        ：
                      </span>
                      {turn.text}
                    </p>
                  </div>
                ))}
                {busy === 'reply' ? (
                  <p className='flex items-center gap-2 text-sm text-muted-foreground'>
                    <Spinner /> {t('talent.practice.thinking')}
                  </p>
                ) : null}
                <div ref={end} />
              </div>
              {data.coachSuggestsEnd && inProgress ? (
                <Alert>
                  <AlertDescription>
                    {t('talent.practice.coachSuggestsEnd')}
                  </AlertDescription>
                </Alert>
              ) : null}
              {busy === 'finish' ? (
                <p className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <Spinner /> {t('talent.practice.scoring')}
                </p>
              ) : null}
              {inProgress ? (
                <form
                  className='flex flex-col gap-2 sm:flex-row sm:items-end'
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder={t('talent.practice.placeholder')}
                    aria-label={t('talent.practice.placeholder')}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'Enter' &&
                        !event.shiftKey &&
                        !event.nativeEvent.isComposing
                      ) {
                        event.preventDefault();
                        void send();
                      }
                    }}
                  />
                  <Button
                    type='submit'
                    disabled={busy !== null || !text.trim()}
                  >
                    <SendIcon data-icon='inline-start' />
                    {t('talent.practice.send')}
                  </Button>
                </form>
              ) : data.status === 'abandoned' ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.practice.abandonedHint')}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
      <AlertDialog open={confirmFinish} onOpenChange={setConfirmFinish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.practice.finishTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('talent.practice.finishDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void finish()}>
              {t('talent.practice.finish')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The situation and the rubric; above the conversation on a phone, beside it on a wider screen. */
function Briefing({ data }: { data: Practice }): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  return (
    <Card className='self-start'>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader>
          <CollapsibleTrigger
            render={
              <button
                type='button'
                className='flex w-full items-center justify-between text-left'
              >
                <CardTitle>{t('talent.practice.situation')}</CardTitle>
                <span className='text-xs text-muted-foreground md:hidden'>
                  {open
                    ? t('talent.practice.collapse')
                    : t('talent.practice.expand')}
                </span>
              </button>
            }
          />
        </CardHeader>
        <CollapsibleContent>
          <CardContent className='space-y-4 text-sm'>
            <p className='whitespace-pre-wrap'>{data.situation}</p>
            <div className='space-y-2'>
              <p className='font-medium'>{t('talent.practice.rubric')}</p>
              <ul className='space-y-1.5'>
                {(data.rubric ?? []).map((point) => (
                  <li key={point.point} className='flex justify-between gap-2'>
                    <span>{point.point}</span>
                    <span className='shrink-0 text-muted-foreground tabular-nums'>
                      {point.weight}
                    </span>
                  </li>
                ))}
              </ul>
              <p className='text-xs text-muted-foreground'>
                {t('talent.practice.passScore', { score: data.passScore })}
              </p>
            </div>
            {data.sourceDocumentId ? (
              <Link
                to={`/talent/knowledge/${encodeURIComponent(data.sourceDocumentId)}`}
                className='inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline'
              >
                <FileTextIcon className='size-4' />
                {data.sourceDocumentTitle ?? t('talent.practice.source')}
              </Link>
            ) : null}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function Result({ data }: { data: Practice }): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <CardTitle className='flex items-center gap-2'>
          {data.passed ? (
            <CheckCircle2Icon className='size-5 text-primary' />
          ) : null}
          {t('talent.practice.result')}
        </CardTitle>
        <span className='flex items-baseline gap-2'>
          <span className='font-heading text-3xl font-semibold tabular-nums'>
            {data.score}
          </span>
          <Badge variant={data.passed ? 'secondary' : 'outline'}>
            {data.passed
              ? t('talent.practice.passed')
              : t('talent.practice.notPassed')}
          </Badge>
        </span>
      </CardHeader>
      <CardContent className='space-y-4'>
        {data.feedback ? (
          <p className='text-sm whitespace-pre-wrap'>{data.feedback}</p>
        ) : null}
        <ul className='space-y-3'>
          {(data.rubricResults ?? []).map((result) => (
            <li
              key={result.point}
              className='space-y-1.5 rounded-md border p-3'
            >
              <div className='flex items-start justify-between gap-2 text-sm font-medium'>
                <span>{result.point}</span>
                <span className='shrink-0 tabular-nums'>
                  {result.score} / {result.weight}
                </span>
              </div>
              <Progress
                value={result.weight ? (result.score / result.weight) * 100 : 0}
                aria-label={result.point}
              />
              {result.quote ? (
                <p className='flex gap-1.5 text-sm text-muted-foreground'>
                  <QuoteIcon className='mt-0.5 size-3.5 shrink-0' />
                  {result.quote}
                </p>
              ) : null}
              {result.suggestion ? (
                <p className='text-sm'>{result.suggestion}</p>
              ) : null}
              {result.clause ? (
                <p className='text-xs text-muted-foreground'>
                  {t('talent.practice.clause', { clause: result.clause })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        {!data.passed ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.practice.retryHint')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

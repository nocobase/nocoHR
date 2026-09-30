import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  AlertCircleIcon,
  ArrowRightLeftIcon,
  MessageSquarePlusIcon,
  SendIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import {
  AIChatProvider,
  AIChatWindow,
  NocoBaseAIRootProvider,
  useAI,
  useAIChatController,
} from '@/extensions/nocobase-ai';

import { talentToolRenderers } from './ai-tool-renderers.js';
import { useEmployeeName } from './employee-name.js';
import { errorMessage } from './errors.js';
import { BlockSkeleton } from './states.js';
import { useEmployeeReadiness } from './use-employee-readiness.js';
import { useRemote } from './use-remote.js';

/** A row of the routing table the signed-in user may be routed to (`GET talent/ai-entry/routes`). */
export interface AiEntryRouteOption {
  readonly key: string;
  readonly description: string;
  readonly employee: string;
}

/** The routing step's answer (`POST talent/ai-entry/route`). */
export interface AiEntryDecision {
  readonly key: string;
  readonly employee: string;
  readonly description: string;
  readonly method: 'model' | 'keywords' | 'fallback';
  readonly alternatives: readonly string[];
}

interface Routed {
  readonly question: string;
  readonly employee: string;
  readonly alternatives: readonly string[];
  /** Changes on every hand-off, so each one starts a fresh conversation. */
  readonly session: number;
}

/**
 * 统一 AI 入口 (V1-04): one chat for every AI employee. The first question
 * goes through the server's routing step, which picks the one employee the
 * routing table sends it to for this user; the chat then opens with that
 * employee and sends the question. The answer is labelled with who answered,
 * and "转给 X" hands the same question to another employee the user may use.
 * Routing never widens access: the chosen employee still runs with the user's
 * own tools and data scope.
 *
 * `layout='page'` fills the 问答 page; `layout='panel'` fills the header's
 * side panel.
 */
export function UnifiedAssistant({
  chatId,
  layout,
}: {
  readonly chatId: string;
  readonly layout: 'page' | 'panel';
}): ReactElement {
  return (
    <NocoBaseAIRootProvider toolRenderers={talentToolRenderers}>
      <Entry chatId={chatId} layout={layout} />
    </NocoBaseAIRootProvider>
  );
}

function Entry({
  chatId,
  layout,
}: {
  chatId: string;
  layout: 'page' | 'panel';
}): ReactElement {
  const { t } = useTranslation();
  const name = useEmployeeName();
  const [routed, setRouted] = useState<Routed | null>(null);

  const frame =
    layout === 'page'
      ? 'h-[calc(100svh-13rem)] min-h-[480px] rounded-xl border bg-card'
      : 'h-full min-h-0';

  if (!routed)
    return (
      <div className={cn('flex flex-col', frame)}>
        <RouteComposer
          onRouted={(question, decision) =>
            setRouted({
              question,
              employee: decision.employee,
              alternatives: decision.alternatives,
              session: 0,
            })
          }
        />
      </div>
    );

  return (
    <div className={cn('flex flex-col overflow-hidden', frame)}>
      <div className='flex flex-wrap items-center gap-2 border-b px-4 py-2'>
        <Badge variant='secondary'>
          {t('aiEntry.chat.answeredBy', { name: name(routed.employee) })}
        </Badge>
        {routed.alternatives.map((other) => (
          <Button
            key={other}
            size='sm'
            variant='outline'
            onClick={() =>
              setRouted({
                question: routed.question,
                employee: other,
                alternatives: [
                  routed.employee,
                  ...routed.alternatives.filter((e) => e !== other),
                ],
                session: routed.session + 1,
              })
            }
          >
            <ArrowRightLeftIcon data-icon='inline-start' />
            {t('aiEntry.chat.handTo', { name: name(other) })}
          </Button>
        ))}
        <Button
          size='sm'
          variant='ghost'
          className='ml-auto'
          onClick={() => setRouted(null)}
        >
          <MessageSquarePlusIcon data-icon='inline-start' />
          {t('aiEntry.chat.newQuestion')}
        </Button>
      </div>
      <div className='min-h-0 flex-1'>
        <RoutedChat
          key={`${routed.employee}-${routed.session}`}
          chatId={`${chatId}-${routed.employee}`}
          employee={routed.employee}
          question={routed.question}
        />
      </div>
    </div>
  );
}

/** Before the first message: the question box and one example per route the user may be sent to. */
function RouteComposer({
  onRouted,
}: {
  onRouted: (question: string, decision: AiEntryDecision) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const routes = useRemote<AiEntryRouteOption[]>('talent/ai-entry/routes');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function ask(text: string): Promise<void> {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await api.request<{ data: AiEntryDecision }>({
        path: 'talent/ai-entry/route',
        method: 'POST',
        json: { question: value },
      });
      onRouted(value, data);
    } catch (cause) {
      setError(errorMessage(cause, t));
      setBusy(false);
    }
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4'>
      <div className='space-y-1'>
        <p className='text-base font-medium'>{t('aiEntry.chat.title')}</p>
        <p className='text-sm text-muted-foreground'>
          {t('aiEntry.chat.hint')}
        </p>
      </div>
      {routes.error ? (
        <Alert variant='destructive'>
          <AlertCircleIcon />
          <AlertDescription>{errorMessage(routes.error, t)}</AlertDescription>
        </Alert>
      ) : !routes.data ? (
        <BlockSkeleton rows={2} />
      ) : routes.data.length ? (
        <div className='space-y-2'>
          <p className='text-sm text-muted-foreground'>
            {t('aiEntry.chat.examples')}
          </p>
          <div className='flex flex-col gap-2'>
            {routes.data.map((route) => (
              <Button
                key={route.key}
                variant='outline'
                className='h-auto min-h-11 justify-start text-left whitespace-normal'
                disabled={busy}
                onClick={() => {
                  setQuestion(route.description);
                  void ask(route.description);
                }}
              >
                {route.description}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <form
        className='mt-auto space-y-2'
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        {error ? (
          <Alert variant='destructive'>
            <AlertCircleIcon />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Textarea
          value={question}
          placeholder={t('aiEntry.chat.placeholder')}
          aria-label={t('aiEntry.chat.placeholder')}
          disabled={busy}
          rows={3}
          maxLength={2000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void ask(question);
            }
          }}
        />
        <div className='flex justify-end'>
          <Button type='submit' disabled={busy || !question.trim()}>
            {busy ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <SendIcon data-icon='inline-start' />
            )}
            {busy ? t('aiEntry.chat.routing') : t('aiEntry.chat.send')}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** The chat with the routed employee; it sends the question once when it opens. */
function RoutedChat({
  chatId,
  employee,
  question,
}: {
  chatId: string;
  employee: string;
  question: string;
}): ReactElement {
  const { t } = useTranslation();
  const { configurationStatus } = useAI();
  const { ready, problem } = useEmployeeReadiness(employee);
  if (!ready) {
    if (configurationStatus === 'loading')
      return (
        <div className='p-4'>
          <BlockSkeleton rows={3} />
        </div>
      );
    return (
      <div className='p-4'>
        <Alert>
          <AlertCircleIcon />
          <AlertTitle>{t('talent.advisor.unavailable')}</AlertTitle>
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      </div>
    );
  }
  return <ReadyChat chatId={chatId} employee={employee} question={question} />;
}

function ReadyChat({
  chatId,
  employee,
  question,
}: {
  chatId: string;
  employee: string;
  question: string;
}): ReactElement {
  const { t } = useTranslation();
  const controller = useAIChatController();
  // A ref survives the development double effect, so the question is sent once.
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    sentRef.current = true;
    controller.triggerTask({
      aiEmployee: employee,
      open: false,
      task: { title: question, message: { user: question }, autoSend: true },
    });
  }, [controller, employee, question]);
  return (
    <AIChatProvider
      id={chatId}
      controller={controller}
      defaultEmployee={employee}
    >
      <AIChatWindow
        className='h-full'
        showEmployeeSelector={false}
        placeholder={t('aiEntry.chat.followUp')}
      />
    </AIChatProvider>
  );
}

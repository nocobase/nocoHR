import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
import { EmptyState, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** A card as `GET talent/ai-entry/dev/im-mock/outbox` answers it (server/providers/hr/im-cards/types.ts). */
export interface MockCardView {
  readonly title: string;
  readonly lines: readonly string[];
  readonly buttons: readonly {
    readonly key: string;
    readonly label: string;
    readonly style?: 'primary' | 'danger' | 'default';
    readonly comment?: 'required' | 'optional';
  }[];
  readonly link?: { readonly label: string; readonly path: string };
  readonly state: 'open' | 'handled' | 'discarded';
  readonly stateText?: string;
}

export interface MockOutbox {
  readonly messages: readonly { id: string; text: string; at: string }[];
  readonly cards: readonly {
    id: string;
    kind: string;
    createdAt: string;
    view: MockCardView;
  }[];
}

/**
 * 模拟渠道 · 收件箱 (development only): what the bot sent one directory member —
 * pushed notifications and cards, each card in its latest state — with the
 * card buttons pressed as that member.
 */
export function MockInbox({
  senderId,
  revision,
}: {
  senderId: string;
  revision: number;
}): ReactElement {
  const { t } = useTranslation();
  const outbox = useRemote<MockOutbox>(
    senderId ? 'talent/ai-entry/dev/im-mock/outbox' : null,
    { senderId, revision },
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiEntry.mock.inbox')}</CardTitle>
        <CardDescription>{t('aiEntry.mock.inboxDescription')}</CardDescription>
        <CardAction>
          <Button
            variant='outline'
            size='sm'
            disabled={!senderId || outbox.loading}
            onClick={outbox.reload}
          >
            <RefreshCwIcon data-icon='inline-start' />
            {t('aiEntry.mock.refresh')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className='space-y-4'>
        {outbox.error ? (
          <LoadError error={outbox.error} onRetry={outbox.reload} />
        ) : !outbox.data?.cards.length && !outbox.data?.messages.length ? (
          <EmptyState
            title={t('aiEntry.mock.inboxEmpty')}
            description={t('aiEntry.mock.inboxEmptyDescription')}
          />
        ) : (
          <>
            {outbox.data.cards.map((card) => (
              <MockCard
                key={card.id}
                cardId={card.id}
                senderId={senderId}
                view={card.view}
                onChanged={outbox.reload}
              />
            ))}
            {outbox.data.messages.map((message) => (
              <div
                key={message.id}
                className='rounded-lg border p-4 text-sm break-words whitespace-pre-wrap'
              >
                {message.text}
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One card with its buttons; a button that asks for a comment opens a comment field first. */
export function MockCard({
  cardId,
  senderId,
  view,
  onChanged,
}: {
  cardId: string;
  senderId: string;
  view: MockCardView;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  // The press's answer, until the inbox reloads and hands a newer view.
  const [answered, setAnswered] = useState<{
    for: MockCardView;
    view: MockCardView;
  } | null>(null);
  const current = answered?.for === view ? answered.view : view;
  const [busy, setBusy] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  async function press(button: string): Promise<void> {
    setBusy(button);
    try {
      const { data } = await api.request<{
        data: { ok: boolean; message: string; card: MockCardView | null };
      }>({
        path: 'talent/ai-entry/dev/im-mock/card',
        method: 'POST',
        json: {
          senderId,
          cardId,
          button,
          comment: asking === button ? comment : null,
        },
      });
      toast.add({ type: data.ok ? 'success' : 'info', title: data.message });
      if (data.card) setAnswered({ for: view, view: data.card });
      if (data.ok) {
        setAsking(null);
        setComment('');
        onChanged();
      }
    } catch (failure) {
      toast.add({ type: 'error', title: errorMessage(failure, t) });
    } finally {
      setBusy(null);
    }
  }

  const askingButton = current.buttons.find((b) => b.key === asking);
  return (
    <div
      className='space-y-3 rounded-lg border p-4'
      aria-label={current.title}
      role='group'
    >
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='text-sm font-medium'>{current.title}</span>
        {current.state === 'open' ? (
          <Badge variant='outline'>{t('aiEntry.mock.cardOpen')}</Badge>
        ) : (
          <Badge variant='secondary'>
            {current.stateText ?? t('aiEntry.mock.cardHandled')}
          </Badge>
        )}
      </div>
      <ul className='space-y-1 text-sm text-muted-foreground'>
        {current.lines.map((line) => (
          <li key={line} className='break-words'>
            {line}
          </li>
        ))}
      </ul>
      {askingButton ? (
        <Field>
          <FieldLabel htmlFor={`comment-${cardId}`}>
            {t('aiEntry.mock.comment')}
            {askingButton.comment === 'required' ? ' *' : ''}
          </FieldLabel>
          <Textarea
            id={`comment-${cardId}`}
            rows={2}
            maxLength={500}
            value={comment}
            disabled={busy !== null}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {current.buttons.map((button) => (
          <Button
            key={button.key}
            className='min-h-11 sm:min-h-8'
            variant={
              button.style === 'primary'
                ? 'default'
                : button.style === 'danger'
                  ? 'destructive'
                  : 'outline'
            }
            disabled={
              busy !== null ||
              (asking === button.key &&
                button.comment === 'required' &&
                !comment.trim())
            }
            onClick={() => {
              if (button.comment && asking !== button.key) {
                setAsking(button.key);
                return;
              }
              void press(button.key);
            }}
          >
            {busy === button.key ? <Spinner data-icon='inline-start' /> : null}
            {button.label}
          </Button>
        ))}
        {current.link ? (
          <Button
            variant='ghost'
            className='min-h-11 sm:min-h-8'
            nativeButton={false}
            render={<Link to={current.link.path} />}
          >
            <ExternalLinkIcon data-icon='inline-start' />
            {current.link.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon, SendIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { EmptyState } from '@/components/talent/states';
import { useEmployeeName } from '@/components/talent/employee-name';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

import { MockInbox } from './im-mock-inbox.js';

/**
 * Directory members from the demo case; 唐宁 exists only in the office suite.
 * 周宏, 陈静 and 林晓 receive approval cards.
 */
const PRESETS = [
  'fs-u-wanglei',
  'fs-u-limin',
  'fs-u-mgr-east',
  'fs-u-mgr-njl',
  'fs-u-hr01',
  'fs-u-tangning',
] as const;

interface Exchange {
  readonly cards?: readonly string[];
  readonly id: number;
  readonly senderId: string;
  readonly chatType: 'p2p' | 'group';
  readonly text: string;
  readonly reply?: string;
  readonly handledBy?: string | null;
  readonly error?: string;
}

/**
 * Route `/dev/im-mock` — 模拟渠道（仅开发环境）(V1-04): sends a message to the
 * office-suite bot's handler as a directory member, the way a Feishu callback
 * would, and shows the reply and which AI employee handled it. It is a dev
 * route, so a production build does not contain it; the endpoint exists only
 * outside production and requires `talent.aiAssistant` configure.
 *
 * 收件箱 shows what the bot sent that member — pushed notifications and
 * 飞书卡片 in their latest state — and presses a card's buttons as the member,
 * through the same handler a signed card callback reaches.
 */
export default function ImMockPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const name = useEmployeeName();
  const [senderId, setSenderId] = useState<string>(PRESETS[0]);
  const [chatType, setChatType] = useState<'p2p' | 'group'>('p2p');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Exchange[]>([]);
  const [inboxRevision, setInboxRevision] = useState(0);

  async function send(): Promise<void> {
    const message = text.trim();
    if (!message || !senderId.trim() || busy) return;
    setBusy(true);
    const base = {
      id: Date.now(),
      senderId: senderId.trim(),
      chatType,
      text: message,
    };
    try {
      const { data } = await api.request<{
        data: {
          reply: string;
          handledBy: string | null;
          cards?: string[];
        };
      }>({
        path: 'talent/ai-entry/dev/im-mock',
        method: 'POST',
        json: { chatType, senderId: base.senderId, text: message },
      });
      setLog((current) => [
        ...current,
        {
          ...base,
          reply: data.reply,
          handledBy: data.handledBy,
          cards: data.cards,
        },
      ]);
      setText('');
      if (data.cards?.length) setInboxRevision((n) => n + 1);
    } catch (cause) {
      setLog((current) => [
        ...current,
        { ...base, error: errorMessage(cause, t) },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={t('navigation.imMock')}
        description={t('aiEntry.mock.description')}
      />
      <Card>
        <CardHeader>
          <CardTitle>{t('aiEntry.mock.composeTitle')}</CardTitle>
          <CardDescription>
            {t('aiEntry.mock.composeDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <FieldGroup>
              <div className='grid gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='im-mock-sender'>
                    {t('aiEntry.mock.sender')} *
                  </FieldLabel>
                  <Input
                    id='im-mock-sender'
                    value={senderId}
                    maxLength={128}
                    disabled={busy}
                    onChange={(e) => setSenderId(e.target.value)}
                  />
                  <div className='flex flex-wrap gap-1'>
                    {PRESETS.map((preset) => (
                      <Button
                        key={preset}
                        type='button'
                        size='xs'
                        variant={preset === senderId ? 'secondary' : 'ghost'}
                        disabled={busy}
                        onClick={() => setSenderId(preset)}
                      >
                        {t(`aiEntry.mock.presets.${preset}`)}
                      </Button>
                    ))}
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor='im-mock-chat'>
                    {t('aiEntry.mock.chatType')}
                  </FieldLabel>
                  <NativeSelect
                    id='im-mock-chat'
                    value={chatType}
                    disabled={busy}
                    onChange={(e) =>
                      setChatType(e.target.value === 'group' ? 'group' : 'p2p')
                    }
                  >
                    <NativeSelectOption value='p2p'>
                      {t('aiEntry.mock.p2p')}
                    </NativeSelectOption>
                    <NativeSelectOption value='group'>
                      {t('aiEntry.mock.group')}
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    {t('aiEntry.mock.groupHint')}
                  </FieldDescription>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor='im-mock-text'>
                  {t('aiEntry.mock.message')} *
                </FieldLabel>
                <Textarea
                  id='im-mock-text'
                  rows={3}
                  maxLength={2000}
                  value={text}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                />
              </Field>
              <div className='flex justify-end'>
                <Button
                  type='submit'
                  disabled={busy || !text.trim() || !senderId.trim()}
                >
                  {busy ? (
                    <Spinner data-icon='inline-start' />
                  ) : (
                    <SendIcon data-icon='inline-start' />
                  )}
                  {t('aiEntry.mock.send')}
                </Button>
              </div>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('aiEntry.mock.conversation')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-4'>
          {!log.length ? (
            <EmptyState
              title={t('aiEntry.mock.empty')}
              description={t('aiEntry.mock.emptyDescription')}
            />
          ) : (
            log.map((entry) => (
              <div key={entry.id} className='space-y-2 rounded-lg border p-4'>
                <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
                  <span>{entry.senderId}</span>
                  <Badge variant='outline'>
                    {t(`aiEntry.mock.${entry.chatType}`)}
                  </Badge>
                </div>
                <p className='text-sm whitespace-pre-wrap'>{entry.text}</p>
                {entry.error ? (
                  <Alert variant='destructive'>
                    <AlertCircleIcon />
                    <AlertDescription>{entry.error}</AlertDescription>
                  </Alert>
                ) : (
                  <div className='space-y-2 rounded-md bg-muted p-3'>
                    <Badge variant='secondary'>
                      {entry.handledBy
                        ? t('aiEntry.chat.answeredBy', {
                            name: name(entry.handledBy),
                          })
                        : t('aiEntry.mock.notHandled')}
                    </Badge>
                    <p className='text-sm break-words whitespace-pre-wrap'>
                      {entry.reply || t('aiEntry.mock.noReply')}
                    </p>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
      <MockInbox senderId={senderId.trim()} revision={inboxRevision} />
    </PageContainer>
  );
}

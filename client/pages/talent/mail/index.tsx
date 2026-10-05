import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { InboxIcon, RefreshCwIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import {
  displaySubject,
  useMailboxes,
  type MailMessage,
  type MailPurpose,
} from '@/components/talent/mail-model';
import { MailMessageView } from '@/components/talent/mail-thread';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const FILTERS = ['all', 'unmatched', 'drafts'] as const;
type Filter = (typeof FILTERS)[number];

/**
 * Route `/talent/mail` (V2-06 邮件往来): each business mailbox the user may
 * read, its messages, the ones waiting to be sorted (待归类) and the reply
 * drafts. Opening a message shows what the HR assistant recognised; a draft is
 * edited and sent from there. `?mailbox=` and `?status=` come from
 * notifications.
 */
export default function MailPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const mailboxes = useMailboxes();
  const available = mailboxes.data ?? [];
  const requested = params.get('mailbox');
  const mailbox =
    available.find((m) => m.purpose === requested) ?? available[0] ?? null;
  const filter: Filter = (FILTERS as readonly string[]).includes(
    params.get('status') ?? '',
  )
    ? (params.get('status') as Filter)
    : 'all';
  const messages = useRemote<MailMessage[]>(
    mailbox ? 'talent/mail/messages' : null,
    mailbox
      ? {
          mailbox: mailbox.purpose,
          status: filter === 'all' ? undefined : filter,
        }
      : undefined,
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const open = messages.data?.find((m) => m.id === openId) ?? null;
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  function select(next: { mailbox?: MailPurpose; status?: Filter }) {
    setParams(
      (current) => {
        const out = new URLSearchParams(current);
        if (next.mailbox) out.set('mailbox', next.mailbox);
        if (next.status) out.set('status', next.status);
        return out;
      },
      { replace: true },
    );
  }

  async function poll(purpose: MailPurpose): Promise<void> {
    setPolling(true);
    try {
      const result = await api.request<{ data: Record<string, number> }>({
        path: 'talent/mail/poll',
        method: 'POST',
        query: { mailbox: purpose },
      });
      toast.add({
        type: 'success',
        title: t('mail.polled', { count: result.data[purpose] ?? 0 }),
      });
      messages.reload();
      mailboxes.reload();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    } finally {
      setPolling(false);
    }
  }

  async function resort(message: MailMessage): Promise<void> {
    try {
      await api.request({
        path: `talent/mail/messages/${encodeURIComponent(message.id)}/resort`,
        method: 'POST',
      });
      toast.add({ type: 'success', title: t('mail.resorted') });
      messages.reload();
      mailboxes.reload();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    }
  }

  async function ignore(message: MailMessage): Promise<void> {
    try {
      await api.request({
        path: `talent/mail/messages/${encodeURIComponent(message.id)}/ignore`,
        method: 'POST',
      });
      toast.add({ type: 'success', title: t('mail.ignored') });
      setOpenId(null);
      messages.reload();
      mailboxes.reload();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    }
  }

  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('mail.title')}
        description={t('mail.description')}
        actions={
          mailbox ? (
            <Button
              variant='outline'
              disabled={polling}
              onClick={() => void poll(mailbox.purpose)}
            >
              {polling ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <RefreshCwIcon data-icon='inline-start' />
              )}
              {t('mail.poll')}
            </Button>
          ) : null
        }
      />
      {mailboxes.error ? (
        <LoadError error={mailboxes.error} onRetry={mailboxes.reload} />
      ) : !mailboxes.data ? (
        <BlockSkeleton rows={3} />
      ) : !mailbox ? (
        <Card>
          <CardContent className='py-10 text-center text-sm text-muted-foreground'>
            {t('mail.noMailbox')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-3'>
            {available.length > 1 ? (
              <ToggleGroup
                variant='outline'
                value={[mailbox.purpose]}
                onValueChange={(value) => {
                  const next = (Array.isArray(value) ? value[0] : value) as
                    MailPurpose | undefined;
                  if (next) select({ mailbox: next });
                }}
              >
                {available.map((m) => (
                  <ToggleGroupItem key={m.purpose} value={m.purpose}>
                    {t(`mail.purposes.${m.purpose}`)}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            ) : (
              <p className='text-sm font-medium'>
                {t(`mail.purposes.${mailbox.purpose}`)} · {mailbox.address}
              </p>
            )}
            <ToggleGroup
              variant='outline'
              value={[filter]}
              onValueChange={(value) => {
                const next = (Array.isArray(value) ? value[0] : value) as
                  Filter | undefined;
                if (next) select({ status: next });
              }}
            >
              {FILTERS.map((f) => (
                <ToggleGroupItem key={f} value={f}>
                  {t(`mail.filters.${f}`)}
                  {f === 'unmatched' && mailbox.unmatched ? (
                    <Badge variant='secondary' className='ml-1'>
                      {mailbox.unmatched}
                    </Badge>
                  ) : null}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          {mailbox.adapter === 'local-files' ? (
            <Alert>
              <InboxIcon />
              <AlertDescription>{t('mail.mockNotice')}</AlertDescription>
            </Alert>
          ) : null}
          {messages.error ? (
            <LoadError error={messages.error} onRetry={messages.reload} />
          ) : !messages.data ? (
            <BlockSkeleton rows={4} />
          ) : !messages.data.length ? (
            <Card>
              <CardContent className='py-10 text-center text-sm text-muted-foreground'>
                {t('mail.empty')}
              </CardContent>
            </Card>
          ) : (
            <ul className='space-y-2'>
              {messages.data.map((m) => {
                const when = m.sentAt ?? m.receivedAt ?? m.createdAt;
                return (
                  <li key={m.id}>
                    <button
                      type='button'
                      className='w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      onClick={() => setOpenId(m.id)}
                    >
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='min-w-0 flex-1 truncate font-medium'>
                          {displaySubject(m.subject)}
                        </span>
                        <Badge
                          variant={
                            m.status === 'unmatched' || m.status === 'draft'
                              ? 'secondary'
                              : 'outline'
                          }
                        >
                          {t(`mail.status.${m.status}`)}
                        </Badge>
                      </div>
                      <p className='mt-1 truncate text-sm text-muted-foreground'>
                        {m.direction === 'inbound'
                          ? (m.from.name ?? m.from.address)
                          : m.to.join('、')}
                        {when ? ` · ${format.format(new Date(when))}` : ''}
                      </p>
                      {m.aiSummary ? (
                        <p className='mt-1 line-clamp-2 text-sm'>
                          {m.aiSummary}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <Sheet
        open={Boolean(open)}
        onOpenChange={(next) => !next && setOpenId(null)}
      >
        <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
          {open ? (
            <>
              <SheetHeader>
                <SheetTitle>{t(`mail.purposes.${open.mailbox}`)}</SheetTitle>
                <SheetDescription>
                  {displaySubject(open.subject)}
                </SheetDescription>
              </SheetHeader>
              <div className='space-y-3 px-4 pb-6'>
                <MailMessageView
                  message={open}
                  canSend={mailbox?.canSend ?? false}
                  showRecordLink
                  onChanged={() => {
                    messages.reload();
                    mailboxes.reload();
                  }}
                />
                {open.status === 'unmatched' && mailbox?.canSend ? (
                  <div className='flex flex-wrap gap-2'>
                    <Button variant='outline' onClick={() => void resort(open)}>
                      {t('mail.resort')}
                    </Button>
                    <Button variant='outline' onClick={() => void ignore(open)}>
                      {t('mail.ignore')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

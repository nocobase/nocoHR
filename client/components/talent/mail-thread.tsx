/**
 * 邮件往来 (V2-06): one message, a reply draft, and a record's whole thread.
 * A received message shows what the AI recognised in it; a draft can be edited
 * and is sent only after the sender confirms the recipient. Bodies are shown
 * as plain text, never as HTML.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PaperclipIcon, SendIcon, SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import {
  displaySubject,
  recordPath,
  type MailMessage,
  type MailPurpose,
} from './mail-model.js';

function Attachments({
  message,
}: {
  message: MailMessage;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  if (!message.attachments.length && !message.rejectedAttachments.length)
    return null;
  return (
    <div className='space-y-1 text-sm'>
      {message.attachments.map((a) => (
        <Button
          key={a.fileId}
          variant='link'
          className='h-auto p-0'
          onClick={() =>
            void downloadFile(
              api,
              `talent/mail/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(a.fileId)}`,
              a.filename,
            ).catch((error: unknown) =>
              toast.add({ type: 'error', title: errorMessage(error, t) }),
            )
          }
        >
          <PaperclipIcon data-icon='inline-start' />
          {a.filename}
        </Button>
      ))}
      {message.rejectedAttachments.length ? (
        <p className='text-muted-foreground'>
          {t('mail.rejected', {
            files: message.rejectedAttachments
              .map(
                (a) =>
                  `${a.filename}（${t(`mail.rejectedReasons.${a.reason}`)}）`,
              )
              .join('、'),
          })}
        </p>
      ) : null}
    </div>
  );
}

function DraftEditor({
  message,
  canSend,
  onChanged,
}: {
  message: MailMessage;
  canSend: boolean;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [body, setBody] = useState(message.bodyText ?? '');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const to = message.to.join('、');
  const id = `mail-draft-${message.id}`;

  async function save(): Promise<boolean> {
    if (body === (message.bodyText ?? '')) return true;
    try {
      await api.request({
        path: `talent/mail/messages/${encodeURIComponent(message.id)}`,
        method: 'PATCH',
        json: { body },
      });
      return true;
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
      return false;
    }
  }

  async function send(): Promise<void> {
    setBusy(true);
    try {
      if (!(await save())) return;
      await api.request({
        path: `talent/mail/messages/${encodeURIComponent(message.id)}/send`,
        method: 'POST',
      });
      toast.add({ type: 'success', title: t('mail.sent', { to }) });
      onChanged();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className='space-y-3'>
      <Field>
        <FieldLabel htmlFor={id}>{t('mail.draftTitle')}</FieldLabel>
        <Textarea
          id={id}
          rows={10}
          value={body}
          disabled={!canSend || busy}
          onChange={(e) => setBody(e.target.value)}
        />
        <FieldDescription>
          {t('mail.draftHint', {
            to,
            assistant: t(`mail.assistants.${message.mailbox}`),
          })}
        </FieldDescription>
      </Field>
      {canSend ? (
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={busy || body === (message.bodyText ?? '')}
            onClick={() =>
              void save().then((ok) => {
                if (!ok) return;
                toast.add({ type: 'success', title: t('mail.saved') });
                onChanged();
              })
            }
          >
            {t('mail.save')}
          </Button>
          <Button
            disabled={busy || !body.trim()}
            onClick={() => setConfirming(true)}
          >
            <SendIcon data-icon='inline-start' />
            {t('mail.send')}
          </Button>
        </div>
      ) : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mail.sendTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mail.sendDescription', {
                to,
                mailbox: t(`mail.purposes.${message.mailbox}`),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void send()}>
              {t('mail.send')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** One message: sender, what the assistant recognised, the text and the attachments. */
export function MailMessageView({
  message,
  canSend,
  onChanged,
  showRecordLink = false,
}: {
  message: MailMessage;
  canSend: boolean;
  onChanged: () => void;
  showRecordLink?: boolean;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const when = message.sentAt ?? message.receivedAt ?? message.createdAt;
  const link = showRecordLink ? recordPath(message) : null;
  return (
    <article className='space-y-3 rounded-lg border p-4'>
      <header className='space-y-1'>
        <div className='flex flex-wrap items-center gap-2'>
          <p className='font-medium'>{displaySubject(message.subject)}</p>
          <Badge
            variant={message.status === 'unmatched' ? 'secondary' : 'outline'}
          >
            {t(`mail.status.${message.status}`)}
          </Badge>
          {message.aiIntent ? (
            <Badge variant='outline'>
              {t(`mail.intents.${message.aiIntent}`, {
                defaultValue: message.aiIntent,
              })}
            </Badge>
          ) : null}
        </div>
        <p className='text-sm text-muted-foreground'>
          {message.direction === 'inbound'
            ? `${t('mail.from')}：${message.from.name ? `${message.from.name} ` : ''}<${message.from.address}>`
            : `${t('mail.to')}：${message.to.join('、')}`}
          {when ? ` · ${format.format(new Date(when))}` : ''}
        </p>
      </header>
      {message.aiSummary ? (
        <p className='flex gap-2 rounded-md bg-muted p-3 text-sm'>
          <SparklesIcon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
          <span>
            <span className='font-medium'>
              {t(`mail.assistants.${message.mailbox}`)}：
            </span>
            {message.aiSummary}
          </span>
        </p>
      ) : null}
      {message.status === 'draft' ? (
        <DraftEditor
          message={message}
          canSend={canSend}
          onChanged={onChanged}
        />
      ) : message.bodyText === null ? (
        <p className='text-sm text-muted-foreground'>{t('mail.bodyCleared')}</p>
      ) : (
        <p className='whitespace-pre-wrap break-words text-sm'>
          {message.bodyText}
        </p>
      )}
      <Attachments message={message} />
      {link ? (
        <Button
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link to={link} />}
        >
          {t('mail.openRecord')}
        </Button>
      ) : null}
    </article>
  );
}

/** Every message about one record, oldest first; mounted in the record's page. */
export function MailThread({
  mailbox,
  refType,
  refId,
  canSend,
}: {
  mailbox: MailPurpose;
  refType: string;
  refId: string;
  canSend: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const thread = useRemote<MailMessage[]>(
    `talent/mail/by-record/${encodeURIComponent(refType)}/${encodeURIComponent(refId)}`,
    { mailbox },
  );
  return (
    <section className='space-y-3'>
      <h3 className='font-medium'>{t('mail.thread')}</h3>
      {thread.error ? (
        <LoadError error={thread.error} onRetry={thread.reload} />
      ) : !thread.data ? (
        <BlockSkeleton rows={2} />
      ) : !thread.data.length ? (
        <p className='text-sm text-muted-foreground'>{t('mail.threadEmpty')}</p>
      ) : (
        thread.data.map((message) => (
          <MailMessageView
            key={`${message.id}-${message.status}`}
            message={message}
            canSend={canSend}
            onChanged={thread.reload}
          />
        ))
      )}
    </section>
  );
}

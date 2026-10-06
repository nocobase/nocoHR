/**
 * 待归类 · 挂到单据 (V2-06): a person links an unsorted message to a record
 * the assistant could not find — a staffing agency's bill, one of the
 * recruiter's applications or published postings, an audit request, an
 * employee. The server lists only what the person may link to, and after the
 * link the mailbox's assistant drafts its reply where it has one.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { LinkIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { MailMessage, MailPurpose } from '@/components/talent/mail-model';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from '@/components/ui/toast';

interface LinkTarget {
  refType: string;
  refId: string;
  label: string;
  hint: string | null;
}

export function LinkRecordButton({
  message,
  mailbox,
  onLinked,
}: {
  message: MailMessage;
  mailbox: MailPurpose;
  onLinked: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const targets = useRemote<LinkTarget[]>(
    open ? 'talent/mail/link-targets' : null,
    { mailbox, q: query },
  );

  async function link(target: LinkTarget): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: `talent/mail/messages/${encodeURIComponent(message.id)}/link`,
        method: 'POST',
        json: { refType: target.refType, refId: target.refId },
      });
      toast.add({
        type: 'success',
        title: t('mail.linked', { label: target.label }),
      });
      setOpen(false);
      onLinked();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant='outline' />}>
        <LinkIcon data-icon='inline-start' />
        {t('mail.link')}
      </PopoverTrigger>
      <PopoverContent className='w-80 space-y-2'>
        <Input
          autoFocus
          value={query}
          placeholder={t('mail.linkSearch')}
          aria-label={t('mail.linkSearch')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {targets.error ? (
          <p className='text-sm text-destructive'>
            {errorMessage(targets.error, t)}
          </p>
        ) : !targets.data ? null : !targets.data.length ? (
          <p className='text-sm text-muted-foreground'>{t('mail.linkNone')}</p>
        ) : (
          <ul className='max-h-64 space-y-1 overflow-y-auto'>
            {targets.data.map((target) => (
              <li key={`${target.refType}:${target.refId}`}>
                <button
                  type='button'
                  disabled={busy}
                  className='w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
                  onClick={() => void link(target)}
                >
                  <span className='block'>{target.label}</span>
                  {target.hint ? (
                    <span className='block text-xs text-muted-foreground'>
                      {target.hint === 'posting' || target.hint === 'departed'
                        ? t(`mail.linkHints.${target.hint}`)
                        : target.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

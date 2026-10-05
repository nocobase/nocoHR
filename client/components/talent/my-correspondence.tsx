import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';

interface Item {
  accountId: string;
  id: string;
  subject: string;
  from: { address: string; name?: string } | null;
  at: string | null;
  preview: string;
}

/**
 * 我的邮箱往来 (业务邮件改用 Mail 插件): the mail between the current user's
 * own mailboxes and an address — a recruiter's correspondence with a
 * candidate from their own mailbox, beside the recruiting mailbox's thread.
 * Only the user's own accounts are read; nothing here sends.
 */
export function MyCorrespondence({
  address,
}: {
  address: string;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const list = useRemote<Item[]>('talent/mail/mine', { address });
  const [open, setOpen] = useState<Record<string, string>>({});
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <section className='space-y-3'>
      <h3 className='font-medium'>{t('myMailbox.correspondence')}</h3>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={2} />
      ) : !list.data.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('myMailbox.noCorrespondence')}{' '}
          <Link className='underline' to='/talent/my-mailbox'>
            {t('myMailbox.title')}
          </Link>
        </p>
      ) : (
        <ul className='space-y-2'>
          {list.data.map((m) => {
            const key = `${m.accountId}:${m.id}`;
            return (
              <li key={key} className='space-y-1 rounded-lg border p-3 text-sm'>
                <p className='font-medium'>{m.subject}</p>
                <p className='text-muted-foreground'>
                  {m.from ? `${m.from.name ?? ''} <${m.from.address}>` : ''}
                  {m.at ? ` · ${format.format(new Date(m.at))}` : ''}
                </p>
                {open[key] !== undefined ? (
                  <p className='whitespace-pre-wrap'>{open[key]}</p>
                ) : (
                  <>
                    <p className='text-muted-foreground'>{m.preview}</p>
                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() =>
                        void api
                          .request<{ data: { text: string } }>({
                            path: `talent/mail/mine/${encodeURIComponent(m.accountId)}/${encodeURIComponent(m.id)}`,
                          })
                          .then((r) =>
                            setOpen((o) => ({ ...o, [key]: r.data.text })),
                          )
                          .catch((error: unknown) =>
                            setOpen((o) => ({
                              ...o,
                              [key]: errorMessage(error, t),
                            })),
                          )
                      }
                    >
                      {t('myMailbox.read')}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

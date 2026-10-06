import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

interface FailedCard {
  id: string;
  title: string;
  recipientName: string | null;
  error: string;
  createdAt: string;
}

/**
 * 连接设置 · 发送失败的卡片: cards that did not reach the office suite, with
 * the provider's reason (such as a recipient outside the app's availability
 * range), and 重新发送 once that is fixed. Shown to whoever may run the sync.
 */
export function FailedCardsCard(): ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'run',
  });
  const list = useRemote<FailedCard[]>(
    grant.can ? 'talent/org-sync/failed-cards' : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  if (!grant.can) return null;
  const time = new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  const resend = async (id: string) => {
    setBusy(id);
    try {
      const result = (
        await api.request<{ data: { status: string; error?: string } }>({
          method: 'POST',
          path: `talent/org-sync/failed-cards/${encodeURIComponent(id)}/resend`,
        })
      ).data;
      if (result.status === 'sent')
        toast.add({ type: 'success', title: t('orgSync.failedCards.resent') });
      else
        toast.add({
          type: 'error',
          title: t('orgSync.failedCards.stillFailed', {
            error: result.error ?? '',
          }),
        });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orgSync.failedCards.title')}</CardTitle>
        <CardDescription>
          {t('orgSync.failedCards.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={2} />
        ) : !list.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('orgSync.failedCards.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('orgSync.failedCards.sentAt')}</TableHead>
                <TableHead>{t('orgSync.failedCards.recipient')}</TableHead>
                <TableHead>{t('orgSync.failedCards.reason')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((card) => (
                <TableRow key={card.id}>
                  <TableCell className='whitespace-nowrap tabular-nums'>
                    {time.format(new Date(card.createdAt))}
                  </TableCell>
                  <TableCell>
                    <div className='font-medium'>
                      {card.recipientName ?? '—'}
                    </div>
                    <div className='text-sm text-muted-foreground'>
                      {card.title}
                    </div>
                  </TableCell>
                  <TableCell className='max-w-80 text-sm break-words text-muted-foreground'>
                    {card.error}
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={busy === card.id}
                      onClick={() => void resend(card.id)}
                    >
                      {t('orgSync.failedCards.resend')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

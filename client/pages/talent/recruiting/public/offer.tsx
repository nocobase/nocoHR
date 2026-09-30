/**
 * （公开）Offer 回复 `/offer/:token`: the candidate reads their own offer
 * letter and accepts or declines before the deadline. After accepting, the
 * same link serves 待入职跟进 — confirming arrival and uploading their ID
 * card, bank card and diploma — until the onboarding takes effect. The link
 * opens nothing else. Usable at 375px.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { downloadFile } from '@/components/talent/download';
import { useRecruitingError } from '@/components/talent/recruiting-lib';
import type { PublicOffer } from '@/components/talent/recruiting-types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export default function PublicOfferPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const { token = '' } = useParams();
  const path = `public/recruiting/offer/${encodeURIComponent(token)}`;
  const offer = useRemote<PublicOffer>(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const post = async (
    sub: string,
    init: { json?: unknown; body?: FormData },
  ) => {
    setBusy(true);
    setError(null);
    try {
      if (init.body)
        await api.request({
          path: `${path}${sub}`,
          method: 'POST',
          body: init.body,
        });
      else
        await api.request({
          path: `${path}${sub}`,
          method: 'POST',
          json: init.json ?? {},
        });
      offer.reload();
      return true;
    } catch (cause) {
      setError(failure(cause));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const data = offer.data;
  return (
    <main className='mx-auto w-full max-w-xl space-y-4 px-4 py-8'>
      {offer.error ? (
        <p className='text-sm text-muted-foreground'>
          {done ?? t('recruiting.public.invalid')}
        </p>
      ) : !data ? (
        <Skeleton className='h-40 w-full' />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('recruiting.public.offerTitle')}</CardTitle>
              <CardDescription>
                {data.name} ·{' '}
                {t('recruiting.public.offerFor', {
                  position: data.position,
                  department: data.department,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-2 text-sm'>
              <p>
                {t('recruiting.public.startDate', { date: data.startDate })}
              </p>
              <p>
                {t('recruiting.public.probation', {
                  months: data.probationMonths,
                })}
              </p>
              {data.hasLetter ? (
                <Button
                  variant='outline'
                  onClick={() =>
                    void downloadFile(api, `${path}/letter`, 'offer.html')
                  }
                >
                  {t('recruiting.public.viewLetter')}
                </Button>
              ) : null}
            </CardContent>
          </Card>
          {data.status === 'sent' ? (
            data.expired ? (
              <p className='text-sm text-muted-foreground'>
                {t('recruiting.public.expired')}
              </p>
            ) : (
              <div className='flex gap-2'>
                <Button
                  className='flex-1'
                  disabled={busy}
                  onClick={() =>
                    void post('/respond', { json: { accept: true } })
                  }
                >
                  {t('recruiting.public.accept')}
                </Button>
                <Button
                  className='flex-1'
                  variant='outline'
                  disabled={busy}
                  onClick={() => {
                    void post('/respond', { json: { accept: false } }).then(
                      (ok) => {
                        if (ok) setDone(t('recruiting.public.declined'));
                      },
                    );
                  }}
                >
                  {t('recruiting.public.decline')}
                </Button>
              </div>
            )
          ) : null}
          {data.status === 'accepted' && data.preboarding ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('recruiting.public.preboarding')}</CardTitle>
                <CardDescription>
                  {t('recruiting.public.accepted', { date: data.startDate })}
                </CardDescription>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                {data.preboarding.arrivalConfirmedAt ? (
                  <p>{t('recruiting.public.arrivalConfirmed')}</p>
                ) : (
                  <Button
                    disabled={busy}
                    onClick={() => void post('/arrival', {})}
                  >
                    {t('recruiting.public.confirmArrival')}
                  </Button>
                )}
                {data.preboarding.kinds.map((kind) => {
                  const uploaded = data.preboarding?.uploads.some(
                    (u) => u.kind === kind,
                  );
                  return (
                    <label key={kind} className='block space-y-1'>
                      <span>
                        {t('recruiting.public.upload', {
                          kind: t(`recruiting.labels.upload.${kind}`),
                        })}
                        {uploaded
                          ? ` · ${t('recruiting.public.uploaded')}`
                          : ''}
                      </span>
                      <Input
                        type='file'
                        accept='.jpg,.jpeg,.png,.pdf,.docx'
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const body = new FormData();
                          body.set('kind', kind);
                          body.set('file', file);
                          void post('/upload', { body });
                        }}
                      />
                    </label>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
        </>
      )}
    </main>
  );
}

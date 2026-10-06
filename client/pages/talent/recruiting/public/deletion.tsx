/**
 * （公开）删除申请 `/jobs/deletion/:token` (V2-07): the link in the resume
 * receipt. The candidate asks for their information to be deleted; the
 * recruiters responsible are told and anonymize them, after which the link no
 * longer opens. The page shows nothing about the candidate, only whether the
 * request was received. Usable at 375px.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import {
  formatDateTime,
  useRecruitingError,
} from '@/components/talent/recruiting-lib';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

interface DeletionView {
  company: string;
  requestedAt: string | null;
}

export default function PublicDeletionPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const { token = '' } = useParams();
  const path = `public/recruiting/deletion/${encodeURIComponent(token)}`;
  const view = useRemote<DeletionView>(path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.request({ path, method: 'POST', json: {} });
      view.reload();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  const data = view.data;
  return (
    <main className='mx-auto w-full max-w-xl space-y-4 px-4 py-8'>
      {view.error ? (
        <p className='text-sm text-muted-foreground'>{failure(view.error)}</p>
      ) : !data ? (
        <Skeleton className='h-40 w-full' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('recruiting.public.deletionTitle')}</CardTitle>
            <CardDescription>
              {t('recruiting.public.deletionDescription', {
                company: data.company,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {data.requestedAt ? (
              <p className='text-sm'>
                {t('recruiting.public.deletionSent', {
                  at: formatDateTime(data.requestedAt),
                })}
              </p>
            ) : (
              <Button
                className='w-full'
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? <Spinner data-icon='inline-start' /> : null}
                {t('recruiting.public.deletionSubmit')}
              </Button>
            )}
            {error ? <p className='text-sm text-destructive'>{error}</p> : null}
          </CardContent>
        </Card>
      )}
    </main>
  );
}

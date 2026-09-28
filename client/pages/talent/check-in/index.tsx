import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { CheckCircle2Icon, QrCodeIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

/**
 * Route `/talent/check-in?code=…` — opened by scanning a session's QR code.
 * The learner confirms; the server checks the enrollment, the time window and
 * the code's age, and records its own time.
 */
export default function CheckInPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const [params] = useSearchParams();
  const code = params.get('code') ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ title: string; checkedInAt: string }>();

  async function checkIn(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.request<{
        data: { title: string; checkedInAt: string };
      }>({ path: 'talent/check-in', method: 'POST', json: { code } });
      setDone(result.data);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer className='mx-auto max-w-lg'>
      <PageHeader title={t('navigation.talentCheckIn')} />
      <Card>
        <CardContent className='space-y-4 text-center'>
          {done ? (
            <>
              <CheckCircle2Icon className='mx-auto size-12 text-primary' />
              <p className='font-heading text-lg font-semibold'>
                {t('talent.checkIn.done')}
              </p>
              <p className='text-sm text-muted-foreground'>
                {t('talent.checkIn.doneDetail', {
                  title: done.title,
                  time: new Intl.DateTimeFormat(locale, {
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(done.checkedInAt)),
                })}
              </p>
              <Button variant='outline' render={<Link to='/talent/learning' />}>
                {t('navigation.talentMyLearning')}
              </Button>
            </>
          ) : code ? (
            <>
              <QrCodeIcon className='mx-auto size-12 text-muted-foreground' />
              <p className='text-sm text-muted-foreground'>
                {t('talent.checkIn.confirmHint')}
              </p>
              {error ? (
                <Alert variant='destructive'>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                className='w-full'
                size='lg'
                disabled={busy}
                onClick={() => void checkIn()}
              >
                {busy ? <Spinner data-icon='inline-start' /> : null}
                {t('talent.checkIn.confirm')}
              </Button>
            </>
          ) : (
            <>
              <QrCodeIcon className='mx-auto size-12 text-muted-foreground' />
              <p className='text-sm text-muted-foreground'>
                {t('talent.checkIn.scanHint')}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

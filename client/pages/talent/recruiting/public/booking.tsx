/**
 * （公开）自助约面 `/jobs/booking/:token`: the candidate's own interview time,
 * picked, rescheduled or cancelled once, from the link in their email.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { useRecruitingError } from '@/components/talent/recruiting-lib';
import type { BookingView } from '@/components/talent/recruiting-types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export default function PublicBookingPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const { token = '' } = useParams();
  const path = `public/recruiting/booking/${encodeURIComponent(token)}`;
  const booking = useRemote<BookingView>(path);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (sub: string, json: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api.request({ path: `${path}${sub}`, method: 'POST', json });
      setChanging(false);
      booking.reload();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  };
  const data = booking.data;
  return (
    <main className='mx-auto w-full max-w-xl space-y-4 px-4 py-8'>
      {booking.error ? (
        <p className='text-sm text-muted-foreground'>
          {failure(booking.error)}
        </p>
      ) : !data ? (
        <Skeleton className='h-32 w-full' />
      ) : (
        <>
          <h1 className='text-2xl font-semibold'>{data.title}</h1>
          {data.booked && !changing ? (
            <div className='space-y-3'>
              <p>
                {t('recruiting.public.booked', { time: data.booked.label })}
                {data.booked.location ? ` · ${data.booked.location}` : ''}
              </p>
              {data.booked.canChange ? (
                <div className='flex gap-2'>
                  <Button variant='outline' onClick={() => setChanging(true)}>
                    {t('recruiting.public.change')}
                  </Button>
                  <Button
                    variant='ghost'
                    disabled={busy}
                    onClick={() => void act('/change', { cancel: true })}
                  >
                    {t('recruiting.public.cancelBooking')}
                  </Button>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('recruiting.public.changeUsed')}
                </p>
              )}
            </div>
          ) : (
            <div className='space-y-2'>
              <p className='text-sm font-medium'>
                {t('recruiting.public.pickSlot')}
              </p>
              {data.slots.length ? (
                data.slots.map((s) => (
                  <Button
                    key={s.start}
                    variant='outline'
                    className='w-full'
                    disabled={busy}
                    onClick={() =>
                      void (changing
                        ? act('/change', { start: s.start })
                        : act('', { start: s.start }))
                    }
                  >
                    {s.label}
                    {s.location ? ` · ${s.location}` : ''}
                  </Button>
                ))
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('recruiting.public.noSlots')}
                </p>
              )}
            </div>
          )}
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
        </>
      )}
    </main>
  );
}

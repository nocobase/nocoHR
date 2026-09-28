import { resolveAppUrl, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import QRCode from 'qrcode';
import { useEffect, useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { TrainingSession } from '@/components/talent/training-types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

/** The screen shows a new code this often; the server accepts one for 30 seconds. */
const REFRESH_MS = 30_000;

/**
 * The check-in QR code, full screen: it encodes the check-in page with a code
 * the server signed, and is replaced every 30 seconds, so a photo of it stops
 * working. Scanning opens the check-in page on the learner's phone.
 */
export function CheckInCodeDialog({
  session,
  open,
  onOpenChange,
  onClosed,
}: {
  session: TrainingSession;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [image, setImage] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [error, setError] = useState<string>();
  const [seconds, setSeconds] = useState(30);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let issuedAt = 0;
    async function refresh(): Promise<void> {
      try {
        const result = await api.request<{ data: { code: string } }>({
          path: `talent/sessions/${encodeURIComponent(session.id)}/check-in-code`,
        });
        const url = new URL(
          resolveAppUrl(
            `talent/check-in?code=${encodeURIComponent(result.data.code)}`,
          ),
          window.location.origin,
        ).href;
        const dataUrl = await QRCode.toDataURL(url, {
          margin: 1,
          width: 640,
          errorCorrectionLevel: 'M',
        });
        if (cancelled) return;
        issuedAt = Date.now();
        setLink(url);
        setImage(dataUrl);
        setError(undefined);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause, t));
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    const countdown = window.setInterval(() => {
      setSeconds(
        Math.max(0, Math.ceil((REFRESH_MS - (Date.now() - issuedAt)) / 1000)),
      );
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearInterval(countdown);
    };
  }, [api, open, session.id, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) onClosed();
      }}
    >
      <DialogContent className='flex h-svh max-h-svh w-full max-w-none flex-col rounded-none sm:max-w-none'>
        <DialogHeader className='text-center'>
          <DialogTitle className='text-2xl'>{session.title}</DialogTitle>
          <DialogDescription>
            {t('talent.sessions.scanToCheckIn')}
          </DialogDescription>
        </DialogHeader>
        <div className='flex min-h-0 flex-1 flex-col items-center justify-center gap-4'>
          {error ? (
            <p className='text-destructive'>{error}</p>
          ) : image ? (
            <img
              src={image}
              alt={t('talent.sessions.checkInCode')}
              className='aspect-square w-[min(80vw,60vh)] rounded-lg bg-white p-2'
            />
          ) : (
            <Spinner className='size-8' />
          )}
          <p className='text-sm text-muted-foreground tabular-nums'>
            {t('talent.sessions.refreshIn', { seconds })}
          </p>
          {link && import.meta.env.DEV ? (
            // Development only: open the check-in page without a phone.
            <a
              href={link}
              target='_blank'
              rel='noreferrer'
              className='text-xs text-muted-foreground underline'
            >
              {t('talent.sessions.devOpenLink')}
            </a>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

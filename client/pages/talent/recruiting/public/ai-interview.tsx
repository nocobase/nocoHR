/**
 * （公开）AI 初面 `/jobs/ai-interview/:token`: consent first (or a human
 * interview instead), then the confirmed questions one at a time as a text
 * chat (voice input on a phone works through the keyboard). No video, no
 * analysis of voice or face. Usable at 375px.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { useRecruitingError } from '@/components/talent/recruiting-lib';
import type { AiInterviewView } from '@/components/talent/recruiting-types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

export default function PublicAiInterviewPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const { token = '' } = useParams();
  const path = `public/recruiting/ai-interview/${encodeURIComponent(token)}`;
  const view = useRemote<AiInterviewView>(path);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = async (sub: string, json: unknown) => {
    setBusy(true);
    setError(null);
    try {
      await api.request({ path: `${path}${sub}`, method: 'POST', json });
      setText('');
      view.reload();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  };
  const data = view.data;
  return (
    <main className='mx-auto w-full max-w-xl space-y-4 px-4 py-8'>
      {view.error ? (
        <p className='text-sm text-muted-foreground'>{failure(view.error)}</p>
      ) : !data ? (
        <Skeleton className='h-40 w-full' />
      ) : (
        <>
          <h1 className='text-2xl font-semibold'>
            {t('recruiting.public.aiTitle')} · {data.title}
          </h1>
          {data.declined ? (
            <p className='text-sm'>{t('recruiting.public.aiDeclined')}</p>
          ) : !data.consentAt ? (
            <div className='space-y-3'>
              <p className='text-sm text-muted-foreground'>
                {t('recruiting.public.aiIntro', { minutes: data.minutes })}
              </p>
              <Button
                className='w-full'
                disabled={busy}
                onClick={() => void post('/consent', { accept: true })}
              >
                {t('recruiting.public.aiConsent')}
              </Button>
              <Button
                className='w-full'
                variant='outline'
                disabled={busy}
                onClick={() => void post('/consent', { accept: false })}
              >
                {t('recruiting.public.aiDecline')}
              </Button>
            </div>
          ) : (
            <div className='space-y-3' aria-live='polite'>
              {data.transcript.map((turn) => (
                <p
                  key={`${turn.role}:${turn.at}`}
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${turn.role === 'candidate' ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'}`}
                >
                  {turn.text}
                </p>
              ))}
              {data.finished ? (
                <p className='text-sm'>{t('recruiting.public.aiFinished')}</p>
              ) : (
                <form
                  className='space-y-2'
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (text.trim()) void post('/turn', { text });
                  }}
                >
                  <Textarea
                    aria-label={t('recruiting.public.aiAnswer')}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <Button
                    type='submit'
                    className='w-full'
                    disabled={busy || !text.trim()}
                  >
                    {t('recruiting.public.aiSend')}
                  </Button>
                </form>
              )}
            </div>
          )}
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
        </>
      )}
    </main>
  );
}

/**
 * （公开）职位与对话式投递 `/jobs/:slug`: the knockout questions one by one
 * (buttons or a short answer — a fixed flow, no model), then name, contact,
 * the resume and consent (with what it is used for, how long it is kept and
 * how to delete it), added fields marked for the careers page, and — for a
 * self-booking posting — the interview time. Usable at 375px.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { errorCode, errorDetails } from '@/components/talent/errors';
import { useRecruitingError } from '@/components/talent/recruiting-lib';
import type {
  ApplyResult,
  PublicJob,
} from '@/components/talent/recruiting-types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

export default function PublicJobPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const { slug = '' } = useParams();
  const job = useRemote<PublicJob>(
    `public/recruiting/jobs/${encodeURIComponent(slug)}`,
  );
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [draftAnswer, setDraftAnswer] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [challenge, setChallenge] = useState<{
    id: string;
    question: string;
  } | null>(null);
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const data = job.data;
  if (job.error)
    return (
      <main className='mx-auto max-w-xl px-4 py-10 text-sm text-muted-foreground'>
        {failure(job.error)}
      </main>
    );
  if (!data)
    return (
      <main className='mx-auto max-w-xl px-4 py-10'>
        <Skeleton className='h-40 w-full' />
      </main>
    );
  const questions = data.questions;
  const current = questions.find((q) => answers[q.key] === undefined);
  const answer = (key: string, value: string) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setDraftAnswer('');
  };
  async function submit() {
    if (!file) return;
    const body = new FormData();
    body.set('name', form.name);
    body.set('phone', form.phone);
    body.set('email', form.email);
    body.set('consent', String(consent));
    body.set('answers', JSON.stringify(answers));
    body.set('customFields', JSON.stringify(custom));
    if (challenge) {
      body.set('challengeId', challenge.id);
      body.set('challengeAnswer', challengeAnswer);
    }
    body.set('file', file);
    setBusy(true);
    setError(null);
    try {
      const { data: done } = await api.request<{ data: ApplyResult }>({
        path: `public/recruiting/jobs/${encodeURIComponent(slug)}/apply`,
        method: 'POST',
        body,
      });
      setResult(done);
      setChallenge(null);
    } catch (cause) {
      if (errorCode(cause) === 'PUBLIC_VERIFY_REQUIRED') {
        const details = errorDetails(cause) as {
          challengeId: string;
          question: string;
        };
        setChallenge({ id: details.challengeId, question: details.question });
      } else setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  async function book(start: string) {
    setBusy(true);
    setError(null);
    try {
      if (!result?.bookingToken) return;
      const { data: done } = await api.request<{ data: { label: string } }>({
        path: `public/recruiting/booking/${encodeURIComponent(result.bookingToken)}`,
        method: 'POST',
        json: { start },
      });
      setBooked(done.label);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  const bubble = (text: string, mine = false) => (
    <p
      className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${mine ? 'ml-auto bg-primary text-primary-foreground' : 'bg-muted'}`}
    >
      {text}
    </p>
  );
  return (
    <main className='mx-auto w-full max-w-xl space-y-4 px-4 py-8'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold'>{data.title}</h1>
        <p className='text-sm text-muted-foreground'>{data.location}</p>
      </header>
      {!started ? (
        <section className='space-y-3'>
          <p className='whitespace-pre-wrap text-sm'>{data.description}</p>
          <div>
            <p className='text-sm font-medium'>
              {t('recruiting.public.requirements')}
            </p>
            <ul className='list-disc pl-5 text-sm'>
              {data.requirements.map((r) => (
                <li key={r.text}>{r.text}</li>
              ))}
            </ul>
          </div>
          <Button className='w-full' onClick={() => setStarted(true)}>
            {t('recruiting.public.start')}
          </Button>
        </section>
      ) : result ? (
        <section className='space-y-3'>
          {bubble(
            result.merged
              ? t('recruiting.public.merged')
              : t('recruiting.public.submitted'),
          )}
          {result.bookingToken && !booked ? (
            <div className='space-y-2'>
              <p className='text-sm font-medium'>
                {t('recruiting.public.pickSlot')}
              </p>
              {result.slots.length ? (
                result.slots.map((s) => (
                  <Button
                    key={s.start}
                    variant='outline'
                    className='w-full'
                    disabled={busy}
                    onClick={() => void book(s.start)}
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
          ) : null}
          {booked
            ? bubble(t('recruiting.public.booked', { time: booked }))
            : null}
          {error ? <p className='text-sm text-destructive'>{error}</p> : null}
        </section>
      ) : (
        <section className='space-y-3' aria-live='polite'>
          {bubble(t('recruiting.public.greeting'))}
          {questions
            .filter((q) => answers[q.key] !== undefined)
            .map((q) => (
              <div key={q.key} className='space-y-2'>
                {bubble(q.question)}
                {bubble(
                  q.answerType === 'yesNo'
                    ? answers[q.key] === 'yes'
                      ? t('recruiting.common.yes')
                      : t('recruiting.common.no')
                    : answers[q.key],
                  true,
                )}
              </div>
            ))}
          {current ? (
            <div className='space-y-2'>
              {bubble(current.question)}
              {current.answerType === 'yesNo' ? (
                <div className='flex gap-2'>
                  <Button
                    className='flex-1'
                    onClick={() => answer(current.key, 'yes')}
                  >
                    {t('recruiting.common.yes')}
                  </Button>
                  <Button
                    className='flex-1'
                    variant='outline'
                    onClick={() => answer(current.key, 'no')}
                  >
                    {t('recruiting.common.no')}
                  </Button>
                </div>
              ) : current.answerType === 'choice' ? (
                <div className='flex flex-wrap gap-2'>
                  {current.options.map((o) => (
                    <Button
                      key={o}
                      variant='outline'
                      onClick={() => answer(current.key, o)}
                    >
                      {o}
                    </Button>
                  ))}
                </div>
              ) : (
                <form
                  className='flex gap-2'
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (draftAnswer.trim())
                      answer(current.key, draftAnswer.trim());
                  }}
                >
                  <Input
                    aria-label={current.question}
                    value={draftAnswer}
                    onChange={(e) => setDraftAnswer(e.target.value)}
                  />
                  <Button type='submit'>
                    {t('recruiting.common.confirm')}
                  </Button>
                </form>
              )}
            </div>
          ) : (
            <form
              className='space-y-3'
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {bubble(t('recruiting.public.formIntro'))}
              <Field>
                <FieldLabel htmlFor='ap-name'>
                  {t('recruiting.public.name')}
                </FieldLabel>
                <Input
                  id='ap-name'
                  required
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='ap-phone'>
                  {t('recruiting.public.phone')}
                </FieldLabel>
                <Input
                  id='ap-phone'
                  type='tel'
                  inputMode='tel'
                  value={form.phone}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, phone: e.target.value }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='ap-email'>
                  {t('recruiting.public.email')}
                </FieldLabel>
                <Input
                  id='ap-email'
                  type='email'
                  value={form.email}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, email: e.target.value }))
                  }
                />
              </Field>
              {data.fields.map((f) => (
                <Field key={f.key}>
                  <FieldLabel htmlFor={`ap-cf-${f.key}`}>
                    {f.label?.['zh-CN'] ?? f.key}
                  </FieldLabel>
                  <Input
                    id={`ap-cf-${f.key}`}
                    type={
                      f.type === 'date'
                        ? 'date'
                        : f.type === 'number'
                          ? 'number'
                          : 'text'
                    }
                    required={f.required}
                    value={custom[f.key] ?? ''}
                    onChange={(e) =>
                      setCustom((c) => ({ ...c, [f.key]: e.target.value }))
                    }
                  />
                </Field>
              ))}
              <Field>
                <FieldLabel htmlFor='ap-file'>
                  {t('recruiting.public.resume', { mb: data.maxResumeMb })}
                </FieldLabel>
                <Input
                  id='ap-file'
                  type='file'
                  accept='.pdf,.doc,.docx'
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </Field>
              <p className='text-xs text-muted-foreground'>
                {data.consentText}
              </p>
              <label className='flex items-start gap-2 text-sm'>
                <Checkbox
                  checked={consent}
                  onCheckedChange={(checked) => setConsent(Boolean(checked))}
                />
                {t('recruiting.public.consent')}
              </label>
              {challenge ? (
                <Field>
                  <FieldLabel htmlFor='ap-challenge'>
                    {t('recruiting.public.verify', {
                      question: challenge.question,
                    })}
                  </FieldLabel>
                  <Input
                    id='ap-challenge'
                    inputMode='numeric'
                    value={challengeAnswer}
                    onChange={(e) => setChallengeAnswer(e.target.value)}
                  />
                </Field>
              ) : null}
              {error ? (
                <p className='text-sm text-destructive'>{error}</p>
              ) : null}
              <Button
                type='submit'
                className='w-full'
                disabled={
                  busy || !consent || !file || (!form.phone && !form.email)
                }
              >
                {t('recruiting.public.apply')}
              </Button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}

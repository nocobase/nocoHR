/**
 * V4-13 开始考核 / 实操记录 (`/talent/practicals/records/:recordId`), built for
 * the phone: the assessor notes what they see (typed or dictated), takes
 * photos, asks the examiner to structure the notes (each item then shows the
 * suggestion and the quoted notes; an unrecorded item is never suggested as
 * passed), confirms every item and signs. The witness signs in their own
 * account; hr.admin voids a signed record with a reason. `passed` is the
 * server's.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CameraIcon, MicIcon, SparklesIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Textarea } from '@/components/ui/textarea';

import type { Template } from './index.js';

interface PracticalRecord {
  id: string;
  status: string;
  passed: boolean;
  observationNotes: string;
  location: string | null;
  results: { key: string; passed: boolean; note: string }[];
  aiStructured: {
    items: { key: string; suggestion: 'pass' | 'fail' | 'notRecorded'; quotes: string[] }[];
    source: string;
  } | null;
  assessment: Template;
  employeeName: string;
  assessorName: string;
  witnessName: string | null;
  voidReason: string | null;
  files: { id: string; filename: string }[];
  can: { edit: boolean; sign: boolean; witness: boolean; void: boolean };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
}

function speechRecognition(): (new () => SpeechRecognitionLike) | undefined {
  const w = globalThis as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export default function PracticalRecordPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { recordId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/practicals/records/${encodeURIComponent(recordId)}`;
  const record = useRemote<PracticalRecord>(path);
  const action = useTrAction();
  const [notes, setNotes] = useState<string | null>(null);
  const [results, setResults] = useState<PracticalRecord['results'] | null>(null);
  const [reason, setReason] = useState('');
  const [listening, setListening] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const data = record.data;
  const reload = () => {
    setNotes(null);
    setResults(null);
    record.reload();
    outlet?.reload?.();
  };
  if (record.error)
    return (
      <RouteChildPage>
        <PageContainer>
          <Breadcrumbs />
          <LoadError error={record.error} onRetry={record.reload} />
        </PageContainer>
      </RouteChildPage>
    );
  if (!data)
    return (
      <RouteChildPage>
        <PageContainer>
          <BlockSkeleton rows={6} />
        </PageContainer>
      </RouteChildPage>
    );
  const currentResults = results ?? data.results;
  const resultOf = (key: string) => currentResults.find((r) => r.key === key);
  const setResult = (key: string, patch: Partial<{ passed: boolean; note: string }>) =>
    setResults(() => {
      const list = [...currentResults];
      const index = list.findIndex((r) => r.key === key);
      const next = { key, passed: patch.passed ?? list[index]?.passed ?? false, note: patch.note ?? list[index]?.note ?? '' };
      if (index >= 0) list[index] = next;
      else list.push(next);
      return list;
    });
  const saveDraft = () =>
    action.run({
      method: 'PATCH',
      path,
      json: {
        ...(notes !== null ? { observationNotes: notes } : {}),
        ...(results !== null ? { results } : {}),
      },
    });
  const Recognition = speechRecognition();
  const complete = data.assessment.checklist.every((c) => resultOf(c.key));
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        <PageHeader
          title={t('talentReview.record.title', { name: data.employeeName })}
          description={t('talentReview.record.description', {
            title: data.assessment.title,
            assessor: data.assessorName,
            witness: data.witnessName ?? '—',
          })}
          actions={
            <div className='flex items-center gap-2'>
              <TrStatusBadge status={data.status} />
              {data.status !== 'draft' ? (
                <Badge variant={data.passed ? 'default' : 'destructive'}>
                  {data.passed ? t('talentReview.practicals.passed') : t('talentReview.practicals.failed')}
                </Badge>
              ) : null}
            </div>
          }
        />
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        {data.voidReason ? (
          <Alert variant='destructive'>
            <AlertDescription>{t('talentReview.record.voided', { reason: data.voidReason })}</AlertDescription>
          </Alert>
        ) : null}
        <Card>
          <CardHeader className='flex flex-row items-center justify-between gap-2'>
            <CardTitle>{t('talentReview.record.notes')}</CardTitle>
            {data.can.edit ? (
              <div className='flex gap-2'>
                {Recognition ? (
                  <Button
                    size='sm'
                    variant='outline'
                    aria-pressed={listening}
                    onClick={() => {
                      const recognition = new Recognition();
                      recognition.lang = 'zh-CN';
                      recognition.interimResults = false;
                      recognition.onresult = (event) => {
                        const said = Array.from(event.results)
                          .map((r) => r[0]?.transcript ?? '')
                          .join('');
                        setNotes((n) => `${n ?? data.observationNotes}${n || data.observationNotes ? '\n' : ''}${said}`);
                      };
                      recognition.onend = () => setListening(false);
                      setListening(true);
                      recognition.start();
                    }}
                  >
                    <MicIcon data-icon='inline-start' />
                    {listening ? t('talentReview.record.listening') : t('talentReview.record.dictate')}
                  </Button>
                ) : null}
                <Button size='sm' variant='outline' onClick={() => photoRef.current?.click()}>
                  <CameraIcon data-icon='inline-start' />
                  {t('talentReview.record.photo')}
                </Button>
                <input
                  ref={photoRef}
                  type='file'
                  accept='image/*,video/*'
                  capture='environment'
                  className='hidden'
                  aria-label={t('talentReview.record.photo')}
                  onChange={(e) => { void (async () => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const body = new FormData();
                    body.append('file', file);
                    await api
                      .request({ method: 'POST', path: `${path}/attachments`, body })
                      .catch(() => undefined);
                    e.target.value = '';
                    record.reload();
                  })(); }}
                />
              </div>
            ) : null}
          </CardHeader>
          <CardContent className='flex flex-col gap-2'>
            <Textarea
              aria-label={t('talentReview.record.notes')}
              rows={5}
              disabled={!data.can.edit}
              value={notes ?? data.observationNotes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('talentReview.record.notesPlaceholder')}
            />
            {data.files.length ? (
              <p className='text-muted-foreground text-xs'>
                {t('talentReview.record.files', { list: data.files.map((f) => f.filename).join('、') })}
              </p>
            ) : null}
            {data.can.edit ? (
              <Button
                variant='outline'
                disabled={action.busy || !(notes ?? data.observationNotes).trim()}
                onClick={() => { void (async () => {
                  if (notes !== null || results !== null) await saveDraft();
                  const done = await action.run<{ restructured: boolean }>(
                    { method: 'POST', path: `${path}/structure` },
                  );
                  if (done) reload();
                })(); }}
              >
                <SparklesIcon data-icon='inline-start' />
                {t('talentReview.record.structure')}
              </Button>
            ) : null}
          </CardContent>
        </Card>
        <div className='flex flex-col gap-2'>
          {data.assessment.checklist.map((item) => {
            const suggestion = data.aiStructured?.items.find((i) => i.key === item.key);
            const result = resultOf(item.key);
            return (
              <Card key={item.key}>
                <CardContent className='flex flex-col gap-2 pt-4 text-sm'>
                  <div className='flex items-start justify-between gap-2'>
                    <span className='font-medium'>
                      {item.item}
                      {item.critical ? (
                        <Badge variant='destructive' className='ms-2'>
                          {t('talentReview.practicals.critical')}
                        </Badge>
                      ) : null}
                    </span>
                    <ToggleGroup
                      value={result ? [result.passed ? 'pass' : 'fail'] : []}
                      onValueChange={(value: string[]) => {
                        const last = value.at(-1);
                        if (last) setResult(item.key, { passed: last === 'pass' });
                      }}
                      disabled={!data.can.edit}
                      aria-label={t('talentReview.record.resultFor', { item: item.item })}
                    >
                      <ToggleGroupItem value='pass'>{t('talentReview.record.pass')}</ToggleGroupItem>
                      <ToggleGroupItem value='fail'>{t('talentReview.record.fail')}</ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                  {suggestion ? (
                    <div className='bg-muted/40 rounded-md p-2 text-xs'>
                      <span className='font-medium'>
                        {t('talentReview.record.suggestion', {
                          value: t(`talentReview.record.suggestionValue.${suggestion.suggestion}`),
                        })}
                      </span>
                      {suggestion.quotes.map((q) => (
                        <blockquote key={q} className='text-muted-foreground border-s-2 ps-2'>
                          {q}
                        </blockquote>
                      ))}
                    </div>
                  ) : null}
                  {data.can.edit ? (
                    <Input
                      aria-label={t('talentReview.record.itemNote', { item: item.item })}
                      placeholder={t('talentReview.record.itemNotePlaceholder')}
                      value={result?.note ?? ''}
                      onChange={(e) => setResult(item.key, { note: e.target.value })}
                    />
                  ) : result?.note ? (
                    <span className='text-muted-foreground'>{result.note}</span>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <div className='flex flex-wrap justify-end gap-2'>
          {data.can.edit ? (
            <Button
              variant='outline'
              disabled={action.busy || (notes === null && results === null)}
              onClick={() => { void (async () => {
                if (await saveDraft()) reload();
              })(); }}
            >
              {t('talentReview.common.save')}
            </Button>
          ) : null}
          {data.can.sign ? (
            <Button
              disabled={action.busy || !complete}
              onClick={() => { void (async () => {
                if (notes !== null || results !== null) {
                  if (!(await saveDraft())) return;
                }
                const done = await action.run({ method: 'POST', path: `${path}/sign` }, t('talentReview.record.signed'));
                if (done) reload();
              })(); }}
            >
              {t('talentReview.record.sign')}
            </Button>
          ) : null}
          {data.can.witness ? (
            <Button
              disabled={action.busy}
              onClick={() => { void (async () => {
                const done = await action.run({ method: 'POST', path: `${path}/witness` }, t('talentReview.record.witnessed'));
                if (done) reload();
              })(); }}
            >
              {t('talentReview.record.witnessSign')}
            </Button>
          ) : null}
        </div>
        {data.can.void && data.status !== 'draft' ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('talentReview.record.void')}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-2 sm:flex-row'>
              <Input
                aria-label={t('talentReview.record.voidReason')}
                placeholder={t('talentReview.record.voidReason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant='destructive'
                disabled={action.busy || !reason.trim()}
                onClick={() => { void (async () => {
                  const done = await action.run({ method: 'POST', path: `${path}/void`, json: { reason } }, t('talentReview.record.voidDone'));
                  if (done) reload();
                })(); }}
              >
                {t('talentReview.record.void')}
              </Button>
            </CardContent>
          </Card>
        ) : null}
      </PageContainer>
    </RouteChildPage>
  );
}

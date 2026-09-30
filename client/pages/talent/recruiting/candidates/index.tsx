/**
 * V2-07 招聘 / 候选人 (`talent.candidates`): the applications of the
 * requisitions the viewer recruits for or manages, as a board by stage or a
 * list, the read-only talent pool, and the resume import. A candidate opens
 * as a child page.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useRecruitingError } from '@/components/talent/recruiting-lib';
import { MatchBadge, StatusBadge } from '@/components/talent/recruiting-shared';
import type {
  ApplicationListItem,
  ParsedProfile,
  Posting,
} from '@/components/talent/recruiting-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

const BOARD = [
  'applied',
  'screening',
  'interview',
  'offer',
  'hired',
  'rejected',
] as const;

export default function CandidatesPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const list = useRemote<{
    items: ApplicationListItem[];
    can: { import: boolean; pool: boolean };
  }>('talent/recruiting/candidates', search ? { search } : undefined);
  const [importing, setImporting] = useState(false);
  const tab = ['board', 'list', 'pool'].includes(params.get('tab') ?? '')
    ? String(params.get('tab'))
    : 'board';
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('recruiting.candidates.title')}
          description={t('recruiting.candidates.description')}
          actions={
            list.data?.can.import ? (
              <Button variant='outline' onClick={() => setImporting((v) => !v)}>
                {t('recruiting.candidates.import')}
              </Button>
            ) : null
          }
        />
        {importing ? (
          <ImportCard
            onDone={() => {
              setImporting(false);
              list.reload();
            }}
          />
        ) : null}
        <Input
          className='max-w-xs'
          placeholder={t('recruiting.common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('tab', String(value));
            setParams(next, { replace: true });
          }}
        >
          <TabsList>
            <TabsTrigger value='board'>
              {t('recruiting.candidates.board')}
            </TabsTrigger>
            <TabsTrigger value='list'>
              {t('recruiting.candidates.list')}
            </TabsTrigger>
            {list.data?.can.pool ? (
              <TabsTrigger value='pool'>
                {t('recruiting.candidates.pool')}
              </TabsTrigger>
            ) : null}
          </TabsList>
          <TabsContent value='board' className='pt-4'>
            {list.error ? (
              <LoadError error={list.error} onRetry={list.reload} />
            ) : !list.data ? (
              <BlockSkeleton rows={4} />
            ) : !list.data.items.length ? (
              <EmptyState title={t('recruiting.candidates.empty')} />
            ) : (
              <div className='grid gap-3 md:grid-cols-3 xl:grid-cols-6'>
                {BOARD.map((stage) => (
                  <div
                    key={stage}
                    className='space-y-2 rounded-lg bg-muted/40 p-2'
                  >
                    <p className='text-sm font-medium'>
                      {t(`recruiting.status.stage.${stage}`)}{' '}
                      <span className='text-muted-foreground'>
                        {
                          list.data!.items.filter((i) => i.stage === stage)
                            .length
                        }
                      </span>
                    </p>
                    {list
                      .data!.items.filter((i) => i.stage === stage)
                      .map((i) => (
                        <Link
                          key={i.id}
                          to={i.id}
                          className='block rounded-md border bg-card p-2 text-sm hover:bg-accent'
                        >
                          <span className='font-medium'>{i.name}</span>
                          <span className='mt-1 flex flex-wrap gap-1'>
                            <MatchBadge level={i.matchLevel} />
                            {i.knockoutUnmet ? (
                              <Badge variant='destructive'>
                                {t('recruiting.candidates.knockoutUnmet')}
                              </Badge>
                            ) : null}
                          </span>
                          <span className='mt-1 block text-xs text-muted-foreground'>
                            {i.postingTitle}
                          </span>
                        </Link>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
          <TabsContent value='list' className='pt-4'>
            {!list.data ? (
              <BlockSkeleton rows={4} />
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('recruiting.public.name')}</TableHead>
                      <TableHead>
                        {t('recruiting.candidates.posting')}
                      </TableHead>
                      <TableHead>
                        {t('recruiting.candidates.suggestion')}
                      </TableHead>
                      <TableHead>
                        {t('recruiting.candidates.channel')}
                      </TableHead>
                      <TableHead>{t('recruiting.common.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data.items.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <Link
                            className='underline-offset-4 hover:underline'
                            to={i.id}
                          >
                            {i.name}
                          </Link>
                          {i.knockoutUnmet ? (
                            <Badge className='ml-2' variant='destructive'>
                              {t('recruiting.candidates.knockoutUnmet')}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{i.postingTitle}</TableCell>
                        <TableCell>
                          <MatchBadge level={i.matchLevel} />
                        </TableCell>
                        <TableCell>
                          {t(`recruiting.labels.source.${i.sourceChannel}`, {
                            defaultValue: i.sourceChannel,
                          })}
                        </TableCell>
                        <TableCell>
                          <StatusBadge kind='stage' value={i.stage} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
          <TabsContent value='pool' className='pt-4'>
            {tab === 'pool' ? <PoolTab /> : null}
          </TabsContent>
        </Tabs>
      </PageContainer>
      <Outlet context={{ reload: list.reload }} />
    </>
  );
}

function ImportCard({ onDone }: { onDone: () => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const postings = useRemote<{ items: Posting[] }>(
    'talent/recruiting/postings',
    { status: 'published' },
  );
  const [postingId, setPostingId] = useState('');
  const [channel, setChannel] = useState('');
  const [consent, setConsent] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const manageable = (postings.data?.items ?? []).filter((p) => p.can?.manage);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.candidates.importTitle')}</CardTitle>
        <CardDescription>
          {t('recruiting.candidates.importHint')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='grid gap-3 sm:grid-cols-2'
          onSubmit={(event) => {
            void (async () => {
              event.preventDefault();
              if (!files?.length) return;
              const body = new FormData();
              body.set('postingId', postingId);
              body.set('sourceChannel', channel || 'import');
              body.set('consentConfirmed', String(consent));
              for (const file of Array.from(files)) body.append('files', file);
              setBusy(true);
              try {
                const { data } = await api.request<{
                  data: { results: { status: string }[] };
                }>({
                  path: 'talent/recruiting/candidates/import',
                  method: 'POST',
                  body,
                });
                const count = (s: string) =>
                  data.results.filter((r) => r.status === s).length;
                toast.add({
                  type: 'success',
                  title: t('recruiting.candidates.imported', {
                    created: count('created') + count('merged'),
                    merged: count('duplicate') + count('merged'),
                    failed: count('failed'),
                  }),
                });
                onDone();
              } catch (error) {
                toast.add({ type: 'error', title: failure(error) });
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          <Field>
            <FieldLabel htmlFor='im-posting'>
              {t('recruiting.candidates.posting')}
            </FieldLabel>
            <NativeSelect
              id='im-posting'
              required
              value={postingId}
              onChange={(e) => setPostingId(e.target.value)}
            >
              <NativeSelectOption value=''>—</NativeSelectOption>
              {manageable.map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='im-channel'>
              {t('recruiting.candidates.channel')}
            </FieldLabel>
            <Input
              id='im-channel'
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            />
          </Field>
          <Field className='sm:col-span-2'>
            <Input
              type='file'
              multiple
              accept='.pdf,.doc,.docx,.txt'
              aria-label={t('recruiting.candidates.resume')}
              onChange={(e) => setFiles(e.target.files)}
            />
          </Field>
          <label className='flex items-center gap-2 text-sm sm:col-span-2'>
            <Checkbox
              checked={consent}
              onCheckedChange={(checked) => setConsent(Boolean(checked))}
            />
            {t('recruiting.candidates.consentConfirmed')}
          </label>
          <div className='sm:col-span-2'>
            <Button
              type='submit'
              disabled={busy || !consent || !postingId || !files?.length}
            >
              {t('recruiting.candidates.import')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PoolTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = useRecruitingError();
  const pool = useRemote<{
    items: { id: string; name: string; profile: ParsedProfile | null }[];
  }>('talent/recruiting/candidates/pool');
  const postings = useRemote<{ items: Posting[] }>(
    'talent/recruiting/postings',
    { status: 'published' },
  );
  const [target, setTarget] = useState('');
  if (pool.error) return <LoadError error={pool.error} onRetry={pool.reload} />;
  if (!pool.data) return <BlockSkeleton rows={4} />;
  const manageable = (postings.data?.items ?? []).filter((p) => p.can?.manage);
  return (
    <div className='space-y-3'>
      <p className='text-sm text-muted-foreground'>
        {t('recruiting.candidates.poolHint')}
      </p>
      <NativeSelect
        aria-label={t('recruiting.candidates.posting')}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      >
        <NativeSelectOption value=''>—</NativeSelectOption>
        {manageable.map((p) => (
          <NativeSelectOption key={p.id} value={p.id}>
            {p.title}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <ul className='divide-y rounded-lg border'>
        {pool.data.items.map((c) => (
          <li
            key={c.id}
            className='flex flex-wrap items-center justify-between gap-2 p-3 text-sm'
          >
            <span>
              <span className='font-medium'>{c.name}</span>
              <span className='ml-2 text-muted-foreground'>
                {[
                  ...(c.profile?.skills ?? []),
                  ...(c.profile?.certificates ?? []),
                ]
                  .slice(0, 5)
                  .join('、')}
              </span>
            </span>
            <Button
              size='sm'
              variant='outline'
              disabled={!target}
              onClick={() => {
                void (async () => {
                  try {
                    await api.request({
                      path: `talent/recruiting/candidates/pool/${encodeURIComponent(c.id)}/add`,
                      method: 'POST',
                      json: { postingId: target },
                    });
                    toast.add({
                      type: 'success',
                      title: t('recruiting.common.saved'),
                    });
                  } catch (error) {
                    toast.add({ type: 'error', title: failure(error) });
                  }
                })();
              }}
            >
              {t('recruiting.candidates.addToPosting')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

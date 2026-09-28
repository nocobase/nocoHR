import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  CheckIcon,
  EyeOffIcon,
  RotateCcwIcon,
  SearchIcon,
  UploadIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { ParseStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import type {
  KbDocument,
  KnowledgeGap,
} from '@/components/talent/learning-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

import { DocumentDialog } from './document-dialog.js';
import { DOCUMENT_CATEGORIES } from './types.js';
import type { KnowledgeOutletContext } from './types.js';

interface DocumentList {
  readonly items: KbDocument[];
  readonly canCreate: boolean;
  readonly canViewGaps: boolean;
}

/** 知识库 — documents the viewer may read, uploads with background extraction, and knowledge gaps. */
export default function KnowledgePage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'gaps' ? 'gaps' : 'documents';
  const filters = {
    q: params.get('q') || undefined,
    category: params.get('category') || undefined,
    competencyId: params.get('competencyId') || undefined,
    parseStatus: params.get('parseStatus') || undefined,
  };
  const list = useRemote<DocumentList>('talent/kb/documents', filters);
  const [uploadOpen, setUploadOpen] = useState(false);
  const context = useMemo<KnowledgeOutletContext>(
    () => ({ reload: list.reload }),
    [list.reload],
  );
  const pending =
    list.data?.items.some((d) => d.parseStatus === 'pending') ?? false;

  // Extraction runs in the background; poll while any document is still being read.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(list.reload, 3000);
    return () => window.clearInterval(timer);
  }, [pending, list.reload]);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const competencyOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of list.data?.items ?? [])
      for (const c of d.competencies) map.set(c.id, c.title);
    return [...map.entries()];
  }, [list.data]);

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentKnowledge')}
        description={t('talent.knowledge.description')}
        actions={
          list.data?.canCreate ? (
            <Button onClick={() => setUploadOpen(true)}>
              <UploadIcon data-icon='inline-start' />
              {t('talent.knowledge.upload')}
            </Button>
          ) : null
        }
      />
      {list.data?.canViewGaps ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setFilter('tab', value === 'gaps' ? 'gaps' : '')
          }
        >
          <TabsList>
            <TabsTrigger value='documents'>
              {t('talent.knowledge.tabs.documents')}
            </TabsTrigger>
            <TabsTrigger value='gaps'>
              {t('talent.knowledge.tabs.gaps')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}

      {tab === 'gaps' && list.data?.canViewGaps ? (
        <GapsPanel documents={list.data.items} />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2'>
            <InputGroup className='w-full sm:w-64'>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                defaultValue={filters.q ?? ''}
                placeholder={t('talent.knowledge.searchPlaceholder')}
                aria-label={t('talent.knowledge.searchPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')
                    setFilter('q', e.currentTarget.value.trim());
                }}
                onBlur={(e) => setFilter('q', e.currentTarget.value.trim())}
              />
            </InputGroup>
            <NativeSelect
              value={filters.category ?? ''}
              onChange={(e) => setFilter('category', e.target.value)}
              aria-label={t('talent.knowledge.fields.category')}
            >
              <NativeSelectOption value=''>
                {t('talent.knowledge.allCategories')}
              </NativeSelectOption>
              {DOCUMENT_CATEGORIES.map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {t(`talent.docCategory.${c}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              value={filters.competencyId ?? ''}
              onChange={(e) => setFilter('competencyId', e.target.value)}
              aria-label={t('talent.knowledge.fields.competencies')}
            >
              <NativeSelectOption value=''>
                {t('talent.knowledge.allCompetencies')}
              </NativeSelectOption>
              {competencyOptions.map(([id, title]) => (
                <NativeSelectOption key={id} value={id}>
                  {title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <NativeSelect
              value={filters.parseStatus ?? ''}
              onChange={(e) => setFilter('parseStatus', e.target.value)}
              aria-label={t('talent.knowledge.fields.parseStatus')}
            >
              <NativeSelectOption value=''>
                {t('talent.knowledge.allParseStatuses')}
              </NativeSelectOption>
              {(['pending', 'ready', 'failed'] as const).map((s) => (
                <NativeSelectOption key={s} value={s}>
                  {t(`talent.parseStatus.${s}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {list.error ? (
            <LoadError error={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <BlockSkeleton rows={4} />
          ) : !list.data.items.length ? (
            <EmptyState
              title={t('talent.knowledge.empty')}
              description={t('talent.knowledge.emptyDescription')}
            />
          ) : (
            <DocumentTable items={list.data.items} onChanged={list.reload} />
          )}
        </>
      )}
      <DocumentDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        document={null}
        onSaved={() => list.reload()}
      />
      <Outlet context={context} />
    </PageContainer>
  );
}

function DocumentTable({
  items,
  onChanged,
}: {
  items: readonly KbDocument[];
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  async function retry(id: string): Promise<void> {
    try {
      await api.request({
        path: `talent/kb/documents/${encodeURIComponent(id)}/retry`,
        method: 'POST',
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talent.knowledge.fields.title')}</TableHead>
            <TableHead>{t('talent.knowledge.fields.category')}</TableHead>
            <TableHead className='hidden lg:table-cell'>
              {t('talent.knowledge.fields.competencies')}
            </TableHead>
            <TableHead className='hidden md:table-cell'>
              {t('talent.knowledge.fields.visibility')}
            </TableHead>
            <TableHead className='hidden md:table-cell'>
              {t('talent.knowledge.fields.owner')}
            </TableHead>
            <TableHead>{t('talent.knowledge.fields.parseStatus')}</TableHead>
            <TableHead className='hidden sm:table-cell'>
              {t('talent.knowledge.fields.updatedAt')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((doc) => (
            <TableRow
              key={doc.id}
              className={doc.active ? undefined : 'text-muted-foreground'}
            >
              <TableCell className='font-medium'>
                <Link
                  to={encodeURIComponent(doc.id)}
                  className='hover:underline'
                >
                  {doc.title}
                </Link>
                {!doc.active ? (
                  <Badge variant='outline' className='ml-2'>
                    {t('talent.common.disabled')}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{t(`talent.docCategory.${doc.category}`)}</TableCell>
              <TableCell className='hidden lg:table-cell'>
                <span className='flex flex-wrap gap-1'>
                  {doc.competencies.map((c) => (
                    <Badge key={c.id} variant='outline'>
                      {c.title}
                    </Badge>
                  ))}
                </span>
              </TableCell>
              <TableCell className='hidden md:table-cell'>
                {doc.visibility === 'all'
                  ? t('talent.visibility.all')
                  : [...doc.departments, ...doc.positions]
                      .map((x) => x.title)
                      .join('、') || t('talent.visibility.restricted')}
              </TableCell>
              <TableCell className='hidden md:table-cell'>
                {doc.ownerName ?? '—'}
              </TableCell>
              <TableCell>
                <span className='flex flex-wrap items-center gap-2'>
                  <ParseStatusBadge status={doc.parseStatus} />
                  {doc.parseStatus === 'failed' && doc.canManage ? (
                    <Button
                      size='xs'
                      variant='ghost'
                      onClick={() => void retry(doc.id)}
                    >
                      <RotateCcwIcon data-icon='inline-start' />
                      {t('talent.knowledge.retry')}
                    </Button>
                  ) : null}
                </span>
                {doc.parseStatus === 'failed' && doc.parseError ? (
                  <span className='mt-1 block max-w-64 text-xs text-destructive'>
                    {doc.parseError}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className='hidden text-muted-foreground tabular-nums sm:table-cell'>
                {format.format(new Date(doc.updatedAt))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function GapsPanel({
  documents,
}: {
  documents: readonly KbDocument[];
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const [status, setStatus] = useState('open');
  const gaps = useRemote<KnowledgeGap[]>('talent/kb/gaps', { status });
  const [resolving, setResolving] = useState<KnowledgeGap | null>(null);
  const [documentId, setDocumentId] = useState('');
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function decide(
    gap: KnowledgeGap,
    next: 'resolved' | 'ignored' | 'open',
    doc?: string,
  ): Promise<void> {
    try {
      await api.request({
        path: `talent/kb/gaps/${encodeURIComponent(gap.id)}`,
        method: 'POST',
        json: { status: next, documentId: doc || null },
      });
      toast.add({
        type: 'success',
        title: t(`talent.knowledge.gapDone.${next}`),
      });
      setResolving(null);
      gaps.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label={t('talent.fields.status')}
        >
          {(['open', 'resolved', 'ignored', 'all'] as const).map((s) => (
            <NativeSelectOption key={s} value={s}>
              {t(`talent.gapStatus.${s}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {gaps.error ? (
        <LoadError error={gaps.error} onRetry={gaps.reload} />
      ) : !gaps.data ? (
        <BlockSkeleton rows={3} />
      ) : !gaps.data.length ? (
        <EmptyState title={t('talent.knowledge.noGaps')} />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('talent.knowledge.gapFields.question')}
                </TableHead>
                <TableHead>{t('talent.knowledge.gapTopic')}</TableHead>
                <TableHead className='hidden sm:table-cell'>
                  {t('talent.knowledge.gapFields.lastAskedAt')}
                </TableHead>
                <TableHead className='hidden md:table-cell'>
                  {t('talent.knowledge.gapFields.askedBy')}
                </TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('talent.common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Questions the weekly report grouped under one topic sit together. */}
              {[...gaps.data]
                .sort((a, b) =>
                  (a.topic ?? '\uffff').localeCompare(b.topic ?? '\uffff'),
                )
                .map((gap) => (
                  <TableRow key={gap.id}>
                    <TableCell className='max-w-md whitespace-normal'>
                      {gap.question}
                      {gap.relatedDocumentTitle ? (
                        <span className='block text-xs text-muted-foreground'>
                          {t('talent.knowledge.gapRelated', {
                            title: gap.relatedDocumentTitle,
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='max-w-48 whitespace-normal'>
                      {gap.topic ?? (
                        <span className='text-muted-foreground'>
                          {t('talent.knowledge.noTopic')}
                        </span>
                      )}
                      {gap.reportedAt ? (
                        <span className='block text-xs text-muted-foreground'>
                          {t('talent.knowledge.gapReported', {
                            date: format.format(new Date(gap.reportedAt)),
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='hidden text-muted-foreground tabular-nums sm:table-cell'>
                      {format.format(new Date(gap.lastAskedAt))}
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {gap.askedByName ?? '—'}
                    </TableCell>
                    <TableCell>
                      {t(`talent.gapStatus.${gap.status}`)}
                      {gap.resolvedDocumentTitle ? (
                        <span className='block text-xs text-muted-foreground'>
                          {gap.resolvedDocumentTitle}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='text-right'>
                      {gap.status === 'open' ? (
                        <span className='inline-flex gap-1'>
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => {
                              setDocumentId('');
                              setResolving(gap);
                            }}
                          >
                            <CheckIcon data-icon='inline-start' />
                            {t('talent.knowledge.resolve')}
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => void decide(gap, 'ignored')}
                          >
                            <EyeOffIcon data-icon='inline-start' />
                            {t('talent.knowledge.ignore')}
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => void decide(gap, 'open')}
                        >
                          {t('talent.knowledge.reopen')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog
        open={Boolean(resolving)}
        onOpenChange={(open) => (!open ? setResolving(null) : undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('talent.knowledge.resolveTitle')}</DialogTitle>
            <DialogDescription>{resolving?.question}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='gap-document'>
              {t('talent.knowledge.resolveDocument')}
            </FieldLabel>
            <NativeSelect
              id='gap-document'
              className='w-full'
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.none')}
              </NativeSelectOption>
              {documents.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {d.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setResolving(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              onClick={() =>
                resolving && void decide(resolving, 'resolved', documentId)
              }
            >
              {t('talent.knowledge.resolve')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

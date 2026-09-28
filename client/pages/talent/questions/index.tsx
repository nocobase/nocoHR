import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  CheckIcon,
  DownloadIcon,
  FileUpIcon,
  PencilIcon,
  PlusIcon,
  PowerIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { ReviewStatusBadge } from '@/components/talent/badges';
import { downloadFile } from '@/components/talent/download';
import {
  errorCode,
  errorDetails,
  errorMessage,
} from '@/components/talent/errors';
import type { Question } from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { toast } from '@/components/ui/toast';

import { DIFFICULTIES, QUESTION_TYPES } from './options.js';
import { QuestionDialog } from './question-dialog.js';

interface QuestionList {
  readonly items: Question[];
  readonly can: { manage: boolean; confirm: boolean; import: boolean };
}

/** 题库 — questions an instructor is responsible for: edit, confirm drafts, disable, import from Excel. */
export default function QuestionsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const filters = {
    type: params.get('type') || undefined,
    competencyId: params.get('competencyId') || undefined,
    difficulty: params.get('difficulty') || undefined,
    status: params.get('status') || undefined,
    q: params.get('q') || undefined,
    review: params.get('review') || undefined,
    sourceCourseId: params.get('sourceCourseId') || undefined,
  };
  const list = useRemote<QuestionList>('talent/questions', filters);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ question: Question | null } | null>(
    null,
  );
  const fileInput = useRef<HTMLInputElement>(null);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setSelected([]);
  };

  async function bulk(
    action: 'confirm' | 'discard' | 'disable' | 'enable',
    ids: readonly string[],
  ): Promise<void> {
    try {
      const result = await api.request<{
        data: { changed: number; skipped: { id: string; reason: string }[] };
      }>({
        path: 'talent/questions/bulk',
        method: 'POST',
        json: { action, ids },
      });
      toast.add({
        type: result.data.changed ? 'success' : 'warning',
        title: t(`talent.questions.bulkDone.${action}`, {
          count: result.data.changed,
        }),
        description: result.data.skipped.length
          ? t('talent.questions.bulkSkipped', {
              count: result.data.skipped.length,
            })
          : undefined,
      });
      setSelected([]);
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function importFile(file: File): Promise<void> {
    const form = new FormData();
    form.append('file', file);
    try {
      const result = await api.request<{ data: { created: number } }>({
        path: 'talent/questions/import',
        method: 'POST',
        body: form,
      });
      toast.add({
        type: 'success',
        title: t('talent.questions.imported', { count: result.data.created }),
      });
      list.reload();
    } catch (cause) {
      const details = errorDetails(cause) as {
        errors?: { row: number; code: string }[];
      } | null;
      toast.add({
        type: 'error',
        title: errorMessage(cause, t),
        description:
          errorCode(cause) === 'IMPORT_HAS_ERRORS' && details?.errors
            ? details.errors
                .slice(0, 5)
                .map((e) =>
                  t('talent.questions.importRowError', {
                    row: e.row,
                    reason: t(`talent.errors.${e.code}`, {
                      defaultValue: e.code,
                    }),
                  }),
                )
                .join('；')
            : undefined,
      });
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const data = list.data;
  const competencyOptions = new Map<string, string>();
  for (const q of data?.items ?? [])
    for (const c of q.competencies) competencyOptions.set(c.id, c.title);
  const allSelected =
    Boolean(data?.items.length) &&
    data!.items.every((q) => selected.includes(q.id));

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentQuestions')}
        description={t('talent.questions.description')}
        actions={
          <>
            {data?.can.import ? (
              <>
                <Button
                  variant='outline'
                  onClick={() =>
                    void downloadFile(
                      api,
                      'talent/questions/import-template',
                      'question-import-template.xlsx',
                    )
                  }
                >
                  <DownloadIcon data-icon='inline-start' />
                  {t('talent.questions.template')}
                </Button>
                <Button
                  variant='outline'
                  onClick={() => fileInput.current?.click()}
                >
                  <FileUpIcon data-icon='inline-start' />
                  {t('talent.questions.import')}
                </Button>
                <input
                  ref={fileInput}
                  type='file'
                  accept='.xlsx'
                  className='hidden'
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void importFile(file);
                  }}
                />
              </>
            ) : null}
            {data?.can.manage ? (
              <Button onClick={() => setEditing({ question: null })}>
                <PlusIcon data-icon='inline-start' />
                {t('talent.questions.create')}
              </Button>
            ) : null}
          </>
        }
      />
      <div className='flex flex-wrap items-center gap-2'>
        <InputGroup className='w-full sm:w-64'>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            defaultValue={filters.q ?? ''}
            placeholder={t('talent.questions.searchPlaceholder')}
            aria-label={t('talent.questions.searchPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                setFilter('q', e.currentTarget.value.trim());
            }}
            onBlur={(e) => setFilter('q', e.currentTarget.value.trim())}
          />
        </InputGroup>
        <NativeSelect
          value={filters.type ?? ''}
          onChange={(e) => setFilter('type', e.target.value)}
          aria-label={t('talent.questions.fields.type')}
        >
          <NativeSelectOption value=''>
            {t('talent.questions.allTypes')}
          </NativeSelectOption>
          {QUESTION_TYPES.map((type) => (
            <NativeSelectOption key={type} value={type}>
              {t(`talent.questionType.${type}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={filters.competencyId ?? ''}
          onChange={(e) => setFilter('competencyId', e.target.value)}
          aria-label={t('talent.questions.fields.competencies')}
        >
          <NativeSelectOption value=''>
            {t('talent.knowledge.allCompetencies')}
          </NativeSelectOption>
          {[...competencyOptions.entries()].map(([id, title]) => (
            <NativeSelectOption key={id} value={id}>
              {title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={filters.difficulty ?? ''}
          onChange={(e) => setFilter('difficulty', e.target.value)}
          aria-label={t('talent.questions.fields.difficulty')}
        >
          <NativeSelectOption value=''>
            {t('talent.questions.allDifficulties')}
          </NativeSelectOption>
          {DIFFICULTIES.map((d) => (
            <NativeSelectOption key={d} value={d}>
              {t(`talent.difficulty.${d}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={
            filters.review === 'mine' ? 'review:mine' : (filters.status ?? '')
          }
          onChange={(e) => {
            // "Awaiting my review" is its own filter: drafts the caller owns.
            const next = new URLSearchParams(params);
            next.delete('status');
            next.delete('review');
            if (e.target.value === 'review:mine') next.set('review', 'mine');
            else if (e.target.value) next.set('status', e.target.value);
            setParams(next, { replace: true });
          }}
          aria-label={t('talent.fields.status')}
        >
          <NativeSelectOption value=''>
            {t('talent.courses.allStatuses')}
          </NativeSelectOption>
          <NativeSelectOption value='review:mine'>
            {t('talent.questions.reviewMine')}
          </NativeSelectOption>
          <NativeSelectOption value='draft'>
            {t('talent.reviewStatus.draft')}
          </NativeSelectOption>
          <NativeSelectOption value='confirmed'>
            {t('talent.reviewStatus.confirmed')}
          </NativeSelectOption>
          <NativeSelectOption value='inactive'>
            {t('talent.common.disabled')}
          </NativeSelectOption>
        </NativeSelect>
        {filters.sourceCourseId ? (
          <Button
            variant='outline'
            size='sm'
            onClick={() => setFilter('sourceCourseId', '')}
          >
            {t('talent.questions.fromCourse', {
              title:
                data?.items.find(
                  (q) => q.sourceCourseId === filters.sourceCourseId,
                )?.sourceCourseTitle ?? filters.sourceCourseId,
            })}
            <XIcon data-icon='inline-end' />
          </Button>
        ) : null}
        {selected.length && data ? (
          <span className='ml-auto flex flex-wrap gap-2'>
            {data.can.confirm ? (
              <Button
                size='sm'
                variant='outline'
                onClick={() => void bulk('confirm', selected)}
              >
                <CheckIcon data-icon='inline-start' />
                {t('talent.questions.confirmSelected', {
                  count: selected.length,
                })}
              </Button>
            ) : null}
            {data.can.manage ? (
              <Button
                size='sm'
                variant='outline'
                onClick={() => void bulk('discard', selected)}
              >
                <Trash2Icon data-icon='inline-start' />
                {t('talent.questions.discardSelected')}
              </Button>
            ) : null}
            {data.can.confirm ? (
              <Button
                size='sm'
                variant='outline'
                onClick={() => void bulk('disable', selected)}
              >
                <PowerIcon data-icon='inline-start' />
                {t('talent.common.disable')}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !data ? (
        <BlockSkeleton rows={5} />
      ) : !data.items.length ? (
        <EmptyState
          title={t('talent.questions.empty')}
          description={t('talent.questions.emptyDescription')}
        />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-8'>
                  <Checkbox
                    checked={allSelected}
                    aria-label={t('talent.assignments.selectAll')}
                    onCheckedChange={(checked) =>
                      setSelected(
                        checked === true ? data.items.map((q) => q.id) : [],
                      )
                    }
                  />
                </TableHead>
                <TableHead>{t('talent.questions.fields.stem')}</TableHead>
                <TableHead>{t('talent.questions.fields.type')}</TableHead>
                <TableHead className='hidden lg:table-cell'>
                  {t('talent.questions.fields.competencies')}
                </TableHead>
                <TableHead className='hidden sm:table-cell'>
                  {t('talent.questions.fields.difficulty')}
                </TableHead>
                <TableHead className='hidden xl:table-cell'>
                  {t('talent.questions.fields.sourceDocument')}
                </TableHead>
                <TableHead className='hidden md:table-cell'>
                  {t('talent.courses.fields.source')}
                </TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('talent.common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((question) => (
                <TableRow
                  key={question.id}
                  className={
                    question.active ? undefined : 'text-muted-foreground'
                  }
                >
                  <TableCell>
                    <Checkbox
                      checked={selected.includes(question.id)}
                      aria-label={t('talent.questions.select')}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked === true
                            ? [...current, question.id]
                            : current.filter((id) => id !== question.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className='max-w-md'>
                    <span className='line-clamp-2 whitespace-normal'>
                      {question.stem}
                    </span>
                  </TableCell>
                  <TableCell>
                    {t(`talent.questionType.${question.type}`)}
                  </TableCell>
                  <TableCell className='hidden lg:table-cell'>
                    <span className='flex flex-wrap gap-1'>
                      {question.competencies.map((c) => (
                        <Badge key={c.id} variant='outline'>
                          {c.title}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className='hidden sm:table-cell'>
                    {t(`talent.difficulty.${question.difficulty}`)}
                  </TableCell>
                  <TableCell className='hidden text-muted-foreground xl:table-cell'>
                    {question.sourceDocumentTitle ?? '—'}
                    {question.sourceCourseTitle ? (
                      <span className='block text-xs'>
                        {t('talent.questions.fromCourse', {
                          title: question.sourceCourseTitle,
                        })}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className='hidden md:table-cell'>
                    {t(`talent.source.${question.source}`)}
                  </TableCell>
                  <TableCell>
                    {question.active ? (
                      <ReviewStatusBadge status={question.reviewStatus} />
                    ) : (
                      <Badge variant='outline'>
                        {t('talent.common.disabled')}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className='text-right'>
                    <span className='inline-flex gap-1'>
                      {data.can.manage ? (
                        <Button
                          size='icon-sm'
                          variant='ghost'
                          aria-label={t('talent.common.edit')}
                          onClick={() => setEditing({ question })}
                        >
                          <PencilIcon />
                        </Button>
                      ) : null}
                      {data.can.confirm && question.reviewStatus === 'draft' ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => void bulk('confirm', [question.id])}
                        >
                          {t('talent.courses.confirm')}
                        </Button>
                      ) : null}
                      {data.can.confirm && !question.active ? (
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => void bulk('enable', [question.id])}
                        >
                          {t('talent.common.enable')}
                        </Button>
                      ) : null}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <QuestionDialog
        open={Boolean(editing)}
        onOpenChange={(open) => (!open ? setEditing(null) : undefined)}
        question={editing?.question ?? null}
        onSaved={list.reload}
      />
    </PageContainer>
  );
}

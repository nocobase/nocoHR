import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { CourseStatusBadge } from '@/components/talent/badges';
import type { CourseSummary } from '@/components/talent/learning-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
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

import type { CoursesOutletContext } from './types.js';

/** 课程管理 — courses an instructor is responsible for (all courses for HR administrators). */
export default function CoursesPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || undefined;
  const status = params.get('status') || undefined;
  const review = params.get('review') || undefined;
  const list = useRemote<{ items: CourseSummary[]; canCreate: boolean }>(
    'talent/courses',
    { q, status, review },
  );
  const context = useMemo<CoursesOutletContext>(
    () => ({ reload: list.reload }),
    [list.reload],
  );
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentCourses')}
        description={t('talent.courses.description')}
        actions={
          list.data?.canCreate ? (
            <Link to='new' className={buttonVariants()}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.courses.create')}
            </Link>
          ) : null
        }
      />
      <div className='flex flex-wrap items-center gap-2'>
        <InputGroup className='w-full sm:w-64'>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            defaultValue={q ?? ''}
            placeholder={t('talent.courses.searchPlaceholder')}
            aria-label={t('talent.courses.searchPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter')
                setFilter('q', e.currentTarget.value.trim());
            }}
            onBlur={(e) => setFilter('q', e.currentTarget.value.trim())}
          />
        </InputGroup>
        <NativeSelect
          value={review === 'mine' ? 'review:mine' : (status ?? '')}
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
            {t('talent.courses.reviewMine')}
          </NativeSelectOption>
          {(['draft', 'confirmed', 'published', 'inactive'] as const).map(
            (s) => (
              <NativeSelectOption key={s} value={s}>
                {t(`talent.courseStatus.${s}`)}
              </NativeSelectOption>
            ),
          )}
        </NativeSelect>
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.items.length ? (
        <EmptyState
          title={t('talent.courses.empty')}
          description={t('talent.courses.emptyDescription')}
        />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talent.courses.fields.title')}</TableHead>
                <TableHead className='hidden lg:table-cell'>
                  {t('talent.courses.fields.sourceDocument')}
                </TableHead>
                <TableHead className='hidden xl:table-cell'>
                  {t('talent.courses.fields.competencies')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('talent.courses.fields.lessons')}
                </TableHead>
                <TableHead className='hidden text-right md:table-cell'>
                  {t('talent.courses.fields.minutes')}
                </TableHead>
                <TableHead className='hidden md:table-cell'>
                  {t('talent.courses.fields.owner')}
                </TableHead>
                <TableHead className='hidden sm:table-cell'>
                  {t('talent.courses.fields.source')}
                </TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('talent.courses.fields.learners')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((course) => (
                <TableRow key={course.id}>
                  <TableCell className='font-medium'>
                    <Link
                      to={encodeURIComponent(course.id)}
                      className='hover:underline'
                    >
                      {course.title}
                    </Link>
                  </TableCell>
                  <TableCell className='hidden lg:table-cell'>
                    {course.sourceDocumentId ? (
                      <Link
                        to={`/talent/knowledge/${encodeURIComponent(course.sourceDocumentId)}`}
                        className='text-muted-foreground hover:underline'
                      >
                        {course.sourceDocumentTitle ?? course.sourceDocumentId}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className='hidden xl:table-cell'>
                    <span className='flex flex-wrap gap-1'>
                      {course.competencies.map((c) => (
                        <Badge key={c.id} variant='outline'>
                          {c.title}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {course.lessonCount}
                  </TableCell>
                  <TableCell className='hidden text-right tabular-nums md:table-cell'>
                    {course.estimatedMinutes}
                  </TableCell>
                  <TableCell className='hidden md:table-cell'>
                    {course.ownerName ?? '—'}
                  </TableCell>
                  <TableCell className='hidden sm:table-cell'>
                    {t(`talent.source.${course.source}`)}
                  </TableCell>
                  <TableCell>
                    <span className='inline-flex flex-wrap items-center gap-1'>
                      <CourseStatusBadge status={course.status} />
                      {course.reviewStatus === 'draft' &&
                      course.source === 'ai' ? (
                        <Badge variant='default'>
                          {t('talent.courses.pendingReview')}
                        </Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {course.learnerCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import { ProcessingBadge, SourceLink } from './parts.js';
import {
  EVENT_SOURCES,
  EVENT_TYPES,
  JOB_EVENT_CAP,
  type JobEventRow,
  type JobEventsOutletContext,
  type JobEventsResponse,
} from './types.js';

const FILTERS = ['eventType', 'source', 'departmentId', 'from', 'to', 'failed'];

/**
 * Route `/talent/job-events` (V1-03 岗位变动): every job event — from a
 * personnel action, a sync, an import or a correction — with where it came
 * from and whether its follow-up processing succeeded. Filters live in the URL.
 */
export default function JobEventsPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const value = (name: string) => params.get(name) ?? '';
  const query = {
    eventType: value('eventType') || undefined,
    source: value('source') || undefined,
    departmentId: value('departmentId') || undefined,
    from: value('from') || undefined,
    to: value('to') || undefined,
    failed: value('failed') === 'true' ? 'true' : undefined,
  };
  const list = useRemote<JobEventsResponse>('talent/job-events', query);
  const orgSync = useCan({
    resource: { type: 'page', id: 'talent.orgSync' },
    action: 'access',
  });
  const context = useMemo<JobEventsOutletContext>(
    () => ({ reload: list.reload, canViewRuns: orgSync.can }),
    [list.reload, orgSync.can],
  );
  const filtering = FILTERS.some((name) => params.has(name));
  const setFilter = (name: string, next: string) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        if (next) copy.set(name, next);
        else copy.delete(name);
        return copy;
      },
      { replace: true },
    );
  const clear = () =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        for (const name of FILTERS) copy.delete(name);
        return copy;
      },
      { replace: true },
    );

  return (
    <PageContainer>
      <PageHeader
        title={t('jobEvents.title')}
        description={t('jobEvents.description')}
      />
      <div className='flex flex-wrap items-end gap-2'>
        <Field className='w-full sm:w-40'>
          <FieldLabel htmlFor='job-event-type'>
            {t('jobEvents.type')}
          </FieldLabel>
          <NativeSelect
            id='job-event-type'
            value={value('eventType')}
            onChange={(e) => setFilter('eventType', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('jobEvents.allTypes')}
            </NativeSelectOption>
            {EVENT_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {t(`talent.actionType.${type}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-full sm:w-40'>
          <FieldLabel htmlFor='job-event-source'>
            {t('jobEvents.source')}
          </FieldLabel>
          <NativeSelect
            id='job-event-source'
            value={value('source')}
            onChange={(e) => setFilter('source', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('jobEvents.allSources')}
            </NativeSelectOption>
            {EVENT_SOURCES.map((source) => (
              <NativeSelectOption key={source} value={source}>
                {t(`talent.events.source.${source}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-full sm:w-56'>
          <FieldLabel htmlFor='job-event-department'>
            {t('jobEvents.department')}
          </FieldLabel>
          <NativeSelect
            id='job-event-department'
            value={value('departmentId')}
            onChange={(e) => setFilter('departmentId', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('jobEvents.allDepartments')}
            </NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'  '.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-full sm:w-40'>
          <FieldLabel htmlFor='job-event-from'>
            {t('jobEvents.from')}
          </FieldLabel>
          <Input
            id='job-event-from'
            type='date'
            value={value('from')}
            onChange={(e) => setFilter('from', e.target.value)}
          />
        </Field>
        <Field className='w-full sm:w-40'>
          <FieldLabel htmlFor='job-event-to'>{t('jobEvents.to')}</FieldLabel>
          <Input
            id='job-event-to'
            type='date'
            value={value('to')}
            onChange={(e) => setFilter('to', e.target.value)}
          />
        </Field>
        <Field orientation='horizontal' className='w-auto pb-2'>
          <Checkbox
            id='job-event-failed'
            checked={value('failed') === 'true'}
            onCheckedChange={(checked) =>
              setFilter('failed', checked ? 'true' : '')
            }
          />
          <FieldLabel htmlFor='job-event-failed'>
            {t('jobEvents.failedOnly')}
          </FieldLabel>
        </Field>
        {filtering ? (
          <Button variant='ghost' onClick={clear}>
            {t('jobEvents.clearFilters')}
          </Button>
        ) : null}
        {list.loading && list.data ? (
          <Spinner aria-label={t('status.loading')} />
        ) : null}
      </div>
      {list.error && !list.data ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={6} />
      ) : !list.data.items.length ? (
        filtering ? (
          <EmptyState
            title={t('jobEvents.noMatch')}
            action={
              <Button variant='outline' onClick={clear}>
                {t('jobEvents.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('jobEvents.empty')}
            description={t('jobEvents.emptyDescription')}
          />
        )
      ) : (
        <>
          {list.data.items.length >= JOB_EVENT_CAP ? (
            <p className='text-sm text-muted-foreground'>
              {t('jobEvents.cap', { count: JOB_EVENT_CAP })}
            </p>
          ) : null}
          <div className='overflow-x-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('jobEvents.employee')}</TableHead>
                  <TableHead>{t('jobEvents.type')}</TableHead>
                  <TableHead>{t('jobEvents.change')}</TableHead>
                  <TableHead>{t('jobEvents.effectiveDate')}</TableHead>
                  <TableHead>{t('jobEvents.source')}</TableHead>
                  <TableHead>{t('jobEvents.processing')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    canRetry={list.data!.can.retry}
                    canViewRuns={orgSync.can}
                    search={location.search}
                    onRetried={list.reload}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

function EventRow({
  event,
  canRetry,
  canViewRuns,
  search,
  onRetried,
}: {
  event: JobEventRow;
  canRetry: boolean;
  canViewRuns: boolean;
  search: string;
  onRetried: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [retrying, setRetrying] = useState(false);
  const from = [event.fromDepartment, event.fromPosition]
    .filter(Boolean)
    .join(' / ');
  const to = [event.toDepartment, event.toPosition].filter(Boolean).join(' / ');
  return (
    <TableRow>
      <TableCell>
        <Link
          className='font-medium hover:underline'
          to={{ pathname: encodeURIComponent(event.id), search }}
        >
          {event.employeeName ?? '—'}
        </Link>
      </TableCell>
      <TableCell>{t(`talent.actionType.${event.eventType}`)}</TableCell>
      <TableCell className='whitespace-normal text-sm'>
        {from ? t('talent.events.change', { from, to: to || '—' }) : to || '—'}
      </TableCell>
      <TableCell className='tabular-nums'>
        {event.effectiveDate ?? '—'}
      </TableCell>
      <TableCell>
        <span className='flex flex-wrap items-center gap-2'>
          <Badge variant='outline'>
            {t(`talent.events.source.${event.source}`)}
          </Badge>
          <SourceLink event={event} canViewRuns={canViewRuns} />
        </span>
      </TableCell>
      <TableCell className='whitespace-normal'>
        <span className='flex flex-wrap items-center gap-2'>
          <ProcessingBadge event={event} />
          {canRetry && event.processError && !event.processedAt ? (
            <Button
              variant='outline'
              size='sm'
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                api
                  .request<{
                    data: {
                      processedAt: string | null;
                      processError: string | null;
                    };
                  }>({
                    path: `talent/job-events/${encodeURIComponent(event.id)}/retry`,
                    method: 'POST',
                  })
                  .then(({ data }) => {
                    toast.add(
                      data.processedAt
                        ? {
                            type: 'success',
                            title: t('jobEvents.retried', {
                              name: event.employeeName ?? '',
                            }),
                          }
                        : {
                            type: 'error',
                            title: t('jobEvents.retryFailed'),
                            description: data.processError ?? undefined,
                          },
                    );
                    onRetried();
                  })
                  .catch((cause: unknown) =>
                    toast.add({ type: 'error', title: errorMessage(cause, t) }),
                  )
                  .finally(() => setRetrying(false));
              }}
            >
              {retrying ? <Spinner data-icon='inline-start' /> : null}
              {t('jobEvents.retry')}
            </Button>
          ) : null}
        </span>
        {event.processError && !event.processedAt ? (
          <p className='mt-1 text-xs text-destructive'>
            {t('jobEvents.failedReason', { reason: event.processError })}
          </p>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

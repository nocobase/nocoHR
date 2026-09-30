import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  CalendarRangeIcon,
  CheckCheckIcon,
  SaveIcon,
  SendIcon,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import {
  addDays,
  daysBetween,
  isDate,
  today,
} from '@/components/talent/attendance/dates';
import { DepartmentSelect } from '@/components/talent/attendance/department-select';
import {
  attendanceErrorMessage,
  checkText,
  checksOf,
} from '@/components/talent/attendance/errors';
import type {
  CheckMap,
  ScheduleBoard,
  ScheduleCell,
} from '@/components/talent/attendance/types';
import { errorCode } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { CoverDialog } from './cover-dialog.js';
import { GridLegend, ScheduleGrid } from './grid.js';
import { cellChecks, cellKey, splitKey, type Edits } from './grid-keys.js';
import { RotationDialog, type RotationCell } from './rotation-dialog.js';

const MAX_DAYS = 31;

/**
 * 排班 (V2-05): a department's employee × date grid. Query: `department`,
 * `from`, `to` (at most 31 days; a week from `from` by default), `q`. The
 * HR assistant's conflict notices link here with `department` and `from`.
 */
export default function SchedulesPage(): ReactElement {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const [params, setParams] = useSearchParams();
  const departmentId = params.get('department') ?? '';
  const from = isDate(params.get('from')) ? params.get('from')! : today(zone);
  const requestedTo = params.get('to');
  const to =
    isDate(requestedTo) &&
    requestedTo >= from &&
    daysBetween(from, requestedTo) < MAX_DAYS
      ? requestedTo
      : addDays(from, 6);
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const set = (entries: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(entries))
      if (value) next.set(name, value);
      else next.delete(name);
    setParams(next, { replace: true });
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.scheduling.title')}
        description={t('attendance.scheduling.description')}
      />
      <Card>
        <CardContent>
          <form
            className='grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(12rem,1fr)_auto_auto_minmax(10rem,1fr)_auto] lg:items-end'
            onSubmit={(event) => {
              event.preventDefault();
              set({ q: search.trim() });
            }}
          >
            <Field>
              <FieldLabel htmlFor='schedule-department'>
                {t('attendance.filters.department')}
              </FieldLabel>
              <DepartmentSelect
                id='schedule-department'
                className='w-full'
                value={departmentId}
                emptyLabel={t('attendance.filters.chooseDepartment')}
                onChange={(value) => set({ department: value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='schedule-from'>
                {t('attendance.filters.from')}
              </FieldLabel>
              <Input
                id='schedule-from'
                type='date'
                value={from}
                onChange={(event) =>
                  isDate(event.target.value) &&
                  set({ from: event.target.value, to: '' })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='schedule-to'>
                {t('attendance.filters.to')}
              </FieldLabel>
              <Input
                id='schedule-to'
                type='date'
                value={to}
                min={from}
                max={addDays(from, MAX_DAYS - 1)}
                onChange={(event) =>
                  isDate(event.target.value) && set({ to: event.target.value })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='schedule-q'>
                {t('attendance.filters.search')}
              </FieldLabel>
              <Input
                id='schedule-q'
                value={search}
                maxLength={100}
                placeholder={t('attendance.filters.searchPlaceholder')}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Field>
            <Button type='submit' variant='outline'>
              {t('attendance.filters.apply')}
            </Button>
          </form>
          <p className='mt-2 text-xs text-muted-foreground'>
            {t('attendance.scheduling.rangeHint', { days: MAX_DAYS })}
          </p>
        </CardContent>
      </Card>
      {departmentId ? (
        <Board
          key={`${departmentId}|${from}|${to}|${q}`}
          departmentId={departmentId}
          from={from}
          to={to}
          q={q}
        />
      ) : (
        <EmptyState
          title={t('attendance.scheduling.chooseTitle')}
          description={t('attendance.scheduling.chooseDescription')}
        />
      )}
    </PageContainer>
  );
}

function Board({
  departmentId,
  from,
  to,
  q,
}: {
  departmentId: string;
  from: string;
  to: string;
  q: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const canEdit = useCan({
    resource: { type: 'composite', id: 'talent.schedule' },
    action: 'edit',
  });
  const canPublish = useCan({
    resource: { type: 'composite', id: 'talent.schedule' },
    action: 'publish',
  });
  const remote = useRemote<ScheduleBoard>('talent/schedules', {
    departmentId,
    from,
    to,
    q: q || undefined,
  });
  const [edits, setEdits] = useState<Edits>({});
  const [checks, setChecks] = useState<CheckMap>();
  const [busy, setBusy] = useState<'save' | 'validate' | 'publish' | null>(
    null,
  );
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const [warnings, setWarnings] = useState<CheckMap>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [rotationOpen, setRotationOpen] = useState(false);
  const [cover, setCover] = useState<ScheduleCell | null>(null);
  const board = remote.data;
  const cells = useMemo(
    () =>
      new Map(
        (board?.cells ?? []).map((cell) => [
          cellKey(cell.employeeId, cell.date),
          cell,
        ]),
      ),
    [board],
  );
  const editCount = Object.keys(edits).length;
  const drafts = (board?.cells ?? []).filter(
    (c) => c.status === 'draft',
  ).length;
  const conflict = errorCode(error) === 'SCHEDULE_CONFLICT';

  const payload = () =>
    Object.entries(edits).map(([key, shiftId]) => {
      const { employeeId, date } = splitKey(key);
      return {
        employeeId,
        date,
        shiftId,
        expectedUpdatedAt: cells.get(key)?.updatedAt ?? null,
      };
    });

  const run = async (
    kind: 'save' | 'validate' | 'publish',
    work: () => Promise<void>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    setError(undefined);
    try {
      await work();
    } catch (cause) {
      const code = errorCode(cause);
      const answered = checksOf(cause);
      if (answered) setChecks((current) => ({ ...current, ...answered }));
      if (code === 'SCHEDULE_WARNING_CONFIRMATION' && answered)
        setWarnings(answered);
      else setError(cause);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const save = (acknowledgeWarnings: boolean) =>
    run('save', async () => {
      setWarnings(undefined);
      const response = await api.request<{
        data: { saved: number; checks: CheckMap };
      }>({
        method: 'POST',
        path: 'talent/schedules/save',
        json: { cells: payload(), acknowledgeWarnings },
      });
      setChecks(response.data.checks);
      setEdits({});
      toast.add({
        type: 'success',
        title: t('attendance.scheduling.savedCount', {
          count: response.data.saved,
        }),
      });
      remote.reload();
    });

  const validate = () =>
    run('validate', async () => {
      const response = await api.request<{
        data: { checks: CheckMap; hasBlock: boolean; hasWarn: boolean };
      }>({
        method: 'POST',
        path: 'talent/schedules/validate',
        json: {
          cells: payload().map(({ employeeId, date, shiftId }) => ({
            employeeId,
            date,
            shiftId,
          })),
        },
      });
      const answered = response.data.checks;
      // Cells the check did not mention passed.
      setChecks((current) => ({
        ...current,
        ...Object.fromEntries(Object.keys(edits).map((key) => [key, []])),
        ...answered,
      }));
      toast.add({
        type: response.data.hasBlock ? 'error' : 'success',
        title: t(
          response.data.hasBlock
            ? 'attendance.scheduling.validateBlocked'
            : response.data.hasWarn
              ? 'attendance.scheduling.validateWarn'
              : 'attendance.scheduling.validateOk',
        ),
      });
    });

  const publish = () =>
    run('publish', async () => {
      const response = await api.request<{
        data: { saved: number; checks: CheckMap };
      }>({
        method: 'POST',
        path: 'talent/schedules/publish-range',
        json: { departmentId, from, to },
      });
      setPublishOpen(false);
      setChecks(response.data.checks);
      toast.add({
        type: 'success',
        title: t('attendance.scheduling.publishedCount', {
          count: response.data.saved,
        }),
      });
      remote.reload();
    }).finally(() => setPublishOpen(false));

  const applyRotation = (list: RotationCell[]) => {
    if (!board) return;
    const shown = new Set(board.employees.map((e) => e.id));
    const next: Edits = {};
    for (const cell of list) {
      if (!shown.has(cell.employeeId) || !board.dates.includes(cell.date))
        continue;
      next[cellKey(cell.employeeId, cell.date)] = cell.shiftId;
    }
    setEdits((current) => ({ ...current, ...next }));
    toast.add({
      type: 'success',
      title: t('attendance.scheduling.rotation.applied', {
        count: Object.keys(next).length,
      }),
    });
  };

  const pickCover = (cell: ScheduleCell, employeeId: string) => {
    setEdits((current) => ({
      ...current,
      [cellKey(employeeId, cell.date)]: cell.shiftId,
      [cellKey(cell.employeeId, cell.date)]: null,
    }));
    setCover(null);
    toast.add({
      type: 'success',
      title: t('attendance.scheduling.cover.picked'),
    });
  };

  if (remote.error && !board)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!board) return <BlockSkeleton rows={6} />;

  const issues = [
    ...new Set([
      ...board.cells.map((c) => cellKey(c.employeeId, c.date)),
      ...Object.keys(checks ?? {}),
    ]),
  ]
    .map((key) => ({
      key,
      cell: cells.get(key),
      list: cellChecks(key, cells.get(key), checks),
    }))
    .filter((item) => item.list.length)
    .sort((a, b) => a.key.localeCompare(b.key));
  const nameOf = (id: string) =>
    board.employees.find((e) => e.id === id)?.name ?? id;
  const editable = canEdit.can && !canEdit.isPending;

  return (
    <>
      <Card>
        <CardHeader className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
          <div className='min-w-0'>
            <CardTitle>
              {t('attendance.scheduling.gridTitle', { from, to })}
            </CardTitle>
            <CardDescription>
              {editCount
                ? t('attendance.scheduling.pendingEdits', { count: editCount })
                : t('attendance.scheduling.draftCount', { count: drafts })}
            </CardDescription>
          </div>
          <div className='flex flex-wrap gap-2'>
            {editable ? (
              <>
                <Button
                  variant='outline'
                  disabled={busy !== null || !board.employees.length}
                  onClick={() => setRotationOpen(true)}
                >
                  <CalendarRangeIcon data-icon='inline-start' />
                  {t('attendance.scheduling.rotation.open')}
                </Button>
                <Button
                  variant='outline'
                  disabled={busy !== null || !editCount}
                  onClick={() => void validate()}
                >
                  {busy === 'validate' ? (
                    <Spinner data-icon='inline-start' />
                  ) : (
                    <CheckCheckIcon data-icon='inline-start' />
                  )}
                  {t('attendance.scheduling.validate')}
                </Button>
                <Button
                  disabled={busy !== null || !editCount}
                  onClick={() => void save(false)}
                >
                  {busy === 'save' ? (
                    <Spinner data-icon='inline-start' />
                  ) : (
                    <SaveIcon data-icon='inline-start' />
                  )}
                  {t('attendance.scheduling.saveCount', { count: editCount })}
                </Button>
              </>
            ) : null}
            {canPublish.can ? (
              <Button
                variant='outline'
                disabled={busy !== null || editCount > 0 || !drafts}
                title={
                  editCount
                    ? t('attendance.scheduling.saveBeforePublish')
                    : undefined
                }
                onClick={() => setPublishOpen(true)}
              >
                <SendIcon data-icon='inline-start' />
                {t('attendance.scheduling.publish')}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className='grid gap-3'>
          {remote.loading ? <Spinner aria-label={t('status.loading')} /> : null}
          {board.meta.employeeTruncated || board.meta.scheduleTruncated ? (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.scheduling.truncated')}
            </p>
          ) : null}
          {error ? (
            <Alert variant='destructive'>
              <AlertTitle>{attendanceErrorMessage(error, t)}</AlertTitle>
              {conflict ? (
                <AlertDescription>
                  <p>{t('attendance.scheduling.conflictHint')}</p>
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={() => {
                      setEdits({});
                      setChecks(undefined);
                      setError(undefined);
                      remote.reload();
                    }}
                  >
                    {t('attendance.scheduling.reloadDiscard')}
                  </Button>
                </AlertDescription>
              ) : null}
            </Alert>
          ) : null}
          {!board.employees.length ? (
            <EmptyState
              title={t('attendance.schedules.noEmployees')}
              description={t('attendance.schedules.noEmployeesDescription')}
            />
          ) : (
            <>
              <ScheduleGrid
                board={board}
                edits={edits}
                checks={checks}
                canEdit={editable && busy === null}
                onEdit={(key, value) => {
                  // The old result no longer describes the cell; validate or save checks it again.
                  setChecks((current) => ({ ...current, [key]: [] }));
                  setEdits((current) => {
                    const next = { ...current };
                    const stored = cells.get(key);
                    // Choosing the stored value again is no edit.
                    if (stored && (stored.shiftId ?? null) === value)
                      delete next[key];
                    else next[key] = value;
                    return next;
                  });
                }}
              />
              <GridLegend />
            </>
          )}
        </CardContent>
      </Card>
      {issues.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('attendance.scheduling.issues')}</CardTitle>
            <CardDescription>
              {t('attendance.scheduling.issuesDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className='divide-y'>
              {issues.map(({ key, cell, list }) => {
                const { employeeId, date } = splitKey(key);
                // V4-14: a missing certification takes certified cover the same way.
                const leave = list.some(
                  (c) =>
                    c.rule === 'leaveConflict' ||
                    c.rule === 'certificationMissing',
                );
                return (
                  <li
                    key={key}
                    className='flex flex-wrap items-start justify-between gap-2 py-3'
                  >
                    <div className='min-w-0 space-y-1'>
                      <p className='font-medium'>
                        {nameOf(employeeId)} · {date}
                      </p>
                      <ul className='text-sm'>
                        {list.map((check) => (
                          <li
                            key={`${check.rule}:${check.message}`}
                            className={
                              check.level === 'block'
                                ? 'text-destructive'
                                : 'text-muted-foreground'
                            }
                          >
                            {t(`attendance.checks.levels.${check.level}`)} ·{' '}
                            {checkText(check, t)}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {leave && cell?.shiftId && editable ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setCover(cell)}
                      >
                        {cell.replacementSuggestion?.candidates.length
                          ? t('attendance.scheduling.cover.openSuggested', {
                              count:
                                cell.replacementSuggestion.candidates.length,
                            })
                          : t('attendance.scheduling.cover.open')}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <AlertDialog
        open={Boolean(warnings)}
        onOpenChange={(open) => {
          if (!open && !busyRef.current) setWarnings(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.scheduling.warningTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.scheduling.warningDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className='max-h-60 list-disc overflow-y-auto pl-5 text-sm'>
            {Object.entries(warnings ?? {}).flatMap(([key, list]) =>
              list.map((check) => (
                <li key={`${key}:${check.rule}:${check.message}`}>
                  {nameOf(splitKey(key).employeeId)} · {splitKey(key).date} ·{' '}
                  {checkText(check, t)}
                </li>
              )),
            )}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>
              {t('attendance.scheduling.backToEdit')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={() => void save(true)}
            >
              {busy === 'save' ? <Spinner data-icon='inline-start' /> : null}
              {t('attendance.scheduling.saveAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={publishOpen}
        onOpenChange={(open) => !busyRef.current && setPublishOpen(open)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.scheduling.publishTitle', { count: drafts })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.scheduling.publishDescription', { from, to })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={() => void publish()}
            >
              {busy === 'publish' ? <Spinner data-icon='inline-start' /> : null}
              {t('attendance.scheduling.publish')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {rotationOpen ? (
        <RotationDialog
          open={rotationOpen}
          onOpenChange={setRotationOpen}
          board={board}
          onApply={applyRotation}
        />
      ) : null}
      <CoverDialog
        cell={cover}
        board={board}
        onClose={() => setCover(null)}
        onPick={pickCover}
        onInvited={() => remote.reload()}
      />
    </>
  );
}

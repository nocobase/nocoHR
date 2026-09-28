import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  BellRingIcon,
  CalendarClockIcon,
  ClipboardPlusIcon,
  MoreHorizontalIcon,
  XCircleIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssignDialog } from '@/components/talent/assign-dialog';
import { AssignmentStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import type { Assignment } from '@/components/talent/learning-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
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
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface AssignmentList {
  readonly items: Assignment[];
  readonly summary: { total: number; completionRate: number; overdue: number };
  readonly can: {
    create: boolean;
    remind: boolean;
    cancel: boolean;
    updateDue: boolean;
  };
}

const STATUSES = [
  'notStarted',
  'inProgress',
  'overdue',
  'completed',
  'cancelled',
] as const;

/** 学习任务 — assignments in the viewer's scope: totals, reminders, due dates and cancellation. */
export default function AssignmentsPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const filters = {
    courseId: params.get('courseId') || undefined,
    examId: params.get('examId') || undefined,
    departmentId: params.get('departmentId') || undefined,
    status: params.get('status') || undefined,
  };
  const list = useRemote<AssignmentList>('talent/assignments', filters);
  const targets = useRemote<{
    courses: { id: string; title: string }[];
    exams: { id: string; title: string }[];
  }>(list.data?.can.create ? 'talent/assignments/targets' : null);
  const [selected, setSelected] = useState<string[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [dueEditing, setDueEditing] = useState<Assignment | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [cancelling, setCancelling] = useState<Assignment | null>(null);
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setSelected([]);
  };

  async function remind(ids: readonly string[]): Promise<void> {
    try {
      const result = await api.request<{
        data: { reminded: number; skipped: { id: string; reason: string }[] };
      }>({ path: 'talent/assignments/remind', method: 'POST', json: { ids } });
      const { reminded, skipped } = result.data;
      toast.add({
        type: reminded ? 'success' : 'warning',
        title: t('talent.assignments.reminded', { count: reminded }),
        description: skipped.length
          ? t('talent.assignments.remindSkipped', { count: skipped.length })
          : undefined,
      });
      setSelected([]);
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function saveDue(): Promise<void> {
    if (!dueEditing || !dueDate) return;
    try {
      await api.request({
        path: `talent/assignments/${encodeURIComponent(dueEditing.id)}`,
        method: 'PATCH',
        json: { dueDate },
      });
      toast.add({ type: 'success', title: t('talent.assignments.dueUpdated') });
      setDueEditing(null);
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function cancel(): Promise<void> {
    if (!cancelling) return;
    try {
      await api.request({
        path: `talent/assignments/${encodeURIComponent(cancelling.id)}/cancel`,
        method: 'POST',
      });
      toast.add({ type: 'success', title: t('talent.assignments.cancelled') });
      setCancelling(null);
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  const data = list.data;
  const openItems =
    data?.items.filter((i) =>
      ['notStarted', 'inProgress', 'overdue'].includes(i.status),
    ) ?? [];
  const allSelected =
    openItems.length > 0 && openItems.every((i) => selected.includes(i.id));

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentAssignments')}
        description={t('talent.assignments.description')}
        actions={
          <>
            {data?.can.remind && selected.length ? (
              <Button variant='outline' onClick={() => void remind(selected)}>
                <BellRingIcon data-icon='inline-start' />
                {t('talent.assignments.remindSelected', {
                  count: selected.length,
                })}
              </Button>
            ) : null}
            {data?.can.create ? (
              <Button onClick={() => setAssignOpen(true)}>
                <ClipboardPlusIcon data-icon='inline-start' />
                {t('talent.assignments.assign')}
              </Button>
            ) : null}
          </>
        }
      />
      {data ? (
        <div className='grid gap-4 sm:grid-cols-3'>
          {(
            [
              ['total', String(data.summary.total)],
              ['completionRate', `${data.summary.completionRate}%`],
              ['overdue', String(data.summary.overdue)],
            ] as const
          ).map(([key, value]) => (
            <Card key={key}>
              <CardHeader>
                <CardDescription>
                  {t(`talent.assignments.summary.${key}`)}
                </CardDescription>
                <CardTitle
                  className={cn(
                    'text-3xl tabular-nums',
                    key === 'overdue' &&
                      data.summary.overdue > 0 &&
                      'text-destructive',
                  )}
                >
                  {value}
                </CardTitle>
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : null}
      <div className='flex flex-wrap items-center gap-2'>
        {targets.data ? (
          <NativeSelect
            value={filters.courseId ?? ''}
            onChange={(e) => setFilter('courseId', e.target.value)}
            aria-label={t('talent.assignments.course')}
          >
            <NativeSelectOption value=''>
              {t('talent.assignments.allCourses')}
            </NativeSelectOption>
            {targets.data.courses.map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}
        <NativeSelect
          value={filters.departmentId ?? ''}
          onChange={(e) => setFilter('departmentId', e.target.value)}
          aria-label={t('talent.fields.department')}
        >
          <NativeSelectOption value=''>
            {t('talent.assignments.allDepartments')}
          </NativeSelectOption>
          {lookups.departments.map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {`${'  '.repeat(d.depth)}${d.label}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          value={filters.status ?? ''}
          onChange={(e) => setFilter('status', e.target.value)}
          aria-label={t('talent.fields.status')}
        >
          <NativeSelectOption value=''>
            {t('talent.assignments.allStatuses')}
          </NativeSelectOption>
          {STATUSES.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {t(`talent.assignmentStatus.${s}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !data ? (
        <BlockSkeleton rows={5} />
      ) : !data.items.length ? (
        <EmptyState title={t('talent.assignments.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                {data.can.remind ? (
                  <TableHead className='w-8'>
                    <Checkbox
                      checked={allSelected}
                      aria-label={t('talent.assignments.selectAll')}
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked === true ? openItems.map((i) => i.id) : [],
                        )
                      }
                    />
                  </TableHead>
                ) : null}
                <TableHead>{t('talent.assignments.fields.employee')}</TableHead>
                <TableHead className='hidden md:table-cell'>
                  {t('talent.fields.department')}
                </TableHead>
                <TableHead>{t('talent.assignments.fields.target')}</TableHead>
                <TableHead className='hidden sm:table-cell'>
                  {t('talent.assignments.fields.progress')}
                </TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                <TableHead>{t('talent.assignments.dueDate')}</TableHead>
                <TableHead className='hidden lg:table-cell'>
                  {t('talent.assignments.fields.assignedBy')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('talent.common.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => {
                const open = ['notStarted', 'inProgress', 'overdue'].includes(
                  item.status,
                );
                return (
                  <TableRow key={item.id}>
                    {data.can.remind ? (
                      <TableCell>
                        {open ? (
                          <Checkbox
                            checked={selected.includes(item.id)}
                            aria-label={t('talent.assignments.select', {
                              name: item.employeeName,
                            })}
                            onCheckedChange={(checked) =>
                              setSelected((current) =>
                                checked === true
                                  ? [...current, item.id]
                                  : current.filter((id) => id !== item.id),
                              )
                            }
                          />
                        ) : null}
                      </TableCell>
                    ) : null}
                    <TableCell className='font-medium'>
                      {item.employeeName}
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {lookups.departmentTitle(item.departmentId)}
                    </TableCell>
                    <TableCell>
                      {item.targetTitle}
                      {item.source === 'recertification' ? (
                        <span className='block text-xs text-muted-foreground'>
                          {t('talent.assignments.recertification')}
                        </span>
                      ) : item.kind !== 'course' ||
                        item.parentAssignmentId ||
                        item.optional ? (
                        // Paths, practices, path steps and recommendations are told apart from plain courses.
                        <span className='block text-xs text-muted-foreground'>
                          {[
                            t(`talent.assignments.kinds.${item.kind}`),
                            item.parentAssignmentId
                              ? t('talent.assignments.pathStep')
                              : null,
                            item.optional
                              ? t('talent.learning.optional')
                              : null,
                            item.source === 'plan'
                              ? t('talent.assignments.fromPlan')
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='hidden sm:table-cell'>
                      <span className='flex items-center gap-2'>
                        <Progress
                          value={item.progress}
                          className='w-20'
                          aria-label={t('talent.assignments.fields.progress')}
                        />
                        <span className='text-xs tabular-nums text-muted-foreground'>
                          {item.progress}%
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <AssignmentStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell
                      className={cn(
                        'tabular-nums',
                        item.status === 'overdue' && 'text-destructive',
                      )}
                    >
                      {item.dueDate
                        ? format.format(new Date(`${item.dueDate}T00:00:00`))
                        : '—'}
                    </TableCell>
                    <TableCell className='hidden lg:table-cell'>
                      {item.assignedByName ?? t('talent.assignments.system')}
                    </TableCell>
                    <TableCell className='text-right'>
                      {open &&
                      (data.can.remind ||
                        data.can.updateDue ||
                        data.can.cancel) ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                size='icon-sm'
                                variant='ghost'
                                aria-label={t('talent.common.actions')}
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuGroup>
                              {data.can.remind ? (
                                <DropdownMenuItem
                                  onClick={() => void remind([item.id])}
                                >
                                  <BellRingIcon />
                                  {t('talent.assignments.remind')}
                                </DropdownMenuItem>
                              ) : null}
                              {data.can.updateDue ? (
                                <DropdownMenuItem
                                  onClick={() => {
                                    setDueDate(item.dueDate ?? '');
                                    setDueEditing(item);
                                  }}
                                >
                                  <CalendarClockIcon />
                                  {t('talent.assignments.changeDue')}
                                </DropdownMenuItem>
                              ) : null}
                              {data.can.cancel ? (
                                <DropdownMenuItem
                                  variant='destructive'
                                  onClick={() => setCancelling(item)}
                                >
                                  <XCircleIcon />
                                  {t('talent.assignments.cancel')}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <AssignDialog
        open={assignOpen}
        onOpenChange={setAssignOpen}
        onAssigned={list.reload}
      />
      <Dialog
        open={Boolean(dueEditing)}
        onOpenChange={(open) => (!open ? setDueEditing(null) : undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('talent.assignments.changeDue')}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='due-date'>
              {t('talent.assignments.dueDate')}
            </FieldLabel>
            <Input
              id='due-date'
              type='date'
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDueEditing(null)}>
              {t('actions.cancel')}
            </Button>
            <Button disabled={!dueDate} onClick={() => void saveDue()}>
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => (!open ? setCancelling(null) : undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.assignments.cancelTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('talent.assignments.cancelDescription', {
                name: cancelling?.employeeName ?? '',
                title: cancelling?.targetTitle ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void cancel()}
            >
              {t('talent.assignments.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

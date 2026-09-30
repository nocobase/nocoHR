import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { EmployeeListItem } from '@/components/talent/types';
import { useRemote, type RemoteState } from '@/components/talent/use-remote';

import type { Candidate, CandidateList } from './candidates-data.js';
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
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
import { cn } from '@/lib/utils';

import type { Position } from './types.js';

/**
 * 拟任人员 (V3-08): the active development targets for this position with
 * each person's 对标差距, smallest first. HR administrators and the heads
 * responsible for the people (or for the departments holding the position)
 * add and cancel; the server decides who may, and whom they see. Setting a
 * target changes nobody's position, permissions or pay.
 */
export function CandidatesPanel({
  position,
  list,
}: {
  position: Position;
  list: RemoteState<CandidateList>;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function cancel(candidate: Candidate): Promise<void> {
    setBusy(candidate.id);
    try {
      await api.request({
        path: `talent/competency/targets/${encodeURIComponent(candidate.id)}/cancel`,
        method: 'POST',
      });
      toast.add({
        type: 'success',
        title: t('talent.competencyExt.candidates.cancelled'),
      });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={3} />;
  const { items, canManage } = list.data;

  return (
    <div className='space-y-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted-foreground'>
          {t('talent.competencyExt.candidates.description')}
        </p>
        {canManage ? (
          <Button size='sm' onClick={() => setAdding(true)}>
            <PlusIcon data-icon='inline-start' />
            {t('talent.competencyExt.candidates.add')}
          </Button>
        ) : null}
      </div>
      {items.length ? (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  {t('talent.competencyExt.candidates.employee')}
                </TableHead>
                <TableHead>
                  {t('talent.competencyExt.candidates.currentPosition')}
                </TableHead>
                <TableHead className='hidden md:table-cell'>
                  {t('talent.competencyExt.candidates.createdBy')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('talent.competencyExt.candidates.gap')}
                </TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                {canManage ? (
                  <TableHead className='text-right'>
                    {t('talent.common.actions')}
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((candidate) => (
                <TableRow key={candidate.id}>
                  <TableCell>
                    <div className='font-medium'>{candidate.employeeName}</div>
                    <div className='text-xs text-muted-foreground'>
                      {[candidate.employeeNo, candidate.departmentTitle]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </TableCell>
                  <TableCell>{candidate.currentPositionTitle ?? '—'}</TableCell>
                  <TableCell className='hidden md:table-cell'>
                    {candidate.createdByName}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      candidate.summary.mandatoryGaps > 0 &&
                        'font-semibold text-destructive',
                    )}
                  >
                    {t('talent.competencyExt.candidates.gapValue', {
                      mandatory: candidate.summary.mandatoryGaps,
                      total: candidate.summary.totalGap,
                    })}
                    {candidate.summary.unassessedMandatory ? (
                      <div className='text-xs font-normal text-muted-foreground'>
                        {t('talent.competencyExt.summaryUnassessed', {
                          count: candidate.summary.unassessedMandatory,
                        })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant='outline'>
                      {t('talent.competencyExt.candidates.active')}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell className='text-right'>
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={busy === candidate.id}
                        onClick={() => void cancel(candidate)}
                      >
                        <XIcon data-icon='inline-start' />
                        {t('talent.competencyExt.candidates.cancel')}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('talent.competencyExt.candidates.empty')}
        </p>
      )}
      {adding ? (
        <AddCandidateDialog
          position={position}
          existing={items.map((c) => c.employeeId)}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function AddCandidateDialog({
  position,
  existing,
  onClose,
  onSaved,
}: {
  position: Position;
  existing: readonly string[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  // The employees the caller may see; the server still decides whom they may prepare.
  const employees = useRemote<{ items: EmployeeListItem[] }>(
    'talent/employees',
    {
      status: 'active',
    },
  );
  const [employeeId, setEmployeeId] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const options = (employees.data?.items ?? []).filter(
    (e) =>
      e.status !== 'leave' &&
      e.positionId !== position.id &&
      !existing.includes(e.id),
  );

  async function save(): Promise<void> {
    if (!employeeId) {
      setError(t('talent.form.required'));
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const { data } = await api.request<{ data: { todoRaised: boolean } }>({
        path: 'talent/competency/targets',
        method: 'POST',
        json: {
          employeeId,
          targetPositionId: position.id,
          reason: reason.trim() || undefined,
        },
      });
      toast.add({
        type: 'success',
        title: data.todoRaised
          ? t('talent.competencyExt.candidates.addedWithTodo')
          : t('talent.competencyExt.candidates.added'),
      });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{t('talent.competencyExt.candidates.add')}</DialogTitle>
          <DialogDescription>
            {t('talent.competencyExt.candidates.addDescription', {
              position: position.title,
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          id='candidate-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='candidate-employee'>
                {t('talent.competencyExt.candidates.employee')}
              </FieldLabel>
              <NativeSelect
                id='candidate-employee'
                value={employeeId}
                disabled={!employees.data}
                onChange={(e) => setEmployeeId(e.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('talent.common.choose')}
                </NativeSelectOption>
                {options.map((e) => (
                  <NativeSelectOption key={e.id} value={e.id}>
                    {e.name}
                    {e.positionTitle ? ` · ${e.positionTitle}` : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='candidate-reason'>
                {t('talent.competencyExt.candidates.reason')}
              </FieldLabel>
              <Input
                id='candidate-reason'
                maxLength={200}
                value={reason}
                placeholder={t(
                  'talent.competencyExt.candidates.reasonPlaceholder',
                )}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='candidate-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

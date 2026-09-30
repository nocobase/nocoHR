import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { addDays, daysBetween } from '@/components/talent/attendance/dates';
import { DepartmentSelect } from '@/components/talent/attendance/department-select';
import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const MAX_DAYS = 62;

/** 重新计算: the records of a date range (at most 62 days), after a rule or punch change. */
export function RecomputeDialog({
  open,
  onOpenChange,
  initialFrom,
  initialTo,
  departmentId: initialDepartment,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialFrom: string;
  initialTo: string;
  departmentId: string;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(
    initialTo < initialFrom ? initialFrom : initialTo,
  );
  const [departmentId, setDepartmentId] = useState(initialDepartment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const invalid =
    !from || !to || to < from || daysBetween(from, to) >= MAX_DAYS;
  const submit = async () => {
    if (busy || invalid) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{
        data: { computed?: number; skippedLocked?: number };
      }>({
        method: 'POST',
        path: 'talent/attendance/recompute',
        json: { from, to, departmentId: departmentId || undefined },
      });
      toast.add({
        type: 'success',
        title: t('attendance.board.recomputed', {
          computed: response.data.computed ?? 0,
          locked: response.data.skippedLocked ?? 0,
        }),
      });
      onOpenChange(false);
      onDone();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('attendance.board.recompute')}</DialogTitle>
          <DialogDescription>
            {t('attendance.board.recomputeDescription', { days: MAX_DAYS })}
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <Field>
            <FieldLabel htmlFor='recompute-department'>
              {t('attendance.filters.department')}
            </FieldLabel>
            <DepartmentSelect
              id='recompute-department'
              className='w-full'
              value={departmentId}
              emptyLabel={t('attendance.filters.allDepartments')}
              onChange={setDepartmentId}
            />
          </Field>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='recompute-from'>
                {t('attendance.filters.from')}
              </FieldLabel>
              <Input
                id='recompute-from'
                type='date'
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='recompute-to'>
                {t('attendance.filters.to')}
              </FieldLabel>
              <Input
                id='recompute-to'
                type='date'
                value={to}
                min={from}
                max={from ? addDays(from, MAX_DAYS - 1) : undefined}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </div>
          {invalid ? (
            <p className='text-sm text-destructive'>
              {t('attendance.board.rangeInvalid', { days: MAX_DAYS })}
            </p>
          ) : null}
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {attendanceErrorMessage(error, t)}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('attendance.board.recomputeConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

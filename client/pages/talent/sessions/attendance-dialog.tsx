import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type {
  Enrollment,
  TrainingSession,
} from '@/components/talent/training-types';
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** Records or corrects one person's attendance; a reason is required and shows on the attendance sheet. */
export function AttendanceDialog({
  session,
  enrollment,
  onOpenChange,
  onSaved,
}: {
  session: TrainingSession;
  enrollment: Enrollment | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [status, setStatus] = useState<'attended' | 'absent'>('attended');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<string | null>(null);
  if (enrollment && openFor !== enrollment.id) {
    setOpenFor(enrollment.id);
    setStatus(enrollment.status === 'attended' ? 'absent' : 'attended');
    setReason('');
    setError(undefined);
  }

  async function save(): Promise<void> {
    if (!enrollment) return;
    if (!reason.trim()) {
      setError(t('talent.sessions.reasonRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.request({
        path: `talent/sessions/${encodeURIComponent(session.id)}/attendance`,
        method: 'POST',
        json: {
          employeeId: enrollment.employeeId,
          status,
          reason: reason.trim(),
        },
      });
      toast.add({ type: 'success', title: t('talent.sessions.marked') });
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(enrollment)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('talent.sessions.markTitle', { name: enrollment?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('talent.sessions.markDescription')}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='attendance-status'>
              {t('talent.sessions.fields.status')}
            </FieldLabel>
            <NativeSelect
              id='attendance-status'
              className='w-full'
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as 'attended' | 'absent')
              }
            >
              <NativeSelectOption value='attended'>
                {t('talent.sessions.enrollmentStatus.attended')}
              </NativeSelectOption>
              <NativeSelectOption value='absent'>
                {t('talent.sessions.enrollmentStatus.absent')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='attendance-reason'>
              {t('talent.sessions.reason')}
            </FieldLabel>
            <Textarea
              id='attendance-reason'
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

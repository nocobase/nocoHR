import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { TrainingSession } from '@/components/talent/training-types';
import { useRemote } from '@/components/talent/use-remote';
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { toast } from '@/components/ui/toast';

/** A `datetime-local` value in the browser's time zone. */
function local(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Schedules or edits a session of an offline course. */
export function SessionDialog({
  open,
  session,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  session?: TrainingSession;
  onOpenChange: (open: boolean) => void;
  onSaved: (session: TrainingSession) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const options = useRemote<{
    courses: { id: string; title: string }[];
    instructors: { userId: string; name: string; employeeNo: string }[];
  }>(open ? 'talent/sessions/options' : null);
  const [form, setForm] = useState({
    courseId: '',
    title: '',
    instructorUserId: '',
    startAt: '',
    endAt: '',
    enrollDeadline: '',
    location: '',
    capacity: '12',
  });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  if (open !== synced) {
    setSynced(open);
    if (open) {
      setForm({
        courseId: session?.courseId ?? '',
        title: session?.title ?? '',
        instructorUserId: session?.instructorUserId ?? '',
        startAt: local(session?.startAt),
        endAt: local(session?.endAt),
        enrollDeadline: local(session?.enrollDeadline),
        location: session?.location ?? '',
        capacity: String(session?.capacity ?? 12),
      });
      setError(undefined);
    }
  }
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function save(): Promise<void> {
    if (
      !form.courseId ||
      !form.startAt ||
      !form.endAt ||
      !form.location.trim()
    ) {
      setError(t('talent.sessions.incomplete'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        courseId: form.courseId,
        title: form.title.trim() || undefined,
        instructorUserId: form.instructorUserId || undefined,
        startAt: new Date(form.startAt).toISOString(),
        endAt: new Date(form.endAt).toISOString(),
        enrollDeadline: form.enrollDeadline
          ? new Date(form.enrollDeadline).toISOString()
          : null,
        location: form.location.trim(),
        capacity: Number(form.capacity),
      };
      const result = session
        ? await api.request<{ data: TrainingSession }>({
            path: `talent/sessions/${encodeURIComponent(session.id)}`,
            method: 'PATCH',
            json,
          })
        : await api.request<{ data: TrainingSession }>({
            path: 'talent/sessions',
            method: 'POST',
            json,
          });
      toast.add({ type: 'success', title: t('talent.sessions.saved') });
      onSaved(result.data);
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {session ? t('talent.sessions.edit') : t('talent.sessions.create')}
          </DialogTitle>
          <DialogDescription>
            {t('talent.sessions.formDescription')}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='session-course'>
              {t('talent.sessions.fields.course')}
            </FieldLabel>
            <NativeSelect
              id='session-course'
              className='w-full'
              value={form.courseId}
              onChange={(e) => set('courseId')(e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {(options.data?.courses ?? []).map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              {t('talent.sessions.courseHint')}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor='session-title'>
              {t('talent.sessions.fields.title')}
            </FieldLabel>
            <Input
              id='session-title'
              value={form.title}
              maxLength={200}
              placeholder={t('talent.sessions.titlePlaceholder')}
              onChange={(e) => set('title')(e.target.value)}
            />
          </Field>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='session-start'>
                {t('talent.sessions.fields.startAt')}
              </FieldLabel>
              <Input
                id='session-start'
                type='datetime-local'
                value={form.startAt}
                onChange={(e) => set('startAt')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='session-end'>
                {t('talent.sessions.fields.endAt')}
              </FieldLabel>
              <Input
                id='session-end'
                type='datetime-local'
                value={form.endAt}
                onChange={(e) => set('endAt')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='session-location'>
                {t('talent.sessions.fields.location')}
              </FieldLabel>
              <Input
                id='session-location'
                value={form.location}
                maxLength={200}
                onChange={(e) => set('location')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='session-capacity'>
                {t('talent.sessions.fields.capacity')}
              </FieldLabel>
              <Input
                id='session-capacity'
                type='number'
                min={1}
                max={1000}
                value={form.capacity}
                onChange={(e) => set('capacity')(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='session-instructor'>
                {t('talent.sessions.fields.instructor')}
              </FieldLabel>
              <NativeSelect
                id='session-instructor'
                className='w-full'
                value={form.instructorUserId}
                onChange={(e) => set('instructorUserId')(e.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('talent.sessions.instructorMe')}
                </NativeSelectOption>
                {(options.data?.instructors ?? []).map((p) => (
                  <NativeSelectOption key={p.userId} value={p.userId}>
                    {p.name}（{p.employeeNo}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='session-deadline'>
                {t('talent.sessions.fields.enrollDeadline')}
              </FieldLabel>
              <Input
                id='session-deadline'
                type='datetime-local'
                value={form.enrollDeadline}
                onChange={(e) => set('enrollDeadline')(e.target.value)}
              />
              <FieldDescription>
                {t('talent.sessions.deadlineHint')}
              </FieldDescription>
            </Field>
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
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

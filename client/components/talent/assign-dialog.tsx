import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { MultiCheckList } from '@/components/talent/multi-check';
import { useLookups } from '@/components/talent/use-lookups';
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
import { toast } from '@/components/ui/toast';

interface Preview {
  /** For a learning path: its steps, and per person the steps that complete at once or take over a task. */
  readonly steps?: readonly { id: string; title: string }[];
  readonly included: readonly {
    employeeId: string;
    name: string;
    departmentId: string;
    completedStepIds?: readonly string[];
    attachedStepIds?: readonly string[];
  }[];
  readonly excluded: readonly {
    employeeId: string;
    name: string;
    reason: string;
  }[];
}

export interface AssignInitial {
  readonly courseId?: string;
  readonly examId?: string;
  readonly learningPathId?: string;
  readonly employeeIds?: readonly string[];
}

/**
 * 指派: pick a published course, exam or learning path, the audience (people, departments
 * including sub-departments, positions — combinable), and a due date; preview
 * who receives it and why others are skipped; then confirm.
 */
export function AssignDialog({
  open,
  onOpenChange,
  onAssigned,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigned: () => void;
  initial?: AssignInitial;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const targets = useRemote<{
    courses: { id: string; title: string }[];
    exams: { id: string; title: string }[];
    paths?: { id: string; title: string }[];
  }>(open ? 'talent/assignments/targets' : null);
  const people = useRemote<{
    items: {
      id: string;
      name: string;
      employeeNo: string;
      departmentId: string;
      status: string;
    }[];
  }>(open ? 'talent/employees' : null);
  const [kind, setKind] = useState<'course' | 'exam' | 'path'>('course');
  const [targetId, setTargetId] = useState('');
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  // A preview belongs to the request it was made for; changing the request hides it.
  const [previewState, setPreviewState] = useState<{
    key: string;
    data: Preview;
  } | null>(null);
  const requestKey = JSON.stringify([
    kind,
    targetId,
    employeeIds,
    departmentIds,
    positionIds,
    dueDate,
  ]);
  const preview = previewState?.key === requestKey ? previewState.data : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Opening the dialog starts a fresh request from `initial`.
  const [synced, setSynced] = useState<{
    open: boolean;
    initial?: AssignInitial;
  }>({ open: false });
  if (synced.open !== open || (open && synced.initial !== initial)) {
    setSynced({ open, initial });
    if (open) {
      setKind(
        initial?.learningPathId ? 'path' : initial?.examId ? 'exam' : 'course',
      );
      setTargetId(
        initial?.learningPathId ?? initial?.examId ?? initial?.courseId ?? '',
      );
      setEmployeeIds([...(initial?.employeeIds ?? [])]);
      setDepartmentIds([]);
      setPositionIds([]);
      setDueDate('');
      setPreviewState(null);
      setError(undefined);
    }
  }

  const payload = () => ({
    ...(kind === 'path'
      ? { learningPathId: targetId, dueDate: dueDate || undefined }
      : {
          courseId: kind === 'course' ? targetId : null,
          examId: kind === 'exam' ? targetId : null,
          dueDate,
        }),
    employeeIds,
    departmentIds,
    positionIds,
  });

  async function run(confirm: boolean): Promise<void> {
    if (
      !targetId ||
      // A path's steps carry their own deadlines; its overall due date is optional.
      (!dueDate && kind !== 'path') ||
      (!employeeIds.length && !departmentIds.length && !positionIds.length)
    ) {
      setError(t('talent.assignments.incomplete'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      if (confirm) {
        const result = await api.request<{ data: { created: number } }>({
          path: 'talent/assignments',
          method: 'POST',
          json: payload(),
        });
        toast.add({
          type: 'success',
          title: t('talent.assignments.assigned', {
            count: result.data.created,
          }),
        });
        onAssigned();
        onOpenChange(false);
      } else {
        const result = await api.request<{ data: Preview }>({
          path: 'talent/assignments/preview',
          method: 'POST',
          json: payload(),
        });
        setPreviewState({ key: requestKey, data: result.data });
      }
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const options =
    kind === 'course'
      ? (targets.data?.courses ?? [])
      : kind === 'path'
        ? (targets.data?.paths ?? [])
        : (targets.data?.exams ?? []);
  const examsAvailable = (targets.data?.exams.length ?? 0) > 0;
  const pathsAvailable = (targets.data?.paths?.length ?? 0) > 0;
  const stepTitle = (id: string) =>
    preview?.steps?.find((s) => s.id === id)?.title ?? id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('talent.assignments.assign')}</DialogTitle>
          <DialogDescription>
            {t('talent.assignments.assignDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className='max-h-[65svh] overflow-y-auto pr-1'>
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)_12rem]'>
              <Field>
                <FieldLabel htmlFor='assign-kind'>
                  {t('talent.assignments.kind')}
                </FieldLabel>
                <NativeSelect
                  id='assign-kind'
                  className='w-full'
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as 'course' | 'exam' | 'path');
                    setTargetId('');
                  }}
                >
                  <NativeSelectOption value='course'>
                    {t('talent.assignments.kinds.course')}
                  </NativeSelectOption>
                  {examsAvailable || kind === 'exam' ? (
                    <NativeSelectOption value='exam'>
                      {t('talent.assignments.kinds.exam')}
                    </NativeSelectOption>
                  ) : null}
                  {pathsAvailable || kind === 'path' ? (
                    <NativeSelectOption value='path'>
                      {t('talent.assignments.kinds.path')}
                    </NativeSelectOption>
                  ) : null}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='assign-target'>
                  {kind === 'course'
                    ? t('talent.assignments.course')
                    : kind === 'path'
                      ? t('talent.assignments.path')
                      : t('talent.assignments.exam')}
                </FieldLabel>
                <NativeSelect
                  id='assign-target'
                  className='w-full'
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.choose')}
                  </NativeSelectOption>
                  {options.map((o) => (
                    <NativeSelectOption key={o.id} value={o.id}>
                      {o.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='assign-due'>
                  {kind === 'path'
                    ? t('talent.assignments.pathDueDate')
                    : t('talent.assignments.dueDate')}
                </FieldLabel>
                <Input
                  id='assign-due'
                  type='date'
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </Field>
            </div>
            <div className='grid gap-4 md:grid-cols-3'>
              <Field>
                <FieldLabel>{t('talent.assignments.byPeople')}</FieldLabel>
                <MultiCheckList
                  options={(people.data?.items ?? [])
                    .filter((p) => p.status !== 'leave')
                    .map((p) => ({
                      value: p.id,
                      label: p.name,
                      hint: p.employeeNo,
                    }))}
                  value={employeeIds}
                  onChange={setEmployeeIds}
                  label={t('talent.assignments.byPeople')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('talent.assignments.byDepartments')}</FieldLabel>
                <MultiCheckList
                  options={lookups.departments
                    .filter((d) => d.active)
                    .map((d) => ({
                      value: d.id,
                      label: d.label,
                      depth: d.depth,
                    }))}
                  value={departmentIds}
                  onChange={setDepartmentIds}
                  label={t('talent.assignments.byDepartments')}
                />
              </Field>
              <Field>
                <FieldLabel>{t('talent.assignments.byPositions')}</FieldLabel>
                <MultiCheckList
                  options={lookups.positions
                    .filter((p) => p.active)
                    .map((p) => ({ value: p.id, label: p.title }))}
                  value={positionIds}
                  onChange={setPositionIds}
                  label={t('talent.assignments.byPositions')}
                />
              </Field>
            </div>
            {preview ? (
              <div className='space-y-3 rounded-md border p-3'>
                <p className='text-sm font-medium'>
                  {t('talent.assignments.previewSummary', {
                    included: preview.included.length,
                    excluded: preview.excluded.length,
                  })}
                </p>
                {preview.included.length ? (
                  <div className='flex flex-wrap gap-1'>
                    {preview.included.map((p) => (
                      <Badge key={p.employeeId} variant='secondary'>
                        {p.name}
                        <span className='text-muted-foreground'>
                          {lookups.departmentTitle(p.departmentId)}
                        </span>
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {preview.steps
                  ? preview.included
                      .filter(
                        (p) =>
                          p.completedStepIds?.length ||
                          p.attachedStepIds?.length,
                      )
                      .map((p) => (
                        <p key={`steps-${p.employeeId}`} className='text-sm'>
                          {p.name}：
                          {p.completedStepIds?.length
                            ? t('talent.assignments.pathCompleted', {
                                steps: p.completedStepIds
                                  .map(stepTitle)
                                  .join('、'),
                              })
                            : ''}
                          {p.attachedStepIds?.length
                            ? ` ${t('talent.assignments.pathAttached', {
                                steps: p.attachedStepIds
                                  .map(stepTitle)
                                  .join('、'),
                              })}`
                            : ''}
                        </p>
                      ))
                  : null}
                {preview.excluded.length ? (
                  <ul className='space-y-1 text-sm text-muted-foreground'>
                    {preview.excluded.map((p) => (
                      <li key={p.employeeId}>
                        {p.name}：{t(`talent.assignments.skip.${p.reason}`)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => void run(false)}
          >
            {t('talent.assignments.preview')}
          </Button>
          <Button
            disabled={busy || !preview || !preview.included.length}
            onClick={() => void run(true)}
          >
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.assignments.confirmAssign', {
              count: preview?.included.length ?? 0,
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  PlusIcon,
  RouteIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorDetails, errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type {
  LearningPath,
  StepType,
} from '@/components/talent/training-types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

interface StepOptions {
  courses: {
    id: string;
    title: string;
    ready: boolean;
    deliveryMode: 'online' | 'offline';
  }[];
  exams: { id: string; title: string; ready: boolean }[];
  scenarios: { id: string; title: string; ready: boolean }[];
}

interface StepDraft {
  key: string;
  stepType: StepType;
  refId: string;
  dueOffsetDays: string;
  required: boolean;
}

/**
 * 学习路径 — ordered steps (courses, offline training, practice, exams) that
 * bring a person to a position. A published path cannot change; unpublish it
 * first. Assigning happens on the assignments page, like a course or an exam.
 */
export default function PathsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const paths = useRemote<LearningPath[]>('talent/paths');
  const canManage = useCan({
    resource: { type: 'composite', id: 'talent.learningPath' },
    action: 'manage',
  });
  const editingId = params.get('path');

  function open(id: string | null): void {
    const next = new URLSearchParams(params);
    if (id) next.set('path', id);
    else next.delete('path');
    setParams(next, { replace: true });
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentPaths')}
        description={t('talent.paths.description')}
        actions={
          canManage.can ? (
            <Button onClick={() => open('new')}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.paths.create')}
            </Button>
          ) : null
        }
      />
      {paths.error ? (
        <LoadError error={paths.error} onRetry={paths.reload} />
      ) : !paths.data ? (
        <BlockSkeleton rows={4} />
      ) : !paths.data.length ? (
        <EmptyState
          title={t('talent.paths.empty')}
          description={t('talent.paths.emptyDescription')}
        />
      ) : (
        <Card>
          <CardContent className='px-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('talent.paths.fields.title')}</TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('talent.paths.fields.position')}
                  </TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('talent.paths.fields.purpose')}
                  </TableHead>
                  <TableHead>{t('talent.paths.fields.steps')}</TableHead>
                  <TableHead className='hidden lg:table-cell'>
                    {t('talent.paths.fields.minutes')}
                  </TableHead>
                  <TableHead className='hidden sm:table-cell'>
                    {t('talent.paths.fields.learners')}
                  </TableHead>
                  <TableHead className='hidden sm:table-cell'>
                    {t('talent.paths.fields.completion')}
                  </TableHead>
                  <TableHead>{t('talent.paths.fields.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paths.data.map((path) => (
                  <TableRow
                    key={path.id}
                    className='cursor-pointer'
                    onClick={() => open(path.id)}
                  >
                    <TableCell>
                      <button
                        type='button'
                        className='flex items-center gap-2 text-left font-medium hover:underline'
                        onClick={(event) => {
                          event.stopPropagation();
                          open(path.id);
                        }}
                      >
                        <RouteIcon className='size-4 text-primary' />
                        {path.title}
                      </button>
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {path.positionTitle ?? '—'}
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {t(`talent.paths.purpose.${path.purpose}`)}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {path.steps.length}
                    </TableCell>
                    <TableCell className='hidden tabular-nums lg:table-cell'>
                      {t('talent.learning.minutes', {
                        count: path.estimatedMinutes,
                      })}
                    </TableCell>
                    <TableCell className='hidden tabular-nums sm:table-cell'>
                      {path.learnerCount}
                    </TableCell>
                    <TableCell className='hidden tabular-nums sm:table-cell'>
                      {path.completionRate === null
                        ? '—'
                        : `${path.completionRate}%`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={path.published ? 'secondary' : 'outline'}>
                        {!path.active
                          ? t('talent.paths.status.inactive')
                          : path.published
                            ? t('talent.paths.status.published')
                            : t('talent.paths.status.draft')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <PathSheet
        id={editingId}
        onClose={() => open(null)}
        onSaved={(id) => {
          paths.reload();
          open(id);
        }}
      />
    </PageContainer>
  );
}

let stepSeed = 0;
const stepKey = () => `step-${(stepSeed += 1)}`;

function PathSheet({
  id,
  onClose,
  onSaved,
}: {
  id: string | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const isNew = id === 'new';
  const path = useRemote<LearningPath>(
    id && !isNew ? `talent/paths/${encodeURIComponent(id)}` : null,
  );
  const options = useRemote<StepOptions>(
    id ? 'talent/paths/step-options' : null,
  );
  const [form, setForm] = useState({
    code: '',
    title: '',
    description: '',
    positionId: '',
    purpose: 'onboarding',
    sequential: true,
    skipCompleted: true,
  });
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const source = isNew ? null : path.data;
  const syncKey = isNew
    ? 'new'
    : source
      ? `${source.id}:${source.published}:${source.steps.length}`
      : null;
  if (id && syncKey && loadedFor !== syncKey) {
    setLoadedFor(syncKey);
    setError(undefined);
    setForm({
      code: source?.code ?? '',
      title: source?.title ?? '',
      description: source?.description ?? '',
      positionId: source?.positionId ?? '',
      purpose: source?.purpose ?? 'onboarding',
      sequential: source?.sequential ?? true,
      skipCompleted: source?.skipCompleted ?? true,
    });
    setSteps(
      (source?.steps ?? []).map((s) => ({
        key: stepKey(),
        stepType: s.stepType,
        refId: s.courseId ?? s.examId ?? s.practiceScenarioId ?? '',
        dueOffsetDays: String(s.dueOffsetDays),
        required: s.required,
      })),
    );
  }
  const locked = Boolean(source?.published);
  const editable = (isNew || Boolean(source?.can.manage)) && !locked;

  function optionsFor(type: StepType) {
    const data = options.data;
    if (!data) return [];
    return type === 'course'
      ? data.courses.map((c) => ({
          id: c.id,
          title:
            c.deliveryMode === 'offline'
              ? `${c.title}（${t('talent.paths.stepTypes.offline')}）`
              : c.title,
          ready: c.ready,
        }))
      : type === 'exam'
        ? data.exams
        : data.scenarios;
  }

  function move(index: number, delta: number): void {
    setSteps((previous) => {
      const next = [...previous];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item);
      return next;
    });
  }

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        ...form,
        positionId: form.positionId || null,
        description: form.description.trim() || null,
        steps: steps.map((s) => ({
          stepType: s.stepType,
          courseId: s.stepType === 'course' ? s.refId : undefined,
          examId: s.stepType === 'exam' ? s.refId : undefined,
          practiceScenarioId: s.stepType === 'practice' ? s.refId : undefined,
          dueOffsetDays: Number(s.dueOffsetDays),
          required: s.required,
        })),
      };
      const result = isNew
        ? await api.request<{ data: LearningPath }>({
            path: 'talent/paths',
            method: 'POST',
            json,
          })
        : await api.request<{ data: LearningPath }>({
            path: `talent/paths/${encodeURIComponent(id ?? '')}`,
            method: 'PATCH',
            json,
          });
      toast.add({ type: 'success', title: t('talent.paths.saved') });
      if (!isNew) path.reload();
      onSaved(result.data.id);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function setPublished(published: boolean): Promise<void> {
    if (!source) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/paths/${encodeURIComponent(source.id)}/publish`,
        method: 'POST',
        json: { published },
      });
      toast.add({
        type: 'success',
        title: published
          ? t('talent.paths.published')
          : t('talent.paths.unpublished'),
      });
      path.reload();
      onSaved(source.id);
    } catch (cause) {
      const details = errorDetails(cause) as { titles?: string[] } | undefined;
      setError(
        `${errorMessage(cause, t)}${details?.titles?.length ? `：${details.titles.join('、')}` : ''}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <SheetContent className='w-full overflow-y-auto sm:max-w-3xl'>
        <SheetHeader>
          <SheetTitle>
            {isNew
              ? t('talent.paths.create')
              : (source?.title ?? t('talent.paths.detail'))}
          </SheetTitle>
          <SheetDescription>
            {locked ? t('talent.paths.lockedHint') : t('talent.paths.editHint')}
          </SheetDescription>
        </SheetHeader>
        <div className='space-y-6 px-4'>
          {path.error ? (
            <LoadError error={path.error} onRetry={path.reload} />
          ) : !isNew && !source ? (
            <BlockSkeleton rows={5} />
          ) : (
            <FieldGroup>
              <div className='grid gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel htmlFor='path-title'>
                    {t('talent.paths.fields.title')}
                  </FieldLabel>
                  <Input
                    id='path-title'
                    disabled={!editable}
                    value={form.title}
                    maxLength={200}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='path-code'>
                    {t('talent.paths.fields.code')}
                  </FieldLabel>
                  <Input
                    id='path-code'
                    disabled={!editable}
                    value={form.code}
                    maxLength={64}
                    placeholder='path-cnc-operator-onboard'
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='path-position'>
                    {t('talent.paths.fields.position')}
                  </FieldLabel>
                  <NativeSelect
                    id='path-position'
                    className='w-full'
                    disabled={!editable}
                    value={form.positionId}
                    onChange={(e) =>
                      setForm({ ...form, positionId: e.target.value })
                    }
                  >
                    <NativeSelectOption value=''>
                      {t('talent.paths.noPosition')}
                    </NativeSelectOption>
                    {lookups.positions
                      .filter((p) => p.active)
                      .map((p) => (
                        <NativeSelectOption key={p.id} value={p.id}>
                          {p.title}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor='path-purpose'>
                    {t('talent.paths.fields.purpose')}
                  </FieldLabel>
                  <NativeSelect
                    id='path-purpose'
                    className='w-full'
                    disabled={!editable}
                    value={form.purpose}
                    onChange={(e) =>
                      setForm({ ...form, purpose: e.target.value })
                    }
                  >
                    {['onboarding', 'development', 'other'].map((p) => (
                      <NativeSelectOption key={p} value={p}>
                        {t(`talent.paths.purpose.${p}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor='path-description'>
                  {t('talent.paths.fields.description')}
                </FieldLabel>
                <Textarea
                  id='path-description'
                  disabled={!editable}
                  value={form.description}
                  maxLength={4000}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </Field>
              <div className='flex flex-wrap gap-6'>
                <label className='flex items-center gap-2 text-sm'>
                  <Switch
                    disabled={!editable}
                    checked={form.sequential}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, sequential: checked })
                    }
                  />
                  {t('talent.paths.fields.sequential')}
                </label>
                <label className='flex items-center gap-2 text-sm'>
                  <Switch
                    disabled={!editable}
                    checked={form.skipCompleted}
                    onCheckedChange={(checked) =>
                      setForm({ ...form, skipCompleted: checked })
                    }
                  />
                  {t('talent.paths.fields.skipCompleted')}
                </label>
              </div>
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <p className='font-medium'>
                    {t('talent.paths.fields.steps')}
                  </p>
                  {editable ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        setSteps([
                          ...steps,
                          {
                            key: stepKey(),
                            stepType: 'course',
                            refId: '',
                            dueOffsetDays: String(
                              Number(
                                steps[steps.length - 1]?.dueOffsetDays ?? 0,
                              ) + 3,
                            ),
                            required: true,
                          },
                        ])
                      }
                    >
                      <PlusIcon data-icon='inline-start' />
                      {t('talent.paths.addStep')}
                    </Button>
                  ) : null}
                </div>
                <FieldDescription>
                  {t('talent.paths.stepsHint')}
                </FieldDescription>
                <ol className='space-y-2'>
                  {steps.map((step, index) => {
                    const choices = optionsFor(step.stepType);
                    const chosen = choices.find((c) => c.id === step.refId);
                    return (
                      <li
                        key={step.key}
                        className='grid gap-2 rounded-md border p-3 sm:grid-cols-[2rem_8rem_minmax(0,1fr)_6rem_auto] sm:items-center'
                      >
                        <span className='text-sm font-medium tabular-nums'>
                          {index + 1}
                        </span>
                        <NativeSelect
                          aria-label={t('talent.paths.fields.stepType')}
                          disabled={!editable}
                          value={step.stepType}
                          onChange={(e) =>
                            setSteps(
                              steps.map((s) =>
                                s.key === step.key
                                  ? {
                                      ...s,
                                      stepType: e.target.value as StepType,
                                      refId: '',
                                    }
                                  : s,
                              ),
                            )
                          }
                        >
                          {(['course', 'exam', 'practice'] as const).map(
                            (type) => (
                              <NativeSelectOption key={type} value={type}>
                                {t(`talent.paths.stepTypes.${type}`)}
                              </NativeSelectOption>
                            ),
                          )}
                        </NativeSelect>
                        <div className='min-w-0 space-y-1'>
                          <NativeSelect
                            aria-label={t('talent.paths.fields.target')}
                            className='w-full'
                            disabled={!editable}
                            value={step.refId}
                            onChange={(e) =>
                              setSteps(
                                steps.map((s) =>
                                  s.key === step.key
                                    ? { ...s, refId: e.target.value }
                                    : s,
                                ),
                              )
                            }
                          >
                            <NativeSelectOption value=''>
                              {t('talent.common.choose')}
                            </NativeSelectOption>
                            {choices.map((c) => (
                              <NativeSelectOption key={c.id} value={c.id}>
                                {c.ready
                                  ? c.title
                                  : `${c.title}（${t('talent.paths.notReady')}）`}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                          {chosen && !chosen.ready ? (
                            <p className='text-xs text-destructive'>
                              {t('talent.paths.notReadyHint')}
                            </p>
                          ) : null}
                        </div>
                        <label className='flex items-center gap-1 text-xs text-muted-foreground'>
                          <Input
                            type='number'
                            min={1}
                            max={365}
                            className='h-8 w-16'
                            disabled={!editable}
                            aria-label={t('talent.paths.fields.dueOffset')}
                            value={step.dueOffsetDays}
                            onChange={(e) =>
                              setSteps(
                                steps.map((s) =>
                                  s.key === step.key
                                    ? { ...s, dueOffsetDays: e.target.value }
                                    : s,
                                ),
                              )
                            }
                          />
                          {t('talent.paths.days')}
                        </label>
                        <div className='flex items-center gap-1'>
                          <label className='mr-2 flex items-center gap-1 text-xs'>
                            <Switch
                              size='sm'
                              disabled={!editable}
                              checked={step.required}
                              onCheckedChange={(checked) =>
                                setSteps(
                                  steps.map((s) =>
                                    s.key === step.key
                                      ? { ...s, required: checked }
                                      : s,
                                  ),
                                )
                              }
                            />
                            {t('talent.paths.fields.required')}
                          </label>
                          {editable ? (
                            <>
                              <Button
                                size='icon-sm'
                                variant='ghost'
                                aria-label={t('talent.paths.moveUp')}
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUpIcon />
                              </Button>
                              <Button
                                size='icon-sm'
                                variant='ghost'
                                aria-label={t('talent.paths.moveDown')}
                                disabled={index === steps.length - 1}
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDownIcon />
                              </Button>
                              <Button
                                size='icon-sm'
                                variant='ghost'
                                aria-label={t('talent.paths.removeStep')}
                                onClick={() =>
                                  setSteps(
                                    steps.filter((s) => s.key !== step.key),
                                  )
                                }
                              >
                                <Trash2Icon />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          )}
        </div>
        <SheetFooter className='flex-row flex-wrap justify-end gap-2'>
          {source?.can.publish && source.active ? (
            source.published ? (
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void setPublished(false)}
              >
                {t('talent.paths.unpublish')}
              </Button>
            ) : (
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void setPublished(true)}
              >
                {t('talent.paths.publish')}
              </Button>
            )
          ) : null}
          {editable ? (
            <Button disabled={busy} onClick={() => void save()}>
              {t('actions.save')}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

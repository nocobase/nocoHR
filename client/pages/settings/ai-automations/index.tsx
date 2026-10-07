import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { BotIcon, PlayIcon, Settings2Icon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { Markdown } from '@/components/talent/markdown';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

type Kind = 'daily' | 'weekly' | 'monthly' | 'afterDaily' | 'event';

interface Automation {
  key: string;
  employee: string;
  kind: Kind;
  enabled: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
  hour: number | null;
  weekday: number | null;
  monthDay: number | null;
  params: Record<string, number | string>;
  lastRun: { id: string; status: string; startedAt: string } | null;
  adoption: {
    total: number;
    adopted: number;
    modified: number;
    discarded: number;
    pending: number;
    rate: number | null;
  };
}

interface Run {
  id: string;
  task: string;
  employee: string;
  trigger: string;
  triggerRef: Record<string, unknown> | null;
  status: string;
  ownerName: string | null;
  inputSummary: string | null;
  output: unknown;
  references: unknown;
  fallback: boolean;
  conversationSessionId: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  items: {
    entityType: string;
    entityId: string;
    outcome: string;
    outcomeByName: string | null;
    outcomeAt: string | null;
  }[];
}

/** Display order; an employee the server registers but this list misses is appended, so its tasks still show. */
const EMPLOYEES = [
  'hrAssistant',
  'recruitingAssistant',
  'vendorReconciler',
  'frameworkAdvisor',
  'knowledgeAssistant',
  'contentWriter',
  'certificationSteward',
  'examiner',
  'learningCoach',
  'practiceCoach',
  'performanceAssistant',
  'talentAnalyst',
];
const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  succeeded: 'secondary',
  skipped: 'outline',
  running: 'default',
  failed: 'destructive',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The app page where a draft a run produced can be reviewed. */
function entityPath(type: string, id: string): string | null {
  switch (type) {
    case 'course':
      return `/talent/courses/${encodeURIComponent(id)}`;
    case 'question':
      return '/talent/questions?review=mine';
    case 'competency':
      return `/talent/competencies/${encodeURIComponent(id)}`;
    case 'positionRequirement':
      return '/talent/framework';
    case 'practiceScenario':
      return `/talent/practice-scenarios?scenario=${encodeURIComponent(id)}`;
    case 'learningPlan':
      return `/talent/learning-plans?tab=all&plan=${encodeURIComponent(id)}`;
    default:
      return null;
  }
}

/** AI 员工任务 — the AI employees' proactive work: switches, owners, run times, manual runs and the run records. */
export default function AIAutomationsSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const automations = useRemote<Automation[]>('talent/automations');
  const [taskFilter, setTaskFilter] = useState('');
  const runs = useRemote<Run[]>('talent/automations/runs', {
    task: taskFilter || undefined,
    limit: 50,
  });
  const [editing, setEditing] = useState<Automation | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const openRunId = params.get('run');

  function openRun(id: string | null): void {
    const next = new URLSearchParams(params);
    if (id) next.set('run', id);
    else next.delete('run');
    setParams(next, { replace: true });
  }

  async function runNow(automation: Automation): Promise<void> {
    setRunning(automation.key);
    try {
      const result = await api.request<{
        data: { status: string; runId?: string };
      }>({
        path: `talent/automations/${encodeURIComponent(automation.key)}/run`,
        method: 'POST',
      });
      toast.add({
        type: result.data.status === 'failed' ? 'error' : 'success',
        title: t('aiAutomations.runResult', {
          status: t(`aiAutomations.status.${result.data.status}`),
        }),
      });
      automations.reload();
      runs.reload();
      if (result.data.runId) openRun(result.data.runId);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setRunning(null);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('aiAutomations.settingsTitle')}
        description={t('aiAutomations.description')}
      />
      {automations.error ? (
        <LoadError error={automations.error} onRetry={automations.reload} />
      ) : !automations.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <div className='space-y-4'>
          {[
            ...EMPLOYEES,
            ...new Set(
              automations.data
                .map((a) => a.employee)
                .filter((employee) => !EMPLOYEES.includes(employee)),
            ),
          ].map((employee) => {
            const items = automations.data!.filter(
              (a) => a.employee === employee,
            );
            if (!items.length) return null;
            return (
              <Card key={employee}>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <BotIcon className='size-4 text-primary' />
                    {t(`aiAutomations.employees.${employee}`)}
                  </CardTitle>
                </CardHeader>
                <CardContent className='divide-y'>
                  {items.map((automation) => (
                    <AutomationRow
                      key={automation.key}
                      automation={automation}
                      busy={running === automation.key}
                      onEdit={() => setEditing(automation)}
                      onRun={() => void runNow(automation)}
                      onOpenRun={openRun}
                      onToggle={async (enabled) => {
                        try {
                          await api.request({
                            path: `talent/automations/${encodeURIComponent(automation.key)}`,
                            method: 'PATCH',
                            json: { enabled },
                          });
                          automations.reload();
                        } catch (cause) {
                          toast.add({
                            type: 'error',
                            title: errorMessage(cause, t),
                          });
                        }
                      }}
                    />
                  ))}
                </CardContent>
              </Card>
            );
          })}
          <Card>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
              <CardTitle>{t('aiAutomations.runs.title')}</CardTitle>
              <NativeSelect
                aria-label={t('aiAutomations.runs.task')}
                value={taskFilter}
                onChange={(e) => setTaskFilter(e.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('aiAutomations.runs.all')}
                </NativeSelectOption>
                {automations.data.map((a) => (
                  <NativeSelectOption key={a.key} value={a.key}>
                    {t(`aiAutomations.tasks.${a.key}.title`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </CardHeader>
            <CardContent>
              {runs.error ? (
                <LoadError error={runs.error} onRetry={runs.reload} />
              ) : !runs.data ? (
                <BlockSkeleton rows={3} />
              ) : !runs.data.length ? (
                <EmptyState title={t('aiAutomations.runs.empty')} />
              ) : (
                <RunTable runs={runs.data} onOpen={openRun} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
      <SettingsDialog
        automation={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          automations.reload();
        }}
      />
      <RunSheet
        runId={openRunId}
        onClose={() => openRun(null)}
        onChanged={() => {
          runs.reload();
          automations.reload();
          openRun(null);
        }}
      />
    </PageContainer>
  );
}

function useScheduleText(): (automation: Automation) => string {
  const { t } = useTranslation();
  return (automation) => {
    const hour = String(automation.hour ?? 9).padStart(2, '0');
    switch (automation.kind) {
      case 'daily':
        return t('aiAutomations.schedule.daily', { hour });
      case 'weekly':
        return t('aiAutomations.schedule.weekly', {
          hour,
          weekday: t(`aiAutomations.weekdays.${automation.weekday ?? 1}`),
        });
      case 'monthly':
        return t('aiAutomations.schedule.monthly', {
          hour,
          day: automation.monthDay ?? 1,
        });
      default:
        return t(`aiAutomations.schedule.${automation.kind}`);
    }
  };
}

function AutomationRow({
  automation,
  busy,
  onEdit,
  onRun,
  onToggle,
  onOpenRun,
}: {
  automation: Automation;
  busy: boolean;
  onEdit: () => void;
  onRun: () => void;
  onToggle: (enabled: boolean) => Promise<void>;
  onOpenRun: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const scheduleText = useScheduleText();
  const { adoption } = automation;
  const decided = adoption.adopted + adoption.modified + adoption.discarded;
  return (
    <div className='flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center'>
      <div className='min-w-0 flex-1 space-y-1'>
        <p className='font-medium'>
          {t(`aiAutomations.tasks.${automation.key}.title`)}
        </p>
        <p className='text-sm text-muted-foreground'>
          {t(`aiAutomations.tasks.${automation.key}.description`)}
        </p>
        <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
          <span>{scheduleText(automation)}</span>
          <span>
            {t('aiAutomations.fields.owner')}：{automation.ownerName ?? '—'}
          </span>
          {adoption.rate !== null ? (
            <span>
              {t('aiAutomations.fields.adoption')}：
              {t('aiAutomations.adoptionValue', {
                rate: adoption.rate,
                decided,
              })}
            </span>
          ) : null}
          {automation.lastRun ? (
            <button
              type='button'
              className='inline-flex items-center gap-1 hover:text-foreground hover:underline'
              onClick={() => onOpenRun(automation.lastRun!.id)}
            >
              {t('aiAutomations.fields.lastRun')}：
              {new Intl.DateTimeFormat(locale, {
                dateStyle: 'short',
                timeStyle: 'short',
              }).format(new Date(automation.lastRun.startedAt))}
              <Badge
                variant={STATUS_VARIANT[automation.lastRun.status] ?? 'outline'}
              >
                {t(`aiAutomations.status.${automation.lastRun.status}`)}
              </Badge>
            </button>
          ) : null}
        </div>
        {!automation.ownerUserId ? (
          <Alert className='mt-2'>
            <AlertDescription>{t('aiAutomations.noOwner')}</AlertDescription>
          </Alert>
        ) : null}
      </div>
      <div className='flex shrink-0 items-center gap-2'>
        <Switch
          aria-label={t('aiAutomations.fields.enabled')}
          checked={automation.enabled}
          onCheckedChange={(checked) => void onToggle(checked)}
        />
        <Button variant='outline' size='sm' onClick={onEdit}>
          <Settings2Icon data-icon='inline-start' />
          {t('aiAutomations.edit')}
        </Button>
        {automation.kind !== 'event' ? (
          <Button
            size='sm'
            disabled={busy || !automation.enabled || !automation.ownerUserId}
            onClick={onRun}
          >
            <PlayIcon data-icon='inline-start' />
            {t('aiAutomations.runNow')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SettingsDialog({
  automation,
  onClose,
  onSaved,
}: {
  automation: Automation | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const owners = useRemote<
    { userId: string; name: string; employeeNo: string }[]
  >(
    automation ? 'talent/automations/owners' : null,
    // Only the people this automation may be handed to (the task runs with its owner's permissions).
    automation ? { key: automation.key } : undefined,
  );
  const [form, setForm] = useState({
    ownerUserId: '',
    hour: '9',
    weekday: '1',
    monthDay: '1',
  });
  // Task parameters (question target, lag threshold …), edited as numbers.
  const [params, setParams] = useState<Record<string, string>>({});
  const [synced, setSynced] = useState<Automation | null>(null);
  const [busy, setBusy] = useState(false);
  if (automation !== synced) {
    setSynced(automation);
    if (automation)
      setForm({
        ownerUserId: automation.ownerUserId ?? '',
        hour: String(automation.hour ?? 9),
        weekday: String(automation.weekday ?? 1),
        monthDay: String(automation.monthDay ?? 1),
      });
    if (automation)
      setParams(
        Object.fromEntries(
          Object.entries(automation.params).map(([k, v]) => [k, String(v)]),
        ),
      );
  }
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function save(): Promise<void> {
    if (!automation) return;
    setBusy(true);
    try {
      const scheduled = ['daily', 'weekly', 'monthly'].includes(
        automation.kind,
      );
      await api.request({
        path: `talent/automations/${encodeURIComponent(automation.key)}`,
        method: 'PATCH',
        json: {
          ownerUserId: form.ownerUserId || null,
          ...(scheduled ? { hour: Number(form.hour) } : {}),
          ...(automation.kind === 'weekly'
            ? { weekday: Number(form.weekday) }
            : {}),
          ...(automation.kind === 'monthly'
            ? { monthDay: Number(form.monthDay) }
            : {}),
          ...(Object.keys(params).length
            ? {
                // Text parameters (the synonym groups) stay text; the others are numbers.
                params: Object.fromEntries(
                  Object.entries(params).map(([k, v]) => [
                    k,
                    typeof automation.params[k] === 'string' ? v : Number(v),
                  ]),
                ),
              }
            : {}),
        },
      });
      toast.add({ type: 'success', title: t('aiAutomations.saved') });
      onSaved();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);
  return (
    <Dialog
      open={Boolean(automation)}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('aiAutomations.editTitle')}</DialogTitle>
          <DialogDescription>
            {automation ? t(`aiAutomations.tasks.${automation.key}.title`) : ''}
          </DialogDescription>
        </DialogHeader>
        {automation ? (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='automation-owner'>
                {t('aiAutomations.fields.owner')}
              </FieldLabel>
              <NativeSelect
                id='automation-owner'
                className='w-full'
                value={form.ownerUserId}
                onChange={(e) => set('ownerUserId', e.target.value)}
              >
                <NativeSelectOption value=''>—</NativeSelectOption>
                {(owners.data ?? []).map((o) => (
                  <NativeSelectOption key={o.userId} value={o.userId}>
                    {o.name}（{o.employeeNo}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                {t('aiAutomations.ownerHint')}
              </FieldDescription>
            </Field>
            {['daily', 'weekly', 'monthly'].includes(automation.kind) ? (
              <div className='grid gap-4 sm:grid-cols-2'>
                {automation.kind === 'weekly' ? (
                  <Field>
                    <FieldLabel htmlFor='automation-weekday'>
                      {t('aiAutomations.fields.weekday')}
                    </FieldLabel>
                    <NativeSelect
                      id='automation-weekday'
                      className='w-full'
                      value={form.weekday}
                      onChange={(e) => set('weekday', e.target.value)}
                    >
                      {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                        <NativeSelectOption key={d} value={String(d)}>
                          {t(`aiAutomations.weekdays.${d}`)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                {automation.kind === 'monthly' ? (
                  <Field>
                    <FieldLabel htmlFor='automation-day'>
                      {t('aiAutomations.fields.monthDay')}
                    </FieldLabel>
                    <Input
                      id='automation-day'
                      type='number'
                      min={1}
                      max={28}
                      value={form.monthDay}
                      onChange={(e) => set('monthDay', e.target.value)}
                    />
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel htmlFor='automation-hour'>
                    {t('aiAutomations.fields.hour')}
                  </FieldLabel>
                  <NativeSelect
                    id='automation-hour'
                    className='w-full'
                    value={form.hour}
                    onChange={(e) => set('hour', e.target.value)}
                  >
                    {hours.map((h) => (
                      <NativeSelectOption key={h} value={String(h)}>
                        {String(h).padStart(2, '0')}:00
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            ) : null}
            {Object.keys(params).map((name) =>
              typeof automation?.params[name] === 'string' ? (
                <Field key={name}>
                  <FieldLabel htmlFor={`automation-param-${name}`}>
                    {t(`aiAutomations.fields.${name}`)}
                  </FieldLabel>
                  <Textarea
                    id={`automation-param-${name}`}
                    rows={3}
                    value={params[name]}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [name]: e.target.value }))
                    }
                  />
                  <FieldDescription>
                    {t(`aiAutomations.fieldHints.${name}`, {
                      defaultValue: '',
                    })}
                  </FieldDescription>
                </Field>
              ) : (
                <Field key={name}>
                  <FieldLabel htmlFor={`automation-param-${name}`}>
                    {t(`aiAutomations.fields.${name}`)}
                  </FieldLabel>
                  <Input
                    id={`automation-param-${name}`}
                    type='number'
                    min={0}
                    max={name === 'targetCount' ? 50 : 100}
                    value={params[name]}
                    onChange={(e) =>
                      setParams((p) => ({ ...p, [name]: e.target.value }))
                    }
                  />
                </Field>
              ),
            )}
          </FieldGroup>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
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

function RunTable({
  runs,
  onOpen,
}: {
  runs: Run[];
  onOpen: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('aiAutomations.runs.task')}</TableHead>
            <TableHead className='hidden md:table-cell'>
              {t('aiAutomations.runs.trigger')}
            </TableHead>
            <TableHead>{t('aiAutomations.runs.status')}</TableHead>
            <TableHead className='hidden md:table-cell'>
              {t('aiAutomations.runs.summary')}
            </TableHead>
            <TableHead>{t('aiAutomations.runs.startedAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              className='cursor-pointer'
              onClick={() => onOpen(run.id)}
            >
              <TableCell className='font-medium'>
                {t(`aiAutomations.tasks.${run.task}.title`)}
              </TableCell>
              <TableCell className='hidden md:table-cell'>
                {t(`aiAutomations.trigger.${run.trigger}`)}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'}>
                  {t(`aiAutomations.status.${run.status}`)}
                </Badge>
              </TableCell>
              <TableCell className='hidden max-w-xs truncate text-muted-foreground md:table-cell'>
                {run.error
                  ? t(`aiAutomations.skipReason.${run.error}`, {
                      defaultValue: run.error,
                    })
                  : (run.inputSummary ?? '—')}
              </TableCell>
              <TableCell className='tabular-nums'>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(new Date(run.startedAt))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunSheet({
  runId,
  onClose,
  onChanged,
}: {
  runId: string | null;
  onClose: () => void;
  /** A retry or a re-run created a new run: refresh the lists. */
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const run = useRemote<Run>(
    runId ? `talent/automations/runs/${encodeURIComponent(runId)}` : null,
  );
  const [acting, setActing] = useState(false);
  async function act(path: string): Promise<void> {
    setActing(true);
    try {
      const { data: outcome } = await api.request<{
        data: { status: string };
      }>({ path, method: 'POST' });
      toast.add({
        type: outcome.status === 'failed' ? 'error' : 'success',
        title: t('aiAutomations.runFinished', {
          status: t(`aiAutomations.status.${outcome.status}`),
        }),
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setActing(false);
    }
  }
  const format = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(value))
      : '—';
  const data = runId ? run.data : undefined;
  return (
    <Sheet
      open={Boolean(runId)}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{t('aiAutomations.runs.detailTitle')}</SheetTitle>
          <SheetDescription>
            {data ? t(`aiAutomations.tasks.${data.task}.title`) : ''}
          </SheetDescription>
        </SheetHeader>
        <div className='space-y-4 px-4 pb-6 text-sm'>
          {run.error ? (
            <LoadError error={run.error} onRetry={run.reload} />
          ) : !data ? (
            <BlockSkeleton rows={4} />
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={STATUS_VARIANT[data.status] ?? 'outline'}>
                  {t(`aiAutomations.status.${data.status}`)}
                </Badge>
                <span className='text-muted-foreground'>
                  {t(`aiAutomations.trigger.${data.trigger}`)} ·{' '}
                  {format(data.startedAt)}
                </span>
                <span className='text-muted-foreground'>
                  {t('aiAutomations.runs.owner')}：{data.ownerName ?? '—'}
                </span>
              </div>
              {data.fallback ? (
                <Alert>
                  <AlertDescription>
                    {t('aiAutomations.runs.fallback')}
                  </AlertDescription>
                </Alert>
              ) : null}
              {data.status === 'failed' ||
              (data.task === 'hrAssistant.importCheck' &&
                typeof data.triggerRef?.batchId === 'string') ? (
                <div className='flex flex-wrap gap-2'>
                  {data.status === 'failed' ? (
                    <Button
                      size='sm'
                      disabled={acting}
                      onClick={() =>
                        void act(
                          `talent/automations/runs/${encodeURIComponent(data.id)}/retry`,
                        )
                      }
                    >
                      {t('aiAutomations.runs.retry')}
                    </Button>
                  ) : null}
                  {data.task === 'hrAssistant.importCheck' &&
                  typeof data.triggerRef?.batchId === 'string' ? (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={acting}
                      onClick={() =>
                        void act(
                          `talent/automations/import-check/${encodeURIComponent(String(data.triggerRef?.batchId))}`,
                        )
                      }
                    >
                      {t('aiAutomations.runs.rerunBatch', {
                        batch: String(data.triggerRef.batchId),
                      })}
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {data.triggerRef ? (
                <Section title={t('aiAutomations.runs.triggerRef')}>
                  <p className='font-mono text-xs break-all'>
                    {Object.entries(data.triggerRef)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(' · ')}
                  </p>
                </Section>
              ) : null}
              {data.error ? (
                <Section title={t('aiAutomations.runs.error')}>
                  <p className='font-mono text-xs break-all text-destructive'>
                    {t(`aiAutomations.skipReason.${data.error}`, {
                      defaultValue: data.error,
                    })}
                  </p>
                </Section>
              ) : null}
              {isRecord(data.output) &&
              typeof data.output.report === 'string' ? (
                <Section title={t('aiAutomations.runs.report')}>
                  <Markdown>{data.output.report}</Markdown>
                </Section>
              ) : null}
              {data.inputSummary ? (
                <Section title={t('aiAutomations.runs.inputSummary')}>
                  <p>{data.inputSummary}</p>
                </Section>
              ) : null}
              <Section title={t('aiAutomations.runs.items')}>
                {data.items.length ? (
                  <ul className='space-y-1.5'>
                    {data.items.map((item) => {
                      const path = entityPath(item.entityType, item.entityId);
                      return (
                        <li
                          key={`${item.entityType}-${item.entityId}`}
                          className='flex flex-wrap items-center justify-between gap-2'
                        >
                          <span>
                            {t(`aiAutomations.entity.${item.entityType}`)}{' '}
                            {path ? (
                              <Link
                                to={path}
                                className='font-mono text-xs text-primary underline-offset-4 hover:underline'
                              >
                                {item.entityId.slice(0, 8)}
                              </Link>
                            ) : null}
                          </span>
                          <span className='text-xs text-muted-foreground'>
                            {t(`aiAutomations.outcome.${item.outcome}`)}
                            {item.outcomeByName
                              ? ` · ${item.outcomeByName}`
                              : ''}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className='text-muted-foreground'>
                    {t('aiAutomations.runs.noItems')}
                  </p>
                )}
              </Section>
              {data.output ? (
                <Section title={t('aiAutomations.runs.output')}>
                  <pre className='max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap'>
                    {JSON.stringify(data.output, null, 2)}
                  </pre>
                </Section>
              ) : null}
              {data.references ? (
                <Section title={t('aiAutomations.runs.references')}>
                  <pre className='max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap'>
                    {JSON.stringify(data.references, null, 2)}
                  </pre>
                </Section>
              ) : null}
              {data.conversationSessionId ? (
                <p className='text-xs text-muted-foreground'>
                  {t('aiAutomations.runs.conversation')}：
                  <span className='font-mono'>
                    {data.conversationSessionId}
                  </span>
                </p>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
  return (
    <section className='space-y-1.5'>
      <h3 className='text-xs font-medium text-muted-foreground'>{title}</h3>
      {children}
    </section>
  );
}

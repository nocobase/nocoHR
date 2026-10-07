import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleMinusIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/**
 * 设置 · 上线准备: the go-live steps in order, each with its status computed by
 * `GET talent/go-live/status` from the tables, a short explanation, what the
 * status was computed from, and a button to the page where the step is done.
 * HR administrators see every step; payroll sees its own. A step a customer
 * does not need is marked as such by whoever owns it. The activation link
 * lifetime sits beside 员工账号开通 for HR administrators.
 */

export type StepKey =
  | 'config'
  | 'departments'
  | 'positions'
  | 'employees'
  | 'contracts'
  | 'leaveOpening'
  | 'salaries'
  | 'insurance'
  | 'deductions'
  | 'taxOpening'
  | 'accounts'
  | 'trialPayroll';
export type StepStatus =
  'notStarted' | 'inProgress' | 'done' | 'skipped' | 'notNeeded';

export interface GoLiveStep {
  key: StepKey;
  group: 'hr' | 'payroll';
  status: StepStatus;
  facts: Record<string, unknown>;
  skipped: boolean;
  canSkip: boolean;
}

export interface GoLiveStatus {
  steps: GoLiveStep[];
  remaining: number;
  firstPayrollMonth: string;
  firstPayrollMonthConfigured: string;
  revision: number;
  can: { setFirstPayrollMonth: boolean };
}

/** Where each step is done. */
function stepLink(step: GoLiveStep): string {
  switch (step.key) {
    case 'config':
      return '/settings/mail';
    case 'departments':
      return step.facts.feishu
        ? '/settings/org-sync'
        : '/settings/departments/import';
    case 'positions':
      return '/talent/positions/import';
    case 'employees':
      return '/talent/employees/import';
    case 'contracts':
      return '/talent/contracts/import';
    case 'leaveOpening':
      return '/talent/leave/balances/import';
    case 'salaries':
      return '/talent/salaries';
    case 'insurance':
    case 'deductions':
      return '/talent/social-insurance';
    case 'taxOpening':
    case 'trialPayroll':
      return '/talent/payroll';
    case 'accounts':
      return '/talent/employees';
  }
}

const STATUS_ICON = {
  notStarted: CircleDashedIcon,
  inProgress: CircleDotIcon,
  done: CircleCheckIcon,
  skipped: CircleMinusIcon,
  notNeeded: CircleMinusIcon,
} as const;

export function StepStatusBadge({
  status,
}: {
  status: StepStatus;
}): ReactElement {
  const { t } = useTranslation();
  const Icon = STATUS_ICON[status];
  return (
    <Badge
      variant={
        status === 'done'
          ? 'default'
          : status === 'inProgress'
            ? 'secondary'
            : 'outline'
      }
    >
      <Icon data-icon='inline-start' />
      {t(`goLive.status.${status}`)}
    </Badge>
  );
}

/** One line on what the status was computed from. */
function StepFacts({ step }: { step: GoLiveStep }): ReactElement | null {
  const { t } = useTranslation();
  const f = step.facts as Record<string, never>;
  const lines: string[] = [];
  switch (step.key) {
    case 'config':
      return (
        <ul className='flex flex-wrap gap-2'>
          {(
            ['companyName', 'publicOrigin', 'mail', 'feishu', 'ai'] as const
          ).map((key) => (
            <li key={key}>
              <Badge variant={f[key] ? 'secondary' : 'outline'}>
                {f[key] ? (
                  <CircleCheckIcon data-icon='inline-start' />
                ) : (
                  <CircleDashedIcon data-icon='inline-start' />
                )}
                {t(`goLive.facts.${key}`)} ·{' '}
                {t(
                  f[key]
                    ? 'goLive.facts.configured'
                    : 'goLive.facts.notConfigured',
                )}
              </Badge>
            </li>
          ))}
        </ul>
      );
    case 'departments': {
      lines.push(t('goLive.facts.count', { count: f.count }));
      const sync = f.lastSync as { status?: string } | null;
      if (sync?.status)
        lines.push(
          t('goLive.facts.lastSync', {
            status: t(`goLive.facts.syncStatus.${sync.status}`, {
              defaultValue: sync.status,
            }),
          }),
        );
      break;
    }
    case 'positions':
      lines.push(t('goLive.facts.count', { count: f.count }));
      break;
    case 'employees': {
      lines.push(t('goLive.facts.count', { count: f.count }));
      const batch = f.lastImport as {
        id: string;
        createdCount: number;
        updatedCount: number;
      } | null;
      if (batch)
        lines.push(
          t('goLive.facts.lastImport', {
            id: batch.id,
            created: batch.createdCount,
            updated: batch.updatedCount,
          }),
        );
      break;
    }
    case 'deductions':
      lines.push(
        t('goLive.facts.declared', { covered: f.covered, year: f.year }),
      );
      break;
    case 'taxOpening':
      lines.push(
        t('goLive.facts.firstPayrollMonth', { month: f.firstPayrollMonth }),
      );
      if (f.available === false) lines.push(t('goLive.facts.notAvailable'));
      else if (step.status !== 'notNeeded')
        lines.push(
          t('goLive.facts.coverage', { covered: f.covered, total: f.total }),
        );
      break;
    case 'accounts':
      lines.push(
        t('goLive.facts.accounts', {
          activated: f.activated,
          pending: f.pending,
          withoutAccount: f.withoutAccount,
        }),
      );
      break;
    case 'trialPayroll':
      lines.push(
        t('goLive.facts.cycles', {
          calculated: f.calculated,
          cycles: f.cycles,
        }),
      );
      break;
    default:
      lines.push(
        t('goLive.facts.coverage', {
          covered: f.covered,
          total: f.total,
        }),
      );
  }
  return <p className='text-sm text-muted-foreground'>{lines.join(' · ')}</p>;
}

function StepRow({
  step,
  index,
  onChanged,
}: {
  step: GoLiveStep;
  index: number;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [pending, setPending] = useState(false);
  const title = t(`goLive.steps.${step.key}.title`);
  async function toggle(): Promise<void> {
    setPending(true);
    try {
      await api.request({
        path: `talent/go-live/steps/${step.key}`,
        method: 'PUT',
        json: { skipped: !step.skipped },
      });
      toast.add({
        type: 'success',
        title: t(
          step.skipped ? 'goLive.unskippedToast' : 'goLive.skippedToast',
          {
            step: title,
          },
        ),
      });
      onChanged();
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
    } finally {
      setPending(false);
    }
  }
  return (
    <li
      className='flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start'
      data-step={step.key}
    >
      <span
        aria-hidden
        className='flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground tabular-nums'
      >
        {index}
      </span>
      <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
        <div className='flex flex-wrap items-center gap-2'>
          <h3 className='font-medium'>{title}</h3>
          <StepStatusBadge status={step.status} />
          {step.group === 'payroll' ? (
            <Badge variant='ghost' className='text-muted-foreground'>
              {t('goLive.groups.payroll')}
            </Badge>
          ) : null}
        </div>
        <p className='text-sm text-muted-foreground'>
          {t(`goLive.steps.${step.key}.description`)}
        </p>
        <StepFacts step={step} />
      </div>
      <div className='flex shrink-0 flex-wrap gap-2'>
        {step.canSkip && step.status !== 'notNeeded' ? (
          <Button
            variant='ghost'
            size='sm'
            disabled={pending}
            onClick={() => void toggle()}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {step.skipped ? t('goLive.unskip') : t('goLive.skip')}
          </Button>
        ) : null}
        <Button
          variant={
            step.status === 'notStarted' || step.status === 'inProgress'
              ? 'outline'
              : 'ghost'
          }
          size='sm'
          nativeButton={false}
          render={<Link to={stepLink(step)} />}
        >
          {t(`goLive.steps.${step.key}.action`)}
        </Button>
      </div>
    </li>
  );
}

function FirstPayrollMonth({
  status,
  onSaved,
}: {
  status: GoLiveStatus;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [value, setValue] = useState(status.firstPayrollMonthConfigured);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function save(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/go-live/first-payroll-month',
        method: 'PUT',
        json: { revision: status.revision, firstPayrollMonth: value },
      });
      toast.add({ type: 'success', title: t('goLive.firstMonth.saved') });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Field className='max-w-sm'>
      <FieldLabel htmlFor='go-live-first-month'>
        {t('goLive.firstMonth.label')}
      </FieldLabel>
      <div className='flex gap-2'>
        <Input
          id='go-live-first-month'
          type='month'
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button
          variant='outline'
          disabled={pending}
          onClick={() => void save()}
        >
          {pending ? <Spinner data-icon='inline-start' /> : null}
          {t('goLive.firstMonth.save')}
        </Button>
      </div>
      <FieldDescription>{t('goLive.firstMonth.description')}</FieldDescription>
      {error ? <FieldError>{error}</FieldError> : null}
    </Field>
  );
}

interface ActivationSettings {
  value: { linkDays: number };
  revision: number;
}

function ActivationSettingsCard(): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const remote = useRemote<ActivationSettings>(
    'talent/go-live/activation-settings',
  );
  const [days, setDays] = useState<string>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  if (!remote.data) return null;
  const current = days ?? String(remote.data.value.linkDays);
  async function save(): Promise<void> {
    if (!remote.data) return;
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/go-live/activation-settings',
        method: 'PUT',
        json: {
          revision: remote.data.revision,
          value: { linkDays: Number(current) },
        },
      });
      toast.add({ type: 'success', title: t('goLive.activation.saved') });
      setDays(undefined);
      remote.reload();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('goLive.activation.settingsTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <Field className='max-w-sm'>
          <FieldLabel htmlFor='go-live-link-days'>
            {t('goLive.activation.linkDays')}
          </FieldLabel>
          <div className='flex gap-2'>
            <Input
              id='go-live-link-days'
              type='number'
              min={1}
              max={30}
              inputMode='numeric'
              value={current}
              onChange={(event) => setDays(event.target.value)}
            />
            <Button
              variant='outline'
              disabled={pending}
              onClick={() => void save()}
            >
              {pending ? <Spinner data-icon='inline-start' /> : null}
              {t('goLive.firstMonth.save')}
            </Button>
          </div>
          <FieldDescription>
            {t('goLive.activation.linkDaysDescription')}
          </FieldDescription>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </CardContent>
    </Card>
  );
}

export default function GoLivePage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<GoLiveStatus>('talent/go-live/status');
  // 人事设置's permission: the activation link lifetime is a personnel setting.
  const personnel = useCan({
    resource: { type: 'settings', id: 'talent.hr' },
    action: 'administer',
  });
  const data = remote.data;
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('goLive.title')}
        description={t('goLive.description')}
        actions={
          data ? (
            <Badge variant={data.remaining ? 'secondary' : 'default'}>
              {data.remaining
                ? t('goLive.remaining', { count: data.remaining })
                : t('goLive.allDone')}
            </Badge>
          ) : undefined
        }
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <>
          <Card>
            <CardContent>
              <ol className='flex flex-col divide-y'>
                {data.steps.map((step, index) => (
                  <StepRow
                    key={step.key}
                    step={step}
                    index={index + 1}
                    onChanged={remote.reload}
                  />
                ))}
              </ol>
            </CardContent>
            {data.can.setFirstPayrollMonth ? (
              <CardFooter>
                <FirstPayrollMonth
                  key={data.revision}
                  status={data}
                  onSaved={remote.reload}
                />
              </CardFooter>
            ) : null}
          </Card>
          {personnel.can ? <ActivationSettingsCard /> : null}
        </>
      )}
    </PageContainer>
  );
}

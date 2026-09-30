import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useLookups } from '@/components/talent/use-lookups';

import { ApprovalChainCard } from './approval-chain-card.js';
import { ChecklistsCard, ComplianceCard, DraftsCard } from './change-cards.js';
import {
  GradeOrderCard,
  JobInfoCard,
  KnowledgeReviewCard,
  SelfServiceCard,
} from './other-cards.js';
import type { AllSettings, SettingsOptions } from './types.js';

interface Snapshot {
  revision: number;
  value: {
    probationDays?: number;
    contractDays?: number[];
    dailyTime?: string;
    maxMonths?: number;
  };
}
interface Settings {
  reminders: Snapshot;
  probation: Snapshot;
}
type Section = keyof Settings;

function windowsOf(value: string): number[] {
  return value
    .split(/[,，]/u)
    .map((part) => (/^\d+$/u.test(part.trim()) ? Number(part.trim()) : NaN));
}

export default function PersonnelSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<AllSettings>('talent/personnel-settings');
  const options = useRemote<SettingsOptions>(
    'talent/personnel-settings/options',
  );
  const lookups = useLookups();
  const error = remote.error ?? options.error ?? lookups.error;
  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={t('personnelSettings.title')}
        description={t('personnelSettings.description')}
      />
      {error ? (
        <LoadError
          error={error}
          onRetry={() => {
            remote.reload();
            options.reload();
            lookups.reload();
          }}
        />
      ) : remote.data && options.data && !lookups.loading ? (
        <>
          <SettingsCard
            key={`reminders-${remote.data.reminders.revision}`}
            section='reminders'
            initial={remote.data.reminders}
          />
          <SettingsCard
            key={`probation-${remote.data.probation.revision}`}
            section='probation'
            initial={remote.data.probation}
          />
          <ApprovalChainCard
            // A draft applied below changes the chain: a new revision remounts the card with it.
            key={`chain-${remote.data.approvalChain.revision}`}
            initial={remote.data.approvalChain}
            departments={lookups.departments}
            options={options.data}
          />
          <SelfServiceCard initial={remote.data.selfService} />
          <GradeOrderCard
            initial={remote.data.gradeOrder}
            options={options.data}
          />
          <JobInfoCard initial={remote.data.jobInfo} />
          {remote.data.knowledge ? (
            <KnowledgeReviewCard initial={remote.data.knowledge} />
          ) : null}
          {remote.data.checklists ? (
            <ChecklistsCard
              key={`checklists-${remote.data.checklists.revision}`}
              initial={remote.data.checklists}
            />
          ) : null}
          {remote.data.compliance ? (
            <ComplianceCard
              key={`compliance-${remote.data.compliance.revision}`}
              initial={remote.data.compliance}
            />
          ) : null}
          {/* 一句话改配置: an applied draft changes the chain or a section, so the page reloads its cards. */}
          <DraftsCard onApplied={remote.reload} />
        </>
      ) : (
        <BlockSkeleton rows={6} />
      )}
    </PageContainer>
  );
}

function SettingsCard({
  section,
  initial,
}: {
  readonly section: Section;
  readonly initial: Snapshot;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const reminders = section === 'reminders';
  const [snapshot, setSnapshot] = useState(initial);
  const [conflict, setConflict] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [reloading, setReloading] = useState(false);
  const defaults = (item: Snapshot) => ({
    first: String(reminders ? item.value.probationDays : item.value.maxMonths),
    windows: (item.value.contractDays ?? []).join(', '),
    dailyTime: item.value.dailyTime ?? '09:00',
  });
  const schema = useMemo(
    () =>
      z.object({
        first: z
          .string()
          .refine(
            (v) =>
              /^\d+$/u.test(v.trim()) && Number(v) <= (reminders ? 365 : 6),
            t(
              reminders
                ? 'personnelSettings.invalidDays'
                : 'personnelSettings.invalidMonths',
            ),
          ),
        windows: z.string().refine((v) => {
          if (!reminders) return true;
          const values = windowsOf(v);
          return (
            values.length <= 12 &&
            values.every((n) => Number.isInteger(n) && n >= 0 && n <= 365) &&
            new Set(values).size === values.length
          );
        }, t('personnelSettings.invalidWindows')),
        dailyTime: z
          .string()
          .refine(
            (v) => !reminders || /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(v.trim()),
            t('personnelSettings.invalidTime'),
          ),
      }),
    [t, reminders],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: defaults(initial),
  });
  const busy = form.formState.isSubmitting || reloading;
  const firstId = `personnel-${section}-first`;
  const windowId = `personnel-${section}-windows`;
  const handleSave = form.handleSubmit(async (values) => {
    if (conflict || busy) return;
    try {
      const result = await api.request<{ data: Snapshot }>({
        path: `talent/personnel-settings/${section}`,
        method: 'PATCH',
        json: {
          revision: snapshot.revision,
          value: reminders
            ? {
                probationDays: Number(values.first),
                contractDays: windowsOf(values.windows),
                dailyTime: values.dailyTime.trim(),
              }
            : { maxMonths: Number(values.first) },
        },
      });
      setSnapshot(result.data);
      form.reset(defaults(result.data));
      toast.add({
        type: 'success',
        title: t('personnelSettings.saved', {
          section: t(`personnelSettings.${section}.title`),
        }),
      });
    } catch (error) {
      const status = error instanceof ApiClientError ? error.status : undefined;
      setConflict(status === 409);
      form.setError('root', {
        message: t(
          status === 409
            ? 'personnelSettings.conflict'
            : status === 403
              ? 'personnelSettings.forbidden'
              : 'personnelSettings.failed',
        ),
      });
    }
  });
  async function reload(): Promise<void> {
    setConfirmReload(false);
    setReloading(true);
    try {
      const { data } = await api.request<{ data: Settings }>({
        path: 'talent/personnel-settings',
      });
      setSnapshot(data[section]);
      form.reset(defaults(data[section]));
      setConflict(false);
      requestAnimationFrame(() => form.setFocus('first'));
    } catch (error) {
      form.setError('root', {
        message: t(
          error instanceof ApiClientError && error.status === 403
            ? 'personnelSettings.forbidden'
            : 'personnelSettings.failed',
        ),
      });
    } finally {
      setReloading(false);
    }
  }
  return (
    <>
      <form noValidate onSubmit={(event) => void handleSave(event)}>
        <Card>
          <CardHeader>
            <CardTitle>{t(`personnelSettings.${section}.title`)}</CardTitle>
            <CardDescription>
              {t(`personnelSettings.${section}.description`)}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {form.formState.errors.root ? (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {form.formState.errors.root.message}
                  </AlertDescription>
                </Alert>
              ) : null}
              <Field data-invalid={Boolean(form.formState.errors.first)}>
                <FieldLabel htmlFor={firstId}>
                  {t(
                    reminders
                      ? 'personnelSettings.probationDays'
                      : 'personnelSettings.maxMonths',
                  )}{' '}
                  *
                </FieldLabel>
                <Input
                  {...form.register('first')}
                  id={firstId}
                  inputMode='numeric'
                  disabled={busy}
                  aria-required='true'
                  aria-invalid={Boolean(form.formState.errors.first)}
                />
                <FieldError errors={[form.formState.errors.first]} />
              </Field>
              {reminders ? (
                <Field data-invalid={Boolean(form.formState.errors.windows)}>
                  <FieldLabel htmlFor={windowId}>
                    {t('personnelSettings.contractDays')} *
                  </FieldLabel>
                  <Input
                    {...form.register('windows')}
                    id={windowId}
                    disabled={busy}
                    aria-required='true'
                    aria-invalid={Boolean(form.formState.errors.windows)}
                  />
                  <FieldError errors={[form.formState.errors.windows]} />
                </Field>
              ) : null}
              {reminders ? (
                <Field data-invalid={Boolean(form.formState.errors.dailyTime)}>
                  <FieldLabel htmlFor={`personnel-${section}-time`}>
                    {t('personnelSettings.dailyTime')} *
                  </FieldLabel>
                  <Input
                    {...form.register('dailyTime')}
                    id={`personnel-${section}-time`}
                    type='time'
                    disabled={busy}
                    aria-required='true'
                    aria-invalid={Boolean(form.formState.errors.dailyTime)}
                  />
                  <FieldDescription>
                    {t('personnelSettings.dailyTimeHint')}
                  </FieldDescription>
                  <FieldError errors={[form.formState.errors.dailyTime]} />
                </Field>
              ) : null}
            </FieldGroup>
          </CardContent>
          <CardFooter className='justify-end gap-2'>
            {conflict ? (
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => setConfirmReload(true)}
              >
                {t('personnelSettings.reload')}
              </Button>
            ) : null}
            <Button
              type='submit'
              variant='outline'
              disabled={busy || conflict || !form.formState.isDirty}
            >
              {busy ? <Spinner data-icon='inline-start' /> : null}
              {t(busy ? 'personnelSettings.saving' : 'actions.save')}
            </Button>
          </CardFooter>
        </Card>
      </form>
      <AlertDialog open={confirmReload} onOpenChange={setConfirmReload}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('personnelSettings.discardTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('personnelSettings.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void reload()}
            >
              {t('personnelSettings.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

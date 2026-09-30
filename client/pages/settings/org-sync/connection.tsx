import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext } from 'react-router';

import {
  errorCode,
  errorDetails,
  errorMessage,
} from '@/components/talent/errors';
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
import { Badge } from '@/components/ui/badge';
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
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

import { formatDateTime, runStatusVariant } from './helpers.js';
import {
  PROVIDERS,
  type OrgMaster,
  type OrgSyncOutletContext,
  type OrgSyncStatus,
  type SettingsSnapshot,
} from './types.js';

/** Tab 连接设置: sync settings, the data source's state and the data master. */
export default function OrgSyncConnectionTab(): ReactElement {
  const { status, statusError, reloadStatus } =
    useOutletContext<OrgSyncOutletContext>();
  if (statusError && !status)
    return <LoadError error={statusError} onRetry={reloadStatus} />;
  if (!status) return <BlockSkeleton rows={6} />;
  const data = status;
  const reload = reloadStatus;
  return (
    <div className='grid max-w-4xl gap-6'>
      <SettingsCard
        key={data.settings.revision}
        snapshot={data.settings}
        onReload={reload}
      />
      <SourceCard status={data} />
      <MasterCard snapshot={data.settings} onChanged={reload} />
    </div>
  );
}

function SettingsCard({
  snapshot,
  onReload,
}: {
  snapshot: SettingsSnapshot;
  onReload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'configure',
  });
  const initial = snapshot.value;
  const [provider, setProvider] = useState(initial.provider);
  const [scope, setScope] = useState(initial.scopeRootDepartments.join(', '));
  const [tree, setTree] = useState(initial.syncDepartmentTree);
  const [time, setTime] = useState(initial.fullSyncTime);
  const [months, setMonths] = useState(String(initial.syncedProbationMonths));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [timeError, setTimeError] = useState<string>();
  const roots = scope
    .split(/[,，\s]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const dirty =
    provider !== initial.provider ||
    roots.join() !== initial.scopeRootDepartments.join() ||
    tree !== initial.syncDepartmentTree ||
    time !== initial.fullSyncTime ||
    Number(months) !== initial.syncedProbationMonths;
  const readOnly = !grant.can;

  async function save(): Promise<void> {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(time)) {
      setTimeError(t('orgSync.settings.timeInvalid'));
      return;
    }
    setTimeError(undefined);
    setSaving(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/org-sync/settings',
        method: 'PATCH',
        json: {
          revision: snapshot.revision,
          value: {
            provider,
            scopeRootDepartments: roots,
            syncDepartmentTree: tree,
            fullSyncTime: time,
            syncedProbationMonths: Number(months),
          },
        },
      });
      toast.add({ type: 'success', title: t('orgSync.settings.saved') });
      onReload();
    } catch (cause) {
      const isConflict =
        cause instanceof ApiClientError && cause.status === 409;
      setConflict(isConflict);
      setError(
        isConflict ? t('orgSync.settings.conflict') : errorMessage(cause, t),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orgSync.settings.title')}</CardTitle>
        <CardDescription>{t('orgSync.settings.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <FieldGroup>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='org-sync-provider'>
                {t('orgSync.settings.provider')}
              </FieldLabel>
              <NativeSelect
                id='org-sync-provider'
                value={provider}
                disabled={readOnly || saving}
                onChange={(e) => setProvider(e.target.value as typeof provider)}
              >
                {PROVIDERS.map((p) => (
                  <NativeSelectOption
                    key={p}
                    value={p}
                    disabled={p !== 'feishu'}
                  >
                    {p === 'feishu'
                      ? t(`orgSync.provider.${p}`)
                      : t('orgSync.settings.providerUnavailable', {
                          name: t(`orgSync.provider.${p}`),
                        })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                {t('orgSync.settings.providerNote')}
              </FieldDescription>
            </Field>
            <Field data-invalid={Boolean(timeError)}>
              <FieldLabel htmlFor='org-sync-time'>
                {t('orgSync.settings.fullSyncTime')}
              </FieldLabel>
              <Input
                id='org-sync-time'
                type='time'
                value={time}
                disabled={readOnly || saving}
                aria-invalid={Boolean(timeError)}
                onChange={(e) => setTime(e.target.value)}
              />
              {timeError ? (
                <FieldDescription className='text-destructive'>
                  {timeError}
                </FieldDescription>
              ) : (
                <FieldDescription>
                  {t('orgSync.settings.fullSyncTimeHint')}
                </FieldDescription>
              )}
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor='org-sync-scope'>
              {t('orgSync.settings.scope')}
            </FieldLabel>
            <Input
              id='org-sync-scope'
              value={scope}
              disabled={readOnly || saving}
              placeholder={t('orgSync.settings.scopePlaceholder')}
              onChange={(e) => setScope(e.target.value)}
            />
            <FieldDescription>
              {t('orgSync.settings.scopeHint')}
            </FieldDescription>
          </Field>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field orientation='horizontal'>
              <Switch
                id='org-sync-tree'
                checked={tree}
                disabled={readOnly || saving}
                onCheckedChange={(checked) => setTree(checked)}
              />
              <FieldLabel htmlFor='org-sync-tree'>
                {t('orgSync.settings.syncDepartmentTree')}
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor='org-sync-probation'>
                {t('orgSync.settings.probationMonths')}
              </FieldLabel>
              <NativeSelect
                id='org-sync-probation'
                value={months}
                disabled={readOnly || saving}
                onChange={(e) => setMonths(e.target.value)}
              >
                {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    {n}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <FieldDescription>
                {t('orgSync.settings.probationHint')}
              </FieldDescription>
            </Field>
          </div>
        </FieldGroup>
      </CardContent>
      {readOnly ? null : (
        <CardFooter className='justify-end gap-2'>
          {conflict ? (
            <Button variant='outline' disabled={saving} onClick={onReload}>
              {t('orgSync.settings.reload')}
            </Button>
          ) : null}
          <Button
            variant='outline'
            disabled={saving || conflict || !dirty}
            onClick={() => void save()}
          >
            {saving ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

function SourceCard({ status }: { status: OrgSyncStatus }): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const run = status.lastRun;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orgSync.source.title')}</CardTitle>
        <CardDescription>{t('orgSync.source.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className='grid gap-3 text-sm sm:grid-cols-[10rem_1fr]'>
          <dt className='text-muted-foreground'>
            {t('orgSync.settings.provider')}
          </dt>
          <dd>{t(`orgSync.provider.${status.settings.value.provider}`)}</dd>
          <dt className='text-muted-foreground'>{t('orgSync.source.kind')}</dt>
          <dd>
            {!status.source
              ? t('orgSync.source.none')
              : status.source.label === 'mock'
                ? t('orgSync.source.mock')
                : t('orgSync.source.live')}
          </dd>
          <dt className='text-muted-foreground'>
            {t('orgSync.source.credentials')}
          </dt>
          <dd>
            <Badge
              variant={status.source?.configured ? 'secondary' : 'outline'}
            >
              {t(
                status.source?.configured
                  ? 'orgSync.source.configured'
                  : 'orgSync.source.notConfigured',
              )}
            </Badge>
          </dd>
          <dt className='text-muted-foreground'>
            {t('orgSync.source.lastRun')}
          </dt>
          <dd className='flex flex-wrap items-center gap-2'>
            {run ? (
              <>
                <span className='tabular-nums'>
                  {formatDateTime(run.finishedAt ?? run.startedAt, locale)}
                </span>
                <Badge variant={runStatusVariant(run.status)}>
                  {t(`orgSync.runStatus.${run.status}`)}
                </Badge>
              </>
            ) : (
              t('orgSync.source.neverRun')
            )}
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

interface BlockingAction {
  readonly id: string;
  readonly actionType: string;
  readonly employeeId: string | null;
  readonly status: string;
}

function MasterCard({
  snapshot,
  onChanged,
}: {
  snapshot: SettingsSnapshot;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'switchMaster',
  });
  const value = snapshot.value;
  const target: OrgMaster =
    value.orgMaster === 'nocohr' ? 'external' : 'nocohr';
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [blocking, setBlocking] = useState<BlockingAction[]>([]);
  const users = useRemote<{ id: string; name: string }[]>(
    value.masterChangedBy ? 'talent/users' : null,
  );
  const changedBy = value.masterChangedBy
    ? (users.data?.find((u) => u.id === value.masterChangedBy)?.name ??
      value.masterChangedBy)
    : null;
  const provider = t(`orgSync.provider.${value.provider}`);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(undefined);
    setBlocking([]);
    try {
      await api.request({
        path: 'talent/org-sync/master',
        method: 'POST',
        json: { revision: snapshot.revision, orgMaster: target },
      });
      toast.add({
        type: 'success',
        title: t('orgSync.master.switched', {
          master: t(`orgSync.master.value.${target}`, { provider }),
        }),
      });
      setOpen(false);
      onChanged();
    } catch (cause) {
      if (errorCode(cause) === 'ORG_MASTER_OPEN_ACTIONS') {
        const details = errorDetails(cause) as
          { actions?: BlockingAction[] } | undefined;
        setBlocking(details?.actions ?? []);
        setError(t('talent.errors.ORG_MASTER_OPEN_ACTIONS'));
      } else setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('orgSync.master.title')}</CardTitle>
        <CardDescription>{t('orgSync.master.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <p className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground'>
            {t('orgSync.master.current')}
          </span>
          <Badge variant='secondary'>
            {t(`orgSync.master.value.${value.orgMaster}`, { provider })}
          </Badge>
        </p>
        <p className='text-muted-foreground'>
          {t(`orgSync.master.explain.${value.orgMaster}`, { provider })}
        </p>
        {value.masterChangedAt ? (
          <p className='text-muted-foreground'>
            {t('orgSync.master.changed', {
              name: changedBy ?? '—',
              time: formatDateTime(value.masterChangedAt, locale),
            })}
          </p>
        ) : null}
      </CardContent>
      {grant.can ? (
        <CardFooter className='justify-end'>
          <Button
            variant='outline'
            onClick={() => {
              setError(undefined);
              setBlocking([]);
              setOpen(true);
            }}
          >
            {t('orgSync.master.switch', {
              master: t(`orgSync.master.value.${target}`, { provider }),
            })}
          </Button>
        </CardFooter>
      ) : null}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('orgSync.master.confirmTitle', {
                master: t(`orgSync.master.value.${target}`, { provider }),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(`orgSync.master.impact.${target}`, { provider })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {target === 'external' ? (
            <p className='text-sm text-muted-foreground'>
              {t('orgSync.master.openActionsHint')}
            </p>
          ) : null}
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>
                <p>{error}</p>
                {blocking.length ? (
                  <ul className='mt-2 space-y-1'>
                    {blocking.map((a) => (
                      <li key={a.id}>
                        <Link
                          className='underline underline-offset-4'
                          to={`/talent/actions/${encodeURIComponent(a.id)}`}
                        >
                          {t('orgSync.master.blockingAction', {
                            type: t(`talent.actionType.${a.actionType}`),
                            status: t(`talent.actionStatus.${a.status}`),
                          })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={pending || blocking.length > 0}
              onClick={(event) => {
                event.preventDefault();
                void confirm();
              }}
            >
              {pending ? <Spinner data-icon='inline-start' /> : null}
              {t('orgSync.master.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

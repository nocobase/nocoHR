import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { ExternalLinkIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorCode, errorMessage } from '@/components/talent/errors';
import { LicensedShiftRequirementsCard } from '@/components/talent/licensed-shift-certifications';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

/** `GET talent/licensed/settings` (server/providers/hr/licensed/settings.ts). */
export interface LicensedSettingsData {
  value: {
    enabled: boolean;
    certificationOnlyPermissionSets: string[];
    scheduleCheckEnabled: boolean;
    transferCheckEnabled: boolean;
  };
  enabledRevision: number;
  packRevision: number;
  history: {
    at: string;
    userId: string;
    field: 'enabled' | 'certificationOnlyPermissionSets';
    from: unknown;
    to: unknown;
  }[];
  permissionSets: {
    key: string;
    title: string;
    protectedByOther: boolean;
    otherAssignments: number;
    certifications: string[];
    certificationTitles?: string[];
  }[];
}

const PATH = 'talent/licensed/settings';

/**
 * 设置 / 持证上岗 (V4-14, hr.admin): the industry pack switch, the permission
 * sets obtainable only through a certification, the schedule and transfer
 * checks, the shifts' required certifications and the change log. Permission
 * sets are assigned to certifications in Settings → Authorization, not here.
 */
export default function LicensedOperationSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<LicensedSettingsData>(PATH);
  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={t('licensed.settings.title')}
        description={t('licensed.settings.description')}
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : remote.data ? (
        <>
          <LicensedSettingsForm
            key={`${remote.data.enabledRevision}-${remote.data.packRevision}`}
            initial={remote.data}
            onSaved={remote.reload}
          />
          <LicensedShiftRequirementsCard />
          <HistoryCard history={remote.data.history} />
          {import.meta.env.DEV ? <PrepareCard onDone={remote.reload} /> : null}
        </>
      ) : (
        <BlockSkeleton rows={6} />
      )}
    </PageContainer>
  );
}

export function LicensedSettingsForm({
  initial,
  onSaved,
}: {
  initial: LicensedSettingsData;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [value, setValue] = useState(initial.value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const listed = new Set(value.certificationOnlyPermissionSets);

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: PATH,
        method: 'PUT',
        json: {
          enabledRevision: initial.enabledRevision,
          packRevision: initial.packRevision,
          value,
        },
      });
      toast.add({ type: 'success', title: t('licensed.settings.saved') });
      onSaved();
    } catch (cause) {
      setError(
        errorCode(cause) === 'SETTINGS_CONFLICT'
          ? t('licensed.settings.conflict')
          : errorMessage(cause, t),
      );
    } finally {
      setBusy(false);
    }
  }

  const toggle = (
    key: 'enabled' | 'scheduleCheckEnabled' | 'transferCheckEnabled',
    labelKey: string,
    hintKey: string,
  ) => (
    <Field orientation='horizontal'>
      <FieldContent>
        <FieldLabel htmlFor={`licensed-${key}`}>{t(labelKey)}</FieldLabel>
        <FieldDescription>{t(hintKey)}</FieldDescription>
      </FieldContent>
      <Switch
        id={`licensed-${key}`}
        checked={value[key]}
        disabled={busy}
        onCheckedChange={(checked) => setValue({ ...value, [key]: checked })}
      />
    </Field>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.settings.pack')}</CardTitle>
        <CardDescription>
          {t('licensed.settings.packDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {toggle(
            'enabled',
            'licensed.settings.enabled',
            'licensed.settings.enabledHint',
          )}
          {toggle(
            'scheduleCheckEnabled',
            'licensed.settings.scheduleCheck',
            'licensed.settings.scheduleCheckHint',
          )}
          {toggle(
            'transferCheckEnabled',
            'licensed.settings.transferCheck',
            'licensed.settings.transferCheckHint',
          )}
          <Field>
            <FieldLabel>{t('licensed.settings.certificationOnly')}</FieldLabel>
            <FieldDescription>
              {t('licensed.settings.certificationOnlyDescription')}
            </FieldDescription>
            {initial.permissionSets.length ? (
              <ul className='flex flex-col gap-2'>
                {initial.permissionSets.map((set) => {
                  const id = `licensed-set-${set.key}`;
                  const blocked =
                    set.protectedByOther ||
                    (!listed.has(set.key) && set.otherAssignments > 0);
                  return (
                    <li
                      key={set.key}
                      className='flex flex-wrap items-center gap-2 text-sm'
                    >
                      <Checkbox
                        id={id}
                        checked={listed.has(set.key)}
                        disabled={busy || (blocked && !listed.has(set.key))}
                        onCheckedChange={(checked) =>
                          setValue({
                            ...value,
                            certificationOnlyPermissionSets: checked
                              ? [
                                  ...value.certificationOnlyPermissionSets,
                                  set.key,
                                ]
                              : value.certificationOnlyPermissionSets.filter(
                                  (key) => key !== set.key,
                                ),
                          })
                        }
                      />
                      <label htmlFor={id} className='font-medium'>
                        {set.title}
                      </label>
                      <span className='font-mono text-xs text-muted-foreground'>
                        {set.key}
                      </span>
                      {set.protectedByOther ? (
                        <Badge variant='outline'>
                          {t('licensed.settings.protectedByOther')}
                        </Badge>
                      ) : set.otherAssignments > 0 && !listed.has(set.key) ? (
                        <Badge variant='outline'>
                          {t('licensed.settings.otherAssignments', {
                            count: set.otherAssignments,
                          })}
                        </Badge>
                      ) : set.certifications.length ? (
                        <Badge variant='secondary'>
                          {set.certificationTitles?.length
                            ? t('licensed.settings.grantedBy', {
                                names: set.certificationTitles.join('、'),
                              })
                            : t('licensed.settings.assignedTo', {
                                count: set.certifications.length,
                              })}
                        </Badge>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('licensed.settings.noSets')}
              </p>
            )}
          </Field>
        </FieldGroup>
      </CardContent>
      <CardFooter className='flex flex-wrap justify-between gap-2'>
        <Link
          to='/settings/authorization/permission-sets'
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <ExternalLinkIcon data-icon='inline-start' />
          {t('licensed.settings.openAuthorization')}
        </Link>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? <Spinner data-icon='inline-start' /> : null}
          {t('licensed.settings.save')}
        </Button>
      </CardFooter>
    </Card>
  );
}

function HistoryCard({
  history,
}: {
  history: LicensedSettingsData['history'];
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.settings.history')}</CardTitle>
        <CardDescription>
          {t('licensed.settings.historyDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.length ? (
          <ul className='divide-y text-sm'>
            {history.map((entry) => (
              <li
                key={`${entry.at}-${entry.field}`}
                className='flex flex-wrap justify-between gap-2 py-2'
              >
                <span>
                  {entry.field === 'enabled'
                    ? t('licensed.settings.historyEnabled', {
                        state: t(
                          entry.to
                            ? 'licensed.settings.on'
                            : 'licensed.settings.off',
                        ),
                      })
                    : t('licensed.settings.historyList', {
                        list:
                          (Array.isArray(entry.to) ? entry.to : []).join(
                            '、',
                          ) || t('licensed.settings.none'),
                      })}
                </span>
                <span className='text-muted-foreground tabular-nums'>
                  {format(entry.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('licensed.settings.historyEmpty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Development only: the step's acceptance data (the server refuses it in production). */
function PrepareCard({ onDone }: { onDone: () => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  async function prepare(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.request<{
        data: { created: string[]; shifts: string[] };
      }>({ path: 'talent/licensed/demo/prepare', method: 'POST' });
      toast.add({
        type: 'success',
        title: t('licensed.settings.prepared', {
          people: result.data.created.join('、') || t('licensed.settings.none'),
          shifts: String(result.data.shifts.length),
        }),
      });
      onDone();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.settings.prepare')}</CardTitle>
        <CardDescription>
          {t('licensed.settings.prepareDescription')}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <Button
          variant='outline'
          disabled={busy}
          onClick={() => void prepare()}
        >
          {busy ? <Spinner data-icon='inline-start' /> : null}
          {t('licensed.settings.prepareButton')}
        </Button>
      </CardFooter>
    </Card>
  );
}

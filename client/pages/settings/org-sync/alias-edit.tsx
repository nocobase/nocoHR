import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { errorCode, errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { useRouteOverlay } from '@/components/use-route-overlay';

import type { AliasesOutletContext } from './aliases.js';
import { PROVIDERS, type PositionAlias } from './types.js';

const FORM_ID = 'position-alias-form';

/**
 * Routes `/settings/org-sync/aliases/new` and `…/aliases/:aliasId/edit`:
 * add a mapping, or change its position; `?confirm=1` also confirms a draft
 * (修改后确认). `?title=` pre-fills the office-suite title from a pending item.
 */
export default function PositionAliasDialog(): ReactElement {
  const { t } = useTranslation();
  const { aliasId } = useParams();
  const [params] = useSearchParams();
  const confirming = Boolean(aliasId) && params.get('confirm') === '1';
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef(false);
  const title = !aliasId
    ? t('orgSync.aliases.createTitle')
    : confirming
      ? t('orgSync.aliases.editConfirmTitle')
      : t('orgSync.aliases.editTitle');
  return (
    <RouteDialog
      title={title}
      description={t('orgSync.aliases.dialogDescription')}
      className='sm:max-w-md'
      beforeClose={() => !ref.current}
      footer={
        <Footer
          submitting={submitting}
          label={t(
            !aliasId
              ? 'orgSync.aliases.createSubmit'
              : confirming
                ? 'orgSync.aliases.saveConfirm'
                : 'actions.save',
          )}
        />
      }
    >
      {aliasId ? (
        <EditBody
          aliasId={aliasId}
          confirming={confirming}
          onSubmittingChange={(value) => {
            ref.current = value;
            setSubmitting(value);
          }}
        />
      ) : (
        <AliasForm
          initialTitle={params.get('title') ?? ''}
          onSubmittingChange={(value) => {
            ref.current = value;
            setSubmitting(value);
          }}
        />
      )}
    </RouteDialog>
  );
}

function EditBody({
  aliasId,
  confirming,
  onSubmittingChange,
}: {
  aliasId: string;
  confirming: boolean;
  onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  // The latest mappings, not the list's copy.
  const remote = useRemote<PositionAlias[]>('talent/position-aliases');
  if (remote.error)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={3} />;
  const alias = remote.data.find((a) => a.id === aliasId);
  if (!alias)
    return (
      <Alert>
        <AlertDescription>{t('orgSync.aliases.notFound')}</AlertDescription>
      </Alert>
    );
  return (
    <AliasForm
      alias={alias}
      confirming={confirming}
      initialTitle={alias.externalTitle}
      onSubmittingChange={onSubmittingChange}
    />
  );
}

function AliasForm({
  alias,
  confirming = false,
  initialTitle,
  onSubmittingChange,
}: {
  alias?: PositionAlias;
  confirming?: boolean;
  initialTitle: string;
  onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { close } = useRouteOverlay();
  const { reload, provider: configured } =
    useOutletContext<AliasesOutletContext>();
  const lookups = useLookups();
  const [provider, setProvider] = useState(
    alias?.provider ?? configured ?? 'feishu',
  );
  const [title, setTitle] = useState(initialTitle);
  const [positionId, setPositionId] = useState(alias?.positionId ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  async function submit(): Promise<void> {
    const next: Record<string, string> = {};
    if (!alias && !title.trim())
      next.title = t('orgSync.aliases.titleRequired');
    if (!positionId) next.position = t('orgSync.aliases.positionRequired');
    setErrors(next);
    if (Object.keys(next).length) {
      document
        .getElementById(next.title ? 'alias-title' : 'alias-position')
        ?.focus();
      return;
    }
    onSubmittingChange(true);
    setError(undefined);
    try {
      if (alias)
        await api.request({
          path: `talent/position-aliases/${encodeURIComponent(alias.id)}`,
          method: 'PATCH',
          json: { positionId, ...(confirming ? { confirm: true } : {}) },
        });
      else
        await api.request({
          path: 'talent/position-aliases',
          method: 'POST',
          json: { provider, externalTitle: title.trim(), positionId },
        });
      toast.add({
        type: 'success',
        title: t(
          !alias
            ? 'orgSync.aliases.createdToast'
            : confirming
              ? 'orgSync.aliases.confirmedOne'
              : 'orgSync.aliases.saved',
          { title: alias?.externalTitle ?? title.trim() },
        ),
      });
      onSubmittingChange(false);
      reload();
      void close();
    } catch (cause) {
      onSubmittingChange(false);
      if (errorCode(cause) === 'POSITION_ALIAS_EXISTS')
        setErrors({ title: errorMessage(cause, t) });
      else setError(errorMessage(cause, t));
    }
  }

  return (
    <form
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor='alias-provider'>
            {t('orgSync.aliases.provider')}
          </FieldLabel>
          <NativeSelect
            id='alias-provider'
            value={provider}
            disabled={Boolean(alias)}
            onChange={(e) => setProvider(e.target.value)}
          >
            {PROVIDERS.map((p) => (
              <NativeSelectOption
                key={p}
                value={p}
                disabled={p !== 'feishu' && p !== alias?.provider}
              >
                {t(`orgSync.provider.${p}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field data-invalid={Boolean(errors.title)}>
          <FieldLabel htmlFor='alias-title'>
            {t('orgSync.aliases.externalTitle')}
            {alias ? null : ' *'}
          </FieldLabel>
          <Input
            id='alias-title'
            value={title}
            maxLength={200}
            disabled={Boolean(alias)}
            aria-invalid={Boolean(errors.title)}
            onChange={(e) => setTitle(e.target.value)}
          />
          {errors.title ? <FieldError>{errors.title}</FieldError> : null}
        </Field>
        <Field data-invalid={Boolean(errors.position)}>
          <FieldLabel htmlFor='alias-position'>
            {t('orgSync.aliases.position')} *
          </FieldLabel>
          <NativeSelect
            id='alias-position'
            value={positionId}
            aria-invalid={Boolean(errors.position)}
            onChange={(e) => setPositionId(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.common.choose')}
            </NativeSelectOption>
            {lookups.positions
              .filter((p) => p.active || p.id === alias?.positionId)
              .map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.title}
                </NativeSelectOption>
              ))}
          </NativeSelect>
          {errors.position ? <FieldError>{errors.position}</FieldError> : null}
        </Field>
        {alias?.draftReason ? (
          <p className='text-sm text-muted-foreground'>
            {t('orgSync.aliases.draftReason', { reason: alias.draftReason })}
          </p>
        ) : null}
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </FieldGroup>
    </form>
  );
}

function Footer({
  submitting,
  label,
}: {
  submitting: boolean;
  label: string;
}): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        variant='outline'
        disabled={submitting}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={FORM_ID} disabled={submitting}>
        {submitting ? <Spinner data-icon='inline-start' /> : null}
        {label}
      </Button>
    </>
  );
}

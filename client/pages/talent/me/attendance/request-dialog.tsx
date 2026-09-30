import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import {
  compactValues,
  customFieldErrors,
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { CustomFieldInputs } from '@/components/talent/custom-fields';
import { errorCode, errorDetails } from '@/components/talent/errors';
import type { AdjustmentType } from '@/components/talent/attendance/types';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

export interface AdjustmentInput {
  type: AdjustmentType;
  date: string;
  details: Record<string, string>;
}

const FORM_ID = 'adjustment-request-form';

/**
 * The shell of 补卡 / 加班 / 调班: a route dialog over 我的档案 with a
 * required reason. `build` returns the request, or null while it is
 * incomplete. Submitting returns to `/talent/me#attendance`, which reloads the
 * section; a failure keeps everything typed.
 */
export function AdjustmentRequestDialog({
  type,
  build,
  blocked,
  children,
}: {
  type: AdjustmentType;
  build: () => AdjustmentInput | null;
  /** Why the request cannot be sent at all (for example the monthly limit). */
  blocked?: string;
  children: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [reason, setReason] = useState('');
  // 界面追加字段 HR placed on these forms; a failed submit keeps them and marks the wrong ones.
  const { definitions } = useCustomFieldDefinitions(
    'attendanceAdjustments',
    'form',
  );
  const [custom, setCustom] = useState<CustomValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const closeTo = {
    pathname: '/talent/me',
    search: location.search,
    hash: '#attendance',
  };
  const input = build();
  const ready = Boolean(input && reason.trim() && !blocked);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current || !input || !ready) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    setCustomErrors({});
    try {
      await api.request({
        method: 'POST',
        path: 'talent/adjustments',
        json: {
          ...input,
          reason: reason.trim(),
          customFields: compactValues(
            Object.fromEntries(
              definitions.map((d) => [d.key, custom[d.key] ?? null]),
            ),
          ),
        },
      });
      toast.add({
        type: 'success',
        title: t('attendance.my.submitted', {
          type: t(`attendance.adjustments.types.${type}`),
        }),
      });
      await navigate(closeTo, { replace: true });
    } catch (cause) {
      setError(cause);
      if (errorCode(cause) === 'CUSTOM_FIELD_INVALID')
        setCustomErrors(customFieldErrors(errorDetails(cause)));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <RouteDialog
      title={t(`attendance.my.dialogs.${type}.title`)}
      description={t(`attendance.my.dialogs.${type}.description`)}
      closeTo={closeTo}
      beforeClose={() => !busyRef.current}
      footer={<Footer busy={busy} disabled={!ready} />}
    >
      <form
        id={FORM_ID}
        className='grid gap-4'
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {attendanceErrorMessage(error, t)}
            </AlertDescription>
          </Alert>
        ) : null}
        {blocked ? (
          <Alert>
            <AlertDescription>{blocked}</AlertDescription>
          </Alert>
        ) : null}
        <fieldset className='grid gap-4' disabled={busy}>
          {children}
          <Field>
            <FieldLabel htmlFor='adjustment-reason'>
              {t('attendance.adjustments.fields.reason')} *
            </FieldLabel>
            <Textarea
              id='adjustment-reason'
              value={reason}
              maxLength={1000}
              aria-required='true'
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <CustomFieldInputs
            definitions={definitions}
            values={custom}
            onChange={(next) => {
              setCustom(next);
              setCustomErrors({});
            }}
            errors={customErrors}
            disabled={busy}
            idPrefix={`adjustment-cf-${type}`}
          />
        </fieldset>
      </form>
    </RouteDialog>
  );
}

function Footer({
  busy,
  disabled,
}: {
  busy: boolean;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={FORM_ID} disabled={busy || disabled}>
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t('attendance.my.submit')}
      </Button>
    </>
  );
}

import { zodResolver } from '@hookform/resolvers/zod';
import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from 'react-router';
import { z } from 'zod';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { today } from '@/components/talent/attendance/dates';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { LeaveError } from '../feedback.js';
import { LeaveFormOverlay } from '../form-overlay.js';
import { LEAVE_FORM_ID, useLeaveForm } from '../form-context.js';
import type { LeaveBalance, LeaveListContext } from '../types.js';

export default function InitializeBalancesPage() {
  const { t } = useTranslation();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'adjustBalance',
  });
  return (
    <LeaveFormOverlay
      title={t('attendance.leave.initialize')}
      description={t('attendance.leave.initializeDescription')}
      enabled={grant.can}
    >
      {grant.can ? (
        <InitializeForm />
      ) : (
        <p>{t('attendance.leave.errors.forbidden')}</p>
      )}
    </LeaveFormOverlay>
  );
}
function InitializeForm() {
  const { t } = useTranslation();
  const api = useApiClient();
  const overlay = useLeaveForm();
  const navigate = useNavigate();
  const location = useLocation();
  const list = useOutletContext<LeaveListContext<LeaveBalance>>();
  const [params] = useSearchParams();
  const [error, setError] = useState<unknown>();
  const zone = useAppTimeZone();
  const schema = z.object({
    asOf: z.iso.date({ error: t('attendance.leave.invalid') }),
  });
  const [now] = useState(() => today(zone));
  const initialYear = params.get('year') || now.slice(0, 4);
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      asOf: `${initialYear}-${now.slice(5)}`,
    },
  });
  return (
    <form
      id={LEAVE_FORM_ID}
      noValidate
      onChange={overlay.markDirty}
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          overlay.start();
          setError(undefined);
          try {
            const { data } = await api.request<{
              data: {
                created: string[];
                skippedEmployeeIds: string[];
                needsCareerStartDate: string[];
              };
            }>({
              path: 'talent/leave/balances/initialize',
              method: 'POST',
              json: {
                year: Number(values.asOf.slice(0, 4)),
                asOf: values.asOf,
              },
            });
            list.reload();
            overlay.saved();
            toast.add({
              type: 'success',
              title: t('attendance.leave.initialized', {
                count: data.created.length,
              }),
              description: t('attendance.leave.initializedDetails', {
                skipped: data.skippedEmployeeIds.length,
                missing: data.needsCareerStartDate.length,
              }),
            });
            await navigate(
              { pathname: '..', search: location.search },
              { relative: 'route', replace: true },
            );
          } catch (cause) {
            setError(cause);
            overlay.end();
          }
        })(event);
      }}
    >
      <FieldGroup>
        {error ? <LeaveError error={error} /> : null}
        <Field data-invalid={Boolean(form.formState.errors.asOf)}>
          <FieldLabel htmlFor='leave-asOf'>
            {t('attendance.leave.fields.asOf')} *
          </FieldLabel>
          <Input
            id='leave-asOf'
            type='date'
            disabled={overlay.pending}
            {...form.register('asOf')}
            aria-invalid={Boolean(form.formState.errors.asOf)}
          />
          <FieldError>{form.formState.errors.asOf?.message}</FieldError>
        </Field>
      </FieldGroup>
    </form>
  );
}

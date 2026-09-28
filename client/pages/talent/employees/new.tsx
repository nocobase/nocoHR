import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouteOverlay } from '@/components/use-route-overlay';

import { EmployeeForm } from './employee-form.js';
import type { EmployeesOutletContext } from './types.js';

const FORM_ID = 'employee-new-form';

/** Route `/talent/employees/new`: create an employee. */
export default function NewEmployeePage(): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const change = (value: boolean) => {
    submittingRef.current = value;
    setSubmitting(value);
  };
  return (
    <RouteDialog
      title={t('talent.employees.create')}
      description={t('talent.employees.createDescription')}
      beforeClose={() => !submittingRef.current}
      footer={<Footer submitting={submitting} />}
    >
      <Body onSubmittingChange={change} />
    </RouteDialog>
  );
}

function Body({
  onSubmittingChange,
}: {
  onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { reload } = useOutletContext<EmployeesOutletContext>();
  const navigate = useNavigate();
  return (
    <EmployeeForm
      formId={FORM_ID}
      canEditSensitive
      onSubmittingChange={onSubmittingChange}
      onSubmitted={(employee) => {
        reload();
        void navigate(`../${employee.id}/profile`, { replace: true });
      }}
    />
  );
}

function Footer({ submitting }: { submitting: boolean }): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={submitting}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={FORM_ID} disabled={submitting}>
        {submitting ? <Spinner data-icon='inline-start' /> : null}
        {t('talent.common.create')}
      </Button>
    </>
  );
}

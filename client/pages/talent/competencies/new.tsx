import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRouteOverlay } from '@/components/use-route-overlay';

import { CompetencyForm } from './competency-form.js';
import type { CompetenciesOutletContext } from './types.js';

const FORM_ID = 'competency-new-form';

/** Route `/talent/competencies/new`: a manually created competency is confirmed immediately. */
export default function NewCompetencyPage(): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef(false);
  return (
    <RouteDialog
      title={t('talent.competencies.create')}
      className='sm:max-w-3xl'
      beforeClose={() => !ref.current}
      footer={<Footer submitting={submitting} />}
    >
      <Body
        onSubmittingChange={(value) => {
          ref.current = value;
          setSubmitting(value);
        }}
      />
    </RouteDialog>
  );
}

function Body({
  onSubmittingChange,
}: {
  onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { reload } = useOutletContext<CompetenciesOutletContext>();
  const navigate = useNavigate();
  return (
    <CompetencyForm
      formId={FORM_ID}
      onSubmittingChange={onSubmittingChange}
      onSubmitted={(competency) => {
        reload();
        void navigate(`../${competency.id}`, { replace: true });
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

/** 新建招聘需求 (child page): saved as a draft, then submitted from its detail. */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useNavigate, useOutletContext } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { RequisitionForm } from '@/components/talent/recruiting-requisition-form';
import { useAction } from '@/components/talent/recruiting-lib';

export default function NewRequisitionPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const { busy, run } = useAction();
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader title={t('recruiting.requisitions.new')} />
        <RequisitionForm
          busy={busy !== null}
          onSubmit={(values) => {
            void run<{ id: string }>(
              'create',
              { path: 'talent/recruiting/requisitions', json: values },
              t('recruiting.common.saved'),
            ).then((created) => {
              if (!created) return;
              outlet?.reload?.();
              void navigate(`../${created.id}`, { relative: 'path' });
            });
          }}
        />
      </PageContainer>
    </RouteChildPage>
  );
}

import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import {
  AdjustmentFacts,
  DecideButtons,
} from '@/components/talent/attendance/adjustment-view';
import type { Adjustment } from '@/components/talent/attendance/types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import type { ApprovalsContext } from './types.js';

/** `/talent/approvals/adjustments/:adjustmentId`: 补卡 / 加班 / 调班 details and the decision. */
export default function AdjustmentApprovalPage(): ReactElement {
  const { adjustmentId = '' } = useParams();
  return <Detail key={adjustmentId} id={adjustmentId} />;
}

function Detail({ id }: { id: string }): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const list = useOutletContext<ApprovalsContext | undefined>();
  const detail = useRemote<Adjustment>(
    `talent/adjustments/${encodeURIComponent(id)}`,
  );
  // The list rows carry the applicant's name and department; the detail does not.
  const listed = useRemote<Adjustment[]>(
    detail.data ? 'talent/adjustments' : null,
    {
      view: 'todo',
      type: detail.data?.type,
    },
  );
  const scoped = useRemote<Adjustment[]>(
    detail.data && listed.data && !listed.data.some((r) => r.id === id)
      ? 'talent/adjustments'
      : null,
    { view: 'scope', type: detail.data?.type },
  );
  const row = detail.data
    ? {
        ...[...(listed.data ?? []), ...(scoped.data ?? [])].find(
          (r) => r.id === id,
        ),
        ...detail.data,
      }
    : undefined;
  const reload = () => {
    detail.reload();
    list?.reload();
  };
  return (
    <RouteChildPage>
      <PageContainer className='max-w-4xl'>
        <Button
          variant='outline'
          nativeButton={false}
          render={
            <Link
              to={{ pathname: '..', search: location.search }}
              relative='route'
            />
          }
        >
          {t('attendance.approvals.back')}
        </Button>
        <PageHeader
          title={t('attendance.adjustments.detailTitle')}
          description={t('attendance.adjustments.detailDescription')}
        />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !row ? (
          <BlockSkeleton rows={6} />
        ) : (
          <>
            {detail.loading ? (
              <Spinner aria-label={t('status.loading')} />
            ) : null}
            <AdjustmentFacts row={row} />
            {row.canDecide && row.status === 'pending' ? (
              <DecideButtons row={row} onDecided={reload} onReload={reload} />
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.adjustments.cannotDecide')}
              </p>
            )}
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

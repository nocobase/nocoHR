import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useLocation, useParams } from 'react-router';
import { RouteDialog } from '@/components/route-dialog';
import {
  ExistingLeaveDraft,
  LeaveRequestCloseFooter,
  LeaveRequestForm,
} from '@/components/talent/leave-request-form';
import { BlockSkeleton } from '@/components/talent/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LeaveError } from '../feedback.js';

/** V2-05: the existing leave page owns HR entry; it is not a new menu. */
export default function HrLeaveEntryPage() {
  const { t } = useTranslation();
  const { requestId } = useParams();
  const location = useLocation();
  const request = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'request',
  });
  const hr = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'manageTypes',
  });
  if (
    !request.isPending &&
    !hr.isPending &&
    !request.error &&
    !hr.error &&
    request.can &&
    hr.can
  )
    return requestId ? (
      <ExistingLeaveDraft key={requestId} id={requestId} mode='hr' />
    ) : (
      <LeaveRequestForm mode='hr' />
    );
  return (
    <RouteDialog
      title={t('attendance.leave.hrEntry.title')}
      description={t('attendance.leave.hrEntry.description')}
      closeTo={`/talent/leave/balances${location.search}`}
      footer={<LeaveRequestCloseFooter />}
    >
      {request.isPending || hr.isPending ? (
        <BlockSkeleton rows={4} />
      ) : request.error || hr.error ? (
        <LeaveError
          error={request.error || hr.error}
          retry={() => {
            void request.retry();
            void hr.retry();
          }}
        />
      ) : (
        <Alert>
          <AlertDescription>
            {t('attendance.leave.errors.forbidden')}
          </AlertDescription>
        </Alert>
      )}
    </RouteDialog>
  );
}

import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { responseCode } from '@/components/talent/errors';

export function LeaveError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  const code = responseCode(error);
  const status = error instanceof ApiClientError ? error.status : undefined;
  const codes = [
    'ATTACHMENT_REQUIRED',
    'ATTACHMENT_NOT_FOUND',
    'LEAVE_TYPE_NOT_FOUND',
    'INVALID_DATE_RANGE',
    'NO_ELIGIBLE_LEAVE_DAYS',
    'LEAVE_SCHEDULE_INVALID',
    'LEAVE_UNIT_POLICY_REQUIRED',
    'BALANCE_NOT_INITIALIZED',
    'LEAVE_OVERLAP',
    'MONTH_LOCKED',
    'ATTENDANCE_RECALCULATION_REQUIRED',
    'ATTENDANCE_LEAVE_CONFLICT',
    'FIXED_LEAVE_LIMIT',
    'BALANCE_CONFLICT',
    'REQUEST_STATE_CONFLICT',
    'ONLY_EMPLOYEE_MAY_SUBMIT',
    'HR_ENTRY_REQUIRES_NO_ACCOUNT',
    'NOT_CURRENT_APPROVER',
    'SELF_APPROVAL_FORBIDDEN',
    'BALANCE_STATE_INVALID',
    'CROSS_YEAR_REQUEST',
    'LEAVE_TYPE_CODE_CONFLICT',
    'LEAVE_TYPE_IN_USE',
    'INSUFFICIENT_LEAVE_BALANCE',
    'BALANCE_FROZEN',
    'INVALID_EMPLOYEE_DATES',
    'FUTURE_INITIALIZATION',
    'SCOPE_TOO_LARGE',
    'CARRYOVER_POLICY_REQUIRED',
    'ATTENDANCE_NOT_INITIALIZED',
    'INVALID_INPUT',
    'IDEMPOTENCY_CONFLICT',
    'CUSTOM_FIELD_INVALID',
  ] as const;
  const key = codes.find((item) => item === code);
  const message = key
    ? t(`attendance.leave.errors.${key}`)
    : t(
        `attendance.leave.errors.${status === 403 ? 'forbidden' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : 'failed'}`,
      );
  return (
    <Alert variant='destructive'>
      <AlertCircleIcon />
      <AlertDescription>
        <p>{message}</p>
        {retry && status !== 403 && status !== 404 ? (
          <Button variant='outline' onClick={retry}>
            {t('attendance.leave.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { responseCode } from '@/components/talent/errors';

export function SettingsError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  const { t } = useTranslation();
  const status = error instanceof ApiClientError ? error.status : undefined;
  const code = responseCode(error);
  const known = [
    'SHIFT_CODE_CONFLICT',
    'SHIFT_IN_USE',
    'ATTENDANCE_RULE_CONFLICT',
    'INVALID_DEPARTMENT',
    'INVALID_INPUT',
    'SCOPE_TOO_LARGE',
    'ATTENDANCE_NOT_INITIALIZED',
  ] as const;
  const key = known.find((value) => value === code);
  return (
    <Alert variant='destructive'>
      <AlertCircleIcon />
      <AlertDescription>
        <p>
          {key
            ? t(`attendance.settings.errors.${key}`)
            : t(
                `attendance.leave.errors.${status === 403 ? 'forbidden' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : 'failed'}`,
              )}
        </p>
        {retry && status !== 403 && status !== 404 ? (
          <Button variant='outline' onClick={retry}>
            {t('attendance.leave.retry')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

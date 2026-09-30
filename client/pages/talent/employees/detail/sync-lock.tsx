import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { EmployeeDetail } from '@/components/talent/types';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

/**
 * 同步锁定 (V1-03): HR keeps a sync from changing this employee's department,
 * position, manager and status. Shown only to people who may configure 组织同步.
 */
export function SyncLockSwitch({
  detail,
  onChanged,
}: {
  detail: EmployeeDetail;
  onChanged: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'configure',
  });
  const [pending, setPending] = useState(false);
  const [locked, setLocked] = useState(detail.employee.syncLocked === true);
  if (!grant.can) return null;
  const employee = detail.employee;
  return (
    <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
      <span className='text-muted-foreground'>
        {employee.externalUserId
          ? t('talent.detail.syncBound', {
              provider: t(
                `orgSync.provider.${employee.externalProvider ?? 'feishu'}`,
                {
                  defaultValue: employee.externalProvider ?? '',
                },
              ),
            })
          : t('talent.detail.syncUnbound')}
      </span>
      <span className='flex items-center gap-2'>
        <Switch
          id='employee-sync-lock'
          checked={locked}
          disabled={pending}
          onCheckedChange={(checked) => {
            setPending(true);
            api
              .request({
                path: `talent/org-sync/employees/${encodeURIComponent(employee.id)}/lock`,
                method: 'POST',
                json: { locked: checked },
              })
              .then(() => {
                setLocked(checked);
                toast.add({
                  type: 'success',
                  title: t(
                    checked
                      ? 'talent.detail.syncLockedOn'
                      : 'talent.detail.syncLockedOff',
                    { name: employee.name },
                  ),
                });
                onChanged();
              })
              .catch((cause: unknown) =>
                toast.add({ type: 'error', title: errorMessage(cause, t) }),
              )
              .finally(() => setPending(false));
          }}
        />
        <Label htmlFor='employee-sync-lock'>
          {t('talent.detail.syncLock')}
        </Label>
      </span>
    </div>
  );
}

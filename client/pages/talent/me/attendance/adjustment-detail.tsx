import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import {
  AdjustmentFacts,
  DecideButtons,
} from '@/components/talent/attendance/adjustment-view';
import { DraftActions } from '@/components/talent/attendance/draft-actions';
import { NoteDialog } from '@/components/talent/attendance/note-dialog';
import type { Adjustment } from '@/components/talent/attendance/types';
import {
  compactValues,
  customFieldErrors,
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { CustomFieldInputs } from '@/components/talent/custom-fields';
import { errorCode, errorDetails } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

/**
 * `/talent/me/attendance/adjustments/:adjustmentId`: my request (withdraw it
 * while pending, submit it while it is the HR assistant's draft) or a
 * colleague's swap waiting for my consent.
 */
export default function MyAdjustmentPage(): ReactElement {
  const { adjustmentId = '' } = useParams();
  return <Detail key={adjustmentId} id={adjustmentId} />;
}

function Detail({ id }: { id: string }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  const navigate = useNavigate();
  const closeTo = {
    pathname: '/talent/me',
    search: location.search,
    hash: '#attendance',
  };
  const detail = useRemote<Adjustment>(
    `talent/adjustments/${encodeURIComponent(id)}`,
  );
  // The list rows name the applicant; the detail carries ids only.
  const consents = useRemote<Adjustment[]>(
    detail.data?.type === 'shiftSwap' ? 'talent/adjustments' : null,
    { view: 'todo', type: 'shiftSwap' },
  );
  const [confirming, setConfirming] = useState(false);
  // A draft the HR assistant prepared: the employee fills the added fields before 提交.
  const { definitions } = useCustomFieldDefinitions(
    'attendanceAdjustments',
    'form',
  );
  const [custom, setCustom] = useState<CustomValues>();
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const values = custom ?? detail.data?.customFields ?? {};
  const row = detail.data
    ? {
        ...consents.data?.find((r) => r.id === id),
        ...detail.data,
      }
    : undefined;
  const cancel = async () => {
    if (!row) return;
    await api.request({
      method: 'POST',
      path: `talent/adjustments/${encodeURIComponent(row.id)}/cancel`,
    });
    toast.add({ type: 'success', title: t('attendance.my.cancelled') });
    await navigate(closeTo, { replace: true });
  };
  return (
    <RouteDrawer
      title={t('attendance.adjustments.detailTitle')}
      closeTo={closeTo}
    >
      {detail.error ? (
        <LoadError error={detail.error} onRetry={detail.reload} />
      ) : !row ? (
        <BlockSkeleton rows={5} />
      ) : (
        <div className='grid gap-4'>
          <AdjustmentFacts row={row} />
          {row.canSubmit ? (
            <div className='grid gap-2'>
              <p className='text-sm text-muted-foreground'>
                {t('attendanceV2.drafts.hint')}
              </p>
              {definitions.length ? (
                <div className='grid gap-4'>
                  <CustomFieldInputs
                    definitions={definitions}
                    values={values}
                    onChange={(next) => {
                      setCustom(next);
                      setCustomErrors({});
                    }}
                    errors={customErrors}
                    idPrefix='adjustment-draft-cf'
                  />
                </div>
              ) : null}
              <div className='flex justify-end'>
                <DraftActions
                  row={row}
                  size='default'
                  customFields={
                    definitions.length
                      ? compactValues(
                          Object.fromEntries(
                            definitions.map((d) => [
                              d.key,
                              values[d.key] ?? null,
                            ]),
                          ),
                        )
                      : undefined
                  }
                  onFailed={(cause) => {
                    if (errorCode(cause) === 'CUSTOM_FIELD_INVALID')
                      setCustomErrors(customFieldErrors(errorDetails(cause)));
                  }}
                  onChanged={() => void navigate(closeTo, { replace: true })}
                />
              </div>
            </div>
          ) : null}
          {row.canDecide && row.status === 'pending' ? (
            <DecideButtons
              row={row}
              onDecided={() => void navigate(closeTo, { replace: true })}
              onReload={detail.reload}
            />
          ) : null}
          {row.canCancel ? (
            <div className='flex justify-end'>
              <Button variant='outline' onClick={() => setConfirming(true)}>
                {t('attendance.my.cancel')}
              </Button>
            </div>
          ) : null}
          {confirming ? (
            <NoteDialog
              open
              onOpenChange={setConfirming}
              title={t('attendance.my.cancelTitle')}
              description={t('attendance.my.cancelDescription')}
              confirmLabel={t('attendance.my.cancel')}
              onSubmit={cancel}
            />
          ) : null}
        </div>
      )}
    </RouteDrawer>
  );
}

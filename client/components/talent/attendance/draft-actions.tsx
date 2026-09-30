import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { attendanceErrorMessage } from './errors.js';
import type { Adjustment } from './types.js';

/**
 * 提交 / 放弃 for a draft the HR assistant prepared (补卡单、考勤异常说明):
 * only its employee sees it, and only they submit it; submitting checks it
 * as a new request (the monthly missed-punch limit counts from now).
 */
export function DraftActions({
  row,
  onChanged,
  size = 'sm',
  customFields,
  onFailed,
}: {
  row: Pick<Adjustment, 'id' | 'type'>;
  onChanged: () => void;
  size?: 'sm' | 'default';
  /** 界面追加字段 filled in on the draft, sent with 提交. */
  customFields?: Record<string, unknown>;
  /** Called with a failed request's error, after the toast. */
  onFailed?: (cause: unknown) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState<'submit' | 'discard' | null>(null);
  const busyRef = useRef(false);
  const act = async (action: 'submit' | 'discard') => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(action);
    try {
      await api.request({
        method: 'POST',
        path: `talent/adjustments/${encodeURIComponent(row.id)}/${action}`,
        ...(action === 'submit' && customFields
          ? { json: { customFields } }
          : {}),
      });
      toast.add({
        type: 'success',
        title:
          action === 'submit'
            ? t('attendanceV2.drafts.submitted', {
                type: t(`attendance.adjustments.types.${row.type}`),
              })
            : t('attendanceV2.drafts.discarded'),
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: attendanceErrorMessage(cause, t) });
      onFailed?.(cause);
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };
  return (
    <span className='flex items-center gap-2'>
      <Button
        size={size}
        disabled={busy !== null}
        onClick={() => void act('submit')}
      >
        {busy === 'submit' ? <Spinner data-icon='inline-start' /> : null}
        {t('attendanceV2.drafts.submit')}
      </Button>
      <Button
        size={size}
        variant='outline'
        disabled={busy !== null}
        onClick={() => void act('discard')}
      >
        {busy === 'discard' ? <Spinner data-icon='inline-start' /> : null}
        {t('attendanceV2.drafts.discard')}
      </Button>
    </span>
  );
}

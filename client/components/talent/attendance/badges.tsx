import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';

const RECORD: Record<string, Variant> = {
  normal: 'secondary',
  late: 'destructive',
  earlyLeave: 'destructive',
  missingPunch: 'destructive',
  absent: 'destructive',
  leave: 'outline',
  rest: 'outline',
};
const SUMMARY: Record<string, Variant> = {
  draft: 'outline',
  confirmed: 'secondary',
  locked: 'default',
};
const REQUEST: Record<string, Variant> = {
  draft: 'outline',
  pending: 'outline',
  approved: 'secondary',
  rejected: 'destructive',
  cancelled: 'outline',
};

/** 考勤状态: normal is quiet, every exception is marked. */
export function RecordStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={RECORD[status] ?? 'outline'}>
      {t(`attendance.recordStatus.${status}`, { defaultValue: status })}
    </Badge>
  );
}

export function SummaryStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={SUMMARY[status] ?? 'outline'}>
      {t(`attendance.summaryStatus.${status}`, { defaultValue: status })}
    </Badge>
  );
}

export function RequestStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={REQUEST[status] ?? 'outline'}>
      {t(`attendance.adjustments.status.${status}`, { defaultValue: status })}
    </Badge>
  );
}

/** 已说明: an approved 考勤异常说明 covers this late / early day. */
export function ExcusedBadge(): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant='secondary' title={t('attendanceV2.excusedHint')}>
      {t('attendanceV2.excused')}
    </Badge>
  );
}

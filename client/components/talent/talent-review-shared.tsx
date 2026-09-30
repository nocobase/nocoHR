/**
 * V4-13 人才盘点与其他: the status badge the step's pages share; the label is
 * `talentReview.status.<status>`.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

const TONE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'outline',
  preparing: 'secondary',
  inSession: 'default',
  concluded: 'secondary',
  confirmed: 'default',
  published: 'default',
  archived: 'secondary',
  signed: 'secondary',
  completed: 'default',
  voided: 'destructive',
  pending: 'outline',
  submitted: 'default',
  expired: 'destructive',
  active: 'default',
  revoked: 'destructive',
  outdated: 'destructive',
  upToDate: 'secondary',
  new: 'outline',
  drafted: 'secondary',
  ignored: 'secondary',
};

/** A status badge; the label is `talentReview.status.<status>`. */
export function TrStatusBadge({ status }: { status: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={TONE[status] ?? 'outline'}>
      {t(`talentReview.status.${status}`)}
    </Badge>
  );
}


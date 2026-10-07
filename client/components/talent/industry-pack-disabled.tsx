import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { EmptyState } from './states.js';

/**
 * Shown (on `isIndustryPackDisabled(error)`, errors.ts) instead of a pack page's content while its industry content pack is
 * off: nothing was deleted, and an administrator turns it back on in
 * 设置 / 持证上岗 (most people who reach the page cannot open that settings
 * page, so it is named rather than linked).
 */
export function IndustryPackDisabled(): ReactElement {
  const { t } = useTranslation();
  return (
    <EmptyState
      title={t('licensed.packDisabled.title')}
      description={t('licensed.packDisabled.description')}
    />
  );
}

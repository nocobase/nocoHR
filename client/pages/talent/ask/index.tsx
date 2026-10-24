import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { UnifiedAssistant } from '#components/talent/unified-assistant';

/** Existing authorized full-page HR entry, now using native sessions and employee tools. */
export default function KnowledgeQaPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <PageHeader
        title={t('nativeAI.title')}
        description={t('nativeAI.description')}
      />
      <UnifiedAssistant layout='page' />
    </PageContainer>
  );
}

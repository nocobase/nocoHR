import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { UnifiedAssistant } from '@/components/talent/unified-assistant';

/**
 * 问答 — the full-page form of the unified AI entry (V1-04). The routing
 * table sends each first question to one AI employee (the knowledge assistant
 * for policies, the HR assistant for the user's own record); the header's
 * "AI 助手" panel is the same chat in a side panel.
 */
export default function KnowledgeQaPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentKnowledgeQa')}
        description={t('talent.ask.description')}
      />
      <UnifiedAssistant chatId='unified-ask' layout='page' />
    </PageContainer>
  );
}

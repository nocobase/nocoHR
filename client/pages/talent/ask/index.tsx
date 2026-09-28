import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { talentToolRenderers } from '@/components/talent/ai-tool-renderers';
import { useEmployeeReadiness } from '@/components/talent/use-employee-readiness';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AIChatProvider,
  AIChatWindow,
  ChatPage,
  NocoBaseAIRootProvider,
} from '@/extensions/nocobase-ai';

/**
 * 知识问答 — a full-page chat with the knowledge assistant. It answers only
 * from documents the signed-in user may read, links each source to the
 * document section, and suggests related courses.
 */
export default function KnowledgeQaPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentKnowledgeQa')}
        description={t('talent.ask.description')}
      />
      <NocoBaseAIRootProvider toolRenderers={talentToolRenderers}>
        <AssistantChat />
      </NocoBaseAIRootProvider>
    </PageContainer>
  );
}

function AssistantChat(): ReactElement {
  const { t } = useTranslation();
  const { ready, problem } = useEmployeeReadiness('knowledgeAssistant');
  const examples = useMemo(
    () =>
      ['stopReport', 'lockout', 'inspection'].map((key) => ({
        title: t(`talent.ask.examples.${key}`),
        message: { user: t(`talent.ask.examples.${key}`) },
        autoSend: true,
      })),
    [t],
  );
  if (!ready) {
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>{t('talent.advisor.unavailable')}</AlertTitle>
        <AlertDescription>{problem}</AlertDescription>
      </Alert>
    );
  }
  return (
    <AIChatProvider
      id='knowledge-qa'
      defaultEmployee='knowledgeAssistant'
      employeeTasks={{ knowledgeAssistant: examples }}
    >
      <ChatPage>
        <AIChatWindow
          enableAttachments
          showEmployeeSelector={false}
          placeholder={t('talent.ask.placeholder')}
        />
      </ChatPage>
    </AIChatProvider>
  );
}

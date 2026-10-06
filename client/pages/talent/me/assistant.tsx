import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';

import { RouteDrawer } from '@/components/route-drawer';
import { talentToolRenderers } from '@/components/talent/ai-tool-renderers';
import { useEmployeeReadiness } from '@/components/talent/use-employee-readiness';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AIChatProvider,
  AIChatWindow,
  NocoBaseAIRootProvider,
} from '@/extensions/nocobase-ai';

/**
 * Route `/talent/me/assistant` — 问人事助理 (V1-02): a chat with the HR
 * assistant about the signed-in employee's own record, contracts and
 * probation. Its only tool reads the caller's own data, so the drawer needs
 * no employee picker and takes no attachments.
 */
export default function MyHrAssistantDrawer(): ReactElement {
  const { t } = useTranslation();
  return (
    <RouteDrawer
      title={t('talent.me.assistant.title')}
      description={t('talent.me.assistant.description')}
      className='sm:max-w-xl'
    >
      <NocoBaseAIRootProvider toolRenderers={talentToolRenderers}>
        <AssistantChat />
      </NocoBaseAIRootProvider>
    </RouteDrawer>
  );
}

function AssistantChat(): ReactElement {
  const { t } = useTranslation();
  const { ready, problem } = useEmployeeReadiness('hrAssistant');
  const examples = useMemo(
    () =>
      ['contract', 'probation', 'events'].map((key) => ({
        title: t(`talent.me.assistant.examples.${key}`),
        message: { user: t(`talent.me.assistant.examples.${key}`) },
        autoSend: true,
      })),
    [t],
  );
  if (!ready)
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>{t('talent.advisor.assistantUnavailable')}</AlertTitle>
        <AlertDescription>{problem}</AlertDescription>
      </Alert>
    );
  return (
    <AIChatProvider
      id='my-hr-assistant'
      defaultEmployee='hrAssistant'
      employeeTasks={{ hrAssistant: examples }}
    >
      <div className='flex h-[70svh] min-h-80 flex-col'>
        <AIChatWindow
          showEmployeeSelector={false}
          placeholder={t('talent.me.assistant.placeholder')}
        />
      </div>
    </AIChatProvider>
  );
}

import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';

import { talentToolRenderers } from '@/components/talent/ai-tool-renderers';
import { useEmployeeReadiness } from '@/components/talent/use-employee-readiness';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  AIChatProvider,
  AIChatWindow,
  NocoBaseAIRootProvider,
} from '@/extensions/nocobase-ai';

import { workContextOf, type AssistantContext } from './helpers.js';

export type { AssistantContext } from './helpers.js';

/**
 * 问人事助理 on 组织同步 (V1-03, hr.admin): a chat with the HR assistant, as
 * the signed-in user. The current tab and the selected pending item go along
 * as work context, so "这个人该怎么处理" is about that item. The assistant
 * only explains, drafts mappings with the user's approval and saves notes;
 * it handles no item and changes no employee (its tools and prompt say so).
 */
export function OrgSyncAssistantSheet({
  context,
  onClose,
}: {
  context: AssistantContext | null;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Sheet
      open={Boolean(context)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className='w-full sm:max-w-xl'>
        <SheetHeader>
          <SheetTitle>{t('orgSync.assistant.title')}</SheetTitle>
          <SheetDescription>
            {context?.issue
              ? t('orgSync.assistant.aboutIssue', {
                  type: t(`orgSync.issueType.${context.issue.type}.title`),
                })
              : t('orgSync.assistant.description')}
          </SheetDescription>
        </SheetHeader>
        <div className='flex min-h-0 flex-1 flex-col px-4 pb-4'>
          {context ? (
            <NocoBaseAIRootProvider toolRenderers={talentToolRenderers}>
              <AssistantChat context={context} />
            </NocoBaseAIRootProvider>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AssistantChat({
  context,
}: {
  context: AssistantContext;
}): ReactElement {
  const { t } = useTranslation();
  const { ready, problem } = useEmployeeReadiness('hrAssistant');
  const tasks = useMemo(() => {
    const workContext = workContextOf(context, t);
    const keys = context.issue ? ['handle', 'why'] : ['summary', 'mappings'];
    return keys.map((key) => ({
      title: t(`orgSync.assistant.examples.${key}`),
      message: {
        user: t(`orgSync.assistant.examples.${key}`),
        workContext,
      },
      autoSend: false,
    }));
  }, [context, t]);
  if (!ready)
    return (
      <Alert>
        <AlertCircleIcon />
        <AlertTitle>{t('talent.advisor.unavailable')}</AlertTitle>
        <AlertDescription>{problem}</AlertDescription>
      </Alert>
    );
  return (
    <AIChatProvider
      // A new item starts a new conversation context.
      key={context.issue?.key ?? context.tab}
      id='org-sync-assistant'
      defaultEmployee='hrAssistant'
      employeeTasks={{ hrAssistant: tasks }}
    >
      <div className='flex h-[70svh] min-h-80 flex-col'>
        <AIChatWindow
          showEmployeeSelector={false}
          placeholder={t('orgSync.assistant.placeholder')}
        />
      </div>
    </AIChatProvider>
  );
}

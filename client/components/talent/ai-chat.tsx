import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  AIChatProvider,
  AIChatWindow,
  ChatSidePanel,
  NocoBaseAIRootProvider,
  useAIChatController,
  useAIChatControllerState,
} from '@/extensions/nocobase-ai';

import { talentToolRenderers } from './ai-tool-renderers.js';
import { useEmployeeReadiness } from './use-employee-readiness.js';

export interface AssistantTask {
  readonly title: string;
  readonly system: string;
  readonly user: string;
}

export interface AssistantLauncherProps {
  readonly employee: string;
  readonly chatId: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly task: () => AssistantTask;
  readonly variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  readonly size?: 'default' | 'sm';
  readonly disabled?: boolean;
  /** Called when the panel closes, so the page can show what the assistant wrote. */
  readonly onClosed?: () => void;
}

/**
 * A button that opens an application AI employee in a side panel. Each click
 * starts a new conversation whose task carries the page's context (such as a
 * document or course id) as background for the employee.
 */
export function AssistantLauncher(props: AssistantLauncherProps): ReactElement {
  return (
    <NocoBaseAIRootProvider toolRenderers={talentToolRenderers}>
      <Launcher {...props} />
    </NocoBaseAIRootProvider>
  );
}

function Launcher({
  employee,
  chatId,
  label,
  icon,
  task,
  variant = 'outline',
  size = 'default',
  disabled,
  onClosed,
}: AssistantLauncherProps): ReactElement {
  const { t } = useTranslation();
  const { ready, problem } = useEmployeeReadiness(employee);
  const controller = useAIChatController();
  const { open } = useAIChatControllerState(controller);
  const [problemOpen, setProblemOpen] = useState(false);

  const setOpen = (next: boolean) => {
    controller.setOpen(next);
    if (!next) onClosed?.();
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        onClick={() => {
          if (!ready) {
            setProblemOpen(true);
            return;
          }
          const current = task();
          controller.triggerTask({
            aiEmployee: employee,
            open: true,
            task: {
              title: current.title,
              message: { system: current.system, user: current.user },
              autoSend: false,
            },
          });
        }}
      >
        {icon}
        {label}
      </Button>
      {ready ? (
        <AIChatProvider
          id={chatId}
          controller={controller}
          defaultEmployee={employee}
        >
          <ChatSidePanel open={open} onOpenChange={setOpen} width={460}>
            <AIChatWindow
              enableAttachments
              showEmployeeSelector={false}
              headerActions={
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() => setOpen(false)}
                >
                  {t('actions.close')}
                </Button>
              }
            />
          </ChatSidePanel>
        </AIChatProvider>
      ) : (
        <ChatSidePanel
          open={problemOpen}
          onOpenChange={setProblemOpen}
          width={420}
        >
          <div className='space-y-3 p-6'>
            <p className='font-medium'>
              {t('talent.advisor.assistantUnavailable')}
            </p>
            <p className='text-sm text-muted-foreground' role='alert'>
              {problem}
            </p>
            <Button variant='outline' onClick={() => setProblemOpen(false)}>
              {t('actions.close')}
            </Button>
          </div>
        </ChatSidePanel>
      )}
    </>
  );
}

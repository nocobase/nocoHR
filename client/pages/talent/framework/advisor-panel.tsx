import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import {
  AIChatProvider,
  AIChatWindow,
  ChatSidePanel,
  NocoBaseAIRootProvider,
  useAI,
  useAIChatController,
  useAIChatControllerState,
} from '@/extensions/nocobase-ai';

export interface AdvisorLauncherProps {
  readonly position: {
    id: string;
    title: string;
    code: string;
    /** V3-08: an extracted 岗位说明书 is handed to the advisor as its primary source. */
    jdFilename?: string | null;
    jdStatus?: string | null;
  };
  /** Called when the panel closes, so the page can show drafts the advisor wrote. */
  readonly onClosed: () => void;
}

/**
 * "用体系顾问生成": opens the framework advisor in a side panel. Each click
 * starts a new conversation whose task carries the current position id, so the
 * advisor reads it with getPositionContext. What it writes stays a draft until
 * confirmed on this page.
 */
export function AdvisorLauncher(props: AdvisorLauncherProps): ReactElement {
  return (
    <NocoBaseAIRootProvider>
      <Launcher {...props} />
    </NocoBaseAIRootProvider>
  );
}

function Launcher({ position, onClosed }: AdvisorLauncherProps): ReactElement {
  const { t } = useTranslation();
  const {
    configurationStatus,
    configurationError,
    modelConfigurationError,
    employees,
    hasEnabledModels,
  } = useAI();
  const controller = useAIChatController();
  const { open } = useAIChatControllerState(controller);
  const [problemOpen, setProblemOpen] = useState(false);
  const ready =
    configurationStatus === 'ready' &&
    employees.some((e) => e.username === 'frameworkAdvisor') &&
    !modelConfigurationError &&
    hasEnabledModels;
  const problem =
    configurationStatus === 'loading'
      ? t('talent.advisor.loading')
      : configurationStatus === 'error'
        ? (configurationError?.message ?? t('talent.advisor.configError'))
        : !employees.some((e) => e.username === 'frameworkAdvisor')
          ? t('talent.advisor.noEmployee')
          : t('talent.advisor.noModel');

  const setOpen = (next: boolean) => {
    controller.setOpen(next);
    if (!next) onClosed();
  };

  return (
    <>
      <Button
        variant='outline'
        onClick={() => {
          if (!ready) {
            setProblemOpen(true);
            return;
          }
          controller.triggerTask({
            aiEmployee: 'frameworkAdvisor',
            open: true,
            task: {
              title: t('talent.advisor.taskTitle', { title: position.title }),
              message: {
                system: `The user is working on position "${position.title}" (code ${position.code}, positionId ${position.id}). Call getPositionContext with this positionId first.${
                  position.jdStatus === 'ready'
                    ? ` The position has an uploaded job description ("${position.jdFilename ?? ''}"); getPositionContext returns its text as jdText. Use it as the primary source and cite, by the clause numbers getPositionContext lists, the clause each competency comes from.`
                    : ''
                }`,
                user: t('talent.advisor.prompt', { title: position.title }),
              },
              autoSend: false,
            },
          });
        }}
      >
        <SparklesIcon data-icon='inline-start' />
        {t('talent.advisor.open')}
      </Button>
      {ready ? (
        <AIChatProvider
          id='framework-advisor'
          controller={controller}
          defaultEmployee='frameworkAdvisor'
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
            <p className='font-medium'>{t('talent.advisor.unavailable')}</p>
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

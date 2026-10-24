import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertTitle, AlertDescription } from '#components/ui/alert';
import {
  ChatPanelScope,
  useChatModels,
  useChatPanel,
} from '@nocobase/app-plugin-agents/client/chat';
import { ConversationView } from '#extensions/nocobase-agent-chat/conversation-view';
import { PanelHeader } from '#extensions/nocobase-agent-chat/panel-header';
import { HistoryList } from '#extensions/nocobase-agent-chat/history-list';

/** NocoHR entry shell; the official controller owns new conversations, history, approvals and Stop. */
export function UnifiedAssistant({ layout }: { layout: 'page' | 'panel' }) {
  const panel = useChatPanel();
  const models = useChatModels();
  const { t } = useTranslation();
  return (
    <ChatPanelScope value={{ ...panel, open: true }}>
      <div
        className={
          layout === 'page'
            ? 'flex h-[calc(100svh-13rem)] min-h-80 flex-col rounded-xl border bg-card'
            : 'flex h-full min-h-80 flex-col'
        }
      >
        <PanelHeader compact embedded />
        {models.isSuccess && models.data.length === 0 ? (
          <Alert>
            <AlertTitle>{t('nativeAI.noModel')}</AlertTitle>
            <AlertDescription>{t('nativeAI.noModelHelp')}</AlertDescription>
          </Alert>
        ) : null}
        {panel.view === 'history' ? (
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <HistoryList
              activeId={panel.conversationId}
              onOpen={(id) => {
                panel.selectConversation(id);
                panel.setView('chat');
              }}
            />
          </div>
        ) : (
          <ConversationView
            conversationId={panel.conversationId}
            variant={layout}
            className='min-h-0 flex-1'
          />
        )}
      </div>
    </ChatPanelScope>
  );
}

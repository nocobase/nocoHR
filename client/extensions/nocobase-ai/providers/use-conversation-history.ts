import type { Chat } from '@ai-sdk/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NocoBaseChatTransport } from './chat-transport.js';
import { reconcileRefreshedMessages } from './chat-message-utils.js';
import { AI_DRAFT_CONVERSATION_ID, type AIChatMessage } from './types.js';

const isChatRunning = (chat: Chat<AIChatMessage>) =>
  chat.status === 'streaming' || chat.status === 'submitted';

export function useConversationHistory({
  chatSurfaceOpen,
  activeConversationId,
  getActiveConversationId,
  getChat,
  getTransport,
  getConversationMessages,
  getConversationActiveState,
  onMarkRead,
  onError,
}: {
  chatSurfaceOpen: boolean;
  activeConversationId: string;
  getActiveConversationId: () => string;
  getChat: (conversationId: string) => Chat<AIChatMessage>;
  getTransport: (conversationId: string) => NocoBaseChatTransport | undefined;
  getConversationMessages: (
    conversationId: string,
    options?: { updateRead?: boolean },
  ) => Promise<AIChatMessage[]>;
  getConversationActiveState: (
    conversationId: string,
  ) => Promise<string | undefined>;
  onMarkRead: (conversationId: string) => void;
  onError: (error?: Error) => void;
}) {
  const openVersionRef = useRef(0);
  const pendingRequestsRef = useRef(
    new Map<string, Promise<AIChatMessage[]>>(),
  );
  const [loadingId, setLoadingId] = useState<string>();
  const [pendingConversationId, setPendingConversationId] = useState<string>();

  const refresh = useCallback(
    (
      conversationId: string,
      targetChat: Chat<AIChatMessage>,
      options: { updateRead?: boolean; isCurrent?: () => boolean } = {},
    ) => {
      const updateRead = options.updateRead === true;
      const requestKey = `${conversationId}:${updateRead ? 'read' : 'peek'}`;
      let request = pendingRequestsRef.current.get(requestKey);
      if (!request) {
        request = getConversationMessages(conversationId, { updateRead });
        pendingRequestsRef.current.set(requestKey, request);
        request.then(
          () => {
            if (pendingRequestsRef.current.get(requestKey) === request) {
              pendingRequestsRef.current.delete(requestKey);
            }
          },
          () => {
            if (pendingRequestsRef.current.get(requestKey) === request) {
              pendingRequestsRef.current.delete(requestKey);
            }
          },
        );
      }

      return request.then((messages) => {
        if (options.isCurrent && !options.isCurrent())
          return targetChat.messages;
        const reconciled = reconcileRefreshedMessages(
          targetChat.messages,
          messages,
        );
        targetChat.messages = reconciled;
        return reconciled;
      });
    },
    [getConversationMessages],
  );

  const load = useCallback(
    async (conversationId: string) => {
      const targetChat = getChat(conversationId);
      if (isChatRunning(targetChat)) return;

      const openVersion = openVersionRef.current + 1;
      openVersionRef.current = openVersion;
      setLoadingId(conversationId);
      setPendingConversationId(undefined);
      onError(undefined);
      try {
        await refresh(conversationId, targetChat, { updateRead: true });
        onMarkRead(conversationId);
      } catch (error) {
        onError(
          error instanceof Error
            ? error
            : new Error('Unable to load conversation messages'),
        );
        return;
      } finally {
        setLoadingId((current) =>
          current === conversationId ? undefined : current,
        );
      }

      if (
        openVersionRef.current !== openVersion ||
        getActiveConversationId() !== conversationId ||
        isChatRunning(targetChat)
      ) {
        return;
      }

      try {
        const activeState = await getConversationActiveState(conversationId);
        if (
          openVersionRef.current !== openVersion ||
          getActiveConversationId() !== conversationId ||
          isChatRunning(targetChat)
        ) {
          return;
        }
        setPendingConversationId(
          activeState === 'pending' ? conversationId : undefined,
        );
        if (activeState !== 'streaming') return;
        getTransport(conversationId)?.prepareConversationResume(
          targetChat.messages,
        );
        await targetChat.resumeStream();
      } catch (error) {
        onError(
          error instanceof Error
            ? error
            : new Error('Unable to resume the conversation stream'),
        );
      }
    },
    [
      getActiveConversationId,
      getChat,
      getConversationActiveState,
      getTransport,
      onError,
      onMarkRead,
      refresh,
    ],
  );

  useEffect(() => {
    if (!chatSurfaceOpen || activeConversationId === AI_DRAFT_CONVERSATION_ID) {
      return;
    }
    // Start the asynchronous subscription after the effect is installed. A superseded
    // surface must not start a request during Strict Mode cleanup or a conversation change.
    let active = true;
    queueMicrotask(() => {
      if (active) void load(activeConversationId);
    });
    return () => {
      active = false;
      openVersionRef.current += 1;
    };
  }, [activeConversationId, chatSurfaceOpen, load]);

  const invalidate = useCallback(() => {
    openVersionRef.current += 1;
  }, []);

  return { invalidate, load, loadingId, refresh, pendingConversationId };
}

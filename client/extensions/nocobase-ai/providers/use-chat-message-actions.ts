import type { Chat } from '@ai-sdk/react';
import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { AIChatAction, AIChatState } from './chat-reducer.js';
import {
  findChatMessage,
  isAIToolPart,
  getDecidedToolMessage,
} from './chat-message-utils.js';
import { getAIWorkContextToolScope } from './page-context-utils.js';
import type { NocoBaseChatTransport } from './chat-transport.js';
import type { useAI } from './ai-context.js';
import type { AIConversationRuntimeContext } from './use-chat-runtime.js';
import { useAutomaticToolApproval } from './use-automatic-tool-approval.js';
import type {
  AIChatAttachment,
  AIChatMessage,
  AIToolCallDecision,
  AIToolCallInvocationContext,
  AIWorkContextItem,
} from './types.js';

type AIContextValue = ReturnType<typeof useAI>;

export type AIMessageEditingSnapshot = {
  conversationId: string;
  messages: AIChatMessage[];
  attachments: AIChatAttachment[];
  workContext: AIWorkContextItem[];
};

type RefreshConversationMessages = (
  conversationId: string,
  targetChat: Chat<AIChatMessage>,
  options?: { updateRead?: boolean; isCurrent?: () => boolean },
) => Promise<AIChatMessage[]>;

const isChatRunning = (chat: Chat<AIChatMessage>) =>
  chat.status === 'streaming' || chat.status === 'submitted';

const removeEmptyResponsePlaceholder = (
  chat: Chat<AIChatMessage>,
  responseMessageId?: string,
) => {
  if (!responseMessageId) return;
  const response = chat.messages.find(
    (message) => message.id === responseMessageId,
  );
  if (!response || response.parts.length > 0) return;
  chat.messages = chat.messages.filter(
    (message) => message.id !== responseMessageId,
  );
};

const getToolInvocationContext = ({
  conversationId,
  messages,
  rootIndex,
  runtimeContext,
  messageId,
  toolCallId,
  toolName,
  automatic,
}: {
  conversationId: string;
  messages: AIChatMessage[];
  rootIndex: number;
  runtimeContext: AIConversationRuntimeContext;
  messageId: string;
  toolCallId: string;
  toolName: string;
  automatic?: boolean;
}): AIToolCallInvocationContext => {
  const userContext = messages
    .slice(0, rootIndex + 1)
    .reverse()
    .find((message) => message.role === 'user')?.metadata?.workContext;
  return {
    sessionId: conversationId,
    messageId,
    toolCallId,
    toolName,
    automatic,
    ...getAIWorkContextToolScope([
      ...(runtimeContext.task?.workContext ?? []),
      ...(userContext ?? []),
    ]),
  };
};

export function useChatMessageActions({
  ai,
  activeChat,
  getChat,
  stateRef,
  chatSurfaceOpenRef,
  transportsRef,
  getRuntimeContext,
  refreshConversationMessages,
  setHistoryError,
  editingSnapshotRef,
  setEditingMessageId,
  getConversationAttachments,
  getConversationWorkContext,
  setConversationAttachments,
  setConversationWorkContext,
  dispatch,
  requestComposerFocus,
  actionTokenRef: sharedActionTokenRef,
}: {
  ai: AIContextValue;
  activeChat: Chat<AIChatMessage>;
  getChat: (conversationId: string) => Chat<AIChatMessage>;
  stateRef: MutableRefObject<AIChatState>;
  chatSurfaceOpenRef: MutableRefObject<boolean>;
  transportsRef: MutableRefObject<Map<string, NocoBaseChatTransport>>;
  getRuntimeContext: (conversationId: string) => AIConversationRuntimeContext;
  refreshConversationMessages: RefreshConversationMessages;
  setHistoryError: Dispatch<SetStateAction<Error | undefined>>;
  editingSnapshotRef: MutableRefObject<AIMessageEditingSnapshot | undefined>;
  setEditingMessageId: Dispatch<SetStateAction<string | undefined>>;
  getConversationAttachments: (conversationId: string) => AIChatAttachment[];
  getConversationWorkContext: (conversationId: string) => AIWorkContextItem[];
  setConversationAttachments: (
    conversationId: string,
    attachments: AIChatAttachment[],
  ) => void;
  setConversationWorkContext: (
    conversationId: string,
    context: AIWorkContextItem[],
  ) => void;
  dispatch: Dispatch<AIChatAction>;
  requestComposerFocus: () => void;
  actionTokenRef?: MutableRefObject<Map<string, symbol>>;
}) {
  const localActionTokenRef = useRef<Map<string, symbol>>(new Map());
  const actionTokenRef = sharedActionTokenRef ?? localActionTokenRef;
  const beginAction = useCallback(
    (conversationId: string) => {
      const token = Symbol(conversationId);
      actionTokenRef.current.set(conversationId, token);
      return token;
    },
    [actionTokenRef],
  );
  const isCurrentAction = useCallback(
    (conversationId: string, token: symbol) =>
      actionTokenRef.current.get(conversationId) === token,
    [actionTokenRef],
  );

  const resolveServerMessage = useCallback(
    async (
      conversationId: string,
      targetChat: Chat<AIChatMessage>,
      message: AIChatMessage,
      isCurrent: () => boolean = () => true,
    ) => {
      let messages = targetChat.messages;
      const resolvedMessage = findChatMessage(messages, message.id);
      if (!resolvedMessage) {
        throw new Error(
          'The message is no longer available in this conversation.',
        );
      }
      let { targetMessage, rootIndex } = resolvedMessage;

      if (!targetMessage.metadata?.serverMessageId) {
        messages = await refreshConversationMessages(
          conversationId,
          targetChat,
          {
            updateRead:
              stateRef.current.activeConversationId === conversationId &&
              chatSurfaceOpenRef.current,
            isCurrent,
          },
        );
        if (!isCurrent()) return;
        const refreshedMatch = findChatMessage(messages, message.id);
        const refreshedTarget = refreshedMatch?.targetMessage;
        if (!refreshedTarget) {
          throw new Error(
            'Unable to resolve the server message for this action.',
          );
        }
        targetMessage = refreshedTarget;
        rootIndex = refreshedMatch.rootIndex;
      }

      return {
        conversationId,
        messages,
        targetMessage,
        rootIndex,
        serverMessageId: targetMessage.metadata?.serverMessageId,
      };
    },
    [chatSurfaceOpenRef, refreshConversationMessages, stateRef],
  );

  const retryMessage = useCallback(
    async (message: AIChatMessage) => {
      if (
        message.role !== 'assistant' ||
        activeChat.status === 'streaming' ||
        activeChat.status === 'submitted'
      ) {
        return;
      }

      const conversationId = stateRef.current.activeConversationId;
      const actionToken = beginAction(conversationId);
      if (stateRef.current.activeConversationId === conversationId) {
        setHistoryError(undefined);
      }
      try {
        const resolved = await resolveServerMessage(
          conversationId,
          activeChat,
          message,
          () => isCurrentAction(conversationId, actionToken),
        );
        if (!isCurrentAction(conversationId, actionToken) || !resolved) return;
        if (!resolved.serverMessageId) {
          throw new Error('The server message id is unavailable for retry.');
        }
        const transport = transportsRef.current.get(resolved.conversationId);
        if (!transport) {
          throw new Error('The NocoBase chat transport is unavailable.');
        }
        transport.prepareResend(resolved.serverMessageId);
        try {
          await activeChat.regenerate({ messageId: resolved.targetMessage.id });
        } catch (error) {
          if (isCurrentAction(conversationId, actionToken)) {
            transport.cancelResend(resolved.serverMessageId);
          }
          throw error;
        }
      } catch (error) {
        if (
          isCurrentAction(conversationId, actionToken) &&
          stateRef.current.activeConversationId === conversationId
        ) {
          setHistoryError(
            error instanceof Error
              ? error
              : new Error('Unable to retry message'),
          );
        }
      }
    },
    [
      activeChat,
      beginAction,
      isCurrentAction,
      resolveServerMessage,
      setHistoryError,
      stateRef,
      transportsRef,
    ],
  );

  const decideConversationToolCall = useCallback(
    async (
      conversationId: string,
      targetChat: Chat<AIChatMessage>,
      decision: AIToolCallDecision,
      options: { automatic?: boolean } = {},
    ) => {
      if (isChatRunning(targetChat)) return;

      const actionToken = beginAction(conversationId);
      if (stateRef.current.activeConversationId === conversationId) {
        setHistoryError(undefined);
      }
      let responseMessageId: string | undefined;
      try {
        const message = findChatMessage(
          targetChat.messages,
          decision.messageId,
        )?.targetMessage;
        if (!message) {
          throw new Error('The tool-call message is no longer available.');
        }
        const resolved = await resolveServerMessage(
          conversationId,
          targetChat,
          message,
          () => isCurrentAction(conversationId, actionToken),
        );
        if (!isCurrentAction(conversationId, actionToken) || !resolved) return;
        if (!resolved.serverMessageId) {
          throw new Error(
            'The server message id is unavailable for this tool decision.',
          );
        }
        const toolPart = resolved.targetMessage.parts
          .filter(isAIToolPart)
          .find((part) => part.toolCallId === decision.toolCallId);
        const toolName =
          toolPart?.type === 'dynamic-tool'
            ? toolPart.toolName
            : toolPart?.type.startsWith('tool-')
              ? toolPart.type.slice(5)
              : decision.toolName;
        const runtimeContext = getRuntimeContext(resolved.conversationId);
        const invocationContext = getToolInvocationContext({
          conversationId: resolved.conversationId,
          messages: resolved.messages,
          rootIndex: resolved.rootIndex,
          runtimeContext,
          messageId: resolved.serverMessageId,
          toolCallId: decision.toolCallId,
          toolName,
          automatic: options.automatic,
        });
        if (
          options.automatic &&
          !ai.canAutoApproveToolCall(
            toolName,
            toolPart?.input ?? decision.input,
            invocationContext,
          )
        ) {
          if (toolPart && 'callProviderMetadata' in toolPart) {
            const providerMetadata = toolPart.callProviderMetadata ?? {};
            const nocobase =
              providerMetadata.nocobase &&
              typeof providerMetadata.nocobase === 'object'
                ? providerMetadata.nocobase
                : {};
            toolPart.callProviderMetadata = {
              ...providerMetadata,
              nocobase: {
                ...nocobase,
                autoApprove: false,
                requiresApproval: true,
              },
            };
            targetChat.messages = [...targetChat.messages];
          }
          return;
        }
        const userDecision =
          decision.decision === 'approve'
            ? ({ type: 'approve' } as const)
            : decision.decision === 'reject'
              ? ({
                  type: 'reject',
                  ...(typeof decision.input === 'string'
                    ? { message: decision.input }
                    : {}),
                } as const)
              : ({
                  type: 'edit',
                  editedAction: { name: toolName, args: decision.input },
                } as const);
        const result = await ai.updateToolCallDecision({
          sessionId: resolved.conversationId,
          messageId: resolved.serverMessageId,
          toolCallId: decision.toolCallId,
          userDecision,
        });
        if (!isCurrentAction(conversationId, actionToken)) return;
        if (!result.updated) {
          await refreshConversationMessages(
            resolved.conversationId,
            targetChat,
            {
              updateRead:
                stateRef.current.activeConversationId ===
                  resolved.conversationId && chatSurfaceOpenRef.current,
              isCurrent: () => isCurrentAction(conversationId, actionToken),
            },
          );
          if (!isCurrentAction(conversationId, actionToken)) return;
          return;
        }

        const interruptingToolCalls = result.toolCalls.filter(
          (toolCall) =>
            toolCall.willInterrupt === true ||
            toolCall.execution === 'frontend' ||
            toolCall.auto === false,
        );
        const allWaiting =
          interruptingToolCalls.length > 0 &&
          interruptingToolCalls.every(
            (toolCall) =>
              String(toolCall.invokeStatus).toLowerCase() === 'waiting',
          );
        if (!allWaiting) return;

        const toolCallIds = result.toolCalls.map((toolCall) => toolCall.id);
        const toolCallResults: Array<{ id: string; result: unknown }> = [];
        for (const toolCall of result.toolCalls) {
          if (!isCurrentAction(conversationId, actionToken)) return;
          const invocation = await ai.invokeToolCall(
            toolCall.name,
            toolCall.args,
            {
              ...invocationContext,
              toolCallId: toolCall.id,
              toolName: toolCall.name,
            },
          );
          if (!isCurrentAction(conversationId, actionToken)) return;
          if (invocation.handled) {
            toolCallResults.push({
              id: toolCall.id,
              result: invocation.result,
            });
          }
        }

        if (!isCurrentAction(conversationId, actionToken)) return;
        const transport = transportsRef.current.get(resolved.conversationId);
        if (!transport) {
          throw new Error('The NocoBase chat transport is unavailable.');
        }
        if (resolved.rootIndex !== targetChat.messages.length - 1) {
          targetChat.messages = resolved.messages.slice(
            0,
            resolved.rootIndex + 1,
          );
        }
        responseMessageId = `assistant-${crypto.randomUUID()}`;
        targetChat.messages = [
          ...targetChat.messages,
          {
            id: responseMessageId,
            role: 'assistant',
            metadata: {
              createdAt: new Date().toISOString(),
              employeeUsername: runtimeContext.employeeUsername,
            },
            parts: [],
          },
        ];
        transport.prepareToolResume(
          resolved.serverMessageId,
          responseMessageId,
          toolCallIds,
          toolCallResults,
        );
        try {
          await targetChat.resumeStream();
          if (!isCurrentAction(conversationId, actionToken)) return;
          // Chat reports transport/stream failures through status and resolves
          // resumeStream, so handle that outcome just like explicit Continue.
          if (targetChat.status === 'error')
            throw targetChat.error ?? new Error('Unable to continue the reply');
        } catch (error) {
          if (isCurrentAction(conversationId, actionToken)) {
            transport.cancelToolResume(resolved.serverMessageId);
            removeEmptyResponsePlaceholder(targetChat, responseMessageId);
          }
          throw error;
        }
      } catch (error) {
        if (
          !isCurrentAction(conversationId, actionToken) ||
          stateRef.current.activeConversationId !== conversationId
        ) {
          return;
        }
        setHistoryError(
          error instanceof Error
            ? error
            : new Error('Unable to process the tool decision'),
        );
        throw error;
      }
    },
    [
      ai,
      beginAction,
      chatSurfaceOpenRef,
      getRuntimeContext,
      isCurrentAction,
      refreshConversationMessages,
      resolveServerMessage,
      setHistoryError,
      stateRef,
      transportsRef,
    ],
  );

  const continuingRef = useRef(new Set<string>());
  const continueReply = useCallback(async () => {
    const conversationId = stateRef.current.activeConversationId;
    const targetChat = getChat(conversationId);
    if (isChatRunning(targetChat) || continuingRef.current.has(conversationId))
      return;
    const message = getDecidedToolMessage(targetChat.messages);
    if (!message) return;
    const transport = transportsRef.current.get(conversationId);
    if (!transport) return;
    const actionToken = beginAction(conversationId);
    continuingRef.current.add(conversationId);
    if (stateRef.current.activeConversationId === conversationId) {
      setHistoryError(undefined);
    }
    const responseMessageId = `assistant-${crypto.randomUUID()}`;
    targetChat.messages = [
      ...targetChat.messages,
      {
        id: responseMessageId,
        role: 'assistant',
        metadata: {
          createdAt: new Date().toISOString(),
          employeeUsername: getRuntimeContext(conversationId).employeeUsername,
        },
        parts: [],
      },
    ];
    transport.prepareToolResume(
      message.metadata!.serverMessageId!,
      responseMessageId,
      message.parts.filter(isAIToolPart).map((part) => part.toolCallId),
      [],
    );
    try {
      await targetChat.resumeStream();
      if (!isCurrentAction(conversationId, actionToken)) return;
      if (targetChat.status === 'error')
        throw targetChat.error ?? new Error('Unable to continue the reply');
    } catch (error) {
      if (isCurrentAction(conversationId, actionToken)) {
        transport.cancelToolResume(message.metadata!.serverMessageId!);
        removeEmptyResponsePlaceholder(targetChat, responseMessageId);
      }
      if (
        isCurrentAction(conversationId, actionToken) &&
        stateRef.current.activeConversationId === conversationId
      ) {
        setHistoryError(
          error instanceof Error
            ? error
            : new Error('Unable to continue the reply'),
        );
      }
    } finally {
      continuingRef.current.delete(conversationId);
    }
  }, [
    beginAction,
    getChat,
    getRuntimeContext,
    isCurrentAction,
    setHistoryError,
    stateRef,
    transportsRef,
  ]);

  const decideToolCall = useCallback(
    (decision: AIToolCallDecision) =>
      decideConversationToolCall(
        stateRef.current.activeConversationId,
        activeChat,
        decision,
      ),
    [activeChat, decideConversationToolCall, stateRef],
  );

  const {
    clearConversation: clearAutomaticToolApproval,
    process: processAutomaticToolApprovals,
  } = useAutomaticToolApproval({
    enabled: true,
    decide: decideConversationToolCall,
  });

  const startEditingMessage = useCallback(
    async (message: AIChatMessage) => {
      if (
        message.role !== 'user' ||
        activeChat.status === 'streaming' ||
        activeChat.status === 'submitted'
      ) {
        return;
      }
      let messages = activeChat.messages;
      let targetMessage = message;
      let index = messages.findIndex((item) => item.id === message.id);
      if (index < 0) return;
      const conversationId = stateRef.current.activeConversationId;
      if (!message.metadata?.serverMessageId) {
        const userMessageIndex =
          messages.slice(0, index + 1).filter((item) => item.role === 'user')
            .length - 1;
        try {
          messages = await refreshConversationMessages(
            conversationId,
            activeChat,
            { updateRead: true },
          );
        } catch (error) {
          setHistoryError(
            error instanceof Error
              ? error
              : new Error('Unable to refresh conversation messages'),
          );
          return;
        }
        if (stateRef.current.activeConversationId !== conversationId) return;
        targetMessage = messages.filter((item) => item.role === 'user')[
          userMessageIndex
        ];
        if (!targetMessage?.metadata?.serverMessageId) return;
        index = messages.findIndex((item) => item.id === targetMessage.id);
        if (index < 0) return;
      }
      const serverMessageId = targetMessage.metadata?.serverMessageId;
      editingSnapshotRef.current = {
        conversationId,
        messages: [...messages],
        attachments: getConversationAttachments(conversationId),
        workContext: getConversationWorkContext(conversationId),
      };
      setEditingMessageId(serverMessageId ?? targetMessage.id);
      // Resolve the chat here rather than mutating the one this render closed
      // over: the store write belongs to the callback, not to the render.
      getChat(conversationId).messages = messages.slice(0, index);
      setConversationAttachments(
        conversationId,
        targetMessage.metadata?.attachments ?? [],
      );
      setConversationWorkContext(
        conversationId,
        targetMessage.metadata?.workContext ?? [],
      );
      dispatch({
        type: 'set-draft',
        conversationId,
        value: targetMessage.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
      });
      requestComposerFocus();
    },
    [
      activeChat,
      dispatch,
      editingSnapshotRef,
      getChat,
      getConversationAttachments,
      getConversationWorkContext,
      refreshConversationMessages,
      requestComposerFocus,
      setConversationAttachments,
      setConversationWorkContext,
      setEditingMessageId,
      setHistoryError,
      stateRef,
    ],
  );

  const cancelEditingMessage = useCallback(() => {
    const snapshot = editingSnapshotRef.current;
    if (
      snapshot &&
      snapshot.conversationId === stateRef.current.activeConversationId
    ) {
      getChat(snapshot.conversationId).messages = snapshot.messages;
      setConversationAttachments(snapshot.conversationId, snapshot.attachments);
      setConversationWorkContext(snapshot.conversationId, snapshot.workContext);
      dispatch({
        type: 'set-draft',
        conversationId: snapshot.conversationId,
        value: '',
      });
    }
    setEditingMessageId(undefined);
    editingSnapshotRef.current = undefined;
  }, [
    dispatch,
    editingSnapshotRef,
    getChat,
    setConversationAttachments,
    setConversationWorkContext,
    setEditingMessageId,
    stateRef,
  ]);

  return {
    retryMessage,
    continueReply,
    decideToolCall,
    startEditingMessage,
    cancelEditingMessage,
    clearAutomaticToolApproval,
    processAutomaticToolApprovals,
  };
}

// @vitest-environment jsdom
import {
  AIContext,
  type AIProviderValue,
} from '../../client/extensions/nocobase-ai/providers/ai-context.js';
import { AIChatProvider } from '../../client/extensions/nocobase-ai/providers/chat-provider.js';
import { useAIChatBase } from '../../client/extensions/nocobase-ai/providers/chat-context.js';
import { ChatMessages } from '../../client/extensions/nocobase-ai/components/chat/chat-messages.js';
import { NocoBaseChatTransport } from '../../client/extensions/nocobase-ai/providers/chat-transport.js';
import type { AIService } from '../../client/extensions/nocobase-ai/services/types.js';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConversationHistory } from '../../client/extensions/nocobase-ai/providers/use-conversation-history.js';
import { useChatMessageActions } from '../../client/extensions/nocobase-ai/providers/use-chat-message-actions.js';
import { getDecidedToolMessage } from '../../client/extensions/nocobase-ai/providers/chat-message-utils.js';
import { AIChatMessageList } from '../../client/extensions/nocobase-ai/components/chat/chat-messages.js';
import type { AIChatMessage } from '../../client/extensions/nocobase-ai/providers/types.js';

// Use real chat contexts; stub unrelated rich cards and locale infrastructure.
vi.mock(
  '../../client/extensions/nocobase-ai/providers/index.js',
  async () =>
    import('../../client/extensions/nocobase-ai/providers/chat-context.js'),
);
vi.mock(
  '../../client/extensions/nocobase-ai/components/chat/chat-message.js',
  () => ({ ChatMessage: () => <div>Saved tool result</div> }),
);
vi.mock(
  '../../client/extensions/nocobase-ai/components/chat/chat-empty-state.js',
  () => ({ ChatEmptyState: () => null }),
);
vi.mock(
  '../../client/extensions/nocobase-ai/locales/use-ai-translate.js',
  () => ({
    useAITranslate: () => (_key: string, fallback: string) => fallback,
  }),
);
afterEach(cleanup);

const message = (
  state:
    | 'output-available'
    | 'output-error'
    | 'input-available' = 'output-available',
): AIChatMessage => ({
  id: 'saved-message',
  role: 'assistant',
  metadata: { serverMessageId: 'saved-message' },
  parts: [
    {
      type: 'dynamic-tool',
      toolName: 'action',
      toolCallId: 'saved-call',
      state,
      input: {},
      ...(state === 'output-error'
        ? { errorText: 'BUSINESS_REFUSED' }
        : state === 'output-available'
          ? { output: { value: 42 } }
          : {}),
      callProviderMetadata: {
        nocobase: { requiresApproval: state === 'input-available' },
      },
    } as AIChatMessage['parts'][number],
  ],
});

function actionFixture() {
  const chat = {
    id: 'assistant-session',
    status: 'ready',
    error: undefined as Error | undefined,
    messages: [message()],
    resumeStream: vi.fn<() => Promise<void>>(async () => undefined),
    regenerate: vi.fn<() => Promise<void>>(async () => undefined),
  };
  const otherChat = {
    id: 'other-conversation',
    status: 'ready',
    messages: [message('output-error')],
    resumeStream: vi.fn<() => Promise<void>>(async () => undefined),
  };
  const transport = {
    prepareToolResume: vi.fn(),
    cancelToolResume: vi.fn(),
    prepareResend: vi.fn(),
    cancelResend: vi.fn(),
  };
  const ai = { updateToolCallDecision: vi.fn(), invokeToolCall: vi.fn() };
  const setError = vi.fn();
  const stateRef = { current: { activeConversationId: chat.id } };
  const actionTokenRef = { current: new Map<string, symbol>() };
  const options = {
    ai,
    activeChat: chat,
    getChat: (conversationId: string) =>
      (conversationId === chat.id ? chat : otherChat) as never,
    stateRef,
    actionTokenRef,
    chatSurfaceOpenRef: { current: true },
    transportsRef: { current: new Map([[chat.id, transport]]) },
    getRuntimeContext: () => ({ employeeUsername: 'employee' }),
    refreshConversationMessages: vi.fn(),
    setHistoryError: setError,
    editingSnapshotRef: { current: undefined },
    setEditingMessageId: vi.fn(),
    getConversationAttachments: () => [],
    getConversationWorkContext: () => [],
    setConversationAttachments: vi.fn(),
    setConversationWorkContext: vi.fn(),
    dispatch: vi.fn(),
    requestComposerFocus: vi.fn(),
  } as unknown as Parameters<typeof useChatMessageActions>[0];
  return {
    chat,
    otherChat,
    transport,
    ai,
    setError,
    stateRef,
    actionTokenRef,
    options,
  };
}

const decide = (
  decideToolCall: ReturnType<typeof useChatMessageActions>['decideToolCall'],
) =>
  decideToolCall({
    messageId: 'saved-message',
    toolCallId: 'saved-call',
    toolName: 'action',
    decision: 'approve',
  });

const makeDecisionContinue = (f: ReturnType<typeof actionFixture>) => {
  f.ai.updateToolCallDecision.mockImplementation(
    async () =>
      ({
        updated: true,
        toolCalls: [
          {
            id: 'saved-call',
            name: 'action',
            args: {},
            willInterrupt: true,
            execution: 'frontend',
            auto: false,
            invokeStatus: 'waiting',
          },
        ],
      }) as never,
  );
  f.ai.invokeToolCall.mockImplementation(async () => ({ handled: false }));
};

describe('saved tool decision continuation', () => {
  it('offers an explicit page action after reopen without executing or deciding a tool', async () => {
    const f = actionFixture();
    const hook = renderHook(() => useChatMessageActions(f.options));
    const { rerender } = render(
      <AIChatMessageList
        messages={f.chat.messages}
        continueReply={hook.result.current.continueReply}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue reply' }));
    await waitFor(() => expect(f.chat.resumeStream).toHaveBeenCalledTimes(1));
    expect(f.transport.prepareToolResume).toHaveBeenCalledWith(
      'saved-message',
      expect.stringMatching(/^assistant-/),
      ['saved-call'],
      [],
    );
    expect(f.ai.updateToolCallDecision).not.toHaveBeenCalled();
    expect(f.ai.invokeToolCall).not.toHaveBeenCalled();
    expect(f.chat.messages[0]).toEqual(message());
    rerender(
      <AIChatMessageList
        messages={f.chat.messages}
        continueReply={hook.result.current.continueReply}
        status='submitted'
      />,
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Continue reply',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    rerender(
      <AIChatMessageList
        messages={f.chat.messages}
        continueReply={hook.result.current.continueReply}
        readOnly
      />,
    );
    expect(screen.queryByRole('button', { name: 'Continue reply' })).toBeNull();
  });

  it('connects the actual chat Provider, restored history, page button and transport', async () => {
    let finished = false;
    const resume = vi.fn(async () => {
      finished = true;
      const events = [
        { type: 'new_message', body: { id: 'final-reply' } },
        { type: 'content', body: { content: 'Done' } },
      ];
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
            ),
          );
          controller.close();
        },
      });
    });
    const model = {
      llmService: 'synthetic',
      value: 'synthetic',
      label: 'Synthetic',
    };
    const employee = {
      username: 'employee',
      nickname: 'Employee',
      position: '',
      greeting: '',
    };
    const value = {
      configurationStatus: 'ready',
      employees: [employee],
      models: [model],
      hasEnabledModels: true,
      listConversations: vi.fn(async () => [
        {
          id: 'assistant-session',
          title: 'Saved',
          employeeUsername: 'employee',
          updatedAt: new Date().toISOString(),
        },
      ]),
      getConversationMessages: vi.fn(async () =>
        finished
          ? [
              {
                id: 'final-reply',
                role: 'assistant',
                metadata: { serverMessageId: 'final-reply' },
                parts: [{ type: 'text', text: 'Done' }],
              },
            ]
          : [message()],
      ),
      getConversationActiveState: vi.fn(async () =>
        finished ? 'idle' : 'pending',
      ),
      createTransport: ({ getContext }: { getContext: () => never }) =>
        new NocoBaseChatTransport({
          service: { resumeToolCallStream: resume } as unknown as AIService,
          getContext,
        }),
      updateToolCallDecision: vi.fn(),
      invokeToolCall: vi.fn(),
      canAutoApproveToolCall: () => false,
    } as unknown as AIProviderValue;
    function Page() {
      const chat = useAIChatBase();
      return (
        <>
          <button onClick={() => chat.selectConversation('assistant-session')}>
            Open saved conversation
          </button>
          <ChatMessages />
        </>
      );
    }
    render(
      <AIContext.Provider value={value}>
        <AIChatProvider id='continuation-page'>
          <Page />
        </AIChatProvider>
      </AIContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Open saved conversation' }),
    );
    const button = await screen.findByRole('button', {
      name: 'Continue reply',
    });
    expect(value.getConversationMessages).toHaveBeenCalledTimes(1);
    expect(value.getConversationActiveState).toHaveBeenCalledTimes(1);
    expect(resume).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(resume).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'assistant-session',
        messageId: 'saved-message',
        toolCallResults: [],
      }),
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Continue reply' }),
      ).toBeNull(),
    );
    expect(value.updateToolCallDecision).not.toHaveBeenCalled();
    expect(value.invokeToolCall).not.toHaveBeenCalled();
  });

  it('blocks repeated clicks while continuation is in flight', async () => {
    const f = actionFixture();
    let release!: () => void;
    f.chat.resumeStream.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useChatMessageActions(f.options));
    await act(async () => {
      const first = result.current.continueReply();
      await result.current.continueReply();
      expect(f.chat.resumeStream).toHaveBeenCalledTimes(1);
      release();
      await first;
    });
    expect(f.transport.prepareToolResume).toHaveBeenCalledTimes(1);
  });

  it('preserves business errors and removes a failed continuation placeholder', async () => {
    const f = actionFixture();
    f.chat.messages = [message('output-error')];
    f.chat.resumeStream.mockRejectedValue(new Error('CHAT_REQUEST_CONFLICT'));
    const { result } = renderHook(() => useChatMessageActions(f.options));
    await act(() => result.current.continueReply());
    expect(f.chat.messages).toEqual([message('output-error')]);
    expect(f.transport.cancelToolResume).toHaveBeenCalledWith('saved-message');
    expect(f.setError).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'CHAT_REQUEST_CONFLICT' }),
    );
    expect(f.ai.invokeToolCall).not.toHaveBeenCalled();
  });

  it.each(['decision', 'continue'] as const)(
    'removes only an empty placeholder when %s continuation fails',
    async (kind) => {
      const f = actionFixture();
      if (kind === 'decision') makeDecisionContinue(f);
      else f.chat.messages = [message('output-error')];
      const before = [...f.chat.messages];
      const failure = new Error('CHAT_REQUEST_CONFLICT');
      f.chat.resumeStream.mockRejectedValue(failure);
      const { result } = renderHook(() => useChatMessageActions(f.options));

      if (kind === 'decision') {
        await expect(
          act(() => decide(result.current.decideToolCall)),
        ).rejects.toBe(failure);
      } else {
        await act(() => result.current.continueReply());
      }

      expect(f.chat.messages).toEqual(before);
      expect(f.transport.cancelToolResume).toHaveBeenCalledWith(
        'saved-message',
      );
      expect(f.setError).toHaveBeenLastCalledWith(failure);
    },
  );

  it.each(['decision', 'continue'] as const)(
    'preserves a partial reply when %s continuation fails',
    async (kind) => {
      const f = actionFixture();
      if (kind === 'decision') makeDecisionContinue(f);
      else f.chat.messages = [message('output-error')];
      const failure = new Error('STREAM_DISCONNECTED');
      f.chat.resumeStream.mockImplementation(async () => {
        f.chat.messages.at(-1)!.parts = [
          { type: 'text', text: 'Partial reply' },
          {
            type: 'dynamic-tool',
            toolName: 'action',
            toolCallId: 'completed-call',
            state: 'output-available',
            input: {},
            output: { value: 42 },
          } as AIChatMessage['parts'][number],
        ];
        f.chat.status = 'error';
        f.chat.error = failure;
      });
      const { result } = renderHook(() => useChatMessageActions(f.options));

      if (kind === 'decision') {
        await expect(
          act(() => decide(result.current.decideToolCall)),
        ).rejects.toBe(failure);
      } else {
        await act(() => result.current.continueReply());
      }

      expect(f.chat.messages.at(-1)?.parts).toEqual([
        { type: 'text', text: 'Partial reply' },
        expect.objectContaining({
          type: 'dynamic-tool',
          toolCallId: 'completed-call',
          output: { value: 42 },
        }),
      ]);
      expect(f.setError).toHaveBeenLastCalledWith(failure);
    },
  );

  it.each(['decision', 'continue'] as const)(
    'keeps a late %s failure out of the newly selected conversation',
    async (kind) => {
      const f = actionFixture();
      if (kind === 'decision') makeDecisionContinue(f);
      else f.chat.messages = [message('output-error')];
      let rejectResume!: (error: Error) => void;
      f.chat.resumeStream.mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectResume = reject;
          }),
      );
      const { result } = renderHook(() => useChatMessageActions(f.options));
      const pending =
        kind === 'decision'
          ? decide(result.current.decideToolCall)
          : result.current.continueReply();
      await waitFor(() => expect(f.chat.resumeStream).toHaveBeenCalledTimes(1));

      f.stateRef.current.activeConversationId = 'other-conversation';
      f.actionTokenRef.current.set(f.chat.id, Symbol(f.chat.id));
      const failure = new Error('OLD_CONVERSATION_FAILED');
      await act(async () => {
        rejectResume(failure);
        await pending;
      });

      expect(f.setError.mock.calls.filter(([error]) => error)).toEqual([]);
      expect(f.otherChat.messages).toEqual([message('output-error')]);
      expect(f.chat.messages).toEqual([
        message(kind === 'decision' ? 'output-available' : 'output-error'),
        expect.objectContaining({ role: 'assistant', parts: [] }),
      ]);
    },
  );

  it.each(['decision', 'continue'] as const)(
    'ignores a stale %s failure after a newer same-conversation action',
    async (kind) => {
      const f = actionFixture();
      if (kind === 'decision') makeDecisionContinue(f);
      else f.chat.messages = [message('output-error')];
      let rejectResume!: (error: Error) => void;
      f.chat.resumeStream.mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectResume = reject;
          }),
      );
      const latestReply: AIChatMessage = {
        id: 'latest-reply',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Newer reply' }],
      };
      f.chat.regenerate.mockImplementation(async () => {
        f.chat.messages = [...f.chat.messages, latestReply];
      });
      const { result } = renderHook(() => useChatMessageActions(f.options));
      const pending =
        kind === 'decision'
          ? decide(result.current.decideToolCall)
          : result.current.continueReply();
      await waitFor(() => expect(f.chat.resumeStream).toHaveBeenCalledTimes(1));

      await act(() => result.current.retryMessage(message('output-error')));
      const failure = new Error('OLD_OPERATION_FAILED');
      await act(async () => {
        rejectResume(failure);
        await pending;
      });

      expect(f.chat.messages).toContainEqual(latestReply);
      expect(f.setError.mock.calls.filter(([error]) => error)).toEqual([]);
      expect(f.transport.cancelToolResume).not.toHaveBeenCalled();
    },
  );

  it.each(['decision', 'continue'] as const)(
    'does not mistake a newer same-conversation error for a late %s result',
    async (kind) => {
      const f = actionFixture();
      if (kind === 'decision') makeDecisionContinue(f);
      else f.chat.messages = [message('output-error')];
      let resolveResume!: () => void;
      f.chat.resumeStream.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveResume = resolve;
          }),
      );
      const latestError = new Error('NEWER_OPERATION_FAILED');
      f.chat.regenerate.mockImplementation(async () => {
        f.chat.status = 'error';
        f.chat.error = latestError;
        throw latestError;
      });
      const { result } = renderHook(() => useChatMessageActions(f.options));
      const pending =
        kind === 'decision'
          ? decide(result.current.decideToolCall)
          : result.current.continueReply();
      await waitFor(() => expect(f.chat.resumeStream).toHaveBeenCalledTimes(1));

      await act(() => result.current.retryMessage(message('output-error')));
      resolveResume();
      await act(() => pending);

      expect(f.setError.mock.calls.filter(([error]) => error)).toEqual([
        [latestError],
      ]);
    },
  );

  it('does not truncate a newer reply when an old decision response arrives', async () => {
    const f = actionFixture();
    makeDecisionContinue(f);
    const accepted = f.ai.updateToolCallDecision.getMockImplementation()!;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.ai.updateToolCallDecision.mockImplementation(async (...args) => {
      await waiting;
      return accepted(...args);
    });
    const latestReply: AIChatMessage = {
      id: 'newer-reply',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Keep newer reply' }],
    };
    f.chat.regenerate.mockImplementation(async () => {
      f.chat.messages = [...f.chat.messages, latestReply];
    });
    const { result } = renderHook(() => useChatMessageActions(f.options));

    const pending = decide(result.current.decideToolCall);
    await waitFor(() =>
      expect(f.ai.updateToolCallDecision).toHaveBeenCalledTimes(1),
    );
    await act(() => result.current.retryMessage(message('output-error')));
    expect(f.chat.messages).toContainEqual(latestReply);

    release();
    await act(() => pending);

    expect(f.chat.messages).toContainEqual(latestReply);
    expect(f.chat.resumeStream).not.toHaveBeenCalled();
  });

  it('stops a superseded decision after its tool invocation returns', async () => {
    const f = actionFixture();
    makeDecisionContinue(f);
    let release!: (value: { handled: boolean; result?: unknown }) => void;
    f.ai.invokeToolCall.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const latestReply: AIChatMessage = {
      id: 'newer-reply',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Keep newer reply' }],
    };
    f.chat.regenerate.mockImplementation(async () => {
      f.chat.messages = [...f.chat.messages, latestReply];
    });
    const { result } = renderHook(() => useChatMessageActions(f.options));

    const pending = decide(result.current.decideToolCall);
    await waitFor(() => expect(f.ai.invokeToolCall).toHaveBeenCalledTimes(1));
    await act(() => result.current.retryMessage(message('output-error')));
    release({ handled: true, result: { completed: true } });
    await act(() => pending);

    expect(f.chat.messages).toContainEqual(latestReply);
    expect(f.transport.prepareToolResume).not.toHaveBeenCalled();
    expect(f.chat.resumeStream).not.toHaveBeenCalled();
  });

  it('does not offer a finished reply or an incompletely decided group', () => {
    expect(getDecidedToolMessage([message('input-available')])).toBeUndefined();
    expect(
      getDecidedToolMessage([
        message(),
        {
          id: 'reply',
          role: 'assistant',
          metadata: { serverMessageId: 'reply' },
          parts: [{ type: 'text', text: 'Done' }],
        },
      ]),
    ).toBeUndefined();
    expect(getDecidedToolMessage([message('output-error')])).toBeDefined();
  });

  it('reloads persisted pending state on close/reopen and never auto-resumes it', async () => {
    const f = actionFixture();
    const getMessages = vi.fn(async () => [message()]);
    const getState = vi.fn(async () => 'pending');
    const onError = vi.fn();
    const onRead = vi.fn();
    const getChat = () => f.chat as never;
    const getId = () => f.chat.id;
    const getTransport = () => f.transport as never;
    const hook = renderHook(
      ({ open }) =>
        useConversationHistory({
          chatSurfaceOpen: open,
          activeConversationId: f.chat.id,
          getActiveConversationId: getId,
          getChat,
          getTransport,
          getConversationMessages: getMessages,
          getConversationActiveState: getState,
          onMarkRead: onRead,
          onError,
        }),
      { initialProps: { open: true } },
    );
    await waitFor(() =>
      expect(hook.result.current.pendingConversationId).toBe(f.chat.id),
    );
    expect(f.chat.resumeStream).not.toHaveBeenCalled();
    hook.rerender({ open: false });
    hook.rerender({ open: true });
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(2));
    expect(hook.result.current.pendingConversationId).toBe(f.chat.id);
    expect(f.chat.resumeStream).not.toHaveBeenCalled();
  });

  it('does not write a stale history refresh over a newer reply', async () => {
    const f = actionFixture();
    let resolveMessages!: (messages: AIChatMessage[]) => void;
    const getMessages = vi.fn(
      () =>
        new Promise<AIChatMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const getState = vi.fn(async () => 'idle');
    const hook = renderHook(() =>
      useConversationHistory({
        chatSurfaceOpen: false,
        activeConversationId: f.chat.id,
        getActiveConversationId: () => f.chat.id,
        getChat: () => f.chat as never,
        getTransport: () => f.transport as never,
        getConversationMessages: getMessages,
        getConversationActiveState: getState,
        onMarkRead: vi.fn(),
        onError: vi.fn(),
      }),
    );
    let current = true;
    const pending = hook.result.current.refresh(f.chat.id, f.chat as never, {
      updateRead: true,
      isCurrent: () => current,
    });
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));

    const latestReply: AIChatMessage = {
      id: 'newer-reply',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Keep newer reply' }],
    };
    f.chat.messages = [latestReply];
    current = false;
    await act(async () => {
      resolveMessages([message('output-error')]);
      await pending;
    });

    expect(f.chat.messages).toEqual([latestReply]);
  });

  it('stops a superseded decision during a coalesced message refresh', async () => {
    const f = actionFixture();
    const unresolvedMessage: AIChatMessage = {
      ...message(),
      metadata: undefined,
    };
    f.chat.messages = [unresolvedMessage];
    let resolveMessages!: (messages: AIChatMessage[]) => void;
    const getMessages = vi.fn(
      () =>
        new Promise<AIChatMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const history = renderHook(() =>
      useConversationHistory({
        chatSurfaceOpen: false,
        activeConversationId: f.chat.id,
        getActiveConversationId: () => f.chat.id,
        getChat: () => f.chat as never,
        getTransport: () => f.transport as never,
        getConversationMessages: getMessages,
        getConversationActiveState: vi.fn(async () => 'idle'),
        onMarkRead: vi.fn(),
        onError: vi.fn(),
      }),
    );
    const actions = renderHook(() =>
      useChatMessageActions({
        ...f.options,
        refreshConversationMessages: history.result.current.refresh,
      }),
    );
    const latestReply: AIChatMessage = {
      id: 'newer-reply',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Keep newer reply' }],
    };
    f.chat.regenerate.mockImplementation(async () => {
      f.chat.messages = [...f.chat.messages, latestReply];
    });

    const pendingDecision = decide(actions.result.current.decideToolCall);
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
    const pendingRetry = actions.result.current.retryMessage(unresolvedMessage);
    expect(getMessages).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMessages([message()]);
      await Promise.all([pendingDecision, pendingRetry]);
    });

    expect(f.chat.messages).toContainEqual(latestReply);
    expect(f.ai.updateToolCallDecision).not.toHaveBeenCalled();
    expect(f.chat.resumeStream).not.toHaveBeenCalled();
  });

  it('does not write a superseded unsuccessful decision refresh', async () => {
    const f = actionFixture();
    f.ai.updateToolCallDecision.mockImplementation(
      async () => ({ updated: false, toolCalls: [] }) as never,
    );
    let resolveMessages!: (messages: AIChatMessage[]) => void;
    const getMessages = vi.fn(
      () =>
        new Promise<AIChatMessage[]>((resolve) => {
          resolveMessages = resolve;
        }),
    );
    const history = renderHook(() =>
      useConversationHistory({
        chatSurfaceOpen: false,
        activeConversationId: f.chat.id,
        getActiveConversationId: () => f.chat.id,
        getChat: () => f.chat as never,
        getTransport: () => f.transport as never,
        getConversationMessages: getMessages,
        getConversationActiveState: vi.fn(async () => 'idle'),
        onMarkRead: vi.fn(),
        onError: vi.fn(),
      }),
    );
    const actions = renderHook(() =>
      useChatMessageActions({
        ...f.options,
        refreshConversationMessages: history.result.current.refresh,
      }),
    );
    const latestReply: AIChatMessage = {
      id: 'newer-reply',
      role: 'assistant',
      parts: [{ type: 'text', text: 'Keep newer reply' }],
    };
    f.chat.regenerate.mockImplementation(async () => {
      f.chat.messages = [...f.chat.messages, latestReply];
    });

    const pendingDecision = decide(actions.result.current.decideToolCall);
    await waitFor(() => expect(getMessages).toHaveBeenCalledTimes(1));
    await act(() =>
      actions.result.current.retryMessage(message('output-error')),
    );
    expect(f.chat.messages).toContainEqual(latestReply);

    await act(async () => {
      resolveMessages([message('output-error')]);
      await pendingDecision;
    });

    expect(f.chat.messages).toContainEqual(latestReply);
    expect(f.chat.resumeStream).not.toHaveBeenCalled();
  });

  it('ignores late state responses after switching conversations', async () => {
    const f = actionFixture();
    let resolve!: (state: string) => void;
    const getState = vi.fn(
      () =>
        new Promise<string>((r) => {
          resolve = r;
        }),
    );
    let active = f.chat.id;
    const getId = () => active;
    const getChat = () => f.chat as never;
    const getMessages = async () => [message()];
    const getTransport = () => undefined;
    const onRead = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useConversationHistory({
        chatSurfaceOpen: true,
        activeConversationId: f.chat.id,
        getActiveConversationId: getId,
        getChat,
        getTransport,
        getConversationMessages: getMessages,
        getConversationActiveState: getState,
        onMarkRead: onRead,
        onError,
      }),
    );
    await waitFor(() => expect(getState).toHaveBeenCalledTimes(1));
    active = 'another-session';
    await act(async () => resolve('pending'));
    expect(result.current.pendingConversationId).toBeUndefined();
  });
});

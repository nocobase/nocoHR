// @vitest-environment jsdom
import { Chat } from '@ai-sdk/react';
import type { ApiClient, ApiRequestOptions } from '@nocobase/app-client';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NocoBaseChatTransport } from '../../client/extensions/nocobase-ai/providers/chat-transport.js';
import { isAIToolPart } from '../../client/extensions/nocobase-ai/providers/chat-message-utils.js';
import { useChatMessageActions } from '../../client/extensions/nocobase-ai/providers/use-chat-message-actions.js';
import type { AIChatMessage } from '../../client/extensions/nocobase-ai/providers/types.js';
import type { AIService } from '../../client/extensions/nocobase-ai/services/types.js';
import { RuntimeAIService } from '../../client/extensions/nocobase-ai/services/runtime-ai-service.js';
import { createAssistantChatFixture } from '../fixtures/assistant-chat-runtime.js';
import { assistantChatProtocol as protocol } from '../fixtures/assistant-chat-protocol.js';

afterEach(cleanup);

// Only the HTTP/storage boundary is synthetic. Use the application service,
// transport, decision hook and server adapter with the published SDK Chat.
function fixture(
  options: Parameters<typeof createAssistantChatFixture>[0] = {},
) {
  const f = createAssistantChatFixture(options);
  let session = f.session();
  let actor = f.actor;
  const requests: ApiRequestOptions[] = [];
  const request = vi.fn(async (input: ApiRequestOptions) => {
    requests.push(input);
    if (input.path === 'assistantRuntime') return { data: { enabled: true } };
    if (input.path?.endsWith('/userDecision')) {
      const segments = input.path.split('/');
      return {
        data: await f
          .adapter()
          .decide(actor, session, segments[3], segments[5], input.json),
      };
    }
    throw new Error(`Unexpected request: ${input.path}`);
  });
  const stream = vi.fn(async (input: ApiRequestOptions) => {
    requests.push(input);
    const body = {
      ...(JSON.parse(JSON.stringify(input.json)) as Record<string, unknown>),
      sessionId: session.id,
    };
    const signal = input.signal ?? new AbortController().signal;
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const emit = async (event: unknown) => {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          };
          const result = input.path?.endsWith('/send')
            ? await f.adapter().send(actor, session, body, signal, emit)
            : await f.adapter().resume(actor, session, body, signal, emit);
          session = {
            ...session,
            history: result.messages,
            pendingCallIds: result.pending.map((call) => call.id),
          };
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
  });
  const service = new RuntimeAIService({
    request,
    stream,
  } as unknown as ApiClient);
  const createChat = (messages: AIChatMessage[] = []) => {
    const transport = new NocoBaseChatTransport({
      service,
      getContext: () => ({
        sessionId: session.id,
        employee: {
          username: protocol.employee,
          nickname: 'Synthetic assistant',
        },
        model: {
          value: protocol.model.model,
          llmService: protocol.model.llmService,
          label: 'Synthetic',
          configured: true,
        },
      }),
    });
    const chat = new Chat<AIChatMessage>({
      id: session.id,
      messages,
      transport,
    });
    const invoke = vi.fn(async () => ({ handled: false }));
    const setError = vi.fn();
    const stateRef = { current: { activeConversationId: session.id } };
    const hookOptions = {
      ai: {
        updateToolCallDecision: service.updateToolCallDecision.bind(service),
        invokeToolCall: invoke,
      },
      activeChat: chat,
      getChat: () => chat,
      stateRef,
      chatSurfaceOpenRef: { current: true },
      transportsRef: { current: new Map([[session.id, transport]]) },
      getRuntimeContext: () => ({ employeeUsername: protocol.employee }),
      refreshConversationMessages: async () => {
        // Model the host's persisted message id lookup, without a database.
        chat.messages = chat.messages.map((message) =>
          message.parts.some(isAIToolPart)
            ? {
                ...message,
                metadata: {
                  ...message.metadata,
                  serverMessageId: f.messageId(),
                },
              }
            : message,
        );
        return chat.messages;
      },
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
    const hook = renderHook(() => useChatMessageActions(hookOptions));
    const decide = async (
      decision: 'approve' | 'reject',
      toolCallId = 'synthetic-model-call',
    ) => {
      const message = chat.messages.find((m) =>
        m.parts.some((p) => isAIToolPart(p) && p.toolCallId === toolCallId),
      )!;
      await act(() =>
        hook.result.current.decideToolCall({
          messageId: message.id,
          toolCallId,
          toolName: 'saveDraft',
          decision,
        }),
      );
    };
    return { chat, transport, hook, decide, invoke, setError, hookOptions };
  };
  return {
    f,
    service,
    createChat,
    requests,
    stream,
    request,
    decideStored: () =>
      f
        .adapter()
        .decide(
          f.actor,
          session,
          f.messageId(),
          'synthetic-model-call',
          protocol.approve,
        ),
    otherUser: () => {
      actor = { ...actor, id: 'other' };
    },
  };
}

const send = (chat: Chat<AIChatMessage>) =>
  act(() =>
    chat.sendMessage({
      id: protocol.send.messages[0].key,
      role: 'user',
      parts: [
        { type: 'text', text: protocol.send.messages[0].content.content },
      ],
    }),
  );
const toolParts = (chat: Chat<AIChatMessage>) =>
  chat.messages.flatMap((m) => m.parts.filter(isAIToolPart));
const text = (chat: Chat<AIChatMessage>) =>
  chat.messages
    .at(-1)
    ?.parts.filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');

const reopenWithDecidedHistory = async (h: ReturnType<typeof fixture>) => {
  const page = h.createChat();
  await send(page.chat);
  await h.decideStored();
  const saved = structuredClone(page.chat.messages).map((message) => ({
    ...message,
    metadata: { serverMessageId: h.f.messageId() },
    parts: message.parts.map((part) =>
      isAIToolPart(part)
        ? {
            type: 'dynamic-tool' as const,
            toolName:
              part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5),
            toolCallId: part.toolCallId,
            input: part.input,
            state: 'output-available' as const,
            output: { id: 'synthetic-draft' },
          }
        : part,
    ),
  }));
  page.hook.unmount();
  return h.createChat(saved);
};

describe('published Chat SDK and application chat contracts', () => {
  it('sends the unchanged request through RuntimeAIService and consumes text', async () => {
    const h = fixture({ plain: true });
    const { chat } = h.createChat();
    await send(chat);
    expect(chat.status).toBe('ready');
    expect(text(chat)).toBe('Your decision has been recorded.');
    const { sessionId: _session, ...body } = protocol.send;
    expect(JSON.parse(JSON.stringify(h.stream.mock.calls[0][0].json))).toEqual(
      body,
    );
    expect(chat.messages[0].id).toBe(protocol.send.messages[0].key);
    expect(h.requests.map((r) => r.path)).toEqual([
      'assistantRuntime',
      `assistantConversations/${protocol.sessionId}/send`,
    ]);
  });

  it('consumes automatic backend results without a browser invocation or extra request', async () => {
    const h = fixture({ calls: 0, autoCalls: 1 });
    const page = h.createChat();
    await send(page.chat);
    expect(page.chat.error).toBeUndefined();
    expect(toolParts(page.chat)).toMatchObject([
      {
        toolCallId: 'synthetic-auto-call-1',
        state: 'output-available',
        output: { value: 42 },
      },
    ]);
    expect(h.f.counts.invokes).toBe(1);
    expect(page.invoke).not.toHaveBeenCalled();
    expect(h.requests).toHaveLength(2);
  });

  it.each(['approve', 'reject'] as const)(
    'records %s and consumes the continued reply with the real decision hook',
    async (decision) => {
      const h = fixture();
      const page = h.createChat();
      await send(page.chat);
      expect(toolParts(page.chat)).toMatchObject([
        { toolCallId: 'synthetic-model-call', state: 'input-available' },
      ]);
      await page.decide(decision);
      expect(page.chat.error).toBeUndefined();
      expect(page.setError.mock.calls.filter(([error]) => error)).toEqual([]);
      expect(text(page.chat)).toBe('Your decision has been recorded.');
      expect(h.f.counts.invokes).toBe(decision === 'approve' ? 1 : 0);
      expect(h.requests.map((r) => r.method)).toEqual([
        'GET',
        'POST',
        'PUT',
        'POST',
      ]);
      expect(h.stream.mock.calls[1][0].json).toMatchObject({
        messageId: h.f.messageId(),
        toolCallResults: [],
      });
      expect(page.invoke).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps mixed tool results distinct and waits for the last manual decision', async () => {
    const h = fixture({ calls: 2, autoCalls: 1 });
    const page = h.createChat();
    await send(page.chat);
    await page.decide('approve');
    expect(h.stream).toHaveBeenCalledTimes(1);
    await page.decide('reject', 'synthetic-model-call-2');
    expect(page.chat.error).toBeUndefined();
    expect(toolParts(page.chat)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: 'synthetic-auto-call-1',
          state: 'output-available',
        }),
        expect.objectContaining({
          toolCallId: 'synthetic-model-call',
          state: 'output-available',
        }),
        expect.objectContaining({
          toolCallId: 'synthetic-model-call-2',
          state: 'output-error',
        }),
      ]),
    );
    expect(h.f.counts.invokes).toBe(2);
  });

  it('reopens a decided group and explicitly continues without executing it again', async () => {
    const h = fixture();
    const page = h.createChat();
    await send(page.chat);
    await h.decideStored();
    const saved = structuredClone(page.chat.messages).map((m) => ({
      ...m,
      metadata: { serverMessageId: h.f.messageId() },
      parts: m.parts.map((p) =>
        isAIToolPart(p)
          ? {
              type: 'dynamic-tool' as const,
              toolName:
                p.type === 'dynamic-tool' ? p.toolName : p.type.slice(5),
              toolCallId: p.toolCallId,
              input: p.input,
              state: 'output-available' as const,
              output: { id: 'synthetic-draft' },
            }
          : p,
      ),
    }));
    page.hook.unmount();
    const reopened = h.createChat(saved);
    expect(h.stream).toHaveBeenCalledTimes(1);
    await act(() => reopened.hook.result.current.continueReply());
    expect(reopened.chat.error).toBeUndefined();
    expect(text(reopened.chat)).toBe('Your decision has been recorded.');
    expect(h.f.counts.invokes).toBe(1);
    expect(reopened.invoke).not.toHaveBeenCalled();
    expect(reopened.chat.messages.slice(0, saved.length)).toEqual(saved);
    await act(() => reopened.hook.result.current.continueReply());
    expect(h.stream).toHaveBeenCalledTimes(2);
    expect(h.f.counts.invokes).toBe(1);
    expect(
      h.request.mock.calls.filter(([r]) => r.path === 'assistantRuntime'),
    ).toHaveLength(1);
  });

  it('renders only the controlled business error in SDK tool output', async () => {
    const h = fixture({
      calls: 0,
      autoCalls: 1,
      toolResult: {
        status: 'error',
        content: { code: 'BUSINESS_REFUSED', secret: 'private' },
      },
    });
    const { chat } = h.createChat();
    await send(chat);
    expect(chat.status).toBe('ready');
    expect(toolParts(chat)).toMatchObject([
      { state: 'output-error', errorText: '{"code":"BUSINESS_REFUSED"}' },
    ]);
    expect(JSON.stringify(chat.messages)).not.toContain('private');
  });

  it.each(['otherUser', 'revoke'] as const)(
    'refuses %s before sending model work',
    async (mode) => {
      const h = fixture({ plain: true });
      const { chat } = h.createChat();
      if (mode === 'otherUser') h.otherUser();
      else h.f.revoke();
      await send(chat);
      expect(chat.status).toBe('error');
      expect(chat.error?.message).toBe(
        mode === 'otherUser' ? 'CONVERSATION_NOT_FOUND' : 'ACCESS_REVOKED',
      );
      expect(h.f.counts.models).toBe(0);
      expect(h.f.counts.invokes).toBe(0);
    },
  );

  it.each(['otherUser', 'revoke'] as const)(
    'refuses %s at decision without executing a tool',
    async (mode) => {
      const h = fixture();
      const page = h.createChat();
      await send(page.chat);
      if (mode === 'otherUser') h.otherUser();
      else h.f.revoke();
      await expect(page.decide('approve')).rejects.toThrow(
        mode === 'otherUser' ? 'CONVERSATION_NOT_FOUND' : 'ACCESS_REVOKED',
      );
      expect(h.f.counts.invokes).toBe(0);
      expect(h.stream).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['otherUser', 'revoke'] as const)(
    'reports %s during resume and removes its empty placeholder',
    async (mode) => {
      const h = fixture();
      const page = h.createChat();
      await send(page.chat);
      await h.decideStored();
      page.chat.messages = page.chat.messages.map((m) => ({
        ...m,
        metadata: { serverMessageId: h.f.messageId() },
        parts: m.parts.map((p) =>
          isAIToolPart(p)
            ? {
                type: 'dynamic-tool' as const,
                toolName:
                  p.type === 'dynamic-tool' ? p.toolName : p.type.slice(5),
                toolCallId: p.toolCallId,
                state: 'output-available' as const,
                input: p.input,
                output: {},
              }
            : p,
        ),
      }));
      const before = structuredClone(page.chat.messages);
      if (mode === 'otherUser') h.otherUser();
      else h.f.revoke();
      await act(() => page.hook.result.current.continueReply());
      expect(page.chat.status).toBe('error');
      expect(page.setError).toHaveBeenLastCalledWith(
        expect.objectContaining({
          message:
            mode === 'otherUser' ? 'CONVERSATION_NOT_FOUND' : 'ACCESS_REVOKED',
        }),
      );
      expect(page.chat.messages).toEqual(before);
      expect(h.f.counts.invokes).toBe(1);
      expect(h.f.counts.models).toBe(1);
    },
  );
});

describe('SDK cancellation and failed continuation', () => {
  it('surfaces a failed post-decision resume instead of retaining an empty reply', async () => {
    const h = fixture();
    const page = h.createChat();
    await send(page.chat);
    const stream = h.stream.getMockImplementation()!;
    h.stream.mockImplementationOnce((input) => {
      h.f.revoke();
      return stream(input);
    });
    const before = page.chat.messages.length;
    await expect(page.decide('approve')).rejects.toThrow('ACCESS_REVOKED');
    expect(page.setError).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: 'ACCESS_REVOKED' }),
    );
    expect(page.chat.messages).toHaveLength(before);
    expect(page.chat.messages.at(-1)?.parts.length).toBeGreaterThan(0);
    expect(h.f.counts.models).toBe(1);
    expect(h.f.counts.invokes).toBe(1);
  });

  it.each(['conversation', 'tool'] as const)(
    'aborts a %s resume while its connection is opening',
    async (mode) => {
      let signal: AbortSignal | undefined;
      let connected!: () => void;
      const opened = new Promise<void>((resolve) => {
        connected = resolve;
      });
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      const reconnect = async (_body: unknown, abortSignal?: AbortSignal) => {
        signal = abortSignal;
        connected();
        await waiting;
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });
      };
      const service = {
        resumeToolCallStream: reconnect,
        resumeConversationStream: reconnect,
      } as unknown as AIService;
      const transport = new NocoBaseChatTransport({
        service,
        getContext: () => ({
          sessionId: 'saved',
          employee: { username: 'employee', nickname: 'Employee' },
          model: { value: 'model', label: 'Model' },
        }),
      });
      if (mode === 'tool')
        transport.prepareToolResume('message', 'reply', ['call'], []);
      const chat = new Chat<AIChatMessage>({ transport });
      const pending = chat.resumeStream();
      await opened;
      await chat.stop();
      release();
      await pending;
      expect(signal?.aborted).toBe(true);
      expect(chat.status).toBe('ready');
      expect(chat.messages).toEqual([]);
    },
  );
});

describe('SDK stop releases the incoming SSE reader', () => {
  it.each(['send', 'conversation', 'tool'] as const)(
    'cancels %s after body consumption starts',
    async (mode) => {
      const cancel = vi.fn();
      const raw = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ type: 'new_message' })}\n\ndata: ${JSON.stringify({ type: 'content', body: 'Partial reply' })}\n\n`,
            ),
          );
        },
        cancel,
      });
      let signal: AbortSignal | undefined;
      const stream = async (_body: unknown, abortSignal?: AbortSignal) => {
        signal = abortSignal;
        return raw;
      };
      const transport = new NocoBaseChatTransport({
        service: {
          sendMessagesStream: stream,
          resumeToolCallStream: stream,
          resumeConversationStream: stream,
        } as unknown as AIService,
        getContext: () => ({
          sessionId: 'saved',
          employee: { username: 'employee', nickname: 'Employee' },
          model: { value: 'model', label: 'Model' },
        }),
      });
      if (mode === 'tool')
        transport.prepareToolResume('message', 'reply', ['call'], []);
      const chat = new Chat<AIChatMessage>({ transport });
      const pending =
        mode === 'send'
          ? chat.sendMessage({ text: 'Hello' })
          : chat.resumeStream();
      await waitFor(() => expect(chat.status).toBe('streaming'));
      await chat.stop();
      await pending;
      await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
      expect(signal?.aborted).toBe(true);
      expect(chat.status).toBe('ready');
      expect(chat.error).toBeUndefined();
      expect(raw.locked).toBe(false);
    },
  );
});

describe('continuation regressions', () => {
  it.each(['decision', 'continue'] as const)(
    'retains partial text after a %s stream failure',
    async (kind) => {
      const h = fixture();
      const page =
        kind === 'decision'
          ? h.createChat()
          : await reopenWithDecidedHistory(h);
      if (kind === 'decision') await send(page.chat);

      let rawController!: ReadableStreamDefaultController<Uint8Array>;
      h.stream.mockImplementationOnce(
        async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              rawController = controller;
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: 'new_message' })}\n\ndata: ${JSON.stringify({ type: 'content', body: 'Saved partial answer' })}\n\n`,
                ),
              );
            },
          }),
      );
      const pending =
        kind === 'decision'
          ? page.decide('approve').catch((error) => error)
          : page.hook.result.current.continueReply();
      await waitFor(() => expect(text(page.chat)).toBe('Saved partial answer'));

      rawController.error(new Error('CONNECTION_LOST'));
      await pending;

      expect(text(page.chat)).toBe('Saved partial answer');
    },
  );

  it.each(['decision', 'continue'] as const)(
    'does not publish a late %s error after switching conversations',
    async (kind) => {
      const h = fixture();
      const page =
        kind === 'decision'
          ? h.createChat()
          : await reopenWithDecidedHistory(h);
      if (kind === 'decision') await send(page.chat);

      let rejectResume!: (reason: Error) => void;
      let release!: () => void;
      const opening = new Promise<void>((resolve) => {
        release = resolve;
      });
      h.stream.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectResume = reject;
            release();
          }),
      );
      const pending =
        kind === 'decision'
          ? page.decide('approve').catch((error) => error)
          : page.hook.result.current.continueReply();
      await opening;
      page.hookOptions.stateRef.current.activeConversationId =
        'new-conversation';
      page.setError.mockClear();
      rejectResume(new Error('OLD_CONVERSATION_FAILED'));
      await pending;

      expect(page.setError).not.toHaveBeenCalled();
    },
  );
});

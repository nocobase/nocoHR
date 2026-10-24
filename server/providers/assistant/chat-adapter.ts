import {
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { z } from 'zod';

import type {
  AIEmployeeOptions,
  RegisteredTool,
  ToolActor,
} from '../../ai/contracts.js';
import { capabilityJsonValue } from '../upgrade/json-value.js';
import { AssistantTurn, type AssistantToolEvent } from './model-turn.js';
import {
  ToolExecutor,
  toolArgumentDigest,
  type StoredToolCall,
  type ToolAuthorization,
  type ToolCallStore,
} from './tool-executor.js';

const model = z.strictObject({
  llmService: z.string().optional(),
  model: z.string(),
});
export const sendRequest = z.strictObject({
  sessionId: z.string(),
  aiEmployee: z.string(),
  model,
  messages: z.tuple([
    z.strictObject({
      key: z.string().min(1).max(200),
      role: z.literal('user'),
      content: z.strictObject({
        type: z.literal('text'),
        content: z.string(),
      }),
    }),
  ]),
});
export const decisionRequest = z.union([
  z.strictObject({ type: z.literal('approve') }),
  z.strictObject({
    type: z.literal('reject'),
    message: z.string().optional(),
  }),
]);
export const resumeRequest = z.strictObject({
  sessionId: z.string(),
  messageId: z.string(),
  model,
  toolCallResults: z.array(z.never()).max(0),
});
const businessFailure = z.object({
  status: z.literal('error'),
  content: z.unknown().optional(),
});
const businessErrorCode = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/u),
});

/** Loaded by the authenticated conversation service, never deserialized from a request body. */
export interface AssistantChatSession {
  id: string;
  userId: string;
  employee: AIEmployeeOptions;
  model: z.infer<typeof model>;
  history: readonly BaseMessage[];
  pendingCallIds: readonly string[];
}

export interface AssistantChatEvent {
  type: 'new_message' | 'content' | 'tool_calls' | 'tool_call_status';
  body?: unknown;
}
type Emit = (event: AssistantChatEvent) => Promise<void>;

export interface AssistantChatAuthorization extends ToolAuthorization {
  authorizeConversation(
    actor: ToolActor,
    employee: string,
    sessionId: string,
  ): Promise<void>;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error('UNSUPPORTED_CHAT_REQUEST');
  return parsed.data;
}

/**
 * Adapts the existing page's text / backend confirmation protocol to the application runtime.
 * The host service owns authenticated session loading, turn serialization and transcript commits.
 * No routes or production writers are registered here. Unsupported capabilities fail closed.
 */
export class AssistantChatAdapter {
  public constructor(
    private readonly turn: AssistantTurn,
    private readonly executor: ToolExecutor,
    private readonly calls: ToolCallStore,
    private readonly authorization: AssistantChatAuthorization,
    private readonly tools: ReadonlyMap<string, RegisteredTool>,
  ) {}

  public async validateSend(
    actor: ToolActor,
    session: AssistantChatSession,
    body: unknown,
  ) {
    const request = parse(sendRequest, body);
    this.checkSession(actor, session, request);
    this.checkTools(session);
    await this.authorization.authorizeConversation(
      actor,
      session.employee.username,
      session.id,
    );
    if (request.aiEmployee !== session.employee.username)
      throw new Error('CHAT_EMPLOYEE_CHANGED');
    if (session.pendingCallIds.length)
      throw new Error('CHAT_CONFIRMATION_REQUIRED');
    return request;
  }

  public async validateResume(
    actor: ToolActor,
    session: AssistantChatSession,
    body: unknown,
  ) {
    const request = parse(resumeRequest, body);
    this.checkSession(actor, session, request);
    this.checkTools(session);
    await this.authorization.authorizeConversation(
      actor,
      session.employee.username,
      session.id,
    );
    const calls = await this.readCalls(actor, session, request.messageId);
    for (const call of calls) {
      await this.authorization.authorize(
        actor,
        call.employee,
        session.id,
        call.tool,
      );
      if (call.status !== 'completed' && call.status !== 'rejected')
        throw new Error('CHAT_CONFIRMATION_REQUIRED');
      if (call.status === 'completed' && !Object.hasOwn(call, 'result'))
        throw new Error('TOOL_RESULT_REQUIRED');
    }
    return request;
  }

  public async send(
    actor: ToolActor,
    session: AssistantChatSession,
    body: unknown,
    signal: AbortSignal,
    emit: Emit,
    onMessage?: (message: BaseMessage) => Promise<void>,
  ) {
    const request = parse(sendRequest, body);
    this.checkSession(actor, session, request);
    this.checkTools(session);
    await this.authorization.authorizeConversation(
      actor,
      session.employee.username,
      session.id,
    );
    if (request.aiEmployee !== session.employee.username)
      throw new Error('CHAT_EMPLOYEE_CHANGED');
    if (session.pendingCallIds.length)
      throw new Error('CHAT_CONFIRMATION_REQUIRED');
    signal.throwIfAborted();
    await emit({ type: 'new_message' });
    const result = await this.turn.run({
      actor,
      employee: session.employee,
      sessionId: session.id,
      history: session.history,
      text: request.messages[0].content.content,
      requestKey: request.messages[0].key,
      onMessage,
      signal,
      onText: async (body) => emit({ type: 'content', body }),
      onToolEvent: async (event) =>
        AssistantChatAdapter.emitToolEvent(event, emit),
    });
    return result;
  }

  public async decide(
    actor: ToolActor,
    session: AssistantChatSession,
    messageId: string,
    toolCallId: string,
    body: unknown,
  ) {
    const request = parse(decisionRequest, body);
    this.checkOwner(actor, session);
    this.checkTools(session);
    await this.authorization.authorizeConversation(
      actor,
      session.employee.username,
      session.id,
    );
    const calls = await this.readCalls(actor, session, messageId);
    const call = calls.find((call) => call.modelCallId === toolCallId);
    if (!call) throw new Error('TOOL_CALL_NOT_FOUND');
    // The browser chooses only approve/reject. Arguments and their digest come from server storage.
    await this.executor.decide(actor, {
      id: call.id,
      sessionId: session.id,
      digest: call.argumentDigest,
      decision: request.type,
    });
    const updated = await this.readCalls(actor, session, messageId);
    return {
      updated: 1,
      toolCalls: updated.map((call) => ({
        ...this.wireCall(call),
        // The page resumes only when every interrupting call is waiting; execution is already durable.
        invokeStatus:
          call.status === 'completed' || call.status === 'rejected'
            ? 'waiting'
            : 'interrupted',
        status: call.status === 'rejected' ? 'rejected' : undefined,
      })),
    };
  }

  public async resume(
    actor: ToolActor,
    session: AssistantChatSession,
    body: unknown,
    signal: AbortSignal,
    emit: Emit,
    onMessage?: (message: BaseMessage) => Promise<void>,
  ) {
    const request = parse(resumeRequest, body);
    this.checkSession(actor, session, request);
    this.checkTools(session);
    await this.authorization.authorizeConversation(
      actor,
      session.employee.username,
      session.id,
    );
    signal.throwIfAborted();
    const calls = await this.readCalls(actor, session, request.messageId);
    const results: ToolMessage[] = [];
    for (const call of calls) {
      await this.authorization.authorize(
        actor,
        call.employee,
        session.id,
        call.tool,
      );
      if (call.status !== 'completed' && call.status !== 'rejected')
        throw new Error('CHAT_CONFIRMATION_REQUIRED');
      if (call.status === 'completed' && !Object.hasOwn(call, 'result'))
        throw new Error('TOOL_RESULT_REQUIRED');
      results.push(
        new ToolMessage({
          tool_call_id: call.modelCallId!,
          content: JSON.stringify(
            call.status === 'rejected'
              ? { code: 'TOOL_REJECTED' }
              : capabilityJsonValue(call.result),
          ),
        }),
      );
    }
    // Backend results supplied by a browser are rejected by the schema, never passed to a model.
    await emit({ type: 'new_message' });
    for (const call of calls)
      await AssistantChatAdapter.emitToolEvent(
        {
          call,
          auto: false,
          status: call.status,
          result:
            call.status === 'rejected'
              ? { code: 'TOOL_REJECTED' }
              : call.result,
        },
        emit,
      );
    for (const message of results) {
      message.id = crypto.randomUUID();
      await onMessage?.(message);
    }
    const result = await this.turn.continue({
      onMessage,
      actor,
      employee: session.employee,
      sessionId: session.id,
      history: [...session.history, ...results],
      signal,
      onText: async (body) => emit({ type: 'content', body }),
      onToolEvent: async (event) =>
        AssistantChatAdapter.emitToolEvent(event, emit),
    });
    return result;
  }

  private checkOwner(actor: ToolActor, session: AssistantChatSession) {
    if (session.userId !== String(actor.id))
      throw new Error('CONVERSATION_NOT_FOUND');
  }

  private checkTools(session: AssistantChatSession) {
    for (const reference of session.employee.tools ?? []) {
      const tool = this.tools.get(reference.name);
      if (!tool || tool.execution === 'frontend')
        throw new Error('UNSUPPORTED_CHAT_REQUEST');
    }
  }

  private checkSession(
    actor: ToolActor,
    session: AssistantChatSession,
    request: { sessionId: string; model: z.infer<typeof model> },
  ) {
    this.checkOwner(actor, session);
    if (request.sessionId !== session.id)
      throw new Error('CONVERSATION_NOT_FOUND');
    if (
      request.model.model !== session.model.model ||
      request.model.llmService !== session.model.llmService
    )
      throw new Error('CHAT_MODEL_CHANGED');
  }

  private async readCalls(
    actor: ToolActor,
    session: AssistantChatSession,
    messageId: string,
  ): Promise<StoredToolCall[]> {
    const messageIndex = session.history.findIndex(
      (message) => message.id === messageId && AIMessage.isInstance(message),
    );
    const message = session.history[messageIndex];
    if (
      !AIMessage.isInstance(message) ||
      !session.pendingCallIds.length ||
      new Set(session.pendingCallIds).size !== session.pendingCallIds.length
    )
      throw new Error('TOOL_CALL_NOT_FOUND');
    const answered = new Set<string>();
    for (const item of session.history.slice(messageIndex + 1)) {
      if (!ToolMessage.isInstance(item)) throw new Error('TOOL_CALL_NOT_FOUND');
      answered.add(item.tool_call_id);
    }
    const calls: StoredToolCall[] = [];
    for (const id of session.pendingCallIds) {
      const call = await this.calls.find(id);
      const request = message.tool_calls?.find(
        (item) => item.id === call?.modelCallId,
      );
      if (
        !call ||
        call.userId !== String(actor.id) ||
        call.sessionId !== session.id ||
        call.employee !== session.employee.username ||
        call.messageId !== messageId ||
        !request ||
        request.name !== call.tool ||
        !session.employee.tools?.some((tool) => tool.name === call.tool) ||
        call.argumentDigest !== toolArgumentDigest(request.args) ||
        call.argumentDigest !== toolArgumentDigest(call.arguments) ||
        answered.has(request.id!)
      )
        throw new Error('TOOL_CALL_NOT_FOUND');
      answered.add(request.id!);
      calls.push(call);
    }
    if (message.tool_calls?.some((call) => !call.id || !answered.has(call.id)))
      throw new Error('TOOL_CALL_NOT_FOUND');
    return calls;
  }

  private wireCall(call: StoredToolCall) {
    return {
      id: call.modelCallId!,
      name: call.tool,
      args: call.arguments,
      auto: false,
      execution: 'backend',
      willInterrupt: true,
    };
  }

  public static async emitToolEvent(event: AssistantToolEvent, emit: Emit) {
    const { call, status } = event;
    const failure =
      status === 'completed'
        ? businessFailure.safeParse(event.result)
        : undefined;
    const failed = failure?.success === true;
    const success = status === 'completed' && !failed;
    const code = failure?.success
      ? businessErrorCode.safeParse(failure.data.content)
      : undefined;
    // A completed execution can have failed in the business domain. Never expose arbitrary details or change its durable state.
    const result = failed
      ? { code: code?.success ? code.data.code : 'TOOL_BUSINESS_ERROR' }
      : event.result;
    const toolCall = {
      id: call.modelCallId!,
      name: call.tool,
      args: call.arguments,
      auto: event.auto,
      execution: 'backend',
      willInterrupt: status === 'pending',
      invokeStatus:
        status === 'pending'
          ? 'interrupted'
          : status === 'executing'
            ? 'running'
            : success
              ? 'success'
              : 'error',
    };
    if (status === 'pending' || status === 'executing')
      await emit({
        type: 'tool_calls',
        body: [toolCall],
      });
    else
      await emit({
        type: 'tool_call_status',
        body: {
          toolCall,
          status: success
            ? 'confirmed'
            : status === 'rejected'
              ? 'rejected'
              : 'error',
          // The existing page decoder reads error content as text, successful output as JSON.
          content: success
            ? capabilityJsonValue(result)
            : JSON.stringify(capabilityJsonValue(result)),
        },
      });
  }
}

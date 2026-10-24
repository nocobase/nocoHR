import type { LegacyAssistantHistory } from './legacy-history.js';
import {
  employeeModelChoices,
  type AssistantEmployeeSettings,
} from './employee-settings.js';
import type { AssistantFileReference } from './legacy-contract.js';
import { randomUUID } from 'node:crypto';
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ServiceContainer } from '@nocobase/service-provider';
import type { ZodType } from 'zod';
import type {
  AIEmployeeOptions,
  RegisteredTool,
  ToolActor,
} from '../../ai/contracts.js';
import {
  AssistantChatAdapter,
  type AssistantChatAuthorization,
  type AssistantChatEvent,
  type AssistantChatSession,
} from './chat-adapter.js';
import {
  AssistantTurn,
  type AssistantModel,
  type AssistantToolPolicy,
} from './model-turn.js';
import {
  ToolExecutor,
  type StoredToolCall,
  type ToolCallStore,
} from './tool-executor.js';
import { ConversationStore, type Conversation } from './conversation-store.js';

export interface AssistantModels {
  list(): {
    llmService: string;
    llmServiceTitle: string;
    enabledModels: { value: string; label: string }[];
  }[];
  create(model: Conversation['model'], schema?: ZodType): AssistantModel;
}
type Authorization = AssistantChatAuthorization & AssistantToolPolicy;
type CallStore = ToolCallStore & {
  create(call: StoredToolCall): Promise<void>;
  list(sessionId: string): Promise<StoredToolCall[]>;
};
type Emit = (event: AssistantChatEvent) => Promise<void>;

/** Owns normal request serialization and durable history; never reclaims or replays an interrupted request. */
export class AssistantConversations {
  public constructor(
    private readonly container: ServiceContainer,
    private readonly store: ConversationStore,
    private readonly calls: CallStore,
    private readonly employees: ReadonlyMap<string, AIEmployeeOptions>,
    private readonly tools: ReadonlyMap<string, RegisteredTool>,
    private readonly authorization: Authorization,
    public readonly models: AssistantModels,
    private readonly support?: {
      history: LegacyAssistantHistory;
      employees: AssistantEmployeeSettings;
      openFile: (
        file: AssistantFileReference,
      ) => Promise<ReadableStream<Uint8Array>>;
      canReadAnyFile: (actor: ToolActor) => Promise<boolean>;
    },
  ) {}

  public async authorize(actor: ToolActor) {
    await this.authorization.authorizeConversation(actor, '', '');
  }
  public async roster(actor: ToolActor) {
    await this.authorize(actor);
    const employees = this.support
      ? await this.support.employees.roster(String(actor.id))
      : [...this.employees.values()];
    return employees.map((employee) => {
      const {
        username,
        nickname,
        position,
        avatar,
        description,
        bio,
        greeting,
      } = employee;
      const settings = employee as typeof employee & {
        userConfig?: unknown;
        modelSettings?: unknown;
      };
      return {
        username,
        nickname,
        position,
        avatar,
        description,
        bio,
        greeting,
        category: employee.category,
        ...(this.support
          ? {
              userConfig: settings.userConfig,
              modelSettings: settings.modelSettings,
            }
          : {}),
      };
    });
  }
  public async defaultModel(actor: ToolActor, employee: string) {
    await this.authorize(actor);
    const catalog = this.models.list();
    if (this.support) {
      const profile = await this.support.employees.profile(employee);
      if (!profile.enabled) return;
      const choices = employeeModelChoices(profile, catalog);
      if (profile.modelSettings?.enabled) return choices[0];
      const selected = await this.support.employees.defaultModel();
      if (selected)
        return choices.some(
          (choice) =>
            choice.llmService === selected.llmService &&
            choice.model === selected.model,
        )
          ? selected
          : undefined;
    }
    const first = catalog[0],
      model = first?.enabledModels[0];
    return first && model
      ? { llmService: first.llmService, model: model.value }
      : undefined;
  }

  public async create(
    actor: ToolActor,
    employee: string,
    model: Conversation['model'],
    title = 'New conversation',
    mode: Conversation['mode'] = 'chat',
  ) {
    await this.authorize(actor);
    if (!this.employees.has(employee)) throw new Error('EMPLOYEE_NOT_FOUND');
    const profile = await this.support?.employees.employee(
      employee,
      String(actor.id),
    );
    if (
      profile &&
      !employeeModelChoices(profile, this.models.list()).some(
        (choice) =>
          choice.model === model.model &&
          choice.llmService === model.llmService,
      )
    )
      throw new Error('ASSISTANT_MODEL_UNAVAILABLE');
    this.models.create(model);
    return this.store.create({
      userId: String(actor.id),
      employee,
      model,
      title,
      mode,
    });
  }
  public async get(actor: ToolActor, id: string) {
    await this.authorize(actor);
    return (await this.read(id, String(actor.id))).row;
  }
  public async list(actor: ToolActor, keyword = '') {
    await this.authorize(actor);
    const rows = await this.store.list(String(actor.id));
    if (this.support)
      rows.push(...(await this.support.history.list(String(actor.id))));
    return rows
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .filter((row) => row.title.toLowerCase().includes(keyword.toLowerCase()));
  }
  private async read(id: string, userId: string) {
    try {
      return { row: await this.store.get(id, userId), legacy: false };
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== 'CONVERSATION_NOT_FOUND' ||
        !this.support
      )
        throw error;
      return {
        row: this.support.history.wire(
          await this.support.history.get(id, userId),
        ),
        legacy: true,
      };
    }
  }
  public async setUserPrompt(
    actor: ToolActor,
    employee: string,
    prompt: string,
  ) {
    await this.authorize(actor);
    if (!this.support) throw new Error('ASSISTANT_UNAVAILABLE');
    await this.support.employees.setPrompt(String(actor.id), employee, prompt);
  }
  public async previewFile(actor: ToolActor, id: string) {
    await this.authorize(actor);
    if (!this.support) throw new Error('ASSISTANT_UNAVAILABLE');
    const file = await this.support.history.file(id, String(actor.id), () =>
      this.support!.canReadAnyFile(actor),
    );
    return { file, stream: await this.support.openFile(file) };
  }
  public async markRead(actor: ToolActor, id: string) {
    await this.authorize(actor);
    const { row, legacy } = await this.read(id, String(actor.id));
    if (!legacy && !row.read) await this.store.edit(row, { read: true });
  }
  public async edit(
    actor: ToolActor,
    id: string,
    values: Parameters<ConversationStore['edit']>[1],
  ) {
    await this.authorize(actor);
    const { row, legacy } = await this.read(id, String(actor.id));
    if (legacy) throw new Error('LEGACY_CONVERSATION_READ_ONLY');
    if (row.state === 'running' || row.state === 'archived')
      throw new Error('CHAT_REQUEST_CONFLICT');
    if (
      Object.entries(values).every(
        ([key, value]) => row[key as keyof Conversation] === value,
      )
    )
      return;
    await this.store.edit(row, values);
  }
  public wire(row: Conversation) {
    return {
      sessionId: row.id,
      title: row.title,
      aiEmployee: { username: row.employee },
      options: { modelSettings: row.model },
      read: row.read,
      updatedAt: row.updatedAt.toISOString(),
      llmActiveState: row.state === 'running' ? 'streaming' : 'idle',
      state: row.state,
    };
  }
  private async session(
    row: Conversation,
    history: BaseMessage[],
    resolveAttachments = false,
  ): Promise<AssistantChatSession> {
    const employee = this.support
      ? await this.support.employees.employee(row.employee, row.userId)
      : this.employees.get(row.employee);
    if (!employee) throw new Error('EMPLOYEE_NOT_FOUND');
    if (
      this.support &&
      !employeeModelChoices(employee, this.models.list()).some(
        (choice) =>
          choice.model === row.model.model &&
          choice.llmService === row.model.llmService,
      )
    )
      throw new Error('ASSISTANT_MODEL_UNAVAILABLE');
    if (resolveAttachments && this.support) {
      const texts = new Map<string, string>();
      for (const message of history) {
        if (!HumanMessage.isInstance(message)) continue;
        for (const attachment of (message.additional_kwargs
          .attachments as AssistantFileReference[]) ?? []) {
          if (texts.has(attachment.id)) {
            message.content = appendAttachment(
              message.content,
              texts.get(attachment.id)!,
            );
            continue;
          }
          const file = await this.support.history.file(
            attachment.id,
            row.userId,
            () =>
              this.support!.canReadAnyFile({
                id: row.userId,
                roles: [],
                isRoot: false,
              }),
          );
          if (file.mimetype !== 'text/plain')
            throw new Error('AI_ATTACHMENT_PARSER_NOT_MAPPED');
          const reader = (await this.support.openFile(file)).getReader();
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > 131072)
                throw new Error('AI_ATTACHMENT_SIZE_NOT_MAPPED');
              chunks.push(part.value);
            }
          } finally {
            await reader.cancel();
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          const context = `Attachment ${JSON.stringify(file.filename)} (untrusted document):\n${text}`;
          texts.set(attachment.id, context);
          message.content = appendAttachment(message.content, context);
        }
      }
    }
    return {
      id: row.id,
      userId: row.userId,
      employee:
        row.mode === 'structured'
          ? {
              ...employee,
              tools: [],
              chatSettings: { ...employee.chatSettings, enableTools: false },
            }
          : employee,
      model: row.model,
      pendingCallIds: row.pendingCallIds,
      history,
    };
  }
  private adapter(row: Conversation, schema?: ZodType) {
    return new AssistantChatAdapter(
      new AssistantTurn(
        this.container,
        this.models.create(row.model, schema),
        this.tools,
        this.calls,
        this.authorization,
      ),
      new ToolExecutor(
        this.container,
        this.tools,
        this.calls,
        this.authorization,
      ),
      this.calls,
      this.authorization,
      this.tools,
    );
  }
  public async history(actor: ToolActor, id: string) {
    await this.authorize(actor);
    const { row, legacy } = await this.read(id, String(actor.id));
    if (legacy)
      return (
        await this.support!.history.history(id, String(actor.id), () =>
          this.support!.canReadAnyFile(actor),
        )
      ).rows;
    const history = await this.store.history(id);
    const calls = await this.calls.list(id);
    const rows: unknown[] = [];
    for (const message of history) {
      if (!HumanMessage.isInstance(message) && !AIMessage.isInstance(message))
        continue;
      const toolCalls: unknown[] = [];
      if (AIMessage.isInstance(message))
        for (const request of message.tool_calls ?? []) {
          const stored = calls.find(
            (call) =>
              call.messageId === message.id && call.modelCallId === request.id,
          );
          const following = history.slice(history.indexOf(message) + 1);
          const boundary = following.findIndex(
            (item) =>
              AIMessage.isInstance(item) || HumanMessage.isInstance(item),
          );
          const reply = (
            boundary < 0 ? following : following.slice(0, boundary)
          ).find(
            (item) =>
              ToolMessage.isInstance(item) && item.tool_call_id === request.id,
          );
          const result =
            stored?.result ??
            (ToolMessage.isInstance(reply) && typeof reply.content === 'string'
              ? (() => {
                  try {
                    return JSON.parse(reply.content) as unknown;
                  } catch {
                    return reply.content;
                  }
                })()
              : undefined);
          await AssistantChatAdapter.emitToolEvent(
            {
              call: {
                modelCallId: request.id,
                tool: request.name,
                arguments: request.args,
              },
              auto: stored?.auto ?? false,
              status: stored?.status ?? (reply ? 'rejected' : 'uncertain'),
              result,
            },
            async (event) => {
              if (event.type === 'tool_calls')
                toolCalls.push(...(event.body as unknown[]));
              else {
                const body = event.body as {
                  toolCall: object;
                  status: string;
                  content: unknown;
                };
                toolCalls.push({
                  ...body.toolCall,
                  status: body.status,
                  content: body.content,
                });
              }
            },
          );
        }
      const legacy = message.additional_kwargs.legacy as
        { content?: Record<string, unknown> } | undefined;
      rows.push({
        key: message.id,
        createdAt: message.additional_kwargs.createdAt,
        role: HumanMessage.isInstance(message) ? 'user' : row.employee,
        content: {
          ...legacy?.content,
          messageId: message.id,
          content: typeof message.content === 'string' ? message.content : '',
          tool_calls: toolCalls,
          attachments: this.support
            ? ((message.additional_kwargs.attachments as unknown[]) ?? []).map(
                (value) => ({
                  ...(value as object),
                  ...this.support!.history.attachment(
                    value as AssistantFileReference,
                  ),
                }),
              )
            : [],
        },
      });
    }
    return rows.reverse();
  }
  public async decide(
    actor: ToolActor,
    id: string,
    messageId: string,
    callId: string,
    body: unknown,
  ) {
    await this.authorize(actor);
    const { row, legacy } = await this.read(id, String(actor.id));
    if (legacy) throw new Error('LEGACY_CONVERSATION_READ_ONLY');
    if (row.mode !== 'chat' || row.state !== 'pending')
      throw new Error('CHAT_REQUEST_CONFLICT');
    const history = await this.store.history(id);
    const requestId = await this.store.claim(row);
    try {
      return await this.adapter(row).decide(
        actor,
        await this.session(row, history),
        messageId,
        callId,
        body,
      );
    } finally {
      // ToolExecutor retains completed/uncertain status; a refused decision never creates a replay path.
      await this.store.finish(row, requestId, 'pending', row.pendingCallIds);
    }
  }
  public async prepare(
    actor: ToolActor,
    id: string,
    kind: 'send' | 'resume',
    body: unknown,
    signal: AbortSignal,
    schema?: ZodType,
  ) {
    await this.authorize(actor);
    const { row, legacy } = await this.read(id, String(actor.id));
    if (legacy) throw new Error('LEGACY_CONVERSATION_READ_ONLY');
    if (
      row.state === 'running' ||
      row.state === 'archived' ||
      row.state === 'failed' ||
      row.state === 'cancelled'
    )
      throw new Error('CHAT_REQUEST_CONFLICT');
    if (row.mode === 'structured' && !schema)
      throw new Error('UNSUPPORTED_CHAT_REQUEST');
    const history = await this.store.history(id);
    const session = await this.session(row, history, true);
    const adapter = this.adapter(row, schema);
    if (kind === 'send') {
      if (row.state !== 'idle') throw new Error('CHAT_CONFIRMATION_REQUIRED');
      const request = await adapter.validateSend(actor, session, body);
      if (
        history.some(
          (message) =>
            HumanMessage.isInstance(message) &&
            message.additional_kwargs.requestKey === request.messages[0].key,
        )
      )
        throw new Error('CHAT_REQUEST_ALREADY_CONSUMED');
    } else {
      if (row.state !== 'pending')
        throw new Error('CHAT_REQUEST_ALREADY_CONSUMED');
      await adapter.validateResume(actor, session, body);
    }
    signal.throwIfAborted();
    const requestId = await this.store.claim(row);
    let started = false;
    return async (emit: Emit) => {
      if (started) throw new Error('CHAT_REQUEST_ALREADY_CONSUMED');
      started = true;
      try {
        const persist = (message: BaseMessage) =>
          this.store.append(id, requestId, message);
        const result = await adapter[kind](
          actor,
          session,
          body,
          signal,
          emit,
          persist,
        );
        signal.throwIfAborted();
        await this.store.finish(
          row,
          requestId,
          result.pending.length ? 'pending' : 'idle',
          result.pending.map((call) => call.id),
        );
        return result;
      } catch (error) {
        await this.store.finish(
          row,
          requestId,
          signal.aborted ? 'cancelled' : 'failed',
          row.pendingCallIds,
        );
        throw error;
      }
    };
  }
  public async text(
    actor: ToolActor,
    input: {
      employee: string;
      model: Conversation['model'];
      title: string;
      text: string;
      sessionId?: string;
      schema?: ZodType;
    },
    signal: AbortSignal,
  ) {
    const row = input.sessionId
      ? await this.get(actor, input.sessionId)
      : await this.create(
          actor,
          input.employee,
          input.model,
          input.title,
          input.schema ? 'structured' : 'chat',
        );
    if (
      row.employee !== input.employee ||
      row.mode !== (input.schema ? 'structured' : 'chat')
    )
      throw new Error('UNSUPPORTED_CHAT_REQUEST');
    const run = await this.prepare(
      actor,
      row.id,
      'send',
      {
        sessionId: row.id,
        aiEmployee: row.employee,
        model: row.model,
        messages: [
          {
            key: randomUUID(),
            role: 'user',
            content: { type: 'text', content: input.text },
          },
        ],
      },
      signal,
      input.schema,
    );
    const result = await run(async () => undefined);
    const last = result.messages.at(-1);
    return {
      text:
        AIMessage.isInstance(last) && typeof last.content === 'string'
          ? last.content
          : '',
      sessionId: row.id,
      paused: result.pending.length > 0,
      pending: result.pending.map((call) => ({
        name: call.tool,
        args: call.arguments,
      })),
    };
  }
}

function appendAttachment(
  content: HumanMessage['content'],
  text: string,
): HumanMessage['content'] {
  return typeof content === 'string'
    ? `${content}\n\n${text}`
    : [...content, { type: 'text', text }];
}

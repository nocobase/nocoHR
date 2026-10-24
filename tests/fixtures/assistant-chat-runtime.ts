import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { ServiceContainer } from '@nocobase/service-provider';
import { z } from 'zod';

import { defineTools, type RegisteredTool } from '../../server/ai/contracts.js';
import {
  AssistantChatAdapter,
  type AssistantChatEvent,
  type AssistantChatSession,
} from '../../server/providers/assistant/chat-adapter.js';
import {
  AssistantTurn,
  type AssistantModel,
} from '../../server/providers/assistant/model-turn.js';
import {
  ToolExecutor,
  type StoredToolCall,
  type ToolCallStore,
} from '../../server/providers/assistant/tool-executor.js';
import { assistantChatProtocol as protocol } from './assistant-chat-protocol.js';

export function createAssistantChatFixture(
  options: {
    calls?: number;
    failTool?: boolean;
    autoCalls?: number;
    denyAuto?: boolean;
    toolResult?: unknown;
    plain?: boolean;
  } = {},
) {
  const actor = { id: 'synthetic-owner', roles: [], isRoot: false };
  const rows = new Map<string, StoredToolCall>();
  const counts = {
    creates: 0,
    reads: 0,
    claims: 0,
    completes: 0,
    invokes: 0,
    models: 0,
  };
  const store: ToolCallStore & {
    create(call: StoredToolCall): Promise<void>;
  } = {
    async create(call) {
      counts.creates++;
      rows.set(call.id, structuredClone(call));
    },
    async find(id) {
      counts.reads++;
      const row = rows.get(id);
      return row ? structuredClone(row) : undefined;
    },
    async claim(id, from, to) {
      counts.claims++;
      const row = rows.get(id);
      if (!row || row.status !== from) return false;
      row.status = to;
      return true;
    },
    async complete(id, result) {
      counts.completes++;
      const row = rows.get(id)!;
      row.status = 'completed';
      row.result = structuredClone(result);
    },
  };
  let permitted = true;
  const policy = {
    async authorizeConversation() {
      if (!permitted) throw new Error('ACCESS_REVOKED');
    },
    async authorize() {
      if (!permitted) throw new Error('ACCESS_REVOKED');
    },
    async decision(_actor: unknown, _employee: string, tool: string) {
      return tool === 'readValue'
        ? options.denyAuto
          ? ('deny' as const)
          : ('allow' as const)
        : ('ask' as const);
    },
  };
  const tool = defineTools({
    scope: 'SPECIFIED',
    defaultPermission: 'ASK',
    execution: 'backend',
    definition: {
      name: 'saveDraft',
      description: 'Save a draft',
      schema: z.strictObject({ text: z.string() }),
    },
    async invoke() {
      counts.invokes++;
      if (options.failTool) throw new Error('SYNTHETIC_WRITE_UNCERTAIN');
      if (Object.hasOwn(options, 'toolResult')) return options.toolResult;
      return { id: 'synthetic-draft' };
    },
  });
  const automatic = defineTools({
    scope: 'SPECIFIED',
    defaultPermission: 'ALLOW',
    execution: 'backend',
    definition: {
      name: 'readValue',
      description: 'Read a synthetic value',
      schema: z.strictObject({}),
    },
    async invoke() {
      counts.invokes++;
      if (options.failTool) throw new Error('SYNTHETIC_WRITE_UNCERTAIN');
      if (Object.hasOwn(options, 'toolResult')) return options.toolResult;
      return { value: 42 };
    },
  });
  const tools = new Map<string, RegisteredTool>([
    ['saveDraft', tool],
    ['readValue', automatic],
  ]);
  const container = new ServiceContainer();
  const modelInputs: (readonly BaseMessage[])[] = [];
  const model: AssistantModel = {
    async reply(input) {
      counts.models++;
      modelInputs.push(input.messages);
      if (counts.models === 1 && !options.plain)
        return new AIMessage({
          content: '',
          tool_calls: [
            ...Array.from({ length: options.autoCalls ?? 0 }, (_, index) => ({
              id: `synthetic-auto-call-${index + 1}`,
              name: 'readValue',
              args: {},
            })),
            ...Array.from({ length: options.calls ?? 1 }, (_, index) => ({
              id:
                index === 0
                  ? 'synthetic-model-call'
                  : `synthetic-model-call-${index + 1}`,
              name: 'saveDraft',
              args: { text: 'A synthetic draft' },
            })),
          ],
        });
      await input.onText('Your decision has been recorded.');
      return new AIMessage('Your decision has been recorded.');
    },
  };
  const turn = new AssistantTurn(container, model, tools, store, policy);
  const executor = new ToolExecutor(container, tools, store, policy);
  const adapter = () =>
    new AssistantChatAdapter(turn, executor, store, policy, tools);
  let session: AssistantChatSession = {
    id: protocol.sessionId,
    userId: actor.id,
    employee: {
      username: protocol.employee,
      systemPrompt: 'Synthetic assistant.',
      tools: [{ name: 'saveDraft' }, { name: 'readValue' }],
    },
    model: protocol.model,
    history: [],
    pendingCallIds: [],
  };
  const events: AssistantChatEvent[] = [];
  const emit = async (event: AssistantChatEvent) => {
    events.push(event);
  };
  const signal = new AbortController().signal;
  async function send() {
    const result = await adapter().send(
      actor,
      session,
      protocol.send,
      signal,
      emit,
    );
    // Stand in for the host's transcript commit. Persist exactly the engine's message/call identities.
    session = {
      ...session,
      history: result.messages,
      pendingCallIds: result.pending.map((call) => call.id),
    };
    return result;
  }
  const messageId = () => rows.values().next().value!.messageId!;
  const decide = (body: unknown = protocol.approve) =>
    adapter().decide(actor, session, messageId(), 'synthetic-model-call', body);
  const resume = (body: Record<string, unknown> = {}) =>
    adapter().resume(
      actor,
      session,
      { ...protocol.resume, messageId: messageId(), ...body },
      signal,
      emit,
    );
  return {
    actor,
    rows,
    counts,
    store,
    executor,
    tools,
    modelInputs,
    events,
    signal,
    emit,
    adapter,
    send,
    decide,
    resume,
    messageId,
    session: () => session,
    revoke: () => {
      permitted = false;
    },
  };
}

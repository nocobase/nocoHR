// @vitest-environment node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { authenticationToken } from '@nocobase/app-plugin-authentication/server';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { ApiError } from '@nocobase/app-server/router';
import { assistantRoutes } from '../../server/routes/assistant.js';
import type { ApiClient, ApiRequestOptions } from '@nocobase/app-client';
import { AIMessage, ToolMessage } from '@langchain/core/messages';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { ServiceContainer } from '@nocobase/service-provider';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import toolMigration from '../../database/main/migrations/202610270031_create_capability_migration_state.js';
import conversationMigration from '../../database/main/migrations/202610270033_create_assistant_conversations.js';
import { defineTools } from '../../server/ai/contracts.js';
import { ConversationStore } from '../../server/providers/assistant/conversation-store.js';
import { assistantModels } from '../../server/providers/assistant/configured-models.js';
import { AssistantConversations } from '../../server/providers/assistant/conversation-service.js';
import { DatabaseToolCallStore } from '../../server/providers/assistant/tool-call-store.js';
import { createAssistantRoutes } from '../../server/routes/assistant-http.js';
import type { AssistantModel } from '../../server/providers/assistant/model-turn.js';
import { RuntimeAIService } from '../../client/extensions/nocobase-ai/services/runtime-ai-service.js';
import { NocoBaseChatTransport } from '../../client/extensions/nocobase-ai/providers/chat-transport.js';
import { createAIRunner } from '../../server/providers/hr/ai-runner.js';
import { assistantConversationsToken } from '../../server/providers/assistant/tokens.js';
import { createNocoBaseUIMessageStream } from '../../client/extensions/nocobase-ai/providers/ui-message-stream.js';

const actor = { id: 'owner', roles: [], isRoot: false };
const modelSettings = { llmService: 'synthetic', model: 'synthetic' };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const run of cleanup.splice(0)) await run();
});

async function fixture(
  options: {
    manual?: boolean;
    businessError?: boolean;
    uncertain?: boolean;
    plain?: boolean;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-session-'));
  const config = {
    default: 'main',
    connections: {
      main: sqlite({
        filename: path.join(directory, 'test.sqlite'),
        schemaManagement: 'managed',
      }),
    },
    metadataStore: new InMemoryCollectionMetadataStore(),
  };
  let db = createDatabaseManager(config);
  await db.connect();
  // Execute the actual self-contained migration definitions against SQLite, without unrelated application seeds.
  for (const migration of [toolMigration, conversationMigration])
    await migration.up!({
      builder: db.builder(),
      query: db.query(),
      repository: (name: string) => db.repository(name),
    } as never);
  cleanup.push(async () => {
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  });
  const state: {
    invokes: number;
    models: number;
    allowed: boolean;
    afterInvocation: () => void;
  } = {
    invokes: 0,
    models: 0,
    allowed: true,
    afterInvocation: () => undefined,
  };
  let reply: AssistantModel['reply'] = async (input) => {
    state.models++;
    if (options.plain || ToolMessage.isInstance(input.messages.at(-1))) {
      await input.onText('Done');
      return new AIMessage('Done');
    }
    return new AIMessage({
      content: '',
      tool_calls: [{ id: `call-${state.models}`, name: 'action', args: {} }],
    });
  };
  const tool = defineTools({
    scope: 'test',
    execution: 'backend',
    defaultPermission: options.manual ? 'ASK' : 'ALLOW',
    definition: {
      name: 'action',
      description: 'Synthetic business action',
      schema: z.strictObject({}),
    },
    async invoke() {
      state.invokes++;
      state.afterInvocation();
      if (options.uncertain) throw new Error('sensitive implementation detail');
      return options.businessError
        ? {
            status: 'error',
            content: { code: 'BUSINESS_REFUSED', secret: 'never show this' },
          }
        : { value: 42 };
    },
  });
  const authorize = async () => {
    if (!state.allowed) throw new Error('ASSISTANT_FORBIDDEN');
  };
  const build = () =>
    new AssistantConversations(
      new ServiceContainer(),
      new ConversationStore(db.connection()),
      new DatabaseToolCallStore(db.connection()),
      new Map([
        ['employee', { username: 'employee', tools: [{ name: 'action' }] }],
      ]),
      new Map([['action', tool!]]),
      {
        authorizeConversation: authorize,
        authorize,
        decision: async () => (options.manual ? 'ask' : 'allow'),
      },
      {
        list: () => [
          {
            llmService: modelSettings.llmService,
            llmServiceTitle: 'Synthetic',
            enabledModels: [{ value: modelSettings.model, label: 'Synthetic' }],
          },
        ],
        create: () => ({ reply: (input) => reply(input) }),
      },
    );
  let service = build();
  const row = await service.create(actor, 'employee', modelSettings);
  const sendBody = (key = randomUUID()) => ({
    sessionId: row.id,
    aiEmployee: 'employee',
    model: modelSettings,
    messages: [
      {
        key,
        role: 'user',
        content: { type: 'text', content: 'Run the synthetic action' },
      },
    ],
  });
  const run = async (
    kind: 'send' | 'resume' = 'send',
    body: unknown = sendBody(),
    signal = new AbortController().signal,
  ) => {
    const events: unknown[] = [];
    const execute = await service.prepare(actor, row.id, kind, body, signal);
    await execute(async (event) => {
      events.push(event);
    });
    return events;
  };
  const calls = () => new DatabaseToolCallStore(db.connection()).list(row.id);
  const resumeBody = async () => ({
    sessionId: row.id,
    messageId: (await calls())[0]!.messageId,
    model: modelSettings,
    toolCallResults: [],
  });
  const decide = async (type: 'approve' | 'reject' = 'approve') => {
    const call = (await calls())[0]!;
    return service.decide(actor, row.id, call.messageId!, call.modelCallId!, {
      type,
    });
  };
  const router = () => {
    const r = createAssistantRoutes({
      enabled: () => true,
      service: () => service,
      actor: (c) => ({ ...actor, id: c.req.header('x-test-user') ?? actor.id }),
      guard: async (c, next) => {
        if (c.req.header('x-test-auth') === 'missing')
          return c.json({ error: 'unauthenticated' }, 401);
        await next();
      },
      document: () => [async (_c, next) => next()],
    });
    r.onError((error, c) =>
      c.json(
        { reason: error.message },
        error.message === 'CONVERSATION_NOT_FOUND'
          ? 404
          : error.message === 'ASSISTANT_FORBIDDEN'
            ? 403
            : 409,
      ),
    );
    return r;
  };
  return {
    get service() {
      return service;
    },
    db: () => db,
    row,
    state,
    run,
    calls,
    sendBody,
    resumeBody,
    decide,
    router,
    setReply: (value: AssistantModel['reply']) => {
      reply = value;
    },
    restart: async () => {
      await db.destroy();
      db = createDatabaseManager(config);
      await db.connect();
      service = build();
    },
    otherInstance: build,
  };
}

function request(body: object, headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  };
}

describe('application conversation persistence and request lifecycle', () => {
  it('persists actual message/call identities and reads them after restarting the database and service', async () => {
    const f = await fixture({ manual: true });
    await f.run();
    const before = await f.service.history(actor, f.row.id);
    const call = (await f.calls())[0]!;
    await f.restart();
    expect(await f.service.history(actor, f.row.id)).toEqual(before);
    expect(JSON.stringify(before)).toContain(call.messageId);
    await f.decide();
    await f.run('resume', await f.resumeBody());
    expect(f.state.invokes).toBe(1);
    expect((await f.service.get(actor, f.row.id)).state).toBe('idle');
  });
  it('rejects cross-user reads and writes, including tool confirmation', async () => {
    const f = await fixture({ manual: true });
    await f.run();
    const other = { ...actor, id: 'other' };
    const call = (await f.calls())[0]!;
    await expect(f.service.history(other, f.row.id)).rejects.toThrow(
      'CONVERSATION_NOT_FOUND',
    );
    await expect(
      f.service.prepare(
        other,
        f.row.id,
        'send',
        f.sendBody(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
    await expect(
      f.service.decide(other, f.row.id, call.messageId!, call.modelCallId!, {
        type: 'approve',
      }),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
    expect(f.state.invokes).toBe(0);
  });
  it('rejects a message from another conversation and permission withdrawn before confirmation', async () => {
    const f = await fixture({ manual: true });
    await f.run();
    const second = await f.service.create(actor, 'employee', modelSettings);
    const call = (await f.calls())[0]!;
    await expect(
      f.service.decide(actor, second.id, call.messageId!, call.modelCallId!, {
        type: 'approve',
      }),
    ).rejects.toThrow();
    f.state.allowed = false;
    await expect(f.decide()).rejects.toThrow('ASSISTANT_FORBIDDEN');
    expect(f.state.invokes).toBe(0);
  });
  it('serializes concurrent continuation across independent service instances and blocks a consumed resume', async () => {
    const f = await fixture({ manual: true });
    await f.run();
    await f.decide();
    const body = await f.resumeBody();
    const attempts = await Promise.allSettled(
      [f.service, f.otherInstance()].map((service) =>
        service.prepare(
          actor,
          f.row.id,
          'resume',
          body,
          new AbortController().signal,
        ),
      ),
    );
    const winners = attempts.filter((value) => value.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    await (
      winners[0] as PromiseFulfilledResult<
        Awaited<ReturnType<AssistantConversations['prepare']>>
      >
    ).value(async () => undefined);
    await expect(f.run('resume', body)).rejects.toThrow(
      'CHAT_REQUEST_ALREADY_CONSUMED',
    );
    expect(f.state.invokes).toBe(1);
  });
  it('rejects duplicate client message keys and permits the next distinct message', async () => {
    const f = await fixture({ plain: true });
    const body = f.sendBody('stable-key');
    await f.run('send', body);
    await expect(f.run('send', body)).rejects.toThrow(
      'CHAT_REQUEST_ALREADY_CONSUMED',
    );
    await f.run();
    expect(f.state.models).toBe(2);
  });
  it('retains a lost request claim after a restart without automatic model or tool replay', async () => {
    const f = await fixture();
    await f.service.prepare(
      actor,
      f.row.id,
      'send',
      f.sendBody(),
      new AbortController().signal,
    );
    await f.restart();
    await expect(f.run()).rejects.toThrow('CHAT_REQUEST_CONFLICT');
    expect(f.state.models).toBe(0);
    expect(f.state.invokes).toBe(0);
  });
  it('cancels model streaming, retains partial text, and closes the session against replay', async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.setReply(async (input) => {
      await input.onText('Partial reply');
      controller.abort();
      input.signal.throwIfAborted();
      return new AIMessage('unreachable');
    });
    await expect(
      f.run('send', f.sendBody(), controller.signal),
    ).rejects.toThrow();
    expect((await f.service.get(actor, f.row.id)).state).toBe('cancelled');
    expect(JSON.stringify(await f.service.history(actor, f.row.id))).toContain(
      'Partial reply',
    );
    await expect(f.run()).rejects.toThrow('CHAT_REQUEST_CONFLICT');
    expect(f.state.invokes).toBe(0);
  });
  it('retains failed business execution and refuses replay after restart', async () => {
    const f = await fixture({ uncertain: true });
    await expect(f.run()).rejects.toThrow();
    await f.restart();
    expect((await f.calls())[0]!.status).toBe('uncertain');
    await expect(f.run()).rejects.toThrow('CHAT_REQUEST_CONFLICT');
    expect(f.state.invokes).toBe(1);
  });
  for (const manual of [false, true])
    it(`decodes business failure from real HTTP SSE and persisted history; manual=${manual}`, async () => {
      const f = await fixture({ businessError: true, manual });
      const router = f.router();
      const { sessionId: _id, ...send } = f.sendBody();
      const initial = await router.request(
        `/assistantConversations/${f.row.id}/send`,
        request(send),
      );
      expect(initial.status).toBe(200);
      const chunks = await Array.fromAsync(
        createNocoBaseUIMessageStream(initial.body!),
      );
      if (manual) {
        expect(
          chunks.some((chunk) => chunk.type === 'tool-input-available'),
        ).toBe(true);
        await f.decide();
        const { sessionId: _session, ...body } = await f.resumeBody();
        const response = await router.request(
          `/assistantConversations/${f.row.id}/resumeToolCall`,
          request(body),
        );
        chunks.push(
          ...(await Array.fromAsync(
            createNocoBaseUIMessageStream(response.body!),
          )),
        );
      }
      expect(
        chunks.some(
          (chunk) =>
            chunk.type === 'tool-output-error' &&
            chunk.errorText.includes('BUSINESS_REFUSED'),
        ),
      ).toBe(true);
      expect(JSON.stringify(chunks)).not.toContain('never show this');
      expect(
        JSON.stringify(await f.service.history(actor, f.row.id)),
      ).not.toContain('never show this');
      expect((await f.calls())[0]!.status).toBe('completed');
      expect(f.state.invokes).toBe(1);
    });
  it('keeps rejected results through restart and resumes without executing the tool', async () => {
    const f = await fixture({ manual: true });
    await f.run();
    await f.decide('reject');
    await f.restart();
    await f.run('resume', await f.resumeBody());
    expect(f.state.invokes).toBe(0);
    expect(JSON.stringify(await f.service.history(actor, f.row.id))).toContain(
      'TOOL_REJECTED',
    );
  });
  it('answers bad input, ownership and permission errors before opening HTTP SSE', async () => {
    const f = await fixture();
    const router = f.router();
    const bad = await router.request(
      `/assistantConversations/${f.row.id}/send`,
      request({}),
    );
    expect(bad.headers.get('content-type')).toContain('application/json');
    const { sessionId: _id, ...send } = f.sendBody();
    expect(
      (
        await router.request(
          `/assistantConversations/${f.row.id}/send`,
          request(send, { 'x-test-user': 'other' }),
        )
      ).status,
    ).toBe(404);
    f.state.allowed = false;
    expect(
      (
        await router.request(
          `/assistantConversations/${f.row.id}/send`,
          request({}),
        )
      ).status,
    ).toBe(403);
    expect(f.state.invokes).toBe(0);
  });
  it('reports controlled HTTP stream errors and persists failure without exposing implementation details', async () => {
    const f = await fixture({ uncertain: true });
    const { sessionId: _id, ...send } = f.sendBody();
    const response = await f
      .router()
      .request(`/assistantConversations/${f.row.id}/send`, request(send));
    const text = await response.text();
    expect(text).toContain('CHAT_REQUEST_FAILED');
    expect(text).not.toContain('sensitive implementation detail');
    expect((await f.service.get(actor, f.row.id)).state).toBe('failed');
  });

  it('serializes concurrent approvals and persists exactly one business execution', async () => {
    const f = await fixture({ manual: true });
    await f.run();
    const call = (await f.calls())[0]!;
    const results = await Promise.allSettled(
      [f.service, f.otherInstance()].map((service) =>
        service.decide(actor, f.row.id, call.messageId!, call.modelCallId!, {
          type: 'approve',
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(f.state.invokes).toBe(1);
    await expect(f.decide()).rejects.toThrow('TOOL_CALL_ALREADY_DECIDED');
  });
  it('lists only owned chat conversations, archives without deleting history, and changes no rows on reads', async () => {
    const f = await fixture({ plain: true });
    await f.run();
    const before = await f.service.get(actor, f.row.id);
    expect(await f.service.list({ ...actor, id: 'other' })).toEqual([]);
    expect((await f.service.list(actor)).map((row) => row.id)).toEqual([
      f.row.id,
    ]);
    await f.service.history(actor, f.row.id);
    expect(await f.service.get(actor, f.row.id)).toEqual(before);
    await f.service.edit(actor, f.row.id, { state: 'archived' });
    expect(await f.service.list(actor)).toEqual([]);
    expect(JSON.stringify(await f.service.history(actor, f.row.id))).toContain(
      'Done',
    );
  });
  it('does not intercept routes outside the assistant when mounted alongside the old runtime', async () => {
    const f = await fixture();
    const r = f.router();
    f.state.allowed = false;
    r.get('/aiEmployee/conversations', (c) => c.json({ legacy: true }));
    const response = await r.request('/aiEmployee/conversations');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ legacy: true });
  });
  it('aborts the actual HTTP stream and waits for durable cancellation without replay', async () => {
    const f = await fixture();
    const finished = Promise.withResolvers<void>();
    const prepare = f.service.prepare.bind(f.service);
    vi.spyOn(f.service, 'prepare').mockImplementation(async (...args) => {
      const run = await prepare(...args);
      return async (emit) => {
        try {
          return await run(emit);
        } finally {
          finished.resolve();
        }
      };
    });
    f.setReply(async (input) => {
      await input.onText('Partial');
      await new Promise<void>((_resolve, reject) => {
        if (input.signal.aborted) reject(input.signal.reason);
        else
          input.signal.addEventListener(
            'abort',
            () => reject(input.signal.reason),
            { once: true },
          );
      });
      return new AIMessage('unreachable');
    });
    const { sessionId: _id, ...body } = f.sendBody();
    const response = await f
      .router()
      .request(`/assistantConversations/${f.row.id}/send`, request(body));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    await finished.promise;
    expect((await f.service.get(actor, f.row.id)).state).toBe('cancelled');
    expect(f.state.invokes).toBe(0);
  });
  it('keeps structured background sessions tool-free and rejects a page continuation into them', async () => {
    const f = await fixture();
    f.setReply(async (input) => {
      expect(input.tools).toEqual([]);
      return new AIMessage('{"ok":true}');
    });
    const result = await f.service.text(
      actor,
      {
        employee: 'employee',
        model: modelSettings,
        title: 'Background',
        text: 'JSON only',
        schema: z.strictObject({ ok: z.boolean() }),
      },
      new AbortController().signal,
    );
    expect(JSON.parse(result.text)).toEqual({ ok: true });
    expect(f.state.invokes).toBe(0);
    expect((await f.service.list(actor)).map((row) => row.id)).not.toContain(
      result.sessionId,
    );
    await expect(
      f.service.prepare(
        actor,
        result.sessionId,
        'send',
        { ...f.sendBody(), sessionId: result.sessionId },
        new AbortController().signal,
      ),
    ).rejects.toThrow('UNSUPPORTED_CHAT_REQUEST');
  });

  it('connects the actual page transport through runtime selection, HTTP and SQLite with stable string message IDs', async () => {
    const f = await fixture({ manual: true });
    const router = f.router();
    const operations: string[] = [];
    const client = {
      async request(options: ApiRequestOptions) {
        operations.push(`${options.method} ${options.path}`);
        if (options.path === 'aiEmployee/conversations')
          return {
            data: [
              {
                sessionId: 'legacy-1',
                title: 'Old history',
                aiEmployeeUsername: 'employee',
                updatedAt: '2026-01-01',
              },
            ],
          };
        if (options.path === 'aiEmployee/conversations/legacy-1/messages')
          return {
            data: [
              {
                key: 'old',
                role: 'employee',
                content: { messageId: '123', content: 'Historical reply' },
              },
            ],
          };
        const url = new URL('http://local/' + options.path);
        for (const [key, value] of Object.entries(options.query ?? {}))
          if (value !== undefined && value !== null)
            url.searchParams.set(key, String(value));
        const response = await router.request(url.pathname + url.search, {
          ...(options.json ? request(options.json as object) : {}),
          method: options.method,
        });
        if (!response.ok)
          throw new Error(JSON.stringify(await response.json()));
        return response.json();
      },
      async stream(options: ApiRequestOptions) {
        operations.push(`${options.method} ${options.path}`);
        const response = await router.request('/' + options.path, {
          ...request(options.json as object),
          signal: options.signal,
        });
        if (!response.ok) throw new Error(await response.text());
        return response.body;
      },
    } as unknown as ApiClient;
    const service = new RuntimeAIService(client);
    const selected = { ...(await service.listModels())[0]!, configured: true };
    const employee = (await service.listEmployees())[0]!;
    const id = await service.createConversation({ employee, model: selected });
    const transport = new NocoBaseChatTransport({
      service,
      getContext: () => ({ sessionId: id, employee, model: selected }),
    });
    const chunks = await Array.fromAsync(
      await transport.sendMessages({
        chatId: id,
        trigger: 'submit-message',
        messageId: undefined,
        messages: [
          {
            id: 'client-stable-id',
            role: 'user',
            parts: [{ type: 'text', text: 'Run' }],
          },
        ],
      }),
    );
    expect(chunks.some((chunk) => chunk.type === 'tool-input-available')).toBe(
      true,
    );
    const messages = await service.getConversationMessages(id, {
      updateRead: true,
    });
    const message = messages.find((item) =>
      item.parts.some((part) => part.type === 'dynamic-tool'),
    )!;
    expect(message.metadata?.serverMessageId).toBe(message.id);
    expect(message.id).toMatch(/-/u);
    const part = message.parts.find((item) => item.type === 'dynamic-tool')!;
    if (part.type !== 'dynamic-tool') throw new Error('missing tool part');
    await service.updateToolCallDecision({
      sessionId: id,
      messageId: message.id,
      toolCallId: part.toolCallId,
      userDecision: { type: 'approve' },
    });
    expect(
      operations.filter((operation) => operation === 'GET assistantRuntime'),
    ).toHaveLength(1);
    // The decision response was lost; a reopened page reads saved state and results.
    await f.restart();
    const reopened = new RuntimeAIService(client);
    expect(await reopened.getConversationActiveState(id)).toBe('pending');
    const { getDecidedToolMessage } =
      await import('../../client/extensions/nocobase-ai/providers/chat-message-utils.js');
    const saved = getDecidedToolMessage(
      await reopened.getConversationMessages(id),
    )!;
    expect(saved.metadata!.serverMessageId).toBe(message.id);
    const reopenedTransport = new NocoBaseChatTransport({
      service: reopened,
      getContext: () => ({ sessionId: id, employee, model: selected }),
    });
    reopenedTransport.prepareToolResume(
      saved.metadata!.serverMessageId!,
      'continued-message',
      [part.toolCallId],
      [],
    );
    const resumed = await reopenedTransport.reconnectToStream();
    expect(
      (await Array.fromAsync(resumed)).some(
        (chunk) => chunk.type === 'tool-output-available',
      ),
    ).toBe(true);
    expect(await reopened.getConversationActiveState(id)).toBe('idle');
    expect(f.state.invokes).toBe(1);
    expect(
      (await service.listConversations()).some((row) => row.id === id),
    ).toBe(true);
    await expect(
      service.sendMessagesStream({ ...f.sendBody(), sessionId: 'legacy-1' }),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
    await expect(
      service.updateConversationTitle('legacy-1', 'Changed'),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
    expect(
      operations.filter((operation) => operation.includes('legacy-1')),
    ).toEqual([
      'POST assistantConversations/legacy-1/send',
      'PATCH assistantConversations/legacy-1',
    ]);
    expect(
      operations.some((operation) => operation.includes('aiEmployee/')),
    ).toBe(false);
    expect(
      operations.filter((operation) => operation === 'GET assistantRuntime'),
    ).toHaveLength(2);
  });
  it('routes background reply and structured retry through persisted sessions without invoking the old runtime', async () => {
    const f = await fixture({ plain: true });
    const container = new ServiceContainer();
    container.singleton(assistantConversationsToken, () => f.service);
    const runner = createAIRunner(container);
    const reply = await runner.reply({
      employee: 'employee',
      userId: actor.id,
      title: 'Bot',
      text: 'Hello',
      timeZone: 'UTC',
    });
    expect(reply.sessionId.startsWith('assistant-')).toBe(true);
    expect(reply.text).toBe('Done');
    let attempts = 0;
    f.setReply(async (input) => {
      expect(input.tools).toEqual([]);
      attempts++;
      return new AIMessage(
        attempts === 1 ? 'outside the format' : '{"ok":true}',
      );
    });
    const result = await runner.structured({
      employee: 'employee',
      userId: actor.id,
      title: 'Task',
      prompt: 'Return JSON',
      timeZone: 'UTC',
      schema: z.strictObject({ ok: z.boolean() }),
    });
    expect(result.data).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(
      JSON.stringify(await f.service.history(actor, result.sessionId)),
    ).toContain('Return JSON');
    await expect(
      runner.reply({
        employee: 'employee',
        userId: actor.id,
        title: 'Old',
        text: 'Continue',
        timeZone: 'UTC',
        sessionId: 'legacy-1',
      }),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });

  it('uses the configured LangChain model for text streaming and tool-free structured output without exposing configuration secrets', async () => {
    const requests: Record<string, unknown>[] = [];
    const server = createServer(async (req, res) => {
      let raw = '';
      for await (const part of req) raw += part.toString();
      const body = JSON.parse(raw);
      requests.push(body);
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(
          `data: ${JSON.stringify({ id: 'completion', object: 'chat.completion.chunk', created: 1, model: 'synthetic', choices: [{ index: 0, delta: { role: 'assistant', content: 'Streamed reply' }, finish_reason: null }] })}\n\n`,
        );
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            id: 'completion',
            object: 'chat.completion',
            created: 1,
            model: 'synthetic',
            choices: [
              {
                index: 0,
                finish_reason: 'tool_calls',
                message: {
                  role: 'assistant',
                  content: '',
                  tool_calls: [
                    {
                      id: 'format-call',
                      type: 'function',
                      function: {
                        name: body.tools[0].function.name,
                        arguments: '{"ok":true}',
                      },
                    },
                  ],
                },
              },
            ],
          }),
        );
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    cleanup.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('server address unavailable');
    const configured = assistantModels({
      enabled: true,
      llmService: 'synthetic',
      model: 'synthetic',
      apiKey: 'synthetic-key',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
    });
    expect(JSON.stringify(configured.list())).not.toContain('synthetic-key');
    expect(JSON.stringify(configured.list())).not.toContain('/v1');
    let text = '';
    const context = {
      messages: [],
      tools: [],
      signal: new AbortController().signal,
      onText: async (part: string) => {
        text += part;
      },
    };
    const reply = await configured.create(modelSettings).reply(context);
    expect(reply.content).toBe('Streamed reply');
    expect(text).toBe('Streamed reply');
    const structured = await configured
      .create(modelSettings, z.strictObject({ ok: z.boolean() }))
      .reply(context);
    expect(JSON.parse(structured.content as string)).toEqual({ ok: true });
    expect(requests).toHaveLength(2);
    expect(requests[0]!.tools).toBeUndefined();
  });

  it('records warm SQLite statement costs for a pending tool, decision and continuation', async () => {
    const f = await fixture({ manual: true });
    await f.service.get(actor, f.row.id);
    await f.service.history(actor, f.row.id);
    await f.calls();
    const queries: string[] = [];
    const client = await f.db().connection().client<{
      on(event: string, listener: (query: { sql: string }) => void): void;
      removeListener(
        event: string,
        listener: (query: { sql: string }) => void,
      ): void;
    }>();
    const listener = (query: { sql: string }) => queries.push(query.sql);
    client.on('query', listener);
    const measure = async (name: string, action: () => Promise<unknown>) => {
      queries.length = 0;
      await action();
      console.log(
        'SQL_COST ' +
          JSON.stringify({
            operation: name,
            selects: queries.filter((sql) => /^select\b/iu.test(sql)).length,
            inserts: queries.filter((sql) => /^insert\b/iu.test(sql)).length,
            updates: queries.filter((sql) => /^update\b/iu.test(sql)).length,
            begins: queries.filter((sql) => /^begin\b/iu.test(sql)).length,
            commits: queries.filter((sql) => /^commit\b/iu.test(sql)).length,
          }),
      );
    };
    try {
      await measure('send-pending', () => f.run());
      const call = (await f.calls())[0]!;
      await measure('approve', () =>
        f.service.decide(actor, f.row.id, call.messageId!, call.modelCallId!, {
          type: 'approve',
        }),
      );
      const body = await f.resumeBody();
      await measure('resume', () => f.run('resume', body));
      await measure('history', () => f.service.history(actor, f.row.id));
      await measure('state-read', () => f.service.get(actor, f.row.id));
      expect(f.state.invokes).toBe(1);
    } finally {
      client.removeListener('query', listener);
    }
  });

  for (const scenario of [
    'approve',
    'reject',
    'mixed',
    'business-error',
  ] as const) {
    it(`continues a persisted ${scenario} group after reopen or a lost decision response without replay`, async () => {
      const { toAIChatHistoryMessages } =
        await import('../../client/extensions/nocobase-ai/services/nocobase-ai-service.js');
      const { getDecidedToolMessage } =
        await import('../../client/extensions/nocobase-ai/providers/chat-message-utils.js');
      const f = await fixture({
        manual: true,
        businessError: scenario === 'business-error',
      });
      if (scenario === 'mixed')
        f.setReply(async (input) => {
          if (ToolMessage.isInstance(input.messages.at(-1)))
            return new AIMessage('Done');
          return new AIMessage({
            content: '',
            tool_calls: [
              { id: 'approve-call', name: 'action', args: {} },
              { id: 'reject-call', name: 'action', args: {} },
            ],
          });
        });
      await f.run();
      expect(
        getDecidedToolMessage(
          toAIChatHistoryMessages(await f.service.history(actor, f.row.id)),
        ),
      ).toBeUndefined();
      const calls = await f.calls();
      for (const [index, call] of calls.entries()) {
        await f.service.decide(
          actor,
          f.row.id,
          call.messageId!,
          call.modelCallId!,
          {
            type:
              scenario === 'reject' || (scenario === 'mixed' && index === 1)
                ? 'reject'
                : 'approve',
          },
        ); // Deliberately discard the response: the browser closed before resume.
        if (index < calls.length - 1)
          expect(
            getDecidedToolMessage(
              toAIChatHistoryMessages(await f.service.history(actor, f.row.id)),
            ),
          ).toBeUndefined();
      }
      await f.restart();
      const history = toAIChatHistoryMessages(
        await f.service.history(actor, f.row.id),
      );
      const message = getDecidedToolMessage(history)!;
      expect(message.metadata!.serverMessageId).toBe(calls[0]!.messageId);
      const parts = message.parts.filter((p) => p.type === 'dynamic-tool');
      expect(parts).toHaveLength(calls.length);
      expect(
        parts.every(
          (p) => p.callProviderMetadata?.nocobase?.requiresApproval === false,
        ),
      ).toBe(true);
      if (scenario === 'business-error') {
        expect(parts[0]!.state).toBe('output-error');
        expect(JSON.stringify(parts)).toContain('BUSINESS_REFUSED');
        expect(JSON.stringify(parts)).not.toContain('never show this');
      }
      expect((await f.service.get(actor, f.row.id)).state).toBe('pending');
      await expect(f.run()).rejects.toThrow('CHAT_CONFIRMATION_REQUIRED');
      const body = {
        ...(await f.resumeBody()),
        messageId: message.metadata!.serverMessageId,
      };
      const results = await Promise.allSettled([
        f.run('resume', body),
        f.run('resume', body),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(f.state.invokes).toBe(scenario === 'reject' ? 0 : 1);
      await f.restart();
      expect((await f.service.get(actor, f.row.id)).state).toBe('idle');
      expect(
        getDecidedToolMessage(
          toAIChatHistoryMessages(await f.service.history(actor, f.row.id)),
        ),
      ).toBeUndefined();
      await expect(f.run('resume', body)).rejects.toThrow();
      expect(f.state.invokes).toBe(scenario === 'reject' ? 0 : 1);
    });
  }

  it('keeps a completed business result if cancellation arrives while the business action runs', async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.state.afterInvocation = () => controller.abort();
    await expect(
      f.run('send', f.sendBody(), controller.signal),
    ).rejects.toThrow();
    expect((await f.calls())[0]!.status).toBe('completed');
    expect((await f.calls())[0]!.result).toEqual({ value: 42 });
    expect((await f.service.get(actor, f.row.id)).state).toBe('cancelled');
    await expect(f.run()).rejects.toThrow('CHAT_REQUEST_CONFLICT');
    expect(f.state.invokes).toBe(1);
  });
  it('reverses the new schema when the application state is empty', async () => {
    const f = await fixture();
    await f
      .db()
      .repository('assistantConversations')
      .deleteMany({ filter: { id: f.row.id } });
    await conversationMigration.down!({
      builder: f.db().builder(),
      query: f.db().query(),
    } as never);
    await expect(
      f.db().query().selectFrom('assistantMessages').selectAll().execute(),
    ).rejects.toThrow();
  });

  it('validates the production route contribution with standard errors, authentication and body limits', async () => {
    const f = await fixture({ plain: true });
    const container = new ServiceContainer();
    container.singleton(assistantConversationsToken, () => f.service);
    container.singleton(
      authenticationToken,
      () =>
        ({
          required:
            () =>
            async (
              c: Parameters<import('hono').MiddlewareHandler>[0],
              next: () => Promise<void>,
            ) => {
              if (c.req.header('x-test-auth') === 'missing')
                throw new ApiError({
                  status: 'UNAUTHENTICATED',
                  reason: 'AUTHENTICATION_REQUIRED',
                  domain: 'app',
                  message: 'Authentication is required.',
                });
              await next();
            },
        }) as never,
    );
    container.singleton(
      authorizationToken,
      () =>
        ({
          middleware:
            () =>
            async (
              c: Parameters<import('hono').MiddlewareHandler>[0],
              next: () => Promise<void>,
            ) => {
              c.set('authz', {
                identity: {
                  principal: {
                    type: 'user',
                    id: c.req.header('x-test-user') ?? actor.id,
                  },
                },
              });
              await next();
            },
        }) as never,
    );
    const router = await assistantRoutes.createRouter({
      container,
      config: { get: () => ({ enabled: true }) },
    } as never);
    const noAuth = await router.request('/assistantRuntime', {
      headers: { 'x-test-auth': 'missing' },
    });
    expect(noAuth.status).toBe(401);
    expect((await noAuth.json()).error.reason).toBe('AUTHENTICATION_REQUIRED');
    const invalid = await router.request(
      '/assistantConversations',
      request({ nonsense: true }),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.fieldViolations.length).toBeGreaterThan(
      0,
    );
    const denied = await router.request(`/assistantConversations/${f.row.id}`, {
      headers: { 'x-test-user': 'other' },
    });
    expect(denied.status).toBe(404);
    expect((await denied.json()).error.reason).toBe('CONVERSATION_NOT_FOUND');
    const tooLarge = await router.request(
      '/assistantConversations',
      request({ text: 'x'.repeat(262145) }),
    );
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).error.reason).toBe('BODY_TOO_LARGE');
    f.state.allowed = false;
    const forbiddenLarge = await router.request(
      '/assistantConversations',
      request({ text: 'x'.repeat(262145) }),
    );
    expect(forbiddenLarge.status).toBe(403);
    expect((await forbiddenLarge.json()).error.reason).toBe(
      'ASSISTANT_FORBIDDEN',
    );
    f.state.allowed = true;
    const { sessionId: _id, ...send } = f.sendBody();
    const response = await router.request(
      `/assistantConversations/${f.row.id}/send`,
      request(send),
    );
    expect(response.status).toBe(200);
    expect(
      (
        await Array.fromAsync(createNocoBaseUIMessageStream(response.body!))
      ).some((chunk) => chunk.type === 'text-delta'),
    ).toBe(true);
  });

  it('refuses rollback of populated history and never drops it', async () => {
    const f = await fixture({ plain: true });
    await f.run();
    await expect(
      conversationMigration.down!({
        builder: f.db().builder(),
        query: f.db().query(),
      } as never),
    ).rejects.toThrow('ASSISTANT_HISTORY_NOT_EMPTY');
    expect(JSON.stringify(await f.service.history(actor, f.row.id))).toContain(
      'Done',
    );
  });
});

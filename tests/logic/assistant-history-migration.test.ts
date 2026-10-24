// @vitest-environment node
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { AIMessage, HumanMessage } from '@langchain/core/messages';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { ServiceContainer } from '@nocobase/service-provider';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import migration31 from '../../database/main/migrations/202610270031_create_capability_migration_state.js';
import migration33 from '../../database/main/migrations/202610270033_create_assistant_conversations.js';
import migration34 from '../../database/main/migrations/202610270034_create_assistant_history_configuration.js';
import { legacyCollections } from '../fixtures/legacy-assistant.js';
import { defineTools, type RegisteredTool } from '../../server/ai/contracts.js';
import { ConversationStore } from '../../server/providers/assistant/conversation-store.js';
import { DatabaseToolCallStore } from '../../server/providers/assistant/tool-call-store.js';
import {
  AssistantConversations,
  type AssistantModels,
} from '../../server/providers/assistant/conversation-service.js';
import { AssistantEmployeeSettings } from '../../server/providers/assistant/employee-settings.js';
import { LegacyAssistantMigration } from '../../server/providers/assistant/legacy-migration.js';
import { LegacyAssistantHistory } from '../../server/providers/assistant/legacy-history.js';
import { legacyId } from '../../server/providers/assistant/legacy-contract.js';
import { capabilityRecordDigest } from '../../server/providers/upgrade/digest.js';
import {
  legacyModelSettings,
  mappedModels,
} from '../../server/providers/assistant/model-configuration.js';
import { toAIChatHistoryMessages } from '../../client/extensions/nocobase-ai/services/nocobase-ai-service.js';
import { RuntimeAIService } from '../../client/extensions/nocobase-ai/services/runtime-ai-service.js';
import { createAssistantRoutes } from '../../server/routes/assistant-http.js';
import type { ApiClient, ApiRequestOptions } from '@nocobase/app-client';
import { createAIRunner } from '../../server/providers/hr/ai-runner.js';
import { assistantConversationsToken } from '../../server/providers/assistant/tokens.js';

const owner = { id: '9007199254740999', roles: [], isRoot: false };
const model = { llmService: 'legacy', model: 'synthetic' };
const session = 'legacy-session';
const first = '9223372036854775700',
  second = '9223372036854775701',
  callId = '9223372036854775702';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const action of cleanup.splice(0)) await action();
});
async function fixture(
  options: {
    pending?: boolean;
    businessError?: boolean;
    attachments?: boolean;
  } = {},
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'assistant-history-'));
  const filename = path.join(directory, 'test.sqlite'),
    file = path.join(directory, 'original.txt');
  await writeFile(file, '保留的附件内容');
  const config = {
    default: 'main',
    connections: { main: sqlite({ filename, schemaManagement: 'managed' }) },
    metadataStore: new InMemoryCollectionMetadataStore(),
  };
  let db = createDatabaseManager(config);
  await db.connect();
  for (const migration of [migration31, migration33, migration34])
    await migration.up!({
      builder: db.builder(),
      query: db.query(),
      repository: (name: string) => db.repository(name),
    } as never);
  await legacyCollections(db.connection());
  const timestamp = new Date('2026-10-01T00:00:00Z');
  await db.repository('llmServices').createOne({
    values: {
      name: 'legacy',
      title: 'Legacy service',
      provider: 'openai-completions',
      options: {
        apiKey: 'OLD_FAKE_SECRET',
        baseURL: 'http://127.0.0.1:1/v1',
      },
      enabledModels: {
        mode: 'custom',
        models: [{ label: 'Saved model title', value: 'synthetic' }],
      },
      enabled: true,
      modelOptions: {
        temperature: 0.4,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
      },
      sort: 4,
    },
  });
  await db.repository('aiSettings').createOne({
    values: {
      id: 'main',
      options: { storage: 'local' },
      defaultLlmService: 'legacy',
      defaultModel: 'synthetic',
    },
  });
  await db.repository('aiEmployees').createOne({
    values: {
      username: 'employee',
      nickname: '保留的员工',
      about: 'Application instructions',
      greeting: '你好',
      modelSettings: { enabled: true, models: [model] },
      skillSettings: {
        tools: [{ name: 'action', autoCall: false }],
        skills: [],
      },
      chatSettings: { systemPromptMode: 'default', enableTools: true },
      enabled: true,
      builtIn: false,
      deprecated: false,
      enableKnowledgeBase: false,
      sort: 5,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
  await db.repository('usersAiEmployees').createOne({
    values: {
      userId: owner.id,
      aiEmployee: 'employee',
      sort: 1,
      prompt: '保留个人提示词',
    },
  });
  await db.repository('aiConversations').createOne({
    values: {
      sessionId: session,
      userId: owner.id,
      aiEmployeeUsername: 'employee',
      title: '旧会话',
      llmActiveState: 'idle',
      category: 'chat',
      from: 'main-agent',
      scope: null,
      topicId: null,
      thread: 0,
      options: { modelSettings: model },
      read: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
  await db.repository('aiFiles').createOne({
    values: {
      id: 'file-1',
      filename: '原文.txt',
      disk: 'local',
      path: 'legacy/original.txt',
      mimetype: 'text/plain',
      size: Buffer.byteLength('保留的附件内容'),
      meta: { retained: true },
      createdById: owner.id,
      url: 'old-plugin-url',
      preview: 'old-plugin-url',
    },
  });
  await db.repository('aiMessages').createOne({
    values: {
      messageId: first,
      sessionId: session,
      role: 'user',
      content: { type: 'text', content: '旧问题' },
      toolCalls: [],
      attachments:
        options.attachments === false
          ? []
          : [
              {
                id: 'file-1',
                filename: '原文.txt',
                preview: 'old-plugin-url',
              },
            ],
      metadata: { id: 'old-model-message' },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
  await db.repository('aiMessages').createOne({
    values: {
      messageId: second,
      sessionId: session,
      role: 'employee',
      content: { type: 'text', content: options.pending ? '' : '旧回复' },
      toolCalls: options.pending
        ? [
            {
              id: 'model-call',
              name: 'action',
              args: { value: 1 },
              type: 'tool_call',
            },
          ]
        : [],
      metadata: { model: 'synthetic', provider: 'openai-completions' },
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  });
  if (options.pending)
    await db.repository('aiToolMessages').createOne({
      values: {
        id: callId,
        messageId: second,
        sessionId: session,
        toolCallId: 'model-call',
        toolName: 'action',
        invokeStatus: 'waiting',
        execution: 'backend',
        auto: false,
        userDecision: { type: 'approve' },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
  const state = {
    invokes: 0,
    models: 0,
    allowed: true,
    canReadAny: false,
    contexts: [] as unknown[],
  };
  const tool = defineTools({
    scope: 'SPECIFIED',
    execution: 'backend',
    defaultPermission: 'ASK',
    definition: {
      name: 'action',
      description: 'Synthetic action',
      schema: z.strictObject({ value: z.number() }),
    },
    async invoke() {
      state.invokes++;
      return options.businessError
        ? {
            status: 'error',
            content: { code: 'BUSINESS_REFUSED', secret: 'sensitive detail' },
          }
        : { value: 42 };
    },
  });
  const employees = new Map([
    [
      'employee',
      {
        username: 'employee',
        systemPrompt: 'Source instructions',
        tools: [{ name: 'action', autoCall: false }],
      },
    ],
  ]);
  const tools = new Map<string, RegisteredTool>([['action', tool]]);
  const models: AssistantModels = {
    list: () => [
      {
        llmService: 'legacy',
        llmServiceTitle: 'Legacy',
        enabledModels: [{ value: 'synthetic', label: 'Synthetic' }],
      },
    ],
    create(selected) {
      if (selected.model !== 'synthetic' || selected.llmService !== 'legacy')
        throw new Error('ASSISTANT_MODEL_UNAVAILABLE');
      return {
        async reply(input) {
          state.models++;
          state.contexts.push(input.messages);
          await input.onText('Continued');
          return new AIMessage('Continued');
        },
      };
    },
  };
  const ai = {
    llmServices: {
      legacy: {
        provider: 'openai-completions',
        options: { apiKey: 'SERVER_FAKE_SECRET' },
        enabledModels: [{ label: 'Source model', value: 'synthetic' }],
      },
    },
  };
  const authorize = async () => {
    if (!state.allowed) throw new Error('ASSISTANT_FORBIDDEN');
  };
  const openFile = async () =>
    new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(await readFile(file));
        controller.close();
      },
    });
  const build = () =>
    new AssistantConversations(
      new ServiceContainer(),
      new ConversationStore(db.connection()),
      new DatabaseToolCallStore(db.connection()),
      employees,
      tools,
      {
        authorize,
        authorizeConversation: authorize,
        decision: async () => 'ask',
      },
      models,
      {
        history: new LegacyAssistantHistory(db.connection()),
        employees: new AssistantEmployeeSettings(db.connection(), employees),
        openFile,
        canReadAnyFile: async () => state.canReadAny,
      },
    );
  let service = build();
  const migration = () =>
    new LegacyAssistantMigration(
      db.connection(),
      employees,
      tools,
      models,
      ai,
      async () => {
        try {
          await stat(file);
          return true;
        } catch {
          return false;
        }
      },
      async () => state.canReadAny,
    );
  const sourceTables = [
    'aiEmployees',
    'usersAiEmployees',
    'llmServices',
    'aiSettings',
    'aiConversations',
    'aiMessages',
    'aiToolMessages',
    'aiFiles',
    'legacyMigrationHistory',
  ];
  const snapshot = async () =>
    capabilityRecordDigest(
      await Promise.all(
        sourceTables.map((name) => db.repository(name).findMany()),
      ),
    );
  const run = async (kind: 'send' | 'resume' = 'send') => {
    const execute = await service.prepare(
      owner,
      session,
      kind,
      kind === 'send'
        ? {
            sessionId: session,
            aiEmployee: 'employee',
            model,
            messages: [
              {
                key: 'new-message',
                role: 'user',
                content: { type: 'text', content: '继续' },
              },
            ],
          }
        : { sessionId: session, messageId: second, model, toolCallResults: [] },
      new AbortController().signal,
    );
    const events: unknown[] = [];
    await execute(async (event) => {
      events.push(event);
    });
    return events;
  };
  const router = () => {
    const r = createAssistantRoutes({
      enabled: () => true,
      service: () => service,
      actor: (c) => ({ ...owner, id: c.req.header('x-user') ?? owner.id }),
      guard: async (_c, next) => next(),
      document: () => [],
    });
    r.onError((error, c) =>
      c.json(
        { reason: error.message },
        error.message === 'FILE_ACCESS_DENIED' ? 403 : 409,
      ),
    );
    return r;
  };
  cleanup.push(async () => {
    await db.destroy();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get db() {
      return db;
    },
    get service() {
      return service;
    },
    state,
    models,
    ai,
    employees,
    tools,
    file,
    migration,
    snapshot,
    run,
    router,
    restartWithoutLegacyMetadata: async () => {
      await db.destroy();
      for (const name of sourceTables) {
        const stored = await config.metadataStore.get(name);
        if (stored)
          await config.metadataStore.delete(name, {
            expectedRevision: stored.revision,
          });
      }
      db = createDatabaseManager(config);
      await db.connect();
      service = build();
    },
    restart: async () => {
      await db.destroy();
      db = createDatabaseManager(config);
      await db.connect();
      service = build();
    },
  };
}

describe('retained AI history and configuration mapping', () => {
  it.each<{
    label: string;
    settings: unknown;
    general?: boolean;
    expected: string[];
  }>([
    {
      label: 'explicit empty selection',
      settings: { tools: [], skills: [] },
      expected: [],
    },
    {
      label: 'explicit empty enabledTools overrides a selection',
      settings: { tools: [{ name: 'action' }], enabledTools: [] },
      expected: [],
    },
    {
      label: 'nonempty selection',
      settings: { tools: [{ name: 'action' }] },
      expected: ['action'],
    },
    { label: 'missing configuration', settings: null, expected: [] },
    { label: 'missing fields', settings: {}, expected: [] },
    { label: 'missing tools field', settings: { skills: [] }, expected: [] },
    { label: 'null tools field', settings: { tools: null }, expected: [] },
    {
      label: 'enabledTools alone discovers a specified tool',
      settings: { enabledTools: ['action'] },
      expected: ['action'],
    },
    {
      label: 'selected registered tool outside code defaults',
      settings: { tools: [{ name: 'unopened' }] },
      expected: ['unopened'],
    },
    {
      label: 'GENERAL with empty selection',
      settings: { tools: [] },
      general: true,
      expected: ['general'],
    },
    {
      label: 'GENERAL with missing configuration',
      settings: null,
      general: true,
      expected: ['general'],
    },
    {
      label: 'GENERAL with empty enabledTools',
      settings: { enabledTools: [] },
      general: true,
      expected: [],
    },
    {
      label: 'GENERAL and SPECIFIED selected together',
      settings: { tools: [{ name: 'action' }] },
      general: true,
      expected: ['general', 'action'],
    },
    {
      label: 'enabledTools excludes GENERAL',
      settings: { tools: [{ name: 'action' }], enabledTools: ['action'] },
      general: true,
      expected: ['action'],
    },
    {
      label: 'enabledTools excludes configured SPECIFIED',
      settings: { tools: [{ name: 'action' }], enabledTools: ['general'] },
      general: true,
      expected: ['general'],
    },
    {
      label: 'deduplicated GENERAL and enabledTools',
      settings: {
        tools: [{ name: 'general' }],
        enabledTools: ['general', 'action', 'general'],
      },
      general: true,
      expected: ['general', 'action'],
    },
  ])(
    'preserves old effective tools: $label',
    async ({ settings: sourceSettings, general, expected }) => {
      const f = await fixture({ attachments: false });
      for (const name of ['unopened', ...(general ? ['general'] : [])])
        f.tools.set(
          name,
          defineTools({
            scope: name === 'general' ? 'GENERAL' : 'SPECIFIED',
            execution: 'backend',
            defaultPermission: 'ASK',
            definition: {
              name,
              description: 'Synthetic selection boundary',
              schema: z.strictObject({ value: z.number() }),
            },
            async invoke() {
              f.state.invokes++;
              return { value: 42 };
            },
          }),
        );
      await f.db.repository('aiEmployees').updateOne({
        filter: { username: 'employee' },
        values: { skillSettings: sourceSettings },
      });
      const before = await f.snapshot();
      const settings = new AssistantEmployeeSettings(
        f.db.connection(),
        f.employees,
      );
      // Defaults apply to an unmigrated/new declaration, not an old row with absent selections.
      expect(
        (await settings.profile('employee')).tools?.map((tool) => tool.name),
      ).toEqual(['action']);
      await f.migration().configuration();
      expect(
        (await settings.profile('employee')).tools?.map((tool) => tool.name),
      ).toEqual(expected);
      expect(
        (await settings.employee('employee', owner.id)).tools?.map(
          (tool) => tool.name,
        ),
      ).toEqual(expected);
      expect(await f.migration().configuration()).toEqual({
        copied: 0,
        unchanged: 3,
      });
      expect(await f.snapshot()).toBe(before);

      const unopened = expected.includes('action') ? 'unopened' : 'action';
      f.models.create = () => ({
        async reply(input) {
          expect(input.tools.map((tool) => tool.definition.name)).toEqual(
            expected,
          );
          return new AIMessage({
            content: '',
            tool_calls: [
              { id: 'unopened-call', name: unopened, args: { value: 1 } },
            ],
          });
        },
      });
      const created = await f.service.create(owner, 'employee', model);
      const execute = await f.service.prepare(
        owner,
        created.id,
        'send',
        {
          sessionId: created.id,
          aiEmployee: 'employee',
          model,
          messages: [
            {
              key: 'selection-test',
              role: 'user',
              content: { type: 'text', content: 'Synthetic request' },
            },
          ],
        },
        new AbortController().signal,
      );
      await expect(execute(async () => undefined)).rejects.toThrow(
        'INVALID_MODEL_TOOL_CALL',
      );
      expect(f.state.invokes).toBe(0);
      expect(await f.db.repository('assistantToolCalls').count()).toBe(0);
    },
  );

  it.each([
    {
      scope: 'GENERAL' as const,
      selected: true,
      autoCall: false,
      expected: true,
    },
    {
      scope: 'SPECIFIED' as const,
      selected: true,
      autoCall: false,
      expected: true,
    },
    {
      scope: 'CUSTOM' as const,
      selected: true,
      autoCall: undefined,
      expected: false,
    },
    {
      scope: 'CUSTOM' as const,
      selected: true,
      autoCall: false,
      expected: false,
    },
    {
      scope: 'CUSTOM' as const,
      selected: true,
      autoCall: true,
      expected: true,
    },
    {
      scope: 'CUSTOM' as const,
      selected: false,
      autoCall: undefined,
      expected: true,
    },
  ])(
    'preserves old auto policy: $scope selected=$selected autoCall=$autoCall',
    async ({ scope, selected, autoCall, expected }) => {
      const f = await fixture();
      f.tools.set(
        'policy-tool',
        defineTools({
          scope,
          execution: 'backend',
          defaultPermission: 'ALLOW',
          definition: {
            name: 'policy-tool',
            description: 'Synthetic policy',
            schema: z.strictObject({ value: z.number() }),
          },
          async invoke() {
            return { value: 42 };
          },
        }),
      );
      await f.db.repository('aiEmployees').updateOne({
        filter: { username: 'employee' },
        values: {
          skillSettings: {
            tools: selected ? [{ name: 'policy-tool', autoCall }] : [],
            enabledTools: ['policy-tool'],
          },
        },
      });
      await f.migration().configuration();
      const settings = new AssistantEmployeeSettings(
        f.db.connection(),
        f.employees,
      );
      expect((await settings.profile('employee')).tools).toEqual([
        { name: 'policy-tool', autoCall: expected },
      ]);
    },
  );

  it('leaves an already copied incorrect selection unchanged rather than overwriting later edits', async () => {
    const f = await fixture();
    await f.db.repository('aiEmployees').updateOne({
      filter: { username: 'employee' },
      values: { skillSettings: { tools: [], skills: [] } },
    });
    await f.migration().configuration();
    const row = await f.db
      .repository('assistantEmployees')
      .findOne({ filter: { id: 'employee' } });
    // Represents a profile copied by the previous mapper, or a later administrator edit.
    const priorProfile = {
      ...(row!.profile as Record<string, unknown>),
      tools: [{ name: 'action', autoCall: false }],
    };
    await f.db.repository('assistantEmployees').updateOne({
      filter: { id: 'employee' },
      values: { profile: priorProfile },
    });
    const before = await f.snapshot();
    expect(await f.migration().configuration()).toEqual({
      copied: 0,
      unchanged: 3,
    });
    expect(
      (await f.db
        .repository('assistantEmployees')
        .findOne({ filter: { id: 'employee' } }))!.profile,
    ).toEqual(priorProfile);
    expect(await f.db.repository('capabilityMigrationLedger').count()).toBe(3);
    expect(await f.snapshot()).toBe(before);
  });

  it('copies non-secret configuration and preserves employee choice, personal prompt and administrator-curated models', async () => {
    const f = await fixture();
    const before = await f.snapshot();
    expect(await f.migration().configuration()).toEqual({
      copied: 3,
      unchanged: 0,
    });
    expect(await f.migration().preferences(owner.id)).toEqual({
      copied: 1,
      unchanged: 0,
    });
    const roster = await f.service.roster(owner);
    expect(roster[0]).toMatchObject({
      username: 'employee',
      nickname: '保留的员工',
      userConfig: { prompt: '保留个人提示词' },
      modelSettings: { enabled: true, models: [model] },
    });
    expect(JSON.stringify(roster)).not.toContain('Application instructions');
    const copied = await f.db
      .repository('assistantModelServices')
      .findOne({ filter: { id: 'service:legacy' } });
    expect(JSON.stringify(copied)).not.toContain('FAKE_SECRET');
    const catalog = mappedModels(
      { enabled: false, model: '', apiKey: '', baseURL: '', llmService: '' },
      f.ai,
      [copied!.settings as never],
    );
    expect(catalog.list()[0]!.enabledModels).toEqual([
      { label: 'Saved model title', value: 'synthetic' },
    ]);
    expect(JSON.stringify(catalog.list())).not.toContain('FAKE_SECRET');
    await f.service.setUserPrompt(owner, 'employee', 'New preference');
    expect(await f.migration().configuration()).toEqual({
      copied: 0,
      unchanged: 3,
    });
    expect(await f.migration().preferences(owner.id)).toEqual({
      copied: 0,
      unchanged: 1,
    });
    expect((await f.service.roster(owner))[0]).toMatchObject({
      userConfig: { prompt: 'New preference' },
    });
    expect(await f.snapshot()).toBe(before);
  });
  it('reads retained history and file bytes without any retired plugin, refuses cross-user reads and keeps sources unchanged', async () => {
    const f = await fixture();
    const before = await f.snapshot();
    expect((await f.service.list(owner))[0]!.id).toBe(session);
    const messages = toAIChatHistoryMessages(
      await f.service.history(owner, session),
    );
    expect(messages.map((message) => message.id)).toEqual([first, second]);
    expect(messages[0]!.metadata!.attachments![0]).toMatchObject({
      uid: 'file-1',
      filename: '原文.txt',
      preview: expect.stringContaining('assistantFiles/file-1/preview'),
    });
    await expect(
      f.service.history({ ...owner, id: 'intruder' }, session),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
    await expect(f.run()).rejects.toThrow('LEGACY_CONVERSATION_READ_ONLY');
    const response = await f.router().request('/assistantFiles/file-1/preview');
    expect(await response.text()).toBe('保留的附件内容');
    expect(
      (
        await f.router().request('/assistantFiles/file-1/preview', {
          headers: { 'x-user': 'intruder' },
        })
      ).status,
    ).toBe(403);
    expect(await f.snapshot()).toBe(before);
    expect(f.state.invokes).toBe(0);
  });
  it('reads and copies physical retained tables after old Collection metadata is removed', async () => {
    const f = await fixture({ pending: true });
    // A scalar JSON string that itself looks like JSON must never be parsed a second time.
    await f.db.repository('aiToolMessages').updateOne({
      filter: { id: callId },
      values: {
        invokeStatus: 'done',
        status: 'success',
        content: '{"value":42}',
        invokeStartTime: '1',
        invokeEndTime: '2',
      },
    });
    await f.restartWithoutLegacyMetadata();
    const raw = await new LegacyAssistantHistory(f.db.connection()).source(
      session,
      owner.id,
    );
    expect(raw.calls[0]!.content).toBe('{"value":42}');
    expect((await f.service.list(owner))[0]!.id).toBe(session);
    expect(
      toAIChatHistoryMessages(await f.service.history(owner, session)),
    ).toHaveLength(2);
    expect(await f.migration().configuration()).toEqual({
      copied: 3,
      unchanged: 0,
    });
    await f.migration().preferences(owner.id);
    await f.migration().conversation(session, owner.id);
    await f.restart();
    await f.run('resume');
    expect(f.state.invokes).toBe(0);
    expect(await readFile(f.file, 'utf8')).toBe('保留的附件内容');
  });
  it('keeps bigint message IDs, attachment references and original bytes through restart, continuation and migration replay', async () => {
    const f = await fixture();
    const before = await f.snapshot();
    await f.migration().configuration();
    await f.migration().preferences(owner.id);
    expect(await f.migration().conversation(session, owner.id)).toEqual({
      copied: 4,
      unchanged: 0,
    });
    await f.restart();
    const history = toAIChatHistoryMessages(
      await f.service.history(owner, session),
    );
    expect(history.map((message) => message.id)).toEqual([first, second]);
    await f.run();
    expect(JSON.stringify(f.state.contexts)).toContain('保留的附件内容');
    expect(JSON.stringify(f.state.contexts)).toContain('保留个人提示词');
    const after = await f.db
      .repository('assistantConversations')
      .findOne({ filter: { id: session } });
    expect(await f.migration().conversation(session, owner.id)).toEqual({
      copied: 0,
      unchanged: 4,
    });
    expect(
      await f.db
        .repository('assistantConversations')
        .findOne({ filter: { id: session } }),
    ).toEqual(after);
    expect(await f.db.repository('assistantMessages').count()).toBe(4);
    expect(await f.snapshot()).toBe(before);
    expect(await readFile(f.file, 'utf8')).toBe('保留的附件内容');
    expect(f.state.invokes).toBe(0);
    await expect(
      f.migration().conversation(session, 'intruder'),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });
  for (const reject of [false, true])
    it(`requires a new decision for a transferred approval and never executes it while copying; reject=${reject}`, async () => {
      const f = await fixture({ pending: true });
      await f.migration().configuration();
      await f.migration().conversation(session, owner.id);
      expect(f.state.invokes).toBe(0);
      expect(f.state.models).toBe(0);
      await f.restart();
      await expect(f.run('resume')).rejects.toThrow(
        'CHAT_CONFIRMATION_REQUIRED',
      );
      const history = toAIChatHistoryMessages(
        await f.service.history(owner, session),
      );
      expect(history.at(-1)!.parts[0]).toMatchObject({
        state: 'input-available',
      });
      await f.service.decide(owner, session, second, 'model-call', {
        type: reject ? 'reject' : 'approve',
      });
      await f.run('resume');
      expect(f.state.invokes).toBe(reject ? 0 : 1);
      await f.migration().conversation(session, owner.id);
      await expect(
        f.service.decide(owner, session, second, 'model-call', {
          type: 'approve',
        }),
      ).rejects.toThrow();
      expect(f.state.invokes).toBe(reject ? 0 : 1);
    });
});

describe('mapping failure gates and transaction boundaries', () => {
  it('rolls back an entire configuration unit if a later employee cannot be mapped', async () => {
    const f = await fixture();
    await f.db
      .repository('aiEmployees')
      .createOne({ values: { username: 'unknown', enabled: true } });
    const before = await f.snapshot();
    await expect(f.migration().configuration()).rejects.toThrow(
      'EMPLOYEE_NOT_MAPPED',
    );
    expect(await f.db.repository('assistantModelServices').count()).toBe(0);
    expect(await f.db.repository('assistantEmployees').count()).toBe(0);
    expect(await f.db.repository('capabilityMigrationLedger').count()).toBe(0);
    expect(await f.snapshot()).toBe(before);
  });
  it('isolates preference owners and rolls back a preference batch on an unknown employee', async () => {
    const f = await fixture();
    await f.migration().configuration();
    await f.db.repository('usersAiEmployees').createOne({
      values: {
        userId: 'another',
        aiEmployee: 'employee',
        prompt: 'Other person',
        sort: 0,
      },
    });
    expect(await f.migration().preferences(owner.id)).toEqual({
      copied: 1,
      unchanged: 0,
    });
    expect(await f.db.repository('assistantEmployeePreferences').count()).toBe(
      1,
    );
    expect(JSON.stringify(await f.service.roster(owner))).not.toContain(
      'Other person',
    );
    await f.db.repository('usersAiEmployees').createOne({
      values: {
        userId: 'another',
        aiEmployee: 'unknown',
        prompt: 'Unknown employee',
      },
    });
    const before = await f.snapshot();
    await expect(f.migration().preferences('another')).rejects.toThrow(
      'EMPLOYEE_NOT_MAPPED',
    );
    expect(await f.db.repository('assistantEmployeePreferences').count()).toBe(
      1,
    );
    expect(await f.snapshot()).toBe(before);
  });
  it('rolls back transcript and ledger writes when a later target message conflicts, then reruns safely', async () => {
    const f = await fixture();
    await f.migration().configuration();
    await f.db.repository('assistantMessages').createOne({
      values: {
        id: second,
        sessionId: 'other',
        message: {},
        createdAt: new Date(),
      },
    });
    const before = await f.snapshot();
    const ledgerBefore = await f.db
      .repository('capabilityMigrationLedger')
      .count();
    await expect(
      f.migration().conversation(session, owner.id),
    ).rejects.toThrow();
    expect(await f.db.repository('assistantConversations').count()).toBe(0);
    expect(await f.db.repository('assistantMessages').count()).toBe(1);
    expect(await f.db.repository('capabilityMigrationLedger').count()).toBe(
      ledgerBefore,
    );
    await f.db
      .repository('assistantMessages')
      .deleteMany({ filter: { id: second, sessionId: 'other' } });
    expect(await f.migration().conversation(session, owner.id)).toEqual({
      copied: 4,
      unchanged: 0,
    });
    expect(await f.snapshot()).toBe(before);
  });
  for (const issue of [
    'active',
    'unknown-provider',
    'unknown-role',
    'orphan-call',
    'missing-file',
    'cross-user-file',
    'traversal',
    'started-approval',
    'partial-message',
  ] as const)
    it(`refuses ${issue} without changing sources or making partial copies`, async () => {
      const f = await fixture({ pending: issue === 'started-approval' });
      if (issue === 'active')
        await f.db.repository('aiConversations').updateMany({
          filter: { sessionId: session },
          values: { llmActiveState: 'streaming' },
        });
      if (issue === 'unknown-provider')
        await f.db.repository('llmServices').updateMany({
          filter: { name: 'legacy' },
          values: { provider: 'openai' },
        });
      if (issue === 'unknown-role')
        await f.db.repository('aiMessages').updateMany({
          filter: { messageId: second },
          values: { role: 'unmapped-employee' },
        });
      if (issue === 'orphan-call')
        await f.db.repository('aiToolMessages').createOne({
          values: {
            id: callId,
            sessionId: session,
            messageId: second,
            toolCallId: 'orphan',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
      if (issue === 'missing-file') await rm(f.file);
      if (issue === 'cross-user-file')
        await f.db.repository('aiFiles').updateMany({
          filter: { id: 'file-1' },
          values: { createdById: 'someone-else' },
        });
      if (issue === 'traversal')
        await f.db.repository('aiFiles').updateMany({
          filter: { id: 'file-1' },
          values: { path: '../private' },
        });
      if (issue === 'started-approval')
        await f.db.repository('aiToolMessages').updateMany({
          filter: { id: callId },
          values: { invokeStartTime: '9223372036854775703' },
        });
      if (issue === 'partial-message')
        await f.db.repository('aiMessages').updateMany({
          filter: { messageId: second },
          values: { metadata: { incomplete: true } },
        });
      const before = await f.snapshot();
      if (issue === 'unknown-provider')
        await expect(f.migration().configuration()).rejects.toThrow(
          'PROVIDER_NOT_MAPPED',
        );
      else
        await expect(
          f.migration().conversation(session, owner.id),
        ).rejects.toThrow();
      expect(await f.db.repository('assistantConversations').count()).toBe(0);
      expect(await f.db.repository('assistantMessages').count()).toBe(0);
      expect(await f.db.repository('capabilityMigrationLedger').count()).toBe(
        0,
      );
      expect(await f.snapshot()).toBe(before);
      expect(f.state.invokes).toBe(0);
    });
  it('detects changed sources and missing targets without overwriting new runtime state', async () => {
    const f = await fixture();
    await f.migration().configuration();
    await f.migration().conversation(session, owner.id);
    await f.run();
    await f.db.repository('aiMessages').updateMany({
      filter: { messageId: first },
      values: { content: { type: 'text', content: 'changed source' } },
    });
    const target = await f.db
      .repository('assistantConversations')
      .findOne({ filter: { id: session } });
    await expect(f.migration().conversation(session, owner.id)).rejects.toThrow(
      'CAPABILITY_MIGRATION_CONFLICT',
    );
    expect(
      await f.db
        .repository('assistantConversations')
        .findOne({ filter: { id: session } }),
    ).toEqual(target);
    await f.db.repository('aiMessages').updateMany({
      filter: { messageId: first },
      values: { content: { type: 'text', content: '旧问题' } },
    });
    await f.db
      .repository('assistantFiles')
      .deleteMany({ filter: { id: 'file-1' } });
    await expect(f.migration().conversation(session, owner.id)).rejects.toThrow(
      'CAPABILITY_MIGRATION_TARGET_MISSING',
    );
  });
  it('streams an already executed legacy business failure as an error, with no new tool decision or execution', async () => {
    const f = await fixture({ pending: true });
    await f.db.repository('aiToolMessages').updateMany({
      filter: { id: callId },
      values: {
        invokeStatus: 'done',
        status: 'error',
        content: { code: 'OLD_BUSINESS_ERROR', secret: 'never expose' },
      },
    });
    await f.migration().configuration();
    await f.migration().conversation(session, owner.id);
    const events = await f.run('resume');
    expect(JSON.stringify(events)).toContain('OLD_BUSINESS_ERROR');
    expect(JSON.stringify(events)).not.toContain('never expose');
    expect(f.state.invokes).toBe(0);
    await f.migration().conversation(session, owner.id);
    expect(f.state.invokes).toBe(0);
  });
  it('preserves unsupported attachment references for authorized history but refuses to silently omit their model context', async () => {
    const f = await fixture();
    await f.db.repository('aiFiles').updateMany({
      filter: { id: 'file-1' },
      values: { mimetype: 'application/pdf' },
    });
    await f.migration().configuration();
    await f.migration().conversation(session, owner.id);
    expect(JSON.stringify(await f.service.history(owner, session))).toContain(
      'application/pdf',
    );
    await expect(f.run()).rejects.toThrow('AI_ATTACHMENT_PARSER_NOT_MAPPED');
    expect(f.state.models).toBe(0);
  });
  it('keeps machine-sized IDs as exact strings and rejects a caller-supplied rounded number', () => {
    expect(legacyId(9223372036854775700n)).toBe(first);
    expect(() => legacyId(Number(first))).toThrow('INVALID_LEGACY_ID');
  });
  it('requires a server-side key even if a legacy database record contains a key', async () => {
    const f = await fixture();
    const row = await f.db
      .repository('llmServices')
      .findOne({ filter: { name: 'legacy' } });
    const metadata = legacyModelSettings(row!);
    expect(() =>
      mappedModels(
        { enabled: false, llmService: '', model: '', apiKey: '', baseURL: '' },
        { llmServices: { legacy: { provider: 'openai-completions' } } },
        [metadata],
      ),
    ).toThrow('MISSING_SECRETS');
    expect(JSON.stringify(metadata)).not.toContain('OLD_FAKE_SECRET');
  });
});

describe('mapped history entry points', () => {
  it('uses the actual runtime selector and native application prompt/history/file routes without a legacy route', async () => {
    const f = await fixture();
    const router = f.router();
    const operations: string[] = [];
    const client = {
      async request(options: ApiRequestOptions) {
        operations.push(`${options.method} ${options.path}`);
        const response = await router.request('/' + options.path, {
          method: options.method,
          headers: options.json
            ? { 'content-type': 'application/json' }
            : undefined,
          body: options.json ? JSON.stringify(options.json) : undefined,
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      },
    } as unknown as ApiClient;
    const runtime = new RuntimeAIService(client);
    expect((await runtime.listConversations())[0]!.id).toBe(session);
    expect(
      (await runtime.getConversationMessages(session, { updateRead: true }))[0]!
        .id,
    ).toBe(first);
    await f.migration().configuration();
    await f.migration().preferences(owner.id);
    await f.migration().conversation(session, owner.id);
    await runtime.updateEmployeeUserPrompt('employee', 'Changed on the page');
    expect((await runtime.listEmployees())[0]).toMatchObject({
      userConfig: { prompt: 'Changed on the page' },
    });
    expect(
      operations.some((operation) => operation.includes('aiEmployee')),
    ).toBe(false);
    expect(
      (await runtime.listConversations()).filter((row) => row.id === session),
    ).toHaveLength(1);
    await f.service.edit(owner, session, { state: 'archived' });
    expect(await f.service.list(owner)).toHaveLength(0);
  });
  it('allows a background reply into a copied session with its original ID and rejects another owner', async () => {
    const f = await fixture({ attachments: false });
    await f.migration().configuration();
    await f.migration().conversation(session, owner.id);
    const container = new ServiceContainer();
    container.singleton(assistantConversationsToken, () => f.service);
    const runner = createAIRunner(container);
    const result = await runner.reply({
      userId: owner.id,
      employee: 'employee',
      title: 'Follow-up',
      text: 'Continue',
      timeZone: 'UTC',
      sessionId: session,
    });
    expect(result.sessionId).toBe(session);
    expect(f.state.models).toBe(1);
    await expect(
      runner.reply({
        userId: 'intruder',
        employee: 'employee',
        title: 'Forbidden',
        text: 'Continue',
        timeZone: 'UTC',
        sessionId: session,
      }),
    ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  });
  it('preserves a confirmed old rejection with a plain-text ToolMessage without executing it', async () => {
    const f = await fixture({ pending: true, attachments: false });
    await f.db.repository('aiToolMessages').updateMany({
      filter: { id: callId },
      values: {
        invokeStatus: 'confirmed',
        status: null,
        userDecision: { type: 'reject' },
      },
    });
    await f.db.repository('aiMessages').createOne({
      values: {
        messageId: '9223372036854775703',
        sessionId: session,
        role: 'tool',
        content: { type: 'text', content: 'User rejected the action' },
        metadata: { toolCallId: 'model-call', toolName: 'action' },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await f.migration().configuration();
    await f.migration().conversation(session, owner.id);
    expect(JSON.stringify(await f.service.history(owner, session))).toContain(
      'rejected',
    );
    await f.run();
    expect(f.state.invokes).toBe(0);
  });
  for (const mode of ['raw', 'none'] as const)
    it(`preserves ${mode} prompt semantics without applying personal preferences`, async () => {
      const f = await fixture({ attachments: false });
      await f.db.repository('aiEmployees').updateMany({
        filter: { username: 'employee' },
        values: { chatSettings: { systemPromptMode: mode } },
      });
      await f.migration().configuration();
      await f.migration().preferences(owner.id);
      await f.migration().conversation(session, owner.id);
      await f.run();
      const context = JSON.stringify(f.state.contexts);
      expect(context).not.toContain('保留个人提示词');
      expect(context.includes('Application instructions')).toBe(mode === 'raw');
    });
  it('keeps disabled employees out of selection and execution while keeping owned history readable', async () => {
    const f = await fixture({ attachments: false });
    await f.db.repository('aiEmployees').updateMany({
      filter: { username: 'employee' },
      values: { enabled: false },
    });
    await f.migration().configuration();
    await f.migration().conversation(session, owner.id);
    expect(await f.service.roster(owner)).toEqual([]);
    expect((await f.service.history(owner, session)).length).toBe(2);
    await expect(f.run()).rejects.toThrow('EMPLOYEE_DISABLED');
    expect(f.state.models).toBe(0);
  });
  it('blocks an old edited pending action rather than silently restoring the original arguments', async () => {
    const f = await fixture({ pending: true });
    await f.db.repository('aiToolMessages').updateMany({
      filter: { id: callId },
      values: {
        userDecision: {
          type: 'edit',
          editedAction: { name: 'action', args: { value: 99 } },
        },
      },
    });
    await expect(f.migration().conversation(session, owner.id)).rejects.toThrow(
      'UNMAPPED_TOOL_EDIT',
    );
    expect(await f.db.repository('assistantConversations').count()).toBe(0);
    expect(f.state.invokes).toBe(0);
  });
  it('keeps history readable when a server model key is unavailable, while model creation fails explicitly', async () => {
    const f = await fixture();
    const row = await f.db
      .repository('llmServices')
      .findOne({ filter: { name: 'legacy' } });
    const models = mappedModels(
      { enabled: false, llmService: '', model: '', apiKey: '', baseURL: '' },
      { llmServices: { legacy: { provider: 'openai-completions' } } },
      [legacyModelSettings(row!)],
      true,
    );
    expect(models.list()).toEqual([]);
    expect(() => models.create(model)).toThrow('MISSING_SECRETS');
    expect((await f.service.history(owner, session)).length).toBe(2);
  });
});

it('uses the mapped server key, endpoint, model list and sampling options through the real LangChain adapter', async () => {
  const f = await fixture();
  const bodies: Record<string, unknown>[] = [];
  const authorizations: string[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk.toString();
    const body = JSON.parse(raw);
    bodies.push(body);
    authorizations.push(String(req.headers.authorization));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify({ id: 'response', object: 'chat.completion.chunk', created: 1, model: 'synthetic', choices: [{ index: 0, delta: { role: 'assistant', content: 'Mapped reply' }, finish_reason: null }] })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('missing address');
  const source = await f.db
    .repository('llmServices')
    .findOne({ filter: { name: 'legacy' } });
  const catalog = mappedModels(
    { enabled: false, llmService: '', model: '', apiKey: '', baseURL: '' },
    {
      llmServices: {
        legacy: {
          provider: 'openai-completions',
          options: {
            apiKey: 'SERVER_FAKE_SECRET',
            baseURL: `http://127.0.0.1:${address.port}/v1`,
          },
        },
      },
    },
    [legacyModelSettings(source!)],
  );
  const response = await catalog.create(model).reply({
    messages: [new HumanMessage('Hello')],
    tools: [],
    signal: new AbortController().signal,
    onText: async () => undefined,
  });
  expect(response.content).toBe('Mapped reply');
  expect(bodies[0]).toMatchObject({
    model: 'synthetic',
    temperature: 0.4,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  });
  expect(authorizations).toEqual(['Bearer SERVER_FAKE_SECRET']);
  expect(JSON.stringify(catalog.list())).not.toContain('FAKE_SECRET');
});

it('records SQL costs for bounded migration units, replay, legacy reads and migrated requests', async () => {
  const f = await fixture({ attachments: false });
  const statements: string[] = [];
  const client = await f.db.connection().client<{
    on: (event: string, callback: (query: { sql: string }) => void) => void;
    removeListener: (
      event: string,
      callback: (query: { sql: string }) => void,
    ) => void;
  }>();
  const listener = (query: { sql: string }) => statements.push(query.sql);
  client.on('query', listener);
  const measure = async (operation: string, run: () => Promise<unknown>) => {
    statements.length = 0;
    await run();
    console.log(
      'HISTORY_SQL_COST ' +
        JSON.stringify({
          operation,
          selects: statements.filter((q) => /^select\b/iu.test(q)).length,
          inserts: statements.filter((q) => /^insert\b/iu.test(q)).length,
          updates: statements.filter((q) => /^update\b/iu.test(q)).length,
          begins: statements.filter((q) => /^begin\b/iu.test(q)).length,
          commits: statements.filter((q) => /^commit\b/iu.test(q)).length,
          savepoints: statements.filter((q) => /^savepoint\b/iu.test(q)).length,
        }),
    );
  };
  try {
    await measure('legacy-history', () => f.service.history(owner, session));
    await measure('legacy-history-warm', () =>
      f.service.history(owner, session),
    );
    await measure('configuration-copy', () => f.migration().configuration());
    await measure('preferences-copy', () =>
      f.migration().preferences(owner.id),
    );
    await measure('transcript-copy', () =>
      f.migration().conversation(session, owner.id),
    );
    await measure('configuration-replay', () => f.migration().configuration());
    await measure('preferences-replay', () =>
      f.migration().preferences(owner.id),
    );
    await measure('transcript-replay', () =>
      f.migration().conversation(session, owner.id),
    );
    await measure('copied-history', () => f.service.history(owner, session));
    await measure('copied-history-warm', () =>
      f.service.history(owner, session),
    );
    await measure('roster', () => f.service.roster(owner));
    await measure('roster-warm', () => f.service.roster(owner));
    await measure('continue-send', () => f.run());
  } finally {
    client.removeListener('query', listener);
  }
});

it('refuses to discard active MCP/skill/knowledge configuration and preserves unavailable model metadata', async () => {
  const f = await fixture();
  for (const section of [
    { mcpServers: { remote: { url: 'https://synthetic.invalid' } } },
    { skills: { paths: ['skills'] } },
    { aiKnowledgeBase: { vectorDatabases: [{ key: 'knowledge' }] } },
  ]) {
    const migration = new LegacyAssistantMigration(
      f.db.connection(),
      f.employees,
      new Map(),
      f.models,
      { ...f.ai, ...section },
      async () => true,
    );
    await expect(migration.configuration()).rejects.toThrow(
      'AI_CAPABILITY_NOT_MAPPED',
    );
    expect(await f.db.repository('assistantEmployees').count()).toBe(0);
  }
  const row = await f.db
    .repository('llmServices')
    .findOne({ filter: { name: 'legacy' } });
  const metadata = legacyModelSettings({ ...row, enabled: false });
  expect(metadata.enabled).toBe(false);
  expect(metadata.selectionMode).toBe('custom');
  expect(metadata.sort).toBe(4);
  expect(
    mappedModels(
      { enabled: false, llmService: '', model: '', apiKey: '', baseURL: '' },
      f.ai,
      [metadata],
    ).list(),
  ).toEqual([]);
});

it('refuses schema rollback after copying data and reverses the new schema only while it is empty', async () => {
  const f = await fixture();
  await f.migration().configuration();
  await expect(
    migration34.down!({
      builder: f.db.builder(),
      query: f.db.query(),
    } as never),
  ).rejects.toThrow('ASSISTANT_HISTORY_NOT_EMPTY');
  expect(await f.db.repository('assistantEmployees').count()).toBe(1);
  const empty = await fixture();
  await migration34.down!({
    builder: empty.db.builder(),
    query: empty.db.query(),
  } as never);
  expect(await empty.db.builder().hasCollection('assistantEmployees')).toBe(
    false,
  );
  expect(await empty.db.repository('aiConversations').count()).toBe(1);
});

it('does not invent legacy history on a new installation', async () => {
  const db = createDatabaseManager({
    default: 'main',
    connections: { main: sqlite({ filename: ':memory:' }) },
    metadataStore: new InMemoryCollectionMetadataStore(),
  });
  await db.connect();
  cleanup.push(() => db.destroy());
  for (const migration of [migration31, migration33, migration34])
    await migration.up!({
      builder: db.builder(),
      query: db.query(),
      repository: (name: string) => db.repository(name),
    } as never);
  const models: AssistantModels = {
    list: () => [],
    create: () => {
      throw new Error('No model needed for a new installation');
    },
  };
  const migration = new LegacyAssistantMigration(
    db.connection(),
    new Map(),
    new Map(),
    models,
    { llmServices: {} },
    async () => false,
  );
  expect(await migration.configuration()).toEqual({ copied: 0, unchanged: 0 });
  expect(await migration.preferences(owner.id)).toEqual({
    copied: 0,
    unchanged: 0,
  });
  const history = new LegacyAssistantHistory(db.connection());
  expect(await history.list(owner.id)).toEqual([]);
  await expect(history.get(session, owner.id)).rejects.toThrow(
    'CONVERSATION_NOT_FOUND',
  );
  await expect(history.file('missing', owner.id)).rejects.toThrow(
    'FILE_ACCESS_DENIED',
  );
  expect(await db.builder().hasCollection('aiConversations')).toBe(false);
});

it('keeps ownership and current authorization in force after a pending conversation is copied', async () => {
  const f = await fixture({ pending: true });
  await f.migration().configuration();
  await f.migration().conversation(session, owner.id);
  await expect(
    f.service.decide(
      { ...owner, id: 'intruder', isRoot: true },
      session,
      second,
      'model-call',
      { type: 'approve' },
    ),
  ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  f.state.allowed = false;
  await expect(
    f.service.decide(owner, session, second, 'model-call', { type: 'approve' }),
  ).rejects.toThrow('ASSISTANT_FORBIDDEN');
  expect(f.state.invokes).toBe(0);
  expect(
    (await f.db.repository('assistantToolCalls').findMany())[0]!.status,
  ).toBe('pending');
});

it('preserves the uploader and requires current AI settings permission for a cross-uploader attachment', async () => {
  const f = await fixture();
  await f.db.repository('aiFiles').updateMany({
    filter: { id: 'file-1' },
    values: { createdById: 'other-uploader' },
  });
  f.state.canReadAny = true;
  expect((await f.service.history(owner, session)).length).toBe(2);
  await f.migration().configuration();
  await f.migration().conversation(session, owner.id);
  expect(
    await f.db
      .repository('assistantFiles')
      .findOne({ filter: { id: 'file-1' } }),
  ).toMatchObject({ userId: 'other-uploader' });
  expect(
    (await f.router().request('/assistantFiles/file-1/preview')).status,
  ).toBe(200);
  f.state.canReadAny = false;
  expect(
    (await f.router().request('/assistantFiles/file-1/preview')).status,
  ).toBe(403);
  await expect(f.run()).rejects.toThrow('FILE_ACCESS_DENIED');
  expect(f.state.models).toBe(0);
});

it('chooses the copied employee model for new background conversations instead of the first catalog entry', async () => {
  const f = await fixture({ attachments: false });
  await f.migration().configuration();
  const originalList = f.models.list;
  f.models.list = () => [
    {
      llmService: 'other',
      llmServiceTitle: 'Other',
      enabledModels: [{ value: 'other-model', label: 'Other' }],
    },
    ...originalList(),
  ];
  expect(await f.service.defaultModel(owner, 'employee')).toEqual(model);
  const container = new ServiceContainer();
  container.singleton(assistantConversationsToken, () => f.service);
  const result = await createAIRunner(container).reply({
    userId: owner.id,
    employee: 'employee',
    title: 'New',
    text: 'New turn',
    timeZone: 'UTC',
  });
  expect(result.text).toBe('Continued');
  expect((await f.service.get(owner, result.sessionId)).model).toEqual(model);
});

it('preserves employee model allow-lists, skips disabled entries and refuses an out-of-list model', async () => {
  const f = await fixture({ attachments: false });
  const allowed = {
    enabled: true,
    models: [{ llmService: 'legacy', model: 'disabled' }, model],
  };
  await f.db.repository('aiEmployees').updateMany({
    filter: { username: 'employee' },
    values: { modelSettings: allowed },
  });
  await f.migration().configuration();
  expect((await f.service.roster(owner))[0]!.modelSettings).toEqual(allowed);
  expect(await f.service.defaultModel(owner, 'employee')).toEqual(model);
  const oldList = f.models.list,
    oldCreate = f.models.create;
  f.models.list = () => [
    ...oldList(),
    {
      llmService: 'other',
      llmServiceTitle: 'Other',
      enabledModels: [{ value: 'other-model', label: 'Other' }],
    },
  ];
  f.models.create = (selected, schema) =>
    oldCreate(selected.llmService === 'other' ? model : selected, schema);
  await expect(
    f.service.create(owner, 'employee', {
      llmService: 'other',
      model: 'other-model',
    }),
  ).rejects.toThrow('ASSISTANT_MODEL_UNAVAILABLE');
  expect(await f.db.repository('assistantConversations').count()).toBe(0);
});

it('preserves the global default when an employee has no enabled model restriction', async () => {
  const f = await fixture({ attachments: false });
  await f.db.repository('aiEmployees').updateMany({
    filter: { username: 'employee' },
    values: { modelSettings: null },
  });
  await f.migration().configuration();
  const oldList = f.models.list;
  f.models.list = () => [
    {
      llmService: 'other',
      llmServiceTitle: 'Other',
      enabledModels: [{ value: 'other-model', label: 'Other' }],
    },
    ...oldList(),
  ];
  expect(await f.service.defaultModel(owner, 'employee')).toEqual(model);
});

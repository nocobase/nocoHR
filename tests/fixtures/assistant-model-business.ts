import { createServer, type ServerResponse } from 'node:http';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { ServiceContainer } from '@nocobase/service-provider';
import { z } from 'zod';
import {
  defineTools,
  type AIEmployeeOptions,
} from '../../server/ai/contracts.js';
import { mappedModels } from '../../server/providers/assistant/model-configuration.js';
import { AssistantConversations } from '../../server/providers/assistant/conversation-service.js';
import { ConversationStore } from '../../server/providers/assistant/conversation-store.js';
import { DatabaseToolCallStore } from '../../server/providers/assistant/tool-call-store.js';
import { AssistantEmployeeSettings } from '../../server/providers/assistant/employee-settings.js';
import { LegacyAssistantHistory } from '../../server/providers/assistant/legacy-history.js';
import { assistantConversationsToken } from '../../server/providers/assistant/tokens.js';
import { createAIRunner } from '../../server/providers/hr/ai-runner.js';
import { createPlatform } from '../../server/providers/hr/platform.js';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { OrganizationService } from '../../server/providers/hr/organization-service.js';
import m0 from '../../database/main/migrations/202609270001_create_organization.js';
import m1 from '../../database/main/migrations/202609270002_create_talent_framework.js';
import m2 from '../../database/main/migrations/202609270003_create_employees.js';
import m3 from '../../database/main/migrations/202609270004_create_hr_core.js';
import m4 from '../../database/main/migrations/202609280001_create_knowledge_learning.js';
import m5 from '../../database/main/migrations/202609280002_create_exams_certifications.js';
import m6 from '../../database/main/migrations/202609290001_create_training_operations.js';
import m7 from '../../database/main/migrations/202609290004_add_personnel_settings.js';
import m8 from '../../database/main/migrations/202609290005_create_work_items.js';
import m9 from '../../database/main/migrations/202609290009_create_org_sync.js';
import m10 from '../../database/main/migrations/202610050001_add_im_cards.js';
import m11 from '../../database/main/migrations/202610140001_add_im_card_message_id.js';
import m12 from '../../database/main/migrations/202610270031_create_capability_migration_state.js';
import m13 from '../../database/main/migrations/202610270033_create_assistant_conversations.js';
import m14 from '../../database/main/migrations/202610270034_create_assistant_history_configuration.js';

export type ModelRequest = {
  model: string;
  stream?: boolean;
  tools?: { function: { name: string } }[];
  messages: { role: string; content?: string; tool_calls?: unknown[] }[];
  [key: string]: unknown;
};
export type Answer = {
  text?: string;
  structured?: unknown;
  tool?: { name: string; args: string };
  status?: number;
  hold?: boolean;
};
export const actor = { id: 'owner', roles: [], isRoot: false };
export const selection = { llmService: 'configured', model: 'chosen' };
export const stamp = { createdAt: new Date(), updatedAt: new Date() };

/** Real SDK over loopback HTTP, application stores and SQLite. Identity, grants, model and office-suite network are synthetic. */
export async function modelBusinessFixture(
  dispose: (fn: () => Promise<void>) => void,
) {
  const requests: ModelRequest[] = [];
  const answers: Answer[] = [];
  const arrived: (() => void)[] = [];
  const respond = (res: ServerResponse, body: ModelRequest, answer: Answer) => {
    if (answer.status) {
      res.writeHead(answer.status, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'synthetic provider failure', type: 'api_error' },
        }),
      );
      return;
    }
    if (answer.hold) return;
    const tool = answer.tool;
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const chunk = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: 'completion', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (tool) {
        chunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'stable-call',
              type: 'function',
              function: { name: tool.name, arguments: tool.args.slice(0, 4) },
            },
          ],
        });
        chunk({
          tool_calls: [
            { index: 0, function: { arguments: tool.args.slice(4) } },
          ],
        });
        chunk({}, 'tool_calls');
      } else {
        const text = answer.text ?? 'Synthetic reply';
        chunk({ role: 'assistant', content: text.slice(0, 4) });
        chunk({ content: text.slice(4) });
        chunk({}, 'stop');
      }
      res.end('data: [DONE]\n\n');
    } else {
      const structured = 'structured' in answer;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'completion',
          object: 'chat.completion',
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              finish_reason: structured ? 'tool_calls' : 'stop',
              message: {
                role: 'assistant',
                content: answer.text ?? '',
                ...(structured
                  ? {
                      tool_calls: [
                        {
                          id: 'format-call',
                          type: 'function',
                          function: {
                            name: body.tools![0]!.function.name,
                            arguments:
                              typeof answer.structured === 'string'
                                ? answer.structured
                                : JSON.stringify(answer.structured),
                          },
                        },
                      ],
                    }
                  : {}),
              },
            },
          ],
        }),
      );
    }
  };
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part.toString();
    const body = JSON.parse(raw) as ModelRequest;
    requests.push(body);
    respond(res, body, answers.shift() ?? { status: 500 });
    arrived.shift()?.();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('No loopback address');
  const db = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({ filename: ':memory:', schemaManagement: 'managed' }),
    },
    metadataStore: new InMemoryCollectionMetadataStore(),
  });
  await db.connect();
  dispose(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.destroy();
  });
  for (const migration of [
    m0,
    m1,
    m2,
    m3,
    m4,
    m5,
    m6,
    m7,
    m8,
    m9,
    m10,
    m11,
    m12,
    m13,
    m14,
  ])
    await migration.up!({
      builder: db.builder(),
      query: db.query(),
      repository: (name: string) => db.repository(name),
    } as never);
  const state = {
    allowed: true,
    invokes: 0,
    policy: 'allow' as 'allow' | 'ask' | 'deny',
  };
  const authorize = async () => {
    if (!state.allowed) throw new Error('ASSISTANT_FORBIDDEN');
  };
  const tools = new Map(
    ['backgroundAction', 'submitMyProfileChange'].map((name) => [
      name,
      defineTools({
        scope: 'SPECIFIED',
        execution: 'backend',
        defaultPermission: name === 'backgroundAction' ? 'ALLOW' : 'ASK',
        definition: {
          name,
          description: 'Synthetic business boundary',
          schema: (name === 'backgroundAction'
            ? z.object({ value: z.number() })
            : z.object({
                changes: z.object({ mobile: z.string() }),
              })) as z.ZodType,
        },
        invoke: async () => {
          state.invokes++;
          return { ok: true };
        },
      }),
    ]),
  );
  const employees = new Map<string, AIEmployeeOptions>(
    [
      'hrAssistant',
      'knowledgeAssistant',
      'learningCoach',
      'certificationSteward',
    ].map((username) => [
      username,
      { username, tools: [...tools.keys()].map((name) => ({ name })) },
    ]),
  );
  const config = {
    enabled: true,
    llmService: 'fallback',
    model: 'other',
    apiKey: 'synthetic-fallback',
    baseURL: `http://127.0.0.1:${address.port}/v1`,
  };
  const aiConfig = {
    llmServices: {
      configured: {
        provider: 'openai-completions',
        title: 'Configured',
        options: { apiKey: 'synthetic-only', baseURL: config.baseURL },
        enabledModels: [{ value: 'chosen', label: 'Chosen' }],
        modelOptions: {
          temperature: 0.2,
          topP: 0.8,
          frequencyPenalty: 0.1,
          presencePenalty: 0.3,
        },
      },
    },
  };
  const models = mappedModels(config, aiConfig, []);
  const settings = new AssistantEmployeeSettings(db.connection(), employees);
  for (const [username, base] of employees)
    await db.repository('assistantEmployees').createOne({
      values: {
        id: username,
        profile: {
          ...base,
          enabled: true,
          modelSettings: { enabled: true, models: [selection] },
        },
      },
    });
  const container = new ServiceContainer();
  const calls = new DatabaseToolCallStore(db.connection());
  const service = new AssistantConversations(
    container,
    new ConversationStore(db.connection()),
    calls,
    employees,
    tools,
    {
      authorizeConversation: authorize,
      authorize,
      decision: async () => state.policy,
    },
    models,
    {
      history: new LegacyAssistantHistory(db.connection()),
      employees: settings,
      openFile: async () => {
        throw new Error('No files');
      },
      canReadAnyFile: async () => false,
    },
  );
  container.singleton(assistantConversationsToken, () => service);
  const runner = createAIRunner(container);
  const notifications: unknown[] = [];
  const scope = {
    identity: { principal: { type: 'user', id: 'owner' } },
    authorize: async () => ({
      effect: state.allowed ? 'allow' : 'deny',
      conditions: {
        database: {
          employees: {
            read: {
              fields: ['id', 'name', 'positionId', 'status', 'userId'],
              scope: { userId: 'owner' },
            },
            create: false,
            update: false,
            delete: false,
          },
        },
      },
    }),
  };
  const authz = {
    subjects: { resolveFor: async () => [] },
    for: () => scope,
  } as unknown as AppAuthorization;
  const platform = createPlatform({
    database: db,
    authz,
    organization: {
      resolveHead: async () => undefined,
    } as unknown as OrganizationService,
    users: { get: async (id) => ({ id, name: id }) },
    notify: async (input) => {
      notifications.push(input);
    },
    timeZone: 'UTC',
  });
  const cost = async <T>(name: string, action: () => Promise<T>) => {
    const queries: string[] = [];
    const client = await db.connection().client<{
      on(event: string, listener: (q: { sql: string }) => void): void;
      removeListener(
        event: string,
        listener: (q: { sql: string }) => void,
      ): void;
    }>();
    const listener = (q: { sql: string }) => queries.push(q.sql);
    const before = requests.length;
    client.on('query', listener);
    try {
      return await action();
    } finally {
      client.removeListener('query', listener);
      console.log(
        'MODEL_BUSINESS_COST ' +
          JSON.stringify({
            name,
            modelRequests: requests.length - before,
            selects: queries.filter((q) => /^select\b/iu.test(q)).length,
            inserts: queries.filter((q) => /^insert\b/iu.test(q)).length,
            updates: queries.filter((q) => /^update\b/iu.test(q)).length,
            deletes: queries.filter((q) => /^delete\b/iu.test(q)).length,
            begins: queries.filter((q) => /^begin\b/iu.test(q)).length,
            commits: queries.filter((q) => /^commit\b/iu.test(q)).length,
          }),
      );
    }
  };
  return {
    db,
    requests,
    answers,
    state,
    service,
    runner,
    container,
    models,
    settings,
    employees,
    calls,
    config,
    aiConfig,
    platform,
    scope,
    notifications,
    cost,
    waitForRequest: () => new Promise<void>((resolve) => arrived.push(resolve)),
    reply: (text = 'Hello', sessionId?: string) =>
      runner.reply({
        employee: 'hrAssistant',
        userId: actor.id,
        title: 'Synthetic bot',
        text,
        timeZone: 'UTC',
        sessionId,
      }),
  };
}

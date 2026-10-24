import { createConflictCheck } from '../../server/providers/hr/knowledge-conflicts.js';
import { writeFileSync } from 'node:fs';
import { signCallback } from '../helpers/callback-signature.js';
import { createFeishuTransport } from '../../server/providers/hr/feishu/transport.js';
import { createImChannel } from '../../server/providers/hr/im-channel.js';
import {
  platformToken as imPlatformToken,
  imChannelToken,
} from '../../server/providers/hr/tokens.js';
import { NATIVE_APPROVAL_CARD } from '../../server/providers/hr/im-cards/native-approval-card.js';
import {
  consumeIMResponse,
  openIMSession,
} from '../../server/providers/native-ai/im-session.js';
import type { NativeApprovalBinding } from '../../server/providers/native-ai/im-session.js';
// @vitest-environment node
import { runWeeklyBriefs } from '../../server/providers/hr/maintenance.js';
import {
  platformToken,
  insightServiceToken,
  licensedServicesToken,
  talentReviewServicesToken,
} from '../../server/providers/hr/tokens.js';
import { createNativeBillReview } from '../../server/providers/native-ai/vendor-bill.js';
import {
  payrollServicesToken,
  aiEntryServiceToken,
} from '../../server/providers/hr/tokens.js';
import {
  vendorBillResource,
  payrollSettingsResource,
} from '../../server/providers/hr/payroll/resources.js';
import { createNativeStructuredAI } from '../../server/providers/native-ai/structured.js';
import {
  personnelSettingsToken,
  settingsDraftServiceToken,
} from '../../server/providers/hr/tokens.js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { registerHooks } from 'node:module';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from '@nocobase/app-testing/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { learningCoachResource } from '../../server/providers/hr/training-resources.js';
import {
  frameworkAdvisorResource,
  aiAssistantResource,
  profileChangeResource,
} from '../../server/providers/hr/authz-resources.js';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  automationServiceToken,
  automationTasksToken,
} from '../../server/providers/hr/tokens.js';
import { hrCoreServiceToken } from '../../server/providers/hr/tokens.js';
import { z } from 'zod';
import { createStandaloneServer } from '../../server/standalone.js';
import { scopeForUser } from '../../server/providers/hr/authorize.js';
import {
  kbDocumentResource,
  knowledgeAssistantResource,
  VISIBLE_DOCUMENTS_SCOPE,
} from '../../server/providers/hr/learning-resources.js';
import {
  knowledgeServiceToken,
  examSettingsToken,
  certificationServiceToken,
} from '../../server/providers/hr/tokens.js';
import { generateLearningPlan } from '../../server/providers/native-ai/learning-plan.js';

// Historical application seeds use Node's source loader, outside Vitest transforms.
const loader = registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        (context.parentURL ?? '').replace(/[?#].*$/u, '').endsWith('.ts') &&
        !context.parentURL.includes('/node_modules/')
      )
        return next(specifier.slice(0, -3) + '.ts', context);
      throw error;
    }
  },
});
let app: TestApp;
let text = 'Native fixture reply';
let routeAnswer: string | undefined;
let calls = 0;
let imTransportCounts:
  { sendCard: number; sendText: number; updateCard: number } | undefined;
const requests: { tools?: unknown[]; messages?: unknown[] }[] = [];
let tool: { name: string; args: string } | undefined;
const toolQueue: { name: string; args: string }[] = [];
let beforeModelReply: (() => Promise<void>) | undefined;
let holdFinal = false;
let hold = false;
let heldStream: { opened(): void; closed(): void } | undefined;
let fail = false;
const model = createServer(async (req, res) => {
  let raw = '';
  for await (const part of req) raw += part;
  const input = JSON.parse(raw) as { stream?: boolean; tools?: unknown[] };
  requests.push(input);
  calls++;
  if (fail) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: 'Controlled model rejection',
          type: 'authentication_error',
        },
      }),
    );
    return;
  }
  await beforeModelReply?.();
  const selectedTool = input.tools?.length
    ? (tool ?? toolQueue.shift())
    : undefined;
  if (input.tools?.length) tool = undefined;
  const message = {
    role: 'assistant',
    content:
      !input.tools?.length && routeAnswer !== undefined ? routeAnswer : text,
  };
  if (input.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: unknown, finish_reason: string | null = null) =>
      res.write(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    if (selectedTool) {
      chunk({
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'controlled-call-' + calls,
            type: 'function',
            function: { name: selectedTool.name, arguments: selectedTool.args },
          },
        ],
      });
      chunk({}, 'tool_calls');
    } else {
      chunk(message);
    }
    if (hold || (holdFinal && !selectedTool)) {
      res.once('close', () => heldStream?.closed());
      heldStream?.opened();
      return;
    }
    chunk({}, 'stop');
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'fixture',
        object: 'chat.completion',
        created: 1,
        model: 'fixture',
        choices: [{ index: 0, message, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      }),
    );
  }
});
let actor: Awaited<ReturnType<typeof actorContext>>;
async function actorContext(id: string) {
  return {
    user: { id },
    authorization: await scopeForUser(
      app.application.container.resolve(authorizationToken),
      id,
    ),
    credentials: { kind: 'controlled-test', userId: id },
  };
}
async function cost<T>(name: string, action: () => Promise<T>) {
  const sql: string[] = [];
  const client = await app.connection.client<{
    on(event: string, callback: (q: { sql: string }) => void): void;
    removeListener(event: string, callback: (q: { sql: string }) => void): void;
  }>();
  const listener = (q: { sql: string }) => sql.push(q.sql);
  const before = calls;
  const beforeTransport = imTransportCounts
    ? { ...imTransportCounts }
    : undefined;
  client.on('query', listener);
  try {
    return await action();
  } finally {
    client.removeListener('query', listener);
    process.stdout.write(
      'NATIVE_AI_COST ' +
        JSON.stringify({
          name,
          modelRequests: calls - before,
          ...(name.startsWith('im-')
            ? {
                transport:
                  imTransportCounts && beforeTransport
                    ? Object.fromEntries(
                        Object.entries(imTransportCounts).map(
                          ([key, value]) => [
                            key,
                            value -
                              beforeTransport[
                                key as keyof typeof beforeTransport
                              ],
                          ],
                        ),
                      )
                    : undefined,
                tables: Object.fromEntries(
                  [
                    'imCards',
                    'hrReminderLog',
                    'employees',
                    'profileChangeRequests',
                    'agConversations',
                    'agConversationMessages',
                  ].map((table) => [
                    table,
                    Object.fromEntries(
                      ['select', 'insert', 'update', 'delete'].map((verb) => [
                        verb,
                        sql.filter(
                          (q) =>
                            new RegExp('^' + verb + '\\b', 'i').test(q) &&
                            new RegExp(
                              '\\b(?:' +
                                table +
                                '|' +
                                table.replace(
                                  /[A-Z]/gu,
                                  (letter) => '_' + letter.toLowerCase(),
                                ) +
                                ')\\b',
                              'i',
                            ).test(q),
                        ).length,
                      ]),
                    ),
                  ]),
                ),
              }
            : {}),
          ...Object.fromEntries(
            ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
              (verb) => [
                verb,
                sql.filter((q) => new RegExp('^' + verb + '\\b', 'i').test(q))
                  .length,
              ],
            ),
          ),
        }) +
        '\n',
    );
  }
}
beforeAll(async () => {
  process.env.IM_CALLBACK_SECRET = 'native-im-test-only-secret';
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({
    createServer: createStandaloneServer,
    server: { env: { HR_DEMO_SEED: 'false' } },
    config: {
      auth: { secret: randomBytes(32).toString('hex') },
      secrets: {
        keys: [{ version: 1, key: randomBytes(32).toString('base64') }],
      },
      i18n: { defaultLocale: 'en-US' },
    },
  });
  const login = await app.request('/auth/sign-in/username', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ username: 'nocobase', password: 'admin123' }),
  });
  if (login.status !== 200) throw new Error('Native fixture sign-in failed');
  const identity = (await login.json()) as { user: { id: string } };
  actor = await actorContext(identity.user.id);
  const stamp = { createdAt: new Date(), updatedAt: new Date() };
  await app.connection.repository('departments').createOne({
    values: {
      id: 'controlled-team',
      title: 'Controlled team',
      active: true,
      sortOrder: 0,
      ...stamp,
    },
  });
  await app.connection.repository('employees').createOne({
    values: {
      id: 'controlled-person',
      employeeNo: 'controlled-person',
      name: 'Controlled employee',
      userId: actor.user.id,
      departmentId: 'controlled-team',
      status: 'active',
      employmentType: 'fullTime',
      syncLocked: false,
      address: 'Original address',
      ...stamp,
    },
  });
  const services =
    app.application.container.resolve(agentsToken).models.services;
  const address = model.address();
  if (!address || typeof address === 'string') throw new Error('model address');
  await services.create({
    title: 'Controlled fixture',
    provider: 'openai-compatible',
    apiKey: 'synthetic-key',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: [{ value: 'fixture' }],
  });
}, 60_000);
afterAll(async () => {
  await app?.close();
  model.closeAllConnections();
  await new Promise<void>((resolve) => model.close(() => resolve()));
  loader.deregister();
  delete process.env.IM_CALLBACK_SECRET;
});

describe('native AI application composition', () => {
  it('owns new realtime history and restores it without another model call', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const session = await cost('create', () => online.realtime(actor));
    await cost('send', async () => {
      await session.send([{ role: 'user', content: 'Hello' }]);
      await Array.fromAsync(await session.receive());
    });
    const history = await cost('history', () => session.history());
    expect(JSON.stringify(history)).toContain('Native fixture reply');
    const before = calls;
    const reopened = await cost('reopen', () =>
      online.realtime(actor, {
        sessionId: session.sessionId,
      }),
    );
    expect(await reopened.history()).toEqual(history);
    expect(calls).toBe(before);
  });
  it('reads the signed-in employee through the native tool without exposing private profile fields', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const session = await online.realtime(actor);
    tool = { name: 'getMyHrProfile', args: '{}' };
    await session.send([{ role: 'user', content: 'Read my own HR profile.' }]);
    const stream = await session.receive();
    if (stream) await Array.fromAsync(stream);
    const history = await session.history();
    const part = history
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'tool-getMyHrProfile');
    expect(part).toMatchObject({
      state: 'output-available',
      output: {
        status: 'success',
        content: { linked: true, name: 'Controlled employee' },
      },
    });
    expect(JSON.stringify(history)).not.toContain('Original address');
  });
  it('generates a validated background draft and never treats text as a structured result', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    expect(
      (
        await cost('background-defaults', () =>
          app.application.container
            .resolve(agentsToken)
            .models.services.defaults(),
        )
      ).effectiveChat,
    ).toBeTruthy();
    const schema = z.object({
      summary: z.string(),
      items: z
        .array(
          z.object({
            type: z.enum(['course', 'learningPath', 'exam', 'practice']),
            refId: z.string(),
            competencyId: z.string(),
            reason: z.string().min(1),
            dueInDays: z.number(),
          }),
        )
        .min(1),
    });
    const draft = {
      summary: 'Controlled learning draft',
      items: [
        {
          type: 'course',
          refId: 'course',
          competencyId: 'competency',
          reason: 'Closes the measured gap',
          dueInDays: 14,
        },
      ],
    };
    text = JSON.stringify(draft);
    const result = await cost('background-success', () =>
      generateLearningPlan(online, actor, 'Draft a learning plan.', schema),
    );
    expect(requests.at(-1)?.tools ?? []).toHaveLength(0);
    expect(result.data).toEqual(draft);
    const reopened = await online.background(actor, {
      sessionId: result.sessionId,
    });
    expect(await reopened.get()).toEqual(result.data);
    text = 'Unstructured model reply';
    await expect(
      cost('background-invalid', () =>
        generateLearningPlan(online, actor, 'Draft a learning plan.', schema),
      ),
    ).rejects.toMatchObject({ code: 'OUTPUT_INVALID' });
  });
  it.each(['valid', 'invalid'] as const)(
    'uses the production learning connection from model selection to stored draft: %s',
    async (output) => {
      const db = app.connection;
      const container = app.application.container;
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      const suffix = 'learning-' + output;
      const owner = await container.resolve(userManagementServiceToken).create({
        name: 'Controlled learning manager',
        username: 'manager_' + output,
        email: 'manager_' + output + '@example.invalid',
        password: randomBytes(24).toString('hex'),
      });
      const authz = container.resolve(authorizationToken);
      await authz.permissionSets.create({
        key: suffix,
        grants: [
          learningCoachResource.reference().grant({
            use: {
              employees: 'talent.managedDepartments',
              learningPlans: 'allRecords',
            },
            configure: {
              aiAutomationSettings: 'allRecords',
              aiTaskRuns: 'allRecords',
              aiTaskRunItems: 'allRecords',
            },
          }),
        ],
      });
      await authz.permissionSets.assign({
        subject: { type: 'user', id: owner.id },
        permissionSet: suffix,
      });
      await db.repository('departments').createOne({
        values: {
          id: suffix,
          title: 'Controlled learning department',
          active: true,
          sortOrder: 0,
          managerId: owner.id,
          ...stamp,
        },
      });
      await db.repository('employees').createOne({
        values: {
          id: suffix + '-manager',
          employeeNo: suffix + '-manager',
          name: 'Controlled learning manager',
          userId: owner.id,
          departmentId: suffix,
          status: 'active',
          employmentType: 'fullTime',
          syncLocked: false,
          ...stamp,
        },
      });
      await db.repository('jobFamilies').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: 'Controlled family',
          active: true,
          sortOrder: 0,
          ...stamp,
        },
      });
      await db.repository('positions').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: 'Controlled position',
          jobFamilyId: suffix,
          departmentId: suffix,
          active: true,
          sortOrder: 0,
          isKey: false,
          ...stamp,
        },
      });
      await db.repository('competencies').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: 'Controlled skill',
          category: 'skill',
          maxLevel: 5,
          source: 'manual',
          reviewStatus: 'confirmed',
          active: true,
          ...stamp,
        },
      });
      await db.repository('positionRequirements').createOne({
        values: {
          id: suffix,
          positionId: suffix,
          competencyId: suffix,
          requiredLevel: 3,
          mandatory: true,
          source: 'manual',
          reviewStatus: 'confirmed',
          ...stamp,
        },
      });
      await db.repository('employees').createOne({
        values: {
          id: suffix,
          employeeNo: suffix,
          name: 'Controlled learner',
          departmentId: suffix,
          positionId: suffix,
          status: 'active',
          employmentType: 'fullTime',
          syncLocked: false,
          ...stamp,
        },
      });
      await db.repository('employees').createOne({
        values: {
          id: suffix + '-outside',
          employeeNo: suffix + '-outside',
          name: 'Out-of-scope controlled learner',
          departmentId: 'controlled-team',
          positionId: suffix,
          status: 'active',
          employmentType: 'fullTime',
          syncLocked: false,
          ...stamp,
        },
      });
      await db.repository('employeeCompetencies').createOne({
        values: {
          id: suffix + '-outside',
          employeeId: suffix + '-outside',
          competencyId: suffix,
          level: 1,
          source: 'manual',
          assessedBy: actor.user.id,
          assessedAt: new Date(),
          ...stamp,
        },
      });
      await db.repository('courses').createOne({
        values: {
          id: suffix,
          title: 'Controlled course',
          ownerUserId: actor.user.id,
          source: 'manual',
          reviewStatus: 'confirmed',
          published: true,
          active: true,
          deliveryMode: 'online',
          kind: 'course',
          version: 1,
          locale: 'en-US',
          ...stamp,
        },
      });
      await db.repository('courseCompetencies').createOne({
        values: {
          id: suffix,
          courseId: suffix,
          competencyId: suffix,
          ...stamp,
        },
      });
      const ctx = { userId: actor.user.id, authz: actor.authorization };
      await db.repository('employeeCompetencies').createOne({
        values: {
          id: suffix,
          employeeId: suffix,
          competencyId: suffix,
          level: 1,
          source: 'manual',
          assessedBy: owner.id,
          assessedAt: new Date(),
          ...stamp,
        },
      });
      await container
        .resolve(automationServiceToken)
        .update(ctx, 'learningCoach.gapPlans', {
          enabled: true,
          ownerUserId: owner.id,
        });
      const draft = {
        summary: 'Controlled native draft',
        items: [
          {
            type: 'course',
            refId: suffix,
            competencyId: suffix,
            reason: 'Closes the known gap',
            dueInDays: 14,
          },
        ],
      };
      text =
        output === 'valid'
          ? JSON.stringify(draft)
          : 'Unstructured native result';
      const online = container.resolve(agentsToken).onlineAgent;
      const originalBackground = online.background.bind(online);
      let sessionId: string | undefined;
      const background = vi
        .spyOn(online, 'background')
        .mockImplementation(async (...args) => {
          const session = await originalBackground(...args);
          sessionId = session.sessionId;
          return session;
        });
      const before = calls;
      const beforeAssignments = await db.repository('assignments').count();
      try {
        const result = await cost('learning-production-' + output, () =>
          container
            .resolve(automationTasksToken)
            .runScheduled('learningCoach.gapPlans', 'manual'),
        );
        expect(result.status).toBe('succeeded');
        expect(calls - before).toBe(1);
        expect(background).toHaveBeenCalledOnce();
        expect(background.mock.calls[0]?.[0].user.id).toBe(owner.id);
        expect(requests.at(-1)?.tools ?? []).toHaveLength(0);
        const plans = await db
          .repository('learningPlans')
          .findMany({ filter: { employeeId: suffix } });
        expect(plans).toHaveLength(1);
        expect(plans[0]?.summary).toEqual(
          output === 'valid'
            ? draft.summary
            : expect.stringContaining('Controlled learner'),
        );
        const items =
          typeof plans[0]?.items === 'string'
            ? JSON.parse(plans[0].items)
            : plans[0]?.items;
        expect(items).toMatchObject([
          { type: 'course', refId: suffix, competencyId: suffix },
        ]);
        expect(
          await db
            .repository('learningPlans')
            .count({ filter: { employeeId: suffix + '-outside' } }),
        ).toBe(0);
        expect(plans[0]).toMatchObject({
          status: 'draft',
          reviewerUserId: owner.id,
          source: 'ai',
        });
        expect(await db.repository('assignments').count()).toBe(
          beforeAssignments,
        );
        expect(
          await db
            .repository('assignments')
            .count({ filter: { employeeId: suffix } }),
        ).toBe(0);
        const run = await db
          .repository('aiTaskRuns')
          .findOne({ filter: { id: result.runId } });
        expect(run).toMatchObject({
          status: 'succeeded',
          fallback: output === 'invalid',
        });
        expect(run?.conversationSessionId).toBe(
          output === 'valid' ? sessionId : null,
        );
        const native = await container
          .resolve(agentsToken)
          .conversations.get(owner.id, sessionId!);
        expect(native.execution?.outcome).toBe(
          output === 'valid' ? 'completed' : 'failed',
        );
        expect(
          await db
            .repository('aiTaskRunItems')
            .count({ filter: { runId: result.runId } }),
        ).toBe(1);
      } finally {
        background.mockRestore();
      }
    },
  );
  it('rejects a different owner before replaying history or running a model', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const session = await online.realtime(actor);
    const before = calls;
    await expect(
      online.realtime(await actorContext('different-owner'), {
        sessionId: session.sessionId,
      }),
    ).rejects.toThrow();
    expect(calls).toBe(before);
  });
  it.each([true, false])(
    'binds native approval and does not repeat an approved business request (%s)',
    async (approved) => {
      text = 'The profile change has been considered.';
      const container = app.application.container;
      const original = container.resolve(hrCoreServiceToken);
      const operation = vi.spyOn(original, 'requestProfileChange');
      const beforeRequests = await app.connection
        .repository('profileChangeRequests')
        .count();
      try {
        const online = container.resolve(agentsToken).onlineAgent;
        const session = await online.realtime(actor);
        tool = {
          name: 'submitMyProfileChange',
          args: '{"changes":{"address":"Controlled address"}}',
        };
        await session.send([
          { role: 'user', content: 'Please request an address correction.' },
        ]);
        await Array.fromAsync((await session.receive())!);
        const history = await session.history();
        const message = history.at(-1)!;
        const part = message.parts.find(
          (p) => 'approval' in p && p.approval?.id,
        );
        if (
          !part ||
          !('approval' in part) ||
          !part.approval ||
          !message.metadata?.executionId
        )
          throw new Error('Missing native approval binding');
        expect(operation.mock.calls.length).toBe(0);
        const input = {
          messageId: message.id,
          executionId: message.metadata.executionId,
          approval: { id: part.approval.id, approved },
        };
        await expect(
          session.approve({ ...input, executionId: 'wrong-execution' }),
        ).rejects.toThrow();
        expect(operation.mock.calls.length).toBe(0);
        await cost(approved ? 'approval' : 'rejection', async () => {
          await session.approve(input);
          const stream = await session.receive();
          if (stream) await Array.fromAsync(stream);
        });
        expect(operation.mock.calls.length).toBe(approved ? 1 : 0);
        const before = calls;
        await expect(session.approve(input)).rejects.toThrow();
        expect(operation.mock.calls.length).toBe(approved ? 1 : 0);
        expect(calls).toBe(before);
        const reopened = await online.realtime(actor, {
          sessionId: session.sessionId,
        });
        expect(await reopened.history()).toEqual(await session.history());
        expect(calls).toBe(before);
        await reopened.send([
          {
            role: 'user',
            content: 'Follow up without repeating that request.',
          },
        ]);
        const followup = await reopened.receive();
        if (followup) await Array.fromAsync(followup);
        expect(operation.mock.calls.length).toBe(approved ? 1 : 0);
        expect(calls).toBe(before + 1);
        expect(
          await app.connection.repository('profileChangeRequests').count(),
        ).toBe(beforeRequests + (approved ? 1 : 0));
        if (approved) {
          expect(
            await app.connection
              .repository('profileChangeRequests')
              .findOne({ filter: { employeeId: 'controlled-person' } }),
          ).toMatchObject({ status: 'pending', source: 'assistant' });
        }
        expect(
          await app.connection
            .repository('employees')
            .findOne({ filter: { id: 'controlled-person' } }),
        ).toMatchObject({ address: 'Original address' });
      } finally {
        operation.mockRestore();
      }
    },
  );
  it('persists a failed native execution without replaying it on reopen', async () => {
    fail = true;
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const session = await online.realtime(actor);
    try {
      await cost('model-failure', async () => {
        await session.send([{ role: 'user', content: 'Controlled failure' }]);
        const stream = await session.receive();
        if (stream) await Array.fromAsync(stream);
      });
      expect(await session.status()).toBe('idle');
      const history = await session.history();
      const saved = await app.application.container
        .resolve(agentsToken)
        .conversations.get(actor.user.id, session.sessionId);
      expect(saved.execution).toMatchObject({
        status: 'idle',
        outcome: 'failed',
      });
      const before = calls;
      const reopened = await online.realtime(actor, {
        sessionId: session.sessionId,
      });
      expect(await reopened.history()).toEqual(history);
      expect(calls).toBe(before);
    } finally {
      fail = false;
    }
  });
  it('reauthorizes a pending tool after its business grant is revoked', async () => {
    const container = app.application.container;
    const authz = container.resolve(authorizationToken);
    const password = randomBytes(24).toString('hex');
    const user = await container.resolve(userManagementServiceToken).create({
      name: 'Controlled employee',
      username: 'controlled_employee',
      email: 'controlled@example.invalid',
      password,
    });
    expect((await app.request('/agents/services')).status).toBe(401);
    const login = await app.request('/auth/sign-in/username', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ username: 'controlled_employee', password }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(
      (await app.request('/agents/services', { headers: { cookie } })).status,
    ).toBe(403);
    await authz.permissionSets.create({
      key: 'controlled-native-ai',
      grants: [
        aiAssistantResource
          .reference()
          .grant({ use: { employees: 'allRecords' } }),
      ],
    });
    const assignment = await authz.permissionSets.assign({
      subject: { type: 'user', id: user.id },
      permissionSet: 'controlled-native-ai',
    });
    const core = container.resolve(hrCoreServiceToken);
    const operation = vi.spyOn(core, 'requestProfileChange');
    try {
      const online = container.resolve(agentsToken).onlineAgent;
      const session = await online.realtime(await actorContext(user.id));
      tool = {
        name: 'submitMyProfileChange',
        args: '{"changes":{"address":"Controlled address"}}',
      };
      await session.send([{ role: 'user', content: 'Request a correction' }]);
      await Array.fromAsync((await session.receive())!);
      const message = (await session.history()).at(-1)!;
      const part = message.parts.find((p) => 'approval' in p && p.approval?.id);
      if (
        !part ||
        !('approval' in part) ||
        !part.approval ||
        !message.metadata?.executionId
      )
        throw new Error('Missing approval');
      await authz.permissionSets.revoke(assignment.id);
      await cost('revoked-tool', async () => {
        await session.approve({
          messageId: message.id,
          executionId: message.metadata!.executionId!,
          approval: { id: part.approval!.id, approved: true },
        });
        const stream = await session.receive();
        if (stream) await Array.fromAsync(stream);
      });
      expect(operation).not.toHaveBeenCalled();
      expect(JSON.stringify(await session.history())).toContain('output-error');
    } finally {
      operation.mockRestore();
    }
  });
  it.each(
    (
      [
        'realtime-read',
        'background-read',
        'restored-read',
        'realtime-write',
        'restored-write',
      ] as const
    ).flatMap((path) =>
      [false, true].map((allowsUse) => ({ path, allowsUse })),
    ),
  )(
    'refuses restricted service credentials before rebuilding HR identity: $path / use=$allowsUse',
    async ({ path, allowsUse }) => {
      const container = app.application.container;
      const authorization = container.resolve(authorizationToken);
      const restricted = authorization.for({
        ...actor.authorization.identity,
        keyScope: {
          keyId: 'controlled-restricted-entry',
          allows: (resource, action) =>
            allowsUse &&
            resource.type === 'composite' &&
            resource.id === 'talent.aiAssistant' &&
            action === 'use',
          objects: () => [],
          permissions: allowsUse
            ? [
                {
                  resource: { type: 'composite', id: 'talent.aiAssistant' },
                  actions: ['use'],
                },
              ]
            : [],
        },
      });
      expect(
        (
          await restricted.authorize({
            resource: { type: 'composite', id: 'talent.aiAssistant' },
            action: 'use',
          })
        ).effect === 'deny',
      ).toBe(!allowsUse);
      const entry = { ...actor, authorization: restricted };
      const core = container.resolve(hrCoreServiceToken);
      const read = vi.spyOn(core, 'myHrProfile');
      const write = vi.spyOn(core, 'requestProfileChange');
      const subjects = vi.spyOn(authorization.subjects, 'resolveFor');
      const online = container.resolve(agentsToken).onlineAgent;
      const beforeRequests = await app.connection
        .repository('profileChangeRequests')
        .count();
      try {
        const reading = path.endsWith('read');
        tool = reading
          ? { name: 'getMyHrProfile', args: '{}' }
          : {
              name: 'submitMyProfileChange',
              args: '{"changes":{"address":"Restricted proposal"}}',
            };
        if (path === 'background-read') {
          const session = await online.background(entry);
          await cost('restricted-background-read', async () => {
            await session.run(
              [
                {
                  role: 'user',
                  content: 'Read through a restricted service entry',
                },
              ],
              {
                type: 'object',
                properties: { ok: { type: 'boolean' } },
                required: ['ok'],
                additionalProperties: false,
              },
            );
            await session.try({ wait: 1000 });
          });
          expect(JSON.stringify(await session.history())).not.toContain(
            'Controlled employee',
          );
        } else {
          let session = await online.realtime(
            path.startsWith('restored-') ? actor : entry,
          );
          if (path === 'restored-read')
            session = await online.realtime(entry, {
              sessionId: session.sessionId,
            });
          await cost(
            'restricted-' + path + '-request-use-' + allowsUse,
            async () => {
              await session.send([
                { role: 'user', content: 'Use this restricted service entry' },
              ]);
              const stream = await session.receive();
              if (stream) await Array.fromAsync(stream);
            },
          );
          if (!reading) {
            const message = (await session.history()).at(-1)!;
            const part = message.parts.find(
              (p) => 'approval' in p && p.approval?.id,
            );
            if (
              !part ||
              !('approval' in part) ||
              !part.approval ||
              !message.metadata?.executionId
            )
              throw new Error('Missing approval');
            if (path === 'restored-write')
              session = await online.realtime(entry, {
                sessionId: session.sessionId,
              });
            await cost('restricted-' + path, async () => {
              await session.approve({
                messageId: message.id,
                executionId: message.metadata!.executionId!,
                approval: { id: part.approval!.id, approved: true },
              });
              const stream = await session.receive();
              if (stream) await Array.fromAsync(stream);
            });
          }
          const history = JSON.stringify(await session.history());
          expect(history).not.toContain('Controlled employee');
          expect(history).toContain('output-error');
        }
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(subjects).not.toHaveBeenCalled();
        expect(
          await app.connection.repository('profileChangeRequests').count(),
        ).toBe(beforeRequests);
      } finally {
        read.mockRestore();
        write.mockRestore();
        subjects.mockRestore();
      }
    },
  );
  it('refuses restricted learning entry before model selection or native persistence', async () => {
    const authorization = app.application.container.resolve(authorizationToken);
    const restricted = authorization.for({
      ...actor.authorization.identity,
      keyScope: {
        keyId: 'controlled-restricted-learning',
        allows: () => false,
        objects: () => [],
        permissions: [],
      },
    });
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const background = vi.spyOn(online, 'background');
    try {
      await expect(
        cost('restricted-learning-entry', () =>
          generateLearningPlan(
            online,
            { ...actor, authorization: restricted },
            'Restricted learning data',
            z.object({ ok: z.boolean() }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(background).not.toHaveBeenCalled();
    } finally {
      background.mockRestore();
    }
  });
  it('never returns stored model credentials in service responses', async () => {
    const payload = JSON.stringify(
      await app.application.container
        .resolve(agentsToken)
        .models.services.list(),
    );
    expect(payload).not.toContain('synthetic-key');
    expect(payload).toContain('apiKeySet');
  });

  it('refuses restricted conflict entry before identity rebuilding or document reads', async () => {
    const container = app.application.container;
    const authorization = container.resolve(authorizationToken);
    const restricted = authorization.for({
      ...actor.authorization.identity,
      keyScope: {
        keyId: 'controlled-conflict',
        allows: () => true,
        objects: () => [],
        permissions: null,
      },
    });
    const subjects = vi.spyOn(authorization.subjects, 'resolveFor');
    const questionScope = vi.fn(async () => ({ docNos: [], categories: [] }));
    const structured = vi.fn(async () => {
      throw new Error('Must not generate');
    });
    const check = createConflictCheck({
      platform: container.resolve(platformToken),
      knowledge: () => container.resolve(knowledgeServiceToken),
      questionScope,
      structured,
      hrRecipients: async () => [],
    });
    try {
      await expect(
        cost('conflict-restricted-entry', () =>
          check(
            {
              runId: 'restricted-conflict',
              trigger: 'manual',
              owner: { userId: actor.user.id, authz: restricted },
              params: {},
              summarize() {},
              reference() {},
              usedConversation() {},
              markFallback() {},
              async recordItems() {},
            },
            'not-read',
          ),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(subjects).not.toHaveBeenCalled();
      expect(questionScope).not.toHaveBeenCalled();
      expect(structured).not.toHaveBeenCalled();
    } finally {
      subjects.mockRestore();
    }
  });
  it.each([
    'owner',
    'ancestor',
    'position',
    'qualification',
    'target-private',
    'candidate-private',
    'use-only',
    'view-only',
    'use-narrow',
    'view-narrow',
    'revoked-use',
    'revoked-view',
    'revoked-after-model',
    'no-candidates',
    'draft',
    'translation',
    'superseded',
    'source-excluded',
  ] as const)(
    'authorizes the production conflict model input: %s',
    async (mode) => {
      const container = app.application.container;
      const authz = container.resolve(authorizationToken);
      const suffix = 'conflict-' + mode;
      const user = await container.resolve(userManagementServiceToken).create({
        name: 'Controlled conflict owner',
        username: suffix.replaceAll('-', '_'),
        email: suffix + '@example.invalid',
        password: randomBytes(24).toString('hex'),
      });
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await app.connection.repository('departments').createMany({
        values: [
          {
            id: suffix + '-parent',
            title: 'Controlled parent',
            active: true,
            sortOrder: 0,
            ...stamp,
          },
          {
            id: suffix + '-child',
            title: 'Controlled child',
            parentId: suffix + '-parent',
            active: true,
            sortOrder: 0,
            ...stamp,
          },
        ],
      });
      await app.connection.repository('jobFamilies').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: suffix,
          active: true,
          sortOrder: 0,
          ...stamp,
        },
      });
      await app.connection.repository('positions').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: suffix,
          jobFamilyId: suffix,
          active: true,
          sortOrder: 0,
          isKey: false,
          ...stamp,
        },
      });
      await app.connection.repository('employees').createOne({
        values: {
          id: suffix,
          employeeNo: suffix,
          name: 'Controlled conflict owner',
          userId: user.id,
          departmentId: suffix + '-child',
          positionId: suffix,
          status: 'active',
          employmentType: 'fullTime',
          syncLocked: false,
          ...stamp,
        },
      });
      const rootCtx = { userId: actor.user.id, authz: actor.authorization };
      const examSettings = container.resolve(examSettingsToken);
      let priorLicensed:
        Awaited<ReturnType<typeof examSettings.get>> | undefined;
      if (mode === 'qualification') {
        priorLicensed = await examSettings.get(rootCtx);
        await examSettings.update(rootCtx, 'licensedOperation', {
          revision: priorLicensed.licensedOperation.revision,
          value: { enabled: true },
        });
        await app.connection.repository('certifications').createOne({
          values: {
            id: suffix,
            code: suffix,
            title: 'Controlled knowledge qualification',
            active: true,
            ...stamp,
          },
        });
        await app.connection.repository('employeeCertificates').createOne({
          values: {
            id: suffix,
            employeeId: suffix,
            certificationId: suffix,
            certificateNo: suffix,
            issuedAt: '2026-01-01',
            status: 'valid',
            source: 'internal',
            ...stamp,
          },
        });
        expect(
          await container
            .resolve(certificationServiceToken)
            .heldCertificationIds(user.id),
        ).toContain(suffix);
      }
      const useKey = suffix + '-use',
        viewKey = suffix + '-view';
      await authz.permissionSets.create({
        key: suffix + '-configure',
        grants: [
          knowledgeAssistantResource.reference().grant({
            configure: {
              aiAutomationSettings: 'allRecords',
              aiTaskRuns: 'allRecords',
              aiTaskRunItems: 'allRecords',
            },
          }),
        ],
      });
      await authz.permissionSets.assign({
        subject: { type: 'user', id: user.id },
        permissionSet: suffix + '-configure',
      });
      await authz.permissionSets.create({
        key: useKey,
        grants: [
          knowledgeAssistantResource.reference().grant({
            use: {
              kbDocuments:
                mode === 'view-narrow' ? 'allRecords' : VISIBLE_DOCUMENTS_SCOPE,
            },
          }),
        ],
      });
      await authz.permissionSets.create({
        key: viewKey,
        grants: [
          kbDocumentResource.reference().grant({
            view: {
              kbDocuments:
                mode === 'use-narrow' ? 'allRecords' : VISIBLE_DOCUMENTS_SCOPE,
            },
          }),
        ],
      });
      const subject =
        mode === 'qualification'
          ? { type: 'hr.certification', id: suffix }
          : { type: 'user', id: user.id };
      const use =
        mode !== 'view-only'
          ? await authz.permissionSets.assign({
              subject,
              permissionSet: useKey,
            })
          : undefined;
      const view =
        mode !== 'use-only'
          ? await authz.permissionSets.assign({
              subject,
              permissionSet: viewKey,
            })
          : undefined;
      const target = suffix + '-target',
        other = suffix + '-other',
        secret = suffix + '-secret';
      const permitted = ![
        'target-private',
        'candidate-private',
        'use-only',
        'view-only',
        'use-narrow',
        'view-narrow',
        'revoked-use',
        'revoked-view',
        'no-candidates',
        'draft',
        'translation',
        'superseded',
        'source-excluded',
      ].includes(mode);
      const shared = mode === 'ancestor' || mode === 'position';
      const ownTarget = mode !== 'target-private' && !shared;
      const ownOther =
        ![
          'candidate-private',
          'use-narrow',
          'view-narrow',
          'no-candidates',
        ].includes(mode) && !shared;
      for (const [id, amount, owner] of [
        [target, 40, ownTarget],
        [other, 50, ownOther],
        [secret, 90, false],
      ] as const) {
        await app.connection.repository('kbDocuments').createOne({
          values: {
            id,
            title: id,
            docNo: id,
            category: 'policy',
            fileId: 'controlled-not-opened',
            contentText:
              '# Night allowance\n员工夜班津贴为 ' + amount + ' 元。',
            parseStatus: 'ready',
            visibility: 'restricted',
            ownerUserId: owner ? user.id : actor.user.id,
            active: true,
            reviewStatus:
              mode === 'draft' && id === target ? 'draft' : 'confirmed',
            translationOfId:
              mode === 'translation' && id === target ? other : null,
            supersededById:
              mode === 'superseded' && id === target ? other : null,
            ...stamp,
          },
        });
      }
      if (shared)
        for (const id of [target, other]) {
          await app.connection
            .repository(
              mode === 'ancestor'
                ? 'kbDocumentDepartments'
                : 'kbDocumentPositions',
            )
            .createOne({
              values: {
                id,
                documentId: id,
                ...(mode === 'ancestor'
                  ? { departmentId: suffix + '-parent' }
                  : { positionId: suffix }),
                ...stamp,
              },
            });
        }
      await container
        .resolve(automationServiceToken)
        .update(rootCtx, 'knowledgeAssistant.conflictCheck', {
          enabled: true,
          ownerUserId: user.id,
        });
      text = JSON.stringify({
        pairs: [
          {
            index: 0,
            isConflict: true,
            description: 'Controlled authorized conflict',
          },
        ],
      });
      const entry = container.resolve(aiEntryServiceToken);
      const priorEntry = await entry.get(rootCtx);
      await entry.update(rootCtx, {
        revision: priorEntry.revision,
        value: {
          ...priorEntry.value,
          knowledgeScopes: {
            ...priorEntry.value.knowledgeScopes,
            knowledgeAssistant: {
              docNos:
                mode === 'source-excluded'
                  ? [other, secret]
                  : [target, other, secret],
              categories: [],
            },
          },
        },
      });
      const originalScope = entry.scopeFor.bind(entry);
      let scopeCalls = 0;
      const scope = vi
        .spyOn(entry, 'scopeFor')
        .mockImplementation(async (employee) => {
          if (
            employee === 'knowledgeAssistant' &&
            ++scopeCalls === 2 &&
            ['revoked-use', 'revoked-view'].includes(mode)
          )
            await authz.permissionSets.revoke(
              mode === 'revoked-use' ? use!.id : view!.id,
            );
          return originalScope(employee);
        });
      if (mode === 'revoked-after-model')
        beforeModelReply = async () => {
          beforeModelReply = undefined;
          await authz.permissionSets.revoke(view!.id);
        };
      const before = calls,
        requestStart = requests.length;
      const fullTextReads: string[] = [];
      const client = await app.connection.client<{
        on(
          event: string,
          cb: (value: unknown, q: { sql: string }) => void,
        ): void;
        removeListener(
          event: string,
          cb: (value: unknown, q: { sql: string }) => void,
        ): void;
      }>();
      const observe = (value: unknown, q: { sql: string }) => {
        if (/select/i.test(q.sql) && /kb_documents/i.test(q.sql)) {
          const rows = Array.isArray(value) ? value : [value];
          for (const row of rows)
            if (
              row &&
              typeof row === 'object' &&
              ('contentText' in row || 'content_text' in row)
            )
              fullTextReads.push(String((row as { id: unknown }).id));
        }
      };
      client.on('query-response', observe);
      try {
        const result = await cost('conflict-production-' + mode, () =>
          container
            .resolve(automationTasksToken)
            .onDocumentReadyForConflicts(target),
        );
        const sent = JSON.stringify(requests.slice(requestStart));
        process.stdout.write(
          'CONFLICT_INPUT ' +
            JSON.stringify({
              mode,
              fullTextReads,
              modelRequests: calls - before,
              sent40: sent.includes('40 元'),
              sent50: sent.includes('50 元'),
              sent90: sent.includes('90 元'),
            }) +
            '\n',
        );
        expect(fullTextReads).not.toContain(secret);
        const denied = [
          'use-only',
          'view-only',
          'revoked-use',
          'revoked-view',
          'revoked-after-model',
        ].includes(mode);
        expect(result.status).toBe(
          denied ? 'failed' : permitted ? 'succeeded' : 'skipped',
        );
        if (
          [
            'target-private',
            'draft',
            'translation',
            'superseded',
            'source-excluded',
          ].includes(mode)
        )
          expect(fullTextReads).not.toContain(target);
        if (
          [
            'candidate-private',
            'use-narrow',
            'view-narrow',
            'no-candidates',
          ].includes(mode)
        )
          expect(fullTextReads).not.toContain(other);
        expect(calls - before).toBe(permitted ? 1 : 0);
        expect(sent).not.toContain('90 元');
        if (!permitted) expect(requests.slice(requestStart)).toHaveLength(0);
        const recorded = await app.connection
          .repository('documentConflicts')
          .findMany({ filter: { documentId: target } });
        expect(recorded).toHaveLength(
          permitted && mode !== 'revoked-after-model' ? 1 : 0,
        );
        if (permitted && mode !== 'revoked-after-model') {
          expect(result.status).toBe('succeeded');
          expect(sent).toContain('40 元');
          expect(sent).toContain('50 元');
          expect(recorded[0]).toMatchObject({
            otherDocumentId: other,
            status: 'open',
            source: 'ai',
          });
        }
      } finally {
        beforeModelReply = undefined;
        client.removeListener('query-response', observe);
        scope.mockRestore();
        const currentEntry = await entry.get(rootCtx);
        await entry.update(rootCtx, {
          revision: currentEntry.revision,
          value: priorEntry.value,
        });
        if (priorLicensed) {
          const now = await examSettings.get(rootCtx);
          await examSettings.update(rootCtx, 'licensedOperation', {
            revision: now.licensedOperation.revision,
            value: priorLicensed.licensedOperation.value,
          });
        }
      }
    },
  );

  it.each([
    'valid',
    'no-model',
    'invalid',
    'model-failure',
    'timeout',
  ] as const)(
    'uses the production ordinary task connection with native output: %s',
    async (outcome) => {
      const container = app.application.container;
      const ctx = { userId: actor.user.id, authz: actor.authorization };
      await container
        .resolve(automationServiceToken)
        .update(ctx, 'frameworkAdvisor.dictionaryReview', {
          enabled: true,
          ownerUserId: actor.user.id,
        });
      // An ungraded position guarantees a review candidate, independently of demo content.
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      const suffix = 'native-dictionary-' + outcome;
      await app.connection.repository('jobFamilies').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: 'Controlled review family',
          active: true,
          sortOrder: 0,
          ...stamp,
        },
      });
      await app.connection.repository('positions').createOne({
        values: {
          id: suffix,
          code: suffix,
          title: 'Controlled review position',
          jobFamilyId: suffix,
          active: true,
          sortOrder: 0,
          isKey: false,
          ...stamp,
        },
      });
      const position = await app.connection
        .repository('positions')
        .findOne({ filter: { id: suffix } });
      const services = container.resolve(agentsToken).models.services;
      const service = (await services.list())[0]!;
      text =
        outcome === 'valid'
          ? JSON.stringify({
              suggestions: [
                {
                  kind: 'position',
                  competencies: ['Controlled review position'],
                  suggestion: 'Ask its owner to review the grade',
                  reason: 'The grade is empty',
                },
              ],
            })
          : 'Invalid ordinary background output';
      if (outcome === 'no-model')
        await services.update(service.name, { enabled: false });
      fail = outcome === 'model-failure';
      hold = outcome === 'timeout';
      const opened = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      if (hold) heldStream = { opened: opened.resolve, closed: closed.resolve };
      const before = calls;
      const native = container.resolve(agentsToken).onlineAgent;
      const original = native.background.bind(native);
      let sessionId: string | undefined;
      let active: Awaited<ReturnType<typeof original>> | undefined;
      const background = vi
        .spyOn(native, 'background')
        .mockImplementation(async (...args) => {
          const session = await original(...args);
          sessionId = session.sessionId;
          active = session;
          if (outcome === 'timeout') {
            const observe = session.try.bind(session);
            vi.spyOn(session, 'try').mockImplementation((options) => {
              // Keep production composition and its 120 s default; shorten only
              // the official observation budget instead of waiting two minutes.
              expect(options?.wait).toBeGreaterThan(110_000);
              return observe({ wait: 300 });
            });
          }
          return session;
        });
      let finished = false;
      const pending = cost('ordinary-production-' + outcome, () =>
        container
          .resolve(automationTasksToken)
          .runScheduled('frameworkAdvisor.dictionaryReview', 'manual'),
      ).finally(() => {
        finished = true;
      });
      try {
        if (outcome === 'timeout') {
          await opened.promise;
          await vi.waitFor(() => expect(finished).toBe(true), {
            timeout: 2000,
          });
          await closed.promise;
          expect(await active!.status()).toBe('idle');
        }
        const result = await pending;
        expect(calls - before).toBe(outcome === 'no-model' ? 0 : 1);
        expect(result.status).toBe(
          outcome === 'model-failure' || outcome === 'timeout'
            ? 'failed'
            : 'succeeded',
        );
        const run = await app.connection
          .repository('aiTaskRuns')
          .findOne({ filter: { id: result.runId } });
        expect(run?.fallback).toBe(
          outcome === 'no-model' || outcome === 'invalid',
        );
        expect(run?.conversationSessionId).toBe(
          outcome === 'valid' ? sessionId : null,
        );
        if (outcome === 'timeout') {
          expect(run?.error).toBe('The operation timed out');
          expect(run?.finishedAt).toBeTruthy();
        }
        if (outcome === 'valid') {
          expect(JSON.stringify(run?.output)).toContain('Ask its owner');
          expect(requests.at(-1)?.tools ?? []).toHaveLength(0);
        }
        if (sessionId) {
          const saved = await container
            .resolve(agentsToken)
            .conversations.get(actor.user.id, sessionId);
          expect(saved.execution?.outcome).toBe(
            outcome === 'valid'
              ? 'completed'
              : outcome === 'timeout'
                ? 'cancelled'
                : 'failed',
          );
        }
        expect(
          await app.connection
            .repository('positions')
            .findOne({ filter: { id: suffix } }),
        ).toEqual(position);
      } finally {
        fail = false;
        hold = false;
        if (!finished) await active?.abort();
        await pending;
        heldStream = undefined;
        background.mockRestore();
        if (outcome === 'no-model')
          await services.update(service.name, { enabled: true });
      }
    },
  );
  it('refuses an ordinary production task after its owner loses the business grant', async () => {
    const container = app.application.container;
    const authz = container.resolve(authorizationToken);
    const user = await container.resolve(userManagementServiceToken).create({
      name: 'Controlled task owner',
      username: 'ordinary_owner',
      email: 'ordinary_owner@example.invalid',
      password: randomBytes(24).toString('hex'),
    });
    await app.connection.repository('employees').createOne({
      values: {
        id: 'ordinary-owner',
        employeeNo: 'ordinary-owner',
        name: 'Controlled task owner',
        userId: user.id,
        departmentId: 'controlled-team',
        status: 'active',
        employmentType: 'fullTime',
        syncLocked: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await authz.permissionSets.create({
      key: 'ordinary-owner',
      grants: [
        frameworkAdvisorResource.reference().grant({
          use: { positions: 'allRecords', competencies: 'allRecords' },
          configure: {
            aiAutomationSettings: 'allRecords',
            aiTaskRuns: 'allRecords',
            aiTaskRunItems: 'allRecords',
          },
        }),
      ],
    });
    const assignment = await authz.permissionSets.assign({
      subject: { type: 'user', id: user.id },
      permissionSet: 'ordinary-owner',
    });
    const automation = container.resolve(automationServiceToken);
    const root = { userId: actor.user.id, authz: actor.authorization };
    await automation.update(root, 'frameworkAdvisor.dictionaryReview', {
      enabled: true,
      ownerUserId: user.id,
    });
    await authz.permissionSets.revoke(assignment.id);
    const before = calls;
    try {
      const result = await cost('ordinary-production-revoked', () =>
        container
          .resolve(automationTasksToken)
          .runScheduled('frameworkAdvisor.dictionaryReview', 'manual'),
      );
      expect(result.status).toBe('failed');
      expect(calls).toBe(before);
      const run = await app.connection
        .repository('aiTaskRuns')
        .findOne({ filter: { id: result.runId } });
      expect(run?.conversationSessionId).toBeNull();
      expect(run?.fallback).toBe(false);
    } finally {
      await automation.update(root, 'frameworkAdvisor.dictionaryReview', {
        ownerUserId: actor.user.id,
      });
    }
  });
  it.each(['checklist', 'observation', 'translation'] as const)(
    'refuses a restricted request before dispatching work as a stored owner: %s',
    async (path) => {
      const container = app.application.container;
      const authorization = container.resolve(authorizationToken).for({
        ...actor.authorization.identity,
        keyScope: {
          keyId: 'controlled-dispatch',
          allows: () => true,
          objects: () => [],
          permissions: null,
        },
      });
      const ctx = { userId: actor.user.id, authz: authorization };
      const service = container.resolve(talentReviewServicesToken);
      await expect(
        cost('restricted-dispatch-' + path, () =>
          path === 'checklist'
            ? service.draftChecklist(ctx, {})
            : path === 'observation'
              ? service.structureRecord(ctx, 'unknown')
              : service.translations.request(ctx, 'course', 'unknown'),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    },
  );
  it.each([
    'success',
    'empty',
    'invalid',
    'provider-failure',
    'unavailable',
  ] as const)(
    'preserves weekly brief facts and rule fallback through the actual native connection: %s',
    async (kind) => {
      const container = app.application.container;
      const platform = container.resolve(platformToken);
      const insights = container.resolve(insightServiceToken);
      const licensed = container.resolve(licensedServicesToken);
      const owner = await container.resolve(userManagementServiceToken).create({
        name: 'Controlled brief owner',
        username: 'brief_' + kind.replaceAll('-', '_'),
        email: 'brief_' + kind + '@example.invalid',
        password: randomBytes(24).toString('hex'),
      });
      await app.connection.repository('departments').createOne({
        values: {
          id: 'brief-' + kind,
          title: 'Controlled brief team',
          managerId: owner.id,
          active: true,
          sortOrder: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const facts = {
        newThisWeek: ['Synthetic member'],
        expiringSoon: [],
        expired: [],
        missing: [],
      };
      // Same business-facts boundary as the former isolated brief test, now with real native SDK/persistence.
      const weekly = vi
        .spyOn(insights, 'weeklyFacts')
        .mockImplementation(async (ctx) =>
          ctx.userId === owner.id ? facts : (undefined as never),
        );
      const lost = vi.spyOn(licensed, 'lostThisWeek').mockResolvedValue([]);
      const notify = vi.spyOn(platform, 'notify');
      const services = container.resolve(agentsToken).models.services;
      const service = (await services.list())[0]!;
      text = JSON.stringify(
        kind === 'success'
          ? { brief: 'A'.repeat(240) }
          : kind === 'empty'
            ? { brief: '  ' }
            : { wrong: true },
      );
      fail = kind === 'provider-failure';
      if (kind === 'unavailable')
        await services.update(service.name, { enabled: false });
      const before = calls;
      try {
        const result = await cost('weekly-native-' + kind, () =>
          runWeeklyBriefs(container, 'UTC'),
        );
        expect(result).toMatchObject({ sent: 1, fallback: kind !== 'success' });
        expect(calls - before).toBe(kind === 'unavailable' ? 0 : 1);
        expect(
          weekly.mock.calls.filter(([ctx]) => ctx.userId === owner.id),
        ).toHaveLength(1);
        const notification = notify.mock.calls.find(
          ([input]) => input.message === 'weeklyBrief',
        )?.[0];
        expect(notification).toMatchObject({
          userIds: [owner.id],
          params: {
            brief:
              kind === 'success'
                ? 'A'.repeat(200)
                : '本周新增持证 1 人：Synthetic member',
          },
        });
        if (kind !== 'unavailable')
          expect(JSON.stringify(requests.at(-1)?.messages)).toContain(
            'Synthetic member',
          );
        if (kind !== 'unavailable')
          expect(requests.at(-1)?.tools ?? []).toHaveLength(0);
      } finally {
        fail = false;
        weekly.mockRestore();
        lost.mockRestore();
        notify.mockRestore();
        if (kind === 'unavailable')
          await services.update(service.name, { enabled: true });
        await app.connection
          .repository('departments')
          .deleteOne({ filter: { id: 'brief-' + kind } });
      }
    },
  );
  it('rejects a scope-bearing ordinary generation entry before any model probe or persistence', async () => {
    const container = app.application.container;
    const authorization = container.resolve(authorizationToken).for({
      ...actor.authorization.identity,
      keyScope: {
        keyId: 'controlled-background-scope',
        allows: () => true,
        objects: () => [],
        permissions: null,
      },
    });
    const defaults = vi.spyOn(
      container.resolve(agentsToken).models.services,
      'defaults',
    );
    try {
      await expect(
        cost('ordinary-restricted-entry', () =>
          createNativeStructuredAI(container).structured({
            userId: actor.user.id,
            authorization,
            employee: 'frameworkAdvisor',
            title: 'Controlled background',
            prompt: 'No HR data',
            schema: z.object({ ok: z.boolean() }),
            timeZone: 'UTC',
          }),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect(defaults).not.toHaveBeenCalled();
    } finally {
      defaults.mockRestore();
    }
  });
  it.each(['valid', 'invalid', 'restricted', 'revoked'] as const)(
    'uses the native settings tool without automatically applying configuration: %s',
    async (outcome) => {
      const container = app.application.container;
      const authz = container.resolve(authorizationToken);
      let entry = actor;
      if (outcome === 'restricted')
        entry = {
          ...actor,
          authorization: authz.for({
            ...actor.authorization.identity,
            keyScope: {
              keyId: 'controlled-settings-scope',
              allows: () => true,
              objects: () => [],
              permissions: null,
            },
          }),
        };
      if (outcome === 'revoked') {
        const user = await container
          .resolve(userManagementServiceToken)
          .create({
            name: 'Controlled settings administrator',
            username: 'native_settings',
            email: 'native_settings@example.invalid',
            password: randomBytes(24).toString('hex'),
          });
        await authz.permissionSets.create({
          key: 'native-settings-tool',
          grants: [authz.settings.grant('talent.hr', ['administer'])],
        });
        await authz.permissionSets.create({
          key: 'native-settings-entry',
          grants: [
            aiAssistantResource
              .reference()
              .grant({ use: { employees: 'allRecords' } }),
          ],
        });
        await authz.permissionSets.assign({
          subject: { type: 'user', id: user.id },
          permissionSet: 'native-settings-entry',
        });
        const assignment = await authz.permissionSets.assign({
          subject: { type: 'user', id: user.id },
          permissionSet: 'native-settings-tool',
        });
        entry = await actorContext(user.id);
        // The admitted actor still has its original subjects; tool execution must refresh them.
        await entry.authorization.require({
          resource: { type: 'settings', id: 'talent.hr' },
          action: 'administer',
        });
        await authz.permissionSets.revoke(assignment.id);
        const fresh = await actorContext(user.id);
        const decision = await fresh.authorization.authorize({
          resource: { type: 'composite', id: 'talent.aiAssistant' },
          action: 'use',
        });
        expect(decision.effect).not.toBe('deny');
        expect(decision.conditions).toHaveProperty('database.employees');
      }
      const settings = container.resolve(personnelSettingsToken);
      const drafts = container.resolve(settingsDraftServiceToken);
      const beforeSettings = await settings.read('reminders');
      const beforeRows = await app.connection
        .repository('settingsChangeLog')
        .count();
      const apply = vi.spyOn(settings, 'update');
      const draft = vi.spyOn(drafts, 'draft');
      tool = {
        name: 'draftSettingsChange',
        args: JSON.stringify({
          utterance: 'Controlled reminder proposal',
          items: [
            {
              type: 'setting',
              section: outcome === 'invalid' ? 'salary' : 'reminders',
              changes: { probationDays: 17 },
            },
          ],
        }),
      };
      try {
        const session = await container
          .resolve(agentsToken)
          .onlineAgent.realtime(entry);
        await cost('settings-native-' + outcome, async () => {
          await session.send([
            {
              role: 'user',
              content: 'Draft a reminder change. Keep it pending my review.',
            },
          ]);
          const stream = await session.receive();
          if (stream) await Array.fromAsync(stream);
        });
        expect(apply).not.toHaveBeenCalled();
        expect(await settings.read('reminders')).toEqual(beforeSettings);
        expect(
          await app.connection.repository('settingsChangeLog').count(),
        ).toBe(beforeRows + (outcome === 'valid' ? 1 : 0));
        expect(draft).toHaveBeenCalledTimes(
          outcome === 'valid' || outcome === 'revoked' ? 1 : 0,
        );
        const history = JSON.stringify(await session.history());
        if (outcome === 'invalid') {
          // SDK input validation rejects malformed arguments before the adapter. Public history omits that invalid tool part.
          expect(history).not.toContain('/settings/personnel');
          expect(history).not.toContain('output-available');
        } else
          expect(history).toContain(
            outcome === 'valid' ? '/settings/personnel' : 'output-error',
          );
        if (outcome === 'valid') {
          const changes = await drafts.list({
            authz: actor.authorization,
            userId: actor.user.id,
          });
          expect(changes[0]).toMatchObject({
            status: 'draft',
            items: [{ status: 'draft' }],
          });
        }
      } finally {
        apply.mockRestore();
        draft.mockRestore();
      }
    },
  );
  it.each(['deadline', 'caller'] as const)(
    'finalizes a stalled ordinary generation before rejecting: %s',
    async (kind) => {
      const online = app.application.container.resolve(agentsToken).onlineAgent;
      const original = online.background.bind(online);
      let active: Awaited<ReturnType<typeof original>> | undefined;
      const background = vi
        .spyOn(online, 'background')
        .mockImplementation(async (...args) => {
          active = await original(...args);
          return active;
        });
      const opened = Promise.withResolvers<void>();
      const closed = Promise.withResolvers<void>();
      heldStream = { opened: opened.resolve, closed: closed.resolve };
      hold = true;
      text = '{"ok":true}';
      const controller = new AbortController();
      const reason = new Error('Controlled caller cancellation');
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      let finished = false;
      let rejection: unknown;
      const before = calls;
      const pending = cost('ordinary-stalled-' + kind, () =>
        createNativeStructuredAI(app.application.container).structured({
          employee: 'controlled',
          userId: actor.user.id,
          authorization: actor.authorization,
          title: 'Stalled generation',
          prompt: 'Return JSON',
          schema: z.object({ ok: z.boolean() }),
          timeZone: 'UTC',
          timeoutMs: kind === 'deadline' ? 500 : 120_000,
          signal: controller.signal,
        }),
      ).then(
        () => {
          finished = true;
        },
        (error: unknown) => {
          rejection = error;
          finished = true;
        },
      );
      try {
        await opened.promise;
        if (kind === 'caller') controller.abort(reason);
        await vi.waitFor(() => expect(finished).toBe(true), { timeout: 2000 });
        await closed.promise;
        if (kind === 'caller') expect(rejection).toBe(reason);
        else expect(rejection).toMatchObject({ name: 'TimeoutError' });
        expect(await active!.status()).toBe('idle');
        const saved = await app.application.container
          .resolve(agentsToken)
          .conversations.get(actor.user.id, active!.sessionId);
        expect(saved.execution?.outcome).toBe('cancelled');
        expect(calls - before).toBe(1);
        expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
      } finally {
        hold = false;
        if (!finished) await active?.abort();
        await pending;
        heldStream = undefined;
        background.mockRestore();
        add.mockRestore();
        remove.mockRestore();
      }
    },
  );
  it('preserves a native model failure when caller cancellation arrives with its outcome', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const original = online.background.bind(online);
    const controller = new AbortController();
    const reason = new Error('Cancellation after model failure');
    const background = vi
      .spyOn(online, 'background')
      .mockImplementation(async (...args) => {
        const session = await original(...args);
        const observe = session.try.bind(session);
        vi.spyOn(session, 'try').mockImplementation(async (options) => {
          const result = await observe(options);
          controller.abort(reason);
          return result;
        });
        return session;
      });
    fail = true;
    try {
      await expect(
        createNativeStructuredAI(app.application.container).structured({
          employee: 'controlled',
          userId: actor.user.id,
          authorization: actor.authorization,
          title: 'Failing generation',
          prompt: 'Return JSON',
          schema: z.object({ ok: z.boolean() }),
          timeZone: 'UTC',
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ reason: 'failed', code: 'EXECUTION_FAILED' });
    } finally {
      fail = false;
      background.mockRestore();
    }
  });
  it('rejects an already cancelled ordinary call before model probing or storage', async () => {
    const controller = new AbortController();
    const reason = new Error('Cancelled before generation');
    controller.abort(reason);
    await expect(
      cost('ordinary-pre-cancelled', () =>
        createNativeStructuredAI(app.application.container).structured({
          employee: 'controlled',
          userId: actor.user.id,
          authorization: actor.authorization,
          title: 'Cancelled generation',
          prompt: 'Return JSON',
          schema: z.object({ ok: z.boolean() }),
          timeZone: 'UTC',
          signal: controller.signal,
        }),
      ),
    ).rejects.toBe(reason);
  });
  it('releases ordinary wait listeners and keeps completed output after the deadline and later cancellation', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const original = online.background.bind(online);
    let active: Awaited<ReturnType<typeof original>> | undefined;
    let abort: ReturnType<typeof vi.spyOn> | undefined;
    const background = vi
      .spyOn(online, 'background')
      .mockImplementation(async (...args) => {
        active = await original(...args);
        abort = vi.spyOn(active, 'abort');
        return active;
      });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    text = '{"ok":true}';
    try {
      const result = await createNativeStructuredAI(
        app.application.container,
      ).structured({
        employee: 'controlled',
        userId: actor.user.id,
        authorization: actor.authorization,
        title: 'Completed generation',
        prompt: 'Return JSON',
        schema: z.object({ ok: z.boolean() }),
        timeZone: 'UTC',
        timeoutMs: 300,
        signal: controller.signal,
      });
      expect(result.data).toEqual({ ok: true });
      const history = await active!.history();
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
      await new Promise((resolve) => setTimeout(resolve, 350));
      controller.abort(new Error('Late cancellation'));
      expect(abort).not.toHaveBeenCalled();
      expect(await active!.status()).toBe('idle');
      expect(await active!.history()).toEqual(history);
    } finally {
      abort?.mockRestore();
      background.mockRestore();
      add.mockRestore();
      remove.mockRestore();
    }
  });
  it.each([
    'valid',
    'no-model',
    'invalid',
    'model-failure',
    'restricted',
    'revoked',
    'audience',
  ] as const)(
    'routes through the production native classifier: %s',
    async (outcome) => {
      const container = app.application.container;
      const entry = container.resolve(aiEntryServiceToken);
      let ctx = { userId: actor.user.id, authz: actor.authorization };
      if (outcome === 'restricted') {
        ctx = {
          ...ctx,
          authz: container.resolve(authorizationToken).for({
            ...actor.authorization.identity,
            keyScope: {
              keyId: 'restricted-route',
              allows: () => true,
              objects: () => [],
              permissions: [],
            },
          }),
        };
      }
      if (outcome === 'revoked' || outcome === 'audience') {
        const user = await container
          .resolve(userManagementServiceToken)
          .create({
            name: 'Controlled routing user',
            username: 'route_' + outcome,
            email: 'route_' + outcome + '@example.invalid',
            password: randomBytes(24).toString('hex'),
          });
        const authz = container.resolve(authorizationToken);
        await authz.permissionSets.create({
          key: 'routing-' + outcome,
          grants: [
            aiAssistantResource
              .reference()
              .grant({ use: { employees: 'allRecords' } }),
          ],
        });
        const assignment = await authz.permissionSets.assign({
          subject: { type: 'user', id: user.id },
          permissionSet: 'routing-' + outcome,
        });
        if (outcome === 'revoked')
          await authz.permissionSets.revoke(assignment.id);
        ctx = {
          userId: user.id,
          authz: (await actorContext(user.id)).authorization,
        };
      }
      const services = container.resolve(agentsToken).models.services;
      const modelService = (await services.list())[0]!;
      text =
        outcome === 'valid'
          ? '{"key":"myRecord"}'
          : outcome === 'audience'
            ? '{"key":"hrData"}'
            : 'myRecord';
      fail = outcome === 'model-failure';
      if (outcome === 'no-model')
        await services.update(modelService.name, { enabled: false });
      const before = calls;
      try {
        const pending = cost('native-route-' + outcome, () =>
          entry.route(ctx, '我的住址需要核对'),
        );
        if (outcome === 'restricted' || outcome === 'revoked') {
          await expect(pending).rejects.toMatchObject({ status: 403 });
          expect(calls).toBe(before);
        } else if (outcome === 'model-failure') {
          await expect(pending).rejects.toMatchObject({
            code: 'EXECUTION_FAILED',
          });
        } else {
          expect(await pending).toMatchObject({
            key: 'myRecord',
            method: outcome === 'valid' ? 'model' : 'keywords',
          });
          expect(calls - before).toBe(outcome === 'no-model' ? 0 : 1);
          expect(requests.at(-1)?.tools ?? []).toHaveLength(0);
          if (outcome === 'audience')
            expect(JSON.stringify(requests.at(-1)?.messages)).not.toContain(
              'hrData',
            );
        }
      } finally {
        fail = false;
        if (outcome === 'no-model')
          await services.update(modelService.name, { enabled: true });
      }
    },
  );
  it.each([
    'valid',
    'no-model',
    'invalid',
    'model-failure',
    'revoked',
    'timeout-after-write',
    'cancel-after-write',
  ] as const)(
    'uses the production native vendor-bill tool connection: %s',
    async (outcome) => {
      const container = app.application.container;
      const authz = container.resolve(authorizationToken);
      const user = await container.resolve(userManagementServiceToken).create({
        name: 'Controlled bill owner',
        username: 'bill_' + outcome.replaceAll('-', '_'),
        email: 'bill_' + outcome + '@example.invalid',
        password: randomBytes(24).toString('hex'),
      });
      const key = 'native-bill-' + outcome;
      await app.connection.repository('employees').createOne({
        values: {
          id: key,
          employeeNo: key,
          name: 'Controlled bill owner',
          userId: user.id,
          departmentId: 'controlled-team',
          status: 'active',
          employmentType: 'fullTime',
          syncLocked: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await authz.permissionSets.create({
        key,
        grants: [
          vendorBillResource.reference().grant({
            view: { laborVendorBills: 'allRecords' },
            upload: {
              laborVendorBills: 'allRecords',
              employees: 'allRecords',
              attendanceMonthlySummaries: 'allRecords',
            },
          }),
          payrollSettingsResource
            .reference()
            .grant({ configure: { salaryStructures: 'allRecords' } }),
        ],
      });
      const assignment = await authz.permissionSets.assign({
        subject: { type: 'user', id: user.id },
        permissionSet: key,
      });
      const root = { userId: actor.user.id, authz: actor.authorization };
      await container
        .resolve(automationServiceToken)
        .update(root, 'vendorReconciler.billReview', {
          enabled: true,
          ownerUserId: user.id,
        });
      // Retained setting is only the opt-in; no old employee/model configuration is loaded.
      const settingsRow = await app.connection
        .repository('personnelSettings')
        .findOne({ filter: { id: 'payroll.settings' } });
      if (!settingsRow) throw new Error('Missing payroll settings');
      let settings: unknown = settingsRow.value;
      while (typeof settings === 'string') settings = JSON.parse(settings);
      const value = settings as { vendorBill: { aiEmployee: string | null } };
      await app.connection.repository('personnelSettings').updateOne({
        filter: { id: 'payroll.settings' },
        values: {
          value: {
            ...value,
            vendorBill: {
              ...value.vendorBill,
              aiEmployee: 'retained-opt-in',
            },
          },
        },
      });
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      await app.connection.repository('laborVendorBills').createOne({
        values: {
          id: key,
          vendorName: key,
          month: '2026-10',
          fileId: 'synthetic-file',
          status: 'uploaded',
          lines: [
            {
              row: 1,
              employeeNo: 'controlled-person',
              name: 'Controlled employee',
              billedHours: 40,
              amount: 987654,
            },
          ],
          reconciliation: [
            {
              employeeId: 'controlled-person',
              employeeNo: 'controlled-person',
              name: 'Controlled employee',
              billedHours: 40,
              attendanceHours: 32,
              diffHours: 8,
              reason: 'diff',
            },
          ],
          ...stamp,
        },
      });
      const payroll = container.resolve(payrollServicesToken);
      const write = vi.spyOn(payroll.bills, 'saveNotes');
      const online = container.resolve(agentsToken).onlineAgent;
      const original = online.background.bind(online);
      let active: Awaited<ReturnType<typeof original>> | undefined;
      const background = vi
        .spyOn(online, 'background')
        .mockImplementation(async (...args) => {
          active = await original(...args);
          if (outcome === 'timeout-after-write') {
            const observe = active.try.bind(active);
            vi.spyOn(active, 'try').mockImplementation((options) => {
              expect(options?.wait).toBeGreaterThan(110_000);
              return observe({ wait: 500 });
            });
          }
          return active;
        });
      const services = container.resolve(agentsToken).models.services;
      const modelService = (await services.list())[0]!;
      if (outcome === 'no-model')
        await services.update(modelService.name, { enabled: false });
      fail = outcome === 'model-failure';
      text =
        outcome === 'invalid'
          ? 'Invalid bill result'
          : '{"summary":"Hours reviewed"}';
      if (
        outcome === 'valid' ||
        outcome === 'revoked' ||
        outcome === 'timeout-after-write' ||
        outcome === 'cancel-after-write'
      ) {
        toolQueue.push(
          {
            name: 'getVendorBillReconciliation',
            args: JSON.stringify({ billId: key }),
          },
          {
            name: 'saveVendorBillNotes',
            args: JSON.stringify({
              billId: key,
              notes:
                'Controlled difference of 8 hours; ask the vendor to verify.',
            }),
          },
        );
      }
      if (outcome === 'revoked')
        beforeModelReply = async () => {
          if (toolQueue[0]?.name === 'saveVendorBillNotes') {
            await authz.permissionSets.revoke(assignment.id);
            beforeModelReply = undefined;
          }
        };
      const closed = Promise.withResolvers<void>();
      const opened = Promise.withResolvers<void>();
      if (
        outcome === 'timeout-after-write' ||
        outcome === 'cancel-after-write'
      ) {
        holdFinal = true;
        heldStream = { opened: opened.resolve, closed: closed.resolve };
      }
      try {
        const pending = cost('native-bill-' + outcome, () =>
          payroll.assistant.review(key, 'controlled-upload'),
        );
        if (outcome === 'cancel-after-write') {
          await opened.promise;
          await active!.abort();
        }
        const result = await pending;
        expect(result.status).toBe(
          outcome === 'revoked' ? 'failed' : 'succeeded',
        );
        const row = await app.connection
          .repository('laborVendorBills')
          .findOne({ filter: { id: key } });
        if (outcome === 'revoked') {
          expect(write).not.toHaveBeenCalled();
          expect(row?.aiNotes).toBeNull();
        } else {
          expect(write).toHaveBeenCalledTimes(1);
          expect(row?.status).toBe('reconciled');
          expect(row?.aiNotes).not.toContain('987654');
          if (
            outcome === 'valid' ||
            outcome === 'timeout-after-write' ||
            outcome === 'cancel-after-write'
          )
            expect(row?.aiNotes).toContain('Controlled difference');
          expect(row?.confirmedAt).toBeNull();
          expect(row?.lines).toEqual([
            {
              row: 1,
              employeeNo: 'controlled-person',
              name: 'Controlled employee',
              billedHours: 40,
              amount: 987654,
            },
          ]);
        }
        if (active) {
          expect(await active.status()).toBe('idle');
          const history = await active.history();
          expect(JSON.stringify(history)).not.toContain('987654');
          if (outcome === 'valid') {
            expect(JSON.stringify(history)).toContain(
              'tool-getVendorBillReconciliation',
            );
            expect(JSON.stringify(history)).toContain(
              'tool-saveVendorBillNotes',
            );
            const before = calls;
            const reopened = await online.background(
              await actorContext(user.id),
              { sessionId: active.sessionId },
            );
            expect(await reopened.get()).toEqual({ summary: 'Hours reviewed' });
            expect(calls).toBe(before);
            await expect(
              online.background(actor, { sessionId: active.sessionId }),
            ).rejects.toThrow();
            const duplicate = await cost('native-bill-duplicate', () =>
              payroll.assistant.review(key, 'controlled-upload'),
            );
            expect(duplicate.status).toBe('duplicate');
            expect(calls).toBe(before);
            expect(write).toHaveBeenCalledTimes(1);
          }
          if (
            outcome === 'timeout-after-write' ||
            outcome === 'cancel-after-write'
          )
            await closed.promise;
        }
      } finally {
        fail = false;
        holdFinal = false;
        heldStream = undefined;
        beforeModelReply = undefined;
        toolQueue.length = 0;
        await active?.abort();
        background.mockRestore();
        write.mockRestore();
        if (outcome === 'no-model')
          await services.update(modelService.name, { enabled: true });
        await app.connection
          .repository('personnelSettings')
          .updateOne({ filter: { id: 'payroll.settings' }, values: { value } });
      }
    },
  );
  it('rejects scoped vendor-bill entry before model probing or persistence', async () => {
    const authz = app.application.container.resolve(authorizationToken);
    const authorization = authz.for({
      ...actor.authorization.identity,
      keyScope: {
        keyId: 'restricted-bill',
        allows: () => true,
        objects: () => [],
        permissions: [],
      },
    });
    await expect(
      cost('native-bill-restricted-entry', () =>
        createNativeBillReview(app.application.container)({
          userId: actor.user.id,
          authorization,
          billId: 'not-read',
          timeZone: 'UTC',
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each(['read', 'write', 'wrong-bill'] as const)(
    'guards raw native bill tools before business access: %s',
    async (path) => {
      const container = app.application.container;
      const payroll = container.resolve(payrollServicesToken);
      const read = vi.spyOn(payroll.bills, 'reconciliationFor');
      const write = vi.spyOn(payroll.bills, 'saveNotes');
      const authz = container.resolve(authorizationToken);
      const entry =
        path === 'wrong-bill'
          ? actor
          : {
              ...actor,
              authorization: authz.for({
                ...actor.authorization.identity,
                keyScope: {
                  keyId: 'raw-bill-scope',
                  allows: () => true,
                  objects: () => [],
                  permissions: [],
                },
              }),
            };
      const online = container.resolve(agentsToken).onlineAgent;
      const session = await online.background(
        { ...entry, business: { billId: 'bound-bill' } },
        { scope: ['hr.vendorBills'] },
      );
      tool = {
        name:
          path === 'read'
            ? 'getVendorBillReconciliation'
            : 'saveVendorBillNotes',
        args: JSON.stringify({
          billId: path === 'wrong-bill' ? 'other-bill' : 'bound-bill',
          notes: 'Must not save',
        }),
      };
      text = '{"summary":"Controlled refusal"}';
      try {
        await cost('native-bill-raw-' + path, async () => {
          await session.run([{ role: 'user', content: 'Use the bill tool' }], {
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
            additionalProperties: false,
          });
          await session.get();
        });
        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(JSON.stringify(await session.history())).toContain(
          'output-error',
        );
      } finally {
        await session.abort();
        read.mockRestore();
        write.mockRestore();
      }
    },
  );
  it.each([
    'approve',
    'reject',
    'restart',
    'revoked',
    'expired',
    'rebound',
    'wrong-user',
    'sessionId',
    'messageId',
    'executionId',
    'approvalId',
    'concurrent',
    'stopped',
    'model-failure',
  ] as const)(
    'continues the exact native IM approval through the production card service: %s',
    async (outcome) => {
      const container = app.application.container;
      const authz = container.resolve(authorizationToken);
      const suffix = 'im_' + outcome.replaceAll('-', '_');
      const user = await container.resolve(userManagementServiceToken).create({
        name: 'Controlled IM employee',
        username: suffix,
        email: suffix + '@example.invalid',
        password: randomBytes(24).toString('hex'),
      });
      const external = 'external-' + suffix;
      await app.connection.repository('employees').createOne({
        values: {
          id: suffix,
          employeeNo: suffix,
          name: 'Controlled IM employee',
          userId: user.id,
          departmentId: 'controlled-team',
          status: 'active',
          employmentType: 'fullTime',
          syncLocked: false,
          mobile: '13800000000',
          address: 'Original address',
          externalProvider: 'feishu',
          externalUserId: external,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      await authz.permissionSets.create({
        key: suffix,
        grants: [
          aiAssistantResource
            .reference()
            .grant({ use: { employees: 'allRecords' } }),
          profileChangeResource
            .reference()
            .grant({ request: { profileChangeRequests: 'allRecords' } }),
        ],
      });
      const assignment = await authz.permissionSets.assign({
        subject: { type: 'user', id: user.id },
        permissionSet: suffix,
      });
      const originalChannel = container.resolve(imChannelToken);
      let channel = originalChannel;
      const online = container.resolve(agentsToken).onlineAgent;
      const core = container.resolve(hrCoreServiceToken);
      const write = vi.spyOn(core, 'requestProfileChange');
      const start = vi.spyOn(online, 'realtime');
      const setTimer = vi.spyOn(globalThis, 'setTimeout');
      const clearTimer = vi.spyOn(globalThis, 'clearTimeout');
      imTransportCounts = { sendCard: 0, sendText: 0, updateCard: 0 };
      const transportSpies: (() => void)[] = [];
      const observeTransport = (transport: typeof channel.transport) => {
        for (const name of ['sendCard', 'sendText', 'updateCard'] as const) {
          const original = transport[name].bind(transport);
          const spy = vi
            .spyOn(transport, name)
            .mockImplementation((...args: unknown[]) => {
              imTransportCounts![name]++;
              return (original as (...values: unknown[]) => Promise<void>)(
                ...args,
              );
            });
          transportSpies.push(() => spy.mockRestore());
        }
      };
      observeTransport(channel.transport);
      let sessionId: string | undefined;
      routeAnswer = '{"key":"myRecord"}';
      text = 'Controlled reply 13900000000 11010119900101001X';
      tool = {
        name: 'submitMyProfileChange',
        args: '{"changes":{"mobile":"13900000000"}}',
      };
      const incoming = {
        provider: 'feishu' as const,
        messageId: suffix,
        chatType: 'p2p' as const,
        senderExternalId: external,
        text: '请修改我的手机号',
      };
      try {
        const answer = await cost('im-card-propose-' + outcome, () =>
          channel.handle(incoming),
        );
        expect(answer.cards).toHaveLength(1);
        expect(write).not.toHaveBeenCalled();
        const row = await app.connection
          .repository('imCards')
          .findOne({ filter: { id: answer.cards![0] } });
        expect(row?.kind).toBe(NATIVE_APPROVAL_CARD);
        let raw: unknown = row?.payload;
        while (typeof raw === 'string') raw = JSON.parse(raw);
        const payload = raw as NativeApprovalBinding & { display: string[] };
        sessionId = payload.sessionId;
        expect(row?.refId).toBe(sessionId);
        expect(Object.keys(payload).sort()).toEqual(
          [
            'sessionId',
            'messageId',
            'executionId',
            'approvalId',
            'display',
          ].sort(),
        );
        expect(JSON.stringify(payload)).not.toContain('13900000000');
        const view = await channel.cards.view(answer.cards![0]!);
        if (outcome === 'approve' && process.env.NATIVE_IM_VIEW_FILE)
          writeFileSync(process.env.NATIVE_IM_VIEW_FILE, JSON.stringify(view));
        expect(JSON.stringify(view)).toContain('139****0000');
        expect(JSON.stringify(view)).not.toContain('13900000000');
        const deadlines = setTimer.mock.calls.flatMap((args, index) =>
          args[1] === 120_000
            ? [setTimer.mock.results[index]!.value as unknown]
            : [],
        );
        expect(deadlines.length).toBeGreaterThan(0);
        for (const timer of deadlines)
          expect(clearTimer).toHaveBeenCalledWith(timer);
        const before = calls;
        expect(
          await cost('im-message-duplicate', () => channel.handle(incoming)),
        ).toMatchObject({ duplicate: true });
        const waiting = await cost('im-waiting-follow-up', () =>
          channel.handle({
            ...incoming,
            messageId: suffix + '-follow',
            text: '那个结果呢',
          }),
        );
        expect(waiting.cards).toEqual(answer.cards);
        expect(calls).toBe(before);
        expect(write).not.toHaveBeenCalled();
        expect(
          (
            await container
              .resolve(agentsToken)
              .conversations.get(user.id, sessionId)
          ).execution?.waitingApproval,
        ).toBe(true);
        if (outcome === 'restart') {
          channel = createImChannel({
            platform: container.resolve(imPlatformToken),
            entry: () => container.resolve(aiEntryServiceToken),
            online: () => online,
            modelAvailable: async () =>
              Boolean(
                (
                  await container
                    .resolve(agentsToken)
                    .models.services.defaults()
                ).effectiveChat,
              ),
            core: () => core,
            publicUrl: (path) => path,
            translate: originalChannel.translate,
            warn: () => undefined,
            production: false,
          });
          observeTransport(channel.transport);
        }
        if (outcome === 'revoked')
          await authz.permissionSets.revoke(assignment.id);
        if (outcome === 'expired') {
          vi.useFakeTimers({ toFake: ['Date'] });
          vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
        }
        if (outcome === 'rebound')
          await app.connection.repository('employees').updateOne({
            filter: { id: suffix },
            values: { externalUserId: external + '-new' },
          });
        if (
          ['sessionId', 'messageId', 'executionId', 'approvalId'].includes(
            outcome,
          )
        ) {
          await app.connection.repository('imCards').updateOne({
            filter: { id: row!.id },
            values: { payload: { ...payload, [outcome]: 'wrong-binding' } },
          });
        }
        if (outcome === 'wrong-user')
          await app.connection.repository('employees').updateOne({
            filter: { id: 'controlled-person' },
            values: {
              externalProvider: 'feishu',
              externalUserId: 'other-operator',
            },
          });
        if (outcome === 'stopped')
          await (
            await online.realtime(await actorContext(user.id), { sessionId })
          ).abort();
        if (outcome === 'model-failure') fail = true;
        const callback = {
          provider: 'feishu' as const,
          callbackId: suffix + '-callback',
          operatorId:
            outcome === 'wrong-user'
              ? 'other-operator'
              : outcome === 'rebound'
                ? external + '-new'
                : external,
          cardId: answer.cards![0]!,
          button: outcome === 'reject' ? 'reject' : 'approve',
          comment: null,
        };
        if (outcome === 'approve') {
          const { provider: _provider, comment: _comment, ...body } = callback;
          const raw = JSON.stringify(body);
          const beforeSignature = calls;
          for (const timestamp of [
            undefined,
            String(Math.floor(Date.now() / 1000) - 600),
          ]) {
            const response = await app.request('/im-callback/feishu/card', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                ...(timestamp
                  ? {
                      'x-nocohr-timestamp': timestamp,
                      'x-nocohr-signature': signCallback(
                        'native-im-test-only-secret',
                        timestamp,
                        raw,
                      ),
                    }
                  : {}),
              },
              body: raw,
            });
            expect(response.status).toBe(403);
          }
          expect(calls).toBe(beforeSignature);
          expect(write).not.toHaveBeenCalled();
        }
        const result = await cost('im-card-callback-' + outcome, async () => {
          if (outcome === 'concurrent') {
            const results = await Promise.all([
              channel.cards.handleCallback(callback),
              channel.cards.handleCallback({
                ...callback,
                callbackId: callback.callbackId + '-concurrent',
              }),
            ]);
            expect(results.filter((item) => item.ok)).toHaveLength(1);
            return results.find((item) => item.ok)!;
          }
          if (outcome === 'approve' || outcome === 'reject') {
            const {
              provider: _provider,
              comment: _comment,
              ...body
            } = callback;
            const raw = JSON.stringify(body);
            const timestamp = String(Math.floor(Date.now() / 1000));
            const response = await app.request('/im-callback/feishu/card', {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-nocohr-timestamp': timestamp,
                'x-nocohr-signature': signCallback(
                  'native-im-test-only-secret',
                  timestamp,
                  raw,
                ),
              },
              body: raw,
            });
            expect(response.status).toBe(200);
            return (
              (await response.json()) as {
                data: Awaited<ReturnType<typeof channel.cards.handleCallback>>;
              }
            ).data;
          }
          return channel.cards.handleCallback(callback);
        });
        const accepted = [
          'approve',
          'reject',
          'restart',
          'concurrent',
          'model-failure',
        ].includes(outcome);
        expect(result.ok).toBe(accepted);
        expect(write).toHaveBeenCalledTimes(
          accepted && outcome !== 'reject' ? 1 : 0,
        );
        const requests = await app.connection
          .repository('profileChangeRequests')
          .findMany({ filter: { employeeId: suffix } });
        expect(requests).toHaveLength(accepted && outcome !== 'reject' ? 1 : 0);
        if (requests[0])
          expect(requests[0]).toMatchObject({
            source: 'feishuCard',
            status: 'pending',
          });
        expect(
          (
            await app.connection
              .repository('employees')
              .findOne({ filter: { id: suffix } })
          )?.mobile,
        ).toBe('13800000000');
        if (outcome === 'expired' || outcome === 'rebound') {
          const currentExternal =
            outcome === 'rebound' ? external + '-new' : external;
          const oldSession = await online.realtime(
            await actorContext(user.id),
            { sessionId },
          );
          const oldHistory = await oldSession.history();
          const oldMetadata = (await app.connection
            .repository('agConversations')
            .findOne({
              filter: { id: sessionId },
              select: (select) => select.fields('metadata'),
            }))!.metadata;
          const freshInput = {
            ...incoming,
            senderExternalId: currentExternal,
            messageId: suffix + '-fresh-message',
            text: '请读取我当前的档案',
          };
          // Neither expired waiting nor a new binding permits revoked users to create a replacement.
          await authz.permissionSets.revoke(assignment.id);
          const beforeUnauthorized = calls;
          const beforeOpen = start.mock.calls.length;
          await expect(
            cost('im-fresh-revoked-' + outcome, () =>
              channel.handle({
                ...freshInput,
                messageId: suffix + '-fresh-revoked',
              }),
            ),
          ).rejects.toMatchObject({ code: 'FORBIDDEN' });
          expect(calls).toBe(beforeUnauthorized);
          expect(start).toHaveBeenCalledTimes(beforeOpen);
          await authz.permissionSets.assign({
            subject: { type: 'user', id: user.id },
            permissionSet: suffix,
          });
          text = 'Fresh authorized response';
          tool = { name: 'getMyHrProfile', args: '{}' };
          const next = await cost('im-fresh-message-' + outcome, () =>
            channel.handle(freshInput),
          );
          expect(next.cards ?? []).not.toContain(answer.cards![0]);
          expect(next.reply).toContain('Fresh authorized response');
          expect(next.handledBy).toBe('hrAssistant');
          expect(start.mock.calls.at(-1)?.[1]?.sessionId).toBeUndefined();
          const replacement = await start.mock.results.at(-1)!.value;
          expect(replacement.sessionId).not.toBe(sessionId);
          const newHistory = JSON.stringify(await replacement.history());
          expect(newHistory).toContain('请读取我当前的档案');
          expect(newHistory).not.toContain('请修改我的手机号');
          expect(newHistory).toContain('tool-getMyHrProfile');
          expect(newHistory).not.toContain('tool-submitMyProfileChange');
          expect(await oldSession.history()).toEqual(oldHistory);
          expect(
            (await app.connection.repository('agConversations').findOne({
              filter: { id: sessionId },
              select: (select) => select.fields('metadata'),
            }))!.metadata,
          ).toEqual(oldMetadata);
          expect(
            await app.connection.repository('imCards').findOne({
              filter: { id: answer.cards![0] },
            }),
          ).toMatchObject({ status: 'open' });
          expect(write).not.toHaveBeenCalled();
          // A generic restore denial must propagate, with no replacement admission or retry.
          const denied = Object.assign(new Error('Controlled restore denial'), {
            status: 403,
          });
          start.mockRejectedValueOnce(denied);
          const beforeDenied = calls;
          await expect(
            cost('im-restore-denied-' + outcome, () =>
              channel.handle({
                ...freshInput,
                messageId: suffix + '-restore-denied',
                text: '那个结果呢',
              }),
            ),
          ).rejects.toBe(denied);
          expect(calls).toBe(beforeDenied);
          await channel.handle({
            ...freshInput,
            messageId: suffix + '-restore-after-denied',
            text: '那个结果呢',
          });
          expect(start.mock.calls.at(-1)?.[1]?.sessionId).toBe(
            replacement.sessionId,
          );
          expect(write).not.toHaveBeenCalled();
        }
        const afterDecision = calls;
        expect(
          await cost('im-callback-duplicate', () =>
            channel.cards.handleCallback(callback),
          ),
        ).toMatchObject({ code: 'duplicate' });
        const different = await cost('im-callback-new-id', () =>
          channel.cards.handleCallback({
            ...callback,
            callbackId: callback.callbackId + '-again',
          }),
        );
        expect(different.ok).toBe(false);
        expect(calls).toBe(afterDecision);
        expect(write).toHaveBeenCalledTimes(
          accepted && outcome !== 'reject' ? 1 : 0,
        );
        if (accepted) {
          const restored = await online.realtime(await actorContext(user.id), {
            sessionId,
          });
          await restored.history();
          expect(calls).toBe(afterDecision);
          expect(await restored.status()).toBe('idle');
        }
        if (outcome === 'approve') {
          const oldIds = start.mock.results.length;
          await channel.handle({
            ...incoming,
            messageId: suffix + '-after',
            text: '那个结果呢',
          });
          expect(start.mock.calls.at(-1)?.[1]?.sessionId).toBe(sessionId);
          expect(start.mock.results.length).toBeGreaterThan(oldIds);
          expect(write).toHaveBeenCalledTimes(1);
          expect(JSON.stringify(channel.mockOutbox?.(external))).not.toContain(
            '13900000000',
          );
        }
      } finally {
        fail = false;
        routeAnswer = undefined;
        tool = undefined;
        vi.useRealTimers();
        if (sessionId)
          await (
            await online.realtime(await actorContext(user.id), { sessionId })
          ).abort();
        write.mockRestore();
        start.mockRestore();
        setTimer.mockRestore();
        clearTimer.mockRestore();
        for (const restore of transportSpies) restore();
        imTransportCounts = undefined;
      }
    },
  );
  it('rejects unsupported restricted IM entry before identity refresh or native storage', async () => {
    const authz = app.application.container.resolve(authorizationToken);
    const restricted = authz.for({
      ...actor.authorization.identity,
      keyScope: {
        keyId: 'im-restricted',
        allows: () => true,
        objects: () => [],
        permissions: [],
      },
    });
    await expect(
      cost('im-restricted-entry', () =>
        openIMSession(
          app.application.container.resolve(agentsToken).onlineAgent,
          { userId: actor.user.id, authz: restricted },
          { provider: 'feishu', externalUserId: 'not-read' },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('routes and masks ordinary native IM replies, isolates channels, and does not execute pay questions', async () => {
    const channel = app.application.container.resolve(imChannelToken);
    await app.connection.repository('employees').updateOne({
      filter: { id: 'controlled-person' },
      values: {
        externalProvider: 'feishu',
        externalUserId: 'native-chat-owner',
      },
    });
    routeAnswer = '{"key":"myRecord"}';
    text = '13900000000 11010119900101001X';
    const input = {
      provider: 'feishu' as const,
      chatType: 'p2p' as const,
      senderExternalId: 'native-chat-owner',
      text: '查看我的档案',
      messageId: 'im-chat',
    };
    const core = app.application.container.resolve(hrCoreServiceToken);
    const read = vi.spyOn(core, 'myHrProfile');
    tool = { name: 'getMyHrProfile', args: '{}' };
    try {
      const first = await cost('im-native-read', () => channel.handle(input));
      expect(first.reply).toContain('139****0000');
      expect(first.reply).not.toContain('13900000000');
      expect(read).toHaveBeenCalledTimes(1);
      await cost('im-native-follow-up', () =>
        channel.handle({
          ...input,
          messageId: 'im-chat-next',
          text: '那个结果呢',
        }),
      );
      expect(read).toHaveBeenCalledTimes(1);
      const before = calls;
      const pay = await cost('im-pay-link', () =>
        channel.handle({
          ...input,
          messageId: 'im-pay',
          text: '我的工资是多少',
        }),
      );
      expect(pay.reply).toContain('/talent/my-payslips');
      expect(calls - before).toBe(1); // Classifier only; no chat input is admitted.
      const unbound = await channel.handle({
        ...input,
        provider: 'wecom',
        messageId: 'im-other-provider',
      });
      expect(unbound.handledBy).toBeNull();
    } finally {
      routeAnswer = undefined;
      tool = undefined;
      read.mockRestore();
    }
  });
  it('persists native card delivery and updates through the real Feishu adapter with a controlled message API', async () => {
    const container = app.application.container;
    const authz = container.resolve(authorizationToken);
    const user = await container.resolve(userManagementServiceToken).create({
      name: 'Delivery employee',
      username: 'im_delivery',
      email: 'im_delivery@example.invalid',
      password: randomBytes(24).toString('hex'),
    });
    await app.connection.repository('employees').createOne({
      values: {
        id: 'im-delivery',
        employeeNo: 'im-delivery',
        name: 'Delivery employee',
        userId: user.id,
        departmentId: 'controlled-team',
        status: 'active',
        employmentType: 'fullTime',
        syncLocked: false,
        mobile: '13800000000',
        externalProvider: 'feishu',
        externalUserId: 'controlled-delivery-recipient',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await authz.permissionSets.create({
      key: 'im-delivery',
      grants: [
        aiAssistantResource
          .reference()
          .grant({ use: { employees: 'allRecords' } }),
        profileChangeResource
          .reference()
          .grant({ request: { profileChangeRequests: 'allRecords' } }),
      ],
    });
    await authz.permissionSets.assign({
      subject: { type: 'user', id: user.id },
      permissionSet: 'im-delivery',
    });
    const sent: { path: string; body: unknown }[] = [];
    imTransportCounts = { sendCard: 0, sendText: 0, updateCard: 0 };
    const transport = createFeishuTransport({
      api: {
        call: async (
          path: string,
          input: { method: string; body: unknown },
        ) => {
          sent.push({ path, body: input.body });
          const body = input.body as { msg_type?: string };
          if (input.method === 'PATCH') imTransportCounts!.updateCard++;
          else if (body.msg_type === 'interactive')
            imTransportCounts!.sendCard++;
          else imTransportCounts!.sendText++;
          return { message_id: 'controlled-delivery-message' };
        },
      } as never,
      link: (path) => 'https://controlled.invalid' + path,
      messages: {
        get: async (id) => {
          const row = await container
            .resolve(imPlatformToken)
            .database.query()
            .selectFrom('imCards')
            .select(['externalMessageId'])
            .where('id', '=', id)
            .executeTakeFirst();
          return row?.externalMessageId ? String(row.externalMessageId) : null;
        },
        set: async (id, messageId) => {
          await container
            .resolve(imPlatformToken)
            .database.query()
            .updateTable('imCards')
            .set({ externalMessageId: messageId })
            .where('id', '=', id)
            .execute();
        },
      },
    });
    const original = container.resolve(imChannelToken);
    const online = container.resolve(agentsToken).onlineAgent;
    const channel = createImChannel({
      platform: container.resolve(imPlatformToken),
      entry: () => container.resolve(aiEntryServiceToken),
      online: () => online,
      modelAvailable: async () =>
        Boolean(
          (await container.resolve(agentsToken).models.services.defaults())
            .effectiveChat,
        ),
      core: () => container.resolve(hrCoreServiceToken),
      publicUrl: (path) => path,
      translate: original.translate,
      warn: () => undefined,
      production: false,
      transport,
    });
    routeAnswer = '{"key":"myRecord"}';
    text = 'Saved for HR review';
    tool = {
      name: 'submitMyProfileChange',
      args: '{"changes":{"mobile":"13900000000"}}',
    };
    try {
      const answer = await cost('im-feishu-delivery', () =>
        channel.handle({
          provider: 'feishu',
          messageId: 'controlled-delivery',
          chatType: 'p2p',
          senderExternalId: 'controlled-delivery-recipient',
          text: '请修改我的手机号',
        }),
      );
      const row = await app.connection
        .repository('imCards')
        .findOne({ filter: { id: answer.cards![0] } });
      expect(row?.externalMessageId).toBe('controlled-delivery-message');
      expect(sent).toHaveLength(1);
      expect(JSON.stringify(sent[0])).toContain('Approve assistant action');
      expect(JSON.stringify(sent[0])).not.toContain('13900000000');
      expect(
        (
          await cost('im-feishu-callback', () =>
            channel.cards.handleCallback({
              provider: 'feishu',
              callbackId: 'controlled-delivery-callback',
              operatorId: 'controlled-delivery-recipient',
              cardId: answer.cards![0]!,
              button: 'approve',
              comment: null,
            }),
          )
        ).ok,
      ).toBe(true);
      expect(
        sent.filter((message) =>
          message.path.endsWith('/controlled-delivery-message'),
        ),
      ).toHaveLength(1);
      expect(imTransportCounts).toEqual({
        sendCard: 1,
        sendText: 1,
        updateCard: 1,
      });
    } finally {
      routeAnswer = undefined;
      tool = undefined;
      imTransportCounts = undefined;
    }
  });
  it('cancels and finalizes a stalled native IM model response using a short execution budget', async () => {
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const ctx = { userId: actor.user.id, authz: actor.authorization };
    await app.connection.repository('employees').updateOne({
      filter: { id: 'controlled-person' },
      values: {
        externalProvider: 'feishu',
        externalUserId: 'native-timeout-owner',
      },
    });
    const session = await openIMSession(online, ctx, {
      provider: 'feishu',
      externalUserId: 'native-timeout-owner',
    });
    const closed = Promise.withResolvers<void>();
    heldStream = { opened: () => undefined, closed: closed.resolve };
    hold = true;
    text = 'Partial reply';
    try {
      await expect(
        cost('im-model-timeout', async () => {
          await session.send([
            { role: 'user', content: 'Wait for cancellation' },
          ]);
          await consumeIMResponse(session, 300);
        }),
      ).rejects.toMatchObject({ name: 'TimeoutError' });
      await closed.promise;
      expect(await session.status()).toBe('idle');
      expect(
        (
          await app.application.container
            .resolve(agentsToken)
            .conversations.get(actor.user.id, session.sessionId)
        ).execution?.outcome,
      ).toBe('cancelled');
    } finally {
      hold = false;
      heldStream = undefined;
      await session.abort();
    }
  });
  it('stops a live native response and restores its saved partial message', async () => {
    text = 'A controlled partial reply';
    hold = true;
    const online = app.application.container.resolve(agentsToken).onlineAgent;
    const session = await online.realtime(actor);
    let signal!: () => void;
    const reached = new Promise<void>((r) => {
      signal = r;
    });
    try {
      await session.send([{ role: 'user', content: 'Wait for Stop' }]);
      const stream = await session.receive();
      const reading = (async () => {
        if (stream)
          for await (const chunk of stream) {
            if (chunk.type === 'text-delta') signal();
          }
      })();
      await reached;
      await cost('stop', () => session.abort());
      await reading;
      expect(await session.status()).toBe('idle');
      expect(JSON.stringify(await session.history())).toContain(
        'controlled partial',
      );
      const before = calls;
      const reopened = await online.realtime(actor, {
        sessionId: session.sessionId,
      });
      expect(await reopened.history()).toEqual(await session.history());
      expect(calls).toBe(before);
    } finally {
      hold = false;
    }
  });
});

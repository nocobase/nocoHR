// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  modelBusinessFixture,
  actor,
  selection,
  stamp,
} from '../fixtures/assistant-model-business.js';
import { mappedModels } from '../../server/providers/assistant/model-configuration.js';
import {
  AIShapeError,
  AIUnavailableError,
} from '../../server/providers/hr/ai-runner.js';
import { createTrainingAutomation } from '../../server/providers/hr/training-automation.js';
import { createPlanService } from '../../server/providers/hr/plan-service.js';
import { planServiceToken } from '../../server/providers/hr/tokens.js';
import type { AutomationRunContext } from '../../server/providers/hr/automation.js';
import type { PathService } from '../../server/providers/hr/path-service.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const fixture = () => modelBusinessFixture((fn) => cleanup.push(fn));
const structuredInput = {
  employee: 'learningCoach',
  userId: actor.id,
  title: 'Synthetic structured task',
  prompt: 'Only known facts',
  schema: z.object({ ok: z.boolean() }),
  timeZone: 'UTC',
};

it('selects the employee model through mapped configuration and streams text into persisted history', async () => {
  const f = await fixture();
  expect(JSON.stringify(f.models.list())).not.toMatch(
    /synthetic-only|127\.0\.0\.1/u,
  );
  expect(
    await f.cost('configuration-default', () =>
      f.service.defaultModel(actor, 'hrAssistant'),
    ),
  ).toEqual(selection);
  f.answers.push({ text: 'Streamed business reply' });
  const result = await f.cost('background-text', () => f.reply());
  expect(result.text).toBe('Streamed business reply');
  expect((await f.service.get(actor, result.sessionId)).model).toEqual(
    selection,
  );
  expect(
    JSON.stringify(await f.service.history(actor, result.sessionId)),
  ).toContain('Streamed business reply');
  expect(f.requests[0]).toMatchObject({
    model: 'chosen',
    temperature: 0.2,
    top_p: 0.8,
    frequency_penalty: 0.1,
    presence_penalty: 0.3,
  });
});

it('rejects unavailable configuration, employee model restrictions, ownership and revoked access before model execution', async () => {
  const f = await fixture();
  for (const service of [
    { ...f.aiConfig.llmServices.configured, enabled: false },
    { ...f.aiConfig.llmServices.configured, options: {} },
    { ...f.aiConfig.llmServices.configured, provider: 'openai' },
  ]) {
    const models = mappedModels(
      f.config,
      { llmServices: { configured: service } },
      [],
      true,
    );
    expect(() => models.create(selection)).toThrow();
    expect(models.list().some((row) => row.llmService === 'configured')).toBe(
      false,
    );
  }
  await f.db.repository('assistantEmployees').updateMany({
    filter: { id: 'hrAssistant' },
    values: {
      profile: {
        username: 'hrAssistant',
        enabled: true,
        modelSettings: {
          enabled: true,
          models: [{ llmService: 'configured', model: 'not-allowed' }],
        },
      },
    },
  });
  await expect(f.reply()).rejects.toBeInstanceOf(AIUnavailableError);
  expect(f.requests).toHaveLength(0);
  await f.db.repository('assistantEmployees').updateMany({
    filter: { id: 'hrAssistant' },
    values: {
      profile: {
        username: 'hrAssistant',
        enabled: true,
        modelSettings: { enabled: true, models: [selection] },
      },
    },
  });
  f.answers.push({ text: 'Owned' });
  const result = await f.reply();
  await expect(
    f.service.text(
      { ...actor, id: 'intruder' },
      {
        employee: 'hrAssistant',
        model: selection,
        title: 'No',
        text: 'No',
        sessionId: result.sessionId,
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('CONVERSATION_NOT_FOUND');
  f.state.allowed = false;
  await expect(f.reply('No', result.sessionId)).rejects.toThrow(
    'ASSISTANT_FORBIDDEN',
  );
  expect(f.requests).toHaveLength(1);
  expect(f.state.invokes).toBe(0);
});

it('validates structured output, bounds new-session retries, accepts fromText, and keeps structured calls tool-free', async () => {
  const f = await fixture();
  f.answers.push({ structured: { ok: true } });
  const first = await f.cost('structured-success', () =>
    f.runner.structured(structuredInput),
  );
  expect(first.data).toEqual({ ok: true });
  f.answers.push(
    { structured: { ok: 'invalid' } },
    { structured: { ok: false } },
  );
  expect(
    (
      await f.cost('structured-retry', () =>
        f.runner.structured(structuredInput),
      )
    ).data,
  ).toEqual({ ok: false });
  f.answers.push({ text: 'yes' });
  expect(
    (
      await f.runner.structured({
        ...structuredInput,
        fromText: (text) => (text === 'yes' ? { ok: true } : undefined),
      })
    ).data,
  ).toEqual({ ok: true });
  f.answers.push({ structured: { ok: 'invalid' } });
  await expect(
    f.runner.structured({ ...structuredInput, sessionId: first.sessionId }),
  ).rejects.toBeInstanceOf(AIShapeError);
  f.answers.push({ structured: '{bad-json' }, { structured: { wrong: true } });
  await expect(f.runner.structured(structuredInput)).rejects.toBeInstanceOf(
    AIShapeError,
  );
  expect(f.requests).toHaveLength(7);
  for (const request of f.requests) {
    expect(request.stream).not.toBe(true);
    expect(request.tools).toHaveLength(1);
    expect(request.tools![0]!.function.name).not.toBe('backgroundAction');
  }
  expect(f.state.invokes).toBe(0);
});

it('propagates provider errors without retry or fallback and durably cancels a held model request', async () => {
  const f = await fixture();
  f.answers.push({ status: 503 });
  const failure = await f.runner
    .structured(structuredInput)
    .catch((error: unknown) => error);
  expect(failure).not.toBeInstanceOf(AIUnavailableError);
  expect(failure).toMatchObject({ status: 503 });
  expect(f.requests).toHaveLength(1);
  f.answers.push({ hold: true });
  const arrived = f.waitForRequest();
  const controller = new AbortController();
  const pending = f.service.text(
    actor,
    {
      employee: 'hrAssistant',
      model: selection,
      title: 'Cancel',
      text: 'Cancel',
    },
    controller.signal,
  );
  await arrived;
  controller.abort(new Error('synthetic-cancel'));
  await expect(pending).rejects.toThrow();
  expect(f.requests).toHaveLength(2);
  expect(
    (await f.db.repository('assistantConversations').findMany()).map(
      (row) => row.state,
    ),
  ).toContain('cancelled');
  f.answers.push({ hold: true });
  const timeout = await f.runner
    .structured({ ...structuredInput, timeoutMs: 100 })
    .catch((error: unknown) => error);
  expect(timeout).not.toBeInstanceOf(AIUnavailableError);
  expect(f.requests).toHaveLength(3);
});

async function seedBound(f: Awaited<ReturnType<typeof fixture>>) {
  await f.db.repository('employees').createOne({
    values: {
      id: 'person',
      employeeNo: 'person',
      name: 'Synthetic Person',
      userId: actor.id,
      departmentId: 'team',
      positionId: 'position',
      status: 'active',
      externalProvider: 'feishu',
      externalUserId: 'external-owner',
      mobile: '13800000000',
      ...stamp,
    },
  });
}
async function training(
  f: Awaited<ReturnType<typeof fixture>>,
  failure?: 'unavailable' | 'invalid' | 'network',
) {
  await seedBound(f);
  await f.db.repository('employees').createOne({
    values: {
      id: 'outside',
      employeeNo: 'outside',
      name: 'Outside scope',
      userId: 'other',
      departmentId: 'team',
      positionId: 'position',
      status: 'active',
      ...stamp,
    },
  });
  await f.db.repository('competencies').createOne({
    values: {
      id: 'competency',
      code: 'competency',
      title: 'Synthetic skill',
      category: 'skill',
      ...stamp,
    },
  });
  await f.db.repository('positionRequirements').createOne({
    values: {
      id: 'requirement',
      positionId: 'position',
      competencyId: 'competency',
      requiredLevel: 3,
      mandatory: true,
      ...stamp,
    },
  });
  for (const employeeId of ['person', 'outside'])
    await f.db.repository('employeeCompetencies').createOne({
      values: {
        id: employeeId,
        employeeId,
        competencyId: 'competency',
        level: 1,
        assessedBy: 'owner',
        assessedAt: new Date(),
        ...stamp,
      },
    });
  await f.db.repository('courses').createOne({
    values: {
      id: 'course',
      title: 'Known course',
      ownerUserId: 'owner',
      published: true,
      ...stamp,
    },
  });
  await f.db.repository('courseCompetencies').createOne({
    values: {
      id: 'tag',
      courseId: 'course',
      competencyId: 'competency',
      ...stamp,
    },
  });
  const plans = createPlanService({
    platform: f.platform,
    paths: {} as PathService,
  });
  f.container.singleton(planServiceToken, () => plans);
  const run: AutomationRunContext = {
    runId: 'synthetic-run',
    trigger: 'manual',
    owner: {
      userId: actor.id,
      authz: f.scope,
    } as unknown as AutomationRunContext['owner'],
    params: {},
    summarize: vi.fn(),
    reference: vi.fn(),
    usedConversation: vi.fn(),
    markFallback: vi.fn(),
    recordItems: vi.fn(async () => undefined),
  };
  const requests: string[] = [];
  const tasks = createTrainingAutomation({
    container: f.container,
    platform: f.platform,
    structured: async () => {
      throw new Error('Learning plans must not use the legacy generator');
    },
    // Business-service boundary double. The native SDK/persistence contract is tested in native-ai.test.ts.
    structuredPlan: async (_run, _employee, _title, prompt, schema) => {
      if (failure === 'unavailable')
        throw new AIUnavailableError('No native model');
      requests.push(prompt);
      if (failure === 'network')
        throw Object.assign(new Error('Controlled network failure'), {
          status: 503,
        });
      if (failure === 'invalid')
        throw new AIShapeError('Invalid native result');
      run.usedConversation('native-session');
      return schema.parse(plan);
    },
    worded: async (_run, compose) => compose(),
  });
  return { run, tasks, requests };
}

const plan = {
  summary: 'Practice the known skill',
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

it('writes the injected native learning draft as its owner through the actual plan service', async () => {
  const f = await fixture();
  const t = await training(f);
  const result = await f.cost('learning-gap-plan', () =>
    t.tasks.gapPlans(t.run),
  );
  expect(result.output?.plans).toHaveLength(1);
  const saved = await f.db.repository('learningPlans').findMany();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({
    employeeId: 'person',
    status: 'draft',
    reviewerUserId: 'owner',
  });
  expect(await f.db.repository('assignments').count()).toBe(0);
  expect(f.requests).toHaveLength(0);
  expect(t.requests).toHaveLength(1);
  expect(JSON.stringify(t.requests)).not.toContain('Outside scope');
  expect(t.run.recordItems).toHaveBeenCalledOnce();
  expect(t.run.usedConversation).toHaveBeenCalledOnce();
  expect(t.run.markFallback).not.toHaveBeenCalled();
});

it.each(['unavailable', 'invalid', 'network'] as const)(
  'preserves learning task fallback and failure classification: %s',
  async (kind) => {
    const f = await fixture();
    const t = await training(f, kind);
    if (kind === 'network') {
      await expect(
        f.cost('learning-network-failure', () => t.tasks.gapPlans(t.run)),
      ).rejects.toMatchObject({ status: 503 });
      expect(await f.db.repository('learningPlans').count()).toBe(0);
      expect(t.run.markFallback).not.toHaveBeenCalled();
    } else {
      await f.cost('learning-' + kind, () => t.tasks.gapPlans(t.run));
      expect(t.run.markFallback).toHaveBeenCalledOnce();
      expect(await f.db.repository('learningPlans').count()).toBe(1);
    }
    expect(f.requests).toHaveLength(0);
    expect(t.requests).toHaveLength(kind === 'unavailable' ? 0 : 1);
  },
);

it.each(['approve', 'reject'] as const)(
  'continues a real SDK tool result after %s without replaying it',
  async (decision) => {
    const f = await fixture();
    f.state.policy = 'ask';
    f.answers.push({
      tool: { name: 'backgroundAction', args: '{"value":42}' },
    });
    const paused = await f.reply();
    expect(paused.paused).toBe(true);
    const call = (await f.calls.list(paused.sessionId))[0]!;
    expect(call.modelCallId).toBe('stable-call');
    f.state.allowed = false;
    await expect(
      f.service.decide(
        actor,
        paused.sessionId,
        call.messageId!,
        call.modelCallId!,
        { type: decision },
      ),
    ).rejects.toThrow('ASSISTANT_FORBIDDEN');
    expect(f.state.invokes).toBe(0);
    expect(f.requests).toHaveLength(1);
    f.state.allowed = true;
    await f.cost('tool-decision-' + decision, () =>
      f.service.decide(
        actor,
        paused.sessionId,
        call.messageId!,
        call.modelCallId!,
        { type: decision },
      ),
    );
    expect(f.state.invokes).toBe(decision === 'approve' ? 1 : 0);
    f.answers.push({ text: 'Decided reply' });
    const resume = () =>
      f.service.prepare(
        actor,
        paused.sessionId,
        'resume',
        {
          sessionId: paused.sessionId,
          messageId: call.messageId,
          model: selection,
          toolCallResults: [],
        },
        new AbortController().signal,
      );
    await f.cost('tool-resume-' + decision, async () => {
      const execute = await resume();
      return execute(async () => undefined);
    });
    expect(f.state.invokes).toBe(decision === 'approve' ? 1 : 0);
    await expect(resume()).rejects.toThrow();
    expect(f.requests).toHaveLength(2);
    expect(
      f.requests[1]!.messages.some((message) => message.role === 'tool'),
    ).toBe(true);
    expect(
      JSON.stringify(await f.service.history(actor, paused.sessionId)),
    ).toContain('Decided reply');
  },
);

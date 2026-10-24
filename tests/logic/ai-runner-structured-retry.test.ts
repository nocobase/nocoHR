// @vitest-environment node
import type { ServiceContainer } from '@nocobase/service-provider';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { assistantConversationsToken } from '../../server/providers/assistant/tokens.js';
import {
  AIShapeError,
  AIUnavailableError,
  createAIRunner,
} from '../../server/providers/hr/ai-runner.js';

/** Exercise the business runner's retry policy independently of the model transport. */
function stubContainer(
  outcomes: (string | Error)[],
  enabled = true,
  configured = true,
) {
  const sessions: string[] = [];
  const prompts: { sessionId: string; text: string; signal: AbortSignal }[] =
    [];
  const service = {
    defaultModel: async () =>
      configured ? { llmService: 'application', model: 'test' } : undefined,
    async text(
      _actor: unknown,
      request: { sessionId?: string; text: string },
      signal: AbortSignal,
    ) {
      const sessionId = request.sessionId ?? `s${sessions.length + 1}`;
      if (!request.sessionId) sessions.push(sessionId);
      prompts.push({ sessionId, text: request.text, signal });
      const next = outcomes.shift();
      if (next === undefined) throw new Error('unexpected model call');
      if (next instanceof Error) throw next;
      return { text: next, sessionId, paused: false, pending: [] };
    },
  };
  const container = {
    has: (token: unknown) => enabled && token === assistantConversationsToken,
    resolve: (token: unknown) => {
      if (token !== assistantConversationsToken)
        throw new Error('unexpected legacy service');
      return service;
    },
  } as unknown as ServiceContainer;
  return { container, sessions, prompts };
}

const input = {
  employee: 'learningCoach',
  userId: 'u1',
  title: '学习计划：张三（目标岗位）',
  prompt: '请起草学习计划',
  schema: z.object({ summary: z.string().min(1) }),
  timeZone: 'Asia/Shanghai',
};

describe('ai-runner structured output', () => {
  it('retries a shape miss once in a fresh conversation', async () => {
    const stub = stubContainer(['请说明学习目标', '{"summary":"补齐差距"}']);
    await expect(
      createAIRunner(stub.container).structured(input),
    ).resolves.toEqual({
      data: { summary: '补齐差距' },
      sessionId: 's2',
    });
    expect(stub.sessions).toEqual(['s1', 's2']);
    expect(stub.prompts.map((p) => p.sessionId)).toEqual(['s1', 's2']);
    expect(stub.prompts[0]?.text).toContain('[Time zone: Asia/Shanghai]');
    expect(stub.prompts[0]?.text).toContain('【系统自动任务】');
    expect(stub.prompts[1]?.text).toContain('请直接按要求的结构化格式给出结果');
    expect(stub.prompts.every((p) => p.signal instanceof AbortSignal)).toBe(
      true,
    );
  });

  it('reports a shape miss as unavailable after the bounded retry', async () => {
    const stub = stubContainer(['{}', '{"summary":""}']);
    const error = await createAIRunner(stub.container)
      .structured(input)
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AIShapeError);
    expect(error).toBeInstanceOf(AIUnavailableError);
    expect(stub.prompts).toHaveLength(2);
  });

  it('does not retry a continued conversation', async () => {
    const stub = stubContainer(['{}']);
    await expect(
      createAIRunner(stub.container).structured({
        ...input,
        sessionId: 'existing',
      }),
    ).rejects.toBeInstanceOf(AIShapeError);
    expect(stub.sessions).toEqual([]);
    expect(stub.prompts.map((p) => p.sessionId)).toEqual(['existing']);
  });

  it('validates a fromText result without another model request', async () => {
    const stub = stubContainer(['补齐差距']);
    await expect(
      createAIRunner(stub.container).structured({
        ...input,
        unattended: false,
        fromText: (text) => ({ summary: text }),
      }),
    ).resolves.toEqual({ data: { summary: '补齐差距' }, sessionId: 's1' });
    expect(stub.prompts).toHaveLength(1);
    expect(stub.prompts[0]?.text).not.toContain('【系统自动任务】');
  });

  it('rethrows provider failures without another request', async () => {
    const failure = new Error('rate limited');
    const stub = stubContainer([failure]);
    await expect(createAIRunner(stub.container).structured(input)).rejects.toBe(
      failure,
    );
    expect(stub.prompts).toHaveLength(1);
  });

  it.each([
    [false, true],
    [true, false],
  ])(
    'reports unavailable with enabled=%s and configured=%s',
    async (enabled, configured) => {
      const stub = stubContainer([], enabled, configured);
      const runner = createAIRunner(stub.container);
      await expect(runner.structured(input)).rejects.toBeInstanceOf(
        AIUnavailableError,
      );
      await expect(
        runner.reply({ ...input, text: '你好' }),
      ).rejects.toBeInstanceOf(AIUnavailableError);
      expect(stub.prompts).toEqual([]);
    },
  );
});

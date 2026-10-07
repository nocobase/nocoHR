/**
 * 设置 · AI 员工任务 · 目标岗位学习计划 · 立即运行 failed with LangGraph's
 * INVALID_CONCURRENT_GRAPH_UPDATE on `jumpTo`: a structured answer that missed
 * the schema made LangChain retry inside the graph, which crashes when the
 * plugin's after-model middleware is present. The runner treats that failure
 * as an answer outside the format: one fresh conversation, then AIShapeError
 * (an AIUnavailableError, so automations take their rule-based fallback).
 */
import {
  agentServiceFactoryToken,
  AgentServiceError,
  aiConversationsManagerToken,
} from '@nocobase/app-plugin-ai-employee/server';
import { loggingToken } from '@nocobase/app-server/logging';
import type { ServiceContainer } from '@nocobase/service-provider';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  AIShapeError,
  AIUnavailableError,
  createAIRunner,
  isRejectedStructuredAnswer,
} from '../../server/providers/hr/ai-runner.js';

/** What the plugin throws when LangChain's in-graph structured-output retry crashes. */
function jumpToCrash(): AgentServiceError {
  const cause = Object.assign(
    new Error(
      'Invalid update for channel "jumpTo" with values [null,null]: UntrackedValue(guard=true) can receive only one value per step.',
    ),
    {
      name: 'InvalidUpdateError',
      lc_error_code: 'INVALID_CONCURRENT_GRAPH_UPDATE',
    },
  );
  return new AgentServiceError('PROVIDER_ERROR', cause.message, { cause });
}

type Outcome = Error | { structuredResponse: unknown };

function stubContainer(outcomes: Outcome[]) {
  const sessions: string[] = [];
  const prompts: { sessionId: string; text: string }[] = [];
  const services = new Map<unknown, unknown>([
    [
      aiConversationsManagerToken,
      {
        async create() {
          const sessionId = `s${sessions.length + 1}`;
          sessions.push(sessionId);
          return { sessionId };
        },
      },
    ],
    [
      agentServiceFactoryToken,
      {
        async createAIEmployee(options: { state: { sessionId: string } }) {
          return {
            async invoke(request: {
              userMessages: { content: { content: string } }[];
            }) {
              prompts.push({
                sessionId: options.state.sessionId,
                text: request.userMessages[0]?.content.content ?? '',
              });
              const next = outcomes.shift();
              if (!next) throw new Error('unexpected invoke');
              if (next instanceof Error) throw next;
              return { message: null, ...next };
            },
          };
        },
      },
    ],
    [loggingToken, { getLogger: () => ({}) }],
  ]);
  const container = {
    has: (token: unknown) => services.has(token),
    resolve: (token: unknown) => services.get(token),
  } as unknown as ServiceContainer;
  return { container, sessions, prompts };
}

const schema = z.object({ summary: z.string().min(1) });
const input = {
  employee: 'learningCoach',
  userId: 'u1',
  title: '学习计划：张三（目标岗位）',
  prompt: '请起草学习计划',
  schema,
  timeZone: 'Asia/Shanghai',
};

describe('ai-runner structured output', () => {
  it('recognizes the in-graph retry crash and nothing else', () => {
    expect(isRejectedStructuredAnswer(jumpToCrash())).toBe(true);
    expect(
      isRejectedStructuredAnswer(
        new AgentServiceError('PROVIDER_ERROR', 'rate limited'),
      ),
    ).toBe(false);
    expect(isRejectedStructuredAnswer(new Error('boom'))).toBe(false);
    expect(isRejectedStructuredAnswer(undefined)).toBe(false);
  });

  it('asks once more in a fresh conversation after the crash', async () => {
    const stub = stubContainer([
      jumpToCrash(),
      { structuredResponse: { summary: '补齐差距' } },
    ]);
    const result = await createAIRunner(stub.container).structured(input);
    expect(result).toEqual({ data: { summary: '补齐差距' }, sessionId: 's2' });
    // Two conversations, never two questions in one.
    expect(stub.sessions).toEqual(['s1', 's2']);
    expect(stub.prompts.map((p) => p.sessionId)).toEqual(['s1', 's2']);
    expect(stub.prompts[1]?.text).toContain('请直接按要求的结构化格式给出结果');
  });

  it('reports a shape miss, which automations fall back from, when the retry crashes too', async () => {
    const stub = stubContainer([jumpToCrash(), jumpToCrash()]);
    const error = await createAIRunner(stub.container)
      .structured(input)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIShapeError);
    expect(error).toBeInstanceOf(AIUnavailableError);
  });

  it('does not retry a continued conversation, but still reports a shape miss', async () => {
    const stub = stubContainer([jumpToCrash()]);
    const error = await createAIRunner(stub.container)
      .structured({ ...input, sessionId: 'existing' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIShapeError);
    expect(stub.sessions).toEqual([]);
  });

  it('rethrows other provider failures', async () => {
    const failure = new AgentServiceError('PROVIDER_ERROR', 'rate limited');
    const stub = stubContainer([failure]);
    await expect(createAIRunner(stub.container).structured(input)).rejects.toBe(
      failure,
    );
    expect(stub.sessions).toEqual(['s1']);
  });
});

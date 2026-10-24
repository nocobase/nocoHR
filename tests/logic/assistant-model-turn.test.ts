import { AIMessage } from '@langchain/core/messages';
import { ServiceContainer } from '@nocobase/service-provider';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineTools } from '../../server/ai/contracts.js';
import {
  AssistantTurn,
  type AssistantModel,
} from '../../server/providers/assistant/model-turn.js';
import type {
  StoredToolCall,
  ToolCallStore,
} from '../../server/providers/assistant/tool-executor.js';

function fixture(defaultPermission: 'ASK' | 'ALLOW') {
  const rows = new Map<string, StoredToolCall>();
  const store: ToolCallStore & { create(call: StoredToolCall): Promise<void> } =
    {
      async create(call) {
        rows.set(call.id, call);
      },
      async find(id) {
        return rows.get(id);
      },
      async claim(id, from, to) {
        const row = rows.get(id);
        if (!row || row.status !== from) return false;
        row.status = to;
        return true;
      },
      async complete(id) {
        rows.get(id)!.status = 'completed';
      },
    };
  const invoke = vi.fn(async () => ({ saved: true }));
  const tool = defineTools({
    scope: 'SPECIFIED',
    defaultPermission,
    definition: {
      name: 'save',
      description: 'Save a draft',
      schema: z.strictObject({ text: z.string() }),
    },
    invoke,
  });
  const reply = vi
    .fn<AssistantModel['reply']>()
    .mockResolvedValueOnce(
      new AIMessage({
        content: '',
        tool_calls: [
          { id: 'model-call', name: 'save', args: { text: 'draft' } },
        ],
      }),
    )
    .mockResolvedValueOnce(new AIMessage('Saved'));
  const policy = {
    authorize: vi.fn(async () => undefined),
    decision: vi.fn(async () => 'allow' as const),
  };
  const turn = new AssistantTurn(
    new ServiceContainer(),
    { reply },
    new Map([['save', tool]]),
    store,
    policy,
  );
  const input = {
    actor: { id: 'owner', roles: [], isRoot: false },
    employee: { username: 'assistant', tools: [{ name: 'save' }] },
    sessionId: 'session',
    history: [],
    text: 'save',
    signal: new AbortController().signal,
  };
  return { rows, invoke, reply, policy, turn, input };
}

it('persists ASK calls with message provenance and never lets the model approve them', async () => {
  const f = fixture('ASK');
  const result = await f.turn.run(f.input);
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.reply).toHaveBeenCalledTimes(1);
  expect(result.pending).toHaveLength(1);
  expect(result.pending[0]).toMatchObject({
    status: 'pending',
    userId: 'owner',
    modelCallId: 'model-call',
    sessionId: 'session',
  });
  expect(result.pending[0].messageId).toBeTruthy();
});

it('executes allowed tools through durable state and returns their result to the model', async () => {
  const f = fixture('ALLOW');
  const result = await f.turn.run(f.input);
  expect(f.invoke).toHaveBeenCalledTimes(1);
  expect(f.policy.authorize).toHaveBeenCalledTimes(2);
  expect([...f.rows.values()][0]?.status).toBe('completed');
  expect(result.pending).toHaveLength(0);
  expect(result.messages.at(-1)?.content).toBe('Saved');
  expect(f.reply.mock.calls[1][0].messages.at(-1)?.content).toBe(
    '{"saved":true}',
  );
});

it('refuses unknown employee tools, invalid model arguments and cancelled turns before writes', async () => {
  const f = fixture('ALLOW');
  await expect(
    f.turn.run({
      ...f.input,
      employee: { username: 'assistant', tools: [{ name: 'unknown' }] },
    }),
  ).rejects.toThrow('EMPLOYEE_TOOL_NOT_AVAILABLE');
  f.reply.mockReset().mockResolvedValue(
    new AIMessage({
      content: '',
      tool_calls: [{ id: 'call', name: 'save', args: { text: 42 } }],
    }),
  );
  await expect(f.turn.run(f.input)).rejects.toThrow('INVALID_MODEL_TOOL_CALL');
  await expect(
    f.turn.run({ ...f.input, signal: AbortSignal.abort() }),
  ).rejects.toThrow();
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.rows.size).toBe(0);
});

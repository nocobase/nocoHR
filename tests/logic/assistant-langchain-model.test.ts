import { AIMessage, HumanMessage } from '@langchain/core/messages';
import { fakeModel } from '@langchain/core/testing';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineTools } from '../../server/ai/contracts.js';
import { LangChainAssistantModel } from '../../server/providers/assistant/langchain-model.js';

it('collects model stream output and emits text through the public LangChain model contract', async () => {
  const model = fakeModel().respond(new AIMessage('你好'));
  const onText = vi.fn(async () => undefined);
  const message = await new LangChainAssistantModel(model).reply({
    messages: [new HumanMessage('hello')],
    tools: [],
    signal: new AbortController().signal,
    onText,
  });
  expect(message.content).toBe('你好');
  expect(onText.mock.calls.flat().join('')).toBe('你好');
});

it('preserves model tool-call identity without executing the bound tool', async () => {
  const invoke = vi.fn(async () => true);
  const tool = defineTools({
    scope: 'SPECIFIED',
    definition: {
      name: 'save',
      description: 'Save',
      schema: z.object({ text: z.string() }),
    },
    invoke,
  });
  const model = fakeModel().respondWithTools([
    { id: 'call', name: 'save', args: { text: 'draft' } },
  ]);
  const message = await new LangChainAssistantModel(model).reply({
    messages: [new HumanMessage('save')],
    tools: [tool],
    signal: new AbortController().signal,
    onText: async () => undefined,
  });
  expect(message.tool_calls).toEqual([
    { id: 'call', name: 'save', args: { text: 'draft' }, type: 'tool_call' },
  ]);
  expect(invoke).not.toHaveBeenCalled();
});

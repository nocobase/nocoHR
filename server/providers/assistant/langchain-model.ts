import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, AIMessageChunk } from '@langchain/core/messages';
import { z } from 'zod';

import type { AssistantModel } from './model-turn.js';

/** Provider selection and secret resolution happen outside the transport adapter. */
export class LangChainAssistantModel implements AssistantModel {
  public constructor(private readonly model: BaseChatModel) {}

  public async reply(
    input: Parameters<AssistantModel['reply']>[0],
  ): Promise<AIMessage> {
    const definitions = input.tools.map((tool) => {
      if (!tool.definition.schema) throw new Error('TOOL_SCHEMA_REQUIRED');
      return {
        type: 'function' as const,
        function: {
          name: tool.definition.name,
          description: tool.definition.description,
          parameters: z.toJSONSchema(tool.definition.schema),
        },
      };
    });
    if (definitions.length && !this.model.bindTools)
      throw new Error('MODEL_TOOLS_NOT_SUPPORTED');
    const runnable = definitions.length
      ? this.model.bindTools!(definitions)
      : this.model;
    let accumulated: AIMessageChunk | undefined;
    for await (const chunk of await runnable.stream([...input.messages], {
      signal: input.signal,
    })) {
      input.signal.throwIfAborted();
      const item: unknown = chunk;
      if (!AIMessage.isInstance(item)) throw new Error('INVALID_MODEL_STREAM');
      const delta = AIMessageChunk.isInstance(item)
        ? item
        : new AIMessageChunk({
            content: item.content,
            tool_calls: item.tool_calls,
            invalid_tool_calls: item.invalid_tool_calls,
            response_metadata: item.response_metadata,
            usage_metadata: item.usage_metadata,
          });
      accumulated = accumulated ? accumulated.concat(delta) : delta;
      if (typeof chunk.content === 'string' && chunk.content)
        await input.onText(chunk.content);
    }
    if (!accumulated) throw new Error('EMPTY_MODEL_RESPONSE');
    return new AIMessage({
      content: accumulated.content,
      tool_calls: accumulated.tool_calls,
      invalid_tool_calls: accumulated.invalid_tool_calls,
      response_metadata: accumulated.response_metadata,
      usage_metadata: accumulated.usage_metadata,
    });
  }
}

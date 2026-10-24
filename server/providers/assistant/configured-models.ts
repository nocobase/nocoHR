import { AIMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import type { AssistantConfig } from '../../config/assistant.js';
import type { AssistantModels } from './conversation-service.js';
import { LangChainAssistantModel } from './langchain-model.js';

export function assistantModels(
  config: AssistantConfig,
  options: {
    temperature?: number;
    topP?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
  } = {},
): AssistantModels {
  const available = () =>
    Boolean(config.model && config.apiKey && config.llmService);
  return {
    list: () =>
      available()
        ? [
            {
              llmService: config.llmService,
              llmServiceTitle: config.llmService,
              enabledModels: [{ value: config.model, label: config.model }],
            },
          ]
        : [],
    create(selected, schema) {
      if (
        !available() ||
        selected.llmService !== config.llmService ||
        selected.model !== config.model
      )
        throw new Error('ASSISTANT_MODEL_UNAVAILABLE');
      const model = new ChatOpenAI({
        ...options,
        model: config.model,
        apiKey: config.apiKey,
        maxRetries: 0,
        ...(config.baseURL
          ? { configuration: { baseURL: config.baseURL } }
          : {}),
      });
      if (!schema) return new LangChainAssistantModel(model);
      return {
        async reply(input) {
          if (input.tools.length) throw new Error('STRUCTURED_TOOLS_FORBIDDEN');
          const value = await model
            .withStructuredOutput(schema, {
              method: 'functionCalling',
              strict: false,
              includeRaw: true,
            })
            .invoke([...input.messages], { signal: input.signal });
          const text =
            // A plain-text completion can omit `parsed`; failed parsing can return null.
            // Both must reach the runner's existing schema/fromText validation.
            value.parsed == null
              ? typeof value.raw.content === 'string'
                ? value.raw.content
                : ''
              : JSON.stringify(value.parsed);
          await input.onText(text);
          return new AIMessage(text);
        },
      };
    },
  };
}

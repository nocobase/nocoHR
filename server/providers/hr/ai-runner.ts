/**
 * Runs an application AI employee without anyone watching, as a real user,
 * for the automations ("从任务运行" in the AI employee Skill). The run asks
 * for structured output through `responseFormat` and offers the model no
 * tools, so it can never pause on a tool that needs approval: the automation
 * reads the data it needs as the owner beforehand, and writes the drafts
 * itself afterwards, validating what came back.
 *
 * `AIUnavailableError` means no usable model is configured (or the AI plugin
 * is absent); callers fall back to rules or record the run as failed. Every
 * other failure is rethrown.
 */
import { loggingToken } from '@nocobase/app-server/logging';
import type { ServiceContainer } from '@nocobase/service-provider';
import type { ZodType } from 'zod';

export class AIUnavailableError extends Error {
  public constructor(reason: string) {
    super(`AI_UNAVAILABLE: ${reason}`);
    this.name = 'AIUnavailableError';
  }
}

/**
 * The model answered, twice, without the structured result asked for — it
 * chatted instead. A subclass of `AIUnavailableError`, so work that has a
 * rule-based fallback takes it; interactive callers can tell the two apart.
 */
export class AIShapeError extends AIUnavailableError {
  public constructor(detail: string) {
    super(`response did not match the expected shape: ${detail}`);
    this.name = 'AIShapeError';
  }
}

/** Opens every unattended prompt: an employee's chat habits (asking before sending) have no one to answer here. */
const UNATTENDED_PREFIX =
  '【系统自动任务】这是后台自动运行的任务，没有用户在线：不要提问，不要请求确认，也不要说明你将要做什么，直接按要求的结构化格式给出结果。\n\n';
const RETRY_PROMPT =
  '请直接按要求的结构化格式给出结果，不要附加说明、提问或请求确认。';

/**
 * True when an agent run failed because the model's structured answer did not
 * match the schema. With a model that answers through the structured-output
 * tool, LangChain (langchain 1.2.39) retries such an answer inside the graph by
 * jumping back to the model node, while the model node's static edge to the
 * plugin's after-model middleware fires as well; the two after-model hooks then
 * run in the same step and both write `jumpTo`, which LangGraph rejects with
 * INVALID_CONCURRENT_GRAPH_UPDATE. So an invalid structured answer never comes
 * back as data: the plugin reports it as a PROVIDER_ERROR whose cause is that
 * error. It is the same miss as an answer outside the format, and is retried
 * the same way, in a fresh conversation. Remove once the in-graph retry works.
 */
export function isRejectedStructuredAnswer(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const { lc_error_code: code, message } = current as {
      lc_error_code?: unknown;
      message?: unknown;
    };
    if (
      code === 'INVALID_CONCURRENT_GRAPH_UPDATE' &&
      typeof message === 'string' &&
      message.includes('"jumpTo"')
    )
      return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export interface StructuredRunInput<T> {
  /** The AI employee username; its own system prompt and model settings apply. */
  readonly employee: string;
  /** The user the run acts as: the automation's owner. */
  readonly userId: string;
  readonly title: string;
  readonly prompt: string;
  readonly schema: ZodType<T>;
  readonly timeZone: string;
  readonly timeoutMs?: number;
  /** Continue this conversation instead of starting one: the model sees its earlier turns. */
  readonly sessionId?: string;
  /** false for a conversation someone is taking part in (practice); true (default) for background work. */
  readonly unattended?: boolean;
  /**
   * Reads the answer from the reply text when the model answered in text instead of the structured format
   * (DeepSeek often replies to the routing question with a bare "myRecord"). The result is still checked
   * against `schema`.
   */
  readonly fromText?: (text: string) => unknown;
}

export interface AIRunner {
  structured<T>(
    input: StructuredRunInput<T>,
  ): Promise<{ data: T; sessionId: string }>;
  /**
   * V1-04 办公软件机器人: one turn of a conversation as the user, with the
   * employee's own tools (so `searchKnowledge` scopes to that user). A tool
   * that needs approval pauses the turn; the reply then says so and the bot
   * links to NocoHR, where confirmations happen.
   */
  reply(input: {
    readonly employee: string;
    readonly userId: string;
    readonly title: string;
    readonly text: string;
    readonly timeZone: string;
    readonly sessionId?: string;
  }): Promise<{
    text: string;
    sessionId: string;
    paused: boolean;
    /** V1-04 飞书卡片: the tool calls a paused turn waits on, with their arguments, so the bot can turn one into a card. */
    pending: { name: string; args: unknown }[];
  }>;
}

export function createAIRunner(container: ServiceContainer): AIRunner {
  return {
    async reply(input) {
      const plugin = await import('@nocobase/app-plugin-ai-employee/server');
      const { aiConversationsManagerToken, agentServiceFactoryToken } = plugin;
      if (
        !container.has(aiConversationsManagerToken) ||
        !container.has(agentServiceFactoryToken)
      )
        throw new AIUnavailableError('ai-employee plugin not registered');
      try {
        const conversation = input.sessionId
          ? { sessionId: input.sessionId }
          : await container.resolve(aiConversationsManagerToken).create({
              userId: input.userId,
              aiEmployee: { username: input.employee },
              title: input.title,
            });
        const agent = await container
          .resolve(agentServiceFactoryToken)
          .createAIEmployee({
            username: input.employee,
            state: {
              sessionId: conversation.sessionId,
              timezone: input.timeZone,
            },
            actor: {
              id: input.userId,
              roles: [],
              isRoot: false,
              locale: 'zh-CN',
            },
            runtime: {
              logger: container.resolve(loggingToken).getLogger('hr-ai'),
            },
          });
        const result = await agent.invoke({
          userMessages: [
            { role: 'user', content: { type: 'text', content: input.text } },
          ],
          signal: AbortSignal.timeout(120_000),
        });
        const content = result.message?.content as unknown;
        const text =
          typeof content === 'string'
            ? content
            : content &&
                typeof content === 'object' &&
                'content' in content &&
                typeof content.content === 'string'
              ? content.content
              : '';
        // An interrupt action names its tool call; the arguments are on the turn that requested it.
        const calls = (result.message?.toolCalls ?? []) as {
          id?: unknown;
          name?: unknown;
          args?: unknown;
        }[];
        const pending = (result.interrupt?.actions ?? []).map((action) => {
          const call = calls.find((c) => c.id === action.toolCall?.id);
          return {
            name:
              action.toolCall?.name ??
              (typeof call?.name === 'string' ? call.name : ''),
            args: call?.args ?? null,
          };
        });
        return {
          text,
          sessionId: conversation.sessionId,
          paused: Boolean(result.interrupt),
          pending,
        };
      } catch (error) {
        if (
          error instanceof plugin.AgentServiceError &&
          error.code === 'CONFIGURATION_ERROR'
        )
          throw new AIUnavailableError(error.rootMessage);
        throw error;
      }
    },

    async structured<T>(input: StructuredRunInput<T>) {
      const plugin = await import('@nocobase/app-plugin-ai-employee/server');
      const { aiConversationsManagerToken, agentServiceFactoryToken } = plugin;
      if (
        !container.has(aiConversationsManagerToken) ||
        !container.has(agentServiceFactoryToken)
      )
        throw new AIUnavailableError('ai-employee plugin not registered');
      // No tools at all: only structured output. See the module comment.
      const skillSettings = {
        toolsVersion: 1,
        tools: [] as string[],
        skillsVersion: 1,
        skills: [] as string[],
      };
      /** One question in a conversation: the given one, or a new one. */
      const attempt = async (text: string, sessionId?: string) => {
        const conversation = sessionId
          ? { sessionId }
          : await container.resolve(aiConversationsManagerToken).create({
              userId: input.userId,
              aiEmployee: { username: input.employee },
              title: input.title,
              options: { skillSettings },
            });
        const agent = await container
          .resolve(agentServiceFactoryToken)
          .createAIEmployee({
            username: input.employee,
            state: {
              sessionId: conversation.sessionId,
              timezone: input.timeZone,
            },
            actor: {
              id: input.userId,
              roles: [],
              isRoot: false,
              locale: 'zh-CN',
            },
            runtime: {
              logger: container.resolve(loggingToken).getLogger('hr-ai'),
            },
            skillSettings,
          });
        let structuredResponse: unknown;
        let replyText = '';
        try {
          const result = await agent.invoke({
            // The plugin reads `content.content`; a bare string reaches the model as an empty question,
            // although the Skill's examples pass one.
            userMessages: [
              { role: 'user', content: { type: 'text', content: text } },
            ],
            responseFormat: input.schema,
            signal: AbortSignal.timeout(input.timeoutMs ?? 120_000),
          });
          structuredResponse = result.structuredResponse;
          const content = result.message?.content as unknown;
          replyText =
            typeof content === 'string'
              ? content
              : content &&
                  typeof content === 'object' &&
                  'content' in content &&
                  typeof content.content === 'string'
                ? content.content
                : '';
        } catch (error) {
          // An answer that missed the schema; see isRejectedStructuredAnswer.
          if (!isRejectedStructuredAnswer(error)) throw error;
          structuredResponse = undefined;
        }
        let parsed = input.schema.safeParse(structuredResponse);
        if (!parsed.success && input.fromText && replyText) {
          const fromText = input.schema.safeParse(input.fromText(replyText));
          if (fromText.success) parsed = fromText;
        }
        return { parsed, sessionId: conversation.sessionId };
      };
      try {
        const unattended = input.unattended !== false;
        const prompt = unattended
          ? UNATTENDED_PREFIX + input.prompt
          : input.prompt;
        let outcome = await attempt(prompt, input.sessionId);
        // A model that chatted, or answered outside the format, gets one more try in a fresh conversation: a
        // continued one can carry a structured-output tool call without its result, which providers reject.
        if (!outcome.parsed.success && !input.sessionId)
          outcome = await attempt(`${prompt}\n\n${RETRY_PROMPT}`);
        if (!outcome.parsed.success)
          throw new AIShapeError(outcome.parsed.error.message.slice(0, 500));
        return { data: outcome.parsed.data, sessionId: outcome.sessionId };
      } catch (error) {
        if (
          error instanceof plugin.AgentServiceError &&
          error.code === 'CONFIGURATION_ERROR'
        )
          throw new AIUnavailableError(error.rootMessage);
        throw error;
      }
    },
  };
}

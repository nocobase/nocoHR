/**
 * Runs an application AI employee without anyone watching, as a real user,
 * for the automations ("从任务运行" in the AI employee Skill). The run asks
 * for structured output through `responseFormat` and offers the model no
 * tools, so it can never pause on a tool that needs approval: the automation
 * reads the data it needs as the owner beforehand, and writes the drafts
 * itself afterwards, validating what came back.
 *
 * `AIUnavailableError` means no usable model is configured (or the assistant
 * is disabled); callers fall back to rules or record the run as failed. Every
 * other failure is rethrown.
 */
import type { ServiceContainer } from '@nocobase/service-provider';
import type { ZodType } from 'zod';
import { assistantConversationsToken } from '../assistant/tokens.js';

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
      if (container.has(assistantConversationsToken)) {
        const service = container.resolve(assistantConversationsToken);
        const model = await service.defaultModel(
          { id: input.userId, roles: [], isRoot: false, locale: 'zh-CN' },
          input.employee,
        );
        if (!model)
          throw new AIUnavailableError('application model not configured');
        return service.text(
          { id: input.userId, roles: [], isRoot: false, locale: 'zh-CN' },
          {
            ...input,
            text: `[Time zone: ${input.timeZone}]\n\n${input.text}`,
            model,
          },
          AbortSignal.timeout(120_000),
        );
      }
      throw new AIUnavailableError('application assistant is disabled');
    },

    async structured<T>(input: StructuredRunInput<T>) {
      if (container.has(assistantConversationsToken)) {
        const service = container.resolve(assistantConversationsToken);
        const model = await service.defaultModel(
          { id: input.userId, roles: [], isRoot: false, locale: 'zh-CN' },
          input.employee,
        );
        if (!model)
          throw new AIUnavailableError('application model not configured');
        const actor = {
          id: input.userId,
          roles: [],
          isRoot: false,
          locale: 'zh-CN',
        };
        const prompt =
          `[Time zone: ${input.timeZone}]\n\n` +
          (input.unattended === false ? '' : UNATTENDED_PREFIX) +
          input.prompt;
        const attempt = async (text: string, sessionId?: string) => {
          const result = await service.text(
            actor,
            {
              employee: input.employee,
              title: input.title,
              text,
              sessionId,
              schema: input.schema,
              model,
            },
            AbortSignal.timeout(input.timeoutMs ?? 120_000),
          );
          let value: unknown;
          try {
            value = JSON.parse(result.text);
          } catch {
            value = undefined;
          }
          let parsed = input.schema.safeParse(value);
          if (!parsed.success && input.fromText && result.text)
            parsed = input.schema.safeParse(input.fromText(result.text));
          return { parsed, sessionId: result.sessionId };
        };
        let result = await attempt(prompt, input.sessionId);
        if (!result.parsed.success && !input.sessionId)
          result = await attempt(`${prompt}\n\n${RETRY_PROMPT}`);
        if (!result.parsed.success)
          throw new AIShapeError(result.parsed.error.message.slice(0, 500));
        return { data: result.parsed.data, sessionId: result.sessionId };
      }
      throw new AIUnavailableError('application assistant is disabled');
    },
  };
}

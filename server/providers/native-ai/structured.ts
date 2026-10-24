import type { ServiceContainer } from '@nocobase/service-provider';
import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { OnlineAgentResultError } from '@nocobase/app-plugin-agents/server/online-agent';
import type { ZodType } from 'zod';
import { generateStructuredResult } from './structured-result.js';
import { assertUnrestrictedNativeAIEntry } from './access.js';
import { AIShapeError, AIUnavailableError } from '../hr/ai-runner.js';

export interface StructuredAI {
  structured<T>(input: {
    readonly employee: string;
    readonly userId: string;
    readonly authorization: AuthorizationContext;
    readonly title: string;
    readonly prompt: string;
    readonly schema: ZodType<T>;
    readonly timeZone: string;
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
  }): Promise<{ data: T; sessionId: string }>;
}

/** Ordinary generation has one native execution, with no legacy employee/model or text-parsing fallback. */
export function createNativeStructuredAI(
  container: ServiceContainer,
): StructuredAI {
  return {
    async structured(input) {
      assertUnrestrictedNativeAIEntry(input.authorization);
      input.signal?.throwIfAborted();
      const agents = container.resolve(agentsToken);
      if (!(await agents.models.services.defaults()).effectiveChat)
        throw new AIUnavailableError('No enabled native chat model');
      try {
        return await generateStructuredResult(
          agents.onlineAgent,
          {
            user: { id: input.userId },
            authorization: input.authorization,
            credentials: { kind: 'hr-background' },
          },
          `[Time zone: ${input.timeZone}]\n${input.title}\n${input.prompt}`,
          input.schema,
          'hr.background',
          { timeoutMs: input.timeoutMs ?? 120_000, signal: input.signal },
        );
      } catch (error) {
        if (
          error instanceof OnlineAgentResultError &&
          error.code === 'OUTPUT_INVALID'
        )
          throw new AIShapeError(error.message);
        throw error;
      }
    },
  };
}

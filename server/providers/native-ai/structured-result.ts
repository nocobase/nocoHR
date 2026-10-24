import type {
  OnlineAgentService,
  OnlineAgentContext,
} from '@nocobase/app-plugin-agents/server/online-agent';
import { OnlineAgentResultError } from '@nocobase/app-plugin-agents/server/online-agent';
import { z } from 'zod';
import { assertUnrestrictedNativeAIEntry } from './access.js';

/** Consume one native structured execution; the official service owns validation, storage and finalization. */
export async function generateStructuredResult<T>(
  online: OnlineAgentService,
  actor: OnlineAgentContext,
  prompt: string,
  schema: z.ZodType<T>,
  scope: string,
  deadline?: { timeoutMs: number; signal?: AbortSignal },
  tools: string[] = [],
) {
  assertUnrestrictedNativeAIEntry(actor.authorization);
  const started = performance.now();
  if (
    deadline &&
    (!Number.isFinite(deadline.timeoutMs) || deadline.timeoutMs < 0)
  )
    throw new RangeError('timeoutMs must be finite and non-negative');
  deadline?.signal?.throwIfAborted();
  const session = await online.background(actor, {
    scope: [scope],
    tool: tools,
  });
  deadline?.signal?.throwIfAborted();
  await session.run(
    [{ role: 'user', content: prompt }],
    z.toJSONSchema(schema, { target: 'draft-7' }) as Parameters<
      typeof session.run
    >[1],
  );
  if (!deadline) {
    const result = await session.get();
    return { data: schema.parse(result), sessionId: session.sessionId };
  }

  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<undefined>((resolve) => {
    onAbort = () => resolve(undefined);
    deadline.signal?.addEventListener('abort', onAbort, { once: true });
    if (deadline.signal?.aborted) onAbort();
  });
  try {
    const result = await Promise.race([
      session.try({
        wait: Math.max(0, deadline.timeoutMs - (performance.now() - started)),
      }),
      cancelled,
    ]);
    if (!result || (!result.ok && result.reason === 'pending')) {
      const reason: unknown = deadline.signal?.aborted
        ? deadline.signal.reason
        : new DOMException('The operation timed out', 'TimeoutError');
      // try only observes. Native abort waits for execution, persistence and release;
      // never return to business error handling with a detached model still running.
      await session.abort();
      try {
        const data = await session.get();
        return { data: schema.parse(data), sessionId: session.sessionId };
      } catch (error) {
        if (
          error instanceof OnlineAgentResultError &&
          error.reason === 'cancelled'
        )
          throw reason;
        throw error;
      }
    }
    if (!result.ok)
      throw new OnlineAgentResultError(result.reason, result.error);
    return { data: schema.parse(result.data), sessionId: session.sessionId };
  } finally {
    if (onAbort) deadline.signal?.removeEventListener('abort', onAbort);
  }
}

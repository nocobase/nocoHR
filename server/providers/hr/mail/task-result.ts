import type { AutomationRunContext } from '../automation.js';

/** Existing mail task boundary; automation retains the durable task outcome. */
type MailTaskRunner = <T extends Record<string, unknown>>(
  key: string,
  options: { dedupeKey: string; triggerRef: Record<string, unknown> },
  work: (
    run: AutomationRunContext,
  ) => Promise<{ status?: 'succeeded' | 'skipped'; output?: T }>,
) => Promise<unknown>;

/** Propagate only actual failure, retaining the original rejection without another task read. */
export async function runMailTask<T extends Record<string, unknown>>(
  run: MailTaskRunner,
  key: string,
  options: { dedupeKey: string; triggerRef: Record<string, unknown> },
  work: (
    context: AutomationRunContext,
  ) => Promise<{ status?: 'succeeded' | 'skipped'; output?: T }>,
  after?: () => Promise<void>,
): Promise<void> {
  let rejected: { reason: unknown } | undefined;
  const outcome = await run(key, options, async (context) => {
    try {
      return await work(context);
    } catch (reason) {
      rejected = { reason };
      throw reason;
    }
  });
  const failed = Boolean(
    outcome &&
    typeof outcome === 'object' &&
    'status' in outcome &&
    outcome.status === 'failed',
  );
  try {
    // Existing received-to-unmatched handling must also run after a recorded failure.
    await after?.();
  } catch (error) {
    if (failed && rejected)
      throw new AggregateError([rejected.reason, error], 'MAIL_TASK_FAILED', {
        cause: error,
      });
    throw error;
  }
  if (failed) {
    // Failure before work (for example owner authorization) has already been recorded by automation.
    throw rejected ? rejected.reason : new Error('MAIL_TASK_FAILED');
  }
}

/** Internal aggregate only. Counts remain received counts; errors and partial writes are retained. */
export class MailPollError extends AggregateError {
  constructor(
    errors: readonly unknown[],
    readonly counts: Readonly<Record<string, number>>,
  ) {
    super(errors, 'MAIL_PROCESSING_FAILED');
    this.name = 'MailPollError';
  }
}

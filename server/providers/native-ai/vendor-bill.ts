import type { ServiceContainer } from '@nocobase/service-provider';
import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { z } from 'zod';
import { AIUnavailableError } from '../hr/ai-runner.js';
import { assertUnrestrictedNativeAIEntry } from './access.js';
import { generateStructuredResult } from './structured-result.js';

export type NativeBillReview = (input: {
  userId: string;
  authorization: AuthorizationContext;
  billId: string;
  timeZone: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}) => Promise<{ sessionId: string }>;

/** A tool-enabled native background conversation, with no human approval wait. */
export function createNativeBillReview(
  container: ServiceContainer,
): NativeBillReview {
  return async (input) => {
    assertUnrestrictedNativeAIEntry(input.authorization);
    input.signal?.throwIfAborted();
    const agents = container.resolve(agentsToken);
    if (!(await agents.models.services.defaults()).effectiveChat)
      throw new AIUnavailableError('No enabled native chat model');
    return generateStructuredResult(
      agents.onlineAgent,
      {
        user: { id: input.userId },
        authorization: input.authorization,
        credentials: { kind: 'hr-vendor-bill' },
        business: { billId: input.billId },
      },
      `[Time zone: ${input.timeZone}]\nReview vendor bill ${input.billId}. Read getVendorBillReconciliation, explain hour differences and use saveVendorBillNotes once. Never confirm a bill, change its lines or amounts, or send anything externally. Return the structured summary when finished.`,
      z.object({ summary: z.string().max(4000) }),
      'hr.vendorBills',
      { timeoutMs: input.timeoutMs ?? 120_000, signal: input.signal },
      ['getVendorBillReconciliation', 'saveVendorBillNotes'],
    );
  };
}

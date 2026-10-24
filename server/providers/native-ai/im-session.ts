import type {
  OnlineAgentService,
  RealtimeOnlineAgent,
  AppUIMessage,
} from '@nocobase/app-plugin-agents/server/online-agent';
import { z } from 'zod';
import type { DatabaseManager } from '@nocobase/db';
import type { ActorContext } from '../hr/framework-service.js';
import { authorizeAction } from '../hr/authorize.js';
import { HrError } from '../hr/shared.js';
import { assertUnrestrictedNativeAIEntry } from './access.js';

export const imOriginSchema = z.object({
  provider: z.enum(['feishu', 'dingtalk', 'wecom']),
  externalUserId: z.string().min(1),
});
export const nativeApprovalSchema = z.object({
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  executionId: z.string().min(1),
  approvalId: z.string().min(1),
});
export type NativeApprovalBinding = z.infer<typeof nativeApprovalSchema>;

export async function openIMSession(
  online: OnlineAgentService,
  actor: ActorContext,
  origin: z.infer<typeof imOriginSchema>,
  sessionId?: string,
) {
  assertUnrestrictedNativeAIEntry(actor.authz);
  await authorizeAction(actor.authz, 'talent.aiAssistant', 'use');
  const context = {
    user: { id: actor.userId },
    authorization: actor.authz,
    credentials: { kind: 'hr-im', ...origin },
    // Creation resolves the trusted scope once. Re-adding a business user message
    // on approval would put it after the SDK approval response and suppress continuation.
    ...(sessionId ? {} : { business: { im: origin } }),
  };
  const session = await online.realtime(
    context,
    sessionId ? { sessionId } : { scope: ['hr.im'] },
  );
  const config = await online.configuration(context, session.sessionId);
  const stored = z.object({ im: imOriginSchema }).parse(config.variable).im;
  if (
    !config.scope.includes('hr.im') ||
    stored.provider !== origin.provider ||
    stored.externalUserId !== origin.externalUserId
  )
    throw new HrError('FORBIDDEN', 403);
  return session;
}

/** Only the live model response has a deadline; a closed approval stream leaves no timer behind. */
export async function consumeIMResponse(
  session: RealtimeOnlineAgent,
  timeoutMs = 120_000,
) {
  let expired = false;
  let cancellation: Promise<void> | undefined;
  let cancelError: Error | undefined;
  const timer = setTimeout(() => {
    expired = true;
    cancellation = session.abort().catch((error: unknown) => {
      cancelError =
        error instanceof Error
          ? error
          : new Error('Native cancellation failed', { cause: error });
    });
  }, timeoutMs);
  try {
    const stream = await session.receive();
    if (stream)
      for await (const _chunk of stream) {
        /* Official stream owns tool execution and persistence. */
      }
  } finally {
    clearTimeout(timer);
    await cancellation;
  }
  if (cancelError) throw cancelError;
  if (expired)
    throw new DOMException('The operation timed out', 'TimeoutError');
}

export function pendingIMApprovals(sessionId: string, history: AppUIMessage[]) {
  return history.flatMap((message) => {
    if (message.role !== 'assistant' || !message.metadata?.executionId)
      return [];
    return message.parts.flatMap((part) => {
      if (
        part.type !== 'tool-submitMyProfileChange' ||
        !('state' in part) ||
        part.state !== 'approval-requested' ||
        !('approval' in part) ||
        !part.approval?.id ||
        !('input' in part)
      )
        return [];
      return [
        {
          sessionId,
          messageId: message.id,
          executionId: message.metadata!.executionId!,
          approvalId: part.approval.id,
          input: part.input,
        },
      ];
    });
  });
}

/** Read-only adapter for the pinned Agents metadata v1; public status omits approval expiry. */
export async function currentIMApprovals(
  database: DatabaseManager,
  userId: string,
  session: RealtimeOnlineAgent,
) {
  const candidates = pendingIMApprovals(
    session.sessionId,
    await session.history(),
  );
  if (!candidates.length) return { expired: false, pending: candidates };
  // The caller has opened this owned HR session; still constrain this read by owner.
  // Never infer effective waiting from historical approval-requested parts alone.
  const row = await database
    .connection()
    .repository('agConversations')
    .findOne({
      filter: { id: session.sessionId, userId },
      select: (select) => select.fields('metadata'),
    });
  if (!row) throw new HrError('FORBIDDEN', 403);
  const metadata: unknown =
    typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
  const {
    onlineAgent: { call },
  } = z
    .object({
      onlineAgent: z.object({
        version: z.literal(1),
        kind: z.literal('realtime'),
        call: z
          .object({
            actorId: z.string(),
            state: z.enum(['running', 'idle', 'waitingApproval']),
            closing: z.boolean().optional(),
            messageId: z.string().optional(),
            executionId: z.string().optional(),
            approvalExpiresAt: z.iso.datetime().optional(),
          })
          .nullable(),
      }),
    })
    .parse(metadata);
  if (call && call.actorId !== userId) throw new HrError('FORBIDDEN', 403);
  if (!call || call.state !== 'waitingApproval' || call.closing)
    return { expired: false, pending: [] };
  // Missing/unknown state fails closed, rather than discarding a possibly valid wait.
  if (!call.approvalExpiresAt || !call.messageId || !call.executionId)
    throw new Error('Native IM approval state is incomplete');
  const expired = Date.parse(call.approvalExpiresAt) <= Date.now();
  return {
    expired,
    pending: expired
      ? []
      : candidates.filter(
          (item) =>
            item.messageId === call.messageId &&
            item.executionId === call.executionId,
        ),
  };
}

export function imResponseText(history: AppUIMessage[]) {
  const last = history.filter((message) => message.role === 'assistant').at(-1);
  return (
    last?.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n') ?? ''
  );
}

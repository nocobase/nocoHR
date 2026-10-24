import type {
  OnlineAgentService,
  RealtimeOnlineAgent,
} from '@nocobase/app-plugin-agents/server/online-agent';
import { z } from 'zod';
import { nativeIMApprovalContext } from '../../native-ai/im-approval-context.js';
import {
  nativeApprovalSchema,
  openIMSession,
  pendingIMApprovals,
} from '../../native-ai/im-session.js';
import { defineCardKind } from './types.js';

export const NATIVE_APPROVAL_CARD = 'nativeToolApproval';
const payloadSchema = nativeApprovalSchema
  .extend({ display: z.array(z.string().max(1000)).max(40) })
  .strict();

export function nativeApprovalCardKind(deps: {
  online: () => OnlineAgentService;
  continued(
    session: RealtimeOnlineAgent,
    userId: string,
    provider: 'feishu' | 'dingtalk' | 'wecom',
    externalUserId: string,
  ): Promise<void>;
}) {
  return defineCardKind({
    kind: NATIVE_APPROVAL_CARD,
    payload: payloadSchema,
    async render({ card, payload, t }) {
      return {
        title: t('imCards.nativeApproval.title'),
        lines: payload.display,
        buttons:
          card.status === 'open'
            ? [
                {
                  key: 'approve',
                  label: t('imCards.approval.approve'),
                  style: 'primary' as const,
                },
                {
                  key: 'reject',
                  label: t('imCards.approval.reject'),
                  style: 'danger' as const,
                },
              ]
            : [],
        state: card.status,
        link: { label: t('imCards.openInApp'), path: '/talent/ask' },
      };
    },
    async act({ card, payload, actor, button, t }) {
      const refused = {
        outcome: 'refused' as const,
        message: t('imCards.nativeApproval.unavailable'),
      };
      if (
        !['approve', 'reject'].includes(button) ||
        payload.sessionId !== card.refId
      )
        return refused;
      let session: RealtimeOnlineAgent;
      try {
        session = await openIMSession(
          deps.online(),
          actor,
          { provider: card.provider, externalUserId: card.externalUserId },
          payload.sessionId,
        );
        const pending = pendingIMApprovals(
          session.sessionId,
          await session.history(),
        );
        if (
          !pending.some(
            (item) =>
              item.messageId === payload.messageId &&
              item.executionId === payload.executionId &&
              item.approvalId === payload.approvalId,
          )
        )
          return refused;
        // Official approval atomically rechecks ownership, exact binding, waiting state and expiry.
        await nativeIMApprovalContext.run(
          { userId: actor.userId, sessionId: session.sessionId },
          () =>
            session.approve({
              messageId: payload.messageId,
              executionId: payload.executionId,
              approval: {
                id: payload.approvalId,
                approved: button === 'approve',
              },
            }),
        );
      } catch {
        return refused;
      }
      try {
        await deps.continued(
          session,
          actor.userId,
          card.provider,
          card.externalUserId,
        );
      } catch {
        // The decision was accepted: never repeat it because a reply or send failed.
        return {
          outcome:
            button === 'approve'
              ? ('handled' as const)
              : ('discarded' as const),
          message: t('imCards.nativeApproval.recorded'),
        };
      }
      return {
        outcome:
          button === 'approve' ? ('handled' as const) : ('discarded' as const),
        message: t(
          button === 'approve'
            ? 'imCards.nativeApproval.approved'
            : 'imCards.nativeApproval.rejected',
        ),
      };
    },
  });
}

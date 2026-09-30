/**
 * 审批卡片 for personnel actions (V1-04): sent to each approver of a level
 * when the level becomes pending. 同意 / 驳回 call the same `decideAction`
 * as the approval page, as the card's recipient, marked `via: 'feishuCard'`
 * (shown as 经飞书卡片 on the approval record). The card shows only what a
 * decision needs — who, what change, which departments, the effective date —
 * and links to the action for the change checklist and everything else.
 */
import { z } from 'zod';

import type { HrCoreService, PersonnelAction } from '../core-service.js';
import type { OrganizationService } from '../organization-service.js';
import { HrError } from '../shared.js';
import { defineCardKind, type Translate } from './types.js';

export const APPROVAL_CARD = 'personnelActionApproval';

const payloadSchema = z.object({
  actionId: z.string().min(1).max(64),
  level: z.number().int().min(1).max(20),
});
export type ApprovalCardPayload = z.infer<typeof payloadSchema>;

export function approvalCardKind(deps: {
  readonly organization: Pick<
    OrganizationService,
    'getDepartment' | 'titleText'
  >;
  readonly core: () => HrCoreService;
}) {
  async function titles(ids: (string | null)[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of ids) {
      if (!id || names.has(id)) continue;
      const department = await deps.organization.getDepartment(id);
      // Seeded titles are translation keys; titleText resolves them.
      if (department)
        names.set(id, deps.organization.titleText(department.title));
    }
    return names;
  }

  async function read(
    actor: Parameters<HrCoreService['getAction']>[0],
    id: string,
  ): Promise<PersonnelAction | undefined> {
    try {
      return await deps.core().getAction(actor, id);
    } catch (error) {
      if (error instanceof HrError && error.status === 403) return undefined;
      throw error;
    }
  }

  function isOpen(action: PersonnelAction, level: number): boolean {
    return (
      action.status === 'pending' &&
      action.approvals.find((s) => s.status === 'pending')?.level === level
    );
  }

  function stateText(
    action: PersonnelAction,
    level: number,
    t: Translate,
  ): string {
    const step = action.approvals.find((s) => s.level === level);
    const decided =
      step?.status === 'approved'
        ? t('imCards.approval.approved')
        : step?.status === 'rejected'
          ? t('imCards.approval.rejected')
          : null;
    const now = t(`imCards.approval.status.${action.status}`);
    return [t('imCards.state.handled'), decided, now]
      .filter(Boolean)
      .join(' · ');
  }

  return defineCardKind({
    kind: APPROVAL_CARD,
    payload: payloadSchema,

    async render({ payload, actor, t }) {
      const link = {
        label: t('imCards.openInApp'),
        path: `/talent/actions/${payload.actionId}`,
      };
      const action = await read(actor, payload.actionId);
      if (!action)
        return {
          title: t('imCards.approval.title'),
          lines: [],
          buttons: [],
          link,
          state: 'handled',
          stateText: t('imCards.state.unavailable'),
        };
      const type = t(`notifications.actionTypes.${action.actionType}`);
      const names = await titles([
        action.fromDepartmentId,
        action.toDepartmentId,
      ]);
      const from = action.fromDepartmentId
        ? names.get(action.fromDepartmentId)
        : undefined;
      const to = action.toDepartmentId
        ? names.get(action.toDepartmentId)
        : undefined;
      // "王磊 · 调岗 · 机加工车间 → 装配车间": nothing sensitive, only what the decision needs.
      const move =
        from && to && from !== to ? `${from} → ${to}` : (to ?? from ?? null);
      const lines = [
        [action.employeeName ?? '', type, move].filter(Boolean).join(' · '),
        t('imCards.approval.effectiveDate', { date: action.effectiveDate }),
        t('imCards.approval.applicant', {
          name: action.applicantName ?? '',
          level: payload.level,
        }),
      ];
      const open = isOpen(action, payload.level);
      return {
        title: t('imCards.approval.title', { type }),
        lines,
        buttons: open
          ? [
              {
                key: 'approve',
                label: t('imCards.approval.approve'),
                style: 'primary',
              },
              {
                key: 'reject',
                label: t('imCards.approval.reject'),
                style: 'danger',
                comment: 'required',
              },
            ]
          : [],
        link,
        state: open ? 'open' : 'handled',
        stateText: open ? undefined : stateText(action, payload.level, t),
      };
    },

    async act({ payload, actor, button, comment, t }) {
      if (button !== 'approve' && button !== 'reject')
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      const action = await read(actor, payload.actionId);
      if (!action)
        return {
          outcome: 'refused',
          message: t('imCards.approval.notApprover'),
        };
      if (!isOpen(action, payload.level))
        return {
          outcome: 'handled',
          message: t('imCards.result.alreadyHandled'),
        };
      if (button === 'reject' && !comment)
        return {
          outcome: 'kept',
          message: t('imCards.approval.commentRequired'),
        };
      try {
        await deps
          .core()
          .decideAction(actor, payload.actionId, button, comment, 'feishuCard');
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
        switch (error.code) {
          case 'ACTION_NOT_PENDING':
            return {
              outcome: 'handled',
              message: t('imCards.result.alreadyHandled'),
            };
          case 'ACTION_REJECT_COMMENT_REQUIRED':
            return {
              outcome: 'kept',
              message: t('imCards.approval.commentRequired'),
            };
          case 'ACTION_SELF_APPROVAL':
            return {
              outcome: 'refused',
              message: t('imCards.approval.selfApproval'),
            };
          case 'ACTION_NOT_APPROVER':
          case 'ACTION_NOT_FOUND':
          case 'FORBIDDEN':
            return {
              outcome: 'refused',
              message: t('imCards.approval.notApprover'),
            };
          default:
            return {
              outcome: 'kept',
              message: t('imCards.result.failed', { code: error.code }),
            };
        }
      }
      return {
        outcome: 'handled',
        message:
          button === 'approve'
            ? t('imCards.approval.approvedDone')
            : t('imCards.approval.rejectedDone'),
      };
    },
  });
}

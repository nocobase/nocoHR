/**
 * 飞书卡片 (V1-04, 总纲 AI 员工约定第 10 条): interactive cards the office-suite
 * bot sends to one bound user, so an employee can submit what the HR
 * assistant drafted and an approver can decide, without leaving the office
 * suite. Everything else (confirming AI content, conflicts, publishing,
 * sending out) stays in NocoHR: a card only links there.
 *
 * ## Registering a card kind (for later steps: leave submit, missed-punch /
 * ## exception submit, leave / adjustment approval, …)
 *
 * ```ts
 * // In the provider that owns the business rule (server/providers/hr/index.ts
 * // boot), after the channel exists:
 * container.resolve(imChannelToken).cards.register(defineCardKind({
 *   kind: 'leaveApproval',                 // unique, stable: stored on each card
 *   payload: z.object({ requestId: z.string(), level: z.number() }),
 *   // Current state, from the business tables — called whenever a card is
 *   // sent, clicked or shown. `actor` is the card's recipient.
 *   async render({ payload, actor, t, card }) {
 *     return {
 *       title: t('imCards.leaveApproval.title'),
 *       lines: ['钱进 · 事假 · 10-10 全天'],   // summary only, no sensitive fields
 *       buttons: open ? [{ key: 'approve', label: t('imCards.approve'), style: 'primary' },
 *                        { key: 'reject', label: t('imCards.reject'), style: 'danger', comment: 'required' }] : [],
 *       link: { label: t('imCards.openInApp'), path: `/talent/leave/${payload.requestId}` },
 *       state: open ? 'open' : 'handled',
 *       stateText: open ? undefined : t('imCards.state.handled'),
 *     };
 *   },
 *   // A button press by the recipient, identified by binding and signature.
 *   // Call the same service method the app's page calls, as `actor`, and
 *   // mark the operation as made on a card (e.g. via / source 'feishuCard').
 *   async act({ payload, actor, button, comment, t }) {
 *     await leave.decide(actor, payload.requestId, button, comment, 'feishuCard');
 *     return { outcome: 'handled', message: t('imCards.approval.approved') };
 *   },
 * }));
 *
 * // Where the business step happens (outside any database transaction):
 * await channel.cards.send({
 *   kind: 'leaveApproval', recipientUserId, refType: 'leaveRequest', refId: id,
 *   dedupeKey: `leaveApproval:${id}:${level}:${recipientUserId}`,
 *   payload: { requestId: id, level },
 * });
 * // After a decision made elsewhere (the app page), refresh sent cards:
 * await channel.cards.refresh('leaveRequest', id);
 * ```
 *
 * Rules the framework enforces, so a kind need not: a callback must carry a
 * valid signature (checked by the route) and come from the user the card was
 * sent to (found by binding); a callback id is handled once; a card that is
 * no longer open answers "已处理" with its latest state and runs nothing.
 * A kind still must: authorize through the business service as `actor`,
 * keep sensitive fields (mobile, ID number, address, salary amounts) out of
 * `lines`, and clear drafted values from the payload once handled.
 */
import type { ZodType } from 'zod';

import type { ActorContext } from '../framework-service.js';

export type ImProvider = 'feishu' | 'dingtalk' | 'wecom';

export interface CardButton {
  /** What the callback names; unique within the card. */
  readonly key: string;
  readonly label: string;
  readonly style?: 'primary' | 'danger' | 'default';
  /** The button asks for a comment first (驳回须填意见). */
  readonly comment?: 'required' | 'optional';
}

export interface CardView {
  readonly title: string;
  /** Summary lines; never mobile, ID number, address or salary amounts. */
  readonly lines: readonly string[];
  /** Empty once the card is no longer open. */
  readonly buttons: readonly CardButton[];
  /** An app-internal path (such as `/talent/actions/…`) and its label. */
  readonly link?: { readonly label: string; readonly path: string };
  readonly state: 'open' | 'handled' | 'discarded';
  /** The latest state in words, such as "已处理 · 已同意". */
  readonly stateText?: string;
}

export interface StoredCard {
  readonly id: string;
  readonly provider: ImProvider;
  readonly kind: string;
  readonly recipientUserId: string;
  readonly externalUserId: string;
  readonly refType: string;
  readonly refId: string;
  readonly status: 'open' | 'handled' | 'discarded';
  readonly resultText: string | null;
  readonly handledAt: string | null;
  readonly createdAt: string;
}

export type Translate = (
  key: string,
  values?: Record<string, unknown>,
) => string;

export interface CardActResult<P> {
  /**
   * handled / discarded close the card; kept leaves it open (for example a
   * missing comment); refused leaves it open and changed nothing (not the
   * current approver).
   */
  readonly outcome: 'handled' | 'discarded' | 'kept' | 'refused';
  /** Shown to the operator. */
  readonly message: string;
  /** Replaces the stored payload, e.g. to clear drafted values once submitted. */
  readonly payload?: P;
}

export interface CardKindDefinition<P> {
  readonly kind: string;
  /** Validates the stored payload before each render and act. */
  readonly payload: ZodType<P>;
  render(input: {
    readonly card: StoredCard;
    readonly payload: P;
    /** The card's recipient, with that user's own authorization. */
    readonly actor: ActorContext;
    readonly t: Translate;
  }): Promise<CardView>;
  act(input: {
    readonly card: StoredCard;
    readonly payload: P;
    /** The operator: always the card's recipient. */
    readonly actor: ActorContext;
    readonly button: string;
    readonly comment: string | null;
    readonly t: Translate;
  }): Promise<CardActResult<P>>;
}

/** Keeps a kind's payload type through registration. */
export function defineCardKind<P>(
  definition: CardKindDefinition<P>,
): CardKindDefinition<P> {
  return definition;
}

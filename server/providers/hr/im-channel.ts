/**
 * 办公软件机器人 · 渠道适配层 (V1-04). The AI employee plugin has no external
 * channels and the notification plugin cannot reach one user in an office
 * suite, so this adapter receives and sends messages, identifies the user,
 * carries interactive cards and pushes notifications; the conversation
 * itself is the AI employee plugin's, run as that user with the same tools
 * and scope as in the app.
 *
 * - A group mention gets "请私聊提问" and never reaches an AI employee.
 * - The sender is found through the V1-03 binding (`employees.externalUserId`);
 *   without a bound employee with a NocoHR account the message stops here.
 *   (No office-suite sign-in plugin is installed, so there is no sign-in
 *   binding to try first.)
 * - The question is routed like the app's entry. When the HR assistant
 *   drafts the employee's own change (its `submitMyProfileChange` tool waits
 *   for approval), the draft becomes a 本人提交 card instead; other
 *   confirmations stay in NocoHR.
 * - Replies are masked: mobile and ID numbers never leave in full, even the
 *   user's own, and a NocoHR link is added.
 * - A message id is handled once. Signatures are checked by the route.
 *
 * Cards (`cards`, see im-cards/types.ts for registering a kind) and per-user
 * push (`push`, im-cards/push.ts) live beside it and share the transport:
 * the development mock (模拟渠道) outside production, nothing in production
 * until a real Feishu transport is configured.
 */
import { AIUnavailableError, type AIRunner } from './ai-runner.js';
import type { AiEntryService } from './ai-entry-service.js';
import { scopeForUser } from './authorize.js';
import { channelContext, type ConversationChannel } from './channel-context.js';
import type { HrCoreService } from './core-service.js';
import { APPROVAL_CARD, approvalCardKind } from './im-cards/approval-card.js';
import {
  PROFILE_CHANGE_CARD,
  profileChangeCardKind,
} from './im-cards/profile-change-card.js';
import { createImPush } from './im-cards/push.js';
import { createImCards, recordOnce } from './im-cards/service.js';
import {
  createMockTransport,
  createUnconfiguredTransport,
} from './im-cards/transport.js';
import type { Translate } from './im-cards/types.js';
import type { Platform } from './platform.js';
import { HrError, isRecord, newId } from './shared.js';

export interface IncomingMessage {
  readonly provider: Exclude<ConversationChannel, 'app'>;
  readonly messageId: string;
  readonly chatType: 'p2p' | 'group';
  readonly senderExternalId: string;
  readonly text: string;
}

export function maskSensitive(text: string): string {
  return text
    .replace(/\b(\d{6})\d{8}(\d{3}[\dXx])\b/gu, '$1********$2')
    .replace(/\b(1\d{2})\d{4}(\d{4})\b/gu, '$1****$2');
}

/**
 * Extension point for later steps (V2-05 考勤异常追问): a hook may claim a
 * message as the answer to a question the bot asked (the HR assistant then
 * gets the note with it, or `fallback` answers when no model is available),
 * and after an HR assistant turn may turn the drafts it made into 本人提交
 * cards.
 */
export interface BotTurnHook {
  claim?(input: {
    readonly userId: string;
    readonly provider: IncomingMessage['provider'];
    readonly text: string;
  }): Promise<{ note: string; fallback(): Promise<string> } | undefined>;
  afterTurn?(input: {
    readonly userId: string;
    readonly provider: IncomingMessage['provider'];
    /** When the turn started: drafts made since then are this turn's. */
    readonly since: Date;
  }): Promise<{ cards: string[]; reply: string } | undefined>;
}

/** Told to the HR assistant with each bot message, so a drafted change comes back as a card. */
const BOT_NOTE =
  '【渠道：飞书私聊】起草本人信息修改时，整理好变更后直接调用 submitMyProfileChange，系统会把变更前后发给本人一张卡片确认，不需要先在对话里确认。\n\n';

export function createImChannel(deps: {
  readonly platform: Platform;
  readonly entry: () => AiEntryService;
  readonly ai: AIRunner;
  readonly core: () => HrCoreService;
  readonly publicUrl: (path: string) => string;
  /** The server locale's `hr` strings in the application's default language. */
  readonly translate: () => Promise<Translate>;
  readonly warn: (detail: Record<string, unknown>, message: string) => void;
  /** production: no transport until one is configured; otherwise the mock channel. */
  readonly production: boolean;
}) {
  const { platform } = deps;
  const { database } = platform;
  const mock = deps.production ? undefined : createMockTransport();
  const transport = mock ?? createUnconfiguredTransport();
  const cards = createImCards({
    database,
    authz: platform.authz,
    transport,
    translate: deps.translate,
  });
  cards.register(
    approvalCardKind({ organization: platform.organization, core: deps.core }),
  );
  const profileChange = profileChangeCardKind({ database, core: deps.core });
  cards.register(profileChange.kind);
  const push = createImPush({
    database,
    transport,
    cards,
    bindings: cards.bindings,
    publicUrl: deps.publicUrl,
    warn: deps.warn,
  });
  // One conversation per user and channel, kept in memory: a restart starts a new one.
  const sessions = new Map<string, string>();
  const hooks: BotTurnHook[] = [];

  async function afterTurn(
    userId: string,
    provider: IncomingMessage['provider'],
    since: Date,
  ) {
    for (const hook of hooks) {
      const result = await hook.afterTurn?.({ userId, provider, since });
      if (result?.cards.length) return result;
    }
    return undefined;
  }

  /**
   * Turns a drafted change into a 本人提交 card for its own employee. Fields
   * the employee may not change themselves are refused before any card.
   */
  async function draftProfileChange(
    userId: string,
    changes: unknown,
    provider: IncomingMessage['provider'] = 'feishu',
  ) {
    if (!isRecord(changes) || !Object.keys(changes).length)
      throw new HrError('INVALID_INPUT', 400);
    const display = await profileChange.describe(
      userId,
      changes,
      await deps.translate(),
    );
    return cards.send({
      kind: PROFILE_CHANGE_CARD,
      provider,
      recipientUserId: userId,
      refType: 'profileChangeDraft',
      refId: userId,
      dedupeKey: `${PROFILE_CHANGE_CARD}:${userId}:${newId()}`,
      payload: { changes, display },
    });
  }

  return {
    cards,
    push,
    draftProfileChange,
    /** Adds a bot turn hook (see BotTurnHook). */
    addHook(hook: BotTurnHook): void {
      hooks.push(hook);
    },
    /**
     * A bot message to one bound user (the HR assistant's own question, such
     * as 考勤异常追问); `notBound` without a binding. Never used for groups.
     */
    async sendText(
      userId: string,
      text: string,
      provider: IncomingMessage['provider'] = 'feishu',
    ): Promise<'sent' | 'notBound' | 'failed'> {
      const externalUserId = await cards.bindings.externalOf(provider, userId);
      if (!externalUserId) return 'notBound';
      try {
        await transport.sendText({ provider, externalUserId }, text);
        return 'sent';
      } catch {
        return 'failed';
      }
    },
    /** What the mock transport "sent" to one member, for 模拟渠道; undefined in production. */
    mockOutbox: mock
      ? (externalUserId: string) => mock.outbox(externalUserId)
      : undefined,

    async handle(message: IncomingMessage): Promise<{
      reply: string;
      handledBy: string | null;
      duplicate?: boolean;
      /** Cards this message produced, such as a 本人提交 card. */
      cards?: string[];
    }> {
      if (!message.text.trim()) throw new HrError('INVALID_INPUT', 400);
      const t = await deps.translate();
      if (
        !(await recordOnce(
          database,
          `im:${message.provider}:${message.messageId}`,
        ))
      )
        return { reply: '', handledBy: null, duplicate: true };
      if (message.chatType === 'group')
        return { reply: t('imBot.groupOnly'), handledBy: null };
      const userId = await cards.bindings.userOf(
        message.provider,
        message.senderExternalId,
      );
      if (!userId) return { reply: t('imBot.unbound'), handledBy: null };
      const ctx = { userId, authz: await scopeForUser(platform.authz, userId) };
      // V2-05: an answer to the bot's own question (考勤异常追问) goes to the HR assistant with its context.
      let claimed: Awaited<ReturnType<NonNullable<BotTurnHook['claim']>>>;
      for (const hook of hooks) {
        claimed = await hook.claim?.({
          userId,
          provider: message.provider,
          text: message.text,
        });
        if (claimed) break;
      }
      const route = claimed
        ? undefined
        : await deps.entry().route(ctx, message.text);
      const employee = route?.employee ?? 'hrAssistant';
      // V2-06: pay questions never reach the model in an office-suite chat — a link to the payslip page only, no amounts.
      if (
        route?.key === 'myPay' ||
        /工资|薪资|薪水|工资条|社保|公积金|个税|扣税/u.test(message.text)
      )
        return {
          reply: t('imBot.payLinkOnly', {
            link: deps.publicUrl('/talent/my-payslips'),
          }),
          handledBy: employee,
        };
      const sessionKey = `${message.provider}:${userId}:${employee}`;
      const link = deps.publicUrl('/talent/ask');
      const since = new Date(Date.now() - 1);
      // Drafts the HR assistant made in this turn (请假单、补卡单、考勤异常说明) come as 本人提交 cards.
      const withCards = async (body: string, cardLine = true) => {
        const drafted =
          employee === 'hrAssistant'
            ? await afterTurn(userId, message.provider, since)
            : undefined;
        const text =
          drafted && cardLine ? `${body}\n\n${drafted.reply}` : body;
        return {
          reply: `${maskSensitive(text)}\n\n${t('imBot.viewInApp', { link })}`,
          handledBy: employee,
          ...(drafted ? { cards: drafted.cards } : {}),
        };
      };
      try {
        const answer = await channelContext.run(message.provider, () =>
          deps.ai.reply({
            employee: employee,
            userId,
            title: `${message.provider} · ${message.text.slice(0, 30)}`,
            text:
              employee === 'hrAssistant'
                ? `${BOT_NOTE}${claimed?.note ?? ''}${message.text}`
                : message.text,
            timeZone: platform.timeZone,
            sessionId: sessions.get(sessionKey),
          }),
        );
        if (answer.paused) {
          // A paused conversation cannot take the next message; the next one starts afresh.
          sessions.delete(sessionKey);
          const draft = answer.pending.find(
            (call) => call.name === 'submitMyProfileChange',
          );
          const changes =
            draft && isRecord(draft.args) ? draft.args.changes : undefined;
          if (changes !== undefined) {
            try {
              const sent = await draftProfileChange(
                userId,
                changes,
                message.provider,
              );
              if (sent.status !== 'notBound')
                return {
                  reply: `${t('imBot.cardSent')}\n\n${t('imBot.viewInApp', { link })}`,
                  handledBy: employee,
                  cards: [sent.cardId],
                };
            } catch (error) {
              if (!(error instanceof HrError)) throw error;
              return {
                reply: `${t('imBot.fieldNotAllowed')}\n\n${t('imBot.viewInApp', { link })}`,
                handledBy: employee,
              };
            }
          }
        } else sessions.set(sessionKey, answer.sessionId);
        const body = answer.paused
          ? t('imBot.confirmInApp')
          : answer.text || t('imBot.noAnswer');
        return await withCards(body);
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        if (claimed) return await withCards(await claimed.fallback(), false);
        return { reply: t('imBot.unavailable'), handledBy: null };
      }
    },
  };
}

export type ImChannel = ReturnType<typeof createImChannel>;
export { APPROVAL_CARD, PROFILE_CHANGE_CARD };

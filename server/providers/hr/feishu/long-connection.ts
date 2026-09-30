/**
 * The Feishu long connection (V1-04) for a self-built app: events and card
 * callbacks arrive over a socket the server opens, so a laptop or an
 * intranet server needs no public callback URL. Choose 使用长连接 in the
 * app's 事件与回调 settings; Feishu only lets that be saved while a client
 * is connected.
 *
 * - `im.message.receive_v1`: a text message becomes the channel's incoming
 *   message; the reply is sent back through the transport. The event is
 *   acknowledged at once and answered in the background, because an AI
 *   answer can outlast Feishu's delivery timeout (a redelivery is dropped by
 *   the channel's message-id dedupe).
 * - `card.action.trigger`: a button press becomes the card framework's
 *   callback, as the operator's `user_id`; the answer is a toast and the
 *   card in its latest state.
 *
 * Other message types get a short hint. Logs name event ids and codes only,
 * never message text.
 */
import {
  EventDispatcher,
  LoggerLevel,
  WSClient,
} from '@larksuiteoapi/node-sdk';

import type { CardCallback, CardCallbackResult } from '../im-cards/service.js';
import type { ImTransport } from '../im-cards/transport.js';
import type { IncomingMessage } from '../im-channel.js';
import { isRecord } from '../shared.js';
import { renderFeishuCard } from './transport.js';

export interface FeishuLongConnectionDeps {
  readonly appId: string;
  readonly appSecret: string;
  readonly baseUrl: string;
  readonly transport: ImTransport;
  readonly link: (path: string) => string;
  readonly handleMessage: (
    message: IncomingMessage,
  ) => Promise<{ reply: string; duplicate?: boolean }>;
  readonly handleCardAction: (
    callback: CardCallback,
  ) => Promise<CardCallbackResult>;
  /** Shown to a member who sent something other than text. */
  readonly textOnly: () => Promise<string>;
  readonly log: {
    info(detail: Record<string, unknown>, message: string): void;
    warn(detail: Record<string, unknown>, message: string): void;
  };
}

/** Message text with the bot's own @-mention placeholders (`@_user_1`) removed. */
export function messageText(content: string): string | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isRecord(parsed) || typeof parsed.text !== 'string') return null;
    return parsed.text.replace(/@_user_\d+/gu, '').trim();
  } catch {
    return null;
  }
}

export function startFeishuLongConnection(deps: FeishuLongConnectionDeps): {
  close(): void;
} {
  const quiet = (...parts: unknown[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : ''))
      .join(' ')
      .slice(0, 300);
  const logger = {
    error: (...m: unknown[]) => deps.log.warn({}, `feishu: ${quiet(...m)}`),
    warn: (...m: unknown[]) => deps.log.warn({}, `feishu: ${quiet(...m)}`),
    info: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
  };

  const dispatcher = new EventDispatcher({
    logger,
    loggerLevel: LoggerLevel.warn,
  });
  dispatcher.register({
    'im.message.receive_v1': (data) => {
      const senderId = data.sender.sender_id?.user_id;
      const { message } = data;
      if (!senderId) {
        deps.log.warn(
          { eventId: data.event_id },
          'feishu message without user_id (grant 获取用户 user ID)',
        );
        return;
      }
      const to = { provider: 'feishu' as const, externalUserId: senderId };
      void (async () => {
        try {
          const text =
            message.message_type === 'text'
              ? messageText(message.content)
              : null;
          if (!text) {
            await deps.transport.sendText(to, await deps.textOnly());
            return;
          }
          const result = await deps.handleMessage({
            provider: 'feishu',
            messageId: message.message_id,
            chatType: message.chat_type === 'p2p' ? 'p2p' : 'group',
            senderExternalId: senderId,
            text: text.slice(0, 2000),
          });
          if (result.reply && !result.duplicate)
            await deps.transport.sendText(to, result.reply);
        } catch (error) {
          deps.log.warn(
            {
              eventId: data.event_id,
              error: error instanceof Error ? error.message : String(error),
            },
            'feishu message handling failed',
          );
        }
      })();
    },
    'card.action.trigger': async (data: {
      token?: string;
      event_id?: string;
      operator?: { user_id?: string };
      action?: { value?: unknown };
      context?: { open_message_id?: string };
    }) => {
      const value = isRecord(data.action?.value) ? data.action.value : {};
      const operatorId = data.operator?.user_id;
      if (
        typeof value.cardId !== 'string' ||
        typeof value.button !== 'string' ||
        !operatorId
      )
        return { toast: { type: 'error', content: 'Unsupported button' } };
      const result = await deps.handleCardAction({
        provider: 'feishu',
        callbackId: String(
          data.token ??
            data.event_id ??
            `${data.context?.open_message_id ?? ''}:${value.button}`,
        ).slice(0, 128),
        operatorId,
        cardId: value.cardId,
        button: value.button,
        comment: null,
      });
      return {
        toast: {
          type: result.ok ? 'success' : 'info',
          content: result.message,
        },
        ...(result.card
          ? {
              card: {
                type: 'raw',
                data: renderFeishuCard(value.cardId, result.card, deps.link),
              },
            }
          : {}),
      };
    },
  } as Parameters<EventDispatcher['register']>[0]);

  const client = new WSClient({
    appId: deps.appId,
    appSecret: deps.appSecret,
    domain: deps.baseUrl,
    logger,
    loggerLevel: LoggerLevel.warn,
    autoReconnect: true,
    onReady: () => deps.log.info({}, 'feishu long connection ready'),
    onError: (error) =>
      deps.log.warn({ error: error.message }, 'feishu long connection failed'),
  });
  void client.start({ eventDispatcher: dispatcher });
  return { close: () => client.close({ force: true }) };
}

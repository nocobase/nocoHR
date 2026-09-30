/**
 * The real Feishu bot transport (V1-04), replacing the development mock
 * when a self-built app is configured. Messages go to one member by
 * `user_id` (the id the directory sync binds):
 *
 * - text: `msg_type: text`;
 * - a card: `msg_type: interactive`, rendered from the card's `CardView`;
 *   its message id is kept on the card (`imCards.externalMessageId`) so a
 *   later state change replaces the same message instead of sending a new
 *   one. Buttons carry only `{ cardId, button }`; the long connection turns
 *   a press into the framework's card callback.
 * - A button that needs a comment (驳回须填意见) opens the NocoHR page
 *   instead, since a plain card button cannot collect text.
 *
 * Links are absolute (`link(path)`), since a Feishu message has no base URL.
 */
import type { CardView } from '../im-cards/types.js';
import type { ImAddress, ImTransport } from '../im-cards/transport.js';
import type { FeishuApi } from './api.js';

export interface CardMessageStore {
  get(cardId: string): Promise<string | null>;
  set(cardId: string, messageId: string): Promise<void>;
}

type FeishuElement = Record<string, unknown>;

export function renderFeishuCard(
  cardId: string,
  view: CardView,
  link: (path: string) => string,
): Record<string, unknown> {
  const text = (content: string) => ({ tag: 'plain_text', content });
  const elements: FeishuElement[] = [];
  if (view.lines.length)
    elements.push({ tag: 'div', text: text(view.lines.join('\n')) });
  if (view.stateText)
    elements.push({ tag: 'note', elements: [text(view.stateText)] });
  const actions: FeishuElement[] = view.buttons.map((button) => {
    const type =
      button.style === 'danger'
        ? 'danger'
        : button.style === 'primary'
          ? 'primary'
          : 'default';
    if (button.comment === 'required' && view.link)
      return {
        tag: 'button',
        text: text(button.label),
        type,
        url: link(view.link.path),
      };
    return {
      tag: 'button',
      text: text(button.label),
      type,
      value: { cardId, button: button.key },
    };
  });
  if (view.link)
    actions.push({
      tag: 'button',
      text: text(view.link.label),
      type: 'default',
      url: link(view.link.path),
    });
  if (actions.length) elements.push({ tag: 'action', actions });
  return {
    // update_multi: the card may be replaced later with its latest state.
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: text(view.title),
      template: view.state === 'open' ? 'blue' : 'grey',
    },
    elements,
  };
}

export function createFeishuTransport(deps: {
  readonly api: FeishuApi;
  readonly link: (path: string) => string;
  readonly messages: CardMessageStore;
}): ImTransport {
  async function send(
    to: ImAddress,
    msgType: 'text' | 'interactive',
    content: unknown,
  ): Promise<string | null> {
    if (to.provider !== 'feishu') throw new Error('IM_PROVIDER_UNSUPPORTED');
    const reply = await deps.api.call<{ message_id?: string }>(
      '/im/v1/messages?receive_id_type=user_id',
      {
        method: 'POST',
        body: {
          receive_id: to.externalUserId,
          msg_type: msgType,
          content: JSON.stringify(content),
        },
      },
    );
    return reply.message_id ?? null;
  }

  return {
    name: 'feishu',
    async sendText(to, text) {
      await send(to, 'text', { text });
    },
    async sendCard(to, cardId, view) {
      const messageId = await send(
        to,
        'interactive',
        renderFeishuCard(cardId, view, deps.link),
      );
      if (messageId) await deps.messages.set(cardId, messageId);
    },
    async updateCard(to, cardId, view) {
      const messageId = await deps.messages.get(cardId);
      if (!messageId) {
        // Never delivered (or sent by the mock before): send it now in its latest state.
        await this.sendCard(to, cardId, view);
        return;
      }
      await deps.api.call(`/im/v1/messages/${encodeURIComponent(messageId)}`, {
        method: 'PATCH',
        body: {
          content: JSON.stringify(renderFeishuCard(cardId, view, deps.link)),
        },
      });
    },
  };
}

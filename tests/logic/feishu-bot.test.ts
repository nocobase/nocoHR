// @vitest-environment node

// The real Feishu bot pieces without a tenant: message text parsing, card rendering (buttons carry only the card id,
// a comment-required button opens the app, links are absolute, handled cards turn grey), and the transport's sends and
// in-place card update by the stored message id.
import { describe, expect, it } from 'vitest';

import { createFeishuApi } from '../../server/providers/hr/feishu/api.ts';
import { messageText } from '../../server/providers/hr/feishu/long-connection.ts';
import {
  createFeishuTransport,
  renderFeishuCard,
} from '../../server/providers/hr/feishu/transport.ts';

const link = (path: string) => `http://localhost:13310/main${path}`;

describe('Feishu message text', () => {
  it('reads text content and drops @-mention placeholders', () => {
    expect(messageText('{"text":"@_user_1 我的年假还有几天"}')).toBe(
      '我的年假还有几天',
    );
    expect(messageText('{"image_key":"img_1"}')).toBeNull();
    expect(messageText('not json')).toBeNull();
  });
});

describe('Feishu card rendering', () => {
  it('renders an open approval card', () => {
    const card = renderFeishuCard(
      'card-1',
      {
        title: '请假审批',
        lines: ['王磊 · 年假 · 10-10 全天'],
        buttons: [
          { key: 'approve', label: '同意', style: 'primary' },
          {
            key: 'reject',
            label: '驳回',
            style: 'danger',
            comment: 'required',
          },
        ],
        link: { label: '在 NocoHR 查看', path: '/talent/leave/1' },
        state: 'open',
      },
      link,
    );
    expect(card).toMatchObject({
      config: { update_multi: true },
      header: { title: { content: '请假审批' }, template: 'blue' },
    });
    const elements = card.elements as Record<string, unknown>[];
    expect(elements[0]).toMatchObject({
      tag: 'div',
      text: { content: '王磊 · 年假 · 10-10 全天' },
    });
    const actions = (elements.at(-1) as { actions: Record<string, unknown>[] })
      .actions;
    expect(actions[0]).toMatchObject({
      type: 'primary',
      value: { cardId: 'card-1', button: 'approve' },
    });
    expect(actions[1]).toMatchObject({
      type: 'danger',
      url: 'http://localhost:13310/main/talent/leave/1',
    });
    expect(actions[1]).not.toHaveProperty('value');
    expect(actions[2]).toMatchObject({
      url: 'http://localhost:13310/main/talent/leave/1',
    });
  });

  it('renders a handled card grey with its state and no buttons', () => {
    const card = renderFeishuCard(
      'card-1',
      {
        title: '请假审批',
        lines: ['王磊 · 年假'],
        buttons: [],
        state: 'handled',
        stateText: '已处理 · 已同意',
      },
      link,
    );
    expect(card).toMatchObject({ header: { template: 'grey' } });
    const elements = card.elements as Record<string, unknown>[];
    expect(elements.some((e) => e.tag === 'action')).toBe(false);
    expect(elements[1]).toMatchObject({
      tag: 'note',
      elements: [{ content: '已处理 · 已同意' }],
    });
  });
});

describe('Feishu transport', () => {
  it('sends text and cards by user_id and updates a card in place', async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const fetchImpl = (async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const path = `${url.pathname.replace('/open-apis', '')}${url.search}`;
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method: init?.method ?? 'GET', path, body });
      const reply = path.startsWith('/auth/')
        ? { code: 0, tenant_access_token: 't', expire: 7200 }
        : { code: 0, data: { message_id: 'om_1' } };
      return new Response(JSON.stringify(reply));
    }) as typeof fetch;
    const stored = new Map<string, string>();
    const transport = createFeishuTransport({
      api: createFeishuApi({
        appId: 'cli',
        appSecret: 's',
        baseUrl: 'https://open.feishu.test',
        fetch: fetchImpl,
      }),
      link,
      messages: {
        get: async (id) => stored.get(id) ?? null,
        set: async (id, messageId) => {
          stored.set(id, messageId);
        },
      },
    });
    const to = { provider: 'feishu' as const, externalUserId: 'u-wang' };
    await transport.sendText(to, '你好');
    const view = {
      title: 'T',
      lines: ['a'],
      buttons: [],
      state: 'open' as const,
    };
    await transport.sendCard(to, 'card-1', view);
    await transport.updateCard(to, 'card-1', { ...view, state: 'handled' });
    const sends = calls.filter((c) => !c.path.startsWith('/auth/'));
    expect(sends[0]).toMatchObject({
      method: 'POST',
      path: '/im/v1/messages?receive_id_type=user_id',
      body: {
        receive_id: 'u-wang',
        msg_type: 'text',
        content: '{"text":"你好"}',
      },
    });
    expect(sends[1]).toMatchObject({ body: { msg_type: 'interactive' } });
    expect(stored.get('card-1')).toBe('om_1');
    expect(sends[2]).toMatchObject({
      method: 'PATCH',
      path: '/im/v1/messages/om_1',
    });
  });
});

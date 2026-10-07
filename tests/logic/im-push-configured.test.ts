import { describe, expect, it, vi } from 'vitest';

import { createImPush } from '../../server/providers/hr/im-cards/push.ts';
import type { ImTransport } from '../../server/providers/hr/im-cards/transport.ts';

// 我的档案 · 通知设置 listed Feishu as enabled on an installation without FEISHU_APP_ID / FEISHU_APP_SECRET, where
// the transport is `none` and nothing can deliver.

function pushWith(name: ImTransport['name']) {
  const sendText = vi.fn(async () => undefined);
  const query = {
    selectFrom: () => query,
    select: () => query,
    where: () => query,
    executeTakeFirst: async () => undefined,
    insertInto: () => query,
    values: () => query,
    execute: async () => [],
  };
  const push = createImPush({
    database: { query: () => query } as never,
    transport: {
      name,
      sendText,
      sendCard: vi.fn(),
      updateCard: vi.fn(),
    } as unknown as ImTransport,
    cards: { refresh: async () => undefined } as never,
    bindings: { externalOf: async () => 'ou_bound' } as never,
    publicUrl: (path) => path,
    warn: () => undefined,
  });
  return { push, sendText };
}

describe('the Feishu channel without credentials', () => {
  it('is listed as not configured and not enabled, and nothing is sent', async () => {
    const { push, sendText } = pushWith('none');
    expect((await push.settingsFor('u1')).channels).toEqual([
      { provider: 'feishu', configured: false, bound: true, enabled: false },
    ]);
    await push.push({
      key: 'k',
      message: 'm',
      userIds: ['u1'],
      title: '标题',
      summary: null,
    });
    expect(sendText).not.toHaveBeenCalled();
  });

  it('is enabled with a transport (the configured app or the development mock)', async () => {
    const { push } = pushWith('feishu');
    expect((await push.settingsFor('u1')).channels).toEqual([
      { provider: 'feishu', configured: true, bound: true, enabled: true },
    ]);
  });
});

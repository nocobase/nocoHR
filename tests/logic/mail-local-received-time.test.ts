// @vitest-environment node

// 本地文件邮箱: a message is stamped with when it landed in the inbox, as a real mailbox stamps receipt,
// not with its own “Date” header — a demo reply copied in showed before the invitation it answered.
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { localMailProvider } from '../../server/providers/hr/mail/local-provider.ts';

const directory = mkdtempSync(path.join(tmpdir(), 'mail-received-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('local mailbox received time', () => {
  it('uses the file’s arrival, not the Date header', async () => {
    const address = 'recruiting@qiheng.example';
    const inbox = path.join(directory, address, 'inbox');
    mkdirSync(inbox, { recursive: true });
    const file = path.join(inbox, '01-reply.eml');
    writeFileSync(
      file,
      [
        'From: 周迪 <zhoudi@example.com>',
        `To: ${address}`,
        'Subject: Re: 面试邀请',
        'Date: Mon, 05 Oct 2026 19:47:00 +0800',
        'Message-ID: <reply-1@example.com>',
        'Content-Type: text/plain; charset=utf-8',
        '',
        '周四下午可以吗？',
      ].join('\r\n'),
    );
    const arrived = new Date('2026-10-05T12:30:00.000Z');
    utimesSync(file, arrived, arrived);
    const adapter = await localMailProvider.createAdapter(
      {} as never,
      {
        type: 'local-files',
        directory,
        outboxDirectory: path.join(directory, 'outbox'),
      } as never,
      { address } as never,
    );
    const message = await adapter.getMessage('01-reply.eml');
    expect(message.ok).toBe(true);
    if (message.ok)
      expect(message.value.receivedAt).toBe(arrived.toISOString());
  });
});

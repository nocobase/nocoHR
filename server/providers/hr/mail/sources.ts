/**
 * Where a business mailbox's mail comes from, and where mock sends go.
 *
 * - mock (development and demo): `storage/mail/inbox/<purpose>/*.eml`; a file
 *   moves to `processed/` once stored, so running the check again finds
 *   nothing new. Sends are written to `storage/mail/outbox/`.
 * - imap: unseen messages in INBOX, marked seen once stored.
 *
 * The IMAP source is never opened under Vitest, so a developer's `.env.local`
 * cannot make a test read a real mailbox.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type { MailboxConfig } from '../../../config/mail.js';
import type { MailPurpose } from './types.js';

export interface IncomingMail {
  readonly raw: Uint8Array;
  /** Called once the message is stored (or known to be a duplicate). */
  readonly ack: () => Promise<void>;
}

export interface MailSource {
  readonly kind: 'mock' | 'imap';
  fetch(): Promise<IncomingMail[]>;
}

export function mockInboxDir(storageDir: string, purpose: MailPurpose): string {
  return path.join(storageDir, 'mail', 'inbox', purpose);
}

export function mockOutboxDir(storageDir: string): string {
  return path.join(storageDir, 'mail', 'outbox');
}

function mockSource(storageDir: string, purpose: MailPurpose): MailSource {
  const dir = mockInboxDir(storageDir, purpose);
  return {
    kind: 'mock',
    async fetch() {
      mkdirSync(dir, { recursive: true });
      return readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith('.eml'))
        .sort()
        .map((name) => ({
          raw: new Uint8Array(readFileSync(path.join(dir, name))),
          ack: async () => {
            const done = path.join(dir, 'processed');
            mkdirSync(done, { recursive: true });
            renameSync(path.join(dir, name), path.join(done, name));
          },
        }));
    },
  };
}

function imapSource(config: MailboxConfig): MailSource {
  return {
    kind: 'imap',
    async fetch() {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow({
        host: config.imapHost,
        port: config.imapPort,
        secure: config.imapSecure,
        auth: { user: config.imapUser, pass: config.imapPassword },
        logger: false,
      });
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      const items: { uid: number; raw: Uint8Array }[] = [];
      try {
        for await (const message of client.fetch(
          { seen: false },
          { uid: true, source: true },
        ))
          if (message.source)
            items.push({
              uid: message.uid,
              raw: new Uint8Array(message.source),
            });
      } finally {
        lock.release();
      }
      // Seen flags are set once each message is stored, on a fresh connection per batch.
      const seen: number[] = [];
      return items.map((item, index) => ({
        raw: item.raw,
        ack: async () => {
          seen.push(item.uid);
          if (index !== items.length - 1) return;
          const flagLock = await client.getMailboxLock('INBOX');
          try {
            await client.messageFlagsAdd(seen, ['\\Seen'], { uid: true });
          } finally {
            flagLock.release();
            await client.logout().catch(() => undefined);
          }
        },
      }));
    },
  };
}

/** The source for a mailbox, or null when it is off or cannot be used here. */
export function mailSourceFor(input: {
  purpose: MailPurpose;
  config: MailboxConfig;
  storageDir: string;
  production: boolean;
}): MailSource | null {
  const { config } = input;
  if (config.adapter === 'none') return null;
  if (config.adapter === 'mock')
    return input.production
      ? null
      : mockSource(input.storageDir, input.purpose);
  if (process.env.VITEST) return null;
  if (!config.imapHost || !config.imapUser || !config.imapPassword) return null;
  return imapSource(config);
}

/** A mock send: the message as it would have gone out, for the demo and the tests. */
export function writeMockOutbox(
  storageDir: string,
  message: {
    id: string;
    from: string;
    replyTo: string;
    to: string;
    subject: string;
    text: string;
  },
): string {
  const dir = mockOutboxDir(storageDir);
  mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `${new Date().toISOString().replace(/[:.]/gu, '-')}-${message.id}.eml`,
  );
  writeFileSync(
    file,
    [
      `From: ${message.from}`,
      `Reply-To: ${message.replyTo}`,
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      message.text,
      '',
    ].join('\r\n'),
  );
  return file;
}

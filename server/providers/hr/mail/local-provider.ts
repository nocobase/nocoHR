/**
 * 本地文件邮箱 (development, tests and the demo film): a Mail plugin provider
 * whose mailbox is a directory, so the business mailboxes run on the plugin
 * without a mail server and every demo run starts from the same messages.
 *
 * - Mail received: `<directory>/<address>/inbox/*.eml`, read in name order.
 *   Files are never moved; the sync cursor remembers which were seen.
 * - Mail sent: written to `<outboxDirectory>/*.eml` with its Message-ID,
 *   In-Reply-To and References, as it would have gone out.
 * - The password is not checked: there is nothing behind it.
 *
 * The provider refuses to run with NODE_ENV=production (validateConfig), and
 * the application registers it only outside production (server/config/mail.ts
 * configures no instance there), so it can never stand in for a real mailbox.
 */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import type {
  MailAddress,
  MailProviderAdapter,
  MailProviderConfig,
  MailProviderDefinition,
  MailProviderError,
  MailProviderResult,
  NormalizedMailMessage,
} from '@nocobase/app-plugin-mail/server';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';

export const LOCAL_MAIL_PROVIDER_TYPE = 'local-files';

export interface LocalMailProviderConfig extends MailProviderConfig {
  readonly type: typeof LOCAL_MAIL_PROVIDER_TYPE;
  /** Root of the mailboxes: one directory per address, with `inbox/`. */
  readonly directory: string;
  /** Where sent messages are written. */
  readonly outboxDirectory: string;
}

const INBOX = 'INBOX';
const SENT = 'Sent';

const CAPABILITIES = {
  receive: true,
  send: true,
  incrementalSync: true,
  pushNotifications: false,
  folders: true,
  labels: false,
  drafts: false,
  moveMessage: false,
  aliases: false,
} as const;

function failure<T>(code: string, message: string): MailProviderResult<T> {
  const error: MailProviderError = {
    code,
    message,
    category: 'provider',
    retryable: false,
  };
  return { ok: false, error };
}

const inboxOf = (config: LocalMailProviderConfig, address: string): string =>
  path.join(config.directory, address.toLowerCase(), 'inbox');

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.eml'))
    .sort();
}

function addresses(
  value: AddressObject | AddressObject[] | undefined,
): MailAddress[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((o) =>
    o.value
      .filter((a) => a.address)
      .map((a) => ({
        address: a.address!.toLowerCase(),
        ...(a.name ? { name: a.name } : {}),
      })),
  );
}

async function parseFile(file: string): Promise<ParsedMail> {
  return simpleParser(readFileSync(file));
}

function normalize(
  id: string,
  parsed: ParsedMail,
  folder: string,
  arrivedAt?: Date,
): NormalizedMailMessage {
  const references = Array.isArray(parsed.references)
    ? parsed.references
    : parsed.references
      ? [parsed.references]
      : [];
  const text = parsed.text ?? '';
  return {
    providerMessageId: id,
    ...(parsed.messageId ? { internetMessageId: parsed.messageId } : {}),
    providerFolderIds: [folder],
    from: addresses(parsed.from)[0],
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: [],
    replyTo: addresses(parsed.replyTo),
    ...(parsed.inReplyTo ? { inReplyTo: parsed.inReplyTo } : {}),
    references,
    subject: parsed.subject ?? '',
    preview: text.replace(/\s+/gu, ' ').slice(0, 200),
    text,
    ...(typeof parsed.html === 'string' ? { html: parsed.html } : {}),
    // When the file landed in the inbox, as a real mailbox stamps receipt: the “Date” header is the sender's
    // clock, and a demo reply copied in now showed before the invitation it answered.
    receivedAt: (arrivedAt ?? parsed.date ?? new Date()).toISOString(),
    read: false,
    starred: false,
    draft: false,
    contentStatus: 'complete',
    attachments: parsed.attachments.map((a, index) => ({
      providerAttachmentId: `a${index}`,
      fileName: a.filename ?? `attachment-${index + 1}`,
      contentType: a.contentType || 'application/octet-stream',
      size: a.size,
      ...(a.cid ? { contentId: a.cid } : {}),
      inline: a.contentDisposition === 'inline',
    })),
  };
}

const header = (text: string): string =>
  /^[\x20-\x7e]*$/u.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;

const formatAddress = (a: MailAddress): string =>
  a.name ? `${header(a.name)} <${a.address}>` : a.address;

async function streamBytes(
  stream: ReadableStream<Uint8Array>,
): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export const localMailProvider: MailProviderDefinition<LocalMailProviderConfig> =
  {
    type: LOCAL_MAIL_PROVIDER_TYPE,
    label: '本地文件邮箱（开发）',
    capabilities: CAPABILITIES,
    validateConfig(config) {
      if (process.env.NODE_ENV === 'production')
        throw new Error(
          'The local-files mail provider is for development only.',
        );
      if (!config.directory || !config.outboxDirectory)
        throw new Error(
          'local-files needs a directory and an outboxDirectory.',
        );
    },
    connection: {
      async connect(context, _config, input) {
        if (!input.address.trim())
          return failure(
            'LOCAL_ADDRESS_REQUIRED',
            'A mailbox address is required.',
          );
        const credentialReference = await context.credentials.put(
          { address: input.address },
          { purpose: 'account' },
        );
        return {
          ok: true,
          value: {
            address: input.address.toLowerCase(),
            ...(input.displayName ? { displayName: input.displayName } : {}),
            credentialReference,
            scopes: [],
            identities: [
              {
                address: input.address.toLowerCase(),
                ...(input.displayName
                  ? { displayName: input.displayName }
                  : {}),
                isPrimary: true,
                canSend: true,
              },
            ],
          },
        };
      },
    },
    async createAdapter(_context, config, account) {
      const inbox = inboxOf(config, account.address);
      const seenOf = (cursor: { value: unknown } | undefined): Set<string> => {
        const value = cursor?.value;
        if (typeof value !== 'string' || !value) return new Set();
        try {
          return new Set(JSON.parse(value) as string[]);
        } catch {
          return new Set();
        }
      };
      const cursorOf = (ids: readonly string[]) => ({
        value: JSON.stringify([...ids].sort()),
        version: '1',
      });
      const read = async (id: string) =>
        normalize(
          id,
          await parseFile(path.join(inbox, id)),
          INBOX,
          statSync(path.join(inbox, id)).mtime,
        );
      const adapter: MailProviderAdapter = {
        identity: account.provider,
        capabilities: CAPABILITIES,
        async listFolders() {
          return {
            ok: true,
            value: {
              folders: [
                {
                  providerFolderId: INBOX,
                  type: 'inbox',
                  name: 'Inbox',
                  kind: 'folder',
                },
                {
                  providerFolderId: SENT,
                  type: 'sent',
                  name: 'Sent',
                  kind: 'folder',
                },
              ],
              completeProviderFolderIds: [INBOX, SENT],
            },
          };
        },
        async getCurrentSyncCursor() {
          return { ok: true, value: cursorOf(files(inbox)) };
        },
        async listMessages(input) {
          const all = files(inbox);
          const start = Number(input.cursor ?? 0) || 0;
          const limit = Math.max(1, input.limit ?? 100);
          const page = all.slice(start, start + limit);
          const after = input.receivedAfter
            ? Date.parse(input.receivedAfter)
            : 0;
          const messages: NormalizedMailMessage[] = [];
          for (const id of page) {
            const message = await read(id);
            if (!after || Date.parse(message.receivedAt ?? '') >= after)
              messages.push(message);
          }
          const next = start + page.length;
          return {
            ok: true,
            value: {
              historyReady: true,
              messages,
              ...(next < all.length ? { nextCursor: String(next) } : {}),
              syncCursor: cursorOf(all),
            },
          };
        },
        async listChanges(input) {
          const seen = seenOf(input.cursor);
          const all = files(inbox);
          const fresh = all
            .filter((id) => !seen.has(id))
            .slice(0, Math.max(1, input.limit));
          const messages = await Promise.all(fresh.map(read));
          const known = [...seen, ...fresh];
          return {
            ok: true,
            value: {
              messages,
              deletedProviderMessageIds: [],
              nextCursor: cursorOf(known),
              hasMore: all.some((id) => !known.includes(id)),
            },
          };
        },
        async getMessage(providerMessageId) {
          if (!files(inbox).includes(providerMessageId))
            return failure(
              'LOCAL_MESSAGE_NOT_FOUND',
              'The message is not in this mailbox.',
            );
          return { ok: true, value: await read(providerMessageId) };
        },
        async getAttachment(providerMessageId, providerAttachmentId) {
          if (!files(inbox).includes(providerMessageId))
            return failure(
              'LOCAL_MESSAGE_NOT_FOUND',
              'The message is not in this mailbox.',
            );
          const parsed = await parseFile(path.join(inbox, providerMessageId));
          const attachment =
            parsed.attachments[Number(providerAttachmentId.slice(1))];
          if (!attachment)
            return failure(
              'LOCAL_ATTACHMENT_NOT_FOUND',
              'The attachment does not exist.',
            );
          const bytes = new Uint8Array(attachment.content);
          return {
            ok: true,
            value: {
              fileName: attachment.filename ?? providerAttachmentId,
              contentType: attachment.contentType || 'application/octet-stream',
              size: bytes.byteLength,
              stream: new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(bytes);
                  controller.close();
                },
              }),
            },
          };
        },
        async sendMessage(input) {
          const domain = account.address.split('@')[1] ?? 'localhost';
          const messageId =
            input.message.internetMessageId ?? `<${randomUUID()}@${domain}>`;
          const boundary = `----=_local_${randomUUID()}`;
          const from = formatAddress({
            address: input.identity.address,
            ...(input.identity.displayName
              ? { name: input.identity.displayName }
              : {}),
          });
          const lines = [
            `From: ${from}`,
            `To: ${input.message.to.map(formatAddress).join(', ')}`,
            ...(input.message.cc.length
              ? [`Cc: ${input.message.cc.map(formatAddress).join(', ')}`]
              : []),
            `Subject: ${header(input.message.subject)}`,
            `Message-ID: ${messageId}`,
            ...(input.message.inReplyTo
              ? [`In-Reply-To: ${input.message.inReplyTo}`]
              : []),
            ...(input.message.references.length
              ? [`References: ${input.message.references.join(' ')}`]
              : []),
            `Date: ${new Date().toUTCString()}`,
            'MIME-Version: 1.0',
          ];
          // The text stays readable in the outbox file (8bit), as a mail client would show it.
          const body = input.message.text;
          let content: string;
          if (!input.message.attachments.length)
            content = [
              ...lines,
              'Content-Type: text/plain; charset=utf-8',
              'Content-Transfer-Encoding: 8bit',
              '',
              body,
            ].join('\r\n');
          else {
            const parts: string[] = [
              `--${boundary}`,
              'Content-Type: text/plain; charset=utf-8',
              'Content-Transfer-Encoding: 8bit',
              '',
              body,
            ];
            for (const a of input.message.attachments) {
              const bytes = await streamBytes(await a.open());
              parts.push(
                `--${boundary}`,
                `Content-Type: ${a.contentType}; name="${header(a.fileName)}"`,
                'Content-Transfer-Encoding: base64',
                `Content-Disposition: attachment; filename="${header(a.fileName)}"`,
                '',
                bytes.toString('base64').replace(/.{1,76}/gu, '$&\r\n'),
              );
            }
            parts.push(`--${boundary}--`, '');
            content = [
              ...lines,
              `Content-Type: multipart/mixed; boundary="${boundary}"`,
              '',
              ...parts,
            ].join('\r\n');
          }
          mkdirSync(config.outboxDirectory, { recursive: true });
          const file = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${input.trackingId.replace(/[^\w-]/gu, '_')}.eml`;
          writeFileSync(path.join(config.outboxDirectory, file), content);
          return {
            status: 'accepted',
            providerMessageId: `sent/${file}`,
            internetMessageId: messageId,
          };
        },
        async setRead() {
          return { ok: true, value: undefined };
        },
        async setStarred() {
          return { ok: true, value: undefined };
        },
      };
      return adapter;
    },
  };

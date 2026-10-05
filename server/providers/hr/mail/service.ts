/**
 * 邮件往来 (总纲 邮件约定, V2-06). The one place business mail is received,
 * threaded, drafted and sent:
 *
 * - Receiving: each enabled mailbox's source is read; a message is stored once
 *   per (mailbox, messageId), attachments are filtered and kept as hrFiles, and
 *   the message is threaded by the `+<threadKey>` in the address it was sent
 *   to (or the `[#threadKey]` tag in its subject). A reply in a linked thread
 *   goes to the purpose's handler as a reply; anything else as unmatched.
 * - Sending: only drafts are sent, only by someone the purpose allows, through
 *   the notification plugin's email channel with a reply address that carries
 *   the thread key. The mock adapter writes the message to the outbox instead.
 *
 * Message content is data: nothing here, and no handler, acts on what a
 * message asks for. Handlers only recognise, link and draft.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import type { DatabaseManager } from '@nocobase/db';
import type { NocoBaseDriveManager } from '@nocobase/drive';

import type { MailConfig, MailboxConfig } from '../../../config/mail.js';
import type { ActorContext } from '../framework-service.js';
import { HrError } from '../shared.js';
import { parseMail, type ParsedMail } from './parse.js';
import type { MailSettingsService } from './settings.js';
import { mailSourceFor, writeMockOutbox } from './sources.js';
import {
  MAIL_PURPOSES,
  type MailHandler,
  type MailMessage,
  type MailPurpose,
  type MailStatus,
} from './types.js';

/** Office files that can carry macros, executables and archives are never kept. */
const ALWAYS_REJECTED =
  /\.(xlsm|xltm|xlam|docm|dotm|pptm|potm|ppsm|exe|bat|cmd|com|msi|scr|js|vbs|ps1|jar|zip|rar|7z|tar|gz)$/iu;

const str = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
};

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

const iso = (v: unknown): string | null =>
  v == null || v === '' ? null : new Date(str(v)).toISOString();

export function toMail(row: Record<string, unknown>): MailMessage {
  return {
    id: str(row.id),
    mailbox: str(row.mailbox) as MailPurpose,
    direction: str(row.direction) as 'inbound' | 'outbound',
    status: str(row.status) as MailStatus,
    threadKey: str(row.threadKey),
    from: {
      address: str(row.fromAddress),
      name: row.fromName == null ? null : str(row.fromName),
    },
    to: parseJson<string[]>(row.toAddresses, []),
    cc: parseJson<string[]>(row.ccAddresses, []),
    subject: str(row.subject),
    bodyText: row.bodyText == null ? null : str(row.bodyText),
    attachments: parseJson(row.attachmentFileIds, []),
    rejectedAttachments: parseJson(row.rejectedAttachments, []),
    refType: row.refType == null ? null : str(row.refType),
    refId: row.refId == null ? null : str(row.refId),
    aiIntent: row.aiIntent == null ? null : str(row.aiIntent),
    aiSummary: row.aiSummary == null ? null : str(row.aiSummary),
    draftOf: row.draftOf == null ? null : str(row.draftOf),
    proposal: parseJson<Record<string, unknown> | null>(row.proposal, null),
    sentBy: row.sentBy == null ? null : str(row.sentBy),
    sentAt: iso(row.sentAt),
    deliveryError: row.deliveryError == null ? null : str(row.deliveryError),
    receivedAt: iso(row.receivedAt),
    retentionUntil: str(row.retentionUntil).slice(0, 10),
    createdAt: iso(row.createdAt) ?? '',
  };
}

const newThreadKey = (): string => randomBytes(6).toString('hex');

/** `billing+<key>@qiheng.test` for the thread key a message was sent to. */
function threadKeyOf(
  parsed: ParsedMail,
  own: readonly string[],
): string | null {
  for (const address of [...parsed.to, ...parsed.cc]) {
    const [local, host] = address.split('@');
    if (!local || !host) continue;
    const [base, key] = local.split('+');
    if (key && own.includes(`${base}@${host}`)) return key.toLowerCase();
  }
  const tag = /\[#([0-9a-f]{12})\]/iu.exec(parsed.subject);
  return tag ? tag[1].toLowerCase() : null;
}

function addDays(date: Date, days: number): string {
  const next = new Date(date.getTime() + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export interface MailServiceDeps {
  readonly database: DatabaseManager;
  readonly settings: MailSettingsService;
  readonly config: () => MailConfig;
  readonly storageDir: () => string;
  readonly drive: () => NocoBaseDriveManager;
  readonly production: boolean;
  /** Sends one email through the notification plugin; answers the delivery state. */
  readonly sendEmail: (input: {
    idempotencyKey: string;
    channel: string;
    to: string;
    replyTo: string;
    subject: string;
    text: string;
  }) => Promise<'sent' | 'channelNotConfigured' | 'failed'>;
  readonly notify: (input: {
    key: string;
    userIds: string[];
    message: string;
    params: Record<string, string>;
    path: string;
  }) => Promise<void>;
  readonly log: (fields: Record<string, unknown>, message: string) => void;
}

export function createMailService(deps: MailServiceDeps) {
  const { database } = deps;
  const handlers = new Map<MailPurpose, MailHandler>();

  function mailboxConfig(purpose: MailPurpose): MailboxConfig {
    return deps.config()[purpose];
  }

  function ownAddresses(): string[] {
    return MAIL_PURPOSES.map((p) => mailboxConfig(p).address.toLowerCase());
  }

  function handlerFor(purpose: MailPurpose): MailHandler {
    const handler = handlers.get(purpose);
    if (!handler) throw new HrError('MAIL_MAILBOX_UNAVAILABLE', 404);
    return handler;
  }

  async function row(id: string): Promise<MailMessage> {
    const found = await database
      .query()
      .selectFrom('mailMessages')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('MAIL_NOT_FOUND', 404);
    return toMail(found);
  }

  async function requireView(ctx: ActorContext, purpose: MailPurpose) {
    if (!(await handlerFor(purpose).canView(ctx)))
      throw new HrError('MAIL_NOT_FOUND', 404);
  }

  async function requireSend(ctx: ActorContext, purpose: MailPurpose) {
    if (!(await handlerFor(purpose).canSend(ctx)))
      throw new HrError('FORBIDDEN', 403);
  }

  async function storeAttachment(
    purpose: MailPurpose,
    file: { filename: string; contentType: string; bytes: Uint8Array },
  ): Promise<string> {
    const id = randomUUID();
    const safe = file.filename.replace(/[^\w.\-一-龥（）]/gu, '_').slice(-120);
    // The storage key stays ASCII (the drive refuses other characters); hrFiles keeps the name.
    const ext = safe.includes('.') ? safe.split('.').pop()!.slice(0, 32) : '';
    const key = `mail/${purpose}/${new Date().toISOString().slice(0, 7)}/${id}${ext ? `.${ext.replace(/[^\w]/gu, '')}` : ''}`;
    await deps.drive().use('local').put(key, file.bytes);
    const now = new Date();
    await database
      .query()
      .insertInto('hrFiles')
      .values({
        id,
        disk: 'local',
        key,
        filename: safe,
        ext,
        mimeType: file.contentType.slice(0, 255),
        size: file.bytes.byteLength,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return id;
  }

  /** Stores one received message; answers it, or null for a duplicate. */
  async function ingest(
    purpose: MailPurpose,
    raw: Uint8Array,
  ): Promise<MailMessage | null> {
    const parsed = await parseMail(raw);
    const messageId = parsed.messageId ?? `<no-id-${randomUUID()}>`;
    const duplicate = await database
      .query()
      .selectFrom('mailMessages')
      .select(['id'])
      .where('mailbox', '=', purpose)
      .where('messageId', '=', messageId)
      .executeTakeFirst();
    if (duplicate) return null;
    const settings = (await deps.settings.read()).value;
    const allowed = new Set(settings.allowedAttachmentTypes);
    const maxBytes = settings.maxAttachmentMb * 1024 * 1024;
    const kept: { fileId: string; filename: string }[] = [];
    const rejected: { filename: string; reason: string }[] = [];
    for (const file of parsed.attachments) {
      const ext = file.filename.includes('.')
        ? file.filename.split('.').pop()!.toLowerCase()
        : '';
      if (ALWAYS_REJECTED.test(file.filename))
        rejected.push({ filename: file.filename, reason: 'unsafe' });
      else if (!allowed.has(ext))
        rejected.push({ filename: file.filename, reason: 'type' });
      else if (file.bytes.byteLength > maxBytes)
        rejected.push({ filename: file.filename, reason: 'size' });
      else
        kept.push({
          fileId: await storeAttachment(purpose, file),
          filename: file.filename,
        });
    }
    // A reply in a known thread takes the thread's record.
    const key = threadKeyOf(parsed, ownAddresses());
    const thread = key
      ? await database
          .query()
          .selectFrom('mailMessages')
          .select(['refType', 'refId'])
          .where('threadKey', '=', key)
          .where('mailbox', '=', purpose)
          .where('refId', 'is not', null)
          .executeTakeFirst()
      : undefined;
    const now = new Date();
    const id = randomUUID();
    await database
      .query()
      .insertInto('mailMessages')
      .values({
        id,
        mailbox: purpose,
        direction: 'inbound',
        status: thread ? 'linked' : 'received',
        messageId,
        inReplyTo: parsed.inReplyTo,
        threadKey: thread && key ? key : newThreadKey(),
        fromAddress: parsed.from.address,
        fromName: parsed.from.name,
        toAddresses: parsed.to,
        ccAddresses: parsed.cc,
        subject: parsed.subject.slice(0, 500),
        bodyText: parsed.text.slice(0, 100_000),
        attachmentFileIds: kept,
        rejectedAttachments: rejected,
        refType: thread ? str(thread.refType) : null,
        refId: thread ? str(thread.refId) : null,
        aiIntent: null,
        aiSummary: null,
        draftOf: null,
        sentBy: null,
        sentAt: null,
        deliveryError: null,
        receivedAt: parsed.date ?? now,
        retentionUntil: addDays(now, settings.mailboxes[purpose].retentionDays),
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return row(id);
  }

  const service = {
    /** A step registers what its purpose's mail means; later registrations replace earlier ones. */
    registerHandler(purpose: MailPurpose, handler: MailHandler) {
      handlers.set(purpose, handler);
    },

    /** Reads every enabled mailbox (or one); answers how many new messages each stored. */
    async poll(only?: MailPurpose): Promise<Record<string, number>> {
      const settings = (await deps.settings.read()).value;
      const counts: Record<string, number> = {};
      for (const purpose of MAIL_PURPOSES) {
        if (only && purpose !== only) continue;
        if (!settings.mailboxes[purpose].enabled || !handlers.has(purpose))
          continue;
        const source = mailSourceFor({
          purpose,
          config: mailboxConfig(purpose),
          storageDir: deps.storageDir(),
          production: deps.production,
        });
        if (!source) continue;
        let stored = 0;
        let items;
        try {
          items = await source.fetch();
        } catch (error) {
          deps.log({ error, purpose }, 'Mailbox could not be read');
          continue;
        }
        for (const item of items) {
          try {
            const mail = await ingest(purpose, item.raw);
            await item.ack();
            if (!mail) continue;
            stored += 1;
            const handler = handlerFor(purpose);
            if (mail.status === 'linked') await handler.onReply(mail);
            else await handler.onUnmatched(mail);
          } catch (error) {
            deps.log({ error, purpose }, 'Mail could not be processed');
          }
        }
        counts[purpose] = stored;
      }
      return counts;
    },

    /** Manual 收信 from the 邮件往来 page, for one purpose the user may read. */
    async pollFor(ctx: ActorContext, purpose: MailPurpose) {
      await requireView(ctx, purpose);
      return service.poll(purpose);
    },

    /** Each mailbox's address and source for 设置 / 邮件; never a credential. */
    connections() {
      return MAIL_PURPOSES.map((purpose) => {
        const config = mailboxConfig(purpose);
        return {
          purpose,
          address: config.address,
          adapter: config.adapter,
          // IMAP needs a host, user and password; the page says whether they are set, not what they are.
          configured:
            config.adapter !== 'imap' ||
            Boolean(config.imapHost && config.imapUser && config.imapPassword),
        };
      });
    },

    /** The purposes the user may open, with the unmatched count of each. */
    async mailboxes(ctx: ActorContext) {
      const settings = (await deps.settings.read()).value;
      const out: {
        purpose: MailPurpose;
        address: string;
        enabled: boolean;
        adapter: string;
        canSend: boolean;
        unmatched: number;
      }[] = [];
      for (const purpose of MAIL_PURPOSES) {
        const handler = handlers.get(purpose);
        if (!handler || !(await handler.canView(ctx))) continue;
        const unmatched = await database
          .query()
          .selectFrom('mailMessages')
          .select(['id'])
          .where('mailbox', '=', purpose)
          .where('status', '=', 'unmatched')
          .execute();
        const config = mailboxConfig(purpose);
        out.push({
          purpose,
          address: config.address,
          enabled: settings.mailboxes[purpose].enabled,
          adapter: config.adapter,
          canSend: await handler.canSend(ctx),
          unmatched: unmatched.length,
        });
      }
      return out;
    },

    async list(
      ctx: ActorContext,
      purpose: MailPurpose,
      filter: { status?: string },
    ) {
      await requireView(ctx, purpose);
      let query = database
        .query()
        .selectFrom('mailMessages')
        .selectAll()
        .where('mailbox', '=', purpose);
      if (filter.status === 'unmatched')
        query = query.where('status', '=', 'unmatched');
      else if (filter.status === 'drafts')
        query = query.where('status', '=', 'draft');
      const rows = await query
        .orderBy('createdAt', 'desc')
        .limit(200)
        .execute();
      return rows.map((r) => toMail(r as Record<string, unknown>));
    },

    async get(ctx: ActorContext, id: string) {
      const mail = await row(id);
      await requireView(ctx, mail.mailbox);
      return mail;
    },

    /** Every message of a record's threads, oldest first. */
    async forRecord(
      ctx: ActorContext,
      purpose: MailPurpose,
      refType: string,
      refId: string,
    ) {
      await requireView(ctx, purpose);
      const rows = await database
        .query()
        .selectFrom('mailMessages')
        .selectAll()
        .where('mailbox', '=', purpose)
        .where('refType', '=', refType)
        .where('refId', '=', refId)
        .orderBy('createdAt', 'asc')
        .execute();
      return rows.map((r) => toMail(r as Record<string, unknown>));
    },

    /** A file of a message the user may read. */
    async attachment(ctx: ActorContext, id: string, fileId: string) {
      const mail = await service.get(ctx, id);
      if (!mail.attachments.some((a) => a.fileId === fileId))
        throw new HrError('MAIL_NOT_FOUND', 404);
      const file = await database
        .query()
        .selectFrom('hrFiles')
        .selectAll()
        .where('id', '=', fileId)
        .executeTakeFirst();
      if (!file) throw new HrError('MAIL_NOT_FOUND', 404);
      const bytes = await deps
        .drive()
        .use(str(file.disk))
        .getBytes(str(file.key));
      return {
        filename: str(file.filename),
        mimeType: str(file.mimeType),
        bytes,
      };
    },

    /** An attachment's bytes for a handler (it runs as its task owner, who holds the purpose's permission). */
    async fileBytes(fileId: string): Promise<Uint8Array | null> {
      const file = await database
        .query()
        .selectFrom('hrFiles')
        .select(['disk', 'key'])
        .where('id', '=', fileId)
        .executeTakeFirst();
      if (!file) return null;
      return deps.drive().use(str(file.disk)).getBytes(str(file.key));
    },

    /** Links a message (and the rest of its thread) to a record: the handler's or a person's decision. */
    async link(input: {
      id: string;
      refType: string;
      refId: string;
      intent?: string | null;
      summary?: string | null;
    }) {
      const mail = await row(input.id);
      const now = new Date();
      // The record belongs to the whole thread; status, intent and summary describe this message only.
      await database
        .query()
        .updateTable('mailMessages')
        .set({ refType: input.refType, refId: input.refId, updatedAt: now })
        .where('threadKey', '=', mail.threadKey)
        .where('mailbox', '=', mail.mailbox)
        .execute();
      await database
        .query()
        .updateTable('mailMessages')
        .set({
          status: mail.direction === 'inbound' ? 'linked' : mail.status,
          ...(input.intent !== undefined ? { aiIntent: input.intent } : {}),
          ...(input.summary !== undefined
            ? { aiSummary: input.summary?.slice(0, 2000) ?? null }
            : {}),
          updatedAt: now,
        })
        .where('id', '=', mail.id)
        .execute();
      return row(input.id);
    },

    /** Leaves a message for a person to sort, with what was recognised. */
    async leaveUnmatched(id: string, intent: string | null, summary: string) {
      await database
        .query()
        .updateTable('mailMessages')
        .set({
          status: 'unmatched',
          aiIntent: intent,
          aiSummary: summary.slice(0, 2000),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      const mail = await row(id);
      const handler = handlerFor(mail.mailbox);
      await deps.notify({
        key: `mail:${id}:unmatched`,
        userIds: await handler.recipients(),
        message: 'mailUnmatched',
        params: { subject: mail.subject, from: mail.from.address },
        path: `/talent/mail?mailbox=${mail.mailbox}&status=unmatched`,
      });
    },

    /** 待归类 · 重新识别: after a cause is fixed (a sender domain added, a file problem solved), recognise it again. */
    async resort(ctx: ActorContext, id: string) {
      const mail = await service.get(ctx, id);
      await requireSend(ctx, mail.mailbox);
      if (mail.direction !== 'inbound' || mail.status !== 'unmatched')
        throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('mailMessages')
        .set({ status: 'received', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      await handlerFor(mail.mailbox).onUnmatched(await row(id), randomUUID());
      return row(id);
    },

    /** 待归类: a person marks a message as not needing anything. */
    async ignore(ctx: ActorContext, id: string) {
      const mail = await service.get(ctx, id);
      await requireSend(ctx, mail.mailbox);
      if (mail.direction !== 'inbound') throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('mailMessages')
        .set({ status: 'ignored', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return row(id);
    },

    /**
     * A reply draft to a received message: always to its sender, in its
     * thread, with its record. The body is stored as written; nothing is sent.
     */
    async draftReply(input: {
      replyTo: string;
      body: string;
      subject?: string;
      proposal?: Record<string, unknown> | null;
    }): Promise<MailMessage> {
      const original = await row(input.replyTo);
      if (original.direction !== 'inbound')
        throw new HrError('INVALID_INPUT', 400);
      // One open draft per message: a new draft replaces an unsent one.
      await database
        .query()
        .deleteFrom('mailMessages')
        .where('draftOf', '=', original.id)
        .where('status', '=', 'draft')
        .execute();
      const now = new Date();
      const id = randomUUID();
      const subject =
        input.subject ??
        (/^(re|回复)[:：]/iu.test(original.subject)
          ? original.subject
          : `Re: ${original.subject}`);
      await database
        .query()
        .insertInto('mailMessages')
        .values({
          id,
          mailbox: original.mailbox,
          direction: 'outbound',
          status: 'draft',
          messageId: null,
          inReplyTo: null,
          threadKey: original.threadKey,
          fromAddress: mailboxConfig(original.mailbox).address,
          fromName: null,
          toAddresses: [original.from.address],
          ccAddresses: [],
          subject: subject.slice(0, 500),
          bodyText: input.body.slice(0, 100_000),
          attachmentFileIds: [],
          rejectedAttachments: [],
          refType: original.refType,
          refId: original.refId,
          aiIntent: null,
          aiSummary: null,
          draftOf: original.id,
          proposal: input.proposal ?? null,
          sentBy: null,
          sentAt: null,
          deliveryError: null,
          receivedAt: null,
          retentionUntil: original.retentionUntil,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return row(id);
    },

    /** A person picks another proposed option of a draft (a reschedule time); the text follows. */
    async chooseProposal(ctx: ActorContext, id: string, choice: unknown) {
      const mail = await service.get(ctx, id);
      await requireSend(ctx, mail.mailbox);
      if (mail.status !== 'draft') throw new HrError('MAIL_NOT_DRAFT', 409);
      const handler = handlerFor(mail.mailbox);
      if (
        !mail.proposal ||
        !handler.chooseProposal ||
        typeof choice !== 'number' ||
        !Number.isInteger(choice) ||
        choice < 0
      )
        throw new HrError('INVALID_INPUT', 400);
      const next = await handler.chooseProposal(mail, choice);
      await database
        .query()
        .updateTable('mailMessages')
        .set({
          proposal: next.proposal,
          bodyText: next.body.slice(0, 100_000),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return row(id);
    },

    /** A person edits a draft's body before sending. */
    async updateDraft(ctx: ActorContext, id: string, body: unknown) {
      const mail = await service.get(ctx, id);
      await requireSend(ctx, mail.mailbox);
      if (mail.status !== 'draft') throw new HrError('MAIL_NOT_DRAFT', 409);
      if (typeof body !== 'string' || !body.trim())
        throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('mailMessages')
        .set({ bodyText: body.slice(0, 100_000), updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return row(id);
    },

    /** Sends a draft: the only way mail leaves the application. */
    async send(ctx: ActorContext, id: string) {
      const mail = await service.get(ctx, id);
      await requireSend(ctx, mail.mailbox);
      if (mail.status !== 'draft') throw new HrError('MAIL_NOT_DRAFT', 409);
      const settings = (await deps.settings.read()).value;
      const config = mailboxConfig(mail.mailbox);
      const [local, host] = config.address.split('@');
      const replyTo = `${local}+${mail.threadKey}@${host}`;
      const subject = mail.subject.includes(`[#${mail.threadKey}]`)
        ? mail.subject
        : `${mail.subject} [#${mail.threadKey}]`;
      const to =
        !deps.production && settings.redirectTo
          ? settings.redirectTo
          : mail.to[0];
      const prepared = (await handlerFor(mail.mailbox).prepareSend?.(
        ctx,
        mail,
      )) ?? { text: mail.bodyText ?? '', storedText: mail.bodyText ?? '' };
      const text = prepared.text;
      let state: 'sent' | 'channelNotConfigured' | 'failed';
      if (config.adapter === 'mock' && !deps.production) {
        writeMockOutbox(deps.storageDir(), {
          id,
          from: settings.senderName
            ? `${settings.senderName} <${config.address}>`
            : config.address,
          replyTo,
          to,
          subject,
          text,
        });
        state = 'sent';
      } else
        state = await deps.sendEmail({
          idempotencyKey: `hr:mail:${id}`,
          channel: settings.channel,
          to,
          replyTo,
          subject,
          text,
        });
      const now = new Date();
      await database
        .query()
        .updateTable('mailMessages')
        .set(
          state === 'sent'
            ? {
                status: 'sent',
                subject,
                bodyText: prepared.storedText.slice(0, 100_000),
                sentBy: ctx.userId,
                sentAt: now,
                deliveryError: null,
                updatedAt: now,
              }
            : { deliveryError: state, updatedAt: now },
        )
        .where('id', '=', id)
        .execute();
      if (state !== 'sent')
        throw new HrError('MAIL_SEND_FAILED', 409, { state });
      await prepared.onSent?.();
      return row(id);
    },

    /**
     * Mail a step sends on its own after a person confirmed the content or its template once (an interview
     * invitation, an offer, a reminder): recorded as sent in the record's thread, with the thread's reply address,
     * so the answer comes back to the same record. Sent once per idempotency key.
     */
    async sendDirect(input: {
      purpose: MailPurpose;
      idempotencyKey: string;
      to: string;
      subject: string;
      text: string;
      refType: string | null;
      refId: string | null;
      /** A step's own channel and test address, when it has them (招聘设置 · 邮件). */
      channel?: string;
      redirectTo?: string;
      /** What the thread keeps when the sent text must not be stored (a one-time code). */
      storedText?: string;
    }): Promise<'sent' | 'channelNotConfigured' | 'failed' | null> {
      // null: the mailbox is off, so the step sends the way it did before mail was connected.
      const settings = (await deps.settings.read()).value;
      const config = mailboxConfig(input.purpose);
      if (
        !settings.mailboxes[input.purpose].enabled ||
        config.adapter === 'none'
      )
        return null;
      const messageId = `<${input.idempotencyKey}>`;
      const done = await database
        .query()
        .selectFrom('mailMessages')
        .select(['status'])
        .where('mailbox', '=', input.purpose)
        .where('messageId', '=', messageId)
        .executeTakeFirst();
      if (done?.status === 'sent') return 'sent';
      const thread =
        input.refType && input.refId
          ? await database
              .query()
              .selectFrom('mailMessages')
              .select(['threadKey'])
              .where('mailbox', '=', input.purpose)
              .where('refType', '=', input.refType)
              .where('refId', '=', input.refId)
              .orderBy('createdAt', 'desc')
              .executeTakeFirst()
          : undefined;
      const threadKey = thread ? str(thread.threadKey) : newThreadKey();
      const [local, host] = config.address.split('@');
      const replyTo = `${local}+${threadKey}@${host}`;
      const subject = `${input.subject} [#${threadKey}]`;
      const redirect = input.redirectTo ?? settings.redirectTo;
      const to = !deps.production && redirect ? redirect : input.to;
      let state: 'sent' | 'channelNotConfigured' | 'failed';
      const id = randomUUID();
      if (config.adapter === 'mock' && !deps.production) {
        writeMockOutbox(deps.storageDir(), {
          id,
          from: settings.senderName
            ? `${settings.senderName} <${config.address}>`
            : config.address,
          replyTo,
          to,
          subject,
          text: input.text,
        });
        state = 'sent';
      } else
        state = await deps.sendEmail({
          idempotencyKey: `hr:mail:${input.idempotencyKey}`,
          channel: input.channel ?? settings.channel,
          to,
          replyTo,
          subject,
          text: input.text,
        });
      const now = new Date();
      if (done)
        await database
          .query()
          .updateTable('mailMessages')
          .set({
            status: state === 'sent' ? 'sent' : 'failed',
            sentAt: state === 'sent' ? now : null,
            deliveryError: state === 'sent' ? null : state,
            updatedAt: now,
          })
          .where('mailbox', '=', input.purpose)
          .where('messageId', '=', messageId)
          .execute();
      else
        await database
          .query()
          .insertInto('mailMessages')
          .values({
            id,
            mailbox: input.purpose,
            direction: 'outbound',
            status: state === 'sent' ? 'sent' : 'failed',
            messageId,
            inReplyTo: null,
            threadKey,
            fromAddress: config.address,
            fromName: settings.senderName || null,
            toAddresses: [input.to],
            ccAddresses: [],
            subject: subject.slice(0, 500),
            bodyText: (input.storedText ?? input.text).slice(0, 100_000),
            attachmentFileIds: [],
            rejectedAttachments: [],
            refType: input.refType,
            refId: input.refId,
            aiIntent: null,
            aiSummary: null,
            draftOf: null,
            sentBy: null,
            sentAt: state === 'sent' ? now : null,
            deliveryError: state === 'sent' ? null : state,
            receivedAt: null,
            retentionUntil: addDays(
              now,
              settings.mailboxes[input.purpose].retentionDays,
            ),
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      return state;
    },

    /** Daily: bodies and attachments past their retention are cleared; subject, addresses and links stay. */
    async sweepRetention(date: string) {
      const expired = await database
        .query()
        .selectFrom('mailMessages')
        .select(['id'])
        .where('retentionUntil', '<', date)
        .where('bodyText', 'is not', null)
        .execute();
      if (!expired.length) return { cleared: 0 };
      await database
        .query()
        .updateTable('mailMessages')
        .set({
          bodyText: null,
          attachmentFileIds: [],
          updatedAt: new Date(),
        })
        .where(
          'id',
          'in',
          expired.map((r) => str(r.id)),
        )
        .execute();
      return { cleared: expired.length };
    },

    row,
  };
  return service;
}

export type MailService = ReturnType<typeof createMailService>;

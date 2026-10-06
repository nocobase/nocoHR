/**
 * 邮件往来 (总纲 邮件约定, V2-06). The one place business mail is received,
 * threaded, drafted and sent. Since 2026-10-05 the mailboxes are Mail plugin
 * accounts (@nocobase/app-plugin-mail): the plugin connects, synchronizes and
 * sends; this service decides what the mail means for NocoHR.
 *
 * - A purpose's mailbox is the plugin account bound to it on 设置 / 邮件, read
 *   and sent as the account's owner. Development, tests and the demo bind a
 *   本地文件邮箱 account per purpose automatically.
 * - Receiving: the account is synchronized, and each new message of its inbox
 *   is stored once per (mailbox, Message-ID) with its attachments filtered and
 *   kept as hrFiles. It is threaded by the `[#threadKey]` tag in its subject,
 *   or by its In-Reply-To / References naming a message of a known thread. A
 *   reply in a linked thread goes to the purpose's handler as a reply;
 *   anything else as unmatched.
 * - Sending: only drafts are sent (and the steps' own confirmed messages,
 *   sendDirect), only by someone the purpose allows, through the plugin as the
 *   account; a reply names the message it answers, so the plugin keeps the
 *   conversation's headers.
 *
 * Message content is data: nothing here, and no handler, acts on what a
 * message asks for. Handlers only recognise, link and draft.
 */
import { randomBytes, randomUUID } from 'node:crypto';

import type { MailService as PluginMailService } from '@nocobase/app-plugin-mail/server';
import type { DatabaseManager } from '@nocobase/db';
import type { NocoBaseDriveManager } from '@nocobase/drive';

import type {
  MailConfig,
  MailboxConfig,
} from '../../../config/business-mail.js';
import type { ActorContext } from '../framework-service.js';
import { HrError } from '../shared.js';
import type { MailSettingsService } from './settings.js';
import {
  MAIL_PURPOSES,
  type MailHandler,
  type MailMessage,
  type MailPurpose,
  type MailStatus,
} from './types.js';
import { MAIL_RESOURCE } from './resources.js';
import { tryAuthorizeAction } from '../authorize.js';

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

/** The `[#threadKey]` tag a reply keeps in its subject. */
function threadKeyOf(subject: string): string | null {
  const tag = /\[#([0-9a-f]{12})\]/iu.exec(subject);
  return tag ? tag[1].toLowerCase() : null;
}

/** A received message, as the plugin hands it over. */
interface IncomingMail {
  readonly ref: string;
  readonly messageId: string;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly from: { address: string; name: string | null };
  readonly to: string[];
  readonly cc: string[];
  readonly subject: string;
  readonly text: string;
  readonly date: Date | null;
  readonly attachments: {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }[];
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function addDays(date: Date, days: number): string {
  const next = new Date(date.getTime() + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}

export interface MailServiceDeps {
  readonly database: DatabaseManager;
  readonly settings: MailSettingsService;
  readonly config: () => MailConfig;
  readonly drive: () => NocoBaseDriveManager;
  readonly production: boolean;
  /** The Mail plugin's service: accounts, synchronization, messages and sending. */
  readonly mail: () => PluginMailService;
  /** The 本地文件邮箱 provider instance, outside production (`local`); null in production. */
  readonly localProvider: string | null;
  /** Who a purpose's mailbox belongs to when it is connected automatically (the owner of its sorting task). */
  readonly defaultOwner: (purpose: MailPurpose) => Promise<string | null>;
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
  const localTried = new Set<MailPurpose>();

  function mailboxConfig(purpose: MailPurpose): MailboxConfig {
    return deps.config()[purpose];
  }

  /** The plugin account serving a purpose and its owner, when one is bound. */
  async function binding(purpose: MailPurpose) {
    let mailbox = (await deps.settings.read()).value.mailboxes[purpose];
    // Outside production the 本地文件邮箱 accounts are connected the first time a mailbox is needed.
    if (
      (!mailbox.accountId || !mailbox.ownerUserId) &&
      deps.localProvider &&
      !localTried.has(purpose)
    ) {
      localTried.add(purpose);
      await ensureLocalAccounts().catch((error: unknown) =>
        deps.log({ error, purpose }, 'Local mailbox could not be connected'),
      );
      mailbox = (await deps.settings.read()).value.mailboxes[purpose];
    }
    if (!mailbox.accountId || !mailbox.ownerUserId) return null;
    return {
      accountId: mailbox.accountId,
      ctx: { actorId: mailbox.ownerUserId },
    };
  }

  /** Development, tests and the demo: each purpose gets a 本地文件邮箱 account of its own, once. */
  async function ensureLocalAccounts(): Promise<void> {
    if (!deps.localProvider || deps.production) return;
    const current = await deps.settings.read();
    // Once an administrator has saved 设置 / 邮件, the bindings are theirs: an unbound mailbox stays unbound.
    if (current.updatedBy && current.updatedBy !== 'system') return;
    let changed = false;
    const mailboxes = { ...current.value.mailboxes };
    for (const purpose of MAIL_PURPOSES) {
      if (mailboxes[purpose].accountId) continue;
      const owner = await deps.defaultOwner(purpose);
      if (!owner) {
        deps.log({ purpose }, 'No owner for the local mailbox yet');
        continue;
      }
      const address = mailboxConfig(purpose).address;
      const ctx = { actorId: owner };
      const existing = (await deps.mail().listAccounts(ctx)).find(
        (a) => a.address.toLowerCase() === address.toLowerCase(),
      );
      const account =
        existing ??
        (await deps.mail().connectAccount(ctx, {
          provider: { type: 'local-files', name: deps.localProvider },
          address,
          ...(current.value.senderName
            ? { displayName: current.value.senderName }
            : {}),
          username: address,
          password: 'local',
          initialSyncReceivedAfter: new Date(
            Date.now() - 365 * 86_400_000,
          ).toISOString(),
        }));
      mailboxes[purpose] = {
        ...mailboxes[purpose],
        accountId: account.id,
        ownerUserId: owner,
      };
      changed = true;
    }
    if (changed)
      await deps.settings.writeTrusted({ ...current.value, mailboxes });
  }

  /**
   * Synchronizes an account and waits (up to ten seconds) until none of its
   * runs is still going: the plugin's jobs carry them out, and a newly
   * connected account already has its first run under way.
   */
  async function synchronize(ctx: { actorId: string }, accountId: string) {
    const mail = deps.mail();
    await mail.startSync(ctx, { accountId });
    for (let i = 0; i < 100; i++) {
      const runs = await mail.listSyncRuns(ctx, 0, 20);
      const active = runs.filter(
        (r) =>
          r.accountId === accountId &&
          ['pending', 'running'].includes(String(r.status)),
      );
      if (!active.length) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /** The inbox messages not stored yet, oldest first, read in full. */
  async function newMail(
    purpose: MailPurpose,
    ctx: { actorId: string },
    accountId: string,
  ): Promise<IncomingMail[]> {
    const mail = deps.mail();
    const inbox = (await mail.listFolders(ctx, accountId)).filter(
      (f) => f.type === 'inbox',
    );
    const fresh: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await mail.listMessages(ctx, {
        accountIds: [accountId],
        limit: 50,
        ...(cursor ? { cursor } : {}),
      });
      // Received mail only: a message names its folders by the provider's id or the plugin's.
      const inboxIds = new Set(
        inbox.flatMap((f) => [f.id, f.providerFolderId]),
      );
      const refs = result.items
        .filter(
          (m) =>
            !m.draft &&
            (!inboxIds.size || m.folderIds.some((id) => inboxIds.has(id))),
        )
        .map((m) => m.id);
      const known = refs.length
        ? new Set(
            (
              await database
                .query()
                .selectFrom('businessMailMessages')
                .select(['mailMessageRef'])
                .where('mailbox', '=', purpose)
                .where('mailMessageRef', 'in', refs)
                .execute()
            ).map((r) => str(r.mailMessageRef)),
          )
        : new Set<string>();
      const unseen = refs.filter((r) => !known.has(r));
      fresh.push(...unseen);
      // Newest first: a page with nothing new means everything older was already stored.
      if (!unseen.length || !result.nextCursor) break;
      cursor = result.nextCursor;
    }
    const out: IncomingMail[] = [];
    for (const ref of fresh.reverse()) {
      const full = await mail.getMessage(ctx, accountId, ref);
      if (!full) continue;
      const attachments = [];
      for (const a of full.attachments.filter((x) => !x.inline)) {
        const content = await mail.getAttachment(ctx, accountId, full.id, a.id);
        attachments.push({
          filename: a.fileName,
          contentType: a.contentType,
          bytes: await readStream(content.stream),
        });
      }
      out.push({
        ref: full.id,
        messageId: full.internetMessageId ?? `<mail-${full.id}>`,
        inReplyTo: full.inReplyTo ?? null,
        references: full.references,
        from: {
          address: (full.from?.address ?? '').toLowerCase(),
          name: full.from?.name ?? null,
        },
        to: full.to.map((t) => t.address.toLowerCase()),
        cc: full.cc.map((t) => t.address.toLowerCase()),
        subject: full.subject,
        text: full.text ?? '',
        date: full.receivedAt ? new Date(full.receivedAt) : null,
        attachments,
      });
    }
    return out;
  }

  /** Sends one message as a purpose's account; answers the plugin's verdict. */
  async function submit(
    purpose: MailPurpose,
    input: {
      idempotencyKey: string;
      to: string;
      subject: string;
      text: string;
      inReplyToRef: string | null;
    },
  ): Promise<{
    state: 'sent' | 'failed' | 'channelNotConfigured';
    accountId: string | null;
  }> {
    const bound = await binding(purpose);
    if (!bound) return { state: 'channelNotConfigured', accountId: null };
    const mail = deps.mail();
    const identities = await mail.listIdentities(bound.ctx, bound.accountId);
    const identity =
      identities.find((i) => i.isPrimary && i.canSend) ??
      identities.find((i) => i.canSend);
    if (!identity)
      return { state: 'channelNotConfigured', accountId: bound.accountId };
    try {
      const submission = await mail.sendMessage(bound.ctx, {
        accountId: bound.accountId,
        identityId: identity.id,
        signatureId: null,
        to: [{ address: input.to }],
        subject: input.subject,
        text: input.text,
        ...(input.inReplyToRef
          ? { inReplyToMessageId: input.inReplyToRef }
          : {}),
        idempotencyKey: input.idempotencyKey,
      });
      return {
        state: ['failed', 'cancelled'].includes(String(submission.status))
          ? 'failed'
          : 'sent',
        accountId: bound.accountId,
      };
    } catch (error) {
      deps.log({ error, purpose }, 'Business mail could not be submitted');
      return { state: 'failed', accountId: bound.accountId };
    }
  }

  function handlerFor(purpose: MailPurpose): MailHandler {
    const handler = handlers.get(purpose);
    if (!handler) throw new HrError('MAIL_MAILBOX_UNAVAILABLE', 404);
    return handler;
  }

  async function row(id: string): Promise<MailMessage> {
    const found = await database
      .query()
      .selectFrom('businessMailMessages')
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

  /** The messages of a purpose this user may see, when its step narrows them. */
  async function visible(ctx: ActorContext, mails: MailMessage[]) {
    if (!mails.length) return mails;
    const handler = handlerFor(mails[0].mailbox);
    if (!handler.canSee) return mails;
    const out: MailMessage[] = [];
    for (const mail of mails)
      if (await handler.canSee(ctx, mail)) out.push(mail);
    return out;
  }

  /** 归类: sorting the unsorted mail of a purpose (talent.mail* assign). */
  async function requireAssign(ctx: ActorContext, purpose: MailPurpose) {
    if (
      !(await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE[purpose], 'assign'))
    )
      throw new HrError('FORBIDDEN', 403);
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
    accountId: string,
    parsed: IncomingMail,
  ): Promise<MailMessage | null> {
    const messageId = parsed.messageId;
    const duplicate = await database
      .query()
      .selectFrom('businessMailMessages')
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
    // A reply in a known thread takes the thread's record: by its subject tag, else by the messages it answers.
    const key = threadKeyOf(parsed.subject);
    const answers = [parsed.inReplyTo, ...parsed.references].filter(
      (v): v is string => Boolean(v),
    );
    const thread = key
      ? await database
          .query()
          .selectFrom('businessMailMessages')
          .select(['threadKey', 'refType', 'refId'])
          .where('threadKey', '=', key)
          .where('mailbox', '=', purpose)
          .where('refId', 'is not', null)
          .executeTakeFirst()
      : answers.length
        ? await database
            .query()
            .selectFrom('businessMailMessages')
            .select(['threadKey', 'refType', 'refId'])
            .where('messageId', 'in', answers)
            .where('mailbox', '=', purpose)
            .where('refId', 'is not', null)
            .executeTakeFirst()
        : undefined;
    const now = new Date();
    const id = randomUUID();
    await database
      .query()
      .insertInto('businessMailMessages')
      .values({
        id,
        mailbox: purpose,
        direction: 'inbound',
        status: thread ? 'linked' : 'received',
        messageId,
        inReplyTo: parsed.inReplyTo,
        threadKey: thread ? str(thread.threadKey) : newThreadKey(),
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
        mailAccountId: accountId,
        mailMessageRef: parsed.ref,
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

    /** Development, tests and the demo: connect the 本地文件邮箱 accounts (once; called at start-up). */
    ensureLocalAccounts,

    /** Reads every enabled mailbox (or one); answers how many new messages each stored. */
    async poll(only?: MailPurpose): Promise<Record<string, number>> {
      const settings = (await deps.settings.read()).value;
      const counts: Record<string, number> = {};
      for (const purpose of MAIL_PURPOSES) {
        if (only && purpose !== only) continue;
        if (!settings.mailboxes[purpose].enabled || !handlers.has(purpose))
          continue;
        const bound = await binding(purpose);
        if (!bound) {
          deps.log({ purpose }, 'Mailbox has no Mail account bound');
          continue;
        }
        let items: IncomingMail[];
        try {
          await synchronize(bound.ctx, bound.accountId);
          items = await newMail(purpose, bound.ctx, bound.accountId);
        } catch (error) {
          deps.log({ error, purpose }, 'Mailbox could not be read');
          continue;
        }
        let stored = 0;
        for (const item of items) {
          try {
            const mail = await ingest(purpose, bound.accountId, item);
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

    /** Each mailbox's bound account for 设置 / 邮件: address, provider and state; never a credential. */
    async connections() {
      const settings = (await deps.settings.read()).value;
      const out = [];
      for (const purpose of MAIL_PURPOSES) {
        const mailbox = settings.mailboxes[purpose];
        const account =
          mailbox.accountId && mailbox.ownerUserId
            ? (
                await deps
                  .mail()
                  .listAccounts({ actorId: mailbox.ownerUserId })
                  .catch(() => [])
              ).find((a) => a.id === mailbox.accountId)
            : undefined;
        out.push({
          purpose,
          address: account?.address ?? mailboxConfig(purpose).address,
          adapter: account ? account.provider.type : 'none',
          status: account?.status ?? null,
          accountId: account?.id ?? null,
          ownerUserId: account ? mailbox.ownerUserId : null,
          configured: Boolean(account),
        });
      }
      return out;
    },

    /** The purposes the user may open, with the unmatched count of each. */
    async mailboxes(ctx: ActorContext) {
      const settings = (await deps.settings.read()).value;
      const connections = await service.connections();
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
        const unmatched = await visible(
          ctx,
          (
            await database
              .query()
              .selectFrom('businessMailMessages')
              .selectAll()
              .where('mailbox', '=', purpose)
              .where('status', '=', 'unmatched')
              .execute()
          ).map((r) => toMail(r as Record<string, unknown>)),
        );
        const connection = connections.find((c) => c.purpose === purpose)!;
        out.push({
          purpose,
          address: connection.address,
          enabled: settings.mailboxes[purpose].enabled,
          adapter: connection.adapter,
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
        .selectFrom('businessMailMessages')
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
      return visible(
        ctx,
        rows.map((r) => toMail(r as Record<string, unknown>)),
      );
    },

    async get(ctx: ActorContext, id: string) {
      const mail = await row(id);
      await requireView(ctx, mail.mailbox);
      if (!(await visible(ctx, [mail])).length)
        throw new HrError('MAIL_NOT_FOUND', 404);
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
        .selectFrom('businessMailMessages')
        .selectAll()
        .where('mailbox', '=', purpose)
        .where('refType', '=', refType)
        .where('refId', '=', refId)
        .orderBy('createdAt', 'asc')
        .execute();
      return visible(
        ctx,
        rows.map((r) => toMail(r as Record<string, unknown>)),
      );
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
        .updateTable('businessMailMessages')
        .set({ refType: input.refType, refId: input.refId, updatedAt: now })
        .where('threadKey', '=', mail.threadKey)
        .where('mailbox', '=', mail.mailbox)
        .execute();
      await database
        .query()
        .updateTable('businessMailMessages')
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
        .updateTable('businessMailMessages')
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
      await requireAssign(ctx, mail.mailbox);
      if (mail.direction !== 'inbound' || mail.status !== 'unmatched')
        throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('businessMailMessages')
        .set({ status: 'received', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      await handlerFor(mail.mailbox).onUnmatched(await row(id), randomUUID());
      return row(id);
    },

    /** 待归类: a person marks a message as not needing anything. */
    async ignore(ctx: ActorContext, id: string) {
      const mail = await service.get(ctx, id);
      await requireAssign(ctx, mail.mailbox);
      if (mail.direction !== 'inbound') throw new HrError('INVALID_INPUT', 400);
      await database
        .query()
        .updateTable('businessMailMessages')
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
        .deleteFrom('businessMailMessages')
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
        .insertInto('businessMailMessages')
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

    /**
     * A new draft to someone, not a reply (a manually created audit request
     * has no message to answer). It joins the thread of the record when one
     * exists; a person still sends it.
     */
    async draftNew(input: {
      purpose: MailPurpose;
      to: string;
      subject: string;
      body: string;
      refType: string;
      refId: string;
    }): Promise<MailMessage> {
      const thread = await database
        .query()
        .selectFrom('businessMailMessages')
        .select(['threadKey'])
        .where('mailbox', '=', input.purpose)
        .where('refType', '=', input.refType)
        .where('refId', '=', input.refId)
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      // One open draft per record: a new one replaces an unsent one.
      await database
        .query()
        .deleteFrom('businessMailMessages')
        .where('mailbox', '=', input.purpose)
        .where('refType', '=', input.refType)
        .where('refId', '=', input.refId)
        .where('status', '=', 'draft')
        .where('draftOf', 'is', null)
        .execute();
      const settings = (await deps.settings.read()).value;
      const now = new Date();
      const id = randomUUID();
      await database
        .query()
        .insertInto('businessMailMessages')
        .values({
          id,
          mailbox: input.purpose,
          direction: 'outbound',
          status: 'draft',
          messageId: null,
          inReplyTo: null,
          threadKey: thread ? str(thread.threadKey) : newThreadKey(),
          fromAddress: mailboxConfig(input.purpose).address,
          fromName: null,
          toAddresses: [input.to.toLowerCase()],
          ccAddresses: [],
          subject: input.subject.slice(0, 500),
          bodyText: input.body.slice(0, 100_000),
          attachmentFileIds: [],
          rejectedAttachments: [],
          refType: input.refType,
          refId: input.refId,
          aiIntent: null,
          aiSummary: null,
          draftOf: null,
          proposal: null,
          sentBy: null,
          sentAt: null,
          deliveryError: null,
          receivedAt: null,
          retentionUntil: addDays(
            now,
            settings.mailboxes[input.purpose].retentionDays,
          ),
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
        .updateTable('businessMailMessages')
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
        .updateTable('businessMailMessages')
        .set({ bodyText: body.slice(0, 100_000), updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return row(id);
    },

    /** Sends a draft: the only way a reply leaves the application. */
    async send(ctx: ActorContext, id: string) {
      const mail = await service.get(ctx, id);
      await requireSend(ctx, mail.mailbox);
      if (mail.status !== 'draft') throw new HrError('MAIL_NOT_DRAFT', 409);
      const settings = (await deps.settings.read()).value;
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
      // The message it answers, so the plugin sends it in that conversation.
      const original = mail.draftOf
        ? await database
            .query()
            .selectFrom('businessMailMessages')
            .select(['mailMessageRef'])
            .where('id', '=', mail.draftOf)
            .executeTakeFirst()
        : undefined;
      const { state, accountId } = await submit(mail.mailbox, {
        idempotencyKey: `hr-mail-${id}`,
        to,
        subject,
        text: prepared.text,
        inReplyToRef: original?.mailMessageRef
          ? str(original.mailMessageRef)
          : null,
      });
      const now = new Date();
      await database
        .query()
        .updateTable('businessMailMessages')
        .set(
          state === 'sent'
            ? {
                status: 'sent',
                subject,
                bodyText: prepared.storedText.slice(0, 100_000),
                sentBy: ctx.userId,
                sentAt: now,
                deliveryError: null,
                mailAccountId: accountId,
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
     * invitation, an offer, a reminder): recorded as sent in the record's thread, with the thread's tag in the
     * subject, so the answer comes back to the same record. Sent once per idempotency key.
     */
    async sendDirect(input: {
      purpose: MailPurpose;
      idempotencyKey: string;
      to: string;
      subject: string;
      text: string;
      refType: string | null;
      refId: string | null;
      /** A step's own test address, when it has one (招聘设置 · 邮件). */
      redirectTo?: string;
      /** What the thread keeps when the sent text must not be stored (a one-time code). */
      storedText?: string;
      /** What the message carries, for the step's own use (人事邮箱: which document). */
      proposal?: Record<string, unknown> | null;
    }): Promise<'sent' | 'channelNotConfigured' | 'failed' | null> {
      // null: the mailbox is off or has no account, so the step sends the way it did before mail was connected.
      const settings = (await deps.settings.read()).value;
      if (!settings.mailboxes[input.purpose].enabled) return null;
      if (!(await binding(input.purpose))) return null;
      const messageId = `<${input.idempotencyKey}>`;
      const done = await database
        .query()
        .selectFrom('businessMailMessages')
        .select(['status'])
        .where('mailbox', '=', input.purpose)
        .where('messageId', '=', messageId)
        .executeTakeFirst();
      if (done?.status === 'sent') return 'sent';
      const thread =
        input.refType && input.refId
          ? await database
              .query()
              .selectFrom('businessMailMessages')
              .select(['threadKey'])
              .where('mailbox', '=', input.purpose)
              .where('refType', '=', input.refType)
              .where('refId', '=', input.refId)
              .orderBy('createdAt', 'desc')
              .executeTakeFirst()
          : undefined;
      const threadKey = thread ? str(thread.threadKey) : newThreadKey();
      const subject = `${input.subject} [#${threadKey}]`;
      const redirect = input.redirectTo || settings.redirectTo;
      const to = !deps.production && redirect ? redirect : input.to;
      const { state, accountId } = await submit(input.purpose, {
        idempotencyKey: `hr-mail-${input.idempotencyKey}`.slice(0, 190),
        to,
        subject,
        text: input.text,
        inReplyToRef: null,
      });
      const now = new Date();
      if (done)
        await database
          .query()
          .updateTable('businessMailMessages')
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
          .insertInto('businessMailMessages')
          .values({
            id: randomUUID(),
            mailbox: input.purpose,
            direction: 'outbound',
            status: state === 'sent' ? 'sent' : 'failed',
            messageId,
            inReplyTo: null,
            threadKey,
            fromAddress: mailboxConfig(input.purpose).address,
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
            proposal: input.proposal ?? null,
            draftOf: null,
            sentBy: null,
            sentAt: state === 'sent' ? now : null,
            deliveryError: state === 'sent' ? null : state,
            receivedAt: null,
            retentionUntil: addDays(
              now,
              settings.mailboxes[input.purpose].retentionDays,
            ),
            mailAccountId: accountId,
            mailMessageRef: null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      return state;
    },

    /** 设置 / 邮件: every Mail plugin account, to bind one to a purpose (HR administrators; checked by the route). */
    async accounts() {
      const accounts = await deps
        .mail()
        .listManagedAccounts({ actorId: 'system' });
      return accounts.map((a) => ({
        id: a.id,
        address: a.address,
        ownerUserId: a.userId,
        ownerName: a.ownerName ?? null,
        provider: a.provider.type,
        status: a.status,
      }));
    },

    /** A binding names an existing account and its real owner, or nothing. */
    async checkBindings(
      mailboxes: Record<string, { accountId?: string; ownerUserId?: string }>,
    ) {
      const accounts = await service.accounts();
      // One account serves one purpose: two purposes reading one inbox would each take every message.
      const bound = Object.values(mailboxes)
        .map((m) => m.accountId)
        .filter((id): id is string => Boolean(id));
      if (new Set(bound).size !== bound.length)
        throw new HrError('MAIL_ACCOUNT_IN_USE', 400);
      for (const mailbox of Object.values(mailboxes)) {
        if (!mailbox.accountId && !mailbox.ownerUserId) continue;
        const account = accounts.find((a) => a.id === mailbox.accountId);
        if (!account || account.ownerUserId !== mailbox.ownerUserId)
          throw new HrError('MAIL_ACCOUNT_INVALID', 400);
      }
    },

    /** The business mailboxes bound to the user's own accounts (我的邮箱 marks them and keeps them from removal). */
    async myBindings(ctx: ActorContext) {
      const settings = (await deps.settings.read()).value;
      return MAIL_PURPOSES.filter(
        (p) =>
          settings.mailboxes[p].accountId &&
          settings.mailboxes[p].ownerUserId === ctx.userId,
      ).map((purpose) => ({
        purpose,
        accountId: settings.mailboxes[purpose].accountId,
      }));
    },

    /**
     * 我的邮箱往来: messages in the user's own Mail accounts that involve an
     * address (a candidate's), newest first. The plugin checks the ownership.
     */
    async mine(ctx: ActorContext, address: string) {
      const target = address.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+$/u.test(target))
        throw new HrError('INVALID_INPUT', 400);
      // The user's mailboxes are synchronized in the background too, so a message that just arrived shows on the next look.
      const own = { actorId: ctx.userId };
      for (const account of await deps
        .mail()
        .listAccounts(own)
        .catch(() => []))
        if (account.status === 'active')
          void deps
            .mail()
            .startSync(own, { accountId: account.id })
            .catch(() => undefined);
      const page = await deps
        .mail()
        .listMessages({ actorId: ctx.userId }, { query: target, limit: 50 });
      return page.items
        .filter(
          (m) =>
            !m.draft &&
            [m.from, ...m.to, ...m.cc]
              .filter((a): a is NonNullable<typeof a> => Boolean(a))
              .some((a) => a.address.toLowerCase() === target),
        )
        .map((m) => ({
          accountId: m.accountId,
          id: m.id,
          subject: m.subject,
          from: m.from ?? null,
          to: m.to,
          at: m.receivedAt ?? m.sentAt ?? null,
          preview: m.preview ?? '',
        }));
    },

    /** One message of the user's own accounts, as text. */
    async mineMessage(ctx: ActorContext, accountId: string, messageId: string) {
      const message = await deps
        .mail()
        .getMessage({ actorId: ctx.userId }, accountId, messageId)
        .catch(() => undefined);
      if (!message) throw new HrError('MAIL_NOT_FOUND', 404);
      return {
        id: message.id,
        subject: message.subject,
        from: message.from ?? null,
        to: message.to,
        at: message.receivedAt ?? message.sentAt ?? null,
        text: message.text ?? '',
        attachments: message.attachments.map((a) => a.fileName),
      };
    },

    /** Daily: bodies and attachments past their retention are cleared; subject, addresses and links stay. */
    async sweepRetention(date: string) {
      const expired = await database
        .query()
        .selectFrom('businessMailMessages')
        .select(['id'])
        .where('retentionUntil', '<', date)
        .where('bodyText', 'is not', null)
        .execute();
      if (!expired.length) return { cleared: 0 };
      await database
        .query()
        .updateTable('businessMailMessages')
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

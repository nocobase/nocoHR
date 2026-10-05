/**
 * 业务邮箱与邮件往来 (总纲 邮件约定, V2-06): the purposes, the stored message
 * shape and the per-purpose handlers later steps register.
 */
import type { ActorContext } from '../framework-service.js';

/** A business mailbox's purpose; each has its own permission and handler. */
export const MAIL_PURPOSES = ['billing', 'recruiting', 'audit', 'hr'] as const;
export type MailPurpose = (typeof MAIL_PURPOSES)[number];

export const MAIL_STATUSES = [
  // Received
  'received',
  'linked',
  'unmatched',
  'ignored',
  // Sent
  'draft',
  'sent',
  'failed',
] as const;
export type MailStatus = (typeof MAIL_STATUSES)[number];

export interface MailAddress {
  readonly address: string;
  readonly name: string | null;
}

export interface MailMessage {
  readonly id: string;
  readonly mailbox: MailPurpose;
  readonly direction: 'inbound' | 'outbound';
  readonly status: MailStatus;
  readonly threadKey: string;
  readonly from: MailAddress;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  /** Empty once the retention period has passed. */
  readonly bodyText: string | null;
  readonly attachments: readonly {
    readonly fileId: string;
    readonly filename: string;
  }[];
  /** Attachments not kept: a type not allowed, too large, or macro-enabled. */
  readonly rejectedAttachments: readonly {
    readonly filename: string;
    readonly reason: string;
  }[];
  readonly refType: string | null;
  readonly refId: string | null;
  readonly aiIntent: string | null;
  readonly aiSummary: string | null;
  readonly draftOf: string | null;
  readonly sentBy: string | null;
  readonly sentAt: string | null;
  readonly deliveryError: string | null;
  readonly receivedAt: string | null;
  readonly retentionUntil: string;
  readonly createdAt: string;
}

/**
 * What a step contributes for its purpose. The mail service stores, dedupes and
 * threads every message; the handler decides who may see it and what a new or
 * replying message means for its records.
 */
export interface MailHandler {
  /** Whether the user may read this purpose's mail. */
  canView(ctx: ActorContext): Promise<boolean>;
  /** Whether the user may send drafts of this purpose. */
  canSend(ctx: ActorContext): Promise<boolean>;
  /** Users notified about new mail of this purpose. */
  recipients(): Promise<string[]>;
  /**
   * A message that belongs to no thread yet: recognise it, link it or leave it unmatched. `attempt` is set when a
   * person asks for it again (重新识别), so the task runs anew instead of being skipped as a repeat.
   */
  onUnmatched(mail: MailMessage, attempt?: string): Promise<void>;
  /** A reply in a thread already linked to a record. */
  onReply(mail: MailMessage): Promise<void>;
  /**
   * Called as a person sends a draft of this purpose: what actually goes out
   * (`text`), what the thread keeps instead (`storedText`, e.g. without a
   * share link), and what to do once it was delivered. A step that adds
   * nothing at sending leaves this out.
   */
  prepareSend?(
    ctx: ActorContext,
    mail: MailMessage,
  ): Promise<{
    text: string;
    storedText: string;
    onSent?: () => Promise<void>;
  }>;
}

/**
 * 邮件往来 (V2-06): the message shape the `/api/talent/mail` endpoints answer
 * and the mailboxes the signed-in user may open.
 */
import { useRemote } from './use-remote.js';

export type MailPurpose = 'billing' | 'recruiting' | 'audit' | 'hr';

export interface MailMessage {
  readonly id: string;
  readonly mailbox: MailPurpose;
  readonly direction: 'inbound' | 'outbound';
  readonly status:
    | 'received'
    | 'linked'
    | 'unmatched'
    | 'ignored'
    | 'draft'
    | 'sent'
    | 'failed';
  readonly threadKey: string;
  readonly from: { address: string; name: string | null };
  readonly to: readonly string[];
  readonly subject: string;
  readonly bodyText: string | null;
  readonly attachments: readonly { fileId: string; filename: string }[];
  readonly rejectedAttachments: readonly {
    filename: string;
    reason: 'unsafe' | 'type' | 'size';
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
  readonly createdAt: string;
}

export interface Mailbox {
  readonly purpose: MailPurpose;
  readonly address: string;
  readonly enabled: boolean;
  readonly adapter: 'mock' | 'imap' | 'none';
  readonly canSend: boolean;
  readonly unmatched: number;
}

export function useMailboxes() {
  return useRemote<Mailbox[]>('talent/mail/mailboxes');
}

/** Where a linked record opens. */
export function recordPath(message: MailMessage): string | null {
  if (!message.refId) return null;
  if (message.refType === 'laborVendorBill')
    return `/talent/payroll/vendor-bills/${encodeURIComponent(message.refId)}`;
  if (message.refType === 'application')
    return `/talent/candidates/${encodeURIComponent(message.refId)}`;
  return null;
}

/** The subject as people read it: the thread tag (`[#3f2a…]`) only routes replies, so it is not shown. */
export function displaySubject(subject: string): string {
  return subject.replace(/\s*\[#[0-9a-f]{12}\]/giu, '').trim();
}

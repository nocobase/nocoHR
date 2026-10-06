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
  /**
   * A reschedule reply: the times the interview could move to and the one the text names.
   * A document reply (人事邮箱, V1-02 V2 增补): the document whose link is made when the reply is sent.
   */
  readonly proposal: {
    readonly kind: string;
    readonly options?: readonly { start: string; label?: string }[];
    readonly chosen?: number;
    readonly document?: string;
    readonly employeeId?: string;
  } | null;
}

export interface Mailbox {
  readonly purpose: MailPurpose;
  readonly address: string;
  readonly enabled: boolean;
  /** The Mail plugin provider type of the bound account, or none. */
  readonly adapter:
    'local-files' | 'imap-smtp' | 'gmail' | 'microsoft' | 'none';
  readonly canSend: boolean;
  /** 归类: sort the unsorted mail (recognise again, ignore, transfer). */
  readonly canAssign: boolean;
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
  if (message.refType === 'auditRequest')
    return `/talent/audit?tab=requests&request=${encodeURIComponent(message.refId)}`;
  if (message.refType === 'employee')
    return `/talent/employees/${encodeURIComponent(message.refId)}`;
  if (message.refType === 'application')
    return `/talent/candidates/${encodeURIComponent(message.refId)}`;
  if (message.refType === 'jobPosting')
    return `/talent/postings/${encodeURIComponent(message.refId)}`;
  return null;
}

/** The subject as people read it: the thread tag (`[#3f2a…]`) only routes replies, so it is not shown. */
export function displaySubject(subject: string): string {
  return subject.replace(/\s*\[#[0-9a-f]{12}\]/giu, '').trim();
}

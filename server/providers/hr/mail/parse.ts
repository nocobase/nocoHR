/**
 * Reads a raw RFC 822 message into the parts the mail service keeps. HTML is
 * reduced to plain text (no scripts run, no remote images load); attachments
 * are returned as bytes for the service to filter and store.
 */
import { simpleParser, type AddressObject } from 'mailparser';

export interface ParsedMail {
  readonly messageId: string | null;
  readonly inReplyTo: string | null;
  readonly references: readonly string[];
  readonly from: { address: string; name: string | null };
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly date: Date | null;
  readonly attachments: readonly {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }[];
}

function addresses(value: AddressObject | AddressObject[] | undefined) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((group) => group.value)
    .map((a) => ({
      address: (a.address ?? '').trim().toLowerCase(),
      name: a.name?.trim() || null,
    }))
    .filter((a) => a.address);
}

export async function parseMail(raw: Uint8Array): Promise<ParsedMail> {
  const mail = await simpleParser(Buffer.from(raw), {
    skipImageLinks: true,
    skipTextToHtml: true,
  });
  const from = addresses(mail.from)[0] ?? { address: '', name: null };
  const references = Array.isArray(mail.references)
    ? mail.references
    : mail.references
      ? [mail.references]
      : [];
  return {
    messageId: mail.messageId?.trim() || null,
    inReplyTo: mail.inReplyTo?.trim() || null,
    references,
    from,
    to: addresses(mail.to).map((a) => a.address),
    cc: addresses(mail.cc).map((a) => a.address),
    subject: (mail.subject ?? '').trim(),
    // mailparser derives plain text from HTML when the message has no text part.
    text: (mail.text ?? '').trim(),
    date: mail.date ?? null,
    attachments: mail.attachments.map((a, index) => ({
      filename: (a.filename ?? `attachment-${index + 1}`).trim(),
      contentType: (a.contentType ?? 'application/octet-stream').toLowerCase(),
      bytes: new Uint8Array(a.content),
    })),
  };
}

/**
 * Demo mail for the local mock mailboxes (总纲 邮件约定: 开发 / 演示环境使用本地
 * 模拟邮箱). Messages are written as .eml files under
 * `storage/mail/inbox/<purpose>/`, which the mock adapter reads on the next
 * 收信; ones kept for an acceptance step go to `storage/demo-materials/mail/`.
 * Addresses use reserved `.test` domains; nothing is sent anywhere.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const encodeWord = (text: string): string =>
  /^[\x20-\x7e]*$/u.test(text)
    ? text
    : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;

const wrap = (base64: string): string => base64.replace(/.{1,76}/gu, '$&\r\n');

export interface DemoMail {
  readonly from: { name: string; address: string };
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly date: Date;
  readonly attachments?: readonly {
    filename: string;
    contentType: string;
    bytes: Uint8Array;
  }[];
}

/** An RFC 822 message with a plain-text body and base64 attachments. */
export function composeMail(mail: DemoMail): string {
  const boundary = `----=_demo_${randomUUID()}`;
  const headers = [
    `From: ${encodeWord(mail.from.name)} <${mail.from.address}>`,
    `To: ${mail.to}`,
    `Subject: ${encodeWord(mail.subject)}`,
    `Date: ${mail.date.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${mail.from.address.split('@')[1]}>`,
    'MIME-Version: 1.0',
  ];
  const body = wrap(Buffer.from(mail.text, 'utf8').toString('base64'));
  if (!mail.attachments?.length)
    return [
      ...headers,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      body,
    ].join('\r\n');
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    ...mail.attachments.flatMap((a) => [
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${encodeWord(a.filename)}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${encodeWord(a.filename)}"`,
      '',
      wrap(Buffer.from(a.bytes).toString('base64')),
    ]),
    `--${boundary}--`,
    '',
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    ...parts,
  ].join('\r\n');
}

/**
 * Writes a demo message once: skipped when the file is already waiting or was
 * already read (moved to `processed/`), so seeding again sends nothing twice.
 */
export function writeDemoMail(dir: string, name: string, mail: DemoMail): void {
  if (
    existsSync(path.join(dir, name)) ||
    existsSync(path.join(dir, 'processed', name))
  )
    return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), composeMail(mail));
}

export const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

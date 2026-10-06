/**
 * 文件分享链接 (V1-02 V2 增补): a document handed to someone outside the
 * company by a link instead of an attachment. The link is stored as a hash
 * and lasts 7 days; opening it asks for a one-time code sent only to the
 * recipient's address (10 minutes, 5 attempts, never stored); each download
 * is recorded; a revoked or expired link opens nothing.
 */
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import type { DatabaseManager } from '@nocobase/db';

import type { MailService } from '../mail/service.js';
import { HrError, newId, str } from '../shared.js';
import { DOCUMENT_TITLES, type DocumentKind } from './documents.js';

export const SHARE_DAYS = 7;
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const time = (value: unknown): number =>
  value instanceof Date
    ? value.getTime()
    : typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : 0;

const iso = (value: unknown): string | null => {
  const t = time(value);
  return t ? new Date(t).toISOString() : null;
};

function mask(address: string): string {
  const [local = '', host = ''] = address.split('@');
  return `${local.slice(0, 1)}***@${host}`;
}

export function createDocumentShares(deps: {
  database: DatabaseManager;
  mail: () => MailService;
  storeFile: (file: { name: string; bytes: Uint8Array }) => Promise<string>;
  readFile: (
    fileId: string,
  ) => Promise<{ bytes: Uint8Array; filename: string } | null>;
  publicUrl: (path: string) => string;
  companyName: () => string;
  now: () => Date;
}) {
  const { database } = deps;

  async function byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/u.test(token))
      throw new HrError('DOCUMENT_LINK_INVALID', 404);
    const row = await database
      .query()
      .selectFrom('documentShares')
      .selectAll()
      .where('tokenHash', '=', hash(token))
      .executeTakeFirst();
    if (!row || row.revokedAt || time(row.expiresAt) <= deps.now().getTime())
      throw new HrError('DOCUMENT_LINK_INVALID', 404);
    return row as Record<string, unknown>;
  }

  async function update(id: string, values: Record<string, unknown>) {
    await database
      .query()
      .updateTable('documentShares')
      .set({ ...values, updatedAt: deps.now() })
      .where('id', '=', id)
      .execute();
  }

  return {
    /** Stores the document and makes its link; answers the link (shown once, never stored). */
    async create(input: {
      kind: DocumentKind;
      employeeId: string;
      fileName: string;
      bytes: Uint8Array;
      recipientAddress: string;
      createdBy: string | null;
    }): Promise<{ id: string; url: string; expiresAt: Date }> {
      const fileId = await deps.storeFile({
        name: input.fileName,
        bytes: input.bytes,
      });
      const token = randomBytes(24).toString('base64url');
      const now = deps.now();
      const expiresAt = new Date(now.getTime() + SHARE_DAYS * 86_400_000);
      const id = newId();
      await database
        .query()
        .insertInto('documentShares')
        .values({
          id,
          kind: input.kind,
          employeeId: input.employeeId,
          fileId,
          fileName: input.fileName,
          recipientAddress: input.recipientAddress.toLowerCase(),
          tokenHash: hash(token),
          expiresAt,
          revokedAt: null,
          codeHash: null,
          codeExpiresAt: null,
          codeAttempts: 0,
          codeSentAt: null,
          downloads: [],
          createdBy: input.createdBy,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return { id, url: deps.publicUrl(`/hr-document/${token}`), expiresAt };
    },

    /** Whether an employee already has a document of a kind (a job handler runs again on retries). */
    async has(employeeId: string, kind: DocumentKind, fileName: string) {
      return Boolean(
        await database
          .query()
          .selectFrom('documentShares')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('kind', '=', kind)
          .where('fileName', '=', fileName)
          .executeTakeFirst(),
      );
    },

    async view(token: string) {
      const row = await byToken(token);
      return {
        title:
          DOCUMENT_TITLES[str(row.kind) as DocumentKind] ?? str(row.fileName),
        company: deps.companyName(),
        recipient: mask(str(row.recipientAddress)),
        expiresAt: iso(row.expiresAt),
        fileName: str(row.fileName),
      };
    },

    async sendCode(token: string) {
      const row = await byToken(token);
      const now = deps.now();
      if (
        row.codeSentAt &&
        now.getTime() - time(row.codeSentAt) < CODE_RESEND_SECONDS * 1000
      )
        throw new HrError('DOCUMENT_CODE_TOO_SOON', 409);
      const id = str(row.id);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const state = await deps.mail().sendDirect({
        purpose: 'hr',
        idempotencyKey: `hr-document-code:${id}:${now.getTime()}`,
        to: str(row.recipientAddress),
        subject: `${deps.companyName()}文件验证码`,
        text: `验证码：${code}\n\n${CODE_MINUTES} 分钟内有效，用于打开${deps.companyName()}发给你的文件。如非本人操作，请忽略本邮件。`,
        storedText: `验证码：******（${CODE_MINUTES} 分钟内有效，不保存原文）`,
        refType: 'employee',
        refId: str(row.employeeId),
      });
      if (state !== 'sent') throw new HrError('DOCUMENT_CODE_UNAVAILABLE', 409);
      await update(id, {
        codeHash: hash(`${id}:${code}`),
        codeExpiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
        codeAttempts: 0,
        codeSentAt: now,
      });
      return { sentTo: mask(str(row.recipientAddress)) };
    },

    async download(token: string, code: unknown, ip: string) {
      const row = await byToken(token);
      const id = str(row.id);
      const attempts = Number(row.codeAttempts ?? 0);
      if (attempts >= CODE_ATTEMPTS)
        throw new HrError('DOCUMENT_CODE_LOCKED', 409);
      const now = deps.now();
      const valid =
        typeof code === 'string' &&
        /^\d{6}$/u.test(code) &&
        Boolean(row.codeHash) &&
        time(row.codeExpiresAt) > now.getTime() &&
        timingSafeEqual(
          Buffer.from(hash(`${id}:${code}`)),
          Buffer.from(str(row.codeHash)),
        );
      if (!valid) {
        await update(id, { codeAttempts: attempts + 1 });
        throw new HrError('DOCUMENT_CODE_INVALID', 400);
      }
      const file = await deps.readFile(str(row.fileId));
      if (!file) throw new HrError('DOCUMENT_LINK_INVALID', 404);
      const downloads = [
        ...((Array.isArray(row.downloads)
          ? row.downloads
          : JSON.parse(str(row.downloads) || '[]')) as {
          at: string;
          ip: string;
        }[]),
        { at: now.toISOString(), ip: ip.slice(0, 64) },
      ].slice(-200);
      await update(id, {
        codeHash: null,
        codeExpiresAt: null,
        codeAttempts: 0,
        downloads,
      });
      return { bytes: file.bytes, filename: str(row.fileName) };
    },
  };
}

export type DocumentShares = ReturnType<typeof createDocumentShares>;

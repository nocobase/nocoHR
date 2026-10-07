import type { DatabaseManager } from '@nocobase/db';

import { HrError } from './shared.js';

/**
 * What an `hrFiles:uploadOne` upload is for. The purpose is chosen by the
 * caller (`?purpose=`), checked against the caller's permission, and stamped on
 * the row with the uploader (`hrFiles.purpose` / `uploadedByUserId`, migration
 * 202610250001). A record accepts only a file the caller uploaded for its
 * purpose, so a file id that belongs to another record — a contract scan, a
 * payroll import, a mail attachment — cannot be attached and then read through
 * the record that now references it.
 */
export type HrFilePurpose =
  | 'courseVideo'
  | 'profileAttachment'
  | 'contract'
  | 'kbDocument'
  | 'jobDescription';

interface FileFormat {
  readonly ext: readonly string[];
  /** Stored MIME types accepted for this format; empty accepts any. */
  readonly mime: readonly string[];
  /** Checks the first bytes of the content. */
  readonly sniff: (head: Uint8Array) => boolean;
}

const startsWith = (head: Uint8Array, bytes: readonly number[], at = 0) =>
  bytes.every((byte, index) => head[at + index] === byte);
const ascii = (value: string) => [...value].map((c) => c.charCodeAt(0));

const PDF: FileFormat = {
  ext: ['pdf'],
  mime: [],
  sniff: (h) => startsWith(h, ascii('%PDF-')),
};
const PNG: FileFormat = {
  ext: ['png'],
  mime: [],
  sniff: (h) => startsWith(h, [137, 80, 78, 71, 13, 10, 26, 10]),
};
const JPEG: FileFormat = {
  ext: ['jpg', 'jpeg'],
  mime: [],
  sniff: (h) => startsWith(h, [255, 216, 255]),
};
const WEBP: FileFormat = {
  ext: ['webp'],
  mime: [],
  sniff: (h) => startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8),
};
const GIF: FileFormat = {
  ext: ['gif'],
  mime: [],
  sniff: (h) => startsWith(h, ascii('GIF8')),
};
/** docx / xlsx / pptx are ZIP containers. */
const OOXML: FileFormat = {
  ext: ['docx', 'xlsx', 'pptx'],
  mime: [],
  sniff: (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]),
};
/** Legacy doc / xls are OLE compound files. */
const OLE: FileFormat = {
  ext: ['doc', 'xls'],
  mime: [],
  sniff: (h) => startsWith(h, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};
/** Markdown and plain text: no NUL byte at the start. */
const TEXT: FileFormat = {
  ext: ['md', 'markdown', 'txt'],
  mime: [],
  sniff: (h) => !h.includes(0),
};
/**
 * MP4 only: the course editor accepts `video/mp4`, every browser plays it, and
 * the lesson endpoint serves the stored type. An ISO media file opens with a
 * box whose type, at byte 4, is `ftyp`.
 */
const MP4: FileFormat = {
  ext: ['mp4', 'm4v'],
  mime: ['video/mp4'],
  sniff: (h) => startsWith(h, ascii('ftyp'), 4),
};

const MB = 1024 * 1024;

export interface HrFilePurposeRule {
  /** The permission the upload needs. */
  readonly resource: string;
  readonly action: string;
  readonly maxSize: number;
  readonly formats: readonly FileFormat[];
}

export const HR_FILE_PURPOSES: Readonly<
  Record<HrFilePurpose, HrFilePurposeRule>
> = {
  courseVideo: {
    resource: 'talent.course',
    action: 'manage',
    maxSize: 200 * MB,
    formats: [MP4],
  },
  profileAttachment: {
    resource: 'talent.profile',
    action: 'manage',
    maxSize: 20 * MB,
    formats: [PDF, PNG, JPEG, WEBP, GIF, OOXML, OLE],
  },
  contract: {
    resource: 'talent.contract',
    action: 'manage',
    maxSize: 20 * MB,
    formats: [PDF, PNG, JPEG],
  },
  kbDocument: {
    resource: 'talent.kbDocument',
    action: 'manage',
    maxSize: 20 * MB,
    formats: [PDF, OOXML, TEXT],
  },
  jobDescription: {
    resource: 'talent.framework',
    action: 'manage',
    maxSize: 20 * MB,
    formats: [PDF, OOXML, TEXT],
  },
};

export function isHrFilePurpose(value: unknown): value is HrFilePurpose {
  return typeof value === 'string' && Object.hasOwn(HR_FILE_PURPOSES, value);
}

/** A text column's value; anything else reads as empty. */
export const textOf = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** The number of leading bytes {@link acceptsHrFile} looks at. */
export const SNIFF_BYTES = 16;

/** Whether an uploaded file (its extension, stored type, size and first bytes) fits the purpose. */
export function acceptsHrFile(
  purpose: HrFilePurpose,
  file: {
    readonly ext: string;
    readonly mimeType: string;
    readonly size: number;
    readonly head?: Uint8Array;
  },
): boolean {
  const rule = HR_FILE_PURPOSES[purpose];
  if (!(file.size > 0) || file.size > rule.maxSize) return false;
  const ext = file.ext.toLowerCase().replace(/^\./u, '');
  const mime = file.mimeType.toLowerCase();
  return rule.formats.some(
    (format) =>
      format.ext.includes(ext) &&
      (!format.mime.length || format.mime.includes(mime)) &&
      (!file.head || format.sniff(file.head)),
  );
}

/**
 * Refuses a file id a record may not take: accepted are a file the caller
 * uploaded for this purpose whose stored type still fits it, and a file the
 * record already references (`referencedHere`, so saving a record unchanged
 * keeps a file attached before purposes were recorded). `referencedElsewhere`
 * refuses a file another record of the same kind already holds.
 */
export async function assertUsableHrFile(
  database: DatabaseManager,
  input: {
    readonly fileId: string;
    readonly userId: string;
    readonly purpose: HrFilePurpose;
    readonly referencedHere?: boolean;
    readonly referencedElsewhere?: () => Promise<boolean>;
    readonly code: string;
  },
): Promise<void> {
  if (input.referencedHere) return;
  const file = await database
    .query()
    .selectFrom('hrFiles')
    .select(['purpose', 'uploadedByUserId', 'ext', 'mimeType', 'size'])
    .where('id', '=', input.fileId)
    .executeTakeFirst();
  if (
    !file ||
    file.purpose !== input.purpose ||
    textOf(file.uploadedByUserId) !== input.userId ||
    !acceptsHrFile(input.purpose, {
      ext: textOf(file.ext),
      mimeType: textOf(file.mimeType),
      size: Number(file.size),
    }) ||
    (input.referencedElsewhere && (await input.referencedElsewhere()))
  )
    throw new HrError(input.code, 404);
}

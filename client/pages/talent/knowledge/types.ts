import type { KbDocumentDetail } from '@/components/talent/learning-types';

export interface KnowledgeOutletContext {
  readonly reload: () => void;
}

/** What a document's detail page passes to its 上传新版本 dialog. */
export interface DocumentOutletContext {
  readonly document: KbDocumentDetail;
  /** Refreshes the document and the list after a new version is uploaded. */
  readonly reload: () => void;
}

/** The file types text can be extracted from. */
export const DOCUMENT_FILE_ACCEPT =
  '.pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain';

export const DOCUMENT_CATEGORIES = [
  'policy',
  'sop',
  'manual',
  'other',
] as const;

/** 复核状态 filters: due within the notice window, or past the review date. */
export const REVIEW_FILTERS = ['dueSoon', 'overdue'] as const;
export type ReviewState = (typeof REVIEW_FILTERS)[number];

/** Review dates within this many days count as 30 天内到期, matching the default reminder window. */
const DUE_SOON_DAYS = 30;

function localDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Whether a next review date (YYYY-MM-DD) is overdue, due soon, or neither. */
export function reviewState(
  date: string | null | undefined,
): ReviewState | null {
  if (!date) return null;
  if (date < localDate()) return 'overdue';
  if (date <= localDate(DUE_SOON_DAYS)) return 'dueSoon';
  return null;
}

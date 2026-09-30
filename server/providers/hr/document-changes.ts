/**
 * Deterministic text work for document versions (V2 step 6): which sections
 * changed between two versions, which content a change touches, the numbers a
 * change replaced, when a statement in one document contradicts another, and
 * working-day due dates. No AI here: the change list, the affected content and
 * the people who must retrain are decided by rules; the AI only words drafts.
 */
import { splitSections } from './document-text.js';

export type ChangeType = 'added' | 'modified' | 'removed';

export interface SectionChange {
  readonly sectionTitle: string;
  readonly changeType: ChangeType;
  readonly before: string | null;
  readonly after: string | null;
}

/** Whitespace and Markdown emphasis do not make a change. */
export function normalizeText(text: string): string {
  return text
    .replace(/[*_`>#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** A section title without its trailing punctuation, for pairing sections across versions. */
function titleKey(title: string): string {
  return title.replace(/\s+/gu, ' ').trim();
}

/**
 * Compares two versions section by section, pairing sections by title. The
 * untitled text before the first heading (the document header, which carries
 * the version number) is not a section and never counts as a change.
 */
export function diffSections(
  previousText: string | null | undefined,
  currentText: string | null | undefined,
): SectionChange[] {
  const before = splitSections(previousText).filter((s) => s.title);
  const after = splitSections(currentText).filter((s) => s.title);
  const oldByTitle = new Map(before.map((s) => [titleKey(s.title), s]));
  const newTitles = new Set(after.map((s) => titleKey(s.title)));
  const changes: SectionChange[] = [];
  for (const section of after) {
    const previous = oldByTitle.get(titleKey(section.title));
    if (!previous)
      changes.push({
        sectionTitle: section.title,
        changeType: 'added',
        before: null,
        after: section.text,
      });
    else if (normalizeText(previous.text) !== normalizeText(section.text))
      changes.push({
        sectionTitle: section.title,
        changeType: 'modified',
        before: previous.text,
        after: section.text,
      });
  }
  for (const section of before)
    if (!newTitles.has(titleKey(section.title)))
      changes.push({
        sectionTitle: section.title,
        changeType: 'removed',
        before: section.text,
        after: null,
      });
  return changes;
}

/** Sentences of a passage long enough to identify it in other content. */
export function fragments(text: string | null | undefined, min = 6): string[] {
  if (!text) return [];
  return normalizeText(text)
    .split(/[。；;！!？?\n]|(?<=[:：])\s/u)
    .map((part) => part.replace(/^[-•\d.、\s]+/u, '').trim())
    .filter((part) => part.length >= min);
}

/** The section number at the start of a title, such as `5.3` in `5.3 灌装中断`. */
export function sectionNumber(title: string): string | null {
  const match = /^(\d+(?:\.\d+)*)\b/u.exec(title.trim());
  return match ? match[1] : null;
}

/** Whether content quotes or restates the text a change replaced. */
export function touchesChange(content: string, change: SectionChange): boolean {
  const haystack = normalizeText(content).replace(/\s/gu, '');
  if (!haystack) return false;
  return fragments(change.before).some((part) =>
    haystack.includes(part.replace(/\s/gu, '')),
  );
}

// 元 and 起 (V1-04): allowances and quality thresholds are the kind of number documents disagree on.
const QUANTITY =
  /(\d+(?:\.\d+)?)\s*(分钟|小时|天|日|周|个月|月|年|次|%|℃|°C|支|人|件|批|元|起|mm|cm|m|kg|g|ml|mL|L)/gu;

export interface Quantity {
  readonly value: string;
  readonly unit: string;
  readonly text: string;
}

export function quantities(text: string | null | undefined): Quantity[] {
  if (!text) return [];
  return [...text.matchAll(QUANTITY)].map((m) => ({
    value: m[1],
    unit: m[2],
    text: m[0],
  }));
}

/**
 * The numbers a change replaced, such as 15 分钟 → 10 分钟: quantities with the
 * same unit at the same position whose values differ.
 */
export function replacedQuantities(
  change: SectionChange,
): { from: Quantity; to: Quantity }[] {
  const was = quantities(change.before);
  const now = quantities(change.after);
  const pairs: { from: Quantity; to: Quantity }[] = [];
  const count = Math.min(was.length, now.length);
  for (let i = 0; i < count; i += 1)
    if (was[i].unit === now[i].unit && was[i].value !== now[i].value)
      pairs.push({ from: was[i], to: now[i] });
  return pairs;
}

/** Replaces a quantity wherever it appears, however it is spaced or emphasised. */
export function replaceQuantity(
  text: string,
  from: Quantity,
  to: Quantity,
): string {
  const pattern = new RegExp(
    `(\\*\\*)?${from.value.replace('.', '\\.')}(\\*\\*)?(\\s*)${from.unit}`,
    'gu',
  );
  return text.replace(
    pattern,
    (_all, open: string | undefined, close: string | undefined, gap: string) =>
      `${open ?? ''}${to.value}${close ?? ''}${gap}${to.unit}`,
  );
}

/** Overlapping character pairs of Chinese runs and whole Latin words, for similarity. */
function bigrams(text: string): Set<string> {
  const clean = normalizeText(text).replace(/\d+(?:\.\d+)?/gu, '#');
  const grams = new Set<string>();
  for (const run of clean.match(/[一-鿿]+/gu) ?? [])
    for (let i = 0; i < run.length - 1; i += 1) grams.add(run.slice(i, i + 2));
  for (const word of clean.toLowerCase().match(/[a-z]+/gu) ?? [])
    grams.add(word);
  return grams;
}

export function similarity(
  a: string,
  b: string,
): { ratio: number; shared: number } {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const gram of x) if (y.has(gram)) shared += 1;
  return { ratio: shared / Math.min(x.size, y.size), shared };
}

/** Clauses: sentences split further at commas, so a number is compared with the words around it. */
function clauses(text: string): string[] {
  return fragments(text, 4).flatMap((sentence) =>
    sentence
      .split(/[，,、]/u)
      .map((part) => part.trim())
      .filter((part) => part.length >= 4),
  );
}

export interface ConflictCandidate {
  readonly sentence: string;
  readonly otherSentence: string;
  readonly quantity: Quantity;
  readonly otherQuantity: Quantity;
}

/**
 * Statements that say the same thing with a different number: a sentence of
 * one passage and one of another that are mostly the same words and give the
 * same unit a different value, such as "超过 10 分钟须通知 QA" against "超过 15
 * 分钟须通知 QA". Used without a model; with one, the knowledge assistant
 * judges the candidates.
 */
export function numericConflicts(
  passage: string,
  otherPassage: string,
  threshold = 0.6,
): ConflictCandidate[] {
  const found: ConflictCandidate[] = [];
  for (const sentence of clauses(passage))
    for (const otherSentence of clauses(otherPassage)) {
      const { ratio, shared } = similarity(sentence, otherSentence);
      if (ratio < threshold || shared < 3) continue;
      for (const quantity of quantities(sentence))
        for (const otherQuantity of quantities(otherSentence))
          if (
            quantity.unit === otherQuantity.unit &&
            quantity.value !== otherQuantity.value
          )
            found.push({ sentence, otherSentence, quantity, otherQuantity });
    }
  return found;
}

/** A date-only string `days` working days (Monday to Friday) after `from`. */
export function addWorkingDays(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}

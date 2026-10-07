/**
 * V3-08 新岗位自动起草: 每项注明出自说明书哪一条 (01-演示案例 · 能力模型).
 *
 * A position's 岗位说明书 (`jdText`) and 职责说明 (`responsibilities`) are
 * split into numbered clauses before the framework advisor sees them, so a
 * drafted requirement can name the clause it comes from by number. The
 * numbers the model returns are checked against the clauses here: an unknown
 * number is dropped, and the stored quote is always taken from the clause
 * itself, so a reference can never cite text the document does not contain.
 */

export type ClauseSource = 'jd' | 'duties';

/** One numbered clause of a position's job description or duties. */
export interface DocumentClause {
  readonly source: ClauseSource;
  /** 1-based, in reading order, per source; headings are not numbered. */
  readonly number: number;
  /** The heading the clause stands under, such as 岗位职责; null before any heading. */
  readonly section: string | null;
  /** The document's own item number (the 2 of "2. 方案设计与报价"), when it has one. */
  readonly item: string | null;
  readonly text: string;
}

/** What a drafted requirement stores in `positionRequirements.sourceClauses`. */
export interface SourceClause {
  readonly source: ClauseSource;
  readonly number: number;
  readonly section: string | null;
  readonly item: string | null;
  readonly quote: string;
}

const QUOTE_LIMIT = 60;
const MAX_REFERENCES = 3;
/** A paragraph longer than this without item markers is split into sentences. */
const LONG_LINE = 80;

const HEADING_PREFIX =
  /^(?:[一二三四五六七八九十]+[、.．]|第[一二三四五六七八九十\d]+[章节部分条]\s*)/u;
const ITEM_PREFIX = /^[（(]?(\d{1,2})[)）.、．]\s*/u;
const BULLET_PREFIX = /^[-•·*●▪]\s*/u;
const PUNCTUATION = /[，。；、,;：:！？!?]/u;

function isHeading(line: string, last: boolean): boolean {
  if (HEADING_PREFIX.test(line)) return line.length <= 30;
  if (/^[【[].*[】\]]$/u.test(line)) return true;
  if (/[：:]$/u.test(line) && line.length <= 30) return true;
  // A short line with no punctuation that something follows is a title, such as 销售解决方案经理岗位说明书;
  // the last line is never one, so a one-line duty such as 负责巡检 stays a clause.
  return (
    !last &&
    line.length <= 20 &&
    !PUNCTUATION.test(line) &&
    !ITEM_PREFIX.test(line)
  );
}

function headingText(line: string): string {
  return line
    .replace(HEADING_PREFIX, '')
    .replace(/^[【[]|[】\]]$/gu, '')
    .replace(/[：:]$/u, '')
    .trim();
}

/** Lines of the text, with inline lists ("职责：1. …；2. …") broken at each item. */
function lines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text
    .replace(/([；;。：:])\s*(?=[（(]?\d{1,2}[)）.、．]\s*\S)/gu, '$1\n')
    .split(/\r?\n/u)) {
    const line = raw.replace(/\s+/gu, ' ').trim();
    if (!line) continue;
    if (line.length > LONG_LINE && !ITEM_PREFIX.test(line)) {
      for (const sentence of line.split(/(?<=[。；;])/u)) {
        if (sentence.trim()) out.push(sentence.trim());
      }
    } else out.push(line);
  }
  return out;
}

/** Splits one document into numbered clauses; headings set the section of what follows. */
export function numberClauses(
  text: string | null | undefined,
  source: ClauseSource,
): DocumentClause[] {
  if (!text) return [];
  const clauses: DocumentClause[] = [];
  let section: string | null = null;
  const all = lines(text);
  for (const [index, line] of all.entries()) {
    if (isHeading(line, index === all.length - 1)) {
      section = headingText(line) || section;
      continue;
    }
    const item = ITEM_PREFIX.exec(line);
    const body = line
      .replace(ITEM_PREFIX, '')
      .replace(BULLET_PREFIX, '')
      .trim();
    if (!body) continue;
    clauses.push({
      source,
      number: clauses.length + 1,
      section,
      item: item ? item[1] : null,
      text: body,
    });
  }
  return clauses;
}

/** The clauses of a position: its job description first (the primary source), then its duties. */
export function positionClauses(position: {
  jdText?: unknown;
  responsibilities?: unknown;
}): DocumentClause[] {
  return [
    ...numberClauses(
      typeof position.jdText === 'string' ? position.jdText : null,
      'jd',
    ),
    ...numberClauses(
      typeof position.responsibilities === 'string'
        ? position.responsibilities
        : null,
      'duties',
    ),
  ];
}

/** How a clause is named to the model: J3 is clause 3 of the 岗位说明书, D2 clause 2 of the 职责说明. */
export function clauseKey(clause: {
  source: ClauseSource;
  number: number;
}): string {
  return `${clause.source === 'jd' ? 'J' : 'D'}${clause.number}`;
}

/** The numbered clauses as the model reads them, one per line. */
export function clauseListing(clauses: readonly DocumentClause[]): string {
  return clauses
    .map(
      (c) =>
        `${clauseKey(c)}. ${c.section ? `【${c.section}${c.item ? ` ${c.item}` : ''}】` : ''}${c.text}`,
    )
    .join('\n');
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function toSourceClause(
  clause: DocumentClause,
  quote?: string | null,
): SourceClause {
  const wanted = quote?.replace(/[「」“”"]/gu, '').trim() ?? '';
  return {
    source: clause.source,
    number: clause.number,
    section: clause.section,
    item: clause.item,
    // Only a quote the clause really contains is kept; otherwise the clause's own words.
    quote:
      wanted && clause.text.includes(wanted)
        ? truncate(wanted, QUOTE_LIMIT)
        : truncate(clause.text, QUOTE_LIMIT),
  };
}

/**
 * The model's references checked against the position's clauses. "J3", "D2",
 * "说明书第 3 条" and a bare "3" (the job description when there is one,
 * else the duties) are understood; an unknown number is dropped, duplicates
 * are merged and at most three are kept.
 */
export function resolveSourceClauses(
  references:
    | readonly { clause: string | number; quote?: string | null }[]
    | null
    | undefined,
  clauses: readonly DocumentClause[],
): SourceClause[] {
  if (!references?.length || !clauses.length) return [];
  const hasJd = clauses.some((c) => c.source === 'jd');
  const out: SourceClause[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const raw = String(reference.clause).trim();
    const match =
      /^([JjDd]|说明书|职责说明|职责)?\s*第?\s*(\d{1,4})\s*条?$/u.exec(raw);
    if (!match) continue;
    const prefix = match[1]?.toUpperCase();
    const source: ClauseSource =
      prefix === 'J' || prefix === '说明书'
        ? 'jd'
        : prefix === 'D' || prefix === '职责说明' || prefix === '职责'
          ? 'duties'
          : hasJd
            ? 'jd'
            : 'duties';
    const number = Number(match[2]);
    const clause = clauses.find(
      (c) => c.source === source && c.number === number,
    );
    if (!clause) continue;
    const key = clauseKey(clause);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(toSourceClause(clause, reference.quote));
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

/** Four-character spans too general to tie a competency to a clause by themselves. */
const GENERIC_SPANS = new Set([
  '管理能力',
  '工作经验',
  '相关经验',
  '能力要求',
  '专业知识',
  '基本知识',
  '岗位职责',
  '任职要求',
]);

/**
 * Rule-based matching for when no model is available: the clauses that name
 * a competency — its whole title, or for a Chinese title any four-character
 * span of it (制动系统产品知识 matches "熟悉制动系统产品的结构").
 */
export function matchClauses(
  title: string,
  clauses: readonly DocumentClause[],
): DocumentClause[] {
  const name = title.trim();
  if (!name) return [];
  if (/[A-Za-z]/u.test(name)) {
    const lower = name.toLowerCase();
    return clauses.filter((c) => c.text.toLowerCase().includes(lower));
  }
  const spans =
    name.length <= 4
      ? [name]
      : Array.from({ length: name.length - 3 }, (_, i) =>
          name.slice(i, i + 4),
        ).filter((span) => !GENERIC_SPANS.has(span));
  return clauses.filter((c) => spans.some((span) => c.text.includes(span)));
}

/** The clause as a stored reference, quoting its own words. */
export function sourceClauseOf(clause: DocumentClause): SourceClause {
  return toSourceClause(clause);
}

/** "依据：说明书第 3 条「…」", appended to a new competency's description. */
export function describeSourceClauses(
  references: readonly SourceClause[],
): string {
  return `依据：${references
    .map(
      (r) =>
        `${r.source === 'jd' ? '说明书' : '职责说明'}第 ${r.number} 条「${r.quote}」`,
    )
    .join('；')}`;
}

/** A stored `sourceClauses` value read back; anything malformed is left out. */
export function readSourceClauses(value: unknown): SourceClause[] | null {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;
  const out: SourceClause[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.source !== 'jd' && e.source !== 'duties') continue;
    const number = Number(e.number);
    if (!Number.isInteger(number) || number < 1) continue;
    out.push({
      source: e.source,
      number,
      section: typeof e.section === 'string' ? e.section : null,
      item: typeof e.item === 'string' ? e.item : null,
      quote: typeof e.quote === 'string' ? e.quote : '',
    });
  }
  return out.length ? out : null;
}

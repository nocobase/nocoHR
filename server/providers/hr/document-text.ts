/**
 * Text extraction and sectioning for knowledge documents. Extracted text is
 * stored as Markdown-like plain text in which `#` headings start sections, so
 * the knowledge base shows a document by section and the assistant cites the
 * section a passage came from.
 */
import { HrError } from './shared.js';

export interface DocumentSection {
  readonly index: number;
  readonly title: string;
  readonly text: string;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/giu, (match, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#'))
      return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return HTML_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** Converts the HTML mammoth produces into heading-delimited text. */
function htmlToText(html: string): string {
  const text = html
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/giu,
      (_m, level: string, inner: string) =>
        `\n${'#'.repeat(Number(level))} ${inner}\n`,
    )
    .replace(/<li[^>]*>/giu, '\n- ')
    .replace(/<\/(p|li|tr|table|ul|ol|div)>/giu, '\n')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<t[dh][^>]*>/giu, ' ')
    .replace(/<[^>]+>/gu, '');
  return decodeEntities(text);
}

/**
 * Plain text from a PDF or text file has no heading markup. A short line
 * numbered like "一、", "第一章", "1." or "1.2" followed by a title is taken
 * as a heading.
 */
function markHeadings(text: string): string {
  if (/^#{1,6}\s/mu.test(text)) return text;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length > 40 || trimmed.length < 2) return line;
      if (
        /^(第[一二三四五六七八九十百]+[章节部分条]|[一二三四五六七八九十]+[、.．]|\d+(\.\d+)*[、.．\s])\s*\S/u.test(
          trimmed,
        ) &&
        !/[。；;，,]$/u.test(trimmed)
      ) {
        return `## ${trimmed}`;
      }
      return line;
    })
    .join('\n');
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/[ \t\u00a0]+/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export type DocumentKind = 'pdf' | 'docx' | 'markdown' | 'text';

export function documentKind(
  filename: string,
  mimeType: string,
): DocumentKind | undefined {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
  if (
    ext === 'docx' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  )
    return 'docx';
  if (ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown')
    return 'markdown';
  if (ext === 'txt' || mimeType === 'text/plain') return 'text';
  return undefined;
}

/**
 * Extracts the text of a PDF, Word (docx), Markdown or text file. A file that
 * cannot be read, or that holds no text, raises an error whose code the
 * knowledge base shows as the parse failure reason.
 */
/**
 * A Markdown file's leading YAML block is its properties (title, subject…),
 * not its body: the demo documents keep their 虚构资料 note there, as the
 * specs ask, so it never reaches the indexed text.
 */
export function stripFrontMatter(markdown: string): string {
  return markdown.replace(
    /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u,
    '',
  );
}

export async function extractDocumentText(
  bytes: Uint8Array,
  kind: DocumentKind,
): Promise<string> {
  let text: string;
  try {
    if (kind === 'pdf') {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      const result = await extractText(pdf, { mergePages: false });
      const pages = Array.isArray(result.text)
        ? result.text
        : [String(result.text)];
      text = markHeadings(pages.join('\n\n'));
    } else if (kind === 'docx') {
      const mammoth = await import('mammoth');
      const convert =
        (
          mammoth as unknown as {
            convertToHtml: typeof import('mammoth').convertToHtml;
          }
        ).convertToHtml ??
        (
          mammoth as unknown as {
            default: { convertToHtml: typeof import('mammoth').convertToHtml };
          }
        ).default.convertToHtml;
      const result = await convert({ buffer: Buffer.from(bytes) });
      text = htmlToText(result.value);
    } else {
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      text =
        kind === 'markdown' ? stripFrontMatter(decoded) : markHeadings(decoded);
    }
  } catch (error) {
    if (error instanceof HrError) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    throw new HrError('DOCUMENT_UNREADABLE', 400, {
      reason: reason.slice(0, 300),
    });
  }
  const normalized = normalize(text);
  if (!normalized) throw new HrError('DOCUMENT_EMPTY', 400);
  return normalized;
}

/** Splits extracted text into sections at its headings; text before the first heading is an untitled section. */
export function splitSections(
  contentText: string | null | undefined,
): DocumentSection[] {
  if (!contentText) return [];
  const sections: DocumentSection[] = [];
  let title = '';
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text || title) sections.push({ index: sections.length, title, text });
    buffer = [];
  };
  for (const line of contentText.split('\n')) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      flush();
      title = heading[1].trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

// ---------- Retrieval ----------

/** Question words that match almost any passage and carry no subject. */
const STOP_TOKENS = new Set([
  '什么',
  '多少',
  '怎么',
  '如何',
  '是否',
  '可以',
  '需要',
  '哪些',
  '为什么',
  '请问',
  '一下',
  '我们',
  '你们',
  '这个',
  '那个',
  '的是',
  '是多',
  '么样',
  '有没',
  '没有',
  '吗？',
  '是什',
  '怎样',
  '能否',
  '应该',
  '要求',
  '规定',
]);

/** Latin words and digits as whole tokens; Chinese runs as overlapping character pairs. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/[a-z0-9]+(?:\.[0-9]+)?|[一-鿿]+/gu)) {
    const run = match[0];
    if (/^[一-鿿]+$/u.test(run)) {
      if (run.length === 1) tokens.push(run);
      for (let i = 0; i + 1 < run.length; i += 1)
        tokens.push(run.slice(i, i + 2));
    } else {
      tokens.push(run);
    }
  }
  return tokens.filter((token) => !STOP_TOKENS.has(token));
}

export interface ScoredPassage<T> {
  readonly item: T;
  readonly score: number;
  readonly excerpt: string;
}

/**
 * Ranks passages by how many distinct query tokens they contain, weighting
 * tokens that occur in few passages and matches in the section title. A
 * passage must match at least a third of the distinct query tokens (and two
 * of them when the query has more than two) to count as relevant.
 */
export function rankPassages<T>(
  query: string,
  passages: readonly { item: T; title: string; text: string }[],
  limit: number,
): ScoredPassage<T>[] {
  const queryTokens = [...new Set(tokenize(query))];
  if (!queryTokens.length || !passages.length) return [];
  const passageTokens = passages.map(
    (p) => new Set(tokenize(`${p.title}\n${p.text}`)),
  );
  const titleTokens = passages.map((p) => new Set(tokenize(p.title)));
  const documentFrequency = new Map<string, number>();
  for (const token of queryTokens)
    documentFrequency.set(
      token,
      passageTokens.filter((set) => set.has(token)).length,
    );
  const minimumMatches =
    queryTokens.length > 2 ? Math.max(2, Math.ceil(queryTokens.length / 3)) : 1;
  const scored: ScoredPassage<T>[] = [];
  passages.forEach((passage, index) => {
    const tokens = passageTokens[index];
    const matched = queryTokens.filter((token) => tokens.has(token));
    if (matched.length < minimumMatches) return;
    let score = 0;
    for (const token of matched) {
      const idf = Math.log(
        1 + passages.length / (documentFrequency.get(token) ?? 1),
      );
      score += idf * (titleTokens[index].has(token) ? 1.5 : 1);
    }
    scored.push({
      item: passage.item,
      score,
      excerpt: excerptAround(passage.text, matched),
    });
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

function excerptAround(
  text: string,
  tokens: readonly string[],
  size = 700,
): string {
  const clean = text.trim();
  if (clean.length <= size) return clean;
  const lower = clean.toLowerCase();
  const first =
    tokens
      .map((token) => lower.indexOf(token))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - Math.floor(size / 3));
  return `${start > 0 ? '…' : ''}${clean.slice(start, start + size)}${start + size < clean.length ? '…' : ''}`;
}

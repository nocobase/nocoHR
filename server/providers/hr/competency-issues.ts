/**
 * The facts behind the framework advisor's monthly dictionary check: pairs
 * of confirmed competencies that read alike, confirmed competencies nothing
 * has referenced in 90 days, and level descriptions that use unobservable
 * adjectives. The advisor turns these into suggestions; it never edits the
 * dictionary.
 */
import type { DatabaseManager } from '@nocobase/db';

import { editDistance, normalizeTitle, parseSynonyms } from './import-check.js';
import { str } from './shared.js';

export interface CompetencyIssues {
  readonly similarPairs: readonly {
    a: { id: string; title: string };
    b: { id: string; title: string };
    similarity: number;
  }[];
  readonly idle: readonly { id: string; title: string }[];
  readonly vagueLevels: readonly {
    competencyId: string;
    title: string;
    level: number;
    behaviors: string;
    words: readonly string[];
  }[];
}

/** Adjectives that grade without describing behaviour anyone could observe. */
const VAGUE_WORDS = [
  '较好',
  '良好',
  '优秀',
  '一般',
  '较强',
  '很强',
  '较高',
  '突出',
  '熟悉',
  '了解',
  '基本掌握',
];
const IDLE_DAYS = 90;
const SIMILARITY_THRESHOLD = 0.25;

function bigrams(text: string): Set<string> {
  const clean = text.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i += 1)
    result.add(clean.slice(i, i + 2));
  return result;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

export async function computeCompetencyIssues(
  database: DatabaseManager,
  now: Date = new Date(),
): Promise<CompetencyIssues> {
  const query = database.query();
  const competencies = (
    await query
      .selectFrom('competencies')
      .select(['id', 'title', 'description'])
      .where('active', '=', true)
      .where('reviewStatus', '=', 'confirmed')
      .execute()
  ).map((c) => ({
    id: str(c.id),
    title: str(c.title),
    description: c.description == null ? '' : str(c.description),
  }));

  const tokens = new Map(
    competencies.map((c) => [c.id, bigrams(`${c.title}${c.description}`)]),
  );
  const similarPairs: CompetencyIssues['similarPairs'][number][] = [];
  for (let i = 0; i < competencies.length; i += 1)
    for (let j = i + 1; j < competencies.length; j += 1) {
      const a = competencies[i];
      const b = competencies[j];
      const similarity = jaccard(tokens.get(a.id)!, tokens.get(b.id)!);
      if (similarity >= SIMILARITY_THRESHOLD)
        similarPairs.push({
          a: { id: a.id, title: a.title },
          b: { id: b.id, title: b.title },
          similarity: Math.round(similarity * 100) / 100,
        });
    }

  // Referenced: required by a position, tagged on a document, course or question, or assessed in the last 90 days.
  const referenced = new Set<string>();
  const since = new Date(now.getTime() - IDLE_DAYS * 86_400_000);
  for (const table of [
    'positionRequirements',
    'kbDocumentCompetencies',
    'courseCompetencies',
    'questionCompetencies',
  ] as const)
    for (const row of await query
      .selectFrom(table)
      .select(['competencyId'])
      .execute())
      referenced.add(str(row.competencyId));
  for (const row of await query
    .selectFrom('employeeCompetencies')
    .select(['competencyId'])
    .where('assessedAt', '>=', since)
    .execute())
    referenced.add(str(row.competencyId));
  const idle = competencies
    .filter((c) => !referenced.has(c.id))
    .map((c) => ({ id: c.id, title: c.title }));

  const titles = new Map(competencies.map((c) => [c.id, c.title]));
  const levels = competencies.length
    ? await query
        .selectFrom('competencyLevels')
        .select(['competencyId', 'level', 'behaviors'])
        .where('competencyId', 'in', [...titles.keys()])
        .execute()
    : [];
  const vagueLevels = levels
    .map((level) => {
      const behaviors = str(level.behaviors);
      return {
        competencyId: str(level.competencyId),
        title: titles.get(str(level.competencyId)) ?? '',
        level: Number(level.level),
        behaviors,
        words: VAGUE_WORDS.filter((word) => behaviors.includes(word)),
      };
    })
    .filter((level) => level.words.length);

  return { similarPairs, idle, vagueLevels };
}

/**
 * V3-08 月检 also looks at the position framework: active positions nobody
 * has held for `vacantDays` (no current holder and no job event to or from
 * the position in that window), positions without a grade, and pairs whose
 * titles read alike after the first step's normalisation (synonym groups and
 * edit distance, as in the import health check). Suggestions only.
 */
export interface PositionIssues {
  readonly vacant: readonly { id: string; title: string }[];
  readonly noGrade: readonly { id: string; title: string }[];
  readonly similarPairs: readonly {
    a: { id: string; title: string };
    b: { id: string; title: string };
  }[];
}

export const POSITION_ISSUE_DEFAULTS = {
  vacantDays: 180,
  editDistance: 1,
  synonyms: 'CNC/数控; 操作工/操作员; 班组长/组长',
} as const;

export async function computePositionIssues(
  database: DatabaseManager,
  options: {
    now?: Date;
    vacantDays?: number;
    editDistance?: number;
    synonyms?: string;
  } = {},
): Promise<PositionIssues> {
  const now = options.now ?? new Date();
  const vacantDays = options.vacantDays ?? POSITION_ISSUE_DEFAULTS.vacantDays;
  const maxDistance =
    options.editDistance ?? POSITION_ISSUE_DEFAULTS.editDistance;
  const groups = parseSynonyms(
    options.synonyms ?? POSITION_ISSUE_DEFAULTS.synonyms,
  );
  const query = database.query();
  const positions = (
    await query
      .selectFrom('positions')
      .select(['id', 'title', 'grade'])
      .where('active', '=', true)
      .execute()
  ).map((p) => ({
    id: str(p.id),
    title: str(p.title),
    grade: p.grade == null ? '' : str(p.grade).trim(),
  }));
  const held = new Set(
    (
      await query
        .selectFrom('employees')
        .select(['positionId'])
        .where('status', '!=', 'leave')
        .where('positionId', 'is not', null)
        .execute()
    ).map((r) => str(r.positionId)),
  );
  const since = new Date(now.getTime() - vacantDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const moved = new Set<string>();
  for (const row of await query
    .selectFrom('jobEvents')
    .select(['fromPositionId', 'toPositionId'])
    .where('effectiveDate', '>=', since)
    .execute()) {
    if (row.fromPositionId) moved.add(str(row.fromPositionId));
    if (row.toPositionId) moved.add(str(row.toPositionId));
  }
  const pick = (p: { id: string; title: string }) => ({
    id: p.id,
    title: p.title,
  });
  const normalized = positions.map((p) => ({
    ...p,
    key: normalizeTitle(p.title, groups),
  }));
  const similarPairs: PositionIssues['similarPairs'][number][] = [];
  for (let i = 0; i < normalized.length; i += 1)
    for (let j = i + 1; j < normalized.length; j += 1) {
      const a = normalized[i];
      const b = normalized[j];
      if (editDistance(a.key, b.key) <= maxDistance)
        similarPairs.push({ a: pick(a), b: pick(b) });
    }
  return {
    vacant: positions
      .filter((p) => !held.has(p.id) && !moved.has(p.id))
      .map(pick),
    noGrade: positions.filter((p) => !p.grade).map(pick),
    similarPairs,
  };
}

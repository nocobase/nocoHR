/**
 * V4-12 绩效: the shared shapes, their defaults, and the pure rules — rating
 * bands, the reference score (参考分), the quality and safety reference score
 * and the draft-adoption similarity. Everything configurable lives in the
 * scheme (qualitySafetyRules, scoring) or the performance settings.
 */
import { z } from 'zod';

import { json } from '../platform.js';
import { str } from '../shared.js';

export { json };

export const SECTION_KEYS = [
  'goals',
  'competencies',
  'qualitySafety',
  'peer',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const CYCLE_STATUSES = [
  'draft',
  'goalSetting',
  'selfReview',
  'peerReview',
  'managerReview',
  'calibration',
  'published',
  'closed',
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];
/** The stages that carry a deadline, in order. */
export const DEADLINE_STAGES = [
  'goalSetting',
  'selfReview',
  'peerReview',
  'managerReview',
  'calibration',
] as const;
export type DeadlineStage = (typeof DEADLINE_STAGES)[number];

export const REVIEW_ROLES = ['self', 'peer', 'manager', 'skipLevel'] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];
export const RESULT_STATUSES = [
  'inProgress',
  'calibrated',
  'published',
  'acknowledged',
  'appealed',
  'closed',
] as const;

export const sectionSchema = z
  .object({
    key: z.enum(SECTION_KEYS),
    weight: z.number().int().min(0).max(100),
  })
  .strict();
export const ratingSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9+]{0,3}$/u),
    score: z.number().min(0).max(10),
    description: z.string().trim().max(500).default(''),
  })
  .strict();
export const stagesSchema = z
  .object({
    goalSetting: z.boolean().default(true),
    selfReview: z.boolean().default(true),
    peerReview: z
      .object({
        enabled: z.boolean(),
        count: z.number().int().min(2).max(5).default(3),
      })
      .strict()
      .default({ enabled: false, count: 3 }),
    managerReview: z.literal(true).default(true),
    skipLevelReview: z.boolean().default(false),
    calibration: z.boolean().default(true),
  })
  .strict();
export type Stages = z.infer<typeof stagesSchema>;

export const qualityRulesSchema = z
  .object({
    base: z.number().min(1).max(10).default(5),
    min: z.number().min(0).max(10).default(1),
    perIssue: z
      .object({
        critical: z.number().min(-10).max(0).default(-3),
        major: z.number().min(-10).max(0).default(-1.5),
        minor: z.number().min(-10).max(0).default(-0.5),
      })
      .strict()
      .default({ critical: -3, major: -1.5, minor: -0.5 }),
    // Categories that are not the person's doing, listed but not deducted.
    // None by default: which categories those are depends on the business
    // (the 启衡精密 demo scheme lists 设备故障, the equipment's).
    excludeCategories: z
      .array(z.string().trim().min(1).max(64))
      .max(50)
      .default([]),
    learningOnTime: z
      .object({
        enabled: z.boolean().default(true),
        below: z.number().min(0).max(100).default(90),
        points: z.number().min(-10).max(0).default(-1),
      })
      .strict()
      .default({ enabled: true, below: 90, points: -1 }),
    certificateExpired: z
      .object({
        enabled: z.boolean().default(true),
        points: z.number().min(-10).max(0).default(-1),
      })
      .strict()
      .default({ enabled: true, points: -1 }),
    absentDays: z
      .object({
        enabled: z.boolean().default(false),
        perDay: z.number().min(-10).max(0).default(-0.5),
      })
      .strict()
      .default({ enabled: false, perDay: -0.5 }),
  })
  .strict();
export type QualityRules = z.infer<typeof qualityRulesSchema>;
export const DEFAULT_QUALITY_RULES: QualityRules = qualityRulesSchema.parse({});

export const scoringSchema = z
  .object({
    // Competency dimension: base × assessed level ÷ required level, capped (评价等级 ÷ 岗位要求等级).
    competencyBase: z.number().min(1).max(5).default(3),
    competencyCap: z.number().min(1).max(10).default(5),
    // A quality-and-safety score more than this far from the reference needs a reason.
    overrideReasonDelta: z.number().min(0).max(5).default(1),
    // An overall rating this many grades from the reference band needs a reason.
    ratingReasonGap: z.number().int().min(1).max(5).default(2),
  })
  .strict();
export type Scoring = z.infer<typeof scoringSchema>;
export const DEFAULT_SCORING: Scoring = scoringSchema.parse({});

export const distributionSchema = z.record(
  z.string().regex(/^[A-Z][A-Z0-9+]{0,9}$/u),
  z
    .object({
      max: z.number().min(0).max(100).optional(),
      min: z.number().min(0).max(100).optional(),
    })
    .strict(),
);
export type DistributionGuide = z.infer<typeof distributionSchema>;

export interface AppliesTo {
  positionIds: string[];
  jobFamilyIds: string[];
  grades: string[];
}

export interface SchemeView {
  id: string;
  title: string;
  appliesTo: AppliesTo;
  sections: { key: SectionKey; weight: number }[];
  ratingScale: { code: string; score: number; description: string }[];
  stages: Stages;
  qualitySafetyRules: QualityRules;
  distributionGuide: DistributionGuide;
  ratingCoefficients: Record<string, number> | null;
  scoring: Scoring;
  active: boolean;
  customFields: Record<string, unknown>;
  updatedAt: string | null;
}

export function toScheme(row: Record<string, unknown>): SchemeView {
  const applies = json<Partial<AppliesTo>>(row.appliesTo, {});
  const quality = qualityRulesSchema.safeParse(
    json<unknown>(row.qualitySafetyRules, {}) ?? {},
  );
  const scoring = scoringSchema.safeParse(json<unknown>(row.scoring, {}) ?? {});
  const stages = stagesSchema.safeParse(json<unknown>(row.stages, {}) ?? {});
  const coefficients = json<Record<string, number> | null>(
    row.ratingCoefficients,
    null,
  );
  return {
    id: str(row.id),
    title: str(row.title),
    appliesTo: {
      positionIds: applies.positionIds ?? [],
      jobFamilyIds: applies.jobFamilyIds ?? [],
      grades: applies.grades ?? [],
    },
    sections: json(row.sections, []),
    ratingScale: [...json<SchemeView['ratingScale']>(row.ratingScale, [])].sort(
      (a, b) => b.score - a.score,
    ),
    stages: stages.success ? stages.data : stagesSchema.parse({}),
    qualitySafetyRules: quality.success ? quality.data : DEFAULT_QUALITY_RULES,
    distributionGuide: json(row.distributionGuide, {}),
    ratingCoefficients:
      coefficients && Object.keys(coefficients).length ? coefficients : null,
    scoring: scoring.success ? scoring.data : DEFAULT_SCORING,
    active: row.active === true || row.active === 1,
    customFields: json(row.customFields, {}),
    updatedAt: iso(row.updatedAt),
  };
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}

export function day(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}

export function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const round2 = (value: number): number =>
  Math.round(value * 100 + Number.EPSILON) / 100;

/** The rating whose band holds a score: the highest rating whose score − 0.5 the value reaches. */
export function bandOf(
  score: number | null,
  scale: SchemeView['ratingScale'],
): string | null {
  if (score === null || !scale.length) return null;
  const sorted = [...scale].sort((a, b) => b.score - a.score);
  for (const rating of sorted)
    if (score >= rating.score - 0.5) return rating.code;
  return sorted[sorted.length - 1].code;
}

/** The score interval of a rating's band, for the manager's page. */
export function bandRange(
  code: string,
  scale: SchemeView['ratingScale'],
): { from: number; to: number } | null {
  const rating = scale.find((r) => r.code === code);
  if (!rating) return null;
  return { from: rating.score - 0.5, to: rating.score + 0.5 };
}

export function scoreOf(
  code: string | null | undefined,
  scale: SchemeView['ratingScale'],
): number | null {
  if (!code) return null;
  return scale.find((r) => r.code === code)?.score ?? null;
}

/** How many grades apart two ratings are (0 when either is unknown). */
export function gradeGap(
  a: string | null | undefined,
  b: string | null | undefined,
  scale: SchemeView['ratingScale'],
): number {
  const sorted = [...scale]
    .sort((x, y) => x.score - y.score)
    .map((r) => r.code);
  const ia = a ? sorted.indexOf(a) : -1;
  const ib = b ? sorted.indexOf(b) : -1;
  if (ia < 0 || ib < 0) return 0;
  return Math.abs(ia - ib);
}

export interface ReviewItems {
  goals?: { goalId: string; score: number | null; comment?: string | null }[];
  competencies?: {
    competencyId: string;
    level: number | null;
    comment?: string | null;
  }[];
  qualitySafety?: {
    score: number | null;
    comment?: string | null;
    reason?: string | null;
  } | null;
}

export const itemsSchema = z
  .object({
    goals: z
      .array(
        z
          .object({
            goalId: z.string().min(1).max(64),
            score: z.number().min(1).max(5).nullable().default(null),
            comment: z.string().trim().max(2000).nullish(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    competencies: z
      .array(
        z
          .object({
            competencyId: z.string().min(1).max(64),
            level: z.number().int().min(0).max(10).nullable().default(null),
            comment: z.string().trim().max(2000).nullish(),
          })
          .strict(),
      )
      .max(40)
      .default([]),
    qualitySafety: z
      .object({
        score: z.number().min(1).max(5).nullable().default(null),
        comment: z.string().trim().max(2000).nullish(),
        reason: z.string().trim().max(1000).nullish(),
      })
      .strict()
      .nullish(),
  })
  .strict();

export interface DimensionScores {
  goals: number | null;
  competencies: number | null;
  qualitySafety: number | null;
  peer: number | null;
}

/** 参考分 = Σ(维度得分 × 权重) over the dimensions that have a score, the weights renormalized. */
export function computeScore(
  scheme: Pick<SchemeView, 'sections'>,
  dimensions: DimensionScores,
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const section of scheme.sections) {
    const value = dimensions[section.key];
    if (value === null || value === undefined || !section.weight) continue;
    weighted += value * section.weight;
    weights += section.weight;
  }
  return weights ? round2(weighted / weights) : null;
}

/** The dimension scores of a manager's items. */
export function dimensionScores(input: {
  items: ReviewItems;
  goalWeights: Map<string, number | null>;
  requirements: Map<string, number>;
  qualityReference: number | null;
  peerScores: number[];
  scoring: Scoring;
}): DimensionScores {
  const goals = (input.items.goals ?? []).filter(
    (g) => typeof g.score === 'number',
  );
  let goalScore: number | null = null;
  if (goals.length) {
    const weights = goals.map((g) => input.goalWeights.get(g.goalId) ?? 0);
    const total = weights.reduce((a, b) => a + b, 0);
    goalScore = total
      ? round2(
          goals.reduce(
            (sum, g, i) => sum + (g.score as number) * weights[i],
            0,
          ) / total,
        )
      : round2(
          goals.reduce((sum, g) => sum + (g.score as number), 0) / goals.length,
        );
  }
  const competencyScores: number[] = [];
  for (const item of input.items.competencies ?? []) {
    if (typeof item.level !== 'number') continue;
    const required = input.requirements.get(item.competencyId);
    if (!required) continue;
    competencyScores.push(
      Math.max(
        1,
        Math.min(
          input.scoring.competencyCap,
          (input.scoring.competencyBase * item.level) / required,
        ),
      ),
    );
  }
  const quality =
    typeof input.items.qualitySafety?.score === 'number'
      ? input.items.qualitySafety.score
      : input.qualityReference;
  return {
    goals: goalScore,
    competencies: competencyScores.length
      ? round2(
          competencyScores.reduce((a, b) => a + b, 0) / competencyScores.length,
        )
      : null,
    qualitySafety: quality,
    peer: input.peerScores.length
      ? round2(
          input.peerScores.reduce((a, b) => a + b, 0) / input.peerScores.length,
        )
      : null,
  };
}

/** Bigram Dice similarity of two texts, ignoring whitespace and punctuation (0–1). */
export function similarity(a: string, b: string): number {
  const clean = (text: string) =>
    text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const x = clean(a);
  const y = clean(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (text: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < text.length - 1; i += 1) {
      const gram = text.slice(i, i + 2);
      map.set(gram, (map.get(gram) ?? 0) + 1);
    }
    return map;
  };
  const gx = grams(x);
  const gy = grams(y);
  let overlap = 0;
  for (const [gram, count] of gx) overlap += Math.min(count, gy.get(gram) ?? 0);
  const total = Math.max(1, x.length - 1) + Math.max(1, y.length - 1);
  return (2 * overlap) / total;
}

/** 原样采用 / 修改后采用 / 未采用, from the submitted comment against the draft's. */
export function adoptionOf(
  draft: string | null | undefined,
  submitted: string | null | undefined,
  thresholds: { asIs: number; edited: number },
): 'adoptedAsIs' | 'edited' | 'discarded' | null {
  if (!draft?.trim()) return null;
  const value = similarity(draft, submitted ?? '');
  if (value >= thresholds.asIs) return 'adoptedAsIs';
  if (value >= thresholds.edited) return 'edited';
  return 'discarded';
}

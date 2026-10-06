/**
 * V4-13 人才盘点与其他: the administrator-adjustable rules of the step, stored
 * in `personnelSettings` under `talentReview` (设置 is 人才盘点 · 规则 on the
 * talent review page, 培训评估 · 规则 on the evaluations page, 外部 AI 助手
 * for the token limits). Every value has a default, so an installation that
 * never opens the settings works as the specification describes.
 *
 * Defaults the specification leaves open are chosen here and listed in the
 * step's report: the potential band thresholds (average ≥ 2.5 → 3, ≥ 1.5 →
 * 2), the box numbering (box = (potential − 1) × 3 + performance, so 9 is
 * high/high), the development suggestions per box, the number of successors
 * recommended (3), the first days of the quarters (Jan, Apr, Jul, Oct), the
 * recertification rule (a previous certificate that was not revoked makes an
 * issue a recertification), the translation glossary (empty), the words the
 * practical checklist fallback reads and the MCP limits.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { json } from '../platform.js';

export const SETTINGS_ID = 'talentReview';

export const RATING_CODES = ['S', 'A', 'B', 'C', 'D'] as const;
export const POTENTIAL_KEYS = [
  'learningAgility',
  'aspiration',
  'influence',
] as const;
export type PotentialKey = (typeof POTENTIAL_KEYS)[number];
export const ACTION_TYPES = [
  'stretch',
  'rotation',
  'promotionPrep',
  'retention',
  'improvement',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const band = z.number().int().min(1).max(3);
const question = z
  .object({
    key: z.string().min(1).max(40),
    title: z.string().min(1).max(200),
    /** scale: 1–5 stars; text: free text (an example). */
    kind: z.enum(['scale', 'text']),
  })
  .strict();

export const talentReviewSettingsSchema = z
  .object({
    /** 等级换算表: final rating → performance band. */
    ratingBands: z
      .record(z.string(), band)
      .default({ S: 3, A: 3, B: 2, C: 1, D: 1 }),
    /** 潜力评估的题目: the three items, each scored 1–3 with an example. */
    potentialQuestions: z
      .array(
        z
          .object({
            key: z.enum(POTENTIAL_KEYS),
            title: z.string().min(1).max(200),
          })
          .strict(),
      )
      .length(3)
      .default([
        { key: 'learningAgility', title: '学习敏锐度' },
        { key: 'aspiration', title: '承担更大职责的意愿' },
        { key: 'influence', title: '影响他人' },
      ]),
    /** Potential band from the average item score. */
    potentialHighFrom: z.number().min(1).max(3).default(2.5),
    potentialMediumFrom: z.number().min(1).max(3).default(1.5),
    /** 每个格子对应的发展建议 (box 1–9 → the suggested action types). */
    boxActions: z
      .record(z.string(), z.array(z.enum(ACTION_TYPES)).max(3))
      .default({
        '1': ['improvement'],
        '2': ['improvement'],
        '3': ['retention'],
        '4': ['improvement', 'stretch'],
        '5': ['stretch'],
        '6': ['retention', 'stretch'],
        '7': ['stretch'],
        '8': ['rotation', 'promotionPrep'],
        '9': ['promotionPrep', 'retention'],
      }),
    /** 继任候选推荐: how many AI candidates (the incumbent never counts). */
    successorCount: z.number().int().min(1).max(10).default(3),
    /** 继任风险提醒: the same position and reason once in this many days. */
    riskCooldownDays: z.number().int().min(1).max(90).default(7),
    /** 每季度首日: the months whose first day runs the quarterly work. */
    quarterMonths: z
      .array(z.number().int().min(1).max(12))
      .min(1)
      .max(12)
      .default([1, 4, 7, 10]),
    /** 实操考核 default pass rule for a new assessment form. */
    practicalPassRule: z
      .object({
        allCriticalPass: z.boolean(),
        minPassRate: z.number().min(0).max(100),
      })
      .strict()
      .default({ allCriticalPass: true, minPassRate: 80 }),
    /**
     * 起草实操考核表 without a model: sections whose title contains one of
     * these words are read for check items (as are sections numbered 4–5), and
     * an item containing one of the critical words is marked critical. Neutral
     * for any written procedure; the 启衡精密 demo adds 检验, 点检 and 首件
     * through its settings (seed 202610210131).
     */
    practicalSectionKeywords: z
      .array(z.string().trim().min(1).max(20))
      .max(30)
      .default(['操作', '步骤', '检查', '核对', '记录', '安全']),
    practicalCriticalKeywords: z
      .array(z.string().trim().min(1).max(20))
      .max(30)
      .default(['安全', '须', '必须', '禁止', '不得', '严禁']),
    /** 培训评估 questionnaires and periods. */
    l1Questions: z
      .array(question)
      .min(1)
      .max(10)
      .default([
        { key: 'useful', title: '课程内容对我有用', kind: 'scale' },
        { key: 'clear', title: '讲解清楚、容易理解', kind: 'scale' },
        { key: 'applicable', title: '能用到我的工作中', kind: 'scale' },
      ]),
    l3Questions: z
      .array(question)
      .min(1)
      .max(10)
      .default([
        {
          key: 'changed',
          title: '培训后是否观察到其工作行为的改变',
          kind: 'scale',
        },
        { key: 'example', title: '请举一个事例', kind: 'text' },
      ]),
    /** l1 is due this many days after completion. */
    l1DueDays: z.number().int().min(1).max(60).default(7),
    /** l3 is created this many days after completion … */
    l3AfterDays: z.number().int().min(1).max(365).default(30),
    /** … and is due this many days after it is created. */
    l3DueDays: z.number().int().min(1).max(60).default(14),
    /** Reminder this many days before a task is due. */
    evaluationReminderDays: z.number().int().min(0).max(30).default(2),
    /** 知识沉淀: the candidates a topic needs before a FAQ draft. */
    knowledgeMergeThreshold: z.number().int().min(2).max(50).default(3),
    /** 内容多语言: the glossary the content writer translates with. */
    glossary: z
      .array(
        z
          .object({
            zh: z.string().min(1).max(100),
            en: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(500)
      // Empty for a new installation: the terms are the business's own. The
      // 启衡精密 demo keeps 首件检验, 作业指导书, 质量问题 and 上岗证 in its
      // settings (seed 202610210131).
      .default([]),
    /** 13C: calls per token per minute, and the longest token life. */
    agentRateLimitPerMinute: z.number().int().min(1).max(10_000).default(60),
    agentTokenMaxDays: z.number().int().min(1).max(90).default(90),
  })
  .strict();

export type TalentReviewSettings = z.infer<typeof talentReviewSettingsSchema>;
export const TALENT_REVIEW_DEFAULTS: TalentReviewSettings =
  talentReviewSettingsSchema.parse({});

export async function readTalentReviewSettings(
  database: DatabaseManager,
): Promise<{ value: TalentReviewSettings; revision: number }> {
  const row = await database
    .query()
    .selectFrom('personnelSettings')
    .select(['value', 'revision'])
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst();
  const parsed = talentReviewSettingsSchema.safeParse(
    json<unknown>(row?.value, {}),
  );
  return {
    value: parsed.success ? parsed.data : TALENT_REVIEW_DEFAULTS,
    revision: Number(row?.revision ?? 0),
  };
}

/** The potential band of three item scores (1–3 each). */
export function potentialBandOf(
  answers: Partial<Record<PotentialKey, { score: number }>> | null,
  settings: TalentReviewSettings,
): number | null {
  if (!answers) return null;
  const scores = POTENTIAL_KEYS.map((key) => answers[key]?.score).filter(
    (s): s is number => typeof s === 'number',
  );
  if (scores.length !== POTENTIAL_KEYS.length) return null;
  const average = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (average >= settings.potentialHighFrom) return 3;
  if (average >= settings.potentialMediumFrom) return 2;
  return 1;
}

/** 九宫格: box 1–9 from the two bands (1 low/low … 9 high/high); null until both are known. */
export function boxOf(
  performanceBand: number | null,
  potentialBand: number | null,
): number | null {
  if (!performanceBand || !potentialBand) return null;
  return (potentialBand - 1) * 3 + performanceBand;
}

/** The bands of a box (the inverse of boxOf). */
export function bandsOfBox(box: number): {
  performanceBand: number;
  potentialBand: number;
} {
  return {
    performanceBand: ((box - 1) % 3) + 1,
    potentialBand: Math.floor((box - 1) / 3) + 1,
  };
}

/**
 * V4-12 绩效: the administrator-adjustable defaults of the step, stored in
 * `personnelSettings` under `performance` (设置 is 考核周期 · 默认规则). A
 * cycle copies the exclusion defaults into its scope when it is created, so
 * changing them later never changes a running cycle.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { json } from '../platform.js';

export const SETTINGS_ID = 'performance';

export const performanceSettingsSchema = z
  .object({
    /** 排除规则: fewer days since joining than this at cycle creation. */
    minTenureDays: z.number().int().min(0).max(3650).default(90),
    /** 排除规则: employees still on probation. */
    excludeProbation: z.boolean().default(true),
    /** 申诉: days after publication. */
    appealDays: z.number().int().min(1).max(60).default(7),
    /** Unacknowledged, unappealed results become acknowledged this many days after publication. */
    autoAcknowledgeDays: z.number().int().min(1).max(60).default(7),
    /** 09:00 reminders this many days before a stage deadline. */
    reminderDays: z
      .array(z.number().int().min(0).max(30))
      .max(5)
      .default([3, 1]),
    /** 一键催办: one reminder per person within this many hours. */
    urgeCooldownHours: z.number().int().min(1).max(168).default(24),
    /** 目标草稿: this many days before the goal-setting deadline. */
    goalDraftDaysBefore: z.number().int().min(0).max(30).default(3),
    /** AI 初稿采纳: similarity of the submitted comment to the draft's. */
    adoptedAsIsSimilarity: z.number().min(0.5).max(1).default(0.98),
    editedSimilarity: z.number().min(0).max(0.95).default(0.3),
    /** 同一评价人等级全部相同: flagged from this many subordinates on. */
    uniformMinCount: z.number().int().min(2).max(50).default(3),
  })
  .strict();
export type PerformanceSettings = z.infer<typeof performanceSettingsSchema>;
export const PERFORMANCE_DEFAULTS: PerformanceSettings =
  performanceSettingsSchema.parse({});

export async function readPerformanceSettings(
  database: DatabaseManager,
): Promise<{ value: PerformanceSettings; revision: number }> {
  const row = await database
    .query()
    .selectFrom('personnelSettings')
    .select(['value', 'revision'])
    .where('id', '=', SETTINGS_ID)
    .executeTakeFirst();
  const parsed = performanceSettingsSchema.safeParse(
    json<unknown>(row?.value, {}),
  );
  return {
    value: parsed.success ? parsed.data : PERFORMANCE_DEFAULTS,
    revision: Number(row?.revision ?? 0),
  };
}

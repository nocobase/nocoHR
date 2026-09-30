/**
 * V3-09 学习规则: the learning rules an HR administrator adjusts in
 * 设置 · 学习规则 (总纲 可定制约定) rather than in code:
 *
 * - `dueSoonDays`: the daily run reminds a learner of a task due within this
 *   many days (spec: 3);
 * - `planExpiryDays`: a learning plan left in draft this many days expires
 *   (spec: 14);
 * - `checkInOpensMinutes`: how long before an offline session starts its
 *   check-in opens (spec: 30);
 * - `minWatchPercent`: the share of a video a new video lesson requires by
 *   default (spec: 90);
 * - `onboardingBackfillDays`: an onboard event whose effective date lies more
 *   than this many days before it is processed records someone already at
 *   work (an import or a 补录), and assigns no onboarding path. The spec
 *   leaves this undefined; 30 is this application's default.
 *
 * The values live in one `personnelSettings` row, `learning.rules`, read by
 * the learning, plan and session services; this module does not touch the
 * personnel settings sections another step owns. A missing row reads as the
 * defaults. Saving checks the revision, so two administrators never silently
 * overwrite each other.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { ActorContext } from './framework-service.js';
import { HrError, isRecord } from './shared.js';

export const LEARNING_RULES_ID = 'learning.rules';
/** The HR administration settings item (core-service's HR_ADMIN_SETTINGS); only hr.admin holds it. */
const HR_ADMIN_SETTINGS = 'talent.hr';

export const learningRulesSchema = z
  .object({
    dueSoonDays: z.number().int().min(0).max(30),
    planExpiryDays: z.number().int().min(1).max(90),
    checkInOpensMinutes: z.number().int().min(0).max(240),
    minWatchPercent: z.number().int().min(10).max(100),
    onboardingBackfillDays: z.number().int().min(1).max(3650),
  })
  .strict();
export type LearningRules = z.infer<typeof learningRulesSchema>;

export const LEARNING_RULE_DEFAULTS: LearningRules = {
  dueSoonDays: 3,
  planExpiryDays: 14,
  checkInOpensMinutes: 30,
  minWatchPercent: 90,
  onboardingBackfillDays: 30,
};

export interface LearningSettingsView {
  readonly value: LearningRules;
  readonly defaults: LearningRules;
  readonly revision: number;
  readonly updatedAt: string | null;
}

export interface LearningSettingsService {
  /** For the services; not exposed without an authorization check. */
  read(): Promise<LearningRules>;
  get(ctx: ActorContext): Promise<LearningSettingsView>;
  save(ctx: ActorContext, input: unknown): Promise<LearningSettingsView>;
}

function decode(value: unknown): unknown {
  let decoded = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i++) {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      return undefined;
    }
  }
  return decoded;
}

/** Stored values over the defaults; a value out of range falls back to its default. */
export function resolveLearningRules(stored: unknown): LearningRules {
  const value = decode(stored);
  const result: LearningRules = { ...LEARNING_RULE_DEFAULTS };
  if (!isRecord(value)) return result;
  const shape = learningRulesSchema.shape;
  for (const key of Object.keys(shape) as (keyof LearningRules)[]) {
    const parsed = shape[key].safeParse(value[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result;
}

export function createLearningSettings(
  database: DatabaseManager,
): LearningSettingsService {
  async function row() {
    return database
      .query()
      .selectFrom('personnelSettings')
      .selectAll()
      .where('id', '=', LEARNING_RULES_ID)
      .executeTakeFirst();
  }
  async function assertAdmin(ctx: ActorContext): Promise<void> {
    const allowed = await ctx.authz.can({
      resource: { type: 'settings', id: HR_ADMIN_SETTINGS },
      action: 'administer',
    });
    if (!allowed) throw new HrError('FORBIDDEN', 403);
  }
  async function view(): Promise<LearningSettingsView> {
    const current = await row();
    return {
      value: resolveLearningRules(current?.value),
      defaults: LEARNING_RULE_DEFAULTS,
      revision: Number(current?.revision ?? 0),
      updatedAt: current?.updatedAt
        ? new Date(current.updatedAt as string | Date).toISOString()
        : null,
    };
  }
  return {
    async read() {
      return resolveLearningRules((await row())?.value);
    },
    async get(ctx) {
      await assertAdmin(ctx);
      return view();
    },
    async save(ctx, input) {
      await assertAdmin(ctx);
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const revision = Number(input.revision);
      if (!Number.isInteger(revision) || revision < 0)
        throw new HrError('INVALID_INPUT', 400);
      const parsed = learningRulesSchema.safeParse(input.value);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, parsed.error.issues);
      const current = await row();
      const stamp = new Date();
      if (!current) {
        if (revision !== 0) throw new HrError('SETTINGS_CONFLICT', 409);
        try {
          await database
            .query()
            .insertInto('personnelSettings')
            .values({
              id: LEARNING_RULES_ID,
              value: parsed.data,
              revision: 1,
              updatedBy: ctx.userId,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
        } catch {
          // Another administrator saved first.
          throw new HrError('SETTINGS_CONFLICT', 409);
        }
        return view();
      }
      const result = await database
        .query()
        .updateTable('personnelSettings')
        .set({
          value: parsed.data,
          revision: revision + 1,
          updatedBy: ctx.userId,
          updatedAt: stamp,
        })
        .where('id', '=', LEARNING_RULES_ID)
        .where('revision', '=', revision)
        .execute();
      if (!(result.updatedCount ?? 0))
        throw new HrError('SETTINGS_CONFLICT', 409);
      return view();
    },
  };
}

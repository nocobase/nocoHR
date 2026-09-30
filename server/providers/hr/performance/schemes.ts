/**
 * V4-12 考核方案. hr.admin maintains dimensions and weights (合计 100), the
 * rating scale, the enabled stages, the quality and safety rules, the
 * distribution guide and the scoring parameters, and reads the bonus
 * coefficients; only hr.payroll writes the coefficients (薪酬设置 · 绩效系数),
 * through an operation that reads nothing else but the rating scale. Writes go
 * through the action's field-limited policy, so `manage` cannot touch
 * `ratingCoefficients` even if a client sends it.
 *
 * Schemes are an extensible table: administrator-added fields
 * (customFieldDefinitions, collection `reviewSchemes`) are validated and
 * stored in `customFields` once the collection is registered for extension.
 */
import { z } from 'zod';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { ExtensibleCollection } from '../custom-fields.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, isRecord, newId, str } from '../shared.js';
import {
  distributionSchema,
  qualityRulesSchema,
  ratingSchema,
  scoringSchema,
  sectionSchema,
  stagesSchema,
  toScheme,
  type SchemeView,
} from './common.js';
import type { PerformanceContext } from './context.js';

const SCHEME = 'talent.reviewScheme';
const COLLECTION = 'reviewSchemes' as ExtensibleCollection;

const appliesToSchema = z
  .object({
    positionIds: z.array(z.string().min(1).max(64)).max(100).default([]),
    jobFamilyIds: z.array(z.string().min(1).max(64)).max(50).default([]),
    grades: z.array(z.string().min(1).max(16)).max(20).default([]),
  })
  .strict()
  .refine((v) => v.positionIds.length + v.jobFamilyIds.length > 0, {
    message: 'REVIEW_SCHEME_APPLIES_REQUIRED',
  });

const schemeInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    appliesTo: appliesToSchema,
    sections: z.array(sectionSchema).min(1).max(4),
    ratingScale: z.array(ratingSchema).min(2).max(7),
    stages: stagesSchema,
    qualitySafetyRules: qualityRulesSchema.nullish(),
    distributionGuide: distributionSchema.nullish(),
    scoring: scoringSchema.nullish(),
    active: z.boolean().default(true),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const coefficientInput = z
  .object({
    coefficients: z.record(
      z.string().regex(/^[A-Z][A-Z0-9+]{0,3}$/u),
      z.number().min(0).max(10),
    ),
  })
  .strict();

function validate(data: z.infer<typeof schemeInput>): void {
  const keys = data.sections.map((s) => s.key);
  if (new Set(keys).size !== keys.length)
    throw new HrError('REVIEW_SCHEME_SECTIONS_DUPLICATE', 400);
  const total = data.sections.reduce((sum, s) => sum + s.weight, 0);
  if (total !== 100)
    throw new HrError('REVIEW_SCHEME_WEIGHTS_NOT_100', 400, { total });
  if (keys.includes('peer') && !data.stages.peerReview.enabled)
    throw new HrError('REVIEW_SCHEME_PEER_STAGE_REQUIRED', 400);
  const codes = data.ratingScale.map((r) => r.code);
  if (new Set(codes).size !== codes.length)
    throw new HrError('REVIEW_SCHEME_RATINGS_DUPLICATE', 400);
  const scores = data.ratingScale.map((r) => r.score);
  if (new Set(scores).size !== scores.length)
    throw new HrError('REVIEW_SCHEME_RATINGS_DUPLICATE', 400);
  for (const key of Object.keys(data.distributionGuide ?? {}))
    for (const part of key.split('+'))
      if (!codes.includes(part))
        throw new HrError('REVIEW_SCHEME_GUIDE_UNKNOWN_RATING', 400, {
          rating: part,
        });
}

export function createSchemeService(ctx: PerformanceContext) {
  const { database } = ctx;

  async function definitions() {
    return ctx.customFields().list(COLLECTION);
  }

  /** A scheme as an administrator sees it: coefficients read-only, custom fields projected. */
  async function present(
    scheme: SchemeView,
    options: { coefficients: boolean },
  ) {
    const service = ctx.customFields();
    return {
      ...scheme,
      ratingCoefficients: options.coefficients
        ? scheme.ratingCoefficients
        : null,
      customFields: service.project(await definitions(), scheme.customFields, {
        sensitive: true,
        includeInactive: true,
      }),
    };
  }

  async function write(actor: ActorContext, input: unknown, id: string | null) {
    const policies = await authorizeAction(actor.authz, SCHEME, 'manage');
    const parsed = schemeInput.safeParse(input);
    if (!parsed.success) {
      const code = parsed.error.issues.find((i) =>
        i.message.startsWith('REVIEW_'),
      )?.message;
      throw new HrError(code ?? 'INVALID_INPUT', 400, {
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      });
    }
    const data = parsed.data;
    validate(data);
    const existing = id ? await ctx.scheme(id) : null;
    const customFields = ctx
      .customFields()
      .prepare(
        await definitions(),
        data.customFields,
        existing?.customFields ?? {},
        {
          enforceRequired: true,
        },
      );
    const now = new Date();
    const values = {
      title: data.title,
      appliesTo: data.appliesTo,
      sections: data.sections,
      ratingScale: [...data.ratingScale].sort((a, b) => b.score - a.score),
      stages: data.stages,
      qualitySafetyRules: qualityRulesSchema.parse(
        data.qualitySafetyRules ?? {},
      ),
      distributionGuide: data.distributionGuide ?? {},
      scoring: scoringSchema.parse(data.scoring ?? {}),
      active: data.active,
      customFields,
      updatedBy: actor.userId,
      updatedAt: now,
    };
    const repository = database
      .repository('reviewSchemes')
      .withPolicy(policyOf(policies, 'reviewSchemes'));
    if (id) await repository.updateOne({ filter: { id }, values });
    else {
      id = newId();
      await repository.createOne({ values: { id, ...values, createdAt: now } });
    }
    return present(await ctx.scheme(id), { coefficients: true });
  }

  return {
    definitions,

    async list(actor: ActorContext) {
      const view = await tryAuthorizeAction(actor.authz, SCHEME, 'view');
      const coefficients = await tryAuthorizeAction(
        actor.authz,
        SCHEME,
        'manageCoefficients',
      );
      if (!view && !coefficients) throw new HrError('FORBIDDEN', 403);
      if (view) {
        const rows = (await database
          .repository('reviewSchemes')
          .withPolicy(policyOf(view, 'reviewSchemes'))
          .findMany({})) as Record<string, unknown>[];
        const schemes = [];
        for (const row of rows)
          schemes.push(await present(toScheme(row), { coefficients: true }));
        return {
          schemes,
          fields: (await definitions()).filter((d) => d.active),
          can: {
            manage: Boolean(
              await tryAuthorizeAction(actor.authz, SCHEME, 'manage'),
            ),
            manageCoefficients: Boolean(coefficients),
          },
        };
      }
      // 薪酬设置 · 绩效系数: title, rating codes and coefficients only.
      const rows = (await database
        .repository('reviewSchemes')
        .withPolicy(policyOf(coefficients!, 'reviewSchemes'))
        .findMany({})) as Record<string, unknown>[];
      return {
        schemes: rows.map((row) => {
          const scheme = toScheme(row);
          return {
            id: scheme.id,
            title: scheme.title,
            active: scheme.active,
            ratingScale: scheme.ratingScale.map((r) => ({
              code: r.code,
              score: r.score,
              description: '',
            })),
            ratingCoefficients: scheme.ratingCoefficients,
          };
        }),
        fields: [],
        can: { manage: false, manageCoefficients: true },
      };
    },

    async get(actor: ActorContext, id: string) {
      const policies = await authorizeAction(actor.authz, SCHEME, 'view');
      const row = (await database
        .repository('reviewSchemes')
        .withPolicy(policyOf(policies, 'reviewSchemes'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('REVIEW_SCHEME_NOT_FOUND', 404);
      return present(toScheme(row), { coefficients: true });
    },

    create: (actor: ActorContext, input: unknown) => write(actor, input, null),
    update: (actor: ActorContext, id: string, input: unknown) =>
      write(actor, input, id),

    /** 薪酬设置 · 绩效系数 (hr.payroll): codes of the scheme's scale only; an empty map clears them. */
    async setCoefficients(actor: ActorContext, id: string, input: unknown) {
      const policies = await authorizeAction(
        actor.authz,
        SCHEME,
        'manageCoefficients',
      );
      const parsed = coefficientInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const repository = database
        .repository('reviewSchemes')
        .withPolicy(policyOf(policies, 'reviewSchemes'));
      const row = (await repository.findOne({ filter: { id } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('REVIEW_SCHEME_NOT_FOUND', 404);
      const scheme = toScheme(row);
      const codes = new Set(scheme.ratingScale.map((r) => r.code));
      for (const code of Object.keys(parsed.data.coefficients))
        if (!codes.has(code))
          throw new HrError('REVIEW_SCHEME_GUIDE_UNKNOWN_RATING', 400, {
            rating: code,
          });
      await repository.updateOne({
        filter: { id },
        values: {
          ratingCoefficients: parsed.data.coefficients,
          updatedBy: actor.userId,
          updatedAt: new Date(),
        },
      });
      const updated = await ctx.scheme(id);
      return {
        id: updated.id,
        title: updated.title,
        ratingScale: updated.ratingScale,
        ratingCoefficients: updated.ratingCoefficients,
      };
    },

    /** getSchemeRules: dimensions, ratings and the quality rules — never the coefficients. */
    async rules(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, 'talent.performanceAssistant', 'use');
      const scheme = await ctx.scheme(id);
      return {
        id: scheme.id,
        title: scheme.title,
        sections: scheme.sections,
        ratingScale: scheme.ratingScale,
        stages: scheme.stages,
        qualitySafetyRules: scheme.qualitySafetyRules,
        distributionGuide: scheme.distributionGuide,
        scoring: scheme.scoring,
      };
    },

    /** Validation of a raw scheme value, for seeds and tests. */
    parse(input: unknown) {
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const data = schemeInput.parse(input);
      validate(data);
      return data;
    },

    /** The scheme that applies to a position: by position first, then by job family (and grade). */
    matchScheme(
      schemes: readonly SchemeView[],
      position: {
        id: string;
        jobFamilyId: string | null;
        grade: string | null;
      } | null,
    ): SchemeView | null {
      if (!position) return null;
      const active = schemes.filter((s) => s.active);
      const byPosition = active.find((s) =>
        s.appliesTo.positionIds.includes(position.id),
      );
      if (byPosition) return byPosition;
      return (
        active.find(
          (s) =>
            position.jobFamilyId &&
            s.appliesTo.jobFamilyIds.includes(position.jobFamilyId) &&
            (!s.appliesTo.grades.length ||
              (position.grade &&
                s.appliesTo.grades.includes(str(position.grade)))),
        ) ?? null
      );
    },
  };
}

export type SchemeService = ReturnType<typeof createSchemeService>;

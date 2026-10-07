import { defineTools } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import {
  computeCompetencyIssues,
  computePositionIssues,
} from '../../providers/hr/competency-issues.js';
import {
  clauseListing,
  positionClauses,
  resolveSourceClauses,
} from '../../providers/hr/jd-clauses.js';
import { HrError } from '../../providers/hr/shared.js';
import { talentServiceToken } from '../../providers/hr/tokens.js';

const I18N = { namespace: 'hr' };

async function actorContext(
  deps: {
    authz: import('@nocobase/app-plugin-authorization/server').AppAuthorization;
  },
  actor: { id: string | number },
) {
  const userId = String(actor.id);
  return { authz: await scopeForUser(deps.authz, userId), userId };
}

function failure(error: unknown) {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
}

/** Reads one position: its family, grade, job description and current requirements. */
export const getPositionContext = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read position context',
    about:
      'Reads a position, its job description and its current requirements.',
  },
  definition: {
    name: 'getPositionContext',
    description:
      'Read one position by id: title, job family, grade, responsibilities (the short duty description), jdText (the text extracted from the uploaded 岗位说明书; when present it is the primary source), clauses (both texts numbered clause by clause: J1, J2 … for the job description, D1, D2 … for the duties; cite these numbers when drafting requirements) and its existing competency requirements with their review status. Call this first.',
    schema: z.object({
      positionId: z.string().describe('The id of the position to read.'),
    }),
  },
  dependencies: { talent: talentServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { positionId: string }) => {
    try {
      const context = await ctx.deps.talent.positionContext(
        await actorContext(ctx.deps, ctx.actor),
        args.positionId,
      );
      // V3-08 每项注明出自说明书哪一条: the numbered clauses requirement drafts cite.
      return {
        status: 'success',
        content: {
          ...context,
          clauses: clauseListing(
            positionClauses({
              jdText:
                context.position.jdStatus === 'ready'
                  ? context.position.jdText
                  : null,
              responsibilities: context.position.responsibilities,
            }),
          ),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

const CATEGORIES = ['skill', 'quality', 'qualification'] as const;

/**
 * The counts a drafting tool returns. The advisor once summed its own list wrongly in chat (“6 项专业技能＋4 项
 * 通用素质…更正：8 项”); it is told to quote these instead of counting.
 */
export function categoryCounts(categories: readonly (string | undefined)[]): {
  total: number;
  skill: number;
  quality: number;
  qualification: number;
} {
  const counts = {
    total: categories.length,
    skill: 0,
    quality: 0,
    qualification: 0,
  };
  for (const category of categories)
    if (category && (CATEGORIES as readonly string[]).includes(category))
      counts[category as (typeof CATEGORIES)[number]]++;
  return counts;
}

/** Finds existing competencies so the advisor reuses them instead of duplicating. */
export const searchCompetencies = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Search competencies',
    about: 'Finds existing competencies to reuse.',
  },
  definition: {
    name: 'searchCompetencies',
    description:
      'Search the competency dictionary by keyword (matches title, code and description) and optionally by category. Returns id, code, title, category, maxLevel and reviewStatus. Use it for every candidate competency before proposing a new one.',
    schema: z.object({
      keyword: z
        .string()
        .optional()
        .describe('Words to match in the title, code or description.'),
      category: z.enum(['skill', 'quality', 'qualification']).optional(),
    }),
  },
  dependencies: { talent: talentServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { keyword?: string; category?: string }) => {
    try {
      const items = await ctx.deps.talent.searchCompetencies(
        await actorContext(ctx.deps, ctx.actor),
        args,
      );
      return {
        status: 'success',
        content: items.map((c) => ({
          id: c.id,
          code: c.code,
          title: c.title,
          category: c.category,
          maxLevel: c.maxLevel,
          reviewStatus: c.reviewStatus,
        })),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

const levelSchema = z.object({
  level: z.number().int().min(1).max(5),
  title: z
    .string()
    .min(1)
    .describe('A short name for the level, such as 入门 or 熟练.'),
  behaviors: z.string().min(1).describe('Observable behaviours at this level.'),
});

/** Writes draft competencies with their level descriptions. Needs the user's approval. */
export const createCompetencyDrafts = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Create competency drafts',
    about:
      'Creates draft competencies and their level descriptions for review.',
  },
  definition: {
    name: 'createCompetencyDrafts',
    description:
      'Create new competencies as drafts (source=ai, reviewStatus=draft) together with their level descriptions. A code that already exists is reported as an error for that item; reuse the existing competency instead. Returns counts (created by category, failed); quote them when stating how many were created.',
    schema: z.object({
      competencies: z
        .array(
          z.object({
            code: z.string().min(1).max(64),
            title: z.string().min(1).max(200),
            category: z.enum(['skill', 'quality', 'qualification']),
            description: z.string().optional(),
            maxLevel: z.number().int().min(1).max(5),
            levels: z.array(levelSchema).min(1),
          }),
        )
        .min(1)
        .max(20),
    }),
  },
  dependencies: { talent: talentServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      competencies: {
        code: string;
        title: string;
        category: string;
        description?: string;
        maxLevel: number;
        levels: { level: number; title: string; behaviors: string }[];
      }[];
    },
  ) => {
    const actor = await actorContext(ctx.deps, ctx.actor);
    // The advisor is an hr.admin tool: without the advisor grant the write is refused even when called directly.
    const allowed = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.frameworkAdvisor' },
      action: 'use',
    });
    // V3-08: writing drafts also needs the framework's own manage grant.
    const manage = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.framework' },
      action: 'manage',
    });
    if (allowed.effect === 'deny' || manage.effect === 'deny')
      return { status: 'error', content: { code: 'FORBIDDEN' } };
    const created: {
      id: string;
      code: string;
      title: string;
      category: string;
    }[] = [];
    const errors: { code: string; error: string }[] = [];
    for (const item of args.competencies) {
      try {
        const saved = await ctx.deps.talent.saveCompetency(actor, null, item, {
          source: 'ai',
          draft: true,
        });
        created.push({
          id: saved.id,
          code: saved.code,
          title: saved.title,
          category: item.category,
        });
      } catch (error) {
        if (error instanceof HrError)
          errors.push({ code: item.code, error: error.code });
        else throw error;
      }
    }
    return {
      status: errors.length && !created.length ? 'error' : 'success',
      content: {
        created,
        errors,
        // Quote these in chat rather than counting the list.
        counts: {
          created: categoryCounts(created.map((c) => c.category)),
          failed: errors.length,
        },
      },
    };
  },
});

/** Writes draft requirements for a position. Needs the user's approval. */
export const createRequirementDrafts = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Create requirement drafts',
    about: 'Creates draft competency requirements for a position.',
  },
  definition: {
    name: 'createRequirementDrafts',
    description:
      'Create draft competency requirements for one position. A competency the position already requires is skipped, never overwritten; the skipped list is returned. Give each requirement the clauses it comes from (sourceClauses: the numbers getPositionContext lists, such as J3, with a short quote); an unknown number is dropped. Returns counts (created by category, mandatory, skipped); quote them when stating how many were created.',
    schema: z.object({
      positionId: z.string(),
      requirements: z
        .array(
          z.object({
            competencyId: z.string(),
            requiredLevel: z.number().int().min(1).max(5),
            mandatory: z.boolean(),
            sourceClauses: z
              .array(
                z.object({
                  clause: z
                    .string()
                    .describe(
                      'A clause number from getPositionContext, such as J3 or D2.',
                    ),
                  quote: z
                    .string()
                    .optional()
                    .describe('A short quote copied from that clause.'),
                }),
              )
              .max(3)
              .optional(),
          }),
        )
        .min(1)
        .max(30),
    }),
  },
  dependencies: {
    talent: talentServiceToken,
    authz: authorizationToken,
    database: databaseManagerToken,
  },
  invoke: async (
    ctx,
    args: {
      positionId: string;
      requirements: {
        competencyId: string;
        requiredLevel: number;
        mandatory: boolean;
        sourceClauses?: { clause: string; quote?: string }[];
      }[];
    },
  ) => {
    const actor = await actorContext(ctx.deps, ctx.actor);
    const allowed = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.frameworkAdvisor' },
      action: 'use',
    });
    const manage = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.framework' },
      action: 'manage',
    });
    if (allowed.effect === 'deny' || manage.effect === 'deny')
      return { status: 'error', content: { code: 'FORBIDDEN' } };
    const created: { id: string; competencyId: string; mandatory: boolean }[] =
      [];
    const skipped: { competencyId: string; reason: string }[] = [];
    let clauses: ReturnType<typeof positionClauses>;
    try {
      const { position } = await ctx.deps.talent.positionContext(
        actor,
        args.positionId,
      );
      clauses = positionClauses({
        jdText: position.jdStatus === 'ready' ? position.jdText : null,
        responsibilities: position.responsibilities,
      });
    } catch (error) {
      return failure(error);
    }
    for (const { sourceClauses, ...item } of args.requirements) {
      try {
        const saved = await ctx.deps.talent.saveRequirement(
          actor,
          args.positionId,
          item,
          {
            source: 'ai',
            draft: true,
            // V3-08: only clauses the position's texts really have are kept.
            sourceClauses: resolveSourceClauses(sourceClauses, clauses),
          },
        );
        created.push({
          id: saved.id,
          competencyId: saved.competencyId,
          mandatory: item.mandatory,
        });
      } catch (error) {
        if (error instanceof HrError)
          skipped.push({ competencyId: item.competencyId, reason: error.code });
        else throw error;
      }
    }
    const categoryOf = new Map(
      created.length
        ? (
            await ctx.deps.database
              .query()
              .selectFrom('competencies')
              .select(['id', 'category'])
              .where(
                'id',
                'in',
                created.map((r) => r.competencyId),
              )
              .execute()
          ).map((c) => [String(c.id), String(c.category)])
        : [],
    );
    return {
      status: 'success',
      content: {
        created,
        skipped,
        // Quote these in chat rather than counting the list.
        counts: {
          created: categoryCounts(
            created.map((r) => categoryOf.get(String(r.competencyId))),
          ),
          mandatory: created.filter((r) => r.mandatory).length,
          skipped: skipped.length,
        },
      },
    };
  },
});

/** The facts of the monthly dictionary check: similar, idle and vaguely described competencies. */
export const listCompetencyIssues = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List competency issues',
    about:
      'Finds similar competencies, idle ones and level descriptions that are not observable.',
  },
  definition: {
    name: 'listCompetencyIssues',
    description:
      'Return pairs of confirmed competencies whose names and definitions read alike, confirmed competencies nothing referenced in the last 90 days, and level descriptions that use unobservable adjectives. Use it to suggest merges, deactivations and rewrites; it changes nothing.',
    schema: z.object({}),
  },
  dependencies: { database: databaseManagerToken, authz: authorizationToken },
  invoke: async (ctx) => {
    const actor = await actorContext(ctx.deps, ctx.actor);
    const allowed = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.frameworkAdvisor' },
      action: 'use',
    });
    if (allowed.effect === 'deny')
      return { status: 'error', content: { code: 'FORBIDDEN' } };
    return {
      status: 'success',
      content: await computeCompetencyIssues(ctx.deps.database),
    };
  },
});

/** V3-08 月检: positions nobody held for half a year, positions without a grade, titles that read alike. */
export const listPositionIssues = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List position issues',
    about:
      'Finds positions without holders, positions without a grade and positions with similar names.',
  },
  definition: {
    name: 'listPositionIssues',
    description:
      'Return active positions nobody has held in the last 180 days, active positions without a grade, and pairs of positions whose titles read alike after normalising synonyms (edit distance 1). Use it for the monthly framework review; it changes nothing.',
    schema: z.object({}),
  },
  dependencies: { database: databaseManagerToken, authz: authorizationToken },
  invoke: async (ctx) => {
    const actor = await actorContext(ctx.deps, ctx.actor);
    const allowed = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.frameworkAdvisor' },
      action: 'use',
    });
    if (allowed.effect === 'deny')
      return { status: 'error', content: { code: 'FORBIDDEN' } };
    return {
      status: 'success',
      content: await computePositionIssues(ctx.deps.database),
    };
  },
});

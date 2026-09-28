import { defineTools } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { databaseManagerToken } from '@nocobase/db';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { computeCompetencyIssues } from '../../providers/hr/competency-issues.js';
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
      'Read one position by id: title, job family, grade, responsibilities (the job description) and its existing competency requirements with their review status. Call this first.',
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
      return { status: 'success', content: context };
    } catch (error) {
      return failure(error);
    }
  },
});

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
      'Create new competencies as drafts (source=ai, reviewStatus=draft) together with their level descriptions. A code that already exists is reported as an error for that item; reuse the existing competency instead.',
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
    if (allowed.effect === 'deny')
      return { status: 'error', content: { code: 'FORBIDDEN' } };
    const created: { id: string; code: string; title: string }[] = [];
    const errors: { code: string; error: string }[] = [];
    for (const item of args.competencies) {
      try {
        const saved = await ctx.deps.talent.saveCompetency(actor, null, item, {
          source: 'ai',
          draft: true,
        });
        created.push({ id: saved.id, code: saved.code, title: saved.title });
      } catch (error) {
        if (error instanceof HrError)
          errors.push({ code: item.code, error: error.code });
        else throw error;
      }
    }
    return {
      status: errors.length && !created.length ? 'error' : 'success',
      content: { created, errors },
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
      'Create draft competency requirements for one position. A competency the position already requires is skipped, never overwritten; the skipped list is returned.',
    schema: z.object({
      positionId: z.string(),
      requirements: z
        .array(
          z.object({
            competencyId: z.string(),
            requiredLevel: z.number().int().min(1).max(5),
            mandatory: z.boolean(),
          }),
        )
        .min(1)
        .max(30),
    }),
  },
  dependencies: { talent: talentServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      positionId: string;
      requirements: {
        competencyId: string;
        requiredLevel: number;
        mandatory: boolean;
      }[];
    },
  ) => {
    const actor = await actorContext(ctx.deps, ctx.actor);
    const allowed = await actor.authz.authorize({
      resource: { type: 'composite', id: 'talent.frameworkAdvisor' },
      action: 'use',
    });
    if (allowed.effect === 'deny')
      return { status: 'error', content: { code: 'FORBIDDEN' } };
    const created: { id: string; competencyId: string }[] = [];
    const skipped: { competencyId: string; reason: string }[] = [];
    for (const item of args.requirements) {
      try {
        const saved = await ctx.deps.talent.saveRequirement(
          actor,
          args.positionId,
          item,
          { source: 'ai', draft: true },
        );
        created.push({ id: saved.id, competencyId: saved.competencyId });
      } catch (error) {
        if (error instanceof HrError)
          skipped.push({ competencyId: item.competencyId, reason: error.code });
        else throw error;
      }
    }
    return { status: 'success', content: { created, skipped } };
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

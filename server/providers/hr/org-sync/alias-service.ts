/**
 * 职务映射 (`positionAliases`, V1-03): an office-suite job title → a
 * position. Only confirmed rows take part in a sync; the HR assistant may
 * write drafts (source=ai) that an HR administrator confirms, edits or
 * discards. (provider, externalTitle) is unique across every status.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import { ORG_PROVIDERS } from './source.js';

export const POSITION_ALIAS = 'talent.positionAlias';

export interface PositionAlias {
  id: string;
  provider: string;
  externalTitle: string;
  positionId: string;
  positionTitle: string | null;
  source: string;
  reviewStatus: 'draft' | 'confirmed';
  draftReason: string | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
  /** Employees currently on the position the alias maps to. */
  headcount: number;
}

const inputSchema = z
  .object({
    provider: z.enum(ORG_PROVIDERS),
    externalTitle: z.string().trim().min(1).max(200),
    positionId: z.string().min(1).max(64),
  })
  .strict();

/** The run-item type of the HR assistant's mapping drafts, for the adoption rate. */
export const ALIAS_DRAFT_ENTITY = 'positionAlias';

export function createAliasService(database: DatabaseManager) {
  /**
   * What an HR administrator did with drafts the HR assistant produced
   * (总纲 AI 员工约定 7): confirmed unchanged is adopted, confirmed on another
   * position is modified, deleted is discarded. The run item's snapshot is
   * the drafted position. Rows no automation produced are left alone.
   */
  async function recordOutcome(
    ids: readonly string[],
    action: 'confirmed' | 'discarded',
    userId: string,
  ): Promise<void> {
    if (!ids.length) return;
    const items = await database
      .query()
      .selectFrom('aiTaskRunItems')
      .select(['id', 'entityId', 'snapshotHash'])
      .where('entityType', '=', ALIAS_DRAFT_ENTITY)
      .where('entityId', 'in', [...ids])
      .where('outcome', '=', 'pending')
      .execute();
    if (!items.length) return;
    const rows = await database
      .query()
      .selectFrom('positionAliases')
      .select(['id', 'positionId'])
      .where(
        'id',
        'in',
        items.map((i) => str(i.entityId)),
      )
      .execute();
    const current = new Map(rows.map((r) => [str(r.id), str(r.positionId)]));
    const now = new Date();
    for (const item of items) {
      const outcome =
        action === 'discarded'
          ? 'discarded'
          : item.snapshotHash &&
              current.get(str(item.entityId)) !== str(item.snapshotHash)
            ? 'modified'
            : 'adopted';
      await database
        .query()
        .updateTable('aiTaskRunItems')
        .set({
          outcome,
          outcomeByUserId: userId,
          outcomeAt: now,
          updatedAt: now,
        })
        .where('id', '=', str(item.id))
        .execute();
    }
  }

  async function activePosition(id: string): Promise<boolean> {
    return Boolean(
      await database
        .query()
        .selectFrom('positions')
        .select(['id'])
        .where('id', '=', id)
        .where('active', '=', true)
        .executeTakeFirst(),
    );
  }

  async function list(): Promise<PositionAlias[]> {
    const [rows, positions, counts] = await Promise.all([
      database
        .query()
        .selectFrom('positionAliases')
        .selectAll()
        .orderBy('externalTitle', 'asc')
        .execute(),
      database
        .query()
        .selectFrom('positions')
        .select(['id', 'title'])
        .execute(),
      database
        .query()
        .selectFrom('employees')
        .select(['positionId'])
        .where('status', '!=', 'leave')
        .execute(),
    ]);
    const title = new Map(positions.map((p) => [str(p.id), str(p.title)]));
    const heads = new Map<string, number>();
    for (const row of counts)
      if (row.positionId)
        heads.set(
          str(row.positionId),
          (heads.get(str(row.positionId)) ?? 0) + 1,
        );
    return rows.map((row) => ({
      id: str(row.id),
      provider: str(row.provider),
      externalTitle: str(row.externalTitle),
      positionId: str(row.positionId),
      positionTitle: title.get(str(row.positionId)) ?? null,
      source: str(row.source),
      reviewStatus: row.reviewStatus === 'draft' ? 'draft' : 'confirmed',
      draftReason: row.draftReason == null ? null : str(row.draftReason),
      confirmedBy: row.confirmedBy == null ? null : str(row.confirmedBy),
      confirmedAt:
        row.confirmedAt == null
          ? null
          : new Date(str(row.confirmedAt)).toISOString(),
      headcount: heads.get(str(row.positionId)) ?? 0,
    }));
  }

  /** The HR assistant's drafts: skipped when the title already has a row, refused for an inactive position. */
  async function createDrafts(
    drafts: readonly {
      provider: string;
      externalTitle: string;
      positionId: string;
      draftReason: string;
    }[],
  ): Promise<{
    created: string[];
    skipped: string[];
    /** The created drafts with the position each points at. */
    items: { id: string; positionId: string }[];
  }> {
    const created: string[] = [];
    const skipped: string[] = [];
    const items: { id: string; positionId: string }[] = [];
    for (const draft of drafts) {
      const parsed = inputSchema.safeParse({
        provider: draft.provider,
        externalTitle: draft.externalTitle,
        positionId: draft.positionId,
      });
      if (!parsed.success || !draft.draftReason?.trim()) {
        skipped.push(draft.externalTitle);
        continue;
      }
      const exists = await database
        .query()
        .selectFrom('positionAliases')
        .select(['id'])
        .where('provider', '=', parsed.data.provider)
        .where('externalTitle', '=', parsed.data.externalTitle)
        .executeTakeFirst();
      if (exists || !(await activePosition(parsed.data.positionId))) {
        skipped.push(parsed.data.externalTitle);
        continue;
      }
      const stamp = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('positionAliases')
        .values({
          id,
          ...parsed.data,
          source: 'ai',
          reviewStatus: 'draft',
          draftReason: draft.draftReason.trim().slice(0, 1000),
          confirmedBy: null,
          confirmedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      created.push(id);
      items.push({ id, positionId: parsed.data.positionId });
    }
    return { created, skipped, items };
  }

  return {
    list: async (ctx: ActorContext) => {
      await authorizeAction(ctx.authz, POSITION_ALIAS, 'view');
      return list();
    },
    createDrafts,

    /** createPositionAliasDrafts from a conversation: drafts only, as someone who manages mappings. */
    async createDraftsAs(
      ctx: ActorContext,
      drafts: Parameters<typeof createDrafts>[0],
    ) {
      await authorizeAction(ctx.authz, POSITION_ALIAS, 'manage');
      return createDrafts(drafts);
    },

    /**
     * searchPositions for the HR assistant: enabled positions whose code,
     * title or responsibilities contain the keyword (optionally in one job
     * family), with their family, grade, responsibilities and the mappings
     * already pointing at them.
     */
    async searchPositions(
      ctx: ActorContext,
      input: { keyword?: string; jobFamilyId?: string },
    ) {
      // The spec's talent.position is this application's talent.framework composite.
      await authorizeAction(ctx.authz, 'talent.framework', 'view');
      const [positions, families, aliases] = await Promise.all([
        database
          .query()
          .selectFrom('positions')
          .select([
            'id',
            'code',
            'title',
            'jobFamilyId',
            'grade',
            'responsibilities',
          ])
          .where('active', '=', true)
          .execute(),
        database
          .query()
          .selectFrom('jobFamilies')
          .select(['id', 'title'])
          .execute(),
        database
          .query()
          .selectFrom('positionAliases')
          .select(['provider', 'externalTitle', 'positionId', 'reviewStatus'])
          .execute(),
      ]);
      const family = new Map(families.map((f) => [str(f.id), str(f.title)]));
      const needle = (input.keyword ?? '').replace(/\s+/gu, '').toLowerCase();
      const hay = (value: unknown) =>
        str(value ?? '')
          .replace(/\s+/gu, '')
          .toLowerCase();
      return positions
        .filter(
          (p) =>
            (!input.jobFamilyId || str(p.jobFamilyId) === input.jobFamilyId) &&
            (!needle ||
              hay(p.title).includes(needle) ||
              hay(p.code).includes(needle) ||
              hay(p.responsibilities).includes(needle) ||
              [...needle].filter((ch) => hay(p.title).includes(ch)).length >=
                Math.min(2, needle.length)),
        )
        .slice(0, 30)
        .map((p) => ({
          id: str(p.id),
          code: str(p.code),
          title: str(p.title),
          jobFamily: family.get(str(p.jobFamilyId)) ?? null,
          jobFamilyId: str(p.jobFamilyId),
          grade: p.grade == null ? null : str(p.grade),
          responsibilities:
            p.responsibilities == null
              ? null
              : str(p.responsibilities).slice(0, 500),
          mappings: aliases
            .filter((a) => str(a.positionId) === str(p.id))
            .map((a) => ({
              provider: str(a.provider),
              externalTitle: str(a.externalTitle),
              reviewStatus: str(a.reviewStatus),
            })),
        }));
    },

    async create(ctx: ActorContext, input: unknown) {
      await authorizeAction(ctx.authz, POSITION_ALIAS, 'manage');
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      if (!(await activePosition(parsed.data.positionId)))
        throw new HrError('EMPLOYEE_POSITION_INACTIVE', 400);
      const exists = await database
        .query()
        .selectFrom('positionAliases')
        .select(['id'])
        .where('provider', '=', parsed.data.provider)
        .where('externalTitle', '=', parsed.data.externalTitle)
        .executeTakeFirst();
      if (exists) throw new HrError('POSITION_ALIAS_EXISTS', 409);
      const stamp = new Date();
      await database
        .query()
        .insertInto('positionAliases')
        .values({
          id: newId(),
          ...parsed.data,
          source: 'manual',
          reviewStatus: 'confirmed',
          draftReason: null,
          confirmedBy: ctx.userId,
          confirmedAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return list();
    },

    /** Changes a mapping's position; editing an AI draft and confirming it at once is "修改后确认". */
    async update(ctx: ActorContext, id: string, input: unknown) {
      await authorizeAction(ctx.authz, POSITION_ALIAS, 'manage');
      const parsed = z
        .object({
          positionId: z.string().min(1).max(64),
          confirm: z.boolean().optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      if (!(await activePosition(parsed.data.positionId)))
        throw new HrError('EMPLOYEE_POSITION_INACTIVE', 400);
      if (parsed.data.confirm)
        await authorizeAction(ctx.authz, POSITION_ALIAS, 'confirm');
      const stamp = new Date();
      await database
        .query()
        .updateTable('positionAliases')
        .set({
          positionId: parsed.data.positionId,
          ...(parsed.data.confirm
            ? {
                reviewStatus: 'confirmed',
                confirmedBy: ctx.userId,
                confirmedAt: stamp,
              }
            : {}),
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      if (parsed.data.confirm)
        await recordOutcome([id], 'confirmed', ctx.userId);
      return list();
    },

    async confirm(ctx: ActorContext, ids: readonly string[]) {
      await authorizeAction(ctx.authz, POSITION_ALIAS, 'confirm');
      if (!ids.length) throw new HrError('INVALID_INPUT', 400);
      const stamp = new Date();
      await database
        .query()
        .updateTable('positionAliases')
        .set({
          reviewStatus: 'confirmed',
          confirmedBy: ctx.userId,
          confirmedAt: stamp,
          updatedAt: stamp,
        })
        .where('id', 'in', [...ids])
        .where('reviewStatus', '=', 'draft')
        .execute();
      await recordOutcome(ids, 'confirmed', ctx.userId);
      return list();
    },

    /** Discards drafts, or deletes a confirmed mapping an administrator no longer wants. */
    async remove(ctx: ActorContext, ids: readonly string[]) {
      await authorizeAction(ctx.authz, POSITION_ALIAS, 'manage');
      if (!ids.length) throw new HrError('INVALID_INPUT', 400);
      await recordOutcome(ids, 'discarded', ctx.userId);
      await database
        .query()
        .deleteFrom('positionAliases')
        .where('id', 'in', [...ids])
        .execute();
      return list();
    },
  };
}

export type AliasService = ReturnType<typeof createAliasService>;

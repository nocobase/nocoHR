/**
 * V4-13 能力模型版本 (13A).
 *
 * - A position's requirement changes are written to its draft version
 *   (`draftVersion`); saving recomputes the impact preview (the people on
 *   the position who would get a new gap, and the competencies no longer
 *   required) and asks the framework advisor for a change note (once per
 *   draft content). The current requirements — and so every gap
 *   calculation — do not change until the version is published.
 * - 发布 (`publishVersion`, hr.admin) replaces `positionRequirements` with the
 *   snapshot (every row confirmed), archives the previous published version
 *   and records the effective date. New gaps are the learning coach's daily
 *   gap plans (V3-09).
 * - Each position gets version 1 from its current requirements (published)
 *   the first time versions are read or drafted, and by the step's required
 *   seed on first installation. Requirements still edited directly (the V3-08
 *   path) are reconciled into a new published version by the daily task, so
 *   the history by date stays complete.
 * - `requirementsAt(date)` answers the version in effect on a date; before
 *   the first recorded version, version 1.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, isDateOnly, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { bool, day, hashOf, iso, json } from './context.js';

const RESOURCE = 'talent.competencyModel';

export interface SnapshotItem {
  competencyId: string;
  requiredLevel: number;
  mandatory: boolean;
}

export interface ImpactPreview {
  newGaps: {
    count: number;
    people: {
      employeeId: string;
      name: string;
      competencyId: string;
      competency: string;
      current: number;
      required: number;
    }[];
  };
  removed: { competencyId: string; competency: string }[];
  changed: {
    competencyId: string;
    competency: string;
    from: number | null;
    to: number | null;
    mandatoryFrom: boolean | null;
    mandatoryTo: boolean | null;
  }[];
  computedAt: string;
}

export interface VersionView {
  id: string;
  positionId: string;
  versionNo: number;
  snapshot: (SnapshotItem & { competency: string })[];
  status: string;
  effectiveFrom: string | null;
  changeNote: string | null;
  changeNoteSource: string | null;
  impactPreview: ImpactPreview | null;
  publishedByName: string | null;
  publishedAt: string | null;
  source: string;
  createdAt: string | null;
}

const snapshotSchema = z
  .array(
    z
      .object({
        competencyId: z.string().min(1).max(64),
        requiredLevel: z.number().int().min(1).max(10),
        mandatory: z.boolean(),
      })
      .strict(),
  )
  .max(100);
const draftInput = z
  .object({
    snapshot: snapshotSchema,
    changeNote: z.string().max(4000).nullable().optional(),
  })
  .strict();

export function normalizeSnapshot(items: readonly SnapshotItem[]): SnapshotItem[] {
  return [...items]
    .map((i) => ({
      competencyId: i.competencyId,
      requiredLevel: Number(i.requiredLevel),
      mandatory: Boolean(i.mandatory),
    }))
    .sort((a, b) => a.competencyId.localeCompare(b.competencyId));
}

export function createModelVersionService(
  ctx: TalentReviewContext,
  hooks: { onDraftSaved: (versionId: string) => void },
) {
  const { database } = ctx;

  async function rows(positionId: string) {
    return (
      await database
        .query()
        .selectFrom('competencyModelVersions')
        .selectAll()
        .where('positionId', '=', positionId)
        .orderBy('versionNo', 'asc')
        .execute()
    ).map((row) => ({
      id: str(row.id),
      positionId: str(row.positionId),
      versionNo: Number(row.versionNo),
      snapshot: normalizeSnapshot(json<SnapshotItem[]>(row.snapshot, [])),
      status: str(row.status),
      effectiveFrom: day(row.effectiveFrom),
      changeNote: row.changeNote ? str(row.changeNote) : null,
      changeNoteSource: row.changeNoteSource ? str(row.changeNoteSource) : null,
      changeNoteHash: row.changeNoteHash ? str(row.changeNoteHash) : null,
      impactPreview: json<ImpactPreview | null>(row.impactPreview, null),
      publishedBy: row.publishedBy ? str(row.publishedBy) : null,
      publishedAt: iso(row.publishedAt),
      source: str(row.source),
      createdAt: iso(row.createdAt),
    }));
  }
  type Row = Awaited<ReturnType<typeof rows>>[number];

  async function versionRow(id: string): Promise<Row> {
    const row = await database
      .query()
      .selectFrom('competencyModelVersions')
      .select(['positionId'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('MODEL_VERSION_NOT_FOUND', 404);
    return (await rows(str(row.positionId))).find((r) => r.id === id)!;
  }

  async function assertPosition(positionId: string) {
    const row = await database
      .query()
      .selectFrom('positions')
      .select(['id', 'title'])
      .where('id', '=', positionId)
      .executeTakeFirst();
    if (!row) throw new HrError('POSITION_NOT_FOUND', 404);
    return { id: str(row.id), title: str(row.title) };
  }

  /** Version 1 from the current requirements, when a position has none (trusted). */
  async function ensureInitial(positionId: string, by: string | null) {
    const existing = await rows(positionId);
    if (existing.length) return existing;
    const now = new Date();
    await database
      .query()
      .insertInto('competencyModelVersions')
      .values({
        id: newId(),
        positionId,
        versionNo: 1,
        snapshot: normalizeSnapshot(await ctx.requirementsOf(positionId)),
        status: 'published',
        effectiveFrom: ctx.today(),
        changeNote: null,
        changeNoteSource: null,
        changeNoteHash: null,
        impactPreview: null,
        publishedBy: by,
        publishedAt: now,
        archivedAt: null,
        source: 'system',
        createdBy: by,
        createdAt: now,
        updatedAt: now,
      })
      .execute()
      .catch((error: unknown) => {
        if (!/unique|constraint/iu.test(String(error))) throw error;
      });
    return rows(positionId);
  }

  async function assertSnapshot(snapshot: readonly SnapshotItem[]) {
    const ids = [...new Set(snapshot.map((s) => s.competencyId))];
    if (ids.length !== snapshot.length)
      throw new HrError('MODEL_VERSION_DUPLICATE', 400);
    if (!ids.length) return;
    const found = await database
      .query()
      .selectFrom('competencies')
      .select(['id', 'maxLevel', 'active', 'reviewStatus'])
      .where('id', 'in', ids)
      .execute();
    for (const item of snapshot) {
      const competency = found.find((c) => str(c.id) === item.competencyId);
      if (!competency || !bool(competency.active))
        throw new HrError('COMPETENCY_NOT_FOUND', 404);
      if (item.requiredLevel > Number(competency.maxLevel))
        throw new HrError('REQUIREMENT_LEVEL_EXCEEDS_MAX', 400);
    }
  }

  /** 影响预览: new gaps among the people on the position, removed and changed requirements. */
  async function impactOf(
    positionId: string,
    current: readonly SnapshotItem[],
    next: readonly SnapshotItem[],
  ): Promise<ImpactPreview> {
    const titles = await ctx.competencyTitles();
    const people = [...(await ctx.employees()).values()].filter(
      (e) => e.positionId === positionId && e.status !== 'leave',
    );
    const levels = await ctx.currentLevels(people.map((p) => p.id));
    const before = new Map(current.map((c) => [c.competencyId, c]));
    const after = new Map(next.map((c) => [c.competencyId, c]));
    const newGaps: ImpactPreview['newGaps']['people'] = [];
    for (const person of people) {
      const map = levels.get(person.id) ?? new Map<string, number>();
      for (const item of next) {
        const level = map.get(item.competencyId) ?? 0;
        const old = before.get(item.competencyId);
        const hadGap = old ? level < old.requiredLevel : false;
        if (level < item.requiredLevel && !hadGap)
          newGaps.push({
            employeeId: person.id,
            name: person.name,
            competencyId: item.competencyId,
            competency: titles.get(item.competencyId) ?? item.competencyId,
            current: level,
            required: item.requiredLevel,
          });
      }
    }
    const changed: ImpactPreview['changed'] = [];
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(id);
      const b = after.get(id);
      if (a && b && a.requiredLevel === b.requiredLevel && a.mandatory === b.mandatory)
        continue;
      changed.push({
        competencyId: id,
        competency: titles.get(id) ?? id,
        from: a?.requiredLevel ?? null,
        to: b?.requiredLevel ?? null,
        mandatoryFrom: a?.mandatory ?? null,
        mandatoryTo: b?.mandatory ?? null,
      });
    }
    return {
      newGaps: {
        count: new Set(newGaps.map((g) => g.employeeId)).size,
        people: newGaps,
      },
      removed: [...before.keys()]
        .filter((id) => !after.has(id))
        .map((id) => ({ competencyId: id, competency: titles.get(id) ?? id })),
      changed,
      computedAt: new Date().toISOString(),
    };
  }

  async function toView(row: Row): Promise<VersionView> {
    const titles = await ctx.competencyTitles();
    return {
      id: row.id,
      positionId: row.positionId,
      versionNo: row.versionNo,
      snapshot: row.snapshot.map((s) => ({
        ...s,
        competency: titles.get(s.competencyId) ?? s.competencyId,
      })),
      status: row.status,
      effectiveFrom: row.effectiveFrom,
      changeNote: row.changeNote,
      changeNoteSource: row.changeNoteSource,
      impactPreview: row.impactPreview,
      publishedByName: row.publishedBy ? await ctx.userName(row.publishedBy) : null,
      publishedAt: row.publishedAt,
      source: row.source,
      createdAt: row.createdAt,
    };
  }

  /** Brings a position's current published version in line with requirements edited directly (trusted). */
  async function reconcile(positionId: string): Promise<boolean> {
    const list = await ensureInitial(positionId, null);
    const published = [...list].reverse().find((r) => r.status === 'published');
    const current = normalizeSnapshot(await ctx.requirementsOf(positionId));
    if (published && hashOf(published.snapshot) === hashOf(current)) return false;
    const now = new Date();
    const versionNo = Math.max(...list.map((r) => r.versionNo)) + 1;
    // A pending draft keeps its number: the reconciled version takes the next one after it.
    await database.transaction(async (connection) => {
      if (published)
        await connection.query
          .updateTable('competencyModelVersions')
          .set({ status: 'archived', archivedAt: now, updatedAt: now })
          .where('id', '=', published.id)
          .execute();
      await connection.query
        .insertInto('competencyModelVersions')
        .values({
          id: newId(),
          positionId,
          versionNo,
          snapshot: current,
          status: 'published',
          effectiveFrom: ctx.today(),
          changeNote: '岗位要求直接修改后同步',
          changeNoteSource: 'rule',
          changeNoteHash: null,
          impactPreview: null,
          publishedBy: null,
          publishedAt: now,
          archivedAt: null,
          source: 'system',
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    });
    return true;
  }

  const service = {
    versionRow,
    impactOf,
    ensureInitial,
    reconcile,

    async list(actor: ActorContext, positionId: string) {
      await authorizeAction(actor.authz, RESOURCE, 'view');
      await assertPosition(positionId);
      await reconcile(positionId);
      const list = await rows(positionId);
      const current = [...list].reverse().find((r) => r.status === 'published');
      const draft = list.find((r) => r.status === 'draft');
      // The preview shows today's numbers.
      if (draft && current) {
        draft.impactPreview = await impactOf(positionId, current.snapshot, draft.snapshot);
      }
      return {
        current: current ? await toView(current) : null,
        draft: draft ? await toView(draft) : null,
        history: await Promise.all(
          list.filter((r) => r.status === 'archived').reverse().map(toView),
        ),
        can: {
          draft: await ctx.can(actor, RESOURCE, 'draftVersion'),
          publish: await ctx.can(actor, RESOURCE, 'publishVersion'),
        },
      };
    },

    /** Saves the position's draft version (creating it from the next number) and recomputes the preview. */
    async saveDraft(actor: ActorContext, positionId: string, input: unknown) {
      await authorizeAction(actor.authz, RESOURCE, 'draftVersion');
      await assertPosition(positionId);
      const parsed = draftInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const snapshot = normalizeSnapshot(parsed.data.snapshot);
      await assertSnapshot(snapshot);
      await reconcile(positionId);
      const list = await rows(positionId);
      const current = [...list].reverse().find((r) => r.status === 'published');
      const draft = list.find((r) => r.status === 'draft');
      const impact = await impactOf(positionId, current?.snapshot ?? [], snapshot);
      const now = new Date();
      const note =
        parsed.data.changeNote === undefined
          ? {}
          : {
              changeNote: parsed.data.changeNote,
              changeNoteSource: parsed.data.changeNote ? 'manual' : null,
            };
      let id: string;
      if (draft) {
        id = draft.id;
        await database
          .query()
          .updateTable('competencyModelVersions')
          .set({ snapshot, impactPreview: impact, ...note, updatedAt: now })
          .where('id', '=', draft.id)
          .execute();
      } else {
        id = newId();
        await database
          .query()
          .insertInto('competencyModelVersions')
          .values({
            id,
            positionId,
            versionNo: Math.max(0, ...list.map((r) => r.versionNo)) + 1,
            snapshot,
            status: 'draft',
            effectiveFrom: null,
            changeNote: parsed.data.changeNote ?? null,
            changeNoteSource: parsed.data.changeNote ? 'manual' : null,
            changeNoteHash: null,
            impactPreview: impact,
            publishedBy: null,
            publishedAt: null,
            archivedAt: null,
            source: 'manual',
            createdBy: actor.userId,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
      hooks.onDraftSaved(id);
      return toView(await versionRow(id));
    },

    async discardDraft(actor: ActorContext, versionId: string) {
      await authorizeAction(actor.authz, RESOURCE, 'draftVersion');
      const row = await versionRow(versionId);
      if (row.status !== 'draft') throw new HrError('MODEL_VERSION_NOT_DRAFT', 409);
      await database
        .query()
        .deleteFrom('competencyModelVersions')
        .where('id', '=', versionId)
        .where('status', '=', 'draft')
        .execute();
      return { discarded: versionId };
    },

    /** 发布: replaces the current requirements with the snapshot; the previous version is archived. */
    async publish(actor: ActorContext, versionId: string, input: unknown) {
      await authorizeAction(actor.authz, RESOURCE, 'publishVersion');
      const row = await versionRow(versionId);
      if (row.status !== 'draft') throw new HrError('MODEL_VERSION_NOT_DRAFT', 409);
      const body = (input && typeof input === 'object' ? input : {}) as {
        changeNote?: unknown;
      };
      const changeNote =
        typeof body.changeNote === 'string' && body.changeNote.trim()
          ? body.changeNote.trim().slice(0, 4000)
          : row.changeNote;
      await assertSnapshot(row.snapshot);
      const list = await rows(row.positionId);
      const current = [...list].reverse().find((r) => r.status === 'published');
      const impact = await impactOf(row.positionId, current?.snapshot ?? [], row.snapshot);
      const existing = await database
        .query()
        .selectFrom('positionRequirements')
        .select(['id', 'competencyId'])
        .where('positionId', '=', row.positionId)
        .execute();
      const now = new Date();
      await database.transaction(async (connection) => {
        const wanted = new Map(row.snapshot.map((s) => [s.competencyId, s]));
        for (const requirement of existing) {
          const item = wanted.get(str(requirement.competencyId));
          if (!item)
            await connection.query
              .deleteFrom('positionRequirements')
              .where('id', '=', str(requirement.id))
              .execute();
          else
            await connection.query
              .updateTable('positionRequirements')
              .set({
                requiredLevel: item.requiredLevel,
                mandatory: item.mandatory,
                reviewStatus: 'confirmed',
                updatedAt: now,
              })
              .where('id', '=', str(requirement.id))
              .execute();
        }
        const present = new Set(existing.map((e) => str(e.competencyId)));
        for (const item of row.snapshot)
          if (!present.has(item.competencyId))
            await connection.query
              .insertInto('positionRequirements')
              .values({
                id: newId(),
                positionId: row.positionId,
                competencyId: item.competencyId,
                requiredLevel: item.requiredLevel,
                mandatory: item.mandatory,
                source: 'manual',
                reviewStatus: 'confirmed',
                createdAt: now,
                updatedAt: now,
              })
              .execute();
        if (current)
          await connection.query
            .updateTable('competencyModelVersions')
            .set({ status: 'archived', archivedAt: now, updatedAt: now })
            .where('id', '=', current.id)
            .execute();
        await connection.query
          .updateTable('competencyModelVersions')
          .set({
            status: 'published',
            effectiveFrom: ctx.today(),
            changeNote,
            impactPreview: impact,
            publishedBy: actor.userId,
            publishedAt: now,
            updatedAt: now,
          })
          .where('id', '=', versionId)
          .execute();
      });
      return toView(await versionRow(versionId));
    },

    /** 按日期查询当日生效的要求 (also used by the audit export). */
    async requirementsAt(actor: ActorContext, positionId: string, date: string) {
      await authorizeAction(actor.authz, RESOURCE, 'view');
      if (!isDateOnly(date)) throw new HrError('INVALID_DATE', 400);
      await assertPosition(positionId);
      return service.requirementsAtTrusted(positionId, date);
    },

    async requirementsAtTrusted(positionId: string, date: string) {
      const list = (await ensureInitial(positionId, null)).filter(
        (r) => r.status !== 'draft' && r.effectiveFrom,
      );
      // The latest publication on or before the date; the same day's later publication wins.
      const effective =
        [...list]
          .filter((r) => (r.effectiveFrom ?? '') <= date)
          .sort(
            (a, b) =>
              (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? '') ||
              a.versionNo - b.versionNo,
          )
          .at(-1) ?? list.sort((a, b) => a.versionNo - b.versionNo)[0];
      if (!effective) return { date, version: null };
      return { date, version: await toView(effective) };
    },

    /** 某员工在某日的岗位要求: the position held that day (from the job events) and its version. */
    async employeeRequirementsAt(employeeId: string, date: string) {
      const events = await database
        .query()
        .selectFrom('jobEvents')
        .select(['toPositionId', 'effectiveDate', 'eventType'])
        .where('employeeId', '=', employeeId)
        .execute();
      const held = events
        .filter((e) => e.toPositionId && (day(e.effectiveDate) ?? '') <= date)
        .sort((a, b) => str(a.effectiveDate).localeCompare(str(b.effectiveDate)))
        .at(-1);
      const employee = await ctx.employee(employeeId);
      const positionId = held?.toPositionId
        ? str(held.toPositionId)
        : employee.positionId;
      if (!positionId) return { date, positionId: null, version: null };
      return { positionId, ...(await service.requirementsAtTrusted(positionId, date)) };
    },

    /** Every position with confirmed requirements gets version 1 (the required seed does the same on install). */
    async ensureAll(): Promise<number> {
      const positions = await database
        .query()
        .selectFrom('positions')
        .select(['id'])
        .execute();
      let changed = 0;
      for (const p of positions) if (await reconcile(str(p.id))) changed += 1;
      return changed;
    },

    /** The advisor's note is written for this content hash (same draft, same note). */
    contentHash(row: Row, current: readonly SnapshotItem[]): string {
      return hashOf({ draft: row.snapshot, current });
    },

    async currentOf(positionId: string) {
      const list = await rows(positionId);
      return [...list].reverse().find((r) => r.status === 'published') ?? null;
    },

    async writeNote(versionId: string, note: string, source: 'ai' | 'rule', hash: string) {
      await database
        .query()
        .updateTable('competencyModelVersions')
        .set({
          changeNote: note,
          changeNoteSource: source,
          changeNoteHash: hash,
          updatedAt: new Date(),
        })
        .where('id', '=', versionId)
        .where('status', '=', 'draft')
        .execute();
    },
  };
  return service;
}

export type ModelVersionService = ReturnType<typeof createModelVersionService>;

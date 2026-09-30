import type { AuthorizationContext } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import { recordDraftOutcome } from './draft-snapshots.js';
import {
  HrError,
  isRecord,
  newId,
  requireEnum,
  requireString,
  str,
} from './shared.js';

export interface ActorContext {
  readonly authz: AuthorizationContext;
  readonly userId: string;
}

export const COMPETENCY_CATEGORIES = [
  'skill',
  'quality',
  'qualification',
] as const;
export const REVIEW_STATUSES = ['draft', 'confirmed'] as const;
export const SOURCES = ['manual', 'ai', 'import'] as const;

export interface JobFamily {
  id: string;
  code: string;
  title: string;
  description: string | null;
  active: boolean;
  sortOrder: number;
}
export interface Position {
  id: string;
  code: string;
  title: string;
  jobFamilyId: string;
  grade: string | null;
  responsibilities: string | null;
  /** When the framework advisor drafted this position's model automatically; each position is drafted once. */
  aiDraftedAt: string | null;
  /** The employee import that created this position; null when created by hand. */
  importBatchId: string | null;
  /** V3-08 岗位说明书: the uploaded file (an `hrFiles` row), its name, extracted text and extraction state. */
  jdFileId: string | null;
  jdFilename: string | null;
  jdText: string | null;
  jdStatus: 'pending' | 'ready' | 'failed' | null;
  jdError: string | null;
  active: boolean;
  sortOrder: number;
}
export interface Competency {
  id: string;
  code: string;
  title: string;
  category: (typeof COMPETENCY_CATEGORIES)[number];
  description: string | null;
  maxLevel: number;
  source: (typeof SOURCES)[number];
  reviewStatus: (typeof REVIEW_STATUSES)[number];
  active: boolean;
}
export interface CompetencyLevel {
  id: string;
  competencyId: string;
  level: number;
  title: string;
  behaviors: string;
}
export interface PositionRequirement {
  id: string;
  positionId: string;
  competencyId: string;
  requiredLevel: number;
  mandatory: boolean;
  source: (typeof SOURCES)[number];
  reviewStatus: (typeof REVIEW_STATUSES)[number];
}

export interface LevelInput {
  level: number;
  title: string;
  behaviors: string;
}

export interface FrameworkService {
  listFramework(ctx: ActorContext): Promise<{
    jobFamilies: JobFamily[];
    positions: Position[];
    requirements: PositionRequirement[];
    competencies: Competency[];
    canManage: boolean;
    canConfirm: boolean;
    canUseAdvisor: boolean;
  }>;
  saveJobFamily(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<JobFamily>;
  savePosition(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<Position>;
  setPositionActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<{ position: Position; activeEmployees: number }>;
  setJobFamilyActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<JobFamily>;
  saveRequirement(
    ctx: ActorContext,
    positionId: string,
    input: unknown,
    options?: { source?: 'manual' | 'ai'; draft?: boolean },
  ): Promise<PositionRequirement>;
  removeRequirement(ctx: ActorContext, id: string): Promise<void>;
  confirmRequirements(
    ctx: ActorContext,
    ids: readonly string[],
  ): Promise<{ confirmedCompetencies: string[] }>;
  discardRequirements(ctx: ActorContext, ids: readonly string[]): Promise<void>;
  listCompetencies(
    ctx: ActorContext,
    options?: { draftOnly?: boolean; includeInactive?: boolean },
  ): Promise<{
    competencies: (Competency & {
      positionCount: number;
      levels: CompetencyLevel[];
    })[];
    canManage: boolean;
    canConfirm: boolean;
  }>;
  getCompetency(
    ctx: ActorContext,
    id: string,
  ): Promise<
    | (Competency & { levels: CompetencyLevel[]; positionCount: number })
    | undefined
  >;
  saveCompetency(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
    options?: { source?: 'manual' | 'ai'; draft?: boolean },
  ): Promise<Competency & { levels: CompetencyLevel[] }>;
  confirmCompetencies(ctx: ActorContext, ids: readonly string[]): Promise<void>;
  discardCompetencies(ctx: ActorContext, ids: readonly string[]): Promise<void>;
  /** Deactivating keeps history; `confirmedRequirements` is how many confirmed requirements still reference it. */
  setCompetencyActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<Competency & { confirmedRequirements: number }>;
  /** Advisor tools: read a position and its confirmed and draft requirements. */
  positionContext(
    ctx: ActorContext,
    positionId: string,
  ): Promise<{
    position: Position;
    jobFamily: JobFamily | undefined;
    requirements: (PositionRequirement & {
      competencyTitle: string;
      competencyCode: string;
    })[];
  }>;
  searchCompetencies(
    ctx: ActorContext,
    query: { keyword?: string; category?: string },
  ): Promise<Competency[]>;
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/**
 * V3-08: told after a confirmation commits which positions went from "no
 * confirmed requirement" to "some" (岗位要求首次整体确认), so the competency
 * service can raise assessment to-dos. Registered at boot, released on
 * shutdown; a listener failure never fails the confirmation.
 */
export type FirstConfirmationListener = (
  positionIds: readonly string[],
) => Promise<void> | void;
const firstConfirmationListeners = new Set<FirstConfirmationListener>();
export function onRequirementsFirstConfirmed(
  listener: FirstConfirmationListener,
): () => void {
  firstConfirmationListeners.add(listener);
  return () => firstConfirmationListeners.delete(listener);
}

export function toJobFamily(row: Record<string, unknown>): JobFamily {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    description: row.description == null ? null : str(row.description),
    active: bool(row.active),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}
export function toPosition(row: Record<string, unknown>): Position {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    jobFamilyId: String(row.jobFamilyId),
    grade: row.grade == null ? null : str(row.grade),
    responsibilities:
      row.responsibilities == null ? null : str(row.responsibilities),
    aiDraftedAt:
      row.aiDraftedAt == null
        ? null
        : row.aiDraftedAt instanceof Date
          ? row.aiDraftedAt.toISOString()
          : str(row.aiDraftedAt),
    importBatchId: row.importBatchId == null ? null : str(row.importBatchId),
    jdFileId: row.jdFileId == null ? null : str(row.jdFileId),
    jdFilename: row.jdFilename == null ? null : str(row.jdFilename),
    jdText: row.jdText == null ? null : str(row.jdText),
    jdStatus:
      row.jdStatus == null ? null : (str(row.jdStatus) as Position['jdStatus']),
    jdError: row.jdError == null ? null : str(row.jdError),
    active: bool(row.active),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}
export function toCompetency(row: Record<string, unknown>): Competency {
  return {
    id: String(row.id),
    code: String(row.code),
    title: String(row.title),
    category: String(row.category) as Competency['category'],
    description: row.description == null ? null : str(row.description),
    maxLevel: Number(row.maxLevel ?? 5),
    source: String(row.source) as Competency['source'],
    reviewStatus: String(row.reviewStatus) as Competency['reviewStatus'],
    active: bool(row.active),
  };
}
export function toLevel(row: Record<string, unknown>): CompetencyLevel {
  return {
    id: String(row.id),
    competencyId: String(row.competencyId),
    level: Number(row.level),
    title: String(row.title),
    behaviors: str(row.behaviors ?? ''),
  };
}
export function toRequirement(
  row: Record<string, unknown>,
): PositionRequirement {
  return {
    id: String(row.id),
    positionId: String(row.positionId),
    competencyId: String(row.competencyId),
    requiredLevel: Number(row.requiredLevel),
    mandatory: bool(row.mandatory),
    source: String(row.source) as PositionRequirement['source'],
    reviewStatus: String(
      row.reviewStatus,
    ) as PositionRequirement['reviewStatus'],
  };
}

export function createFrameworkService(
  database: DatabaseManager,
): FrameworkService {
  const FRAMEWORK = 'talent.framework';
  const COMPETENCY = 'talent.competency';

  async function can(
    ctx: ActorContext,
    resource: string,
    action: string,
  ): Promise<boolean> {
    return (
      (await tryAuthorizeAction(ctx.authz, resource, action)) !== undefined
    );
  }

  async function loadLevels(
    competencyIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<Map<string, CompetencyLevel[]>> {
    const map = new Map<string, CompetencyLevel[]>();
    if (!competencyIds.length) return map;
    const rows = await (connection ? connection.query : database.query())
      .selectFrom('competencyLevels')
      .select(['id', 'competencyId', 'level', 'title', 'behaviors'])
      .where('competencyId', 'in', [...competencyIds])
      .orderBy('level', 'asc')
      .execute();
    for (const row of rows) {
      const level = toLevel(row);
      const list = map.get(level.competencyId) ?? [];
      list.push(level);
      map.set(level.competencyId, list);
    }
    return map;
  }

  async function positionCounts(): Promise<Map<string, number>> {
    const rows = await database
      .query()
      .selectFrom('positionRequirements')
      .select(['competencyId'])
      .execute();
    const map = new Map<string, number>();
    for (const row of rows) {
      const id = String(row.competencyId);
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }

  function validateLevels(levels: unknown, maxLevel: number): LevelInput[] {
    if (levels === undefined) return [];
    if (!Array.isArray(levels))
      throw new HrError('COMPETENCY_LEVELS_INVALID', 400);
    const result: LevelInput[] = [];
    const seen = new Set<number>();
    for (const item of levels) {
      if (!isRecord(item)) throw new HrError('COMPETENCY_LEVELS_INVALID', 400);
      const level = Number(item.level);
      if (
        !Number.isInteger(level) ||
        level < 1 ||
        level > maxLevel ||
        seen.has(level)
      )
        throw new HrError('COMPETENCY_LEVELS_INVALID', 400);
      seen.add(level);
      result.push({
        level,
        title:
          requireString(item.title, 'COMPETENCY_LEVELS_INVALID', {
            max: 200,
          }) ?? '',
        behaviors:
          requireString(item.behaviors, 'COMPETENCY_LEVELS_INVALID', {
            max: 4000,
          }) ?? '',
      });
    }
    return result.sort((a, b) => a.level - b.level);
  }

  async function assertCodeFree(
    collection: string,
    code: string,
    exceptId: string | null,
    connection: DatabaseConnection,
  ): Promise<void> {
    const existing = await connection.query
      .selectFrom(collection)
      .select(['id'])
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing && String(existing.id) !== exceptId)
      throw new HrError('CODE_TAKEN', 409);
  }

  const service: FrameworkService = {
    async listFramework(ctx) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'view');
      const competencyPolicies = await tryAuthorizeAction(
        ctx.authz,
        COMPETENCY,
        'view',
      );
      const canConfirm = await can(ctx, FRAMEWORK, 'confirm');
      const [families, positions, requirements] = await Promise.all([
        database
          .repository('jobFamilies')
          .withPolicy(policyOf(policies, 'jobFamilies'))
          .findMany({
            sort: (s) => [s.field('sortOrder').asc(), s.field('title').asc()],
          }),
        database
          .repository('positions')
          .withPolicy(policyOf(policies, 'positions'))
          .findMany({
            sort: (s) => [s.field('sortOrder').asc(), s.field('title').asc()],
          }),
        database
          .repository('positionRequirements')
          .withPolicy(policyOf(policies, 'positionRequirements'))
          .findMany(),
      ]);
      const competencies = competencyPolicies
        ? await database
            .repository('competencies')
            .withPolicy(policyOf(competencyPolicies, 'competencies'))
            .findMany({
              sort: (s) => [s.field('category').asc(), s.field('title').asc()],
            })
        : [];
      const canSeeDrafts = canConfirm;
      return {
        jobFamilies: families.map((r) =>
          toJobFamily(r as Record<string, unknown>),
        ),
        positions: positions.map((r) =>
          toPosition(r as Record<string, unknown>),
        ),
        requirements: requirements
          .map((r) => toRequirement(r as Record<string, unknown>))
          .filter((r) => canSeeDrafts || r.reviewStatus === 'confirmed'),
        competencies: competencies
          .map((r) => toCompetency(r as Record<string, unknown>))
          .filter((c) => canSeeDrafts || c.reviewStatus === 'confirmed'),
        canManage: await can(ctx, FRAMEWORK, 'manage'),
        canConfirm,
        canUseAdvisor: await can(ctx, 'talent.frameworkAdvisor', 'use'),
      };
    },

    async saveJobFamily(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const code = requireString(input.code, 'JOB_FAMILY_CODE_REQUIRED', {
        max: 64,
      })!;
      const title = requireString(input.title, 'JOB_FAMILY_TITLE_REQUIRED', {
        max: 200,
      })!;
      const description = requireString(input.description, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
      const sortOrder =
        input.sortOrder === undefined ? undefined : Number(input.sortOrder);
      return database.transaction(async (connection) => {
        await assertCodeFree('jobFamilies', code, id, connection);
        const repo = connection
          .repository('jobFamilies')
          .withPolicy(policyOf(policies, 'jobFamilies'));
        const now = new Date();
        if (id) {
          const { record } = await repo.updateOne({
            filter: { id },
            values: {
              code,
              title,
              description,
              ...(sortOrder === undefined ? {} : { sortOrder }),
              updatedAt: now,
            },
          });
          return toJobFamily(record);
        }
        const { record } = await repo.createOne({
          values: {
            id: newId(),
            code,
            title,
            description,
            active: true,
            sortOrder: sortOrder ?? 0,
            createdAt: now,
            updatedAt: now,
          },
        });
        return toJobFamily(record);
      });
    },

    async savePosition(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const code = requireString(input.code, 'POSITION_CODE_REQUIRED', {
        max: 64,
      })!;
      const title = requireString(input.title, 'POSITION_TITLE_REQUIRED', {
        max: 200,
      })!;
      const jobFamilyId = requireString(
        input.jobFamilyId,
        'POSITION_FAMILY_REQUIRED',
        { max: 64 },
      )!;
      const grade = requireString(input.grade, 'INVALID_INPUT', {
        optional: true,
        max: 32,
      });
      const responsibilities = requireString(
        input.responsibilities,
        'INVALID_INPUT',
        { optional: true, max: 20000 },
      );
      const sortOrder =
        input.sortOrder === undefined ? undefined : Number(input.sortOrder);
      return database.transaction(async (connection) => {
        const family = await connection.query
          .selectFrom('jobFamilies')
          .select(['id'])
          .where('id', '=', jobFamilyId)
          .executeTakeFirst();
        if (!family) throw new HrError('POSITION_FAMILY_NOT_FOUND', 404);
        await assertCodeFree('positions', code, id, connection);
        const repo = connection
          .repository('positions')
          .withPolicy(policyOf(policies, 'positions'));
        const now = new Date();
        if (id) {
          const { record } = await repo.updateOne({
            filter: { id },
            values: {
              code,
              title,
              jobFamilyId,
              grade,
              responsibilities,
              ...(sortOrder === undefined ? {} : { sortOrder }),
              updatedAt: now,
            },
          });
          return toPosition(record);
        }
        const { record } = await repo.createOne({
          values: {
            id: newId(),
            code,
            title,
            jobFamilyId,
            grade,
            responsibilities,
            active: true,
            sortOrder: sortOrder ?? 0,
            createdAt: now,
            updatedAt: now,
          },
        });
        return toPosition(record);
      });
    },

    async setPositionActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      const activeEmployees = await database
        .query()
        .selectFrom('employees')
        .select(['id'])
        .where('positionId', '=', id)
        .where('status', '!=', 'leave')
        .execute();
      const { record } = await database
        .repository('positions')
        .withPolicy(policyOf(policies, 'positions'))
        .updateOne({
          filter: { id },
          values: { active, updatedAt: new Date() },
        });
      return {
        position: toPosition(record),
        activeEmployees: activeEmployees.length,
      };
    },

    async setJobFamilyActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      const { record } = await database
        .repository('jobFamilies')
        .withPolicy(policyOf(policies, 'jobFamilies'))
        .updateOne({
          filter: { id },
          values: { active, updatedAt: new Date() },
        });
      return toJobFamily(record);
    },

    async saveRequirement(ctx, positionId, input, options = {}) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const competencyId = requireString(
        input.competencyId,
        'REQUIREMENT_COMPETENCY_REQUIRED',
        { max: 64 },
      )!;
      const requiredLevel = Number(input.requiredLevel);
      const mandatory = Boolean(input.mandatory);
      if (!Number.isInteger(requiredLevel) || requiredLevel < 1)
        throw new HrError('REQUIREMENT_LEVEL_INVALID', 400);
      return database.transaction(async (connection) => {
        const position = await connection.query
          .selectFrom('positions')
          .select(['id'])
          .where('id', '=', positionId)
          .executeTakeFirst();
        if (!position) throw new HrError('POSITION_NOT_FOUND', 404);
        const competency = await connection.query
          .selectFrom('competencies')
          .select(['id', 'maxLevel', 'active'])
          .where('id', '=', competencyId)
          .executeTakeFirst();
        if (!competency || !bool(competency.active))
          throw new HrError('COMPETENCY_NOT_FOUND', 404);
        if (requiredLevel > Number(competency.maxLevel))
          throw new HrError('REQUIREMENT_LEVEL_EXCEEDS_MAX', 400);
        const repo = connection
          .repository('positionRequirements')
          .withPolicy(policyOf(policies, 'positionRequirements'));
        const now = new Date();
        const existing = await connection.query
          .selectFrom('positionRequirements')
          .select(['id', 'reviewStatus'])
          .where('positionId', '=', positionId)
          .where('competencyId', '=', competencyId)
          .executeTakeFirst();
        const draft = options.draft ?? false;
        if (existing) {
          // A person editing an existing requirement updates it; the advisor never overwrites a confirmed one.
          if (options.source === 'ai')
            throw new HrError('REQUIREMENT_EXISTS', 409);
          if (input.id === undefined || str(input.id) !== String(existing.id))
            throw new HrError('REQUIREMENT_EXISTS', 409);
          const { record } = await repo.updateOne({
            filter: { id: String(existing.id) },
            values: { requiredLevel, mandatory, updatedAt: now },
          });
          return toRequirement(record);
        }
        const { record } = await repo.createOne({
          values: {
            id: newId(),
            positionId,
            competencyId,
            requiredLevel,
            mandatory,
            source: options.source ?? 'manual',
            reviewStatus: draft ? 'draft' : 'confirmed',
            createdAt: now,
            updatedAt: now,
          },
        });
        return toRequirement(record);
      });
    },

    async removeRequirement(ctx, id) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'manage');
      await database
        .repository('positionRequirements')
        .withPolicy(policyOf(policies, 'positionRequirements'))
        .deleteOne({ filter: { id } });
    },

    async confirmRequirements(ctx, ids) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'confirm');
      const competencyPolicies = await authorizeAction(
        ctx.authz,
        COMPETENCY,
        'confirm',
      );
      if (!ids.length) return { confirmedCompetencies: [] };
      // Positions without any confirmed requirement before this confirmation.
      const touched = [
        ...new Set(
          (
            await database
              .query()
              .selectFrom('positionRequirements')
              .select(['positionId'])
              .where('id', 'in', [...ids])
              .execute()
          ).map((row) => String(row.positionId)),
        ),
      ];
      const alreadyConfirmed = new Set(
        touched.length
          ? (
              await database
                .query()
                .selectFrom('positionRequirements')
                .select(['positionId'])
                .where('positionId', 'in', touched)
                .where('reviewStatus', '=', 'confirmed')
                .execute()
            ).map((row) => String(row.positionId))
          : [],
      );
      const result = await database.transaction(async (connection) => {
        const rows = await connection.query
          .selectFrom('positionRequirements')
          .select(['id', 'competencyId', 'reviewStatus'])
          .where('id', 'in', [...ids])
          .execute();
        const now = new Date();
        const confirmedCompetencies: string[] = [];
        const requirementRepo = connection
          .repository('positionRequirements')
          .withPolicy(policyOf(policies, 'positionRequirements'));
        const competencyRepo = connection
          .repository('competencies')
          .withPolicy(policyOf(competencyPolicies, 'competencies'));
        for (const row of rows) {
          // Confirming a requirement that references a draft competency confirms the competency in the same transaction.
          const competency = await connection.query
            .selectFrom('competencies')
            .select(['id', 'reviewStatus'])
            .where('id', '=', String(row.competencyId))
            .executeTakeFirst();
          if (competency && competency.reviewStatus === 'draft') {
            await competencyRepo.updateOne({
              filter: { id: String(competency.id) },
              values: { reviewStatus: 'confirmed', updatedAt: now },
            });
            confirmedCompetencies.push(String(competency.id));
          }
          if (row.reviewStatus !== 'confirmed') {
            await requirementRepo.updateOne({
              filter: { id: String(row.id) },
              values: { reviewStatus: 'confirmed', updatedAt: now },
            });
          }
        }
        return { confirmedCompetencies: [...new Set(confirmedCompetencies)] };
      });
      // Outside the transaction: the run items live on another connection.
      for (const id of ids)
        await recordDraftOutcome(
          database,
          'positionRequirement',
          id,
          'confirmed',
          ctx.userId,
        );
      for (const id of result.confirmedCompetencies)
        await recordDraftOutcome(
          database,
          'competency',
          id,
          'confirmed',
          ctx.userId,
        );
      const first = touched.filter((id) => !alreadyConfirmed.has(id));
      if (first.length)
        for (const listener of firstConfirmationListeners) {
          try {
            await listener(first);
          } catch {
            // To-dos are a follow-up; the confirmation has committed.
          }
        }
      return result;
    },

    async discardRequirements(ctx, ids) {
      const policies = await authorizeAction(ctx.authz, FRAMEWORK, 'confirm');
      if (!ids.length) return;
      for (const id of ids)
        await recordDraftOutcome(
          database,
          'positionRequirement',
          id,
          'discarded',
          ctx.userId,
        );
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('positionRequirements')
          .withPolicy(policyOf(policies, 'positionRequirements'));
        const rows = await connection.query
          .selectFrom('positionRequirements')
          .select(['id', 'reviewStatus'])
          .where('id', 'in', [...ids])
          .execute();
        for (const row of rows) {
          if (row.reviewStatus !== 'draft')
            throw new HrError('REQUIREMENT_NOT_DRAFT', 409);
          await repo.deleteOne({ filter: { id: String(row.id) } });
        }
      });
    },

    async listCompetencies(ctx, options = {}) {
      const policies = await authorizeAction(ctx.authz, COMPETENCY, 'view');
      const canConfirm = await can(ctx, COMPETENCY, 'confirm');
      const rows = await database
        .repository('competencies')
        .withPolicy(policyOf(policies, 'competencies'))
        .findMany({
          sort: (s) => [s.field('category').asc(), s.field('title').asc()],
        });
      let competencies = rows.map((r) =>
        toCompetency(r as Record<string, unknown>),
      );
      if (!canConfirm)
        competencies = competencies.filter(
          (c) => c.reviewStatus === 'confirmed',
        );
      if (options.draftOnly)
        competencies = competencies.filter((c) => c.reviewStatus === 'draft');
      if (!options.includeInactive)
        competencies = competencies.filter((c) => c.active);
      const levels = await loadLevels(competencies.map((c) => c.id));
      const counts = await positionCounts();
      return {
        competencies: competencies.map((c) => ({
          ...c,
          positionCount: counts.get(c.id) ?? 0,
          levels: levels.get(c.id) ?? [],
        })),
        canManage: await can(ctx, COMPETENCY, 'manage'),
        canConfirm,
      };
    },

    async getCompetency(ctx, id) {
      const policies = await authorizeAction(ctx.authz, COMPETENCY, 'view');
      const row = await database
        .repository('competencies')
        .withPolicy(policyOf(policies, 'competencies'))
        .findOne({ filter: { id } });
      if (!row) return undefined;
      const competency = toCompetency(row);
      if (
        competency.reviewStatus === 'draft' &&
        !(await can(ctx, COMPETENCY, 'confirm'))
      )
        return undefined;
      const levels = await loadLevels([id]);
      const counts = await positionCounts();
      return {
        ...competency,
        levels: levels.get(id) ?? [],
        positionCount: counts.get(id) ?? 0,
      };
    },

    async saveCompetency(ctx, id, input, options = {}) {
      const policies = await authorizeAction(ctx.authz, COMPETENCY, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const code = requireString(input.code, 'COMPETENCY_CODE_REQUIRED', {
        max: 64,
      })!;
      const title = requireString(input.title, 'COMPETENCY_TITLE_REQUIRED', {
        max: 200,
      })!;
      const category = requireEnum(
        input.category,
        COMPETENCY_CATEGORIES,
        'COMPETENCY_CATEGORY_INVALID',
      );
      const description = requireString(input.description, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
      const maxLevel =
        input.maxLevel === undefined
          ? category === 'qualification'
            ? 1
            : 5
          : Number(input.maxLevel);
      if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 5)
        throw new HrError('COMPETENCY_MAX_LEVEL_INVALID', 400);
      const levels = validateLevels(input.levels, maxLevel);
      return database.transaction(async (connection) => {
        await assertCodeFree('competencies', code, id, connection);
        const repo = connection
          .repository('competencies')
          .withPolicy(policyOf(policies, 'competencies'));
        const levelRepo = connection
          .repository('competencyLevels')
          .withPolicy(policyOf(policies, 'competencyLevels'));
        const now = new Date();
        let saved: Record<string, unknown>;
        if (id) {
          const current = await connection.query
            .selectFrom('competencies')
            .select(['id', 'maxLevel'])
            .where('id', '=', id)
            .executeTakeFirst();
          if (!current) throw new HrError('COMPETENCY_NOT_FOUND', 404);
          if (maxLevel < Number(current.maxLevel)) {
            // Lowering the ceiling under an existing requirement or assessment would silently invalidate it.
            const requirements = await connection.query
              .selectFrom('positionRequirements')
              .select(['positionId', 'requiredLevel'])
              .where('competencyId', '=', id)
              .where('requiredLevel', '>', maxLevel)
              .execute();
            const assessments = await connection.query
              .selectFrom('employeeCompetencies')
              .select(['employeeId', 'level'])
              .where('competencyId', '=', id)
              .where('level', '>', maxLevel)
              .execute();
            if (requirements.length || assessments.length) {
              throw new HrError('COMPETENCY_MAX_LEVEL_CONFLICT', 409, {
                requirements: requirements.map((r) => ({
                  positionId: String(r.positionId),
                  requiredLevel: Number(r.requiredLevel),
                })),
                assessments: assessments.map((a) => ({
                  employeeId: String(a.employeeId),
                  level: Number(a.level),
                })),
              });
            }
          }
          const { record } = await repo.updateOne({
            filter: { id },
            values: {
              code,
              title,
              category,
              description,
              maxLevel,
              updatedAt: now,
            },
          });
          saved = record;
        } else {
          const { record } = await repo.createOne({
            values: {
              id: newId(),
              code,
              title,
              category,
              description,
              maxLevel,
              source: options.source ?? 'manual',
              reviewStatus: options.draft ? 'draft' : 'confirmed',
              active: true,
              createdAt: now,
              updatedAt: now,
            },
          });
          saved = record;
        }
        const competencyId = String(saved.id);
        if (input.levels !== undefined) {
          const existing = await connection.query
            .selectFrom('competencyLevels')
            .select(['id', 'level'])
            .where('competencyId', '=', competencyId)
            .execute();
          const byLevel = new Map(
            existing.map((row) => [Number(row.level), String(row.id)]),
          );
          for (const level of levels) {
            const existingId = byLevel.get(level.level);
            if (existingId) {
              await levelRepo.updateOne({
                filter: { id: existingId },
                values: {
                  title: level.title,
                  behaviors: level.behaviors,
                  updatedAt: now,
                },
              });
              byLevel.delete(level.level);
            } else {
              await levelRepo.createOne({
                values: {
                  id: newId(),
                  competencyId,
                  level: level.level,
                  title: level.title,
                  behaviors: level.behaviors,
                  createdAt: now,
                  updatedAt: now,
                },
              });
            }
          }
          for (const [, leftoverId] of byLevel)
            await levelRepo.deleteOne({ filter: { id: leftoverId } });
        } else if (id) {
          // Levels above the new ceiling cannot stay.
          const leftovers = await connection.query
            .selectFrom('competencyLevels')
            .select(['id'])
            .where('competencyId', '=', competencyId)
            .where('level', '>', maxLevel)
            .execute();
          for (const row of leftovers)
            await levelRepo.deleteOne({ filter: { id: String(row.id) } });
        }
        const allLevels = await loadLevels([competencyId], connection);
        return {
          ...toCompetency(saved),
          levels: allLevels.get(competencyId) ?? [],
        };
      });
    },

    async confirmCompetencies(ctx, ids) {
      const policies = await authorizeAction(ctx.authz, COMPETENCY, 'confirm');
      if (!ids.length) return;
      const repo = database
        .repository('competencies')
        .withPolicy(policyOf(policies, 'competencies'));
      const now = new Date();
      for (const id of ids) {
        await repo.updateOne({
          filter: { id },
          values: { reviewStatus: 'confirmed', updatedAt: now },
        });
        await recordDraftOutcome(
          database,
          'competency',
          id,
          'confirmed',
          ctx.userId,
        );
      }
    },

    async discardCompetencies(ctx, ids) {
      const policies = await authorizeAction(ctx.authz, COMPETENCY, 'confirm');
      if (!ids.length) return;
      // A confirmed requirement referencing a draft (added by hand) keeps it: discarding is refused.
      const inUse = await database
        .query()
        .selectFrom('positionRequirements')
        .select(['id', 'positionId', 'competencyId'])
        .where('competencyId', 'in', [...ids])
        .where('reviewStatus', '=', 'confirmed')
        .execute();
      if (inUse.length)
        throw new HrError('COMPETENCY_IN_USE', 409, {
          requirements: inUse.map((r) => ({
            positionId: String(r.positionId),
            competencyId: String(r.competencyId),
          })),
        });
      // A discarded competency takes its draft requirements with it.
      const requirements = await database
        .query()
        .selectFrom('positionRequirements')
        .select(['id'])
        .where('competencyId', 'in', [...ids])
        .where('reviewStatus', '=', 'draft')
        .execute();
      for (const requirement of requirements)
        await recordDraftOutcome(
          database,
          'positionRequirement',
          str(requirement.id),
          'discarded',
          ctx.userId,
        );
      for (const id of ids)
        await recordDraftOutcome(
          database,
          'competency',
          id,
          'discarded',
          ctx.userId,
        );
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('competencies')
          .withPolicy(policyOf(policies, 'competencies'));
        const levelRepo = connection
          .repository('competencyLevels')
          .withPolicy(policyOf(policies, 'competencyLevels'));
        for (const id of ids) {
          const row = await connection.query
            .selectFrom('competencies')
            .select(['reviewStatus'])
            .where('id', '=', id)
            .executeTakeFirst();
          if (!row) continue;
          if (row.reviewStatus !== 'draft')
            throw new HrError('COMPETENCY_NOT_DRAFT', 409);
          const requirements = await connection.query
            .selectFrom('positionRequirements')
            .select(['id'])
            .where('competencyId', '=', id)
            .execute();
          // A discarded draft takes its draft requirements with it; nothing confirmed can reference a draft.
          for (const requirement of requirements)
            await connection.query
              .deleteFrom('positionRequirements')
              .where('id', '=', String(requirement.id))
              .execute();
          const levels = await connection.query
            .selectFrom('competencyLevels')
            .select(['id'])
            .where('competencyId', '=', id)
            .execute();
          for (const level of levels)
            await levelRepo.deleteOne({ filter: { id: String(level.id) } });
          await repo.deleteOne({ filter: { id } });
        }
      });
    },

    async setCompetencyActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, COMPETENCY, 'manage');
      const { record } = await database
        .repository('competencies')
        .withPolicy(policyOf(policies, 'competencies'))
        .updateOne({
          filter: { id },
          values: { active, updatedAt: new Date() },
        });
      // Deactivating is allowed while confirmed requirements still reference it; the page shows how many.
      const confirmed = await database
        .query()
        .selectFrom('positionRequirements')
        .select(['id'])
        .where('competencyId', '=', id)
        .where('reviewStatus', '=', 'confirmed')
        .execute();
      return {
        ...toCompetency(record),
        confirmedRequirements: confirmed.length,
      };
    },

    async positionContext(ctx, positionId) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.frameworkAdvisor',
        'use',
      );
      const row = await database
        .repository('positions')
        .withPolicy(policyOf(policies, 'positions'))
        .findOne({ filter: { id: positionId } });
      if (!row) throw new HrError('POSITION_NOT_FOUND', 404);
      const position = toPosition(row);
      const family = await database
        .query()
        .selectFrom('jobFamilies')
        .select(['id', 'code', 'title', 'description', 'active', 'sortOrder'])
        .where('id', '=', position.jobFamilyId)
        .executeTakeFirst();
      const requirements = await database
        .query()
        .selectFrom('positionRequirements')
        .select([
          'id',
          'positionId',
          'competencyId',
          'requiredLevel',
          'mandatory',
          'source',
          'reviewStatus',
        ])
        .where('positionId', '=', positionId)
        .execute();
      const competencies = requirements.length
        ? await database
            .query()
            .selectFrom('competencies')
            .select(['id', 'code', 'title'])
            .where(
              'id',
              'in',
              requirements.map((r) => String(r.competencyId)),
            )
            .execute()
        : [];
      const byId = new Map(competencies.map((c) => [String(c.id), c]));
      return {
        position,
        jobFamily: family ? toJobFamily(family) : undefined,
        requirements: requirements.map((r) => {
          const requirement = toRequirement(r);
          const competency = byId.get(requirement.competencyId);
          return {
            ...requirement,
            competencyTitle: competency ? String(competency.title) : '',
            competencyCode: competency ? String(competency.code) : '',
          };
        }),
      };
    },

    async searchCompetencies(ctx, query) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.frameworkAdvisor',
        'use',
      );
      const rows = await database
        .repository('competencies')
        .withPolicy(policyOf(policies, 'competencies'))
        .findMany({ sort: (s) => [s.field('title').asc()] });
      const keyword = query.keyword?.trim().toLowerCase();
      return rows
        .map((r) => toCompetency(r as Record<string, unknown>))
        .filter((c) => c.active)
        .filter((c) => !query.category || c.category === query.category)
        .filter(
          (c) =>
            !keyword ||
            c.title.toLowerCase().includes(keyword) ||
            c.code.toLowerCase().includes(keyword) ||
            (c.description ?? '').toLowerCase().includes(keyword),
        )
        .slice(0, 50);
    },
  };

  return service;
}

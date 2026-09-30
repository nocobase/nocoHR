/**
 * V4-13 人才盘点与其他: what every service of the step receives from the
 * provider (index.ts, V4-13 block), and the trusted reads they share. Reads
 * here never decide access: each service authorizes its business action
 * first and uses these only for rows the action already covers, or for
 * non-sensitive facts (titles, names, dates).
 */
import { createHash } from 'node:crypto';

import type { NocoBaseDriveManager } from '@nocobase/drive';

import type { AIRunner } from '../ai-runner.js';
import type { AutomationService } from '../automation.js';
import type { CertificationService } from '../certification-service.js';
import type { CustomFieldService } from '../custom-fields.js';
import type { ActorContext } from '../framework-service.js';
import type { KnowledgeService } from '../knowledge-service.js';
import type { PlanService } from '../plan-service.js';
import { bool, json, type Platform } from '../platform.js';
import { HrError, newId, str } from '../shared.js';
import {
  readTalentReviewSettings,
  type TalentReviewSettings,
} from './config.js';

export { bool, json };

export interface TalentReviewDeps {
  readonly platform: Platform;
  readonly ai: AIRunner;
  readonly automation: () => AutomationService;
  readonly plans: () => PlanService;
  readonly certifications: () => CertificationService;
  readonly knowledge: () => KnowledgeService;
  readonly customFields: () => CustomFieldService;
  readonly drive: () => NocoBaseDriveManager;
  readonly hrAdministrators: () => Promise<string[]>;
  /** Runs work after the request answers; failures are logged. */
  readonly background: (label: string, run: () => Promise<unknown>) => void;
}

export interface EmployeeRow {
  id: string;
  employeeNo: string;
  name: string;
  userId: string | null;
  departmentId: string;
  positionId: string | null;
  status: string;
  hireDate: string | null;
}

export const day = (value: unknown): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return str(value).slice(0, 10);
};
export const iso = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(str(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};
export const num = (value: unknown): number | null =>
  value === null || value === undefined || value === ''
    ? null
    : Number.isFinite(Number(value))
      ? Number(value)
      : null;
export const hashOf = (value: unknown): string =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(value))
    .digest('hex');

export function createTalentReviewContext(deps: TalentReviewDeps) {
  const { platform } = deps;
  const { database } = platform;

  const context = {
    ...deps,
    database,
    today: () => platform.currentDate(),
    settings: async (): Promise<TalentReviewSettings> =>
      (await readTalentReviewSettings(database)).value,

    async employees(): Promise<Map<string, EmployeeRow>> {
      const rows = await database
        .query()
        .selectFrom('employees')
        .select([
          'id',
          'employeeNo',
          'name',
          'userId',
          'departmentId',
          'positionId',
          'status',
          'hireDate',
        ])
        .execute();
      return new Map(
        rows.map((row) => [
          str(row.id),
          {
            id: str(row.id),
            employeeNo: str(row.employeeNo),
            name: str(row.name),
            userId: row.userId ? str(row.userId) : null,
            departmentId: str(row.departmentId),
            positionId: row.positionId ? str(row.positionId) : null,
            status: str(row.status),
            hireDate: day(row.hireDate),
          },
        ]),
      );
    },

    async employee(id: string): Promise<EmployeeRow> {
      const employee = (await context.employees()).get(id);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      return employee;
    },

    async departmentTitles(): Promise<Map<string, string>> {
      const tree = await platform.organization.listTree();
      return new Map(
        tree.map((d) => [d.id, platform.organization.titleText(d.title)]),
      );
    },

    async positionTitles(): Promise<Map<string, string>> {
      const rows = await database
        .query()
        .selectFrom('positions')
        .select(['id', 'title'])
        .execute();
      return new Map(rows.map((r) => [str(r.id), str(r.title)]));
    },

    async competencyTitles(): Promise<Map<string, string>> {
      const rows = await database
        .query()
        .selectFrom('competencies')
        .select(['id', 'title'])
        .execute();
      return new Map(rows.map((r) => [str(r.id), str(r.title)]));
    },

    async userName(userId: string | null | undefined): Promise<string> {
      return (await platform.userName(userId)) ?? '';
    },

    /** The head an employee reports to (walking up; never the employee). */
    headOf: (employee: { departmentId: string; userId: string | null }) =>
      platform.headOf(employee),

    /** The latest assessment per competency for the given employees. */
    async currentLevels(
      employeeIds: readonly string[],
    ): Promise<Map<string, Map<string, number>>> {
      const result = new Map<string, Map<string, number>>();
      if (!employeeIds.length) return result;
      const rows = await database
        .query()
        .selectFrom('employeeCompetencies')
        .select(['employeeId', 'competencyId', 'level', 'assessedAt', 'createdAt'])
        .where('employeeId', 'in', [...new Set(employeeIds)])
        .execute();
      const sorted = [...rows].sort(
        (a, b) =>
          new Date(str(a.assessedAt)).getTime() -
            new Date(str(b.assessedAt)).getTime() ||
          new Date(str(a.createdAt)).getTime() -
            new Date(str(b.createdAt)).getTime(),
      );
      for (const row of sorted) {
        const map = result.get(str(row.employeeId)) ?? new Map<string, number>();
        map.set(str(row.competencyId), Number(row.level));
        result.set(str(row.employeeId), map);
      }
      return result;
    },

    /** A position's current (confirmed) requirements. */
    async requirementsOf(
      positionId: string,
    ): Promise<
      { competencyId: string; requiredLevel: number; mandatory: boolean }[]
    > {
      const rows = await database
        .query()
        .selectFrom('positionRequirements')
        .select(['competencyId', 'requiredLevel', 'mandatory'])
        .where('positionId', '=', positionId)
        .where('reviewStatus', '=', 'confirmed')
        .execute();
      return rows
        .map((r) => ({
          competencyId: str(r.competencyId),
          requiredLevel: Number(r.requiredLevel),
          mandatory: bool(r.mandatory),
        }))
        .sort((a, b) => a.competencyId.localeCompare(b.competencyId));
    },

    /** The final ratings of published review results, latest cycle first, per employee. */
    async latestRatings(
      employeeIds: readonly string[],
      cycleId?: string | null,
    ): Promise<Map<string, { rating: string; cycleId: string; cycleTitle: string }>> {
      const map = new Map<
        string,
        { rating: string; cycleId: string; cycleTitle: string }
      >();
      if (!employeeIds.length) return map;
      let query = database
        .query()
        .selectFrom('reviewResults')
        .innerJoin('reviewCycles', 'reviewCycles.id', 'reviewResults.cycleId')
        .select([
          'reviewResults.employeeId as employeeId',
          'reviewResults.finalRating as finalRating',
          'reviewResults.cycleId as cycleId',
          'reviewCycles.title as cycleTitle',
          'reviewCycles.periodEnd as periodEnd',
        ])
        .where('reviewResults.employeeId', 'in', [...new Set(employeeIds)])
        .where('reviewResults.publishedAt', 'is not', null)
        .where('reviewResults.finalRating', 'is not', null);
      if (cycleId) query = query.where('reviewResults.cycleId', '=', cycleId);
      const rows = await query.execute();
      const sorted = [...rows].sort((a, b) =>
        str(b.periodEnd).localeCompare(str(a.periodEnd)),
      );
      for (const row of sorted)
        if (!map.has(str(row.employeeId)))
          map.set(str(row.employeeId), {
            rating: str(row.finalRating),
            cycleId: str(row.cycleId),
            cycleTitle: str(row.cycleTitle),
          });
      return map;
    },

    /** Whether the caller holds an action (feature visibility, not access). */
    can: (ctx: ActorContext, resource: string, action: string) =>
      platform.can(ctx, resource, action),

    /** The owner of an automation (default: the first HR administrator). */
    async automationOwner(key: string): Promise<string | null> {
      const row = await database
        .query()
        .selectFrom('aiAutomationSettings')
        .select(['ownerUserId'])
        .where('id', '=', key)
        .executeTakeFirst();
      if (row?.ownerUserId) return str(row.ownerUserId);
      return (await deps.hrAdministrators())[0] ?? null;
    },

    /** The to-dos of a reference close once handled. */
    async closeWorkItems(refPrefix: string): Promise<void> {
      const now = new Date();
      await database
        .query()
        .updateTable('workItems')
        .set({ status: 'done', doneAt: now, updatedAt: now })
        .where('refId', 'like', `${refPrefix}%`)
        .where('status', '=', 'open')
        .execute()
        .catch(() => undefined);
    },

    /** Writes generated text to the default drive and the file collection; answers the file id. */
    async storeTextFile(name: string, text: string): Promise<string> {
      const id = newId();
      const bytes = new TextEncoder().encode(text);
      const safe = name.replace(/[^\w.\-一-龥]/gu, '_').slice(-120);
      // Drive keys are ASCII: the readable name stays in `filename`.
      const key = `hr-files/talent-review/${new Date().toISOString().slice(0, 7)}/${id}.md`;
      await deps.drive().use('local').put(key, bytes);
      const now = new Date();
      await database
        .query()
        .insertInto('hrFiles')
        .values({
          id,
          disk: 'local',
          key,
          filename: safe,
          ext: 'md',
          mimeType: 'text/markdown',
          size: bytes.byteLength,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return id;
    },
  };
  return context;
}

export type TalentReviewContext = ReturnType<typeof createTalentReviewContext>;

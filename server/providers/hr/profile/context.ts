/**
 * V3-11: what the profile services share — their dependencies and the plain
 * reads several of them repeat (people, levels, requirements, certificates).
 * Reads here are rule inputs, never authorization: every service authorizes
 * the caller first and filters with the policies it gets back.
 */
import type { UserAdministrationService } from '@nocobase/app-plugin-authentication';
import type { NocoBaseDriveManager } from '@nocobase/drive';
import type { ServiceContainer } from '@nocobase/service-provider';

import type { AIRunner } from '../ai-runner.js';
import type { AutomationService } from '../automation.js';
import type { CompetencyService } from '../competency-service.js';
import type { CustomFieldService } from '../custom-fields.js';
import type { InsightService } from '../insight-service.js';
import { json, type Platform } from '../platform.js';
import type { RevisionService } from '../revision-service.js';
import { newId, str } from '../shared.js';

export interface ProfileConfig {
  readonly writebackUrl: string;
  readonly writebackSecret: string;
  /** Origin for links sent to other systems, such as https://hr.example.com; empty for relative links. */
  readonly publicOrigin: string;
  /** The application's mount path, such as /main. */
  readonly basePath: string;
}

export interface ProfileDeps {
  readonly container: ServiceContainer;
  readonly platform: Platform;
  readonly ai: AIRunner;
  readonly drive: () => NocoBaseDriveManager;
  readonly users: () => UserAdministrationService;
  readonly customFields: () => CustomFieldService;
  readonly competency: () => CompetencyService;
  readonly automation: () => AutomationService;
  readonly revisions: () => RevisionService;
  readonly insights: () => InsightService;
  readonly departmentTitle: (id: string) => Promise<string>;
  readonly config: () => ProfileConfig;
  readonly background: (label: string, run: () => Promise<unknown>) => void;
  readonly warn: (detail: Record<string, unknown>, message: string) => void;
}

export function iso(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(str(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export function dateOnly(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return str(value).slice(0, 10);
}
export const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

/**
 * Whether a stored datetime is at or after `since`. Compared in code: SQLite
 * keeps datetimes as text, and a bound Date does not compare with text.
 */
export function onOrAfter(value: unknown, since: Date): boolean {
  const at = iso(value);
  return at !== null && new Date(at).getTime() >= since.getTime();
}

/** The instant `days` days before now. */
export function daysBefore(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

export interface PersonRow {
  readonly id: string;
  readonly employeeNo: string;
  readonly name: string;
  readonly userId: string | null;
  readonly departmentId: string;
  readonly positionId: string | null;
  readonly status: string;
  readonly hireDate: string | null;
}

export function toPerson(row: Record<string, unknown>): PersonRow {
  return {
    id: str(row.id),
    employeeNo: str(row.employeeNo ?? ''),
    name: str(row.name),
    userId: nullable(row.userId),
    departmentId: str(row.departmentId),
    positionId: nullable(row.positionId),
    status: str(row.status),
    hireDate: dateOnly(row.hireDate),
  };
}

export const PERSON_COLUMNS = [
  'id',
  'employeeNo',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'status',
  'hireDate',
] as const;

/** 在职: everyone who has not left. */
export const isActive = (person: { status: string }): boolean =>
  person.status !== 'leave';

export interface LevelRow {
  readonly level: number;
  readonly assessedAt: string | null;
  readonly assessedBy: string | null;
  readonly id: string;
}

export function createProfileReads(platform: Platform) {
  const { database } = platform;

  return {
    async people(ids?: readonly string[]): Promise<PersonRow[]> {
      let q = database
        .query()
        .selectFrom('employees')
        .select([...PERSON_COLUMNS]);
      if (ids) {
        if (!ids.length) return [];
        q = q.where('id', 'in', [...ids]);
      }
      return (await q.execute()).map(toPerson);
    },

    /** The latest assessment of each employee and competency. */
    async levels(
      employeeIds: readonly string[],
    ): Promise<Map<string, Map<string, LevelRow>>> {
      const result = new Map<string, Map<string, LevelRow>>();
      if (!employeeIds.length) return result;
      const rows = await database
        .query()
        .selectFrom('employeeCompetencies')
        .select([
          'id',
          'employeeId',
          'competencyId',
          'level',
          'assessedAt',
          'assessedBy',
          'createdAt',
        ])
        .where('employeeId', 'in', [...employeeIds])
        .execute();
      const sorted = [...rows].sort((a, b) =>
        `${iso(a.assessedAt) ?? ''}${iso(a.createdAt) ?? ''}`.localeCompare(
          `${iso(b.assessedAt) ?? ''}${iso(b.createdAt) ?? ''}`,
        ),
      );
      for (const row of sorted) {
        const employee = str(row.employeeId);
        const map = result.get(employee) ?? new Map<string, LevelRow>();
        map.set(str(row.competencyId), {
          id: str(row.id),
          level: Number(row.level) || 0,
          assessedAt: iso(row.assessedAt),
          assessedBy: nullable(row.assessedBy),
        });
        result.set(employee, map);
      }
      return result;
    },

    /** Confirmed requirements by position. */
    async requirements(): Promise<
      Map<
        string,
        { competencyId: string; requiredLevel: number; mandatory: boolean }[]
      >
    > {
      const rows = await database
        .query()
        .selectFrom('positionRequirements')
        .select(['positionId', 'competencyId', 'requiredLevel', 'mandatory'])
        .where('reviewStatus', '=', 'confirmed')
        .execute();
      const map = new Map<
        string,
        { competencyId: string; requiredLevel: number; mandatory: boolean }[]
      >();
      for (const row of rows)
        map.set(str(row.positionId), [
          ...(map.get(str(row.positionId)) ?? []),
          {
            competencyId: str(row.competencyId),
            requiredLevel: Number(row.requiredLevel) || 0,
            mandatory: row.mandatory === true || row.mandatory === 1,
          },
        ]);
      return map;
    },

    async competencies(): Promise<
      Map<
        string,
        {
          id: string;
          code: string;
          title: string;
          description: string;
          category: string;
          maxLevel: number;
          active: boolean;
          confirmed: boolean;
        }
      >
    > {
      const rows = await database
        .query()
        .selectFrom('competencies')
        .select([
          'id',
          'code',
          'title',
          'description',
          'category',
          'maxLevel',
          'active',
          'reviewStatus',
        ])
        .execute();
      return new Map(
        rows.map((row) => [
          str(row.id),
          {
            id: str(row.id),
            code: str(row.code ?? ''),
            title: str(row.title),
            description: str(row.description ?? ''),
            category: str(row.category ?? ''),
            maxLevel: Number(row.maxLevel) || 5,
            active: row.active === true || row.active === 1,
            confirmed: row.reviewStatus === 'confirmed',
          },
        ]),
      );
    },

    async positions(): Promise<Map<string, string>> {
      const rows = await database
        .query()
        .selectFrom('positions')
        .select(['id', 'title'])
        .execute();
      return new Map(rows.map((r) => [str(r.id), str(r.title)]));
    },

    /**
     * Certifications a position requires: its mandatory confirmed
     * qualification requirements a certification proves (insight service rule).
     */
    async requiredCertifications(): Promise<
      Map<string, { id: string; title: string; competencyId: string }[]>
    > {
      const query = database.query();
      const requirements = await query
        .selectFrom('positionRequirements')
        .innerJoin(
          'competencies',
          'competencies.id',
          'positionRequirements.competencyId',
        )
        .select([
          'positionRequirements.positionId as positionId',
          'positionRequirements.competencyId as competencyId',
        ])
        .where('positionRequirements.mandatory', '=', true)
        .where('positionRequirements.reviewStatus', '=', 'confirmed')
        .where('competencies.category', '=', 'qualification')
        .execute();
      const certifications = await query
        .selectFrom('certifications')
        .select(['id', 'title', 'competencyId'])
        .where('active', '=', true)
        .execute();
      const map = new Map<
        string,
        { id: string; title: string; competencyId: string }[]
      >();
      for (const requirement of requirements)
        for (const certification of certifications)
          if (str(certification.competencyId) === str(requirement.competencyId))
            map.set(str(requirement.positionId), [
              ...(map.get(str(requirement.positionId)) ?? []),
              {
                id: str(certification.id),
                title: str(certification.title),
                competencyId: str(requirement.competencyId),
              },
            ]);
      return map;
    },

    /** Every certificate of the employees, newest issue first. */
    async certificates(employeeIds: readonly string[]): Promise<
      {
        id: string;
        employeeId: string;
        certificationId: string;
        certificateNo: string;
        issuedAt: string | null;
        expiresAt: string | null;
        status: string;
        revokedReason: string | null;
        updatedAt: string | null;
      }[]
    > {
      if (!employeeIds.length) return [];
      const rows = await database
        .query()
        .selectFrom('employeeCertificates')
        .select([
          'id',
          'employeeId',
          'certificationId',
          'certificateNo',
          'issuedAt',
          'expiresAt',
          'status',
          'revokedReason',
          'updatedAt',
        ])
        .where('employeeId', 'in', [...employeeIds])
        .execute();
      return rows
        .map((row) => ({
          id: str(row.id),
          employeeId: str(row.employeeId),
          certificationId: str(row.certificationId),
          certificateNo: str(row.certificateNo),
          issuedAt: dateOnly(row.issuedAt),
          expiresAt: dateOnly(row.expiresAt),
          status: str(row.status),
          revokedReason: nullable(row.revokedReason),
          updatedAt: iso(row.updatedAt),
        }))
        .sort((a, b) => (b.issuedAt ?? '').localeCompare(a.issuedAt ?? ''));
    },

    /** Competencies an exam's questions assess. */
    async examCompetencies(): Promise<Map<string, Set<string>>> {
      const rows = await database
        .query()
        .selectFrom('examQuestions')
        .innerJoin(
          'questionCompetencies',
          'questionCompetencies.questionId',
          'examQuestions.questionId',
        )
        .select([
          'examQuestions.examId as examId',
          'questionCompetencies.competencyId as competencyId',
        ])
        .execute();
      const map = new Map<string, Set<string>>();
      for (const row of rows)
        map.set(
          str(row.examId),
          (map.get(str(row.examId)) ?? new Set()).add(str(row.competencyId)),
        );
      // A random paper draws by competency.
      for (const exam of await database
        .query()
        .selectFrom('exams')
        .select(['id', 'randomRules'])
        .execute())
        for (const rule of json<{ competencyId?: string | null }[]>(
          exam.randomRules,
          [],
        ))
          if (rule?.competencyId)
            map.set(
              str(exam.id),
              (map.get(str(exam.id)) ?? new Set()).add(str(rule.competencyId)),
            );
      // An exam behind a certification also assesses the certification's competency.
      const certified = await database
        .query()
        .selectFrom('certificationExams')
        .innerJoin(
          'certifications',
          'certifications.id',
          'certificationExams.certificationId',
        )
        .select([
          'certificationExams.examId as examId',
          'certifications.competencyId as competencyId',
        ])
        .execute();
      for (const row of certified)
        if (row.competencyId)
          map.set(
            str(row.examId),
            (map.get(str(row.examId)) ?? new Set()).add(str(row.competencyId)),
          );
      return map;
    },

    /** An attempt's score as a percentage of the paper's total. */
    attemptPercent(row: Record<string, unknown>): number | null {
      if (row.score === null || row.score === undefined) return null;
      const score = Number(row.score);
      const paper = json<{ items?: { score?: number }[] } | unknown[]>(
        row.paperSnapshot,
        [],
      );
      const items = Array.isArray(paper)
        ? (paper as { score?: number }[])
        : (paper.items ?? []);
      const total = items.reduce(
        (sum, item) => sum + (Number(item.score) || 0),
        0,
      );
      return total > 0 ? Math.round((score / total) * 1000) / 10 : score;
    },

    /** Records what a person did with something an automation drafted (adoption rate). */
    async recordOutcome(
      entityType: string,
      entityId: string,
      outcome: 'adopted' | 'modified' | 'discarded',
      userId: string,
    ): Promise<void> {
      const item = await database
        .query()
        .selectFrom('aiTaskRunItems')
        .select(['id', 'outcome'])
        .where('entityType', '=', entityType)
        .where('entityId', '=', entityId)
        .executeTakeFirst();
      if (!item || str(item.outcome) !== 'pending') return;
      const now = new Date();
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
    },

    /** Writes generated bytes to the default drive and the file collection; answers the file id. */
    async storeFile(
      drive: NocoBaseDriveManager,
      file: {
        folder: string;
        name: string;
        bytes: Uint8Array;
        mimeType: string;
      },
    ): Promise<string> {
      const id = newId();
      const safe = file.name.replace(/[^\w.\-一-龥]/gu, '_').slice(-120);
      const ext = safe.includes('.')
        ? safe
            .split('.')
            .pop()!
            .replace(/[^A-Za-z0-9]/gu, '')
            .slice(0, 16)
        : '';
      // The storage key stays ASCII (the drive refuses other characters); the original name is kept in the row.
      const key = `${file.folder}/${new Date().toISOString().slice(0, 7)}/${id}${ext ? `.${ext}` : ''}`;
      await drive.use('local').put(key, file.bytes);
      const now = new Date();
      await database
        .query()
        .insertInto('hrFiles')
        .values({
          id,
          disk: 'local',
          key,
          filename: safe,
          ext: safe.includes('.') ? safe.split('.').pop()!.slice(0, 32) : '',
          mimeType: file.mimeType,
          size: file.bytes.byteLength,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return id;
    },

    async readFile(
      drive: NocoBaseDriveManager,
      fileId: string,
    ): Promise<
      { bytes: Uint8Array; filename: string; mimeType: string } | undefined
    > {
      const row = await database
        .query()
        .selectFrom('hrFiles')
        .select(['disk', 'key', 'filename', 'mimeType'])
        .where('id', '=', fileId)
        .executeTakeFirst();
      if (!row) return undefined;
      const bytes = await drive.use(str(row.disk)).getBytes(str(row.key));
      return {
        bytes,
        filename: str(row.filename),
        mimeType: str(row.mimeType),
      };
    },
  };
}

export type ProfileReads = ReturnType<typeof createProfileReads>;

/**
 * V3-10 application settings that administrators adjust on the exam and
 * certification pages rather than in the configuration file:
 *
 * - `examRules`: the "考试 → 能力等级规则" — the share of a paper's points a
 *   competency must carry before an exam writes its level, and the two
 *   score rates that give the required level and the level below it.
 * - `licensedOperation`: the V4-14 industry pack switch (持证上岗). Off, a
 *   certificate means only "held and valid": the certification subject has no
 *   members and notices never mention permissions. The demo seed turns it on
 *   so the machine-start demonstration keeps working.
 *
 * Both live as rows of `personnelSettings`, next to the AI entry's `aiEntry`
 * row, under ids the personnel settings sections do not use. Reads fall back
 * to the defaults; a write is a compare-and-set on the row's revision.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { authorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { HrError } from './shared.js';

const rulesSchema = z
  .object({
    minWeight: z.number().min(0).max(1),
    fullRate: z.number().min(0).max(1),
    partialRate: z.number().min(0).max(1),
  })
  .strict()
  .refine((v) => v.partialRate <= v.fullRate);
const licensedSchema = z.object({ enabled: z.boolean() }).strict();

export type ExamRules = z.infer<typeof rulesSchema>;
export interface LicensedOperation {
  readonly enabled: boolean;
}

const SECTIONS = {
  examRules: { id: 'examRules', schema: rulesSchema },
  licensedOperation: { id: 'licensedOperation', schema: licensedSchema },
} as const;
export type ExamSettingsSection = keyof typeof SECTIONS;

export interface ExamSettingsService {
  rules(): Promise<ExamRules>;
  licensedOperation(): Promise<LicensedOperation>;
  get(ctx: ActorContext): Promise<{
    examRules: { value: ExamRules; revision: number };
    licensedOperation: { value: LicensedOperation; revision: number };
  }>;
  update(
    ctx: ActorContext,
    section: string,
    input: unknown,
  ): Promise<{ value: unknown; revision: number }>;
}

export function createExamSettingsService(deps: {
  readonly database: DatabaseManager;
  /** The configuration file's `talent.examCompetency`, the default until an administrator saves one. */
  readonly defaultRules: () => ExamRules;
  /** Called after the industry pack switch changes: holders' sessions are refreshed. */
  readonly onLicensedOperationChanged?: () => Promise<void>;
}): ExamSettingsService {
  const { database } = deps;

  async function read(
    section: ExamSettingsSection,
  ): Promise<{ value: unknown; revision: number }> {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', SECTIONS[section].id)
      .executeTakeFirst();
    let stored: unknown = row?.value;
    for (let i = 0; i < 3 && typeof stored === 'string'; i += 1) {
      try {
        stored = JSON.parse(stored);
      } catch {
        stored = undefined;
      }
    }
    const fallback =
      section === 'examRules' ? deps.defaultRules() : { enabled: false };
    const parsed = SECTIONS[section].schema.safeParse(stored);
    return {
      value: parsed.success ? parsed.data : fallback,
      revision: Number(row?.revision ?? 0),
    };
  }

  const service: ExamSettingsService = {
    async rules() {
      return (await read('examRules')).value as ExamRules;
    },
    async licensedOperation() {
      return (await read('licensedOperation')).value as LicensedOperation;
    },
    async get(ctx) {
      await authorizeAction(ctx.authz, 'talent.exam', 'view');
      return {
        examRules: (await read('examRules')) as {
          value: ExamRules;
          revision: number;
        },
        licensedOperation: (await read('licensedOperation')) as {
          value: LicensedOperation;
          revision: number;
        },
      };
    },
    async update(ctx, section, input) {
      if (!(section in SECTIONS)) throw new HrError('INVALID_INPUT', 400);
      const key = section as ExamSettingsSection;
      // The competency rule belongs to exam administration; the industry pack switch to certification administration.
      if (key === 'examRules')
        await authorizeAction(ctx.authz, 'talent.exam', 'configure');
      else await authorizeAction(ctx.authz, 'talent.certification', 'manage');
      const body = z
        .object({
          revision: z.number().int().min(0),
          value: SECTIONS[key].schema,
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const current = await read(key);
      if (current.revision !== body.data.revision)
        throw new HrError('SETTINGS_CONFLICT', 409);
      const stamp = new Date();
      const id = SECTIONS[key].id;
      const exists = await database
        .query()
        .selectFrom('personnelSettings')
        .select(['id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (exists) {
        const result = await database
          .query()
          .updateTable('personnelSettings')
          .set({
            value: body.data.value,
            revision: current.revision + 1,
            updatedBy: ctx.userId,
            updatedAt: stamp,
          })
          .where('id', '=', id)
          .where('revision', '=', current.revision)
          .execute();
        if (!Number(result.updatedCount ?? 0))
          throw new HrError('SETTINGS_CONFLICT', 409);
      } else {
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id,
            value: body.data.value,
            revision: 1,
            updatedBy: ctx.userId,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      }
      if (
        key === 'licensedOperation' &&
        (current.value as LicensedOperation).enabled !==
          (body.data.value as LicensedOperation).enabled
      )
        await deps.onLicensedOperationChanged?.();
      return { value: body.data.value, revision: current.revision + 1 };
    },
  };
  return service;
}

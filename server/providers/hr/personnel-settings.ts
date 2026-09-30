import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { ActorContext } from './framework-service.js';
import { HrError } from './shared.js';

export const PERSONNEL_SETTINGS_AUTH = {
  resource: { type: 'settings', id: 'talent.hr' },
  action: 'administer',
} as const;

/** The action types a chain rule may name; kept here so the settings do not import the core service. */
export const CHAIN_ACTION_TYPES = [
  'onboard',
  'regularize',
  'transfer',
  'promote',
  'offboard',
] as const;
/** The fields an employee may be allowed to change through self-service. */
export const SELF_SERVICE_FIELDS = [
  'mobile',
  'email',
  'address',
  'educations',
  'experiences',
  'emergencyContacts',
] as const;

const reminderSchema = z
  .object({
    probationDays: z.number().int().min(0).max(365),
    contractDays: z
      .array(z.number().int().min(0).max(365))
      .min(1)
      .max(12)
      .refine((days) => new Set(days).size === days.length),
    // The daily task's time of day in the application's time zone. Stored rows
    // from before this field existed read as the documented default.
    dailyTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u)
      .default('09:00'),
  })
  .strict();
const probationSchema = z
  .object({ maxMonths: z.number().int().min(0).max(6) })
  .strict();
const approverSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('departmentHead'),
      departmentId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({ type: z.literal('user'), userId: z.string().min(1).max(64) })
    .strict(),
  z
    .object({
      type: z.literal('permissionSet'),
      key: z.string().min(1).max(128),
    })
    .strict(),
]);
const chainRuleSchema = z
  .object({
    id: z.string().min(1).max(64),
    departmentId: z.string().min(1).max(64),
    actionTypes: z
      .array(z.enum(CHAIN_ACTION_TYPES))
      .min(1)
      .refine((types) => new Set(types).size === types.length),
    name: z.string().trim().min(1).max(60),
    approver: approverSchema,
    position: z.enum(['afterFirst', 'afterHr']),
    enabled: z.boolean(),
  })
  .strict();
const approvalChainSchema = z
  .object({
    // Order is the rule's sequence number: matching rules insert in this order.
    rules: z
      .array(chainRuleSchema)
      .max(50)
      .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length),
    mergeAdjacent: z.boolean(),
  })
  .strict();
const selfServiceSchema = z
  .object({
    fields: z
      .array(z.enum(SELF_SERVICE_FIELDS))
      .refine((fields) => new Set(fields).size === fields.length),
  })
  .strict();
const gradeOrderSchema = z
  .object({
    // jobFamilyId -> grades from lowest to highest. A family without an entry
    // compares its grades in natural order (S1 < S2 < S3 < S4).
    families: z.record(
      z.string().min(1).max(64),
      z
        .array(z.string().trim().min(1).max(32))
        .max(30)
        .refine((grades) => new Set(grades).size === grades.length),
    ),
  })
  .strict();
// V1-04 制度知识库 复核: advance notice, overdue reminder interval, default review cycle.
const knowledgeSchema = z
  .object({
    reviewNoticeDays: z.number().int().min(1).max(180),
    overdueIntervalDays: z.number().int().min(1).max(60),
    defaultReviewMonths: z.number().int().min(1).max(60),
  })
  .strict();
// V1-02 变动影响清单: which kinds get a checklist, and how often an overdue one reminds its owner.
const checklistsSchema = z
  .object({
    onboard: z.boolean(),
    change: z.boolean(),
    offboard: z.boolean(),
    reminderIntervalDays: z.number().int().min(1).max(30),
  })
  .strict();
// V1-02 用工合规检查: each check can be switched off; the thresholds follow the Labour Contract Law by default.
const complianceSchema = z
  .object({
    enabled: z.boolean(),
    checks: z
      .object({
        secondFixedTerm: z.boolean(),
        probationLimit: z.boolean(),
        noContract: z.boolean(),
        expiredContract: z.boolean(),
      })
      .strict(),
    noContractDays: z.number().int().min(1).max(120),
    // Longest probation, in months, by the contract's term (第十九条).
    probationLimits: z
      .object({
        underThreeMonths: z.number().int().min(0).max(6),
        underOneYear: z.number().int().min(0).max(6),
        underThreeYears: z.number().int().min(0).max(6),
        threeYearsOrOpen: z.number().int().min(0).max(6),
      })
      .strict(),
  })
  .strict();
const jobInfoSchema = z
  .object({
    importMayChangeJob: z.boolean(),
    allowCorrection: z.boolean(),
  })
  .strict();

const schemas = {
  reminders: reminderSchema,
  probation: probationSchema,
  approvalChain: approvalChainSchema,
  selfService: selfServiceSchema,
  gradeOrder: gradeOrderSchema,
  jobInfo: jobInfoSchema,
  knowledge: knowledgeSchema,
  checklists: checklistsSchema,
  compliance: complianceSchema,
};
export const PERSONNEL_SECTIONS = Object.keys(schemas) as PersonnelSection[];
/** Checks a whole section value; used when a draft is built from a partial change. */
export function parseSection<K extends PersonnelSection>(
  section: K,
  value: unknown,
): PersonnelSettings[K] | undefined {
  const parsed = schemas[section].safeParse(value);
  return parsed.success ? (parsed.data as PersonnelSettings[K]) : undefined;
}
export const CHAIN_RULE_SCHEMA = chainRuleSchema;
export type PersonnelSection = keyof typeof schemas;
export type ChainRule = z.infer<typeof chainRuleSchema>;
export interface PersonnelSettings {
  reminders: z.infer<typeof reminderSchema>;
  probation: z.infer<typeof probationSchema>;
  approvalChain: z.infer<typeof approvalChainSchema>;
  selfService: z.infer<typeof selfServiceSchema>;
  gradeOrder: z.infer<typeof gradeOrderSchema>;
  jobInfo: z.infer<typeof jobInfoSchema>;
  knowledge: z.infer<typeof knowledgeSchema>;
  checklists: z.infer<typeof checklistsSchema>;
  compliance: z.infer<typeof complianceSchema>;
}
const defaults: PersonnelSettings = {
  reminders: { probationDays: 15, contractDays: [60, 30], dailyTime: '09:00' },
  probation: { maxMonths: 6 },
  approvalChain: { rules: [], mergeAdjacent: true },
  selfService: { fields: [...SELF_SERVICE_FIELDS] },
  gradeOrder: { families: {} },
  jobInfo: { importMayChangeJob: true, allowCorrection: true },
  knowledge: {
    reviewNoticeDays: 30,
    overdueIntervalDays: 7,
    defaultReviewMonths: 12,
  },
  checklists: {
    onboard: true,
    change: true,
    offboard: true,
    reminderIntervalDays: 1,
  },
  compliance: {
    enabled: true,
    checks: {
      secondFixedTerm: true,
      probationLimit: true,
      noContract: true,
      expiredContract: true,
    },
    noContractDays: 30,
    probationLimits: {
      underThreeMonths: 0,
      underOneYear: 1,
      underThreeYears: 2,
      threeYearsOrOpen: 6,
    },
  },
};
export interface SettingsSection<T> {
  value: T;
  revision: number;
}

export function createPersonnelSettingsService(database: DatabaseManager) {
  async function read<K extends PersonnelSection>(
    section: K,
  ): Promise<SettingsSection<PersonnelSettings[K]>> {
    const row = await database
      .repository('personnelSettings')
      .findOne({ filter: { id: section } });
    const parsed = schemas[section].parse(
      row?.value ?? defaults[section],
    ) as PersonnelSettings[K];
    return { value: parsed, revision: Number(row?.revision ?? 0) };
  }
  async function readAll(): Promise<{
    [K in PersonnelSection]: SettingsSection<PersonnelSettings[K]>;
  }> {
    return {
      reminders: await read('reminders'),
      probation: await read('probation'),
      approvalChain: await read('approvalChain'),
      selfService: await read('selfService'),
      gradeOrder: await read('gradeOrder'),
      jobInfo: await read('jobInfo'),
      knowledge: await read('knowledge'),
      checklists: await read('checklists'),
      compliance: await read('compliance'),
    };
  }
  return {
    // Internal business reads use the same persisted configuration as the admin API.
    read,
    async get(ctx: ActorContext) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      return readAll();
    },
    async update(
      ctx: ActorContext,
      section: string,
      input: unknown,
      validate?: (
        section: PersonnelSection,
        value: unknown,
      ) => Promise<void> | void,
    ) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      if (!(PERSONNEL_SECTIONS as string[]).includes(section))
        throw new HrError('INVALID_INPUT');
      const key = section as PersonnelSection;
      const body = z
        .object({ revision: z.number().int().min(0), value: schemas[key] })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT');
      // References (departments, users, permission sets, job families) are checked by the caller.
      await validate?.(key, body.data.value);
      return database.transaction(async (connection) => {
        const repo = connection.repository('personnelSettings');
        const previous = await repo.findOne({ filter: { id: key } });
        const revision = Number(previous?.revision ?? 0);
        if (revision !== body.data.revision)
          throw new HrError('SETTINGS_CONFLICT', 409);
        const stamp = new Date();
        const value = body.data.value;
        if (previous) {
          // Include the version in the predicate so concurrent editors cannot silently overwrite one another.
          await repo.updateOne({
            filter: { id: key, revision },
            values: {
              value,
              revision: revision + 1,
              updatedBy: ctx.userId,
              updatedAt: stamp,
            },
          });
        } else {
          await repo.createOne({
            values: {
              id: key,
              value,
              revision: 1,
              updatedBy: ctx.userId,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        }
        return { value, revision: revision + 1 };
      });
    },
  };
}

export type PersonnelSettingsService = ReturnType<
  typeof createPersonnelSettingsService
>;

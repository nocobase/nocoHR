import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { ActorContext } from './framework-service.js';
import { HrError } from './shared.js';

export const PERSONNEL_SETTINGS_AUTH = {
  resource: { type: 'settings', id: 'talent.hr' },
  action: 'administer',
} as const;

const reminderSchema = z
  .object({
    probationDays: z.number().int().min(0).max(365),
    contractDays: z
      .array(z.number().int().min(0).max(365))
      .min(1)
      .max(12)
      .refine((days) => new Set(days).size === days.length),
  })
  .strict();
const probationSchema = z
  .object({ maxMonths: z.number().int().min(0).max(6) })
  .strict();
const schemas = { reminders: reminderSchema, probation: probationSchema };
export type PersonnelSection = keyof typeof schemas;
export interface PersonnelSettings {
  reminders: z.infer<typeof reminderSchema>;
  probation: z.infer<typeof probationSchema>;
}
const defaults: PersonnelSettings = {
  reminders: { probationDays: 15, contractDays: [60, 30] },
  probation: { maxMonths: 6 },
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
  return {
    // Internal business reads use the same persisted configuration as the admin API.
    read,
    async get(ctx: ActorContext) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      return {
        reminders: await read('reminders'),
        probation: await read('probation'),
      };
    },
    async update(ctx: ActorContext, section: string, input: unknown) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      if (section !== 'reminders' && section !== 'probation')
        throw new HrError('INVALID_INPUT');
      const body = z
        .object({ revision: z.number().int().min(0), value: schemas[section] })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT');
      return database.transaction(async (connection) => {
        const repo = connection.repository('personnelSettings');
        const previous = await repo.findOne({ filter: { id: section } });
        const revision = Number(previous?.revision ?? 0);
        if (revision !== body.data.revision)
          throw new HrError('SETTINGS_CONFLICT', 409);
        const stamp = new Date();
        const value = body.data.value;
        if (previous) {
          // Include the version in the predicate so concurrent editors cannot silently overwrite one another.
          await repo.updateOne({
            filter: { id: section, revision },
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
              id: section,
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

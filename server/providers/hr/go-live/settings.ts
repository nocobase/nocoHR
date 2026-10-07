/**
 * 上线准备's two stored values, each its own personnelSettings row with a
 * revision (like the 人事设置 sections and the `mail` row):
 *
 * - `goLive`: the steps marked as not needed (`skipped`) and the first payroll
 *   month (`firstPayrollMonth`, YYYY-MM; empty: the earliest payroll cycle,
 *   else the current month), which decides whether 本年个税累计期初 applies.
 * - `accountActivation`: how many days an activation link lasts (default 7).
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { HrError } from '../shared.js';

export const GO_LIVE_STEPS = [
  'config',
  'departments',
  'positions',
  'employees',
  'contracts',
  'leaveOpening',
  'salaries',
  'insurance',
  'deductions',
  'taxOpening',
  'accounts',
  'trialPayroll',
] as const;
export type GoLiveStepKey = (typeof GO_LIVE_STEPS)[number];
/** Steps only payroll may see as their own and mark as not needed. */
export const PAYROLL_STEPS: ReadonlySet<GoLiveStepKey> = new Set([
  'salaries',
  'insurance',
  'deductions',
  'taxOpening',
  'trialPayroll',
]);

const goLiveSchema = z
  .object({
    skipped: z
      .array(z.enum(GO_LIVE_STEPS))
      .max(GO_LIVE_STEPS.length)
      .refine((keys) => new Set(keys).size === keys.length),
    firstPayrollMonth: z.union([
      z.literal(''),
      z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u),
    ]),
  })
  .strict();
const activationSchema = z
  .object({ linkDays: z.number().int().min(1).max(30) })
  .strict();

export type GoLiveSettings = z.infer<typeof goLiveSchema>;
export type ActivationSettings = z.infer<typeof activationSchema>;

const schemas = { goLive: goLiveSchema, accountActivation: activationSchema };
const defaults = {
  goLive: { skipped: [], firstPayrollMonth: '' } as GoLiveSettings,
  accountActivation: { linkDays: 7 },
};
type Row = keyof typeof schemas;
type ValueOf<K extends Row> = K extends 'goLive'
  ? GoLiveSettings
  : ActivationSettings;

export function createGoLiveSettings(database: DatabaseManager) {
  async function read<K extends Row>(
    id: K,
  ): Promise<{ value: ValueOf<K>; revision: number }> {
    const row = await database
      .repository('personnelSettings')
      .findOne({ filter: { id } });
    const parsed = schemas[id].safeParse(row?.value ?? defaults[id]);
    return {
      value: (parsed.success ? parsed.data : defaults[id]) as ValueOf<K>,
      revision: Number(row?.revision ?? 0),
    };
  }

  /** Writes a whole row when `revision` is still the stored one; the caller has authorized. */
  async function write<K extends Row>(
    id: K,
    revision: number,
    value: unknown,
    userId: string,
  ): Promise<{ value: ValueOf<K>; revision: number }> {
    const parsed = schemas[id].safeParse(value);
    if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
    return database.transaction(async (connection) => {
      const repo = connection.repository('personnelSettings');
      const previous = await repo.findOne({ filter: { id } });
      const current = Number(previous?.revision ?? 0);
      if (current !== revision) throw new HrError('SETTINGS_CONFLICT', 409);
      const stamp = new Date();
      if (previous)
        // The revision in the predicate keeps concurrent editors from overwriting one another.
        await repo.updateOne({
          filter: { id, revision: current },
          values: {
            value: { ...parsed.data },
            revision: current + 1,
            updatedBy: userId,
            updatedAt: stamp,
          },
        });
      else
        await repo.createOne({
          values: {
            id,
            value: { ...parsed.data },
            revision: 1,
            updatedBy: userId,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      return { value: parsed.data as ValueOf<K>, revision: current + 1 };
    });
  }

  return { read, write };
}

export type GoLiveSettingsStore = ReturnType<typeof createGoLiveSettings>;

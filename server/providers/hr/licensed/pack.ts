/**
 * V4-14 行业方案 · 持证上岗: the industry pack's application settings.
 *
 * - `enabled` stays the V3-10 row `personnelSettings.licensedOperation`
 *   (`{ enabled }`), so the certification subject, the notices and the
 *   earlier toggle keep reading one switch.
 * - The rest lives in `personnelSettings.licensedOperation.pack`:
 *   `certificationOnlyPermissionSets` (default prod.cncOperator and
 *   equip.forkliftOperator), `scheduleCheckEnabled` (default true),
 *   `transferCheckEnabled` (default true), and the last changes of the
 *   switch and of the certification-only list (the settings page's log; the
 *   `hr-audit` logger records the same).
 *
 * Reads accept any query adapter, so the schedule preflight reads them on its
 * own transaction's connection.
 */
import type { QueryAdapter } from '@nocobase/db';
import { z } from 'zod';

import { json } from '../platform.js';

export const LICENSED_ROW = 'licensedOperation';
export const PACK_ROW = 'licensedOperation.pack';
/** The certification subject type (V3-10 certification-service). */
export const CERTIFICATION_SUBJECT_TYPE = 'hr.certification';
export const CNC_OPERATOR_SET = 'prod.cncOperator';
export const FORKLIFT_OPERATOR_SET = 'equip.forkliftOperator';
export const DEFAULT_CERTIFICATION_ONLY = [
  CNC_OPERATOR_SET,
  FORKLIFT_OPERATOR_SET,
] as const;
/** How many switch and list changes the settings page keeps. */
export const HISTORY_LIMIT = 100;

export const packSchema = z
  .object({
    certificationOnlyPermissionSets: z
      .array(z.string().trim().min(1).max(128))
      .max(200)
      .refine((keys) => new Set(keys).size === keys.length),
    scheduleCheckEnabled: z.boolean(),
    transferCheckEnabled: z.boolean(),
  })
  .strict();

export type PackOptions = z.infer<typeof packSchema>;

export interface PackChange {
  readonly at: string;
  readonly userId: string;
  readonly field: 'enabled' | 'certificationOnlyPermissionSets';
  readonly from: unknown;
  readonly to: unknown;
}

export interface LicensedPack extends PackOptions {
  readonly enabled: boolean;
}

export const PACK_DEFAULTS: PackOptions = {
  certificationOnlyPermissionSets: [...DEFAULT_CERTIFICATION_ONLY],
  scheduleCheckEnabled: true,
  transferCheckEnabled: true,
};

export interface PackRows {
  readonly pack: LicensedPack;
  readonly history: readonly PackChange[];
  readonly enabledRevision: number;
  readonly packRevision: number;
}

/** Both rows, with defaults for anything missing or unreadable. */
export async function readPackRows(query: QueryAdapter): Promise<PackRows> {
  const rows = await query
    .selectFrom('personnelSettings')
    .select(['id', 'value', 'revision'])
    .where('id', 'in', [LICENSED_ROW, PACK_ROW])
    .execute();
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const switchRow = byId.get(LICENSED_ROW);
  const packRow = byId.get(PACK_ROW);
  const switchValue = json<{ enabled?: unknown }>(switchRow?.value, {});
  const stored = json<Record<string, unknown>>(packRow?.value, {});
  const parsed = packSchema.safeParse({
    certificationOnlyPermissionSets:
      stored.certificationOnlyPermissionSets ??
      PACK_DEFAULTS.certificationOnlyPermissionSets,
    scheduleCheckEnabled:
      stored.scheduleCheckEnabled ?? PACK_DEFAULTS.scheduleCheckEnabled,
    transferCheckEnabled:
      stored.transferCheckEnabled ?? PACK_DEFAULTS.transferCheckEnabled,
  });
  const options = parsed.success ? parsed.data : PACK_DEFAULTS;
  const history = Array.isArray(stored.history)
    ? (stored.history as PackChange[]).slice(-HISTORY_LIMIT)
    : [];
  return {
    pack: { enabled: switchValue.enabled === true, ...options },
    history,
    enabledRevision: Number(switchRow?.revision ?? 0),
    packRevision: Number(packRow?.revision ?? 0),
  };
}

export async function readPack(query: QueryAdapter): Promise<LicensedPack> {
  return (await readPackRows(query)).pack;
}

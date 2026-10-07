/**
 * 行业内容包的启用和停用. The choice is the personnelSettings row
 * `industryPacks` (`{ enabled: string[], history }`); a missing row means no
 * pack is on, which is what a new installation gets. The demo turns
 * 制造业 on (seed 202610230102), and an installation that already used its
 * permission sets keeps it on (seed 202610230101).
 *
 * - Turning a pack on creates each of its permission sets that does not
 *   exist, from the pack's definition; an existing set is never changed, so
 *   an administrator's edits and assignments stay.
 * - Turning a pack off deletes nothing. Its pages drop out of what
 *   certificates are said to allow (certificate wall, certification detail,
 *   the steward), its registration endpoints answer INDUSTRY_PACK_DISABLED,
 *   and its kinds leave the traces and the 持证操作追溯 export. The sets,
 *   their assignments and every record stay, so turning it back on restores
 *   all of it.
 *
 * Who changed what and when goes to the row's history (newest 100) and the
 * `hr-audit` log.
 */
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager, QueryAdapter } from '@nocobase/db';
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import { CERTIFICATION_SUBJECT } from '../certification-service.js';
import type { ActorContext } from '../framework-service.js';
import { LICENSED_SETTINGS } from '../licensed/resources.js';
import { json } from '../platform.js';
import { HrError, str } from '../shared.js';
import {
  allOperations,
  INDUSTRY_PACKS,
  operationByKind,
  packByKey,
  type PackOperation,
} from './registry.js';

export const INDUSTRY_PACKS_ROW = 'industryPacks';
const HISTORY_LIMIT = 100;

export interface IndustryPackChange {
  readonly at: string;
  readonly userId: string;
  readonly pack: string;
  readonly enabled: boolean;
}

export interface IndustryPacksState {
  readonly enabled: readonly string[];
  readonly history: readonly IndustryPackChange[];
  readonly revision: number;
  readonly exists: boolean;
}

/** The row with defaults: missing or unreadable means no pack is on. Unknown keys are ignored. */
export async function readIndustryPacks(
  query: QueryAdapter,
): Promise<IndustryPacksState> {
  const row = await query
    .selectFrom('personnelSettings')
    .select(['value', 'revision'])
    .where('id', '=', INDUSTRY_PACKS_ROW)
    .executeTakeFirst();
  const value = json<{ enabled?: unknown; history?: unknown }>(row?.value, {});
  const enabled = Array.isArray(value.enabled)
    ? value.enabled.filter(
        (key): key is string => typeof key === 'string' && !!packByKey(key),
      )
    : [];
  return {
    enabled: [...new Set(enabled)],
    history: Array.isArray(value.history)
      ? (value.history as IndustryPackChange[]).slice(-HISTORY_LIMIT)
      : [],
    revision: Number(row?.revision ?? 0),
    exists: Boolean(row),
  };
}

/** What the enabled packs contribute right now; built once per call that needs it. */
export interface PackCatalog {
  readonly enabled: ReadonlySet<string>;
  /** Operation kinds of the enabled packs. */
  readonly kinds: ReadonlySet<string>;
  /** A page, set or composite of a pack that is off (and of no pack that is on). */
  hiddenPage(id: string): boolean;
  hiddenSet(key: string): boolean;
  hiddenResource(id: string): boolean;
  /** An enabled pack's page, with its display name and route. */
  page(id: string): { title: string; path: string } | undefined;
}

export interface IndustryPackView {
  readonly key: string;
  readonly title: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly changedAt: string | null;
  readonly operations: readonly {
    kind: string;
    page: string;
    path: string;
    title: string;
    permissionSet: string;
    /** Whether the permission set exists (turning the pack on creates it). */
    permissionSetExists: boolean;
    /** The certifications the permission set is assigned to: who may perform the operation. */
    certifications: readonly { id: string; title: string }[];
  }[];
}

const setEnabledInput = z.object({ enabled: z.boolean() }).strict();

export function createIndustryPackService(deps: {
  readonly database: DatabaseManager;
  readonly authz: AppAuthorization;
  /** A server locale key of the `hr` namespace in a locale (default: the application's), '' when missing. */
  readonly translate: (key: string, locale?: string) => string;
  readonly audit: (event: Record<string, unknown>) => void;
}) {
  const { database, authz } = deps;
  const text = (key: string, locale?: string) =>
    deps.translate(key, locale) || key;

  async function enabledKeys(): Promise<Set<string>> {
    return new Set((await readIndustryPacks(database.query())).enabled);
  }

  async function catalog(locale?: string): Promise<PackCatalog> {
    const enabled = await enabledKeys();
    const on = allOperations().filter((op) => enabled.has(op.pack));
    const off = allOperations().filter((op) => !enabled.has(op.pack));
    const hidden = (pick: (op: PackOperation) => string) => {
      const kept = new Set(on.map(pick));
      return new Set(off.map(pick).filter((value) => !kept.has(value)));
    };
    const pages = hidden((op) => op.page);
    const sets = hidden((op) => op.permissionSet);
    const resources = hidden((op) => op.resource);
    return {
      enabled,
      kinds: new Set(on.map((op) => op.kind)),
      hiddenPage: (id) => pages.has(id),
      hiddenSet: (key) => sets.has(key),
      hiddenResource: (id) => resources.has(id),
      page(id) {
        const op = on.find((candidate) => candidate.page === id);
        return op
          ? { title: text(op.titleKey, locale), path: op.path }
          : undefined;
      },
    };
  }

  /** Creates each missing permission set of a pack; existing sets stay as they are. */
  async function ensurePermissionSets(key: string): Promise<string[]> {
    const pack = packByKey(key);
    const created: string[] = [];
    for (const op of pack?.operations ?? []) {
      if (created.includes(op.permissionSet)) continue;
      if (await authz.permissionSets.get(op.permissionSet)) continue;
      await authz.permissionSets.create(op.permissionSetDefinition());
      created.push(op.permissionSet);
    }
    return created;
  }

  const service = {
    catalog,
    enabledKeys,
    async isEnabled(key: string): Promise<boolean> {
      return (await enabledKeys()).has(key);
    },
    /** The operations of the enabled packs. */
    async enabledOperations(): Promise<readonly PackOperation[]> {
      const enabled = await enabledKeys();
      return allOperations().filter((op) => enabled.has(op.pack));
    },
    /** Refuses an operation of a pack that is off (or unknown) before anything else is checked. */
    async assertOperation(kind: string): Promise<void> {
      const op = operationByKind(kind);
      if (!op || !(await enabledKeys()).has(op.pack))
        throw new HrError('INDUSTRY_PACK_DISABLED', 404, {
          pack: op?.pack ?? null,
        });
    },

    /** 设置 / 持证上岗 · 行业内容包 (talent.licensedOperationSettings · manage). */
    async list(
      ctx: ActorContext,
      locale?: string,
    ): Promise<{ packs: IndustryPackView[] }> {
      await authorizeAction(ctx.authz, LICENSED_SETTINGS, 'manage');
      const state = await readIndustryPacks(database.query());
      const certificationTitle = new Map(
        (
          await database
            .query()
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((row) => [str(row.id), str(row.title)]),
      );
      const packs: IndustryPackView[] = [];
      for (const pack of INDUSTRY_PACKS) {
        const operations = [];
        for (const op of pack.operations) {
          const exists = Boolean(
            await authz.permissionSets.get(op.permissionSet),
          );
          const assignments = exists
            ? await authz.permissionSets.listAssignments(op.permissionSet)
            : [];
          operations.push({
            kind: op.kind,
            page: op.page,
            path: op.path,
            title: text(op.titleKey, locale),
            permissionSet: op.permissionSet,
            permissionSetExists: exists,
            certifications: assignments
              .filter((a) => a.subject.type === CERTIFICATION_SUBJECT)
              .map((a) => ({
                id: a.subject.id,
                title: certificationTitle.get(a.subject.id) ?? a.subject.id,
              })),
          });
        }
        const last = [...state.history]
          .reverse()
          .find((change) => change.pack === pack.key);
        packs.push({
          key: pack.key,
          title: text(pack.titleKey, locale),
          description: text(pack.descriptionKey, locale),
          enabled: state.enabled.includes(pack.key),
          changedAt: last?.at ?? null,
          operations,
        });
      }
      return { packs };
    },

    async setEnabled(
      ctx: ActorContext,
      key: string,
      input: unknown,
      locale?: string,
    ): Promise<{ packs: IndustryPackView[]; created: string[] }> {
      await authorizeAction(ctx.authz, LICENSED_SETTINGS, 'manage');
      if (!packByKey(key)) throw new HrError('INDUSTRY_PACK_NOT_FOUND', 404);
      const parsed = setEnabledInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const { enabled } = parsed.data;
      // The sets first: a pack is never on without them.
      const created = enabled ? await ensurePermissionSets(key) : [];
      const state = await readIndustryPacks(database.query());
      const was = state.enabled.includes(key);
      if (was !== enabled) {
        const at = new Date();
        const change: IndustryPackChange = {
          at: at.toISOString(),
          userId: ctx.userId,
          pack: key,
          enabled,
        };
        const value = {
          enabled: enabled
            ? [...state.enabled, key]
            : state.enabled.filter((k) => k !== key),
          history: [...state.history, change].slice(-HISTORY_LIMIT),
        };
        if (state.exists) {
          const result = await database
            .query()
            .updateTable('personnelSettings')
            .set({
              value,
              revision: state.revision + 1,
              updatedBy: ctx.userId,
              updatedAt: at,
            })
            .where('id', '=', INDUSTRY_PACKS_ROW)
            .where('revision', '=', state.revision)
            .execute();
          if (!Number(result.updatedCount ?? 0))
            throw new HrError('SETTINGS_CONFLICT', 409);
        } else
          await database
            .query()
            .insertInto('personnelSettings')
            .values({
              id: INDUSTRY_PACKS_ROW,
              value,
              revision: 1,
              updatedBy: ctx.userId,
              createdAt: at,
              updatedAt: at,
            })
            .execute();
        deps.audit({ event: 'industryPack.changed', ...change, created });
      }
      return { ...(await service.list(ctx, locale)), created };
    },
  };
  return service;
}

export type IndustryPackService = ReturnType<typeof createIndustryPackService>;

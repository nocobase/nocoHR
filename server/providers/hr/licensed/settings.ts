/**
 * V4-14 设置 / 持证上岗 and the rules that follow it:
 *
 * - The switch and the options (pack.ts), written compare-and-set on each
 *   row's revision. Switch and certification-only list changes go to the
 *   `hr-audit` log and the page's own change list; a switch change refreshes
 *   every holder's session, since the certification subject has members only
 *   while the pack is on.
 * - 只能经认证获得: the certification-only permission sets are protected
 *   through the authorization plugin's assignment check
 *   (`permissionSets.protect({ assignableTo })`): any assignment of them to
 *   a user, department, department head or position is refused by the plugin
 *   itself (PERMISSION_SET_SUBJECT_NOT_ALLOWED), in the Settings →
 *   Authorization page and through the API alike. Every other operation on
 *   those sets stays allowed. A set already protected by another owner (root,
 *   the default set) cannot be listed; a set still assigned to something
 *   other than a certification cannot be added until that assignment is
 *   removed.
 * - 权限变化记录: the plugin keeps no history of assignments, and the 总纲
 *   allows no new table for this step, so each change to a certification
 *   subject's assignments is appended to `personnelSettings`
 *   `licensedOperation.grantHistory` (a snapshot of the current assignments
 *   and the dated entries, the newest 5000). Changes made while the server
 *   was down are recorded, dated when it starts.
 */
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { json } from '../platform.js';
import { HrError, str } from '../shared.js';
import {
  CERTIFICATION_SUBJECT_TYPE,
  HISTORY_LIMIT,
  LICENSED_ROW,
  PACK_ROW,
  packSchema,
  readPackRows,
  type LicensedPack,
  type PackChange,
} from './pack.js';
import { LICENSED_SETTINGS } from './resources.js';

export const PROTECTION_OWNER = 'nocohr.licensedOperation';
export const GRANT_HISTORY_ROW = 'licensedOperation.grantHistory';
const GRANT_HISTORY_LIMIT = 5000;

export interface GrantHistoryEntry {
  /** ISO time; null for the state found when the history started. */
  readonly at: string | null;
  readonly certificationId: string;
  readonly permissionSet: string;
  readonly change: 'assigned' | 'revoked';
}

export interface GrantHistory {
  /** Certification id → permission set keys assigned now. */
  readonly snapshot: Readonly<Record<string, readonly string[]>>;
  readonly entries: readonly GrantHistoryEntry[];
}

export interface LicensedSettingsView {
  readonly value: LicensedPack;
  readonly enabledRevision: number;
  readonly packRevision: number;
  readonly history: readonly PackChange[];
  /** Every permission set, for the certification-only picker. */
  readonly permissionSets: readonly {
    key: string;
    title: string;
    /** Another owner protects it (root, the default set): it cannot be listed. */
    protectedByOther: boolean;
    /** Assignments to something other than a certification. */
    otherAssignments: number;
    /** Certifications it is assigned to. */
    certifications: readonly string[];
    /** The certifications' titles: the 权限检查器 names only the permission set, this names who grants it. */
    certificationTitles: readonly string[];
  }[];
}

const updateSchema = z
  .object({
    enabledRevision: z.number().int().min(0),
    packRevision: z.number().int().min(0),
    value: packSchema.extend({ enabled: z.boolean() }).strict(),
  })
  .strict();

export function createLicensedSettings(deps: {
  readonly database: DatabaseManager;
  readonly authz: AppAuthorization;
  readonly titleText: (title: unknown) => string;
  readonly audit: (event: Record<string, unknown>) => void;
}) {
  const { database, authz } = deps;
  let releaseProtection: (() => void) | undefined;
  let historyChain: Promise<unknown> = Promise.resolve();

  /** Holders of a valid or expiring certificate: their sessions follow the switch. */
  async function refreshHolders(): Promise<void> {
    const holders = await database
      .query()
      .selectFrom('employeeCertificates')
      .innerJoin('employees', 'employees.id', 'employeeCertificates.employeeId')
      .select(['employees.userId as userId'])
      .where('employeeCertificates.status', 'in', ['valid', 'expiring'])
      .execute();
    for (const userId of new Set(holders.map((h) => h.userId)))
      if (userId)
        await authz.permissionSets.notifyAssignmentsChanged({
          type: 'user',
          id: str(userId),
        });
  }

  /** Applies the certification-only list to the plugin's assignment check. */
  async function syncProtection(): Promise<string[]> {
    const { pack } = await readPackRows(database.query());
    releaseProtection?.();
    releaseProtection = undefined;
    const keys = pack.certificationOnlyPermissionSets.filter((key) => {
      const protection = authz.permissionSets.protection(key);
      return !protection || protection.owner === PROTECTION_OWNER;
    });
    if (keys.length)
      releaseProtection = authz.permissionSets.protect({
        owner: PROTECTION_OWNER,
        keys,
        allow: ['create', 'update', 'delete', 'assign', 'revoke'],
        assignableTo: [CERTIFICATION_SUBJECT_TYPE],
      });
    return keys;
  }

  async function certificationAssignments(): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const set of await authz.permissionSets.list())
      for (const assignment of await authz.permissionSets.listAssignments(
        set.key,
      ))
        if (assignment.subject.type === CERTIFICATION_SUBJECT_TYPE) {
          const list = map.get(assignment.subject.id) ?? [];
          if (!list.includes(set.key)) list.push(set.key);
          map.set(assignment.subject.id, list.sort());
        }
    return map;
  }

  async function readHistory(): Promise<{
    history: GrantHistory;
    exists: boolean;
  }> {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', GRANT_HISTORY_ROW)
      .executeTakeFirst();
    const value = json<Partial<GrantHistory>>(row?.value, {});
    return {
      exists: Boolean(row),
      history: {
        snapshot: value.snapshot ?? {},
        entries: Array.isArray(value.entries) ? value.entries : [],
      },
    };
  }

  /** Compares the certification subjects' assignments with the snapshot and appends what changed. */
  function recordGrantChanges(): Promise<number> {
    const run = historyChain.then(async () => {
      const current = await certificationAssignments();
      const { history, exists } = await readHistory();
      const at = exists ? new Date().toISOString() : null;
      const entries: GrantHistoryEntry[] = [];
      const ids = new Set([
        ...Object.keys(history.snapshot),
        ...current.keys(),
      ]);
      for (const certificationId of ids) {
        const before = new Set(history.snapshot[certificationId] ?? []);
        const now = new Set(current.get(certificationId) ?? []);
        for (const key of now)
          if (!before.has(key))
            entries.push({
              at,
              certificationId,
              permissionSet: key,
              change: 'assigned',
            });
        for (const key of before)
          if (!now.has(key))
            entries.push({
              at,
              certificationId,
              permissionSet: key,
              change: 'revoked',
            });
      }
      if (exists && !entries.length) return 0;
      const value = {
        snapshot: Object.fromEntries(current),
        entries: [...history.entries, ...entries].slice(-GRANT_HISTORY_LIMIT),
      };
      const stamp = new Date();
      if (exists)
        await database
          .query()
          .updateTable('personnelSettings')
          .set({ value, updatedAt: stamp })
          .where('id', '=', GRANT_HISTORY_ROW)
          .execute();
      else
        await database
          .query()
          .insertInto('personnelSettings')
          .values({
            id: GRANT_HISTORY_ROW,
            value,
            revision: 1,
            updatedBy: 'system',
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      for (const entry of entries)
        if (entry.at)
          deps.audit({
            event: 'licensedOperation.grantChanged',
            ...entry,
          });
      return entries.length;
    });
    historyChain = run.catch(() => 0);
    return run;
  }

  return {
    refreshHolders,
    syncProtection,
    recordGrantChanges,
    async grantHistory(): Promise<GrantHistory> {
      return (await readHistory()).history;
    },
    release(): void {
      releaseProtection?.();
      releaseProtection = undefined;
    },

    async get(ctx: ActorContext): Promise<LicensedSettingsView> {
      await authorizeAction(ctx.authz, LICENSED_SETTINGS, 'manage');
      const rows = await readPackRows(database.query());
      const certificationTitle = new Map(
        (
          await database
            .query()
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [String(c.id), String(c.title)]),
      );
      const permissionSets = [];
      for (const set of await authz.permissionSets.list()) {
        const assignments = await authz.permissionSets.listAssignments(set.key);
        const protection = authz.permissionSets.protection(set.key);
        permissionSets.push({
          key: set.key,
          title: deps.titleText(set.title ?? set.key) || set.key,
          protectedByOther: Boolean(
            protection && protection.owner !== PROTECTION_OWNER,
          ),
          otherAssignments: assignments.filter(
            (a) => a.subject.type !== CERTIFICATION_SUBJECT_TYPE,
          ).length,
          certifications: assignments
            .filter((a) => a.subject.type === CERTIFICATION_SUBJECT_TYPE)
            .map((a) => a.subject.id),
          certificationTitles: assignments
            .filter((a) => a.subject.type === CERTIFICATION_SUBJECT_TYPE)
            .map((a) => certificationTitle.get(a.subject.id) ?? a.subject.id),
        });
      }
      return {
        value: rows.pack,
        enabledRevision: rows.enabledRevision,
        packRevision: rows.packRevision,
        history: [...rows.history].reverse(),
        permissionSets: permissionSets.sort((a, b) =>
          a.key.localeCompare(b.key),
        ),
      };
    },

    async update(
      ctx: ActorContext,
      input: unknown,
    ): Promise<LicensedSettingsView> {
      const policies = await authorizeAction(
        ctx.authz,
        LICENSED_SETTINGS,
        'manage',
      );
      void policies;
      const parsed = updateSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      const body = parsed.data;
      const current = await readPackRows(database.query());
      if (
        current.enabledRevision !== body.enabledRevision ||
        current.packRevision !== body.packRevision
      )
        throw new HrError('SETTINGS_CONFLICT', 409);
      const { enabled, ...options } = body.value;
      const added = options.certificationOnlyPermissionSets.filter(
        (key) => !current.pack.certificationOnlyPermissionSets.includes(key),
      );
      for (const key of options.certificationOnlyPermissionSets) {
        if (!(await authz.permissionSets.get(key)))
          throw new HrError('PERMISSION_SET_NOT_FOUND', 400, {
            permissionSet: key,
          });
        const protection = authz.permissionSets.protection(key);
        if (protection && protection.owner !== PROTECTION_OWNER)
          throw new HrError('PERMISSION_SET_PROTECTED', 409, {
            permissionSet: key,
          });
      }
      // "Only through a certification" must be true the moment it is listed.
      for (const key of added) {
        const others = (await authz.permissionSets.listAssignments(key)).filter(
          (a) => a.subject.type !== CERTIFICATION_SUBJECT_TYPE,
        );
        if (others.length)
          throw new HrError('CERTIFICATION_ONLY_HAS_OTHER_ASSIGNMENTS', 409, {
            permissionSet: key,
            subjects: others.map((a) => ({
              type: a.subject.type,
              id: a.subject.id,
            })),
          });
      }
      const at = new Date().toISOString();
      const changes: PackChange[] = [];
      if (enabled !== current.pack.enabled)
        changes.push({
          at,
          userId: ctx.userId,
          field: 'enabled',
          from: current.pack.enabled,
          to: enabled,
        });
      const listBefore = [
        ...current.pack.certificationOnlyPermissionSets,
      ].sort();
      const listAfter = [...options.certificationOnlyPermissionSets].sort();
      if (JSON.stringify(listBefore) !== JSON.stringify(listAfter))
        changes.push({
          at,
          userId: ctx.userId,
          field: 'certificationOnlyPermissionSets',
          from: listBefore,
          to: listAfter,
        });
      const stamp = new Date();
      await database.transaction(async (connection) => {
        const write = async (
          id: string,
          value: Record<string, unknown>,
          revision: number,
        ) => {
          const exists = await connection.query
            .selectFrom('personnelSettings')
            .select(['id'])
            .where('id', '=', id)
            .executeTakeFirst();
          if (exists) {
            const result = await connection.query
              .updateTable('personnelSettings')
              .set({
                value,
                revision: revision + 1,
                updatedBy: ctx.userId,
                updatedAt: stamp,
              })
              .where('id', '=', id)
              .where('revision', '=', revision)
              .execute();
            if (!Number(result.updatedCount ?? 0))
              throw new HrError('SETTINGS_CONFLICT', 409);
          } else
            await connection.query
              .insertInto('personnelSettings')
              .values({
                id,
                value,
                revision: 1,
                updatedBy: ctx.userId,
                createdAt: stamp,
                updatedAt: stamp,
              })
              .execute();
        };
        if (enabled !== current.pack.enabled || !current.enabledRevision)
          await write(LICENSED_ROW, { enabled }, current.enabledRevision);
        await write(
          PACK_ROW,
          {
            ...options,
            history: [...current.history, ...changes].slice(-HISTORY_LIMIT),
          },
          current.packRevision,
        );
      });
      for (const change of changes)
        deps.audit({ event: 'licensedOperation.settingsChanged', ...change });
      await syncProtection();
      if (enabled !== current.pack.enabled) await refreshHolders();
      return this.get(ctx);
    },
  };
}

export type LicensedSettings = ReturnType<typeof createLicensedSettings>;

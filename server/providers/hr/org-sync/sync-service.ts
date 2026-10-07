/**
 * 组织同步 (V1-03): reads an office suite's directory and reconciles it with
 * NocoHR's departments and employees.
 *
 * - Bindings (department `externalId`, employee `externalUserId`) are written
 *   in both modes. Members match by bound id, then employee number, work
 *   email, mobile; an ambiguous match binds nothing and becomes an issue.
 * - `orgMaster=nocohr` (default): NocoHR is the HR system. Differences in
 *   department, position, manager and status become pending items; HR raises
 *   the matching personnel action from the item. No job event is written.
 * - `orgMaster=external`: the directory wins. Department, position, manager
 *   and status are written, each change of department, position or status as
 *   a `source=sync` job event carrying the run id.
 * - Issues have a stable key (type + directory id + a digest of the
 *   difference). A run carries over the status, action and AI notes of the
 *   keys the previous run had, resolves those that vanished, and keeps
 *   ignored ones ignored while the key stays the same.
 * - One run at a time: a trigger during a run waits for it.
 * - A sync never touches permission set assignments or login credentials.
 */
import { createHash } from 'node:crypto';

import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { z } from 'zod';

import { callbackSignatureValid } from '../../../http/signed-callback.js';
import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import {
  classifyJobChange,
  loadPositionGrades,
  recordJobEvent,
  type JobEventProcessor,
} from '../job-events.js';
import type { OrganizationService } from '../organization-service.js';
import type { PersonnelSettingsService } from '../personnel-settings.js';
import { HrError, isRecord, newId, str, toDateOnly } from '../shared.js';
import {
  toEmployee,
  type EmployeeRecord,
  type TalentService,
} from '../talent-service.js';
import type {
  Directory,
  DirectoryMember,
  OrgDirectorySource,
  OrgProvider,
} from './source.js';

export const ORG_SYNC = 'talent.orgSync';

export const ISSUE_TYPES = [
  'unmappedTitle',
  'unknownParentDepartment',
  'departmentRemoved',
  'departmentAmbiguous',
  'duplicateMatch',
  'managerOutOfScope',
  'noAccount',
  'lockedChange',
  'newMember',
  'deactivatedMember',
  'orgMismatch',
  'managerMismatch',
  'departmentManagerMismatch',
  'contractPending',
] as const;
export type IssueType = (typeof ISSUE_TYPES)[number];
export type IssueStatus = 'open' | 'inProgress' | 'resolved' | 'ignored';

export interface SyncIssue {
  key: string;
  type: IssueType;
  externalId: string;
  employeeId?: string | null;
  departmentId?: string | null;
  /** Both sides' values; mobile numbers masked. */
  detail: Record<string, unknown>;
  status: IssueStatus;
  actionId?: string | null;
  handledBy?: string | null;
  handledAt?: string | null;
  ignoreReason?: string | null;
  aiExplanation?: string | null;
  aiSuggestedAction?: string | null;
  aiExplainedAt?: string | null;
  /** When the issue was first seen, for merging incremental explanations. */
  firstSeenAt?: string;
}

export interface SyncStats {
  departmentsCreated: number;
  departmentsUpdated: number;
  departmentsDeactivated: number;
  membersCreated: number;
  membersUpdated: number;
  membersDeactivated: number;
  bound: number;
  jobEvents: number;
  issues: number;
}

const settingsSchema = z
  .object({
    provider: z.enum(['feishu', 'dingtalk', 'wecom']),
    // Directory department ids whose subtrees are synced; empty is the whole directory.
    scopeRootDepartments: z.array(z.string().min(1).max(128)).max(50),
    orgMaster: z.enum(['nocohr', 'external']),
    syncDepartmentTree: z.boolean(),
    fullSyncTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
    syncedProbationMonths: z.number().int().min(0).max(6),
    masterChangedBy: z.string().nullable(),
    masterChangedAt: z.string().nullable(),
  })
  .strict();
export type OrgSyncSettings = z.infer<typeof settingsSchema>;
const DEFAULT_SETTINGS: OrgSyncSettings = {
  provider: 'feishu',
  scopeRootDepartments: [],
  orgMaster: 'nocohr',
  syncDepartmentTree: true,
  fullSyncTime: '02:00',
  syncedProbationMonths: 0,
  masterChangedBy: null,
  masterChangedAt: null,
};
const SETTINGS_ID = 'orgSync';

export interface OrgSyncServiceDeps {
  readonly database: DatabaseManager;
  readonly organization: OrganizationService;
  readonly talent: () => TalentService;
  readonly personnel: PersonnelSettingsService;
  readonly jobEvents: () => JobEventProcessor;
  /** The directory the configured provider reads, or undefined when none is available. */
  readonly source: (provider: OrgProvider) => OrgDirectorySource | undefined;
  readonly createAccount: (
    input: { name: string; email: string; password: string },
    connection: DatabaseConnection,
  ) => Promise<{ id: string }>;
  readonly notify: (input: {
    key: string;
    userIds: readonly string[];
    message: string;
    params: Record<string, string>;
    path?: string;
  }) => Promise<void>;
  /** Users to tell about failures and new hires: the automation owner, else HR administrators. */
  readonly hrRecipients: () => Promise<string[]>;
  /** Called after a run finishes (not failed), for the HR assistant's explanations. */
  readonly onRunFinished?: () =>
    ((run: { id: string; mode: 'full' | 'incremental' }) => void) | undefined;
  /** The HMAC secret the directory signs callbacks with; unset rejects every callback. */
  readonly callbackSecret: () => string | undefined;
  /** How far a callback's timestamp may be from now (publicEndpoints.callbackToleranceSeconds). */
  readonly callbackToleranceSeconds?: () => number;
  readonly currentDate: () => string;
}

function digest(value: unknown): string {
  return createHash('sha1')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 10);
}

/** `li***@example.com`: enough to tell addresses apart, not to use one. */
export function maskEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = value.indexOf('@');
  if (at < 1) return '***';
  return `${value.slice(0, Math.min(2, at))}***${value.slice(at)}`;
}

/** An item's detail as the HR assistant may read it: mobile and email masked. */
export function maskedDetail(
  detail: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (key === 'email' && typeof value === 'string')
      out[key] = maskEmail(value);
    else if (key === 'mobile' && typeof value === 'string')
      out[key] = value.includes('*') ? value : maskMobile(value);
    else out[key] = value;
  }
  return out;
}

export function maskMobile(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > 7
    ? `${value.slice(0, 3)}****${value.slice(-4)}`
    : '****';
}

const normalizeTitle = (title: string) =>
  title.replace(/\s+/gu, '').toLowerCase();

export function createOrgSyncService(deps: OrgSyncServiceDeps) {
  const { database, organization } = deps;
  let queue: Promise<unknown> = Promise.resolve();

  async function readSettings(): Promise<{
    value: OrgSyncSettings;
    revision: number;
  }> {
    const row = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', SETTINGS_ID)
      .executeTakeFirst();
    let stored: unknown = row?.value;
    for (let i = 0; i < 3 && typeof stored === 'string'; i++)
      stored = JSON.parse(stored);
    const parsed = settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      ...(isRecord(stored) ? stored : {}),
    });
    return {
      value: parsed.success ? parsed.data : DEFAULT_SETTINGS,
      revision: Number(row?.revision ?? 0),
    };
  }

  async function writeSettings(
    value: OrgSyncSettings,
    revision: number,
    userId: string,
  ): Promise<{ value: OrgSyncSettings; revision: number }> {
    const stamp = new Date();
    const existing = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['revision'])
      .where('id', '=', SETTINGS_ID)
      .executeTakeFirst();
    if (Number(existing?.revision ?? 0) !== revision)
      throw new HrError('SETTINGS_CONFLICT', 409);
    if (existing)
      await database
        .query()
        .updateTable('personnelSettings')
        .set({
          value: JSON.stringify(value),
          revision: revision + 1,
          updatedBy: userId,
          updatedAt: stamp,
        })
        .where('id', '=', SETTINGS_ID)
        .where('revision', '=', revision)
        .execute();
    else
      await database
        .query()
        .insertInto('personnelSettings')
        .values({
          id: SETTINGS_ID,
          value: JSON.stringify(value),
          revision: 1,
          updatedBy: userId,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
    return { value, revision: revision + 1 };
  }

  async function latestRun(
    finishedOnly = true,
  ): Promise<Record<string, unknown> | undefined> {
    let select = database
      .query()
      .selectFrom('orgSyncRuns')
      .selectAll()
      .orderBy('startedAt', 'desc');
    if (finishedOnly) select = select.where('status', '!=', 'running');
    return await select.limit(1).executeTakeFirst();
  }

  function issuesOf(row: Record<string, unknown> | undefined): SyncIssue[] {
    if (!row) return [];
    let value: unknown = row.issues;
    for (let i = 0; i < 3 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    return Array.isArray(value) ? (value as SyncIssue[]) : [];
  }

  async function saveIssues(runId: string, issues: SyncIssue[]) {
    await database
      .query()
      .updateTable('orgSyncRuns')
      .set({ issues: JSON.stringify(issues), updatedAt: new Date() })
      .where('id', '=', runId)
      .execute();
  }

  /** The current pending items live on the latest finished run. */
  async function currentIssues(): Promise<{
    runId: string | null;
    issues: SyncIssue[];
  }> {
    const run = await latestRun();
    if (!run) return { runId: null, issues: [] };
    const issues = issuesOf(run);
    // An action raised from an item and then rejected or withdrawn puts the item back.
    const linked = issues.filter(
      (i) => i.status === 'inProgress' && i.actionId,
    );
    if (linked.length) {
      const rows = await database
        .query()
        .selectFrom('personnelActions')
        .select(['id', 'status'])
        .where(
          'id',
          'in',
          linked.map((i) => i.actionId!),
        )
        .execute();
      const statusOf = new Map(rows.map((r) => [str(r.id), str(r.status)]));
      let changed = false;
      for (const issue of linked) {
        const status = statusOf.get(issue.actionId!);
        if (!status || status === 'rejected' || status === 'cancelled') {
          issue.status = 'open';
          issue.actionId = null;
          changed = true;
        }
      }
      if (changed) await saveIssues(String(run.id), issues);
    }
    return { runId: String(run.id), issues };
  }

  // ---------------- The reconciliation ----------------

  interface Local {
    departments: {
      id: string;
      title: string;
      parentId: string | null;
      managerId: string | null;
      active: boolean;
      externalProvider: string | null;
      externalId: string | null;
    }[];
    employees: (EmployeeRecord & {
      externalProvider: string | null;
      externalUserId: string | null;
      syncLocked: boolean;
    })[];
    aliases: Map<string, string>;
  }

  async function loadLocal(provider: OrgProvider): Promise<Local> {
    const [departments, employees, aliases] = await Promise.all([
      database
        .query()
        .selectFrom('departments')
        .select([
          'id',
          'title',
          'parentId',
          'managerId',
          'active',
          'externalProvider',
          'externalId',
        ])
        .execute(),
      database.query().selectFrom('employees').selectAll().execute(),
      database
        .query()
        .selectFrom('positionAliases')
        .select(['externalTitle', 'positionId'])
        .where('provider', '=', provider)
        .where('reviewStatus', '=', 'confirmed')
        .execute(),
    ]);
    return {
      departments: departments.map((d) => ({
        id: str(d.id),
        title: str(d.title),
        parentId: d.parentId == null ? null : str(d.parentId),
        managerId: d.managerId == null ? null : str(d.managerId),
        active: d.active === true || d.active === 1,
        externalProvider:
          d.externalProvider == null ? null : str(d.externalProvider),
        externalId: d.externalId == null ? null : str(d.externalId),
      })),
      employees: employees.map((row) => ({
        ...toEmployee(row as Record<string, unknown>),
        externalProvider:
          row.externalProvider == null ? null : str(row.externalProvider),
        externalUserId:
          row.externalUserId == null ? null : str(row.externalUserId),
        syncLocked: row.syncLocked === true || row.syncLocked === 1,
      })),
      aliases: new Map(
        aliases.map((a) => [
          normalizeTitle(str(a.externalTitle)),
          str(a.positionId),
        ]),
      ),
    };
  }

  /** Directory departments inside the configured scope. */
  function inScope(directory: Directory, roots: readonly string[]) {
    if (!roots.length) return directory;
    const byId = new Map(directory.departments.map((d) => [d.id, d]));
    const within = (id: string | null): boolean => {
      for (let cursor = id, depth = 0; cursor && depth < 64; depth++) {
        if (roots.includes(cursor)) return true;
        cursor = byId.get(cursor)?.parentId ?? null;
      }
      return false;
    };
    return {
      departments: directory.departments.filter((d) => within(d.id)),
      members: directory.members.filter((m) => within(m.departmentId)),
    };
  }

  async function reconcile(
    runId: string,
    settings: OrgSyncSettings,
    directory: Directory,
    previous: SyncIssue[],
  ): Promise<{
    stats: SyncStats;
    issues: SyncIssue[];
    affectedUsers: string[];
    /** Members that could not be written, and job events whose handlers failed. */
    failures: string[];
  }> {
    const provider = settings.provider;
    const external = settings.orgMaster === 'external';
    const stats: SyncStats = {
      departmentsCreated: 0,
      departmentsUpdated: 0,
      departmentsDeactivated: 0,
      membersCreated: 0,
      membersUpdated: 0,
      membersDeactivated: 0,
      bound: 0,
      jobEvents: 0,
      issues: 0,
    };
    const found: SyncIssue[] = [];
    const failures: string[] = [];
    const affected = new Set<string>();
    const eventIds: string[] = [];
    const notices: Parameters<OrgSyncServiceDeps['notify']>[0][] = [];
    const issue = (
      type: IssueType,
      externalId: string,
      detail: Record<string, unknown>,
      refs: { employeeId?: string | null; departmentId?: string | null } = {},
      difference: unknown = detail,
    ) =>
      found.push({
        key: `${type}:${externalId}:${digest(difference)}`,
        type,
        externalId,
        employeeId: refs.employeeId ?? null,
        departmentId: refs.departmentId ?? null,
        detail,
        status: 'open',
      });
    const scoped = inScope(directory, settings.scopeRootDepartments);
    let local = await loadLocal(provider);

    // ---- Departments ----
    const localTitle = (d: Local['departments'][number]) =>
      organization.titleText(d.title, 'zh-CN');
    const localPath = (id: string | null): string => {
      const parts: string[] = [];
      for (let cursor = id, depth = 0; cursor && depth < 64; depth++) {
        const d = local.departments.find((x) => x.id === cursor);
        if (!d) break;
        parts.unshift(localTitle(d));
        cursor = d.parentId;
      }
      return parts.join('/');
    };
    const dirById = new Map(scoped.departments.map((d) => [d.id, d]));
    const dirPath = (id: string | null): string => {
      const parts: string[] = [];
      for (let cursor = id, depth = 0; cursor && depth < 64; depth++) {
        const d = directory.departments.find((x) => x.id === cursor);
        if (!d) break;
        parts.unshift(d.name);
        cursor = d.parentId;
      }
      return parts.join('/');
    };
    const deptMap = new Map<string, string>(); // directory id -> local id
    for (const d of local.departments)
      if (d.externalProvider === provider && d.externalId)
        deptMap.set(d.externalId, d.id);
    // Parents first, so a child can be created under a parent created in the same run.
    const ordered = [...scoped.departments].sort(
      (a, b) =>
        dirPath(a.id).split('/').length - dirPath(b.id).split('/').length,
    );
    for (const d of ordered) {
      if (deptMap.has(d.id)) continue;
      const path = dirPath(d.id);
      const candidates = local.departments.filter(
        (x) => !x.externalId && localPath(x.id) === path,
      );
      if (candidates.length === 1) {
        await database
          .query()
          .updateTable('departments')
          .set({
            externalProvider: provider,
            externalId: d.id,
            updatedAt: new Date(),
          })
          .where('id', '=', candidates[0].id)
          .execute();
        deptMap.set(d.id, candidates[0].id);
        candidates[0].externalId = d.id;
        candidates[0].externalProvider = provider;
        continue;
      }
      if (candidates.length > 1) {
        issue('departmentAmbiguous', d.id, {
          name: d.name,
          path,
          candidates: candidates.map((c) => c.id),
        });
        continue;
      }
      const parentLocal = d.parentId ? deptMap.get(d.parentId) : null;
      if (d.parentId && !parentLocal) {
        issue('unknownParentDepartment', d.id, { name: d.name, path });
        continue;
      }
      if (!settings.syncDepartmentTree) continue;
      const created = await organization.createDepartment({
        // Stored titles are encoded like the ones the departments page writes.
        title: encodeAuthorizationTitle(d.name) ?? d.name,
        parentId: parentLocal ?? null,
      });
      await database
        .query()
        .updateTable('departments')
        .set({
          externalProvider: provider,
          externalId: d.id,
          updatedAt: new Date(),
        })
        .where('id', '=', created.id)
        .execute();
      deptMap.set(d.id, created.id);
      stats.departmentsCreated += 1;
      local = await loadLocal(provider);
    }
    // Renames and moves of bound departments.
    if (settings.syncDepartmentTree)
      for (const d of scoped.departments) {
        const localId = deptMap.get(d.id);
        const current = local.departments.find((x) => x.id === localId);
        if (!localId || !current) continue;
        const parentLocal = d.parentId
          ? (deptMap.get(d.parentId) ?? null)
          : null;
        if (d.parentId && !parentLocal) continue;
        const changes: { title?: string; parentId?: string | null } = {};
        if (localTitle(current) !== d.name)
          changes.title = encodeAuthorizationTitle(d.name) ?? d.name;
        if (current.parentId !== parentLocal && (parentLocal || !d.parentId))
          changes.parentId = parentLocal;
        if (Object.keys(changes).length) {
          const { changed } = await organization.updateDepartment(
            localId,
            changes,
          );
          for (const u of changed) affected.add(u);
          stats.departmentsUpdated += 1;
        }
      }
    // Departments the directory no longer has.
    for (const d of local.departments) {
      if (d.externalProvider !== provider || !d.externalId || !d.active)
        continue;
      if (dirById.has(d.externalId)) continue;
      const inService = local.employees.filter(
        (e) => e.departmentId === d.id && e.status !== 'leave',
      ).length;
      if (external && !inService) {
        for (const u of await organization.setActive(d.id, false))
          affected.add(u);
        stats.departmentsDeactivated += 1;
      } else
        issue(
          'departmentRemoved',
          d.externalId,
          { title: localTitle(d), inService },
          { departmentId: d.id },
          { removed: true },
        );
    }
    local = await loadLocal(provider);

    // ---- Members: bind ----
    const byExternal = new Map(
      local.employees
        .filter((e) => e.externalProvider === provider && e.externalUserId)
        .map((e) => [e.externalUserId!, e]),
    );
    const claimed = new Map<string, string[]>(); // employee id -> member ids matching it
    const matchOf = new Map<string, (typeof local.employees)[number]>();
    const ambiguous = new Set<string>();
    for (const m of scoped.members) {
      const bound = byExternal.get(m.userId);
      if (bound) {
        matchOf.set(m.userId, bound);
        continue;
      }
      let candidates: typeof local.employees = [];
      for (const pick of [
        (e: (typeof local.employees)[number]) =>
          Boolean(m.employeeNo) && e.employeeNo === m.employeeNo,
        (e: (typeof local.employees)[number]) =>
          Boolean(m.email) && e.email?.toLowerCase() === m.email!.toLowerCase(),
        (e: (typeof local.employees)[number]) =>
          Boolean(m.mobile) && e.mobile === m.mobile,
      ]) {
        candidates = local.employees.filter(
          (e) =>
            !(e.externalProvider === provider && e.externalUserId) && pick(e),
        );
        if (candidates.length) break;
      }
      if (candidates.length > 1) {
        ambiguous.add(m.userId);
        issue('duplicateMatch', m.userId, {
          name: m.name,
          candidates: candidates.map((c) => ({
            id: c.id,
            name: c.name,
            employeeNo: c.employeeNo,
          })),
        });
        continue;
      }
      if (candidates.length === 1) {
        const e = candidates[0];
        claimed.set(e.id, [...(claimed.get(e.id) ?? []), m.userId]);
        matchOf.set(m.userId, e);
      }
    }
    for (const [employeeId, members] of claimed) {
      if (members.length < 2) continue;
      for (const memberId of members) matchOf.delete(memberId);
      const e = local.employees.find((x) => x.id === employeeId)!;
      issue('duplicateMatch', members.join('+'), {
        employee: { id: e.id, name: e.name, employeeNo: e.employeeNo },
        members,
      });
    }
    for (const [memberId, e] of matchOf) {
      if (e.externalUserId === memberId && e.externalProvider === provider)
        continue;
      await database
        .query()
        .updateTable('employees')
        .set({
          externalProvider: provider,
          externalUserId: memberId,
          updatedAt: new Date(),
        })
        .where('id', '=', e.id)
        .execute();
      e.externalProvider = provider;
      e.externalUserId = memberId;
      stats.bound += 1;
    }

    // ---- Members: reconcile ----
    const grades = await loadPositionGrades(
      database.query(),
      local.employees
        .map((e) => e.positionId)
        .concat([...local.aliases.values()]),
    );
    const gradeOrder = (await deps.personnel.read('gradeOrder')).value.families;
    const employeeOfMember = (id: string | null) =>
      id ? matchOf.get(id) : undefined;
    const today = deps.currentDate();
    for (const m of scoped.members) {
      // One member that cannot be written does not stop the others: the run ends `partial`.
      try {
        if (ambiguous.has(m.userId)) continue;
        const e = matchOf.get(m.userId);
        const targetDept = deptMap.get(m.departmentId) ?? null;
        const titleKey = m.title ? normalizeTitle(m.title) : null;
        const targetPosition = titleKey
          ? (local.aliases.get(titleKey) ?? null)
          : null;
        if (m.title && !targetPosition)
          issue(
            'unmappedTitle',
            m.userId,
            { name: m.name, title: m.title, employeeId: e?.id ?? null },
            { employeeId: e?.id ?? null },
            { title: m.title },
          );
        if (!e) {
          if (!m.active) continue;
          if (!external) {
            issue(
              'newMember',
              m.userId,
              {
                name: m.name,
                employeeNo: m.employeeNo,
                email: m.email,
                mobile: maskMobile(m.mobile),
                departmentId: targetDept,
                title: m.title,
                positionId: targetPosition,
              },
              { departmentId: targetDept },
              { member: m.userId },
            );
            continue;
          }
          if (!targetDept) continue; // the department is an issue of its own
          const created = await createSyncedEmployee(
            runId,
            settings,
            m,
            targetDept,
            targetPosition,
          );
          eventIds.push(created.eventId);
          if (created.userId) affected.add(created.userId);
          else
            issue(
              'noAccount',
              m.userId,
              { name: m.name },
              { employeeId: created.id },
              { member: m.userId },
            );
          stats.membersCreated += 1;
          stats.jobEvents += 1;
          notices.push({
            key: `orgSync:onboard:${created.id}`,
            userIds: await deps.hrRecipients(),
            message: 'orgSyncOnboarded',
            params: { name: m.name },
            path: `/talent/employees/${created.id}`,
          });
          continue;
        }
        // Basic information follows the directory in both modes, without an event.
        const basic: Record<string, unknown> = {};
        if (m.name && m.name !== e.name) basic.name = m.name;
        if (m.email && m.email !== e.email) basic.email = m.email;
        if (Object.keys(basic).length) {
          await database
            .query()
            .updateTable('employees')
            .set({ ...basic, updatedAt: new Date() })
            .where('id', '=', e.id)
            .execute();
          stats.membersUpdated += 1;
        }
        if (!e.userId && e.status !== 'leave')
          issue(
            'noAccount',
            m.userId,
            { name: e.name },
            { employeeId: e.id },
            { member: m.userId },
          );
        const manager = employeeOfMember(m.managerUserId);
        if (m.managerUserId && !manager)
          issue(
            'managerOutOfScope',
            m.userId,
            { name: e.name, managerUserId: m.managerUserId },
            { employeeId: e.id },
            { manager: m.managerUserId },
          );
        const want = {
          departmentId: targetDept ?? e.departmentId,
          positionId: targetPosition ?? e.positionId,
          status: m.active ? e.status : 'leave',
          managerEmployeeId: manager ? manager.id : e.managerEmployeeId,
        };
        const jobDiffers =
          want.departmentId !== e.departmentId ||
          want.positionId !== e.positionId ||
          want.status !== e.status;
        const managerDiffers = want.managerEmployeeId !== e.managerEmployeeId;
        if (e.syncLocked) {
          if (jobDiffers || managerDiffers)
            issue(
              'lockedChange',
              m.userId,
              { name: e.name, want },
              { employeeId: e.id },
              want,
            );
          continue;
        }
        if (e.status === 'leave') continue;
        if (!external) {
          if (!m.active)
            issue(
              'deactivatedMember',
              m.userId,
              { name: e.name, deactivatedAt: m.deactivatedAt ?? today },
              { employeeId: e.id },
              { active: false },
            );
          else if (jobDiffers) {
            const kind = classifyJobChange(
              e,
              { ...want, status: e.status },
              {
                from: e.positionId ? grades.get(e.positionId) : undefined,
                to: want.positionId ? grades.get(want.positionId) : undefined,
                gradeOrder,
              },
            );
            issue(
              'orgMismatch',
              m.userId,
              {
                name: e.name,
                from: {
                  departmentId: e.departmentId,
                  positionId: e.positionId,
                },
                to: {
                  departmentId: want.departmentId,
                  positionId: want.positionId,
                },
                suggestedAction: kind === 'promote' ? 'promote' : 'transfer',
              },
              { employeeId: e.id },
              { departmentId: want.departmentId, positionId: want.positionId },
            );
          }
          if (managerDiffers && manager)
            issue(
              'managerMismatch',
              m.userId,
              {
                name: e.name,
                from: e.managerEmployeeId,
                to: manager.id,
                toName: manager.name,
              },
              { employeeId: e.id },
              { manager: manager.id },
            );
          continue;
        }
        // external: the directory wins.
        if (managerDiffers && manager)
          await database
            .query()
            .updateTable('employees')
            .set({ managerEmployeeId: manager.id, updatedAt: new Date() })
            .where('id', '=', e.id)
            .execute();
        if (!jobDiffers) continue;
        const kind = classifyJobChange(e, want, {
          from: e.positionId ? grades.get(e.positionId) : undefined,
          to: want.positionId ? grades.get(want.positionId) : undefined,
          gradeOrder,
        });
        if (!kind) continue;
        const result = await database.transaction(async (connection) => {
          if (want.status === 'leave')
            await connection.query
              .updateTable('employees')
              .set({ leaveDate: today, updatedAt: new Date() })
              .where('id', '=', e.id)
              .execute();
          const users = await deps.talent().applyCoreChange(connection, e, {
            departmentId: want.departmentId,
            positionId: want.positionId,
            status: want.status,
          });
          const eventId = await recordJobEvent(connection, {
            employeeId: e.id,
            eventType: kind,
            fromDepartmentId: e.departmentId,
            toDepartmentId: want.departmentId,
            fromPositionId: e.positionId,
            toPositionId: want.positionId,
            effectiveDate: today,
            source: 'sync',
            syncRunId: runId,
            actionId: null,
            note: null,
          });
          return { users, eventId };
        });
        for (const u of result.users) affected.add(u);
        eventIds.push(result.eventId);
        stats.jobEvents += 1;
        if (kind === 'offboard') {
          stats.membersDeactivated += 1;
          const contract = await database
            .query()
            .selectFrom('employmentContracts')
            .select(['id', 'contractNo'])
            .where('employeeId', '=', e.id)
            .where('status', '=', 'active')
            .executeTakeFirst();
          if (contract)
            issue(
              'contractPending',
              m.userId,
              { name: e.name, contractNo: str(contract.contractNo) },
              { employeeId: e.id },
              { contract: str(contract.id) },
            );
          notices.push({
            key: `orgSync:offboard:${result.eventId}`,
            userIds: await deps.hrRecipients(),
            message: 'orgSyncOffboarded',
            params: { name: e.name },
            path: `/talent/employees/${e.id}`,
          });
        } else {
          stats.membersUpdated += 1;
          const heads = new Set<string>();
          for (const departmentId of [e.departmentId, want.departmentId]) {
            const head = await organization.resolveHead(departmentId);
            if (head) heads.add(head.userId);
          }
          if (e.userId) heads.add(e.userId);
          notices.push({
            key: `orgSync:move:${result.eventId}`,
            userIds: [...heads],
            message: 'orgSyncMoved',
            params: { name: e.name, type: kind },
            path: `/talent/employees/${e.id}/events`,
          });
        }
      } catch (error) {
        failures.push(
          `${m.userId}: ${
            error instanceof HrError
              ? error.code
              : error instanceof Error
                ? error.message.slice(0, 200)
                : 'ORG_SYNC_MEMBER_FAILED'
          }`,
        );
      }
    }

    // ---- Department heads ----
    for (const d of scoped.departments) {
      const localId = deptMap.get(d.id);
      const current = local.departments.find((x) => x.id === localId);
      if (!localId || !current) continue;
      const head = employeeOfMember(d.managerUserId);
      const wantHead = head?.userId ?? null;
      if (!d.managerUserId || wantHead === current.managerId) continue;
      if (external && wantHead) {
        const { changed } = await organization.updateDepartment(localId, {
          managerId: wantHead,
        });
        for (const u of changed) affected.add(u);
      } else if (!external)
        issue(
          'departmentManagerMismatch',
          d.id,
          {
            title: localTitle(current),
            from: current.managerId,
            toName: head?.name ?? null,
          },
          { departmentId: localId },
          { head: wantHead ?? d.managerUserId },
        );
    }

    // ---- Carry over the previous run's handling ----
    const before = new Map(previous.map((i) => [i.key, i]));
    const now = new Date().toISOString();
    const merged: SyncIssue[] = [];
    const seen = new Set<string>();
    for (const item of found) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      const prior = before.get(item.key);
      merged.push(
        prior && prior.status !== 'resolved'
          ? {
              ...item,
              status: prior.status,
              actionId: prior.actionId ?? null,
              handledBy: prior.handledBy ?? null,
              handledAt: prior.handledAt ?? null,
              ignoreReason: prior.ignoreReason ?? null,
              aiExplanation: prior.aiExplanation ?? null,
              aiSuggestedAction: prior.aiSuggestedAction ?? null,
              aiExplainedAt: prior.aiExplainedAt ?? null,
              firstSeenAt: prior.firstSeenAt ?? now,
            }
          : { ...item, firstSeenAt: now },
      );
    }
    for (const prior of previous)
      if (
        !seen.has(prior.key) &&
        (prior.status === 'open' || prior.status === 'inProgress')
      )
        merged.push({
          ...prior,
          status: 'resolved',
          handledBy: 'system',
          handledAt: now,
        });
    stats.issues = merged.filter(
      (i) => i.status === 'open' || i.status === 'inProgress',
    ).length;
    // Handlers and notices after the writes are committed. An event a handler
    // failed keeps processedAt empty and is retried from 岗位变动.
    if (eventIds.length) {
      const processed = await deps
        .jobEvents()
        .process(eventIds)
        .catch(() => 0);
      if (processed < eventIds.length)
        failures.push(
          `ORG_SYNC_EVENTS_UNPROCESSED: ${eventIds.length - processed}`,
        );
    }
    for (const notice of notices)
      await deps.notify(notice).catch(() => undefined);
    return { stats, issues: merged, affectedUsers: [...affected], failures };
  }

  async function createSyncedEmployee(
    runId: string,
    settings: OrgSyncSettings,
    m: DirectoryMember,
    departmentId: string,
    positionId: string | null,
  ): Promise<{ id: string; userId: string | null; eventId: string }> {
    const today = deps.currentDate();
    const months = settings.syncedProbationMonths;
    const probationEnd = months > 0 ? addMonths(today, months) : null;
    return database.transaction(async (connection) => {
      let userId: string | null = null;
      if (m.email) {
        // Sign-in goes through the office suite; the random password is never shown.
        const account = await deps.createAccount(
          { name: m.name, email: m.email, password: `Sync#${newId()}` },
          connection,
        );
        userId = account.id;
      }
      const id = newId();
      const stamp = new Date();
      await connection.query
        .insertInto('employees')
        .values({
          id,
          employeeNo: m.employeeNo ?? `SYNC-${m.userId.slice(0, 20)}`,
          name: m.name,
          userId,
          departmentId,
          positionId,
          managerEmployeeId: null,
          status: probationEnd ? 'probation' : 'active',
          hireDate: today,
          positionSince: positionId ? today : null,
          email: m.email,
          mobile: m.mobile,
          employmentType: 'fullTime',
          probationEndDate: probationEnd,
          externalProvider: settings.provider,
          externalUserId: m.userId,
          syncLocked: false,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      if (userId)
        await organization.syncPrimaryMembership(
          userId,
          departmentId,
          connection,
        );
      const eventId = await recordJobEvent(connection, {
        employeeId: id,
        eventType: 'onboard',
        fromDepartmentId: null,
        toDepartmentId: departmentId,
        fromPositionId: null,
        toPositionId: positionId,
        effectiveDate: today,
        source: 'sync',
        syncRunId: runId,
        actionId: null,
        note: null,
      });
      return { id, userId, eventId };
    });
  }

  async function execute(options: {
    mode: 'full' | 'incremental';
    triggeredBy: string | null;
  }): Promise<string> {
    const settings = (await readSettings()).value;
    const source = deps.source(settings.provider);
    const id = newId();
    const started = new Date();
    await database
      .query()
      .insertInto('orgSyncRuns')
      .values({
        id,
        provider: settings.provider,
        mode: options.mode,
        orgMaster: settings.orgMaster,
        triggeredBy: options.triggeredBy,
        startedAt: started,
        finishedAt: null,
        status: 'running',
        stats: null,
        issues: null,
        error: null,
        createdAt: started,
        updatedAt: started,
      })
      .execute();
    const previous = (await currentIssues()).issues;
    try {
      if (!source || !(await source.configured()))
        throw new HrError('ORG_SYNC_SOURCE_UNAVAILABLE', 409);
      const directory = await source.fetch();
      const { stats, issues, affectedUsers, failures } = await reconcile(
        id,
        settings,
        directory,
        previous,
      );
      await deps.talent().notifyUsers(affectedUsers);
      await database
        .query()
        .updateTable('orgSyncRuns')
        .set({
          // 部分成功: some members or event handlers failed; the rest is written.
          status: failures.length ? 'partial' : 'succeeded',
          finishedAt: new Date(),
          stats: JSON.stringify(stats),
          issues: JSON.stringify(issues),
          error: failures.length ? failures.join('\n').slice(0, 2000) : null,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      deps.onRunFinished?.()?.({ id, mode: options.mode });
    } catch (error) {
      const message =
        error instanceof HrError
          ? error.code
          : error instanceof Error
            ? error.message.slice(0, 500)
            : 'ORG_SYNC_FAILED';
      await database
        .query()
        .updateTable('orgSyncRuns')
        .set({
          status: 'failed',
          finishedAt: new Date(),
          // The last good issue list stays current: copy it forward.
          issues: JSON.stringify(previous),
          error: message,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      // The same reason is told once per day.
      await deps
        .notify({
          key: `orgSync:failed:${digest(message)}:${deps.currentDate()}`,
          userIds: await deps.hrRecipients(),
          message: 'orgSyncFailed',
          params: { reason: message },
          path: '/settings/org-sync/runs',
        })
        .catch(() => undefined);
    }
    return id;
  }

  /** Runs one sync after any run in progress. */
  function run(options: {
    mode: 'full' | 'incremental';
    triggeredBy: string | null;
  }): Promise<string> {
    const next = queue.catch(() => undefined).then(() => execute(options));
    queue = next;
    return next;
  }

  async function mutateIssue(
    key: string,
    change: (issue: SyncIssue) => void,
  ): Promise<SyncIssue> {
    const { runId, issues } = await currentIssues();
    const target = issues.find((i) => i.key === key);
    if (!runId || !target) throw new HrError('ORG_SYNC_ISSUE_NOT_FOUND', 404);
    change(target);
    await saveIssues(runId, issues);
    return target;
  }

  function toRun(row: Record<string, unknown>, withIssues: boolean) {
    const parse = (value: unknown) => {
      let v = value;
      for (let i = 0; i < 3 && typeof v === 'string'; i++) v = JSON.parse(v);
      return v;
    };
    return {
      id: str(row.id),
      provider: str(row.provider),
      mode: str(row.mode),
      orgMaster: str(row.orgMaster),
      triggeredBy: row.triggeredBy == null ? null : str(row.triggeredBy),
      startedAt: new Date(str(row.startedAt)).toISOString(),
      finishedAt:
        row.finishedAt == null
          ? null
          : new Date(str(row.finishedAt)).toISOString(),
      status: str(row.status),
      stats: (parse(row.stats) as SyncStats | null) ?? null,
      error: row.error == null ? null : str(row.error),
      ...(withIssues ? { issues: issuesOf(row) } : {}),
    };
  }

  const service = {
    readSettings,

    async getStatus(ctx: ActorContext) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'view');
      const settings = await readSettings();
      const source = deps.source(settings.value.provider);
      const last = await latestRun(false);
      return {
        settings,
        source: source
          ? { label: source.label, configured: await source.configured() }
          : null,
        lastRun: last ? toRun(last, false) : null,
      };
    },

    async updateSettings(ctx: ActorContext, input: unknown) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'configure');
      const body = z
        .object({
          revision: z.number().int().min(0),
          value: settingsSchema.omit({
            orgMaster: true,
            masterChangedBy: true,
            masterChangedAt: true,
          }),
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const current = (await readSettings()).value;
      // The data master changes only through switchMaster, with its checks.
      return writeSettings(
        {
          ...body.data.value,
          orgMaster: current.orgMaster,
          masterChangedBy: current.masterChangedBy,
          masterChangedAt: current.masterChangedAt,
        },
        body.data.revision,
        ctx.userId,
      );
    },

    /** Switching the data master changes no employee data and writes no event. */
    async switchMaster(ctx: ActorContext, input: unknown) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'switchMaster');
      const body = z
        .object({
          revision: z.number().int().min(0),
          orgMaster: z.enum(['nocohr', 'external']),
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const current = await readSettings();
      if (current.value.orgMaster === body.data.orgMaster) return current;
      if (body.data.orgMaster === 'external') {
        const open = await database
          .query()
          .selectFrom('personnelActions')
          .select(['id', 'actionType', 'employeeId', 'status'])
          .where('actionType', 'in', ['transfer', 'promote', 'offboard'])
          .where('status', 'in', ['pending', 'approved'])
          .execute();
        if (open.length)
          throw new HrError('ORG_MASTER_OPEN_ACTIONS', 409, {
            actions: open.map((a) => ({
              id: str(a.id),
              actionType: str(a.actionType),
              employeeId: a.employeeId == null ? null : str(a.employeeId),
              status: str(a.status),
            })),
          });
      }
      return writeSettings(
        {
          ...current.value,
          orgMaster: body.data.orgMaster,
          masterChangedBy: ctx.userId,
          masterChangedAt: new Date().toISOString(),
        },
        body.data.revision,
        ctx.userId,
      );
    },

    async runNow(ctx: ActorContext) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'run');
      const id = await run({ mode: 'full', triggeredBy: ctx.userId });
      const row = await database
        .query()
        .selectFrom('orgSyncRuns')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      return toRun(row as Record<string, unknown>, false);
    },

    run,

    async listRuns(ctx: ActorContext) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'view');
      const rows = await database
        .query()
        .selectFrom('orgSyncRuns')
        .selectAll()
        .orderBy('startedAt', 'desc')
        .limit(100)
        .execute();
      return rows.map((r) => toRun(r as Record<string, unknown>, false));
    },

    async getRun(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'view');
      const row = await database
        .query()
        .selectFrom('orgSyncRuns')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('ORG_SYNC_RUN_NOT_FOUND', 404);
      return toRun(row, true);
    },

    async listIssues(ctx: ActorContext) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'view');
      const { runId, issues } = await currentIssues();
      return {
        runId,
        orgMaster: (await readSettings()).value.orgMaster,
        issues: issues.filter(
          (i) => i.status === 'open' || i.status === 'inProgress',
        ),
      };
    },

    currentIssues,

    async ignoreIssue(ctx: ActorContext, key: string, reason: unknown) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'resolveIssues');
      if (typeof reason !== 'string' || !reason.trim())
        throw new HrError('ORG_SYNC_IGNORE_REASON_REQUIRED', 400);
      return mutateIssue(key, (issue) => {
        if (issue.status !== 'open')
          throw new HrError('ORG_SYNC_ISSUE_NOT_OPEN', 409);
        issue.status = 'ignored';
        issue.ignoreReason = reason.trim().slice(0, 500);
        issue.handledBy = ctx.userId;
        issue.handledAt = new Date().toISOString();
      });
    },

    /** managerMismatch: take the directory's manager, without a job event. */
    async adoptManager(ctx: ActorContext, key: string) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'resolveIssues');
      const { issues } = await currentIssues();
      const issue = issues.find((i) => i.key === key);
      if (!issue || issue.type !== 'managerMismatch' || issue.status !== 'open')
        throw new HrError('ORG_SYNC_ISSUE_NOT_FOUND', 404);
      await database
        .query()
        .updateTable('employees')
        .set({ managerEmployeeId: str(issue.detail.to), updatedAt: new Date() })
        .where('id', '=', str(issue.employeeId))
        .execute();
      return mutateIssue(key, (i) => {
        i.status = 'resolved';
        i.handledBy = ctx.userId;
        i.handledAt = new Date().toISOString();
      });
    },

    /**
     * 手工指定: what the sync could not decide, an HR administrator decides.
     *
     * - departmentAmbiguous: `departmentId` — one of the candidates — is bound
     *   to the directory department;
     * - unknownParentDepartment: `departmentId` is the parent the directory
     *   department is created under (and bound to);
     * - duplicateMatch: `employeeId` (one member, several employees) or
     *   `memberId` (one employee, several members) is the binding to keep.
     *
     * The next sync reconciles the bound record like any other.
     */
    async assignIssue(ctx: ActorContext, key: string, input: unknown) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'resolveIssues');
      const body = z
        .object({
          departmentId: z.string().min(1).max(64).optional(),
          employeeId: z.string().min(1).max(64).optional(),
          memberId: z.string().min(1).max(128).optional(),
        })
        .strict()
        .safeParse(input);
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const { provider } = (await readSettings()).value;
      const { issues } = await currentIssues();
      const issue = issues.find((i) => i.key === key);
      if (!issue || issue.status !== 'open')
        throw new HrError('ORG_SYNC_ISSUE_NOT_FOUND', 404);
      const stamp = new Date();
      const bindDepartment = async (localId: string, externalId: string) => {
        const taken = await database
          .query()
          .selectFrom('departments')
          .select(['id'])
          .where('externalProvider', '=', provider)
          .where('externalId', '=', externalId)
          .executeTakeFirst();
        if (taken) throw new HrError('ORG_SYNC_ALREADY_BOUND', 409);
        await database
          .query()
          .updateTable('departments')
          .set({
            externalProvider: provider,
            externalId,
            updatedAt: stamp,
          })
          .where('id', '=', localId)
          .execute();
      };
      const bindEmployee = async (employeeId: string, memberId: string) => {
        const rows = await database
          .query()
          .selectFrom('employees')
          .select(['id', 'externalProvider', 'externalUserId'])
          .where((eb) =>
            eb.or([
              eb('id', '=', employeeId),
              eb.and([
                eb('externalProvider', '=', provider),
                eb('externalUserId', '=', memberId),
              ]),
            ]),
          )
          .execute();
        const target = rows.find((r) => str(r.id) === employeeId);
        if (!target) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
        if (
          rows.some((r) => str(r.id) !== employeeId) ||
          (target.externalUserId && str(target.externalProvider) === provider)
        )
          throw new HrError('ORG_SYNC_ALREADY_BOUND', 409);
        await database
          .query()
          .updateTable('employees')
          .set({
            externalProvider: provider,
            externalUserId: memberId,
            updatedAt: stamp,
          })
          .where('id', '=', employeeId)
          .execute();
      };
      if (issue.type === 'departmentAmbiguous') {
        const candidates = Array.isArray(issue.detail.candidates)
          ? issue.detail.candidates.map(String)
          : [];
        const chosen = body.data.departmentId;
        if (!chosen || !candidates.includes(chosen))
          throw new HrError('ORG_SYNC_ASSIGN_NOT_CANDIDATE', 400);
        await bindDepartment(chosen, issue.externalId);
      } else if (issue.type === 'unknownParentDepartment') {
        const parentId = body.data.departmentId;
        if (!parentId) throw new HrError('INVALID_INPUT', 400);
        if (!(await organization.getDepartment(parentId)))
          throw new HrError('DEPARTMENT_PARENT_NOT_FOUND', 404);
        const name = str(issue.detail.name) || issue.externalId;
        const created = await organization.createDepartment({
          title: encodeAuthorizationTitle(name) ?? name,
          parentId,
        });
        await bindDepartment(created.id, issue.externalId);
      } else if (issue.type === 'duplicateMatch') {
        if (Array.isArray(issue.detail.candidates)) {
          // One member matched several employees: keep one employee.
          const ids = (issue.detail.candidates as { id?: unknown }[]).map((c) =>
            str(c.id),
          );
          const chosen = body.data.employeeId;
          if (!chosen || !ids.includes(chosen))
            throw new HrError('ORG_SYNC_ASSIGN_NOT_CANDIDATE', 400);
          await bindEmployee(chosen, issue.externalId);
        } else {
          // One employee matched by several members: keep one member.
          const members = Array.isArray(issue.detail.members)
            ? issue.detail.members.map(String)
            : [];
          const employee = issue.detail.employee as
            { id?: unknown } | undefined;
          const chosen = body.data.memberId;
          if (!chosen || !members.includes(chosen) || !employee?.id)
            throw new HrError('ORG_SYNC_ASSIGN_NOT_CANDIDATE', 400);
          await bindEmployee(str(employee.id), chosen);
        }
      } else throw new HrError('ORG_SYNC_ISSUE_NO_ACTION', 400);
      return mutateIssue(key, (i) => {
        i.status = 'resolved';
        i.handledBy = ctx.userId;
        i.handledAt = new Date().toISOString();
      });
    },

    /**
     * 开通账号 for an employee bound to an office-suite member but without a
     * NocoHR account (noAccount; 孙丽 in the demo): a login account named after
     * the member is created and linked, which also sets up the primary
     * department membership. Sign-in goes through the office suite, so the
     * random password is never shown. The directory's email is used unless
     * the member has none, when the administrator supplies one.
     */
    async createAccountFor(
      ctx: ActorContext,
      employeeId: string,
      input: unknown,
    ) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'resolveIssues');
      const body = z
        .object({ email: z.string().trim().email().max(191).optional() })
        .strict()
        .safeParse(input ?? {});
      if (!body.success) throw new HrError('INVALID_INPUT', 400);
      const settings = (await readSettings()).value;
      const row = await database
        .query()
        .selectFrom('employees')
        .select([
          'id',
          'name',
          'userId',
          'status',
          'departmentId',
          'externalProvider',
          'externalUserId',
        ])
        .where('id', '=', employeeId)
        .executeTakeFirst();
      if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      if (row.userId) throw new HrError('EMPLOYEE_USER_TAKEN', 409);
      if (row.status === 'leave')
        throw new HrError('ORG_SYNC_EMPLOYEE_LEFT', 409);
      if (
        !row.externalUserId ||
        str(row.externalProvider) !== settings.provider
      )
        throw new HrError('ORG_SYNC_NOT_BOUND', 409);
      const source = deps.source(settings.provider);
      const member = source
        ? (await source.fetch()).members.find(
            (m) => m.userId === str(row.externalUserId),
          )
        : undefined;
      const email = body.data.email ?? member?.email ?? null;
      if (!email) throw new HrError('ORG_SYNC_ACCOUNT_EMAIL_REQUIRED', 400);
      // The account is committed first; linking runs its own transaction and checks.
      // Account and link in one transaction. talent-service linkUser is not used:
      // it reads the user through the default connection inside its own
      // transaction, which waits forever on SQLite's single connection.
      const departmentId = str(row.departmentId);
      const account = await database.transaction(async (connection) => {
        const created = await deps.createAccount(
          {
            name: member?.name ?? str(row.name),
            email,
            password: `Sync#${newId()}`,
          },
          connection,
        );
        const current = await connection.query
          .selectFrom('employees')
          .select(['userId'])
          .where('id', '=', employeeId)
          .executeTakeFirst();
        if (current?.userId) throw new HrError('EMPLOYEE_USER_TAKEN', 409);
        await connection.query
          .updateTable('employees')
          .set({ userId: created.id, updatedAt: new Date() })
          .where('id', '=', employeeId)
          .execute();
        await organization.syncPrimaryMembership(
          created.id,
          departmentId,
          connection,
        );
        return created;
      });
      // The new account's department and position subjects apply on its first request.
      await deps.talent().notifyUsers([account.id]);
      const { issues } = await currentIssues();
      const open = issues.filter(
        (i) =>
          i.type === 'noAccount' &&
          i.employeeId === employeeId &&
          i.status === 'open',
      );
      for (const item of open)
        await mutateIssue(item.key, (i) => {
          i.status = 'resolved';
          i.handledBy = ctx.userId;
          i.handledAt = new Date().toISOString();
        });
      return { employeeId, userId: account.id };
    },

    /**
     * listSyncIssues for the HR assistant: the items of a run (default the
     * current ones) with what they refer to — the matched employee,
     * department and position by name, and existing mappings with a similar
     * title. Mobile numbers and email addresses are masked.
     */
    async assistantIssues(
      ctx: ActorContext,
      options: { syncRunId?: string; unexplainedOnly?: boolean } = {},
    ) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'view');
      let runId: string | null;
      let list: SyncIssue[];
      if (options.syncRunId) {
        const row = await database
          .query()
          .selectFrom('orgSyncRuns')
          .selectAll()
          .where('id', '=', options.syncRunId)
          .executeTakeFirst();
        if (!row) throw new HrError('ORG_SYNC_RUN_NOT_FOUND', 404);
        runId = options.syncRunId;
        list = issuesOf(row);
      } else ({ runId, issues: list } = await currentIssues());
      list = list.filter(
        (i) =>
          (i.status === 'open' || i.status === 'inProgress') &&
          (!options.unexplainedOnly || !i.aiExplainedAt),
      );
      const settings = (await readSettings()).value;
      const [departments, employees, positions, aliases] = await Promise.all([
        database
          .query()
          .selectFrom('departments')
          .select(['id', 'title'])
          .execute(),
        database
          .query()
          .selectFrom('employees')
          .select(['id', 'name', 'employeeNo', 'departmentId', 'positionId'])
          .execute(),
        database
          .query()
          .selectFrom('positions')
          .select(['id', 'title'])
          .execute(),
        database
          .query()
          .selectFrom('positionAliases')
          .select(['externalTitle', 'positionId', 'reviewStatus'])
          .where('provider', '=', settings.provider)
          .execute(),
      ]);
      const deptTitle = new Map(
        departments.map((d) => [
          str(d.id),
          organization.titleText(str(d.title), 'zh-CN'),
        ]),
      );
      const posTitle = new Map(positions.map((p) => [str(p.id), str(p.title)]));
      const byId = new Map(employees.map((e) => [str(e.id), e]));
      const similar = (title: string) => {
        const grams = (s: string) => {
          const v = normalizeTitle(s);
          const out = new Set<string>();
          for (let i = 0; i < v.length - 1; i++) out.add(v.slice(i, i + 2));
          return out;
        };
        const mine = grams(title);
        return aliases
          .filter((a) => {
            const theirs = grams(str(a.externalTitle));
            const shared = [...mine].filter((g) => theirs.has(g)).length;
            return (
              normalizeTitle(str(a.externalTitle)) !== normalizeTitle(title) &&
              shared > 0 &&
              shared / Math.max(1, Math.min(mine.size, theirs.size)) >= 0.5
            );
          })
          .slice(0, 5)
          .map((a) => ({
            externalTitle: str(a.externalTitle),
            position: posTitle.get(str(a.positionId)) ?? str(a.positionId),
            reviewStatus: str(a.reviewStatus),
          }));
      };
      return {
        runId,
        orgMaster: settings.orgMaster,
        provider: settings.provider,
        issues: list.map((i) => {
          const employee = i.employeeId ? byId.get(i.employeeId) : undefined;
          return {
            key: i.key,
            type: i.type,
            status: i.status,
            externalId: i.externalId,
            detail: maskedDetail(i.detail),
            employee: employee
              ? {
                  id: str(employee.id),
                  name: str(employee.name),
                  employeeNo: str(employee.employeeNo),
                  department: deptTitle.get(str(employee.departmentId)) ?? null,
                  position: employee.positionId
                    ? (posTitle.get(str(employee.positionId)) ?? null)
                    : null,
                }
              : null,
            department: i.departmentId
              ? (deptTitle.get(i.departmentId) ?? null)
              : null,
            similarMappings:
              i.type === 'unmappedTitle' && typeof i.detail.title === 'string'
                ? similar(i.detail.title)
                : [],
            aiExplanation: i.aiExplanation ?? null,
            aiSuggestedAction: i.aiSuggestedAction ?? null,
            actionId: i.actionId ?? null,
          };
        }),
      };
    },

    /** saveSyncIssueNotes from a conversation: notes only, as someone who may handle items. */
    async saveNotesAs(
      ctx: ActorContext,
      notes: readonly {
        key: string;
        aiExplanation: string;
        aiSuggestedAction: string;
      }[],
    ) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'resolveIssues');
      return service.saveNotes(notes);
    },

    /**
     * What the personnel action form is pre-filled with for an item: an
     * onboarding for a new member, a transfer or promotion for a mismatch,
     * an offboarding for a deactivated member. Only confirmed aliases fill a
     * position.
     */
    async prefill(ctx: ActorContext, key: string) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'resolveIssues');
      const settings = (await readSettings()).value;
      const { issues } = await currentIssues();
      const issue = issues.find((i) => i.key === key);
      if (!issue || issue.status !== 'open')
        throw new HrError('ORG_SYNC_ISSUE_NOT_FOUND', 404);
      const today = deps.currentDate();
      if (issue.type === 'newMember') {
        const source = deps.source(settings.provider);
        const member = source
          ? (await source.fetch()).members.find(
              (m) => m.userId === issue.externalId,
            )
          : undefined;
        const alias = member?.title
          ? await database
              .query()
              .selectFrom('positionAliases')
              .select(['positionId'])
              .where('provider', '=', settings.provider)
              .where('externalTitle', '=', member.title)
              .where('reviewStatus', '=', 'confirmed')
              .executeTakeFirst()
          : undefined;
        return {
          issueKey: key,
          actionType: 'onboard',
          effectiveDate: today,
          name: member?.name ?? str(issue.detail.name),
          employeeNo: member?.employeeNo ?? '',
          email: member?.email ?? '',
          mobile: member?.mobile ?? '',
          toDepartmentId: issue.detail.departmentId ?? null,
          toPositionId: alias ? str(alias.positionId) : null,
          createAccount: true,
          externalProvider: settings.provider,
          externalUserId: issue.externalId,
        };
      }
      if (issue.type === 'orgMismatch') {
        const to = issue.detail.to as {
          departmentId: string;
          positionId: string | null;
        };
        return {
          issueKey: key,
          actionType: str(issue.detail.suggestedAction),
          effectiveDate: today,
          employeeId: issue.employeeId,
          toDepartmentId: to.departmentId,
          toPositionId: to.positionId,
        };
      }
      if (issue.type === 'deactivatedMember')
        return {
          issueKey: key,
          actionType: 'offboard',
          employeeId: issue.employeeId,
          effectiveDate: toDateOnly(str(issue.detail.deactivatedAt)) ?? today,
          leaveReason: null,
        };
      throw new HrError('ORG_SYNC_ISSUE_NO_ACTION', 400);
    },

    /** Called when an action raised from an item is created: the item is in progress. */
    async linkAction(key: string, actionId: string) {
      await mutateIssue(key, (issue) => {
        if (issue.status !== 'open' || issue.actionId)
          throw new HrError('ORG_SYNC_ISSUE_HAS_ACTION', 409);
        issue.status = 'inProgress';
        issue.actionId = actionId;
      });
    },

    /** Checks an item may take a new action before one is created. */
    async assertIssueOpen(key: string) {
      const { issues } = await currentIssues();
      const issue = issues.find((i) => i.key === key);
      if (!issue) throw new HrError('ORG_SYNC_ISSUE_NOT_FOUND', 404);
      if (issue.status !== 'open' || issue.actionId)
        throw new HrError('ORG_SYNC_ISSUE_HAS_ACTION', 409);
    },

    async saveNotes(
      notes: readonly {
        key: string;
        aiExplanation: string;
        aiSuggestedAction: string;
      }[],
    ) {
      const { runId, issues } = await currentIssues();
      if (!runId) return 0;
      let saved = 0;
      const stamp = new Date().toISOString();
      for (const note of notes) {
        const issue = issues.find((i) => i.key === note.key);
        if (!issue) continue;
        issue.aiExplanation = note.aiExplanation.slice(0, 1000);
        issue.aiSuggestedAction = note.aiSuggestedAction.slice(0, 300);
        issue.aiExplainedAt = stamp;
        saved += 1;
      }
      await saveIssues(runId, issues);
      return saved;
    },

    /** syncLocked: a sync leaves this employee's department, position, manager and status alone. */
    async setSyncLock(ctx: ActorContext, employeeId: string, locked: unknown) {
      await authorizeAction(ctx.authz, ORG_SYNC, 'configure');
      if (typeof locked !== 'boolean') throw new HrError('INVALID_INPUT', 400);
      const row = await database
        .query()
        .selectFrom('employees')
        .select(['id'])
        .where('id', '=', employeeId)
        .executeTakeFirst();
      if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      await database
        .query()
        .updateTable('employees')
        .set({ syncLocked: locked, updatedAt: new Date() })
        .where('id', '=', employeeId)
        .execute();
      return { employeeId, syncLocked: locked };
    },

    /**
     * A directory callback: verified (a recent timestamp and the signature over it, server/http/signed-callback.ts),
     * deduplicated by event id, then an incremental sync.
     */
    async handleCallback(
      provider: string,
      raw: string,
      signature: string | undefined,
      timestamp?: string,
    ): Promise<'accepted' | 'duplicate'> {
      if (
        !callbackSignatureValid({
          secret: deps.callbackSecret(),
          raw,
          signature,
          timestamp,
          toleranceSeconds: deps.callbackToleranceSeconds?.() ?? 300,
        })
      )
        throw new HrError('ORG_SYNC_BAD_SIGNATURE', 403);
      let eventId: unknown;
      try {
        eventId = (JSON.parse(raw) as { eventId?: unknown }).eventId;
      } catch {
        throw new HrError('INVALID_INPUT', 400);
      }
      if (typeof eventId !== 'string' || !eventId)
        throw new HrError('INVALID_INPUT', 400);
      const key = `orgSync:event:${provider}:${eventId}`;
      try {
        const stamp = new Date();
        await database
          .query()
          .insertInto('hrReminderLog')
          .values({
            id: newId(),
            reminderKey: key,
            sentAt: stamp,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      } catch {
        return 'duplicate';
      }
      void run({ mode: 'incremental', triggeredBy: null }).catch(
        () => undefined,
      );
      return 'accepted';
    },
  };
  return service;
}

function addMonths(dateOnly: string, months: number): string {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}

export type OrgSyncService = ReturnType<typeof createOrgSyncService>;

/**
 * Helpers the knowledge, learning, exam and certification services share:
 * permission probes, user names, the people who hold a permission set's
 * settings item, department heads, one-time reminders and notifications.
 */
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import { tryAuthorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { OrganizationService } from './organization-service.js';
import { newId, today, str } from './shared.js';

export interface NotifyInput {
  /** Stable per recipient set and event, so a replay never sends twice. */
  readonly key: string;
  readonly userIds: readonly string[];
  /** A key under `notifications` in the server locales, with `title` and `body`. */
  readonly message: string;
  readonly params: Record<string, string>;
  readonly path?: string;
}
export type Notify = (input: NotifyInput) => Promise<void>;

export interface UserDirectory {
  get(id: string): Promise<{ id: string; name: string } | undefined>;
}

export interface PlatformDeps {
  readonly database: DatabaseManager;
  readonly authz: AppAuthorization;
  readonly organization: OrganizationService;
  readonly users: UserDirectory;
  readonly notify: Notify;
  readonly timeZone: string;
}

export interface EmployeeSummary {
  readonly id: string;
  readonly name: string;
  readonly userId: string | null;
  readonly departmentId: string;
  readonly positionId: string;
  readonly status: string;
}

export function createPlatform(deps: PlatformDeps) {
  const { database, authz, organization, users, notify, timeZone } = deps;
  const names = new Map<string, string>();

  const platform = {
    database,
    authz,
    organization,
    notify,
    timeZone,
    currentDate: (): string => today(timeZone),

    async can(
      ctx: ActorContext,
      resource: string,
      action: string,
    ): Promise<boolean> {
      return (
        (await tryAuthorizeAction(ctx.authz, resource, action)) !== undefined
      );
    },

    async userName(userId: string | null | undefined): Promise<string | null> {
      if (!userId) return null;
      const cached = names.get(userId);
      if (cached !== undefined) return cached;
      const user = await users.get(userId).catch(() => undefined);
      const name = user?.name ?? null;
      if (name) names.set(userId, name);
      return name;
    },

    async employee(
      id: string,
      connection?: DatabaseConnection,
    ): Promise<EmployeeSummary | undefined> {
      const row = await (connection ? connection.query : database.query())
        .selectFrom('employees')
        .select([
          'id',
          'name',
          'userId',
          'departmentId',
          'positionId',
          'status',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toSummary(row) : undefined;
    },

    async employeeOfUser(
      userId: string,
      connection?: DatabaseConnection,
    ): Promise<EmployeeSummary | undefined> {
      const row = await (connection ? connection.query : database.query())
        .selectFrom('employees')
        .select([
          'id',
          'name',
          'userId',
          'departmentId',
          'positionId',
          'status',
        ])
        .where('userId', '=', userId)
        .executeTakeFirst();
      return row ? toSummary(row) : undefined;
    },

    /** The head responsible for an employee's department, walking up past departments without one. */
    async headOf(
      employee: Pick<EmployeeSummary, 'departmentId' | 'userId'>,
    ): Promise<string | undefined> {
      const head = await organization.resolveHead(employee.departmentId);
      if (!head) return undefined;
      if (head.userId !== employee.userId) return head.userId;
      // An employee who heads their own department reports to the next head up.
      const department = await organization.getDepartment(head.departmentId);
      if (!department?.parentId) return undefined;
      const above = await organization.resolveHead(department.parentId);
      return above?.userId;
    },

    /** Every user holding a settings item action, directly or through an organisation subject. */
    async holdersOfSettings(
      settingsId: string,
      action: string,
    ): Promise<string[]> {
      const result = new Set<string>();
      for (const set of await authz.permissionSets.list()) {
        const grants = set.grants.some(
          (grant) =>
            grant.resource.type === 'settings' &&
            grant.resource.id === settingsId &&
            grant.actions.some((a) => a.action === action),
        );
        if (!grants) continue;
        for (const assignment of await authz.permissionSets.listAssignments(
          set.key,
        )) {
          const { type, id } = assignment.subject;
          if (type === 'user') result.add(id);
          else if (type === 'org.position') {
            // hr.admin is assigned to the "HR 专员" position: everyone currently on it.
            for (const row of await database
              .query()
              .selectFrom('employees')
              .select(['userId'])
              .where('positionId', '=', id)
              .where('status', '!=', 'leave')
              .execute())
              if (row.userId) result.add(str(row.userId));
          } else if (type === 'org.department') {
            for (const departmentId of await organization.descendantsOf(id)) {
              for (const member of await organization.directMembers(
                departmentId,
              ))
                result.add(member.userId);
            }
          }
        }
      }
      return [...result];
    },

    /** Sends a reminder once per key; answers whether it was sent now. */
    async reminderOnce(
      key: string,
      send: () => Promise<void>,
    ): Promise<boolean> {
      const existing = await database
        .query()
        .selectFrom('hrReminderLog')
        .select(['id'])
        .where('reminderKey', '=', key)
        .executeTakeFirst();
      if (existing) return false;
      await send();
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
      return true;
    },
  };
  return platform;
}

export type Platform = ReturnType<typeof createPlatform>;

function toSummary(row: Record<string, unknown>): EmployeeSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    userId: row.userId == null ? null : str(row.userId),
    departmentId: String(row.departmentId),
    positionId: String(row.positionId),
    status: String(row.status),
  };
}

/** Normalizes a stored boolean, which SQLite returns as 0 or 1. */
export function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

/** Reads a JSON column that the query adapter may return as a string, possibly encoded twice. */
export function json<T>(value: unknown, fallback: T): T {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1) {
    try {
      current = JSON.parse(current);
    } catch {
      // Text that is not JSON is the decoded value itself: a JSON column holding a string, such as a
      // single-choice answer "C", arrives as `"C"` or already as `C`.
      break;
    }
  }
  return current === null || current === undefined ? fallback : (current as T);
}

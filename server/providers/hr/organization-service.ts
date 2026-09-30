import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import type { SubjectOption } from '@nocobase/app-plugin-authorization/server';
import {
  decodeAuthorizationTitle,
  encodeAuthorizationTitle,
} from '@nocobase/authorization/core';

import { HrError, newId } from './shared.js';

export interface Department {
  readonly id: string;
  readonly code: string | null;
  readonly title: string;
  readonly parentId: string | null;
  readonly managerId: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface DirectMember {
  readonly userId: string;
  readonly primary: boolean;
}

/** Translations of seeded department titles, for literal search in every language. */
export interface DepartmentTitleTranslations {
  readonly [locale: string]: Readonly<Record<string, string>>;
}

export interface OrganizationService {
  listTree(connection?: DatabaseConnection): Promise<readonly Department[]>;
  getDepartment(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<Department | undefined>;
  createDepartment(input: {
    id?: string;
    code?: string | null;
    title: string;
    parentId?: string | null;
    managerId?: string | null;
    sortOrder?: number;
  }): Promise<Department>;
  updateDepartment(
    id: string,
    input: {
      code?: string | null;
      title?: string;
      parentId?: string | null;
      managerId?: string | null;
      sortOrder?: number;
    },
  ): Promise<{ department: Department; changed: readonly string[] }>;
  listDepartments(query: {
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: readonly SubjectOption[]; total: number }>;
  resolveDepartments(ids: readonly string[]): Promise<readonly SubjectOption[]>;
  activeChain(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[] | undefined>;
  filterActive(
    ids: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  departmentsOf(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Departments the user heads whose whole chain is active. */
  headedBy(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** Headed departments plus every active descendant. */
  managedDepartments(
    userId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** The department and its active descendants. */
  descendantsOf(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  /** The head of the department, or of the nearest ancestor that has one. */
  resolveHead(
    departmentId: string,
    connection?: DatabaseConnection,
  ): Promise<{ userId: string; departmentId: string } | undefined>;
  directMembers(departmentId: string): Promise<readonly DirectMember[]>;
  addMember(
    input: { departmentId: string; userId: string; primary?: boolean },
    connection?: DatabaseConnection,
  ): Promise<readonly string[]>;
  removeMember(
    departmentId: string,
    userId: string,
  ): Promise<readonly string[]>;
  setPrimary(departmentId: string, userId: string): Promise<readonly string[]>;
  /** Makes `departmentId` the user's active primary membership; used by employee writes. */
  syncPrimaryMembership(
    userId: string,
    departmentId: string,
    connection: DatabaseConnection,
  ): Promise<void>;
  /** Disables every membership of the user; used when an employee leaves. */
  deactivateMemberships(
    userId: string,
    connection: DatabaseConnection,
  ): Promise<void>;
  setActive(departmentId: string, active: boolean): Promise<readonly string[]>;
  /** Plain text of a stored title in one locale, for exports and search. */
  titleText(title: string, locale?: string): string;
}

interface DepartmentRow {
  id: string;
  code: string | null;
  title: string;
  parentId: string | null;
  managerId: string | null;
  active: boolean | number;
  sortOrder: number;
}

function toDepartment(row: DepartmentRow): Department {
  return {
    id: String(row.id),
    code: row.code === null || row.code === undefined ? null : String(row.code),
    title: String(row.title),
    parentId:
      row.parentId === null || row.parentId === undefined
        ? null
        : String(row.parentId),
    managerId:
      row.managerId === null || row.managerId === undefined
        ? null
        : String(row.managerId),
    active: Boolean(row.active),
    sortOrder: Number(row.sortOrder ?? 0),
  };
}

export function createOrganizationService(
  database: DatabaseManager,
  translations: DepartmentTitleTranslations,
): OrganizationService {
  const q = (connection?: DatabaseConnection) =>
    connection ? connection.query : database.query();

  async function loadTree(
    connection?: DatabaseConnection,
  ): Promise<Map<string, Department>> {
    const rows = await q(connection)
      .selectFrom('departments')
      .select([
        'id',
        'code',
        'title',
        'parentId',
        'managerId',
        'active',
        'sortOrder',
      ])
      .execute();
    const map = new Map<string, Department>();
    for (const row of rows as unknown as DepartmentRow[])
      map.set(String(row.id), toDepartment(row));
    return map;
  }

  /** Ancestors nearest first; `undefined` when any node in the chain is inactive or missing, or a cycle is found. */
  function chainOf(
    tree: Map<string, Department>,
    id: string,
  ): string[] | undefined {
    const chain: string[] = [];
    const seen = new Set<string>();
    let current: string | null = id;
    while (current) {
      if (seen.has(current)) return undefined;
      seen.add(current);
      const node = tree.get(current);
      if (!node || !node.active) return undefined;
      chain.push(node.id);
      current = node.parentId;
    }
    return chain;
  }

  function activeDescendants(
    tree: Map<string, Department>,
    roots: readonly string[],
  ): string[] {
    const childrenOf = new Map<string, string[]>();
    for (const node of tree.values()) {
      if (!node.parentId) continue;
      const list = childrenOf.get(node.parentId) ?? [];
      list.push(node.id);
      childrenOf.set(node.parentId, list);
    }
    const result = new Set<string>();
    const stack = [...roots];
    while (stack.length) {
      const id = stack.pop()!;
      if (result.has(id)) continue;
      const node = tree.get(id);
      if (!node || !node.active) continue;
      result.add(id);
      for (const child of childrenOf.get(id) ?? []) stack.push(child);
    }
    return [...result];
  }

  function titleText(title: string, locale = 'zh-CN'): string {
    let decoded: ReturnType<typeof decodeAuthorizationTitle>;
    try {
      decoded = decodeAuthorizationTitle(title);
    } catch {
      // A title written as plain text rather than an encoded one: show it as is.
      return title;
    }
    if (typeof decoded === 'string') return decoded;
    if (decoded && typeof decoded === 'object') {
      const key = decoded.key;
      return translations[locale]?.[key] ?? translations['en-US']?.[key] ?? key;
    }
    return title;
  }

  function matches(department: Department, search: string): boolean {
    const needle = search.toLowerCase();
    const decoded = decodeAuthorizationTitle(department.title);
    if (typeof decoded === 'string')
      return decoded.toLowerCase().includes(needle);
    if (decoded && typeof decoded === 'object') {
      return Object.values(translations).some((locale) =>
        (locale[decoded.key] ?? '').toLowerCase().includes(needle),
      );
    }
    return department.title.toLowerCase().includes(needle);
  }

  function option(
    tree: Map<string, Department>,
    department: Department,
  ): SubjectOption {
    const parent = department.parentId
      ? tree.get(department.parentId)
      : undefined;
    const description = !department.active
      ? { key: 'departments.disabled', ns: 'hr' }
      : parent
        ? (decodeAuthorizationTitle(parent.title) ?? parent.title)
        : undefined;
    return {
      id: department.id,
      title: decodeAuthorizationTitle(department.title) ?? department.title,
      ...(description ? { description } : {}),
    };
  }

  async function membershipUsers(
    departmentIds: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<string[]> {
    if (!departmentIds.length) return [];
    const rows = await q(connection)
      .selectFrom('departmentMembers')
      .select(['userId'])
      .where('active', '=', true)
      .where('departmentId', 'in', [...departmentIds])
      .execute();
    return [...new Set(rows.map((row) => String(row.userId)))];
  }

  const service: OrganizationService = {
    async listTree(connection) {
      const tree = await loadTree(connection);
      return [...tree.values()].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id),
      );
    },
    async getDepartment(id, connection) {
      const row = await q(connection)
        .selectFrom('departments')
        .select([
          'id',
          'code',
          'title',
          'parentId',
          'managerId',
          'active',
          'sortOrder',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      return row ? toDepartment(row as unknown as DepartmentRow) : undefined;
    },
    async createDepartment(input) {
      const id = input.id ?? newId();
      const now = new Date();
      return database.transaction(async (connection) => {
        if (input.parentId) {
          const parent = await service.getDepartment(
            input.parentId,
            connection,
          );
          if (!parent) throw new HrError('DEPARTMENT_PARENT_NOT_FOUND', 404);
        }
        if (input.code) {
          const existing = await connection.query
            .selectFrom('departments')
            .select(['id'])
            .where('code', '=', input.code)
            .executeTakeFirst();
          if (existing) throw new HrError('DEPARTMENT_CODE_TAKEN', 409);
        }
        await connection.query
          .insertInto('departments')
          .values({
            id,
            code: input.code ?? null,
            title: input.title,
            parentId: input.parentId ?? null,
            managerId: input.managerId ?? null,
            active: true,
            sortOrder: input.sortOrder ?? 0,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        return (await service.getDepartment(id, connection))!;
      });
    },
    async updateDepartment(id, input) {
      return database.transaction(async (connection) => {
        const tree = await loadTree(connection);
        const current = tree.get(id);
        if (!current) throw new HrError('DEPARTMENT_NOT_FOUND', 404);
        const changed = new Set<string>();
        const values: Record<string, unknown> = { updatedAt: new Date() };
        if (input.title !== undefined) values.title = input.title;
        if (input.sortOrder !== undefined) values.sortOrder = input.sortOrder;
        if (input.code !== undefined) {
          if (input.code) {
            const existing = [...tree.values()].find(
              (d) => d.code === input.code && d.id !== id,
            );
            if (existing) throw new HrError('DEPARTMENT_CODE_TAKEN', 409);
          }
          values.code = input.code ?? null;
        }
        if (input.parentId !== undefined) {
          const parentId = input.parentId ?? null;
          if (parentId === id) throw new HrError('DEPARTMENT_CYCLE', 400);
          if (parentId) {
            if (!tree.has(parentId))
              throw new HrError('DEPARTMENT_PARENT_NOT_FOUND', 404);
            // Walking up from the new parent must never reach this department.
            let cursor: string | null = parentId;
            const seen = new Set<string>();
            while (cursor) {
              if (cursor === id) throw new HrError('DEPARTMENT_CYCLE', 400);
              if (seen.has(cursor)) break;
              seen.add(cursor);
              cursor = tree.get(cursor)?.parentId ?? null;
            }
          }
          if (parentId !== current.parentId) {
            values.parentId = parentId;
            for (const user of await membershipUsers(
              activeDescendants(tree, [id]),
              connection,
            ))
              changed.add(user);
          }
        }
        if (
          input.managerId !== undefined &&
          (input.managerId ?? null) !== current.managerId
        ) {
          values.managerId = input.managerId ?? null;
          if (current.managerId) changed.add(current.managerId);
          if (input.managerId) changed.add(input.managerId);
        }
        await connection.query
          .updateTable('departments')
          .set(values)
          .where('id', '=', id)
          .execute();
        const department = (await service.getDepartment(id, connection))!;
        return { department, changed: [...changed] };
      });
    },
    async listDepartments({ search, page, pageSize }) {
      const tree = await loadTree();
      const all = [...tree.values()]
        .filter((d) => chainOf(tree, d.id) !== undefined)
        .filter((d) => !search || matches(d, search))
        .sort(
          (a, b) =>
            titleText(a.title).localeCompare(titleText(b.title)) ||
            a.id.localeCompare(b.id),
        );
      const start = (Math.max(page, 1) - 1) * pageSize;
      return {
        items: all.slice(start, start + pageSize).map((d) => option(tree, d)),
        total: all.length,
      };
    },
    async resolveDepartments(ids) {
      const tree = await loadTree();
      return ids.flatMap((id) => {
        const department = tree.get(id);
        return department ? [option(tree, department)] : [];
      });
    },
    async activeChain(departmentId, connection) {
      return chainOf(await loadTree(connection), departmentId);
    },
    async filterActive(ids, connection) {
      const tree = await loadTree(connection);
      return ids.filter((id) => chainOf(tree, id) !== undefined);
    },
    async departmentsOf(userId, connection) {
      const rows = await q(connection)
        .selectFrom('departmentMembers')
        .select(['departmentId'])
        .where('userId', '=', userId)
        .where('active', '=', true)
        .execute();
      const tree = await loadTree(connection);
      const result = new Set<string>();
      for (const row of rows) {
        const chain = chainOf(tree, String(row.departmentId));
        if (chain) for (const id of chain) result.add(id);
      }
      return [...result];
    },
    async headedBy(userId, connection) {
      const tree = await loadTree(connection);
      return [...tree.values()]
        .filter(
          (d) => d.managerId === userId && chainOf(tree, d.id) !== undefined,
        )
        .map((d) => d.id);
    },
    async managedDepartments(userId, connection) {
      const tree = await loadTree(connection);
      const headed = [...tree.values()]
        .filter(
          (d) => d.managerId === userId && chainOf(tree, d.id) !== undefined,
        )
        .map((d) => d.id);
      return activeDescendants(tree, headed);
    },
    async descendantsOf(departmentId, connection) {
      const tree = await loadTree(connection);
      if (chainOf(tree, departmentId) === undefined) return [];
      return activeDescendants(tree, [departmentId]);
    },
    async resolveHead(departmentId, connection) {
      const tree = await loadTree(connection);
      let cursor: string | null = departmentId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        const node = tree.get(cursor);
        if (!node) return undefined;
        if (node.managerId)
          return { userId: node.managerId, departmentId: node.id };
        cursor = node.parentId;
      }
      return undefined;
    },
    async directMembers(departmentId) {
      const rows = await database
        .query()
        .selectFrom('departmentMembers')
        .select(['userId', 'primary'])
        .where('departmentId', '=', departmentId)
        .where('active', '=', true)
        .execute();
      return rows.map((row) => ({
        userId: String(row.userId),
        primary: Boolean(row.primary),
      }));
    },
    async addMember(input, connection) {
      const run = async (c: DatabaseConnection) => {
        const department = await service.getDepartment(input.departmentId, c);
        if (!department) throw new HrError('DEPARTMENT_NOT_FOUND', 404);
        const now = new Date();
        const existing = await c.query
          .selectFrom('departmentMembers')
          .select(['id', 'active'])
          .where('departmentId', '=', input.departmentId)
          .where('userId', '=', input.userId)
          .executeTakeFirst();
        if (input.primary) {
          await c.query
            .updateTable('departmentMembers')
            .set({ primary: false, updatedAt: now })
            .where('userId', '=', input.userId)
            .execute();
        }
        if (existing) {
          await c.query
            .updateTable('departmentMembers')
            .set({
              active: true,
              primary: Boolean(input.primary),
              updatedAt: now,
            })
            .where('id', '=', String(existing.id))
            .execute();
        } else {
          await c.query
            .insertInto('departmentMembers')
            .values({
              id: newId(),
              departmentId: input.departmentId,
              userId: input.userId,
              primary: Boolean(input.primary),
              active: true,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        }
        return [input.userId];
      };
      return connection ? run(connection) : database.transaction(run);
    },
    async removeMember(departmentId, userId) {
      await database
        .query()
        .updateTable('departmentMembers')
        .set({ active: false, primary: false, updatedAt: new Date() })
        .where('departmentId', '=', departmentId)
        .where('userId', '=', userId)
        .execute();
      return [userId];
    },
    async setPrimary(departmentId, userId) {
      await database.transaction(async (connection) => {
        const now = new Date();
        await connection.query
          .updateTable('departmentMembers')
          .set({ primary: false, updatedAt: now })
          .where('userId', '=', userId)
          .execute();
        await connection.query
          .updateTable('departmentMembers')
          .set({ primary: true, active: true, updatedAt: now })
          .where('departmentId', '=', departmentId)
          .where('userId', '=', userId)
          .execute();
      });
      return [userId];
    },
    async syncPrimaryMembership(userId, departmentId, connection) {
      await service.addMember(
        { departmentId, userId, primary: true },
        connection,
      );
    },
    async deactivateMemberships(userId, connection) {
      await connection.query
        .updateTable('departmentMembers')
        .set({ active: false, primary: false, updatedAt: new Date() })
        .where('userId', '=', userId)
        .execute();
    },
    async setActive(departmentId, active) {
      return database.transaction(async (connection) => {
        const tree = await loadTree(connection);
        if (!tree.has(departmentId))
          throw new HrError('DEPARTMENT_NOT_FOUND', 404);
        await connection.query
          .updateTable('departments')
          .set({ active, updatedAt: new Date() })
          .where('id', '=', departmentId)
          .execute();
        // The subtree is affected either way: disabling cuts it off, enabling restores it.
        const subtree = activeDescendants(
          new Map(
            [...tree.entries()].map(([id, d]) => [
              id,
              id === departmentId ? { ...d, active: true } : d,
            ]),
          ),
          [departmentId],
        );
        const heads = subtree
          .map((id) => tree.get(id)?.managerId)
          .filter((id): id is string => Boolean(id));
        return [
          ...new Set([
            ...(await membershipUsers(subtree, connection)),
            ...heads,
          ]),
        ];
      });
    },
    titleText,
  };

  return service;
}

export function encodeSeededTitle(key: string): string {
  return encodeAuthorizationTitle({ key, ns: 'hr' }) ?? key;
}

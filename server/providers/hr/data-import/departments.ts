/**
 * 部门导入: the department tree from Excel, created or updated by 部门编码.
 *
 * - A parent may be named before or after its child in the file; the whole
 *   tree, the file's departments over the existing ones, is resolved in the
 *   preview, which flags unknown parents and cycles.
 * - 负责人工号 names an employee with a login account: the head is a user.
 * - A title that reads the same as the stored one keeps the stored title, so
 *   a seeded department keeps its translations.
 * - The import does not enable or disable departments, and leaves those with
 *   no code alone. Department custom fields have no import placement.
 * - While the office suite's directory is the data master (组织同步
 *   `orgMaster=external`), departments come from the directory and the
 *   import is refused.
 */
import type { DatabaseConnection } from '@nocobase/db';

import type { OrganizationService } from '../organization-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  assertNoErrors,
  buildTemplate,
  newBatchId,
  readSheet,
  recordBatch,
  rowsFromBody,
  summarize,
  type ImportColumn,
  type ImportPreview,
  type ImportRow,
} from './shared.js';
import type { DataImportDeps } from './types.js';

type Key = 'code' | 'title' | 'parentCode' | 'managerNo' | 'sortOrder';

export const DEPARTMENT_COLUMNS: readonly ImportColumn<Key>[] = [
  {
    key: 'code',
    title: '部门编码',
    titleEn: 'Department code',
    required: true,
  },
  {
    key: 'title',
    title: '部门名称',
    titleEn: 'Department name',
    required: true,
  },
  {
    key: 'parentCode',
    title: '上级部门编码',
    titleEn: 'Parent department code',
  },
  { key: 'managerNo', title: '负责人工号', titleEn: 'Head employee no.' },
  { key: 'sortOrder', title: '排序', titleEn: 'Sort order' },
];

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

interface StoredDepartment {
  id: string;
  code: string | null;
  title: string;
  parentId: string | null;
  managerId: string | null;
  sortOrder: number;
}

export function createDepartmentImport(deps: DataImportDeps) {
  const { database } = deps;

  async function assertNotExternal(): Promise<void> {
    if ((await deps.orgMaster()) === 'external')
      throw new HrError('IMPORT_ORG_MASTER_EXTERNAL', 409);
  }

  async function stored(
    connection?: DatabaseConnection,
  ): Promise<StoredDepartment[]> {
    const q = connection ? connection.query : database.query();
    const rows = await q
      .selectFrom('departments')
      .select(['id', 'code', 'title', 'parentId', 'managerId', 'sortOrder'])
      .execute();
    return rows.map((r) => ({
      id: str(r.id),
      code: r.code ? str(r.code) : null,
      title: str(r.title),
      parentId: r.parentId ? str(r.parentId) : null,
      managerId: r.managerId ? str(r.managerId) : null,
      sortOrder: Number(r.sortOrder ?? 0),
    }));
  }

  async function validate(rows: ImportRow<Key>[]): Promise<ImportPreview<Key>> {
    const organization: OrganizationService = deps.organization();
    const departments = await stored();
    const byCode = new Map(
      departments.filter((d) => d.code).map((d) => [d.code!, d]),
    );
    const byId = new Map(departments.map((d) => [d.id, d]));
    const employees = await database
      .query()
      .selectFrom('employees')
      .select(['employeeNo', 'userId'])
      .execute();
    const userByNo = new Map(
      employees.map((e) => [str(e.employeeNo), e.userId ? str(e.userId) : '']),
    );
    const counts = new Map<string, number>();
    for (const row of rows)
      if (row.cells.code)
        counts.set(row.cells.code, (counts.get(row.cells.code) ?? 0) + 1);
    const fileRows = new Map(
      rows.filter((r) => r.cells.code).map((r) => [r.cells.code, r]),
    );
    // The tree after the import: nodes by code (`#id` for a stored department without one).
    const parentOf = (key: string): string | null => {
      const row = key.startsWith('#') ? undefined : fileRows.get(key);
      if (row) return row.cells.parentCode || null;
      const department = key.startsWith('#')
        ? byId.get(key.slice(1))
        : byCode.get(key);
      if (!department?.parentId) return null;
      const parent = byId.get(department.parentId);
      if (!parent) return null;
      return parent.code ?? `#${parent.id}`;
    };
    for (const row of rows) {
      const { code, title, parentCode, managerNo, sortOrder } = row.cells;
      const errors = row.errors;
      if (!code) errors.push({ column: 'code', code: 'REQUIRED' });
      else if (code.length > 64 || !CODE.test(code))
        errors.push({ column: 'code', code: 'CODE_INVALID' });
      else if ((counts.get(code) ?? 0) > 1)
        errors.push({ column: 'code', code: 'DUPLICATE_IN_FILE' });
      if (!title) errors.push({ column: 'title', code: 'REQUIRED' });
      else if (title.length > 200)
        errors.push({ column: 'title', code: 'TOO_LONG' });
      if (parentCode) {
        if (parentCode === code)
          errors.push({ column: 'parentCode', code: 'DEPARTMENT_CYCLE' });
        else if (!fileRows.has(parentCode) && !byCode.has(parentCode))
          errors.push({ column: 'parentCode', code: 'PARENT_NOT_FOUND' });
        else if (code) {
          // Walking up from the parent must never come back to this department.
          const seen = new Set<string>();
          let cursor: string | null = parentCode;
          while (cursor && !seen.has(cursor)) {
            if (cursor === code) {
              errors.push({ column: 'parentCode', code: 'DEPARTMENT_CYCLE' });
              break;
            }
            seen.add(cursor);
            cursor = parentOf(cursor);
          }
        }
      }
      if (managerNo) {
        const userId = userByNo.get(managerNo);
        if (userId === undefined)
          errors.push({ column: 'managerNo', code: 'EMPLOYEE_NOT_FOUND' });
        else if (!userId)
          errors.push({ column: 'managerNo', code: 'MANAGER_NO_ACCOUNT' });
      }
      if (sortOrder && !/^-?\d{1,6}$/u.test(sortOrder))
        errors.push({ column: 'sortOrder', code: 'INTEGER_INVALID' });
      const current = code ? byCode.get(code) : undefined;
      if (!current) row.action = 'create';
      else {
        const parent = parentCode ? byCode.get(parentCode) : undefined;
        const same =
          organization.titleText(current.title) === title &&
          (parentCode
            ? parent !== undefined && current.parentId === parent.id
            : current.parentId === null) &&
          (!managerNo || current.managerId === userByNo.get(managerNo)) &&
          (!sortOrder || current.sortOrder === Number(sortOrder));
        row.action = same ? 'unchanged' : 'update';
      }
    }
    return summarize(rows);
  }

  return {
    columns: DEPARTMENT_COLUMNS,

    template(): Buffer {
      return buildTemplate(
        DEPARTMENT_COLUMNS,
        [
          ['D01', '总部', '', '', '1'],
          ['D0101', '人力资源部', 'D01', '', '1'],
          ['D0102', '财务部', 'D01', '', '2'],
        ],
        'departments',
      );
    },

    async preview(file: Buffer): Promise<ImportPreview<Key>> {
      await assertNotExternal();
      return validate(readSheet(file, DEPARTMENT_COLUMNS));
    },

    async commit(
      userId: string,
      body: unknown,
    ): Promise<{
      batchId: string;
      created: number;
      updated: number;
      unchanged: number;
      changedUserIds: string[];
    }> {
      await assertNotExternal();
      const preview = await validate(rowsFromBody(body, DEPARTMENT_COLUMNS));
      assertNoErrors(preview);
      const organization = deps.organization();
      const batchId = newBatchId('departments', deps.currentDate());
      const employees = await database
        .query()
        .selectFrom('employees')
        .select(['employeeNo', 'userId'])
        .execute();
      const userByNo = new Map(
        employees
          .filter((e) => e.userId)
          .map((e) => [str(e.employeeNo), str(e.userId)]),
      );
      return database.transaction(async (connection) => {
        const before = await stored(connection);
        const byCode = new Map(
          before.filter((d) => d.code).map((d) => [d.code!, d]),
        );
        const stamp = new Date();
        const created: string[] = [];
        const updated: string[] = [];
        const movedIds: string[] = [];
        const managers = new Set<string>();
        const work = preview.rows.filter((r) => r.action !== 'unchanged');
        // New departments first, without a parent, so every code exists before parents are set.
        for (const row of work) {
          if (byCode.has(row.cells.code)) continue;
          const id = newId();
          await connection.query
            .insertInto('departments')
            .values({
              id,
              code: row.cells.code,
              title: row.cells.title,
              parentId: null,
              managerId: null,
              active: true,
              sortOrder: row.cells.sortOrder ? Number(row.cells.sortOrder) : 0,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
          byCode.set(row.cells.code, {
            id,
            code: row.cells.code,
            title: row.cells.title,
            parentId: null,
            managerId: null,
            sortOrder: 0,
          });
          created.push(id);
        }
        const createdSet = new Set(created);
        for (const row of work) {
          const department = byCode.get(row.cells.code)!;
          const values: Record<string, unknown> = { updatedAt: stamp };
          const parentId = row.cells.parentCode
            ? byCode.get(row.cells.parentCode)!.id
            : null;
          if (parentId !== department.parentId) {
            values.parentId = parentId;
            if (!createdSet.has(department.id)) movedIds.push(department.id);
          }
          if (organization.titleText(department.title) !== row.cells.title)
            values.title = row.cells.title;
          if (row.cells.sortOrder)
            values.sortOrder = Number(row.cells.sortOrder);
          if (row.cells.managerNo) {
            const managerId = userByNo.get(row.cells.managerNo) ?? null;
            if (managerId !== department.managerId) {
              values.managerId = managerId;
              if (department.managerId) managers.add(department.managerId);
              if (managerId) managers.add(managerId);
            }
          }
          await connection.query
            .updateTable('departments')
            .set(values)
            .where('id', '=', department.id)
            .execute();
          if (!createdSet.has(department.id)) updated.push(department.id);
        }
        // A moved department changes what its members' department-based permissions inherit.
        const changed = new Set(managers);
        if (movedIds.length) {
          const tree = await organization.listTree(connection);
          const childrenOf = new Map<string, string[]>();
          for (const node of tree)
            if (node.parentId)
              childrenOf.set(node.parentId, [
                ...(childrenOf.get(node.parentId) ?? []),
                node.id,
              ]);
          const subtree = new Set<string>();
          const stack = [...movedIds];
          while (stack.length) {
            const id = stack.pop()!;
            if (subtree.has(id)) continue;
            subtree.add(id);
            stack.push(...(childrenOf.get(id) ?? []));
          }
          const members = await connection.query
            .selectFrom('departmentMembers')
            .select(['userId'])
            .where('active', '=', true)
            .where('departmentId', 'in', [...subtree])
            .execute();
          for (const m of members) changed.add(str(m.userId));
        }
        await recordBatch(connection, {
          id: batchId,
          kind: 'departments',
          userId,
          created,
          updated,
          unchanged: preview.unchanged,
        });
        return {
          batchId,
          created: created.length,
          updated: updated.length,
          unchanged: preview.unchanged,
          changedUserIds: [...changed],
        };
      });
    },

    async count(): Promise<number> {
      return database
        .repository('departments')
        .count({ filter: { active: true } });
    },
  };
}

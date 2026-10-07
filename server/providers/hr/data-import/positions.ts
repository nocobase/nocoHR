/**
 * 岗位导入: positions from Excel, created or updated by 岗位编码.
 *
 * - 岗位序列 names a job family by its title or code; a title that matches
 *   none creates the family with the import (the preview lists them).
 * - 职级 and 所属部门编码 are optional; an empty cell leaves the stored value
 *   alone, so a partial file does not erase data. The department is matched
 *   by its code.
 * - Responsibilities, job descriptions, requirements and custom fields are
 *   left as they are; positions have no custom-field import placement.
 */
import type { DatabaseConnection } from '@nocobase/db';

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

type Key = 'code' | 'title' | 'family' | 'grade' | 'departmentCode';

export const POSITION_COLUMNS: readonly ImportColumn<Key>[] = [
  { key: 'code', title: '岗位编码', titleEn: 'Position code', required: true },
  { key: 'title', title: '岗位名称', titleEn: 'Position name', required: true },
  { key: 'family', title: '岗位序列', titleEn: 'Job family', required: true },
  { key: 'grade', title: '职级', titleEn: 'Grade' },
  {
    key: 'departmentCode',
    title: '所属部门编码',
    titleEn: 'Department code',
  },
];

const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
/** Family titles compare without spacing and letter case. */
const titleKey = (title: string) => title.replace(/\s+/gu, '').toLowerCase();

export interface PositionPreview extends ImportPreview<Key> {
  /** Job family titles the import will create. */
  readonly newFamilies: string[];
}

export function createPositionImport(deps: DataImportDeps) {
  const { database } = deps;

  async function lookups(connection?: DatabaseConnection) {
    const q = () => (connection ? connection.query : database.query());
    const [families, positions, departments] = await Promise.all([
      q().selectFrom('jobFamilies').select(['id', 'code', 'title']).execute(),
      q()
        .selectFrom('positions')
        .select(['id', 'code', 'title', 'jobFamilyId', 'grade', 'departmentId'])
        .execute(),
      q().selectFrom('departments').select(['id', 'code']).execute(),
    ]);
    const familyByKey = new Map<string, string>();
    for (const f of families) {
      familyByKey.set(titleKey(str(f.title)), str(f.id));
      if (f.code) familyByKey.set(`code:${str(f.code)}`, str(f.id));
    }
    return {
      familyOf: (cell: string) =>
        familyByKey.get(`code:${cell}`) ?? familyByKey.get(titleKey(cell)),
      positionByCode: new Map(positions.map((p) => [str(p.code), p])),
      departmentByCode: new Map(
        departments.filter((d) => d.code).map((d) => [str(d.code), str(d.id)]),
      ),
    };
  }

  async function validate(rows: ImportRow<Key>[]): Promise<PositionPreview> {
    const { familyOf, positionByCode, departmentByCode } = await lookups();
    const counts = new Map<string, number>();
    for (const row of rows)
      if (row.cells.code)
        counts.set(row.cells.code, (counts.get(row.cells.code) ?? 0) + 1);
    const newFamilies: string[] = [];
    for (const row of rows) {
      const { code, title, family, grade, departmentCode } = row.cells;
      const errors = row.errors;
      if (!code) errors.push({ column: 'code', code: 'REQUIRED' });
      else if (code.length > 64 || !CODE.test(code))
        errors.push({ column: 'code', code: 'CODE_INVALID' });
      else if ((counts.get(code) ?? 0) > 1)
        errors.push({ column: 'code', code: 'DUPLICATE_IN_FILE' });
      if (!title) errors.push({ column: 'title', code: 'REQUIRED' });
      else if (title.length > 200)
        errors.push({ column: 'title', code: 'TOO_LONG' });
      let familyId: string | undefined;
      if (!family) errors.push({ column: 'family', code: 'REQUIRED' });
      else if (family.length > 200)
        errors.push({ column: 'family', code: 'TOO_LONG' });
      else {
        familyId = familyOf(family);
        if (
          !familyId &&
          !newFamilies.some((t) => titleKey(t) === titleKey(family))
        )
          newFamilies.push(family.replace(/\s+/gu, ' ').trim());
      }
      if (grade.length > 32) errors.push({ column: 'grade', code: 'TOO_LONG' });
      const departmentId = departmentCode
        ? departmentByCode.get(departmentCode)
        : undefined;
      if (departmentCode && !departmentId)
        errors.push({ column: 'departmentCode', code: 'DEPARTMENT_NOT_FOUND' });
      const current = code ? positionByCode.get(code) : undefined;
      if (!current) row.action = 'create';
      else
        row.action =
          str(current.title) === title &&
          familyId !== undefined &&
          str(current.jobFamilyId) === familyId &&
          (!grade || str(current.grade ?? '') === grade) &&
          (!departmentId || str(current.departmentId ?? '') === departmentId)
            ? 'unchanged'
            : 'update';
    }
    return { ...summarize(rows), newFamilies };
  }

  return {
    columns: POSITION_COLUMNS,

    template(): Buffer {
      return buildTemplate(
        POSITION_COLUMNS,
        [
          ['P-HR-01', '人事专员', '职能序列', 'P3', 'D0101'],
          ['P-FIN-01', '会计', '职能序列', 'P4', 'D0102'],
        ],
        'positions',
      );
    },

    async preview(file: Buffer): Promise<PositionPreview> {
      return validate(readSheet(file, POSITION_COLUMNS));
    },

    async commit(userId: string, body: unknown) {
      const preview = await validate(rowsFromBody(body, POSITION_COLUMNS));
      assertNoErrors(preview);
      const batchId = newBatchId('positions', deps.currentDate());
      return database.transaction(async (connection) => {
        const { familyOf, positionByCode, departmentByCode } =
          await lookups(connection);
        const stamp = new Date();
        const createdFamilies = new Map<string, string>();
        const familySort = await connection.query
          .selectFrom('jobFamilies')
          .select(['sortOrder'])
          .orderBy('sortOrder', 'desc')
          .limit(1)
          .executeTakeFirst();
        let nextSort = Number(familySort?.sortOrder ?? 0) + 1;
        for (const [index, title] of preview.newFamilies.entries()) {
          const id = newId();
          await connection.query
            .insertInto('jobFamilies')
            .values({
              id,
              code: `${batchId.toLowerCase()}-f${index + 1}`,
              title,
              description: null,
              active: true,
              sortOrder: nextSort++,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
          createdFamilies.set(titleKey(title), id);
        }
        const created: string[] = [];
        const updated: string[] = [];
        for (const row of preview.rows) {
          if (row.action === 'unchanged') continue;
          const { code, title, family, grade, departmentCode } = row.cells;
          const jobFamilyId =
            familyOf(family) ?? createdFamilies.get(titleKey(family));
          if (!jobFamilyId) throw new HrError('POSITION_FAMILY_NOT_FOUND', 409);
          const departmentId = departmentCode
            ? (departmentByCode.get(departmentCode) ?? null)
            : null;
          const current = positionByCode.get(code);
          if (current) {
            await connection.query
              .updateTable('positions')
              .set({
                title,
                jobFamilyId,
                ...(grade ? { grade } : {}),
                ...(departmentId ? { departmentId } : {}),
                updatedAt: stamp,
              })
              .where('id', '=', str(current.id))
              .execute();
            updated.push(str(current.id));
          } else {
            const id = newId();
            await connection.query
              .insertInto('positions')
              .values({
                id,
                code,
                title,
                jobFamilyId,
                grade: grade || null,
                departmentId,
                responsibilities: null,
                aiDraftedAt: null,
                importBatchId: batchId,
                active: true,
                sortOrder: 0,
                createdAt: stamp,
                updatedAt: stamp,
              })
              .execute();
            created.push(id);
          }
        }
        await recordBatch(connection, {
          id: batchId,
          kind: 'positions',
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
          createdFamilies: createdFamilies.size,
        };
      });
    },

    async count(): Promise<number> {
      return database
        .repository('positions')
        .count({ filter: { active: true } });
    },
  };
}

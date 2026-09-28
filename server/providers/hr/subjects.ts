import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';

import type { OrganizationService } from './organization-service.js';
import { label, str } from './shared.js';

export const DEPARTMENT_SUBJECT = 'org.department';
export const DEPARTMENT_HEAD_SUBJECT = 'org.departmentHead';
export const POSITION_SUBJECT = 'org.position';

/**
 * Registers the three organisation subject types: departments (inherited
 * through the tree), department heads (a fixed audience) and positions (the
 * employee's current position). Returns the function that releases them.
 */
export function registerSubjects(
  authz: AppAuthorization,
  database: DatabaseManager,
  organization: OrganizationService,
): () => void {
  const releases = [
    authz.subjects.add<DatabaseConnection>(DEPARTMENT_SUBJECT, {
      resolveFor: async (principal) =>
        principal.type === 'user'
          ? organization.departmentsOf(String(principal.id))
          : [],
      filterActive: (ids, transaction) =>
        organization.filterActive(ids, transaction),
      administration: {
        title: label('departments.subjectTitle'),
        selection: {
          type: 'collection',
          list: (query) => organization.listDepartments(query),
          resolve: (ids) => organization.resolveDepartments(ids),
        },
      },
    }),
    authz.subjects.add<DatabaseConnection>(DEPARTMENT_HEAD_SUBJECT, {
      resolveFor: async (principal) =>
        principal.type === 'user' &&
        (await organization.headedBy(String(principal.id))).length
          ? ['*']
          : [],
      filterActive: async (ids) => ids.filter((id) => id === '*'),
      administration: {
        title: label('departments.headsSubjectTitle'),
        selection: { type: 'fixed', id: '*' },
      },
    }),
    authz.subjects.add<DatabaseConnection>(POSITION_SUBJECT, {
      resolveFor: async (principal) => {
        if (principal.type !== 'user') return [];
        const employee = await database
          .query()
          .selectFrom('employees')
          .select(['positionId', 'status'])
          .where('userId', '=', String(principal.id))
          .executeTakeFirst();
        if (!employee || !employee.positionId || employee.status === 'leave')
          return [];
        const position = await database
          .query()
          .selectFrom('positions')
          .select(['id'])
          .where('id', '=', str(employee.positionId))
          .where('active', '=', true)
          .executeTakeFirst();
        return position ? [String(position.id)] : [];
      },
      filterActive: async (ids, transaction) => {
        if (!ids.length) return [];
        const rows = await (transaction ?? database.connection()).query
          .selectFrom('positions')
          .select(['id'])
          .where('active', '=', true)
          .where('id', 'in', [...ids])
          .execute();
        return rows.map((row) => String(row.id));
      },
      administration: {
        title: label('framework.positionSubjectTitle'),
        selection: {
          type: 'collection',
          async list({ search, page, pageSize }) {
            const all = await database
              .query()
              .selectFrom('positions')
              .select(['id', 'code', 'title'])
              .where('active', '=', true)
              .orderBy('title', 'asc')
              .execute();
            const filtered = all.filter(
              (row) =>
                !search ||
                String(row.title)
                  .toLowerCase()
                  .includes(search.toLowerCase()) ||
                String(row.code).toLowerCase().includes(search.toLowerCase()),
            );
            const start = (Math.max(page, 1) - 1) * pageSize;
            return {
              items: filtered.slice(start, start + pageSize).map((row) => ({
                id: String(row.id),
                title: String(row.title),
                description: String(row.code),
              })),
              total: filtered.length,
            };
          },
          async resolve(ids) {
            if (!ids.length) return [];
            const rows = await database
              .query()
              .selectFrom('positions')
              .select(['id', 'code', 'title'])
              .where('id', 'in', [...ids])
              .execute();
            return rows.map((row) => ({
              id: String(row.id),
              title: String(row.title),
              description: String(row.code),
            }));
          },
        },
      },
    }),
  ];
  return () => {
    for (const release of releases) release();
  };
}

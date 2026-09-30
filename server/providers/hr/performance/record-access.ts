/**
 * V4-12 绩效 record scopes. Each is computed for the caller on the server;
 * none can reach a record the specification's matrix does not give:
 *
 * - self: one's own goals and results; the review tasks one is the reviewer of
 *   (self and peer tasks). The reviews others wrote about one are not reached.
 * - team: goals, results and reviews of the employees in the managed
 *   departments (heads, as 本范围) and of the people whose result names one as
 *   manager or skip-level reviewer — never one's own; plus the tasks one
 *   reviews.
 * - published: results with a publication time (hr.payroll).
 * - linked: published results a salary adjustment links to (hr.payrollApprover).
 */
import {
  anyScope,
  condition,
  type AppAuthorization,
  type DatabaseScope,
} from '@nocobase/app-plugin-authorization/server';
import {
  defineRecordAccess,
  type RecordAccessContext,
} from '@nocobase/authorization/core';
import type { DatabaseManager } from '@nocobase/db';

import type { OrganizationService } from '../organization-service.js';
import { label, str } from '../shared.js';
import {
  PERFORMANCE_LINKED_SCOPE,
  PERFORMANCE_PUBLISHED_SCOPE,
  PERFORMANCE_SCOPED_COLLECTIONS,
  PERFORMANCE_SELF_SCOPE,
  PERFORMANCE_TEAM_SCOPE,
} from './resources.js';

function anyOf(field: string, values: readonly string[]): DatabaseScope {
  return values.length
    ? anyScope(values.map((value) => condition(field, '$eq', value)))
    : false;
}

function pick(scopes: DatabaseScope[]): DatabaseScope {
  const present = scopes.filter((scope) => scope !== false);
  return present.length ? anyScope(present) : false;
}

/** The employees a user reaches as a head or as a named manager / skip-level reviewer. */
export async function teamEmployeeIds(
  database: DatabaseManager,
  organization: OrganizationService,
  userId: string,
): Promise<string[]> {
  const departments = await organization.managedDepartments(userId);
  const ids = new Set<string>();
  const own = await database
    .query()
    .selectFrom('employees')
    .select(['id'])
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (departments.length)
    for (const row of await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('departmentId', 'in', departments)
      .execute())
      ids.add(str(row.id));
  for (const row of await database
    .query()
    .selectFrom('reviewResults')
    .select(['employeeId', 'managerUserId', 'skipLevelUserId'])
    .execute())
    if (
      str(row.managerUserId) === userId ||
      (row.skipLevelUserId && str(row.skipLevelUserId) === userId)
    )
      ids.add(str(row.employeeId));
  // A head never reaches their own review, result or goals through the team scope.
  if (own) ids.delete(str(own.id));
  return [...ids];
}

export function registerPerformanceRecordAccess(
  authz: AppAuthorization,
  database: DatabaseManager,
  organization: OrganizationService,
): void {
  async function ownEmployeeId(userId: string): Promise<string | undefined> {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('userId', '=', userId)
      .executeTakeFirst();
    return row ? str(row.id) : undefined;
  }

  authz.recordAccess.define(
    defineRecordAccess(PERFORMANCE_SELF_SCOPE, (access) =>
      access
        .title(label('performance.scopes.self'))
        .description(label('performance.scopes.selfDescription'))
        .collections(...PERFORMANCE_SCOPED_COLLECTIONS)
        .resolver(async ({ principal, collection }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const userId = String(principal.id);
          if (collection === 'reviews')
            return condition('reviewerUserId', '$eq', userId);
          const employeeId = await ownEmployeeId(userId);
          return employeeId
            ? condition('employeeId', '$eq', employeeId)
            : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(PERFORMANCE_TEAM_SCOPE, (access) =>
      access
        .title(label('performance.scopes.team'))
        .description(label('performance.scopes.teamDescription'))
        .collections(...PERFORMANCE_SCOPED_COLLECTIONS)
        .resolver(async ({ principal, collection }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const userId = String(principal.id);
          const employees = await teamEmployeeIds(
            database,
            organization,
            userId,
          );
          if (collection === 'reviews')
            return pick([
              anyOf('employeeId', employees),
              condition('reviewerUserId', '$eq', userId),
            ]);
          if (collection === 'goals') {
            // Department goals of the managed departments too.
            const departments = await organization.managedDepartments(userId);
            return pick([
              anyOf('employeeId', employees),
              anyOf('departmentId', departments),
            ]);
          }
          return anyOf('employeeId', employees);
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(PERFORMANCE_PUBLISHED_SCOPE, (access) =>
      access
        .title(label('performance.scopes.published'))
        .description(label('performance.scopes.publishedDescription'))
        .collections('reviewResults')
        .resolver(async ({ principal }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const rows = await database
            .query()
            .selectFrom('reviewResults')
            .select(['id'])
            .where('publishedAt', 'is not', null)
            .execute();
          return anyOf(
            'id',
            rows.map((row) => str(row.id)),
          );
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(PERFORMANCE_LINKED_SCOPE, (access) =>
      access
        .title(label('performance.scopes.linked'))
        .description(label('performance.scopes.linkedDescription'))
        .collections('reviewResults')
        .resolver(async ({ principal }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const links = await database
            .query()
            .selectFrom('salaryAdjustments')
            .select(['relatedReviewResultId'])
            .where('relatedReviewResultId', 'is not', null)
            .execute();
          const ids = [
            ...new Set(links.map((row) => str(row.relatedReviewResultId))),
          ];
          if (!ids.length) return false;
          const published = await database
            .query()
            .selectFrom('reviewResults')
            .select(['id'])
            .where('id', 'in', ids)
            .where('publishedAt', 'is not', null)
            .execute();
          return anyOf(
            'id',
            published.map((row) => str(row.id)),
          );
        }),
    ),
  );
}

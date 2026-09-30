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
import { WORK_ITEM_SCOPE } from './workbench-resource.js';

import {
  EMPLOYEE_CHILD_COLLECTIONS,
  MANAGED_DEPARTMENTS_SCOPE,
  SELF_SCOPE,
} from './authz-resources.js';
import { EXAM_EMPLOYEE_COLLECTIONS } from './exam-resources.js';
import {
  LEARNING_EMPLOYEE_COLLECTIONS,
  OWNED_BY_ME_SCOPE,
  VISIBLE_DOCUMENTS_SCOPE,
} from './learning-resources.js';
import type { OrganizationService } from './organization-service.js';
import { CONTENT_OWNED_COLLECTIONS } from './content-resources.js';
import {
  TRAINING_EMPLOYEE_COLLECTIONS,
  TRAINING_OWNED_COLLECTIONS,
} from './training-resources.js';
import { label, str } from './shared.js';
// V3-11
import {
  PROFILE_SCOPED_COLLECTIONS,
  profileManagedScope,
  profileSelfScope,
} from './profile/resources.js';
// V3-11 end

function anyOf(field: string, values: readonly string[]): DatabaseScope {
  return values.length
    ? anyScope(values.map((value) => condition(field, '$eq', value)))
    : false;
}

const SCOPED_COLLECTIONS = [
  'employees',
  ...EMPLOYEE_CHILD_COLLECTIONS,
  ...LEARNING_EMPLOYEE_COLLECTIONS,
  ...EXAM_EMPLOYEE_COLLECTIONS,
  ...TRAINING_EMPLOYEE_COLLECTIONS,
  'leaveRequests',
  'leaveBalances',
  'shiftSchedules',
  'attendanceRecords',
  'attendanceAdjustments',
  'attendanceMonthlySummaries',
  // V2-06: an employee's own payslips and enrolment (talent.myPayslip, self scope).
  'payslips',
  'employeeSocialInsurances',
  // V3-11: business data, level suggestions and training recommendations (profile/resources.ts).
  ...PROFILE_SCOPED_COLLECTIONS,
];
/** Collections with an `ownerUserId` column: content an instructor is responsible for. */
const OWNED_COLLECTIONS = [
  'kbDocuments',
  'courses',
  'questions',
  'exams',
  ...TRAINING_OWNED_COLLECTIONS,
  ...CONTENT_OWNED_COLLECTIONS,
];

/**
 * The documents a user may read under the knowledge base's visibility rule:
 * every document open to all, every document the user is responsible for, and
 * every restricted document granted to one of the user's departments or an
 * ancestor of it, or to the user's current position. Computed for the caller
 * on the server; the client never supplies the scope.
 */
export async function visibleDocumentsScope(
  database: DatabaseManager,
  organization: OrganizationService,
  userId: string,
): Promise<DatabaseScope> {
  const query = database.query();
  const employee = await query
    .selectFrom('employees')
    .select(['departmentId', 'positionId', 'status'])
    .where('userId', '=', userId)
    .executeTakeFirst();
  const departments = new Set<string>(await organization.departmentsOf(userId));
  if (employee?.departmentId && employee.status !== 'leave')
    departments.add(str(employee.departmentId));
  const chain = new Set<string>();
  for (const departmentId of departments) {
    for (const id of (await organization.activeChain(departmentId)) ?? [])
      chain.add(id);
  }
  const documentIds = new Set<string>();
  if (chain.size) {
    const rows = await query
      .selectFrom('kbDocumentDepartments')
      .select(['documentId'])
      .where('departmentId', 'in', [...chain])
      .execute();
    for (const row of rows) documentIds.add(String(row.documentId));
  }
  if (employee?.positionId && employee.status !== 'leave') {
    const rows = await query
      .selectFrom('kbDocumentPositions')
      .select(['documentId'])
      .where('positionId', '=', str(employee.positionId))
      .execute();
    for (const row of rows) documentIds.add(String(row.documentId));
  }
  const scopes: DatabaseScope[] = [
    condition('visibility', '$eq', 'all'),
    condition('ownerUserId', '$eq', userId),
  ];
  const granted = anyOf('id', [...documentIds]);
  if (granted !== false) scopes.push(granted);
  return anyScope(scopes);
}

/**
 * The two viewer-relative data scopes of the talent platform. Both are
 * computed for the caller, so neither can reach another department's records.
 */
export function registerRecordAccess(
  authz: AppAuthorization,
  database: DatabaseManager,
  organization: OrganizationService,
): void {
  authz.recordAccess.define(
    defineRecordAccess(WORK_ITEM_SCOPE, (access) =>
      access
        .title(label('workbench.recipient'))
        .collections('workItems')
        .resolver(({ principal }: RecordAccessContext) =>
          principal.type === 'user'
            ? condition('recipientUserId', '$eq', String(principal.id))
            : false,
        ),
    ),
  );
  async function employeeIdsIn(
    departmentIds: readonly string[],
  ): Promise<string[]> {
    if (!departmentIds.length) return [];
    const rows = await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('departmentId', 'in', [...departmentIds])
      .execute();
    return rows.map((row) => String(row.id));
  }

  async function ownEmployeeId(userId: string): Promise<string | undefined> {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('userId', '=', userId)
      .executeTakeFirst();
    return row ? String(row.id) : undefined;
  }

  authz.recordAccess.define(
    defineRecordAccess(MANAGED_DEPARTMENTS_SCOPE, (access) =>
      access
        .title(label('scopes.managedDepartments'))
        .description(label('scopes.managedDepartmentsDescription'))
        .collections(...SCOPED_COLLECTIONS)
        .resolver(async ({ principal, collection }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const userId = String(principal.id);
          const departments = await organization.managedDepartments(userId);
          if (collection === 'employees')
            return anyOf('departmentId', departments);
          const employees = await employeeIdsIn(departments);
          if (collection === 'personnelActions') {
            // A transfer into a managed department reaches its head too, and
            // an applicant always sees what they raised.
            const scopes: DatabaseScope[] = [
              anyOf('employeeId', employees),
              anyOf('toDepartmentId', departments),
              condition('applicantUserId', '$eq', userId),
            ];
            return anyScope(scopes.filter((scope) => scope !== false));
          }
          if (collection === 'learningPlans') {
            // A plan waiting for this person's decision reaches them even outside their departments.
            const scopes: DatabaseScope[] = [
              anyOf('employeeId', employees),
              condition('reviewerUserId', '$eq', userId),
            ];
            return anyScope(scopes.filter((scope) => scope !== false));
          }
          if (
            [
              'leaveRequests',
              'leaveBalances',
              'shiftSchedules',
              'attendanceRecords',
            ].includes(collection)
          ) {
            const scopes: DatabaseScope[] = [anyOf('employeeId', employees)];
            if (collection === 'leaveRequests') {
              const pending = await database
                .query()
                .selectFrom('leaveRequests')
                .select(['id', 'approvals'])
                .where('status', '=', 'pending')
                .execute();
              const ids = pending
                .filter((row) => {
                  let value: unknown = row.approvals;
                  for (let i = 0; i < 2 && typeof value === 'string'; i += 1) {
                    try {
                      value = JSON.parse(value);
                    } catch {
                      break;
                    }
                  }
                  return (
                    Array.isArray(value) &&
                    value.some(
                      (step) =>
                        step &&
                        typeof step === 'object' &&
                        (step as { status?: string; approverUserId?: string })
                          .status === 'pending' &&
                        (step as { approverUserId?: string }).approverUserId ===
                          userId,
                    )
                  );
                })
                .map((row) => String(row.id));
              const pendingScope = anyOf('id', ids);
              if (pendingScope !== false) scopes.push(pendingScope);
            }
            return anyScope(scopes.filter((scope) => scope !== false));
          }
          if (collection === 'developmentTargets') {
            // V3-08: a head also reaches targets whose position is held in a managed department (目标岗位所在部门).
            const held = departments.length
              ? await database
                  .query()
                  .selectFrom('employees')
                  .select(['positionId'])
                  .where('departmentId', 'in', [...departments])
                  .where('status', '!=', 'leave')
                  .where('positionId', 'is not', null)
                  .execute()
              : [];
            const scopes: DatabaseScope[] = [
              anyOf('employeeId', employees),
              anyOf('targetPositionId', [
                ...new Set(held.map((row) => String(row.positionId))),
              ]),
            ];
            const present = scopes.filter((scope) => scope !== false);
            return present.length ? anyScope(present) : false;
          }
          // V3-11: by department or reviewer as well as by employee.
          const profile = profileManagedScope(collection, {
            userId,
            departments,
            employees,
          });
          if (profile !== undefined) return profile;
          // V3-11 end
          return anyOf('employeeId', employees);
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(SELF_SCOPE, (access) =>
      access
        .title(label('scopes.self'))
        .description(label('scopes.selfDescription'))
        .collections(...SCOPED_COLLECTIONS)
        .resolver(async ({ principal, collection }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const userId = String(principal.id);
          if (collection === 'employees')
            return condition('userId', '$eq', userId);
          const employeeId = await ownEmployeeId(userId);
          if (collection === 'personnelActions') {
            const scopes: DatabaseScope[] = [
              condition('applicantUserId', '$eq', userId),
            ];
            if (employeeId)
              scopes.push(condition('employeeId', '$eq', employeeId));
            return anyScope(scopes);
          }
          if (
            [
              'leaveRequests',
              'leaveBalances',
              'shiftSchedules',
              'attendanceRecords',
            ].includes(collection)
          )
            return employeeId
              ? condition('employeeId', '$eq', employeeId)
              : false;
          // V3-11
          const profile = profileSelfScope(collection, employeeId);
          if (profile !== undefined) return profile;
          // V3-11 end
          return employeeId
            ? condition('employeeId', '$eq', employeeId)
            : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(VISIBLE_DOCUMENTS_SCOPE, (access) =>
      access
        .title(label('scopes.visibleDocuments'))
        .description(label('scopes.visibleDocumentsDescription'))
        .collections('kbDocuments')
        .resolver(async ({ principal }: RecordAccessContext) =>
          principal.type === 'user'
            ? visibleDocumentsScope(
                database,
                organization,
                String(principal.id),
              )
            : false,
        ),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(OWNED_BY_ME_SCOPE, (access) =>
      access
        .title(label('scopes.ownedByMe'))
        .description(label('scopes.ownedByMeDescription'))
        .collections(...OWNED_COLLECTIONS)
        .resolver(async ({ principal, collection }: RecordAccessContext) => {
          if (principal.type !== 'user') return false;
          const userId = String(principal.id);
          // A session is also the instructor's; a practice is its scenario owner's.
          if (collection === 'trainingSessions')
            return anyScope([
              condition('ownerUserId', '$eq', userId),
              condition('instructorUserId', '$eq', userId),
            ]);
          if (collection === 'documentConflicts') {
            const rows = await database
              .query()
              .selectFrom('kbDocuments')
              .select(['id'])
              .where('ownerUserId', '=', userId)
              .execute();
            const ids = rows.map((row) => String(row.id));
            const scopes = [
              anyOf('documentId', ids),
              anyOf('otherDocumentId', ids),
            ].filter(
              (scope): scope is Exclude<typeof scope, false> => scope !== false,
            );
            return scopes.length ? anyScope(scopes) : false;
          }
          if (collection === 'practiceSessions') {
            const rows = await database
              .query()
              .selectFrom('practiceScenarios')
              .select(['id'])
              .where('ownerUserId', '=', userId)
              .execute();
            return anyOf(
              'scenarioId',
              rows.map((row) => String(row.id)),
            );
          }
          return condition('ownerUserId', '$eq', userId);
        }),
    ),
  );
}

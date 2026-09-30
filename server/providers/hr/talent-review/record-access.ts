/**
 * V4-13 record scopes. Each is computed for the caller on the server:
 *
 * - talentReviewTeam (talentPlacements): the placements of the employees in
 *   the departments one heads (with descendants) — never one's own — of the
 *   reviews that are preparing or in session. After the review concludes
 *   nothing is reached (员工本人看不到自己的落位；主管只在盘点期间看到本范围).
 * - successionSuperior (successionPlans): the plans whose incumbent's
 *   superior head is the caller; never a plan whose incumbent is the caller.
 * - practicalAssessorOwn / practicalWitness (practicalRecords): the records
 *   one conducts; the records naming one as witness.
 * - evaluationRespondent / evaluationTeam / evaluationInstructor
 *   (trainingEvaluations): one's own tasks; the tasks about people in the
 *   departments one heads; the tasks about the courses one owns and the
 *   sessions one teaches (internal instructor profile included).
 * - agentTokenOwn (agentTokens): one's own tokens.
 * - translationContentOwner (courses, lessons, questions, practiceScenarios,
 *   kbDocuments): the content one owns (a lesson through its course), and
 *   the translations of it.
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
  AGENT_TOKEN_OWN_SCOPE,
  CONTENT_OWNER_SCOPE,
  EVALUATION_INSTRUCTOR_SCOPE,
  EVALUATION_RESPONDENT_SCOPE,
  EVALUATION_TEAM_SCOPE,
  PRACTICAL_ASSESSOR_OWN_SCOPE,
  PRACTICAL_WITNESS_SCOPE,
  SUCCESSION_SUPERIOR_SCOPE,
  TALENT_REVIEW_TEAM_SCOPE,
  TRANSLATABLE_COLLECTIONS,
} from './resources.js';

function anyOf(field: string, values: readonly string[]): DatabaseScope {
  return values.length
    ? anyScope(values.map((value) => condition(field, '$eq', value)))
    : false;
}

async function ownEmployeeId(
  database: DatabaseManager,
  userId: string,
): Promise<string | undefined> {
  const row = await database
    .query()
    .selectFrom('employees')
    .select(['id'])
    .where('userId', '=', userId)
    .executeTakeFirst();
  return row ? str(row.id) : undefined;
}

/** The placements a head reaches during a review (see the module comment). */
export async function teamPlacementIds(
  database: DatabaseManager,
  organization: OrganizationService,
  userId: string,
): Promise<string[]> {
  const departments = await organization.managedDepartments(userId);
  if (!departments.length) return [];
  const own = await ownEmployeeId(database, userId);
  const rows = await database
    .query()
    .selectFrom('talentPlacements')
    .innerJoin(
      'talentReviews',
      'talentReviews.id',
      'talentPlacements.talentReviewId',
    )
    .innerJoin('employees', 'employees.id', 'talentPlacements.employeeId')
    .select([
      'talentPlacements.id as id',
      'talentPlacements.employeeId as employeeId',
    ])
    .where('talentReviews.status', 'in', ['preparing', 'inSession'])
    .where('employees.departmentId', 'in', [...departments])
    .execute();
  return rows
    .filter((row) => str(row.employeeId) !== own)
    .map((row) => str(row.id));
}

/** The superior head of an incumbent: the head of their department, or the head above when they head it. */
export async function superiorOf(
  database: DatabaseManager,
  organization: OrganizationService,
  incumbentEmployeeId: string,
): Promise<string | undefined> {
  const employee = await database
    .query()
    .selectFrom('employees')
    .select(['userId', 'departmentId'])
    .where('id', '=', incumbentEmployeeId)
    .executeTakeFirst();
  if (!employee) return undefined;
  const head = await organization.resolveHead(str(employee.departmentId));
  if (!head) return undefined;
  if (!employee.userId || head.userId !== str(employee.userId))
    return head.userId;
  const department = await organization.getDepartment(head.departmentId);
  return department?.parentId
    ? (await organization.resolveHead(department.parentId))?.userId
    : undefined;
}

/** The plans whose incumbent reports to the caller (the head above the incumbent). */
export async function superiorPlanIds(
  database: DatabaseManager,
  organization: OrganizationService,
  userId: string,
): Promise<string[]> {
  const own = await ownEmployeeId(database, userId);
  const plans = await database
    .query()
    .selectFrom('successionPlans')
    .select(['id', 'incumbentEmployeeId'])
    .execute();
  const ids: string[] = [];
  for (const plan of plans) {
    if (!plan.incumbentEmployeeId) continue;
    const incumbent = str(plan.incumbentEmployeeId);
    if (incumbent === own) continue;
    if ((await superiorOf(database, organization, incumbent)) === userId)
      ids.push(str(plan.id));
  }
  return ids;
}

export function registerTalentReviewRecordAccess(
  authz: AppAuthorization,
  database: DatabaseManager,
  organization: OrganizationService,
): void {
  const userOf = (principal: RecordAccessContext['principal']) =>
    principal.type === 'user' ? String(principal.id) : undefined;

  authz.recordAccess.define(
    defineRecordAccess(TALENT_REVIEW_TEAM_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.team'))
        .description(label('talentReview.scopes.teamDescription'))
        .collections('talentPlacements')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          if (!userId) return false;
          return anyOf(
            'id',
            await teamPlacementIds(database, organization, userId),
          );
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(SUCCESSION_SUPERIOR_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.superior'))
        .description(label('talentReview.scopes.superiorDescription'))
        .collections('successionPlans')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          if (!userId) return false;
          return anyOf(
            'id',
            await superiorPlanIds(database, organization, userId),
          );
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(PRACTICAL_ASSESSOR_OWN_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.assessorOwn'))
        .description(label('talentReview.scopes.assessorOwnDescription'))
        .collections('practicalRecords')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          return userId ? condition('assessorUserId', '$eq', userId) : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(PRACTICAL_WITNESS_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.witness'))
        .description(label('talentReview.scopes.witnessDescription'))
        .collections('practicalRecords')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          return userId ? condition('witnessUserId', '$eq', userId) : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(EVALUATION_RESPONDENT_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.respondent'))
        .description(label('talentReview.scopes.respondentDescription'))
        .collections('trainingEvaluations')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          return userId ? condition('respondentUserId', '$eq', userId) : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(EVALUATION_TEAM_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.evaluationTeam'))
        .description(label('talentReview.scopes.evaluationTeamDescription'))
        .collections('trainingEvaluations')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          if (!userId) return false;
          const departments = await organization.managedDepartments(userId);
          if (!departments.length) return false;
          const rows = await database
            .query()
            .selectFrom('employees')
            .select(['id'])
            .where('departmentId', 'in', [...departments])
            .execute();
          return anyOf(
            'employeeId',
            rows.map((row) => str(row.id)),
          );
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(EVALUATION_INSTRUCTOR_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.evaluationInstructor'))
        .description(
          label('talentReview.scopes.evaluationInstructorDescription'),
        )
        .collections('trainingEvaluations')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          if (!userId) return false;
          const courses = await database
            .query()
            .selectFrom('courses')
            .select(['id'])
            .where('ownerUserId', '=', userId)
            .execute();
          const profiles = await database
            .query()
            .selectFrom('instructorProfiles')
            .select(['id'])
            .where('userId', '=', userId)
            .execute();
          let sessionQuery = database
            .query()
            .selectFrom('trainingSessions')
            .select(['id'])
            .where('instructorUserId', '=', userId);
          const sessions = (await sessionQuery.execute()).map((r) =>
            str(r.id),
          );
          if (profiles.length) {
            sessionQuery = database
              .query()
              .selectFrom('trainingSessions')
              .select(['id'])
              .where(
                'instructorProfileId',
                'in',
                profiles.map((p) => str(p.id)),
              );
            for (const row of await sessionQuery.execute())
              sessions.push(str(row.id));
          }
          const scopes = [
            anyOf(
              'courseId',
              courses.map((c) => str(c.id)),
            ),
            anyOf('targetId', sessions),
          ].filter((scope) => scope !== false);
          return scopes.length ? anyScope(scopes) : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(AGENT_TOKEN_OWN_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.tokenOwn'))
        .description(label('talentReview.scopes.tokenOwnDescription'))
        .collections('agentTokens')
        .resolver(async ({ principal }: RecordAccessContext) => {
          const userId = userOf(principal);
          return userId ? condition('userId', '$eq', userId) : false;
        }),
    ),
  );

  authz.recordAccess.define(
    defineRecordAccess(CONTENT_OWNER_SCOPE, (access) =>
      access
        .title(label('talentReview.scopes.contentOwner'))
        .description(label('talentReview.scopes.contentOwnerDescription'))
        .collections(...TRANSLATABLE_COLLECTIONS)
        .resolver(async ({ principal, collection }: RecordAccessContext) => {
          const userId = userOf(principal);
          if (!userId) return false;
          if (collection === 'lessons') {
            const courses = await database
              .query()
              .selectFrom('courses')
              .select(['id'])
              .where('ownerUserId', '=', userId)
              .execute();
            return anyOf(
              'courseId',
              courses.map((c) => str(c.id)),
            );
          }
          return condition('ownerUserId', '$eq', userId);
        }),
    ),
  );
}

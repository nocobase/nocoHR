import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  MANAGED_DEPARTMENTS_SCOPE,
  SELF_SCOPE,
} from '../../../server/providers/hr/authz-resources.js';
import {
  calibrationResource,
  goalResource,
  PERFORMANCE_LINKED_SCOPE,
  PERFORMANCE_PUBLISHED_SCOPE,
  PERFORMANCE_SELF_SCOPE,
  PERFORMANCE_TEAM_SCOPE,
  performanceAssistantResource,
  reviewAppealResource,
  reviewCycleResource,
  reviewResource,
  reviewResultRatingResource,
  reviewSchemeResource,
} from '../../../server/providers/hr/performance/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';
const TEAM = PERFORMANCE_TEAM_SCOPE;
const MINE = PERFORMANCE_SELF_SCOPE;
const configure = {
  aiAutomationSettings: ALL,
  aiTaskRuns: ALL,
  aiTaskRunItems: ALL,
};
const page = (id: string): Grant => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});

/**
 * V4-12 绩效, the permission matrix of this step:
 *
 * - hr.admin: 考核方案, 考核周期, 校准; every performance action on all
 *   records; the bonus coefficients read-only (no manageCoefficients).
 * - hr.manager: 团队考核 and 校准 (read only); goals (approve, and department
 *   goals of managed departments), reviews as reviewer and calibration view
 *   within the team scope (managed departments and the people they review).
 * - hr.employee: 我的考核; their own goals, their own review tasks (self and
 *   peer), appeals on their own results; the assistant.
 * - hr.payroll: 绩效系数 (manageCoefficients) and the published final ratings.
 * - hr.payrollApprover: the published final rating a salary adjustment links to.
 *
 * Only missing actions are appended to existing sets, so an administrator's
 * edits stay.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610100101_performance_permissions',
  transaction: true,
  async run({ query }) {
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        page('talent.reviewSchemes'),
        page('talent.reviewCycles'),
        page('talent.calibration'),
        reviewSchemeResource.reference().grant({
          view: { reviewSchemes: ALL },
          manage: { reviewSchemes: ALL },
        }),
        reviewCycleResource.reference().grant({
          view: {
            reviewCycles: ALL,
            reviewResults: ALL,
            reviews: ALL,
            employees: ALL,
          },
          manage: { reviewCycles: ALL, reviewResults: ALL, employees: ALL },
          advance: { reviewCycles: ALL, reviewResults: ALL, reviews: ALL },
          remind: { reviewCycles: ALL, reviews: ALL },
        }),
        goalResource.reference().grant({
          view: { goals: ALL, employees: ALL },
          manage: { goals: ALL },
          approve: { goals: ALL },
        }),
        reviewResource.reference().grant({
          view: {
            reviews: ALL,
            reviewResults: ALL,
            goals: ALL,
            employees: ALL,
          },
          write: { reviews: ALL },
          submit: { reviews: ALL, reviewResults: ALL },
        }),
        calibrationResource.reference().grant({
          view: { reviewResults: ALL, employees: ALL },
          adjust: { reviewResults: ALL },
          publish: { reviewResults: ALL, reviewCycles: ALL },
        }),
        reviewAppealResource.reference().grant({
          handle: { reviewResults: ALL },
        }),
        performanceAssistantResource
          .reference()
          .grant({ use: { employees: ALL }, configure }),
      ] as unknown as Grant[],
      'hr.manager': [
        page('talent.teamReviews'),
        page('talent.calibration'),
        goalResource.reference().grant({
          view: { goals: TEAM, employees: MANAGED_DEPARTMENTS_SCOPE },
          manage: { goals: TEAM },
          approve: { goals: TEAM },
        }),
        reviewResource.reference().grant({
          view: {
            reviews: TEAM,
            reviewResults: TEAM,
            goals: TEAM,
            employees: MANAGED_DEPARTMENTS_SCOPE,
          },
          write: { reviews: TEAM },
          submit: { reviews: TEAM, reviewResults: TEAM },
        }),
        calibrationResource.reference().grant({
          view: { reviewResults: TEAM, employees: MANAGED_DEPARTMENTS_SCOPE },
        }),
        performanceAssistantResource
          .reference()
          .grant({ use: { employees: MANAGED_DEPARTMENTS_SCOPE } }),
      ] as unknown as Grant[],
      'hr.employee': [
        page('talent.myReview'),
        goalResource.reference().grant({
          view: { goals: MINE, employees: SELF_SCOPE },
          manage: { goals: MINE },
        }),
        reviewResource.reference().grant({
          view: {
            reviews: MINE,
            reviewResults: MINE,
            goals: MINE,
            employees: SELF_SCOPE,
          },
          write: { reviews: MINE },
          submit: { reviews: MINE, reviewResults: MINE },
        }),
        reviewAppealResource.reference().grant({
          submit: { reviewResults: MINE },
        }),
        performanceAssistantResource
          .reference()
          .grant({ use: { employees: SELF_SCOPE } }),
      ] as unknown as Grant[],
      'hr.payroll': [
        reviewSchemeResource.reference().grant({
          manageCoefficients: { reviewSchemes: ALL },
        }),
        reviewResultRatingResource.reference().grant({
          view: {
            reviewResults: PERFORMANCE_PUBLISHED_SCOPE,
            reviewCycles: ALL,
            employees: ALL,
          },
        }),
      ] as unknown as Grant[],
      'hr.payrollApprover': [
        reviewResultRatingResource.reference().grant({
          view: {
            reviewResults: PERFORMANCE_LINKED_SCOPE,
            reviewCycles: ALL,
            employees: ALL,
          },
        }),
      ] as unknown as Grant[],
    };
    for (const [key, grants] of Object.entries(additions)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      // hr.payroll / hr.payrollApprover come with V2-06; a set that is missing is left alone.
      if (!row) continue;
      let decoded = row.grants;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const existing = decoded as Grant[];
      let changed = false;
      for (const grant of grants) {
        const current = existing.find(
          (g) =>
            g.resource.type === grant.resource.type &&
            g.resource.id === grant.resource.id,
        );
        if (!current) {
          existing.push(grant);
          changed = true;
          continue;
        }
        for (const action of grant.actions) {
          if (current.actions.some((a) => a.action === action.action)) continue;
          current.actions.push(action);
          changed = true;
        }
      }
      if (!changed) continue;
      // The permission-set table stores grants as text, as the earlier permission seeds write them.
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  MANAGED_DEPARTMENTS_SCOPE,
  SELF_SCOPE,
} from '../../../server/providers/hr/authz-resources.js';
import {
  AGENT_TOKEN_OWN_SCOPE,
  agentClientResource,
  competencyModelResource,
  CONTENT_OWNER_SCOPE,
  EVALUATION_INSTRUCTOR_SCOPE,
  EVALUATION_RESPONDENT_SCOPE,
  EVALUATION_TEAM_SCOPE,
  instructorResource,
  knowledgeCandidateResource,
  PRACTICAL_ASSESSOR_OWN_SCOPE,
  PRACTICAL_ASSESSOR_SET,
  PRACTICAL_WITNESS_SCOPE,
  practicalResource,
  SUCCESSION_SUPERIOR_SCOPE,
  successionResource,
  TALENT_REVIEW_TEAM_SCOPE,
  talentReviewResource,
  TICKET_INTEGRATION_SET,
  trainingEvaluationResource,
  translationResource,
} from '../../../server/providers/hr/talent-review/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';
const page = (id: string): Grant => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});
const content = (scope: string) => ({
  courses: scope,
  lessons: scope,
  questions: scope,
  practiceScenarios: scope,
  kbDocuments: scope,
});

/**
 * V4-13 人才盘点与其他, the permission matrix of this step:
 *
 * - hr.admin: 人才盘点, 继任计划, 实操考核, 讲师, 培训评估, 译文审核 and
 *   设置 · 外部 AI 助手; every new action on all records except
 *   `talent.practical.conduct` (only hr.practicalAssessor conducts) and the
 *   witness signature (per record).
 * - hr.manager: 人才盘点 (view and assessPotential through the review-time
 *   team scope), 继任计划 (view as the incumbent's superior), 培训评估 (the
 *   team's evaluations, and their own tasks).
 * - hr.instructor: 实操考核 (maintain forms), 培训评估 (their own courses and
 *   sessions), 译文审核 (their own content).
 * - hr.employee: 培训评估 (their own tasks), the witness signature on the
 *   records naming them, and personal access tokens for themselves.
 * - hr.practicalAssessor (new; trainer01 in the demo): 实操考核 and
 *   `talent.practical.conduct` only.
 * - hr.ticketIntegration (new; integration_ticket): `talent.knowledgeCandidate.ingest` only.
 *
 * New sets are created when missing; for existing sets only missing actions
 * are appended, so an administrator's edits stay.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610110101_talent_review_permissions',
  transaction: true,
  async run({ query }) {
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        ...[
          'talent.talentReviews',
          'talent.succession',
          'talent.practicals',
          'talent.instructors',
          'talent.trainingEvaluations',
          'talent.translations',
          'talent.agentClients',
        ].map(page),
        talentReviewResource.reference().grant({
          view: { talentReviews: ALL, talentPlacements: ALL, employees: ALL },
          manage: { talentReviews: ALL, talentPlacements: ALL },
          assessPotential: { talentPlacements: ALL, employees: ALL },
          place: { talentPlacements: ALL },
          conclude: { talentReviews: ALL, talentPlacements: ALL },
        }),
        successionResource.reference().grant({
          view: { successionPlans: ALL, employees: ALL },
          manage: { successionPlans: ALL, positions: ALL },
          confirm: { successionPlans: ALL },
        }),
        competencyModelResource.reference().grant({
          view: { competencyModelVersions: ALL },
          draftVersion: { competencyModelVersions: ALL },
          publishVersion: { competencyModelVersions: ALL },
        }),
        practicalResource.reference().grant({
          view: { practicalAssessments: ALL, practicalRecords: ALL, employees: ALL },
          manageTemplates: { practicalAssessments: ALL },
          void: { practicalRecords: ALL },
        }),
        instructorResource.reference().grant({
          view: { instructorProfiles: ALL },
          manage: { instructorProfiles: ALL, trainingSessions: ALL },
        }),
        trainingEvaluationResource.reference().grant({
          respond: { trainingEvaluations: EVALUATION_RESPONDENT_SCOPE },
          view: { trainingEvaluations: ALL, employees: ALL },
          configure: { trainingEvaluations: ALL },
        }),
        knowledgeCandidateResource.reference().grant({
          view: { knowledgeCandidates: ALL },
          ignore: { knowledgeCandidates: ALL },
        }),
        translationResource.reference().grant({
          draft: content(ALL),
          review: content(ALL),
        }),
        agentClientResource.reference().grant({
          manage: { agentClients: ALL, agentTokens: ALL, agentCallLogs: ALL },
          issueToken: { agentClients: ALL, agentTokens: AGENT_TOKEN_OWN_SCOPE },
        }),
      ] as unknown as Grant[],
      'hr.manager': [
        page('talent.talentReviews'),
        page('talent.succession'),
        page('talent.trainingEvaluations'),
        talentReviewResource.reference().grant({
          view: {
            talentReviews: ALL,
            talentPlacements: TALENT_REVIEW_TEAM_SCOPE,
            employees: MANAGED_DEPARTMENTS_SCOPE,
          },
          assessPotential: {
            talentPlacements: TALENT_REVIEW_TEAM_SCOPE,
            employees: MANAGED_DEPARTMENTS_SCOPE,
          },
        }),
        successionResource.reference().grant({
          view: { successionPlans: SUCCESSION_SUPERIOR_SCOPE, employees: ALL },
        }),
        trainingEvaluationResource.reference().grant({
          view: {
            trainingEvaluations: EVALUATION_TEAM_SCOPE,
            employees: MANAGED_DEPARTMENTS_SCOPE,
          },
        }),
      ] as unknown as Grant[],
      'hr.instructor': [
        page('talent.practicals'),
        page('talent.trainingEvaluations'),
        page('talent.translations'),
        practicalResource.reference().grant({
          manageTemplates: { practicalAssessments: ALL },
        }),
        trainingEvaluationResource.reference().grant({
          view: { trainingEvaluations: EVALUATION_INSTRUCTOR_SCOPE, employees: ALL },
        }),
        translationResource.reference().grant({
          draft: content(CONTENT_OWNER_SCOPE),
          review: content(CONTENT_OWNER_SCOPE),
        }),
      ] as unknown as Grant[],
      'hr.employee': [
        page('talent.trainingEvaluations'),
        trainingEvaluationResource.reference().grant({
          respond: { trainingEvaluations: EVALUATION_RESPONDENT_SCOPE },
        }),
        practicalResource.reference().grant({
          witness: {
            practicalAssessments: ALL,
            practicalRecords: PRACTICAL_WITNESS_SCOPE,
            employees: SELF_SCOPE,
          },
        }),
        agentClientResource.reference().grant({
          issueToken: { agentClients: ALL, agentTokens: AGENT_TOKEN_OWN_SCOPE },
        }),
      ] as unknown as Grant[],
    };
    const title = (key: string, fallback: string) =>
      encodeAuthorizationTitle({ key, ns: 'hr' }) ?? fallback;
    const created: Record<string, { title: string; grants: Grant[] }> = {
      [PRACTICAL_ASSESSOR_SET]: {
        title: title('permissionSets.hrPracticalAssessor', PRACTICAL_ASSESSOR_SET),
        grants: [
          page('talent.practicals'),
          practicalResource.reference().grant({
            view: {
              practicalAssessments: ALL,
              practicalRecords: PRACTICAL_ASSESSOR_OWN_SCOPE,
              employees: ALL,
            },
            conduct: {
              practicalAssessments: ALL,
              practicalRecords: PRACTICAL_ASSESSOR_OWN_SCOPE,
              employees: ALL,
            },
          }),
        ] as unknown as Grant[],
      },
      [TICKET_INTEGRATION_SET]: {
        title: title('permissionSets.hrTicketIntegration', TICKET_INTEGRATION_SET),
        grants: [
          knowledgeCandidateResource
            .reference()
            .grant({ ingest: { knowledgeCandidates: ALL } }),
        ] as unknown as Grant[],
      },
    };
    const now = new Date();
    for (const [key, set] of Object.entries(created)) {
      const existing = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', key)
        .executeTakeFirst();
      if (existing) continue;
      await query
        .insertInto('authorizationPermissionSets')
        .values({
          id: key,
          key,
          title: set.title,
          grants: JSON.stringify(set.grants),
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
    for (const [key, grants] of Object.entries(additions)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      // hr.instructor comes with V3-09; a set that is missing is left alone.
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
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

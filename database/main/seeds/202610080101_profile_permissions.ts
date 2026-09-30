import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  assessmentResource,
  employeeResource,
  jobEventResource,
  MANAGED_DEPARTMENTS_SCOPE,
  SELF_SCOPE,
} from '../../../server/providers/hr/authz-resources.js';
import {
  certificateResource,
  certificationResource,
  trainingReportResource,
} from '../../../server/providers/hr/exam-resources.js';
import {
  learningHistoryResource,
  OWNED_BY_ME_SCOPE,
} from '../../../server/providers/hr/learning-resources.js';
import { revisionResource } from '../../../server/providers/hr/content-resources.js';
import {
  auditResource,
  competencySuggestionResource,
  findPeopleResource,
  profileSummaryResource,
  signalResource,
  talentAnalystResource,
  teamDashboardResource,
  trainingRecommendationResource,
} from '../../../server/providers/hr/profile/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';
const MANAGED = MANAGED_DEPARTMENTS_SCOPE;
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
 * V3-11 画像、联动与内容维护, the permission matrix of this step:
 *
 * - hr.admin: the six pages and every new action, all records; the talent
 *   analyst (use and configure); revision suggestions.
 * - hr.manager: 待我决定, 团队看板, 找人 and 业务数据 (read only) within the
 *   managed departments; level suggestions and training recommendations
 *   (view, approve / accept, reject) where they head the department or are
 *   the named reviewer; profile summaries; the analyst (use).
 * - hr.instructor: 修订建议 on their own content.
 * - hr.employee: their own profile summary and business-data timeline.
 * - hr.auditor (new): 审计导出, 培训报表, 员工 (read only, no sensitive
 *   fields), 认证项目 (read only); the audit exports; no write action.
 * - hr.integration (new): `talent.signal.ingest` only, for the API key of
 *   the quality system's integration account.
 *
 * New sets are created when missing; for existing sets only missing actions
 * are appended, so an administrator's edits stay.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610080101_profile_permissions',
  transaction: true,
  async run({ query }) {
    const analystUse = (scope: string) =>
      talentAnalystResource.reference().grant({ use: { employees: scope } });
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        ...[
          'talent.decisions',
          'talent.teamDashboard',
          'talent.findPeople',
          'talent.signals',
          'talent.revisions',
          'talent.audit',
        ].map(page),
        signalResource.reference().grant({
          view: { businessSignals: ALL, signalCompetencyRules: ALL },
          import: { businessSignals: ALL },
          match: { businessSignals: ALL, employees: ALL },
          manageRules: { signalCompetencyRules: ALL },
        }),
        competencySuggestionResource.reference().grant({
          view: { competencySuggestions: ALL },
          accept: { competencySuggestions: ALL },
          reject: { competencySuggestions: ALL },
        }),
        trainingRecommendationResource.reference().grant({
          view: { trainingRecommendations: ALL },
          approve: { trainingRecommendations: ALL },
          reject: { trainingRecommendations: ALL },
          retryWriteback: { trainingRecommendations: ALL },
        }),
        teamDashboardResource
          .reference()
          .grant({ view: { employees: ALL }, export: { employees: ALL } }),
        findPeopleResource.reference().grant({ use: { employees: ALL } }),
        profileSummaryResource.reference().grant({
          view: { employees: ALL },
          regenerate: { employees: ALL },
        }),
        auditResource.reference().grant({
          exportTrainingFile: { employees: ALL },
          exportRecommendationProof: { trainingRecommendations: ALL },
          exportQualificationLedger: { employees: ALL },
          exportAuditPack: { employees: ALL },
        }),
        talentAnalystResource
          .reference()
          .grant({ use: { employees: ALL }, configure }),
        revisionResource.reference().grant({
          view: { contentRevisions: ALL },
          accept: { contentRevisions: ALL },
          reject: { contentRevisions: ALL },
          apply: { contentRevisions: ALL },
        }),
      ] as unknown as Grant[],
      'hr.manager': [
        ...[
          'talent.decisions',
          'talent.teamDashboard',
          'talent.findPeople',
          'talent.signals',
        ].map(page),
        signalResource.reference().grant({
          view: { businessSignals: MANAGED, signalCompetencyRules: ALL },
        }),
        competencySuggestionResource.reference().grant({
          view: { competencySuggestions: MANAGED },
          accept: { competencySuggestions: MANAGED },
          reject: { competencySuggestions: MANAGED },
        }),
        trainingRecommendationResource.reference().grant({
          view: { trainingRecommendations: MANAGED },
          approve: { trainingRecommendations: MANAGED },
          reject: { trainingRecommendations: MANAGED },
        }),
        teamDashboardResource.reference().grant({
          view: { employees: MANAGED },
          export: { employees: MANAGED },
        }),
        findPeopleResource.reference().grant({ use: { employees: MANAGED } }),
        profileSummaryResource.reference().grant({
          view: { employees: MANAGED },
          regenerate: { employees: MANAGED },
        }),
        analystUse(MANAGED),
      ] as unknown as Grant[],
      'hr.instructor': [
        page('talent.revisions'),
        revisionResource.reference().grant({
          view: { contentRevisions: OWNED_BY_ME_SCOPE },
          accept: { contentRevisions: OWNED_BY_ME_SCOPE },
          reject: { contentRevisions: OWNED_BY_ME_SCOPE },
          apply: { contentRevisions: OWNED_BY_ME_SCOPE },
        }),
      ] as unknown as Grant[],
      'hr.employee': [
        profileSummaryResource
          .reference()
          .grant({ view: { employees: SELF_SCOPE } }),
      ] as unknown as Grant[],
    };
    const created: Record<string, { title: string; grants: Grant[] }> = {
      'hr.auditor': {
        title:
          encodeAuthorizationTitle({
            key: 'permissionSets.hrAuditor',
            ns: 'hr',
          }) ?? 'hr.auditor',
        grants: [
          page('talent.audit'),
          page('talent.trainingReports'),
          page('talent.employees'),
          page('talent.certifications'),
          employeeResource
            .reference()
            .grant({ view: { employees: ALL }, list: { employees: ALL } }),
          jobEventResource.reference().grant({ view: { jobEvents: ALL } }),
          assessmentResource
            .reference()
            .grant({ view: { employeeCompetencies: ALL } }),
          learningHistoryResource
            .reference()
            .grant({ view: { assignments: ALL, learningRecords: ALL } }),
          certificationResource.reference().grant({
            view: {
              certifications: ALL,
              certificationCourses: ALL,
              certificationExams: ALL,
            },
          }),
          certificateResource.reference().grant({
            view: { employeeCertificates: ALL },
            download: { employeeCertificates: ALL },
          }),
          trainingReportResource.reference().grant({
            view: {
              employees: ALL,
              assignments: ALL,
              examAttempts: ALL,
              employeeCertificates: ALL,
            },
          }),
          auditResource.reference().grant({
            exportTrainingFile: { employees: ALL },
            exportRecommendationProof: { trainingRecommendations: ALL },
            exportQualificationLedger: { employees: ALL },
            exportAuditPack: { employees: ALL },
          }),
        ] as unknown as Grant[],
      },
      'hr.integration': {
        title:
          encodeAuthorizationTitle({
            key: 'permissionSets.hrIntegration',
            ns: 'hr',
          }) ?? 'hr.integration',
        grants: [
          signalResource
            .reference()
            .grant({ ingest: { businessSignals: ALL } }),
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
      if (!row) throw new Error(`Missing required permission set: ${key}`);
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

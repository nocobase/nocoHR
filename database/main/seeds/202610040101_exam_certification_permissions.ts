import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { SELF_SCOPE } from '../../../server/providers/hr/authz-resources.js';
import {
  certificationStewardResource,
  examinerResource,
  examResource,
  externalCertificateResource,
} from '../../../server/providers/hr/exam-resources.js';
import { OWNED_BY_ME_SCOPE } from '../../../server/providers/hr/learning-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';
const configure = {
  aiAutomationSettings: ALL,
  aiTaskRuns: ALL,
  aiTaskRunItems: ALL,
};

/**
 * V3-10 考试与认证, the permission matrix of this step's new operations:
 *
 * - hr.admin: 外部证书核验 page; integrity review, voiding attempts and the
 *   exam → competency rule; registering and verifying external
 *   certificates; the examiner (use and configure).
 * - hr.instructor: integrity review and voiding on their own exams; the
 *   examiner (suggestions on the attempts of their exams).
 * - hr.employee: registering their own external certificates; the examiner
 *   (their own results); the certification steward for their own
 *   certificates.
 *
 * Only missing actions are appended; grants an administrator changed stay.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610040101_exam_certification_permissions',
  transaction: true,
  async run({ query }) {
    const page = (id: string): Grant => ({
      resource: { type: 'page', id },
      actions: [{ action: 'access' }],
    });
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        page('talent.externalCerts'),
        examResource.reference().grant({
          reviewIntegrity: { exams: ALL, examAttempts: ALL },
          voidAttempt: { exams: ALL, examAttempts: ALL },
          configure: { exams: ALL },
        }) as unknown as Grant,
        externalCertificateResource.reference().grant({
          register: {
            employees: ALL,
            certifications: ALL,
            employeeCertificates: ALL,
          },
          verify: {
            employees: ALL,
            certifications: ALL,
            employeeCertificates: ALL,
          },
        }) as unknown as Grant,
        examinerResource.reference().grant({
          use: { examAttempts: ALL },
          configure,
        }) as unknown as Grant,
      ],
      'hr.instructor': [
        examResource.reference().grant({
          reviewIntegrity: { exams: OWNED_BY_ME_SCOPE, examAttempts: ALL },
          voidAttempt: { exams: OWNED_BY_ME_SCOPE, examAttempts: ALL },
        }) as unknown as Grant,
        examinerResource
          .reference()
          .grant({ use: { examAttempts: ALL } }) as unknown as Grant,
      ],
      'hr.employee': [
        externalCertificateResource.reference().grant({
          register: {
            employees: SELF_SCOPE,
            certifications: ALL,
            employeeCertificates: SELF_SCOPE,
          },
        }) as unknown as Grant,
        examinerResource
          .reference()
          .grant({ use: { examAttempts: SELF_SCOPE } }) as unknown as Grant,
        certificationStewardResource.reference().grant({
          use: { employees: SELF_SCOPE, employeeCertificates: SELF_SCOPE },
        }) as unknown as Grant,
      ],
    };
    for (const [key, grants] of Object.entries(additions)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
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

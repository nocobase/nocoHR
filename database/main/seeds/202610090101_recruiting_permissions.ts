import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  candidateResource,
  interviewResource,
  newHireCheckInResource,
  offerResource,
  postingResource,
  recruitingAssistantResource,
  recruitingReportResource,
  recruitingSettingsResource,
  requisitionResource,
  workforcePlanResource,
} from '../../../server/providers/hr/recruiting/resources.js';

/**
 * V2-07 权限配置. Creates 招聘专员 hr.recruiter and the ERP integration set
 * hr.integrationErp (only writes production plans) when missing, and adds the
 * step's business operations and pages to the existing sets:
 *
 * - hr.recruiter: postings, candidates (with contact data), interviews,
 *   offers (with the salary of their requisitions' offers), reports in detail;
 * - hr.admin: workforce plans, requisition approval and the recruiter,
 *   postings read-only, interviews it is assigned to, turning accepted offers
 *   into onboarding actions (no salary), report totals, 招聘设置, the
 *   recruiting assistant's configuration — never candidate contact data or
 *   offer salaries;
 * - hr.manager: workforce plans and requisitions of the departments they
 *   manage, related candidates without contact data, their interviews,
 *   hiring-manager approval of offers (no salary);
 * - hr.employee: scoring an interview that names them, their own check-ins;
 * - hr.payrollApprover: offer salary review; hr.payroll: the offer salary for
 *   待建档.
 *
 * Record scope is decided by the services from the records (see
 * recruiting/resources.ts). Adds what is missing; an administrator's edits
 * stay. Assignments (recruit01, integration_mes) belong to the demo seed.
 */
type Grant = {
  resource: { type: string; id: string };
  actions: { action: string }[];
};

const ALL = 'allRecords';
const all = (...collections: string[]) =>
  Object.fromEntries(collections.map((c) => [c, ALL]));

const PARTS = {
  plan: {
    view: all('workforcePlans'),
    decide: all('workforcePlans'),
    import: all('workforcePlans'),
  },
  requisition: {
    view: all('jobRequisitions'),
    create: all('jobRequisitions'),
    approve: all('jobRequisitions'),
    assignRecruiter: all('jobRequisitions'),
  },
  posting: {
    view: all('jobPostings', 'jobRequisitions'),
    manage: all('jobPostings', 'jobRequisitions'),
    publish: all('jobPostings'),
  },
  candidate: {
    view: all('candidates', 'applications'),
    viewContact: all('candidates'),
    manage: all('candidates', 'applications'),
    decide: all('applications'),
    anonymize: all('candidates'),
  },
  interview: {
    view: all('interviews'),
    schedule: all('interviews', 'applications'),
    score: all('interviews'),
  },
  offer: {
    view: all('offers'),
    viewSalary: all('offers'),
    manage: all('offers'),
    approve: all('offers'),
    send: all('offers'),
    onboard: all('offers'),
  },
  report: {
    view: all('applications'),
    detail: all('applications', 'jobRequisitions'),
  },
  settings: { manage: all('jobPostings') },
  checkIn: { view: all('newHireCheckIns') },
  assistant: {
    use: all('applications'),
    configure: all('jobPostings'),
  },
} as const;

type Parts = typeof PARTS;
function pick<K extends keyof Parts>(key: K, actions: (keyof Parts[K])[]) {
  return Object.fromEntries(
    actions.map((a) => [a, (PARTS[key] as Record<string, unknown>)[a as string]]),
  );
}

const composites = [
  {
    resource: workforcePlanResource,
    grants: {
      'hr.admin': pick('plan', ['view', 'decide', 'import']),
      'hr.manager': pick('plan', ['view', 'decide']),
      'hr.integrationErp': pick('plan', ['import']),
    },
  },
  {
    resource: requisitionResource,
    grants: {
      'hr.admin': pick('requisition', ['view', 'create', 'approve', 'assignRecruiter']),
      'hr.manager': pick('requisition', ['view', 'create', 'approve']),
      'hr.recruiter': pick('requisition', ['view']),
    },
  },
  {
    resource: postingResource,
    grants: {
      'hr.recruiter': pick('posting', ['view', 'manage', 'publish']),
      'hr.admin': pick('posting', ['view']),
    },
  },
  {
    resource: candidateResource,
    grants: {
      'hr.recruiter': pick('candidate', ['view', 'viewContact', 'manage', 'decide', 'anonymize']),
      'hr.manager': pick('candidate', ['view']),
    },
  },
  {
    resource: interviewResource,
    grants: {
      'hr.recruiter': pick('interview', ['view', 'schedule', 'score']),
      'hr.admin': pick('interview', ['view', 'score']),
      'hr.manager': pick('interview', ['view', 'score']),
      'hr.employee': pick('interview', ['view', 'score']),
    },
  },
  {
    resource: offerResource,
    grants: {
      'hr.recruiter': pick('offer', ['view', 'viewSalary', 'manage', 'send']),
      'hr.manager': pick('offer', ['view', 'approve']),
      'hr.payrollApprover': pick('offer', ['view', 'viewSalary', 'approve']),
      'hr.payroll': pick('offer', ['viewSalary']),
      'hr.admin': pick('offer', ['onboard']),
    },
  },
  {
    resource: recruitingReportResource,
    grants: {
      'hr.recruiter': pick('report', ['view', 'detail']),
      'hr.admin': pick('report', ['view']),
    },
  },
  {
    resource: recruitingSettingsResource,
    grants: { 'hr.admin': pick('settings', ['manage']) },
  },
  {
    resource: newHireCheckInResource,
    grants: {
      'hr.admin': pick('checkIn', ['view']),
      'hr.employee': pick('checkIn', ['view']),
    },
  },
  {
    resource: recruitingAssistantResource,
    grants: {
      'hr.recruiter': pick('assistant', ['use']),
      'hr.manager': pick('assistant', ['use']),
      'hr.admin': pick('assistant', ['use', 'configure']),
    },
  },
] as const;

const pages: Record<string, readonly string[]> = {
  'hr.recruiter': [
    'talent.requisitions',
    'talent.postings',
    'talent.candidates',
    'talent.interviews',
    'talent.offers',
    'talent.recruitingReports',
  ],
  'hr.admin': [
    'talent.workforcePlans',
    'talent.requisitions',
    'talent.postings',
    'talent.interviews',
    'talent.offers',
    'talent.recruitingReports',
    'talent.recruitingSettings',
  ],
  'hr.manager': [
    'talent.workforcePlans',
    'talent.requisitions',
    'talent.candidates',
    'talent.interviews',
    'talent.offers',
  ],
  'hr.payrollApprover': ['talent.offers'],
  'hr.employee': [],
  'hr.payroll': [],
  'hr.integrationErp': [],
};

const NEW_SETS: Record<string, string> = {
  'hr.recruiter': 'recruiting.permissionSets.hrRecruiter',
  'hr.integrationErp': 'recruiting.permissionSets.hrIntegrationErp',
};

function decode(value: unknown): Grant[] {
  let decoded: unknown = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
    decoded = JSON.parse(decoded);
  if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
  return decoded as Grant[];
}

const seed: SeedDefinition = defineSeed({
  name: '202610090101_recruiting_permissions',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    for (const key of Object.keys(pages)) {
      let row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row && NEW_SETS[key]) {
        await query
          .insertInto('authorizationPermissionSets')
          .values({
            id: key,
            key,
            title: encodeAuthorizationTitle({ key: NEW_SETS[key], ns: 'hr' }),
            grants: JSON.stringify([]),
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        row = { id: key, grants: '[]' };
      }
      // A set this step only adds to (hr.payroll, hr.payrollApprover) may be absent in a trimmed install.
      if (!row) continue;
      const list = decode(row.grants);
      const before = JSON.stringify(list);
      for (const composite of composites) {
        const addition = (composite.grants as Record<string, unknown>)[key];
        if (!addition) continue;
        const reference = composite.resource.reference() as unknown as {
          grant(assignments: unknown): Grant;
        };
        const grant = reference.grant(addition);
        const existing = list.find(
          (item) =>
            item.resource.type === grant.resource.type &&
            item.resource.id === grant.resource.id,
        );
        if (!existing) list.push(grant);
        else
          for (const action of grant.actions)
            if (!existing.actions.some((item) => item.action === action.action))
              existing.actions.push(action);
      }
      for (const id of pages[key]) {
        const page = list.find(
          (item) => item.resource.type === 'page' && item.resource.id === id,
        );
        if (!page)
          list.push({
            resource: { type: 'page', id },
            actions: [{ action: 'access' }],
          });
        else if (!page.actions.some((a) => a.action === 'access'))
          page.actions.push({ action: 'access' });
      }
      if (JSON.stringify(list) !== before)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(list), updatedAt: now })
          .where('id', '=', String(row.id))
          .execute();
    }
  },
});
export default seed;

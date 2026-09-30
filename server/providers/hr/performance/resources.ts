/**
 * V4-12 绩效: the permission model — collections, business operations and
 * their field capabilities, and the record scopes (record-access.ts). The
 * field lists here are the field grants the specification's matrix asks to
 * be "declared in code":
 *
 * - `talent.reviewResultRating.view` (hr.payroll, hr.payrollApprover) reads
 *   only the published result's cycleId, employeeId, schemeId, finalRating,
 *   status and publishedAt — never comments, items, snapshots or the
 *   calibration log. Its record scopes answer published results only (all of
 *   them, or the ones a salary adjustment links to).
 * - `talent.reviewScheme.view` reads the bonus coefficients (hr.admin, read
 *   only); `manage` never writes them; only `manageCoefficients`
 *   (hr.payroll) does, and it reads nothing else of the scheme but its
 *   rating scale.
 * - Reviews and results are reached through the performance scopes: one's own
 *   (the person, or the reviewer of a task), the team (managed departments
 *   and the people one is the manager or skip-level reviewer of) or all.
 *   Peer identities, drafts and hints are further filtered by the services.
 */
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { defineCompositeResource } from '@nocobase/authorization/core';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from '../automation-resources.js';
import { EMPLOYEE_BASE_FIELDS } from '../authz-resources.js';
import { label } from '../shared.js';

/** One's own goals, results and the review tasks one is the reviewer of. */
export const PERFORMANCE_SELF_SCOPE = 'talent.performanceSelf';
/** Managed departments, plus the people one is the manager or skip-level reviewer of. */
export const PERFORMANCE_TEAM_SCOPE = 'talent.performanceTeam';
/** Published results only (hr.payroll). */
export const PERFORMANCE_PUBLISHED_SCOPE = 'talent.performancePublished';
/** Published results a salary adjustment links to (hr.payrollApprover). */
export const PERFORMANCE_LINKED_SCOPE = 'talent.performanceLinked';

export const SCHEME_FIELDS = [
  'id',
  'title',
  'appliesTo',
  'sections',
  'ratingScale',
  'stages',
  'qualitySafetyRules',
  'distributionGuide',
  'scoring',
  'active',
  'customFields',
  'updatedBy',
  'createdAt',
  'updatedAt',
] as const;
export const CYCLE_FIELDS = [
  'id',
  'title',
  'periodStart',
  'periodEnd',
  'scope',
  'stageDeadlines',
  'autoAdvance',
  'status',
  'ownerUserId',
  'exclusions',
  'stageLog',
  'calibrationPack',
  'publishedAt',
  'createdAt',
  'updatedAt',
] as const;
export const GOAL_FIELDS = [
  'id',
  'cycleId',
  'employeeId',
  'departmentId',
  'title',
  'measure',
  'weight',
  'alignedGoalId',
  'progress',
  'progressNotes',
  'status',
  'source',
  'editedByEmployee',
  'createdBy',
  'submittedAt',
  'approvedBy',
  'approvedAt',
  'returnNote',
  'createdAt',
  'updatedAt',
] as const;
export const REVIEW_FIELDS = [
  'id',
  'cycleId',
  'resultId',
  'employeeId',
  'reviewerUserId',
  'role',
  'items',
  'overallRating',
  'overallReason',
  'comment',
  'status',
  'aiDraft',
  'aiDraftAdoption',
  'activeSeconds',
  'submissionCount',
  'submittedAt',
  'hints',
  'createdAt',
  'updatedAt',
] as const;
export const RESULT_FIELDS = [
  'id',
  'cycleId',
  'employeeId',
  'schemeId',
  'departmentId',
  'positionId',
  'managerUserId',
  'skipLevelUserId',
  'skipLevelSkipped',
  'noAccount',
  'peerUserIds',
  'peerStatus',
  'evidenceSnapshot',
  'evidenceSummary',
  'computedScore',
  'managerRating',
  'calibratedRating',
  'finalRating',
  'adjustments',
  'status',
  'closedReason',
  'appeal',
  'publishedAt',
  'acknowledgedAt',
  'createdAt',
  'updatedAt',
] as const;
/** What payroll may read of a result (与薪酬的衔接): no comment, item, snapshot or calibration record. */
export const RATING_FIELDS = [
  'id',
  'cycleId',
  'employeeId',
  'schemeId',
  'finalRating',
  'status',
  'publishedAt',
] as const;

const employees = defineDatabasePermission((p) =>
  p.collection('employees').read([...EMPLOYEE_BASE_FIELDS]),
);
const schemesRead = defineDatabasePermission((p) =>
  p.collection('reviewSchemes').read([...SCHEME_FIELDS, 'ratingCoefficients']),
);
const schemesWrite = defineDatabasePermission((p) =>
  p
    .collection('reviewSchemes')
    .read([...SCHEME_FIELDS, 'ratingCoefficients'])
    .create([...SCHEME_FIELDS])
    .update([...SCHEME_FIELDS]),
);
const coefficientsWrite = defineDatabasePermission((p) =>
  p
    .collection('reviewSchemes')
    .read(['id', 'title', 'active', 'ratingScale', 'ratingCoefficients'])
    .update(['ratingCoefficients', 'updatedBy', 'updatedAt']),
);
const cyclesRead = defineDatabasePermission((p) =>
  p.collection('reviewCycles').read([...CYCLE_FIELDS]),
);
const cyclesWrite = defineDatabasePermission((p) =>
  p
    .collection('reviewCycles')
    .read([...CYCLE_FIELDS])
    .create([...CYCLE_FIELDS])
    .update([...CYCLE_FIELDS]),
);
const cycleTitles = defineDatabasePermission((p) =>
  p
    .collection('reviewCycles')
    .read(['id', 'title', 'status', 'periodStart', 'periodEnd', 'publishedAt']),
);
const goalsRead = defineDatabasePermission((p) =>
  p.collection('goals').read([...GOAL_FIELDS]),
);
const goalsWrite = defineDatabasePermission((p) =>
  p
    .collection('goals')
    .read([...GOAL_FIELDS])
    .create([...GOAL_FIELDS])
    .update([...GOAL_FIELDS]),
);
const goalsApprove = defineDatabasePermission((p) =>
  p
    .collection('goals')
    .read([...GOAL_FIELDS])
    .update(['status', 'approvedBy', 'approvedAt', 'returnNote', 'updatedAt']),
);
const reviewsRead = defineDatabasePermission((p) =>
  p.collection('reviews').read([...REVIEW_FIELDS]),
);
const reviewsWrite = defineDatabasePermission((p) =>
  p
    .collection('reviews')
    .read([...REVIEW_FIELDS])
    .create([...REVIEW_FIELDS])
    .update([...REVIEW_FIELDS]),
);
/** The progress board and the statistics: task states, adoption and editing time, never contents. */
const reviewProgress = defineDatabasePermission((p) =>
  p
    .collection('reviews')
    .read([
      'id',
      'cycleId',
      'resultId',
      'employeeId',
      'reviewerUserId',
      'role',
      'status',
      'aiDraftAdoption',
      'activeSeconds',
      'submissionCount',
      'submittedAt',
    ]),
);
const resultsRead = defineDatabasePermission((p) =>
  p.collection('reviewResults').read([...RESULT_FIELDS]),
);
const resultsWrite = defineDatabasePermission((p) =>
  p
    .collection('reviewResults')
    .read([...RESULT_FIELDS])
    .create([...RESULT_FIELDS])
    .update([...RESULT_FIELDS]),
);
const resultsRating = defineDatabasePermission((p) =>
  p.collection('reviewResults').read([...RATING_FIELDS]),
);
const resultsAppeal = defineDatabasePermission((p) =>
  p
    .collection('reviewResults')
    .read([
      'id',
      'cycleId',
      'employeeId',
      'status',
      'finalRating',
      'appeal',
      'publishedAt',
      'acknowledgedAt',
    ])
    .update(['appeal', 'status', 'acknowledgedAt', 'updatedAt']),
);

export const reviewSchemeResource = defineCompositeResource(
  'talent.reviewScheme',
  (r) =>
    r
      .title(label('performance.authz.reviewScheme.title'))
      .action('view', (a) =>
        a
          .title(label('performance.authz.actions.view'))
          .grant('reviewSchemes', schemesRead),
      )
      .action('manage', (a) =>
        a
          .title(label('performance.authz.actions.manage'))
          .grant('reviewSchemes', schemesWrite),
      )
      .action('manageCoefficients', (a) =>
        a
          .title(label('performance.authz.reviewScheme.manageCoefficients'))
          .grant('reviewSchemes', coefficientsWrite),
      ),
);

export const reviewCycleResource = defineCompositeResource(
  'talent.reviewCycle',
  (r) =>
    r
      .title(label('performance.authz.reviewCycle.title'))
      .action('view', (a) =>
        a
          .title(label('performance.authz.actions.view'))
          .grant('reviewCycles', cyclesRead)
          .grant('reviewResults', resultsRead)
          .grant('reviews', reviewProgress)
          .grant('employees', employees),
      )
      .action('manage', (a) =>
        a
          .title(label('performance.authz.actions.manage'))
          .grant('reviewCycles', cyclesWrite)
          .grant('reviewResults', resultsWrite)
          .grant('employees', employees),
      )
      .action('advance', (a) =>
        a
          .title(label('performance.authz.reviewCycle.advance'))
          .grant('reviewCycles', cyclesWrite)
          .grant('reviewResults', resultsWrite)
          .grant('reviews', reviewsWrite),
      )
      .action('remind', (a) =>
        a
          .title(label('performance.authz.reviewCycle.remind'))
          .grant('reviewCycles', cyclesRead)
          .grant('reviews', reviewProgress),
      ),
);

export const goalResource = defineCompositeResource('talent.goal', (r) =>
  r
    .title(label('performance.authz.goal.title'))
    .action('view', (a) =>
      a
        .title(label('performance.authz.actions.view'))
        .grant('goals', goalsRead)
        .grant('employees', employees),
    )
    .action('manage', (a) =>
      a
        .title(label('performance.authz.actions.manage'))
        .grant('goals', goalsWrite),
    )
    .action('approve', (a) =>
      a
        .title(label('performance.authz.goal.approve'))
        .grant('goals', goalsApprove),
    ),
);

export const reviewResource = defineCompositeResource('talent.review', (r) =>
  r
    .title(label('performance.authz.review.title'))
    .action('view', (a) =>
      a
        .title(label('performance.authz.actions.view'))
        .grant('reviews', reviewsRead)
        .grant('reviewResults', resultsRead)
        .grant('goals', goalsRead)
        .grant('employees', employees),
    )
    .action('write', (a) =>
      a
        .title(label('performance.authz.review.write'))
        .grant('reviews', reviewsWrite),
    )
    .action('submit', (a) =>
      a
        .title(label('performance.authz.review.submit'))
        .grant('reviews', reviewsWrite)
        .grant('reviewResults', resultsWrite),
    ),
);

export const calibrationResource = defineCompositeResource(
  'talent.calibration',
  (r) =>
    r
      .title(label('performance.authz.calibration.title'))
      .action('view', (a) =>
        a
          .title(label('performance.authz.actions.view'))
          .grant('reviewResults', resultsRead)
          .grant('employees', employees),
      )
      .action('adjust', (a) =>
        a
          .title(label('performance.authz.calibration.adjust'))
          .grant('reviewResults', resultsWrite),
      )
      .action('publish', (a) =>
        a
          .title(label('performance.authz.calibration.publish'))
          .grant('reviewResults', resultsWrite)
          .grant('reviewCycles', cyclesWrite),
      ),
);

export const reviewAppealResource = defineCompositeResource(
  'talent.reviewAppeal',
  (r) =>
    r
      .title(label('performance.authz.reviewAppeal.title'))
      .action('submit', (a) =>
        a
          .title(label('performance.authz.reviewAppeal.submit'))
          .grant('reviewResults', resultsAppeal),
      )
      .action('handle', (a) =>
        a
          .title(label('performance.authz.reviewAppeal.handle'))
          .grant('reviewResults', resultsWrite),
      ),
);

export const reviewResultRatingResource = defineCompositeResource(
  'talent.reviewResultRating',
  (r) =>
    r
      .title(label('performance.authz.reviewResultRating.title'))
      .action('view', (a) =>
        a
          .title(label('performance.authz.actions.view'))
          .grant('reviewResults', resultsRating)
          .grant('reviewCycles', cycleTitles)
          .grant('employees', employees),
      ),
);

export const performanceAssistantResource = defineCompositeResource(
  'talent.performanceAssistant',
  (r) =>
    r
      .title(label('performance.authz.performanceAssistant.title'))
      .action('use', (a) =>
        a
          .title(label('performance.authz.performanceAssistant.use'))
          .grant('employees', employees),
      )
      .action('configure', (a) =>
        a
          .title(label('performance.authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

export const PERFORMANCE_COMPOSITES = [
  reviewSchemeResource,
  reviewCycleResource,
  goalResource,
  reviewResource,
  calibrationResource,
  reviewAppealResource,
  reviewResultRatingResource,
  performanceAssistantResource,
] as const;

export const PERFORMANCE_COLLECTIONS: readonly {
  name: string;
  title: string;
}[] = [
  { name: 'reviewSchemes', title: 'performance.collections.reviewSchemes' },
  { name: 'reviewCycles', title: 'performance.collections.reviewCycles' },
  { name: 'goals', title: 'performance.collections.goals' },
  { name: 'reviews', title: 'performance.collections.reviews' },
  { name: 'reviewResults', title: 'performance.collections.reviewResults' },
];

/** The collections the performance record scopes apply to. */
export const PERFORMANCE_SCOPED_COLLECTIONS = [
  'goals',
  'reviews',
  'reviewResults',
] as const;

/** The pages of the step. */
export const PERFORMANCE_PAGES = {
  schemes: 'talent.reviewSchemes',
  cycles: 'talent.reviewCycles',
  myReview: 'talent.myReview',
  teamReviews: 'talent.teamReviews',
  calibration: 'talent.calibration',
} as const;

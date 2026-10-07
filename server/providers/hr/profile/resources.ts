/**
 * V3-11 画像、联动与内容维护: the permission model of business data, the talent
 * analyst's suggestions, the team dashboard, finding people, profile
 * summaries and audit exports.
 *
 * Field capabilities (权限配置 · 补充规则), declared here rather than hidden
 * on the page:
 *
 * - `rawPayload` is read only through `talent.signal.import` (HR
 *   administrators); `view` never reads it.
 * - A quality issue's `summary` is read through `talent.signal.view` within
 *   its scope (HR administrators, heads for their departments). The person it
 *   concerns reads their own through the profile timeline. Nobody else,
 *   auditors included, holds either path.
 * - Auditors read employees without the sensitive fields (mobile, ID number,
 *   birth date, address) and never salary data.
 */
import {
  anyScope,
  condition,
  defineDatabasePermission,
  type DatabaseScope,
} from '@nocobase/app-plugin-authorization/server';
import { defineCompositeResource } from '@nocobase/authorization/core';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from '../automation-resources.js';
import { EMPLOYEE_BASE_FIELDS } from '../authz-resources.js';
import { revisionResource } from '../content-resources.js';
import { label } from '../shared.js';

export const SIGNAL_FIELDS = [
  'id',
  'sourceSystem',
  'externalId',
  'signalType',
  'category',
  'severity',
  'title',
  'summary',
  'occurredAt',
  'employeeId',
  'personKey',
  'departmentId',
  'competencyId',
  'correctiveActionRef',
  'link',
  'matchStatus',
  'customFields',
  'channel',
  'ingestedBy',
  'createdAt',
  'updatedAt',
] as const;
/** HR administrators only: the payload as the source system sent it. */
export const SIGNAL_ADMIN_FIELDS = [...SIGNAL_FIELDS, 'rawPayload'] as const;

export const SIGNAL_RULE_FIELDS = [
  'id',
  'sourceSystem',
  'category',
  'competencyId',
  'source',
  'reviewStatus',
  'note',
  'createdBy',
  'confirmedBy',
  'confirmedAt',
  'createdAt',
  'updatedAt',
] as const;

export const SUGGESTION_FIELDS = [
  'id',
  'employeeId',
  'competencyId',
  'departmentId',
  'currentLevel',
  'suggestedLevel',
  'rationale',
  'evidence',
  'reviewerUserId',
  'status',
  'decidedLevel',
  'reviewedBy',
  'reviewedAt',
  'reviewNote',
  'assessmentId',
  'source',
  'createdAt',
  'updatedAt',
] as const;

export const RECOMMENDATION_FIELDS = [
  'id',
  'departmentId',
  'competencyId',
  'reason',
  'evidence',
  'audience',
  'items',
  'dueDate',
  'correctiveActionRefs',
  'reviewerUserId',
  'status',
  'reviewedBy',
  'reviewedAt',
  'reviewNote',
  'completedAt',
  'certificateFileId',
  'writebackStatus',
  'writebackError',
  'writebackAt',
  'source',
  'createdAt',
  'updatedAt',
] as const;

/** What profile reads, dashboards, finding people and audit exports read of an employee: never the sensitive fields. */
export const PROFILE_EMPLOYEE_FIELDS = [
  ...EMPLOYEE_BASE_FIELDS,
  'aiSummary',
  'aiSummaryAt',
  'aiSummaryEvidence',
] as const;

const read = (collection: string, fields: readonly string[]) =>
  defineDatabasePermission((p) =>
    p
      .collection(collection)
      .title(label(`collections.${collection}`))
      .read([...fields]),
  );

const signalRead = read('businessSignals', SIGNAL_FIELDS);
const signalAdminRead = read('businessSignals', SIGNAL_ADMIN_FIELDS);
const ruleRead = read('signalCompetencyRules', SIGNAL_RULE_FIELDS);
const employeeRead = read('employees', PROFILE_EMPLOYEE_FIELDS);
const suggestionRead = read('competencySuggestions', SUGGESTION_FIELDS);
const recommendationRead = read(
  'trainingRecommendations',
  RECOMMENDATION_FIELDS,
);

/** 业务数据: ingest is the integration account's only action; view is scoped by the person's department. */
export const signalResource = defineCompositeResource('talent.signal', (r) =>
  r
    .title(label('authz.signal.title'))
    .action('ingest', (a) =>
      a
        .title(label('authz.signal.ingest'))
        .grant(
          'businessSignals',
          signalAdminRead
            .create([...SIGNAL_ADMIN_FIELDS])
            .update([...SIGNAL_ADMIN_FIELDS]),
        ),
    )
    .action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant('businessSignals', signalRead)
        .grant('signalCompetencyRules', ruleRead),
    )
    .action('import', (a) =>
      a
        .title(label('authz.signal.import'))
        .grant(
          'businessSignals',
          signalAdminRead
            .create([...SIGNAL_ADMIN_FIELDS])
            .update([...SIGNAL_ADMIN_FIELDS]),
        ),
    )
    .action('match', (a) =>
      a
        .title(label('authz.signal.match'))
        .grant(
          'businessSignals',
          signalRead.update([
            'employeeId',
            'departmentId',
            'competencyId',
            'matchStatus',
            'updatedAt',
          ]),
        )
        .grant('employees', employeeRead),
    )
    .action('manageRules', (a) =>
      a
        .title(label('authz.signal.manageRules'))
        .grant(
          'signalCompetencyRules',
          ruleRead
            .create([...SIGNAL_RULE_FIELDS])
            .update([...SIGNAL_RULE_FIELDS]),
        ),
    ),
);

const suggestionDecide = suggestionRead.update([
  'status',
  'decidedLevel',
  'reviewedBy',
  'reviewedAt',
  'reviewNote',
  'assessmentId',
  'updatedAt',
]);
/** 能力等级建议: the head of the employee's department (or the named reviewer) decides. */
export const competencySuggestionResource = defineCompositeResource(
  'talent.competencySuggestion',
  (r) =>
    r
      .title(label('authz.competencySuggestion.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('competencySuggestions', suggestionRead),
      )
      .action('accept', (a) =>
        a
          .title(label('authz.competencySuggestion.accept'))
          .grant('competencySuggestions', suggestionDecide),
      )
      .action('reject', (a) =>
        a
          .title(label('authz.competencySuggestion.reject'))
          .grant('competencySuggestions', suggestionDecide),
      ),
);

const recommendationDecide = recommendationRead.update([
  'audience',
  'status',
  'reviewedBy',
  'reviewedAt',
  'reviewNote',
  'writebackStatus',
  'writebackError',
  'writebackAt',
  'updatedAt',
]);
/** 专项培训建议: same scope as the level suggestions; retrying the 8D write-back is for HR administrators. */
export const trainingRecommendationResource = defineCompositeResource(
  'talent.trainingRecommendation',
  (r) =>
    r
      .title(label('authz.trainingRecommendation.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('trainingRecommendations', recommendationRead),
      )
      .action('approve', (a) =>
        a
          .title(label('authz.trainingRecommendation.approve'))
          .grant('trainingRecommendations', recommendationDecide),
      )
      .action('reject', (a) =>
        a
          .title(label('authz.trainingRecommendation.reject'))
          .grant('trainingRecommendations', recommendationDecide),
      )
      .action('retryWriteback', (a) =>
        a
          .title(label('authz.trainingRecommendation.retryWriteback'))
          .grant('trainingRecommendations', recommendationDecide),
      ),
);

export const teamDashboardResource = defineCompositeResource(
  'talent.teamDashboard',
  (r) =>
    r
      .title(label('authz.teamDashboard.title'))
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('employees', employeeRead),
      )
      .action('export', (a) =>
        a
          .title(label('authz.teamDashboard.export'))
          .grant('employees', employeeRead),
      ),
);

export const findPeopleResource = defineCompositeResource(
  'talent.findPeople',
  (r) =>
    r
      .title(label('authz.findPeople.title'))
      .action('use', (a) =>
        a.title(label('authz.findPeople.use')).grant('employees', employeeRead),
      ),
);

/** view: oneself, heads within scope, HR; regenerate: heads within scope and HR. */
export const profileSummaryResource = defineCompositeResource(
  'talent.profileSummary',
  (r) =>
    r
      .title(label('authz.profileSummary.title'))
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('employees', employeeRead),
      )
      .action('regenerate', (a) =>
        a
          .title(label('authz.profileSummary.regenerate'))
          .grant('employees', employeeRead),
      ),
);

/** 审计导出 (hr.admin, hr.auditor): read-only exports; every export is logged. */
export const auditResource = defineCompositeResource('talent.audit', (r) =>
  r
    .title(label('authz.audit.title'))
    .action('exportTrainingFile', (a) =>
      a
        .title(label('authz.audit.exportTrainingFile'))
        .grant('employees', employeeRead),
    )
    .action('exportRecommendationProof', (a) =>
      a
        .title(label('authz.audit.exportRecommendationProof'))
        .grant('trainingRecommendations', recommendationRead),
    )
    .action('exportQualificationLedger', (a) =>
      a
        .title(label('authz.audit.exportQualificationLedger'))
        .grant('employees', employeeRead),
    )
    .action('exportAuditPack', (a) =>
      a
        .title(label('authz.audit.exportAuditPack'))
        .grant('employees', employeeRead),
    )
    // V4-14 审计导出扩展: 持证操作追溯 and 权限变化记录 (licensed/exports.ts).
    .action('exportStartTrace', (a) =>
      a
        .title(label('licensed.authz.exportStartTrace'))
        .grant('employees', employeeRead),
    )
    .action('exportPermissionChanges', (a) =>
      a
        .title(label('licensed.authz.exportPermissionChanges'))
        .grant('employees', employeeRead),
    ),
);

export const talentAnalystResource = defineCompositeResource(
  'talent.talentAnalyst',
  (r) =>
    r
      .title(label('authz.talentAnalyst.title'))
      .action('use', (a) =>
        a
          .title(label('authz.talentAnalyst.use'))
          .grant('employees', employeeRead),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

/**
 * 审核请求 (客户审核问询): view lists the requests and their mail; confirm
 * edits and confirms the scope and builds the pack (which also needs
 * talent.audit exportAuditPack); share sends the reply with the share link;
 * revoke ends a link early. The requests are read through the service, which
 * checks these actions; the employee grant is what the scope and risks read.
 */
export const auditRequestResource = defineCompositeResource(
  'talent.auditRequest',
  (r) =>
    r
      .title(label('authz.auditRequest.title'))
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('employees', employeeRead),
      )
      .action('confirm', (a) =>
        a
          .title(label('authz.auditRequest.confirm'))
          .grant('employees', employeeRead),
      )
      .action('share', (a) =>
        a
          .title(label('authz.auditRequest.share'))
          .grant('employees', employeeRead),
      )
      .action('revoke', (a) =>
        a
          .title(label('authz.auditRequest.revoke'))
          .grant('employees', employeeRead),
      ),
);

export const PROFILE_COLLECTIONS: readonly { name: string; title: string }[] = [
  { name: 'businessSignals', title: 'collections.businessSignals' },
  {
    name: 'signalCompetencyRules',
    title: 'collections.signalCompetencyRules',
  },
  {
    name: 'competencySuggestions',
    title: 'collections.competencySuggestions',
  },
  {
    name: 'trainingRecommendations',
    title: 'collections.trainingRecommendations',
  },
  // Registered here: V2 step 6 declared the revision composite but never registered it.
  { name: 'contentRevisions', title: 'collections.contentRevisions' },
];

export const PROFILE_COMPOSITES = [
  signalResource,
  competencySuggestionResource,
  trainingRecommendationResource,
  teamDashboardResource,
  findPeopleResource,
  profileSummaryResource,
  auditResource,
  auditRequestResource,
  talentAnalystResource,
  revisionResource,
] as const;

/** Collections the managed-departments and self scopes reach (record-access.ts). */
export const PROFILE_SCOPED_COLLECTIONS = [
  'businessSignals',
  'competencySuggestions',
  'trainingRecommendations',
] as const;

function anyOf(field: string, values: readonly string[]): DatabaseScope {
  return values.length
    ? anyScope(values.map((value) => condition(field, '$eq', value)))
    : false;
}

/**
 * The managed-departments scope of this step's collections: a signal by its
 * department (the department at the time) or its person; a suggestion by its
 * employee or its named reviewer; a recommendation by its department or its
 * reviewer. `undefined` for other collections.
 */
export function profileManagedScope(
  collection: string,
  context: {
    userId: string;
    departments: readonly string[];
    employees: readonly string[];
  },
): DatabaseScope | undefined {
  const pick = (scopes: DatabaseScope[]): DatabaseScope => {
    const present = scopes.filter((scope) => scope !== false);
    return present.length ? anyScope(present) : false;
  };
  if (collection === 'businessSignals')
    return pick([
      anyOf('departmentId', context.departments),
      anyOf('employeeId', context.employees),
    ]);
  if (collection === 'competencySuggestions')
    return pick([
      anyOf('employeeId', context.employees),
      condition('reviewerUserId', '$eq', context.userId),
    ]);
  if (collection === 'trainingRecommendations')
    return pick([
      anyOf('departmentId', context.departments),
      condition('reviewerUserId', '$eq', context.userId),
    ]);
  return undefined;
}

/** The self scope: one's own signals; no suggestions or recommendations. */
export function profileSelfScope(
  collection: string,
  employeeId: string | undefined,
): DatabaseScope | undefined {
  if (collection === 'businessSignals')
    return employeeId ? condition('employeeId', '$eq', employeeId) : false;
  if (
    collection === 'competencySuggestions' ||
    collection === 'trainingRecommendations'
  )
    return false;
  return undefined;
}

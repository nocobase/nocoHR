/**
 * V4-13 人才盘点与其他: the permission model — collections, business
 * operations with their field grants, and the names of the record scopes
 * (record-access.ts). The field lists are the "敏感数据" rules of the
 * specification declared in code:
 *
 * - 九宫格落位 and 潜力评估: hr.admin reads every field of every placement
 *   (`talent.talentReview.view` / `place` / `conclude` on all records). A
 *   head holds `assessPotential` and `view` only through the scope
 *   `talent.talentReviewTeam`, which answers the placements of the managed
 *   departments while the review is preparing or in session — never the
 *   head's own placement, and nothing once the review has concluded. An
 *   employee holds no talent-review action: their own placement is never
 *   reached.
 * - 继任计划: hr.admin manages and confirms; the incumbent's superior head
 *   views through `talent.successionSuperior` (never the incumbent).
 * - 实操记录: `conduct` (hr.practicalAssessor) writes only the results and
 *   notes of the records one conducts (`talent.practicalAssessorOwn`);
 *   `witness` reaches only the records naming one as witness
 *   (`talent.practicalWitness`) and writes only the witness signature;
 *   `void` (hr.admin) writes only the void fields. `passed` is written by the
 *   service from the pass rule, never taken from a request.
 * - 培训评估: `respond` reaches one's own tasks and writes only the answers;
 *   `view` is all (hr.admin), the instructor's own courses and sessions, or
 *   the head's departments.
 * - 外部 AI 助手: `issueToken` reaches only one's own tokens; the hash is
 *   never granted for reading.
 */
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';
import { defineCompositeResource } from '@nocobase/authorization/core';

import { EMPLOYEE_BASE_FIELDS } from '../authz-resources.js';
import { label } from '../shared.js';

export const TALENT_REVIEW_TEAM_SCOPE = 'talent.talentReviewTeam';
export const SUCCESSION_SUPERIOR_SCOPE = 'talent.successionSuperior';
export const PRACTICAL_ASSESSOR_OWN_SCOPE = 'talent.practicalAssessorOwn';
export const PRACTICAL_WITNESS_SCOPE = 'talent.practicalWitness';
export const EVALUATION_RESPONDENT_SCOPE = 'talent.evaluationRespondent';
export const EVALUATION_TEAM_SCOPE = 'talent.evaluationTeam';
export const EVALUATION_INSTRUCTOR_SCOPE = 'talent.evaluationInstructor';
export const AGENT_TOKEN_OWN_SCOPE = 'talent.agentTokenOwn';
export const CONTENT_OWNER_SCOPE = 'talent.translationContentOwner';

/** The permission set trainer01 holds directly in this step (V4-14 may assign it to a certification instead). */
export const PRACTICAL_ASSESSOR_SET = 'hr.practicalAssessor';
/** The permission set of the ticket integration account (only knowledgeCandidate.ingest). */
export const TICKET_INTEGRATION_SET = 'hr.ticketIntegration';

export const TALENT_REVIEW_FIELDS = [
  'id',
  'title',
  'scope',
  'reviewCycleId',
  'status',
  'ownerUserId',
  'stageLog',
  'createdAt',
  'updatedAt',
] as const;
export const PLACEMENT_FIELDS = [
  'id',
  'talentReviewId',
  'employeeId',
  'departmentId',
  'performanceBand',
  'performanceRating',
  'performanceSource',
  'performanceReason',
  'potentialAnswers',
  'potentialAssessedBy',
  'potentialAssessedAt',
  'potentialBand',
  'box',
  'aiSuggestion',
  'moves',
  'developmentActions',
  'decidedBy',
  'decidedAt',
  'learningPlanId',
  'createdAt',
  'updatedAt',
] as const;
export const SUCCESSION_FIELDS = [
  'id',
  'positionId',
  'departmentId',
  'incumbentEmployeeId',
  'candidates',
  'status',
  'reviewedBy',
  'reviewedAt',
  'createdAt',
  'updatedAt',
] as const;
export const VERSION_FIELDS = [
  'id',
  'positionId',
  'versionNo',
  'snapshot',
  'status',
  'effectiveFrom',
  'changeNote',
  'changeNoteSource',
  'changeNoteHash',
  'impactPreview',
  'publishedBy',
  'publishedAt',
  'archivedAt',
  'source',
  'createdBy',
  'createdAt',
  'updatedAt',
] as const;
export const ASSESSMENT_FIELDS = [
  'id',
  'title',
  'competencyIds',
  'checklist',
  'passRule',
  'sourceDocumentId',
  'requiresWitness',
  'reviewStatus',
  'source',
  'active',
  'ownerUserId',
  'confirmedBy',
  'confirmedAt',
  'customFields',
  'createdAt',
  'updatedAt',
] as const;
export const RECORD_FIELDS = [
  'id',
  'assessmentId',
  'employeeId',
  'assessorUserId',
  'witnessUserId',
  'conductedAt',
  'location',
  'observationNotes',
  'aiStructured',
  'results',
  'passed',
  'attachments',
  'signedAt',
  'witnessSignedAt',
  'status',
  'voidReason',
  'voidedBy',
  'voidedAt',
  'createdAt',
  'updatedAt',
] as const;
export const INSTRUCTOR_FIELDS = [
  'id',
  'userId',
  'name',
  'type',
  'organization',
  'competencyIds',
  'level',
  'active',
  'customFields',
  'createdAt',
  'updatedAt',
] as const;
export const EVALUATION_FIELDS = [
  'id',
  'level',
  'targetType',
  'targetId',
  'courseId',
  'employeeId',
  'respondentUserId',
  'answers',
  'score',
  'status',
  'dueAt',
  'completedAt',
  'submittedAt',
  'remindedAt',
  'createdAt',
  'updatedAt',
] as const;
export const CANDIDATE_FIELDS = [
  'id',
  'sourceSystem',
  'externalId',
  'title',
  'content',
  'link',
  'topic',
  'status',
  'draftDocumentId',
  'ignoredBy',
  'createdAt',
  'updatedAt',
] as const;
export const AGENT_CLIENT_FIELDS = [
  'id',
  'name',
  'ownerUserId',
  'allowedTools',
  'status',
  'createdAt',
  'updatedAt',
] as const;
/** Never `tokenHash`. */
export const AGENT_TOKEN_FIELDS = [
  'id',
  'clientId',
  'userId',
  'name',
  'prefix',
  'expiresAt',
  'revokedAt',
  'revokedBy',
  'lastUsedAt',
  'createdAt',
  'updatedAt',
] as const;
export const AGENT_CALL_FIELDS = [
  'id',
  'clientId',
  'tokenId',
  'userId',
  'tool',
  'status',
  'summary',
  'calledAt',
  'createdAt',
  'updatedAt',
] as const;
/** The translation columns every translatable content table gained. */
export const TRANSLATION_FIELDS = [
  'locale',
  'translationOfId',
  'translationStatus',
  'sourceHash',
] as const;

const read = (collection: string, fields: readonly string[]) =>
  defineDatabasePermission((p) => p.collection(collection).read([...fields]));
const write = (collection: string, fields: readonly string[]) =>
  defineDatabasePermission((p) =>
    p
      .collection(collection)
      .read([...fields])
      .create([...fields])
      .update([...fields]),
  );

const employees = read('employees', EMPLOYEE_BASE_FIELDS);
const reviewHeaders = read('talentReviews', [
  'id',
  'title',
  'status',
  'reviewCycleId',
  'scope',
  'createdAt',
  'updatedAt',
]);
const potentialWrite = defineDatabasePermission((p) =>
  p
    .collection('talentPlacements')
    .read([...PLACEMENT_FIELDS])
    .update([
      'potentialAnswers',
      'potentialBand',
      'potentialAssessedBy',
      'potentialAssessedAt',
      'box',
      'updatedAt',
    ]),
);
export const talentReviewResource = defineCompositeResource(
  'talent.talentReview',
  (r) =>
    r
      .title(label('talentReview.authz.talentReview.title'))
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant('talentReviews', reviewHeaders)
          .grant('talentPlacements', read('talentPlacements', PLACEMENT_FIELDS))
          .grant('employees', employees),
      )
      .action('manage', (a) =>
        a
          .title(label('talentReview.authz.actions.manage'))
          .grant('talentReviews', write('talentReviews', TALENT_REVIEW_FIELDS))
          .grant(
            'talentPlacements',
            write('talentPlacements', PLACEMENT_FIELDS),
          ),
      )
      .action('assessPotential', (a) =>
        a
          .title(label('talentReview.authz.talentReview.assessPotential'))
          .grant('talentPlacements', potentialWrite)
          .grant('employees', employees),
      )
      .action('place', (a) =>
        a
          .title(label('talentReview.authz.talentReview.place'))
          .grant(
            'talentPlacements',
            write('talentPlacements', PLACEMENT_FIELDS),
          ),
      )
      .action('conclude', (a) =>
        a
          .title(label('talentReview.authz.talentReview.conclude'))
          .grant('talentReviews', write('talentReviews', TALENT_REVIEW_FIELDS))
          .grant(
            'talentPlacements',
            write('talentPlacements', PLACEMENT_FIELDS),
          ),
      ),
);

export const successionResource = defineCompositeResource(
  'talent.succession',
  (r) =>
    r
      .title(label('talentReview.authz.succession.title'))
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant('successionPlans', read('successionPlans', SUCCESSION_FIELDS))
          .grant('employees', employees),
      )
      .action('manage', (a) =>
        a
          .title(label('talentReview.authz.actions.manage'))
          .grant(
            'successionPlans',
            write('successionPlans', SUCCESSION_FIELDS),
          )
          .grant(
            'positions',
            defineDatabasePermission((p) =>
              p
                .collection('positions')
                .read(['id', 'title', 'isKey', 'keyReason'])
                .update(['isKey', 'keyReason', 'updatedAt']),
            ),
          ),
      )
      .action('confirm', (a) =>
        a
          .title(label('talentReview.authz.succession.confirm'))
          .grant(
            'successionPlans',
            write('successionPlans', SUCCESSION_FIELDS),
          ),
      ),
);

export const competencyModelResource = defineCompositeResource(
  'talent.competencyModel',
  (r) =>
    r
      .title(label('talentReview.authz.competencyModel.title'))
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant(
            'competencyModelVersions',
            read('competencyModelVersions', VERSION_FIELDS),
          ),
      )
      .action('draftVersion', (a) =>
        a
          .title(label('talentReview.authz.competencyModel.draftVersion'))
          .grant(
            'competencyModelVersions',
            write('competencyModelVersions', VERSION_FIELDS),
          ),
      )
      .action('publishVersion', (a) =>
        a
          .title(label('talentReview.authz.competencyModel.publishVersion'))
          .grant(
            'competencyModelVersions',
            write('competencyModelVersions', VERSION_FIELDS),
          ),
      ),
);

export const practicalResource = defineCompositeResource(
  'talent.practical',
  (r) =>
    r
      .title(label('talentReview.authz.practical.title'))
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant(
            'practicalAssessments',
            read('practicalAssessments', ASSESSMENT_FIELDS),
          )
          .grant('practicalRecords', read('practicalRecords', RECORD_FIELDS))
          .grant('employees', employees),
      )
      .action('manageTemplates', (a) =>
        a
          .title(label('talentReview.authz.practical.manageTemplates'))
          .grant(
            'practicalAssessments',
            write('practicalAssessments', ASSESSMENT_FIELDS),
          ),
      )
      .action('conduct', (a) =>
        a
          .title(label('talentReview.authz.practical.conduct'))
          .grant(
            'practicalAssessments',
            read('practicalAssessments', ASSESSMENT_FIELDS),
          )
          .grant(
            'practicalRecords',
            defineDatabasePermission((p) =>
              p
                .collection('practicalRecords')
                .read([...RECORD_FIELDS])
                .create([...RECORD_FIELDS])
                .update([
                  'witnessUserId',
                  'location',
                  'observationNotes',
                  'aiStructured',
                  'results',
                  'attachments',
                  'signedAt',
                  'status',
                  'updatedAt',
                ]),
            ),
          )
          .grant('employees', employees),
      )
      .action('witness', (a) =>
        a
          .title(label('talentReview.authz.practical.witness'))
          .grant(
            'practicalAssessments',
            read('practicalAssessments', ASSESSMENT_FIELDS),
          )
          .grant(
            'practicalRecords',
            defineDatabasePermission((p) =>
              p
                .collection('practicalRecords')
                .read([...RECORD_FIELDS])
                .update(['witnessSignedAt', 'status', 'updatedAt']),
            ),
          )
          .grant('employees', employees),
      )
      .action('void', (a) =>
        a
          .title(label('talentReview.authz.practical.void'))
          .grant(
            'practicalRecords',
            defineDatabasePermission((p) =>
              p
                .collection('practicalRecords')
                .read([...RECORD_FIELDS])
                .update([
                  'status',
                  'voidReason',
                  'voidedBy',
                  'voidedAt',
                  'updatedAt',
                ]),
            ),
          ),
      ),
);

export const instructorResource = defineCompositeResource(
  'talent.instructor',
  (r) =>
    r
      .title(label('talentReview.authz.instructor.title'))
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant(
            'instructorProfiles',
            read('instructorProfiles', INSTRUCTOR_FIELDS),
          ),
      )
      .action('manage', (a) =>
        a
          .title(label('talentReview.authz.actions.manage'))
          .grant(
            'instructorProfiles',
            write('instructorProfiles', INSTRUCTOR_FIELDS),
          )
          .grant(
            'trainingSessions',
            defineDatabasePermission((p) =>
              p
                .collection('trainingSessions')
                .read(['id', 'instructorUserId', 'instructorProfileId'])
                .update(['instructorUserId', 'instructorProfileId', 'updatedAt']),
            ),
          ),
      ),
);

export const trainingEvaluationResource = defineCompositeResource(
  'talent.trainingEvaluation',
  (r) =>
    r
      .title(label('talentReview.authz.trainingEvaluation.title'))
      .action('respond', (a) =>
        a
          .title(label('talentReview.authz.trainingEvaluation.respond'))
          .grant(
            'trainingEvaluations',
            defineDatabasePermission((p) =>
              p
                .collection('trainingEvaluations')
                .read([...EVALUATION_FIELDS])
                .update(['answers', 'score', 'status', 'submittedAt', 'updatedAt']),
            ),
          ),
      )
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant(
            'trainingEvaluations',
            read('trainingEvaluations', EVALUATION_FIELDS),
          )
          .grant('employees', employees),
      )
      .action('configure', (a) =>
        a
          .title(label('talentReview.authz.actions.configure'))
          .grant(
            'trainingEvaluations',
            read('trainingEvaluations', ['id', 'status']),
          ),
      ),
);

export const knowledgeCandidateResource = defineCompositeResource(
  'talent.knowledgeCandidate',
  (r) =>
    r
      .title(label('talentReview.authz.knowledgeCandidate.title'))
      .action('ingest', (a) =>
        a
          .title(label('talentReview.authz.knowledgeCandidate.ingest'))
          .grant(
            'knowledgeCandidates',
            defineDatabasePermission((p) =>
              p
                .collection('knowledgeCandidates')
                .read(['id', 'sourceSystem', 'externalId', 'status'])
                .create([...CANDIDATE_FIELDS])
                .update(['title', 'content', 'link', 'updatedAt']),
            ),
          ),
      )
      .action('view', (a) =>
        a
          .title(label('talentReview.authz.actions.view'))
          .grant(
            'knowledgeCandidates',
            read('knowledgeCandidates', CANDIDATE_FIELDS),
          ),
      )
      .action('ignore', (a) =>
        a
          .title(label('talentReview.authz.knowledgeCandidate.ignore'))
          .grant(
            'knowledgeCandidates',
            defineDatabasePermission((p) =>
              p
                .collection('knowledgeCandidates')
                .read([...CANDIDATE_FIELDS])
                .update(['status', 'ignoredBy', 'updatedAt']),
            ),
          ),
      ),
);

const contentFields = {
  courses: ['id', 'title', 'ownerUserId', 'reviewStatus', ...TRANSLATION_FIELDS],
  lessons: ['id', 'courseId', 'title', ...TRANSLATION_FIELDS],
  questions: ['id', 'stem', 'ownerUserId', 'reviewStatus', ...TRANSLATION_FIELDS],
  practiceScenarios: [
    'id',
    'title',
    'ownerUserId',
    'reviewStatus',
    ...TRANSLATION_FIELDS,
  ],
  kbDocuments: [
    'id',
    'title',
    'ownerUserId',
    'reviewStatus',
    ...TRANSLATION_FIELDS,
  ],
} as const;
export const TRANSLATABLE_COLLECTIONS = Object.keys(
  contentFields,
) as (keyof typeof contentFields)[];

const contentRead = (collection: keyof typeof contentFields) =>
  read(collection, contentFields[collection]);

export const translationResource = defineCompositeResource(
  'talent.translation',
  (r) =>
    r
      .title(label('talentReview.authz.translation.title'))
      .action('draft', (a) =>
        a
          .title(label('talentReview.authz.translation.draft'))
          .grant('courses', contentRead('courses'))
          .grant('lessons', contentRead('lessons'))
          .grant('questions', contentRead('questions'))
          .grant('practiceScenarios', contentRead('practiceScenarios'))
          .grant('kbDocuments', contentRead('kbDocuments')),
      )
      .action('review', (a) =>
        a
          .title(label('talentReview.authz.translation.review'))
          .grant('courses', contentRead('courses'))
          .grant('lessons', contentRead('lessons'))
          .grant('questions', contentRead('questions'))
          .grant('practiceScenarios', contentRead('practiceScenarios'))
          .grant('kbDocuments', contentRead('kbDocuments')),
      ),
);

export const agentClientResource = defineCompositeResource(
  'talent.agentClient',
  (r) =>
    r
      .title(label('talentReview.authz.agentClient.title'))
      .action('manage', (a) =>
        a
          .title(label('talentReview.authz.actions.manage'))
          .grant('agentClients', write('agentClients', AGENT_CLIENT_FIELDS))
          .grant(
            'agentTokens',
            defineDatabasePermission((p) =>
              p
                .collection('agentTokens')
                .read([...AGENT_TOKEN_FIELDS])
                .update(['revokedAt', 'revokedBy', 'updatedAt']),
            ),
          )
          .grant('agentCallLogs', read('agentCallLogs', AGENT_CALL_FIELDS)),
      )
      .action('issueToken', (a) =>
        a
          .title(label('talentReview.authz.agentClient.issueToken'))
          .grant(
            'agentClients',
            read('agentClients', ['id', 'name', 'allowedTools', 'status']),
          )
          .grant(
            'agentTokens',
            defineDatabasePermission((p) =>
              p
                .collection('agentTokens')
                .read([...AGENT_TOKEN_FIELDS])
                // The hash is written once and never granted for reading.
                .create([...AGENT_TOKEN_FIELDS, 'tokenHash'])
                .update(['revokedAt', 'revokedBy', 'updatedAt']),
            ),
          ),
      ),
);

export const TALENT_REVIEW_COMPOSITES = [
  talentReviewResource,
  successionResource,
  competencyModelResource,
  practicalResource,
  instructorResource,
  trainingEvaluationResource,
  knowledgeCandidateResource,
  translationResource,
  agentClientResource,
] as const;

export const TALENT_REVIEW_COLLECTIONS: readonly {
  name: string;
  title: string;
}[] = [
  { name: 'talentReviews', title: 'talentReview.collections.talentReviews' },
  {
    name: 'talentPlacements',
    title: 'talentReview.collections.talentPlacements',
  },
  {
    name: 'successionPlans',
    title: 'talentReview.collections.successionPlans',
  },
  {
    name: 'competencyModelVersions',
    title: 'talentReview.collections.competencyModelVersions',
  },
  {
    name: 'practicalAssessments',
    title: 'talentReview.collections.practicalAssessments',
  },
  {
    name: 'practicalRecords',
    title: 'talentReview.collections.practicalRecords',
  },
  {
    name: 'instructorProfiles',
    title: 'talentReview.collections.instructorProfiles',
  },
  {
    name: 'trainingEvaluations',
    title: 'talentReview.collections.trainingEvaluations',
  },
  {
    name: 'knowledgeCandidates',
    title: 'talentReview.collections.knowledgeCandidates',
  },
  { name: 'agentClients', title: 'talentReview.collections.agentClients' },
  { name: 'agentTokens', title: 'talentReview.collections.agentTokens' },
  { name: 'agentCallLogs', title: 'talentReview.collections.agentCallLogs' },
];

/** The pages of the step (page resource ids). */
export const TALENT_REVIEW_PAGES = {
  talentReviews: 'talent.talentReviews',
  succession: 'talent.succession',
  practicals: 'talent.practicals',
  instructors: 'talent.instructors',
  trainingEvaluations: 'talent.trainingEvaluations',
  translations: 'talent.translations',
  agentClients: 'talent.agentClients',
} as const;

/**
 * The permission model of exams and certification (V1 step 3) and of the
 * permission loop (V1 step 4): the question bank, exams and grading, a
 * candidate's own attempts, certification programmes, certificates, the
 * training report, the certification steward, and the demonstration batch
 * record whose filling step can be signed only through a certification.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from './automation-resources.js';
import { ASSIGNMENT_FIELDS } from './learning-resources.js';
import { label } from './shared.js';

export const QUESTION_FIELDS = [
  'id',
  'type',
  'stem',
  'options',
  'answer',
  'explanation',
  'gradingNotes',
  'difficulty',
  'sourceDocumentId',
  'sourceCourseId',
  'sourceExcerpt',
  'score',
  'ownerUserId',
  'source',
  'reviewStatus',
  'active',
  'createdAt',
  'updatedAt',
] as const;
const QUESTION_COMPETENCY_FIELDS = [
  'id',
  'questionId',
  'competencyId',
  'createdAt',
  'updatedAt',
] as const;
export const EXAM_FIELDS = [
  'id',
  'title',
  'description',
  'paperMode',
  'randomRules',
  'durationMinutes',
  'maxAttempts',
  'passScore',
  'showAnswersAfter',
  'ownerUserId',
  'published',
  'active',
  'antiCheat',
  'aiGrading',
  'createdAt',
  'updatedAt',
] as const;
const EXAM_QUESTION_FIELDS = [
  'id',
  'examId',
  'questionId',
  'sortOrder',
  'score',
  'createdAt',
  'updatedAt',
] as const;
export const ATTEMPT_FIELDS = [
  'id',
  'examId',
  'employeeId',
  'assignmentId',
  'attemptNo',
  'paperSnapshot',
  'answers',
  'startedAt',
  'deadlineAt',
  'submittedAt',
  'objectiveScore',
  'subjectiveScore',
  'score',
  'status',
  'gradedBy',
  'itemResults',
  'blurCount',
  'integrityFlags',
  'integrityReview',
  'deviceToken',
  'voidReason',
  'lossByCompetency',
  // V3-10: when a reset stopped the attempt counting.
  'resetAt',
  'createdAt',
  'updatedAt',
] as const;
export const CERTIFICATION_FIELDS = [
  'id',
  'code',
  'title',
  'description',
  'validityMonths',
  'competencyId',
  'competencyLevel',
  'certificateTemplate',
  'expiringNoticeDays',
  'recertAdvanceDays',
  'escalateDays',
  'recertMode',
  'active',
  'kind',
  'issuingAuthority',
  // V3-10 任职资格: the position this certification qualifies for.
  'qualifiesPositionId',
  'createdAt',
  'updatedAt',
] as const;
const CERTIFICATION_LINK_FIELDS = {
  certificationCourses: [
    'id',
    'certificationId',
    'courseId',
    'createdAt',
    'updatedAt',
  ],
  certificationExams: [
    'id',
    'certificationId',
    'examId',
    'createdAt',
    'updatedAt',
  ],
} as const;
export const CERTIFICATE_FIELDS = [
  'id',
  'employeeId',
  'certificationId',
  'certificateNo',
  'issuedAt',
  'expiresAt',
  'status',
  'source',
  'revokedReason',
  'evidence',
  'supersededById',
  'externalNo',
  'attachmentFileId',
  'verifyStatus',
  'verifiedBy',
  'verifiedAt',
  'verifyNote',
  'createdAt',
  'updatedAt',
] as const;

const read = (collection: string, fields: readonly string[]) =>
  defineDatabasePermission((p) =>
    p
      .collection(collection)
      .title(label(`collections.${collection}`))
      .read([...fields]),
  );
const write = (
  collection: string,
  fields: readonly string[],
  options: { remove?: boolean } = {},
) =>
  defineDatabasePermission((p) => {
    const base = p
      .collection(collection)
      .title(label(`collections.${collection}`))
      .read([...fields])
      .create([...fields])
      .update([...fields]);
    return options.remove ? base.delete() : base;
  });

export const questionResource = defineCompositeResource(
  'talent.question',
  (r) =>
    r
      .title(label('authz.question.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('questions', read('questions', QUESTION_FIELDS))
          .grant(
            'questionCompetencies',
            read('questionCompetencies', QUESTION_COMPETENCY_FIELDS),
          ),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.question.manage'))
          .grant('questions', write('questions', QUESTION_FIELDS))
          .grant(
            'questionCompetencies',
            write('questionCompetencies', QUESTION_COMPETENCY_FIELDS, {
              remove: true,
            }),
          ),
      )
      .action('confirm', (a) =>
        a
          .title(label('authz.question.confirm'))
          .grant(
            'questions',
            read('questions', QUESTION_FIELDS).update([
              'reviewStatus',
              'active',
              'updatedAt',
            ]),
          ),
      )
      .action('import', (a) =>
        a
          .title(label('authz.question.import'))
          .grant('questions', write('questions', QUESTION_FIELDS))
          .grant(
            'questionCompetencies',
            write('questionCompetencies', QUESTION_COMPETENCY_FIELDS, {
              remove: true,
            }),
          ),
      ),
);

export const examResource = defineCompositeResource('talent.exam', (r) =>
  r
    .title(label('authz.exam.title'))
    .action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant('exams', read('exams', EXAM_FIELDS))
        .grant('examQuestions', read('examQuestions', EXAM_QUESTION_FIELDS)),
    )
    .action('manage', (a) =>
      a
        .title(label('authz.exam.manage'))
        .grant('exams', write('exams', EXAM_FIELDS))
        .grant(
          'examQuestions',
          write('examQuestions', EXAM_QUESTION_FIELDS, { remove: true }),
        ),
    )
    .action('publish', (a) =>
      a
        .title(label('authz.exam.publish'))
        .grant(
          'exams',
          read('exams', EXAM_FIELDS).update([
            'published',
            'active',
            'updatedAt',
          ]),
        ),
    )
    // Grading reads and scores attempts on the exams in scope.
    .action('grade', (a) =>
      a
        .title(label('authz.exam.grade'))
        .grant('exams', read('exams', EXAM_FIELDS))
        .grant(
          'examAttempts',
          read('examAttempts', ATTEMPT_FIELDS).update([
            'subjectiveScore',
            'score',
            'status',
            'gradedBy',
            'itemResults',
            'lossByCompetency',
            'updatedAt',
          ]),
        ),
    )
    .action('resetAttempts', (a) =>
      a
        .title(label('authz.exam.resetAttempts'))
        .grant('exams', read('exams', EXAM_FIELDS))
        .grant(
          'examAttempts',
          read('examAttempts', ATTEMPT_FIELDS).update([
            'status',
            'resetAt',
            'updatedAt',
          ]),
        ),
    )
    // V3-10: the exam → competency rule (score share and rates), an application setting.
    .action('configure', (a) =>
      a
        .title(label('authz.exam.configure'))
        .grant('exams', read('exams', EXAM_FIELDS)),
    )
    // V2 step 6: reviewing attempts with integrity flags, and voiding one (people only; no AI tool does this).
    .action('reviewIntegrity', (a) =>
      a
        .title(label('authz.exam.reviewIntegrity'))
        .grant('exams', read('exams', EXAM_FIELDS))
        .grant(
          'examAttempts',
          read('examAttempts', ATTEMPT_FIELDS).update([
            'integrityReview',
            'updatedAt',
          ]),
        ),
    )
    .action('voidAttempt', (a) =>
      a
        .title(label('authz.exam.voidAttempt'))
        .grant('exams', read('exams', EXAM_FIELDS))
        .grant(
          'examAttempts',
          read('examAttempts', ATTEMPT_FIELDS).update([
            'status',
            'voidReason',
            'integrityReview',
            'updatedAt',
          ]),
        ),
    ),
);

/** A candidate's own attempts. The attempts scope is always the candidate. */
export const examTakingResource = defineCompositeResource(
  'talent.examTaking',
  (r) =>
    r
      .title(label('authz.examTaking.title'))
      .action('start', (a) =>
        a
          .title(label('authz.examTaking.start'))
          .grant('examAttempts', write('examAttempts', ATTEMPT_FIELDS)),
      )
      .action('save', (a) =>
        a
          .title(label('authz.examTaking.save'))
          .grant(
            'examAttempts',
            read('examAttempts', ATTEMPT_FIELDS).update([
              'answers',
              'blurCount',
              'integrityFlags',
              'updatedAt',
            ]),
          ),
      )
      .action('submit', (a) =>
        a
          .title(label('authz.examTaking.submit'))
          .grant('examAttempts', write('examAttempts', ATTEMPT_FIELDS)),
      )
      .action('viewResult', (a) =>
        a
          .title(label('authz.examTaking.viewResult'))
          .grant('examAttempts', read('examAttempts', ATTEMPT_FIELDS)),
      ),
);

export const certificationResource = defineCompositeResource(
  'talent.certification',
  (r) =>
    r
      .title(label('authz.certification.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('certifications', read('certifications', CERTIFICATION_FIELDS))
          .grant(
            'certificationCourses',
            read(
              'certificationCourses',
              CERTIFICATION_LINK_FIELDS.certificationCourses,
            ),
          )
          .grant(
            'certificationExams',
            read(
              'certificationExams',
              CERTIFICATION_LINK_FIELDS.certificationExams,
            ),
          ),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.certification.manage'))
          .grant(
            'certifications',
            write('certifications', CERTIFICATION_FIELDS),
          )
          .grant(
            'certificationCourses',
            write(
              'certificationCourses',
              CERTIFICATION_LINK_FIELDS.certificationCourses,
              { remove: true },
            ),
          )
          .grant(
            'certificationExams',
            write(
              'certificationExams',
              CERTIFICATION_LINK_FIELDS.certificationExams,
              { remove: true },
            ),
          ),
      ),
);

export const certificateResource = defineCompositeResource(
  'talent.certificate',
  (r) =>
    r
      .title(label('authz.certificate.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant(
            'employeeCertificates',
            read('employeeCertificates', CERTIFICATE_FIELDS),
          ),
      )
      .action('revoke', (a) =>
        a
          .title(label('authz.certificate.revoke'))
          .grant(
            'employeeCertificates',
            read('employeeCertificates', CERTIFICATE_FIELDS).update([
              'status',
              'revokedReason',
              'updatedAt',
            ]),
          ),
      )
      .action('download', (a) =>
        a
          .title(label('authz.certificate.download'))
          .grant(
            'employeeCertificates',
            read('employeeCertificates', CERTIFICATE_FIELDS),
          ),
      ),
);

/** The training report reads assignments, attempts and certificates of the employees in scope. */
export const trainingReportResource = defineCompositeResource(
  'talent.trainingReport',
  (r) =>
    r.title(label('authz.trainingReport.title')).action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant(
          'employees',
          read('employees', [
            'id',
            'name',
            'departmentId',
            'positionId',
            'status',
            'userId',
          ]),
        )
        .grant('assignments', read('assignments', ASSIGNMENT_FIELDS))
        .grant('examAttempts', read('examAttempts', ATTEMPT_FIELDS))
        .grant(
          'employeeCertificates',
          read('employeeCertificates', CERTIFICATE_FIELDS),
        ),
    ),
);

export const certificationStewardResource = defineCompositeResource(
  'talent.certificationSteward',
  (r) =>
    r
      .title(label('authz.certificationSteward.title'))
      .action('use', (a) =>
        a
          .title(label('authz.certificationSteward.use'))
          .grant(
            'employees',
            read('employees', [
              'id',
              'name',
              'departmentId',
              'positionId',
              'status',
              'userId',
            ]),
          )
          .grant(
            'employeeCertificates',
            read('employeeCertificates', CERTIFICATE_FIELDS),
          ),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

const SIGNOFF_FIELDS = [
  'id',
  'batchNo',
  'step',
  'employeeId',
  'userId',
  'signedAt',
  'certificateId',
  'certificateNo',
  'certificateStatus',
  'createdAt',
  'updatedAt',
] as const;

/**
 * 批生产记录（演示）: viewing the demonstration batch and signing its filling
 * step. Its only permission set is assigned to the aseptic filling
 * certification, so signing shows "certified to sign".
 */
export const demoBatchResource = defineCompositeResource('demo.batch', (r) =>
  r
    .title(label('authz.demoBatch.title'))
    .action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant('demoBatchSignoffs', read('demoBatchSignoffs', SIGNOFF_FIELDS)),
    )
    .action('signFilling', (a) =>
      a
        .title(label('authz.demoBatch.signFilling'))
        .grant('employees', read('employees', ['id', 'name', 'userId']))
        .grant('demoBatchSignoffs', write('demoBatchSignoffs', SIGNOFF_FIELDS)),
    ),
);

/**
 * V3-10 外部证书登记: an employee registers their own external certificate
 * (or HR registers one for them) with a scan; only HR verifies, never the
 * holder. Verification brings the certificate into its lifecycle.
 */
export const externalCertificateResource = defineCompositeResource(
  'talent.externalCertificate',
  (r) =>
    r
      .title(label('authz.externalCertificate.title'))
      .action('register', (a) =>
        a
          .title(label('authz.externalCertificate.register'))
          .grant(
            'employees',
            read('employees', ['id', 'name', 'departmentId', 'userId']),
          )
          .grant('certifications', read('certifications', CERTIFICATION_FIELDS))
          .grant(
            'employeeCertificates',
            write('employeeCertificates', CERTIFICATE_FIELDS),
          ),
      )
      .action('verify', (a) =>
        a
          .title(label('authz.externalCertificate.verify'))
          .grant(
            'employees',
            read('employees', ['id', 'name', 'departmentId', 'userId']),
          )
          .grant('certifications', read('certifications', CERTIFICATION_FIELDS))
          .grant(
            'employeeCertificates',
            read('employeeCertificates', CERTIFICATE_FIELDS).update([
              'status',
              'verifyStatus',
              'verifiedBy',
              'verifiedAt',
              'verifyNote',
              'supersededById',
              'updatedAt',
            ]),
          ),
      ),
);

/** V3-10 考官: suggested scores for short answers, and a candidate's own result explained. */
export const examinerResource = defineCompositeResource(
  'talent.examiner',
  (r) =>
    r
      .title(label('authz.examiner.title'))
      .action('use', (a) =>
        a
          .title(label('authz.examiner.use'))
          .grant('examAttempts', read('examAttempts', ATTEMPT_FIELDS)),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

export const EXAM_COLLECTIONS: readonly { name: string; title: string }[] = [
  { name: 'questions', title: 'collections.questions' },
  { name: 'questionCompetencies', title: 'collections.questionCompetencies' },
  { name: 'exams', title: 'collections.exams' },
  { name: 'examQuestions', title: 'collections.examQuestions' },
  { name: 'examAttempts', title: 'collections.examAttempts' },
  { name: 'certifications', title: 'collections.certifications' },
  { name: 'certificationCourses', title: 'collections.certificationCourses' },
  { name: 'certificationExams', title: 'collections.certificationExams' },
  { name: 'employeeCertificates', title: 'collections.employeeCertificates' },
];

export const EXAM_COMPOSITES = [
  questionResource,
  examResource,
  examTakingResource,
  certificationResource,
  certificateResource,
  trainingReportResource,
  certificationStewardResource,
  demoBatchResource,
  externalCertificateResource,
  examinerResource,
] as const;

/** Collections whose rows belong to one employee and follow the employee scopes. */
export const EXAM_EMPLOYEE_COLLECTIONS = [
  'examAttempts',
  'employeeCertificates',
] as const;

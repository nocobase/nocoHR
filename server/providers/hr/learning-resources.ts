/**
 * The permission model of knowledge and learning (V1 step 2): which
 * collections participate and the business operations on documents, knowledge
 * gaps, courses, assignments and a learner's own study. The specification's
 * composite and matrix tables are empty; the operations below follow its page
 * and acceptance sections. Registration happens in the HR provider's boot.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from './automation-resources.js';
import { label } from './shared.js';

export const KB_DOCUMENT_FIELDS = [
  'id',
  'title',
  'category',
  'fileId',
  'contentText',
  'parseStatus',
  'parseError',
  'visibility',
  'ownerUserId',
  'reviewDate',
  'autoDraftCourse',
  'active',
  'docNo',
  'version',
  'previousVersionId',
  'supersededById',
  'effectiveDate',
  'changeSummary',
  'changeNote',
  'lastReviewedAt',
  // V4-13: AI-drafted FAQ documents (source, reviewStatus, controlled, aiNotes) and translations.
  'source',
  'reviewStatus',
  'controlled',
  'aiNotes',
  'locale',
  'translationOfId',
  'translationStatus',
  'sourceHash',
  'createdAt',
  'updatedAt',
] as const;
const DOCUMENT_LINK_FIELDS = {
  kbDocumentCompetencies: [
    'id',
    'documentId',
    'competencyId',
    'createdAt',
    'updatedAt',
  ],
  kbDocumentDepartments: [
    'id',
    'documentId',
    'departmentId',
    'createdAt',
    'updatedAt',
  ],
  kbDocumentPositions: [
    'id',
    'documentId',
    'positionId',
    'createdAt',
    'updatedAt',
  ],
} as const;
export const COURSE_FIELDS = [
  'id',
  'title',
  'description',
  'sourceDocumentId',
  'ownerUserId',
  'source',
  'reviewStatus',
  'published',
  'publishedAt',
  'active',
  'deliveryMode',
  'kind',
  'version',
  'briefForDocumentId',
  'revisionDueDays',
  'createdAt',
  'updatedAt',
] as const;
const COURSE_COMPETENCY_FIELDS = [
  'id',
  'courseId',
  'competencyId',
  'createdAt',
  'updatedAt',
] as const;
export const LESSON_FIELDS = [
  'id',
  'courseId',
  'sortOrder',
  'title',
  'content',
  'sourceExcerpt',
  'estimatedMinutes',
  'contentType',
  'videoFileId',
  'videoSeconds',
  'minWatchPercent',
  'createdAt',
  'updatedAt',
] as const;
export const ASSIGNMENT_FIELDS = [
  'id',
  'employeeId',
  'courseId',
  'examId',
  'certificateId',
  'assignedByUserId',
  'dueDate',
  'status',
  'progress',
  'source',
  'completedAt',
  'cancelledAt',
  'lastRemindedAt',
  'escalatedAt',
  'learningPathId',
  'parentAssignmentId',
  'pathStepId',
  'practiceScenarioId',
  'learningPlanId',
  'optional',
  'reminderCount',
  // V3-09: the job event that assigned or cancelled it, why it was cancelled, the coach's one escalation.
  'jobEventId',
  'cancelReason',
  'cancelJobEventId',
  'lagEscalatedAt',
  'createdAt',
  'updatedAt',
] as const;
export const LEARNING_RECORD_FIELDS = [
  'id',
  'employeeId',
  'courseId',
  'lessonId',
  'startedAt',
  'completedAt',
  'durationSeconds',
  'watchedSeconds',
  'maxPositionSeconds',
  'watchedRanges',
  'lastReportedAt',
  'createdAt',
  'updatedAt',
] as const;
export const KNOWLEDGE_GAP_FIELDS = [
  'id',
  'question',
  'askedByUserId',
  'askedAt',
  'askCount',
  'lastAskedAt',
  'relatedDocumentId',
  'channel',
  'topic',
  'reportedAt',
  'status',
  'resolvedDocumentId',
  'resolvedByUserId',
  'resolvedAt',
  'createdAt',
  'updatedAt',
] as const;

const documentRead = defineDatabasePermission((p) =>
  p
    .collection('kbDocuments')
    .title(label('collections.kbDocuments'))
    .read([...KB_DOCUMENT_FIELDS]),
);
const documentWrite = defineDatabasePermission((p) =>
  p
    .collection('kbDocuments')
    .title(label('collections.kbDocuments'))
    .read([...KB_DOCUMENT_FIELDS])
    .create([...KB_DOCUMENT_FIELDS])
    .update([...KB_DOCUMENT_FIELDS]),
);
function linkRead(collection: keyof typeof DOCUMENT_LINK_FIELDS) {
  return defineDatabasePermission((p) =>
    p
      .collection(collection)
      .title(label(`collections.${collection}`))
      .read([...DOCUMENT_LINK_FIELDS[collection]]),
  );
}
function linkWrite(collection: keyof typeof DOCUMENT_LINK_FIELDS) {
  return defineDatabasePermission((p) =>
    p
      .collection(collection)
      .title(label(`collections.${collection}`))
      .read([...DOCUMENT_LINK_FIELDS[collection]])
      .create([...DOCUMENT_LINK_FIELDS[collection]])
      .delete(),
  );
}

export const kbDocumentResource = defineCompositeResource(
  'talent.kbDocument',
  (r) =>
    r
      .title(label('authz.kbDocument.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('kbDocuments', documentRead)
          .grant('kbDocumentCompetencies', linkRead('kbDocumentCompetencies'))
          .grant('kbDocumentDepartments', linkRead('kbDocumentDepartments'))
          .grant('kbDocumentPositions', linkRead('kbDocumentPositions')),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.kbDocument.manage'))
          .grant('kbDocuments', documentWrite)
          .grant('kbDocumentCompetencies', linkWrite('kbDocumentCompetencies'))
          .grant('kbDocumentDepartments', linkWrite('kbDocumentDepartments'))
          .grant('kbDocumentPositions', linkWrite('kbDocumentPositions')),
      )
      // V2 step 6: a new version inherits the document's tags and visibility.
      .action('uploadVersion', (a) =>
        a
          .title(label('authz.kbDocument.uploadVersion'))
          .grant('kbDocuments', documentWrite)
          .grant('kbDocumentCompetencies', linkWrite('kbDocumentCompetencies'))
          .grant('kbDocumentDepartments', linkWrite('kbDocumentDepartments'))
          .grant('kbDocumentPositions', linkWrite('kbDocumentPositions')),
      )
      .action('markReviewed', (a) =>
        a
          .title(label('authz.kbDocument.markReviewed'))
          .grant(
            'kbDocuments',
            documentRead.update(['reviewDate', 'lastReviewedAt', 'updatedAt']),
          ),
      ),
);

const gapRead = defineDatabasePermission((p) =>
  p
    .collection('knowledgeGaps')
    .title(label('collections.knowledgeGaps'))
    .read([...KNOWLEDGE_GAP_FIELDS]),
);

export const knowledgeGapResource = defineCompositeResource(
  'talent.knowledgeGap',
  (r) =>
    r
      .title(label('authz.knowledgeGap.title'))
      .action('view', (a) =>
        a.title(label('authz.actions.view')).grant('knowledgeGaps', gapRead),
      )
      .action('resolve', (a) =>
        a
          .title(label('authz.knowledgeGap.resolve'))
          .grant(
            'knowledgeGaps',
            gapRead.update([
              'status',
              'resolvedDocumentId',
              'resolvedByUserId',
              'resolvedAt',
              'updatedAt',
            ]),
          ),
      ),
);

const courseRead = defineDatabasePermission((p) =>
  p
    .collection('courses')
    .title(label('collections.courses'))
    .read([...COURSE_FIELDS]),
);
const courseWrite = defineDatabasePermission((p) =>
  p
    .collection('courses')
    .title(label('collections.courses'))
    .read([...COURSE_FIELDS])
    .create([...COURSE_FIELDS])
    .update([...COURSE_FIELDS]),
);
const courseCompetencyRead = defineDatabasePermission((p) =>
  p
    .collection('courseCompetencies')
    .title(label('collections.courseCompetencies'))
    .read([...COURSE_COMPETENCY_FIELDS]),
);
const courseCompetencyWrite = defineDatabasePermission((p) =>
  p
    .collection('courseCompetencies')
    .title(label('collections.courseCompetencies'))
    .read([...COURSE_COMPETENCY_FIELDS])
    .create([...COURSE_COMPETENCY_FIELDS])
    .delete(),
);
const lessonRead = defineDatabasePermission((p) =>
  p
    .collection('lessons')
    .title(label('collections.lessons'))
    .read([...LESSON_FIELDS]),
);
const lessonWrite = defineDatabasePermission((p) =>
  p
    .collection('lessons')
    .title(label('collections.lessons'))
    .read([...LESSON_FIELDS])
    .create([...LESSON_FIELDS])
    .update([...LESSON_FIELDS])
    .delete(),
);

export const courseResource = defineCompositeResource('talent.course', (r) =>
  r
    .title(label('authz.course.title'))
    .action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant('courses', courseRead)
        .grant('lessons', lessonRead)
        .grant('courseCompetencies', courseCompetencyRead),
    )
    .action('manage', (a) =>
      a
        .title(label('authz.course.manage'))
        .grant('courses', courseWrite)
        .grant('lessons', lessonWrite)
        .grant('courseCompetencies', courseCompetencyWrite),
    )
    .action('confirm', (a) =>
      a
        .title(label('authz.course.confirm'))
        .grant('courses', courseRead.update(['reviewStatus', 'updatedAt'])),
    )
    .action('discard', (a) =>
      a
        .title(label('authz.course.discard'))
        .grant('courses', courseRead.delete())
        .grant('lessons', lessonRead.delete())
        .grant('courseCompetencies', courseCompetencyRead.delete()),
    )
    .action('publish', (a) =>
      a
        .title(label('authz.course.publish'))
        .grant(
          'courses',
          courseRead.update([
            'published',
            'publishedAt',
            'active',
            'updatedAt',
          ]),
        ),
    ),
);

const assignmentRead = defineDatabasePermission((p) =>
  p
    .collection('assignments')
    .title(label('collections.assignments'))
    .read([...ASSIGNMENT_FIELDS]),
);

const assigneeRead = defineDatabasePermission((p) =>
  p
    .collection('employees')
    .title(label('collections.employees'))
    .read(['id', 'name', 'userId', 'departmentId', 'positionId', 'status']),
);

export const assignmentResource = defineCompositeResource(
  'talent.assignment',
  (r) =>
    r
      .title(label('authz.assignment.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('assignments', assignmentRead),
      )
      // The `employees` scope of `create` is the set of employees who may receive an assignment.
      .action('create', (a) =>
        a
          .title(label('authz.actions.create'))
          .grant('assignments', assignmentRead.create([...ASSIGNMENT_FIELDS]))
          .grant('employees', assigneeRead),
      )
      .action('remind', (a) =>
        a
          .title(label('authz.assignment.remind'))
          .grant(
            'assignments',
            assignmentRead.update(['lastRemindedAt', 'updatedAt']),
          ),
      )
      .action('updateDue', (a) =>
        a
          .title(label('authz.assignment.updateDue'))
          .grant(
            'assignments',
            assignmentRead.update(['dueDate', 'status', 'updatedAt']),
          ),
      )
      .action('cancel', (a) =>
        a
          .title(label('authz.assignment.cancel'))
          .grant(
            'assignments',
            assignmentRead.update([
              'status',
              'cancelledAt',
              'cancelReason',
              'updatedAt',
            ]),
          ),
      ),
);

const learningRecordWrite = defineDatabasePermission((p) =>
  p
    .collection('learningRecords')
    .title(label('collections.learningRecords'))
    .read([...LEARNING_RECORD_FIELDS])
    .create([...LEARNING_RECORD_FIELDS])
    .update([...LEARNING_RECORD_FIELDS]),
);

/** A learner's own study: opening lessons and reporting progress. Its scope is always the learner. */
export const learningResource = defineCompositeResource(
  'talent.learning',
  (r) =>
    r.title(label('authz.learning.title')).action('study', (a) =>
      a
        .title(label('authz.learning.study'))
        .grant(
          'assignments',
          assignmentRead.update([
            'status',
            'progress',
            'completedAt',
            'updatedAt',
          ]),
        )
        .grant('learningRecords', learningRecordWrite),
    ),
);

/** Records the learning history shown on a profile. */
export const learningHistoryResource = defineCompositeResource(
  'talent.learningHistory',
  (r) =>
    r.title(label('authz.learningHistory.title')).action('view', (a) =>
      a
        .title(label('authz.actions.view'))
        .grant('assignments', assignmentRead)
        .grant(
          'learningRecords',
          defineDatabasePermission((p) =>
            p
              .collection('learningRecords')
              .title(label('collections.learningRecords'))
              .read([...LEARNING_RECORD_FIELDS]),
          ),
        ),
    ),
);

export const knowledgeAssistantResource = defineCompositeResource(
  'talent.knowledgeAssistant',
  (r) =>
    r
      .title(label('authz.knowledgeAssistant.title'))
      .action('use', (a) =>
        a
          .title(label('authz.knowledgeAssistant.use'))
          .grant('kbDocuments', documentRead)
          .grant('knowledgeGaps', gapRead.create([...KNOWLEDGE_GAP_FIELDS])),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

export const contentWriterResource = defineCompositeResource(
  'talent.contentWriter',
  (r) =>
    r
      .title(label('authz.contentWriter.title'))
      .action('use', (a) =>
        a
          .title(label('authz.contentWriter.use'))
          .grant('kbDocuments', documentRead)
          .grant('courses', courseRead),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

export const LEARNING_COLLECTIONS: readonly { name: string; title: string }[] =
  [
    { name: 'kbDocuments', title: 'collections.kbDocuments' },
    {
      name: 'kbDocumentCompetencies',
      title: 'collections.kbDocumentCompetencies',
    },
    {
      name: 'kbDocumentDepartments',
      title: 'collections.kbDocumentDepartments',
    },
    { name: 'kbDocumentPositions', title: 'collections.kbDocumentPositions' },
    { name: 'courses', title: 'collections.courses' },
    { name: 'courseCompetencies', title: 'collections.courseCompetencies' },
    { name: 'lessons', title: 'collections.lessons' },
    { name: 'assignments', title: 'collections.assignments' },
    { name: 'learningRecords', title: 'collections.learningRecords' },
    { name: 'knowledgeGaps', title: 'collections.knowledgeGaps' },
  ];

export const LEARNING_COMPOSITES = [
  kbDocumentResource,
  knowledgeGapResource,
  courseResource,
  assignmentResource,
  learningResource,
  learningHistoryResource,
  knowledgeAssistantResource,
  contentWriterResource,
] as const;

/** Documents the viewer may read under the visibility rule. */
export const VISIBLE_DOCUMENTS_SCOPE = 'talent.visibleDocuments';
/** Records whose `ownerUserId` is the viewer: documents, courses, questions and exams. */
export const OWNED_BY_ME_SCOPE = 'talent.ownedByMe';
/** Collections whose rows belong to one employee and follow the employee scopes. */
export const LEARNING_EMPLOYEE_COLLECTIONS = [
  'assignments',
  'learningRecords',
] as const;

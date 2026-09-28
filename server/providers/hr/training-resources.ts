/**
 * The permission model of training operations (V2 step 5): learning paths,
 * offline training sessions and check-in, practice scenarios and
 * conversations, learning plans, and the two AI employees that work on them.
 * Assigning a path reuses `talent.assignment.create`.
 */
import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

import {
  automationRunItemsRead,
  automationRunsRead,
  automationSettingsWrite,
} from './automation-resources.js';
import { label } from './shared.js';

export const LEARNING_PATH_FIELDS = [
  'id',
  'code',
  'title',
  'description',
  'positionId',
  'purpose',
  'sequential',
  'skipCompleted',
  'ownerUserId',
  'published',
  'publishedAt',
  'active',
  'createdAt',
  'updatedAt',
] as const;
export const LEARNING_PATH_STEP_FIELDS = [
  'id',
  'pathId',
  'sortOrder',
  'stepType',
  'courseId',
  'examId',
  'practiceScenarioId',
  'dueOffsetDays',
  'required',
  'createdAt',
  'updatedAt',
] as const;
export const TRAINING_SESSION_FIELDS = [
  'id',
  'courseId',
  'title',
  'instructorUserId',
  'startAt',
  'endAt',
  'location',
  'capacity',
  'enrollDeadline',
  'status',
  'ownerUserId',
  'createdAt',
  'updatedAt',
] as const;
export const TRAINING_ENROLLMENT_FIELDS = [
  'id',
  'sessionId',
  'employeeId',
  'assignmentId',
  'status',
  'checkedInAt',
  'checkInMethod',
  'markedBy',
  'markReason',
  'createdAt',
  'updatedAt',
] as const;
export const PRACTICE_SCENARIO_FIELDS = [
  'id',
  'title',
  'persona',
  'situation',
  'openingLine',
  'rubric',
  'sourceDocumentId',
  'maxTurns',
  'passScore',
  'ownerUserId',
  'source',
  'reviewStatus',
  'active',
  'createdAt',
  'updatedAt',
] as const;
const SCENARIO_COMPETENCY_FIELDS = [
  'id',
  'scenarioId',
  'competencyId',
  'createdAt',
  'updatedAt',
] as const;
/** What a manager may see of a practice: the score and when, never the conversation or the feedback. */
export const PRACTICE_SCORE_FIELDS = [
  'id',
  'scenarioId',
  'employeeId',
  'assignmentId',
  'turnCount',
  'status',
  'score',
  'rehearsal',
  'startedAt',
  'completedAt',
  'createdAt',
  'updatedAt',
] as const;
export const PRACTICE_SESSION_FIELDS = [
  ...PRACTICE_SCORE_FIELDS,
  'transcript',
  'rubricResults',
  'feedback',
  'lastActivityAt',
  'conversationSessionId',
] as const;
export const LEARNING_PLAN_FIELDS = [
  'id',
  'employeeId',
  'trigger',
  'triggerRef',
  'summary',
  'items',
  'reviewerUserId',
  'status',
  'reviewedBy',
  'reviewedAt',
  'reviewNote',
  'assignmentIds',
  'source',
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
const people = read('employees', [
  'id',
  'name',
  'userId',
  'departmentId',
  'positionId',
  'status',
]);

export const learningPathResource = defineCompositeResource(
  'talent.learningPath',
  (r) =>
    r
      .title(label('authz.learningPath.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('learningPaths', read('learningPaths', LEARNING_PATH_FIELDS))
          .grant(
            'learningPathSteps',
            read('learningPathSteps', LEARNING_PATH_STEP_FIELDS),
          ),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.learningPath.manage'))
          .grant('learningPaths', write('learningPaths', LEARNING_PATH_FIELDS))
          .grant(
            'learningPathSteps',
            write('learningPathSteps', LEARNING_PATH_STEP_FIELDS, {
              remove: true,
            }),
          ),
      )
      .action('publish', (a) =>
        a
          .title(label('authz.learningPath.publish'))
          .grant(
            'learningPaths',
            read('learningPaths', LEARNING_PATH_FIELDS).update([
              'published',
              'publishedAt',
              'updatedAt',
            ]),
          ),
      ),
);

export const trainingSessionResource = defineCompositeResource(
  'talent.trainingSession',
  (r) =>
    r
      .title(label('authz.trainingSession.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant(
            'trainingSessions',
            read('trainingSessions', TRAINING_SESSION_FIELDS),
          )
          .grant(
            'trainingEnrollments',
            read('trainingEnrollments', TRAINING_ENROLLMENT_FIELDS),
          ),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.trainingSession.manage'))
          .grant(
            'trainingSessions',
            write('trainingSessions', TRAINING_SESSION_FIELDS),
          ),
      )
      // Its `employees` scope is whom one may enroll: oneself, one's teams, everyone.
      .action('enroll', (a) =>
        a
          .title(label('authz.trainingSession.enroll'))
          .grant(
            'trainingEnrollments',
            write('trainingEnrollments', TRAINING_ENROLLMENT_FIELDS),
          )
          .grant('employees', people),
      )
      .action('checkIn', (a) =>
        a
          .title(label('authz.trainingSession.checkIn'))
          .grant(
            'trainingEnrollments',
            read('trainingEnrollments', TRAINING_ENROLLMENT_FIELDS).update([
              'status',
              'checkedInAt',
              'checkInMethod',
              'updatedAt',
            ]),
          ),
      )
      .action('markAttendance', (a) =>
        a
          .title(label('authz.trainingSession.markAttendance'))
          .grant(
            'trainingEnrollments',
            read('trainingEnrollments', TRAINING_ENROLLMENT_FIELDS).update([
              'status',
              'checkedInAt',
              'checkInMethod',
              'markedBy',
              'markReason',
              'updatedAt',
            ]),
          ),
      )
      .action('export', (a) =>
        a
          .title(label('authz.trainingSession.export'))
          .grant(
            'trainingEnrollments',
            read('trainingEnrollments', TRAINING_ENROLLMENT_FIELDS),
          ),
      ),
);

export const practiceScenarioResource = defineCompositeResource(
  'talent.practiceScenario',
  (r) =>
    r
      .title(label('authz.practiceScenario.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant(
            'practiceScenarios',
            read('practiceScenarios', PRACTICE_SCENARIO_FIELDS),
          )
          .grant(
            'practiceScenarioCompetencies',
            read('practiceScenarioCompetencies', SCENARIO_COMPETENCY_FIELDS),
          ),
      )
      .action('manage', (a) =>
        a
          .title(label('authz.practiceScenario.manage'))
          .grant(
            'practiceScenarios',
            write('practiceScenarios', PRACTICE_SCENARIO_FIELDS),
          )
          .grant(
            'practiceScenarioCompetencies',
            write('practiceScenarioCompetencies', SCENARIO_COMPETENCY_FIELDS, {
              remove: true,
            }),
          ),
      )
      .action('confirm', (a) =>
        a
          .title(label('authz.practiceScenario.confirm'))
          .grant(
            'practiceScenarios',
            read('practiceScenarios', PRACTICE_SCENARIO_FIELDS).update([
              'reviewStatus',
              'updatedAt',
            ]),
          ),
      ),
);

export const practiceResource = defineCompositeResource(
  'talent.practice',
  (r) =>
    r
      .title(label('authz.practice.title'))
      .action('start', (a) =>
        a
          .title(label('authz.practice.start'))
          .grant(
            'practiceSessions',
            write('practiceSessions', PRACTICE_SESSION_FIELDS),
          ),
      )
      .action('view', (a) =>
        a
          .title(label('authz.practice.view'))
          .grant(
            'practiceSessions',
            read('practiceSessions', PRACTICE_SESSION_FIELDS),
          ),
      )
      // Field capability in code: the score and completion time, without the conversation.
      .action('viewScores', (a) =>
        a
          .title(label('authz.practice.viewScores'))
          .grant(
            'practiceSessions',
            read('practiceSessions', PRACTICE_SCORE_FIELDS),
          ),
      ),
);

export const learningPlanResource = defineCompositeResource(
  'talent.learningPlan',
  (r) =>
    r
      .title(label('authz.learningPlan.title'))
      .action('view', (a) =>
        a
          .title(label('authz.actions.view'))
          .grant('learningPlans', read('learningPlans', LEARNING_PLAN_FIELDS)),
      )
      .action('approve', (a) =>
        a
          .title(label('authz.learningPlan.approve'))
          .grant(
            'learningPlans',
            read('learningPlans', LEARNING_PLAN_FIELDS).update([
              'items',
              'status',
              'reviewedBy',
              'reviewedAt',
              'reviewNote',
              'assignmentIds',
              'updatedAt',
            ]),
          ),
      )
      .action('reject', (a) =>
        a
          .title(label('authz.learningPlan.reject'))
          .grant(
            'learningPlans',
            read('learningPlans', LEARNING_PLAN_FIELDS).update([
              'status',
              'reviewedBy',
              'reviewedAt',
              'reviewNote',
              'updatedAt',
            ]),
          ),
      ),
);

export const learningCoachResource = defineCompositeResource(
  'talent.learningCoach',
  (r) =>
    r
      .title(label('authz.learningCoach.title'))
      .action('use', (a) =>
        a
          .title(label('authz.learningCoach.use'))
          .grant('employees', people)
          .grant('learningPlans', write('learningPlans', LEARNING_PLAN_FIELDS)),
      )
      .action('configure', (a) =>
        a
          .title(label('authz.actions.configure'))
          .grant('aiAutomationSettings', automationSettingsWrite)
          .grant('aiTaskRuns', automationRunsRead)
          .grant('aiTaskRunItems', automationRunItemsRead),
      ),
);

export const practiceCoachResource = defineCompositeResource(
  'talent.practiceCoach',
  (r) =>
    r
      .title(label('authz.practiceCoach.title'))
      .action('use', (a) =>
        a
          .title(label('authz.practiceCoach.use'))
          .grant(
            'practiceScenarios',
            read('practiceScenarios', PRACTICE_SCENARIO_FIELDS),
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

export const TRAINING_COLLECTIONS: readonly { name: string; title: string }[] =
  [
    { name: 'learningPaths', title: 'collections.learningPaths' },
    { name: 'learningPathSteps', title: 'collections.learningPathSteps' },
    { name: 'trainingSessions', title: 'collections.trainingSessions' },
    { name: 'trainingEnrollments', title: 'collections.trainingEnrollments' },
    { name: 'practiceScenarios', title: 'collections.practiceScenarios' },
    {
      name: 'practiceScenarioCompetencies',
      title: 'collections.practiceScenarioCompetencies',
    },
    { name: 'practiceSessions', title: 'collections.practiceSessions' },
    { name: 'learningPlans', title: 'collections.learningPlans' },
  ];

export const TRAINING_COMPOSITES = [
  learningPathResource,
  trainingSessionResource,
  practiceScenarioResource,
  practiceResource,
  learningPlanResource,
  learningCoachResource,
  practiceCoachResource,
] as const;

/** Collections whose rows belong to one employee and follow the employee scopes. */
export const TRAINING_EMPLOYEE_COLLECTIONS = [
  'trainingEnrollments',
  'practiceSessions',
  'learningPlans',
] as const;
/** Collections an instructor owns through `ownerUserId` (sessions also through `instructorUserId`, practices through their scenario). */
export const TRAINING_OWNED_COLLECTIONS = [
  'learningPaths',
  'trainingSessions',
  'practiceScenarios',
  'practiceSessions',
] as const;

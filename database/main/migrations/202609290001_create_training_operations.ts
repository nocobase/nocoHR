import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2 step 5, training operations: learning paths that bring a person to a
 * position step by step, offline training sessions with QR check-in, video
 * lessons counted by what was actually watched, practice conversations with
 * the practice coach, and learning plans the learning coach drafts for a
 * manager to approve.
 *
 * Beyond the specification's fields:
 *
 * - `learningRecords.watchedRanges` keeps the merged watched intervals, from
 *   which the server computes `watchedSeconds`; `lastReportedAt` bounds how
 *   long a reported interval may be.
 * - `assignments.reminderCount` counts the learning coach's nudges, since
 *   "reminded twice" decides when a manager is told.
 * - `practiceSessions.lastActivityAt` finds abandoned conversations,
 *   `rehearsal` marks an instructor's trial run, which statistics skip, and
 *   `conversationSessionId` keeps one AI conversation per practice.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290001_create_training_operations',
  async up({ builder }) {
    await builder.createCollection('learningPaths', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code', { length: 64 }).notNull();
      c.string('title').notNull();
      c.text('description').nullable();
      c.string('positionId', { length: 64 }).nullable();
      // onboarding | development | other
      c.string('purpose', { length: 16 }).notNull().defaultTo('onboarding');
      c.boolean('sequential').notNull().defaultTo(true);
      c.boolean('skipCompleted').notNull().defaultTo(true);
      c.string('ownerUserId', { length: 64 }).notNull();
      c.boolean('published').notNull().defaultTo(false);
      c.datetime('publishedAt').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('code', { name: 'learning_paths_code_unique' });
      c.index('positionId', { name: 'learning_paths_position_index' });
    });
    await builder.createCollection('learningPathSteps', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('pathId', { length: 64 }).notNull();
      c.integer('sortOrder').notNull().defaultTo(0);
      // course | exam | practice
      c.string('stepType', { length: 16 }).notNull();
      c.string('courseId', { length: 64 }).nullable();
      c.string('examId', { length: 64 }).nullable();
      c.string('practiceScenarioId', { length: 64 }).nullable();
      c.integer('dueOffsetDays').notNull();
      c.boolean('required').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('pathId', { name: 'learning_path_steps_path_index' });
    });
    await builder.alterCollection('courses', (c) => {
      // online | offline
      c.string('deliveryMode', { length: 16 }).notNull().defaultTo('online');
    });
    await builder.alterCollection('lessons', (c) => {
      // markdown | video
      c.string('contentType', { length: 16 }).notNull().defaultTo('markdown');
      c.string('videoFileId', { length: 64 }).nullable();
      c.integer('videoSeconds').nullable();
      c.integer('minWatchPercent').nullable();
    });
    await builder.alterCollection('learningRecords', (c) => {
      c.integer('watchedSeconds').nullable();
      c.integer('maxPositionSeconds').nullable();
      // Merged watched intervals [[start, end], ...] in seconds.
      c.json('watchedRanges').nullable();
      c.datetime('lastReportedAt').nullable();
    });
    await builder.createCollection('trainingSessions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('courseId', { length: 64 }).notNull();
      c.string('title').notNull();
      c.string('instructorUserId', { length: 64 }).notNull();
      c.datetime('startAt').notNull();
      c.datetime('endAt').notNull();
      c.string('location').notNull();
      c.integer('capacity').notNull();
      c.datetime('enrollDeadline').nullable();
      // scheduled | cancelled | completed
      c.string('status', { length: 16 }).notNull().defaultTo('scheduled');
      c.string('ownerUserId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('courseId', { name: 'training_sessions_course_index' });
      c.index('startAt', { name: 'training_sessions_start_index' });
    });
    await builder.createCollection('trainingEnrollments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('sessionId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('assignmentId', { length: 64 }).nullable();
      // enrolled | attended | absent | cancelled
      c.string('status', { length: 16 }).notNull().defaultTo('enrolled');
      c.datetime('checkedInAt').nullable();
      // qr | manual
      c.string('checkInMethod', { length: 16 }).nullable();
      c.string('markedBy', { length: 64 }).nullable();
      // Required when an instructor records or corrects attendance.
      c.string('markReason').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['sessionId', 'employeeId'], {
        name: 'training_enrollments_session_employee_unique',
      });
      c.index('employeeId', { name: 'training_enrollments_employee_index' });
    });
    await builder.createCollection('practiceScenarios', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title').notNull();
      c.text('persona').notNull();
      c.text('situation').notNull();
      c.string('openingLine', { length: 1000 }).notNull();
      // [{ point, weight, competencyId, sourceExcerpt }], weights totalling 100.
      c.json('rubric').notNull();
      c.string('sourceDocumentId', { length: 64 }).notNull();
      c.integer('maxTurns').notNull().defaultTo(12);
      c.integer('passScore').notNull().defaultTo(70);
      c.string('ownerUserId', { length: 64 }).notNull();
      // manual | ai
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('draft');
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('ownerUserId', { name: 'practice_scenarios_owner_index' });
    });
    await builder.createCollection('practiceScenarioCompetencies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('scenarioId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['scenarioId', 'competencyId'], {
        name: 'practice_scenario_competencies_unique',
      });
      c.index('competencyId', {
        name: 'practice_scenario_competencies_competency_index',
      });
    });
    await builder.createCollection('practiceSessions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('scenarioId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('assignmentId', { length: 64 }).nullable();
      // [{ role: 'coach' | 'employee', text, at }]
      c.json('transcript').notNull();
      c.integer('turnCount').notNull().defaultTo(0);
      // inProgress | completed | abandoned
      c.string('status', { length: 16 }).notNull().defaultTo('inProgress');
      c.integer('score').nullable();
      c.json('rubricResults').nullable();
      c.text('feedback').nullable();
      // An instructor's trial run of a scenario; left out of statistics.
      c.boolean('rehearsal').notNull().defaultTo(false);
      // The AI conversation the practice coach runs in, one per practice.
      c.string('conversationSessionId', { length: 64 }).nullable();
      c.datetime('startedAt').nullable();
      c.datetime('completedAt').nullable();
      c.datetime('lastActivityAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('scenarioId', { name: 'practice_sessions_scenario_index' });
      c.index('employeeId', { name: 'practice_sessions_employee_index' });
      c.index('status', { name: 'practice_sessions_status_index' });
    });
    await builder.createCollection('learningPlans', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      // gap | request
      c.string('trigger', { length: 16 }).notNull();
      c.json('triggerRef').nullable();
      c.text('summary').notNull();
      // [{ type, refId, competencyId, reason, dueDate, estimatedMinutes }], at most 5.
      c.json('items').notNull();
      c.string('reviewerUserId', { length: 64 }).notNull();
      // draft | approved | rejected | expired
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.string('reviewedBy', { length: 64 }).nullable();
      c.datetime('reviewedAt').nullable();
      c.string('reviewNote', { length: 1000 }).nullable();
      c.json('assignmentIds').nullable();
      // ai | manual
      c.string('source', { length: 16 }).notNull().defaultTo('ai');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId', { name: 'learning_plans_employee_index' });
      c.index('reviewerUserId', { name: 'learning_plans_reviewer_index' });
      c.index('status', { name: 'learning_plans_status_index' });
    });
    await builder.alterCollection('assignments', (c) => {
      c.string('learningPathId', { length: 64 }).nullable();
      c.string('parentAssignmentId', { length: 64 }).nullable();
      c.string('pathStepId', { length: 64 }).nullable();
      c.string('practiceScenarioId', { length: 64 }).nullable();
      c.string('learningPlanId', { length: 64 }).nullable();
      c.boolean('optional').notNull().defaultTo(false);
      c.integer('reminderCount').notNull().defaultTo(0);
      c.index('parentAssignmentId', { name: 'assignments_parent_index' });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('assignments', (c) => {
      c.dropIndex('assignments_parent_index');
      c.dropFields(
        'learningPathId',
        'parentAssignmentId',
        'pathStepId',
        'practiceScenarioId',
        'learningPlanId',
        'optional',
        'reminderCount',
      );
    });
    await builder.dropCollection('learningPlans');
    await builder.dropCollection('practiceSessions');
    await builder.dropCollection('practiceScenarioCompetencies');
    await builder.dropCollection('practiceScenarios');
    await builder.dropCollection('trainingEnrollments');
    await builder.dropCollection('trainingSessions');
    await builder.alterCollection('learningRecords', (c) => {
      c.dropFields(
        'watchedSeconds',
        'maxPositionSeconds',
        'watchedRanges',
        'lastReportedAt',
      );
    });
    await builder.alterCollection('lessons', (c) => {
      c.dropFields(
        'contentType',
        'videoFileId',
        'videoSeconds',
        'minWatchPercent',
      );
    });
    await builder.alterCollection('courses', (c) => {
      c.dropField('deliveryMode');
    });
    await builder.dropCollection('learningPathSteps');
    await builder.dropCollection('learningPaths');
  },
});

export default migration;

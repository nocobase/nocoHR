import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-11 画像、联动与内容维护:
 *
 * - `businessSignals`: quality issues, tickets and project tasks pushed or
 *   imported from other systems, matched to an employee and a competency.
 *   (sourceSystem, externalId) is unique, so a repeated push updates the row.
 *   `customFields` holds administrator-added fields (such as 班次), keyed by
 *   the definition's internal key.
 * - `signalCompetencyRules`: which source category proves which competency;
 *   only confirmed rules match. (sourceSystem, category) is unique.
 * - `competencySuggestions`: the talent analyst's level suggestions, decided
 *   by the employee's head. `departmentId` is the employee's department when
 *   the suggestion was written.
 * - `trainingRecommendations`: 专项培训建议 for a department and competency
 *   with repeated quality issues; the learning coach fills `items`, the head
 *   approves, the proof PDF and the 8D write-back follow completion.
 * - `auditExports`: one row per audit export (the application has no audit-log
 *   plugin); who exported what, when, over which scope.
 * - employees: the AI profile summary with its per-sentence evidence;
 *   employeeCompetencies.suggestionId; assignments: the recommendation a task
 *   came from and the course version and source document it was completed
 *   against. Completed course assignments are backfilled with version 1 and the
 *   course's current source document.
 *
 * `contentRevisions` and the course / document columns of content maintenance
 * already exist (202609290002).
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610080001_create_profile_signals',
  async up({ builder, query }) {
    await builder.createCollection('businessSignals', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // qms | ticket | project | other
      c.string('sourceSystem', { length: 16 }).notNull();
      c.string('externalId', { length: 128 }).notNull();
      // qualityIssue | correctiveAction | ticketResolved | ticketReopened | ticketEscalated | taskDelivered | taskDelayed
      c.string('signalType', { length: 32 }).notNull();
      c.string('category', { length: 128 }).nullable();
      // minor | major | critical
      c.string('severity', { length: 16 }).nullable();
      c.string('title', { length: 500 }).notNull();
      c.text('summary').nullable();
      c.datetime('occurredAt').notNull();
      c.string('employeeId', { length: 64 }).nullable();
      c.string('personKey', { length: 128 }).notNull();
      c.string('departmentId', { length: 64 }).nullable();
      c.string('competencyId', { length: 64 }).nullable();
      c.string('correctiveActionRef', { length: 64 }).nullable();
      c.string('link', { length: 1000 }).nullable();
      // matched | unmatchedPerson | unmatchedCompetency | ignored
      c.string('matchStatus', { length: 32 }).notNull();
      c.json('rawPayload').nullable();
      c.json('customFields').nullable();
      // push | import | workflow | seed
      c.string('channel', { length: 16 }).notNull().defaultTo('push');
      c.string('ingestedBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['sourceSystem', 'externalId'], {
        name: 'business_signals_source_external_unique',
      });
      c.index('employeeId', { name: 'business_signals_employee_index' });
      c.index(['departmentId', 'competencyId'], {
        name: 'business_signals_department_competency_index',
      });
      c.index('matchStatus', { name: 'business_signals_match_index' });
      c.index('occurredAt', { name: 'business_signals_occurred_index' });
    });
    await builder.createCollection('signalCompetencyRules', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('sourceSystem', { length: 16 }).notNull();
      c.string('category', { length: 128 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      // manual | ai
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('draft');
      c.text('note').nullable();
      c.string('createdBy', { length: 64 }).nullable();
      c.string('confirmedBy', { length: 64 }).nullable();
      c.datetime('confirmedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['sourceSystem', 'category'], {
        name: 'signal_competency_rules_category_unique',
      });
    });
    await builder.createCollection('competencySuggestions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.string('departmentId', { length: 64 }).nullable();
      c.integer('currentLevel').notNull();
      c.integer('suggestedLevel').notNull();
      c.text('rationale').notNull();
      // [{ type: signal | examAttempt | practiceSession, id, summary }]
      c.json('evidence').notNull();
      c.string('reviewerUserId', { length: 64 }).notNull();
      // draft | accepted | rejected | expired
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.integer('decidedLevel').nullable();
      c.string('reviewedBy', { length: 64 }).nullable();
      c.datetime('reviewedAt').nullable();
      c.text('reviewNote').nullable();
      // The assessment written when the head accepted.
      c.string('assessmentId', { length: 64 }).nullable();
      c.string('source', { length: 16 }).notNull().defaultTo('ai');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'competencyId', 'status'], {
        name: 'competency_suggestions_employee_index',
      });
      c.index(['reviewerUserId', 'status'], {
        name: 'competency_suggestions_reviewer_index',
      });
    });
    await builder.createCollection('trainingRecommendations', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('departmentId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.text('reason').notNull();
      // [{ signalId, externalId, summary }]
      c.json('evidence').notNull();
      // [{ employeeId, reason }]
      c.json('audience').notNull();
      // [{ type: course | practice | exam, id, title }]
      c.json('items').nullable();
      c.date('dueDate').nullable();
      c.json('correctiveActionRefs').nullable();
      c.string('reviewerUserId', { length: 64 }).notNull();
      // drafting | draft | approved | rejected | expired | completed
      c.string('status', { length: 16 }).notNull().defaultTo('drafting');
      c.string('reviewedBy', { length: 64 }).nullable();
      c.datetime('reviewedAt').nullable();
      c.text('reviewNote').nullable();
      c.datetime('completedAt').nullable();
      c.string('certificateFileId', { length: 64 }).nullable();
      // notConfigured | pending | succeeded | failed
      c.string('writebackStatus', { length: 16 }).nullable();
      c.text('writebackError').nullable();
      c.datetime('writebackAt').nullable();
      c.string('source', { length: 16 }).notNull().defaultTo('ai');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['departmentId', 'competencyId', 'status'], {
        name: 'training_recommendations_department_index',
      });
      c.index(['reviewerUserId', 'status'], {
        name: 'training_recommendations_reviewer_index',
      });
    });
    await builder.createCollection('auditExports', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // trainingFile | recommendationProof | qualificationLedger | auditPack
      c.string('kind', { length: 32 }).notNull();
      c.string('actorUserId', { length: 64 }).notNull();
      c.json('scope').nullable();
      c.string('fileName', { length: 255 }).nullable();
      c.text('summary').nullable();
      // page | assistant
      c.string('via', { length: 16 }).notNull().defaultTo('page');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('createdAt', { name: 'audit_exports_created_index' });
    });
    await builder.alterCollection('employees', (c) => {
      c.text('aiSummary').nullable();
      c.datetime('aiSummaryAt').nullable();
      // [{ sentence, evidence: [{ type, id, label }] }]
      c.json('aiSummaryEvidence').nullable();
    });
    await builder.alterCollection('employeeCompetencies', (c) => {
      c.string('suggestionId', { length: 64 }).nullable();
    });
    await builder.alterCollection('assignments', (c) => {
      c.string('trainingRecommendationId', { length: 64 }).nullable();
      c.integer('courseVersion').nullable();
      c.string('courseSourceDocumentId', { length: 64 }).nullable();
      c.index('trainingRecommendationId', {
        name: 'assignments_training_recommendation_index',
      });
    });
    // Completed course assignments were completed against version 1 of their course's current source.
    const courses = await query
      .selectFrom('courses')
      .select(['id', 'sourceDocumentId'])
      .execute();
    for (const course of courses)
      await query
        .updateTable('assignments')
        .set({
          courseVersion: 1,
          courseSourceDocumentId:
            course.sourceDocumentId == null
              ? null
              : `${course.sourceDocumentId as string}`,
        })
        .where('courseId', '=', String(course.id))
        .where('status', '=', 'completed')
        .where('courseVersion', 'is', null)
        .execute();
  },
  async down({ builder }) {
    await builder.alterCollection('assignments', (c) => {
      c.dropFields(
        'trainingRecommendationId',
        'courseVersion',
        'courseSourceDocumentId',
      );
    });
    await builder.alterCollection('employeeCompetencies', (c) => {
      c.dropFields('suggestionId');
    });
    await builder.alterCollection('employees', (c) => {
      c.dropFields('aiSummary', 'aiSummaryAt', 'aiSummaryEvidence');
    });
    await builder.dropCollection('auditExports');
    await builder.dropCollection('trainingRecommendations');
    await builder.dropCollection('competencySuggestions');
    await builder.dropCollection('signalCompetencyRules');
    await builder.dropCollection('businessSignals');
  },
});

export default migration;

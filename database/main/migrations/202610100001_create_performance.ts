import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V4-12 绩效:
 *
 * - `reviewSchemes`: 考核方案 — dimensions and weights, the rating scale, the
 *   enabled stages, the quality and safety rules, the distribution guide and
 *   the bonus coefficients (maintained by hr.payroll). `scoring` holds the
 *   administrator-adjustable scoring parameters (competency conversion, the
 *   reason thresholds). `customFields` holds administrator-added fields, keyed
 *   by the definition's internal key.
 * - `reviewCycles`: 考核周期 — period, scope and exclusion rules, stage
 *   deadlines, status, the owning HR, the participants excluded when goal
 *   setting started, the stage log and the calibration pack.
 * - `goals`: personal and department goals, with progress notes.
 * - `reviews`: one evaluation task (self / peer / manager / skipLevel); the
 *   assistant's draft is only the reviewer's to see; the adoption and the
 *   active editing time are computed on the server.
 * - `reviewResults`: one per (cycleId, employeeId): the scheme, the reviewers,
 *   the evidence snapshot and summary, the reference score, the ratings and
 *   the calibration log, the appeal, publication and acknowledgement.
 * - employeeSalaries.bonusBase, payrollCycles.bonusCycleId and
 *   salaryAdjustments.relatedReviewResultId (V2-06 extended).
 *
 * `employeeCompetencies.source = review` and `learningPlans.trigger =
 * reviewResult` are new values of existing string columns; no change here.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610100001_create_performance',
  async up({ builder }) {
    await builder.createCollection('reviewSchemes', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title', { length: 200 }).notNull();
      // { positionIds: string[], jobFamilyIds: string[], grades: string[] }
      c.json('appliesTo').notNull();
      // [{ key: goals | competencies | qualitySafety | peer, weight }]
      c.json('sections').notNull();
      // [{ code, score, description }]
      c.json('ratingScale').notNull();
      // { goalSetting, selfReview, peerReview: { enabled, count }, managerReview, skipLevelReview, calibration }
      c.json('stages').notNull();
      c.json('qualitySafetyRules').nullable();
      // { S: { max: 10 }, A: { max: 25 }, 'C+D': { min: 5 } } (percentages)
      c.json('distributionGuide').nullable();
      // { S: 1.5, A: 1.2, ... }
      c.json('ratingCoefficients').nullable();
      c.json('scoring').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.json('customFields').nullable();
      c.string('updatedBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('reviewCycles', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title', { length: 200 }).notNull();
      c.date('periodStart').notNull();
      c.date('periodEnd').notNull();
      // { departmentIds, minTenureDays, excludeProbation, schemeOverrides: { employeeId: schemeId }, managerOverrides: { employeeId: userId } }
      c.json('scope').notNull();
      // { goalSetting: date, selfReview: date, ... }
      c.json('stageDeadlines').notNull();
      c.boolean('autoAdvance').notNull().defaultTo(false);
      // draft | goalSetting | selfReview | peerReview | managerReview | calibration | published | closed
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.string('ownerUserId', { length: 64 }).notNull();
      // [{ employeeId, reasons: [] }] written when goal setting starts
      c.json('exclusions').nullable();
      // [{ from, to, at, by, auto }]
      c.json('stageLog').nullable();
      // { content, generatedAt, runId, source }
      c.json('calibrationPack').nullable();
      c.datetime('publishedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('status', { name: 'review_cycles_status_index' });
    });
    await builder.createCollection('goals', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('cycleId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).nullable();
      c.string('departmentId', { length: 64 }).nullable();
      c.string('title', { length: 300 }).notNull();
      c.text('measure').notNull();
      c.integer('weight').nullable();
      c.string('alignedGoalId', { length: 64 }).nullable();
      c.integer('progress').notNull().defaultTo(0);
      // [{ at, progress, note, by }]
      c.json('progressNotes').nullable();
      // draft | submitted | approved | cancelled
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      // manual | ai
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // The employee edited an AI draft before submitting it.
      c.boolean('editedByEmployee').notNull().defaultTo(false);
      c.string('createdBy', { length: 64 }).nullable();
      c.datetime('submittedAt').nullable();
      c.string('approvedBy', { length: 64 }).nullable();
      c.datetime('approvedAt').nullable();
      c.text('returnNote').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['cycleId', 'employeeId'], {
        name: 'goals_cycle_employee_index',
      });
      c.index(['cycleId', 'departmentId'], {
        name: 'goals_cycle_department_index',
      });
    });
    await builder.createCollection('reviews', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('cycleId', { length: 64 }).notNull();
      c.string('resultId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('reviewerUserId', { length: 64 }).notNull();
      // self | peer | manager | skipLevel
      c.string('role', { length: 16 }).notNull();
      // { goals: [{ goalId, score, comment }], competencies: [{ competencyId, level, comment }], qualitySafety: { score, comment, reason } }
      c.json('items').nullable();
      c.string('overallRating', { length: 8 }).nullable();
      c.text('overallReason').nullable();
      c.text('comment').nullable();
      // notStarted | draft | submitted | cancelled
      c.string('status', { length: 16 }).notNull().defaultTo('notStarted');
      // { comment, itemSuggestions, evidenceRefs, generatedAt, source }
      c.json('aiDraft').nullable();
      // adoptedAsIs | edited | discarded
      c.string('aiDraftAdoption', { length: 16 }).nullable();
      c.integer('activeSeconds').notNull().defaultTo(0);
      c.integer('submissionCount').notNull().defaultTo(0);
      c.datetime('submittedAt').nullable();
      // { submission, items: [{ type, text }], at }
      c.json('hints').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['cycleId', 'reviewerUserId'], {
        name: 'reviews_cycle_reviewer_index',
      });
      c.index(['cycleId', 'employeeId'], {
        name: 'reviews_cycle_employee_index',
      });
    });
    await builder.createCollection('reviewResults', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('cycleId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('schemeId', { length: 64 }).notNull();
      // The department and position when the result was created (scope, distribution).
      c.string('departmentId', { length: 64 }).nullable();
      c.string('positionId', { length: 64 }).nullable();
      c.string('managerUserId', { length: 64 }).notNull();
      c.string('skipLevelUserId', { length: 64 }).nullable();
      c.boolean('skipLevelSkipped').notNull().defaultTo(false);
      c.boolean('noAccount').notNull().defaultTo(false);
      c.json('peerUserIds').nullable();
      // none | nominated | confirmed
      c.string('peerStatus', { length: 16 }).notNull().defaultTo('none');
      c.json('evidenceSnapshot').nullable();
      c.text('evidenceSummary').nullable();
      c.double('computedScore').nullable();
      c.string('managerRating', { length: 8 }).nullable();
      c.string('calibratedRating', { length: 8 }).nullable();
      c.string('finalRating', { length: 8 }).nullable();
      // [{ from, to, reason, by, at }]
      c.json('adjustments').nullable();
      // inProgress | calibrated | published | acknowledged | appealed | closed
      c.string('status', { length: 16 }).notNull().defaultTo('inProgress');
      // offboarded | manual
      c.string('closedReason', { length: 16 }).nullable();
      // { reason, at, handledBy, handledAt, result, note }
      c.json('appeal').nullable();
      c.datetime('publishedAt').nullable();
      c.datetime('acknowledgedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['cycleId', 'employeeId'], {
        name: 'review_results_cycle_employee_unique',
      });
      c.index('employeeId', { name: 'review_results_employee_index' });
    });
    await builder.alterCollection('employeeSalaries', (c) => {
      c.double('bonusBase').nullable();
    });
    await builder.alterCollection('payrollCycles', (c) => {
      c.string('bonusCycleId', { length: 64 }).nullable();
    });
    await builder.alterCollection('salaryAdjustments', (c) => {
      c.string('relatedReviewResultId', { length: 64 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('salaryAdjustments', (c) => {
      c.dropFields('relatedReviewResultId');
    });
    await builder.alterCollection('payrollCycles', (c) => {
      c.dropFields('bonusCycleId');
    });
    await builder.alterCollection('employeeSalaries', (c) => {
      c.dropFields('bonusBase');
    });
    await builder.dropCollection('reviewResults');
    await builder.dropCollection('reviews');
    await builder.dropCollection('goals');
    await builder.dropCollection('reviewCycles');
    await builder.dropCollection('reviewSchemes');
  },
});

export default migration;

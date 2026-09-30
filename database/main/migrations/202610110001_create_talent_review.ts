import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V4-13 人才盘点与其他 (the ten tables the 总纲 names for the step, plus the
 * two the 13C audit log needs and the certification link table):
 *
 * 13A
 * - `talentReviews`: 盘点活动 — the departments in scope (with descendants),
 *   the published review cycle the performance axis reads, status
 *   draft → preparing → inSession → concluded, the HR owner, the stage log.
 * - `talentPlacements`: one per (talentReviewId, employeeId): the
 *   performance band (converted from the final rating, or entered with a
 *   reason), the manager's potential answers and band, the box, the talent
 *   analyst's pre-placement (reference only), the moves made in the session
 *   (each with a reason), the development actions, who decided, the plan.
 * - `successionPlans`: one per (positionId, departmentId): incumbent,
 *   candidates [{ employeeId, readiness, gaps, developmentPlanId, source,
 *   note, left }], draft / confirmed, reviewer; the risk alerts sent.
 * - `competencyModelVersions`: one per (positionId, versionNo): the snapshot
 *   of the position's requirements, draft / published / archived, the
 *   effective date, the change note (and whether the advisor wrote it, with
 *   the hash of the draft it was written for), the impact preview.
 * - `positions.isKey` / `keyReason` (V1-01 extended).
 *
 * 13B
 * - `practicalAssessments`, `practicalRecords`: 实操考核表 and 考核记录.
 *   `passed` is computed by the server from `passRule`; signed records are
 *   immutable except for 作废 (voidReason). Attachments are `hrFiles` ids.
 * - `certificationPracticals` (the practical assessments a certification
 *   requires) and `certifications.practicalRequiredFor` / `practicalValidMonths`
 *   (V3-10 extended).
 * - `instructorProfiles`; `trainingSessions.instructorProfileId`. An external
 *   instructor has no account: the session then keeps its organizer (the
 *   owner) in the required `instructorUserId` and names the external profile
 *   in `instructorProfileId`. (Altering a string column's nullability fails
 *   on SQLite in this framework version, so the column stays required.)
 * - `trainingEvaluations`: l1 / l3 tasks, one per (level, targetType,
 *   targetId, employeeId).
 * - `knowledgeCandidates`: resolved tickets and featured forum posts, one per
 *   (sourceSystem, externalId).
 * - `kbDocuments.source` / `reviewStatus` / `controlled` / `aiNotes`
 *   (V1-04 extended): a draft document never answers; an uncontrolled one is
 *   cited with a notice.
 * - 内容多语言: `locale`, `translationOfId`, `translationStatus`
 *   (upToDate / outdated) and `sourceHash` on courses, lessons,
 *   practiceScenarios, questions and kbDocuments.
 *
 * 13C
 * - `agentClients`; `agentTokens` (personal access tokens: a hash, never the
 *   secret); `agentCallLogs` (the audit log of every call).
 *
 * `customFields` on instructorProfiles and practicalAssessments holds
 * administrator-added fields. `learningPlans.trigger = talentReview` is a new
 * value of an existing string column; no change here.
 */
const TRANSLATABLE = [
  'courses',
  'lessons',
  'practiceScenarios',
  'questions',
] as const;

const migration: MigrationDefinition = defineMigration({
  name: '202610110001_create_talent_review',
  async up({ builder }) {
    // ---------- 13A ----------
    await builder.createCollection('talentReviews', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title', { length: 200 }).notNull();
      // { departmentIds: string[] } — each with its descendants
      c.json('scope').notNull();
      c.string('reviewCycleId', { length: 64 }).nullable();
      // draft | preparing | inSession | concluded
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.string('ownerUserId', { length: 64 }).notNull();
      // [{ from, to, at, by }]
      c.json('stageLog').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('status', { name: 'talent_reviews_status_index' });
    });
    await builder.createCollection('talentPlacements', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('talentReviewId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      // The employee's department when the placement was created (scope of the heads).
      c.string('departmentId', { length: 64 }).notNull();
      c.integer('performanceBand').nullable();
      // The final rating the band was converted from (null without a result).
      c.string('performanceRating', { length: 16 }).nullable();
      // rating | manual
      c.string('performanceSource', { length: 16 }).nullable();
      c.text('performanceReason').nullable();
      // { learningAgility: { score, example }, aspiration: {...}, influence: {...} }
      c.json('potentialAnswers').nullable();
      c.string('potentialAssessedBy', { length: 64 }).nullable();
      c.datetime('potentialAssessedAt').nullable();
      c.integer('potentialBand').nullable();
      c.integer('box').nullable();
      // { performanceBand, potentialEvidence: [], suggestedBox, notes, source, generatedAt }
      c.json('aiSuggestion').nullable();
      // [{ fromBox, toBox, performanceBand, potentialBand, reason, by, at }]
      c.json('moves').nullable();
      // [{ type, note }]
      c.json('developmentActions').nullable();
      c.string('decidedBy', { length: 64 }).nullable();
      c.datetime('decidedAt').nullable();
      c.string('learningPlanId', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['talentReviewId', 'employeeId'], {
        name: 'talent_placements_review_employee_unique',
      });
      c.index('employeeId', { name: 'talent_placements_employee_index' });
    });
    await builder.createCollection('successionPlans', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('positionId', { length: 64 }).notNull();
      c.string('departmentId', { length: 64 }).notNull();
      c.string('incumbentEmployeeId', { length: 64 }).nullable();
      // [{ employeeId, readiness, gaps, developmentPlanId, source, note, left, addedAt }]
      c.json('candidates').notNull();
      // draft | confirmed
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.string('reviewedBy', { length: 64 }).nullable();
      c.datetime('reviewedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['positionId', 'departmentId'], {
        name: 'succession_plans_position_department_unique',
      });
    });
    await builder.createCollection('competencyModelVersions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('positionId', { length: 64 }).notNull();
      c.integer('versionNo').notNull();
      // [{ competencyId, requiredLevel, mandatory }]
      c.json('snapshot').notNull();
      // draft | published | archived
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.date('effectiveFrom').nullable();
      c.text('changeNote').nullable();
      // ai | rule | manual — who wrote the change note last
      c.string('changeNoteSource', { length: 16 }).nullable();
      // The draft content the advisor's note was written for.
      c.string('changeNoteHash', { length: 64 }).nullable();
      // { newGaps: { count, people: [...] }, removed: [...], changed: [...] }
      c.json('impactPreview').nullable();
      c.string('publishedBy', { length: 64 }).nullable();
      c.datetime('publishedAt').nullable();
      c.datetime('archivedAt').nullable();
      // manual | ai | system (initial version, direct edits)
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      c.string('createdBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['positionId', 'versionNo'], {
        name: 'competency_model_versions_position_version_unique',
      });
    });
    await builder.alterCollection('positions', (c) => {
      c.boolean('isKey').notNull().defaultTo(false);
      c.string('keyReason', { length: 500 }).nullable();
    });

    // ---------- 13B ----------
    await builder.createCollection('practicalAssessments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title', { length: 200 }).notNull();
      c.json('competencyIds').notNull();
      // [{ key, item, critical, sourceExcerpt }]
      c.json('checklist').notNull();
      // { allCriticalPass, minPassRate }
      c.json('passRule').notNull();
      c.string('sourceDocumentId', { length: 64 }).nullable();
      c.boolean('requiresWitness').notNull().defaultTo(false);
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('draft');
      // manual | ai
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      c.boolean('active').notNull().defaultTo(true);
      c.string('ownerUserId', { length: 64 }).notNull();
      c.string('confirmedBy', { length: 64 }).nullable();
      c.datetime('confirmedAt').nullable();
      c.json('customFields').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('practicalRecords', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('assessmentId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('assessorUserId', { length: 64 }).notNull();
      c.string('witnessUserId', { length: 64 }).nullable();
      c.datetime('conductedAt').notNull();
      c.string('location', { length: 200 }).nullable();
      c.text('observationNotes').nullable();
      // { items: [{ key, suggestion: pass | fail | notRecorded, quotes: [] }], notesHash, source, generatedAt }
      c.json('aiStructured').nullable();
      // [{ key, passed, note }]
      c.json('results').notNull();
      c.boolean('passed').notNull().defaultTo(false);
      // hrFiles ids
      c.json('attachments').nullable();
      c.datetime('signedAt').nullable();
      c.datetime('witnessSignedAt').nullable();
      // draft | signed (waiting for the witness) | completed | voided
      c.string('status', { length: 16 }).notNull().defaultTo('draft');
      c.string('voidReason', { length: 500 }).nullable();
      c.string('voidedBy', { length: 64 }).nullable();
      c.datetime('voidedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId', { name: 'practical_records_employee_index' });
      c.index('witnessUserId', { name: 'practical_records_witness_index' });
    });
    await builder.createCollection('certificationPracticals', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('certificationId', { length: 64 }).notNull();
      c.string('assessmentId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['certificationId', 'assessmentId'], {
        name: 'certification_practicals_unique',
      });
    });
    await builder.alterCollection('certifications', (c) => {
      // initial | recert | both
      c.string('practicalRequiredFor', { length: 16 })
        .notNull()
        .defaultTo('both');
      c.integer('practicalValidMonths').notNull().defaultTo(12);
    });
    await builder.createCollection('instructorProfiles', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('userId', { length: 64 }).nullable();
      c.string('name', { length: 100 }).notNull();
      // internal | external
      c.string('type', { length: 16 }).notNull();
      c.string('organization', { length: 200 }).nullable();
      c.json('competencyIds').nullable();
      // junior | senior | expert
      c.string('level', { length: 16 }).nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.json('customFields').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.alterCollection('trainingSessions', (c) => {
      c.string('instructorProfileId', { length: 64 }).nullable();
    });
    await builder.createCollection('trainingEvaluations', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // l1 | l3
      c.string('level', { length: 8 }).notNull();
      // course | trainingSession | trainingRecommendation
      c.string('targetType', { length: 32 }).notNull();
      c.string('targetId', { length: 64 }).notNull();
      // The course behind the target, for the course summary.
      c.string('courseId', { length: 64 }).nullable();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('respondentUserId', { length: 64 }).notNull();
      c.json('answers').nullable();
      c.float('score').nullable();
      // pending | submitted | expired
      c.string('status', { length: 16 }).notNull().defaultTo('pending');
      c.datetime('dueAt').notNull();
      // When the learning the task evaluates was completed.
      c.datetime('completedAt').notNull();
      c.datetime('submittedAt').nullable();
      c.datetime('remindedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['level', 'targetType', 'targetId', 'employeeId'], {
        name: 'training_evaluations_unique',
      });
      c.index('respondentUserId', {
        name: 'training_evaluations_respondent_index',
      });
    });
    await builder.createCollection('knowledgeCandidates', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // ticket | forum | knowledgeGap
      c.string('sourceSystem', { length: 16 }).notNull();
      c.string('externalId', { length: 128 }).notNull();
      c.string('title', { length: 300 }).notNull();
      c.text('content').notNull();
      c.string('link', { length: 1000 }).nullable();
      c.string('topic', { length: 200 }).nullable();
      // new | drafted | ignored
      c.string('status', { length: 16 }).notNull().defaultTo('new');
      c.string('draftDocumentId', { length: 64 }).nullable();
      c.string('ignoredBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['sourceSystem', 'externalId'], {
        name: 'knowledge_candidates_source_unique',
      });
    });
    await builder.alterCollection('kbDocuments', (c) => {
      // manual | ai
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 })
        .notNull()
        .defaultTo('confirmed');
      c.boolean('controlled').notNull().defaultTo(true);
      // { topic, candidateIds, sources: [], conflicts: [] } for an AI-drafted FAQ
      c.json('aiNotes').nullable();
      c.string('locale', { length: 8 }).notNull().defaultTo('zh-CN');
      c.string('translationOfId', { length: 64 }).nullable();
      c.string('translationStatus', { length: 16 }).nullable();
      c.string('sourceHash', { length: 64 }).nullable();
    });
    for (const collection of TRANSLATABLE)
      await builder.alterCollection(collection, (c) => {
        c.string('locale', { length: 8 }).notNull().defaultTo('zh-CN');
        c.string('translationOfId', { length: 64 }).nullable();
        // upToDate | outdated (the original changed after the translation)
        c.string('translationStatus', { length: 16 }).nullable();
        // The original's content hash the translation was drafted from.
        c.string('sourceHash', { length: 64 }).nullable();
      });

    // ---------- 13C ----------
    await builder.createCollection('agentClients', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('name', { length: 200 }).notNull();
      c.string('ownerUserId', { length: 64 }).notNull();
      c.json('allowedTools').notNull();
      // active | revoked
      c.string('status', { length: 16 }).notNull().defaultTo('active');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('agentTokens', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('clientId', { length: 64 }).notNull();
      c.string('userId', { length: 64 }).notNull();
      c.string('name', { length: 200 }).nullable();
      // SHA-256 of the secret; the secret is shown once.
      c.string('tokenHash', { length: 64 }).notNull();
      c.string('prefix', { length: 16 }).notNull();
      c.datetime('expiresAt').notNull();
      c.datetime('revokedAt').nullable();
      c.string('revokedBy', { length: 64 }).nullable();
      c.datetime('lastUsedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('tokenHash', { name: 'agent_tokens_hash_unique' });
      c.index('userId', { name: 'agent_tokens_user_index' });
    });
    await builder.createCollection('agentCallLogs', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('clientId', { length: 64 }).nullable();
      c.string('tokenId', { length: 64 }).nullable();
      c.string('userId', { length: 64 }).nullable();
      c.string('tool', { length: 64 }).notNull();
      // ok | denied | error | rateLimited | unauthorized
      c.string('status', { length: 16 }).notNull();
      c.string('summary', { length: 500 }).nullable();
      c.datetime('calledAt').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('tokenId', { name: 'agent_call_logs_token_index' });
      c.index('clientId', { name: 'agent_call_logs_client_index' });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('agentCallLogs');
    await builder.dropCollection('agentTokens');
    await builder.dropCollection('agentClients');
    for (const collection of [...TRANSLATABLE].reverse())
      await builder.alterCollection(collection, (c) => {
        c.dropFields(
          'locale',
          'translationOfId',
          'translationStatus',
          'sourceHash',
        );
      });
    await builder.alterCollection('kbDocuments', (c) => {
      c.dropFields(
        'source',
        'reviewStatus',
        'controlled',
        'aiNotes',
        'locale',
        'translationOfId',
        'translationStatus',
        'sourceHash',
      );
    });
    await builder.dropCollection('knowledgeCandidates');
    await builder.dropCollection('trainingEvaluations');
    await builder.alterCollection('trainingSessions', (c) => {
      c.dropFields('instructorProfileId');
    });
    await builder.dropCollection('instructorProfiles');
    await builder.alterCollection('certifications', (c) => {
      c.dropFields('practicalRequiredFor', 'practicalValidMonths');
    });
    await builder.dropCollection('certificationPracticals');
    await builder.dropCollection('practicalRecords');
    await builder.dropCollection('practicalAssessments');
    await builder.alterCollection('positions', (c) => {
      c.dropFields('isKey', 'keyReason');
    });
    await builder.dropCollection('competencyModelVersions');
    await builder.dropCollection('successionPlans');
    await builder.dropCollection('talentPlacements');
    await builder.dropCollection('talentReviews');
  },
});

export default migration;

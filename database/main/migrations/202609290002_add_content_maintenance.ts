import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2 step 6, content maintenance and exam enhancements:
 *
 * - document versions (a version chain per document number, the superseded
 *   version leaving the knowledge assistant, the section-by-section change
 *   list) and review dates;
 * - change-brief courses and course versions; revision suggestions for the
 *   lessons, questions and practice scenarios a change touches; conflicts
 *   between documents;
 * - anti-cheating settings and records on exams and attempts, the examiner's
 *   suggested scores (inside `itemResults`), points lost by competency;
 * - external certificates, registered with a scan and verified by HR before
 *   they bring any permission.
 *
 * An attempt voided after an integrity review keeps `voidReason`; attempts
 * voided by "reset attempts" (V1) have none, and only those stop counting.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290002_add_content_maintenance',
  async up({ builder }) {
    await builder.alterCollection('kbDocuments', (c) => {
      c.string('docNo', { length: 64 }).nullable();
      c.string('version', { length: 32 }).nullable();
      c.string('previousVersionId', { length: 64 }).nullable();
      c.string('supersededById', { length: 64 }).nullable();
      c.date('effectiveDate').nullable();
      // [{ sectionTitle, changeType: added | modified | removed, before, after }]
      c.json('changeSummary').nullable();
      c.text('changeNote').nullable();
      c.datetime('lastReviewedAt').nullable();
      c.index('docNo', { name: 'kb_documents_doc_no_index' });
    });
    await builder.alterCollection('courses', (c) => {
      // standard | changeBrief
      c.string('kind', { length: 16 }).notNull().defaultTo('standard');
      c.integer('version').notNull().defaultTo(1);
      c.string('briefForDocumentId', { length: 64 }).nullable();
      c.integer('revisionDueDays').nullable();
    });
    await builder.createCollection('contentRevisions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('documentId', { length: 64 }).nullable();
      // documentChanged | lowQuality
      c.string('reason', { length: 16 }).notNull();
      // lesson | question | practiceScenario
      c.string('targetType', { length: 32 }).notNull();
      c.string('targetId', { length: 64 }).notNull();
      // The course a lesson belongs to, so a course's suggestions are handled together.
      c.string('courseId', { length: 64 }).nullable();
      // Whose content it is: the course, question or scenario owner.
      c.string('ownerUserId', { length: 64 }).notNull();
      c.string('sectionTitle').nullable();
      c.json('currentSnapshot').notNull();
      c.json('proposed').notNull();
      // What the reviewer wrote when accepting with changes.
      c.json('accepted').nullable();
      c.text('explanation').notNull();
      // open | accepted | rejected | applied | stale
      c.string('status', { length: 16 }).notNull().defaultTo('open');
      c.string('reviewedBy', { length: 64 }).nullable();
      c.datetime('reviewedAt').nullable();
      c.string('rejectReason', { length: 1000 }).nullable();
      c.string('source', { length: 16 }).notNull().defaultTo('ai');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('documentId', { name: 'content_revisions_document_index' });
      c.index(['targetType', 'targetId'], {
        name: 'content_revisions_target_index',
      });
      c.index('status', { name: 'content_revisions_status_index' });
    });
    await builder.createCollection('documentConflicts', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('documentId', { length: 64 }).notNull();
      c.string('sectionTitle').notNull();
      c.string('otherDocumentId', { length: 64 }).notNull();
      c.string('otherSectionTitle').notNull();
      c.text('description').notNull();
      c.text('excerpt').nullable();
      c.text('otherExcerpt').nullable();
      // open | resolved | ignored
      c.string('status', { length: 16 }).notNull().defaultTo('open');
      c.string('handledBy', { length: 64 }).nullable();
      c.datetime('handledAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(
        ['documentId', 'sectionTitle', 'otherDocumentId', 'otherSectionTitle'],
        { name: 'document_conflicts_pair_unique' },
      );
      c.index('status', { name: 'document_conflicts_status_index' });
    });
    await builder.alterCollection('exams', (c) => {
      // { shuffleOptions, disableCopy, maxBlurCount, blurAction: flag | submit, singleDevice }
      c.json('antiCheat').nullable();
      c.boolean('aiGrading').notNull().defaultTo(true);
    });
    await builder.alterCollection('examAttempts', (c) => {
      c.integer('blurCount').notNull().defaultTo(0);
      // [{ type: blur | multiDevice | pasteAttempt, at, detail }]
      c.json('integrityFlags').nullable();
      // When an instructor judged the flags: valid, or voided with a reason.
      c.string('integrityReview', { length: 16 }).nullable();
      c.string('deviceToken', { length: 64 }).nullable();
      c.string('voidReason', { length: 1000 }).nullable();
      // [{ competencyId, lost, total }]
      c.json('lossByCompetency').nullable();
    });
    await builder.alterCollection('certifications', (c) => {
      // internal | external
      c.string('kind', { length: 16 }).notNull().defaultTo('internal');
      c.string('issuingAuthority').nullable();
    });
    await builder.alterCollection('employeeCertificates', (c) => {
      c.string('externalNo', { length: 128 }).nullable();
      c.string('attachmentFileId', { length: 64 }).nullable();
      // pending | verified | rejected (external certificates only)
      c.string('verifyStatus', { length: 16 }).nullable();
      c.string('verifiedBy', { length: 64 }).nullable();
      c.datetime('verifiedAt').nullable();
      c.string('verifyNote', { length: 1000 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('employeeCertificates', (c) => {
      c.dropFields(
        'externalNo',
        'attachmentFileId',
        'verifyStatus',
        'verifiedBy',
        'verifiedAt',
        'verifyNote',
      );
    });
    await builder.alterCollection('certifications', (c) => {
      c.dropFields('kind', 'issuingAuthority');
    });
    await builder.alterCollection('examAttempts', (c) => {
      c.dropFields(
        'blurCount',
        'integrityFlags',
        'integrityReview',
        'deviceToken',
        'voidReason',
        'lossByCompetency',
      );
    });
    await builder.alterCollection('exams', (c) => {
      c.dropFields('antiCheat', 'aiGrading');
    });
    await builder.dropCollection('documentConflicts');
    await builder.dropCollection('contentRevisions');
    await builder.alterCollection('courses', (c) => {
      c.dropFields('kind', 'version', 'briefForDocumentId', 'revisionDueDays');
    });
    await builder.alterCollection('kbDocuments', (c) => {
      c.dropIndex('kb_documents_doc_no_index');
      c.dropFields(
        'docNo',
        'version',
        'previousVersionId',
        'supersededById',
        'effectiveDate',
        'changeSummary',
        'changeNote',
        'lastReviewedAt',
      );
    });
  },
});

export default migration;

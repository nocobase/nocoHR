import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Exams and certification (V1 step 3): the question bank, exams with fixed
 * papers or random rules, attempts, certification programmes with their course
 * and exam requirements, and the certificates issued to employees.
 * Assignments gain `examId`, so an assignment points at exactly one course or
 * one exam.
 *
 * The question field table in the specification is empty; its columns are
 * inferred from the grading rules and the content writer's tool input. Answers
 * live only on the server: attempts store a paper snapshot without them.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609280002_create_exams_certifications',
  async up({ builder }) {
    await builder.createCollection('questions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // single | multiple | judge | blank | short
      c.string('type', { length: 16 }).notNull();
      c.text('stem').notNull();
      // [{ key, text }] for single and multiple choice.
      c.json('options').nullable();
      // single: "A"; multiple: ["A","C"]; judge: true | false;
      // blank: [["accepted", "alternatives"], ...] one entry per blank; short: reference answer text.
      c.json('answer').notNull();
      c.text('explanation').nullable();
      // What a grader looks for in a short answer.
      c.text('gradingNotes').nullable();
      // easy | medium | hard
      c.string('difficulty', { length: 16 }).notNull().defaultTo('medium');
      c.string('sourceDocumentId', { length: 64 }).nullable();
      c.text('sourceExcerpt').nullable();
      c.string('ownerUserId', { length: 64 }).notNull();
      // manual | ai | import
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('confirmed');
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('type');
      c.index('ownerUserId');
      c.index('reviewStatus');
    });
    await builder.createCollection('questionCompetencies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('questionId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['questionId', 'competencyId']);
      c.index('competencyId');
    });
    await builder.createCollection('exams', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title').notNull();
      c.text('description').nullable();
      // fixed | random
      c.string('paperMode', { length: 16 }).notNull();
      // [{ competencyId?, questionType, difficulty?, count, scoreEach }]
      c.json('randomRules').nullable();
      c.integer('durationMinutes').notNull().defaultTo(30);
      c.integer('maxAttempts').notNull().defaultTo(3);
      c.integer('passScore').notNull().defaultTo(80);
      // never | afterSubmit | afterPass
      c.string('showAnswersAfter', { length: 16 })
        .notNull()
        .defaultTo('afterPass');
      c.string('ownerUserId', { length: 64 }).notNull();
      c.boolean('published').notNull().defaultTo(false);
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('ownerUserId');
    });
    await builder.createCollection('examQuestions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('examId', { length: 64 }).notNull();
      c.string('questionId', { length: 64 }).notNull();
      c.integer('sortOrder').notNull().defaultTo(0);
      c.integer('score').notNull().defaultTo(10);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['examId', 'questionId']);
    });
    await builder.createCollection('examAttempts', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('examId', { length: 64 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.integer('attemptNo').notNull();
      c.json('paperSnapshot').notNull();
      c.json('answers').nullable();
      c.datetime('startedAt').notNull();
      c.datetime('deadlineAt').notNull();
      c.datetime('submittedAt').nullable();
      c.double('objectiveScore').nullable();
      c.double('subjectiveScore').nullable();
      c.double('score').nullable();
      // inProgress | grading | passed | failed
      c.string('status', { length: 16 }).notNull().defaultTo('inProgress');
      c.string('gradedBy', { length: 64 }).nullable();
      c.json('itemResults').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['examId', 'employeeId', 'attemptNo']);
      c.index('status');
      c.index('employeeId');
    });
    await builder.createCollection('certifications', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code', { length: 64 }).notNull();
      c.string('title').notNull();
      c.text('description').nullable();
      // Null means the certificate never expires.
      c.integer('validityMonths').nullable();
      c.string('competencyId', { length: 64 }).nullable();
      c.integer('competencyLevel').nullable();
      c.string('certificateTemplate').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('code');
    });
    await builder.createCollection('certificationCourses', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('certificationId', { length: 64 }).notNull();
      c.string('courseId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['certificationId', 'courseId']);
    });
    await builder.createCollection('certificationExams', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('certificationId', { length: 64 }).notNull();
      c.string('examId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['certificationId', 'examId']);
    });
    await builder.createCollection('employeeCertificates', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('certificationId', { length: 64 }).notNull();
      c.string('certificateNo', { length: 64 }).notNull();
      c.date('issuedAt').notNull();
      c.date('expiresAt').nullable();
      // valid | revoked (step 4 adds expiring | expired | superseded)
      c.string('status', { length: 16 }).notNull().defaultTo('valid');
      // internal (external certificates arrive in V2)
      c.string('source', { length: 16 }).notNull().defaultTo('internal');
      c.text('revokedReason').nullable();
      // { assignmentIds: [], attemptIds: [] }
      c.json('evidence').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('certificateNo');
      c.index('employeeId');
      c.index('certificationId');
      c.index('status');
    });
    await builder.alterCollection('assignments', (c) => {
      c.string('examId', { length: 64 }).nullable();
      c.index('examId', { name: 'assignments_exam_id_index' });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('assignments', (c) => {
      c.dropIndex('assignments_exam_id_index');
      c.dropField('examId');
    });
    await builder.dropCollection('employeeCertificates');
    await builder.dropCollection('certificationExams');
    await builder.dropCollection('certificationCourses');
    await builder.dropCollection('certifications');
    await builder.dropCollection('examAttempts');
    await builder.dropCollection('examQuestions');
    await builder.dropCollection('exams');
    await builder.dropCollection('questionCompetencies');
    await builder.dropCollection('questions');
  },
});

export default migration;

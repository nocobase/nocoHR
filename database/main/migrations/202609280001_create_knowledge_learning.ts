import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Knowledge and learning (V1 step 2): the knowledge base with its visibility
 * scope and competency tags, courses with lessons, learning assignments,
 * per-lesson learning records, and the knowledge gaps the assistant records.
 *
 * The specification leaves several field tables empty; the columns below are
 * inferred from its page, automation and acceptance sections. Courses and
 * lessons carry `source` and `reviewStatus` because the content writer
 * produces drafts that a person confirms. `assignments.courseId` is nullable
 * because step 3 lets an assignment point at an exam instead.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609280001_create_knowledge_learning',
  async up({ builder }) {
    await builder.createCollection('kbDocuments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title').notNull();
      // policy | sop | manual | other
      c.string('category', { length: 16 }).notNull();
      c.string('fileId', { length: 64 }).notNull();
      // Extracted plain text; `#` headings delimit its sections.
      c.text('contentText').nullable();
      // pending | ready | failed
      c.string('parseStatus', { length: 16 }).notNull().defaultTo('pending');
      c.text('parseError').nullable();
      // all | restricted
      c.string('visibility', { length: 16 }).notNull().defaultTo('all');
      c.string('ownerUserId', { length: 64 }).notNull();
      c.date('reviewDate').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('ownerUserId');
      c.index('parseStatus');
    });
    await builder.createCollection('kbDocumentCompetencies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('documentId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['documentId', 'competencyId']);
      c.index('competencyId');
    });
    await builder.createCollection('kbDocumentDepartments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('documentId', { length: 64 }).notNull();
      c.string('departmentId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['documentId', 'departmentId']);
      c.index('departmentId');
    });
    await builder.createCollection('kbDocumentPositions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('documentId', { length: 64 }).notNull();
      c.string('positionId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['documentId', 'positionId']);
      c.index('positionId');
    });
    await builder.createCollection('courses', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('title').notNull();
      c.text('description').nullable();
      c.string('sourceDocumentId', { length: 64 }).nullable();
      // The responsible instructor.
      c.string('ownerUserId', { length: 64 }).notNull();
      // manual | ai | import
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('draft');
      c.boolean('published').notNull().defaultTo(false);
      c.datetime('publishedAt').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('ownerUserId');
      c.index('sourceDocumentId');
    });
    await builder.createCollection('courseCompetencies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('courseId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['courseId', 'competencyId']);
      c.index('competencyId');
    });
    await builder.createCollection('lessons', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('courseId', { length: 64 }).notNull();
      c.integer('sortOrder').notNull().defaultTo(0);
      c.string('title').notNull();
      // Markdown.
      c.text('content').notNull();
      // Required when the content writer produced the lesson.
      c.text('sourceExcerpt').nullable();
      c.integer('estimatedMinutes').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('courseId');
    });
    await builder.createCollection('assignments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('courseId', { length: 64 }).nullable();
      // Null for assignments the system creates.
      c.string('assignedByUserId', { length: 64 }).nullable();
      c.date('dueDate').nullable();
      // notStarted | inProgress | overdue | completed | cancelled
      c.string('status', { length: 16 }).notNull().defaultTo('notStarted');
      // Percent of the course's lessons completed.
      c.integer('progress').notNull().defaultTo(0);
      // manual | recertification
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      c.datetime('completedAt').nullable();
      c.datetime('cancelledAt').nullable();
      // Reminders are limited to one per assignment in 24 hours.
      c.datetime('lastRemindedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId');
      c.index('courseId');
      c.index('status');
    });
    await builder.createCollection('learningRecords', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('courseId', { length: 64 }).notNull();
      c.string('lessonId', { length: 64 }).notNull();
      c.datetime('startedAt').notNull();
      c.datetime('completedAt').nullable();
      c.integer('durationSeconds').notNull().defaultTo(0);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'lessonId']);
      c.index('courseId');
    });
    await builder.createCollection('knowledgeGaps', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.text('question').notNull();
      c.string('askedByUserId', { length: 64 }).notNull();
      c.integer('askCount').notNull().defaultTo(1);
      c.datetime('lastAskedAt').notNull();
      // open | resolved | ignored
      c.string('status', { length: 16 }).notNull().defaultTo('open');
      c.string('resolvedDocumentId', { length: 64 }).nullable();
      c.string('resolvedByUserId', { length: 64 }).nullable();
      c.datetime('resolvedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('status');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('knowledgeGaps');
    await builder.dropCollection('learningRecords');
    await builder.dropCollection('assignments');
    await builder.dropCollection('lessons');
    await builder.dropCollection('courseCompetencies');
    await builder.dropCollection('courses');
    await builder.dropCollection('kbDocumentPositions');
    await builder.dropCollection('kbDocumentDepartments');
    await builder.dropCollection('kbDocumentCompetencies');
    await builder.dropCollection('kbDocuments');
  },
});

export default migration;

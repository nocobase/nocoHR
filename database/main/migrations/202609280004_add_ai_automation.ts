import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * The revised V1 specification makes every AI employee do proactive work —
 * on a schedule or when a business event happens — with an owner, an on/off
 * switch and a traceable run record. This adds:
 *
 * - `aiAutomationSettings`: one row per automation, overriding the defaults in
 *   code (switch, owner, run time, parameters); administrators edit it.
 * - `aiTaskRuns`: one row per run — trigger, owner, input summary, output,
 *   the conversation it used, error — deduplicated by `dedupeKey` per task.
 * - `aiTaskRunItems`: each draft a run produced and what a person did with it
 *   (adopted as written, modified before confirming, or discarded), for the
 *   adoption rate.
 *
 * It also adds the fields the proactive work needs on existing tables, the
 * one-question-per-row knowledge gap fields, and the demonstration batch
 * sign-off table. The specification wants that table only when the demo seed
 * runs, but seeds never create structure, so it always exists and stays empty
 * outside a demo.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609280004_add_ai_automation',
  async up({ builder }) {
    await builder.createCollection('aiAutomationSettings', (c) => {
      // The automation key, such as `frameworkAdvisor.draftNewPositions`.
      c.string('id', { length: 96 }).notNull();
      c.primary('id');
      c.boolean('enabled').notNull().defaultTo(true);
      c.string('ownerUserId', { length: 64 }).nullable();
      // Scheduled work: hour of day (0–23); weekday 1–7 (Monday = 1) for weekly work; day of month for monthly work.
      c.integer('hour').nullable();
      c.integer('weekday').nullable();
      c.integer('monthDay').nullable();
      // Task-specific parameters, such as a lag threshold.
      c.json('params').nullable();
      c.string('updatedByUserId', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('aiTaskRuns', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('task', { length: 96 }).notNull();
      // The AI employee username.
      c.string('employee', { length: 64 }).notNull();
      // schedule | event | manual
      c.string('trigger', { length: 16 }).notNull();
      // What caused the run, such as { documentId } or { period }.
      c.json('triggerRef').nullable();
      // Repeating a trigger with the same key never runs the task twice.
      c.string('dedupeKey', { length: 191 }).nullable();
      c.string('ownerUserId', { length: 64 }).nullable();
      // running | succeeded | skipped | failed
      c.string('status', { length: 16 }).notNull();
      c.text('inputSummary').nullable();
      // What the run produced: counts, created record ids, recipients.
      c.json('output').nullable();
      // The passages or records the output relies on.
      c.json('references').nullable();
      // true when the AI was unavailable and the rule-based fallback produced the output.
      c.boolean('fallback').notNull().defaultTo(false);
      c.string('conversationSessionId', { length: 64 }).nullable();
      c.text('error').nullable();
      c.datetime('startedAt').notNull();
      c.datetime('finishedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['task', 'dedupeKey'], {
        name: 'ai_task_runs_task_dedupe_unique',
      });
      c.index('task');
      c.index('status');
      c.index('startedAt');
    });
    await builder.createCollection('aiTaskRunItems', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('runId', { length: 64 }).notNull();
      // course | question | competency | positionRequirement
      c.string('entityType', { length: 32 }).notNull();
      c.string('entityId', { length: 64 }).notNull();
      // A hash of the content as the AI wrote it, to tell "adopted" from "modified".
      c.string('snapshotHash', { length: 64 }).nullable();
      // pending | adopted | modified | discarded
      c.string('outcome', { length: 16 }).notNull().defaultTo('pending');
      c.string('outcomeByUserId', { length: 64 }).nullable();
      c.datetime('outcomeAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['entityType', 'entityId'], {
        name: 'ai_task_run_items_entity_unique',
      });
      c.index('runId');
    });

    // 体系顾问: each position is drafted automatically once.
    await builder.alterCollection('positions', (c) => {
      c.datetime('aiDraftedAt').nullable();
    });
    // 内容编写员: whether a document gets a course draft once its text is extracted.
    await builder.alterCollection('kbDocuments', (c) => {
      c.boolean('autoDraftCourse').notNull().defaultTo(true);
    });
    // 知识助手: one row per question asked; the weekly report groups them into topics.
    await builder.alterCollection('knowledgeGaps', (c) => {
      c.datetime('askedAt').nullable();
      c.string('relatedDocumentId', { length: 64 }).nullable();
      c.string('topic').nullable();
      c.datetime('reportedAt').nullable();
      c.index('reportedAt', { name: 'knowledge_gaps_reported_at_index' });
    });
    // 内容编写员: questions written from a course, and the default points a question carries into a paper.
    await builder.alterCollection('questions', (c) => {
      c.string('sourceCourseId', { length: 64 }).nullable();
      c.integer('score').notNull().defaultTo(10);
      c.index('sourceCourseId', { name: 'questions_source_course_id_index' });
    });
    // 认证管家: days before expiry at which a renewal not yet started is escalated; 0 turns it off.
    await builder.alterCollection('certifications', (c) => {
      c.integer('escalateDays').notNull().defaultTo(7);
    });
    await builder.alterCollection('assignments', (c) => {
      c.datetime('escalatedAt').nullable();
    });

    // 批生产记录（演示）: who signed a batch step, when, and on which certificate.
    await builder.createCollection('demoBatchSignoffs', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('batchNo', { length: 32 }).notNull();
      c.string('step', { length: 32 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('userId', { length: 64 }).nullable();
      c.datetime('signedAt').notNull();
      // The certificate the signer held when signing, as it was then.
      c.string('certificateId', { length: 64 }).nullable();
      c.string('certificateNo', { length: 64 }).nullable();
      c.string('certificateStatus', { length: 16 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['batchNo', 'step'], {
        name: 'demo_batch_signoffs_batch_step_index',
      });
      c.index('employeeId', { name: 'demo_batch_signoffs_employee_index' });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('demoBatchSignoffs');
    await builder.alterCollection('assignments', (c) => {
      c.dropField('escalatedAt');
    });
    await builder.alterCollection('certifications', (c) => {
      c.dropField('escalateDays');
    });
    await builder.alterCollection('questions', (c) => {
      c.dropIndex('questions_source_course_id_index');
      c.dropFields('sourceCourseId', 'score');
    });
    await builder.alterCollection('knowledgeGaps', (c) => {
      c.dropIndex('knowledge_gaps_reported_at_index');
      c.dropFields('askedAt', 'relatedDocumentId', 'topic', 'reportedAt');
    });
    await builder.alterCollection('kbDocuments', (c) => {
      c.dropField('autoDraftCourse');
    });
    await builder.alterCollection('positions', (c) => {
      c.dropField('aiDraftedAt');
    });
    await builder.dropCollection('aiTaskRunItems');
    await builder.dropCollection('aiTaskRuns');
    await builder.dropCollection('aiAutomationSettings');
  },
});

export default migration;

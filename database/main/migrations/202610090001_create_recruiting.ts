import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-07 用工计划与招聘入职: the eight tables of 总纲 step 7.
 *
 * - `workforcePlans`: one per (department, position, month); a repeated ERP
 *   push updates it and recalculates. `calculation` and `options` are the
 *   server's numbers; `aiSummary` and each option's note are the HR
 *   assistant's words. `calculationHash` makes the same push a no-op.
 * - `jobRequisitions`: 招聘需求 with the hiring department's checklist and
 *   its approval snapshot; `hiredCount` is summed on each onboarding.
 * - `jobPostings`: the public posting, its requirements (each with a stable
 *   key), knockout questions, open interview slots and the self-booking
 *   reminder template the recruiter confirmed; the optional AI initial
 *   interview (`aiInterviewEnabled`, `aiInterviewPlan`).
 * - `candidates`: one person, deduplicated by mobile or email; contact data,
 *   the resume file and the parsed profile are sensitive. `customFields`
 *   holds fields administrators add (总纲 可定制约定).
 * - `applications`: one per (candidate, posting); the screening suggestion,
 *   the recruiter's decision, the stage history and the candidate messages
 *   drafted for the recruiter to send (`messages`).
 * - `interviews`: rounds with the question plan, each interviewer's
 *   scorecard, the assistant's summary, and the AI initial interview's
 *   consent, transcript and report.
 * - `offers`: salary (sensitive), approvals, the letter, the response link
 *   (only its hash is stored) and 待入职跟进 (`preboarding`).
 * - `newHireCheckIns`: one per (employee, day); the reply's summary by topic
 *   and the issues routed to their owners.
 *
 * `down` drops the tables in reverse dependency order.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610090001_create_recruiting',
  async up({ builder }) {
    await builder.createCollection('workforcePlans', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('departmentId', { length: 64 }).notNull();
      c.foreignKey('departmentId', {
        references: { collection: 'departments', fields: ['id'] },
      });
      c.string('positionId', { length: 64 }).notNull();
      c.foreignKey('positionId', {
        references: { collection: 'positions', fields: ['id'] },
      });
      c.string('month', { length: 7 }).notNull();
      c.decimal('plannedOutput', { precision: 14, scale: 2 }).notNull();
      c.decimal('currentOutput', { precision: 14, scale: 2 }).nullable();
      // api | import | manual
      c.string('source', { length: 16 }).notNull();
      c.json('calculation').notNull();
      // Hash of the inputs and parameters: an identical push changes nothing.
      c.string('calculationHash', { length: 64 }).notNull();
      c.json('options').nullable();
      c.text('aiSummary').nullable();
      // The calculation the summary was written for.
      c.string('aiSummaryHash', { length: 64 }).nullable();
      c.json('decision').nullable();
      c.string('requisitionId', { length: 64 }).nullable();
      // calculated | decided | noGap | cancelled
      c.string('status', { length: 16 }).notNull();
      c.string('pushedBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['departmentId', 'positionId', 'month']);
      c.index(['status']);
    });
    await builder.createCollection('jobRequisitions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('departmentId', { length: 64 }).notNull();
      c.foreignKey('departmentId', {
        references: { collection: 'departments', fields: ['id'] },
      });
      c.string('positionId', { length: 64 }).notNull();
      c.foreignKey('positionId', {
        references: { collection: 'positions', fields: ['id'] },
      });
      c.integer('headcount').notNull();
      // newHeadcount | replacement
      c.string('reason', { length: 16 }).notNull();
      c.string('workforcePlanId', { length: 64 }).nullable();
      c.string('replacingEmployeeId', { length: 64 }).nullable();
      c.date('targetDate').notNull();
      c.json('requirementsChecklist').nullable();
      c.text('note').nullable();
      c.string('requesterUserId', { length: 64 }).notNull();
      c.string('hiringManagerUserId', { length: 64 }).notNull();
      c.string('recruiterUserId', { length: 64 }).nullable();
      // draft | pending | approved | open | filled | cancelled
      c.string('status', { length: 16 }).notNull();
      c.json('approvals').nullable();
      c.integer('hiredCount').notNull().defaultTo(0);
      // The pool reuse suggestion made when the requisition opened.
      c.json('poolSuggestion').nullable();
      c.datetime('openedAt').nullable();
      c.datetime('filledAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['departmentId']);
      c.index(['status']);
      c.index(['recruiterUserId']);
    });
    await builder.createCollection('jobPostings', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('requisitionId', { length: 64 }).notNull();
      c.foreignKey('requisitionId', {
        references: { collection: 'jobRequisitions', fields: ['id'] },
      });
      c.string('title', { length: 200 }).notNull();
      c.text('description').notNull();
      c.json('requirements').notNull();
      c.string('location', { length: 200 }).notNull();
      c.string('publicSlug', { length: 64 }).nullable();
      c.json('channels').nullable();
      // draft | published | closed
      c.string('status', { length: 16 }).notNull();
      // manual | ai
      c.string('source', { length: 16 }).notNull();
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull();
      c.json('knockoutQuestions').nullable();
      c.json('interviewSlots').nullable();
      c.boolean('selfBookingEnabled').notNull().defaultTo(false);
      // {subject, body, confirmedBy, confirmedAt}: the self-booking confirmation and reminder the recruiter confirmed.
      c.json('bookingTemplate').nullable();
      c.boolean('aiInterviewEnabled').notNull().defaultTo(false);
      c.json('aiInterviewPlan').nullable();
      c.string('confirmedBy', { length: 64 }).nullable();
      c.datetime('confirmedAt').nullable();
      c.datetime('publishedAt').nullable();
      c.datetime('closedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['publicSlug']);
      c.index(['requisitionId']);
      c.index(['status']);
    });
    await builder.createCollection('candidates', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('name', { length: 200 }).notNull();
      // Sensitive; the deduplication keys.
      c.string('phone', { length: 32 }).nullable();
      c.string('email', { length: 320 }).nullable();
      // Sensitive: the original resume.
      c.string('resumeFileId', { length: 64 }).nullable();
      c.json('parsedProfile').nullable();
      c.json('parseConfidence').nullable();
      // pending | parsed | manual (image-only, filled in by hand) | failed | none
      c.string('parseStatus', { length: 16 }).notNull().defaultTo('none');
      c.string('sourceChannel', { length: 100 }).notNull();
      c.datetime('consentAt').notNull();
      // page (ticked on the careers page) | recruiter (confirmed by the recruiter on import)
      c.string('consentBy', { length: 16 }).notNull();
      c.date('retentionUntil').notNull();
      c.datetime('lastActivityAt').notNull();
      c.datetime('anonymizedAt').nullable();
      c.string('anonymizedBy', { length: 64 }).nullable();
      c.json('customFields').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['phone']);
      c.index(['email']);
      c.index(['retentionUntil']);
    });
    await builder.createCollection('applications', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('candidateId', { length: 64 }).notNull();
      c.foreignKey('candidateId', {
        references: { collection: 'candidates', fields: ['id'] },
      });
      c.string('postingId', { length: 64 }).notNull();
      c.foreignKey('postingId', {
        references: { collection: 'jobPostings', fields: ['id'] },
      });
      // applied | screening | interview | offer | hired | rejected | withdrawn
      c.string('stage', { length: 16 }).notNull();
      c.string('sourceChannel', { length: 100 }).notNull();
      c.json('screeningSuggestion').nullable();
      c.datetime('screenedAt').nullable();
      c.json('knockoutAnswers').nullable();
      // advance | hold | reject
      c.string('screeningDecision', { length: 16 }).nullable();
      c.string('decidedBy', { length: 64 }).nullable();
      c.datetime('decidedAt').nullable();
      c.json('rejectRequirementKeys').nullable();
      c.string('rejectNote', { length: 1000 }).nullable();
      c.json('stageHistory').notNull();
      c.datetime('stageSince').notNull();
      // Candidate messages drafted by the assistant or the recruiter; sent only on the recruiter's confirmation.
      c.json('messages').nullable();
      c.integer('submitCount').notNull().defaultTo(1);
      c.datetime('lastSubmittedAt').notNull();
      // Only the hash of the booking link's token; the link reschedules or cancels once.
      c.string('bookingTokenHash', { length: 64 }).nullable();
      c.boolean('aiInterviewDeclined').notNull().defaultTo(false);
      c.string('aiInterviewTokenHash', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['candidateId', 'postingId']);
      c.index(['postingId']);
      c.index(['stage']);
    });
    await builder.createCollection('interviews', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('applicationId', { length: 64 }).notNull();
      c.foreignKey('applicationId', {
        references: { collection: 'applications', fields: ['id'] },
      });
      c.integer('round').notNull();
      // onsite | video | phone | ai
      c.string('mode', { length: 16 }).notNull();
      c.datetime('scheduledAt').notNull();
      c.integer('durationMinutes').notNull().defaultTo(60);
      c.string('locationOrLink', { length: 500 }).nullable();
      c.json('interviewerUserIds').notNull();
      c.json('questionPlan').nullable();
      c.datetime('questionPlanAt').nullable();
      c.json('scorecards').nullable();
      c.json('aiSummary').nullable();
      c.datetime('summaryAt').nullable();
      // scheduled | completed | cancelled | noShow
      c.string('status', { length: 16 }).notNull();
      // The self-booked slot (its start), or null when scheduled by the recruiter.
      c.string('slotKey', { length: 64 }).nullable();
      c.boolean('selfBooked').notNull().defaultTo(false);
      c.integer('changesUsed').notNull().defaultTo(0);
      c.datetime('reminderSentAt').nullable();
      c.string('scheduledBy', { length: 64 }).nullable();
      c.datetime('consentAt').nullable();
      c.json('transcript').nullable();
      c.json('aiReport').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['applicationId']);
      c.index(['scheduledAt']);
      c.index(['status']);
    });
    await builder.createCollection('offers', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('applicationId', { length: 64 }).notNull();
      c.foreignKey('applicationId', {
        references: { collection: 'applications', fields: ['id'] },
      });
      c.string('positionId', { length: 64 }).notNull();
      c.string('departmentId', { length: 64 }).notNull();
      // Sensitive: {baseSalary, allowances: [{code, amount}], salaryStructureId}.
      c.json('salaryOffer').notNull();
      c.text('outOfRangeReason').nullable();
      c.date('startDate').notNull();
      c.integer('probationMonths').notNull();
      // draft | pendingApproval | approved | sent | accepted | declined | expired | withdrawn
      c.string('status', { length: 16 }).notNull();
      c.json('approvals').nullable();
      c.string('offerLetterFileId', { length: 64 }).nullable();
      c.datetime('sentAt').nullable();
      c.datetime('respondBy').nullable();
      c.datetime('respondedAt').nullable();
      // link | recorded
      c.string('responseChannel', { length: 16 }).nullable();
      c.string('declineReason', { length: 500 }).nullable();
      // The candidate's link: looked up by its hash; the token itself is kept (never returned by any
      // endpoint) so the 待入职 reminders can carry the same link. Cleared when the link stops working.
      c.string('tokenHash', { length: 64 }).nullable();
      c.string('linkToken', { length: 64 }).nullable();
      c.string('onboardActionId', { length: 64 }).nullable();
      c.json('preboarding').nullable();
      c.string('createdBy', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['applicationId']);
      c.index(['status']);
      c.unique(['tokenHash']);
      c.index(['onboardActionId']);
    });
    await builder.createCollection('newHireCheckIns', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.foreignKey('employeeId', {
        references: { collection: 'employees', fields: ['id'] },
      });
      c.integer('day').notNull();
      // feishu | app
      c.string('channel', { length: 16 }).notNull();
      c.datetime('askedAt').nullable();
      c.datetime('repliedAt').nullable();
      c.json('answers').nullable();
      c.json('issues').nullable();
      // pending | asked | replied | noReply | faceToFace (no account or no binding: the head is asked instead)
      c.string('status', { length: 16 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['employeeId', 'day']);
      c.index(['status']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('newHireCheckIns');
    await builder.dropCollection('offers');
    await builder.dropCollection('interviews');
    await builder.dropCollection('applications');
    await builder.dropCollection('candidates');
    await builder.dropCollection('jobPostings');
    await builder.dropCollection('jobRequisitions');
    await builder.dropCollection('workforcePlans');
  },
});

export default migration;

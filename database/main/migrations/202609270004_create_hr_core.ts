import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Core HR: the complete employee profile (identity, education, experience,
 * emergency contacts, attachments), employment contracts, personnel actions
 * with their approval record, the job event history and self-service
 * profile change requests. `hrFiles` is the file collection the file plugin
 * owns the columns of; `employeeAttachments` links files to employees.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609270004_create_hr_core',
  async up({ builder }) {
    await builder.alterCollection('employees', (c) => {
      // male | female | other
      c.string('gender', { length: 16 }).nullable();
      // Sensitive.
      c.date('birthDate').nullable();
      // idCard | passport | other
      c.string('idType', { length: 16 }).nullable();
      // Sensitive; masked in lists and exports.
      c.string('idNumber', { length: 64 }).nullable();
      // fullTime | partTime | intern | outsourced
      c.string('employmentType', { length: 16 })
        .notNull()
        .defaultTo('fullTime');
      c.string('workLocation').nullable();
      c.date('probationEndDate').nullable();
      c.date('regularizedAt').nullable();
      c.date('leaveDate').nullable();
      // resign | dismiss | contractEnd | other
      c.string('leaveReason', { length: 16 }).nullable();
      // Sensitive.
      c.string('address').nullable();
    });
    await builder.createCollection('employeeEducations', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('school').notNull();
      // highSchool | associate | bachelor | master | doctor | other
      c.string('degree', { length: 16 }).notNull();
      c.string('major').nullable();
      c.date('startDate').nullable();
      c.date('endDate').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId');
    });
    await builder.createCollection('employeeExperiences', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('company').notNull();
      c.string('title').nullable();
      c.date('startDate').nullable();
      c.date('endDate').nullable();
      c.text('description').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId');
    });
    await builder.createCollection('employeeEmergencyContacts', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('name').notNull();
      c.string('relation', { length: 64 }).nullable();
      // Sensitive.
      c.string('phone', { length: 32 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId');
    });
    // The file plugin's fixed column set; uploads supply every value.
    await builder.createCollection('hrFiles', (c) => {
      c.uuid('id').primary().notNull();
      c.string('disk', { length: 255 }).notNull();
      c.text('key').notNull();
      c.text('filename').notNull();
      c.string('ext', { length: 32 }).notNull();
      c.string('mimeType', { length: 255 }).notNull();
      c.bigInt('size').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
    });
    await builder.createCollection('employeeAttachments', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('fileId', { length: 64 }).notNull();
      // diploma | idCard | contract | other
      c.string('category', { length: 32 }).notNull().defaultTo('other');
      c.string('title').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId');
      c.index('fileId');
    });
    await builder.createCollection('employmentContracts', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('contractNo', { length: 64 }).notNull();
      // fixedTerm | openEnded | internship | labor
      c.string('type', { length: 16 }).notNull();
      c.date('startDate').notNull();
      c.date('endDate').nullable();
      c.date('signedAt').nullable();
      // active | expired | renewed | terminated
      c.string('status', { length: 16 }).notNull().defaultTo('active');
      c.string('previousContractId', { length: 64 }).nullable();
      c.string('fileId', { length: 64 }).nullable();
      c.text('note').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('contractNo');
      c.index('employeeId');
      c.index('status');
      c.index('endDate');
    });
    await builder.createCollection('personnelActions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // onboard | regularize | transfer | promote | offboard
      c.string('actionType', { length: 16 }).notNull();
      c.string('employeeId', { length: 64 }).nullable();
      // The person an onboarding action creates when it takes effect.
      c.json('candidate').nullable();
      c.string('toDepartmentId', { length: 64 }).nullable();
      c.string('toPositionId', { length: 64 }).nullable();
      c.date('effectiveDate').notNull();
      c.text('reason').nullable();
      c.string('leaveReason', { length: 16 }).nullable();
      // draft | pending | approved | effective | rejected | cancelled
      c.string('status', { length: 16 }).notNull().defaultTo('pending');
      c.string('applicantUserId', { length: 64 }).notNull();
      // The approval chain: each level's approver, result, comment and time.
      c.json('approvals').nullable();
      c.datetime('effectiveAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('employeeId');
      c.index('status');
      c.index('applicantUserId');
      c.index('toDepartmentId');
    });
    await builder.createCollection('jobEvents', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('eventType', { length: 16 }).notNull();
      c.string('fromDepartmentId', { length: 64 }).nullable();
      c.string('toDepartmentId', { length: 64 }).nullable();
      c.string('fromPositionId', { length: 64 }).nullable();
      c.string('toPositionId', { length: 64 }).nullable();
      c.date('effectiveDate').notNull();
      c.string('actionId', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'effectiveDate']);
    });
    await builder.createCollection('profileChangeRequests', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      // field -> new value, whitelisted fields only.
      c.json('changes').notNull();
      // pending | approved | rejected
      c.string('status', { length: 16 }).notNull().defaultTo('pending');
      c.string('reviewerUserId', { length: 64 }).nullable();
      c.datetime('reviewedAt').nullable();
      c.string('comment').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index(['employeeId', 'status']);
    });
    // One row per reminder actually sent, so a rerun of the daily task never
    // sends the same reminder to the same person twice.
    await builder.createCollection('hrReminderLog', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('reminderKey').notNull();
      c.datetime('sentAt').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('reminderKey');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hrReminderLog');
    await builder.dropCollection('profileChangeRequests');
    await builder.dropCollection('jobEvents');
    await builder.dropCollection('personnelActions');
    await builder.dropCollection('employmentContracts');
    await builder.dropCollection('employeeAttachments');
    await builder.dropCollection('hrFiles');
    await builder.dropCollection('employeeEmergencyContacts');
    await builder.dropCollection('employeeExperiences');
    await builder.dropCollection('employeeEducations');
    await builder.alterCollection('employees', (c) => {
      c.dropFields(
        'gender',
        'birthDate',
        'idType',
        'idNumber',
        'employmentType',
        'workLocation',
        'probationEndDate',
        'regularizedAt',
        'leaveDate',
        'leaveReason',
        'address',
      );
    });
  },
});

export default migration;

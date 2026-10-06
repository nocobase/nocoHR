import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1-02 V2 增补 · 已离职员工的邮件往来 (人事邮箱):
 *
 * - `employees.personalEmail`: where a departed employee is reached once their
 *   office account is off. Sensitive: only HR administrators and the person.
 * - `personnelActions.personalEmail`: entered on the 离职单; written to the
 *   employee when the action takes effect.
 * - `documentShares`: a document handed to someone outside by a link — a
 *   separation certificate, the last payslip, an income or employment
 *   certificate. The link is stored as a hash with its expiry and revocation;
 *   it opens only with a one-time code sent to `recipientAddress` (hash,
 *   expiry, failed attempts); each download is recorded.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610190002_departed_employee_mail',
  async up({ builder }) {
    await builder.alterCollection('employees', (c) => {
      c.string('personalEmail', { length: 320 }).nullable();
    });
    await builder.alterCollection('personnelActions', (c) => {
      c.string('personalEmail', { length: 320 }).nullable();
    });
    await builder.createCollection('documentShares', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      // separationCertificate | payslip | incomeCertificate | employmentCertificate
      c.string('kind', { length: 32 }).notNull();
      c.string('employeeId', { length: 64 }).notNull();
      c.string('fileId', { length: 64 }).notNull();
      c.string('fileName', { length: 255 }).notNull();
      c.string('recipientAddress', { length: 320 }).notNull();
      c.string('tokenHash', { length: 128 }).notNull();
      c.datetime('expiresAt').notNull();
      c.datetime('revokedAt').nullable();
      c.string('codeHash', { length: 128 }).nullable();
      c.datetime('codeExpiresAt').nullable();
      c.integer('codeAttempts').notNull().defaultTo(0);
      c.datetime('codeSentAt').nullable();
      c.json('downloads').nullable();
      c.string('createdBy', { length: 64 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['tokenHash']);
      c.index(['employeeId', 'kind']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('documentShares');
    await builder.alterCollection('personnelActions', (c) => {
      c.dropFields('personalEmail');
    });
    await builder.alterCollection('employees', (c) => {
      c.dropFields('personalEmail');
    });
  },
});

export default migration;

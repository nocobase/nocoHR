import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * The certification lifecycle (V1 step 4) adds fields only: expiry and
 * recertification settings on certifications, the replacement link on
 * certificates, and the links a recertification task needs. A recertification
 * assignment names the certificate it renews, and an attempt made for it names
 * that assignment, so recertification keeps its own attempt count.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609280003_extend_certification_lifecycle',
  async up({ builder }) {
    await builder.alterCollection('certifications', (c) => {
      c.integer('expiringNoticeDays').notNull().defaultTo(30);
      // 0 means never assign recertification automatically.
      c.integer('recertAdvanceDays').notNull().defaultTo(60);
      // examOnly | full
      c.string('recertMode', { length: 16 }).notNull().defaultTo('examOnly');
    });
    await builder.alterCollection('employeeCertificates', (c) => {
      c.string('supersededById', { length: 64 }).nullable();
    });
    await builder.alterCollection('assignments', (c) => {
      c.string('certificateId', { length: 64 }).nullable();
      c.index('certificateId', { name: 'assignments_certificate_id_index' });
    });
    await builder.alterCollection('examAttempts', (c) => {
      c.string('assignmentId', { length: 64 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('examAttempts', (c) => {
      c.dropField('assignmentId');
    });
    await builder.alterCollection('assignments', (c) => {
      c.dropIndex('assignments_certificate_id_index');
      c.dropField('certificateId');
    });
    await builder.alterCollection('employeeCertificates', (c) => {
      c.dropField('supersededById');
    });
    await builder.alterCollection('certifications', (c) => {
      c.dropFields('expiringNoticeDays', 'recertAdvanceDays', 'recertMode');
    });
  },
});

export default migration;

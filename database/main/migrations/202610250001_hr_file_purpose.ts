import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Who uploaded an `hrFiles` row through `hrFiles:uploadOne`, and for what:
 * `purpose` is courseVideo | profileAttachment | contract | kbDocument |
 * jobDescription, `uploadedByUserId` the uploader. Both are stamped by the
 * upload route; a record (a lesson video, an employee attachment, a contract
 * scan, a knowledge document, a job description) accepts only a file its
 * editor uploaded for it. Files stored by the application itself (mail,
 * payroll, recruiting, practical photos) and rows from before this migration
 * leave both empty.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610250001_hr_file_purpose',
  async up({ builder }) {
    await builder.alterCollection('hrFiles', (c) => {
      c.string('purpose', { length: 32 }).nullable();
      c.string('uploadedByUserId', { length: 255 }).nullable();
      c.index(['uploadedByUserId', 'purpose'], {
        name: 'hr_files_uploader_purpose_index',
      });
    });
  },
  async down({ builder }) {
    await builder.alterCollection('hrFiles', (c) => {
      c.dropIndex('hr_files_uploader_purpose_index');
    });
    await builder.alterCollection('hrFiles', (c) => {
      c.dropFields('purpose', 'uploadedByUserId');
    });
  },
});

export default migration;

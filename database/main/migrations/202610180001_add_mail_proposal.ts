import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 招聘邮箱 · 改期回信 (V2-07): `businessMailMessages.proposal` (the table was
 * `mailMessages` until 2026-10-05; see 202609020001) holds what a reply draft
 * proposes to do once a person sends it — for a candidate's reschedule
 * request, the interview, the times it could move to and the one chosen. The
 * draft's text names the chosen time; sending it moves the interview. Null
 * for every other message.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610180001_add_mail_proposal',
  async up({ builder }) {
    await builder.alterCollection('businessMailMessages', (c) => {
      c.json('proposal').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('businessMailMessages', (c) => {
      c.dropFields('proposal');
    });
  },
});

export default migration;

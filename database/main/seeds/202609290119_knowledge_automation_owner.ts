import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V1-04: the knowledge assistant's conflict check is owned by hr01, like its
 * weekly gap report. Development and demo only; a configured owner stays.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290119_knowledge_automation_owner',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const hr = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-hr01')
      .executeTakeFirst();
    const owned = await query
      .selectFrom('aiAutomationSettings')
      .select(['id'])
      .where('id', '=', 'knowledgeAssistant.conflictCheck')
      .executeTakeFirst();
    if (!hr?.userId || owned) return;
    const now = new Date();
    await query
      .insertInto('aiAutomationSettings')
      .values({
        id: 'knowledgeAssistant.conflictCheck',
        enabled: true,
        ownerUserId: hr.userId,
        hour: null,
        weekday: null,
        monthDay: null,
        params: null,
        updatedByUserId: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  },
});
export default seed;

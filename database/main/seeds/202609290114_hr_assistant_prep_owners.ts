import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V1-02 · 设置 / AI 员工任务: the HR assistant's attachment recognition,
 * probation and renewal preparation are owned by hr01 (林晓), like the import
 * check. Development and demo only; an automation already configured is left
 * as the administrator set it.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290114_hr_assistant_prep_owners',
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
    if (!hr?.userId) return;
    const now = new Date();
    for (const key of [
      'hrAssistant.extractAttachment',
      'hrAssistant.probationPrep',
      'hrAssistant.renewalPrep',
    ]) {
      const existing = await query
        .selectFrom('aiAutomationSettings')
        .select(['id'])
        .where('id', '=', key)
        .executeTakeFirst();
      if (existing) continue;
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: key,
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
    }
  },
});
export default seed;

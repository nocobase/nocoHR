import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * The synonym groups that the import health check, the directory sync's
 * job-title matching and the monthly position check read are empty by
 * default now: CNC/数控 and 操作工/操作员 belong to a factory. The 启衡精密
 * demo keeps its groups by writing them into each task's settings
 * (`aiAutomationSettings.params.synonyms`), only when the task does not hold
 * a value yet, so groups an administrator saved are never replaced.
 * Development and demo only (`NODE_ENV=production` or `HR_DEMO_SEED=false`
 * skips it).
 */
const DEMO_SYNONYMS: Record<string, string> = {
  'hrAssistant.importCheck': 'CNC/数控; 操作工/操作员; 班组长/组长',
  'hrAssistant.syncExplain': 'CNC/数控机床/数控; 操作工/操作员; 班组长/组长',
  'frameworkAdvisor.dictionaryReview': 'CNC/数控; 操作工/操作员; 班组长/组长',
};

const seed: SeedDefinition = defineSeed({
  name: '202610210132_demo_search_synonyms',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    for (const [id, synonyms] of Object.entries(DEMO_SYNONYMS)) {
      const row = await query
        .selectFrom('aiAutomationSettings')
        .select(['params'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) {
        // No row means "on, no owner, default schedule": keep exactly that.
        await query
          .insertInto('aiAutomationSettings')
          .values({
            id,
            enabled: true,
            ownerUserId: null,
            hour: null,
            weekday: null,
            monthDay: null,
            params: JSON.stringify({ synonyms }),
            updatedByUserId: null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        continue;
      }
      let value: unknown = row.params;
      for (let i = 0; i < 3 && typeof value === 'string'; i++)
        value = JSON.parse(value);
      const stored =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      if (typeof stored.synonyms === 'string') continue;
      await query
        .updateTable('aiAutomationSettings')
        .set({
          params: JSON.stringify({ ...stored, synonyms }),
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
    }
  },
});
export default seed;

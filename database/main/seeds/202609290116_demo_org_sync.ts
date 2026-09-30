import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

import { DEMO_POSITION_ALIASES } from '../../seed-data/org-sync-mock.js';

/**
 * V1-03 测试数据 (development and demo only): 组织同步 set to Feishu with
 * NocoHR as the data master, the confirmed job-title mappings, and hr01 as
 * the owner of the HR assistant's sync explanations. The mock directory
 * itself is written by the application on the first sync. Rows that exist
 * are left as they are.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290116_demo_org_sync',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    const settings = await query
      .selectFrom('personnelSettings')
      .select(['id'])
      .where('id', '=', 'orgSync')
      .executeTakeFirst();
    if (!settings)
      await query
        .insertInto('personnelSettings')
        .values({
          id: 'orgSync',
          value: JSON.stringify({
            provider: 'feishu',
            scopeRootDepartments: [],
            orgMaster: 'nocohr',
            syncDepartmentTree: true,
            fullSyncTime: '02:00',
            syncedProbationMonths: 0,
            masterChangedBy: null,
            masterChangedAt: null,
          }),
          revision: 1,
          updatedBy: 'system',
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    for (const [title, positionId] of DEMO_POSITION_ALIASES) {
      const exists = await query
        .selectFrom('positionAliases')
        .select(['id'])
        .where('provider', '=', 'feishu')
        .where('externalTitle', '=', title)
        .executeTakeFirst();
      const position = await query
        .selectFrom('positions')
        .select(['id'])
        .where('id', '=', positionId)
        .executeTakeFirst();
      if (exists || !position) continue;
      await query
        .insertInto('positionAliases')
        .values({
          id: randomUUID(),
          provider: 'feishu',
          externalTitle: title,
          positionId,
          source: 'manual',
          reviewStatus: 'confirmed',
          draftReason: null,
          confirmedBy: null,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
    const hr = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-hr01')
      .executeTakeFirst();
    const owned = await query
      .selectFrom('aiAutomationSettings')
      .select(['id'])
      .where('id', '=', 'hrAssistant.syncExplain')
      .executeTakeFirst();
    if (hr?.userId && !owned)
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: 'hrAssistant.syncExplain',
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

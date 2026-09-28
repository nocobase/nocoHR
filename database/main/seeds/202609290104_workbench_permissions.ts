import { defineSeed, type SeedDefinition } from '@nocobase/db';
import {
  workbenchResource,
  WORK_ITEM_SCOPE,
} from '../../../server/providers/hr/workbench-resource.js';

/** Append only the new feature; preserve all administrator-edited existing grants. */
const seed: SeedDefinition = defineSeed({
  name: '202609290104_workbench_permissions',
  transaction: true,
  async run({ query }) {
    const additions = [
      {
        resource: { type: 'page', id: 'talent.workbench' },
        actions: [{ action: 'access' }],
      },
      workbenchResource.reference().grant({
        view: { workItems: WORK_ITEM_SCOPE },
        complete: { workItems: WORK_ITEM_SCOPE },
        dismiss: { workItems: WORK_ITEM_SCOPE },
      }),
    ];
    for (const key of ['hr.admin', 'hr.manager', 'hr.employee']) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) throw new Error(`Missing required permission set: ${key}`);
      let decoded = row.grants;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const existing = decoded as { resource: { type: string; id: string } }[];
      const missing = additions.filter(
        (grant) =>
          !existing.some(
            (g) =>
              g.resource.type === grant.resource.type &&
              g.resource.id === grant.resource.id,
          ),
      );
      if (!missing.length) continue;
      await query
        .updateTable('authorizationPermissionSets')
        .set({
          grants: JSON.stringify([...existing, ...missing]),
          updatedAt: new Date(),
        })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

import { defineSeed, type SeedDefinition } from '@nocobase/db';

const seed: SeedDefinition = defineSeed({
  name: '202609290110_approval_page_permission',
  transaction: true,
  async run({ query }) {
    for (const key of ['hr.admin', 'hr.manager']) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) throw new Error(`Missing required permission set: ${key}`);
      let grants: unknown = row.grants;
      for (let i = 0; i < 3 && typeof grants === 'string'; i += 1)
        grants = JSON.parse(grants);
      if (!Array.isArray(grants)) throw new Error('Invalid permission grants');
      const list = grants as {
        resource: { type: string; id: string };
        actions: { action: string }[];
      }[];
      const existing = list.find(
        (item) =>
          item.resource.type === 'page' &&
          item.resource.id === 'talent.approvals',
      );
      if (existing) {
        if (existing.actions.some((action) => action.action === 'access'))
          continue;
        existing.actions.push({ action: 'access' });
      } else
        list.push({
          resource: { type: 'page', id: 'talent.approvals' },
          actions: [{ action: 'access' }],
        });
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(list), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

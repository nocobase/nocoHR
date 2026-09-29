import { defineSeed, type SeedDefinition } from '@nocobase/db';

const seed: SeedDefinition = defineSeed({
  name: '202609290107_leave_page_permission',
  transaction: true,
  async run({ query }) {
    const row = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', '=', 'hr.admin')
      .executeTakeFirst();
    if (!row) throw new Error('Missing required permission set: hr.admin');
    let decoded = row.grants;
    for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
      decoded = JSON.parse(decoded);
    if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
    const grants = decoded as {
      resource: { type: string; id: string };
      actions: { action: string }[];
    }[];
    const existing = grants.find(
      (grant) =>
        grant.resource.type === 'page' && grant.resource.id === 'talent.leave',
    );
    if (existing?.actions.some((action) => action.action === 'access')) return;
    if (existing) existing.actions.push({ action: 'access' });
    else
      grants.push({
        resource: { type: 'page', id: 'talent.leave' },
        actions: [{ action: 'access' }],
      });
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
      .where('id', '=', String(row.id))
      .execute();
  },
});
export default seed;

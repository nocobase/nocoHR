import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { leaveResource } from '../../../server/providers/hr/leave-resources.js';

const seed: SeedDefinition = defineSeed({
  name: '202609290106_leave_management_permissions',
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
    const addition = leaveResource.reference().grant({
      manageTypes: {
        types: 'allRecords',
        balances: 'allRecords',
        requests: 'allRecords',
        configuration: 'allRecords',
      },
      adjustBalance: {
        types: 'allRecords',
        employees: 'allRecords',
        balances: 'allRecords',
        configuration: 'allRecords',
      },
    });
    const existing = grants.find(
      (g) =>
        g.resource.type === addition.resource.type &&
        g.resource.id === addition.resource.id,
    );
    const missing = addition.actions.filter(
      (a) => !existing?.actions.some((e) => e.action === a.action),
    );
    if (!missing.length) return;
    if (existing) existing.actions.push(...missing);
    else grants.push({ resource: addition.resource, actions: missing });
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
      .where('id', '=', String(row.id))
      .execute();
  },
});
export default seed;

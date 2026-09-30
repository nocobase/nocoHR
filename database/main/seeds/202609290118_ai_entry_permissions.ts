import { defineSeed, type SeedDefinition } from '@nocobase/db';
import {
  aiAssistantResource,
  SELF_SCOPE,
} from '../../../server/providers/hr/authz-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

/**
 * V1-04 统一 AI 入口: everyone may use it (what they get still depends on the
 * AI employee it routes to); only HR administrators configure the routing
 * table, knowledge scopes and bots. Only missing actions are appended.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290118_ai_entry_permissions',
  transaction: true,
  async run({ query }) {
    const use = aiAssistantResource
      .reference()
      .grant({ use: { employees: SELF_SCOPE } }) as unknown as Grant;
    const admin = aiAssistantResource.reference().grant({
      use: { employees: SELF_SCOPE },
      configure: { employees: 'allRecords' },
    }) as unknown as Grant;
    const additions: Record<string, Grant[]> = {
      'hr.admin': [admin],
      'hr.manager': [use],
      'hr.employee': [use],
    };
    for (const [key, grants] of Object.entries(additions)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      let decoded = row.grants;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const existing = decoded as Grant[];
      let changed = false;
      for (const grant of grants) {
        const current = existing.find(
          (g) =>
            g.resource.type === grant.resource.type &&
            g.resource.id === grant.resource.id,
        );
        if (!current) {
          existing.push(grant);
          changed = true;
          continue;
        }
        for (const action of grant.actions) {
          if (current.actions.some((a) => a.action === action.action)) continue;
          current.actions.push(action);
          changed = true;
        }
      }
      if (!changed) continue;
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

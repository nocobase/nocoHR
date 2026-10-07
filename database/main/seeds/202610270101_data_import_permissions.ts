import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  contractResource,
  frameworkResource,
} from '../../../server/providers/hr/authz-resources.js';
import { leaveResource } from '../../../server/providers/hr/leave-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';

/**
 * 初始数据导入 (上线准备): HR administrators (hr.admin) may import the
 * department tree (the departments settings item's import), positions
 * (talent.framework import), labour contracts (talent.contract import) and
 * opening leave balances (talent.leaveRequest importBalances). Only what is
 * missing is added, so an administrator's edits stay; without hr.admin
 * nothing is done.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610270101_data_import_permissions',
  transaction: true,
  async run({ query }) {
    const additions: Grant[] = [
      {
        resource: { type: 'settings', id: 'talent.departments' },
        actions: [{ action: 'import' }],
      },
      frameworkResource
        .reference()
        .grant({ import: { jobFamilies: ALL, positions: ALL } }) as Grant,
      contractResource
        .reference()
        .grant({ import: { employmentContracts: ALL } }) as Grant,
      leaveResource.reference().grant({
        importBalances: { types: ALL, employees: ALL, balances: ALL },
      }) as Grant,
    ];
    const row = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', '=', 'hr.admin')
      .executeTakeFirst();
    if (!row) return;
    let decoded: unknown = row.grants;
    for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
      decoded = JSON.parse(decoded);
    if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
    const existing = decoded as Grant[];
    let changed = false;
    for (const grant of additions) {
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
      const missing = grant.actions.filter(
        (action) => !current.actions.some((a) => a.action === action.action),
      );
      if (!missing.length) continue;
      current.actions.push(...missing);
      changed = true;
    }
    if (!changed) return;
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
      .where('id', '=', String(row.id))
      .execute();
  },
});
export default seed;

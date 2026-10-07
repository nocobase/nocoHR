import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { goLiveResource } from '../../../server/providers/hr/go-live/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string; policy?: unknown }[];
}

const ALL = 'allRecords';
const page = (id: string): Grant => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});

/**
 * 上线准备: the settings page (page `talent.goLive`) and its steps.
 *
 * - hr.admin: the page, every step (view, viewPayroll: payroll steps as
 *   counts only) and marking HR steps as not needed (skip).
 * - hr.payroll: the page, the payroll steps (viewPayroll) and marking them as
 *   not needed (skipPayroll).
 *
 * Only missing grants and actions are added, so an administrator's edits
 * stay; a set that does not exist is skipped.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610270121_go_live_permissions',
  transaction: true,
  async run({ query }) {
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        page('talent.goLive'),
        goLiveResource.reference().grant({
          view: { personnelSettings: ALL },
          viewPayroll: { personnelSettings: ALL },
          skip: { personnelSettings: ALL },
        }) as unknown as Grant,
      ],
      'hr.payroll': [
        page('talent.goLive'),
        goLiveResource.reference().grant({
          viewPayroll: { personnelSettings: ALL },
          skipPayroll: { personnelSettings: ALL },
        }) as unknown as Grant,
      ],
    };
    const decode = (value: unknown): Grant[] => {
      let decoded = value;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      return decoded as Grant[];
    };
    for (const [key, grants] of Object.entries(additions)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      const existing = decode(row.grants);
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

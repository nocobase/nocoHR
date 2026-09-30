import { defineSeed, type SeedDefinition } from '@nocobase/db';
import {
  jobEventResource,
  MANAGED_DEPARTMENTS_SCOPE,
  orgSyncResource,
  positionAliasResource,
} from '../../../server/providers/hr/authz-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

/**
 * V1-03 权限配置: HR administrators get 组织同步 and 职务映射 in full, the
 * 岗位变动 page and retrying events; department heads get the 岗位变动 page
 * (events stay scoped to their departments). Existing grants keep every
 * action an administrator configured; only missing actions are appended.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290115_org_sync_permissions',
  transaction: true,
  async run({ query }) {
    const page = (id: string): Grant => ({
      resource: { type: 'page', id },
      actions: [{ action: 'access' }],
    });
    const all = 'allRecords';
    const additions = {
      'hr.admin': [
        page('talent.orgSync'),
        page('talent.jobEvents'),
        orgSyncResource.reference().grant({
          view: { orgSyncRuns: all },
          configure: { orgSyncRuns: all },
          run: { orgSyncRuns: all },
          switchMaster: { orgSyncRuns: all },
          resolveIssues: { orgSyncRuns: all },
        }),
        positionAliasResource.reference().grant({
          view: { positionAliases: all },
          manage: { positionAliases: all },
          confirm: { positionAliases: all },
        }),
        jobEventResource.reference().grant({ retry: { jobEvents: all } }),
      ],
      'hr.manager': [
        page('talent.jobEvents'),
        jobEventResource
          .reference()
          .grant({ view: { jobEvents: MANAGED_DEPARTMENTS_SCOPE } }),
      ],
    } as unknown as Record<string, Grant[]>;
    for (const [key, grants] of Object.entries(additions)) {
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

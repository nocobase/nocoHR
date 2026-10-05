import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { auditRequestResource } from '../../../server/providers/hr/profile/resources.js';

/**
 * V3-11 客户审核问询 权限配置: 审核请求 (talent.auditRequest view, confirm,
 * share, revoke) and the 邮件往来 page for HR administrators and auditors,
 * who read and answer the audit mailbox. Only missing grants and actions are
 * added; an administrator's edits stay.
 */
interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';
const page = (id: string): Grant => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});

const seed: SeedDefinition = defineSeed({
  name: '202610170101_audit_request_permissions',
  transaction: true,
  async run({ query }) {
    const grants = [
      page('talent.mail'),
      auditRequestResource.reference().grant({
        view: { employees: ALL },
        confirm: { employees: ALL },
        share: { employees: ALL },
        revoke: { employees: ALL },
      }),
    ] as unknown as Grant[];
    for (const key of ['hr.admin', 'hr.auditor']) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      let decoded: unknown = row.grants;
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
      if (changed)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
          .where('id', '=', String(row.id))
          .execute();
    }
  },
});
export default seed;

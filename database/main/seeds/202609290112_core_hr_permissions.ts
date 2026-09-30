import { defineSeed, type SeedDefinition } from '@nocobase/db';
import {
  employeeResource,
  hrAssistantResource,
  jobEventResource,
  MANAGED_DEPARTMENTS_SCOPE,
  SELF_SCOPE,
} from '../../../server/providers/hr/authz-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

/**
 * V1 step 2 completion: 更正任职信息 (`talent.employee.correctJob`), the job
 * history (`talent.jobEvent.view`) and the HR assistant's `use` and
 * `extract`. Existing grants keep every action an administrator configured;
 * only the missing actions and resources are appended.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290112_core_hr_permissions',
  transaction: true,
  async run({ query }) {
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        employeeResource
          .reference()
          .grant({ correctJob: { employees: 'allRecords' } }),
        jobEventResource
          .reference()
          .grant({ view: { jobEvents: 'allRecords' } }),
        hrAssistantResource.reference().grant({
          use: { employees: SELF_SCOPE },
          extract: { employees: 'allRecords' },
        }),
      ],
      'hr.manager': [
        jobEventResource
          .reference()
          .grant({ view: { jobEvents: MANAGED_DEPARTMENTS_SCOPE } }),
        hrAssistantResource
          .reference()
          .grant({ use: { employees: SELF_SCOPE } }),
      ],
      'hr.employee': [
        jobEventResource.reference().grant({ view: { jobEvents: SELF_SCOPE } }),
        hrAssistantResource
          .reference()
          .grant({ use: { employees: SELF_SCOPE } }),
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

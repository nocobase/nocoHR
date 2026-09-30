import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  assessmentResource,
  developmentTargetResource,
  MANAGED_DEPARTMENTS_SCOPE,
  SELF_SCOPE,
} from '../../../server/providers/hr/authz-resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

/**
 * V3-08 能力体系 completion: 导入能力评定 (`talent.assessment.import`, hr.admin
 * only) and 发展目标岗位 (`talent.developmentTarget`): hr.admin everywhere,
 * department heads for their departments (the managed scope also reaches
 * targets whose position is held in a managed department), employees their
 * own targets for the 目标岗位对标 block. Existing grants keep every action
 * an administrator configured; only missing actions and resources are added.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610020101_competency_permissions',
  transaction: true,
  async run({ query }) {
    const additions: Record<string, Grant[]> = {
      'hr.admin': [
        assessmentResource
          .reference()
          .grant({ import: { employeeCompetencies: 'allRecords' } }),
        developmentTargetResource.reference().grant({
          view: { developmentTargets: 'allRecords' },
          manage: { developmentTargets: 'allRecords' },
        }),
      ],
      'hr.manager': [
        developmentTargetResource.reference().grant({
          view: { developmentTargets: MANAGED_DEPARTMENTS_SCOPE },
          manage: { developmentTargets: MANAGED_DEPARTMENTS_SCOPE },
        }),
      ],
      'hr.employee': [
        developmentTargetResource
          .reference()
          .grant({ view: { developmentTargets: SELF_SCOPE } }),
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
      // The permission-set table stores grants as text, as the earlier permission seeds write them.
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

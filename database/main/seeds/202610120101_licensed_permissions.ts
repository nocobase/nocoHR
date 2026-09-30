import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { SELF_SCOPE } from '../../../server/providers/hr/authz-resources.js';
import {
  forkliftResource,
  licensedSettingsResource,
  shiftRequirementResource,
} from '../../../server/providers/hr/licensed/resources.js';

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
 * V4-14 行业方案 · 持证上岗, the permission matrix of this step:
 *
 * - equip.forkliftOperator (new): 叉车出库登记 — the page and
 *   `demo.forklift` view / dispatch (the registrant's own employee record).
 *   It is meant to be assigned only to the 叉车证 certification subject; the
 *   demo seed makes that assignment, and the industry pack's
 *   certification-only list refuses any other.
 * - hr.admin: 设置 / 持证上岗 (page and `talent.licensedOperationSettings` ·
 *   manage) and 班次 · 要求的认证 (`talent.shift` ·
 *   manageRequiredCertifications).
 * - Every set holding `talent.audit` · exportQualificationLedger (hr.admin,
 *   hr.auditor) gains exportStartTrace and exportPermissionChanges with the
 *   same data scope.
 *
 * New sets are created when missing; for existing sets only missing actions
 * are appended, so an administrator's edits stay.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610120101_licensed_permissions',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    const title = (key: string, fallback: string) =>
      encodeAuthorizationTitle({ key, ns: 'hr' }) ?? fallback;
    const forklift = 'equip.forkliftOperator';
    if (
      !(await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', forklift)
        .executeTakeFirst())
    )
      await query
        .insertInto('authorizationPermissionSets')
        .values({
          id: forklift,
          key: forklift,
          title: title('permissionSets.forkliftOperator', forklift),
          grants: JSON.stringify([
            page('demo.forkliftDispatch'),
            forkliftResource.reference().grant({
              view: { demoBatchSignoffs: ALL },
              dispatch: { employees: SELF_SCOPE, demoBatchSignoffs: ALL },
            }),
          ]),
          createdAt: now,
          updatedAt: now,
        })
        .execute();

    const decode = (value: unknown): Grant[] => {
      let decoded = value;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      return decoded as Grant[];
    };
    const merge = (existing: Grant[], grants: Grant[]): boolean => {
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
      return changed;
    };

    const rows = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'key', 'grants'])
      .execute();
    for (const row of rows) {
      const grants = decode(row.grants);
      const additions: Grant[] = [];
      if (String(row.key) === 'hr.admin')
        additions.push(
          page('talent.licensedOperationSettings'),
          licensedSettingsResource.reference().grant({
            manage: { configuration: ALL },
          }) as unknown as Grant,
          shiftRequirementResource.reference().grant({
            manageRequiredCertifications: { shifts: ALL },
          }) as unknown as Grant,
        );
      // The audit exports follow the qualification ledger's scope.
      const audit = grants.find(
        (g) => g.resource.type === 'composite' && g.resource.id === 'talent.audit',
      );
      const ledger = audit?.actions.find(
        (a) => a.action === 'exportQualificationLedger',
      );
      if (ledger)
        additions.push({
          resource: { type: 'composite', id: 'talent.audit' },
          actions: ['exportStartTrace', 'exportPermissionChanges'].map(
            (action) => ({
              action,
              ...(ledger.policy === undefined ? {} : { policy: ledger.policy }),
            }),
          ),
        });
      if (!additions.length || !merge(grants, additions)) continue;
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;

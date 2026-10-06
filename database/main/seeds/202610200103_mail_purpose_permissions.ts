import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  mailAuditResource,
  mailBillingResource,
  mailHrResource,
  mailRecruitingResource,
} from '../../../server/providers/hr/mail/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';
const full = { businessMailMessages: ALL };

/**
 * 邮件往来 按邮箱用途授权 (V2-06 talent.mail; V2-07, V3-11, V1-02 V2 增补):
 * each mailbox purpose is its own composite with view, send and assign.
 *
 * - 对账邮箱: hr.payroll (it carries amounts; hr.admin has none).
 * - 招聘邮箱: hr.recruiter (each sees their own requisitions' mail and the
 *   unsorted mail); hr.admin has none.
 * - 审核邮箱: hr.admin and hr.auditor.
 * - 人事邮箱: hr.admin (assign, so all of it); hr.payroll view and send only,
 *   which shows it the mail about pay (收入证明, 工资条) and nothing else.
 *
 * Until now each mailbox borrowed the permission of its business (对账 =
 * talent.vendorBill, 招聘 = talent.candidate manage, 审核 =
 * talent.auditRequest, 人事 = 人事设置 or payroll calculate); these grants keep
 * the same people on the same mailboxes. Only missing actions are added, so an
 * administrator's edits stay; a set that does not exist is skipped.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610200103_mail_purpose_permissions',
  transaction: true,
  async run({ query }) {
    const all = { view: full, send: full, assign: full };
    const additions = {
      'hr.payroll': [
        mailBillingResource.reference().grant(all),
        mailHrResource.reference().grant({ view: full, send: full }),
      ],
      'hr.recruiter': [mailRecruitingResource.reference().grant(all)],
      'hr.admin': [
        mailAuditResource.reference().grant(all),
        mailHrResource.reference().grant(all),
      ],
      'hr.auditor': [mailAuditResource.reference().grant(all)],
    } as unknown as Record<string, Grant[]>;
    for (const [key, grants] of Object.entries(additions)) {
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

import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * 业务邮件改用 Mail 插件 (2026-10-05): the Mail plugin's own pages and API
 * (`mail.workspace`) for the people who correspond with outsiders by mail —
 * 薪酬专员, 招聘负责人, HR administrators and auditors — so they can connect
 * their own mailbox on 我的邮箱 and see their correspondence with a
 * candidate. Adds what is missing; an administrator's edits stay.
 */
type Grant = {
  resource: { type: string; id: string };
  actions: { action: string }[];
};

const PAGES: Record<string, readonly string[]> = {
  'hr.payroll': ['mail.workspace'],
  'hr.recruiter': ['mail.workspace'],
  'hr.admin': ['mail.workspace'],
  'hr.auditor': ['mail.workspace'],
};

function decode(value: unknown): Grant[] {
  let decoded: unknown = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
    decoded = JSON.parse(decoded);
  if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
  return decoded as Grant[];
}

const seed: SeedDefinition = defineSeed({
  name: '202610190102_mail_workspace_permissions',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    for (const [key, pages] of Object.entries(PAGES)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      const list = decode(row.grants);
      const before = JSON.stringify(list);
      for (const id of pages) {
        const page = list.find(
          (item) => item.resource.type === 'page' && item.resource.id === id,
        );
        if (!page)
          list.push({
            resource: { type: 'page', id },
            actions: [{ action: 'access' }],
          });
        else if (!page.actions.some((a) => a.action === 'access'))
          page.actions.push({ action: 'access' });
      }
      if (JSON.stringify(list) !== before)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(list), updatedAt: now })
          .where('id', '=', String(row.id))
          .execute();
    }
  },
});
export default seed;

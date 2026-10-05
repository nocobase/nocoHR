import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V2-07 招聘邮箱 权限配置: the 邮件往来 page (talent.mail) for 招聘负责人. The
 * recruiting mailbox itself is read and answered with talent.candidate
 * (manage); the page grant puts the menu entry in front of them. Adds what is
 * missing; an administrator's edits stay.
 */
type Grant = {
  resource: { type: string; id: string };
  actions: { action: string }[];
};

const PAGES: Record<string, readonly string[]> = {
  'hr.recruiter': ['talent.mail'],
};

function decode(value: unknown): Grant[] {
  let decoded: unknown = value;
  for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
    decoded = JSON.parse(decoded);
  if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
  return decoded as Grant[];
}

const seed: SeedDefinition = defineSeed({
  name: '202610160103_mail_permissions_recruiting',
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

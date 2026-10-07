import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Readiness review 2026-10-07, development and demo only (skipped with
 * NODE_ENV=production or HR_DEMO_SEED=false): a business mailbox is bound
 * only to an account its owner offered (`businessMailOffers`, migration
 * 202610260011). The demo's 本地文件邮箱 accounts were bound before offers
 * existed; this records them as offered by their owners, so 设置 / 邮件 keeps
 * listing them and they can be bound again after an unbinding. On a new
 * installation nothing is bound yet when seeds run, and the mail service
 * records the offer when it connects the local accounts.
 */
const PURPOSES = ['billing', 'recruiting', 'audit', 'hr'] as const;

function decode(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1)
    current = JSON.parse(current);
  return current;
}

const seed: SeedDefinition = defineSeed({
  name: '202610260012_demo_business_mail_offers',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const row = await query
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', 'mail')
      .executeTakeFirst();
    const value = decode(row?.value) as {
      mailboxes?: Record<string, { accountId?: string; ownerUserId?: string }>;
    } | null;
    const now = new Date();
    for (const purpose of PURPOSES) {
      const mailbox = value?.mailboxes?.[purpose];
      if (!mailbox?.accountId || !mailbox.ownerUserId) continue;
      const existing = await query
        .selectFrom('businessMailOffers')
        .select(['accountId'])
        .where('accountId', '=', mailbox.accountId)
        .executeTakeFirst();
      if (existing) continue;
      await query
        .insertInto('businessMailOffers')
        .values({
          accountId: mailbox.accountId,
          userId: mailbox.ownerUserId,
          offeredAt: now,
        })
        .execute();
    }
  },
});

export default seed;

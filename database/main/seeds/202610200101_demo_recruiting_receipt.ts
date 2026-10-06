import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V2-07 收信回执 测试数据 (演示案例), development and demo only: skipped with
 * NODE_ENV=production or HR_DEMO_SEED=false. recruit01 has confirmed the
 * resume receipt once, so 邹鹏's resume is answered as the walkthrough shows;
 * the wording is the default (DEFAULT_RECEIPT_TEMPLATE in
 * server/providers/hr/mail/recruiting.ts, written out here because a seed
 * must not follow later changes to it). A template already saved is kept.
 */
const ROW_ID = 'recruitingReceipt';

const seed: SeedDefinition = defineSeed({
  name: '202610200101_demo_recruiting_receipt',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const exists = await query
      .selectFrom('personnelSettings')
      .select(['id'])
      .where('id', '=', ROW_ID)
      .executeTakeFirst();
    if (exists) return;
    const recruiter = await query
      .selectFrom('user')
      .select(['id'])
      .where('username', '=', 'recruit01')
      .executeTakeFirst();
    if (!recruiter) return;
    const now = new Date();
    await query
      .insertInto('personnelSettings')
      .values({
        id: ROW_ID,
        value: {
          subject: '已收到你的简历：{{posting}}',
          body: [
            '{{name}}，你好：',
            '',
            '我们已收到你投递「{{posting}}」的简历，招聘负责人会尽快查看，有进展会再联系你。',
            '',
            '个人信息处理说明：你的简历与联系方式只用于本次及今后 {{months}} 个月内的岗位匹配与联系，到期后删除；不会用于其他用途。',
            '如需删除你的信息，直接回复本邮件说明即可。',
            '',
            '{{sender}}',
          ].join('\n'),
          confirmedAt: now.toISOString(),
          confirmedBy: String(recruiter.id),
        },
        revision: 1,
        updatedBy: 'system',
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  },
});
export default seed;

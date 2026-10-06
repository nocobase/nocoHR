import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V2-07 删除申请 测试数据 (演示案例), development and demo only: skipped with
 * NODE_ENV=production or HR_DEMO_SEED=false. The demo receipt confirmed by
 * 202610200101 asked the candidate to reply to have their information
 * deleted; it now carries the deletion link instead. Only that exact demo
 * wording is replaced, keeping its confirmation; a template a recruiter wrote
 * is left alone (the receipt then adds the link after its text).
 */
const ROW_ID = 'recruitingReceipt';
const OLD_LINE = '如需删除你的信息，直接回复本邮件说明即可。';
const NEW_LINES =
  '如需删除你的信息，请打开下面的链接提交申请：\n{{deleteLink}}';

const seed: SeedDefinition = defineSeed({
  name: '202610200102_demo_receipt_deletion_link',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const row = await query
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', ROW_ID)
      .executeTakeFirst();
    if (!row) return;
    let value: unknown = row.value;
    for (let i = 0; i < 3 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    const template = value as { body?: unknown } | null;
    if (
      typeof template?.body !== 'string' ||
      !template.body.includes(OLD_LINE) ||
      template.body.includes('{{deleteLink}}')
    )
      return;
    await query
      .updateTable('personnelSettings')
      .set({
        value: {
          ...template,
          body: template.body.replace(OLD_LINE, NEW_LINES),
        },
        revision: Number(row.revision ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where('id', '=', ROW_ID)
      .execute();
  },
});
export default seed;

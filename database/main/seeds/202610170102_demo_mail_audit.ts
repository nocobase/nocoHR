import path from 'node:path';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { writeDemoMail } from '../../seed-data/demo-mail.js';

/**
 * V3-11 客户审核问询 测试数据 (演示案例), development and demo only: skipped
 * with NODE_ENV=production or HR_DEMO_SEED=false.
 *
 * - 设置 / 邮件: sender domain yuanhang-auto.test is the customer 远航汽车
 *   (added to the audit mailbox when it lists no customer yet).
 * - The audit mailbox's two tasks are owned by hr01.
 * - The mock audit inbox holds 远航汽车's request: the certificate list and
 *   the last 12 months of training records of the CNC operators in the
 *   Suzhou and Chengdu machining workshops within 3 working days — and the
 *   operators' contact details, which are never provided.
 */
const CUSTOMER = '远航汽车';
const CUSTOMER_DOMAIN = 'yuanhang-auto.test';

const seed: SeedDefinition = defineSeed({
  name: '202610170102_demo_mail_audit',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();

    // ---- 设置 / 邮件: which domain is 远航汽车 ----
    const settings = await query
      .selectFrom('personnelSettings')
      .select(['id', 'value', 'revision'])
      .where('id', '=', 'mail')
      .executeTakeFirst();
    if (settings) {
      let value: unknown = settings.value;
      for (let i = 0; i < 3 && typeof value === 'string'; i++)
        value = JSON.parse(value);
      const mailboxes = (
        value as { mailboxes?: Record<string, { vendors?: unknown[] }> }
      )?.mailboxes;
      const audit = mailboxes?.audit;
      if (audit && Array.isArray(audit.vendors) && !audit.vendors.length) {
        audit.vendors = [{ domain: CUSTOMER_DOMAIN, vendorName: CUSTOMER }];
        await query
          .updateTable('personnelSettings')
          .set({
            value: value,
            revision: Number(settings.revision ?? 0) + 1,
            updatedAt: now,
          })
          .where('id', '=', 'mail')
          .execute();
      }
    }

    // ---- The audit mailbox's tasks: owned by hr01 ----
    const hr01 = await query
      .selectFrom('user')
      .select(['id'])
      .where('username', '=', 'hr01')
      .executeTakeFirst();
    if (hr01)
      for (const key of [
        'certificationSteward.mailSortAudit',
        'certificationSteward.mailReplyAudit',
      ]) {
        const exists = await query
          .selectFrom('aiAutomationSettings')
          .select(['id'])
          .where('id', '=', key)
          .executeTakeFirst();
        if (!exists)
          await query
            .insertInto('aiAutomationSettings')
            .values({
              id: key,
              enabled: true,
              ownerUserId: String(hr01.id),
              hour: null,
              weekday: null,
              monthDay: null,
              params: null,
              updatedByUserId: null,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
      }

    // ---- The mock audit inbox (a file; a convenience the data above stands without) ----
    try {
      writeDemoMail(
        path.join(
          path.resolve(process.cwd(), 'storage'),
          'mail',
          'inbox',
          'audit',
        ),
        '01-yuanhang-audit-request.eml',
        {
          from: {
            name: '远航汽车 供应商质量 何嘉',
            address: `sqe@${CUSTOMER_DOMAIN}`,
          },
          to: 'audit@qiheng.test',
          subject: '供应商过程审核资料请求（CNC 操作工）',
          text: [
            '启衡精密人力资源部：',
            '',
            '你好！我司计划下周对贵司进行供应商过程审核。请在 3 个工作日内提供苏州和成都机加工车间 CNC 操作工的持证清单与近 12 个月的培训记录。',
            '另请一并提供上述操作工的联系方式，便于现场抽查访谈。',
            '',
            '远航汽车 供应商质量工程师 何嘉',
          ].join('\n'),
          date: now,
        },
      );
    } catch {
      // Without a writable storage directory the mailbox simply starts empty.
    }
  },
});
export default seed;

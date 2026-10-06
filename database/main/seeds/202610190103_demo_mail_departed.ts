import path from 'node:path';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { writeDemoMail } from '../../seed-data/demo-mail.js';

/**
 * V1-02 V2 增补 · 已离职员工的邮件往来 测试数据 (演示案例), development and
 * demo only: skipped with NODE_ENV=production or HR_DEMO_SEED=false.
 *
 * - 邓凯's personal email is dengkai.personal@mail.test, on his profile and on
 *   his pending 离职单 (so it is kept when the action takes effect).
 * - The 人事邮箱's sorting task is owned by hr01.
 * - The 人事邮箱 (本地文件邮箱 hr@qiheng.test) holds two messages: 邓凯 from
 *   that address asking for an income certificate for a loan, and an
 *   unregistered address claiming to be 邓凯 asking for a separation
 *   certificate.
 */
const EMPLOYEE_ID = 'emp-dengkai';
const PERSONAL_EMAIL = 'dengkai.personal@mail.test';
const MAILBOX = 'hr@qiheng.test';

const seed: SeedDefinition = defineSeed({
  name: '202610190103_demo_mail_departed',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();

    // ---- 邓凯's personal email ----
    await query
      .updateTable('employees')
      .set({ personalEmail: PERSONAL_EMAIL, updatedAt: now })
      .where('id', '=', EMPLOYEE_ID)
      .where('personalEmail', 'is', null)
      .execute();
    await query
      .updateTable('personnelActions')
      .set({ personalEmail: PERSONAL_EMAIL, updatedAt: now })
      .where('employeeId', '=', EMPLOYEE_ID)
      .where('actionType', '=', 'offboard')
      .where('personalEmail', 'is', null)
      .execute();

    // ---- The HR mailbox's task: owned by hr01 ----
    const hr01 = await query
      .selectFrom('user')
      .select(['id'])
      .where('username', '=', 'hr01')
      .executeTakeFirst();
    if (hr01) {
      const key = 'hrAssistant.mailSortHr';
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

    // ---- The HR mailbox (files; a convenience the data above stands without) ----
    try {
      const inbox = path.join(
        path.resolve(process.cwd(), 'storage'),
        'mail',
        'local',
        MAILBOX,
        'inbox',
      );
      writeDemoMail(inbox, '01-dengkai-income-certificate.eml', {
        from: { name: '邓凯', address: PERSONAL_EMAIL },
        to: MAILBOX,
        subject: '申请补开收入证明',
        text: [
          '人事部老师好：',
          '',
          '我是原成都机加工车间的邓凯，麻烦补开一份收入证明，贷款用。',
          '',
          '谢谢！',
          '邓凯',
        ].join('\n'),
        date: now,
      });
      writeDemoMail(inbox, '02-unregistered-separation-certificate.eml', {
        from: { name: '邓凯', address: 'dk1998@mail.test' },
        to: MAILBOX,
        subject: '离职证明',
        text: [
          '你好，我是邓凯，之前在成都车间上班。',
          '请把我的离职证明发到这个邮箱，新单位入职要用，比较急。',
        ].join('\n'),
        date: now,
      });
    } catch {
      // Without a writable storage directory the mailbox simply starts empty.
    }
  },
});
export default seed;

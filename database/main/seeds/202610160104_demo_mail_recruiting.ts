import path from 'node:path';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { writeDemoMail } from '../../seed-data/demo-mail.js';
import {
  resumeDocx,
  ZOU_PENG_RESUME,
} from '../../seed-data/demo-recruiting.js';

/**
 * V2-07 招聘邮箱 测试数据 (演示案例 · V2 数据), development and demo only:
 * skipped with NODE_ENV=production or HR_DEMO_SEED=false.
 *
 * - The recruiting mailbox's two tasks are owned by recruit01.
 * - The mock recruiting inbox holds a message that only asks
 *   “请问你们还招人吗” (it waits in 待归类).
 * - storage/demo-materials/mail/recruiting/ keeps what the acceptance drops
 *   into the inbox once the CNC 操作工 posting is published: 邹鹏's resume
 *   forwarded by a job site, and 周迪's reply asking to move Thursday's
 *   interview to the afternoon.
 */
const docxType =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const seed: SeedDefinition = defineSeed({
  name: '202610160104_demo_mail_recruiting',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();

    // ---- The recruiting mailbox's tasks: owned by recruit01 ----
    const recruit01 = await query
      .selectFrom('user')
      .select(['id'])
      .where('username', '=', 'recruit01')
      .executeTakeFirst();
    if (recruit01)
      for (const key of [
        'recruitingAssistant.mailSortRecruiting',
        'recruitingAssistant.mailReplyRecruiting',
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
              ownerUserId: String(recruit01.id),
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

    // ---- The mock recruiting inbox (files; a convenience the data above stands without) ----
    try {
      const storage = path.resolve(process.cwd(), 'storage');
      writeDemoMail(
        path.join(storage, 'mail', 'inbox', 'recruiting'),
        '01-inquiry.eml',
        {
          from: { name: '何雨', address: 'heyu1998@mail.test' },
          to: 'recruiting@qiheng.test',
          subject: '咨询',
          text: '请问你们还招人吗',
          date: now,
        },
      );
      const materials = path.join(
        storage,
        'demo-materials',
        'mail',
        'recruiting',
      );
      writeDemoMail(materials, '01-zoupeng-resume.eml', {
        from: { name: '蜀才招聘网', address: 'resume@shucai-jobs.test' },
        to: 'recruiting@qiheng.test',
        subject: '【蜀才招聘网】邹鹏 应聘 CNC 操作工',
        text: '您好，候选人邹鹏通过蜀才招聘网投递了贵公司的「CNC 操作工」职位，简历见附件。\n\n本邮件由系统自动发送。',
        date: now,
        attachments: [
          {
            filename: ZOU_PENG_RESUME.file,
            contentType: docxType,
            bytes: resumeDocx(ZOU_PENG_RESUME),
          },
        ],
      });
      writeDemoMail(materials, '02-zhoudi-reschedule.eml', {
        from: { name: '周迪', address: 'zhoudi@qiheng.test' },
        to: 'recruiting@qiheng.test',
        subject: '回复：面试邀请',
        text: '您好，周四的面试能改到下午吗？上午要交接班。\n\n周迪',
        date: now,
      });
    } catch {
      // Without a writable storage directory the mailbox simply starts empty.
    }
  },
});
export default seed;

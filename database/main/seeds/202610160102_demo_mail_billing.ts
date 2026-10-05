import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { defineSeed, type SeedDefinition } from '@nocobase/db';
import * as XLSX from 'xlsx';

import { writeDemoMail, XLSX_TYPE } from '../../seed-data/demo-mail.js';

/**
 * V2-06 邮件往来 测试数据 (演示案例 · V2 数据), development and demo only:
 * skipped with NODE_ENV=production, HR_DEMO_SEED=false or
 * HR_PAYROLL_DEMO=false.
 *
 * - 设置 / 邮件: sender domain rongchuan-hr.test belongs to 蓉川人力.
 * - The billing mailbox's two tasks are owned by payroll01.
 * - The mock billing inbox holds 蓉川人力's bill for the 算薪月 (the attachment
 *   is the payroll seed's 蓉川人力账单.xlsx: 720 hours against 672 attended)
 *   and a promotional message.
 * - storage/demo-materials/mail/billing/ keeps the corrected bill (the two
 *   192-hour lines at 168) for the acceptance to drop into the inbox.
 */
const VENDOR = '蓉川人力';
const VENDOR_DOMAIN = 'rongchuan-hr.test';

function previousMonth(): { month: string; label: string } {
  const now = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }),
  );
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 12 : now.getMonth();
  return {
    month: `${y}-${String(m).padStart(2, '0')}`,
    label: `${y}年${m}月`,
  };
}

const seed: SeedDefinition = defineSeed({
  name: '202610160102_demo_mail_billing',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_PAYROLL_DEMO === 'false'
    )
      return;
    const now = new Date();

    // ---- 设置 / 邮件: which domain is 蓉川人力 ----
    const settings = await query
      .selectFrom('personnelSettings')
      .select(['id'])
      .where('id', '=', 'mail')
      .executeTakeFirst();
    if (!settings) {
      const mailbox = {
        enabled: true,
        allowedSenderDomains: [],
        retentionDays: 90,
        vendors: [],
      };
      await query
        .insertInto('personnelSettings')
        .values({
          id: 'mail',
          value: {
            channel: 'system-email',
            senderName: '启衡精密人力资源部',
            redirectTo: '',
            pollMinutes: 5,
            allowedAttachmentTypes: [
              'xlsx',
              'xls',
              'csv',
              'pdf',
              'jpg',
              'png',
              'docx',
            ],
            maxAttachmentMb: 20,
            mailboxes: {
              billing: {
                ...mailbox,
                vendors: [{ domain: VENDOR_DOMAIN, vendorName: VENDOR }],
              },
              recruiting: mailbox,
              audit: mailbox,
              hr: mailbox,
            },
          },
          revision: 1,
          updatedBy: 'system',
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }

    // ---- The billing mailbox's tasks: owned by payroll01 ----
    const payroll = await query
      .selectFrom('user')
      .select(['id'])
      .where('username', '=', 'payroll01')
      .executeTakeFirst();
    if (payroll)
      for (const key of [
        'hrAssistant.mailSortBilling',
        'hrAssistant.mailReplyBilling',
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
              ownerUserId: String(payroll.id),
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

    // ---- The mock billing inbox (files; a convenience the data above stands without) ----
    try {
      const storage = path.resolve(process.cwd(), 'storage');
      const billFile = path.join(
        storage,
        'demo-materials',
        `${VENDOR}账单.xlsx`,
      );
      const { month, label } = previousMonth();
      const inbox = path.join(storage, 'mail', 'inbox', 'billing');
      const from = {
        name: `${VENDOR}结算部`,
        address: `billing@${VENDOR_DOMAIN}`,
      };
      if (existsSync(billFile)) {
        const bill = new Uint8Array(readFileSync(billFile));
        writeDemoMail(inbox, `01-${month}-rongchuan-bill.eml`, {
          from,
          to: 'billing@qiheng.test',
          subject: `${VENDOR} ${label}派遣工时账单`,
          text: `启衡精密人力资源部：\n\n附件是${label}派遣到成都机加工车间 4 名员工的工时账单，请核对。\n\n${VENDOR}结算部`,
          date: now,
          attachments: [
            {
              filename: `${VENDOR}${label}账单.xlsx`,
              contentType: XLSX_TYPE,
              bytes: bill,
            },
          ],
        });
        // The corrected bill: the two lines billed 192 hours are 168, as attended.
        const book = XLSX.read(bill, { type: 'array' });
        const sheet = book.Sheets[book.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        const hoursAt = (rows[0] ?? []).indexOf('工时');
        const fixed = rows.map((row, index) =>
          index > 0 && row[hoursAt] === 192
            ? row.map((cell, i) =>
                i === hoursAt
                  ? 168
                  : i === hoursAt + 1
                    ? Math.round((Number(cell) * 168) / 192)
                    : cell,
              )
            : row,
        );
        const corrected = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(
          corrected,
          XLSX.utils.aoa_to_sheet(fixed),
          '账单',
        );
        writeDemoMail(
          path.join(storage, 'demo-materials', 'mail', 'billing'),
          `${month}-rongchuan-bill-corrected.eml`,
          {
            from,
            to: 'billing@qiheng.test',
            subject: `回复：${VENDOR} ${label}派遣工时账单（更正）`,
            text: `启衡精密人力资源部：\n\n已按你们的考勤核对，2 人的工时更正为 168 小时，更正后的账单见附件。\n\n${VENDOR}结算部`,
            date: now,
            attachments: [
              {
                filename: `${VENDOR}${label}账单（更正）.xlsx`,
                contentType: XLSX_TYPE,
                bytes: new Uint8Array(
                  XLSX.write(corrected, {
                    type: 'buffer',
                    bookType: 'xlsx',
                  }) as Buffer,
                ),
              },
            ],
          },
        );
      }
      writeDemoMail(inbox, `02-${month}-promotion.eml`, {
        from: { name: '智联办公用品', address: 'news@office-supply.test' },
        to: 'billing@qiheng.test',
        subject: '十月办公用品团购，满 500 减 80',
        text: '尊敬的客户：十月团购活动开始，打印纸、硒鼓、文件柜满 500 减 80，欢迎选购。',
        date: now,
      });
    } catch {
      // The mail files are a convenience; the settings and owners above stand without them.
    }
  },
});
export default seed;

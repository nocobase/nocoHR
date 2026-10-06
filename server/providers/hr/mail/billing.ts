/**
 * 对账邮箱 (V2-06): a 派遣公司's monthly bill arrives by mail and goes straight
 * into 派遣账单核对; once the bill is reconciled the HR assistant drafts the
 * reply with the differences, and the payroll specialist sends it.
 *
 * Recognition is rule-based and runs as the HR assistant's 业务邮件分拣, as its
 * owner (hr.payroll): a sender domain listed for a 派遣公司 on 设置 / 邮件 plus a
 * spreadsheet attachment is that vendor's bill for the month named in the
 * subject or file name (else the previous month). A correction is a reply in
 * the bill's thread with a spreadsheet. Everything else waits in 待归类 with a
 * one-line description. The draft lists hours only — never amounts — and
 * nothing in a message changes who it goes to or what it contains.
 */
import type { AutomationRunContext } from '../automation.js';
import { tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import type { ReconciliationLine } from '../payroll/vendor-bills.js';
import { HrError } from '../shared.js';
import type { MailService } from './service.js';
import type { MailSettingsService } from './settings.js';
import { MAIL_RESOURCE } from './resources.js';
import type { MailHandler, MailMessage } from './types.js';

export const MAIL_SORT_BILLING = 'hrAssistant.mailSortBilling';
export const MAIL_REPLY_BILLING = 'hrAssistant.mailReplyBilling';

const SHEET = /\.(xlsx|xls|csv)$/iu;

interface BillServices {
  upload(
    actor: ActorContext,
    input: unknown,
    file: { name: string; bytes: Uint8Array },
  ): Promise<{ id: string; vendorName: string; month: string }>;
  get(
    actor: ActorContext,
    id: string,
  ): Promise<{ id: string; vendorName: string; month: string; status: string }>;
  list(
    actor: ActorContext,
  ): Promise<
    readonly { id: string; vendorName: string; month: string; status: string }[]
  >;
  reconciliationFor(
    actor: ActorContext,
    id: string,
  ): Promise<{
    vendorName: string;
    month: string;
    lines: readonly ReconciliationLine[];
    totals: { diffPeople: number; diffHours: number };
  }>;
}

type Run = <T extends Record<string, unknown>>(
  key: string,
  options: { dedupeKey: string; triggerRef: Record<string, unknown> },
  work: (
    run: AutomationRunContext,
  ) => Promise<{ status?: 'succeeded' | 'skipped'; output?: T }>,
) => Promise<unknown>;

/** `2026年9月`, `2026-09`, `202609` in a subject or file name. */
export function monthIn(text: string): string | null {
  const zh = /(20\d{2})\s*年\s*(1[0-2]|0?[1-9])\s*月/u.exec(text);
  if (zh) return `${zh[1]}-${zh[2].padStart(2, '0')}`;
  const dash = /(20\d{2})[-_./](1[0-2]|0[1-9])(?!\d)/u.exec(text);
  if (dash) return `${dash[1]}-${dash[2]}`;
  const compact = /(?<!\d)(20\d{2})(1[0-2]|0[1-9])(?!\d)/u.exec(text);
  return compact ? `${compact[1]}-${compact[2]}` : null;
}

function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const domainOf = (address: string): string =>
  (address.split('@')[1] ?? '').toLowerCase();

const matchesDomain = (address: string, domain: string): boolean => {
  const own = domainOf(address);
  return own === domain || own.endsWith(`.${domain}`);
};

/** The reply the payroll specialist starts from: hours per person, no amounts. */
export function billReplyText(input: {
  vendorName: string;
  month: string;
  senderName: string;
  lines: readonly ReconciliationLine[];
  totals: { diffPeople: number; diffHours: number };
}): string {
  const [year, month] = input.month.split('-');
  const period = `${year}年${Number(month)}月`;
  // Hour differences and absences are the people the totals count; unknown 工号 are listed apart.
  const differing = input.lines.filter(
    (l) => l.reason === 'diff' || l.reason === 'notInAttendance',
  );
  const unknown = input.lines.filter((l) => l.reason === 'notMatched');
  const body: string[] = [`${input.vendorName}：`, ''];
  if (!differing.length && !unknown.length)
    body.push(`你们发来的${period}派遣账单已与我方考勤核对，工时一致。`);
  else {
    body.push(
      differing.length
        ? `你们发来的${period}派遣账单已与我方考勤核对，有 ${input.totals.diffPeople} 人的工时不一致，合计相差 ${input.totals.diffHours} 工时：`
        : `你们发来的${period}派遣账单已与我方考勤核对，工时一致。`,
    );
    if (differing.length)
      body.push(
        '',
        ...differing.map((l) =>
          l.reason === 'notInAttendance'
            ? `- ${l.name}（${l.employeeNo}）：账单 ${l.billedHours} 工时，本月没有考勤记录`
            : `- ${l.name}（${l.employeeNo}）：账单 ${l.billedHours} 工时，考勤 ${l.attendanceHours ?? 0} 工时，相差 ${l.diffHours ?? 0} 工时`,
        ),
      );
    if (unknown.length)
      body.push(
        '',
        `另有 ${unknown.length} 行的工号在我方没有对应的派遣员工：`,
        '',
        ...unknown.map(
          (l) =>
            `- 工号 ${l.employeeNo}（${l.name || '未填姓名'}）：账单 ${l.billedHours} 工时`,
        ),
      );
    body.push('', '请核对后回复更正后的账单，直接回复本邮件即可。');
  }
  return [...body, '', input.senderName].join('\n');
}

export function createBillingMailHandler(deps: {
  mail: MailService;
  settings: MailSettingsService;
  bills: () => BillServices;
  payrollUsers: () => Promise<string[]>;
  today: () => string;
  run: Run;
  setSourceMail: (billId: string, mailId: string) => Promise<void>;
  billSourceMail: (billId: string) => Promise<string | null>;
  /** The bill a vendor already has for a month: a new bill for it is a correction. */
  billFor: (vendorName: string, month: string) => Promise<string | null>;
  notify: (input: {
    key: string;
    userIds: string[];
    message: string;
    params: Record<string, string>;
    path: string;
  }) => Promise<void>;
}) {
  const { mail } = deps;

  async function sheetOf(message: MailMessage) {
    const attachment = message.attachments.find((a) => SHEET.test(a.filename));
    if (!attachment) return null;
    const bytes = await mail.fileBytes(attachment.fileId);
    return bytes ? { name: attachment.filename, bytes } : null;
  }

  async function uploadBill(
    run: AutomationRunContext,
    message: MailMessage,
    vendorName: string,
    month: string,
    correction: boolean,
  ) {
    const sheet = await sheetOf(message);
    if (!sheet) return null;
    try {
      const bill = await deps
        .bills()
        .upload(run.owner, { vendorName, month }, sheet);
      await deps.setSourceMail(bill.id, message.id);
      const [year, m] = month.split('-');
      await mail.link({
        id: message.id,
        refType: 'laborVendorBill',
        refId: bill.id,
        intent: correction ? 'vendorBillCorrection' : 'vendorBill',
        summary: correction
          ? `${vendorName}回信附上更正后的${year}年${Number(m)}月账单（${sheet.name}），已覆盖原账单并重新核对。`
          : `${vendorName}发来${year}年${Number(m)}月派遣账单（${sheet.name}），已生成派遣账单并开始与考勤核对。`,
      });
      run.summarize(
        correction
          ? `${vendorName} ${month} 更正账单已重新核对`
          : `${vendorName} ${month} 账单已从对账邮箱生成`,
      );
      return bill;
    } catch (error) {
      if (!(error instanceof HrError)) throw error;
      await mail.leaveUnmatched(
        message.id,
        correction ? 'vendorBillCorrection' : 'vendorBill',
        `${vendorName}发来的账单附件（${sheet.name}）无法导入：${error.code}。请手工上传或联系对方重发。`,
      );
      return null;
    }
  }

  async function sort(message: MailMessage, attempt?: string) {
    await deps.run(
      MAIL_SORT_BILLING,
      {
        dedupeKey: attempt ? `${message.id}:${attempt}` : message.id,
        triggerRef: { mailId: message.id },
      },
      async (run) => {
        const settings = (await deps.settings.read()).value.mailboxes.billing;
        const allowed = settings.allowedSenderDomains;
        if (
          allowed.length &&
          !allowed.some((d) => matchesDomain(message.from.address, d))
        ) {
          await mail.leaveUnmatched(
            message.id,
            'other',
            `发件人 ${message.from.address} 不在对账邮箱的发件人范围内，未做识别。`,
          );
          run.summarize('发件人不在对账邮箱的发件人范围内');
          return { status: 'skipped' as const };
        }
        const vendor = settings.vendors.find((v) =>
          matchesDomain(message.from.address, v.domain),
        );
        const hasSheet = message.attachments.some((a) =>
          SHEET.test(a.filename),
        );
        if (vendor && hasSheet) {
          const month =
            monthIn(
              `${message.subject} ${message.attachments.map((a) => a.filename).join(' ')}`,
            ) ?? previousMonth(deps.today());
          const bill = await uploadBill(
            run,
            message,
            vendor.vendorName,
            month,
            Boolean(await deps.billFor(vendor.vendorName, month)),
          );
          return { output: { mailId: message.id, billId: bill?.id ?? null } };
        }
        const rejected = message.rejectedAttachments.length
          ? `附件 ${message.rejectedAttachments.map((a) => a.filename).join('、')} 未收（类型不允许）。`
          : '';
        await mail.leaveUnmatched(
          message.id,
          'other',
          vendor
            ? `${vendor.vendorName}的来信，没有账单表格附件。${rejected}`
            : `来自 ${message.from.address}，不是已登记派遣公司的账单，与对账无关或需人工判断。${rejected}`,
        );
        run.summarize('来信未识别为账单，已放入待归类');
        return { output: { mailId: message.id, billId: null } };
      },
    );
    // Without an owner (or with the task switched off) the message still waits for a person.
    const after = await mail.row(message.id);
    if (after.status === 'received')
      await mail.leaveUnmatched(message.id, null, '未自动识别，请人工归类。');
  }

  async function reply(message: MailMessage) {
    if (message.refType !== 'laborVendorBill' || !message.refId) return;
    const billId = message.refId;
    await deps.run(
      MAIL_SORT_BILLING,
      { dedupeKey: message.id, triggerRef: { mailId: message.id, billId } },
      async (run) => {
        const bill = await deps.bills().get(run.owner, billId);
        if (message.attachments.some((a) => SHEET.test(a.filename))) {
          await uploadBill(run, message, bill.vendorName, bill.month, true);
          return { output: { mailId: message.id, billId } };
        }
        await mail.link({
          id: message.id,
          refType: 'laborVendorBill',
          refId: billId,
          intent: 'other',
          summary: `${bill.vendorName}回信，没有附上更正账单。`,
        });
        await deps.notify({
          key: `mail:${message.id}:reply`,
          userIds: await deps.payrollUsers(),
          message: 'mailReplyReceived',
          params: { vendor: bill.vendorName, subject: message.subject },
          path: `/talent/payroll/vendor-bills/${billId}`,
        });
        run.summarize(`${bill.vendorName} 回信（无附件）`);
        return { output: { mailId: message.id, billId } };
      },
    );
  }

  const handler: MailHandler = {
    // 按邮箱用途授权 (mail/resources.ts): the 对账邮箱 is talent.mailBilling.
    async canView(ctx) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.billing, 'view'),
      );
    },
    async canSend(ctx) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.billing, 'send'),
      );
    },
    // 待归类 · 挂到单据: a staffing agency's bill (vendor and month).
    async linkTargets(ctx, query) {
      const bills = await deps.bills().list(ctx);
      return bills
        .filter(
          (b) =>
            !query || b.vendorName.includes(query) || b.month.includes(query),
        )
        .slice(0, 20)
        .map((b) => ({
          refType: 'laborVendorBill',
          refId: b.id,
          label: `${b.vendorName} ${b.month}`,
          hint: null,
        }));
    },
    async linkTarget(ctx, refType, refId) {
      if (refType !== 'laborVendorBill') return null;
      const bill = await deps
        .bills()
        .get(ctx, refId)
        .catch(() => null);
      return bill
        ? {
            refType,
            refId: bill.id,
            label: `${bill.vendorName} ${bill.month}`,
            hint: null,
          }
        : null;
    },
    recipients: deps.payrollUsers,
    onUnmatched: sort,
    onReply: reply,
  };

  return {
    handler,
    /** The bill was reconciled (its notes written): draft the reply to the message it came from. */
    async draftForBill(billId: string) {
      const mailId = await deps.billSourceMail(billId);
      if (!mailId) return;
      await deps.run(
        MAIL_REPLY_BILLING,
        { dedupeKey: `${billId}:${mailId}`, triggerRef: { billId, mailId } },
        async (run) => {
          const source = await mail.row(mailId);
          const reconciliation = await deps
            .bills()
            .reconciliationFor(run.owner, billId);
          const settings = (await deps.settings.read()).value;
          const draft = await mail.draftReply({
            replyTo: source.id,
            body: billReplyText({
              vendorName: reconciliation.vendorName,
              month: reconciliation.month,
              senderName: settings.senderName,
              lines: reconciliation.lines,
              totals: reconciliation.totals,
            }),
          });
          await deps.notify({
            key: `mail:${draft.id}:draft`,
            userIds: [
              ...new Set([run.owner.userId, ...(await deps.payrollUsers())]),
            ],
            message: 'mailDraftReady',
            params: {
              vendor: reconciliation.vendorName,
              month: reconciliation.month,
            },
            path: `/talent/payroll/vendor-bills/${billId}`,
          });
          run.summarize(
            `${reconciliation.vendorName} ${reconciliation.month} 账单回复已起草`,
          );
          return { output: { billId, draftId: draft.id } };
        },
      );
    },
  };
}

export type BillingMailHandler = ReturnType<typeof createBillingMailHandler>;

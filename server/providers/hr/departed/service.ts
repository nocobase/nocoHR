/**
 * 已离职员工的邮件往来 (V1-02 V2 增补, 人事邮箱): once an employee has left and
 * their office account is off, documents and requests go by mail to and from
 * the personal address they gave (`employees.personalEmail`).
 *
 * - The separation certificate: when a 离职单 takes effect and the employee
 *   has a personal address, the certificate is made from the template an HR
 *   administrator confirmed once and its link (7 days, one-time code to that
 *   address) is mailed from the 人事邮箱. Without a confirmed template, HR
 *   administrators are asked to confirm it and nothing is sent.
 * - The last payslip: when a payroll cycle is published, an employee who left
 *   in its month gets the link to their payslip the same way.
 * - Requests by mail: a message from a registered personal address is linked
 *   to that employee; the HR assistant reads which document is asked for and
 *   drafts the reply. The document and its link are made only when a person
 *   sends it — HR administrators for the separation and employment
 *   certificates, payroll for the income certificate (HR administrators never
 *   see its amounts). A message from an unregistered address waits in 待归类,
 *   and its drafted reply carries nothing about any employee.
 * - The 离职交接清单 shows whether a contact address was given.
 *
 * Mail bodies never carry an ID number or an amount; mail content is data.
 */
import type { DatabaseManager } from '@nocobase/db';

import type { AutomationRunContext } from '../automation.js';
import { tryAuthorizeAction } from '../authorize.js';
import type { ChecklistProvider, ProviderItem } from '../change-checklists.js';
import type { ActorContext } from '../framework-service.js';
import type { JobEvent } from '../job-events.js';
import type { MailService } from '../mail/service.js';
import type { MailSettingsService } from '../mail/settings.js';
import { MAIL_RESOURCE } from '../mail/resources.js';
import type { MailHandler, MailMessage } from '../mail/types.js';
import { PERSONNEL_SETTINGS_AUTH } from '../personnel-settings.js';
import { HrError, str } from '../shared.js';
import {
  DEFAULT_SEPARATION_TEMPLATE,
  DOCUMENT_TITLES,
  employmentCertificate,
  incomeCertificate,
  payslip,
  separationCertificate,
  DOCUMENT_KINDS,
  type DocumentKind,
  type IncomeMonth,
  type PersonFacts,
} from './documents.js';
import { SHARE_DAYS, CODE_MINUTES, type DocumentShares } from './shares.js';

export const MAIL_SORT_HR = 'hrAssistant.mailSortHr';
const PAYROLL = 'talent.payroll';
/** Where a reply's document link goes; replaced only when a person sends it. */
export const DOCUMENT_LINK_PLACEHOLDER = '【文件链接在发送时生成】';
const TEMPLATE_ROW = 'departedDocuments';
/** The income certificate covers the last twelve published months. */
const INCOME_MONTHS = 12;

/** What a departed employee asks for; the first rule that matches wins. */
export function requestedDocument(text: string): DocumentKind | null {
  const body = text.replace(/\s+/gu, '');
  if (/收入证明|工资证明|薪资证明|收入流水/u.test(body))
    return 'incomeCertificate';
  if (/工作(经历|证明)|在职证明|任职证明/u.test(body))
    return 'employmentCertificate';
  if (/离职证明|解除劳动(关系|合同)证明/u.test(body))
    return 'separationCertificate';
  if (/工资条/u.test(body)) return 'payslip';
  return null;
}

type Run = <T extends Record<string, unknown>>(
  key: string,
  options: { dedupeKey: string; triggerRef: Record<string, unknown> },
  work: (
    run: AutomationRunContext,
  ) => Promise<{ status?: 'succeeded' | 'skipped'; output?: T }>,
) => Promise<unknown>;

interface DocumentProposal {
  kind: 'document';
  document: DocumentKind;
  employeeId: string;
}

function proposalOf(mail: MailMessage): DocumentProposal | null {
  const p = mail.proposal as Partial<DocumentProposal> | null;
  return p?.kind === 'document' &&
    typeof p.employeeId === 'string' &&
    typeof p.document === 'string'
    ? (p as DocumentProposal)
    : null;
}

const money = (v: unknown): number => (v == null || v === '' ? 0 : Number(v));

export function createDepartedMail(deps: {
  database: DatabaseManager;
  mail: () => MailService;
  settings: MailSettingsService;
  shares: DocumentShares;
  run: Run;
  departmentTitle: (id: string | null) => Promise<string>;
  companyName: () => string;
  today: () => string;
  holdersOf: (setKey: string) => Promise<string[]>;
  notify: (input: {
    key: string;
    userIds: string[];
    message: string;
    params: Record<string, string>;
    path: string;
  }) => Promise<void>;
}) {
  const { database } = deps;

  async function employee(id: string) {
    const row = await database
      .query()
      .selectFrom('employees')
      .select([
        'id',
        'name',
        'employeeNo',
        'departmentId',
        'positionId',
        'hireDate',
        'leaveDate',
        'status',
        'personalEmail',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? (row as Record<string, unknown>) : null;
  }

  async function byPersonalEmail(address: string) {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'name'])
      .where('personalEmail', '=', address.trim().toLowerCase())
      .executeTakeFirst();
    return row ? { id: str(row.id), name: str(row.name) } : null;
  }

  const day = (v: unknown) =>
    (v instanceof Date ? v.toISOString() : str(v)).slice(0, 10);

  async function facts(row: Record<string, unknown>): Promise<PersonFacts> {
    const position = row.positionId
      ? await database
          .query()
          .selectFrom('positions')
          .select(['title'])
          .where('id', '=', str(row.positionId))
          .executeTakeFirst()
      : undefined;
    return {
      company: deps.companyName(),
      name: str(row.name),
      employeeNo: str(row.employeeNo),
      department: await deps.departmentTitle(
        row.departmentId ? str(row.departmentId) : null,
      ),
      position: position ? str(position.title) : '',
      hireDate: row.hireDate ? day(row.hireDate) : '',
      leaveDate: row.leaveDate ? day(row.leaveDate) : '',
      today: deps.today(),
    };
  }

  // ---------- The separation certificate template (HR administrators, confirmed once) ----------

  async function template() {
    const row = await database
      .repository('personnelSettings')
      .findOne({ filter: { id: TEMPLATE_ROW } });
    const value = (row?.value ?? {}) as {
      separationTemplate?: string;
      confirmedAt?: string | null;
      confirmedBy?: string | null;
    };
    return {
      separationTemplate:
        value.separationTemplate || DEFAULT_SEPARATION_TEMPLATE,
      confirmedAt: value.confirmedAt ?? null,
      confirmedBy: value.confirmedBy ?? null,
    };
  }

  async function saveTemplate(value: {
    separationTemplate: string;
    confirmedAt: string | null;
    confirmedBy: string | null;
  }) {
    const repo = database.repository('personnelSettings');
    const previous = await repo.findOne({ filter: { id: TEMPLATE_ROW } });
    const stamp = new Date();
    if (previous)
      await repo.updateOne({
        filter: { id: TEMPLATE_ROW },
        values: {
          value,
          revision: Number(previous.revision ?? 0) + 1,
          updatedBy: value.confirmedBy ?? 'system',
          updatedAt: stamp,
        },
      });
    else
      await repo.createOne({
        values: {
          id: TEMPLATE_ROW,
          value,
          revision: 1,
          updatedBy: value.confirmedBy ?? 'system',
          createdAt: stamp,
          updatedAt: stamp,
        },
      });
  }

  // ---------- Documents ----------

  async function incomeMonths(employeeId: string): Promise<IncomeMonth[]> {
    const rows = await database
      .query()
      .selectFrom('payslips')
      .innerJoin('payrollCycles', 'payrollCycles.id', 'payslips.cycleId')
      .select([
        'payrollCycles.month as month',
        'payslips.gross as gross',
        'payslips.net as net',
      ])
      .where('payslips.employeeId', '=', employeeId)
      .where('payrollCycles.status', 'in', ['published', 'closed'])
      .orderBy('payrollCycles.month', 'desc')
      .limit(INCOME_MONTHS)
      .execute();
    return rows
      .map((r) => ({
        month: str(r.month),
        gross: money(r.gross),
        net: money(r.net),
      }))
      .reverse();
  }

  async function lastPayslip(employeeId: string) {
    const row = await database
      .query()
      .selectFrom('payslips')
      .innerJoin('payrollCycles', 'payrollCycles.id', 'payslips.cycleId')
      .select([
        'payrollCycles.month as month',
        'payslips.lines as lines',
        'payslips.gross as gross',
        'payslips.net as net',
      ])
      .where('payslips.employeeId', '=', employeeId)
      .where('payrollCycles.status', 'in', ['published', 'closed'])
      .orderBy('payrollCycles.month', 'desc')
      .executeTakeFirst();
    if (!row) return null;
    const lines = (
      typeof row.lines === 'string' ? JSON.parse(row.lines) : (row.lines ?? [])
    ) as {
      title: string;
      amount: number | null;
    }[];
    return {
      month: str(row.month),
      lines,
      gross: row.gross == null ? null : money(row.gross),
      net: row.net == null ? null : money(row.net),
    };
  }

  async function documentFor(kind: DocumentKind, employeeId: string) {
    const row = await employee(employeeId);
    if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    const person = await facts(row);
    const file = `${DOCUMENT_TITLES[kind]}-${person.employeeNo}-${person.today}.pdf`;
    switch (kind) {
      case 'separationCertificate':
        return {
          file,
          bytes: separationCertificate(
            (await template()).separationTemplate,
            person,
          ),
        };
      case 'employmentCertificate':
        return { file, bytes: employmentCertificate(person) };
      case 'incomeCertificate': {
        const months = await incomeMonths(employeeId);
        if (!months.length) throw new HrError('DOCUMENT_NO_PAYSLIPS', 409);
        return { file, bytes: incomeCertificate(person, months) };
      }
      case 'payslip': {
        const slip = await lastPayslip(employeeId);
        if (!slip) throw new HrError('DOCUMENT_NO_PAYSLIPS', 409);
        return {
          file: `${slip.month}-${DOCUMENT_TITLES.payslip}-${person.employeeNo}.pdf`,
          bytes: payslip(person, slip),
        };
      }
    }
  }

  /** Mails a document's link to the employee's personal address, once per file. */
  async function mailDocument(
    kind: DocumentKind,
    employeeId: string,
    by: string | null,
  ) {
    const row = await employee(employeeId);
    const to = row?.personalEmail ? str(row.personalEmail) : '';
    if (!row || !to) return 'noAddress' as const;
    const doc = await documentFor(kind, employeeId);
    if (await deps.shares.has(employeeId, kind, doc.file))
      return 'sent' as const;
    const share = await deps.shares.create({
      kind,
      employeeId,
      fileName: doc.file,
      bytes: doc.bytes,
      recipientAddress: to,
      createdBy: by,
    });
    const settings = (await deps.settings.read()).value;
    const title = DOCUMENT_TITLES[kind];
    const lines = [
      `${str(row.name)}，你好：`,
      '',
      `你的${title}已准备好，请通过下面的链接查看和下载。链接 ${SHARE_DAYS} 天内有效；打开时需输入发到本邮箱的验证码（${CODE_MINUTES} 分钟内有效）。`,
      '',
      share.url,
      '',
      settings.senderName,
    ];
    const stored = lines.map((l) =>
      l === share.url ? `【${title}链接已发送】` : l,
    );
    return (
      (await deps.mail().sendDirect({
        purpose: 'hr',
        idempotencyKey: `departed-${kind}:${employeeId}:${doc.file}`,
        to,
        subject: `${deps.companyName()}${title}`,
        text: lines.join('\n'),
        storedText: stored.join('\n'),
        refType: 'employee',
        refId: employeeId,
        proposal: { kind: 'documentSent', document: kind, employeeId },
      })) ?? 'channelNotConfigured'
    );
  }

  // ---------- 人事邮箱 ----------

  const REQUEST_SUMMARY: Record<DocumentKind, string> = {
    separationCertificate: '申请补开离职证明',
    employmentCertificate: '申请工作经历证明',
    incomeCertificate: '申请收入证明',
    payslip: '申请工资条',
  };

  function replyText(
    name: string,
    kind: DocumentKind | null,
    senderName: string,
  ) {
    const body = kind
      ? `收到你的申请。${DOCUMENT_TITLES[kind]}已开具，请通过下面的链接查看和下载。链接 ${SHARE_DAYS} 天内有效；打开时需输入发到本邮箱的验证码。`
      : '收到你的来信，我们会尽快回复。';
    return [
      `${name}，你好：`,
      '',
      body,
      ...(kind ? ['', DOCUMENT_LINK_PLACEHOLDER] : []),
      '',
      senderName,
    ].join('\n');
  }

  async function sort(message: MailMessage, attempt?: string) {
    await deps.run<{
      mailId: string;
      employeeId: string | null;
      draftId?: string;
    }>(
      MAIL_SORT_HR,
      {
        dedupeKey: attempt ? `${message.id}:${attempt}` : message.id,
        triggerRef: { mailId: message.id },
      },
      async () => {
        const text = `${message.subject}\n${message.bodyText ?? ''}`.slice(
          0,
          2000,
        );
        const kind = requestedDocument(text);
        const settings = (await deps.settings.read()).value;
        const person = await byPersonalEmail(message.from.address);
        if (!person) {
          // Not a registered address: nothing about anyone in the summary or the reply.
          await deps
            .mail()
            .leaveUnmatched(
              message.id,
              kind ? 'documentRequest' : 'other',
              `来自未登记地址 ${message.from.address}${kind ? `，${REQUEST_SUMMARY[kind]}` : ''}。未核实身份，回复草稿只请对方从登记的邮箱来信或联系人事部。`,
            );
          await deps.mail().draftReply({
            replyTo: message.id,
            body: [
              '你好：',
              '',
              '为保护员工的个人信息，我们只回复员工在公司登记的联系邮箱的来信。请从你登记的邮箱来信，或直接联系人事部。',
              '',
              settings.senderName,
            ].join('\n'),
          });
          return { output: { mailId: message.id, employeeId: null } };
        }
        await deps.mail().link({
          id: message.id,
          refType: 'employee',
          refId: person.id,
          intent: kind ?? 'question',
          summary: `${person.name}从登记的个人邮箱来信，${kind ? REQUEST_SUMMARY[kind] : '提出问题'}。${
            kind === 'incomeCertificate'
              ? '收入证明含薪资，由薪酬专员确认金额后发送。'
              : kind
                ? 'HR 管理员确认后发送。'
                : ''
          }`,
        });
        const draft = await deps.mail().draftReply({
          replyTo: message.id,
          body: replyText(person.name, kind, settings.senderName),
          proposal: kind
            ? ({
                kind: 'document',
                document: kind,
                employeeId: person.id,
              } satisfies DocumentProposal)
            : null,
        });
        const payroll = kind === 'incomeCertificate' || kind === 'payslip';
        await deps.notify({
          key: `mail:${message.id}:departed`,
          userIds: await deps.holdersOf(payroll ? 'hr.payroll' : 'hr.admin'),
          message: 'mailDepartedRequest',
          params: { request: kind ? DOCUMENT_TITLES[kind] : '来信' },
          path: `/talent/mail?mailbox=hr`,
        });
        return {
          output: {
            mailId: message.id,
            employeeId: person.id,
            draftId: draft.id,
          },
        };
      },
    );
    const after = await deps.mail().row(message.id);
    if (after.status === 'received')
      await deps
        .mail()
        .leaveUnmatched(message.id, null, '未自动识别，请人工归类。');
  }

  async function canAdminister(ctx: ActorContext) {
    return ctx.authz.can(PERSONNEL_SETTINGS_AUTH).catch(() => false);
  }
  async function canPay(ctx: ActorContext) {
    return Boolean(
      await tryAuthorizeAction(ctx.authz, PAYROLL, 'calculate').catch(
        () => false,
      ),
    );
  }

  /** The documents that state pay: only payroll drafts, sends and sees their mail. */
  const PAY_DOCUMENTS = new Set<string>(['incomeCertificate', 'payslip']);

  const handler: MailHandler = {
    // 按邮箱用途授权 (mail/resources.ts): the 人事邮箱 is talent.mailHr.
    async canView(ctx) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.hr, 'view'),
      );
    },
    async canSend(ctx) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.hr, 'send'),
      );
    },
    // Those who sort the mailbox (assign: HR administrators) see all of it; payroll only the mail about pay.
    async canSee(ctx, mail) {
      if (await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.hr, 'assign'))
        return true;
      const document = (mail.proposal as { document?: unknown } | null)
        ?.document;
      const about = typeof document === 'string' ? document : mail.aiIntent;
      return Boolean(about && PAY_DOCUMENTS.has(about));
    },
    // 待归类 · 挂到单据: an employee (those who sort the 人事邮箱 are HR administrators).
    async linkTargets(_ctx, query) {
      let q = database
        .query()
        .selectFrom('employees')
        .select(['id', 'name', 'employeeNo', 'status']);
      if (query)
        q = q.where((eb) =>
          eb.or([
            eb('name', 'like', `%${query}%`),
            eb('employeeNo', 'like', `%${query}%`),
          ]),
        );
      const rows = await q.orderBy('employeeNo', 'asc').limit(20).execute();
      return rows.map((r) => ({
        refType: 'employee',
        refId: str(r.id),
        label: `${str(r.name)}（${str(r.employeeNo)}）`,
        hint: str(r.status) === 'leave' ? 'departed' : null,
      }));
    },
    async linkTarget(_ctx, refType, refId) {
      if (refType !== 'employee') return null;
      const r = await employee(refId);
      return r
        ? {
            refType,
            refId,
            label: `${str(r.name)}（${str(r.employeeNo)}）`,
            hint: str(r.status) === 'leave' ? 'departed' : null,
          }
        : null;
    },
    async recipients() {
      return deps.holdersOf('hr.admin');
    },
    onUnmatched: sort,
    onReply: (message) => sort(message),
    /** The document and its link are made now, by the person allowed to send this kind. */
    async prepareSend(ctx, draft) {
      const body = draft.bodyText ?? '';
      const proposal = proposalOf(draft);
      if (!proposal) return { text: body, storedText: body };
      if (/https?:\/\/|www\./iu.test(body))
        throw new HrError('DOCUMENT_REPLY_LINK_NOT_ALLOWED', 400);
      const amounts =
        proposal.document === 'incomeCertificate' ||
        proposal.document === 'payslip';
      if (amounts ? !(await canPay(ctx)) : !(await canAdminister(ctx)))
        throw new HrError(
          amounts ? 'DOCUMENT_PAYROLL_ONLY' : 'DOCUMENT_HR_ONLY',
          403,
        );
      const row = await employee(proposal.employeeId);
      const to = draft.to[0] ?? '';
      // Only to the employee's registered address.
      if (!row?.personalEmail || str(row.personalEmail) !== to.toLowerCase())
        throw new HrError('DOCUMENT_RECIPIENT_NOT_REGISTERED', 409);
      const doc = await documentFor(proposal.document, proposal.employeeId);
      const share = await deps.shares.create({
        kind: proposal.document,
        employeeId: proposal.employeeId,
        fileName: doc.file,
        bytes: doc.bytes,
        recipientAddress: to,
        createdBy: ctx.userId,
      });
      const marker = `【${DOCUMENT_TITLES[proposal.document]}链接已发送，${share.expiresAt.toISOString().slice(0, 10)} 前有效】`;
      return {
        text: body.includes(DOCUMENT_LINK_PLACEHOLDER)
          ? body.replace(DOCUMENT_LINK_PLACEHOLDER, share.url)
          : `${body}\n\n${share.url}`,
        storedText: body.includes(DOCUMENT_LINK_PLACEHOLDER)
          ? body.replace(DOCUMENT_LINK_PLACEHOLDER, marker)
          : `${body}\n\n${marker}`,
      };
    },
  };

  const checklist: ChecklistProvider = {
    key: 'departedContact',
    kinds: ['offboard'],
    async items(ctx): Promise<ProviderItem[]> {
      const employeeId =
        ctx.employee?.id ?? ctx.action?.employeeId ?? ctx.event?.employeeId;
      if (!employeeId) return [];
      const fromAction = ctx.action?.id
        ? await database
            .query()
            .selectFrom('personnelActions')
            .select(['personalEmail'])
            .where('id', '=', ctx.action.id)
            .executeTakeFirst()
        : undefined;
      const row = await employee(employeeId);
      const given = Boolean(fromAction?.personalEmail || row?.personalEmail);
      // The address itself is not shown: the checklist is read by managers too.
      return [
        {
          key: 'personalEmail',
          code: given ? 'personalEmailGiven' : 'personalEmailMissing',
          params: {},
          status: given ? 'auto' : 'todo',
          link: null,
        },
      ];
    },
  };

  return {
    handler,
    checklist,
    template,
    async getTemplate(ctx: ActorContext) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      return template();
    },
    /** An HR administrator saves and confirms the template; certificates are mailed only once it is confirmed. */
    async confirmTemplate(ctx: ActorContext, input: unknown) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const text = (input as { separationTemplate?: unknown } | null)
        ?.separationTemplate;
      if (typeof text !== 'string' || !text.trim() || text.length > 4000)
        throw new HrError('INVALID_INPUT', 400);
      await saveTemplate({
        separationTemplate: text.trim(),
        confirmedAt: new Date().toISOString(),
        confirmedBy: ctx.userId,
      });
      return template();
    },
    /** Whether the caller may send a reply carrying this document (payroll for amounts, else HR administrators). */
    async maySend(ctx: ActorContext, document: string) {
      if (!(DOCUMENT_KINDS as readonly string[]).includes(document))
        throw new HrError('INVALID_INPUT', 400);
      const amounts =
        document === 'incomeCertificate' || document === 'payslip';
      return {
        canSend: amounts ? await canPay(ctx) : await canAdminister(ctx),
      };
    },
    /** Payroll previews the income a certificate would state (never HR administrators). */
    async incomePreview(ctx: ActorContext, employeeId: string) {
      if (!(await canPay(ctx))) throw new HrError('DOCUMENT_PAYROLL_ONLY', 403);
      return incomeMonths(employeeId);
    },
    /** Job event: a 离职单 took effect. */
    async onOffboard(event: JobEvent) {
      if (event.eventType !== 'offboard') return;
      const row = await employee(event.employeeId);
      if (!row?.personalEmail) return;
      const current = await template();
      if (!current.confirmedAt) {
        await deps.notify({
          key: `departedTemplate:${event.employeeId}`,
          userIds: await deps.holdersOf('hr.admin'),
          message: 'departedTemplateRequired',
          params: { name: str(row.name) },
          path: '/settings/mail',
        });
        return;
      }
      await mailDocument(
        'separationCertificate',
        event.employeeId,
        current.confirmedBy,
      );
    },
    /** A payroll cycle was published: employees who left in its month get their payslip. */
    async onPayslipsPublished(cycleId: string) {
      const cycle = await database
        .query()
        .selectFrom('payrollCycles')
        .select(['month'])
        .where('id', '=', cycleId)
        .executeTakeFirst();
      if (!cycle) return;
      const month = str(cycle.month);
      const rows = await database
        .query()
        .selectFrom('payslips')
        .innerJoin('employees', 'employees.id', 'payslips.employeeId')
        .select(['employees.id as id', 'employees.leaveDate as leaveDate'])
        .where('payslips.cycleId', '=', cycleId)
        .where('employees.status', '=', 'leave')
        .where('employees.personalEmail', 'is not', null)
        .execute();
      for (const r of rows)
        if (r.leaveDate && day(r.leaveDate).slice(0, 7) <= month)
          await mailDocument('payslip', str(r.id), null);
    },
  };
}

export type DepartedMail = ReturnType<typeof createDepartedMail>;

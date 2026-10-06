/**
 * 审核邮箱与审核请求 (V3-11 客户审核问询): a customer's quality engineer asks
 * by mail for audit material; the certification steward recognises the
 * request, a person confirms its scope and builds the pack, and the reply
 * carries only a share link that needs a one-time code.
 *
 * - 审核问询分拣与准备 (`certificationSteward.mailSortAudit`, as its owner):
 *   a message outside any thread that asks for audit material becomes an
 *   `auditRequests` row with `reviewStatus = draft` — the customer (a sender
 *   domain listed on 设置 / 邮件, else the sender's organisation), the scope
 *   read from the text (departments and positions by name; what could not
 *   be matched is listed for the person to confirm), the materials, the due
 *   date ("3 个工作日内") and what is never provided (contact details, ID
 *   numbers, salary). The pre-audit risks are listed as the owner may read
 *   them and kept as a snapshot. hr.admin and hr.auditor are notified.
 *   Anything else waits in 待归类.
 * - 审核回复起草 (`certificationSteward.mailReplyAudit`): once the pack is
 *   built, the reply says which material is provided, how long the link
 *   lasts and how to open it, and what is not provided. It never contains
 *   the risks, a link or an attachment: the link is created when a person
 *   sends the reply, and a draft carrying any other link is refused.
 * - The share page (`/audit-pack/:token`): the link is stored as a hash and
 *   lasts 7 days; opening it asks for a code sent only to the requester's
 *   address (10 minutes, 5 attempts); each download is logged; a revoked or
 *   expired link opens nothing.
 *
 * Mail content is data: it only selects among these outcomes.
 */
import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import type { DatabaseManager } from '@nocobase/db';

import type { AutomationRunContext } from '../automation.js';
import { authorizeAction, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import type { AuditRisk, AuditScope } from '../profile/audit.js';
import { HrError, newId, str } from '../shared.js';
import type { MailService } from './service.js';
import type { MailSettingsService } from './settings.js';
import type { MailHandler, MailMessage } from './types.js';

export const MAIL_SORT_AUDIT = 'certificationSteward.mailSortAudit';
export const MAIL_REPLY_AUDIT = 'certificationSteward.mailReplyAudit';

const RESOURCE = 'talent.auditRequest';
export const SHARE_DAYS = 7;
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
const CODE_RESEND_SECONDS = 60;
/** Where the reply's share link goes; replaced only when a person sends it. */
export const SHARE_LINK_PLACEHOLDER = '【分享链接在发送时生成】';

export const AUDIT_MATERIALS = [
  'certificates',
  'trainingRecords',
  'competencyMatrix',
  'revisionTraining',
  'qualificationLedger',
] as const;
export type AuditMaterial = (typeof AUDIT_MATERIALS)[number];

const MATERIAL_LABEL: Record<AuditMaterial, string> = {
  certificates: '持证清单（证书编号与有效期）',
  trainingRecords: '培训与考试记录',
  competencyMatrix: '能力矩阵（岗位要求与当前等级）',
  revisionTraining: '作业文件升版后的差异培训完成情况',
  qualificationLedger: '培训与资格台账',
};

const MATERIAL_WORDS: [AuditMaterial, RegExp][] = [
  ['certificates', /持证|证书|上岗证|资格证/u],
  ['trainingRecords', /培训记录|培训|考试/u],
  ['competencyMatrix', /能力矩阵|技能矩阵|能力评定/u],
  ['revisionTraining', /升版|差异培训|变更培训/u],
  ['qualificationLedger', /台账/u],
];

/** What a customer may ask for but never receives. */
const EXCLUDED_WORDS: [string, RegExp][] = [
  ['联系方式', /联系方式|手机|电话|微信/u],
  ['证件号码', /身份证|证件号/u],
  ['薪资', /薪资|工资|收入|薪酬/u],
  ['住址', /住址|家庭地址/u],
];

const REQUEST_WORDS = /审核|审计|资料|清单|记录|证书|持证|培训|台账|资质|材料/u;

export interface AuditRequestScope extends AuditScope {
  materials: AuditMaterial[];
}

export interface AuditRequestRead {
  materials: AuditMaterial[];
  excluded: string[];
  dueDate: string | null;
}

/** Workdays after a date (Saturday and Sunday skipped). */
export function addWorkdays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/** Materials, refused items and the due date a request names. */
export function readAuditRequest(
  text: string,
  received: string,
): AuditRequestRead {
  const materials = MATERIAL_WORDS.filter(([, re]) => re.test(text)).map(
    ([m]) => m,
  );
  const excluded = EXCLUDED_WORDS.filter(([, re]) => re.test(text)).map(
    ([name]) => name,
  );
  let dueDate: string | null = null;
  const workdays = /(\d+|[一二三四五六七八九十])\s*个?工作日/u.exec(text);
  const zh = '一二三四五六七八九十';
  if (workdays) {
    const n = /\d/u.test(workdays[1])
      ? Number(workdays[1])
      : zh.indexOf(workdays[1]) + 1;
    if (n > 0 && n <= 60) dueDate = addWorkdays(received, n);
  } else {
    const date =
      /(?:(20\d{2})\s*年\s*)?(1[0-2]|0?[1-9])\s*月\s*([12]\d|3[01]|0?[1-9])\s*日/u.exec(
        text,
      );
    if (date) {
      const year = date[1] ?? received.slice(0, 4);
      dueDate = `${year}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
    }
  }
  return {
    materials: materials.length
      ? materials
      : ['certificates', 'trainingRecords'],
    excluded,
    dueDate,
  };
}

/**
 * The sentences that ask for material: the scope is read from these only, so
 * a salutation ("启衡精密人力资源部：") or a signature never becomes part of it.
 */
export function requestSentences(text: string): string {
  return text
    .split(/[\n。！？!?；;]+/u)
    .map((s) => s.trim())
    .filter((s) => s && REQUEST_WORDS.test(s))
    .join('。');
}

const domainOf = (address: string): string =>
  (address.split('@')[1] ?? '').toLowerCase();

const matchesDomain = (address: string, domain: string): boolean => {
  const own = domainOf(address);
  return own === domain || own.endsWith(`.${domain}`);
};

/** 远航汽车质量部 蒋涛 → 远航汽车. */
function organisationOf(name: string | null): string | null {
  if (!name) return null;
  const org =
    /^(.+?(?:汽车|集团|股份|有限公司|公司|科技|电子|制造|工业|实业))/u.exec(
      name.trim(),
    );
  return org ? org[1] : null;
}

/** Milliseconds of a stored date (a Date or an ISO string); 0 when unset. */
const time = (value: unknown): number =>
  value instanceof Date
    ? value.getTime()
    : typeof value === 'string' || typeof value === 'number'
      ? new Date(value).getTime()
      : 0;

const iso = (value: unknown): string | null =>
  value ? new Date(value as string | Date).toISOString() : null;

const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

function maskAddress(address: string): string {
  const [local = '', host = ''] = address.split('@');
  return `${local.slice(0, 1)}***@${host}`;
}

const bodyLines = (text: string | null): string =>
  (text ?? '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('>'))
    .join('\n');

type Run = <T extends Record<string, unknown>>(
  key: string,
  options: { dedupeKey: string; triggerRef: Record<string, unknown> },
  work: (
    run: AutomationRunContext,
  ) => Promise<{ status?: 'succeeded' | 'skipped'; output?: T }>,
) => Promise<unknown>;

export interface AuditServices {
  resolveScope(input: {
    text?: unknown;
    departmentIds?: unknown;
    positionIds?: unknown;
  }): Promise<AuditScope>;
  risks(ctx: ActorContext, scope: AuditScope): Promise<AuditRisk[]>;
  pack(
    ctx: ActorContext,
    scope: AuditScope,
    via?: string,
    /** The material types to include; all of them when left out. */
    materials?: readonly string[],
  ): Promise<{
    bytes: Uint8Array;
    fileName: string;
    people: number;
    risks: AuditRisk[];
    sheets: string[];
  }>;
}

export function createAuditMail(deps: {
  database: DatabaseManager;
  mail: MailService;
  settings: MailSettingsService;
  run: Run;
  audit: () => AuditServices;
  storePack: (pack: { bytes: Uint8Array; fileName: string }) => Promise<string>;
  readPack: (
    fileId: string,
  ) => Promise<{ bytes: Uint8Array; filename: string } | null>;
  /** hr.admin and hr.auditor: who hears about a request. */
  reviewers: () => Promise<string[]>;
  departmentTitle: (id: string) => Promise<string>;
  positionTitle: (id: string) => Promise<string>;
  publicUrl: (path: string) => string;
  companyName: () => string;
  today: () => string;
  now: () => Date;
  notify: (input: {
    key: string;
    userIds: string[];
    message: string;
    params: Record<string, string>;
    path: string;
  }) => Promise<void>;
}) {
  const { database, mail } = deps;

  function present(row: Record<string, unknown>) {
    const scope = (row.scope ?? {}) as Partial<AuditRequestScope>;
    const now = deps.now().getTime();
    const expires = row.shareExpiresAt ? time(row.shareExpiresAt) : 0;
    return {
      id: str(row.id),
      customerName: str(row.customerName),
      requesterAddress: str(row.requesterAddress),
      scope: {
        departmentIds: scope.departmentIds ?? [],
        positionIds: scope.positionIds ?? [],
        materials: (scope.materials ?? []).filter((m): m is AuditMaterial =>
          (AUDIT_MATERIALS as readonly string[]).includes(m),
        ),
      },
      excludedRequests: (row.excludedRequests ?? []) as string[],
      unmatchedNames: (row.unmatchedNames ?? []) as string[],
      dueDate: row.dueDate ? str(row.dueDate).slice(0, 10) : null,
      status: str(row.status),
      reviewStatus: str(row.reviewStatus),
      risks: (row.risks ?? []) as AuditRisk[],
      packFileName: row.packFileName ? str(row.packFileName) : null,
      hasPack: Boolean(row.packFileId),
      share: row.shareTokenHash
        ? {
            expiresAt: iso(row.shareExpiresAt),
            revokedAt: iso(row.shareRevokedAt),
            active: !row.shareRevokedAt && expires > now,
          }
        : null,
      downloads: (row.downloads ?? []) as { at: string; ip: string }[],
      sourceMailId: row.sourceMailId ? str(row.sourceMailId) : null,
      confirmedBy: row.confirmedBy ? str(row.confirmedBy) : null,
      confirmedAt: iso(row.confirmedAt),
      createdAt: iso(row.createdAt),
    };
  }
  type AuditRequest = ReturnType<typeof present>;

  async function rowOf(id: string): Promise<Record<string, unknown>> {
    const row = await database
      .query()
      .selectFrom('auditRequests')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('AUDIT_REQUEST_NOT_FOUND', 404);
    return row;
  }

  async function scopeLabel(scope: AuditScope): Promise<string> {
    const departments = await Promise.all(
      scope.departmentIds.map((id) => deps.departmentTitle(id)),
    );
    const positions = await Promise.all(
      scope.positionIds.map((id) => deps.positionTitle(id)),
    );
    const roles = positions.join('、') || '全部岗位';
    // 中文与拉丁字母之间留一个空格：……车间的 CNC 操作工.
    return `${departments.join('、') || '全部部门'}的${/^[A-Za-z0-9]/u.test(roles) ? ' ' : ''}${roles}`;
  }

  async function update(id: string, values: Record<string, unknown>) {
    await database
      .query()
      .updateTable('auditRequests')
      .set({ ...values, updatedAt: deps.now() })
      .where('id', '=', id)
      .execute();
  }

  // ---------- 审核问询分拣与准备 ----------

  async function sort(message: MailMessage, attempt?: string) {
    await deps.run<{ mailId: string; requestId: string | null }>(
      MAIL_SORT_AUDIT,
      {
        dedupeKey: attempt ? `${message.id}:${attempt}` : message.id,
        triggerRef: { mailId: message.id },
      },
      async (run) => {
        const settings = (await deps.settings.read()).value.mailboxes.audit;
        const allowed = settings.allowedSenderDomains;
        if (
          allowed.length &&
          !allowed.some((d) => matchesDomain(message.from.address, d))
        ) {
          await mail.leaveUnmatched(
            message.id,
            'other',
            `发件人 ${message.from.address} 不在审核邮箱的发件人范围内，未做识别。`,
          );
          run.summarize('发件人不在审核邮箱的发件人范围内');
          return { status: 'skipped' as const };
        }
        const text = `${message.subject}\n${bodyLines(message.bodyText)}`.slice(
          0,
          4000,
        );
        if (!REQUEST_WORDS.test(text)) {
          await mail.leaveUnmatched(
            message.id,
            'other',
            `来自 ${message.from.address}，不是审核资料请求，请人工判断。`,
          );
          run.summarize('来信不是审核资料请求，已放入待归类');
          return { output: { mailId: message.id, requestId: null } };
        }
        const received =
          (message.receivedAt ?? message.createdAt).slice(0, 10) ||
          deps.today();
        const read = readAuditRequest(text, received);
        const scope = await deps
          .audit()
          .resolveScope({ text: requestSentences(text) });
        const unmatched = [
          ...(scope.departmentIds.length ? [] : ['部门']),
          ...(scope.positionIds.length ? [] : ['岗位']),
        ];
        const customerName =
          settings.vendors.find((v) =>
            matchesDomain(message.from.address, v.domain),
          )?.vendorName ??
          organisationOf(message.from.name) ??
          domainOf(message.from.address);
        const risks =
          scope.departmentIds.length || scope.positionIds.length
            ? await deps
                .audit()
                .risks(run.owner, scope)
                .catch(() => [])
            : [];
        const id = newId();
        const now = deps.now();
        await database
          .query()
          .insertInto('auditRequests')
          .values({
            id,
            customerName: customerName.slice(0, 200),
            requesterAddress: message.from.address.toLowerCase(),
            scope: { ...scope, materials: read.materials },
            excludedRequests: read.excluded,
            unmatchedNames: unmatched,
            dueDate: read.dueDate,
            status: 'draft',
            reviewStatus: 'draft',
            risks,
            packFileId: null,
            packFileName: null,
            shareTokenHash: null,
            shareExpiresAt: null,
            shareRevokedAt: null,
            shareCodeHash: null,
            shareCodeExpiresAt: null,
            shareCodeAttempts: 0,
            shareCodeSentAt: null,
            downloads: [],
            sourceMailId: message.id,
            createdBy: run.owner.userId,
            confirmedBy: null,
            confirmedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
        const range = await scopeLabel(scope);
        await mail.link({
          id: message.id,
          refType: 'auditRequest',
          refId: id,
          intent: 'auditRequest',
          summary: [
            `${customerName}请求审核资料：${range}；资料为${read.materials.map((m) => MATERIAL_LABEL[m]).join('、')}`,
            read.dueDate ? `，期限 ${read.dueDate}` : '',
            '。',
            read.excluded.length
              ? `另要${read.excluded.join('、')}，不在提供范围内。`
              : '',
            unmatched.length
              ? `${unmatched.join('和')}没能识别，请确认范围。`
              : '',
            risks.length ? `审核前有 ${risks.length} 条风险待处理。` : '',
          ].join(''),
        });
        await deps.notify({
          key: `mail:${message.id}:auditRequest`,
          userIds: await deps.reviewers(),
          message: 'mailAuditRequest',
          params: {
            customer: customerName,
            due: read.dueDate ?? '—',
            risks: String(risks.length),
          },
          path: `/talent/audit?tab=requests&request=${id}`,
        });
        run.summarize(
          `${customerName} 的审核资料请求已建立（风险 ${risks.length} 条）`,
        );
        return { output: { mailId: message.id, requestId: id } };
      },
    );
    const after = await mail.row(message.id);
    if (after.status === 'received')
      await mail.leaveUnmatched(message.id, null, '未自动识别，请人工归类。');
  }

  async function reply(message: MailMessage) {
    if (message.refType !== 'auditRequest' || !message.refId) return;
    const request = present(await rowOf(message.refId));
    await mail.link({
      id: message.id,
      refType: 'auditRequest',
      refId: request.id,
      intent: 'followUp',
      summary: `${request.customerName}就审核请求回信。`,
    });
    await deps.notify({
      key: `mail:${message.id}:auditReply`,
      userIds: await deps.reviewers(),
      message: 'mailReplyReceived',
      params: { vendor: request.customerName, subject: message.subject },
      path: `/talent/audit?tab=requests&request=${request.id}`,
    });
  }

  // ---------- 审核回复起草 ----------

  async function draftReply(
    request: AuditRequest,
    people: number,
    packFileId: string,
  ) {
    if (!request.sourceMailId) return null;
    const sourceMailId = request.sourceMailId;
    let draftId: string | null = null;
    await deps.run(
      MAIL_REPLY_AUDIT,
      {
        dedupeKey: `${request.id}:${packFileId}`,
        triggerRef: { requestId: request.id, mailId: sourceMailId },
      },
      async (run) => {
        const settings = (await deps.settings.read()).value;
        const range = await scopeLabel(request.scope);
        const body = [
          `${request.customerName}：`,
          '',
          `关于你们的审核资料请求，我们已按以下范围准备好资料：`,
          `- 范围：${range}（${people} 人）`,
          ...request.scope.materials.map((m) => `- ${MATERIAL_LABEL[m]}`),
          '',
          `资料通过下方分享链接提供，链接 ${SHARE_DAYS} 天内有效；打开时需输入发到 ${request.requesterAddress} 的验证码（${CODE_MINUTES} 分钟内有效）。本邮件不带附件。`,
          ...(request.excludedRequests.length
            ? ['', `${request.excludedRequests.join('、')}不在提供范围内。`]
            : []),
          '',
          SHARE_LINK_PLACEHOLDER,
          '',
          settings.senderName,
        ].join('\n');
        const draft = await mail.draftReply({ replyTo: sourceMailId, body });
        draftId = draft.id;
        await deps.notify({
          key: `mail:${draft.id}:auditDraft`,
          userIds: [
            ...new Set([run.owner.userId, ...(await deps.reviewers())]),
          ],
          message: 'mailAuditDraftReady',
          params: { customer: request.customerName },
          path: `/talent/audit?tab=requests&request=${request.id}`,
        });
        run.summarize(`${request.customerName} 审核请求的回复已起草`);
        return { output: { requestId: request.id, draftId: draft.id } };
      },
    );
    return draftId;
  }

  // ---------- The request, for people ----------

  const service = {
    async list(ctx: ActorContext) {
      await authorizeAction(ctx.authz, RESOURCE, 'view');
      const rows = await database
        .query()
        .selectFrom('auditRequests')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .execute();
      return rows.map((r) => present(r as Record<string, unknown>));
    },

    async get(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'view');
      const request = present(await rowOf(id));
      return {
        ...request,
        scopeLabel: await scopeLabel(request.scope),
        can: {
          confirm: Boolean(
            await tryAuthorizeAction(ctx.authz, RESOURCE, 'confirm'),
          ),
          share: Boolean(
            await tryAuthorizeAction(ctx.authz, RESOURCE, 'share'),
          ),
          revoke: Boolean(
            await tryAuthorizeAction(ctx.authz, RESOURCE, 'revoke'),
          ),
        },
      };
    },

    /** Edits the recognised scope; a confirmed scope goes back to draft. */
    async updateScope(ctx: ActorContext, id: string, input: unknown) {
      await authorizeAction(ctx.authz, RESOURCE, 'confirm');
      const request = present(await rowOf(id));
      if (!['draft', 'confirmed'].includes(request.status))
        throw new HrError('AUDIT_REQUEST_LOCKED', 409);
      const body = (input ?? {}) as Record<string, unknown>;
      const ids = (v: unknown) =>
        Array.isArray(v)
          ? v
              .map((x) => str(x))
              .filter(Boolean)
              .slice(0, 100)
          : null;
      const departmentIds =
        ids(body.departmentIds) ?? request.scope.departmentIds;
      const positionIds = ids(body.positionIds) ?? request.scope.positionIds;
      const materials = (ids(body.materials) ?? request.scope.materials).filter(
        (m): m is AuditMaterial =>
          (AUDIT_MATERIALS as readonly string[]).includes(m),
      );
      const checked = await deps
        .audit()
        .resolveScope({ departmentIds, positionIds });
      const customerName =
        typeof body.customerName === 'string' && body.customerName.trim()
          ? body.customerName.trim().slice(0, 200)
          : request.customerName;
      const dueDate =
        body.dueDate === null
          ? null
          : typeof body.dueDate === 'string' &&
              /^\d{4}-\d{2}-\d{2}$/u.test(body.dueDate)
            ? body.dueDate
            : request.dueDate;
      await update(id, {
        customerName,
        dueDate,
        scope: { ...checked, materials },
        unmatchedNames: [],
        status: 'draft',
        reviewStatus: 'draft',
        confirmedBy: null,
        confirmedAt: null,
      });
      return service.get(ctx, id);
    },

    async confirm(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'confirm');
      const request = present(await rowOf(id));
      if (request.status !== 'draft')
        throw new HrError('AUDIT_REQUEST_LOCKED', 409);
      if (
        (!request.scope.departmentIds.length &&
          !request.scope.positionIds.length) ||
        !request.scope.materials.length
      )
        throw new HrError('AUDIT_SCOPE_EMPTY', 400);
      await update(id, {
        status: 'confirmed',
        reviewStatus: 'confirmed',
        unmatchedNames: [],
        confirmedBy: ctx.userId,
        confirmedAt: deps.now(),
      });
      return service.get(ctx, id);
    },

    /** Builds the pack for the confirmed scope as the caller may read it, then drafts the reply. */
    async buildPack(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'confirm');
      const request = present(await rowOf(id));
      if (
        request.reviewStatus !== 'confirmed' ||
        !['confirmed', 'packReady'].includes(request.status)
      )
        throw new HrError('AUDIT_SCOPE_NOT_CONFIRMED', 409);
      // Only the material types the scope names (V3-11: 审核包只含 scope 内的资料).
      const pack = await deps
        .audit()
        .pack(ctx, request.scope, 'auditRequest', request.scope.materials);
      const fileId = await deps.storePack(pack);
      await update(id, {
        status: 'packReady',
        packFileId: fileId,
        packFileName: pack.fileName,
        risks: pack.risks,
      });
      await draftReply(request, pack.people, fileId);
      return service.get(ctx, id);
    },

    async revoke(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'revoke');
      const request = present(await rowOf(id));
      if (!request.share) throw new HrError('AUDIT_SHARE_NONE', 409);
      await update(id, {
        shareRevokedAt: deps.now(),
        shareCodeHash: null,
        shareCodeExpiresAt: null,
      });
      return service.get(ctx, id);
    },

    async close(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'confirm');
      await rowOf(id);
      await update(id, { status: 'closed' });
      return service.get(ctx, id);
    },

    async pack(ctx: ActorContext, id: string) {
      await authorizeAction(ctx.authz, RESOURCE, 'view');
      await authorizeAction(ctx.authz, 'talent.audit', 'exportAuditPack');
      const row = await rowOf(id);
      const file = row.packFileId
        ? await deps.readPack(str(row.packFileId))
        : null;
      if (!file) throw new HrError('NOT_FOUND', 404);
      return file;
    },
  };

  // ---------- The share link, for the customer ----------

  async function byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,100}$/u.test(token))
      throw new HrError('AUDIT_LINK_INVALID', 404);
    const row = await database
      .query()
      .selectFrom('auditRequests')
      .selectAll()
      .where('shareTokenHash', '=', hash(token))
      .executeTakeFirst();
    const now = deps.now().getTime();
    if (
      !row ||
      row.shareRevokedAt ||
      !row.shareExpiresAt ||
      time(row.shareExpiresAt) <= now ||
      !row.packFileId
    )
      throw new HrError('AUDIT_LINK_INVALID', 404);
    return row as Record<string, unknown>;
  }

  const share = {
    async view(token: string) {
      const row = await byToken(token);
      return {
        customerName: str(row.customerName),
        company: deps.companyName(),
        requester: maskAddress(str(row.requesterAddress)),
        expiresAt: iso(row.shareExpiresAt),
        fileName: str(row.packFileName ?? 'audit-pack.zip'),
      };
    },

    /** Sends a one-time code to the requester's address only. */
    async sendCode(token: string) {
      const row = await byToken(token);
      const now = deps.now();
      if (
        row.shareCodeSentAt &&
        now.getTime() - time(row.shareCodeSentAt) < CODE_RESEND_SECONDS * 1000
      )
        throw new HrError('AUDIT_CODE_TOO_SOON', 409);
      const id = str(row.id);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const subject = `${deps.companyName()}客户审核包验证码`;
      const state = await mail.sendDirect({
        purpose: 'audit',
        idempotencyKey: `audit-code:${id}:${now.getTime()}`,
        to: str(row.requesterAddress),
        subject,
        text: `验证码：${code}\n\n${CODE_MINUTES} 分钟内有效，用于打开${deps.companyName()}发给你的客户审核包。如非本人操作，请忽略本邮件。`,
        storedText: `验证码：******（${CODE_MINUTES} 分钟内有效，不保存原文）`,
        refType: 'auditRequest',
        refId: id,
      });
      if (state !== 'sent') throw new HrError('AUDIT_CODE_UNAVAILABLE', 409);
      await update(id, {
        shareCodeHash: hash(`${id}:${code}`),
        shareCodeExpiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
        shareCodeAttempts: 0,
        shareCodeSentAt: now,
      });
      return { sentTo: maskAddress(str(row.requesterAddress)) };
    },

    /** The pack, for a valid code; the code is used up and the download logged. */
    async download(token: string, code: unknown, ip: string) {
      const row = await byToken(token);
      const id = str(row.id);
      const attempts = Number(row.shareCodeAttempts ?? 0);
      if (attempts >= CODE_ATTEMPTS)
        throw new HrError('AUDIT_CODE_LOCKED', 409);
      const now = deps.now();
      const valid =
        typeof code === 'string' &&
        /^\d{6}$/u.test(code) &&
        Boolean(row.shareCodeHash) &&
        row.shareCodeExpiresAt !== null &&
        time(row.shareCodeExpiresAt) > now.getTime() &&
        timingSafeEqual(
          Buffer.from(hash(`${id}:${code}`)),
          Buffer.from(str(row.shareCodeHash)),
        );
      if (!valid) {
        await update(id, { shareCodeAttempts: attempts + 1 });
        throw new HrError('AUDIT_CODE_INVALID', 400);
      }
      const file = await deps.readPack(str(row.packFileId));
      if (!file) throw new HrError('AUDIT_LINK_INVALID', 404);
      const downloads = [
        ...((row.downloads ?? []) as { at: string; ip: string }[]),
        { at: now.toISOString(), ip: ip.slice(0, 64) },
      ].slice(-200);
      await update(id, {
        shareCodeHash: null,
        shareCodeExpiresAt: null,
        shareCodeAttempts: 0,
        downloads,
      });
      await database
        .query()
        .insertInto('auditExports')
        .values({
          id: newId(),
          kind: 'auditPackShare',
          actorUserId: 'external',
          scope: { requestId: id },
          fileName: file.filename,
          summary: `${str(row.customerName)}（${str(row.requesterAddress)}）通过分享链接下载客户审核包，来源 ${ip || '未知'}`,
          via: 'share',
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return file;
    },
  };

  // ---------- The mailbox ----------

  const handler: MailHandler = {
    async canView(ctx) {
      return Boolean(await tryAuthorizeAction(ctx.authz, RESOURCE, 'view'));
    },
    async canSend(ctx) {
      return Boolean(await tryAuthorizeAction(ctx.authz, RESOURCE, 'share'));
    },
    recipients: deps.reviewers,
    onUnmatched: sort,
    onReply: reply,
    /** The share link is made only now; the thread keeps the reply without it. */
    async prepareSend(ctx, draft) {
      const body = draft.bodyText ?? '';
      if (draft.refType !== 'auditRequest' || !draft.refId)
        return { text: body, storedText: body };
      // Only the link the server makes may leave in an audit reply.
      if (/https?:\/\/|www\./iu.test(body))
        throw new HrError('AUDIT_REPLY_LINK_NOT_ALLOWED', 400);
      await authorizeAction(ctx.authz, RESOURCE, 'share');
      const request = present(await rowOf(draft.refId));
      if (!request.hasPack) throw new HrError('AUDIT_PACK_MISSING', 409);
      const token = randomBytes(24).toString('base64url');
      const expiresAt = new Date(
        deps.now().getTime() + SHARE_DAYS * 86_400_000,
      );
      const link = deps.publicUrl(`/audit-pack/${token}`);
      const until = `${expiresAt.toISOString().slice(0, 10)} 前有效`;
      const withLink = body.includes(SHARE_LINK_PLACEHOLDER)
        ? body.replace(SHARE_LINK_PLACEHOLDER, link)
        : `${body}\n\n${link}`;
      const stored = body.includes(SHARE_LINK_PLACEHOLDER)
        ? body.replace(SHARE_LINK_PLACEHOLDER, `【分享链接已发送，${until}】`)
        : `${body}\n\n【分享链接已发送，${until}】`;
      return {
        text: withLink,
        storedText: stored,
        onSent: async () => {
          await update(request.id, {
            shareTokenHash: hash(token),
            shareExpiresAt: expiresAt,
            shareRevokedAt: null,
            shareCodeHash: null,
            shareCodeExpiresAt: null,
            shareCodeAttempts: 0,
            status: 'replied',
          });
        },
      };
    },
  };

  return { handler, service, share };
}

export type AuditMail = ReturnType<typeof createAuditMail>;

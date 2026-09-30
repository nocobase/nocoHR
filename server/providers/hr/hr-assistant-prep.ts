/**
 * The HR assistant's proactive work added in V1 step 2:
 *
 * - 转正准备: probations ending within the reminder window get a summary for
 *   the department head and the task owner, each read with that recipient's
 *   own permissions (a head's copy holds no contract), with a link to a
 *   pre-filled regularization form. Once per employee; never raises the action.
 * - 续签准备: contracts entering the largest reminder window get a summary of
 *   the contract history and what HR should check, with a link to the renewal
 *   form. Once per contract; never renews.
 * - 附件识别: an ID card, diploma or contract scan an HR administrator
 *   attaches is read, and the fields that differ from the record become a
 *   pending `source=ai` change request for HR to review. Nothing is written to
 *   the record. The run record keeps field names and confidence only.
 *
 * The facts are gathered by the server; the AI words the summaries (a
 * template when no model is available) and reads the attachment's text.
 * Images need a model that reads images; the configured one is text-only, so
 * an image scan fails with that reason rather than being guessed (V1-02: do
 * not add an OCR library).
 */
import type { NocoBaseDriveManager } from '@nocobase/drive';
import { z } from 'zod';

import { AIUnavailableError } from './ai-runner.js';
import { scopeForUser } from './authorize.js';
import type { AutomationRunContext } from './automation.js';
import type { ComplianceService } from './compliance.js';
import type { HrCoreService } from './core-service.js';
import { documentKind, extractDocumentText } from './document-text.js';
import type { Platform } from './platform.js';
import type { PersonnelSettingsService } from './personnel-settings.js';
import { daysBetween, HrError, newId, str, toDateOnly } from './shared.js';

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;
type Worded = (
  run: AutomationRunContext,
  compose: () => Promise<string>,
  fallback: () => string,
) => Promise<string>;

export interface HrAssistantPrepDeps {
  readonly platform: Platform;
  readonly core: () => HrCoreService;
  readonly settings: () => PersonnelSettingsService;
  readonly drive: () => NocoBaseDriveManager;
  readonly structured: Structured;
  readonly worded: Worded;
  readonly locale: () => string;
  /** V1-02 用工合规检查: open prompts for the employee join the renewal preparation. */
  readonly compliance?: () => ComplianceService;
  /** V3-09: the probationer's learning, read as the recipient; undefined when they may not view it. */
  readonly learning?: (
    ctx: { userId: string; authz: Awaited<ReturnType<typeof scopeForUser>> },
    employeeId: string,
  ) => Promise<Record<string, unknown> | undefined>;
  /** V3-09: the template sentence for the learning part. */
  readonly learningText?: (learning: Record<string, unknown>) => string;
}

const CONFIRM_TEXT: Record<string, string> = {
  probationEvaluation: '试用期评价待主管填写',
  openActions: '有审批中或待生效的人事异动',
  missingEducation: '档案缺少教育经历',
  missingEmergencyContact: '档案缺少紧急联系人',
  pendingProfileChange: '有待审核的信息修改申请',
};
const ATTACHMENT_TEXT_LIMIT = 8000;

export function createHrAssistantPrep(deps: HrAssistantPrepDeps) {
  const { platform, structured, worded } = deps;
  const { database } = platform;

  /** Records that a preparation was sent, atomically: false when it already was. */
  async function claim(key: string): Promise<boolean> {
    const stamp = new Date();
    try {
      await database
        .query()
        .insertInto('hrReminderLog')
        .values({
          id: newId(),
          reminderKey: key,
          sentAt: stamp,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return true;
    } catch {
      return false;
    }
  }
  async function claimed(key: string): Promise<boolean> {
    return Boolean(
      await database
        .query()
        .selectFrom('hrReminderLog')
        .select(['id'])
        .where('reminderKey', '=', key)
        .executeTakeFirst(),
    );
  }

  async function asUser(userId: string) {
    return { userId, authz: await scopeForUser(platform.authz, userId) };
  }

  function summaryFallback(
    kind: 'probation' | 'renewal',
    summary: Record<string, unknown>,
  ): string {
    const confirm = ((summary.toConfirm as string[] | undefined) ?? [])
      .map((key) => CONFIRM_TEXT[key] ?? key)
      .join('；');
    const contracts = summary.contracts as
      | {
          contractNo: string;
          startDate: string;
          endDate: string | null;
          status: string;
        }[]
      | null;
    const history = contracts
      ? contracts
          .map(
            (c) =>
              `${c.contractNo}（${c.startDate} 至 ${c.endDate ?? '无固定期限'}，${c.status}）`,
          )
          .join('；')
      : null;
    const text = (key: string, fallback = '') => {
      const value = summary[key];
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : fallback;
    };
    const head =
      kind === 'probation'
        ? `${text('name')}（${text('position')}，${text('department')}）入职于 ${text('hireDate')}，试用期至 ${text('probationEndDate')}。`
        : `${text('name')}（${text('position')}）入职于 ${text('hireDate')}，已订立固定期限合同 ${text('fixedTermContracts', '0')} 次。`;
    const compliance = (summary.complianceNotes as string[] | undefined) ?? [];
    // V3-09: 试用期内的学习情况.
    const learning =
      kind === 'probation' && summary.learning && deps.learningText
        ? deps.learningText(summary.learning as Record<string, unknown>)
        : null;
    return [
      head,
      // null: this recipient may not see contracts (a head's copy), not "no contract".
      history
        ? `合同：${history}。`
        : contracts === null
          ? '合同信息由 HR 核对。'
          : '尚无劳动合同记录，请 HR 核对签订情况。',
      learning,
      compliance.length ? `合规提示：${compliance.join(' ')}` : null,
      confirm ? `待确认：${confirm}。` : null,
      kind === 'renewal'
        ? '请 HR 核对续签类型与法定要求；是否续签由主管和 HR 决定。'
        : '是否转正由主管和 HR 决定。',
    ]
      .filter(Boolean)
      .join('');
  }

  async function wordSummary(
    run: AutomationRunContext,
    kind: 'probation' | 'renewal',
    summary: Record<string, unknown>,
  ): Promise<string> {
    return worded(
      run,
      async () =>
        (
          await structured(
            run,
            'hrAssistant',
            kind === 'probation' ? '转正准备' : '续签准备',
            `${
              kind === 'probation'
                ? '请为下面这位试用期即将结束的员工写一段转正准备摘要（不超过 300 字）：入职日期、岗位、试用期内的异动、合同（如有）和需要主管确认的事项。'
                : '请为下面这份即将到期的劳动合同写一段续签准备摘要（不超过 300 字）：合同历史、司龄、已订立的固定期限合同次数，以及 HR 需要核对的事项。'
            }只陈述事实与待确认事项，不下结论；涉及劳动法规的判断只提示 HR 核对，不给法律结论。${
              summary.contracts === null
                ? '数据中 contracts 为 null，表示这位接收人无权查看合同，并不是没有合同：不要写“未查到合同”，只写“合同信息由 HR 核对”。'
                : ''
            }toConfirm 中的代码含义：${JSON.stringify(CONFIRM_TEXT)}。数据：${JSON.stringify(summary)}`,
            z.object({ summary: z.string().min(1).max(800) }),
          )
        ).summary,
      () => summaryFallback(kind, summary),
    );
  }

  async function probationPrep(run: AutomationRunContext) {
    const { probationDays } = (await deps.settings().read('reminders')).value;
    const today = platform.currentDate();
    const rows = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'name', 'userId', 'departmentId', 'probationEndDate'])
      .where('status', '=', 'probation')
      .execute();
    let prepared = 0;
    const locale = deps.locale();
    for (const row of rows) {
      const end = toDateOnly(row.probationEndDate as string | null);
      if (!end) continue;
      const days = daysBetween(today, end);
      if (days < 0 || days > probationDays) continue;
      const key = `hrAssistant:probationPrep:${str(row.id)}`;
      if (await claimed(key)) continue;
      const head = await platform.headOf({
        departmentId: str(row.departmentId),
        userId: row.userId == null ? null : str(row.userId),
      });
      const recipients = [
        ...new Set([head, run.owner.userId].filter(Boolean)),
      ] as string[];
      for (const recipient of recipients) {
        // Each recipient's copy is read as that recipient, so it holds only what they may see.
        const viewer = await asUser(recipient);
        const base = await deps
          .core()
          .hrSummary(viewer, str(row.id), locale)
          .catch((error: unknown) => {
            if (error instanceof HrError) return undefined;
            throw error;
          });
        if (!base) continue;
        // V3-09: the learning during probation, as far as this recipient may see it.
        const learning = await deps.learning?.(viewer, str(row.id));
        const summary = learning ? { ...base, learning } : base;
        const text = await wordSummary(run, 'probation', summary);
        await platform.notify({
          key: `${key}:${recipient}`,
          userIds: [recipient],
          message: 'hrProbationPrep',
          params: { name: str(row.name), date: end, text: text.slice(0, 800) },
          path: `/talent/actions/new?type=regularize&employeeId=${encodeURIComponent(str(row.id))}`,
        });
      }
      if (await claim(key)) prepared += 1;
    }
    if (!prepared) return { status: 'skipped' as const, output: { prepared } };
    run.summarize(`为 ${prepared} 名试用期即将结束的员工准备了转正材料`);
    return { output: { prepared } };
  }

  async function renewalPrep(run: AutomationRunContext) {
    const { contractDays } = (await deps.settings().read('reminders')).value;
    const window = Math.max(...contractDays);
    const today = platform.currentDate();
    const rows = await database
      .query()
      .selectFrom('employmentContracts')
      .select(['id', 'employeeId', 'contractNo', 'endDate'])
      .where('status', '=', 'active')
      .execute();
    let prepared = 0;
    const locale = deps.locale();
    for (const row of rows) {
      const end = toDateOnly(row.endDate as string | null);
      if (!end) continue;
      const days = daysBetween(today, end);
      if (days < 0 || days > window) continue;
      const key = `hrAssistant:renewalPrep:${str(row.id)}`;
      if (await claimed(key)) continue;
      const summary = await deps
        .core()
        .hrSummary(run.owner, str(row.employeeId), locale)
        .catch((error: unknown) => {
          if (error instanceof HrError) return undefined;
          throw error;
        });
      if (!summary) continue;
      const prompts = (
        (await deps.compliance?.().openFor(str(row.employeeId))) ?? []
      ).map((issue) => issue.aiNote ?? issue.kind);
      const text = await wordSummary(run, 'renewal', {
        ...summary,
        contractNo: str(row.contractNo),
        endDate: end,
        ...(prompts.length ? { complianceNotes: prompts } : {}),
      });
      await platform.notify({
        key,
        userIds: [run.owner.userId],
        message: 'hrRenewalPrep',
        params: {
          name: String(summary.name),
          contractNo: str(row.contractNo),
          date: end,
          text: text.slice(0, 800),
        },
        path: `/talent/contracts?renew=${encodeURIComponent(str(row.id))}`,
      });
      if (await claim(key)) prepared += 1;
    }
    if (!prepared) return { status: 'skipped' as const, output: { prepared } };
    run.summarize(`为 ${prepared} 份即将到期的合同准备了续签材料`);
    return { output: { prepared } };
  }

  const fieldSchema = z
    .object({
      value: z.unknown(),
      confidence: z.number().min(0).max(1),
      snippet: z.string().max(200),
    })
    .nullable();

  async function extractAttachment(
    run: AutomationRunContext,
    input: { attachmentId: string; uploaderUserId: string },
  ) {
    const attachment = await database
      .query()
      .selectFrom('employeeAttachments')
      .select(['id', 'employeeId', 'fileId', 'category'])
      .where('id', '=', input.attachmentId)
      .executeTakeFirst();
    if (!attachment) throw new HrError('PROFILE_ATTACHMENT_NOT_FOUND', 404);
    const file = await database
      .query()
      .selectFrom('hrFiles')
      .select(['disk', 'key', 'filename', 'mimeType'])
      .where('id', '=', str(attachment.fileId))
      .executeTakeFirst();
    if (!file) throw new HrError('PROFILE_FILE_NOT_FOUND', 404);
    const category = str(attachment.category);
    run.summarize(
      `识别${{ idCard: '证件', diploma: '学历证书', contract: '合同扫描件' }[category] ?? '附件'}`,
    );
    const kind = documentKind(str(file.filename), str(file.mimeType));
    if (!kind)
      // An image scan: the configured model reads text only (see the module comment).
      throw new AIUnavailableError(
        `attachment ${str(file.mimeType)} needs a model that reads images`,
      );
    const bytes = await deps
      .drive()
      .use(str(file.disk))
      .getBytes(str(file.key));
    const text = (await extractDocumentText(bytes, kind)).slice(
      0,
      ATTACHMENT_TEXT_LIMIT,
    );
    const shapes: Record<string, Record<string, typeof fieldSchema>> = {
      idCard: {
        idNumber: fieldSchema,
        birthDate: fieldSchema,
        gender: fieldSchema,
        address: fieldSchema,
      },
      diploma: { education: fieldSchema },
      contract: { contract: fieldSchema },
    };
    const shape = shapes[category];
    if (!shape)
      return { status: 'skipped' as const, output: { reason: 'category' } };
    const read = await structured(
      run,
      'hrAssistant',
      '附件识别',
      `下面是一份${{ idCard: '证件', diploma: '学历证书', contract: '劳动合同' }[category]}的文字内容。只提取附件上明确可见的字段；看不清或有歧义的字段返回 null，不要猜测。每个字段给出 value、confidence（0 到 1）和 snippet（依据的原文片段，不超过 60 字）。格式：birthDate 为 YYYY-MM-DD；gender 为 male / female / other；education 为 { school, degree (highSchool/associate/bachelor/master/doctor/other), major, startDate, endDate }；contract 为 { contractNo, startDate, endDate }。\n\n附件内容：\n${text}`,
      z.object(shape),
    );
    const fields: Record<
      string,
      { value: unknown; confidence: number; snippet: string }
    > = {};
    for (const [key, value] of Object.entries(read as Record<string, unknown>))
      if (value && typeof value === 'object')
        fields[key] = value as {
          value: unknown;
          confidence: number;
          snippet: string;
        };
    const created = await deps.core().createAiSuggestion(run.owner, {
      employeeId: str(attachment.employeeId),
      attachmentFileId: str(attachment.fileId),
      fields,
    });
    if (!created) {
      run.summarize('附件内容与档案一致，未生成修改申请');
      return { status: 'skipped' as const, output: { fields: [] } };
    }
    await run.recordItems('profileChangeRequests', [
      { id: created.id, hash: null },
    ]);
    // Field names only: the values (such as ID numbers) stay out of the run record.
    run.summarize(`生成待审核信息修改：${created.fields.join('、')}`);
    await platform.notify({
      key: `hrAssistant:extract:${input.attachmentId}`,
      userIds: [...new Set([input.uploaderUserId, run.owner.userId])],
      message: 'hrAttachmentExtracted',
      params: { fields: String(created.fields.length) },
      path: '/talent/employees/changes',
    });
    return { output: { fields: created.fields } };
  }

  return { probationPrep, renewalPrep, extractAttachment };
}

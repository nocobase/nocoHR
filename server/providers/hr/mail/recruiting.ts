/**
 * 招聘邮箱 (V2-07): resumes that arrive by mail become candidates and
 * applications, and a candidate's answer to an invitation, an offer or any
 * other message the recruiting module sent comes back to that application.
 *
 * Runs as the recruiting assistant's 招聘邮箱分拣, as its owner (hr.recruiter):
 * - A message outside any thread with a resume attachment (pdf, docx, doc) is
 *   taken in through the same intake as an import — deduplicated by email or
 *   mobile, sourceChannel `email`, consent `email` (the candidate sent it) —
 *   for the published posting its subject names, then screened as any new
 *   application. The sender gets one 收信回执 per 30 days.
 * - Anything else waits in 待归类 with a one-line description.
 * - A reply in an application's thread is read for what the candidate wants
 *   (reschedule, withdraw, erasure, a question); the recruiter is notified and
 *   starts from a drafted reply. Nothing in a message changes a stage, an
 *   interview or an offer: 标记放弃 and 改期 stay the recruiter's actions.
 *
 * Mail content is data: it only selects among these outcomes.
 */
import type { AutomationRunContext } from '../automation.js';
import { tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError } from '../shared.js';
import type { MailService } from './service.js';
import type { MailSettingsService } from './settings.js';
import type { MailHandler, MailMessage } from './types.js';

export const MAIL_SORT_RECRUITING = 'recruitingAssistant.mailSortRecruiting';
export const MAIL_REPLY_RECRUITING = 'recruitingAssistant.mailReplyRecruiting';

const RESUME = /\.(pdf|docx|doc)$/iu;
const RESUME_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
};
const RECEIPT_DAYS = 30;

export type CandidateReplyIntent =
  'reschedule' | 'withdraw' | 'erasure' | 'question';

/** What a candidate's reply asks for; the first rule that matches wins, a question otherwise. */
export function candidateReplyIntent(text: string): CandidateReplyIntent {
  const body = text.replace(/\s+/gu, '');
  if (/删除(我的)?(个人)?(信息|资料|简历)|注销|不要保存/u.test(body))
    return 'erasure';
  if (
    /(不(再)?考虑|放弃|不去了|不参加了|已(经)?(找到|入职)|另有(安排|选择)|婉拒|谢绝)/u.test(
      body,
    )
  )
    return 'withdraw';
  if (
    /(改(到|成|期|时间)|换(个|一个)?时间|调整(一下)?时间|推迟|提前|延后|能否.*(上午|下午|晚上)|能.*(上午|下午)吗)/u.test(
      body,
    )
  )
    return 'reschedule';
  return 'question';
}

const compact = (text: string): string =>
  text.toLowerCase().replace(/\s+/gu, '');

/**
 * The published posting a subject names: its title, or the title without the
 * bracketed place (「CNC 操作工」 for 「CNC 操作工（成都）」); the longest match wins.
 */
export function postingForSubject<T extends { id: string; title: string }>(
  subject: string,
  postings: readonly T[],
): T | null {
  const text = compact(subject);
  const scored = postings
    .map((p) => {
      const full = compact(p.title);
      const base = compact(p.title.replace(/[（(][^）)]*[）)]/gu, ''));
      return {
        posting: p,
        score: text.includes(full)
          ? full.length + 1000
          : base && text.includes(base)
            ? base.length
            : 0,
      };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.posting ?? null;
}

const firstLine = (text: string | null): string =>
  (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('>'))[0]
    ?.slice(0, 80) ?? '';

type Run = <T extends Record<string, unknown>>(
  key: string,
  options: { dedupeKey: string; triggerRef: Record<string, unknown> },
  work: (
    run: AutomationRunContext,
  ) => Promise<{ status?: 'succeeded' | 'skipped'; output?: T }>,
) => Promise<unknown>;

interface Posting {
  id: string;
  title: string;
  requisitionId: string;
}

export function createRecruitingMailHandler(deps: {
  mail: MailService;
  settings: MailSettingsService;
  run: Run;
  /** Published postings, for matching a subject. */
  publishedPostings: () => Promise<Posting[]>;
  /** The recruiter responsible for a posting's requisition. */
  recruiterOf: (postingId: string) => Promise<string | null>;
  recruiters: () => Promise<string[]>;
  /** A candidate's open application by the address they write from (the latest). */
  applicationForAddress: (address: string) => Promise<string | null>;
  intake: (input: {
    postingId: string;
    fromAddress: string;
    fromName: string | null;
    file: { name: string; bytes: Uint8Array; mimeType: string };
    by: string;
  }) => Promise<{
    applicationId: string;
    candidateName: string;
    created: boolean;
    email: string | null;
  }>;
  application: (id: string) => Promise<{
    id: string;
    postingId: string;
    postingTitle: string;
    candidateName: string;
    stage: string;
  } | null>;
  /** Months a candidate's information is kept (招聘设置 · 保存期限). */
  retentionMonths: () => Promise<number>;
  /** The recruiting module's candidate send: the step's channel and test address, recorded in the thread. */
  sendEmail: (input: {
    key: string;
    to: string;
    subject: string;
    body: string;
    applicationId?: string | null;
  }) => Promise<'sent' | 'channelNotConfigured' | 'failed'>;
  /** Whether this address had a receipt in the last days. */
  receiptSince: (address: string, since: Date) => Promise<boolean>;
  now: () => Date;
  notify: (input: {
    key: string;
    userIds: string[];
    message: string;
    params: Record<string, string>;
    path: string;
  }) => Promise<void>;
}) {
  const { mail } = deps;

  async function resumeOf(message: MailMessage) {
    const attachment = message.attachments.find((a) => RESUME.test(a.filename));
    if (!attachment) return null;
    const bytes = await mail.fileBytes(attachment.fileId);
    const ext = attachment.filename.toLowerCase().split('.').pop() ?? '';
    return bytes
      ? { name: attachment.filename, bytes, mimeType: RESUME_MIME[ext] ?? '' }
      : null;
  }

  async function receipt(
    applicationId: string,
    to: string,
    name: string,
    postingTitle: string,
  ) {
    const now = deps.now();
    if (
      await deps.receiptSince(
        to,
        new Date(now.getTime() - RECEIPT_DAYS * 86_400_000),
      )
    )
      return;
    const settings = (await deps.settings.read()).value;
    const months = await deps.retentionMonths();
    await deps.sendEmail({
      key: `receipt:${to.toLowerCase()}:${now.toISOString().slice(0, 10)}`,
      to,
      applicationId,
      subject: `已收到你的简历：${postingTitle}`,
      body: [
        `${name}，你好：`,
        '',
        `我们已收到你投递「${postingTitle}」的简历，招聘负责人会尽快查看，有进展会再联系你。`,
        '',
        `个人信息处理说明：你的简历与联系方式只用于本次及今后 ${months} 个月内的岗位匹配与联系，到期后删除；不会用于其他用途。`,
        '如需删除你的信息，直接回复本邮件说明即可。',
        '',
        settings.senderName,
      ].join('\n'),
    });
  }

  async function sort(message: MailMessage, attempt?: string) {
    await deps.run<{ mailId: string; applicationId: string | null }>(
      MAIL_SORT_RECRUITING,
      {
        dedupeKey: attempt ? `${message.id}:${attempt}` : message.id,
        triggerRef: { mailId: message.id },
      },
      async (run) => {
        const resume = await resumeOf(message);
        // A candidate writing from their address outside the thread (a new message instead of a reply).
        const own = resume
          ? null
          : await deps.applicationForAddress(message.from.address);
        if (own) {
          await mail.link({
            id: message.id,
            refType: 'application',
            refId: own,
            intent: 'question',
            summary: '候选人来信，已挂到其投递。',
          });
          await reply({ ...message, refType: 'application', refId: own });
          run.summarize('候选人来信已挂到其投递');
          return { output: { mailId: message.id, applicationId: own } };
        }
        if (!resume) {
          const line = firstLine(message.bodyText);
          await mail.leaveUnmatched(
            message.id,
            'inquiry',
            line
              ? `来自 ${message.from.address} 的询问，没有简历附件：“${line}”。`
              : `来自 ${message.from.address}，没有简历附件，认不出用途。`,
          );
          run.summarize('来信没有简历附件，已放入待归类');
          return { output: { mailId: message.id, applicationId: null } };
        }
        const posting = postingForSubject(
          `${message.subject} ${resume.name}`,
          await deps.publishedPostings(),
        );
        if (!posting) {
          await mail.leaveUnmatched(
            message.id,
            'resume',
            `来自 ${message.from.address} 的简历（${resume.name}），主题中没有在招职位的名称，请挂到职位后导入。`,
          );
          run.summarize('简历来信未对应到在招职位');
          return { output: { mailId: message.id, applicationId: null } };
        }
        try {
          const outcome = await deps.intake({
            postingId: posting.id,
            fromAddress: message.from.address,
            fromName: message.from.name,
            file: resume,
            by: run.owner.userId,
          });
          await mail.link({
            id: message.id,
            refType: 'application',
            refId: outcome.applicationId,
            intent: 'resume',
            summary: outcome.created
              ? `${outcome.candidateName}的简历（${resume.name}），已投递到「${posting.title}」并开始初筛。`
              : `${outcome.candidateName}再次发来简历（${resume.name}），已并入「${posting.title}」的原投递。`,
          });
          const to = outcome.email ?? message.from.address;
          await receipt(
            outcome.applicationId,
            to,
            outcome.candidateName,
            posting.title,
          );
          const recruiter = await deps.recruiterOf(posting.id);
          if (recruiter)
            await deps.notify({
              key: `mail:${message.id}:resume`,
              userIds: [recruiter],
              message: 'mailResumeReceived',
              params: { name: outcome.candidateName, position: posting.title },
              path: `/talent/candidates/${outcome.applicationId}`,
            });
          run.summarize(
            `${outcome.candidateName} 的简历已从招聘邮箱投递到 ${posting.title}`,
          );
          return {
            output: {
              mailId: message.id,
              applicationId: outcome.applicationId,
            },
          };
        } catch (error) {
          if (!(error instanceof HrError)) throw error;
          await mail.leaveUnmatched(
            message.id,
            'resume',
            `来自 ${message.from.address} 的简历（${resume.name}）无法导入：${error.code}。`,
          );
          run.summarize('简历来信无法导入');
          return { output: { mailId: message.id, applicationId: null } };
        }
      },
    );
    const after = await mail.row(message.id);
    if (after.status === 'received')
      await mail.leaveUnmatched(message.id, null, '未自动识别，请人工归类。');
  }

  function replyDraft(
    intent: CandidateReplyIntent,
    name: string,
    position: string,
    senderName: string,
  ): string {
    const body =
      intent === 'reschedule'
        ? `收到你调整面试时间的请求。我们确认可安排的时间后会再发邮件告诉你新的时间。`
        : intent === 'withdraw'
          ? `收到你的回复，感谢你告诉我们。我们会为你关闭「${position}」的投递；今后有合适的岗位，欢迎再联系我们。`
          : intent === 'erasure'
            ? `收到你删除个人信息的申请。我们会删除你的简历与联系方式，完成后不再联系你。`
            : `收到你的来信，我们会尽快回复你的问题。`;
    return [`${name}，你好：`, '', body, '', senderName].join('\n');
  }

  const SUMMARY: Record<CandidateReplyIntent, string> = {
    reschedule: '希望调整面试时间',
    withdraw: '表示不再考虑这个岗位',
    erasure: '申请删除个人信息',
    question: '提出问题',
  };

  async function reply(message: MailMessage) {
    if (message.refType !== 'application' || !message.refId) return;
    const applicationId = message.refId;
    await deps.run(
      MAIL_REPLY_RECRUITING,
      {
        dedupeKey: message.id,
        triggerRef: { mailId: message.id, applicationId },
      },
      async (run) => {
        const application = await deps.application(applicationId);
        if (!application) {
          await mail.leaveUnmatched(
            message.id,
            null,
            '回信对应的投递已不存在，请人工处理。',
          );
          return { status: 'skipped' as const };
        }
        const intent = candidateReplyIntent(
          `${message.subject}\n${firstLine(message.bodyText)}\n${message.bodyText ?? ''}`.slice(
            0,
            2000,
          ),
        );
        const line = firstLine(message.bodyText);
        await mail.link({
          id: message.id,
          refType: 'application',
          refId: applicationId,
          intent,
          summary: `${application.candidateName}${SUMMARY[intent]}${line ? `：“${line}”` : ''}。${
            intent === 'withdraw'
              ? '确认后请在投递中点“标记放弃”。'
              : intent === 'reschedule'
                ? '改期请在面试安排中调整，再发送回复。'
                : ''
          }`,
        });
        const settings = (await deps.settings.read()).value;
        const draft = await mail.draftReply({
          replyTo: message.id,
          body: replyDraft(
            intent,
            application.candidateName,
            application.postingTitle,
            settings.senderName,
          ),
        });
        const recruiter = await deps.recruiterOf(application.postingId);
        await deps.notify({
          key: `mail:${message.id}:reply`,
          userIds: recruiter ? [recruiter] : await deps.recruiters(),
          message: 'mailCandidateReplied',
          params: {
            name: application.candidateName,
            intent: SUMMARY[intent],
          },
          path: `/talent/candidates/${applicationId}`,
        });
        run.summarize(`${application.candidateName} 回信：${SUMMARY[intent]}`);
        return {
          output: {
            mailId: message.id,
            applicationId,
            intent,
            draftId: draft.id,
          },
        };
      },
    );
  }

  const handler: MailHandler = {
    async canView(ctx: ActorContext) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, 'talent.candidate', 'manage'),
      );
    },
    async canSend(ctx: ActorContext) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, 'talent.candidate', 'manage'),
      );
    },
    recipients: deps.recruiters,
    onUnmatched: sort,
    onReply: reply,
  };

  return { handler };
}

export type RecruitingMailHandler = ReturnType<
  typeof createRecruitingMailHandler
>;

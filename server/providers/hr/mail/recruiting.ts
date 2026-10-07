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
import { z } from 'zod';

import { AIUnavailableError } from '../ai-runner.js';
import type { AutomationRunContext } from '../automation.js';
import { tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError } from '../shared.js';
import type { MailService } from './service.js';
import type { MailSettingsService } from './settings.js';
import { MAIL_RESOURCE } from './resources.js';
import type { MailHandler, MailLinkTarget, MailMessage } from './types.js';

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

const WEEKDAYS = '日一二三四五六';

/** 改期回信: the weekday (0 = Sunday) and part of the day a candidate asks for, when named. */
export function rescheduleWish(text: string): {
  weekday: number | null;
  period: 'morning' | 'afternoon' | 'evening' | null;
} {
  const body = text.replace(/\s+/gu, '');
  // The day asked for is the last one named ("周四的面试能改到周五下午吗" → 周五).
  const days = [...body.matchAll(/(?:周|星期|礼拜)([一二三四五六日天])/gu)];
  const day = days.at(-1)?.[1];
  const weekday = day ? (day === '天' ? 0 : WEEKDAYS.indexOf(day)) : null;
  const period = /下午/u.test(body)
    ? 'afternoon'
    : /晚上|傍晚/u.test(body)
      ? 'evening'
      : /上午|早上/u.test(body)
        ? 'morning'
        : null;
  return { weekday: weekday !== null && weekday >= 0 ? weekday : null, period };
}

export interface RescheduleOption {
  start: string;
  end: string;
  slotKey: string | null;
  location: string | null;
}

export interface RescheduleProposal {
  kind: 'reschedule';
  interviewId: string;
  name: string;
  options: RescheduleOption[];
  chosen: number;
}

/** 10月8日（周四）14:00–15:00, in the company's time zone. */
export function rescheduleLabel(
  option: RescheduleOption,
  timeZone: string,
): string {
  const parts = (value: string) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
      })
        .formatToParts(new Date(value))
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
  const a = parts(option.start);
  const b = parts(option.end);
  const weekday =
    WEEKDAYS[
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(a.weekday ?? '')
    ] ?? '';
  return `${Number(a.month)}月${Number(a.day)}日（周${weekday}）${a.hour}:${a.minute}–${b.hour}:${b.minute}`;
}

/** The reply proposing the chosen time; nothing else about the interview changes. */
export function rescheduleText(
  proposal: RescheduleProposal,
  timeZone: string,
  senderName: string,
): string {
  const option = proposal.options[proposal.chosen];
  return [
    `${proposal.name}，你好：`,
    '',
    `可以，你的面试改到 ${rescheduleLabel(option, timeZone)}${option.location ? `，地点不变：${option.location}` : ''}。`,
    '',
    '如这个时间仍不方便，请直接回复本邮件。',
    '',
    senderName,
  ].join('\n');
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

function proposalOf(mail: MailMessage): RescheduleProposal | null {
  const p = mail.proposal as Partial<RescheduleProposal> | null;
  return p?.kind === 'reschedule' &&
    typeof p.interviewId === 'string' &&
    Array.isArray(p.options) &&
    typeof p.chosen === 'number'
    ? (p as RescheduleProposal)
    : null;
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

/** The receipt for a resume taken in by mail; `{{name}}`, `{{posting}}`, `{{months}}`, `{{sender}}` and `{{deleteLink}}` are filled. */
export interface ReceiptTemplateValue {
  readonly subject: string;
  readonly body: string;
  readonly confirmedAt: string | null;
  readonly confirmedBy: string | null;
}

export const DEFAULT_RECEIPT_TEMPLATE = {
  subject: '已收到你的简历：{{posting}}',
  body: [
    '{{name}}，你好：',
    '',
    '我们已收到你投递「{{posting}}」的简历，招聘负责人会尽快查看，有进展会再联系你。',
    '',
    '个人信息处理说明：你的简历与联系方式只用于本次及今后 {{months}} 个月内的岗位匹配与联系，到期后删除；不会用于其他用途。',
    '如需删除你的信息，请打开下面的链接提交申请：',
    '{{deleteLink}}',
    '',
    '{{sender}}',
  ].join('\n'),
};

/**
 * 渠道名称: the job site that forwarded a resume, when the sender is not the
 * candidate (the resume names another address) — from 【…】 or […] at the
 * start of the subject, else the sender's display name, else its domain.
 * A candidate writing in themselves has no site.
 */
export function forwardingSite(input: {
  subject: string;
  fromName: string | null;
  fromAddress: string;
  resumeEmail: string | null;
}): string | null {
  if (
    !input.resumeEmail ||
    input.resumeEmail.toLowerCase() === input.fromAddress.toLowerCase()
  )
    return null;
  return (
    /^\s*[【[]([^】\]]{1,40})[】\]]/u.exec(input.subject)?.[1]?.trim() ||
    input.fromName?.trim() ||
    input.fromAddress.split('@')[1] ||
    null
  );
}

/**
 * The model's answer as the body of a reply the system frames: no greeting
 * (the draft has one), and no sentence about who answers the rest (the draft
 * says that once, for the topics the letter asked about).
 */
export function tidyAnswer(answer: string): string {
  return answer
    .trim()
    .replace(/^[^，,。！!\n]{0,12}(?:你好|您好)[，,：:！!。]?\s*/u, '')
    .split(/(?<=[。！？!?])/u)
    .filter(
      (sentence) =>
        !/招聘负责人|另行答复|稍后.*答复|再.*回复你/u.test(sentence),
    )
    .join('')
    .trim();
}

/** What a posting tells a candidate (V2-07: 询问时按职位信息起草回复). */
export interface PostingFacts {
  readonly title: string;
  readonly location: string;
  readonly description: string;
  readonly requirements: readonly string[];
}

/** Topics a posting never settles: the recruiter answers them. */
const OPEN_TOPICS: [string, RegExp][] = [
  ['薪资待遇', /薪资|工资|待遇|薪酬|收入|底薪|提成|奖金/u],
  ['住宿', /住宿|宿舍|住的地方/u],
  ['班车', /班车|通勤|接送/u],
  ['食堂', /食堂|吃饭|餐补/u],
  ['社保', /社保|五险|公积金/u],
  ['班次与加班', /倒班|夜班|加班|班次|休息/u],
];

/**
 * The rule-based answer to a candidate's question, from the posting only:
 * where, what is asked of them, what the work is. Anything else (pay,
 * housing, shuttles…) is named as left to the recruiter; nothing is invented.
 */
export function answerFromPosting(
  question: string,
  posting: PostingFacts,
): { lines: string[]; open: string[] } {
  const lines: string[] = [];
  if (/招人|招聘|还要人|缺人|空缺|在招/u.test(question))
    lines.push(
      `「${posting.title}」正在招聘${posting.location ? `，工作地点是${posting.location}` : ''}。欢迎直接回复本邮件附上简历。`,
    );
  if (/地点|地址|在哪|哪里|位置|城市/u.test(question) && posting.location)
    lines.push(`「${posting.title}」的工作地点是${posting.location}。`);
  if (
    /要求|条件|经验|学历|证书|年龄|能不能|可以吗|符合/u.test(question) &&
    posting.requirements.length
  )
    lines.push(`这个岗位的要求是：${posting.requirements.join('；')}。`);
  if (/做什么|工作内容|职责|干什么|负责/u.test(question) && posting.description)
    lines.push(`工作内容：${posting.description}`);
  const open = OPEN_TOPICS.filter(
    ([, words]) => words.test(question) && !words.test(posting.description),
  ).map(([topic]) => topic);
  return { lines, open };
}

function fillReceipt(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/gu, (whole, key: string) =>
    key in values ? values[key] : whole,
  );
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
    /** For the forwarding site's name (渠道名称). */
    subject: string;
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
  /** 待归类 · 挂到单据: the user's own applications and published postings matching a query. */
  linkables: (userId: string, query: string) => Promise<MailLinkTarget[]>;
  /** One of them by its reference, if it is the user's. */
  linkable: (
    userId: string,
    refType: string,
    refId: string,
  ) => Promise<MailLinkTarget | null>;
  /** A candidate's keeping (招聘设置 · 保存期限) through one of their applications; null when it is gone. */
  candidateRetention: (
    applicationId: string,
  ) => Promise<{ until: string | null; anonymized: boolean } | null>;
  /** What the posting says, for answering a candidate's question. */
  postingFacts: (postingId: string) => Promise<PostingFacts | null>;
  /** The recruiting assistant's structured answer; throws AIUnavailableError without a model. */
  structured: <T>(
    run: AutomationRunContext,
    title: string,
    prompt: string,
    schema: z.ZodType<T>,
  ) => Promise<T>;
  /** V2-07 删除申请: a new deletion link for the application's candidate (public URL). */
  deletionLink: (applicationId: string) => Promise<string>;
  /** The receipt template a recruiter confirmed (V2-07: 招聘负责人确认过一次的回执模板). */
  receiptTemplate: {
    /** Who confirmed it, by name: recruiters may not read the user list. */
    userName(id: string): Promise<string | null>;
    read(): Promise<ReceiptTemplateValue | null>;
    write(value: ReceiptTemplateValue): Promise<void>;
  };
  now: () => Date;
  /** The company's time zone, for the times a reply names. */
  timeZone: () => string;
  /** 改期回信: the application's next interview, the times it could move to, and the move. */
  interviews: {
    upcomingFor(applicationId: string): Promise<{ id: string } | null>;
    rescheduleOptions(
      interviewId: string,
      wish: ReturnType<typeof rescheduleWish>,
    ): Promise<{ options: RescheduleOption[] }>;
    rescheduleTrusted(
      interviewId: string,
      option: RescheduleOption,
      check?: boolean,
    ): Promise<unknown>;
  };
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
    const template = await receiptTemplate();
    // Sent only from a template a recruiter confirmed once; until then the recruiters are asked to.
    if (!template.confirmedAt) {
      await deps.notify({
        key: 'recruitingReceiptTemplate',
        userIds: await deps.recruiters(),
        message: 'recruitingReceiptTemplateRequired',
        params: {},
        path: '/talent/mail?mailbox=recruiting',
      });
      return;
    }
    const settings = (await deps.settings.read()).value;
    const values = {
      name,
      posting: postingTitle,
      months: String(await deps.retentionMonths()),
      sender: settings.senderName,
      deleteLink: await deps.deletionLink(applicationId),
    };
    // A template confirmed before the link existed still carries it, after the text.
    const body = template.body.includes('{{deleteLink}}')
      ? template.body
      : `${template.body}\n\n如需删除你的信息，请打开：{{deleteLink}}`;
    await deps.sendEmail({
      key: `receipt:${to.toLowerCase()}:${now.toISOString().slice(0, 10)}`,
      to,
      applicationId,
      subject: fillReceipt(template.subject, values),
      body: fillReceipt(body, values),
    });
  }

  async function receiptTemplate() {
    const stored = await deps.receiptTemplate.read();
    return {
      subject: stored?.subject || DEFAULT_RECEIPT_TEMPLATE.subject,
      body: stored?.body || DEFAULT_RECEIPT_TEMPLATE.body,
      confirmedAt: stored?.confirmedAt ?? null,
      confirmedBy: stored?.confirmedBy ?? null,
      confirmedByName: stored?.confirmedBy
        ? await deps.receiptTemplate.userName(stored.confirmedBy)
        : null,
    };
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
            subject: message.subject,
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
          // 邮件正文不留存: the resume now lives with the candidate (and their 保存期限); the mail keeps its subject and summary.
          await mail.forgetMessage(message.id);
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

  /** The model's answer from the posting, else the rules'; never a promise the posting does not make. */
  async function answerQuestion(
    run: AutomationRunContext,
    question: string,
    facts: PostingFacts,
  ): Promise<{ text: string; open: string[] }> {
    const ruled = answerFromPosting(question, facts);
    const openText = (open: string[]) =>
      open.length
        ? `你问到的${open.join('、')}，招聘负责人会再单独回复你。`
        : '';
    try {
      const data = await deps.structured(
        run,
        '候选人询问回复',
        [
          '候选人来信提问。只回答来信里问到、而且下面的职位信息能回答的问题，一两句话，语气礼貌。',
          '不要写称呼、问候或落款，不要复述来信没问到的职位内容。',
          '职位信息里没有的内容（如薪资、住宿、班车）一个字也不要写，也不要说会由谁答复——系统会另外说明；把这些来信真正问到的话题用两到四个字列入 open。',
          '不要提及其他候选人或公司内部信息。',
          `职位信息：${JSON.stringify(facts)}`,
          `来信：${question}`,
        ].join('\n'),
        z.object({
          answer: z.string().max(800),
          open: z.array(z.string().max(20)).max(6),
        }),
      );
      const text = tidyAnswer(data.answer);
      if (text) {
        // The rules read the topics from the letter itself; the model's list only when they find none.
        const open = ruled.open.length
          ? ruled.open
          : [...new Set(data.open.map((t) => t.trim()).filter(Boolean))].slice(
              0,
              3,
            );
        return {
          text: [text, openText(open)].filter(Boolean).join('\n\n'),
          open,
        };
      }
      run.markFallback();
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
    }
    const body = ruled.lines.length
      ? ruled.lines.join('\n')
      : ruled.open.length
        ? ''
        : '你的问题我们已转给招聘负责人，会尽快回复你。';
    return {
      text: [body, openText(ruled.open)].filter(Boolean).join('\n\n'),
      open: ruled.lines.length || ruled.open.length ? ruled.open : ['你的问题'],
    };
  }

  /** 挂到职位后回复: the question answered from the posting, for the recruiter to send. */
  async function answerPosting(message: MailMessage, postingId: string) {
    await deps.run(
      MAIL_REPLY_RECRUITING,
      {
        dedupeKey: `${message.id}:posting:${postingId}`,
        triggerRef: { mailId: message.id, postingId },
      },
      async (run) => {
        const facts = await deps.postingFacts(postingId);
        if (!facts) return { status: 'skipped' as const };
        const settings = (await deps.settings.read()).value;
        const answer = await answerQuestion(
          run,
          `${message.subject}\n${message.bodyText ?? ''}`.slice(0, 2000),
          facts,
        );
        const draft = await mail.draftReply({
          replyTo: message.id,
          body: ['你好：', '', answer.text, '', settings.senderName].join('\n'),
        });
        run.summarize(`按职位「${facts.title}」起草了回复`);
        return { output: { mailId: message.id, postingId, draftId: draft.id } };
      },
    );
  }

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
        const settings = (await deps.settings.read()).value;
        const tz = deps.timeZone();
        // 改期: the times the interview could move to; the reply names the first, the recruiter may pick another.
        let proposal: RescheduleProposal | null = null;
        let rescheduleNote = '';
        if (intent === 'reschedule') {
          const interview = await deps.interviews.upcomingFor(applicationId);
          if (!interview)
            rescheduleNote = '这份投递没有待进行的面试，请人工处理。';
          else {
            const { options } = await deps.interviews.rescheduleOptions(
              interview.id,
              rescheduleWish(
                `${message.subject}\n${message.bodyText ?? ''}`.slice(0, 2000),
              ),
            );
            if (options.length) {
              proposal = {
                kind: 'reschedule',
                interviewId: interview.id,
                name: application.candidateName,
                options,
                chosen: 0,
              };
              rescheduleNote = `可改到：${options.map((o) => rescheduleLabel(o, tz)).join('、')}。回复写的是第一个时间，可在草稿中换成其他时间；确认发送后面试才改到所选时段，并通知面试官。`;
            } else
              rescheduleNote =
                '所提时段内没有面试官都空闲的时间，请与面试官协调后在面试安排中调整。';
          }
        }
        // 询问: answered from the posting; what it does not settle is left to the recruiter.
        let answer: { text: string; open: string[] } | null = null;
        if (intent === 'question') {
          const facts = await deps.postingFacts(application.postingId);
          if (facts)
            answer = await answerQuestion(
              run,
              (message.bodyText ?? message.subject).slice(0, 2000),
              facts,
            );
        }
        const questionNote = answer
          ? answer.open.length
            ? `已按职位信息起草回答；职位信息里没有${answer.open.join('、')}，草稿写明会由招聘负责人另行答复，请补充后发送。`
            : '已按职位信息起草回答，请核对后发送。'
          : '';
        await mail.link({
          id: message.id,
          refType: 'application',
          refId: applicationId,
          intent,
          summary: `${application.candidateName}${SUMMARY[intent]}${line ? `：“${line}”` : ''}。${
            intent === 'withdraw'
              ? '确认后请在投递中点“标记放弃”。'
              : intent === 'question'
                ? questionNote
                : rescheduleNote
          }`,
        });
        const draft = await mail.draftReply({
          replyTo: message.id,
          body: proposal
            ? rescheduleText(proposal, tz, settings.senderName)
            : answer
              ? [
                  `${application.candidateName}，你好：`,
                  '',
                  answer.text,
                  '',
                  settings.senderName,
                ].join('\n')
              : replyDraft(
                  intent,
                  application.candidateName,
                  application.postingTitle,
                  settings.senderName,
                ),
          proposal: proposal as unknown as Record<string, unknown> | null,
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

  const recruiterCache = new WeakMap<
    ActorContext,
    Map<string, string | null>
  >();

  const handler: MailHandler = {
    // 按邮箱用途授权 (mail/resources.ts): the 招聘邮箱 is talent.mailRecruiting.
    async canView(ctx: ActorContext) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.recruiting, 'view'),
      );
    },
    async canSend(ctx: ActorContext) {
      return Boolean(
        await tryAuthorizeAction(ctx.authz, MAIL_RESOURCE.recruiting, 'send'),
      );
    },
    /**
     * V2-07 权限: a recruiter sees the mail of the requisitions they are responsible for, and the
     * mailbox's 待归类 (mail not linked to an application yet). Each application's recruiter is
     * looked up once per request.
     */
    async canSee(ctx: ActorContext, mail: MailMessage) {
      if (!mail.refType || !mail.refId) return true;
      // Linked by hand to a posting (“请问你们还招人吗”): its recruiter's.
      if (mail.refType === 'jobPosting')
        return (await deps.recruiterOf(mail.refId)) === ctx.userId;
      if (mail.refType !== 'application') return false;
      let owners = recruiterCache.get(ctx);
      if (!owners)
        recruiterCache.set(ctx, (owners = new Map<string, string | null>()));
      let owner = owners.get(mail.refId);
      if (owner === undefined) {
        const application = await deps.application(mail.refId);
        owner = application
          ? await deps.recruiterOf(application.postingId)
          : null;
        owners.set(mail.refId, owner);
      }
      return owner === ctx.userId;
    },
    // 待归类 · 挂到单据: the recruiter's own applications and published postings.
    async linkTargets(ctx, query) {
      return deps.linkables(ctx.userId, query);
    },
    async linkTarget(ctx, refType, refId) {
      return deps.linkable(ctx.userId, refType, refId);
    },
    /** A candidate's mail is handled as their reply; a question about a posting is answered from it. */
    async onLinked(_ctx, mail) {
      if (mail.refType === 'application') {
        await reply(mail);
        return true;
      }
      if (mail.refType === 'jobPosting' && mail.refId) {
        await answerPosting(mail, mail.refId);
        return true;
      }
      return false;
    },
    // A candidate's mail is kept as long as the candidate (保存期限), and goes when they are anonymized.
    async retentionOf(refType, refId) {
      if (refType !== 'application') return null;
      const kept = await deps.candidateRetention(refId);
      if (!kept || kept.anonymized) return '0000-01-01';
      return kept.until;
    },
    recipients: deps.recruiters,
    onUnmatched: sort,
    onReply: reply,
    async chooseProposal(draft, choice) {
      const proposal = proposalOf(draft);
      if (!proposal || choice >= proposal.options.length)
        throw new HrError('INVALID_INPUT', 400);
      const next = { ...proposal, chosen: choice };
      const settings = (await deps.settings.read()).value;
      return {
        proposal: next as unknown as Record<string, unknown>,
        body: rescheduleText(next, deps.timeZone(), settings.senderName),
      };
    },
    /** A reschedule reply moves the interview once it was sent, if the time is still free. */
    async prepareSend(_ctx, draft) {
      const body = draft.bodyText ?? '';
      const proposal = proposalOf(draft);
      if (!proposal) return { text: body, storedText: body };
      const option = proposal.options[proposal.chosen];
      if (!option) return { text: body, storedText: body };
      await deps.interviews.rescheduleTrusted(
        proposal.interviewId,
        option,
        true,
      );
      return {
        text: body,
        storedText: body,
        onSent: async () => {
          await deps.interviews.rescheduleTrusted(proposal.interviewId, option);
        },
      };
    },
  };

  /** The receipt template, for the recruiters who send this mailbox's mail. */
  async function requireRecruiter(ctx: ActorContext) {
    if (!(await handler.canSend(ctx))) throw new HrError('FORBIDDEN', 403);
  }

  return {
    handler,
    async getReceiptTemplate(ctx: ActorContext) {
      await requireRecruiter(ctx);
      return receiptTemplate();
    },
    /** A recruiter saves and confirms the receipt; receipts are sent only once it is confirmed. */
    async confirmReceiptTemplate(ctx: ActorContext, input: unknown) {
      await requireRecruiter(ctx);
      const { subject, body } = (input ?? {}) as {
        subject?: unknown;
        body?: unknown;
      };
      if (
        typeof subject !== 'string' ||
        typeof body !== 'string' ||
        !subject.trim() ||
        subject.length > 200 ||
        !body.trim() ||
        body.length > 4000
      )
        throw new HrError('INVALID_INPUT', 400);
      // The receipt must state how long the information is kept (个人信息处理说明).
      if (!body.includes('{{months}}'))
        throw new HrError('MAIL_RECEIPT_RETENTION_REQUIRED', 400);
      // …and how to have it deleted (删除申请链接).
      if (!body.includes('{{deleteLink}}'))
        throw new HrError('MAIL_RECEIPT_DELETE_LINK_REQUIRED', 400);
      await deps.receiptTemplate.write({
        subject: subject.trim(),
        body: body.trim(),
        confirmedAt: deps.now().toISOString(),
        confirmedBy: ctx.userId,
      });
      return receiptTemplate();
    },
  };
}

export type RecruitingMailHandler = ReturnType<
  typeof createRecruitingMailHandler
>;

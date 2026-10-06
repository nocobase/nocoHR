/**
 * 新员工回访 (V2-07, 人事助理). On the configured days after joining (default
 * 3 / 7 / 30) the HR assistant asks a new employee, in a Feishu private chat,
 * how the commute, mentoring, the workload and the schedule are going (the
 * configured questions). A reply is
 * claimed by the bot hook (im-channel `addHook`) and answered by the HR
 * assistant, who calls `saveCheckInIssues`; without a model the rule path
 * sorts the reply by topic, cites a policy when one answers it, and routes
 * each issue to its owner as a workbench to-do (type newHireIssue).
 *
 * - An employee without an account or a Feishu binding is not asked: their
 *   head is reminded to ask in person.
 * - No reply within noReplyDays: noReply, and nobody asks again.
 * - Only the employee, hr.admin and the people an issue was routed to see
 *   anything; a head sees only the issues routed to them (as to-dos).
 * - The run record keeps employee ids and topics only, never the reply.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { addDays, daysBetween, HrError, newId, str } from '../shared.js';
import {
  CHECK_IN_TOPICS,
  checkInRouteFor,
  type CheckInTopic,
  type StoredCheckInTopic,
} from './config.js';
import { day, iso, json } from './common.js';
import type { RecruitingContext } from './context.js';
import { COMPOSITE } from './resources.js';

export const CHECK_IN_TASK = 'hrAssistant.newHireCheckIn';

const issuesSchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            topic: z.enum(CHECK_IN_TOPICS),
            text: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(20),
    issues: z
      .array(
        z
          .object({
            topic: z.enum(CHECK_IN_TOPICS),
            summary: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .max(10),
    declined: z.boolean().optional(),
  })
  .strict();

/**
 * Keywords per topic, tried in this order; the first match wins. Commute
 * covers getting to work and, where an employer provides it, accommodation
 * (what were the separate housing and shuttle topics).
 */
const TOPIC_WORDS: Record<CheckInTopic, RegExp> = {
  commute:
    /通勤|交通|班车|公交|地铁|打车|接送|路上|住得远|离.{0,8}远|下班.{0,6}(没有?|没)车|住宿|宿舍|租房|室友/u,
  mentoring: /师傅|带教|导师|教我|没人教|没人带|上手|同事|培训/u,
  schedule: /排班|夜班|班次|倒班|调班|休息|工作时间|上班时间|周末/u,
  workload: /太累|加班|工作量|任务多|强度/u,
  expectations: /工作内容|岗位职责|职责|预期|期望|说的不一样|不一致|和.{0,6}(说|讲|介绍)的/u,
  environment: /环境|工位|办公室|设备|电脑|工具|空调|热水|噪音|食堂|吃饭/u,
  other: /$^/u,
};

export function presentCheckIn(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    day: Number(row.day),
    channel: str(row.channel),
    askedAt: iso(row.askedAt),
    repliedAt: iso(row.repliedAt),
    // Rows written before 2026-10 may carry the legacy housing / shuttle topics.
    answers: json<{ topic: StoredCheckInTopic; text: string }[]>(
      row.answers,
      [],
    ),
    issues: json<
      {
        topic: StoredCheckInTopic;
        summary: string;
        routedToUserId: string | null;
        workItemId: string | null;
      }[]
    >(row.issues, []),
    status: str(row.status),
  };
}
export type CheckInView = ReturnType<typeof presentCheckIn>;

/** Topics a reply touches, by keyword; the sentence it came from is the answer. */
export function classifyReply(text: string) {
  const sentences = text
    .split(/[。！？!?；;\n]/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const answers: { topic: CheckInTopic; text: string }[] = [];
  for (const sentence of sentences.length ? sentences : [text]) {
    const parts = sentence.split(/[，,]/u).map((p) => p.trim()).filter(Boolean);
    for (const part of parts.length ? parts : [sentence]) {
      const topic =
        (Object.keys(TOPIC_WORDS) as CheckInTopic[]).find((t) =>
          TOPIC_WORDS[t].test(part),
        ) ?? null;
      if (topic) answers.push({ topic, text: part.slice(0, 200) });
    }
  }
  const negative =
    /不|没|远|慢|累|难|问题|麻烦|不方便|不习惯|不适应|太(多|长|久|慢|晚|早|挤|乱)/u;
  const issues = answers
    .filter((a) => negative.test(a.text))
    .map((a) => ({ topic: a.topic, summary: a.text }));
  const declined = /不想(回答|说)|不用了|没事|挺好|都好/u.test(text) && !issues.length;
  return { answers, issues, declined };
}

export function createCheckIns(ctx: RecruitingContext) {
  const { database, platform } = ctx;

  async function owner(): Promise<string | null> {
    return (await ctx.ownerOf(CHECK_IN_TASK)) ?? (await ctx.hrAdministrators())[0] ?? null;
  }

  async function routeTarget(topic: StoredCheckInTopic, employeeId: string) {
    const settings = await ctx.settings();
    const target = checkInRouteFor(settings.checkIns.routing, topic);
    if (target.startsWith('user:')) return target.slice(5);
    if (target === 'hrOwner') return owner();
    const employee = await platform.employee(employeeId);
    if (!employee) return owner();
    return (await platform.headOf(employee)) ?? (await owner());
  }

  async function row(id: string) {
    const found = await database
      .query()
      .selectFrom('newHireCheckIns')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('CHECK_IN_NOT_FOUND', 404);
    return presentCheckIn(found);
  }

  /** The open check-in a bot message from this user answers. */
  async function openFor(userId: string) {
    const employee = await platform.employeeOfUser(userId);
    if (!employee) return undefined;
    const settings = await ctx.settings();
    const found = await database
      .query()
      .selectFrom('newHireCheckIns')
      .selectAll()
      .where('employeeId', '=', employee.id)
      .where('status', '=', 'asked')
      .orderBy('askedAt', 'desc')
      .executeTakeFirst();
    if (!found) return undefined;
    const view = presentCheckIn(found);
    if (
      view.askedAt &&
      Date.now() - new Date(view.askedAt).getTime() >
        settings.checkIns.noReplyDays * 86_400_000
    )
      return undefined;
    return view;
  }

  const service = {
    get: row,
    openFor,

    /** Writes the reply's topics and routes each issue; the employee's own conversation only. */
    async saveIssues(actor: ActorContext, checkInId: string, input: unknown) {
      const checkIn = await row(checkInId);
      const employee = await platform.employeeOfUser(actor.userId);
      if (!employee || employee.id !== checkIn.employeeId)
        throw new HrError('CHECK_IN_NOT_FOUND', 404);
      const parsed = issuesSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      return service.saveIssuesTrusted(checkIn, parsed.data);
    },

    async saveIssuesTrusted(
      checkIn: CheckInView,
      data: z.infer<typeof issuesSchema>,
    ) {
      if (checkIn.status === 'replied') {
        // A second reply adds what is new; issues already routed stay.
        const known = new Set(checkIn.issues.map((i) => `${i.topic}:${i.summary}`));
        data = {
          ...data,
          issues: data.issues.filter((i) => !known.has(`${i.topic}:${i.summary}`)),
        };
      }
      const employee = await platform.employee(checkIn.employeeId);
      const t = await ctx.translate();
      // One to-do per person an issue is routed to, listing the topics (整理成待办转给对应负责人).
      const byUser = new Map<string, { topic: CheckInTopic; summary: string }[]>();
      const unrouted: { topic: CheckInTopic; summary: string }[] = [];
      for (const issue of data.issues) {
        const userId = await routeTarget(issue.topic, checkIn.employeeId);
        if (!userId) unrouted.push(issue);
        else byUser.set(userId, [...(byUser.get(userId) ?? []), issue]);
      }
      const routed: CheckInView['issues'] = unrouted.map((i) => ({
        ...i,
        routedToUserId: null,
        workItemId: null,
      }));
      for (const [userId, issues] of byUser) {
        const key = `newHireIssue:${checkIn.id}:${userId}:${checkIn.issues.length}`;
        await platform.notify({
          key,
          userIds: [userId],
          message: 'recruitingNewHireIssue',
          params: {
            name: employee?.name ?? '',
            topic: issues
              .map((i) => t(`recruiting.checkIns.topics.${i.topic}`))
              .join('、'),
            summary: issues.map((i) => i.summary).join('；'),
          },
          path: `/talent/workbench`,
        });
        const item = await database
          .query()
          .selectFrom('workItems')
          .select(['id'])
          .where('recipientUserId', '=', userId)
          .where('refId', '=', key)
          .executeTakeFirst();
        for (const issue of issues)
          routed.push({
            ...issue,
            routedToUserId: userId,
            workItemId: item ? str(item.id) : null,
          });
      }
      const now = new Date();
      await database
        .query()
        .updateTable('newHireCheckIns')
        .set({
          answers: [...checkIn.answers, ...data.answers],
          issues: [...checkIn.issues, ...routed],
          status: 'replied',
          repliedAt: now,
          updatedAt: now,
        })
        .where('id', '=', checkIn.id)
        .execute();
      return {
        checkInId: checkIn.id,
        routed: await Promise.all(
          routed.map(async (r) => ({
            topic: r.topic,
            to: (await platform.userName(r.routedToUserId)) ?? null,
          })),
        ),
      };
    },

    /**
     * The daily scan: creates and sends today's check-ins, closes unanswered
     * ones. Returns ids and topics only, for the run record.
     */
    async runDaily(asOf: string, send: (checkInId: string) => Promise<'sent' | 'notBound' | 'failed'>) {
      const settings = await ctx.settings();
      const maxDay = Math.max(...settings.checkIns.days);
      const rows = await database
        .query()
        .selectFrom('employees')
        .select(['id', 'userId', 'hireDate', 'status', 'name', 'departmentId'])
        .where('status', '!=', 'leave')
        .where('hireDate', '>=', addDays(asOf, -maxDay - 1))
        .where('hireDate', '<=', asOf)
        .execute();
      const created: { employeeId: string; day: number; channel: string }[] = [];
      for (const employee of rows) {
        const hire = day(employee.hireDate);
        if (!hire) continue;
        const elapsed = daysBetween(hire, asOf);
        if (!settings.checkIns.days.includes(elapsed)) continue;
        // Only people who joined through an onboarding action (not an import of people already at work).
        const event = await database
          .query()
          .selectFrom('jobEvents')
          .select(['id'])
          .where('employeeId', '=', str(employee.id))
          .where('eventType', '=', 'onboard')
          .where('source', 'in', ['action', 'manual', 'sync'])
          .executeTakeFirst();
        if (!event) continue;
        const exists = await database
          .query()
          .selectFrom('newHireCheckIns')
          .select(['id'])
          .where('employeeId', '=', str(employee.id))
          .where('day', '=', elapsed)
          .executeTakeFirst();
        if (exists) continue;
        const id = newId();
        const now = new Date();
        try {
          await database
            .query()
            .insertInto('newHireCheckIns')
            .values({
              id,
              employeeId: str(employee.id),
              day: elapsed,
              channel: 'feishu',
              askedAt: null,
              repliedAt: null,
              answers: [],
              issues: [],
              status: 'pending',
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        } catch {
          continue;
        }
        const outcome = employee.userId ? await send(id) : 'notBound';
        if (outcome === 'sent') {
          await database
            .query()
            .updateTable('newHireCheckIns')
            .set({ status: 'asked', askedAt: new Date(), updatedAt: new Date() })
            .where('id', '=', id)
            .execute();
        } else {
          // 无账号或未绑定飞书：改为提醒部门负责人当面了解.
          await database
            .query()
            .updateTable('newHireCheckIns')
            .set({ channel: 'app', status: 'faceToFace', updatedAt: new Date() })
            .where('id', '=', id)
            .execute();
          const head = await platform.headOf({
            departmentId: str(employee.departmentId),
            userId: employee.userId ? str(employee.userId) : null,
          });
          if (head)
            await platform.notify({
              key: `checkInFaceToFace:${id}`,
              userIds: [head],
              message: 'recruitingCheckInFaceToFace',
              params: { name: str(employee.name), day: String(elapsed) },
              path: `/talent/employees/${str(employee.id)}`,
            });
        }
        created.push({ employeeId: str(employee.id), day: elapsed, channel: outcome === 'sent' ? 'feishu' : 'app' });
      }
      // 3 天未回复记为 noReply，不重复追问: counted from the check-in's own day (hire date + day), so a
      // simulated date (验收 · 模拟日期) and the real one agree.
      const asked = await database
        .query()
        .selectFrom('newHireCheckIns')
        .innerJoin('employees', 'employees.id', 'newHireCheckIns.employeeId')
        .select([
          'newHireCheckIns.id as id',
          'newHireCheckIns.day as day',
          'employees.hireDate as hireDate',
        ])
        .where('newHireCheckIns.status', '=', 'asked')
        .execute();
      const late = asked.filter((r) => {
        const hire = day(r.hireDate);
        return (
          hire &&
          daysBetween(addDays(hire, Number(r.day)), asOf) >=
            settings.checkIns.noReplyDays
        );
      });
      for (const r of late)
        await database
          .query()
          .updateTable('newHireCheckIns')
          .set({ status: 'noReply', updatedAt: new Date() })
          .where('id', '=', str(r.id))
          .where('status', '=', 'asked')
          .execute();
      return { created, closed: late.length };
    },

    /** The question text sent in the chat (the configured questions, one at a time as asked). */
    async questionText(checkInId: string) {
      const checkIn = await row(checkInId);
      const employee = await platform.employee(checkIn.employeeId);
      const settings = await ctx.settings();
      const t = await ctx.translate();
      return t('recruiting.checkIns.opening', {
        name: employee?.name ?? '',
        day: String(checkIn.day),
        question: settings.checkIns.questions[0] ?? '',
        more: settings.checkIns.questions.slice(1).join(' / '),
      });
    },

    /** 回访内容: the employee themselves or hr.admin; everyone else sees their routed to-dos only. */
    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.checkIn, 'view');
      const hrAdmin = await ctx.isHrAdmin(actor);
      const own = await platform.employeeOfUser(actor.userId);
      let q = database.query().selectFrom('newHireCheckIns').selectAll();
      if (query.employeeId) q = q.where('employeeId', '=', query.employeeId);
      const rows = await q.orderBy('createdAt', 'desc').execute();
      const items = rows
        .map((r) => presentCheckIn(r as Record<string, unknown>))
        .filter((c) => hrAdmin || c.employeeId === own?.id);
      const out = [];
      for (const c of items) {
        const employee = await platform.employee(c.employeeId);
        out.push({ ...c, employeeName: employee?.name ?? '' });
      }
      return { items: out };
    },
  };
  return service;
}

export type CheckIns = ReturnType<typeof createCheckIns>;

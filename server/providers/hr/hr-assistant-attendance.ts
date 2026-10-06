/**
 * The HR assistant's proactive attendance work (V2-05 主动工作):
 *
 * - 顶班推荐: for a published cell an approved leave now blocks, the rules
 *   pick who could take the shift (`listReplacementCandidates`); the
 *   assistant chooses at most three and words the reasons, the suggestion is
 *   written to the cell and the scheduler (the department's head) is told.
 *   The schedule itself is never changed. The run's dedupe key holds the
 *   cell, the leave and the candidates, so the same conflict is suggested
 *   once and again only when the candidates changed.
 * - 考勤异常提醒: consecutive missed punches not yet covered by a request
 *   remind the employee (their head when they have no account); the month's
 *   approved overtime reaching the configured share of the alert line tells
 *   the head and the task owner. Each fact is reminded once.
 * - 月底核对: after the monthly summaries, what HR must settle before
 *   locking, grouped by department, with a link to the filtered page.
 *
 * All three run as the task owner (default hr01) and read what the owner may.
 */
import { z } from 'zod';

import { AIUnavailableError } from './ai-runner.js';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
} from './attendance-config.js';
import { inquiryQuestion } from './attendance-cards.js';
import { shiftInterval } from './attendance-compute.js';
import { json, listIssues, previousMonth } from './attendance-service.js';
import type { AutomationRunContext } from './automation.js';
import type { ImChannel } from './im-channel.js';
import type { Platform } from './platform.js';
import type { ScheduleService } from './schedule-service.js';
import { addDays, str } from './shared.js';

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;

export function createHrAssistantAttendance(deps: {
  readonly platform: Platform;
  readonly schedules: () => ScheduleService;
  readonly structured: Structured;
  /** The office-suite bot: 考勤异常追问 asks the employee there. */
  readonly channel: () => ImChannel;
}) {
  const { platform } = deps;
  const { database } = platform;

  /** Claims a reminder key once; false when it was already sent. */
  async function claim(key: string): Promise<boolean> {
    try {
      const stamp = new Date();
      await database
        .query()
        .insertInto('hrReminderLog')
        .values({
          id: key,
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

  async function headOf(departmentId: string): Promise<string | null> {
    const head = await platform.organization.resolveHead(departmentId);
    return head?.userId ?? null;
  }

  /** The candidates for a conflicted cell, as the owner may read them (for the dedupe key). */
  async function candidatesFor(run: AutomationRunContext, scheduleId: string) {
    return deps.schedules().candidates(run.owner, scheduleId);
  }

  async function replacementSuggest(
    run: AutomationRunContext,
    scheduleId: string,
    found?: Awaited<ReturnType<typeof candidatesFor>>,
  ) {
    const result = found ?? (await candidatesFor(run, scheduleId));
    const { schedule, candidates } = result;
    run.summarize(`排班 ${schedule.date} · 候选 ${candidates.length} 人`);
    // `line`: the one sentence the head reads in the notice (and in Feishu) for this person.
    let chosen = candidates.slice(0, 3).map((c) => ({
      employeeId: c.employeeId,
      reasons: c.reasons,
      line: c.reasons.join('，'),
    }));
    if (candidates.length) {
      try {
        const data = await deps.structured(
          run,
          'hrAssistant',
          '顶班推荐',
          [
            '以下是规则筛出的可顶班人员（已按当月加班少者优先排序）。只从中选，最多 3 人，逐人用一句话说明理由（当天空闲、前后休息时间、当月加班与夜班数），只陈述事实、不评价员工；restBeforeHours 或 restAfterHours 为 null 表示那一侧没有相邻班次，不要写这一项，也不要写“—”。',
            JSON.stringify(
              candidates.slice(0, 10).map((c) => ({
                employeeId: c.employeeId,
                name: c.name,
                restBeforeHours: c.restBeforeHours,
                restAfterHours: c.restAfterHours,
                monthOvertimeHours: c.monthOvertimeHours,
                monthNightShifts: c.monthNightShifts,
              })),
            ),
          ].join('\n'),
          z.object({
            candidates: z
              .array(
                z.object({
                  employeeId: z.string(),
                  reason: z.string().max(200),
                }),
              )
              .max(3),
          }),
        );
        const allowed = new Map(candidates.map((c) => [c.employeeId, c]));
        const picked = data.candidates
          .filter((c) => allowed.has(c.employeeId))
          .slice(0, 3)
          .map((c) => ({
            employeeId: c.employeeId,
            reasons: [c.reason, ...allowed.get(c.employeeId)!.reasons],
            line: c.reason,
          }));
        if (picked.length) chosen = picked;
        else run.markFallback();
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
      }
    }
    await deps.schedules().saveSuggestion(run.owner, scheduleId, {
      candidates: chosen.map(({ employeeId, reasons }) => ({
        employeeId,
        reasons,
      })),
      runId: run.runId,
    });
    const employee = await database
      .query()
      .selectFrom('employees')
      .select(['name'])
      .where('id', '=', schedule.employeeId)
      .executeTakeFirst();
    const head = await headOf(schedule.departmentId);
    const names = chosen.length
      ? (
          await database
            .query()
            .selectFrom('employees')
            .select(['id', 'name'])
            .where(
              'id',
              'in',
              chosen.map((c) => c.employeeId),
            )
            .execute()
        ).map((row) => [str(row.id), str(row.name)] as const)
      : [];
    const nameOf = new Map(names);
    // “刘洋：当天空闲、休息间隔 16 小时、本月加班最少”: who and why, not only a link.
    const lines = chosen
      // The notice adds its own full stop: a reason's closing “。” or “；” read “夜班 0 次。。”.
      .map(
        (c) =>
          `${nameOf.get(c.employeeId) ?? ''}：${c.line.trim().replace(/[。；;.，,\s]+$/u, '')}`,
      )
      .join('；');
    if (head)
      await platform.notify({
        key: `replacement:${scheduleId}:${run.runId}`,
        userIds: [head],
        message: chosen.length ? 'replacementSuggested' : 'replacementNone',
        params: {
          name: str(employee?.name ?? ''),
          date: schedule.date,
          candidates: lines,
        },
        path: `/talent/schedules?department=${schedule.departmentId}&from=${schedule.date}`,
      });
    run.reference({ scheduleId, candidates: chosen.map((c) => c.employeeId) });
    return { output: { scheduleId, suggested: chosen.length } };
  }

  async function anomalyReminder(run: AutomationRunContext) {
    const today = platform.currentDate();
    const month = today.slice(0, 7);
    const limitsRow = await database
      .query()
      .selectFrom('personnelSettings')
      .select(['value'])
      .where('id', '=', 'attendance.limits')
      .executeTakeFirst();
    const limits = attendanceConfigSchemas.limits.parse(
      json(limitsRow?.value, attendanceConfigDefaults.limits),
    );
    const replyDays = Math.max(1, Number(run.params.replyDays ?? 2) || 2);
    const since = addDays(today, -7);
    const q = database.query();
    const [records, requests, employees] = await Promise.all([
      q
        .selectFrom('attendanceRecords')
        .select([
          'id',
          'employeeId',
          'date',
          'status',
          'shiftId',
          'punches',
          'lateMinutes',
          'earlyMinutes',
          'excusedByAdjustmentId',
          'inquiry',
        ])
        .where('date', '>=', addDays(today, -40))
        .where('date', '<', today)
        .orderBy('date', 'asc')
        .execute(),
      q
        .selectFrom('attendanceAdjustments')
        .select(['employeeId', 'date', 'type'])
        .where('type', 'in', ['missingPunch', 'exception'])
        .where('status', 'in', ['draft', 'pending', 'approved'])
        .where('date', '>=', addDays(today, -40))
        .execute(),
      q
        .selectFrom('employees')
        .select(['id', 'name', 'userId', 'departmentId'])
        .where('status', '!=', 'leave')
        .execute(),
    ]);
    // A missed punch is settled by a 补卡, a late or early day by a 考勤异常说明.
    const covered = new Set(
      requests.map(
        (r) =>
          `${str(r.employeeId)}:${str(r.date).slice(0, 10)}:${str(r.type)}`,
      ),
    );
    const settledBy = (status: string) =>
      status === 'missingPunch' ? 'missingPunch' : 'exception';
    const isOpen = (r: (typeof records)[number]) =>
      ['late', 'earlyLeave', 'missingPunch'].includes(str(r.status)) &&
      !r.excusedByAdjustmentId &&
      !covered.has(
        `${str(r.employeeId)}:${str(r.date).slice(0, 10)}:${settledBy(str(r.status))}`,
      );
    const shiftIds = [
      ...new Set(records.flatMap((r) => (r.shiftId ? [str(r.shiftId)] : []))),
    ];
    const shifts = new Map(
      (shiftIds.length
        ? await q
            .selectFrom('shifts')
            .select(['id', 'title', 'startTime', 'endTime'])
            .where('id', 'in', shiftIds)
            .execute()
        : []
      ).map((row) => [str(row.id), row]),
    );
    const t = await deps.channel().cards.translate();
    const now = new Date().toISOString();
    let asked = 0;
    let headReminded = 0;
    const askedRefs: { recordId: string; status: string }[] = [];

    // 1. 考勤异常追问: each new late / early / missed-punch day is asked once; consecutive missed punches together.
    for (const employee of employees) {
      const id = str(employee.id);
      const own = records.filter(
        (r) => str(r.employeeId) === id && str(r.status) !== 'rest',
      );
      const groups: (typeof records)[] = [];
      let run_: typeof records = [];
      for (const r of own) {
        const fresh =
          str(r.date).slice(0, 10) >= since && !r.inquiry && isOpen(r);
        if (fresh && str(r.status) === 'missingPunch') {
          run_.push(r);
          continue;
        }
        if (run_.length) groups.push(run_);
        run_ = [];
        if (fresh) groups.push([r]);
      }
      if (run_.length) groups.push(run_);
      for (const group of groups) {
        const first = group[0];
        const status = str(first.status);
        const shift = first.shiftId
          ? shifts.get(str(first.shiftId))
          : undefined;
        let missingSide: 'in' | 'out' = 'out';
        if (status === 'missingPunch' && shift) {
          const window = shiftInterval(
            str(first.date).slice(0, 10),
            {
              startTime: str(shift.startTime).slice(0, 5),
              endTime: str(shift.endTime).slice(0, 5),
            },
            platform.timeZone,
          );
          const punch = json<{ at: string }[]>(first.punches, [])[0];
          const at = punch ? Date.parse(punch.at) : NaN;
          missingSide =
            Number.isFinite(at) &&
            Math.abs(at - window.start) > Math.abs(at - window.end)
              ? 'in'
              : 'out';
        }
        const { question, detail } = inquiryQuestion(t, {
          status,
          dates: group.map((r) => str(r.date).slice(0, 10)),
          shiftTitle: shift ? str(shift.title) : '',
          minutes:
            status === 'late'
              ? Number(first.lateMinutes ?? 0)
              : status === 'earlyLeave'
                ? Number(first.earlyMinutes ?? 0)
                : null,
          missingSide,
        });
        // The employee in a bot chat; without an account or a binding, their department head in the inbox.
        const sent = employee.userId
          ? await deps.channel().sendText(str(employee.userId), question)
          : 'notBound';
        let channel: 'feishu' | 'head' = 'feishu';
        if (sent !== 'sent') {
          channel = 'head';
          const head = await headOf(str(employee.departmentId));
          if (head) {
            await platform.notify({
              key: `attendanceInquiry:${str(first.id)}`,
              userIds: [head],
              message: 'attendanceInquiryHead',
              params: { name: str(employee.name), detail },
              path: `/talent/attendance?tab=issues&month=${str(first.date).slice(0, 7)}`,
            });
            headReminded += 1;
          }
        }
        const recordIds = group.map((r) => str(r.id));
        for (const r of group)
          await database
            .query()
            .updateTable('attendanceRecords')
            .set({
              inquiry: {
                askedAt: now,
                channel,
                reply: null,
                repliedAt: null,
                draftAdjustmentId: null,
                recordIds,
                remindedAt: null,
              },
            })
            .where('id', '=', str(r.id))
            .execute();
        asked += 1;
        for (const r of group)
          askedRefs.push({ recordId: str(r.id), status: str(r.status) });
      }
    }

    // 2. No reply after the configured days: the employee and the head, in the inbox, once.
    let overdue = 0;
    const deadline = Date.now() - replyDays * 86_400_000;
    const seen = new Set<string>();
    for (const r of records) {
      const inquiry = json<{
        askedAt?: string;
        channel?: string;
        repliedAt?: string | null;
        remindedAt?: string | null;
        recordIds?: string[];
      } | null>(r.inquiry, null);
      if (
        !inquiry?.askedAt ||
        inquiry.channel === 'head' ||
        inquiry.repliedAt ||
        inquiry.remindedAt ||
        Date.parse(inquiry.askedAt) > deadline ||
        !isOpen(r)
      )
        continue;
      const group = inquiry.recordIds?.length ? inquiry.recordIds : [str(r.id)];
      const groupKey = `${str(r.employeeId)}:${inquiry.askedAt}`;
      if (!seen.has(groupKey)) {
        seen.add(groupKey);
        const employee = employees.find((e) => str(e.id) === str(r.employeeId));
        if (employee) {
          const head = await headOf(str(employee.departmentId));
          const dates = records
            .filter((x) => group.includes(str(x.id)))
            .map((x) => str(x.date).slice(0, 10));
          const { detail } = inquiryQuestion(t, {
            status: str(r.status),
            dates: dates.length ? dates : [str(r.date).slice(0, 10)],
            shiftTitle: '',
            minutes:
              str(r.status) === 'late'
                ? Number(r.lateMinutes ?? 0)
                : Number(r.earlyMinutes ?? 0),
          });
          if (await claim(`attendanceInquiryOverdue:${group[0]}`)) {
            await platform.notify({
              key: `attendanceInquiryOverdue:${group[0]}`,
              userIds: [
                ...new Set(
                  [employee.userId ? str(employee.userId) : null, head].filter(
                    (u): u is string => Boolean(u),
                  ),
                ),
              ],
              message: 'attendanceInquiryOverdue',
              params: {
                name: str(employee.name),
                days: String(replyDays),
                detail,
              },
              path: `/talent/attendance?tab=issues&month=${str(r.date).slice(0, 7)}`,
            });
            overdue += 1;
          }
        }
      }
      await database
        .query()
        .updateTable('attendanceRecords')
        .set({ inquiry: { ...inquiry, remindedAt: now } })
        .where('id', '=', str(r.id))
        .execute();
    }
    let overtime = 0;
    const { from } = { from: `${month}-01` };
    const ot = await q
      .selectFrom('attendanceAdjustments')
      .select(['employeeId', 'details'])
      .where('type', '=', 'overtime')
      .where('status', '=', 'approved')
      .where('date', '>=', from)
      .where('date', '<=', `${month}-31`)
      .execute();
    const hours = new Map<string, number>();
    for (const row of ot)
      hours.set(
        str(row.employeeId),
        (hours.get(str(row.employeeId)) ?? 0) +
          Number(json<{ hours?: number }>(row.details, {}).hours ?? 0),
      );
    const alertOf = await alertLines();
    for (const [id, total] of hours) {
      const employee = employees.find((e) => str(e.id) === id);
      if (!employee) continue;
      const alert = alertOf(str(employee.departmentId));
      if (total < alert * limits.overtimeReminderRatio) continue;
      if (!(await claim(`attendanceOvertime:${id}:${month}`))) continue;
      const head = await headOf(str(employee.departmentId));
      await platform.notify({
        key: `attendanceOvertime:${id}:${month}`,
        userIds: [
          ...new Set(
            [head, run.owner.userId].filter((u): u is string => Boolean(u)),
          ),
        ],
        message: 'attendanceOvertimeNear',
        params: {
          name: str(employee.name),
          hours: String(Math.round(total * 10) / 10),
          alert: String(alert),
        },
        path: `/talent/attendance?tab=monthly&month=${month}`,
      });
      overtime += 1;
    }
    // 运行记录只保存记录 id 与异常类型: never the question or the employee's reply.
    run.reference({ asked: askedRefs });
    run.summarize(
      `考勤异常追问 ${asked} 项（改为提醒部门负责人 ${headReminded} 项），未回复提醒 ${overdue} 项，加班接近预警 ${overtime} 人`,
    );
    return {
      status:
        asked || overdue || overtime
          ? ('succeeded' as const)
          : ('skipped' as const),
      output: { asked, headReminded, overdue, overtime },
    };
  }

  /** The alert line of the rule that applies to a department (nearest ancestor). */
  async function alertLines() {
    const rules = await database
      .query()
      .selectFrom('attendanceRules')
      .select(['departmentIds', 'monthlyOvertimeAlertHours'])
      .where('active', '=', true)
      .execute();
    const tree = await platform.organization.listTree();
    const parent = new Map(tree.map((d) => [d.id, d.parentId]));
    return (departmentId: string) => {
      for (
        let cursor: string | null | undefined = departmentId, i = 0;
        cursor && i < 50;
        cursor = parent.get(cursor), i++
      ) {
        const rule = rules.find((r) =>
          json<string[]>(r.departmentIds, []).includes(cursor),
        );
        if (rule) return Number(rule.monthlyOvertimeAlertHours);
      }
      return 36;
    };
  }

  async function monthEndCheck(run: AutomationRunContext, month?: string) {
    const value = month ?? previousMonth(platform.currentDate());
    const employees = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'name', 'departmentId', 'userId'])
      .execute();
    const issues = await listIssues(
      database.connection(),
      employees.map((e) => ({
        id: str(e.id),
        name: str(e.name),
        departmentId: str(e.departmentId),
        userId: e.userId ? str(e.userId) : null,
      })),
      value,
    );
    const tree = await platform.organization.listTree();
    const title = new Map(
      tree.map((d) => [d.id, platform.organization.titleText(d.title)]),
    );
    const groups = new Map<string, string[]>();
    const add = (departmentId: string, line: string) => {
      const list = groups.get(departmentId) ?? [];
      list.push(line);
      groups.set(departmentId, list);
    };
    const statusText: Record<string, string> = {
      late: '迟到',
      earlyLeave: '早退',
      missingPunch: '缺卡',
      absent: '缺勤',
    };
    // 已追问并已提交申请的列为“等待审批”，追问后未回复的列为“需要 HR 跟进”。
    const waiting = new Set<string>();
    for (const a of issues.anomalies) {
      const what = statusText[a.status] ?? a.status;
      if (a.followUp === 'waitingApproval') {
        waiting.add(`${a.employeeId}:${a.date}`);
        add(
          a.departmentId,
          `【等待审批】${a.name} ${a.date} ${what}已追问并提交申请`,
        );
      } else if (a.followUp === 'needsHr')
        add(
          a.departmentId,
          `【需要 HR 跟进】${a.name} ${a.date} ${what}已追问未回复`,
        );
      else if (a.followUp === 'drafted')
        add(
          a.departmentId,
          `【需要 HR 跟进】${a.name} ${a.date} ${what}已起草未提交`,
        );
      else add(a.departmentId, `${a.name} ${a.date} ${what}未处理`);
    }
    for (const r of issues.openRequests)
      if (!waiting.has(`${r.employeeId}:${r.date}`))
        add(r.departmentId, `${r.name} ${r.date} 申请待审批`);
    for (const o of issues.overtime)
      add(
        o.departmentId,
        `${o.name} 当月加班 ${o.hours} 小时（预警 ${o.alertHours}）`,
      );
    for (const s of issues.summaries)
      add(s.departmentId, `${s.name} 汇总${s.objection ? '有异议' : '未确认'}`);
    const lines = [...groups]
      .map(
        ([id, items]) =>
          `【${title.get(id) ?? id}】${items.slice(0, 20).join('；')}${items.length > 20 ? ` 等 ${items.length} 项` : ''}`,
      )
      .join('\n');
    run.summarize(
      `${value} 核对：${groups.size} 个部门 ${[...groups.values()].flat().length} 项`,
    );
    run.reference({ month: value });
    await platform.notify({
      key: `attendanceMonthCheck:${value}`,
      userIds: [run.owner.userId],
      message: groups.size
        ? 'attendanceMonthCheck'
        : 'attendanceMonthCheckClean',
      params: { month: value, list: lines.slice(0, 3000) },
      path: `/talent/attendance?tab=issues&month=${value}`,
    });
    return { output: { month: value, departments: groups.size } };
  }

  return { candidatesFor, replacementSuggest, anomalyReminder, monthEndCheck };
}

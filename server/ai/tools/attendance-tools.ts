import { defineTools } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { HrError, str } from '../../providers/hr/shared.js';
import {
  adjustmentServiceToken,
  attendanceServiceToken,
  leaveRequestServiceToken,
  scheduleServiceToken,
} from '../../providers/hr/tokens.js';

/**
 * V2-05 人事助理 tools. The "my" tools take no employee id: they read the
 * signed-in user's own data through the same services as the pages, with the
 * user's own authorization, so a question about someone else has nothing to
 * answer from. `draftLeaveRequest` only creates a source=hrAssistant draft;
 * the employee submits it in NocoHR. The cover tools are rules only — the
 * assistant can choose among candidates, never add one — and the two
 * task-only tools refuse outside the scheduled work.
 */
const I18N = { namespace: 'hr' };
const TASK_ONLY = {
  status: 'error' as const,
  content: { code: 'HR_ASSISTANT_TASK_ONLY', details: null },
};

const failure = (error: unknown) => {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: null },
    };
  throw error;
};

async function actorOf(ctx: {
  actor: { id: string | number };
  deps: { authz: Parameters<typeof scopeForUser>[0] };
}) {
  const userId = String(ctx.actor.id);
  return { userId, authz: await scopeForUser(ctx.deps.authz, userId) };
}

const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/u)
  .describe('The month, such as 2026-10.');

export const getMyAttendance = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read my attendance',
    about: "The signed-in employee's own attendance for a month.",
  },
  definition: {
    name: 'getMyAttendance',
    description:
      "Return the signed-in user's own attendance for one month: each day's status (normal, late, earlyLeave, missingPunch, absent, leave, rest) with late and early minutes, the monthly summary if generated, and how many missed-punch requests are used of the limit. Takes a month only, never an employee.",
    schema: z.object({ month }),
  },
  dependencies: {
    attendance: attendanceServiceToken,
    authz: authorizationToken,
  },
  invoke: async (ctx, args: { month: string }) => {
    try {
      const data = await ctx.deps.attendance.mine(await actorOf(ctx), {
        month: args.month,
      });
      return {
        status: 'success',
        content: {
          month: args.month,
          records: data.records.map((r) => ({
            date: r.date,
            status: r.status,
            lateMinutes: r.lateMinutes,
            earlyMinutes: r.earlyMinutes,
            overtimeMinutes: r.overtimeMinutes,
          })),
          summary: data.summary
            ? {
                status: data.summary.status,
                lateCount: data.summary.lateCount,
                earlyCount: data.summary.earlyCount,
                missingCount: data.summary.missingCount,
                absentDays: data.summary.absentDays,
                leaveByType: data.summary.leaveByType,
                overtimeByType: data.summary.overtimeByType,
              }
            : null,
          missingPunchUsed: data.missingPunchUsed,
          missingPunchLimit: data.missingPunchLimit,
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const getMySchedule = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read my schedule',
    about: "The signed-in employee's own published shifts.",
  },
  definition: {
    name: 'getMySchedule',
    description:
      "Return the signed-in user's own published shifts between two dates (at most two months): date, shift title, start and end time, night shift or not; days without a shift are rest. Never another employee's.",
    schema: z.object({
      from: z.iso.date().describe('First date, YYYY-MM-DD.'),
      to: z.iso.date().describe('Last date, YYYY-MM-DD.'),
    }),
  },
  dependencies: {
    attendance: attendanceServiceToken,
    authz: authorizationToken,
  },
  invoke: async (ctx, args: { from: string; to: string }) => {
    try {
      const actor = await actorOf(ctx);
      const months = [...new Set([args.from.slice(0, 7), args.to.slice(0, 7)])];
      if (months.length > 2 || args.to < args.from)
        throw new HrError('INVALID_DATE_RANGE', 400);
      const schedules = [];
      for (const value of months)
        schedules.push(
          ...(await ctx.deps.attendance.mine(actor, { month: value }))
            .schedules,
        );
      return {
        status: 'success',
        content: schedules.filter(
          (s) => s.date >= args.from && s.date <= args.to,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const getMyLeaveBalance = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read my leave balance',
    about: "The signed-in employee's own leave balances and leave types.",
  },
  definition: {
    name: 'getMyLeaveBalance',
    description:
      "Return the signed-in user's own leave balances for this year (entitled, carried over, used, pending, available, in days) and the active leave types with their unit, whether proof is required and the fixed days of per-event types. Takes no arguments.",
    schema: z.object({}),
  },
  dependencies: { leave: leaveRequestServiceToken, authz: authorizationToken },
  invoke: async (ctx) => {
    try {
      const actor = await actorOf(ctx);
      const [balances, types] = await Promise.all([
        ctx.deps.leave.myBalances(actor, {}),
        ctx.deps.leave.listTypes(actor),
      ]);
      return {
        status: 'success',
        content: {
          balances,
          types: types.data.map((t) => ({
            id: str(t.id),
            code: str(t.code),
            title: str(t.title),
            unit: str(t.unit),
            balanceRule: str(t.balanceRule),
            fixedDays: t.fixedDays == null ? null : Number(t.fixedDays),
            requiresAttachment: Boolean(t.requiresAttachment),
            countBy: str(t.countBy),
          })),
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const draftLeaveRequest = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Draft my leave request',
    about:
      'Creates a draft leave request for the signed-in employee, who submits it in NocoHR.',
  },
  definition: {
    name: 'draftLeaveRequest',
    description:
      "Create a DRAFT leave request for the signed-in user only (source hrAssistant). Returns the server-computed duration, the balances, the conflicts with the user's published schedule (scheduleConflicts: date and shift) and the draft link; it is not submitted and uses no balance until the employee submits it on the page or on the 本人提交 card. Times are ISO 8601 with offset; a whole day starts at 00:00 and ends at 00:00 of the next day.",
    schema: z.object({
      leaveType: z
        .string()
        .describe('The leave type code (such as annual) or id.'),
      startAt: z.iso.datetime({ offset: true }),
      endAt: z.iso.datetime({ offset: true }),
      reason: z.string().max(1000).optional(),
    }),
  },
  dependencies: { leave: leaveRequestServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      leaveType: string;
      startAt: string;
      endAt: string;
      reason?: string;
    },
  ) => {
    try {
      const actor = await actorOf(ctx);
      const types = await ctx.deps.leave.listTypes(actor);
      const type = types.data.find(
        (t) => str(t.code) === args.leaveType || str(t.id) === args.leaveType,
      );
      if (!type) throw new HrError('LEAVE_TYPE_NOT_FOUND', 404);
      const draft = (await ctx.deps.leave.createDraft(actor, {
        leaveTypeId: str(type.id),
        startAt: args.startAt,
        endAt: args.endAt,
        reason: args.reason ?? null,
        source: 'hrAssistant',
      })) as { id: string; duration: number };
      const balances = await ctx.deps.leave.myBalances(actor, {});
      // 与本人已发布排班的冲突: the shifts the leave would take off.
      const conflicts = await ctx.deps.leave.scheduleConflicts(actor, draft.id);
      return {
        status: 'success',
        content: {
          id: draft.id,
          scheduleConflicts: conflicts,
          leaveType: str(type.title),
          unit: str(type.unit),
          duration: draft.duration,
          requiresAttachment: Boolean(type.requiresAttachment),
          balances,
          link: `/talent/me/leave/${draft.id}/edit`,
          note: '草稿须由本人在页面上提交。',
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const listReplacementCandidates = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List cover candidates',
    about: 'Who could take a shift that a leave now blocks, by the rules.',
  },
  definition: {
    name: 'listReplacementCandidates',
    description:
      "For a schedule cell with a leave conflict, return who could take the shift by the rules: same department, the shift applies to them, free that day, no leave, enough rest before and after, within the night-shift limit; with this month's overtime hours and night shifts, fewest overtime first. Only cells the user may see.",
    schema: z.object({ scheduleId: z.string() }),
  },
  dependencies: { schedules: scheduleServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { scheduleId: string }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.schedules.candidates(
          await actorOf(ctx),
          args.scheduleId,
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveReplacementSuggestion = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Save a cover suggestion',
    about:
      'Writes up to three suggested candidates on the cell; the schedule is unchanged.',
  },
  definition: {
    name: 'saveReplacementSuggestion',
    description:
      'Write at most three cover candidates, each from listReplacementCandidates, with reasons, onto the schedule cell. Does not change the schedule.',
    schema: z.object({
      scheduleId: z.string(),
      candidates: z
        .array(
          z.object({ employeeId: z.string(), reasons: z.array(z.string()) }),
        )
        .max(3),
    }),
  },
  dependencies: { schedules: scheduleServiceToken, authz: authorizationToken },
  invoke: async (
    ctx,
    args: {
      scheduleId: string;
      candidates: { employeeId: string; reasons: string[] }[];
    },
  ) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.schedules.saveSuggestion(
          await actorOf(ctx),
          args.scheduleId,
          { candidates: args.candidates, runId: null },
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const listAttendanceIssues = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'List attendance issues',
    about: 'What HR must settle before locking a month; used by tasks only.',
  },
  definition: {
    name: 'listAttendanceIssues',
    description:
      'Unresolved anomalies, open requests, overtime near the alert line and unconfirmed or objected summaries of a month. Only available inside the HR assistant tasks.',
    schema: z.object({ month, departmentId: z.string().optional() }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

export const sendAttendanceNotice = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Send an attendance notice',
    about: 'Sends an in-app attendance reminder; used by tasks only.',
  },
  definition: {
    name: 'sendAttendanceNotice',
    description:
      'Send an in-app attendance reminder with a link. Only available inside the HR assistant tasks.',
    schema: z.object({
      recipients: z.array(z.string()),
      body: z.string(),
      link: z.string().optional(),
    }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

export const draftMyAttendanceAdjustment = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Draft my missed punch or exception',
    about:
      'Creates a draft 补卡单 or 考勤异常说明 for one of the signed-in employee’s own attendance records; the employee submits it.',
  },
  definition: {
    name: 'draftMyAttendanceAdjustment',
    description:
      "Create a DRAFT for the signed-in user's own attendance record (source hrAssistant): type missingPunch (补卡) for a missed punch, or exception (考勤异常说明) for a late arrival or early leave. For missingPunch, `at` is optional and defaults to the shift's standard start or end time on the side without a punch; it must fall inside the shift's window. For exception, pass the policy clause found in the knowledge base as `policy` when there is one. Drafts do not count towards the monthly missed-punch limit; only the employee submits them (in NocoHR or on the 本人提交 card).",
    schema: z.object({
      attendanceRecordId: z.string(),
      type: z.enum(['missingPunch', 'exception']),
      at: z.iso
        .datetime({ offset: true })
        .optional()
        .describe(
          'The punch time for missingPunch; omit for the standard time.',
        ),
      reason: z.string().min(1).max(1000),
      policy: z
        .object({
          documentId: z.string(),
          documentTitle: z.string(),
          citation: z.string(),
        })
        .optional(),
    }),
  },
  dependencies: {
    adjustments: adjustmentServiceToken,
    authz: authorizationToken,
  },
  invoke: async (
    ctx,
    args: {
      attendanceRecordId: string;
      type: 'missingPunch' | 'exception';
      at?: string;
      reason: string;
      policy?: { documentId: string; documentTitle: string; citation: string };
    },
  ) => {
    try {
      const draft = await ctx.deps.adjustments.draftFromRecord(
        await actorOf(ctx),
        args,
      );
      return {
        status: 'success',
        content: {
          id: draft.id,
          type: draft.type,
          date: draft.date,
          details: draft.details,
          status: draft.status,
          link: '/talent/me?tab=requests#attendance',
          note: '草稿须由本人提交。',
        },
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const askAttendanceException = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Ask about an attendance anomaly',
    about:
      'Asks the employee about an anomaly in a bot chat; used by the 09:00 task only.',
  },
  definition: {
    name: 'askAttendanceException',
    description:
      'Ask the employee (or their department head when they cannot be reached) about one attendance anomaly and record the question on the record. Only available inside the HR assistant tasks.',
    schema: z.object({
      attendanceRecordId: z.string(),
      question: z.string().max(500),
    }),
  },
  invoke: () => Promise.resolve(TASK_ONLY),
});

export const inviteReplacement = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: {
    title: 'Invite cover candidates',
    about:
      'Sends 顶班邀请 cards to chosen candidates of a conflicted cell, after the scheduler approves.',
  },
  definition: {
    name: 'inviteReplacement',
    description:
      'Send a 顶班邀请 card (接受 / 不方便) to each chosen candidate of a schedule cell with a leave conflict; candidates must come from listReplacementCandidates. Runs only after the scheduler approves the call. The first to accept goes into that shift as a schedule draft for the scheduler to publish; the others expire.',
    schema: z.object({
      scheduleId: z.string(),
      candidateIds: z.array(z.string()).min(1).max(3),
    }),
  },
  dependencies: { schedules: scheduleServiceToken, authz: authorizationToken },
  invoke: async (ctx, args: { scheduleId: string; candidateIds: string[] }) => {
    try {
      return {
        status: 'success',
        content: await ctx.deps.schedules.invite(
          await actorOf(ctx),
          args.scheduleId,
          { candidateIds: args.candidateIds },
        ),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

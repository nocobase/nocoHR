/**
 * V2-05 (realigned) 考勤与假期在飞书里办 (总纲 AI 员工约定第 10 条), on the V1-04
 * card framework (im-cards/types.ts):
 *
 * - 本人提交 cards for what the HR assistant drafted in a bot conversation: a
 *   leave request (`leaveDraftSubmit`, with the conflicts it has with the
 *   employee's published schedule) and missed-punch / exception drafts
 *   (`attendanceDraftSubmit`, all drafts of one turn on one card). 提交 calls
 *   the same submit as 我的申请, as the employee, marked `feishuCard`.
 * - 审批 cards to the current approver: `leaveApproval` and
 *   `attendanceAdjustmentApproval` (a shift swap's 对方同意 too). 同意 / 驳回
 *   (a comment is required to reject) call the same decide as the approval
 *   page; a decision made elsewhere refreshes the sent cards through the push
 *   routes below.
 * - 顶班邀请 (`replacementInvite`): sent only when the scheduler clicks
 *   发出顶班邀请; 接受 / 不方便 answer through the schedule service, the first
 *   接受 becomes a schedule draft and the scheduler is told.
 * - The bot hooks: an answer to 考勤异常追问 is recorded on the attendance
 *   record (the reply text lives only there) and handed to the HR assistant
 *   with its context and the policy clause found in the knowledge base; with
 *   no model, the rules draft the missed punches or the exception
 *   explanation. After the HR assistant's turn, its drafts become the cards.
 *
 * Cards carry summaries only: no mobile, ID number, address, pay or proof.
 */
import type { DatabaseManager } from '@nocobase/db';
import type { ServiceContainer } from '@nocobase/service-provider';
import { z } from 'zod';

import type { AdjustmentService } from './adjustment-service.js';
import { json, presentInquiry } from './attendance-service.js';
import { scopeForUser } from './authorize.js';
import { displayValue, type CustomFieldService } from './custom-fields.js';
import type { ActorContext } from './framework-service.js';
import type { ImChannel } from './im-channel.js';
import {
  defineCardKind,
  type CardKindDefinition,
  type Translate,
} from './im-cards/types.js';
import type { KnowledgeService } from './knowledge-service.js';
import type { LeaveRequestService } from './leave-request-service.js';
import type { OrganizationService } from './organization-service.js';
import type { Notify, Platform } from './platform.js';
import type { ScheduleService } from './schedule-service.js';
import { HrError, str } from './shared.js';
import {
  adjustmentServiceToken,
  customFieldServiceToken,
  imChannelToken,
  knowledgeServiceToken,
  leaveRequestServiceToken,
  platformToken,
  scheduleServiceToken,
} from './tokens.js';

export const LEAVE_SUBMIT_CARD = 'leaveDraftSubmit';
export const ADJUSTMENT_SUBMIT_CARD = 'attendanceDraftSubmit';
export const LEAVE_APPROVAL_CARD = 'leaveApproval';
export const ADJUSTMENT_APPROVAL_CARD = 'attendanceAdjustmentApproval';
export const INVITE_CARD = 'replacementInvite';

/** A reply that says the day was not worked as recorded: suggest the fitting request, draft nothing. */
const NOT_A_PUNCH =
  /请假|事假|病假|生病|看病|没来|没上班|旷工|不属实|休息|调休|no[\s-]?show|sick|leave/iu;
/**
 * A new question rather than an answer (我还有几天年假？): it goes to the
 * assistants as usual and the inquiry stays open.
 */
const A_QUESTION = /[？?]|几天|多少|怎么|能不能|可以吗|是否/u;

const shortDate = (value: string) => value.slice(5);
const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);

interface Deps {
  readonly database: DatabaseManager;
  readonly timeZone: string;
  readonly organization: OrganizationService;
  readonly notify: Notify;
  readonly authz: Platform['authz'];
  readonly channel: () => ImChannel;
  readonly leave: () => LeaveRequestService;
  readonly adjustments: () => AdjustmentService;
  readonly schedules: () => ScheduleService;
  readonly knowledge: () => KnowledgeService;
  readonly customFields: () => CustomFieldService;
}

async function actorFor(deps: Deps, userId: string): Promise<ActorContext> {
  return { userId, authz: await scopeForUser(deps.authz, userId) };
}

/** An HrError as a card result; anything else is a programming error and is thrown. */
function codeOf(error: unknown): string {
  if (error instanceof HrError) return error.code;
  throw error;
}

function localDate(value: unknown, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(
    new Date(str(value)),
  );
}

function createKinds(deps: Deps) {
  const { database, timeZone } = deps;

  async function shiftOf(shiftId: string | null) {
    if (!shiftId) return undefined;
    return database
      .query()
      .selectFrom('shifts')
      .select(['title', 'startTime', 'endTime'])
      .where('id', '=', shiftId)
      .executeTakeFirst();
  }

  async function nameOf(employeeId: string): Promise<string> {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['name'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    return row ? str(row.name) : '';
  }

  /**
   * 界面追加字段 on an approval card: only non-sensitive fields placed on the
   * detail, whatever the recipient may read in the app — a card is a message.
   */
  async function customFieldLines(
    collection: 'leaveRequests' | 'attendanceAdjustments',
    values: unknown,
    t: Translate,
  ): Promise<string[]> {
    const service = deps.customFields();
    const read = { sensitive: false, placement: 'detail' } as const;
    const definitions = service.visible(await service.list(collection), read);
    const shown = service.project(definitions, values, read);
    return definitions
      .filter((d) => shown[d.key] != null)
      .map((d) =>
        t('attendanceCards.customField', {
          zh: d.label['zh-CN'],
          en: d.label['en-US'] ?? d.label['zh-CN'],
          value:
            d.type === 'boolean'
              ? t(shown[d.key] === true ? 'attendanceCards.yes' : 'attendanceCards.no')
              : displayValue(d, shown[d.key]),
        }),
      );
  }

  // ---- 本人提交 · 请假单 ----------------------------------------------------
  const leaveSubmit = defineCardKind({
    kind: LEAVE_SUBMIT_CARD,
    payload: z.object({ requestId: z.string().min(1).max(64) }),
    async render({ payload, actor, card, t }) {
      const link = {
        label: t('attendanceCards.editInApp'),
        path: `/talent/me/leave/${payload.requestId}/edit`,
      };
      let row: Record<string, unknown>;
      try {
        row = await deps.leave().get(actor, payload.requestId);
      } catch (error) {
        codeOf(error);
        return {
          title: t('attendanceCards.leaveSubmit.title'),
          lines: [],
          buttons: [],
          link,
          state: 'handled',
          stateText: t('imCards.state.unavailable'),
        };
      }
      const type = await database
        .query()
        .selectFrom('leaveTypes')
        .select(['requiresAttachment'])
        .where('id', '=', str(row.leaveTypeId))
        .executeTakeFirst();
      const conflicts = await deps
        .leave()
        .scheduleConflicts(actor, payload.requestId);
      const unit = str(row.leaveUnit || 'day');
      const lines = [
        t('attendanceCards.leaveSubmit.line', {
          leaveType: str(row.leaveTypeTitle),
          from: shortDate(localDate(row.startAt, timeZone)),
          to: shortDate(
            localDate(
              new Date(new Date(str(row.endAt)).getTime() - 1).toISOString(),
              timeZone,
            ),
          ),
          duration: Number(row.duration),
          unit: t(`attendanceCards.units.${unit}`),
        }),
        ...(row.reason
          ? [t('attendanceCards.leaveSubmit.reason', { reason: row.reason })]
          : []),
        ...conflicts.map((c) =>
          t('attendanceCards.leaveSubmit.conflict', {
            date: shortDate(c.date),
            shift: c.shiftTitle,
            time: `${c.startTime}–${c.endTime}`,
          }),
        ),
        ...(type?.requiresAttachment && !row.attachmentFileId
          ? [t('attendanceCards.leaveSubmit.attachment')]
          : []),
      ];
      const open = card.status === 'open' && str(row.status) === 'draft';
      return {
        title: t('attendanceCards.leaveSubmit.title'),
        lines,
        buttons: open
          ? [
              {
                key: 'submit',
                label: t('attendanceCards.submit'),
                style: 'primary',
              },
              { key: 'discard', label: t('attendanceCards.discard') },
            ]
          : [],
        link,
        state: open ? 'open' : 'handled',
        stateText: open
          ? undefined
          : [
              t('imCards.state.handled'),
              str(row.status) === 'draft'
                ? null
                : t(`attendanceCards.approval.status.${str(row.status)}`),
            ]
              .filter(Boolean)
              .join(' · '),
      };
    },
    async act({ payload, actor, button, t }) {
      if (button === 'discard')
        return {
          outcome: 'discarded',
          message: t('attendanceCards.leaveSubmit.discarded'),
        };
      if (button !== 'submit')
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      try {
        const row = (await deps.leave().get(actor, payload.requestId)) as {
          status?: unknown;
          updatedAt?: unknown;
        };
        if (str(row.status) !== 'draft')
          return {
            outcome: 'handled',
            message: t('imCards.result.alreadyHandled'),
          };
        await deps
          .leave()
          .submit(
            actor,
            payload.requestId,
            { expectedUpdatedAt: str(row.updatedAt) },
            'feishuCard',
          );
      } catch (error) {
        const code = codeOf(error);
        if (code === 'ATTACHMENT_REQUIRED')
          return {
            outcome: 'kept',
            message: t('attendanceCards.leaveSubmit.attachmentRequired'),
          };
        if (code === 'CUSTOM_FIELD_INVALID')
          return {
            outcome: 'kept',
            message: t('attendanceCards.customFieldsRequired'),
          };
        if (code === 'REQUEST_STATE_CONFLICT')
          return {
            outcome: 'handled',
            message: t('imCards.result.alreadyHandled'),
          };
        if (
          code === 'FORBIDDEN' ||
          code === 'ONLY_EMPLOYEE_MAY_SUBMIT' ||
          code === 'NOT_FOUND'
        )
          return { outcome: 'refused', message: t('imCards.result.notFound') };
        return {
          outcome: 'kept',
          message: t('imCards.result.failed', { code }),
        };
      }
      return {
        outcome: 'handled',
        message: t('attendanceCards.leaveSubmit.submitted'),
      };
    },
  });

  // ---- 本人提交 · 补卡单与考勤异常说明 ----------------------------------------
  async function adjustmentLine(
    row: Awaited<ReturnType<AdjustmentService['get']>>,
    t: Translate,
  ): Promise<string[]> {
    const date = shortDate(row.date);
    const details = row.details;
    const lines: string[] = [];
    if (row.type === 'missingPunch') {
      const record = await database
        .query()
        .selectFrom('shiftSchedules')
        .select(['shiftId'])
        .where('employeeId', '=', row.employeeId)
        .where('date', '=', row.date)
        .executeTakeFirst();
      const shift = await shiftOf(record?.shiftId ? str(record.shiftId) : null);
      const at = new Date(str(details.at));
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(at);
      const start = shift ? str(shift.startTime).slice(0, 5) : '';
      const end = shift ? str(shift.endTime).slice(0, 5) : '';
      const side =
        shift &&
        Math.abs(minutesOf(time) - minutesOf(end)) <
          Math.abs(minutesOf(time) - minutesOf(start))
          ? 'out'
          : 'in';
      lines.push(
        t('attendanceCards.adjustmentSubmit.missingPunch', {
          date,
          shift: shift ? str(shift.title) : '',
          side: t(`attendanceCards.sides.${side}`),
          time,
        }),
      );
    } else if (row.type === 'exception') {
      lines.push(
        t('attendanceCards.adjustmentSubmit.exception', {
          date,
          anomaly: t(`attendanceCards.anomalies.${str(details.anomaly)}`),
          minutes: Number(details.minutes ?? 0),
        }),
      );
    } else lines.push(`${t(`attendanceCards.types.${row.type}`)} · ${date}`);
    lines.push(
      t('attendanceCards.adjustmentSubmit.reason', { reason: row.reason }),
    );
    const policy = details.policy as { citation?: string } | undefined;
    if (policy?.citation)
      lines.push(
        t('attendanceCards.adjustmentSubmit.policy', {
          citation: policy.citation,
        }),
      );
    return lines;
  }

  const adjustmentSubmit = defineCardKind({
    kind: ADJUSTMENT_SUBMIT_CARD,
    payload: z.object({
      adjustmentIds: z.array(z.string().min(1).max(64)).min(1).max(10),
    }),
    async render({ payload, actor, card, t }) {
      const rows = [];
      for (const id of payload.adjustmentIds)
        try {
          rows.push(await deps.adjustments().get(actor, id));
        } catch (error) {
          codeOf(error);
        }
      const lines: string[] = [];
      for (const row of rows) lines.push(...(await adjustmentLine(row, t)));
      const open =
        card.status === 'open' && rows.some((row) => row.status === 'draft');
      return {
        title: t('attendanceCards.adjustmentSubmit.title'),
        lines,
        buttons: open
          ? [
              {
                key: 'submit',
                label: t('attendanceCards.submit'),
                style: 'primary',
              },
              { key: 'discard', label: t('attendanceCards.discard') },
            ]
          : [],
        link: {
          label: t('attendanceCards.editInApp'),
          path: '/talent/me?tab=requests#attendance',
        },
        state: open ? 'open' : rows.length ? 'handled' : 'discarded',
        stateText: open
          ? undefined
          : rows.length
            ? [
                t('imCards.state.handled'),
                ...new Set(
                  rows
                    .filter((row) => row.status !== 'draft')
                    .map((row) =>
                      t(`attendanceCards.approval.status.${row.status}`),
                    ),
                ),
              ].join(' · ')
            : t('imCards.state.unavailable'),
      };
    },
    async act({ payload, actor, button, t }) {
      if (button !== 'submit' && button !== 'discard')
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      let done = 0;
      const failed: string[] = [];
      let limit: number | undefined;
      for (const id of payload.adjustmentIds) {
        try {
          const row = await deps.adjustments().get(actor, id);
          if (row.status !== 'draft') continue;
          if (button === 'discard')
            await deps.adjustments().discardDraft(actor, id);
          else await deps.adjustments().submitDraft(actor, id, 'feishuCard');
          done += 1;
        } catch (error) {
          const code = codeOf(error);
          failed.push(code);
          if (code === 'MISSING_PUNCH_LIMIT')
            limit = Number(
              (error as HrError).details &&
                (error as HrError & { details: { limit?: number } }).details
                  .limit,
            );
        }
      }
      if (button === 'discard')
        return {
          outcome: 'discarded',
          message: t('attendanceCards.adjustmentSubmit.discarded'),
        };
      if (!failed.length)
        return done
          ? {
              outcome: 'handled',
              message: t('attendanceCards.adjustmentSubmit.submitted', {
                count: done,
              }),
            }
          : {
              outcome: 'handled',
              message: t('imCards.result.alreadyHandled'),
            };
      if (!done)
        return {
          outcome: 'kept',
          message:
            limit !== undefined
              ? t('attendanceCards.adjustmentSubmit.limit', { limit })
              : failed[0] === 'CUSTOM_FIELD_INVALID'
                ? t('attendanceCards.customFieldsRequired')
                : t('imCards.result.failed', { code: failed[0] }),
        };
      return {
        outcome: 'handled',
        message: t('attendanceCards.adjustmentSubmit.partial', {
          done,
          failed: failed.length,
          code: failed[0],
        }),
      };
    },
  });

  // ---- 审批 · 请假 ----------------------------------------------------------
  const leaveApproval = defineCardKind({
    kind: LEAVE_APPROVAL_CARD,
    payload: z.object({
      requestId: z.string().min(1).max(64),
      level: z.number().int().min(1).max(20),
    }),
    async render({ payload, actor, t }) {
      const link = {
        label: t('imCards.openInApp'),
        path: `/talent/approvals/leave/${payload.requestId}?tab=leave`,
      };
      let row: Record<string, unknown>;
      try {
        row = await deps.leave().get(actor, payload.requestId);
      } catch (error) {
        codeOf(error);
        return {
          title: t('attendanceCards.approval.leaveTitle'),
          lines: [],
          buttons: [],
          link,
          state: 'handled',
          stateText: t('imCards.state.unavailable'),
        };
      }
      const steps = (row.approvals ?? []) as {
        level?: number;
        status: string;
      }[];
      const index = steps.findIndex((s) => s.status === 'pending');
      const open =
        str(row.status) === 'pending' &&
        index + 1 === payload.level &&
        Boolean(row.canApprove);
      const unit = str(row.leaveUnit || 'day');
      return {
        title: t('attendanceCards.approval.leaveTitle'),
        lines: [
          t('attendanceCards.approval.leaveLine', {
            name: str(row.employeeName),
            leaveType: str(row.leaveTypeTitle),
            from: shortDate(localDate(row.startAt, timeZone)),
            to: shortDate(
              localDate(
                new Date(new Date(str(row.endAt)).getTime() - 1).toISOString(),
                timeZone,
              ),
            ),
            duration: Number(row.duration),
            unit: t(`attendanceCards.units.${unit}`),
          }),
          ...(row.reason
            ? [t('attendanceCards.approval.reason', { reason: row.reason })]
            : []),
          ...(await customFieldLines('leaveRequests', row.customFields, t)),
          t('attendanceCards.approval.level', { level: payload.level }),
        ],
        buttons: open
          ? [
              {
                key: 'approve',
                label: t('imCards.approval.approve'),
                style: 'primary',
              },
              {
                key: 'reject',
                label: t('imCards.approval.reject'),
                style: 'danger',
                comment: 'required',
              },
            ]
          : [],
        link,
        state: open ? 'open' : 'handled',
        stateText: open
          ? undefined
          : [
              t('imCards.state.handled'),
              t(`attendanceCards.approval.status.${str(row.status)}`),
            ].join(' · '),
      };
    },
    async act({ payload, actor, button, comment, t }) {
      if (button !== 'approve' && button !== 'reject')
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      if (button === 'reject' && !comment)
        return {
          outcome: 'kept',
          message: t('imCards.approval.commentRequired'),
        };
      try {
        const row = (await deps.leave().get(actor, payload.requestId)) as {
          status?: unknown;
          updatedAt?: unknown;
          canApprove?: boolean;
          approvals?: { status: string }[];
        };
        const index = (row.approvals ?? []).findIndex(
          (s) => s.status === 'pending',
        );
        if (str(row.status) !== 'pending' || index + 1 !== payload.level)
          return {
            outcome: 'handled',
            message: t('imCards.result.alreadyHandled'),
          };
        if (!row.canApprove)
          return {
            outcome: 'refused',
            message: t('imCards.approval.notApprover'),
          };
        await deps.leave().decide(
          actor,
          payload.requestId,
          {
            decision: button === 'approve' ? 'approved' : 'rejected',
            comment,
            expectedUpdatedAt: str(row.updatedAt),
          },
          'feishuCard',
        );
      } catch (error) {
        const code = codeOf(error);
        if (code === 'REQUEST_STATE_CONFLICT' || code === 'CONFLICT')
          return {
            outcome: 'handled',
            message: t('imCards.result.alreadyHandled'),
          };
        if (code === 'SELF_APPROVAL_FORBIDDEN')
          return {
            outcome: 'refused',
            message: t('imCards.approval.selfApproval'),
          };
        if (
          code === 'NOT_CURRENT_APPROVER' ||
          code === 'NOT_FOUND' ||
          code === 'FORBIDDEN'
        )
          return {
            outcome: 'refused',
            message: t('imCards.approval.notApprover'),
          };
        return {
          outcome: 'kept',
          message: t('imCards.result.failed', { code }),
        };
      }
      return {
        outcome: 'handled',
        message:
          button === 'approve'
            ? t('imCards.approval.approved')
            : t('imCards.approval.rejectedDone'),
      };
    },
  });

  // ---- 审批 · 补卡、加班、调班、考勤异常说明 ------------------------------------
  const adjustmentApproval = defineCardKind({
    kind: ADJUSTMENT_APPROVAL_CARD,
    payload: z.object({
      adjustmentId: z.string().min(1).max(64),
      level: z.number().int().min(1).max(20),
    }),
    async render({ payload, actor, t }) {
      const link = {
        label: t('imCards.openInApp'),
        path: `/talent/approvals/adjustments/${payload.adjustmentId}`,
      };
      let row: Awaited<ReturnType<AdjustmentService['get']>>;
      try {
        row = await deps.adjustments().get(actor, payload.adjustmentId);
      } catch (error) {
        codeOf(error);
        return {
          title: t('attendanceCards.approval.title', {
            type: t('attendanceCards.types.missingPunch'),
          }),
          lines: [],
          buttons: [],
          link,
          state: 'handled',
          stateText: t('imCards.state.unavailable'),
        };
      }
      link.path = `/talent/approvals/adjustments/${row.id}?tab=${row.type}`;
      const step = row.approvals.find((s) => s.level === payload.level);
      const consent = step?.kind === 'counterparty';
      const current = row.approvals.find((s) => s.status === 'pending');
      const open =
        row.status === 'pending' &&
        current?.level === payload.level &&
        row.canDecide;
      const type = t(`attendanceCards.types.${row.type}`);
      const lines = [
        t('attendanceCards.approval.line', {
          name: await nameOf(row.employeeId),
          type,
          date: shortDate(row.date),
        }),
        ...(await adjustmentLine(row, t)).slice(
          row.type === 'missingPunch' || row.type === 'exception' ? 0 : 1,
        ),
        ...(await customFieldLines(
          'attendanceAdjustments',
          row.customFields,
          t,
        )),
        t('attendanceCards.approval.level', { level: payload.level }),
      ];
      return {
        title: consent
          ? t('attendanceCards.approval.consentTitle')
          : t('attendanceCards.approval.title', { type }),
        lines,
        buttons: open
          ? [
              {
                key: 'approve',
                label: consent
                  ? t('attendanceCards.approval.agree')
                  : t('imCards.approval.approve'),
                style: 'primary',
              },
              {
                key: 'reject',
                label: consent
                  ? t('attendanceCards.approval.disagree')
                  : t('imCards.approval.reject'),
                style: 'danger',
                comment: 'required',
              },
            ]
          : [],
        link,
        state: open ? 'open' : 'handled',
        stateText: open
          ? undefined
          : [
              t('imCards.state.handled'),
              t(`attendanceCards.approval.status.${row.status}`),
            ].join(' · '),
      };
    },
    async act({ payload, actor, button, comment, t }) {
      if (button !== 'approve' && button !== 'reject')
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      if (button === 'reject' && !comment)
        return {
          outcome: 'kept',
          message: t('imCards.approval.commentRequired'),
        };
      try {
        const row = await deps.adjustments().get(actor, payload.adjustmentId);
        const current = row.approvals.find((s) => s.status === 'pending');
        if (row.status !== 'pending' || current?.level !== payload.level)
          return {
            outcome: 'handled',
            message: t('imCards.result.alreadyHandled'),
          };
        if (!row.canDecide)
          return {
            outcome: 'refused',
            message: t('imCards.approval.notApprover'),
          };
        await deps.adjustments().decide(
          actor,
          payload.adjustmentId,
          {
            decision: button === 'approve' ? 'approved' : 'rejected',
            comment,
            expectedUpdatedAt: row.updatedAt,
          },
          'feishuCard',
        );
      } catch (error) {
        const code = codeOf(error);
        if (code === 'REQUEST_STATE_CONFLICT' || code === 'CONFLICT')
          return {
            outcome: 'handled',
            message: t('imCards.result.alreadyHandled'),
          };
        if (
          code === 'NOT_CURRENT_APPROVER' ||
          code === 'NOT_FOUND' ||
          code === 'FORBIDDEN'
        )
          return {
            outcome: 'refused',
            message: t('imCards.approval.notApprover'),
          };
        return {
          outcome: 'kept',
          message: t('imCards.result.failed', { code }),
        };
      }
      return {
        outcome: 'handled',
        message:
          button === 'approve'
            ? t('imCards.approval.approved')
            : t('imCards.approval.rejectedDone'),
      };
    },
  });

  // ---- 顶班邀请 -------------------------------------------------------------
  async function ownEmployeeId(userId: string) {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['id'])
      .where('userId', '=', userId)
      .executeTakeFirst();
    return row ? str(row.id) : undefined;
  }

  const invite = defineCardKind({
    kind: INVITE_CARD,
    payload: z.object({ scheduleId: z.string().min(1).max(64) }),
    async render({ payload, actor, card, t }) {
      const employeeId = await ownEmployeeId(actor.userId);
      const found = employeeId
        ? await deps.schedules().invitationOf(payload.scheduleId, employeeId)
        : undefined;
      const invitation = found?.invitation ?? null;
      const shift = await shiftOf(found?.shiftId ?? null);
      const department = found
        ? await deps.organization.getDepartment(found.departmentId)
        : undefined;
      const inviter = invitation?.invitedBy
        ? await database
            .query()
            .selectFrom('employees')
            .select(['name'])
            .where('userId', '=', invitation.invitedBy)
            .executeTakeFirst()
        : undefined;
      const lines =
        found && shift
          ? [
              t('attendanceCards.invite.line', {
                date: found.date,
                shift: str(shift.title),
                time: `${str(shift.startTime).slice(0, 5)}–${str(shift.endTime).slice(0, 5)}`,
              }),
              t('attendanceCards.invite.from', {
                department: department
                  ? deps.organization.titleText(department.title)
                  : '',
                inviter: inviter ? str(inviter.name) : '',
              }),
            ]
          : [];
      const open =
        card.status === 'open' && Boolean(invitation && !invitation.response);
      const response = invitation?.response ?? 'expired';
      return {
        title: t('attendanceCards.invite.title'),
        lines,
        buttons: open
          ? [
              {
                key: 'accept',
                label: t('attendanceCards.invite.accept'),
                style: 'primary',
              },
              { key: 'decline', label: t('attendanceCards.invite.decline') },
            ]
          : [],
        link: {
          label: t('imCards.openInApp'),
          path: found
            ? `/talent/me?month=${found.date.slice(0, 7)}#attendance`
            : '/talent/me#attendance',
        },
        state: open ? 'open' : 'handled',
        stateText: open
          ? undefined
          : t(`attendanceCards.invite.state.${response}`),
      };
    },
    async act({ payload, actor, button, t }) {
      if (button !== 'accept' && button !== 'decline')
        return { outcome: 'refused', message: t('imCards.result.notFound') };
      let result: Awaited<ReturnType<ScheduleService['respondInvitation']>>;
      try {
        result = await deps
          .schedules()
          .respondInvitation(
            actor,
            payload.scheduleId,
            button === 'accept' ? 'accepted' : 'declined',
          );
      } catch (error) {
        return {
          outcome: 'kept',
          message: t('imCards.result.failed', { code: codeOf(error) }),
        };
      }
      if (result.outcome === 'accepted' && result.inviterUserId)
        await deps.notify({
          key: `replacementAccepted:${payload.scheduleId}`,
          userIds: [result.inviterUserId],
          message: 'replacementAccepted',
          params: {
            name: result.employeeName ?? '',
            date: result.date ?? '',
          },
          path: `/talent/schedules?department=${result.departmentId ?? ''}&from=${result.date ?? ''}`,
        });
      return {
        outcome: 'handled',
        message: t(`attendanceCards.invite.${result.outcome}`),
      };
    },
  });

  return {
    leaveSubmit,
    adjustmentSubmit,
    leaveApproval,
    adjustmentApproval,
    invite,
  };
}

function minutesOf(time: string): number {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return h * 60 + m;
}

/** The sentence of a passage that best matches the reply: the clause to quote. */
function clauseOf(excerpt: string, reply: string): string {
  const sentences = excerpt
    .split(/[。；;\n]/u)
    .map((s) => s.replace(/^[-#\d\s.]+/u, '').trim())
    .filter(Boolean);
  const grams = new Set<string>();
  for (let i = 0; i < reply.length - 1; i++) grams.add(reply.slice(i, i + 2));
  let best = sentences[0] ?? excerpt.slice(0, 60);
  let score = -1;
  for (const sentence of sentences) {
    let hits = 0;
    for (const gram of grams) if (sentence.includes(gram)) hits += 1;
    if (hits > score) {
      score = hits;
      best = sentence;
    }
  }
  return best.slice(0, 120);
}

/** 顶班邀请 cards to the invitees, after the invitation was recorded (schedule-service `invite`). */
export async function sendInvitationCards(
  container: ServiceContainer,
  input: {
    scheduleId: string;
    inviterUserId: string;
    invitees: readonly { employeeId: string; userId: string }[];
  },
): Promise<Record<string, 'sent' | 'duplicate' | 'notBound' | 'failed'>> {
  const channel = container.resolve(imChannelToken);
  const cell = await container
    .resolve(platformToken)
    .database.query()
    .selectFrom('shiftSchedules')
    .select(['checkResult'])
    .where('id', '=', input.scheduleId)
    .executeTakeFirst();
  const leaves = json<{ rule?: string; leaveRequestId?: string }[]>(
    cell?.checkResult,
    [],
  )
    .filter((c) => c.rule === 'leaveConflict')
    .map((c) => c.leaveRequestId ?? '')
    .sort()
    .join(',');
  const results: Record<string, 'sent' | 'duplicate' | 'notBound' | 'failed'> =
    {};
  for (const invitee of input.invitees) {
    const sent = await channel.cards.send({
      kind: INVITE_CARD,
      recipientUserId: invitee.userId,
      refType: 'replacementInvite',
      refId: input.scheduleId,
      dedupeKey: `${INVITE_CARD}:${input.scheduleId}:${leaves}:${invitee.employeeId}`,
      payload: { scheduleId: input.scheduleId },
    });
    results[invitee.employeeId] = sent.status;
  }
  return results;
}

/**
 * Registers the card kinds, the push routes (pending leave and attendance
 * approvals as cards; decisions refresh sent cards) and the bot hooks. Called
 * once at boot, after the channel exists.
 */
export function registerAttendanceCards(
  container: ServiceContainer,
  /** The bot to extend; the application's own by default (a test may pass another). */
  bot?: ImChannel,
): void {
  const platform = container.resolve(platformToken);
  const deps: Deps = {
    database: platform.database,
    timeZone: platform.timeZone,
    organization: platform.organization,
    notify: platform.notify,
    authz: platform.authz,
    channel: () => container.resolve(imChannelToken),
    leave: () => container.resolve(leaveRequestServiceToken),
    adjustments: () => container.resolve(adjustmentServiceToken),
    schedules: () => container.resolve(scheduleServiceToken),
    knowledge: () => container.resolve(knowledgeServiceToken),
    customFields: () => container.resolve(customFieldServiceToken),
  };
  const channel = bot ?? deps.channel();
  const kinds = createKinds(deps);
  const add = <P>(kind: CardKindDefinition<P>) => {
    if (!channel.cards.has(kind.kind)) channel.cards.register(kind);
  };
  add(kinds.leaveSubmit);
  add(kinds.adjustmentSubmit);
  add(kinds.leaveApproval);
  add(kinds.adjustmentApproval);
  add(kinds.invite);

  channel.push.addRoute({
    card(input, userId) {
      const leave =
        input.message === 'leavePending'
          ? /^leave:([^:]+):level:(\d+)$/u.exec(input.key)
          : null;
      if (leave)
        return {
          kind: LEAVE_APPROVAL_CARD,
          refType: 'leaveRequest',
          refId: leave[1],
          dedupeKey: `${LEAVE_APPROVAL_CARD}:${leave[1]}:${leave[2]}:${userId}`,
          payload: { requestId: leave[1], level: Number(leave[2]) },
        };
      const adjustment =
        input.message === 'adjustmentPending' ||
        input.message === 'shiftSwapConsent'
          ? /^adjustment:([^:]+):level:(\d+)$/u.exec(input.key)
          : null;
      if (adjustment)
        return {
          kind: ADJUSTMENT_APPROVAL_CARD,
          refType: 'attendanceAdjustment',
          refId: adjustment[1],
          dedupeKey: `${ADJUSTMENT_APPROVAL_CARD}:${adjustment[1]}:${adjustment[2]}:${userId}`,
          payload: {
            adjustmentId: adjustment[1],
            level: Number(adjustment[2]),
          },
        };
      return undefined;
    },
    // Any news about a request (next level, decided) shows on the cards already sent about it.
    refresh(input) {
      const leave = /^leave(?:Decided)?:([^:]+)/u.exec(input.key);
      if (leave)
        return [
          ['leaveRequest', leave[1]],
          ['leaveDraft', leave[1]],
        ];
      const adjustment = /^adjustment(?:Decided)?:([^:]+)/u.exec(input.key);
      if (adjustment)
        return [
          ['attendanceAdjustment', adjustment[1]],
          ['attendanceDraft', adjustment[1]],
        ];
      const accepted = /^replacementAccepted:([^:]+)/u.exec(input.key);
      if (accepted) return [['replacementInvite', accepted[1]]];
      return [];
    },
  });

  channel.addHook({
    claim: (input) => claimInquiryReply(deps, input),
    afterTurn: (input) => draftCards(deps, input),
  });
}

/** Drafts the HR assistant made for the user during a bot turn, as 本人提交 cards. */
async function draftCards(
  deps: Deps,
  input: {
    userId: string;
    provider: 'feishu' | 'dingtalk' | 'wecom';
    since: Date;
  },
): Promise<{ cards: string[]; reply: string } | undefined> {
  const { database } = deps;
  const own = await database
    .query()
    .selectFrom('employees')
    .select(['id'])
    .where('userId', '=', input.userId)
    .executeTakeFirst();
  if (!own) return undefined;
  const since = input.since.getTime();
  const recent = (value: unknown) => new Date(str(value)).getTime() >= since;
  const [leaves, adjustments] = await Promise.all([
    database
      .query()
      .selectFrom('leaveRequests')
      .select(['id', 'createdAt', 'updatedAt'])
      .where('employeeId', '=', str(own.id))
      .where('status', '=', 'draft')
      .where('source', '=', 'hrAssistant')
      .execute(),
    database
      .query()
      .selectFrom('attendanceAdjustments')
      .select(['id', 'date', 'updatedAt'])
      .where('employeeId', '=', str(own.id))
      .where('status', '=', 'draft')
      .where('source', '=', 'hrAssistant')
      .orderBy('date', 'asc')
      .execute(),
  ]);
  const t = await deps.channel().cards.translate();
  const cards: string[] = [];
  const replies: string[] = [];
  for (const leave of leaves.filter(
    (l) => recent(l.createdAt) || recent(l.updatedAt),
  )) {
    const sent = await deps.channel().cards.send({
      kind: LEAVE_SUBMIT_CARD,
      provider: input.provider,
      recipientUserId: input.userId,
      refType: 'leaveDraft',
      refId: str(leave.id),
      dedupeKey: `${LEAVE_SUBMIT_CARD}:${str(leave.id)}`,
      payload: { requestId: str(leave.id) },
    });
    if (sent.status === 'sent' || sent.status === 'failed') {
      cards.push(sent.cardId);
      if (!replies.includes(t('attendanceCards.bot.leaveCard')))
        replies.push(t('attendanceCards.bot.leaveCard'));
    }
  }
  const drafted = adjustments
    .filter((a) => recent(a.updatedAt))
    .map((a) => str(a.id))
    .slice(0, 10);
  if (drafted.length) {
    const sent = await deps.channel().cards.send({
      kind: ADJUSTMENT_SUBMIT_CARD,
      provider: input.provider,
      recipientUserId: input.userId,
      refType: 'attendanceDraft',
      refId: drafted[0],
      dedupeKey: `${ADJUSTMENT_SUBMIT_CARD}:${drafted.join(',')}:${since}`,
      payload: { adjustmentIds: drafted },
    });
    if (sent.status === 'sent' || sent.status === 'failed') {
      cards.push(sent.cardId);
      replies.push(t('attendanceCards.bot.adjustmentCard'));
    }
  }
  return cards.length ? { cards, reply: replies.join('\n') } : undefined;
}

/**
 * 考勤异常追问的回复: the employee's first message after the bot asked about an
 * anomaly (within a week, not yet answered). The reply is stored on the
 * asked records only; the HR assistant gets the records, the policy clause
 * found for it and what to draft.
 */
async function claimInquiryReply(
  deps: Deps,
  input: {
    userId: string;
    provider: 'feishu' | 'dingtalk' | 'wecom';
    text: string;
  },
): Promise<{ note: string; fallback(): Promise<string> } | undefined> {
  const { database } = deps;
  const own = await database
    .query()
    .selectFrom('employees')
    .select(['id'])
    .where('userId', '=', input.userId)
    .executeTakeFirst();
  if (!own) return undefined;
  const rows = await database
    .query()
    .selectFrom('attendanceRecords')
    .select([
      'id',
      'date',
      'status',
      'shiftId',
      'lateMinutes',
      'earlyMinutes',
      'inquiry',
    ])
    .where('employeeId', '=', str(own.id))
    .where('inquiry', 'is not', null)
    .orderBy('date', 'asc')
    .execute();
  if (A_QUESTION.test(input.text)) return undefined;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const open = rows
    .map((row) => ({ row, inquiry: presentInquiry(row.inquiry) }))
    .filter(
      (item) =>
        item.inquiry &&
        item.inquiry.channel === input.provider &&
        !item.inquiry.repliedAt &&
        Date.parse(item.inquiry.askedAt) >= weekAgo,
    );
  if (!open.length) return undefined;
  // The latest question: consecutive missed punches were asked together.
  const latest = open
    .map((item) => item.inquiry!.askedAt)
    .sort()
    .at(-1)!;
  const group = open.filter((item) => item.inquiry!.askedAt === latest);
  const reply = input.text.trim().slice(0, 500);
  const repliedAt = new Date().toISOString();
  for (const item of group) {
    const stored = json<Record<string, unknown>>(item.row.inquiry, {});
    await database
      .query()
      .updateTable('attendanceRecords')
      .set({ inquiry: { ...stored, reply, repliedAt } })
      .where('id', '=', str(item.row.id))
      .execute();
  }
  const actor = await actorFor(deps, input.userId);
  const anomaly = str(group[0].row.status);
  const records: {
    attendanceRecordId: string;
    date: string;
    status: string;
    shift: string | null;
    lateMinutes: number | null;
    earlyMinutes: number | null;
  }[] = [];
  for (const item of group) {
    const shift = item.row.shiftId
      ? await database
          .query()
          .selectFrom('shifts')
          .select(['title', 'startTime', 'endTime'])
          .where('id', '=', str(item.row.shiftId))
          .executeTakeFirst()
      : undefined;
    records.push({
      attendanceRecordId: str(item.row.id),
      date: day(item.row.date),
      status: str(item.row.status),
      shift: shift
        ? `${str(shift.title)} ${str(shift.startTime).slice(0, 5)}–${str(shift.endTime).slice(0, 5)}`
        : null,
      lateMinutes:
        item.row.lateMinutes == null ? null : Number(item.row.lateMinutes),
      earlyMinutes:
        item.row.earlyMinutes == null ? null : Number(item.row.earlyMinutes),
    });
  }
  // 引用《考勤与加班管理制度》中适用的条款: searched as the employee, from what they may read.
  let policy:
    | {
        documentId: string;
        documentTitle: string;
        citation: string;
        excerpt: string;
        clause: string;
      }
    | undefined;
  if (anomaly === 'late' || anomaly === 'earlyLeave')
    try {
      const word = anomaly === 'late' ? '迟到' : '早退';
      const [top] = await deps
        .knowledge()
        .search(actor, `${reply} ${word} 说明`, 3);
      if (top && top.score > 0)
        policy = {
          documentId: top.documentId,
          documentTitle: top.documentTitle,
          citation: top.citation.slice(0, 500),
          excerpt: top.excerpt.slice(0, 500),
          clause: clauseOf(top.excerpt, reply),
        };
    } catch (error) {
      codeOf(error);
    }
  const note = [
    '【考勤异常追问的回复】系统之前在飞书私聊里问过本人一个考勤异常，下面这条消息是本人的回复。',
    `涉及的考勤记录：${JSON.stringify(records)}`,
    policy
      ? `知识库中适用的条款：《${policy.documentTitle}》${policy.citation}：“${policy.clause}”（调用 draftMyAttendanceAdjustment 时把 policy 设为 ${JSON.stringify({ documentId: policy.documentId, documentTitle: policy.documentTitle, citation: policy.citation })}）`
      : '知识库中没有找到适用的条款，不要自行编造制度。',
    '按回复选择：缺卡且本人确认当天正常出勤的，对每条记录调用一次 draftMyAttendanceAdjustment（type=missingPunch，不填时间则按班次标准时间）；迟到或早退有正当原因的，调用 draftMyAttendanceAdjustment（type=exception，reason 用本人的原因），回复中引用上面的条款；回复表示情况不属实或需要请假的，只建议走相应申请，不起草、不替员工决定。起草后告诉本人卡片上可以提交。',
    '',
    '',
  ].join('\n');

  const fallback = async (): Promise<string> => {
    const t = await deps.channel().cards.translate();
    if (NOT_A_PUNCH.test(reply))
      return t('attendanceCards.inquiry.suggestLeave');
    if (anomaly === 'missingPunch' || anomaly === 'absent') {
      let count = 0;
      for (const record of records)
        try {
          await deps.adjustments().draftFromRecord(actor, {
            attendanceRecordId: record.attendanceRecordId,
            type: 'missingPunch',
            reason: t('attendanceCards.inquiry.missingReason'),
          });
          count += 1;
        } catch (error) {
          codeOf(error);
        }
      return count
        ? t('attendanceCards.inquiry.draftedMissing', { count })
        : t('attendanceCards.inquiry.thanks');
    }
    let drafted = 0;
    for (const record of records)
      try {
        await deps.adjustments().draftFromRecord(actor, {
          attendanceRecordId: record.attendanceRecordId,
          type: 'exception',
          reason: reply.slice(0, 200),
          ...(policy
            ? {
                policy: {
                  documentId: policy.documentId,
                  documentTitle: policy.documentTitle,
                  citation: policy.citation,
                },
              }
            : {}),
        });
        drafted += 1;
      } catch (error) {
        codeOf(error);
      }
    if (!drafted) return t('attendanceCards.inquiry.thanks');
    return policy
      ? t('attendanceCards.inquiry.draftedException', {
          title: policy.documentTitle,
          clause: policy.clause,
        })
      : t('attendanceCards.inquiry.draftedExceptionPlain');
  };
  return { note, fallback };
}

/**
 * The question for one anomaly group (考勤异常追问): which day, which shift,
 * what is missing — about the employee only.
 */
export function inquiryQuestion(
  t: Translate,
  group: {
    status: string;
    dates: readonly string[];
    shiftTitle: string;
    minutes: number | null;
    missingSide?: 'in' | 'out';
  },
): { question: string; detail: string } {
  const dates = group.dates
    .map((d) => t('attendanceCards.inquiry.day', { day: Number(d.slice(8)) }))
    .join('、');
  if (group.status === 'late')
    return {
      question: t('attendanceCards.inquiry.late', {
        dates,
        minutes: group.minutes ?? 0,
      }),
      detail: t('attendanceCards.inquiry.detailLate', {
        dates,
        minutes: group.minutes ?? 0,
      }),
    };
  if (group.status === 'earlyLeave')
    return {
      question: t('attendanceCards.inquiry.earlyLeave', {
        dates,
        minutes: group.minutes ?? 0,
        shift: group.shiftTitle,
      }),
      detail: t('attendanceCards.inquiry.detailEarly', {
        dates,
        minutes: group.minutes ?? 0,
      }),
    };
  const side = group.missingSide === 'in' ? 'missingIn' : 'missingOut';
  return {
    question: t(
      `attendanceCards.inquiry.${side}${group.dates.length > 1 ? '' : 'One'}`,
      { dates, shift: group.shiftTitle },
    ),
    detail: t('attendanceCards.inquiry.detailMissing', { dates }),
  };
}

/**
 * 招聘设置 (V2-07): every rule the step leaves to the administrator, stored as
 * one application-settings row (`personnelSettings` id `recruiting.settings`)
 * and merged section by section over the defaults. Nothing here is code:
 * hr.admin edits it on 设置 / 招聘设置 and a change applies to the next
 * calculation, task run or submission.
 */
import type { DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import { json } from '../platform.js';
import { HrError } from '../shared.js';

export const RECRUITING_SETTINGS_ID = 'recruiting.settings';

/**
 * 新员工回访 topics, written for any employer: commute (and accommodation,
 * where an employer provides it), mentoring (带教与同事支持), the schedule, the
 * workload, whether the work matches what was described (expectations), the
 * working environment, and anything else.
 */
export const CHECK_IN_TOPICS = [
  'commute',
  'mentoring',
  'schedule',
  'workload',
  'expectations',
  'environment',
  'other',
] as const;
export type CheckInTopic = (typeof CHECK_IN_TOPICS)[number];

/**
 * Topics written before 2026-10 (housing 住宿 / shuttle 班车, a factory's
 * questions). Check-ins and routing rules that carry them still read and
 * display; nothing new is written with them. Both are now part of commute.
 */
export const LEGACY_CHECK_IN_TOPICS = ['housing', 'shuttle'] as const;
export type LegacyCheckInTopic = (typeof LEGACY_CHECK_IN_TOPICS)[number];
/** A topic as stored on a check-in: a current one or a legacy one. */
export type StoredCheckInTopic = CheckInTopic | LegacyCheckInTopic;
export const STORED_CHECK_IN_TOPICS = [
  ...CHECK_IN_TOPICS,
  ...LEGACY_CHECK_IN_TOPICS,
] as const;
export const LEGACY_TOPIC_OF: Record<LegacyCheckInTopic, CheckInTopic> = {
  housing: 'commute',
  shuttle: 'commute',
};

/**
 * Who an issue on this topic goes to: its own rule, else (for commute) the
 * rule an older settings row kept for shuttle or housing, else the HR owner.
 */
export function checkInRouteFor(
  routing: Partial<Record<StoredCheckInTopic, string>>,
  topic: StoredCheckInTopic,
): string {
  const own = routing[topic];
  if (own) return own;
  const current =
    topic in LEGACY_TOPIC_OF
      ? LEGACY_TOPIC_OF[topic as LegacyCheckInTopic]
      : (topic as CheckInTopic);
  if (routing[current]) return routing[current];
  const legacy = LEGACY_CHECK_IN_TOPICS.find(
    (l) => LEGACY_TOPIC_OF[l] === current && routing[l],
  );
  return (legacy && routing[legacy]) || 'hrOwner';
}

/** hrOwner: the owner of 新员工回访 (default hr01); departmentHead / scheduler: the new hire's head; user:<id>. */
const routeTarget = z
  .string()
  .regex(/^(hrOwner|departmentHead|scheduler|user:[\w-]{1,64})$/u);

const template = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
  })
  .strict()
  .nullable();

export const TEMPLATE_KEYS = [
  'bookingConfirmation',
  'interviewReminder',
  'invitation',
  'rejection',
  'offer',
  'preboarding',
  'aiInterviewInvitation',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const recruitingSettingsSchema = z
  .object({
    publicPage: z
      .object({
        enabled: z.boolean(),
        /** 同一 IP 每小时最多投递次数; beyond it the page asks for a verification answer. */
        ipLimitPerHour: z.number().int().min(1).max(1000),
        maxResumeMb: z.number().int().min(1).max(20),
      })
      .strict(),
    retention: z
      .object({ months: z.number().int().min(1).max(120) })
      .strict(),
    reminders: z
      .object({
        /** 投递在同一阶段停留超过此天数未处理，提醒招聘负责人. */
        stageStaleDays: z.number().int().min(1).max(60),
        /** Offer 回复截止: days after sending. */
        offerRespondDays: z.number().int().min(1).max(60),
        /** 报到提醒: days before the start date. */
        preboardingDays: z.array(z.number().int().min(1).max(30)).max(5),
        /** Unconfirmed arrival this many days before the start: the recruiter is told. */
        escalateDaysBefore: z.number().int().min(0).max(30),
      })
      .strict(),
    approvals: z
      .object({
        /** Levels added after the department head for a department and its subtree (沿用第二步的按部门追加). */
        requisitionExtra: z
          .array(
            z
              .object({
                departmentId: z.string().min(1).max(64),
                name: z.string().trim().min(1).max(64),
                approverUserId: z.string().min(1).max(64),
              })
              .strict(),
          )
          .max(50),
      })
      .strict(),
    workforce: z
      .object({
        capacity: z
          .array(
            z
              .object({
                departmentId: z.string().min(1).max(64),
                positionId: z.string().min(1).max(64),
                outputPerShift: z.number().positive().max(1_000_000),
                shiftsPerMonth: z.number().positive().max(31),
                hoursPerShift: z.number().positive().max(24),
              })
              .strict(),
          )
          .max(200),
        transferLimits: z
          .array(
            z
              .object({
                departmentId: z.string().min(1).max(64),
                maxHeadcount: z.number().int().min(0).max(10_000),
                /** Who coordinates a loan from this department; its head (walking up) when unset. */
                coordinatorUserId: z.string().min(1).max(64).nullable(),
              })
              .strict(),
          )
          .max(100),
        /**
         * 借调人员需安排住宿: a loan option carries the housing risk. Off for a new
         * install (most employers lend people without accommodation); optional so
         * a settings row saved before it existed still reads.
         */
        transferHousingRisk: z.boolean().optional(),
        recruitingCycleDays: z.number().int().min(0).max(365),
        /** A shortfall the people on duty absorb with at most this much overtime each (hours/month) is noGap. */
        absorbOvertimeHours: z.number().min(0).max(100),
        /** Used until a published onboarding path exists for the position (第九步起取路径). */
        onboardingDays: z.number().int().min(0).max(365),
      })
      .strict(),
    checkIns: z
      .object({
        days: z.array(z.number().int().min(1).max(365)).min(1).max(10),
        noReplyDays: z.number().int().min(1).max(30),
        questions: z.array(z.string().trim().min(1).max(200)).min(1).max(10),
        /** Legacy topics (housing, shuttle) are accepted so an older row still reads. */
        routing: z.partialRecord(z.enum(STORED_CHECK_IN_TOPICS), routeTarget),
      })
      .strict(),
    interviews: z
      .object({
        /** Shifts during which an interviewer can still interview (常日班 office staff): not counted as busy. */
        freeShiftCodes: z.array(z.string().trim().min(1).max(64)).max(50),
      })
      .strict(),
    assistant: z
      .object({
        /** 一线岗位批量招聘: from this headcount the posting draft also has knockout questions. */
        bulkHeadcount: z.number().int().min(1).max(1000),
        poolLimit: z.number().int().min(1).max(50),
      })
      .strict(),
    email: z
      .object({
        /** The notification channel candidate emails go through (an email Provider in config.yml). */
        channel: z.string().trim().min(1).max(100),
        /** Outside production only: every candidate email goes to this test mailbox instead. */
        redirectTo: z.string().trim().email().max(320).nullable(),
      })
      .strict(),
    templates: z.partialRecord(z.enum(TEMPLATE_KEYS), template),
  })
  .strict();

export type RecruitingSettings = z.infer<typeof recruitingSettingsSchema>;

export const RECRUITING_SETTINGS_DEFAULTS: RecruitingSettings = {
  publicPage: { enabled: false, ipLimitPerHour: 10, maxResumeMb: 10 },
  retention: { months: 24 },
  reminders: {
    stageStaleDays: 5,
    offerRespondDays: 7,
    preboardingDays: [3, 1],
    escalateDaysBefore: 1,
  },
  approvals: { requisitionExtra: [] },
  workforce: {
    capacity: [],
    transferLimits: [],
    // transferHousingRisk is left out: unset means off (the demo seed
    // 202610210111 turns it on only while it was never saved).
    recruitingCycleDays: 14,
    absorbOvertimeHours: 8,
    onboardingDays: 14,
  },
  checkIns: {
    days: [3, 7, 30],
    noReplyDays: 3,
    questions: [
      '上下班通勤方便吗？',
      '现在的工作内容和入职前了解的一致吗？',
      '带教人和同事有没有及时帮你上手？',
      '工作量还合适吗？',
      '现在的排班或工作时间还适应吗？',
    ],
    routing: {
      commute: 'hrOwner',
      mentoring: 'departmentHead',
      workload: 'departmentHead',
      expectations: 'departmentHead',
      schedule: 'scheduler',
      environment: 'hrOwner',
      other: 'hrOwner',
    },
  },
  interviews: { freeShiftCodes: ['office-day'] },
  assistant: { bulkHeadcount: 5, poolLimit: 10 },
  email: { channel: 'recruiting-email', redirectTo: null },
  templates: {},
};

export async function readRecruitingSettings(
  database: DatabaseManager,
): Promise<{ value: RecruitingSettings; revision: number }> {
  const row = await database
    .query()
    .selectFrom('personnelSettings')
    .select(['value', 'revision'])
    .where('id', '=', RECRUITING_SETTINGS_ID)
    .executeTakeFirst();
  const stored = json<Record<string, unknown>>(row?.value, {});
  const merged: Record<string, unknown> = { ...RECRUITING_SETTINGS_DEFAULTS };
  for (const key of Object.keys(RECRUITING_SETTINGS_DEFAULTS))
    if (stored[key] !== undefined) {
      const base = (RECRUITING_SETTINGS_DEFAULTS as Record<string, unknown>)[
        key
      ];
      merged[key] =
        base && typeof base === 'object' && !Array.isArray(base)
          ? { ...(base), ...(stored[key] as object) }
          : stored[key];
    }
  const parsed = recruitingSettingsSchema.safeParse(merged);
  return {
    value: parsed.success ? parsed.data : RECRUITING_SETTINGS_DEFAULTS,
    revision: Number(row?.revision ?? 0),
  };
}

/** Replaces the given sections; the revision guards against a concurrent edit. */
export async function writeRecruitingSettings(
  database: DatabaseManager,
  input: unknown,
  userId: string,
): Promise<{ value: RecruitingSettings; revision: number }> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new HrError('INVALID_INPUT', 400);
  const body = input as { revision?: unknown; value?: unknown };
  const current = await readRecruitingSettings(database);
  if (body.revision !== undefined && Number(body.revision) !== current.revision)
    throw new HrError('SETTINGS_REVISION_CONFLICT', 409);
  const patch =
    body.value && typeof body.value === 'object' && !Array.isArray(body.value)
      ? (body.value as Record<string, unknown>)
      : {};
  const next = { ...current.value, ...patch };
  const parsed = recruitingSettingsSchema.safeParse(next);
  if (!parsed.success)
    throw new HrError('INVALID_INPUT', 400, {
      fields: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
  const now = new Date();
  if (current.revision)
    await database
      .query()
      .updateTable('personnelSettings')
      .set({
        value: parsed.data,
        revision: current.revision + 1,
        updatedBy: userId,
        updatedAt: now,
      })
      .where('id', '=', RECRUITING_SETTINGS_ID)
      .execute();
  else
    await database
      .query()
      .insertInto('personnelSettings')
      .values({
        id: RECRUITING_SETTINGS_ID,
        value: parsed.data,
        revision: 1,
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  return readRecruitingSettings(database);
}

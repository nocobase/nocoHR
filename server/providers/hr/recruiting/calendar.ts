/**
 * 面试官的日程 (V2-07): an interviewer is busy during their other scheduled
 * interviews and during a shift they are scheduled for (第五步排班; a night
 * shift runs into the next day), except the shifts 招聘设置 lists as free
 * (default 常日班 office-day: office staff interview during their working day). Used when a recruiter schedules an
 * interview and when a posting opens self-booking slots.
 */
import { str } from '../shared.js';
import { json } from './common.js';
import type { RecruitingContext } from './context.js';

export interface BusyConflict {
  userId: string;
  name: string | null;
  kind: 'interview' | 'shift';
  start: string;
  end: string;
}

const MINUTE = 60_000;

function toMinutes(time: unknown): number {
  const [h, m] = str(time).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** The local wall-clock instant of `date` `minutes` after midnight, in the time zone (fixed offset zones only: +08:00). */
function instant(date: string, minutes: number, offset: string): number {
  const h = String(Math.floor(minutes / 60) % 24).padStart(2, '0');
  const m = String(minutes % 60).padStart(2, '0');
  const dayShift = Math.floor(minutes / 1440);
  const base = new Date(`${date}T${h}:${m}:00${offset}`).getTime();
  return base + dayShift * 1440 * MINUTE;
}

export function createCalendar(ctx: RecruitingContext) {
  const { database, platform } = ctx;
  const offset = platform.timeZone === 'UTC' ? 'Z' : '+08:00';

  return {
    /** Everything that keeps the interviewers busy between start and end. */
    async conflicts(input: {
      interviewerUserIds: readonly string[];
      start: string;
      end: string;
      /** The interview being moved, which never conflicts with itself. */
      ignoreInterviewId?: string | null;
    }): Promise<BusyConflict[]> {
      const start = new Date(input.start).getTime();
      const end = new Date(input.end).getTime();
      if (!(end > start) || !input.interviewerUserIds.length) return [];
      const result: BusyConflict[] = [];
      const others = await database
        .query()
        .selectFrom('interviews')
        .select([
          'id',
          'scheduledAt',
          'durationMinutes',
          'interviewerUserIds',
        ])
        .where('status', '=', 'scheduled')
        .execute();
      for (const other of others) {
        if (input.ignoreInterviewId && str(other.id) === input.ignoreInterviewId)
          continue;
        const s = new Date(str(other.scheduledAt)).getTime();
        const e = s + Number(other.durationMinutes ?? 60) * MINUTE;
        if (!(s < end && e > start)) continue;
        for (const userId of json<string[]>(other.interviewerUserIds, []))
          if (input.interviewerUserIds.includes(userId))
            result.push({
              userId,
              name: await platform.userName(userId),
              kind: 'interview',
              start: new Date(s).toISOString(),
              end: new Date(e).toISOString(),
            });
      }
      const employees = await database
        .query()
        .selectFrom('employees')
        .select(['id', 'userId'])
        .where('userId', 'in', [...input.interviewerUserIds])
        .execute();
      if (employees.length) {
        const from = new Date(start - 1440 * MINUTE).toISOString().slice(0, 10);
        const to = new Date(end).toISOString().slice(0, 10);
        const cells = await database
          .query()
          .selectFrom('shiftSchedules')
          .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
          .select([
            'shiftSchedules.employeeId as employeeId',
            'shiftSchedules.date as date',
            'shifts.startTime as startTime',
            'shifts.endTime as endTime',
            'shifts.code as code',
          ])
          .where(
            'shiftSchedules.employeeId',
            'in',
            employees.map((e) => str(e.id)),
          )
          .where('shiftSchedules.date', '>=', from)
          .where('shiftSchedules.date', '<=', to)
          .execute();
        const free = new Set((await ctx.settings()).interviews.freeShiftCodes);
        for (const cell of cells) {
          if (free.has(str(cell.code))) continue;
          const date = str(cell.date).slice(0, 10);
          const startMin = toMinutes(cell.startTime);
          let endMin = toMinutes(cell.endTime);
          if (endMin <= startMin) endMin += 1440;
          const s = instant(date, startMin, offset);
          const e = instant(date, endMin, offset);
          if (!(s < end && e > start)) continue;
          const userId = str(
            employees.find((emp) => str(emp.id) === str(cell.employeeId))
              ?.userId,
          );
          result.push({
            userId,
            name: await platform.userName(userId),
            kind: 'shift',
            start: new Date(s).toISOString(),
            end: new Date(e).toISOString(),
          });
        }
      }
      return result;
    },
  };
}

export type Calendar = ReturnType<typeof createCalendar>;

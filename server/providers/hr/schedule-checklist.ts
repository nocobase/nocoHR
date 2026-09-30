/**
 * V2-05 变动影响清单 · 排班 (provider `schedule`): what a change does to the
 * published schedule. The rules that act on it are the job-event handlers
 * `attendance.transferRevalidate` and `attendance.offboard`; this provider
 * only shows their scope beforehand and their result afterwards.
 *
 * - Transfer / promotion to another department: before it takes effect, the
 *   published cells from the effective date on (they will be revalidated
 *   and the schedulers told); afterwards, how many cells the revalidation
 *   blocked (班次不适用于所在部门). Status `auto` either way.
 * - Offboarding: the cells after the leaving date (cleared on effect) and,
 *   when a balance exists, the unused annual leave for the settlement.
 */
import type {
  ChecklistProvider,
  ProviderContext,
  ProviderItem,
} from './change-checklists.js';
import { json } from './attendance-service.js';
import { str } from './shared.js';

const day = (value: unknown) =>
  value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);

export function scheduleChecklistProvider(): ChecklistProvider {
  return {
    key: 'schedule',
    kinds: ['change', 'offboard'],
    async items(ctx: ProviderContext): Promise<ProviderItem[]> {
      const employeeId =
        ctx.employee?.id ?? ctx.action?.employeeId ?? ctx.event?.employeeId;
      const effectiveDate = (
        ctx.action?.effectiveDate ??
        ctx.event?.effectiveDate ??
        ''
      ).slice(0, 10);
      if (!employeeId || !effectiveDate) return [];
      const q = ctx.database.query();
      const cells = (
        await q
          .selectFrom('shiftSchedules')
          .select(['date', 'checkResult'])
          .where('employeeId', '=', employeeId)
          .where('status', '=', 'published')
          .where('shiftId', 'is not', null)
          .where('date', '>=', effectiveDate)
          .execute()
      ).map((row) => ({
        date: day(row.date),
        blocked: json<{ rule?: string }[]>(row.checkResult, []).some(
          (check) => check.rule === 'departmentScope',
        ),
      }));
      const span = (list: typeof cells) => {
        const dates = list.map((c) => c.date).sort();
        return { from: dates[0] ?? '', to: dates.at(-1) ?? '' };
      };

      if (ctx.kind === 'change') {
        const from =
          ctx.action?.fromDepartmentId ?? ctx.event?.fromDepartmentId ?? null;
        const to =
          ctx.action?.toDepartmentId ?? ctx.event?.toDepartmentId ?? null;
        if (!to || from === to) return [];
        if (!ctx.effective) {
          if (!cells.length) return [];
          return [
            {
              key: 'schedule',
              code: 'scheduleRevalidatePending',
              params: { count: String(cells.length), ...span(cells) },
              status: 'auto',
              link: `/talent/schedules?department=${from ?? ''}&from=${span(cells).from}`,
            },
          ];
        }
        const blocked = cells.filter((c) => c.blocked);
        return [
          blocked.length
            ? {
                key: 'schedule',
                code: 'scheduleRevalidated',
                params: { count: String(blocked.length), ...span(blocked) },
                status: 'auto',
                link: `/talent/schedules?department=${from ?? ''}&from=${span(blocked).from}`,
              }
            : {
                key: 'schedule',
                code: 'scheduleStillValid',
                params: {},
                status: 'auto',
                link: null,
              },
        ];
      }

      // Offboarding: the cells after the leaving day go when it takes effect.
      const items: ProviderItem[] = [];
      const after = cells.filter((c) => c.date > effectiveDate);
      if (!ctx.effective && after.length)
        items.push({
          key: 'schedule',
          code: 'scheduleClearPending',
          params: { count: String(after.length), ...span(after) },
          status: 'auto',
          link: null,
        });
      const balance = await q
        .selectFrom('leaveBalances')
        .select(['entitled', 'carriedOver', 'used', 'pending', 'adjustments'])
        .where('employeeId', '=', employeeId)
        .where('leaveTypeId', '=', 'leave-annual')
        .where('year', '=', Number(effectiveDate.slice(0, 4)))
        .executeTakeFirst();
      if (balance) {
        const adjusted = json<{ days?: number }[]>(
          balance.adjustments,
          [],
        ).reduce((sum, a) => sum + Number(a.days ?? 0), 0);
        const remaining =
          Number(balance.entitled ?? 0) +
          Number(balance.carriedOver ?? 0) +
          adjusted -
          Number(balance.used ?? 0) -
          Number(balance.pending ?? 0);
        if (remaining > 0)
          items.push({
            key: 'annualLeave',
            code: 'annualLeaveRemaining',
            params: { days: String(Math.round(remaining * 10) / 10) },
            status: 'todo',
            link: `/talent/employees/${employeeId}`,
          });
      }
      return items;
    },
  };
}

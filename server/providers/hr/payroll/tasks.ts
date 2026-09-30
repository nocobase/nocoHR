/**
 * V2-06 定时任务 (scheduler target `app.hr-payroll`):
 *
 * - `monthly` (每月 5 日 09:00): last month's 增减员 list reminder to hr.payroll,
 *   once per month.
 * - `yearly` (每月 1 日 09:00, acting only in the adjustment month of 薪酬设置,
 *   July by default): the yearly base adjustment suggestions, once per year,
 *   and a reminder to confirm them.
 *
 * Both are rules, not AI work; the manual entry (`POST
 * /talent/payroll/tasks/:task/run`) does exactly what the schedule does.
 */
import { addMonths } from './common.js';
import type { PayrollContext } from './context.js';
import type { InsuranceService } from './insurance.js';

export type PayrollTask = 'monthly' | 'yearly';

export function createPayrollTasks(
  ctx: PayrollContext,
  insurance: InsuranceService,
) {
  const { platform } = ctx;

  return async function run(
    task: PayrollTask,
    options: { trigger: 'schedule' | 'manual'; asOf?: string } = {
      trigger: 'schedule',
    },
  ): Promise<Record<string, unknown>> {
    const today = options.asOf ?? platform.currentDate();
    if (task === 'monthly') {
      const month = addMonths(today.slice(0, 7), -1);
      const rows = (await insurance.enrolments()).filter(
        (e) =>
          (e.status === 'active' && e.startMonth === month) ||
          (e.status === 'stopped' &&
            e.endMonth === month &&
            !e.pendingAction) ||
          e.status === 'pending',
      );
      const started = rows.filter((e) => e.status === 'active').length;
      const stopped = rows.filter((e) => e.status === 'stopped').length;
      const pending = rows.filter((e) => e.status === 'pending').length;
      await platform.notify({
        key: `payrollInsuranceMonthly:${month}`,
        userIds: await ctx.payrollUsers(),
        message: 'payrollInsuranceMonthly',
        params: {
          month,
          started: String(started),
          stopped: String(stopped),
          pending: String(pending),
        },
        path: `/talent/social-insurance?tab=changes&month=${month}`,
      });
      return { month, started, stopped, pending };
    }
    const settings = await ctx.settings();
    const month = Number(today.slice(5, 7));
    if (
      options.trigger === 'schedule' &&
      month !== settings.socialInsurance.baseAdjustMonth
    )
      return { skipped: 'notAdjustmentMonth' };
    const year = Number(today.slice(0, 4));
    let generated = false;
    const result = await platform.reminderOnce(
      `payrollBaseAdjust:${year}`,
      async () => {
        const value = await insurance.generateBaseSuggestions(null, year);
        generated = true;
        await platform.notify({
          key: `payrollBaseAdjust:${year}`,
          userIds: await ctx.payrollUsers(),
          message: 'payrollBaseAdjust',
          params: { year: String(year), count: String(value.items.length) },
          path: '/talent/social-insurance?tab=base',
        });
      },
    );
    if (!result && options.trigger === 'manual') {
      // A manual run regenerates the list (the notification was already sent this year).
      const value = await insurance.generateBaseSuggestions(null, year);
      return { year, suggestions: value.items.length, regenerated: true };
    }
    return { year, generated };
  };
}

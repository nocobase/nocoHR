/**
 * V2-06 与岗位变动事件衔接 (only from jobEvents, 总纲 rule 2). Each rule is
 * idempotent per event: notifications carry the event id in their key and
 * enrolment suggestions carry it in `sourceEventId`, so a replay adds
 * nothing.
 *
 * - onboard: the employee joins 待建档 (when they have no salary file) and
 *   hr.payroll is told; a pending 增员 is suggested in the insured city.
 * - offboard: the last month is prorated by the leaving date on its own; a
 *   pending 减员 is suggested and hr.payroll is told.
 * - transfer / promote: hr.payroll is told to check the file and structure,
 *   with a 发起调薪 link pre-filling the personnel action.
 *
 * The change-checklist provider `salary` lists "适用薪资结构可能变化" for a
 * transfer or promotion and "最后一个月按在职天数结算、停保" for an
 * offboarding — never an amount. The first becomes handled on its own once
 * an adjustment related to the action is approved; the second once the
 * employee's 减员 is confirmed.
 */
import type { ChecklistProvider } from '../change-checklists.js';
import type { JobEvent } from '../job-events.js';
import { str } from '../shared.js';
import type { PayrollContext } from './context.js';
import type { InsuranceService } from './insurance.js';

export function createPayrollEventHandler(
  ctx: PayrollContext,
  insurance: InsuranceService,
) {
  const { platform } = ctx;
  const { database } = platform;

  async function nameOf(employeeId: string): Promise<string> {
    const row = await database
      .query()
      .selectFrom('employees')
      .select(['name'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    return row ? str(row.name) : '';
  }

  async function hasFile(employeeId: string): Promise<boolean> {
    const row = await database
      .query()
      .selectFrom('employeeSalaries')
      .select(['id'])
      .where('employeeId', '=', employeeId)
      .executeTakeFirst();
    return Boolean(row);
  }

  return async function handle(event: JobEvent): Promise<void> {
    // An Excel import loads people already at work (初始化): no 增减员 suggestion and no 待建档 to-do per row; they
    // appear in 待建档 until their files are imported.
    if (event.source === 'import') return;
    const date = event.effectiveDate.slice(0, 10);
    if (event.eventType === 'onboard') {
      await insurance.suggestStart(event);
      if (await hasFile(event.employeeId)) return;
      await platform.notify({
        key: `payrollOnboard:${event.id}:${event.employeeId}`,
        userIds: await ctx.payrollUsers(),
        message: 'payrollOnboard',
        params: { name: await nameOf(event.employeeId), date },
        path: `/talent/salaries?tab=pending&employee=${event.employeeId}`,
      });
      return;
    }
    if (event.eventType === 'offboard') {
      await insurance.suggestStop(event);
      await platform.notify({
        key: `payrollOffboard:${event.id}:${event.employeeId}`,
        userIds: await ctx.payrollUsers(),
        message: 'payrollOffboard',
        params: { name: await nameOf(event.employeeId), date },
        path: `/talent/social-insurance?tab=changes`,
      });
      return;
    }
    if (event.eventType === 'transfer' || event.eventType === 'promote') {
      if (!(await hasFile(event.employeeId))) return;
      await platform.notify({
        key: `payrollTransfer:${event.id}:${event.employeeId}`,
        userIds: await ctx.payrollUsers(),
        message: 'payrollTransfer',
        params: {
          name: await nameOf(event.employeeId),
          date,
          type: event.eventType,
        },
        path: event.actionId
          ? `/talent/salaries/adjustments/new?actionId=${event.actionId}`
          : `/talent/salaries/${event.employeeId}`,
      });
    }
  };
}

/** The change-checklist provider `salary` (变动影响清单). */
export function salaryChecklistProvider(): ChecklistProvider {
  return {
    key: 'salary',
    kinds: ['change', 'offboard'],
    async items(context) {
      const employeeId =
        context.employee?.id ?? context.action?.employeeId ?? null;
      if (!employeeId) return [];
      const file = await context.database
        .query()
        .selectFrom('employeeSalaries')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .executeTakeFirst();
      if (!file) return [];
      if (context.kind === 'change') {
        const actionId = context.action?.id ?? null;
        const handled = actionId
          ? await context.database
              .query()
              .selectFrom('salaryAdjustments')
              .select(['id'])
              .where('relatedActionId', '=', actionId)
              .where('status', '=', 'approved')
              .executeTakeFirst()
          : undefined;
        return [
          {
            key: 'salary.structure',
            code: 'salaryStructureCheck',
            params: {},
            status: handled ? 'auto' : 'todo',
            link: actionId
              ? `/talent/salaries/adjustments/new?actionId=${actionId}`
              : `/talent/salaries/${employeeId}`,
          },
        ];
      }
      const stopped = await context.database
        .query()
        .selectFrom('employeeSocialInsurances')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('pendingAction', '=', 'stop')
        .where('status', '=', 'stopped')
        .executeTakeFirst();
      return [
        {
          key: 'salary.final',
          code: 'salaryFinalSettlement',
          params: {},
          status: stopped ? 'auto' : 'todo',
          link: '/talent/social-insurance?tab=changes',
        },
      ];
    },
  };
}

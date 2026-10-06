/**
 * V2-06 我的工资条. An employee reads only their own published payslips and
 * enrolment, through `talent.myPayslip` (self scope), and only after
 * verifying their identity again: the payslip page asks for the password
 * (the authentication plugin offers no second factor here), and the
 * verification holds for 30 minutes for that user — the payslip page and the
 * HR assistant's `getMyPayslip` both check it. The first view stamps
 * `viewedAt`.
 *
 * The verification is kept in memory (a restart asks again), so it never
 * outlives the process or reaches another instance.
 */
import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, str } from '../shared.js';
import type { PayslipLine } from './calc.js';
import { iso, json, MONTH, num } from './common.js';
import { sourceLabels, withSourceLabels } from './source-labels.js';
import type { PayrollContext } from './context.js';

const RESOURCE = 'talent.myPayslip';
export const VERIFICATION_MINUTES = 30;
const MAX_ATTEMPTS = 5;

export function createMyPayslipService(ctx: PayrollContext) {
  const { platform } = ctx;
  const { database } = platform;
  const verified = new Map<string, number>();
  const failures = new Map<string, { count: number; until: number }>();

  function verifiedUntil(userId: string): number | null {
    const until = verified.get(userId);
    if (!until) return null;
    if (until < Date.now()) {
      verified.delete(userId);
      return null;
    }
    return until;
  }

  async function self(actor: ActorContext) {
    const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
    const rows = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findMany({ limit: 2 });
    if (rows.length !== 1) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    return { policies, employee: rows[0] as Record<string, unknown> };
  }

  function requireVerified(actor: ActorContext) {
    if (!verifiedUntil(actor.userId))
      throw new HrError('PAYSLIP_VERIFY_REQUIRED', 403);
  }

  /** Published months of the caller's own payslips. */
  async function publishedSlips(actor: ActorContext) {
    const { policies, employee } = await self(actor);
    const slips = (await database
      .repository('payslips')
      .withPolicy(policyOf(policies, 'payslips'))
      .findMany({})) as Record<string, unknown>[];
    const cycles = await database
      .query()
      .selectFrom('payrollCycles')
      .select(['id', 'month', 'status', 'publishedAt'])
      .where('status', 'in', ['published', 'closed'])
      .execute();
    const byId = new Map(cycles.map((c) => [str(c.id), c]));
    return {
      policies,
      employee,
      slips: slips
        .filter((s) => byId.has(str(s.cycleId)) && s.lines)
        .map((s) => ({ row: s, month: str(byId.get(str(s.cycleId))!.month) }))
        .sort((a, b) => b.month.localeCompare(a.month)),
    };
  }

  function present(
    row: Record<string, unknown>,
    month: string,
    label: (name: string) => string | undefined,
  ) {
    const lines = withSourceLabels(json<PayslipLine[]>(row.lines, []), label);
    return {
      id: str(row.id),
      month,
      lines: lines.map((line) => ({
        code: line.code,
        title: line.title,
        kind: line.kind,
        calc: line.calc,
        amount: line.amount,
        value: line.value,
        unit: line.unit,
        formula: line.formula,
        expression: line.expression,
        sources: line.sources,
      })),
      gross: num(row.gross),
      socialEmployee: num(row.socialEmployee),
      housingFundEmployee: num(row.housingFundEmployee),
      tax: num(row.tax),
      net: num(row.net),
      taxableIncomeYtd: num(row.taxableIncomeYtd),
      taxWithheldYtd: num(row.taxWithheldYtd),
      viewedAt: iso(row.viewedAt),
    };
  }

  const service = {
    status(actor: ActorContext) {
      const until = verifiedUntil(actor.userId);
      return {
        verified: Boolean(until),
        until: until ? new Date(until).toISOString() : null,
      };
    },

    async verify(actor: ActorContext, password: unknown) {
      await authorizeAction(actor.authz, RESOURCE, 'view');
      const lock = failures.get(actor.userId);
      if (lock && lock.count >= MAX_ATTEMPTS && lock.until > Date.now())
        throw new HrError('PAYSLIP_VERIFY_LOCKED', 409);
      if (typeof password !== 'string' || !password || password.length > 200)
        throw new HrError('PAYSLIP_VERIFY_FAILED', 400);
      const ok = await ctx
        .verifyPassword(actor.userId, password)
        .catch(() => false);
      if (!ok) {
        const current = failures.get(actor.userId);
        failures.set(actor.userId, {
          count:
            (current && current.until > Date.now() ? current.count : 0) + 1,
          until: Date.now() + 15 * 60_000,
        });
        throw new HrError('PAYSLIP_VERIFY_FAILED', 400);
      }
      failures.delete(actor.userId);
      verified.set(actor.userId, Date.now() + VERIFICATION_MINUTES * 60_000);
      return service.status(actor);
    },

    /** The months with a published payslip; amounts only after verification. */
    async list(actor: ActorContext) {
      const { slips } = await publishedSlips(actor);
      const ok = Boolean(verifiedUntil(actor.userId));
      return {
        verified: ok,
        months: slips.map((s) => ({
          month: s.month,
          net: ok ? num(s.row.net) : null,
          viewedAt: iso(s.row.viewedAt),
        })),
      };
    },

    async get(actor: ActorContext, month: string) {
      if (!MONTH.test(month)) throw new HrError('PAYROLL_MONTH_INVALID', 400);
      requireVerified(actor);
      const { policies, slips } = await publishedSlips(actor);
      const found = slips.find((s) => s.month === month);
      if (!found) throw new HrError('PAYSLIP_NOT_FOUND', 404);
      if (!found.row.viewedAt)
        await database
          .repository('payslips')
          .withPolicy(policyOf(policies, 'payslips'))
          .updateOne({
            filter: { id: str(found.row.id) },
            values: { viewedAt: new Date(), updatedAt: new Date() },
          });
      return present(found.row, month, await sourceLabels(database));
    },

    /** 参保情况: city, bases, and each personal contribution of the latest published payslip. */
    async socialInsurance(actor: ActorContext) {
      requireVerified(actor);
      const { policies, employee } = await self(actor);
      const enrolments = (await database
        .repository('employeeSocialInsurances')
        .withPolicy(policyOf(policies, 'employeeSocialInsurances'))
        .findMany({})) as Record<string, unknown>[];
      const active = enrolments
        .filter((e) => str(e.status) === 'active')
        .sort((a, b) => str(b.startMonth).localeCompare(str(a.startMonth)))[0];
      // Contributions come from the latest published payslip's snapshot (the employee's own).
      const latest = (await publishedSlips(actor)).slips[0];
      const snapshot = latest
        ? await database
            .query()
            .selectFrom('payslips')
            .select(['inputs'])
            .where('id', '=', str(latest.row.id))
            .where('employeeId', '=', str(employee.id))
            .executeTakeFirst()
        : undefined;
      const lines =
        json<{
          insurance?: {
            lines?: {
              code: string;
              base: number;
              employeeRate: number;
              employee: number;
            }[];
          } | null;
        }>(snapshot?.inputs, {}).insurance?.lines ?? [];
      return {
        enrolment: active
          ? {
              planCity: str(active.planCity),
              socialBase: num(active.socialBase),
              housingFundBase: num(active.housingFundBase),
              startMonth: str(active.startMonth),
              endMonth: active.endMonth ? str(active.endMonth) : null,
            }
          : null,
        month: latest?.month ?? null,
        contributions: lines.map((l) => ({
          code: l.code,
          base: l.base,
          employeeRate: l.employeeRate,
          employee: l.employee,
        })),
      };
    },

    verifiedUntil,
  };
  return service;
}

export type MyPayslipService = ReturnType<typeof createMyPayslipService>;

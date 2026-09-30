/**
 * V4-12 与薪酬的衔接.
 *
 * - `perf.coefficient` (payroll/calc.ts): for a payroll cycle whose
 *   `bonusCycleId` is set, the employee's final rating in that review cycle
 *   converted through their scheme's `ratingCoefficients`; 0 when the payroll
 *   cycle has no review cycle, the employee has no published result there,
 *   the result is closed, or the scheme has no coefficients (the last two are
 *   reported to the anomaly check). Payroll calls `coefficientsFor` after
 *   authorizing its own calculation; the rating and coefficient go into the
 *   payslip's `inputs` snapshot.
 * - hr.payroll reads published results through talent.reviewResultRating
 *   (cycleId, employeeId, schemeId, finalRating, status, publishedAt);
 *   hr.payrollApprover reads the one a salary adjustment links to, as
 *   "周期名称 · 最终等级".
 */
import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, str } from '../shared.js';
import { RATING_FIELDS } from './resources.js';
import { toCycle, toResult, type PerformanceContext } from './context.js';

const RATING = 'talent.reviewResultRating';

export interface PerformanceCoefficient {
  status: 'found' | 'noResult' | 'closed' | 'noCoefficients';
  rating: string | null;
  coefficient: number;
  schemeId: string | null;
  schemeTitle: string | null;
}

export function createPayrollLink(ctx: PerformanceContext) {
  const { database } = ctx;

  const link = {
    /** A review cycle payroll may pay a bonus for: published or closed. */
    async bonusCycle(
      id: string,
    ): Promise<{ id: string; title: string; status: string }> {
      const cycle = await ctx.cycle(id).catch(() => null);
      if (!cycle || !['published', 'closed'].includes(cycle.status))
        throw new HrError('PAYROLL_BONUS_CYCLE_INVALID', 400);
      return { id: cycle.id, title: cycle.title, status: cycle.status };
    },

    /** perf.coefficient for each employee (trusted: payroll has authorized its calculation). */
    async coefficientsFor(
      bonusCycleId: string,
      employeeIds: readonly string[],
    ): Promise<{
      cycleTitle: string;
      byEmployee: Map<string, PerformanceCoefficient>;
    }> {
      const cycle = await ctx.cycle(bonusCycleId);
      const schemes = new Map((await ctx.schemes()).map((s) => [s.id, s]));
      const results = new Map(
        (await ctx.resultsOf(bonusCycleId)).map((r) => [r.employeeId, r]),
      );
      const byEmployee = new Map<string, PerformanceCoefficient>();
      for (const employeeId of employeeIds) {
        const result = results.get(employeeId);
        const scheme = result ? schemes.get(result.schemeId) : undefined;
        const base = {
          rating: null,
          coefficient: 0,
          schemeId: scheme?.id ?? null,
          schemeTitle: scheme?.title ?? null,
        };
        if (!result || !result.publishedAt || !result.finalRating) {
          byEmployee.set(employeeId, {
            ...base,
            status: result?.status === 'closed' ? 'closed' : 'noResult',
          });
          continue;
        }
        if (result.status === 'closed') {
          byEmployee.set(employeeId, { ...base, status: 'closed' });
          continue;
        }
        const coefficients = scheme?.ratingCoefficients ?? null;
        if (!coefficients) {
          byEmployee.set(employeeId, {
            ...base,
            rating: result.finalRating,
            status: 'noCoefficients',
          });
          continue;
        }
        byEmployee.set(employeeId, {
          ...base,
          rating: result.finalRating,
          coefficient: Number(coefficients[result.finalRating] ?? 0) || 0,
          status: 'found',
        });
      }
      return { cycleTitle: cycle.title, byEmployee };
    },

    /** A published result of this employee, for an adjustment's `relatedReviewResultId`. */
    async resultForAdjustment(resultId: string, employeeId: string) {
      const result = await ctx.result(resultId).catch(() => null);
      if (
        !result ||
        result.employeeId !== employeeId ||
        !result.publishedAt ||
        result.status === 'closed'
      )
        throw new HrError('ADJUSTMENT_REVIEW_RESULT_INVALID', 400);
      const cycle = await ctx.cycle(result.cycleId);
      return {
        id: result.id,
        cycleTitle: cycle.title,
        finalRating: result.finalRating,
      };
    },

    /** "周期名称 · 最终等级" of linked results (trusted: payroll has authorized the adjustment read). */
    async labelsFor(resultIds: readonly string[]) {
      const map = new Map<
        string,
        { cycleTitle: string; finalRating: string | null }
      >();
      for (const id of new Set(resultIds)) {
        const result = await ctx.result(id).catch(() => null);
        if (!result?.publishedAt) continue;
        const cycle = await ctx.cycle(result.cycleId);
        map.set(id, {
          cycleTitle: cycle.title,
          finalRating: result.finalRating,
        });
      }
      return map;
    },

    /** talent.reviewResultRating.view: the published results payroll may read, field-limited. */
    async ratings(
      actor: ActorContext,
      query: { cycleId?: string; employeeId?: string },
    ) {
      const policies = await authorizeAction(actor.authz, RATING, 'view');
      const filter: Record<string, string> = {};
      if (query.cycleId) filter.cycleId = query.cycleId;
      if (query.employeeId) filter.employeeId = query.employeeId;
      // An empty filter object is refused by the repository: no filter at all instead.
      const rows = (await database
        .repository('reviewResults')
        .withPolicy(policyOf(policies, 'reviewResults'))
        .findMany(Object.keys(filter).length ? { filter } : {})) as Record<
        string,
        unknown
      >[];
      const cycles = new Map(
        (
          (await database
            .repository('reviewCycles')
            .withPolicy(policyOf(policies, 'reviewCycles'))
            .findMany({})) as Record<string, unknown>[]
        ).map((row) => [str(row.id), str(row.title)]),
      );
      return rows
        .filter((row) => row.publishedAt)
        .map((row) => ({
          ...Object.fromEntries(RATING_FIELDS.map((f) => [f, row[f] ?? null])),
          cycleTitle: cycles.get(str(row.cycleId)) ?? '',
        }));
    },

    /** Review cycles payroll may choose as a bonus cycle (published or closed), titles only. */
    async bonusCycles(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RATING, 'view');
      return (
        (await database
          .repository('reviewCycles')
          .withPolicy(policyOf(policies, 'reviewCycles'))
          .findMany({})) as Record<string, unknown>[]
      )
        .map(toCycle)
        .filter((c) => c.status === 'published' || c.status === 'closed')
        .map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          periodEnd: c.periodEnd,
        }));
    },

    toResult,
  };
  return link;
}

export type PayrollLink = ReturnType<typeof createPayrollLink>;

/**
 * V2-06 算薪异常检查 (`listPayrollAnomalies`): the rules, computed on the
 * server from the cycle's payslips and their snapshots. Each issue has a
 * stable key (so a recalculation can tell added from removed issues), a type
 * and facts — counts, days, percentages, codes and dates, never an amount —
 * which is also everything the HR assistant is given to word its notes.
 *
 * | Type | Rule |
 * |---|---|
 * | netChange | net pay changed by more than the threshold (20 %) against last month |
 * | belowMinimumWage | net pay below the city's configured minimum wage |
 * | manualLarge | a manual item above the configured amount |
 * | importMissing | an applicable imported item without a value this month |
 * | importSpike | an imported value above factor × the last three months' average |
 * | prorationMismatch | the payable days used differ from the record's joining / leaving dates |
 * | baseOutOfRange | the enrolment's base outside the plan's range |
 * | overtimeNoPay | overtime hours with no item reading overtime |
 * | paramMismatch | one parameter code with different values across the structures in use |
 * | perfResultMissing | V4-12: the cycle pays a performance bonus but the employee has no published result in that review cycle |
 * | perfCoefficientsMissing | V4-12: the employee's review scheme has no bonus coefficients |
 */
import type { PayslipLine } from './calc.js';
import {
  addMonths,
  chainOf,
  json,
  loadEmployees,
  num,
  payableDaysFor,
  readCalendar,
  type PayrollEmployee,
} from './common.js';
import type { PayrollContext } from './context.js';
import type { CycleService, PayslipIssue } from './cycles.js';
import { toPlan } from './insurance.js';
import { str } from '../shared.js';

interface Snapshot {
  employee?: {
    hireDate?: string | null;
    leaveDate?: string | null;
    departmentId?: string;
  };
  structure?: {
    id: string;
    title: string;
    payDaysPerMonth: number;
    params: { code: string; title: string; value: number }[];
    items: {
      code: string;
      title: string;
      calc: string;
      formula: string | null;
      departmentIds: string[];
    }[];
  };
  payableDays?: { payableDays: number; partial: boolean };
  attendance?: {
    leaveByType?: Record<string, number>;
    overtimeByType?: Record<string, number>;
    absentDays?: number;
    nightShiftCount?: number;
  };
  insurance?: {
    planId: string | null;
    planCity: string;
    socialBase: number;
    housingFundBase: number;
  } | null;
  importedValues?: Record<string, number>;
}

export interface AnomalyReport {
  cycleId: string;
  month: string;
  calculationId: string | null;
  issues: {
    payslipId: string;
    employeeId: string;
    name: string;
    issue: PayslipIssue;
  }[];
}

export function createAnomalyCheck(ctx: PayrollContext, cycles: CycleService) {
  const { database } = ctx.platform;

  return async function listAnomalies(cycleId: string): Promise<AnomalyReport> {
    const cycle = await cycles.cycleRow(cycleId);
    const settings = await ctx.settings();
    const slips = (await cycles.payslipsOf(cycle.id)).filter(
      (s) => s.lines && s.inputs,
    );
    const employees = new Map(
      (await loadEmployees(database.query())).map((e) => [e.id, e] as const),
    );
    const tree = await ctx.tree();
    const calendar = await readCalendar(database.query());
    const titleOf = new Map(tree.map((d) => [d.id, d.title]));
    const out: AnomalyReport['issues'] = [];
    const push = (
      slip: { id: string; employeeId: string },
      type: string,
      suffix: string,
      facts: PayslipIssue['facts'],
      severity: PayslipIssue['severity'] = 'warn',
    ) =>
      out.push({
        payslipId: slip.id,
        employeeId: slip.employeeId,
        name: employees.get(slip.employeeId)?.name ?? '',
        issue: {
          key: `${type}:${slip.employeeId}${suffix ? `:${suffix}` : ''}`,
          type,
          severity,
          facts,
          note: null,
          noteSource: null,
        },
      });

    // Earlier months for the comparisons: last month's net, the last three months' imports.
    const earlier = await database
      .query()
      .selectFrom('payslips')
      .innerJoin('payrollCycles', 'payrollCycles.id', 'payslips.cycleId')
      .select([
        'payslips.employeeId as employeeId',
        'payslips.net as net',
        'payslips.importedValues as importedValues',
        'payrollCycles.month as month',
        'payrollCycles.status as status',
      ])
      .where('payrollCycles.month', '<', cycle.month)
      .where('payrollCycles.month', '>=', addMonths(cycle.month, -3))
      .execute();
    const previousMonth = addMonths(cycle.month, -1);
    const lastNet = new Map<string, number>();
    const history = new Map<string, Record<string, number>[]>();
    for (const row of earlier) {
      if (!['approved', 'published', 'closed'].includes(str(row.status)))
        continue;
      if (str(row.month) === previousMonth && row.net !== null)
        lastNet.set(str(row.employeeId), num(row.net));
      const list = history.get(str(row.employeeId)) ?? [];
      list.push(json(row.importedValues, {}));
      history.set(str(row.employeeId), list);
    }
    const plans = (
      await database
        .query()
        .selectFrom('socialInsurancePlans')
        .selectAll()
        .execute()
    ).map((row) => toPlan(row as Record<string, unknown>));
    const inFile = new Map<string, Set<string>>();
    for (const record of cycle.imports)
      for (const code of record.itemCodes) {
        const set = inFile.get(code) ?? new Set<string>();
        for (const no of record.employeeNos ?? []) set.add(no);
        inFile.set(code, set);
      }

    // paramMismatch: the value most employees are paid with is the reference.
    const paramUse = new Map<
      string,
      Map<number, { structures: Map<string, string>; employees: string[] }>
    >();
    const paramTitles = new Map<string, string>();

    for (const slip of slips) {
      const employee: PayrollEmployee | undefined = employees.get(
        slip.employeeId,
      );
      const inputs = slip.inputs as Snapshot;
      const lines = slip.lines as PayslipLine[];
      const chain = chainOf(
        slip.departmentId ?? employee?.departmentId ?? '',
        tree,
      );
      const leave = inputs.attendance?.leaveByType ?? {};

      // Net pay change against last month.
      const before = lastNet.get(slip.employeeId);
      if (before && before > 0 && slip.net !== null) {
        const percent = Math.round(((slip.net - before) / before) * 1000) / 10;
        if (Math.abs(percent) > settings.thresholds.netChangePercent)
          push(slip, 'netChange', '', {
            percent,
            direction: percent < 0 ? 'down' : 'up',
            threshold: settings.thresholds.netChangePercent,
            personalLeaveDays: num(leave.personal),
            sickLeaveDays: num(leave.sick),
            absentDays: num(inputs.attendance?.absentDays),
            partialMonth: inputs.payableDays?.partial ?? false,
            manualItems: slip.manualItems.length,
          });
      }

      // Minimum wage of the insured city (or none configured).
      const city = inputs.insurance?.planCity ?? null;
      const minimum = settings.minimumWage.find((m) => m.city === city);
      if (
        minimum &&
        slip.net !== null &&
        slip.net < minimum.amount &&
        !inputs.payableDays?.partial
      )
        push(slip, 'belowMinimumWage', '', { city });

      // Manual items above the threshold.
      slip.manualItems.forEach((item, index) => {
        if (Math.abs(item.amount) > settings.thresholds.manualItemAmount)
          push(slip, 'manualLarge', String(index), {
            code: item.code,
            reason: item.reason,
            threshold: settings.thresholds.manualItemAmount,
          });
      });

      // Imported items: missing, or far above the recent months.
      for (const item of inputs.structure?.items ?? []) {
        if (item.calc !== 'imported') continue;
        if (
          item.departmentIds?.length &&
          !item.departmentIds.some((d) => chain.includes(d))
        )
          continue;
        const value = slip.importedValues[item.code];
        if (value === undefined) {
          const hiredThisMonth = Boolean(
            employee?.hireDate?.startsWith(cycle.month),
          );
          push(slip, 'importMissing', item.code, {
            item: item.code,
            itemTitle: item.title,
            imported: cycle.imports.some((r) =>
              r.itemCodes.includes(item.code),
            ),
            inFile:
              inFile.get(item.code)?.has(employee?.employeeNo ?? '') ?? false,
            employeeNo: employee?.employeeNo ?? '',
            hireDate: employee?.hireDate ?? null,
            hiredThisMonth,
            department: titleOf.get(slip.departmentId ?? '') ?? '',
          });
          continue;
        }
        const past = (history.get(slip.employeeId) ?? [])
          .map((v) => v[item.code])
          .filter((v): v is number => typeof v === 'number' && v > 0);
        if (past.length) {
          const average = past.reduce((s, v) => s + v, 0) / past.length;
          if (value > average * settings.thresholds.importSpikeFactor)
            push(slip, 'importSpike', item.code, {
              item: item.code,
              itemTitle: item.title,
              ratio: Math.round((value / average) * 10) / 10,
              months: past.length,
              factor: settings.thresholds.importSpikeFactor,
            });
        }
      }

      // Payable days against the record's dates now.
      if (employee && inputs.structure) {
        const expected = payableDaysFor(
          employee,
          cycle.month,
          inputs.structure.payDaysPerMonth,
          calendar,
        );
        const used = num(inputs.payableDays?.payableDays, expected.payableDays);
        const joinsOrLeaves =
          Boolean(employee.hireDate?.startsWith(cycle.month)) ||
          Boolean(employee.leaveDate?.startsWith(cycle.month)) ||
          inputs.payableDays?.partial;
        if (joinsOrLeaves && Math.abs(expected.payableDays - used) > 0.001)
          push(slip, 'prorationMismatch', '', {
            expectedDays: expected.payableDays,
            usedDays: used,
            hireDate: employee.hireDate,
            leaveDate: employee.leaveDate,
          });
      }

      // The enrolment's bases outside the plan's range.
      if (inputs.insurance) {
        const plan = plans.find((p) => p.id === inputs.insurance?.planId);
        for (const item of plan?.items ?? []) {
          const base =
            item.code === 'housingFund'
              ? inputs.insurance.housingFundBase
              : inputs.insurance.socialBase;
          if (
            base < item.baseMin ||
            (item.baseMax > 0 && base > item.baseMax)
          ) {
            push(slip, 'baseOutOfRange', item.code, {
              code: item.code,
              city: inputs.insurance.planCity,
              below: base < item.baseMin,
            });
            break;
          }
        }
      }

      // Overtime without an overtime item.
      const overtime = Object.values(
        inputs.attendance?.overtimeByType ?? {},
      ).reduce((s, v) => s + num(v), 0);
      const paysOvertime = lines.some((l) =>
        (l.formula ?? '').includes('att.overtime'),
      );
      if (overtime > 0 && !paysOvertime)
        push(slip, 'overtimeNoPay', '', {
          hours: Math.round(overtime * 100) / 100,
        });

      // Parameters in use, by value.
      const structure = inputs.structure;
      if (structure)
        for (const param of structure.params ?? []) {
          // Only parameters an applicable formula of this employee actually reads.
          const reads = lines.some((l) =>
            (l.formula ?? '').includes(`param.${param.code}`),
          );
          if (!reads) continue;
          paramTitles.set(param.code, param.title);
          const byValue =
            paramUse.get(param.code) ??
            new Map<
              number,
              { structures: Map<string, string>; employees: string[] }
            >();
          const entry = byValue.get(param.value) ?? {
            structures: new Map<string, string>(),
            employees: [] as string[],
          };
          entry.structures.set(structure.id, structure.title);
          entry.employees.push(slip.employeeId);
          byValue.set(param.value, entry);
          paramUse.set(param.code, byValue);
        }
    }

    const structureLogs = new Map(
      (
        await database
          .query()
          .selectFrom('salaryStructures')
          .select(['id', 'changeLog'])
          .execute()
      ).map((s) => [
        str(s.id),
        json<{ summary: string; at: string }[]>(s.changeLog, []),
      ]),
    );
    for (const [code, byValue] of paramUse) {
      if (byValue.size < 2) continue;
      const ranked = [...byValue.entries()].sort(
        (a, b) => b[1].employees.length - a[1].employees.length,
      );
      const [referenceValue, reference] = ranked[0];
      const referenceStructures = [...reference.structures.values()];
      for (const [value, entry] of ranked.slice(1))
        for (const employeeId of entry.employees) {
          const slip = slips.find((s) => s.employeeId === employeeId)!;
          const structure = (slip.inputs as Snapshot).structure!;
          const log = (structureLogs.get(structure.id) ?? [])
            .filter(
              (l) =>
                l.summary.includes(code) ||
                l.summary.includes(paramTitles.get(code) ?? code),
            )
            .map((l) => l.summary);
          push(slip, 'paramMismatch', code, {
            param: code,
            paramTitle: paramTitles.get(code) ?? code,
            value,
            structureId: structure.id,
            structureTitle: structure.title,
            referenceValue,
            referenceStructures: referenceStructures.join('、'),
            changeLog: log.slice(-3).join(' / ') || null,
            affected: entry.employees.length,
          });
        }
    }
    // V4-12: the bonus cycle's gaps — employee id, type and the review cycle's name, never a rating.
    for (const slip of slips) {
      const perf = (
        slip.inputs as {
          perf?: {
            status?: string;
            cycleTitle?: string | null;
            schemeId?: string | null;
          } | null;
        }
      ).perf;
      if (!perf) continue;
      if (perf.status === 'noResult' || perf.status === 'closed')
        push(slip, 'perfResultMissing', '', {
          cycleTitle: perf.cycleTitle ?? '',
          employeeId: slip.employeeId,
        });
      else if (perf.status === 'noCoefficients')
        push(slip, 'perfCoefficientsMissing', '', {
          cycleTitle: perf.cycleTitle ?? '',
          employeeId: slip.employeeId,
          schemeId: perf.schemeId ?? null,
        });
    }
    return {
      cycleId: cycle.id,
      month: cycle.month,
      calculationId: cycle.calculationId,
      issues: out,
    };
  };
}

export type AnomalyCheck = ReturnType<typeof createAnomalyCheck>;

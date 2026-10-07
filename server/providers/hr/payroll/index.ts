/**
 * V2-06 薪酬与社保: the payroll services, built once by the provider
 * (server/providers/hr/index.ts, V2-06 block) and resolved through
 * `payrollServicesToken`.
 */
import type { AIRunner } from '../ai-runner.js';
import type { AutomationService } from '../automation.js';
import { createAnomalyCheck } from './anomalies.js';
import { createPayrollAssistant } from './assistant.js';
import { createPayrollContext, type PayrollDeps } from './context.js';
import { createCycleService } from './cycles.js';
import { createPayrollEventHandler } from './events.js';
import { createInsuranceService } from './insurance.js';
import { createMyPayslipService } from './my-payslips.js';
import { createOpeningImportService } from './opening-imports.js';
import { createSalaryService } from './salaries.js';
import { createStructureService } from './structures.js';
import { createPayrollTasks } from './tasks.js';
import { createVendorBillService } from './vendor-bills.js';

export function createPayrollServices(
  deps: PayrollDeps & {
    readonly automation: () => AutomationService;
    readonly ai: AIRunner;
  },
) {
  const ctx = createPayrollContext(deps);
  const structures = createStructureService(ctx);
  const salaries = createSalaryService(ctx, structures);
  const insurance = createInsuranceService(ctx);
  const cycles = createCycleService(ctx, structures, insurance);
  const anomalies = createAnomalyCheck(ctx, cycles);
  const bills = createVendorBillService(ctx);
  const mine = createMyPayslipService(ctx);
  // 上线准备: the opening-data importers (薪资档案, 参保, 专项附加扣除, 个税累计期初).
  const openings = createOpeningImportService(ctx, structures);
  const assistant = createPayrollAssistant({
    ctx,
    cycles,
    anomalies,
    bills,
    automation: deps.automation,
    ai: deps.ai,
  });
  return {
    context: ctx,
    structures,
    salaries,
    insurance,
    cycles,
    anomalies,
    bills,
    mine,
    openings,
    assistant,
    onJobEvent: createPayrollEventHandler(ctx, insurance),
    runTask: createPayrollTasks(ctx, insurance),
  };
}

export type PayrollServices = ReturnType<typeof createPayrollServices>;

import type { GapTableRow } from './gap-table.js';
import { useRemote } from './use-remote.js';

/** V3-08 差距汇总: mandatory items with a gap, the sum of all gaps, and mandatory items nobody assessed. */
export interface GapSummary {
  readonly mandatoryGaps: number;
  readonly totalGap: number;
  readonly unassessedMandatory: number;
}

export interface CompetencyTarget {
  readonly id: string;
  readonly targetPositionId: string;
  readonly targetPositionTitle: string;
  readonly reason: string | null;
  readonly createdAt: string;
  readonly rows: GapTableRow[];
  readonly summary: GapSummary;
}

/** `GET talent/competency/employees/:id`: the 能力 Tab's data. */
export interface EmployeeCompetencyView {
  readonly employee: { id: string; name: string; positionId: string | null };
  readonly positionTitle: string | null;
  readonly rows: GapTableRow[];
  readonly summary: GapSummary;
  readonly targets: CompetencyTarget[];
}

export function competencyViewPath(employeeId: string): string {
  return `talent/competency/employees/${encodeURIComponent(employeeId)}`;
}

/** Loads the 能力 Tab's data for one employee. */
export function useCompetencyView(employeeId: string | null) {
  return useRemote<EmployeeCompetencyView>(
    employeeId ? competencyViewPath(employeeId) : null,
  );
}

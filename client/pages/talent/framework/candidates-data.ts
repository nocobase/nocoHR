import type { GapSummary } from '@/components/talent/competency-types';
import { useRemote, type RemoteState } from '@/components/talent/use-remote';

export interface Candidate {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeNo: string;
  readonly currentPositionTitle: string | null;
  readonly departmentTitle: string;
  readonly createdByName: string;
  readonly reason: string | null;
  readonly status: string;
  readonly summary: GapSummary;
}

export interface CandidateList {
  readonly items: Candidate[];
  readonly canManage: boolean;
}

/** Loads the 拟任人员 of a position; a caller without access gets an error and the tab stays hidden. */
export function useCandidates(
  positionId: string | null,
): RemoteState<CandidateList> {
  return useRemote<CandidateList>(
    positionId
      ? `talent/competency/positions/${encodeURIComponent(positionId)}/candidates`
      : null,
  );
}

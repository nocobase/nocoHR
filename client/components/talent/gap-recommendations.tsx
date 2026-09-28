import { useState, type ReactElement, type ReactNode } from 'react';

import { AssignDialog, type AssignInitial } from './assign-dialog.js';
import { GapLinks, type Recommendation } from './gap-links.js';
import type { GapRow } from './types.js';
import { useRemote } from './use-remote.js';

/**
 * What closes each gap: published courses and exams tagged with the
 * competency, and — for a qualification — the certification that proves it.
 * The viewer's own profile links to learning and exams; a manager who may
 * assign gets a one-click 指派 prefilled with the person and the course.
 */
export function useGapRecommendations(
  employeeId: string,
  rows: readonly GapRow[] | undefined,
  options: { self: boolean },
): { extra: (row: GapRow) => ReactNode; dialog: ReactElement | null } {
  const ids = (rows ?? [])
    .filter((row) => row.gap > 0)
    .map((row) => row.competencyId);
  const remote = useRemote<{
    items: Record<string, Recommendation>;
    canAssign: boolean;
  }>(
    ids.length
      ? `talent/people/${encodeURIComponent(employeeId)}/recommendations`
      : null,
    { ids: ids.join(',') },
  );
  const [initial, setInitial] = useState<AssignInitial | null>(null);
  const canAssign = Boolean(remote.data?.canAssign) && !options.self;
  return {
    extra: (row) => {
      const item =
        row.gap > 0 ? remote.data?.items[row.competencyId] : undefined;
      return item ? (
        <GapLinks
          row={row}
          item={item}
          self={options.self}
          onAssign={
            canAssign
              ? (target) => setInitial({ ...target, employeeIds: [employeeId] })
              : undefined
          }
        />
      ) : null;
    },
    dialog: canAssign ? (
      <AssignDialog
        open={initial !== null}
        onOpenChange={(open) => (!open ? setInitial(null) : undefined)}
        onAssigned={() => setInitial(null)}
        initial={initial ?? undefined}
      />
    ) : null,
  };
}

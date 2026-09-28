import { useTranslation } from '@nocobase/i18n/client';
import { useMemo } from 'react';

import { titleText } from './titles.js';
import type { LookupDepartment, Lookups } from './types.js';
import { useRemote } from './use-remote.js';

export interface DepartmentOption extends LookupDepartment {
  readonly label: string;
  readonly depth: number;
}

/**
 * Departments and positions for pickers and labels. Department titles are
 * decoded here so every page shows them in the viewer's language.
 */
export function useLookups() {
  const { t } = useTranslation();
  const remote = useRemote<Lookups>('talent/lookups');
  const value = useMemo(() => {
    const departments = remote.data?.departments ?? [];
    const positions = remote.data?.positions ?? [];
    const childrenOf = new Map<string | null, LookupDepartment[]>();
    for (const d of departments) {
      const list = childrenOf.get(d.parentId) ?? [];
      list.push(d);
      childrenOf.set(d.parentId, list);
    }
    const known = new Set(departments.map((d) => d.id));
    const ordered: DepartmentOption[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const d of childrenOf.get(parentId) ?? []) {
        ordered.push({ ...d, label: titleText(d.title, t), depth });
        walk(d.id, depth + 1);
      }
    };
    walk(null, 0);
    // Orphans (a parent the caller cannot see) still get listed.
    for (const d of departments)
      if (
        d.parentId &&
        !known.has(d.parentId) &&
        !ordered.some((o) => o.id === d.id)
      )
        ordered.push({ ...d, label: titleText(d.title, t), depth: 0 });
    const departmentLabel = new Map(ordered.map((d) => [d.id, d.label]));
    const positionLabel = new Map(positions.map((p) => [p.id, p.title]));
    return {
      departments: ordered,
      positions,
      departmentTitle: (id: string | null | undefined) =>
        id ? (departmentLabel.get(id) ?? id) : '',
      positionTitle: (id: string | null | undefined) =>
        id ? (positionLabel.get(id) ?? id) : '',
    };
  }, [remote.data, t]);
  return {
    ...value,
    loading: remote.loading,
    error: remote.error,
    reload: remote.reload,
  };
}

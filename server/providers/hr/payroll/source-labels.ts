/**
 * 工资条 · 计算方式: the names a payslip line's variables are shown with, so
 * an employee reads “夜班津贴标准” rather than `param.nightRate`. Parameters,
 * items, imports and allowances take the salary structures' own titles; leave
 * types and shifts theirs. Fixed variables (`base`, `att.nightShiftCount`, …)
 * are named by the client's translations. Labels are added when a payslip is
 * read, so payslips calculated earlier get them too.
 */
import type { DatabaseManager } from '@nocobase/db';

import { json } from './common.js';

type Source = { name: string; value: number; source: string };
type Line = { sources?: Source[] | null };

export async function sourceLabels(
  database: DatabaseManager,
): Promise<(name: string) => string | undefined> {
  const q = database.query();
  const [structures, leaveTypes, shifts] = await Promise.all([
    q.selectFrom('salaryStructures').select(['items', 'params']).execute(),
    q.selectFrom('leaveTypes').select(['code', 'title']).execute(),
    q.selectFrom('shifts').select(['code', 'title']).execute(),
  ]);
  const params = new Map<string, string>();
  const items = new Map<string, string>();
  for (const s of structures) {
    for (const p of json<{ code: string; title: string }[]>(s.params, []))
      if (!params.has(p.code)) params.set(p.code, p.title);
    for (const i of json<{ code: string; title: string }[]>(s.items, []))
      if (!items.has(i.code)) items.set(i.code, i.title);
  }
  const leave = new Map(
    leaveTypes.map((l) => [String(l.code), String(l.title)]),
  );
  const shift = new Map(shifts.map((l) => [String(l.code), String(l.title)]));
  return (name) => {
    const [head, second, third] = name.split('.');
    if (head === 'param') return params.get(second);
    if (head === 'item' || head === 'imp' || head === 'allowance')
      return items.get(second);
    if (head === 'att' && second === 'leave') return leave.get(third);
    if (head === 'att' && second === 'shift') return shift.get(third);
    return undefined;
  };
}

/** The lines with each source's label, where one is known. */
export function withSourceLabels<T extends Line>(
  lines: readonly T[],
  label: (name: string) => string | undefined,
): T[] {
  return lines.map((line) =>
    line.sources
      ? {
          ...line,
          sources: line.sources.map((s) => {
            const known = label(s.name);
            return known ? { ...s, label: known } : s;
          }),
        }
      : line,
  );
}

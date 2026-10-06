// Same rule as server/providers/hr/department-labels.ts; the client and the server share no source.
/**
 * Departments with the same name in different places — 机加工车间 in two plants, 急诊科 in two hospital
 * campuses, 收银组 in two stores — are told apart by the unit above them. These helpers used to know only
 * “…工厂” parents.
 */

/** The trailing unit word of an organisation unit's name, longest first. */
const UNIT_SUFFIX =
  /(工厂|分公司|子公司|医院|院区|门店|大区|区域|片区|中心|项目部|事业部|基地|园区|厂|院|店|区)$/u;

/** The name without its unit word (苏州工厂 → 苏州, 东院区 → 东), or the name itself when nothing is left. */
export function unitShortName(title: string): string {
  const short = title.replace(UNIT_SUFFIX, '');
  return short || title;
}

/**
 * The department's name, qualified by its parent's when another department has the same name and the name
 * does not already carry the parent's (成都机加工车间 stays as it is).
 */
export function qualifiedDepartmentTitle(
  department: { id: string; title: string; parentId?: string | null },
  departments: readonly { id: string; title: string }[],
  separator = '',
): string {
  const { title } = department;
  const parent = department.parentId
    ? departments.find((d) => d.id === department.parentId)
    : undefined;
  if (!parent) return title;
  const shared = departments.some(
    (d) => d.id !== department.id && d.title === title,
  );
  if (!shared || title.startsWith(unitShortName(parent.title))) return title;
  return `${parent.title}${separator}${title}`;
}

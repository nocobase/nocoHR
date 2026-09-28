/**
 * The HR assistant's import health check (V1 step 1): the problems an Excel
 * import leaves in the organisation data, computed by rules on the server —
 * the model only words the report. Nothing here changes data, and no mobile
 * number leaves this module: a duplicate is reported as "same name and
 * mobile".
 *
 * Every walk up the manager chain or the department tree is bounded and stops
 * at a repeated node, so a loop in imported data cannot hang the server.
 */
import type { OrganizationService } from './organization-service.js';
import { bool, json, type Platform } from './platform.js';
import { HrError, str } from './shared.js';

export type IssueType =
  | 'duplicateEmployee'
  | 'managerCycle'
  | 'departmentNoHead'
  | 'noManager'
  | 'noPosition'
  | 'similarPositions';
export type IssueSeverity = 'mustFix' | 'suggested';

export interface IssueRecord {
  readonly type: 'employee' | 'department' | 'position';
  readonly id: string;
  readonly name: string;
  /** Employee number, department code or position code. */
  readonly code: string | null;
}

export interface ImportIssue {
  readonly type: IssueType;
  readonly severity: IssueSeverity;
  readonly records: readonly IssueRecord[];
  /** Facts computed on the server that the report explains, such as the nearest head or a headcount. */
  readonly facts: Readonly<Record<string, unknown>>;
  /** The candidate fix, worded by rule; the report may rephrase it. */
  readonly suggestion: string;
  /** Opens the employee list or positions page filtered to the records. */
  readonly link: string;
}

export interface ImportCheckResult {
  readonly batch: {
    readonly id: string;
    readonly importedByUserId: string;
    readonly importedByName: string | null;
    readonly createdCount: number;
    readonly updatedCount: number;
    readonly createdPositions: readonly string[];
  };
  readonly issues: readonly ImportIssue[];
  readonly counts: { readonly mustFix: number; readonly suggested: number };
}

export interface ImportCheckParams {
  readonly synonyms: string;
  readonly editDistance: number;
}

const MAX_DEPTH = 50;
const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  mustFix: 0,
  suggested: 1,
};
const TYPE_ORDER: IssueType[] = [
  'duplicateEmployee',
  'managerCycle',
  'departmentNoHead',
  'noManager',
  'noPosition',
  'similarPositions',
];

/** Mobile numbers compare without spaces, hyphens and a +86/86 prefix. */
export function normalizeMobile(value: unknown): string {
  const digits = str(value ?? '').replace(/[\s()-]/gu, '');
  return digits.replace(/^\+?86(?=1\d{10}$)/u, '');
}

/** Parses "CNC/数控; 操作工/操作员" into groups of alternatives. */
export function parseSynonyms(text: string): string[][] {
  return text
    .split(/[;；\n]/u)
    .map((group) =>
      group
        .split(/[/／|,，]/u)
        .map((word) =>
          word.normalize('NFKC').replace(/\s+/gu, '').toLowerCase(),
        )
        .filter(Boolean),
    )
    .filter((group) => group.length > 1);
}

/** Position titles compare without spacing, width and case, with every synonym replaced by its group's first word. */
export function normalizeTitle(title: string, groups: string[][]): string {
  let text = title.normalize('NFKC').replace(/\s+/gu, '').toLowerCase();
  for (const group of groups)
    for (const word of group.slice(1)) text = text.split(word).join(group[0]);
  return text;
}

export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let previous = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= y.length; j += 1)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[y.length];
}

function employeesLink(ids: readonly string[]): string {
  return `/talent/employees?ids=${ids.map(encodeURIComponent).join(',')}`;
}

export async function computeImportIssues(
  platform: Platform,
  organization: OrganizationService,
  batchId: string,
  params: ImportCheckParams,
): Promise<ImportCheckResult> {
  const query = platform.database.query();
  const batch = await query
    .selectFrom('employeeImportBatches')
    .selectAll()
    .where('id', '=', batchId)
    .executeTakeFirst();
  if (!batch) throw new HrError('IMPORT_BATCH_NOT_FOUND', 404);
  const batchIds = new Set([
    ...json<string[]>(batch.createdEmployeeIds, []),
    ...json<string[]>(batch.updatedEmployeeIds, []),
  ]);
  const createdPositionIds = new Set(
    json<string[]>(batch.createdPositionIds, []),
  );
  const employees = (
    await query
      .selectFrom('employees')
      .select([
        'id',
        'employeeNo',
        'name',
        'userId',
        'departmentId',
        'positionId',
        'managerEmployeeId',
        'status',
        'mobile',
      ])
      .execute()
  ).map((e) => ({
    id: str(e.id),
    no: str(e.employeeNo),
    name: str(e.name),
    userId: e.userId ? str(e.userId) : null,
    departmentId: str(e.departmentId),
    positionId: e.positionId ? str(e.positionId) : null,
    managerId: e.managerEmployeeId ? str(e.managerEmployeeId) : null,
    status: str(e.status),
    mobile: normalizeMobile(e.mobile),
  }));
  const byId = new Map(employees.map((e) => [e.id, e]));
  const inBatch = employees.filter((e) => batchIds.has(e.id));
  const activeInBatch = inBatch.filter((e) => e.status !== 'leave');
  const departments = new Map(
    (await organization.listTree()).map((d) => [d.id, d]),
  );
  const departmentName = (id: string): string => {
    const department = departments.get(id);
    return department ? organization.titleText(department.title) : id;
  };
  const positions = (
    await query
      .selectFrom('positions')
      .select(['id', 'code', 'title', 'active'])
      .execute()
  ).map((p) => ({
    id: str(p.id),
    code: str(p.code),
    title: str(p.title),
    active: bool(p.active),
  }));
  const positionById = new Map(positions.map((p) => [p.id, p]));
  const employeeRecord = (e: (typeof employees)[number]): IssueRecord => ({
    type: 'employee',
    id: e.id,
    name: e.name,
    code: e.no,
  });
  const issues: ImportIssue[] = [];

  // 1. Duplicate employees: the same name and mobile under another employee number (including people who left).
  const reported = new Set<string>();
  for (const person of inBatch) {
    if (!person.mobile) continue;
    const twins = employees.filter(
      (other) =>
        other.id !== person.id &&
        other.name === person.name &&
        other.mobile === person.mobile &&
        other.no !== person.no,
    );
    if (!twins.length) continue;
    const group = [person, ...twins].sort((a, b) => a.no.localeCompare(b.no));
    const key = group.map((e) => e.id).join('|');
    if (reported.has(key)) continue;
    reported.add(key);
    issues.push({
      type: 'duplicateEmployee',
      severity: 'mustFix',
      records: group.map(employeeRecord),
      facts: {
        existing: twins.map((t) => ({
          employeeNo: t.no,
          department: departmentName(t.departmentId),
          status: t.status,
          possibleRehire: t.status === 'leave',
        })),
      },
      suggestion: twins.some((t) => t.status === 'leave')
        ? '对方已离职，可能是再入职：确认是同一人后保留一个工号，另一条删除或标记离职'
        : '确认是否为同一人；是同一人时保留一个工号，删除误导入的记录',
      link: employeesLink(group.map((e) => e.id)),
    });
  }

  // 2. Manager loops among active employees.
  const inCycle = new Set<string>();
  for (const start of employees) {
    if (start.status === 'leave' || inCycle.has(start.id)) continue;
    const path: string[] = [];
    const seen = new Map<string, number>();
    let cursor: string | null = start.id;
    for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
      if (seen.has(cursor)) {
        const loop = path.slice(seen.get(cursor));
        if (!loop.some((id) => inCycle.has(id))) {
          loop.forEach((id) => inCycle.add(id));
          const members = loop.map((id) => byId.get(id)!);
          const heads = members.map((m) => {
            const head = headOf(m.departmentId, m.userId);
            return head ? `${m.name} → ${head.name}（${head.no}）` : null;
          });
          issues.push({
            type: 'managerCycle',
            severity: 'mustFix',
            records: members.map(employeeRecord),
            facts: { loop: members.map((m) => `${m.name}（${m.no}）`) },
            suggestion: heads.some(Boolean)
              ? `把直属上级改为所在部门负责人：${heads.filter(Boolean).join('；')}`
              : '把其中一人的直属上级改为所在部门负责人',
            link: employeesLink(loop),
          });
        }
        break;
      }
      const person = byId.get(cursor);
      if (!person || person.status === 'leave') break;
      seen.set(cursor, path.length);
      path.push(cursor);
      cursor = person.managerId;
    }
  }

  /** The employee record of the nearest head above a department (skipping the person themselves). */
  function headOf(
    departmentId: string,
    selfUserId: string | null,
  ): { id: string; name: string; no: string; departmentId: string } | null {
    let cursor: string | null = departmentId;
    for (let depth = 0; cursor && depth < MAX_DEPTH; depth += 1) {
      const department = departments.get(cursor);
      if (!department) return null;
      if (department.managerId && department.managerId !== selfUserId) {
        const head = employees.find(
          (e) => e.userId === department.managerId && e.status !== 'leave',
        );
        if (head)
          return {
            id: head.id,
            name: head.name,
            no: head.no,
            departmentId: department.id,
          };
      }
      cursor = department.parentId;
    }
    return null;
  }

  // 3. Departments of the batch without a head.
  const batchDepartments = [
    ...new Set(activeInBatch.map((e) => e.departmentId)),
  ];
  for (const departmentId of batchDepartments) {
    const department = departments.get(departmentId);
    if (!department || department.managerId) continue;
    const above = department.parentId
      ? headOf(department.parentId, null)
      : null;
    issues.push({
      type: 'departmentNoHead',
      severity: above ? 'suggested' : 'mustFix',
      records: [
        {
          type: 'department',
          id: departmentId,
          name: departmentName(departmentId),
          code: department.code ?? null,
        },
      ],
      facts: {
        nearestHead: above
          ? {
              name: above.name,
              employeeNo: above.no,
              department: departmentName(above.departmentId),
            }
          : null,
      },
      suggestion: above
        ? `在组织管理中为该部门设负责人；未设置前，主管范围和审批会向上找到${departmentName(above.departmentId)}（${above.name}）`
        : '本部门及所有上级部门都没有负责人：请在组织管理中设置负责人，否则主管范围和审批都找不到人',
      link: `/talent/employees?department=${encodeURIComponent(departmentId)}`,
    });
  }

  // 4. Active employees of the batch without a manager.
  for (const person of activeInBatch) {
    if (person.managerId) continue;
    const department = departments.get(person.departmentId);
    const isHead = Boolean(
      department?.managerId && department.managerId === person.userId,
    );
    const head = headOf(person.departmentId, person.userId);
    // A head whose ancestors have no head has nobody to report to.
    if (isHead && !head) continue;
    issues.push({
      type: 'noManager',
      severity: 'suggested',
      records: [employeeRecord(person)],
      facts: {
        department: departmentName(person.departmentId),
        candidate: head ? { name: head.name, employeeNo: head.no } : null,
      },
      suggestion: head
        ? `直属上级填写所在部门（向上）负责人 ${head.name}（${head.no}）`
        : `${departmentName(person.departmentId)}及其上级部门都没有负责人，暂时找不到合适的直属上级；先设置部门负责人`,
      link: employeesLink([person.id]),
    });
  }

  // 5. Employees of the batch without a position.
  for (const person of activeInBatch) {
    if (person.positionId) continue;
    const counts = new Map<string, number>();
    for (const colleague of employees)
      if (
        colleague.departmentId === person.departmentId &&
        colleague.positionId &&
        colleague.status !== 'leave'
      )
        counts.set(
          colleague.positionId,
          (counts.get(colleague.positionId) ?? 0) + 1,
        );
    const common = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    const position = common ? positionById.get(common[0]) : undefined;
    issues.push({
      type: 'noPosition',
      severity: 'suggested',
      records: [employeeRecord(person)],
      facts: {
        department: departmentName(person.departmentId),
        common: position ? { title: position.title, count: common[1] } : null,
      },
      suggestion: position
        ? `同部门员工最常见的岗位是“${position.title}”（${common[1]} 人），确认后填写岗位`
        : '同部门没有可参考的岗位，请按实际工作填写岗位',
      link: employeesLink([person.id]),
    });
  }

  // 6. Similar position titles: positions the batch used or created against all enabled positions.
  const groups = parseSynonyms(params.synonyms);
  const used = new Set<string>([
    ...createdPositionIds,
    ...inBatch.map((e) => e.positionId).filter((id): id is string => !!id),
  ]);
  const headcount = new Map<string, number>();
  for (const e of employees)
    if (e.positionId && e.status !== 'leave')
      headcount.set(e.positionId, (headcount.get(e.positionId) ?? 0) + 1);
  const pairs = new Set<string>();
  for (const id of used) {
    const mine = positionById.get(id);
    if (!mine || !mine.active) continue;
    const key = normalizeTitle(mine.title, groups);
    for (const other of positions) {
      if (other.id === mine.id || !other.active) continue;
      const otherKey = normalizeTitle(other.title, groups);
      if (
        key !== otherKey &&
        editDistance(key, otherKey) > Math.max(0, params.editDistance)
      )
        continue;
      const pair = [mine.id, other.id].sort().join('|');
      if (pairs.has(pair)) continue;
      pairs.add(pair);
      const both = [mine, other];
      const fresh = both.find((p) => createdPositionIds.has(p.id));
      issues.push({
        type: 'similarPositions',
        severity: 'suggested',
        records: both.map((p) => ({
          type: 'position',
          id: p.id,
          name: p.title,
          code: p.code,
        })),
        facts: {
          positions: both.map((p) => ({
            title: p.title,
            headcount: headcount.get(p.id) ?? 0,
            createdByThisImport: createdPositionIds.has(p.id),
          })),
        },
        suggestion: fresh
          ? `“${fresh.title}”由本次导入新建，与“${both.find((p) => p !== fresh)!.title}”相近：如是同一岗位，把相关员工改到已有岗位后停用新建的岗位`
          : `“${mine.title}”与“${other.title}”相近：确认是否同一岗位，统一后停用其中一个`,
        link: `/talent/positions?position=${encodeURIComponent(fresh?.id ?? mine.id)}`,
      });
    }
  }

  issues.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type),
  );
  return {
    batch: {
      id: batchId,
      importedByUserId: str(batch.importedByUserId),
      importedByName: await platform.userName(str(batch.importedByUserId)),
      createdCount: Number(batch.createdCount ?? 0),
      updatedCount: Number(batch.updatedCount ?? 0),
      createdPositions: [...createdPositionIds].map(
        (id) => positionById.get(id)?.title ?? id,
      ),
    },
    issues,
    counts: {
      mustFix: issues.filter((i) => i.severity === 'mustFix').length,
      suggested: issues.filter((i) => i.severity === 'suggested').length,
    },
  };
}

/**
 * V1-02 用工合规检查: labour-contract risks found by rule, every day and when a
 * contract is saved or an onboarding takes effect.
 *
 * - secondFixedTerm: the second consecutive fixed-term contract is about to
 *   end — the employee may require an open-ended one (劳动合同法 第十四条);
 * - probationLimit: the probation is longer than the contract term allows
 *   (第十九条; limits in 人事设置 · 用工合规检查);
 * - noContract: in service for more than the configured days without an
 *   active written contract (第八十二条, double wages);
 * - expiredContract: the contract ended, the employee is still at work and
 *   has no new one.
 *
 * Rules decide; the HR assistant only words the notice. Every notice says it
 * is a prompt for HR to check, not legal advice. An issue is raised once and
 * closes by itself when it is gone.
 */
import type { DatabaseManager } from '@nocobase/db';

import type { ActorContext } from './framework-service.js';
import type { PersonnelSettings } from './personnel-settings.js';
import {
  addDays,
  daysBetween,
  HrError,
  newId,
  str,
  toDateOnly,
} from './shared.js';

export const COMPLIANCE_KINDS = [
  'secondFixedTerm',
  'probationLimit',
  'noContract',
  'expiredContract',
] as const;
export type ComplianceKind = (typeof COMPLIANCE_KINDS)[number];

export interface ComplianceFinding {
  employeeId: string;
  employeeName: string;
  kind: ComplianceKind;
  /** The facts the rule used; shown to HR and handed to the assistant. */
  detail: Record<string, string | number | null>;
}

export interface ComplianceIssue extends ComplianceFinding {
  id: string;
  status: 'open' | 'closed';
  aiNote: string | null;
  /** What the page shows: the assistant's note, or the template wording until it is written. */
  note: string;
  detectedAt: string;
  closedAt: string | null;
}

/** The law each kind cites, for the notice. */
export const COMPLIANCE_ARTICLES: Record<ComplianceKind, string> = {
  secondFixedTerm: '《劳动合同法》第十四条',
  probationLimit: '《劳动合同法》第十九条',
  noContract: '《劳动合同法》第八十二条',
  expiredContract: '《劳动合同法》第十四条、第八十二条',
};

const COMPLIANCE_TEXT: Record<string, (i: ComplianceIssue) => string> = {
  secondFixedTerm: (i) =>
    `${i.employeeName}的劳动合同 ${i.detail.contractNo} 将于 ${i.detail.endDate} 到期，这是第 ${i.detail.fixedTermCount} 次连续订立的固定期限合同。续签时员工提出或同意续订的，除法定情形外应签订无固定期限合同。`,
  probationLimit: (i) =>
    `${i.employeeName}的试用期为 ${i.detail.probationMonths} 个月，合同期限 ${i.detail.termMonths ?? '无固定期限'}${i.detail.termMonths == null ? '' : ' 个月'}，按规定试用期最长 ${i.detail.limitMonths} 个月，建议更正。`,
  noContract: (i) =>
    `${i.employeeName}入职已 ${i.detail.days} 天（${i.detail.hireDate}），还没有书面劳动合同，超过一个月未签存在支付双倍工资的风险，建议尽快签订。`,
  expiredContract: (i) =>
    `${i.employeeName}的劳动合同 ${i.detail.contractNo} 已于 ${i.detail.endDate} 到期，本人仍在职且没有新合同，请续签或确认用工状态。`,
};

export function complianceFallback(issue: ComplianceIssue): string {
  const text = COMPLIANCE_TEXT[issue.kind]?.(issue) ?? issue.kind;
  return `${text}依据：${COMPLIANCE_ARTICLES[issue.kind]}。提示，不是法律意见，请 HR 核对。`;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** Whole months from `start` up to the day after `end` (a probation from 07-01 to 12-31 is 6). */
export function monthsCovered(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${addDays(end, 1)}T00:00:00Z`);
  let months =
    (b.getUTCFullYear() - a.getUTCFullYear()) * 12 +
    (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/** The longest probation a contract of this term allows, by 第十九条 (configurable). */
export function probationLimitFor(
  startDate: string,
  endDate: string | null,
  limits: PersonnelSettings['compliance']['probationLimits'],
): number {
  if (!endDate) return limits.threeYearsOrOpen;
  const months = monthsCovered(startDate, endDate);
  if (months < 3) return limits.underThreeMonths;
  if (months < 12) return limits.underOneYear;
  if (months < 36) return limits.underThreeYears;
  return limits.threeYearsOrOpen;
}

interface EmployeeRow {
  id: string;
  name: string;
  status: string;
  /** Only 全职 sign a written labour contract with the company (派遣/外包 with their agency, 实习 none, 兼职 may agree orally). */
  employmentType?: string | null;
  hireDate: string | null;
  probationEndDate: string | null;
}

interface ContractRow {
  employeeId: string;
  contractNo: string;
  type: string;
  status: string;
  startDate: string;
  endDate: string | null;
  previousContractId: string | null;
  id: string;
}

/** The pure rules, over one employee's record and contracts. */
export function findIssues(
  employee: EmployeeRow,
  contracts: readonly ContractRow[],
  settings: PersonnelSettings['compliance'],
  reminderWindowDays: number,
  date: string,
): ComplianceFinding[] {
  if (!settings.enabled || employee.status === 'leave') return [];
  if ((employee.employmentType ?? 'fullTime') !== 'fullTime') return [];
  const out: ComplianceFinding[] = [];
  const base = { employeeId: employee.id, employeeName: employee.name };
  const active = contracts.find((c) => c.status === 'active');
  if (
    settings.checks.secondFixedTerm &&
    active?.type === 'fixedTerm' &&
    active.endDate
  ) {
    // Consecutive fixed-term contracts: follow the renewal chain back.
    const byId = new Map(contracts.map((c) => [c.id, c]));
    let count = 1;
    let cursor = active.previousContractId
      ? byId.get(active.previousContractId)
      : undefined;
    while (cursor && count < 10) {
      if (cursor.type !== 'fixedTerm') break;
      count += 1;
      cursor = cursor.previousContractId
        ? byId.get(cursor.previousContractId)
        : undefined;
    }
    const left = daysBetween(date, active.endDate);
    if (count >= 2 && left >= 0 && left <= reminderWindowDays)
      out.push({
        ...base,
        kind: 'secondFixedTerm',
        detail: {
          contractNo: active.contractNo,
          endDate: active.endDate,
          fixedTermCount: count,
        },
      });
  }
  if (
    settings.checks.probationLimit &&
    active &&
    employee.hireDate &&
    employee.probationEndDate
  ) {
    const probationMonths = monthsCovered(
      employee.hireDate,
      employee.probationEndDate,
    );
    const limit = probationLimitFor(
      active.startDate,
      active.endDate,
      settings.probationLimits,
    );
    const termMonths = active.endDate
      ? monthsCovered(active.startDate, active.endDate)
      : null;
    if (probationMonths > limit)
      out.push({
        ...base,
        kind: 'probationLimit',
        detail: {
          contractNo: active.contractNo,
          termMonths,
          probationMonths,
          limitMonths: limit,
        },
      });
  }
  if (settings.checks.noContract && !active && employee.hireDate) {
    const days = daysBetween(employee.hireDate, date);
    const ended = contracts.some(
      (c) => c.status === 'expired' || c.status === 'terminated',
    );
    if (!contracts.length && days >= settings.noContractDays)
      out.push({
        ...base,
        kind: 'noContract',
        detail: { hireDate: employee.hireDate, days },
      });
    else if (ended && settings.checks.expiredContract) {
      const latest = [...contracts].sort((a, b) =>
        str(b.endDate ?? '').localeCompare(str(a.endDate ?? '')),
      )[0];
      if (latest?.status === 'expired')
        out.push({
          ...base,
          kind: 'expiredContract',
          detail: { contractNo: latest.contractNo, endDate: latest.endDate },
        });
    }
  }
  if (
    settings.checks.expiredContract &&
    active?.endDate &&
    daysBetween(active.endDate, date) > 0
  )
    out.push({
      ...base,
      kind: 'expiredContract',
      detail: { contractNo: active.contractNo, endDate: active.endDate },
    });
  return out;
}

export function createComplianceService(deps: {
  database: DatabaseManager;
  currentDate: () => string;
  isHrAdmin: (ctx: ActorContext) => Promise<boolean>;
  settings: () => Promise<{
    compliance: PersonnelSettings['compliance'];
    reminderWindowDays: number;
  }>;
}) {
  const { database } = deps;

  async function employeesAndContracts(employeeId?: string) {
    let employees = database
      .query()
      .selectFrom('employees')
      .select([
        'id',
        'name',
        'status',
        'employmentType',
        'hireDate',
        'probationEndDate',
      ])
      .where('status', '!=', 'leave');
    if (employeeId) employees = employees.where('id', '=', employeeId);
    const rows = await employees.execute();
    const ids = rows.map((r: Record<string, unknown>) => str(r.id));
    const contracts = ids.length
      ? await database
          .query()
          .selectFrom('employmentContracts')
          .select([
            'id',
            'employeeId',
            'contractNo',
            'type',
            'status',
            'startDate',
            'endDate',
            'previousContractId',
          ])
          .where('employeeId', 'in', ids)
          .execute()
      : [];
    const byEmployee = new Map<string, ContractRow[]>();
    for (const c of contracts as Record<string, unknown>[]) {
      const list = byEmployee.get(str(c.employeeId)) ?? [];
      list.push({
        id: str(c.id),
        employeeId: str(c.employeeId),
        contractNo: str(c.contractNo),
        type: str(c.type),
        status: str(c.status),
        startDate: toDateOnly(c.startDate as string) ?? '',
        endDate: toDateOnly(c.endDate as string | null),
        previousContractId:
          c.previousContractId == null ? null : str(c.previousContractId),
      });
      byEmployee.set(str(c.employeeId), list);
    }
    return rows.map((r: Record<string, unknown>) => ({
      employee: {
        id: str(r.id),
        name: str(r.name),
        status: str(r.status),
        employmentType: r.employmentType == null ? null : str(r.employmentType),
        hireDate: toDateOnly(r.hireDate as string | null),
        probationEndDate: toDateOnly(r.probationEndDate as string | null),
      },
      contracts: byEmployee.get(str(r.id)) ?? [],
    }));
  }

  function toIssue(
    row: Record<string, unknown>,
    name: string,
  ): ComplianceIssue {
    const issue: Omit<ComplianceIssue, 'note'> = {
      id: str(row.id),
      employeeId: str(row.employeeId),
      employeeName: name,
      kind: str(row.kind) as ComplianceKind,
      status: str(row.status) as 'open' | 'closed',
      detail: parseJson<Record<string, string | number | null>>(row.detail, {}),
      aiNote: row.aiNote == null ? null : str(row.aiNote),
      detectedAt: new Date(str(row.detectedAt)).toISOString(),
      closedAt:
        row.closedAt == null ? null : new Date(str(row.closedAt)).toISOString(),
    };
    return {
      ...issue,
      note: issue.aiNote ?? complianceFallback({ ...issue, note: '' }),
    };
  }

  return {
    /**
     * Runs the rules (for everyone, or one employee), opens new issues and
     * closes the ones that are gone. Returns the issues opened now, which the
     * caller notifies.
     */
    async check(employeeId?: string): Promise<ComplianceIssue[]> {
      const { compliance, reminderWindowDays } = await deps.settings();
      const date = deps.currentDate();
      const opened: ComplianceIssue[] = [];
      const scope = await employeesAndContracts(employeeId);
      const found = new Map<string, ComplianceFinding>();
      for (const { employee, contracts } of scope)
        for (const finding of findIssues(
          employee,
          contracts,
          compliance,
          reminderWindowDays,
          date,
        ))
          found.set(`${finding.employeeId}:${finding.kind}`, finding);
      let openQuery = database
        .query()
        .selectFrom('complianceIssues')
        .selectAll()
        .where('status', '=', 'open');
      if (employeeId)
        openQuery = openQuery.where('employeeId', '=', employeeId);
      const openRows = await openQuery.execute();
      const stamp = new Date();
      for (const row of openRows) {
        const key = `${str(row.employeeId)}:${str(row.kind)}`;
        if (found.has(key)) {
          found.delete(key);
          continue;
        }
        await database
          .query()
          .updateTable('complianceIssues')
          .set({ status: 'closed', closedAt: stamp, updatedAt: stamp })
          .where('id', '=', str(row.id))
          .execute();
        await database
          .query()
          .updateTable('workItems')
          .set({ status: 'done', doneAt: stamp, updatedAt: stamp })
          .where('refId', '=', `compliance:${str(row.id)}`)
          .where('status', '=', 'open')
          .execute();
      }
      for (const finding of found.values()) {
        const id = newId();
        await database
          .query()
          .insertInto('complianceIssues')
          .values({
            id,
            employeeId: finding.employeeId,
            kind: finding.kind,
            status: 'open',
            detail: JSON.stringify(finding.detail),
            aiNote: null,
            detectedAt: stamp,
            notifiedAt: null,
            closedAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        const issue = {
          ...finding,
          id,
          status: 'open' as const,
          aiNote: null,
          detectedAt: stamp.toISOString(),
          closedAt: null,
          note: '',
        };
        opened.push({ ...issue, note: complianceFallback(issue) });
      }
      return opened;
    },

    async saveNote(id: string, note: string) {
      await database
        .query()
        .updateTable('complianceIssues')
        .set({
          aiNote: note.slice(0, 600),
          notifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
    },

    /** Open issues for an employee's renewal preparation. */
    async openFor(employeeId: string): Promise<ComplianceIssue[]> {
      const rows = await database
        .query()
        .selectFrom('complianceIssues')
        .selectAll()
        .where('employeeId', '=', employeeId)
        .where('status', '=', 'open')
        .execute();
      return rows.map((r: Record<string, unknown>) => toIssue(r, ''));
    },

    async list(ctx: ActorContext, status: string | undefined) {
      if (!(await deps.isHrAdmin(ctx))) throw new HrError('FORBIDDEN', 403);
      let query = database.query().selectFrom('complianceIssues').selectAll();
      query = query.where(
        'status',
        '=',
        status === 'closed' ? 'closed' : 'open',
      );
      const rows = await query
        .orderBy('detectedAt', 'desc')
        .limit(300)
        .execute();
      const ids = [...new Set(rows.map((r) => str(r.employeeId)))];
      const names = new Map(
        ids.length
          ? (
              await database
                .query()
                .selectFrom('employees')
                .select(['id', 'name'])
                .where('id', 'in', ids)
                .execute()
            ).map((e: Record<string, unknown>) => [str(e.id), str(e.name)])
          : [],
      );
      return rows.map((r) => toIssue(r, names.get(str(r.employeeId)) ?? ''));
    },
  };
}

export type ComplianceService = ReturnType<typeof createComplianceService>;

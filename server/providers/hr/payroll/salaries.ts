/**
 * V2-06 薪资档案 and 调薪申请. A salary file is history only: every change
 * adds a row, and the file a month uses is the latest one whose
 * effectiveMonth is not after it. A new hire's first file is `manual`; an
 * adjustment goes draft → pending → approved (a new `adjustment` file) or
 * rejected, through the approval levels of 薪酬设置. The applicant never
 * decides their own adjustment. An adjustment raised from a transfer or
 * promotion keeps the personnel action (`relatedActionId`), and deciding it
 * refreshes that action's change checklist.
 *
 * Bank accounts are masked in every list; only the file history shows them.
 */
import { z } from 'zod';

import { authorizeAction, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  addMonths,
  employedIn,
  iso,
  json,
  loadEmployees,
  maskAccount,
  MONTH,
  num,
  type PayrollEmployee,
} from './common.js';
import type { PayrollContext } from './context.js';
import { payrollScopes, type PayrollScopes } from './scope.js';
import type { StructureService } from './structures.js';

const SALARY = 'talent.salary';

const allowanceSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/u),
    amount: z.number().finite().min(0).max(10_000_000),
  })
  .strict();
const bankSchema = z
  .object({
    bankName: z.string().trim().max(100).nullish(),
    accountNo: z
      .string()
      .trim()
      .regex(/^[0-9 ]{4,40}$/u)
      .nullish(),
    accountName: z.string().trim().max(100).nullish(),
  })
  .strict();
const fileSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    effectiveMonth: z.string().regex(MONTH),
    baseSalary: z.number().finite().min(0).max(10_000_000),
    fixedAllowances: z.array(allowanceSchema).max(20).default([]),
    salaryStructureId: z.string().min(1).max(64).nullish(),
    bankAccount: bankSchema.nullish(),
    // V2-07: offer — pre-filled from an accepted offer, written when a payroll specialist confirms it.
    source: z.enum(['import', 'manual', 'offer']).default('manual'),
    // V4-12: 绩效奖金基数.
    bonusBase: z.number().finite().min(0).max(10_000_000).nullish(),
  })
  .strict();
const adjustmentSchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    effectiveMonth: z.string().regex(MONTH),
    baseSalary: z.number().finite().min(0).max(10_000_000),
    fixedAllowances: z.array(allowanceSchema).max(20).default([]),
    salaryStructureId: z.string().min(1).max(64),
    reason: z.string().trim().min(1).max(2000),
    relatedActionId: z.string().min(1).max(64).nullish(),
    // V4-12: the bonus base may change with an adjustment; the adjustment may cite a published review result.
    bonusBase: z.number().finite().min(0).max(10_000_000).nullish(),
    relatedReviewResultId: z.string().min(1).max(64).nullish(),
    submit: z.boolean().default(true),
  })
  .strict();
const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).nullish(),
  })
  .strict();

export interface SalaryFile {
  id: string;
  employeeId: string;
  effectiveMonth: string;
  baseSalary: number;
  fixedAllowances: { code: string; amount: number }[];
  salaryStructureId: string;
  bankAccount: {
    bankName?: string | null;
    accountNo?: string | null;
    accountName?: string | null;
  } | null;
  source: string;
  adjustmentId: string | null;
  createdAt: string | null;
  /** V4-12: 绩效奖金基数. */
  bonusBase: number | null;
}

export function toSalaryFile(row: Record<string, unknown>): SalaryFile {
  return {
    id: str(row.id),
    employeeId: str(row.employeeId),
    effectiveMonth: str(row.effectiveMonth),
    baseSalary: num(row.baseSalary),
    fixedAllowances: json(row.fixedAllowances, []),
    salaryStructureId: str(row.salaryStructureId),
    bankAccount: json(row.bankAccount, null),
    source: str(row.source),
    adjustmentId: row.adjustmentId ? str(row.adjustmentId) : null,
    createdAt: iso(row.createdAt),
    bonusBase:
      row.bonusBase === null || row.bonusBase === undefined
        ? null
        : num(row.bonusBase),
  };
}

/**
 * The file each employee uses in a month: the latest one not after it. With
 * the scopes of the action being served, only the files (and fields) its
 * grant reaches are used.
 */
export async function filesForMonth(
  ctx: PayrollContext,
  month: string,
  scopes?: PayrollScopes,
): Promise<Map<string, SalaryFile>> {
  const rows = await ctx.platform.database
    .query()
    .selectFrom('employeeSalaries')
    .selectAll()
    .where('effectiveMonth', '<=', month)
    .orderBy('effectiveMonth', 'asc')
    .execute();
  const result = new Map<string, SalaryFile>();
  for (const row of scopes
    ? await scopes.rows('employeeSalaries', rows)
    : rows) {
    const file = toSalaryFile(
      scopes ? await scopes.fields('employeeSalaries', row) : row,
    );
    result.set(file.employeeId, file);
  }
  return result;
}

export interface ApprovalStep {
  level: number;
  title: string;
  permissionSet: string;
  status: 'pending' | 'approved' | 'rejected' | 'waiting';
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
}

/** The approval steps for a submission, from 薪酬设置's levels. */
export async function approvalSteps(
  ctx: PayrollContext,
): Promise<ApprovalStep[]> {
  const settings = await ctx.settings();
  return settings.approval.levels.map((level, index) => ({
    level: index + 1,
    title: level.title,
    permissionSet: level.permissionSet,
    status: index === 0 ? 'pending' : 'waiting',
    decidedBy: null,
    decidedByName: null,
    decidedAt: null,
    comment: null,
  }));
}

/**
 * Decides the pending step: the decider must hold the step's permission set
 * and must not be the submitter. Answers the new steps and whether the whole
 * chain is now approved or rejected.
 */
export async function decideStep(
  ctx: PayrollContext,
  actor: ActorContext,
  steps: ApprovalStep[],
  submitter: string | null,
  input: { decision: 'approve' | 'reject'; comment?: string | null },
): Promise<{
  steps: ApprovalStep[];
  outcome: 'approved' | 'rejected' | 'pending';
}> {
  const pending = steps.find((step) => step.status === 'pending');
  if (!pending) throw new HrError('PAYROLL_NOT_PENDING', 409);
  if (submitter && submitter === actor.userId)
    throw new HrError('PAYROLL_SELF_APPROVAL', 403);
  const holders = await ctx.holdersOf(pending.permissionSet);
  if (!holders.includes(actor.userId)) throw new HrError('FORBIDDEN', 403);
  if (input.decision === 'reject' && !input.comment)
    throw new HrError('PAYROLL_COMMENT_REQUIRED', 400);
  const now = new Date().toISOString();
  const name = await ctx.platform.userName(actor.userId);
  const next = steps.map((step) =>
    step.level === pending.level
      ? {
          ...step,
          status:
            input.decision === 'approve'
              ? ('approved' as const)
              : ('rejected' as const),
          decidedBy: actor.userId,
          decidedByName: name,
          decidedAt: now,
          comment: input.comment ?? null,
        }
      : step,
  );
  if (input.decision === 'reject') return { steps: next, outcome: 'rejected' };
  const following = next.find((step) => step.status === 'waiting');
  if (!following) return { steps: next, outcome: 'approved' };
  return {
    steps: next.map((step) =>
      step.level === following.level
        ? { ...step, status: 'pending' as const }
        : step,
    ),
    outcome: 'pending',
  };
}

export function createSalaryService(
  ctx: PayrollContext,
  structures: StructureService,
) {
  const { platform } = ctx;
  const { database } = platform;

  /** An employee's salary files, newest first; with scopes, only those the action's grant reaches. */
  async function history(
    employeeId: string,
    scopes?: PayrollScopes,
  ): Promise<SalaryFile[]> {
    const rows = await database
      .query()
      .selectFrom('employeeSalaries')
      .selectAll()
      .where('employeeId', '=', employeeId)
      .orderBy('effectiveMonth', 'desc')
      .execute();
    if (!scopes)
      return rows.map((row) => toSalaryFile(row as Record<string, unknown>));
    const files = [];
    for (const row of await scopes.rows('employeeSalaries', rows))
      files.push(toSalaryFile(await scopes.fields('employeeSalaries', row)));
    return files;
  }

  /** The adjustments rows the action's grant reaches. */
  async function scopedAdjustments(
    scopes: PayrollScopes,
    rows: readonly Record<string, unknown>[],
  ) {
    const result = [];
    for (const row of await scopes.rows('salaryAdjustments', rows))
      result.push(
        presentAdjustment(await scopes.fields('salaryAdjustments', row)),
      );
    return result;
  }

  function presentAdjustment(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      employeeId: str(row.employeeId),
      effectiveMonth: str(row.effectiveMonth),
      changes: json<Record<string, unknown>>(row.changes, {}),
      reason: str(row.reason),
      relatedActionId: row.relatedActionId ? str(row.relatedActionId) : null,
      // V4-12
      relatedReviewResultId: row.relatedReviewResultId
        ? str(row.relatedReviewResultId)
        : null,
      status: str(row.status),
      approvals: json<ApprovalStep[]>(row.approvals, []),
      applicantUserId: str(row.applicantUserId),
      customFields: json<Record<string, unknown>>(row.customFields, {}),
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
    };
  }

  /** An adjustment; with scopes, one outside the action's grant is not found. */
  async function adjustmentRow(id: string, scopes?: PayrollScopes) {
    const row = await database
      .query()
      .selectFrom('salaryAdjustments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (
      !row ||
      (scopes && !(await scopes.rows('salaryAdjustments', [row])).length)
    )
      throw new HrError('ADJUSTMENT_NOT_FOUND', 404);
    return row as Record<string, unknown>;
  }

  /** An employee; with scopes, one outside the action's employee scope is not found. */
  async function employeeOrThrow(
    employeeId: string,
    scopes?: PayrollScopes,
  ): Promise<PayrollEmployee> {
    const employees = await loadEmployees(database.query());
    const employee = employees.find((e) => e.id === employeeId);
    if (!employee || (scopes && !(await scopes.employee(employee.id))))
      throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    return employee;
  }

  /** Whether a base salary is outside the structure's range for the employee's position or grade. */
  async function rangeCheck(
    employee: PayrollEmployee,
    structureId: string,
    baseSalary: number,
  ) {
    const structure = await structures.get(structureId);
    const position = employee.positionId
      ? await database
          .query()
          .selectFrom('positions')
          .select(['grade'])
          .where('id', '=', employee.positionId)
          .executeTakeFirst()
      : undefined;
    const range =
      structure.payRanges.find(
        (r) => r.positionId && r.positionId === employee.positionId,
      ) ??
      structure.payRanges.find(
        (r) => r.grade && position?.grade && r.grade === str(position.grade),
      );
    if (!range) return null;
    return {
      min: range.min,
      max: range.max,
      outOfRange: baseSalary < range.min || baseSalary > range.max,
    };
  }

  async function notifyApprovers(
    adjustment: ReturnType<typeof presentAdjustment>,
    steps: ApprovalStep[],
    employeeName: string,
  ) {
    const pending = steps.find((s) => s.status === 'pending');
    if (!pending) return;
    const holders = (await ctx.holdersOf(pending.permissionSet)).filter(
      (id) => id !== adjustment.applicantUserId,
    );
    await platform.notify({
      key: `salaryAdjustment:${adjustment.id}:level:${pending.level}`,
      userIds: holders,
      message: 'payrollAdjustmentPending',
      params: { name: employeeName, month: adjustment.effectiveMonth },
      path: `/talent/salaries?tab=adjustments&adjustment=${adjustment.id}`,
    });
  }

  const service = {
    history,
    presentAdjustment,

    /** The list page: every employee with the current file, structure and latest adjustment, and the 待建档 list. */
    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'view'),
      );
      const month =
        query.month && MONTH.test(query.month)
          ? query.month
          : platform.currentDate().slice(0, 7);
      const employees = [];
      for (const e of await loadEmployees(database.query()))
        if (
          (e.status !== 'leave' ||
            (e.leaveDate ?? '') >= `${addMonths(month, -1)}-01`) &&
          (await scopes.employee(e.id))
        )
          employees.push(e);
      const files = await filesForMonth(ctx, addMonths(month, 24), scopes);
      const current = await filesForMonth(ctx, month, scopes);
      const structureTitles = new Map(
        (await structures.list()).map((s) => [s.id, s.title]),
      );
      const adjustments = await scopes.rows(
        'salaryAdjustments',
        await database
          .query()
          .selectFrom('salaryAdjustments')
          .selectAll()
          .orderBy('createdAt', 'desc')
          .execute(),
      );
      const latestAdjustment = new Map<string, Record<string, unknown>>();
      for (const row of adjustments)
        if (!latestAdjustment.has(str(row.employeeId)))
          latestAdjustment.set(str(row.employeeId), row);
      const search = (query.search ?? '').trim();
      const rows = [];
      for (const employee of employees) {
        if (
          search &&
          !employee.name.includes(search) &&
          !employee.employeeNo.includes(search)
        )
          continue;
        if (query.departmentId && employee.departmentId !== query.departmentId)
          continue;
        const file = current.get(employee.id) ?? files.get(employee.id) ?? null;
        const adjustment = latestAdjustment.get(employee.id);
        rows.push({
          employeeId: employee.id,
          employeeNo: employee.employeeNo,
          name: employee.name,
          departmentId: employee.departmentId,
          departmentTitle: await ctx.departmentTitle(employee.departmentId),
          status: employee.status,
          hireDate: employee.hireDate,
          baseSalary: file ? file.baseSalary : null,
          fixedAllowances: file?.fixedAllowances ?? [],
          effectiveMonth: file?.effectiveMonth ?? null,
          salaryStructureId: file?.salaryStructureId ?? null,
          structureTitle: file
            ? (structureTitles.get(file.salaryStructureId) ?? null)
            : null,
          bankAccount: file?.bankAccount?.accountNo
            ? maskAccount(file.bankAccount.accountNo)
            : null,
          lastAdjustment: adjustment
            ? {
                id: str(adjustment.id),
                status: str(adjustment.status),
                effectiveMonth: str(adjustment.effectiveMonth),
              }
            : null,
        });
      }
      // 待建档: on the books (hired, not left) but without any salary file.
      const pendingFiles = employees
        .filter((e) => e.status !== 'leave' && !files.has(e.id))
        .map((e) => ({
          employeeId: e.id,
          employeeNo: e.employeeNo,
          name: e.name,
          departmentId: e.departmentId,
          hireDate: e.hireDate,
        }));
      return {
        month,
        rows,
        pendingFiles,
        can: {
          manage: Boolean(
            await tryAuthorizeAction(actor.authz, SALARY, 'manage'),
          ),
          adjust: Boolean(
            await tryAuthorizeAction(actor.authz, SALARY, 'adjust'),
          ),
        },
      };
    },

    async detail(actor: ActorContext, employeeId: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'view'),
      );
      const employee = await employeeOrThrow(employeeId, scopes);
      const adjustments = await scopedAdjustments(
        scopes,
        await database
          .query()
          .selectFrom('salaryAdjustments')
          .selectAll()
          .where('employeeId', '=', employeeId)
          .orderBy('createdAt', 'desc')
          .execute(),
      );
      return {
        employee: {
          id: employee.id,
          employeeNo: employee.employeeNo,
          name: employee.name,
          departmentId: employee.departmentId,
          departmentTitle: await ctx.departmentTitle(employee.departmentId),
          positionId: employee.positionId,
          hireDate: employee.hireDate,
        },
        files: await history(employeeId, scopes),
        adjustments,
        defaultStructureId: await structures.defaultFor(employeeId),
      };
    },

    /** 新入职建档 or 初始化导入: a new row, never an edit. */
    async createFile(actor: ActorContext, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'manage'),
      );
      const parsed = fileSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      const data = parsed.data;
      const employee = await employeeOrThrow(data.employeeId, scopes);
      const structureId =
        data.salaryStructureId ?? (await structures.defaultFor(employee.id));
      if (!structureId) throw new HrError('SALARY_STRUCTURE_REQUIRED', 400);
      await structures.get(structureId);
      const exists = await database
        .query()
        .selectFrom('employeeSalaries')
        .select(['id'])
        .where('employeeId', '=', employee.id)
        .where('effectiveMonth', '=', data.effectiveMonth)
        .executeTakeFirst();
      if (exists) throw new HrError('SALARY_MONTH_TAKEN', 409);
      const now = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('employeeSalaries')
        .values({
          id,
          employeeId: employee.id,
          effectiveMonth: data.effectiveMonth,
          baseSalary: data.baseSalary,
          fixedAllowances: data.fixedAllowances,
          salaryStructureId: structureId,
          bankAccount: data.bankAccount ?? null,
          source: data.source,
          adjustmentId: null,
          // V4-12
          bonusBase: data.bonusBase ?? null,
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      // The 待建档 to-do is done.
      await database
        .query()
        .updateTable('workItems')
        .set({ status: 'done', doneAt: now, updatedAt: now })
        .where('refId', 'like', `payrollOnboard:%:${employee.id}`)
        .where('status', '=', 'open')
        .execute()
        .catch(() => undefined);
      return (await history(employee.id)).find((f) => f.id === id)!;
    },

    async listAdjustments(
      actor: ActorContext,
      query: Record<string, string | undefined>,
    ) {
      const canView = await tryAuthorizeAction(actor.authz, SALARY, 'view');
      const canApprove = await tryAuthorizeAction(
        actor.authz,
        SALARY,
        'approveAdjustment',
      );
      if (!canView && !canApprove) throw new HrError('FORBIDDEN', 403);
      let select = database
        .query()
        .selectFrom('salaryAdjustments')
        .selectAll()
        .orderBy('createdAt', 'desc');
      if (query.status) select = select.where('status', '=', query.status);
      // The rows the caller's grant reaches: the view grant's, else the approver's.
      const rows = await scopedAdjustments(
        payrollScopes(database, (canView ?? canApprove)!),
        await select.limit(500).execute(),
      );
      const holders = new Map<string, string[]>();
      const holdersOf = async (permissionSet: string) => {
        if (!holders.has(permissionSet))
          holders.set(permissionSet, await ctx.holdersOf(permissionSet));
        return holders.get(permissionSet)!;
      };
      // An approver without the view action sees only what waits for their own
      // step (they hold the pending step's permission set), or what they decided.
      const visible = [];
      for (const row of rows) {
        if (canView) {
          visible.push(row);
          continue;
        }
        const pending = row.approvals.find((step) => step.status === 'pending');
        if (
          row.approvals.some((step) => step.decidedBy === actor.userId) ||
          (row.status === 'pending' &&
            pending &&
            (await holdersOf(pending.permissionSet)).includes(actor.userId))
        )
          visible.push(row);
      }
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.id, e]),
      );
      // V4-12: an approver sees the linked review result as "周期名称 · 最终等级" only.
      const reviewLabels = ctx.performance
        ? await ctx
            .performance()
            .labelsFor(
              visible
                .map((row) => row.relatedReviewResultId)
                .filter((id): id is string => Boolean(id)),
            )
        : new Map<string, { cycleTitle: string; finalRating: string | null }>();
      const result = [];
      for (const row of visible) {
        const pending = row.approvals.find((step) => step.status === 'pending');
        if (pending) await holdersOf(pending.permissionSet);
        const employee = employees.get(row.employeeId);
        result.push({
          ...row,
          employeeName: employee?.name ?? '',
          employeeNo: employee?.employeeNo ?? '',
          reviewResult: row.relatedReviewResultId
            ? (reviewLabels.get(row.relatedReviewResultId) ?? null)
            : null,
          canDecide: Boolean(
            pending &&
            row.applicantUserId !== actor.userId &&
            holders.get(pending.permissionSet)?.includes(actor.userId) &&
            canApprove,
          ),
        });
      }
      return result;
    },

    /** Pre-fills an adjustment from a transfer or promotion (变动影响清单 / 通知 → 发起调薪). */
    async prefill(actor: ActorContext, actionId: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'adjust'),
      );
      const action = await database
        .query()
        .selectFrom('personnelActions')
        .select([
          'id',
          'employeeId',
          'actionType',
          'effectiveDate',
          'toPositionId',
          'toDepartmentId',
        ])
        .where('id', '=', actionId)
        .executeTakeFirst();
      if (!action?.employeeId || !(await scopes.employee(action.employeeId)))
        throw new HrError('NOT_FOUND', 404);
      const employeeId = str(action.employeeId);
      const effectiveDate = str(action.effectiveDate).slice(0, 10);
      const files = await history(employeeId, scopes);
      const current = files[0] ?? null;
      return {
        employeeId,
        relatedActionId: str(action.id),
        actionType: str(action.actionType),
        effectiveMonth: effectiveDate.slice(0, 7),
        current,
        suggestedStructureId: await structures.defaultFor(employeeId),
      };
    },

    async requestAdjustment(actor: ActorContext, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'adjust'),
      );
      const parsed = adjustmentSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      const data = parsed.data;
      const employee = await employeeOrThrow(data.employeeId, scopes);
      if (
        !employedIn(employee, data.effectiveMonth) &&
        employee.status === 'leave'
      )
        throw new HrError('EMPLOYEE_NOT_ACTIVE', 400);
      await structures.get(data.salaryStructureId);
      const files = await history(employee.id, scopes);
      const current =
        files.find((f) => f.effectiveMonth <= data.effectiveMonth) ??
        files[0] ??
        null;
      if (!current) throw new HrError('SALARY_FILE_REQUIRED', 400);
      if (files.some((f) => f.effectiveMonth === data.effectiveMonth))
        throw new HrError('SALARY_MONTH_TAKEN', 409);
      if (data.relatedActionId) {
        const action = await database
          .query()
          .selectFrom('personnelActions')
          .select(['employeeId'])
          .where('id', '=', data.relatedActionId)
          .executeTakeFirst();
        if (!action || str(action.employeeId) !== employee.id)
          throw new HrError('ADJUSTMENT_ACTION_INVALID', 400);
      }
      // V4-12: only a published review result of this employee may be cited.
      if (data.relatedReviewResultId) {
        if (!ctx.performance) throw new HrError('ADJUSTMENT_REVIEW_RESULT_INVALID', 400);
        await ctx.performance().resultForAdjustment(data.relatedReviewResultId, employee.id);
      }
      const range = await rangeCheck(
        employee,
        data.salaryStructureId,
        data.baseSalary,
      );
      const changes = {
        before: {
          baseSalary: current.baseSalary,
          fixedAllowances: current.fixedAllowances,
          salaryStructureId: current.salaryStructureId,
          // V4-12
          bonusBase: current.bonusBase,
        },
        after: {
          baseSalary: data.baseSalary,
          fixedAllowances: data.fixedAllowances,
          salaryStructureId: data.salaryStructureId,
          // V4-12: unchanged unless given.
          bonusBase:
            data.bonusBase === undefined ? current.bonusBase : data.bonusBase,
        },
        payRange: range,
      };
      const steps = data.submit ? await approvalSteps(ctx) : [];
      const now = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('salaryAdjustments')
        .values({
          id,
          employeeId: employee.id,
          effectiveMonth: data.effectiveMonth,
          changes,
          reason: data.reason,
          relatedActionId: data.relatedActionId ?? null,
          // V4-12
          relatedReviewResultId: data.relatedReviewResultId ?? null,
          status: data.submit ? 'pending' : 'draft',
          approvals: steps,
          applicantUserId: actor.userId,
          customFields: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      const view = presentAdjustment(await adjustmentRow(id));
      if (data.submit) await notifyApprovers(view, steps, employee.name);
      return view;
    },

    async submitAdjustment(actor: ActorContext, id: string) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'adjust'),
      );
      const row = presentAdjustment(await adjustmentRow(id, scopes));
      if (row.status !== 'draft')
        throw new HrError('ADJUSTMENT_STATE_CONFLICT', 409);
      const steps = await approvalSteps(ctx);
      await database
        .query()
        .updateTable('salaryAdjustments')
        .set({ status: 'pending', approvals: steps, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      const view = presentAdjustment(await adjustmentRow(id));
      const employee = await employeeOrThrow(view.employeeId);
      await notifyApprovers(view, steps, employee.name);
      return view;
    },

    async decideAdjustment(actor: ActorContext, id: string, input: unknown) {
      const scopes = payrollScopes(
        database,
        await authorizeAction(actor.authz, SALARY, 'approveAdjustment'),
      );
      const parsed = decisionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const row = presentAdjustment(await adjustmentRow(id, scopes));
      if (row.status !== 'pending')
        throw new HrError('PAYROLL_NOT_PENDING', 409);
      const { steps, outcome } = await decideStep(
        ctx,
        actor,
        row.approvals,
        row.applicantUserId,
        parsed.data,
      );
      const employee = await employeeOrThrow(row.employeeId);
      const now = new Date();
      if (outcome === 'approved') {
        const after = (row.changes.after ?? {}) as {
          baseSalary: number;
          fixedAllowances: { code: string; amount: number }[];
          salaryStructureId: string;
          bonusBase?: number | null;
        };
        const files = await history(employee.id);
        if (files.some((f) => f.effectiveMonth === row.effectiveMonth))
          throw new HrError('SALARY_MONTH_TAKEN', 409);
        // The bank account carries over from the file in force.
        const previous =
          files.find((f) => f.effectiveMonth <= row.effectiveMonth) ?? files[0];
        await database.transaction(async (connection) => {
          await connection.query
            .updateTable('salaryAdjustments')
            .set({ status: 'approved', approvals: steps, updatedAt: now })
            .where('id', '=', id)
            .execute();
          await connection.query
            .insertInto('employeeSalaries')
            .values({
              id: newId(),
              employeeId: employee.id,
              effectiveMonth: row.effectiveMonth,
              baseSalary: after.baseSalary,
              fixedAllowances: after.fixedAllowances ?? [],
              salaryStructureId: after.salaryStructureId,
              bankAccount: previous?.bankAccount ?? null,
              source: 'adjustment',
              adjustmentId: id,
              // V4-12: the bonus base carries over unless the adjustment changed it.
              bonusBase:
                after.bonusBase === undefined
                  ? (previous?.bonusBase ?? null)
                  : after.bonusBase,
              createdBy: actor.userId,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        });
      } else
        await database
          .query()
          .updateTable('salaryAdjustments')
          .set({
            status: outcome === 'rejected' ? 'rejected' : 'pending',
            approvals: steps,
            updatedAt: now,
          })
          .where('id', '=', id)
          .execute();
      const view = presentAdjustment(await adjustmentRow(id));
      if (outcome === 'pending')
        await notifyApprovers(view, steps, employee.name);
      else {
        await platform.notify({
          key: `salaryAdjustment:${id}:${outcome}`,
          userIds: [row.applicantUserId],
          message:
            outcome === 'approved'
              ? 'payrollAdjustmentApproved'
              : 'payrollAdjustmentRejected',
          params: { name: employee.name, month: row.effectiveMonth },
          path: `/talent/salaries/${employee.id}`,
        });
        if (row.relatedActionId) ctx.onAdjustmentDecided(row.relatedActionId);
      }
      // The approver's to-do is done either way.
      await database
        .query()
        .updateTable('workItems')
        .set({ status: 'done', doneAt: now, updatedAt: now })
        .where('refId', 'like', `salaryAdjustment:${id}:level:%`)
        .where('status', '=', 'open')
        .execute()
        .catch(() => undefined);
      return view;
    },

    /** Whether an action's employee has had their salary handled (an approved adjustment related to it). */
    async handledForAction(actionId: string): Promise<boolean> {
      const row = await database
        .query()
        .selectFrom('salaryAdjustments')
        .select(['id'])
        .where('relatedActionId', '=', actionId)
        .where('status', '=', 'approved')
        .executeTakeFirst();
      return Boolean(row);
    },
  };
  return service;
}

export type SalaryService = ReturnType<typeof createSalaryService>;

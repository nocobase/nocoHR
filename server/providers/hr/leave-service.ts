import type { DatabaseManager, DatabaseConnection } from '@nocobase/db';
import { z } from 'zod';
import type { ActorContext } from './framework-service.js';
import {
  authorizeAction,
  policyOf,
  type CollectionPolicies,
} from './authorize.js';
import { HrError, newId, str } from './shared.js';
import { lockAttendanceSettings } from './attendance-settings.js';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
} from './attendance-config.js';
import { calculateAnnualLeave } from './annual-leave.js';
import {
  balanceAdjustmentSchema,
  leaveBalanceAmounts,
  leaveTypeSchema,
  readAdjustmentHistory,
} from './leave-policy.js';

const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new HrError('INVALID_INPUT', 400, {
      fields: result.error.issues.map((e) => e.path.join('.')),
    });
  return result.data;
};
const version = z.iso.datetime({ local: true });
const stampAfter = (value: unknown) =>
  new Date(
    Math.max(
      Date.now(),
      value == null ? 0 : new Date(str(value)).getTime() + 1,
    ),
  );

export function createLeaveService(
  database: DatabaseManager,
  currentDate: () => string,
) {
  const authorize = (
    ctx: ActorContext,
    action: 'manageTypes' | 'adjustBalance',
  ) => authorizeAction(ctx.authz, 'talent.leaveRequest', action);
  const scoped = (
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    name: string,
  ) => connection.repository(name).withPolicy(policyOf(policies, name));
  const locked = (
    ctx: ActorContext,
    fn: (connection: DatabaseConnection) => Promise<unknown>,
  ) =>
    database.transaction(async (connection) => {
      // One shared lock across catalog, balances and future request mutations: never split a balance read/modify/write.
      await lockAttendanceSettings(connection, ctx.userId);
      return fn(connection);
    });
  const balanceView = async (
    policies: CollectionPolicies,
    row: Record<string, unknown>,
  ) => {
    const employee = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id: str(row.employeeId) } });
    const type = await database
      .repository('leaveTypes')
      .withPolicy(policyOf(policies, 'leaveTypes'))
      .findOne({ filter: { id: str(row.leaveTypeId) } });
    if (!employee || !type) throw new HrError('NOT_FOUND', 404);
    return {
      ...row,
      ...leaveBalanceAmounts(
        {
          entitled: row.entitled,
          carriedOver: row.carriedOver,
          used: row.used,
          pending: row.pending,
          expiresAt: row.expiresAt,
          adjustments: row.adjustments,
        },
        currentDate(),
      ),
      employeeName: str(employee.name),
      employeeNo: str(employee.employeeNo),
      leaveTypeTitle: str(type.title),
      needsCareerStartDate: !employee.careerStartDate,
      frozen: employee.status === 'leave',
    };
  };
  return {
    async getType(ctx: ActorContext, id: string) {
      const policies = await authorize(ctx, 'manageTypes');
      const row = await database
        .repository('leaveTypes')
        .withPolicy(policyOf(policies, 'leaveTypes'))
        .findOne({ filter: { id } });
      if (!row) throw new HrError('NOT_FOUND', 404);
      return row;
    },
    async getBalance(ctx: ActorContext, id: string) {
      const policies = await authorize(ctx, 'adjustBalance');
      const row = await database
        .repository('leaveBalances')
        .withPolicy(policyOf(policies, 'leaveBalances'))
        .findOne({ filter: { id } });
      if (!row) throw new HrError('NOT_FOUND', 404);
      return balanceView(policies, row);
    },
    async listTypes(ctx: ActorContext) {
      const policies = await authorize(ctx, 'manageTypes');
      const rows = await database
        .repository('leaveTypes')
        .withPolicy(policyOf(policies, 'leaveTypes'))
        .findMany({ sort: (s) => s.field('code').asc(), limit: 501 });
      return {
        data: rows.slice(0, 500),
        meta: { limit: 500, truncated: rows.length > 500 },
      };
    },
    async saveType(ctx: ActorContext, id: string | undefined, input: unknown) {
      const policies = await authorize(ctx, 'manageTypes');
      const body = parse(
        z
          .object({
            value: leaveTypeSchema,
            expectedUpdatedAt: version.optional(),
          })
          .strict(),
        input,
      );
      if (Boolean(id) !== Boolean(body.expectedUpdatedAt))
        throw new HrError('INVALID_INPUT');
      return locked(ctx, async (connection) => {
        const repo = scoped(connection, policies, 'leaveTypes');
        const previous = id ? await repo.findOne({ filter: { id } }) : null;
        if (id && !previous) throw new HrError('NOT_FOUND', 404);
        if (previous && str(previous.updatedAt) !== body.expectedUpdatedAt)
          throw new HrError('SETTINGS_CONFLICT', 409);
        const duplicate = await repo.findOne({
          filter: { code: body.value.code },
        });
        if (duplicate && duplicate.id !== id)
          throw new HrError('LEAVE_TYPE_CODE_CONFLICT', 409);
        if (
          previous &&
          ((await scoped(connection, policies, 'leaveBalances').exists({
            filter: { leaveTypeId: id },
          })) ||
            (await scoped(connection, policies, 'leaveRequests').exists({
              filter: { leaveTypeId: id },
            })))
        ) {
          // Preserve historical accounting; names and availability can still change.
          const fields = [
            'code',
            'payType',
            'unit',
            'balanceRule',
            'fixedDays',
            'requiresAttachment',
            'countBy',
          ] as const;
          if (
            fields.some((field) =>
              field === 'fixedDays'
                ? (previous[field] == null ? null : Number(previous[field])) !==
                  body.value[field]
                : previous[field] !== body.value[field],
            )
          )
            throw new HrError('LEAVE_TYPE_IN_USE', 409);
        }
        const stamp = stampAfter(previous?.updatedAt);
        const result = previous
          ? await repo.updateOne({
              filter: { id },
              values: { ...body.value, updatedAt: stamp },
            })
          : await repo.createOne({
              values: {
                id: newId(),
                ...body.value,
                createdAt: stamp,
                updatedAt: stamp,
              },
            });
        return result.record;
      });
    },
    async listBalances(ctx: ActorContext, input: unknown) {
      const policies = await authorize(ctx, 'adjustBalance');
      const query = parse(
        z
          .object({
            year: z.coerce.number().int().min(1900).max(2200),
            employeeId: z.string().min(1).max(64).optional(),
          })
          .strict(),
        input,
      );
      const rows = await database
        .repository('leaveBalances')
        .withPolicy(policyOf(policies, 'leaveBalances'))
        .findMany({
          filter: query,
          sort: (s) => s.field('id').asc(),
          limit: 501,
        });
      return {
        data: await Promise.all(
          rows.slice(0, 500).map((row) => balanceView(policies, row)),
        ),
        meta: { limit: 500, truncated: rows.length > 500 },
      };
    },
    async initialize(ctx: ActorContext, input: unknown) {
      const policies = await authorize(ctx, 'adjustBalance');
      const body = parse(
        z
          .object({
            year: z.number().int().min(1900).max(2200),
            asOf: z.iso.date(),
            employeeIds: z
              .array(z.string().min(1).max(64))
              .min(1)
              .max(500)
              .refine((ids) => new Set(ids).size === ids.length)
              .optional(),
          })
          .strict()
          .refine((v) => Number(v.asOf.slice(0, 4)) === v.year),
        input,
      );
      if (body.asOf > currentDate()) throw new HrError('FUTURE_INITIALIZATION');
      return locked(ctx, async (connection) => {
        const employees = await scoped(
          connection,
          policies,
          'employees',
        ).findMany({
          filter: body.employeeIds
            ? (f) => f.or(body.employeeIds!.map((id) => f.string('id').eq(id)))
            : undefined,
          limit: 501,
        });
        if (employees.length > 500) throw new HrError('SCOPE_TOO_LARGE');
        if (body.employeeIds && employees.length !== body.employeeIds.length)
          throw new HrError('NOT_FOUND', 404);
        const types = await scoped(connection, policies, 'leaveTypes').findMany(
          { filter: { active: true }, limit: 501 },
        );
        if (types.length > 500) throw new HrError('SCOPE_TOO_LARGE');
        const config = await scoped(
          connection,
          policies,
          'personnelSettings',
        ).findOne({ filter: { id: 'attendance.annualLeave' } });
        const bands = attendanceConfigSchemas.annualLeave.parse(
          config?.value ?? attendanceConfigDefaults.annualLeave,
        ).bands;
        const balances = scoped(connection, policies, 'leaveBalances');
        const created: string[] = [];
        const skipped: string[] = [];
        const needsCareerStartDate: string[] = [];
        for (const employee of employees) {
          if (
            !['active', 'probation'].includes(str(employee.status)) ||
            !employee.hireDate ||
            str(employee.hireDate) > body.asOf
          ) {
            skipped.push(str(employee.id));
            continue;
          }
          if (!employee.careerStartDate)
            needsCareerStartDate.push(str(employee.id));
          for (const type of types) {
            if (
              type.balanceRule !== 'annualBySeniority' &&
              type.balanceRule !== 'earned'
            )
              continue;
            const key = {
              employeeId: str(employee.id),
              leaveTypeId: str(type.id),
              year: body.year,
            };
            if (await balances.exists({ filter: key })) continue;
            let entitled = 0;
            if (type.balanceRule === 'annualBySeniority') {
              try {
                entitled = calculateAnnualLeave({
                  asOf: body.asOf,
                  hireDate: str(employee.hireDate),
                  careerStartDate: employee.careerStartDate
                    ? str(employee.careerStartDate)
                    : null,
                  bands,
                }).entitled;
              } catch (error) {
                if (error instanceof Error && error.message === 'INVALID_INPUT')
                  throw new HrError('INVALID_EMPLOYEE_DATES', 409, {
                    employeeId: str(employee.id),
                  });
                throw error;
              }
            }
            const stamp = new Date();
            const result = await balances.createOne({
              values: {
                id: newId(),
                ...key,
                entitled,
                carriedOver: 0,
                used: 0,
                pending: 0,
                expiresAt: null,
                adjustments: [],
                createdAt: stamp,
                updatedAt: stamp,
              },
            });
            created.push(str(result.record.id));
          }
        }
        return { created, skippedEmployeeIds: skipped, needsCareerStartDate };
      });
    },
    async adjust(ctx: ActorContext, id: string, input: unknown) {
      const policies = await authorize(ctx, 'adjustBalance');
      const body = parse(balanceAdjustmentSchema, input);
      return locked(ctx, async (connection) => {
        const balances = scoped(connection, policies, 'leaveBalances');
        const balance = await balances.findOne({ filter: { id } });
        if (!balance) throw new HrError('NOT_FOUND', 404);
        const employee = await scoped(
          connection,
          policies,
          'employees',
        ).findOne({ filter: { id: str(balance.employeeId) } });
        if (!employee) throw new HrError('NOT_FOUND', 404);
        const history = readAdjustmentHistory(balance.adjustments);
        const prior = history.find(
          (entry) => entry.idempotencyKey === body.idempotencyKey,
        );
        if (prior) {
          if (
            prior.by !== ctx.userId ||
            prior.delta !== body.delta ||
            prior.reason !== body.reason
          )
            throw new HrError('IDEMPOTENCY_CONFLICT', 409);
          return {
            ...balance,
            ...leaveBalanceAmounts(
              {
                entitled: balance.entitled,
                carriedOver: balance.carriedOver,
                used: balance.used,
                pending: balance.pending,
                expiresAt: balance.expiresAt,
                adjustments: balance.adjustments,
              },
              currentDate(),
            ),
            replayed: true,
          };
        }
        if (employee.status === 'leave')
          throw new HrError('BALANCE_FROZEN', 409);
        if (str(balance.updatedAt) !== body.expectedUpdatedAt)
          throw new HrError('SETTINGS_CONFLICT', 409);
        if (history.length >= 1000)
          throw new HrError('ADJUSTMENT_HISTORY_FULL', 409);
        const adjusted = [
          ...history,
          {
            idempotencyKey: body.idempotencyKey,
            delta: body.delta,
            reason: body.reason,
            by: ctx.userId,
            at: new Date().toISOString(),
          },
        ];
        const amounts = leaveBalanceAmounts(
          {
            entitled: balance.entitled,
            carriedOver: balance.carriedOver,
            used: balance.used,
            pending: balance.pending,
            expiresAt: balance.expiresAt,
            adjustments: adjusted,
          },
          currentDate(),
        );
        if (amounts.available < 0)
          throw new HrError('INSUFFICIENT_LEAVE_BALANCE', 409);
        const result = await balances.updateOne({
          filter: { id },
          values: {
            adjustments: adjusted,
            updatedAt: stampAfter(balance.updatedAt),
          },
        });
        return { ...result.record, ...amounts, replayed: false };
      });
    },
  };
}
export type LeaveService = ReturnType<typeof createLeaveService>;

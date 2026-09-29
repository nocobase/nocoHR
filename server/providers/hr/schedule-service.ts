import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import { z } from 'zod';
import type { ActorContext } from './framework-service.js';
import {
  authorizeAction,
  policyOf,
  type CollectionPolicies,
} from './authorize.js';
import { HrError, newId, str } from './shared.js';
import { schedulePreflight } from './schedule-preflight.js';
import type { OrganizationService } from './organization-service.js';

const date = z.iso.date();
const request = z.object({
  departmentId: z.string().min(1).max(64),
  from: date,
  to: date,
  q: z.string().trim().max(100).optional(),
});
const cell = z
  .object({
    employeeId: z.string().min(1).max(64),
    date,
    shiftId: z.string().max(64).nullable(),
  })
  .strict();
const mutation = z
  .object({
    cells: z.array(cell).min(1).max(2000),
    acknowledgeWarnings: z.boolean().default(false),
  })
  .strict();

type Cell = z.infer<typeof cell> & {
  id?: string;
  status?: string;
  checkResult?: unknown;
};

function requireVerifiedScheduleWrites() {
  // Read-only preflight now covers the documented deterministic constraints.
  // Monthly overtime forecasting, write-version checks and publication
  // notifications still require completion before any persisted scheduling.
  // Preserve the implementation, but no caller (including HR) may execute it.
  throw new HrError('SCHEDULE_NOT_READY', 409);
}

function days(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (end < start || (end.getTime() - start.getTime()) / 86_400_000 > 30)
    throw new HrError('INVALID_DATE_RANGE', 400);
  const out: string[] = [];
  for (
    let cursor = start;
    cursor <= end;
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  )
    out.push(cursor.toISOString().slice(0, 10));
  return out;
}

export function createScheduleService(
  database: DatabaseManager,
  context: { organization: OrganizationService; timeZone: string },
) {
  const scoped = (
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    name: string,
  ) => connection.repository(name).withPolicy(policyOf(policies, name));
  async function policy(
    ctx: ActorContext,
    action: 'view' | 'edit' | 'publish',
  ) {
    return authorizeAction(ctx.authz, 'talent.schedule', action);
  }

  async function load(
    ctx: ActorContext,
    action: 'view' | 'edit' | 'publish',
    input: unknown,
  ) {
    const policies = await policy(ctx, action);
    const result = request.safeParse(input);
    if (!result.success) throw new HrError('INVALID_INPUT', 400);
    const parsed = result.data;
    const connection = database.connection();
    const employeeRepo = scoped(connection, policies, 'employees');
    const employeeRows = await employeeRepo.findMany({
      filter: { departmentId: parsed.departmentId },
      sort: (s) => s.field('employeeNo').asc(),
      limit: 501,
    });
    const keyword = parsed.q?.toLocaleLowerCase();
    const employees = employeeRows
      .filter(
        (row) =>
          !keyword ||
          `${str(row.name)} ${str(row.employeeNo)}`
            .toLocaleLowerCase()
            .includes(keyword),
      )
      .slice(0, 500)
      .map((row) => ({
        id: str(row.id),
        employeeNo: str(row.employeeNo),
        name: str(row.name),
        status: str(row.status),
        departmentId: str(row.departmentId),
        hireDate: row.hireDate ? str(row.hireDate).slice(0, 10) : null,
        leaveDate: row.leaveDate ? str(row.leaveDate).slice(0, 10) : null,
      }));
    const dates = days(parsed.from, parsed.to);
    const schedules = employees.length
      ? await scoped(connection, policies, 'shiftSchedules').findMany({
          filter: (f) =>
            f.and([
              f.or(employees.map((row) => f.string('employeeId').eq(row.id))),
              f.date('date').between([parsed.from, parsed.to]),
            ]),
          limit: 10001,
        })
      : [];
    const shifts = await scoped(connection, policies, 'shifts').findMany({
      limit: 501,
      sort: (s) => s.field('code').asc(),
    });
    return {
      departmentId: parsed.departmentId,
      from: parsed.from,
      to: parsed.to,
      dates,
      employees,
      shifts,
      cells: schedules,
      meta: {
        employeeTruncated: employeeRows.length > 500,
        scheduleTruncated: schedules.length > 10000,
      },
    };
  }

  async function validate(
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    cells: Cell[],
  ) {
    const result = await schedulePreflight({
      connection,
      policies,
      cells,
      ...context,
    });
    return {
      ...result,
      checks: new Map(Object.entries(result.checks)),
    };
  }

  return {
    async list(ctx: ActorContext, input: unknown) {
      return load(ctx, 'view', input);
    },
    async validate(ctx: ActorContext, input: unknown) {
      const policies = await policy(ctx, 'edit');
      const parsed = mutation.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      return database.transaction(async (connection) => {
        return schedulePreflight({
          connection,
          policies,
          cells: parsed.data.cells,
          ...context,
        });
      });
    },
    async save(ctx: ActorContext, input: unknown, publish: boolean) {
      const policies = await policy(ctx, publish ? 'publish' : 'edit');
      requireVerifiedScheduleWrites();
      const body = mutation.parse(input);
      return database.transaction(async (connection) => {
        const result = await validate(connection, policies, body.cells);
        if (!result.writesReady)
          throw new HrError('SCHEDULE_NOT_READY', 409, {
            pendingRules: result.pendingRules,
          });
        if (result.hasBlock || (result.hasWarn && !body.acknowledgeWarnings))
          throw new HrError(
            result.hasBlock
              ? 'SCHEDULE_BLOCKED'
              : 'SCHEDULE_WARNING_CONFIRMATION',
            409,
            { checks: Object.fromEntries(result.checks) },
          );
        const repo = scoped(connection, policies, 'shiftSchedules');
        const now = new Date();
        for (const item of body.cells) {
          const existing = await repo.findOne({
            filter: { employeeId: item.employeeId, date: item.date },
          });
          const values = {
            shiftId: item.shiftId,
            status: publish ? 'published' : (existing?.status ?? 'draft'),
            checkResult:
              result.checks.get(`${item.employeeId}:${item.date}`) ?? null,
            ...(publish ? { publishedBy: ctx.userId, publishedAt: now } : {}),
            updatedAt: now,
          };
          if (existing)
            await repo.updateOne({ filter: { id: str(existing.id) }, values });
          else
            await repo.createOne({
              values: {
                id: newId(),
                employeeId: item.employeeId,
                date: item.date,
                createdAt: now,
                ...values,
              },
            });
        }
        return {
          saved: body.cells.length,
          published: publish,
          checks: Object.fromEntries(result.checks),
        };
      });
    },
  };
}

export type ScheduleService = ReturnType<typeof createScheduleService>;

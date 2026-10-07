/**
 * 上线准备 · 状态: each go-live step's status computed from live counts of the
 * business tables, never from another step's endpoint.
 *
 * A step is 未开始 (notStarted), 进行中 (inProgress) or 已完成 (done); a step
 * HR or payroll marked as not needed is `skipped`, and 本年个税累计期初 is
 * `notNeeded` when the first payroll month is January. HR steps need
 * `talent.goLive` · view, payroll steps `talent.goLive` · viewPayroll;
 * payroll steps carry counts of people only, never an amount.
 *
 * Tables another go-live step adds (本年个税累计期初) are read only when they
 * exist, so this works before and after their migrations.
 */
import type { DatabaseManager } from '@nocobase/db';

import type { ActorContext } from '../framework-service.js';
import { tryAuthorizeAction } from '../authorize.js';
import { HrError } from '../shared.js';
import { GO_LIVE } from './resources.js';
import {
  GO_LIVE_STEPS,
  PAYROLL_STEPS,
  type GoLiveSettingsStore,
  type GoLiveStepKey,
} from './settings.js';

/** A column value as text; null and undefined are empty (`str` of shared.ts spells them out). */
const text = (value: unknown): string =>
  value == null
    ? ''
    : typeof value === 'string'
      ? value
      : value instanceof Date
        ? value.toISOString()
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value);

export type StepStatus =
  'notStarted' | 'inProgress' | 'done' | 'skipped' | 'notNeeded';

export interface GoLiveStep {
  readonly key: GoLiveStepKey;
  readonly group: 'hr' | 'payroll';
  readonly status: StepStatus;
  /** What the status was computed from (counts and booleans only). */
  readonly facts: Record<string, unknown>;
  readonly skipped: boolean;
  readonly canSkip: boolean;
}

/** What the server can say about its configuration: booleans only, never a value. */
export interface ConfigFacts {
  readonly companyName: boolean;
  readonly publicOrigin: boolean;
  readonly feishu: boolean;
  readonly ai: boolean;
}

/**
 * The 本年个税累计期初 table (payroll opening importers, migration
 * 202610270011); read only when it exists.
 */
export const TAX_OPENING_TABLE = 'payrollTaxOpenings';
/** The adjustment entries the 期初假期余额 importer writes start with this idempotency key. */
export const LEAVE_OPENING_KEY = 'opening-import:';

const coverage = (covered: number, total: number): StepStatus =>
  covered <= 0 || total <= 0
    ? 'notStarted'
    : covered >= total
      ? 'done'
      : 'inProgress';

export function createGoLiveStatus(deps: {
  database: DatabaseManager;
  settings: GoLiveSettingsStore;
  config: () => ConfigFacts;
  mailConfigured: () => Promise<boolean>;
  /** Today in the application's time zone, YYYY-MM-DD. */
  currentDate: () => string;
}) {
  const { database } = deps;

  /** Rows of a table, or `undefined` when it does not exist (yet). */
  async function rowsIfExists(
    table: string,
    columns: readonly string[],
  ): Promise<Record<string, unknown>[] | undefined> {
    try {
      return await database
        .query()
        .selectFrom(table as never)
        .select(columns as never)
        .execute();
    } catch {
      return undefined;
    }
  }

  async function permissions(ctx: ActorContext) {
    const [view, viewPayroll, skip, skipPayroll] = await Promise.all(
      (['view', 'viewPayroll', 'skip', 'skipPayroll'] as const).map(
        async (action) =>
          (await tryAuthorizeAction(ctx.authz, GO_LIVE, action)) !== undefined,
      ),
    );
    return { view, viewPayroll, skip, skipPayroll };
  }

  async function firstPayrollMonth(configured: string): Promise<string> {
    if (configured) return configured;
    const first = await database
      .query()
      .selectFrom('payrollCycles')
      .select(['month'])
      .orderBy('month', 'asc')
      .executeTakeFirst();
    return first ? text(first.month) : deps.currentDate().slice(0, 7);
  }

  /** The facts of one step; only called for steps the caller may see. */
  async function facts(
    key: GoLiveStepKey,
    shared: {
      active: Set<string>;
      year: number;
      payrollMonth: string;
    },
  ): Promise<{ status: StepStatus; facts: Record<string, unknown> }> {
    const { active } = shared;
    const activeCount = active.size;
    const distinctActive = (rows: Record<string, unknown>[]) =>
      new Set(
        rows.map((r) => text(r.employeeId)).filter((id) => active.has(id)),
      ).size;
    switch (key) {
      case 'config': {
        const config = deps.config();
        const mail = await deps.mailConfigured();
        const required = [config.companyName, config.publicOrigin];
        return {
          status: required.every(Boolean)
            ? 'done'
            : required.some(Boolean) || mail || config.feishu || config.ai
              ? 'inProgress'
              : 'notStarted',
          facts: { ...config, mail },
        };
      }
      case 'departments': {
        const departments = await database
          .query()
          .selectFrom('departments')
          .select(['id'])
          .execute();
        const run = await database
          .query()
          .selectFrom('orgSyncRuns')
          .select(['provider', 'status', 'startedAt', 'finishedAt'])
          .orderBy('startedAt', 'desc')
          .executeTakeFirst();
        return {
          status: departments.length ? 'done' : 'notStarted',
          facts: {
            count: departments.length,
            feishu: deps.config().feishu,
            lastSync: run
              ? {
                  provider: text(run.provider),
                  status: text(run.status),
                  at: run.finishedAt ?? run.startedAt ?? null,
                }
              : null,
          },
        };
      }
      case 'positions': {
        const positions = await database
          .query()
          .selectFrom('positions')
          .select(['id'])
          .execute();
        return {
          status: positions.length ? 'done' : 'notStarted',
          facts: { count: positions.length },
        };
      }
      case 'employees': {
        const batch = await database
          .query()
          .selectFrom('employeeImportBatches')
          .select(['id', 'createdCount', 'updatedCount', 'createdAt'])
          .orderBy('createdAt', 'desc')
          .executeTakeFirst();
        return {
          status: activeCount ? 'done' : 'notStarted',
          facts: {
            count: activeCount,
            lastImport: batch
              ? {
                  id: text(batch.id),
                  createdCount: Number(batch.createdCount ?? 0),
                  updatedCount: Number(batch.updatedCount ?? 0),
                  at: batch.createdAt,
                }
              : null,
          },
        };
      }
      case 'contracts': {
        const rows = await database
          .query()
          .selectFrom('employmentContracts')
          .select(['employeeId'])
          .where('status', '=', 'active')
          .execute();
        const covered = distinctActive(rows);
        return {
          status: coverage(covered, activeCount),
          facts: { covered, total: activeCount },
        };
      }
      case 'leaveOpening': {
        // A balance of this year carrying an entry of the 期初假期余额 import.
        const rows = await database
          .query()
          .selectFrom('leaveBalances')
          .select(['employeeId', 'adjustments'])
          .where('year', '=', shared.year)
          .execute();
        const covered = distinctActive(
          rows.filter((row) => {
            let value: unknown = row.adjustments;
            for (let i = 0; i < 3 && typeof value === 'string'; i++) {
              try {
                value = JSON.parse(value);
              } catch {
                return false;
              }
            }
            return (
              Array.isArray(value) &&
              value.some((entry) =>
                text(
                  (entry as { idempotencyKey?: unknown })?.idempotencyKey,
                ).startsWith(LEAVE_OPENING_KEY),
              )
            );
          }),
        );
        return {
          status: coverage(covered, activeCount),
          facts: { covered, total: activeCount, year: shared.year },
        };
      }
      case 'salaries': {
        const rows = await database
          .query()
          .selectFrom('employeeSalaries')
          .select(['employeeId'])
          .execute();
        const covered = distinctActive(rows);
        return {
          status: coverage(covered, activeCount),
          facts: { covered, total: activeCount },
        };
      }
      case 'insurance': {
        const rows = await database
          .query()
          .selectFrom('employeeSocialInsurances')
          .select(['employeeId'])
          .where('status', 'in', ['active', 'pending'])
          .execute();
        const covered = distinctActive(rows);
        return {
          status: coverage(covered, activeCount),
          facts: { covered, total: activeCount },
        };
      }
      case 'deductions': {
        // Not everyone declares special deductions: any declaration for this year completes the step.
        const rows = await database
          .query()
          .selectFrom('employeeTaxDeductions')
          .select(['employeeId'])
          .where('year', '=', shared.year)
          .execute();
        const covered = distinctActive(rows);
        return {
          status: covered ? 'done' : 'notStarted',
          facts: { covered, total: activeCount, year: shared.year },
        };
      }
      case 'taxOpening': {
        const month = shared.payrollMonth;
        if (month.endsWith('-01'))
          return {
            status: 'notNeeded',
            facts: { firstPayrollMonth: month, available: true },
          };
        const year = Number(month.slice(0, 4));
        const rows = await rowsIfExists(TAX_OPENING_TABLE, [
          'employeeId',
          'year',
        ]);
        if (!rows)
          return {
            status: 'notStarted',
            facts: { firstPayrollMonth: month, available: false },
          };
        const covered = distinctActive(
          rows.filter((r) => Number(r.year) === year),
        );
        return {
          status: coverage(covered, activeCount),
          facts: {
            covered,
            total: activeCount,
            year,
            firstPayrollMonth: month,
            available: true,
          },
        };
      }
      case 'accounts': {
        const employees = await database
          .query()
          .selectFrom('employees')
          .select(['id', 'userId'])
          .where('status', '!=', 'leave')
          .execute();
        const linked = employees.filter((e) => e.userId);
        const now = Date.now();
        const open = await database
          .query()
          .selectFrom('accountActivations')
          .select(['userId', 'expiresAt'])
          .where('usedAt', 'is', null)
          .where('revokedAt', 'is', null)
          .execute();
        const pendingUsers = new Set(
          open
            .filter((r) => new Date(String(r.expiresAt)).getTime() > now)
            .map((r) => text(r.userId)),
        );
        const pending = linked.filter((e) =>
          pendingUsers.has(text(e.userId)),
        ).length;
        const activated = linked.length - pending;
        const withoutAccount = employees.length - linked.length;
        return {
          status:
            !employees.length || !linked.length
              ? 'notStarted'
              : withoutAccount || pending
                ? 'inProgress'
                : 'done',
          facts: {
            total: employees.length,
            activated,
            pending,
            withoutAccount,
          },
        };
      }
      case 'trialPayroll': {
        const cycles = await database
          .query()
          .selectFrom('payrollCycles')
          .select(['month', 'calculatedAt'])
          .execute();
        const calculated = cycles.filter((c) => c.calculatedAt);
        return {
          status: calculated.length
            ? 'done'
            : cycles.length
              ? 'inProgress'
              : 'notStarted',
          facts: { cycles: cycles.length, calculated: calculated.length },
        };
      }
    }
  }

  return {
    async status(ctx: ActorContext) {
      const can = await permissions(ctx);
      if (!can.view && !can.viewPayroll) throw new HrError('FORBIDDEN', 403);
      const settings = await deps.settings.read('goLive');
      const skipped = new Set(settings.value.skipped);
      const employees = await database
        .query()
        .selectFrom('employees')
        .select(['id'])
        .where('status', '!=', 'leave')
        .execute();
      const payrollMonth = await firstPayrollMonth(
        settings.value.firstPayrollMonth,
      );
      const shared = {
        active: new Set(employees.map((e) => text(e.id))),
        year: Number(deps.currentDate().slice(0, 4)),
        payrollMonth,
      };
      const steps: GoLiveStep[] = [];
      for (const key of GO_LIVE_STEPS) {
        const payroll = PAYROLL_STEPS.has(key);
        if (payroll ? !can.viewPayroll : !can.view) continue;
        const computed = await facts(key, shared);
        const isSkipped = skipped.has(key) && computed.status !== 'notNeeded';
        steps.push({
          key,
          group: payroll ? 'payroll' : 'hr',
          status: isSkipped ? 'skipped' : computed.status,
          facts: computed.facts,
          skipped: isSkipped,
          canSkip: payroll ? can.skipPayroll : can.skip,
        });
      }
      return {
        steps,
        remaining: steps.filter(
          (s) => s.status === 'notStarted' || s.status === 'inProgress',
        ).length,
        firstPayrollMonth: payrollMonth,
        firstPayrollMonthConfigured: settings.value.firstPayrollMonth,
        revision: settings.revision,
        can: {
          setFirstPayrollMonth: can.skipPayroll || can.skip,
        },
      };
    },

    /** Marks a step as not needed, or needed again. */
    async setSkipped(ctx: ActorContext, key: string, skipped: unknown) {
      if (!(GO_LIVE_STEPS as readonly string[]).includes(key))
        throw new HrError('NOT_FOUND', 404);
      if (typeof skipped !== 'boolean') throw new HrError('INVALID_INPUT', 400);
      const step = key as GoLiveStepKey;
      const action = PAYROLL_STEPS.has(step) ? 'skipPayroll' : 'skip';
      if (!(await tryAuthorizeAction(ctx.authz, GO_LIVE, action)))
        throw new HrError('FORBIDDEN', 403);
      // Retried on a concurrent change: the edit is a set operation on the stored list.
      for (let attempt = 0; ; attempt++) {
        const current = await deps.settings.read('goLive');
        const next = new Set(current.value.skipped);
        if (skipped) next.add(step);
        else next.delete(step);
        try {
          return await deps.settings.write(
            'goLive',
            current.revision,
            {
              ...current.value,
              skipped: GO_LIVE_STEPS.filter((k) => next.has(k)),
            },
            ctx.userId,
          );
        } catch (error) {
          if (
            attempt < 3 &&
            error instanceof HrError &&
            error.code === 'SETTINGS_CONFLICT'
          )
            continue;
          throw error;
        }
      }
    },

    async setFirstPayrollMonth(ctx: ActorContext, input: unknown) {
      const allowed =
        (await tryAuthorizeAction(ctx.authz, GO_LIVE, 'skipPayroll')) ||
        (await tryAuthorizeAction(ctx.authz, GO_LIVE, 'skip'));
      if (!allowed) throw new HrError('FORBIDDEN', 403);
      const body = (input ?? {}) as {
        revision?: unknown;
        firstPayrollMonth?: unknown;
      };
      if (typeof body.revision !== 'number')
        throw new HrError('INVALID_INPUT', 400);
      const current = await deps.settings.read('goLive');
      return deps.settings.write(
        'goLive',
        body.revision,
        { ...current.value, firstPayrollMonth: body.firstPayrollMonth },
        ctx.userId,
      );
    },
  };
}

export type GoLiveStatusService = ReturnType<typeof createGoLiveStatus>;

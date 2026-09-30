import {
  RepositoryError,
  type DatabaseConnection,
  type DatabaseManager,
} from '@nocobase/db';
import { z } from 'zod';
import type { ActorContext } from './framework-service.js';
import { authorizeAction, policyOf } from './authorize.js';
import { HrError, newId, str } from './shared.js';
import {
  attendanceDepartmentChain,
  attendanceRuleSchema,
  shiftSchema,
  type AttendanceDepartment,
} from './attendance-catalog.js';
import {
  attendanceConfigDefaults,
  attendanceConfigSchemas,
  decodeSetting,
  isAttendanceConfigSection,
  type AttendanceConfigSection,
  type AttendanceConfiguration,
} from './attendance-config.js';

const timestamp = (value: unknown): Date =>
  value instanceof Date ? value : new Date(String(value));

export async function lockAttendanceSettings(
  connection: DatabaseConnection,
  userId: string,
) {
  // The catalog row is an internal transaction mutex. It is deliberately
  // updated with a compare-and-swap Repository write rather than the caller's
  // collection policy: request/approve actions only read personnel settings,
  // while this row never exposes business configuration to the caller.
  const repo = connection.repository('personnelSettings');
  const lock = await repo.findOne({ filter: { id: 'attendance.catalog' } });
  if (!lock) throw new HrError('ATTENDANCE_NOT_INITIALIZED', 409);
  try {
    await repo.updateOne({
      filter: { id: 'attendance.catalog', revision: Number(lock.revision) },
      values: {
        revision: Number(lock.revision) + 1,
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    if (error instanceof RepositoryError && error.code === 'RECORD_NOT_FOUND')
      throw new HrError('SETTINGS_CONFLICT', 409);
    throw error;
  }
}

export function createAttendanceSettingsService(database: DatabaseManager) {
  // Business calculations use this internal reader; it is not exposed as an unguarded API.
  async function read<K extends AttendanceConfigSection>(section: K) {
    const row = await database.repository('personnelSettings').findOne({
      filter: { id: `attendance.${section}` },
    });
    return {
      value: attendanceConfigSchemas[section].parse(
        decodeSetting(row?.value) ?? attendanceConfigDefaults[section],
      ) as AttendanceConfiguration[K],
      revision: Number(row?.revision ?? 0),
    };
  }
  return {
    read,
    async getSection(ctx: ActorContext, section: string) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.attendanceSettings',
        'manage',
      );
      if (!isAttendanceConfigSection(section))
        throw new HrError('INVALID_INPUT');
      const row = await database
        .repository('personnelSettings')
        .withPolicy(policyOf(policies, 'personnelSettings'))
        .findOne({ filter: { id: `attendance.${section}` } });
      return {
        value: attendanceConfigSchemas[section].parse(
          decodeSetting(row?.value) ?? attendanceConfigDefaults[section],
        ),
        revision: Number(row?.revision ?? 0),
      };
    },
    async getCatalog(ctx: ActorContext, kind: 'shifts' | 'rules', id: string) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.attendanceSettings',
        'manage',
      );
      const name = kind === 'shifts' ? 'shifts' : 'attendanceRules';
      const row = await database
        .repository(name)
        .withPolicy(policyOf(policies, name))
        .findOne({ filter: { id } });
      if (!row) throw new HrError('NOT_FOUND', 404);
      return row;
    },
    async get(ctx: ActorContext) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.attendanceSettings',
        'manage',
      );
      const repo = database
        .repository('personnelSettings')
        .withPolicy(policyOf(policies, 'personnelSettings'));
      const config: Record<string, unknown> = {};
      for (const section of Object.keys(
        attendanceConfigSchemas,
      ) as AttendanceConfigSection[]) {
        const row = await repo.findOne({
          filter: { id: `attendance.${section}` },
        });
        config[section] = {
          value: attendanceConfigSchemas[section].parse(
            decodeSetting(row?.value) ?? attendanceConfigDefaults[section],
          ),
          revision: Number(row?.revision ?? 0),
        };
      }
      const readCatalog = async (collection: string) => {
        const rows = await database
          .repository(collection)
          .withPolicy(policyOf(policies, collection))
          .findMany({ limit: 501, sort: (s) => s.field('id').asc() });
        return {
          data: rows.slice(0, 500),
          meta: { limit: 500, truncated: rows.length > 500 },
        };
      };
      return {
        config,
        shifts: await readCatalog('shifts'),
        rules: await readCatalog('attendanceRules'),
        departments: await readCatalog('departments'),
      };
    },
    async saveCatalog(
      ctx: ActorContext,
      kind: 'shifts' | 'rules',
      id: string | undefined,
      input: unknown,
    ) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.attendanceSettings',
        'manage',
      );
      const schema = kind === 'shifts' ? shiftSchema : attendanceRuleSchema;
      const parsed = z
        .object({
          value: schema,
          expectedUpdatedAt: z.iso.datetime({ local: true }).optional(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      if (Boolean(id) !== Boolean(parsed.data.expectedUpdatedAt))
        throw new HrError('INVALID_INPUT');
      return database.transaction(async (connection) => {
        // Serialize catalog validation and mutation across requests, not merely within a JS process.
        await lockAttendanceSettings(connection, ctx.userId);
        const collection = kind === 'shifts' ? 'shifts' : 'attendanceRules';
        const repo = connection
          .repository(collection)
          .withPolicy(policyOf(policies, collection));
        const previous = id ? await repo.findOne({ filter: { id } }) : null;
        if (id && !previous) throw new HrError('NOT_FOUND', 404);
        if (
          previous &&
          str(previous.updatedAt) !== parsed.data.expectedUpdatedAt
        )
          throw new HrError('SETTINGS_CONFLICT', 409);
        const value = parsed.data.value;
        const repositoryValue =
          kind === 'shifts'
            ? (() => {
                const shift = shiftSchema.parse(value);
                return {
                  ...shift,
                  startTime: `${shift.startTime}:00`,
                  endTime: `${shift.endTime}:00`,
                };
              })()
            : value;
        const departments = await connection
          .repository('departments')
          .withPolicy(policyOf(policies, 'departments'))
          .findMany({ limit: 10001 });
        if (departments.length > 10000) throw new HrError('SCOPE_TOO_LARGE');
        const tree = departments.map((d): AttendanceDepartment => ({
          id: str(d.id),
          parentId: d.parentId == null ? null : str(d.parentId),
          active: Boolean(d.active),
        }));
        // Historical definitions must remain disableable after their department is retired.
        // Only an unchanged scope may bypass active-tree validation, and only when disabling.
        if (
          value.active ||
          !previous ||
          JSON.stringify(value.departmentIds) !==
            JSON.stringify(previous.departmentIds)
        ) {
          for (const departmentId of value.departmentIds ?? [])
            attendanceDepartmentChain(departmentId, tree);
        }
        if (kind === 'shifts') {
          const shift = shiftSchema.parse(value);
          const duplicate = await repo.findOne({
            filter: { code: shift.code },
          });
          if (duplicate && duplicate.id !== id)
            throw new HrError('SHIFT_CODE_CONFLICT', 409);
          if (
            previous &&
            (await connection
              .repository('shiftSchedules')
              .withPolicy(policyOf(policies, 'shiftSchedules'))
              .exists({ filter: { shiftId: id } }))
          ) {
            // Historical shift times drive attendance. Until effective-dated shifts exist, referenced definitions are immutable; active can change.
            const normalized: Record<string, unknown> = {
              ...previous,
              startTime: str(previous.startTime).slice(0, 5),
              endTime: str(previous.endTime).slice(0, 5),
            };
            if (
              Object.keys(shift).some(
                (key) =>
                  key !== 'active' &&
                  JSON.stringify(normalized[key]) !==
                    JSON.stringify(shift[key as keyof typeof shift]),
              )
            )
              throw new HrError('SHIFT_IN_USE', 409);
          }
        } else if (value.active) {
          const active = await repo.findMany({
            filter: { active: true },
            limit: 10001,
          });
          if (active.length > 10000) throw new HrError('SCOPE_TOO_LARGE');
          if (
            active.some(
              (rule) =>
                rule.id !== id &&
                Array.isArray(rule.departmentIds) &&
                rule.departmentIds.some((departmentId) =>
                  value.departmentIds?.includes(String(departmentId)),
                ),
            )
          )
            throw new HrError('ATTENDANCE_RULE_CONFLICT', 409);
        }
        const stamp = new Date(
          Math.max(
            Date.now(),
            previous ? timestamp(previous.updatedAt).getTime() + 1 : 0,
          ),
        );
        const result = previous
          ? await repo.updateOne({
              // The catalog revision was conditionally advanced before reading this row.
              // Every catalog writer takes that same lock, so the checked timestamp stays current until commit.
              filter: { id },
              values: { ...repositoryValue, updatedAt: stamp },
            })
          : await repo.createOne({
              values: {
                ...repositoryValue,
                id: newId(),
                createdAt: stamp,
                updatedAt: stamp,
              },
            });
        return result.record;
      });
    },
    async update(ctx: ActorContext, section: string, input: unknown) {
      const policies = await authorizeAction(
        ctx.authz,
        'talent.attendanceSettings',
        'manage',
      );
      if (!isAttendanceConfigSection(section))
        throw new HrError('INVALID_INPUT');
      const parsed = z
        .object({
          revision: z.number().int().nonnegative(),
          value: attendanceConfigSchemas[section],
        })
        .strict()
        .safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((issue) => issue.path.join('.')),
        });
      const { value, revision } = parsed.data;
      return database.transaction(async (connection) => {
        const repo = connection
          .repository('personnelSettings')
          .withPolicy(policyOf(policies, 'personnelSettings'));
        const id = `attendance.${section}`;
        // The seeded lock also serializes first writes, where no section row exists yet.
        await lockAttendanceSettings(connection, ctx.userId);
        const previous = await repo.findOne({ filter: { id } });
        if (Number(previous?.revision ?? 0) !== revision)
          throw new HrError('SETTINGS_CONFLICT', 409);
        const stamp = new Date();
        if (previous) {
          await repo.updateOne({
            filter: { id, revision },
            values: {
              value,
              revision: revision + 1,
              updatedBy: ctx.userId,
              updatedAt: stamp,
            },
          });
        } else {
          await repo.createOne({
            values: {
              id,
              value,
              revision: 1,
              updatedBy: ctx.userId,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        }
        return { value, revision: revision + 1 };
      });
    },
  };
}

export type AttendanceSettingsService = ReturnType<
  typeof createAttendanceSettingsService
>;

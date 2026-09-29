import { z } from 'zod';
import { HrError } from './shared.js';

const departments = z
  .array(z.string().min(1).max(64))
  .max(500)
  .refine((ids) => new Set(ids).size === ids.length);
const title = z.string().trim().min(1).max(255);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
export function clockMinutes(value: string): number {
  const parsed = time.safeParse(value);
  if (!parsed.success) throw new HrError('INVALID_INPUT');
  const [hours, minutes] = parsed.data.split(':').map(Number);
  return hours * 60 + minutes;
}

export const shiftSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/u),
    title,
    startTime: time,
    endTime: time,
    breakMinutes: z.number().int().min(0).max(1439).default(30),
    isNight: z.boolean(),
    departmentIds: departments.nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((shift, ctx) => {
    if (
      !time.safeParse(shift.startTime).success ||
      !time.safeParse(shift.endTime).success
    )
      return;
    const duration =
      (clockMinutes(shift.endTime) - clockMinutes(shift.startTime) + 1440) %
      1440;
    if (duration === 0)
      ctx.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'INVALID_SHIFT_DURATION',
      });
    if (shift.breakMinutes >= duration)
      ctx.addIssue({
        code: 'custom',
        path: ['breakMinutes'],
        message: 'INVALID_BREAK_DURATION',
      });
  });

export const attendanceRuleSchema = z
  .object({
    title,
    departmentIds: departments.refine((ids) => ids.length > 0),
    workHourSystem: z.enum(['standard', 'comprehensive', 'flexible']),
    punchSource: z.enum(['feishu', 'dingtalk', 'wecom', 'device']),
    lateGraceMinutes: z.number().int().min(0).max(240).default(5),
    overtimeRequiresApproval: z.boolean().default(true),
    monthlyOvertimeAlertHours: z.number().int().min(0).max(744).default(36),
    minRestHours: z.number().int().min(0).max(72).default(11),
    maxConsecutiveNights: z.number().int().min(0).max(31).default(5),
    active: z.boolean().default(true),
  })
  .strict();

export interface AttendanceDepartment {
  id: string;
  parentId: string | null;
  active: boolean;
}
export type AttendanceRule = z.infer<typeof attendanceRuleSchema> & {
  id: string;
};

/** Resolve the complete trusted department tree before applying ancestor precedence. */
export function attendanceDepartmentChain(
  id: string,
  tree: readonly AttendanceDepartment[],
): string[] {
  const departments = new Map(tree.map((d) => [d.id, d]));
  if (departments.size !== tree.length)
    throw new HrError('INVALID_DEPARTMENT_TREE');
  const chain: string[] = [];
  let current: string | null = id;
  while (current) {
    if (chain.includes(current)) throw new HrError('INVALID_DEPARTMENT_TREE');
    const department = departments.get(current);
    if (!department || !department.active)
      throw new HrError('INVALID_DEPARTMENT');
    chain.push(current);
    current = department.parentId;
  }
  return chain;
}

/** Exactly one rule at the nearest department; ambiguity is never settled by row order. */
export function resolveAttendanceRule(
  departmentId: string,
  tree: readonly AttendanceDepartment[],
  rules: readonly AttendanceRule[],
): AttendanceRule {
  const chain = attendanceDepartmentChain(departmentId, tree);
  for (const id of chain) {
    const matches = rules.filter(
      (rule) => rule.active && rule.departmentIds.includes(id),
    );
    if (matches.length > 1) throw new HrError('ATTENDANCE_RULE_CONFLICT', 409);
    if (matches.length === 1) return matches[0];
  }
  throw new HrError('ATTENDANCE_RULE_NOT_CONFIGURED', 409);
}

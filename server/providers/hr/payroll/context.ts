/**
 * What every payroll service receives from the provider (index.ts, V2-06
 * block): the platform helpers, who holds a permission set, the file drive,
 * password verification for the payslip page, and the hooks that start the
 * HR assistant's check and the vendor-bill processing in the background.
 */
import type { NocoBaseDriveManager } from '@nocobase/drive';

import type { ActorContext } from '../framework-service.js';
import type { Platform } from '../platform.js';
import { newId, str } from '../shared.js';
import { readPayrollSettings, type PayrollSettings } from './config.js';
import type { DepartmentNode } from './common.js';

export interface PayrollDeps {
  readonly platform: Platform;
  /** Everyone who holds a permission set now, through any subject. */
  readonly holdersOf: (setKey: string) => Promise<string[]>;
  readonly drive: () => NocoBaseDriveManager;
  /** Checks the signed-in user's own password (工资条二次验证). */
  readonly verifyPassword: (
    userId: string,
    password: string,
  ) => Promise<boolean>;
  /** A cycle finished a calculation: the HR assistant checks it once. */
  readonly onCalculated: (cycleId: string, calculationId: string) => void;
  /** A vendor bill was uploaded and reconciled. */
  readonly onBillUploaded: (billId: string) => void;
  /** V2-06 邮件往来: the reconciliation notes of a bill were written (the billing mailbox drafts the vendor's reply). */
  readonly onBillReviewed?: (billId: string) => void;
  /** V1-02 V2 增补: a cycle was published (employees who left get their last payslip by mail). */
  readonly onPublished?: (cycleId: string) => void;
  /** A salary adjustment related to a personnel action was decided: refresh its change checklist. */
  readonly onAdjustmentDecided: (actionId: string) => void;
  /** Import, export and publish events for the server log (the application has no audit-log plugin). */
  readonly audit: (event: Record<string, unknown>) => void;
  /** V4-12: perf.coefficient, the bonus cycle and the review result an adjustment links to (optional). */
  readonly performance?: () => import('../performance/payroll-link.js').PayrollLink;
}

export interface PayrollContext extends PayrollDeps {
  settings(): Promise<PayrollSettings>;
  tree(): Promise<DepartmentNode[]>;
  departmentTitle(id: string | null): Promise<string>;
  /** hr.payroll holders, the recipients of payroll to-dos. */
  payrollUsers(): Promise<string[]>;
}

export function createPayrollContext(deps: PayrollDeps): PayrollContext {
  const { platform } = deps;
  const tree = async (): Promise<DepartmentNode[]> =>
    (await platform.organization.listTree()).map((d) => ({
      id: d.id,
      parentId: d.parentId,
      title: platform.organization.titleText(d.title),
    }));
  return {
    ...deps,
    settings: async () => (await readPayrollSettings(platform.database)).value,
    tree,
    async departmentTitle(id) {
      if (!id) return '';
      const department = await platform.organization.getDepartment(id);
      return department
        ? platform.organization.titleText(department.title)
        : id;
    },
    payrollUsers: () => deps.holdersOf('hr.payroll'),
  };
}

/** Writes an uploaded workbook to the default drive and the file collection; answers its id. */
export async function storeUpload(
  ctx: PayrollContext,
  actor: ActorContext,
  file: { name: string; bytes: Uint8Array; mimeType?: string },
): Promise<string> {
  const id = newId();
  const safe = file.name.replace(/[^\w.\-一-龥]/gu, '_').slice(-120);
  const ext = safe.includes('.') ? safe.split('.').pop()!.slice(0, 32) : '';
  // The storage key stays ASCII: the drive refuses other characters (a Chinese file name failed every upload).
  // hrFiles keeps the original name.
  const key = `payroll/${new Date().toISOString().slice(0, 7)}/${id}${ext ? `.${ext.replace(/[^\w]/gu, '')}` : ''}`;
  await ctx.drive().use('local').put(key, file.bytes);
  const now = new Date();
  await ctx.platform.database
    .query()
    .insertInto('hrFiles')
    .values({
      id,
      disk: 'local',
      key,
      filename: safe,
      ext,
      mimeType:
        file.mimeType ||
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: file.bytes.byteLength,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  ctx.audit({
    event: 'payroll.upload',
    fileId: id,
    by: actor.userId,
    name: str(safe),
  });
  return id;
}

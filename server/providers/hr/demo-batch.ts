/**
 * 设备开工登记（演示）: the demonstration of "certified to operate". Work
 * order MO-24031 lists its operations (10 粗车, 20 精车, 30 钻孔攻丝, each on
 * its machine); only operation 20 takes a machine start log in the demo, and
 * recording one is granted solely through the permission set assigned to the
 * CNC 岗位上岗证 certification. Each entry stores the certificate the operator
 * held at that moment, which is what a customer auditor traces later ("was
 * the operator qualified on the day?").
 *
 * The work order and its operations are fixed demonstration content, not a
 * MES. The table, the `demo.batch` resource, its `signFilling` action and the
 * `/demo/batch-record` route keep the names of the earlier batch record demo
 * (renaming them needs a migration and a permission grant migration); in this
 * module a "batch" is the work order and a "step" is an operation.
 *
 * V4-14 adds 叉车出库登记 (`/demo/forklift-dispatch`, `demo.forklift` ·
 * dispatch), granted only through equip.forkliftOperator on the 叉车证
 * certification subject, and writes both kinds of start log to the same
 * table (`kind` machineStart / forkliftDispatch, `machineNo`). Both
 * registrations check twice on the server: the business operation first,
 * then a valid or expiring certificate of a certification the operation's
 * permission set is assigned to; without one the registration is refused,
 * whatever the permission says. The mapping of page to permission set is
 * demonstration configuration (DEMO_OPERATIONS). These pages and their
 * records exist only where the demo seed ran; they are not a product
 * feature.
 */
import { authorizeAction, policyOf } from './authorize.js';
import { CERTIFICATION_SUBJECT } from './certification-service.js';
import type { ActorContext } from './framework-service.js';
import type { Platform } from './platform.js';
import { HrError, newId, str } from './shared.js';

export const DEMO_BATCH = {
  /** The work order number. */
  batchNo: 'MO-24031',
  /** The part the work order machines (a brake caliper housing). */
  product: 'BC-2403',
  /** Operation codes, in routing order. */
  steps: ['op10', 'op20', 'op30'],
  /** The machine each operation runs on. */
  machines: { op10: 'CK6150-03', op20: 'CK6150-05', op30: 'VMC850-02' },
  /** The operation that takes machine start logs in the demo. */
  signableStep: 'op20',
} as const;
/** The permission set whose holders may record a machine start. */
export const CNC_OPERATOR_PERMISSION_SET = 'prod.cncOperator';
/** V4-14: the permission set whose holders may record a forklift dispatch. */
export const FORKLIFT_OPERATOR_PERMISSION_SET = 'equip.forkliftOperator';
/** V4-14 叉车出库登记: one demonstration dispatch note on one forklift. */
export const DEMO_FORKLIFT = {
  orderNo: 'CK-24031',
  forkliftNo: 'FL-03',
  warehouse: '苏州工厂成品库',
  items: [
    { code: 'BC-2403', quantity: 120 },
    { code: 'BC-2405', quantity: 80 },
  ],
} as const;
/**
 * V4-14 演示配置: which demonstration page each permission set opens, the
 * operation behind its button, and the kind of start log it writes.
 */
export const DEMO_OPERATIONS = [
  {
    kind: 'machineStart',
    permissionSet: CNC_OPERATOR_PERMISSION_SET,
    page: 'demo.batchRecord',
    resource: 'demo.batch',
    action: 'signFilling',
  },
  {
    kind: 'forkliftDispatch',
    permissionSet: FORKLIFT_OPERATOR_PERMISSION_SET,
    page: 'demo.forkliftDispatch',
    resource: 'demo.forklift',
    action: 'dispatch',
  },
] as const;
export type StartLogKind = (typeof DEMO_OPERATIONS)[number]['kind'];
const BATCH = 'demo.batch';
const FORKLIFT = 'demo.forklift';
const STEWARD = 'talent.certificationSteward';
const HOLDING_STATUSES = ['valid', 'expiring'];

export interface BatchSignoff {
  readonly id: string;
  /** V4-14: machineStart or forkliftDispatch. */
  readonly kind: string;
  readonly machineNo: string | null;
  readonly step: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly signedAt: string;
  readonly certificateNo: string | null;
  readonly certificateStatusAtSigning: string | null;
}

export interface BatchView {
  readonly batchNo: string;
  readonly steps: readonly {
    code: string;
    /** The machine the operation runs on. */
    machine: string;
    signable: boolean;
    signoffs: readonly BatchSignoff[];
  }[];
  readonly canSign: boolean;
}

export interface SignoffTrace extends BatchSignoff {
  readonly certificateId: string | null;
  readonly certificateStatusNow: string | null;
  readonly certificateExpiresAt: string | null;
  /** When the signer completed each course the certification requires. */
  readonly requiredCourses: readonly {
    courseId: string;
    title: string;
    completedAt: string | null;
  }[];
  /** The records behind the trace, to open in the application. */
  readonly links: {
    readonly certificate: string | null;
    readonly employee: string;
  };
}

export interface ForkliftView {
  readonly orderNo: string;
  readonly forkliftNo: string;
  readonly warehouse: string;
  readonly items: readonly { code: string; quantity: number }[];
  readonly dispatches: readonly BatchSignoff[];
  readonly canDispatch: boolean;
}

export interface DemoBatchService {
  view(ctx: ActorContext): Promise<BatchView>;
  /** Records a machine start on the demo operation (the action keeps its earlier name). */
  signFilling(ctx: ActorContext): Promise<BatchSignoff>;
  /** V4-14 叉车出库登记. */
  forkliftView(ctx: ActorContext): Promise<ForkliftView>;
  forkliftDispatch(ctx: ActorContext): Promise<BatchSignoff>;
  /** The certification steward's trace, limited to the people in the caller's data range. */
  traceSignoffs(
    ctx: ActorContext,
    batchNo: string,
    step?: string,
    kind?: string,
  ): Promise<SignoffTrace[]>;
  /** V4-14: the same trace over people the caller's own authorization already selected (审计导出). */
  traceWithin(
    visible: ReadonlySet<string>,
    batchNo: string,
    step?: string,
    kind?: string,
  ): Promise<SignoffTrace[]>;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : str(value);
}
function dateOnly(value: unknown): string | null {
  const text = iso(value);
  return text ? text.slice(0, 10) : null;
}

export function createDemoBatchService(deps: {
  readonly platform: Platform;
}): DemoBatchService {
  const { platform } = deps;
  const { database, authz } = platform;

  /** Certifications a permission set is assigned to (the CNC operator set by default). */
  async function operatorCertifications(
    permissionSet: string = CNC_OPERATOR_PERMISSION_SET,
  ): Promise<string[]> {
    const assignments = await authz.permissionSets
      .listAssignments(permissionSet)
      .catch(() => []);
    return assignments
      .filter((a) => a.subject.type === CERTIFICATION_SUBJECT)
      .map((a) => a.subject.id);
  }

  async function signoffRows(batchNo: string, step?: string, kind?: string) {
    let builder = database
      .query()
      .selectFrom('demoBatchSignoffs')
      .selectAll()
      .where('batchNo', '=', batchNo);
    if (step) builder = builder.where('step', '=', step);
    const rows = await builder.orderBy('signedAt', 'desc').execute();
    // Rows written before V4-14 carry no kind: they are machine starts.
    return kind
      ? rows.filter((row) => str(row.kind ?? 'machineStart') === kind)
      : rows;
  }

  /**
   * The second check (V4-14 登记双重校验): after the business operation was
   * authorized, the registrant's own valid or expiring certificate of a
   * certification the operation's permission set is assigned to. Without one
   * the registration is refused.
   */
  async function holdingCertificate(
    ctx: ActorContext,
    permissionSet: string,
  ): Promise<{
    employee: { id: string; name: string };
    certificate: { id: string; certificateNo: string; status: string };
  }> {
    const employee = await platform.employeeOfUser(ctx.userId);
    if (!employee || employee.status === 'leave')
      throw new HrError('EMPLOYEE_NOT_LINKED', 404);
    const certifications = await operatorCertifications(permissionSet);
    const certificate = certifications.length
      ? await database
          .query()
          .selectFrom('employeeCertificates')
          .select(['id', 'certificateNo', 'status'])
          .where('employeeId', '=', employee.id)
          .where('certificationId', 'in', certifications)
          .where('status', 'in', HOLDING_STATUSES)
          .orderBy('issuedAt', 'desc')
          .executeTakeFirst()
      : undefined;
    if (!certificate) throw new HrError('CERTIFICATE_REQUIRED', 403);
    return {
      employee: { id: employee.id, name: employee.name },
      certificate: {
        id: str(certificate.id),
        certificateNo: str(certificate.certificateNo),
        status: str(certificate.status),
      },
    };
  }

  async function record(
    ctx: ActorContext,
    input: {
      kind: StartLogKind;
      batchNo: string;
      step: string;
      machineNo: string;
      permissionSet: string;
    },
  ): Promise<BatchSignoff> {
    const { employee, certificate } = await holdingCertificate(
      ctx,
      input.permissionSet,
    );
    const now = new Date();
    const id = newId();
    // Only added, never changed or deleted: the registration is evidence.
    await database
      .query()
      .insertInto('demoBatchSignoffs')
      .values({
        id,
        kind: input.kind,
        batchNo: input.batchNo,
        step: input.step,
        machineNo: input.machineNo,
        employeeId: employee.id,
        userId: ctx.userId,
        signedAt: now,
        certificateId: certificate.id,
        certificateNo: certificate.certificateNo,
        certificateStatus: certificate.status,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return {
      id,
      kind: input.kind,
      machineNo: input.machineNo,
      step: input.step,
      employeeId: employee.id,
      employeeName: employee.name,
      signedAt: now.toISOString(),
      certificateNo: certificate.certificateNo,
      certificateStatusAtSigning: certificate.status,
    };
  }

  async function toSignoff(
    row: Record<string, unknown>,
  ): Promise<BatchSignoff> {
    const employee = await platform.employee(str(row.employeeId));
    return {
      id: str(row.id),
      kind: str(row.kind ?? 'machineStart'),
      machineNo: row.machineNo ? str(row.machineNo) : null,
      step: str(row.step),
      employeeId: str(row.employeeId),
      employeeName: employee?.name ?? str(row.employeeId),
      signedAt: iso(row.signedAt)!,
      certificateNo: row.certificateNo ? str(row.certificateNo) : null,
      certificateStatusAtSigning: row.certificateStatus
        ? str(row.certificateStatus)
        : null,
    };
  }

  const service: DemoBatchService = {
    async view(ctx) {
      await authorizeAction(ctx.authz, BATCH, 'view');
      const rows = await signoffRows(DEMO_BATCH.batchNo);
      const signoffs = await Promise.all(rows.map(toSignoff));
      return {
        batchNo: DEMO_BATCH.batchNo,
        steps: DEMO_BATCH.steps.map((code) => ({
          code,
          machine: DEMO_BATCH.machines[code],
          signable: code === DEMO_BATCH.signableStep,
          signoffs: signoffs.filter((s) => s.step === code),
        })),
        canSign: await platform.can(ctx, BATCH, 'signFilling'),
      };
    },

    async signFilling(ctx) {
      // Granted only through the certification's permission set; nothing on the request can claim it.
      await authorizeAction(ctx.authz, BATCH, 'signFilling');
      return record(ctx, {
        kind: 'machineStart',
        batchNo: DEMO_BATCH.batchNo,
        step: DEMO_BATCH.signableStep,
        machineNo: DEMO_BATCH.machines[DEMO_BATCH.signableStep],
        permissionSet: CNC_OPERATOR_PERMISSION_SET,
      });
    },

    async forkliftView(ctx) {
      await authorizeAction(ctx.authz, FORKLIFT, 'view');
      const rows = await signoffRows(
        DEMO_FORKLIFT.orderNo,
        undefined,
        'forkliftDispatch',
      );
      return {
        orderNo: DEMO_FORKLIFT.orderNo,
        forkliftNo: DEMO_FORKLIFT.forkliftNo,
        warehouse: DEMO_FORKLIFT.warehouse,
        items: DEMO_FORKLIFT.items,
        dispatches: await Promise.all(rows.map(toSignoff)),
        canDispatch: await platform.can(ctx, FORKLIFT, 'dispatch'),
      };
    },

    async forkliftDispatch(ctx) {
      await authorizeAction(ctx.authz, FORKLIFT, 'dispatch');
      return record(ctx, {
        kind: 'forkliftDispatch',
        batchNo: DEMO_FORKLIFT.orderNo,
        step: 'dispatch',
        machineNo: DEMO_FORKLIFT.forkliftNo,
        permissionSet: FORKLIFT_OPERATOR_PERMISSION_SET,
      });
    },

    async traceSignoffs(ctx, batchNo, step, kind) {
      const policies = await authorizeAction(ctx.authz, STEWARD, 'use');
      // The steward's employee scope decides whose start logs the caller may see.
      const visible = new Set(
        (
          (await database
            .repository('employees')
            .withPolicy(policyOf(policies, 'employees'))
            .findMany({})) as Record<string, unknown>[]
        ).map((e) => str(e.id)),
      );
      return service.traceWithin(visible, batchNo, step, kind);
    },

    async traceWithin(visible, batchNo, step, kind) {
      // An operation may be named by its number ("20") as well as its code ("op20").
      const operation =
        step && /^\d+$/.test(step.trim()) ? `op${step.trim()}` : step;
      const rows = (await signoffRows(batchNo, operation, kind))
        .filter((row) => visible.has(str(row.employeeId)))
        // 按登记时间排序 (V4-14 提示词要点 3).
        .sort((a, b) => iso(a.signedAt)!.localeCompare(iso(b.signedAt)!));
      const result: SignoffTrace[] = [];
      for (const row of rows) {
        const signoff = await toSignoff(row);
        const certificate = row.certificateId
          ? await database
              .query()
              .selectFrom('employeeCertificates')
              .select(['id', 'certificationId', 'status', 'expiresAt'])
              .where('id', '=', str(row.certificateId))
              .executeTakeFirst()
          : undefined;
        const courses = certificate
          ? await database
              .query()
              .selectFrom('certificationCourses')
              .innerJoin(
                'courses',
                'courses.id',
                'certificationCourses.courseId',
              )
              .select(['courses.id as id', 'courses.title as title'])
              .where(
                'certificationCourses.certificationId',
                '=',
                str(certificate.certificationId),
              )
              .execute()
          : [];
        const requiredCourses = [];
        for (const course of courses) {
          const done = await database
            .query()
            .selectFrom('assignments')
            .select(['completedAt'])
            .where('employeeId', '=', signoff.employeeId)
            .where('courseId', '=', str(course.id))
            .where('status', '=', 'completed')
            .orderBy('completedAt', 'asc')
            .executeTakeFirst();
          requiredCourses.push({
            courseId: str(course.id),
            title: str(course.title),
            completedAt: done ? iso(done.completedAt) : null,
          });
        }
        result.push({
          ...signoff,
          certificateId: certificate ? str(certificate.id) : null,
          certificateStatusNow: certificate ? str(certificate.status) : null,
          certificateExpiresAt: certificate
            ? dateOnly(certificate.expiresAt)
            : null,
          requiredCourses,
          links: {
            certificate: certificate
              ? `/talent/certifications/${str(certificate.certificationId)}`
              : null,
            employee: `/talent/employees/${signoff.employeeId}/profile`,
          },
        });
      }
      return result;
    },
  };
  return service;
}

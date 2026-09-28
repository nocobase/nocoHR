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
const BATCH = 'demo.batch';
const STEWARD = 'talent.certificationSteward';
const HOLDING_STATUSES = ['valid', 'expiring'];

export interface BatchSignoff {
  readonly id: string;
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

export interface DemoBatchService {
  view(ctx: ActorContext): Promise<BatchView>;
  /** Records a machine start on the demo operation (the action keeps its earlier name). */
  signFilling(ctx: ActorContext): Promise<BatchSignoff>;
  /** The certification steward's trace, limited to the people in the caller's data range. */
  traceSignoffs(
    ctx: ActorContext,
    batchNo: string,
    step?: string,
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

  /** Certifications the CNC operator permission set is assigned to. */
  async function operatorCertifications(): Promise<string[]> {
    const assignments = await authz.permissionSets
      .listAssignments(CNC_OPERATOR_PERMISSION_SET)
      .catch(() => []);
    return assignments
      .filter((a) => a.subject.type === CERTIFICATION_SUBJECT)
      .map((a) => a.subject.id);
  }

  async function signoffRows(batchNo: string, step?: string) {
    let builder = database
      .query()
      .selectFrom('demoBatchSignoffs')
      .selectAll()
      .where('batchNo', '=', batchNo);
    if (step) builder = builder.where('step', '=', step);
    return await builder.orderBy('signedAt', 'desc').execute();
  }

  async function toSignoff(
    row: Record<string, unknown>,
  ): Promise<BatchSignoff> {
    const employee = await platform.employee(str(row.employeeId));
    return {
      id: str(row.id),
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

  return {
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
      const employee = await platform.employeeOfUser(ctx.userId);
      if (!employee || employee.status === 'leave')
        throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      const certifications = await operatorCertifications();
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
      const now = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('demoBatchSignoffs')
        .values({
          id,
          batchNo: DEMO_BATCH.batchNo,
          step: DEMO_BATCH.signableStep,
          employeeId: employee.id,
          userId: ctx.userId,
          signedAt: now,
          certificateId: certificate ? str(certificate.id) : null,
          certificateNo: certificate ? str(certificate.certificateNo) : null,
          certificateStatus: certificate ? str(certificate.status) : null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return {
        id,
        step: DEMO_BATCH.signableStep,
        employeeId: employee.id,
        employeeName: employee.name,
        signedAt: now.toISOString(),
        certificateNo: certificate ? str(certificate.certificateNo) : null,
        certificateStatusAtSigning: certificate
          ? str(certificate.status)
          : null,
      };
    },

    async traceSignoffs(ctx, batchNo, step) {
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
      // An operation may be named by its number ("20") as well as its code ("op20").
      const operation =
        step && /^\d+$/.test(step.trim()) ? `op${step.trim()}` : step;
      const rows = (await signoffRows(batchNo, operation)).filter((row) =>
        visible.has(str(row.employeeId)),
      );
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
}

/**
 * Certification programmes and certificates.
 *
 * A certificate is issued as soon as every requirement is met; issuing,
 * expiry, replacement, revocation and leaving are the only ways the
 * certification subject's membership changes, and each refreshes the holder's
 * session so permissions granted through the certification follow at once.
 *
 * Renewal: a holder of a valid or expiring certificate who completes the
 * recertification requirements (the exams, or courses and exams when the
 * programme's mode is "full") after the current certificate was issued gets a
 * new one expiring one validity period after the old one; the old one becomes
 * superseded in the same transaction, so access never lapses. Someone whose
 * certificate already expired or was revoked is certified again as if for the
 * first time, from today.
 */
import type { DatabaseConnection } from '@nocobase/db';

import {
  authorizeAction,
  policyOf,
  tryAuthorizeAction,
  type CollectionPolicies,
} from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { LearningService } from './learning-service.js';
import { bool, json, type EmployeeSummary, type Platform } from './platform.js';
import {
  daysBetween,
  HrError,
  isRecord,
  newId,
  optionalDate,
  requireEnum,
  requireString,
  str,
} from './shared.js';

const CERTIFICATION = 'talent.certification';
const CERTIFICATE = 'talent.certificate';
const EXTERNAL = 'talent.externalCertificate';
export const CERTIFICATION_SUBJECT = 'hr.certification';
/** Certificate states that carry the certification's permissions. */
export const HOLDING_STATUSES = ['valid', 'expiring'] as const;

export interface RequirementStatus {
  readonly courses: readonly { id: string; title: string; done: boolean }[];
  readonly exams: readonly { id: string; title: string; done: boolean }[];
}

export interface CertificateView {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly certificationId: string;
  readonly certificationTitle: string;
  readonly certificateNo: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly status: string;
  readonly revokedReason: string | null;
  readonly supersededById: string | null;
  /** V3-10: internal (issued here) or external (registered with a scan and verified by HR). */
  readonly source: string;
  readonly externalNo: string | null;
  readonly attachmentFileId: string | null;
  readonly verifyStatus: string | null;
  readonly verifyNote: string | null;
  readonly verifiedAt: string | null;
  readonly issuingAuthority: string | null;
}

export interface CertificationSummary {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly validityMonths: number | null;
  readonly competencyId: string | null;
  readonly competencyTitle: string | null;
  readonly competencyLevel: number | null;
  readonly expiringNoticeDays: number;
  readonly recertAdvanceDays: number;
  /** Days before expiry at which a renewal not yet started is escalated to the head; 0 turns it off. */
  readonly escalateDays: number;
  readonly recertMode: string;
  readonly active: boolean;
  readonly courses: readonly { id: string; title: string }[];
  readonly exams: readonly { id: string; title: string }[];
  readonly holderCount: number;
  /** V3-10 10B: internal certification or external certificate type. */
  readonly kind: 'internal' | 'external';
  readonly issuingAuthority: string | null;
  /** V3-10 任职资格: holding a valid certificate means qualified for this position. */
  readonly qualifiesPositionId: string | null;
  readonly qualifiesPositionTitle: string | null;
  readonly validCount: number;
  readonly expiringCount: number;
}

export interface CertificationDetail extends CertificationSummary {
  readonly mine: {
    requirements: RequirementStatus;
    certificate: CertificateView | null;
  } | null;
  readonly holders: readonly CertificateView[] | null;
  /** Permission sets assigned to this certification's subject; managed in Settings → Authorization. */
  readonly grantedPermissionSets:
    readonly { key: string; title: string }[] | null;
  /** Page resources those permission sets open, for every viewer. */
  readonly grantedPages: readonly string[];
  readonly can: { manage: boolean; revoke: boolean };
}

export interface CertificationDailyReport {
  recertAssigned: number;
  expiringCertificates: number;
  expiredCertificates: number;
}

export interface CertificationService {
  listCertifications(
    ctx: ActorContext,
  ): Promise<{ items: CertificationSummary[]; canManage: boolean }>;
  getCertification(
    ctx: ActorContext,
    id: string,
  ): Promise<CertificationDetail | undefined>;
  saveCertification(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<CertificationDetail>;
  setCertificationActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<CertificationDetail>;
  listCertificates(
    ctx: ActorContext,
    filters: { employeeId?: string; certificationId?: string; status?: string },
  ): Promise<CertificateView[]>;
  revokeCertificate(
    ctx: ActorContext,
    id: string,
    reason: unknown,
  ): Promise<CertificateView>;
  /** A printable certificate page for the holder or someone who may download it. */
  certificateDocument(
    ctx: ActorContext,
    id: string,
    locale: string,
  ): Promise<string>;
  /** Called after a course completes or an exam is passed. */
  evaluate(employeeId: string): Promise<string[]>;
  /** Certifications whose certificate the user holds; the certification subject's membership. */
  heldCertificationIds(userId: string): Promise<string[]>;
  activeCertificationIds(
    ids: readonly string[],
    connection?: DatabaseConnection,
  ): Promise<string[]>;
  subjectOptions(query: {
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    items: { id: string; title: string; description: string }[];
    total: number;
  }>;
  resolveSubjects(
    ids: readonly string[],
  ): Promise<{ id: string; title: string; description: string }[]>;
  /** Titles of the permission sets a certification grants, for notices. */
  grantedSetTitles(certificationId: string): Promise<string[]>;
  runDaily(asOf?: string): Promise<CertificationDailyReport>;

  // ---------- V3-10 10B: external certificates ----------
  /** An employee registers their own external certificate, or HR registers one for someone. */
  registerExternal(ctx: ActorContext, input: unknown): Promise<CertificateView>;
  /** The holder (or HR) corrects a rejected registration and submits it again. */
  updateExternal(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<CertificateView>;
  /** HR verifies (the certificate enters its lifecycle) or rejects (with a reason) a pending one. */
  verifyExternal(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<CertificateView>;
  listExternal(
    ctx: ActorContext,
    filters: { verifyStatus?: string; mine?: boolean },
  ): Promise<{ items: CertificateView[]; canVerify: boolean }>;
  /** The scan's file record, for someone who may see the certificate. */
  externalScan(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown> | null>;
  canReadScan(ctx: ActorContext, fileId: string): Promise<boolean>;
  /** V3-10 任职资格: the material the certification steward prepared for a qualification certificate. */
  qualificationDossier(
    ctx: ActorContext,
    certificateId: string,
  ): Promise<Record<string, unknown> | null>;
}

export interface CertificationServiceDeps {
  readonly platform: Platform;
  readonly learning: LearningService;
  readonly companyName: () => string;
  /** Resolves a stored permission set title to text. */
  readonly titleText: (title: unknown) => string;
  /**
   * V3-10: whether the V4-14 industry pack (持证上岗) is on. Off, certificates
   * grant nothing: the subject has no members and notices do not mention
   * permissions. Defaults to on when not wired, the V1 behaviour.
   */
  readonly licensed?: () => Promise<boolean>;
  /** V3-10: a certificate of a certification that qualifies for a position was issued. */
  readonly onQualified?: () => ((certificateId: string) => void) | undefined;
  /**
   * V4-13 实操考核: asked before a certificate is issued or renewed. With the
   * certification's practical assessments required for this kind of issue
   * (`recert` when an earlier, unrevoked certificate exists), `ok` is false
   * until each has a valid, signed, passed record; the ids join the evidence.
   */
  readonly practicalGate?: () =>
    | ((
        employeeId: string,
        certificationId: string,
        mode: 'initial' | 'recert',
      ) => Promise<{ ok: boolean; recordIds: string[] }>)
    | undefined;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}
function isoTime(value: unknown): number {
  if (!value) return 0;
  return (value instanceof Date ? value : new Date(str(value))).getTime();
}
function addMonths(dateOnlyValue: string, months: number): string {
  const [y, m, d] = dateOnlyValue.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/gu,
    (ch) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        ch
      ]!,
  );
}
function ids(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 64)
  )
    throw new HrError('INVALID_INPUT', 400);
  return [...new Set(value as string[])];
}

export function createCertificationService(
  deps: CertificationServiceDeps,
): CertificationService {
  const { platform } = deps;
  const { database, notify, authz } = platform;
  const licensed = async () => (deps.licensed ? deps.licensed() : true);
  /** The permission sets a certificate loses, for notices; none while the industry pack is off. */
  const lostSets = (certificationId: string) =>
    service.grantedSetTitles(certificationId);

  async function certificationRow(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<Record<string, unknown> | undefined> {
    return await (connection ? connection.query : database.query())
      .selectFrom('certifications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async function requirementsOf(
    certificationId: string,
    connection?: DatabaseConnection,
  ): Promise<{
    courses: { id: string; title: string }[];
    exams: { id: string; title: string }[];
  }> {
    const query = connection ? connection.query : database.query();
    const courses = await query
      .selectFrom('certificationCourses')
      .innerJoin('courses', 'courses.id', 'certificationCourses.courseId')
      .select(['courses.id as id', 'courses.title as title'])
      .where('certificationCourses.certificationId', '=', certificationId)
      .execute();
    const exams = await query
      .selectFrom('certificationExams')
      .innerJoin('exams', 'exams.id', 'certificationExams.examId')
      .select(['exams.id as id', 'exams.title as title'])
      .where('certificationExams.certificationId', '=', certificationId)
      .execute();
    return {
      courses: courses.map((c) => ({
        id: String(c.id),
        title: String(c.title),
      })),
      exams: exams.map((e) => ({ id: String(e.id), title: String(e.title) })),
    };
  }

  /** When the employee last completed a course: its completed assignment, or the last lesson once every lesson is done. */
  async function courseCompletedAt(
    employeeId: string,
    courseId: string,
    connection?: DatabaseConnection,
  ): Promise<number> {
    const query = connection ? connection.query : database.query();
    const assignment = await query
      .selectFrom('assignments')
      .select(['completedAt'])
      .where('employeeId', '=', employeeId)
      .where('courseId', '=', courseId)
      .where('status', '=', 'completed')
      .orderBy('completedAt', 'desc')
      .executeTakeFirst();
    let latest = assignment ? isoTime(assignment.completedAt) : 0;
    const lessons = await query
      .selectFrom('lessons')
      .select(['id'])
      .where('courseId', '=', courseId)
      .execute();
    if (lessons.length) {
      const records = await query
        .selectFrom('learningRecords')
        .select(['lessonId', 'completedAt'])
        .where('employeeId', '=', employeeId)
        .where('courseId', '=', courseId)
        .execute();
      const done = new Map(
        records
          .filter((r) => r.completedAt)
          .map((r) => [String(r.lessonId), isoTime(r.completedAt)]),
      );
      if (lessons.every((l) => done.has(String(l.id))))
        latest = Math.max(
          latest,
          ...lessons.map((l) => done.get(String(l.id))!),
        );
    }
    return latest;
  }

  async function examPassedAt(
    employeeId: string,
    examId: string,
    connection?: DatabaseConnection,
  ): Promise<number> {
    const row = await (connection ? connection.query : database.query())
      .selectFrom('examAttempts')
      .select(['submittedAt', 'updatedAt'])
      .where('employeeId', '=', employeeId)
      .where('examId', '=', examId)
      .where('status', '=', 'passed')
      .orderBy('updatedAt', 'desc')
      .executeTakeFirst();
    return row ? Math.max(isoTime(row.submittedAt), isoTime(row.updatedAt)) : 0;
  }

  async function requirementStatus(
    employeeId: string,
    certificationId: string,
    since = 0,
  ): Promise<RequirementStatus> {
    const requirements = await requirementsOf(certificationId);
    return {
      courses: await Promise.all(
        requirements.courses.map(async (c) => ({
          ...c,
          done: (await courseCompletedAt(employeeId, c.id)) > since,
        })),
      ),
      exams: await Promise.all(
        requirements.exams.map(async (e) => ({
          ...e,
          done: (await examPassedAt(employeeId, e.id)) > since,
        })),
      ),
    };
  }

  async function toCertificateViews(
    rows: readonly Record<string, unknown>[],
  ): Promise<CertificateView[]> {
    if (!rows.length) return [];
    const query = database.query();
    const employeeIds = [...new Set(rows.map((r) => String(r.employeeId)))];
    const employees = new Map(
      (
        await query
          .selectFrom('employees')
          .select(['id', 'name', 'departmentId'])
          .where('id', 'in', employeeIds)
          .execute()
      ).map((e) => [String(e.id), e]),
    );
    const certificationIds = [
      ...new Set(rows.map((r) => String(r.certificationId))),
    ];
    const certificationRows = await query
      .selectFrom('certifications')
      .select(['id', 'title', 'issuingAuthority'])
      .where('id', 'in', certificationIds)
      .execute();
    const titles = new Map(
      certificationRows.map((c) => [String(c.id), String(c.title)]),
    );
    const authorities = new Map(
      certificationRows.map((c) => [
        String(c.id),
        c.issuingAuthority == null ? null : str(c.issuingAuthority),
      ]),
    );
    const nullable = (value: unknown) => (value == null ? null : str(value));
    return rows.map((row) => {
      const employee = employees.get(String(row.employeeId));
      return {
        id: String(row.id),
        employeeId: String(row.employeeId),
        employeeName: employee ? String(employee.name) : '',
        departmentId: employee ? String(employee.departmentId) : '',
        certificationId: String(row.certificationId),
        certificationTitle: titles.get(String(row.certificationId)) ?? '',
        certificateNo: String(row.certificateNo),
        issuedAt: dateOnly(row.issuedAt)!,
        expiresAt: dateOnly(row.expiresAt),
        status: String(row.status),
        revokedReason:
          row.revokedReason == null ? null : str(row.revokedReason),
        supersededById:
          row.supersededById == null ? null : str(row.supersededById),
        source: str(row.source ?? 'internal'),
        externalNo: nullable(row.externalNo),
        attachmentFileId: nullable(row.attachmentFileId),
        verifyStatus: nullable(row.verifyStatus),
        verifyNote: nullable(row.verifyNote),
        verifiedAt:
          row.verifiedAt == null
            ? null
            : new Date(str(row.verifiedAt)).toISOString(),
        issuingAuthority: authorities.get(String(row.certificationId)) ?? null,
      };
    });
  }

  async function toSummaries(
    rows: readonly Record<string, unknown>[],
  ): Promise<CertificationSummary[]> {
    const query = database.query();
    const result: CertificationSummary[] = [];
    for (const row of rows) {
      const id = String(row.id);
      const requirements = await requirementsOf(id);
      const holders = await query
        .selectFrom('employeeCertificates')
        .select(['id', 'status'])
        .where('certificationId', '=', id)
        .where('status', 'in', [...HOLDING_STATUSES])
        .execute();
      const position = row.qualifiesPositionId
        ? await query
            .selectFrom('positions')
            .select(['title'])
            .where('id', '=', str(row.qualifiesPositionId))
            .executeTakeFirst()
        : undefined;
      const competency = row.competencyId
        ? await query
            .selectFrom('competencies')
            .select(['title'])
            .where('id', '=', str(row.competencyId))
            .executeTakeFirst()
        : undefined;
      result.push({
        id,
        code: String(row.code),
        title: String(row.title),
        description: row.description == null ? null : str(row.description),
        validityMonths:
          row.validityMonths == null ? null : Number(row.validityMonths),
        competencyId: row.competencyId == null ? null : str(row.competencyId),
        competencyTitle: competency ? String(competency.title) : null,
        competencyLevel:
          row.competencyLevel == null ? null : Number(row.competencyLevel),
        expiringNoticeDays: Number(row.expiringNoticeDays ?? 30),
        recertAdvanceDays: Number(row.recertAdvanceDays ?? 60),
        escalateDays: Number(row.escalateDays ?? 7),
        recertMode: str(row.recertMode ?? 'examOnly'),
        active: bool(row.active),
        courses: requirements.courses,
        exams: requirements.exams,
        holderCount: holders.length,
        kind: row.kind === 'external' ? 'external' : 'internal',
        issuingAuthority:
          row.issuingAuthority == null ? null : str(row.issuingAuthority),
        qualifiesPositionId:
          row.qualifiesPositionId == null ? null : str(row.qualifiesPositionId),
        qualifiesPositionTitle: position ? str(position.title) : null,
        validCount: holders.filter((h) => h.status === 'valid').length,
        expiringCount: holders.filter((h) => h.status === 'expiring').length,
      });
    }
    return result;
  }

  async function refreshSession(userId: string | null): Promise<void> {
    if (userId)
      await authz.permissionSets.notifyAssignmentsChanged({
        type: 'user',
        id: userId,
      });
  }

  async function writeCompetency(
    employeeId: string,
    competencyId: string,
    level: number,
    evidence: string,
  ): Promise<void> {
    const stamp = new Date();
    await database
      .query()
      .insertInto('employeeCompetencies')
      .values({
        id: newId(),
        employeeId,
        competencyId,
        level,
        source: 'certificate',
        evidence,
        assessedBy: 'system',
        assessedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
  }

  /** Issues (or renews) one certificate and answers its id. */
  async function issue(
    employee: EmployeeSummary,
    certification: Record<string, unknown>,
    evidence: Record<string, unknown>,
  ): Promise<string | undefined> {
    const today = platform.currentDate();
    const validity =
      certification.validityMonths == null
        ? null
        : Number(certification.validityMonths);
    const code = String(certification.code).toUpperCase();
    const year = today.slice(0, 4);
    const result = await database.transaction(async (connection) => {
      const current = await connection.query
        .selectFrom('employeeCertificates')
        .selectAll()
        .where('employeeId', '=', employee.id)
        .where('certificationId', '=', String(certification.id))
        .where('status', 'in', [...HOLDING_STATUSES])
        .executeTakeFirst();
      // Renewing early costs nothing: the new period starts where the old one ends.
      const base =
        current && current.expiresAt ? dateOnly(current.expiresAt)! : today;
      const expiresAt =
        validity === null ? null : addMonths(current ? base : today, validity);
      const count = await connection.query
        .selectFrom('employeeCertificates')
        .select(['id'])
        .where('certificationId', '=', String(certification.id))
        .execute();
      let sequence = count.length + 1;
      let certificateNo = `${code}-${year}-${String(sequence).padStart(5, '0')}`;
      while (
        await connection.query
          .selectFrom('employeeCertificates')
          .select(['id'])
          .where('certificateNo', '=', certificateNo)
          .executeTakeFirst()
      ) {
        sequence += 1;
        certificateNo = `${code}-${year}-${String(sequence).padStart(5, '0')}`;
      }
      const id = newId();
      const stamp = new Date();
      await connection.query
        .insertInto('employeeCertificates')
        .values({
          id,
          employeeId: employee.id,
          certificationId: String(certification.id),
          certificateNo,
          issuedAt: today,
          expiresAt,
          status: 'valid',
          source: 'internal',
          revokedReason: null,
          evidence: JSON.stringify(evidence),
          supersededById: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      if (current) {
        await connection.query
          .updateTable('employeeCertificates')
          .set({ status: 'superseded', supersededById: id, updatedAt: stamp })
          .where('id', '=', String(current.id))
          .where('status', 'in', [...HOLDING_STATUSES])
          .execute();
      }
      // A finished recertification closes its assignments.
      await connection.query
        .updateTable('assignments')
        .set({
          status: 'completed',
          progress: 100,
          completedAt: stamp,
          updatedAt: stamp,
        })
        .where('employeeId', '=', employee.id)
        .where('source', '=', 'recertification')
        .where('certificateId', '=', current ? String(current.id) : '__none__')
        .where('status', 'in', ['notStarted', 'inProgress', 'overdue'])
        .execute();
      return { id, certificateNo, expiresAt, renewed: Boolean(current) };
    });
    if (certification.competencyId && certification.competencyLevel != null) {
      await writeCompetency(
        employee.id,
        str(certification.competencyId),
        Number(certification.competencyLevel),
        `取得证书《${String(certification.title)}》`,
      );
    }
    await refreshSession(employee.userId);
    const head = await platform.headOf(employee);
    const recipients = [employee.userId, head].filter((v): v is string =>
      Boolean(v),
    );
    // V4-14: a first certificate names the permission sets it brings (industry pack on).
    const gained = result.renewed
      ? []
      : await lostSets(String(certification.id));
    if (recipients.length)
      await notify({
        key: `certificate:${result.id}:issued`,
        userIds: recipients,
        message: result.renewed
          ? 'certificateRenewed'
          : gained.length
            ? 'certificateIssuedWithSets'
            : 'certificateIssued',
        params: {
          name: employee.name,
          title: String(certification.title),
          no: result.certificateNo,
          date: result.expiresAt ?? '—',
          sets: gained.join('、') || '—',
        },
        path: '/talent/me',
      });
    // V3-10 任职资格: the certification steward prepares the qualification material.
    if (certification.qualifiesPositionId) deps.onQualified?.()?.(result.id);
    return result.id;
  }

  async function assertCertificationVisible(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, CERTIFICATION, 'view');
    const row = (await database
      .repository('certifications')
      .withPolicy(policyOf(policies, 'certifications'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('CERTIFICATION_NOT_FOUND', 404);
    return row;
  }

  const service: CertificationService = {
    async listCertifications(ctx) {
      const policies = await authorizeAction(ctx.authz, CERTIFICATION, 'view');
      const canManage = await platform.can(ctx, CERTIFICATION, 'manage');
      const rows = (await database
        .repository('certifications')
        .withPolicy(policyOf(policies, 'certifications'))
        .findMany({
          filter: (f) => f.and(canManage ? [] : [f.boolean('active').isTrue()]),
          sort: (s) => [s.field('code').asc()],
        })) as Record<string, unknown>[];
      return { items: await toSummaries(rows), canManage };
    },

    async getCertification(ctx, id) {
      const row = await assertCertificationVisible(ctx, id).catch(
        (error: unknown) => {
          if (error instanceof HrError && error.status === 404)
            return undefined;
          throw error;
        },
      );
      if (!row) return undefined;
      const canManage = await platform.can(ctx, CERTIFICATION, 'manage');
      if (!bool(row.active) && !canManage) return undefined;
      const [summary] = await toSummaries([row]);
      const employee = await platform.employeeOfUser(ctx.userId);
      let mine: CertificationDetail['mine'] = null;
      if (employee) {
        const own = await database
          .query()
          .selectFrom('employeeCertificates')
          .selectAll()
          .where('employeeId', '=', employee.id)
          .where('certificationId', '=', id)
          .orderBy('issuedAt', 'desc')
          .executeTakeFirst();
        // 认证要求 · 你的进度 shows what has been done toward this certification, before or after a
        // certificate was issued: a holder's completed course and passed exam stay ticked. Renewal
        // progress has its own record (复审任务), so it is not measured from the issue date here.
        mine = {
          requirements: await requirementStatus(employee.id, id, 0),
          certificate: own ? (await toCertificateViews([own]))[0] : null,
        };
      }
      const certificatePolicies = await tryAuthorizeAction(
        ctx.authz,
        CERTIFICATE,
        'view',
      );
      const holders =
        canManage && certificatePolicies
          ? await toCertificateViews(
              await database
                .repository('employeeCertificates')
                .withPolicy(
                  policyOf(certificatePolicies, 'employeeCertificates'),
                )
                .findMany({
                  filter: { certificationId: id },
                  sort: (s) => [s.field('issuedAt').desc()],
                }),
            )
          : null;
      // Permission sets assigned to this certification: their titles for managers, and the pages they open for
      // everyone, so a holder can find what the certificate unlocks.
      const assigned: { key: string; title: string; pages: string[] }[] = [];
      for (const set of (await licensed())
        ? await authz.permissionSets.list()
        : []) {
        const assignments = await authz.permissionSets.listAssignments(set.key);
        if (
          assignments.some(
            (a) =>
              a.subject.type === CERTIFICATION_SUBJECT && a.subject.id === id,
          )
        )
          assigned.push({
            key: set.key,
            title: deps.titleText(set.title),
            pages: set.grants
              .filter((grant) => grant.resource.type === 'page')
              .map((grant) => grant.resource.id),
          });
      }
      const granted = canManage
        ? assigned.map(({ key, title }) => ({ key, title }))
        : null;
      return {
        ...summary,
        mine,
        holders,
        grantedPermissionSets: granted,
        grantedPages: [...new Set(assigned.flatMap((set) => set.pages))],
        can: {
          manage: canManage,
          revoke: await platform.can(ctx, CERTIFICATE, 'revoke'),
        },
      };
    },

    async saveCertification(ctx, id, input) {
      const policies = await authorizeAction(
        ctx.authz,
        CERTIFICATION,
        'manage',
      );
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const optionalInt = (
        value: unknown,
        code: string,
        min: number,
        max: number,
      ) => {
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max)
          throw new HrError(code, 400);
        return n;
      };
      const values = {
        code: requireString(input.code, 'CERTIFICATION_CODE_REQUIRED', {
          max: 32,
        })!,
        title: requireString(input.title, 'CERTIFICATION_TITLE_REQUIRED', {
          max: 200,
        })!,
        description: requireString(input.description, 'INVALID_INPUT', {
          optional: true,
          max: 4000,
        }),
        validityMonths: optionalInt(
          input.validityMonths,
          'CERTIFICATION_VALIDITY_INVALID',
          1,
          240,
        ),
        competencyId: requireString(input.competencyId, 'INVALID_INPUT', {
          optional: true,
          max: 64,
        }),
        competencyLevel: optionalInt(
          input.competencyLevel,
          'INVALID_INPUT',
          0,
          5,
        ),
        certificateTemplate: requireString(
          input.certificateTemplate,
          'INVALID_INPUT',
          { optional: true, max: 100 },
        ),
        expiringNoticeDays:
          optionalInt(input.expiringNoticeDays, 'INVALID_INPUT', 1, 365) ?? 30,
        recertAdvanceDays:
          optionalInt(input.recertAdvanceDays, 'INVALID_INPUT', 0, 365) ?? 60,
        escalateDays:
          optionalInt(input.escalateDays, 'INVALID_INPUT', 0, 365) ?? 7,
        recertMode: requireEnum(
          input.recertMode ?? 'examOnly',
          ['examOnly', 'full'] as const,
          'INVALID_INPUT',
        ),
        kind: requireEnum(
          input.kind ?? 'internal',
          ['internal', 'external'] as const,
          'INVALID_INPUT',
        ),
        issuingAuthority: requireString(
          input.issuingAuthority,
          'INVALID_INPUT',
          {
            optional: true,
            max: 200,
          },
        ),
        qualifiesPositionId: requireString(
          input.qualifiesPositionId,
          'INVALID_INPUT',
          { optional: true, max: 64 },
        ),
      };
      if (!/^[A-Za-z0-9-]+$/u.test(values.code))
        throw new HrError('CERTIFICATION_CODE_INVALID', 400);
      const courseIds = ids(input.courseIds);
      const examIds = ids(input.examIds);
      // An external certificate type has no courses or exams: it is registered with a scan and verified by HR.
      if (values.kind === 'external') {
        if (courseIds.length || examIds.length)
          throw new HrError('CERTIFICATION_EXTERNAL_REQUIREMENTS', 400);
        if (values.qualifiesPositionId) throw new HrError('INVALID_INPUT', 400);
      } else if (!courseIds.length && !examIds.length)
        throw new HrError('CERTIFICATION_REQUIREMENTS_REQUIRED', 400);
      const query = database.query();
      if (
        values.qualifiesPositionId &&
        !(await query
          .selectFrom('positions')
          .select(['id'])
          .where('id', '=', values.qualifiesPositionId)
          .executeTakeFirst())
      )
        throw new HrError('POSITION_NOT_FOUND', 404);
      if (
        courseIds.length &&
        (
          await query
            .selectFrom('courses')
            .select(['id'])
            .where('id', 'in', courseIds)
            .execute()
        ).length !== courseIds.length
      )
        throw new HrError('COURSE_NOT_FOUND', 404);
      if (
        examIds.length &&
        (
          await query
            .selectFrom('exams')
            .select(['id'])
            .where('id', 'in', examIds)
            .execute()
        ).length !== examIds.length
      )
        throw new HrError('EXAM_NOT_FOUND', 404);
      if (
        values.competencyId &&
        !(await query
          .selectFrom('competencies')
          .select(['id'])
          .where('id', '=', values.competencyId)
          .executeTakeFirst())
      )
        throw new HrError('COMPETENCY_NOT_FOUND', 404);
      const clash = await query
        .selectFrom('certifications')
        .select(['id'])
        .where('code', '=', values.code)
        .executeTakeFirst();
      if (clash && String(clash.id) !== id)
        throw new HrError('CERTIFICATION_CODE_TAKEN', 409);
      const certificationId = id ?? newId();
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('certifications')
          .withPolicy(policyOf(policies, 'certifications'));
        const stamp = new Date();
        if (id) {
          if (!(await repo.findOne({ filter: { id } })))
            throw new HrError('CERTIFICATION_NOT_FOUND', 404);
          await repo.updateOne({
            filter: { id },
            values: { ...values, updatedAt: stamp },
          });
        } else {
          await repo.createOne({
            values: {
              id: certificationId,
              ...values,
              active: true,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        }
        for (const [table, column, wanted] of [
          ['certificationCourses', 'courseId', courseIds],
          ['certificationExams', 'examId', examIds],
        ] as const) {
          const links = connection
            .repository(table)
            .withPolicy(policyOf(policies, table));
          const existing = (await links.findMany({
            filter: { certificationId },
          })) as Record<string, unknown>[];
          for (const row of existing)
            if (!wanted.includes(String(row[column])))
              await links.deleteOne({ filter: { id: String(row.id) } });
          const present = new Set(existing.map((row) => String(row[column])));
          for (const target of wanted)
            if (!present.has(target))
              await links.createOne({
                values: {
                  id: newId(),
                  certificationId,
                  [column]: target,
                  createdAt: stamp,
                  updatedAt: stamp,
                },
              });
        }
      });
      return (await service.getCertification(ctx, certificationId))!;
    },

    async setCertificationActive(ctx, id, active) {
      const policies = await authorizeAction(
        ctx.authz,
        CERTIFICATION,
        'manage',
      );
      const repo = database
        .repository('certifications')
        .withPolicy(policyOf(policies, 'certifications'));
      if (!(await repo.findOne({ filter: { id } })))
        throw new HrError('CERTIFICATION_NOT_FOUND', 404);
      await repo.updateOne({
        filter: { id },
        values: { active, updatedAt: new Date() },
      });
      // Holders gain or lose what the certification grants.
      const holders = await database
        .query()
        .selectFrom('employeeCertificates')
        .innerJoin(
          'employees',
          'employees.id',
          'employeeCertificates.employeeId',
        )
        .select(['employees.userId as userId'])
        .where('employeeCertificates.certificationId', '=', id)
        .where('employeeCertificates.status', 'in', [...HOLDING_STATUSES])
        .execute();
      for (const holder of holders)
        await refreshSession(holder.userId == null ? null : str(holder.userId));
      return (await service.getCertification(ctx, id))!;
    },

    async listCertificates(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, CERTIFICATE, 'view');
      const rows = (await database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'))
        .findMany({
          filter: (f) =>
            f.and([
              ...(filters.employeeId
                ? [f.string('employeeId').eq(filters.employeeId)]
                : []),
              ...(filters.certificationId
                ? [f.string('certificationId').eq(filters.certificationId)]
                : []),
              ...(filters.status
                ? [f.string('status').eq(filters.status)]
                : []),
            ]),
          sort: (s) => [s.field('issuedAt').desc()],
        })) as Record<string, unknown>[];
      return toCertificateViews(rows);
    },

    async revokeCertificate(ctx, id, reasonInput) {
      const policies = await authorizeAction(ctx.authz, CERTIFICATE, 'revoke');
      const reason = requireString(reasonInput, 'REVOKE_REASON_REQUIRED', {
        max: 1000,
      });
      if (!reason) throw new HrError('REVOKE_REASON_REQUIRED', 400);
      const repo = database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'));
      const row = (await repo.findOne({ filter: { id } })) as
        Record<string, unknown> | undefined;
      if (!row) throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      if (!(HOLDING_STATUSES as readonly string[]).includes(String(row.status)))
        throw new HrError('CERTIFICATE_NOT_VALID', 409);
      await repo.updateOne({
        filter: { id, status: String(row.status) },
        values: {
          status: 'revoked',
          revokedReason: reason,
          updatedAt: new Date(),
        },
      });
      const certification = await certificationRow(String(row.certificationId));
      const employee = await platform.employee(String(row.employeeId));
      if (certification?.competencyId)
        await writeCompetency(
          String(row.employeeId),
          str(certification.competencyId),
          0,
          `证书《${String(certification.title)}》已吊销：${reason}`,
        );
      await refreshSession(employee?.userId ?? null);
      if (employee?.userId) {
        // Permissions are mentioned only with the V4-14 industry pack on.
        const sets = await lostSets(String(row.certificationId));
        await notify({
          key: `certificate:${id}:revoked`,
          userIds: [employee.userId],
          message: sets.length
            ? 'certificateRevoked'
            : 'certificateRevokedNotice',
          params: {
            title: str(certification?.title ?? ''),
            reason,
            sets: sets.join('、') || '—',
          },
          path: '/talent/me',
        });
      }
      const [view] = await toCertificateViews([
        (await repo.findOne({ filter: { id } })) as Record<string, unknown>,
      ]);
      return view;
    },

    async certificateDocument(ctx, id, locale) {
      const policies = await authorizeAction(
        ctx.authz,
        CERTIFICATE,
        'download',
      );
      const row = (await database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      const [view] = await toCertificateViews([row]);
      const english = locale.startsWith('en');
      const labels = english
        ? {
            heading: 'Certificate',
            holder: 'Holder',
            no: 'Certificate no.',
            issued: 'Issued',
            expires: 'Expires',
            never: 'Does not expire',
            status: 'Status',
            print: 'Print / save as PDF',
          }
        : {
            heading: '资格证书',
            holder: '持证人',
            no: '证书编号',
            issued: '发证日期',
            expires: '有效期至',
            never: '长期有效',
            status: '状态',
            print: '打印 / 另存为 PDF',
          };
      const statusText: Record<string, string> = english
        ? {
            valid: 'Valid',
            expiring: 'Expiring soon',
            expired: 'Expired',
            revoked: 'Revoked',
            superseded: 'Replaced',
          }
        : {
            valid: '有效',
            expiring: '即将到期',
            expired: '已过期',
            revoked: '已吊销',
            superseded: '已换发',
          };
      const v = view;
      const company = escapeHtml(deps.companyName());
      return `<!doctype html>
<html lang="${english ? 'en' : 'zh-CN'}">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(v.certificationTitle)} · ${escapeHtml(v.certificateNo)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Inter", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2430; background: #f4f5f8; }
  .sheet { width: 297mm; height: 210mm; margin: 12px auto; background: #fff; padding: 22mm 26mm; position: relative; border: 10px solid #eef0fb; }
  .frame { position: absolute; inset: 12mm; border: 1.5px solid #5b5fd6; border-radius: 6px; }
  .company { font-size: 16px; letter-spacing: .2em; color: #5b5fd6; text-transform: uppercase; }
  h1 { font-size: 44px; margin: 14mm 0 4mm; letter-spacing: .3em; font-weight: 700; }
  .title { font-size: 26px; font-weight: 600; margin-bottom: 12mm; }
  .name { font-size: 34px; font-weight: 700; border-bottom: 1px solid #c9cce8; display: inline-block; min-width: 90mm; padding-bottom: 2mm; }
  dl { display: grid; grid-template-columns: repeat(3, auto); gap: 4mm 18mm; margin-top: 14mm; font-size: 15px; }
  dt { color: #6b7080; font-size: 12px; }
  dd { margin: 1mm 0 0; font-weight: 600; }
  .stamp { position: absolute; right: 30mm; bottom: 26mm; width: 44mm; height: 44mm; border: 3px solid #c0392b; border-radius: 50%; color: #c0392b; display: flex; align-items: center; justify-content: center; text-align: center; font-weight: 700; transform: rotate(-12deg); font-size: 14px; padding: 6mm; }
  .toolbar { text-align: center; margin: 12px; }
  .toolbar button { font: inherit; padding: 8px 16px; border-radius: 6px; border: 1px solid #5b5fd6; background: #5b5fd6; color: #fff; cursor: pointer; }
  @media print { body { background: #fff; } .sheet { margin: 0; border: 0; } .toolbar { display: none; } }
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">${labels.print}</button></div>
<div class="sheet">
  <div class="frame"></div>
  <div class="company">${company}</div>
  <h1>${labels.heading}</h1>
  <div class="title">${escapeHtml(v.certificationTitle)}</div>
  <div><span style="color:#6b7080;font-size:13px">${labels.holder}</span><br /><span class="name">${escapeHtml(v.employeeName)}</span></div>
  <dl>
    <div><dt>${labels.no}</dt><dd>${escapeHtml(v.certificateNo)}</dd></div>
    <div><dt>${labels.issued}</dt><dd>${escapeHtml(v.issuedAt)}</dd></div>
    <div><dt>${labels.expires}</dt><dd>${escapeHtml(v.expiresAt ?? labels.never)}</dd></div>
    <div><dt>${labels.status}</dt><dd>${escapeHtml(statusText[v.status] ?? v.status)}</dd></div>
  </dl>
  <div class="stamp">${company}<br />${english ? 'Training Center' : '培训中心'}</div>
</div>
</body>
</html>`;
    },

    async evaluate(employeeId) {
      const employee = await platform.employee(employeeId);
      if (!employee || employee.status === 'leave') return [];
      const issued: string[] = [];
      const certifications = await database
        .query()
        .selectFrom('certifications')
        .selectAll()
        .where('active', '=', true)
        .execute();
      for (const certification of certifications) {
        const id = String(certification.id);
        // External certificates are never issued here.
        if (certification.kind === 'external') continue;
        const requirements = await requirementsOf(id);
        if (!requirements.courses.length && !requirements.exams.length)
          continue;
        const latest = await database
          .query()
          .selectFrom('employeeCertificates')
          .selectAll()
          .where('employeeId', '=', employee.id)
          .where('certificationId', '=', id)
          .orderBy('createdAt', 'desc')
          .executeTakeFirst();
        let since = 0;
        let courses = requirements.courses;
        if (latest) {
          // After a certificate, only newer evidence counts: the recertification mode's parts, done after it was issued or revoked.
          since = isoTime(
            latest.status === 'revoked' ? latest.updatedAt : latest.createdAt,
          );
          if (
            str(certification.recertMode ?? 'examOnly') === 'examOnly' &&
            requirements.exams.length
          )
            courses = [];
        }
        const coursesDone = await Promise.all(
          courses.map(
            async (c) => (await courseCompletedAt(employee.id, c.id)) > since,
          ),
        );
        const examsDone = await Promise.all(
          requirements.exams.map(
            async (e) => (await examPassedAt(employee.id, e.id)) > since,
          ),
        );
        if (![...coursesDone, ...examsDone].every(Boolean)) continue;
        // V4-13: the practical assessments the certification requires (发证与复审续发).
        const gate = await deps.practicalGate?.()?.(
          employee.id,
          id,
          latest && latest.status !== 'revoked' ? 'recert' : 'initial',
        );
        if (gate && !gate.ok) continue;
        // The evidence names the records that met each requirement: completed course assignments and passed attempts.
        const assignmentIds: string[] = [];
        for (const course of courses) {
          const done = await database
            .query()
            .selectFrom('assignments')
            .select(['id'])
            .where('employeeId', '=', employee.id)
            .where('courseId', '=', course.id)
            .where('status', '=', 'completed')
            .orderBy('completedAt', 'desc')
            .executeTakeFirst();
          if (done) assignmentIds.push(str(done.id));
        }
        const attemptIds: string[] = [];
        for (const exam of requirements.exams) {
          const passed = await database
            .query()
            .selectFrom('examAttempts')
            .select(['id'])
            .where('employeeId', '=', employee.id)
            .where('examId', '=', exam.id)
            .where('status', '=', 'passed')
            .orderBy('updatedAt', 'desc')
            .executeTakeFirst();
          if (passed) attemptIds.push(str(passed.id));
        }
        const evidence = {
          assignmentIds,
          attemptIds,
          courseIds: courses.map((c) => c.id),
          examIds: requirements.exams.map((e) => e.id),
          // V4-13
          ...(gate?.recordIds.length ? { practicalRecordIds: gate.recordIds } : {}),
          at: new Date().toISOString(),
        };
        const certificateId = await issue(employee, certification, evidence);
        if (certificateId) issued.push(certificateId);
      }
      return issued;
    },

    async heldCertificationIds(userId) {
      // V4-14: with the industry pack off, certificates grant nothing.
      if (!(await licensed())) return [];
      const rows = await database
        .query()
        .selectFrom('employeeCertificates')
        .innerJoin(
          'employees',
          'employees.id',
          'employeeCertificates.employeeId',
        )
        .innerJoin(
          'certifications',
          'certifications.id',
          'employeeCertificates.certificationId',
        )
        .select(['employeeCertificates.certificationId as certificationId'])
        .where('employees.userId', '=', userId)
        .where('employees.status', '!=', 'leave')
        .where('employeeCertificates.status', 'in', [...HOLDING_STATUSES])
        .where('certifications.active', '=', true)
        .execute();
      return [...new Set(rows.map((r) => String(r.certificationId)))];
    },

    async activeCertificationIds(list, connection) {
      if (!list.length) return [];
      const rows = await (connection ? connection.query : database.query())
        .selectFrom('certifications')
        .select(['id'])
        .where('active', '=', true)
        .where('id', 'in', [...list])
        .execute();
      return rows.map((r) => String(r.id));
    },

    async subjectOptions({ search, page, pageSize }) {
      const rows = await database
        .query()
        .selectFrom('certifications')
        .select(['id', 'code', 'title'])
        .where('active', '=', true)
        .orderBy('code', 'asc')
        .execute();
      const filtered = rows.filter(
        (row) =>
          !search ||
          String(row.title).toLowerCase().includes(search.toLowerCase()) ||
          String(row.code).toLowerCase().includes(search.toLowerCase()),
      );
      const start = (Math.max(page, 1) - 1) * pageSize;
      return {
        items: filtered.slice(start, start + pageSize).map((row) => ({
          id: String(row.id),
          title: String(row.title),
          description: String(row.code),
        })),
        total: filtered.length,
      };
    },

    async resolveSubjects(list) {
      if (!list.length) return [];
      const rows = await database
        .query()
        .selectFrom('certifications')
        .select(['id', 'code', 'title'])
        .where('id', 'in', [...list])
        .execute();
      return rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        description: String(row.code),
      }));
    },

    async grantedSetTitles(certificationId) {
      // V4-14: with the industry pack off a certificate grants nothing, so there is nothing to lose.
      if (!(await licensed())) return [];
      const titles: string[] = [];
      for (const set of await authz.permissionSets.list()) {
        const assignments = await authz.permissionSets.listAssignments(set.key);
        if (
          assignments.some(
            (a) =>
              a.subject.type === CERTIFICATION_SUBJECT &&
              a.subject.id === certificationId,
          )
        )
          titles.push(deps.titleText(set.title));
      }
      return titles;
    },

    async runDaily(asOf) {
      const today = asOf ?? platform.currentDate();
      const report: CertificationDailyReport = {
        recertAssigned: 0,
        expiringCertificates: 0,
        expiredCertificates: 0,
      };
      const rows = await database
        .query()
        .selectFrom('employeeCertificates')
        .innerJoin(
          'certifications',
          'certifications.id',
          'employeeCertificates.certificationId',
        )
        .select([
          'employeeCertificates.id as id',
          'employeeCertificates.employeeId as employeeId',
          'employeeCertificates.certificationId as certificationId',
          'employeeCertificates.expiresAt as expiresAt',
          'employeeCertificates.status as status',
          'certifications.title as title',
          'certifications.expiringNoticeDays as expiringNoticeDays',
          'certifications.recertAdvanceDays as recertAdvanceDays',
          'certifications.recertMode as recertMode',
          'certifications.kind as kind',
        ])
        .where('employeeCertificates.status', 'in', [...HOLDING_STATUSES])
        .where('employeeCertificates.expiresAt', 'is not', null)
        .execute();
      for (const row of rows) {
        const employee = await platform.employee(String(row.employeeId));
        if (!employee || employee.status === 'leave') continue;
        const expiresAt = dateOnly(row.expiresAt)!;
        const days = daysBetween(today, expiresAt);
        const head = await platform.headOf(employee);
        const recipients = [employee.userId, head].filter((v): v is string =>
          Boolean(v),
        );
        const title = String(row.title);
        if (days < 0) {
          await database
            .query()
            .updateTable('employeeCertificates')
            .set({ status: 'expired', updatedAt: new Date() })
            .where('id', '=', String(row.id))
            .where('status', 'in', [...HOLDING_STATUSES])
            .execute();
          report.expiredCertificates += 1;
          await refreshSession(employee.userId);
          // "到期后不再计入有效持证"; lost permissions only with the industry pack on.
          const lost = await lostSets(String(row.certificationId));
          const sets = lost.join('、') || '—';
          if (recipients.length)
            await platform.reminderOnce(
              `certificate:${String(row.id)}:expired`,
              () =>
                notify({
                  key: `certificate:${String(row.id)}:expired`,
                  userIds: recipients,
                  message: lost.length
                    ? 'certificateExpiredWithSets'
                    : 'certificateExpiredNotice',
                  params: { name: employee.name, title, date: expiresAt, sets },
                  path: '/talent/me',
                }),
            );
          continue;
        }
        const external = row.kind === 'external';
        const advance = Number(row.recertAdvanceDays ?? 60);
        // External certificates are never renewed here: the holder is only reminded to register the new one.
        if (!external && advance > 0 && days <= advance) {
          const open = await database
            .query()
            .selectFrom('assignments')
            .select(['id'])
            .where('certificateId', '=', String(row.id))
            .where('status', 'in', ['notStarted', 'inProgress', 'overdue'])
            .executeTakeFirst();
          if (!open) {
            const requirements = await requirementsOf(
              String(row.certificationId),
            );
            const courses =
              str(row.recertMode ?? 'examOnly') === 'full' ||
              !requirements.exams.length
                ? requirements.courses
                : [];
            const stamp = new Date();
            for (const target of [
              ...courses.map((c) => ({ courseId: c.id, examId: null })),
              ...requirements.exams.map((e) => ({
                courseId: null,
                examId: e.id,
              })),
            ]) {
              await database
                .query()
                .insertInto('assignments')
                .values({
                  id: newId(),
                  employeeId: employee.id,
                  courseId: target.courseId,
                  examId: target.examId,
                  certificateId: String(row.id),
                  assignedByUserId: null,
                  dueDate: expiresAt,
                  status: 'notStarted',
                  progress: 0,
                  source: 'recertification',
                  completedAt: null,
                  cancelledAt: null,
                  lastRemindedAt: null,
                  createdAt: stamp,
                  updatedAt: stamp,
                })
                .execute();
            }
            report.recertAssigned += 1;
            if (employee.userId)
              await platform.reminderOnce(
                `certificate:${String(row.id)}:recert`,
                () =>
                  notify({
                    key: `certificate:${String(row.id)}:recert`,
                    userIds: [employee.userId!],
                    message: 'recertificationAssigned',
                    params: { title, date: expiresAt },
                    path: '/talent/my-exams',
                  }),
              );
          }
        }
        if (
          row.status === 'valid' &&
          days <= Number(row.expiringNoticeDays ?? 30)
        ) {
          await database
            .query()
            .updateTable('employeeCertificates')
            .set({ status: 'expiring', updatedAt: new Date() })
            .where('id', '=', String(row.id))
            .where('status', '=', 'valid')
            .execute();
          report.expiringCertificates += 1;
          if (external) {
            if (employee.userId)
              await platform.reminderOnce(
                `certificate:${String(row.id)}:expiring`,
                () =>
                  notify({
                    key: `certificate:${String(row.id)}:expiring`,
                    userIds: [employee.userId!],
                    message: 'externalCertificateExpiring',
                    params: { title, date: expiresAt },
                    path: '/talent/certifications',
                  }),
              );
          } else if (recipients.length) {
            // V4-14: "到期后将不能使用：……" when the certificate brings permissions.
            const losing = await lostSets(String(row.certificationId));
            await platform.reminderOnce(
              `certificate:${String(row.id)}:expiring`,
              () =>
                notify({
                  key: `certificate:${String(row.id)}:expiring`,
                  userIds: recipients,
                  message: losing.length
                    ? 'certificateExpiringWithSets'
                    : 'certificateExpiring',
                  params: {
                    name: employee.name,
                    title,
                    date: expiresAt,
                    sets: losing.join('、') || '—',
                  },
                  path: '/talent/me',
                }),
            );
          }
        }
      }
      return report;
    },

    // ---------- V3-10 10B: external certificates ----------
    async registerExternal(ctx, input) {
      const policies = await authorizeAction(ctx.authz, EXTERNAL, 'register');
      const values = await externalInput(ctx, input);
      const employeeId = await registrant(ctx, policies, input);
      const certification = await certificationRow(values.certificationId);
      if (
        !certification ||
        certification.kind !== 'external' ||
        !bool(certification.active)
      )
        throw new HrError('CERTIFICATION_NOT_EXTERNAL', 409);
      // One registration waiting for verification per employee and type.
      const waiting = await database
        .query()
        .selectFrom('employeeCertificates')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('certificationId', '=', values.certificationId)
        .where('status', '=', 'pending')
        .executeTakeFirst();
      if (waiting) throw new HrError('EXTERNAL_CERTIFICATE_PENDING', 409);
      const id = newId();
      const stamp = new Date();
      await database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'))
        .createOne({
          values: {
            id,
            employeeId,
            certificationId: values.certificationId,
            // The internal number is ours; the certificate's own number is externalNo.
            certificateNo: `EXT-${String(certification.code).toUpperCase()}-${id.slice(0, 8).toUpperCase()}`,
            issuedAt: values.issuedAt,
            expiresAt: values.expiresAt,
            status: 'pending',
            source: 'external',
            revokedReason: null,
            evidence: JSON.stringify({ registeredBy: ctx.userId }),
            supersededById: null,
            externalNo: values.externalNo,
            attachmentFileId: values.attachmentFileId,
            verifyStatus: 'pending',
            verifiedBy: null,
            verifiedAt: null,
            verifyNote: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      return (await toCertificateViews([(await certificateRow(id))!]))[0];
    },

    async updateExternal(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, EXTERNAL, 'register');
      const row = (await database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row || row.source !== 'external')
        throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      // Only a registration still waiting (or rejected) can be corrected.
      if (row.status !== 'pending')
        throw new HrError('EXTERNAL_CERTIFICATE_NOT_PENDING', 409);
      const values = await externalInput(ctx, {
        ...(isRecord(input) ? input : {}),
        certificationId: String(row.certificationId),
      });
      await database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'))
        .updateOne({
          filter: { id, status: 'pending' },
          values: {
            externalNo: values.externalNo,
            issuedAt: values.issuedAt,
            expiresAt: values.expiresAt,
            attachmentFileId: values.attachmentFileId,
            verifyStatus: 'pending',
            updatedAt: new Date(),
          },
        });
      return (await toCertificateViews([(await certificateRow(id))!]))[0];
    },

    async verifyExternal(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, EXTERNAL, 'verify');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const decision = requireEnum(
        input.decision,
        ['verified', 'rejected'] as const,
        'INVALID_INPUT',
      );
      const note = requireString(input.note, 'VERIFY_NOTE_REQUIRED', {
        optional: decision === 'verified',
        max: 1000,
      });
      if (decision === 'rejected' && !note)
        throw new HrError('VERIFY_NOTE_REQUIRED', 400);
      const row = (await database
        .repository('employeeCertificates')
        .withPolicy(policyOf(policies, 'employeeCertificates'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row || row.source !== 'external')
        throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      if (row.status !== 'pending' || row.verifyStatus !== 'pending')
        throw new HrError('EXTERNAL_CERTIFICATE_NOT_PENDING', 409);
      const employee = await platform.employee(String(row.employeeId));
      // The holder never verifies their own certificate.
      if (employee?.userId && employee.userId === ctx.userId)
        throw new HrError('VERIFY_OWN_CERTIFICATE', 403);
      const certification = (await certificationRow(
        String(row.certificationId),
      ))!;
      const stamp = new Date();
      if (decision === 'rejected') {
        await database
          .repository('employeeCertificates')
          .withPolicy(policyOf(policies, 'employeeCertificates'))
          .updateOne({
            filter: { id, status: 'pending' },
            values: {
              verifyStatus: 'rejected',
              verifyNote: note,
              verifiedBy: ctx.userId,
              verifiedAt: stamp,
              updatedAt: stamp,
            },
          });
        if (employee?.userId)
          await notify({
            key: `certificate:${id}:rejected:${stamp.getTime()}`,
            userIds: [employee.userId],
            message: 'externalCertificateRejected',
            params: { title: String(certification.title), note: note ?? '' },
            path: '/talent/certifications?external=mine',
          });
      } else {
        // Verified: valid from now, into the lifecycle; a certificate of the same type still held is replaced.
        await database.transaction(async (connection) => {
          const current = await connection.query
            .selectFrom('employeeCertificates')
            .select(['id'])
            .where('employeeId', '=', String(row.employeeId))
            .where('certificationId', '=', String(row.certificationId))
            .where('status', 'in', [...HOLDING_STATUSES])
            .executeTakeFirst();
          await connection.query
            .updateTable('employeeCertificates')
            .set({
              status: 'valid',
              verifyStatus: 'verified',
              verifyNote: note,
              verifiedBy: ctx.userId,
              verifiedAt: stamp,
              updatedAt: stamp,
            })
            .where('id', '=', id)
            .where('status', '=', 'pending')
            .execute();
          if (current)
            await connection.query
              .updateTable('employeeCertificates')
              .set({
                status: 'superseded',
                supersededById: id,
                updatedAt: stamp,
              })
              .where('id', '=', String(current.id))
              .execute();
        });
        if (certification.competencyId && certification.competencyLevel != null)
          await writeCompetency(
            String(row.employeeId),
            str(certification.competencyId),
            Number(certification.competencyLevel),
            `外部证书《${String(certification.title)}》核验通过（${str(row.externalNo ?? '')}）`,
          );
        await refreshSession(employee?.userId ?? null);
        // V4-14: the permission sets the verified certificate brings (industry pack on).
        const gained = await lostSets(String(row.certificationId));
        if (employee?.userId)
          await notify({
            key: `certificate:${id}:verified`,
            userIds: [employee.userId],
            message: gained.length
              ? 'externalCertificateVerifiedWithSets'
              : 'externalCertificateVerified',
            params: {
              title: String(certification.title),
              sets: gained.join('、') || '—',
            },
            path: '/talent/me',
          });
      }
      return (await toCertificateViews([(await certificateRow(id))!]))[0];
    },

    async listExternal(ctx, filters) {
      const canVerify = await platform.can(ctx, EXTERNAL, 'verify');
      const mine = filters.mine || !canVerify;
      let items: Record<string, unknown>[];
      if (mine) {
        await authorizeAction(ctx.authz, EXTERNAL, 'register');
        const employee = await platform.employeeOfUser(ctx.userId);
        if (!employee) return { items: [], canVerify };
        items = await database
          .query()
          .selectFrom('employeeCertificates')
          .selectAll()
          .where('employeeId', '=', employee.id)
          .where('source', '=', 'external')
          .orderBy('createdAt', 'desc')
          .execute();
      } else {
        const policies = await authorizeAction(ctx.authz, EXTERNAL, 'verify');
        items = await database
          .repository('employeeCertificates')
          .withPolicy(policyOf(policies, 'employeeCertificates'))
          .findMany({
            filter: (f) =>
              f.and([
                f.string('source').eq('external'),
                ...(filters.verifyStatus
                  ? [f.string('verifyStatus').eq(filters.verifyStatus)]
                  : []),
              ]),
            sort: (s) => [s.field('createdAt').desc()],
          });
      }
      return { items: await toCertificateViews(items), canVerify };
    },

    async externalScan(ctx, id) {
      const row = await certificateRow(id);
      if (!row || row.source !== 'external' || !row.attachmentFileId)
        return null;
      if (!(await maySeeExternal(ctx, row)))
        throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      return (
        ((await database.repository('certificateScanFiles').findOne({
          filter: { id: str(row.attachmentFileId) },
          select: (s) =>
            s.fields(
              'id',
              'ext',
              'filename',
              'mimeType',
              'size',
              'createdAt',
              'updatedAt',
            ),
        })) as Record<string, unknown> | undefined) ?? null
      );
    },

    async canReadScan(ctx, fileId) {
      const file = (await database
        .repository('certificateScanFiles')
        .findOne({ filter: { id: fileId } })) as
        Record<string, unknown> | undefined;
      if (!file) return false;
      const linked = await database
        .query()
        .selectFrom('employeeCertificates')
        .selectAll()
        .where('attachmentFileId', '=', fileId)
        .execute();
      for (const row of linked) if (await maySeeExternal(ctx, row)) return true;
      // A scan not yet attached is visible only to whoever uploaded it.
      return !linked.length && str(file.uploadedByUserId) === ctx.userId;
    },

    async qualificationDossier(ctx, certificateId) {
      const row = await certificateRow(certificateId);
      if (!row) throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      const employee = await platform.employee(String(row.employeeId));
      const head = employee ? await platform.headOf(employee) : null;
      // HR administrators and the head who decides on the appointment.
      if (
        head !== ctx.userId &&
        !(await platform.can(ctx, CERTIFICATION, 'manage'))
      )
        throw new HrError('CERTIFICATE_NOT_FOUND', 404);
      const runs = await database
        .query()
        .selectFrom('aiTaskRuns')
        .select(['id', 'output', 'triggerRef', 'finishedAt', 'fallback'])
        .where('task', '=', 'certificationSteward.qualificationPrep')
        .where('status', '=', 'succeeded')
        .orderBy('startedAt', 'desc')
        .limit(50)
        .execute();
      const run = runs.find(
        (r) =>
          json<{ certificateId?: string }>(r.triggerRef, {}).certificateId ===
          certificateId,
      );
      if (!run) return null;
      return {
        runId: String(run.id),
        fallback: bool(run.fallback),
        ...json<Record<string, unknown>>(run.output, {}),
      };
    },
  };

  async function certificateRow(
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    return await database
      .query()
      .selectFrom('employeeCertificates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** The holder, a verifier, or anyone whose certificate view scope covers the holder. */
  async function maySeeExternal(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<boolean> {
    const own = await platform.employeeOfUser(ctx.userId);
    if (own && own.id === String(row.employeeId)) return true;
    for (const [resource, action] of [
      [EXTERNAL, 'verify'],
      [CERTIFICATE, 'view'],
    ] as const) {
      const policies = await tryAuthorizeAction(ctx.authz, resource, action);
      if (
        policies &&
        (await database
          .repository('employeeCertificates')
          .withPolicy(policyOf(policies, 'employeeCertificates'))
          .findOne({ filter: { id: String(row.id) } }))
      )
        return true;
    }
    return false;
  }

  /** The employee a registration is for: oneself, or anyone in scope for HR. */
  async function registrant(
    ctx: ActorContext,
    policies: CollectionPolicies,
    input: unknown,
  ): Promise<string> {
    const requested =
      isRecord(input) && typeof input.employeeId === 'string'
        ? input.employeeId
        : null;
    const own = await platform.employeeOfUser(ctx.userId);
    if (!requested || requested === own?.id) {
      if (!own || own.status === 'leave')
        throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      return own.id;
    }
    const visible = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id: requested } });
    if (!visible) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    return requested;
  }

  async function externalInput(
    ctx: ActorContext,
    input: unknown,
  ): Promise<{
    certificationId: string;
    externalNo: string;
    issuedAt: string;
    expiresAt: string | null;
    attachmentFileId: string;
  }> {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const issuedAt = optionalDate(input.issuedAt, 'INVALID_INPUT');
    if (!issuedAt) throw new HrError('EXTERNAL_ISSUED_REQUIRED', 400);
    const expiresAt = optionalDate(input.expiresAt, 'INVALID_INPUT');
    if (expiresAt && expiresAt <= issuedAt)
      throw new HrError('EXTERNAL_DATES_INVALID', 400);
    const attachmentFileId = requireString(
      input.attachmentFileId,
      'EXTERNAL_SCAN_REQUIRED',
      { max: 64 },
    )!;
    // The scan must exist and be readable by the person registering it.
    if (!(await service.canReadScan(ctx, attachmentFileId)))
      throw new HrError('EXTERNAL_SCAN_REQUIRED', 400);
    return {
      certificationId: requireString(input.certificationId, 'INVALID_INPUT', {
        max: 64,
      })!,
      externalNo: requireString(input.externalNo, 'EXTERNAL_NO_REQUIRED', {
        max: 128,
      })!,
      issuedAt,
      expiresAt,
      attachmentFileId,
    };
  }

  return service;
}

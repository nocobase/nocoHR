/**
 * Read models for V1 step 4: the training report, a person's certificate wall,
 * growth timeline and gap recommendations, and the data the certification
 * steward works from (certificate lists, team summaries, reminders and the
 * weekly brief's facts). Every read goes through the caller's authorization.
 */
import {
  authorizeAction,
  policyOf,
  tryAuthorizeAction,
  type CollectionPolicies,
} from './authorize.js';
import { HOLDING_STATUSES } from './certification-service.js';
import type { ActorContext } from './framework-service.js';
import type { LearningService } from './learning-service.js';
import { bool, json, type Platform } from './platform.js';
import {
  addDays,
  daysBetween,
  HrError,
  isRecord,
  newId,
  requireString,
  str,
} from './shared.js';

const REPORT = 'talent.trainingReport';
const STEWARD = 'talent.certificationSteward';
const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RequiredCertificationState {
  readonly certificationId: string;
  readonly title: string;
  readonly status: 'held' | 'expiring' | 'missing';
  readonly certificateId: string | null;
  readonly expiresAt: string | null;
}

export interface CertificateWall {
  readonly required: readonly RequiredCertificationState[];
  readonly others: readonly {
    id: string;
    certificationId: string;
    title: string;
    certificateNo: string;
    issuedAt: string;
    expiresAt: string | null;
    status: string;
  }[];
}

export interface TimelineEntry {
  readonly kind: 'jobEvent' | 'course' | 'exam' | 'certificate' | 'assessment';
  readonly at: string;
  readonly title: string;
  readonly detail: string | null;
}

export interface Recommendations {
  readonly [competencyId: string]: {
    readonly courses: readonly { id: string; title: string }[];
    readonly exams: readonly { id: string; title: string }[];
    readonly certifications: readonly { id: string; title: string }[];
  };
}

export interface TeamSummaryRow {
  readonly positionId: string;
  readonly positionTitle: string;
  readonly certificationId: string;
  readonly certificationTitle: string;
  readonly shouldHold: number;
  readonly valid: number;
  readonly expiring: number;
  readonly expired: number;
  readonly missing: readonly { employeeId: string; name: string }[];
}

export interface TrainingReport {
  readonly metrics: {
    readonly completionRate: number | null;
    readonly overdue: number;
    readonly firstPassRate: number | null;
    readonly finalPassRate: number | null;
    readonly coverage: number | null;
    readonly expiring: number;
    readonly expired: number;
    readonly openGaps: number;
    /** V2 step 5: path assignments due in the period that were completed, and completed on time. */
    readonly pathCompletionRate: number | null;
    readonly pathOnTimeRate: number | null;
    /** attended ÷ (attended + absent) for sessions that started in the period. */
    readonly attendanceRate: number | null;
    readonly practiceCount: number;
    readonly practiceAverage: number | null;
    /** approved ÷ decided learning plans created in the period. */
    readonly planAdoptionRate: number | null;
  };
  readonly trend: readonly {
    month: string;
    completionRate: number | null;
    passRate: number | null;
  }[];
  readonly coverageByDepartment: readonly {
    departmentId: string;
    title: string;
    coverage: number | null;
    covered: number;
    total: number;
  }[];
  readonly details: {
    readonly completion: readonly {
      employee: string;
      target: string;
      status: string;
      dueDate: string | null;
    }[];
    readonly overdue: readonly {
      employee: string;
      target: string;
      dueDate: string | null;
    }[];
    readonly exams: readonly {
      employee: string;
      exam: string;
      firstPassed: boolean;
      passed: boolean;
    }[];
    readonly coverageMissing: readonly {
      employee: string;
      position: string;
      certification: string;
    }[];
    readonly expiring: readonly {
      employee: string;
      certification: string;
      expiresAt: string | null;
    }[];
    readonly expired: readonly {
      employee: string;
      certification: string;
      expiresAt: string | null;
    }[];
    readonly gaps: readonly {
      question: string;
      askCount: number;
      lastAskedAt: string;
    }[];
    readonly paths: readonly {
      employee: string;
      path: string;
      status: string;
      progress: number;
      dueDate: string | null;
      onTime: boolean;
    }[];
    readonly attendance: readonly {
      employee: string;
      session: string;
      startAt: string | null;
      status: string;
      method: string | null;
    }[];
    readonly practice: readonly {
      employee: string;
      scenario: string;
      score: number | null;
      completedAt: string | null;
    }[];
  };
}

export interface InsightService {
  certificateWall(
    ctx: ActorContext,
    employeeId: string,
  ): Promise<CertificateWall>;
  timeline(ctx: ActorContext, employeeId: string): Promise<TimelineEntry[]>;
  recommendations(
    ctx: ActorContext,
    employeeId: string,
    competencyIds: readonly string[],
  ): Promise<{ items: Recommendations; canAssign: boolean }>;
  trainingReport(
    ctx: ActorContext,
    filters: {
      departmentId?: string;
      positionId?: string;
      from?: string;
      to?: string;
    },
  ): Promise<TrainingReport>;
  stewardCertificates(
    ctx: ActorContext,
    filters: {
      certificationId?: string;
      status?: string;
      departmentId?: string;
      expiresWithinDays?: number;
    },
  ): Promise<
    {
      employeeId: string;
      name: string;
      department: string;
      certification: string;
      certificateNo: string;
      expiresAt: string | null;
      status: string;
    }[]
  >;
  teamSummary(
    ctx: ActorContext,
    departmentId?: string,
  ): Promise<TeamSummaryRow[]>;
  sendReminders(
    ctx: ActorContext,
    employeeIds: readonly string[],
    note: string | null,
  ): Promise<{
    sent: readonly string[];
    skipped: readonly { employeeId: string; reason: string }[];
  }>;
  /** Facts for one head's weekly brief; empty when nothing needs attention. */
  weeklyFacts(ctx: ActorContext): Promise<{
    newThisWeek: string[];
    expiringSoon: string[];
    expired: string[];
    missing: string[];
  }>;
}

export interface InsightServiceDeps {
  readonly platform: Platform;
  readonly learning: LearningService;
  readonly departmentTitle: (id: string) => Promise<string>;
}

function dateOnly(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}
function iso(value: unknown): string {
  if (!value) return '';
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
const rate = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 1000) / 10 : null;

export function createInsightService(deps: InsightServiceDeps): InsightService {
  const { platform, learning, departmentTitle } = deps;
  const { database, organization, notify } = platform;

  async function visibleEmployee(
    ctx: ActorContext,
    employeeId: string,
  ): Promise<void> {
    const policies = await authorizeAction(
      ctx.authz,
      'talent.employee',
      'view',
    );
    const row = await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findOne({ filter: { id: employeeId } });
    if (!row) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
  }

  /** Mandatory qualification requirements of a position that a certification can prove. */
  async function requiredCertifications(
    positionId: string,
  ): Promise<{ id: string; title: string }[]> {
    const query = database.query();
    const requirements = await query
      .selectFrom('positionRequirements')
      .innerJoin(
        'competencies',
        'competencies.id',
        'positionRequirements.competencyId',
      )
      .select(['positionRequirements.competencyId as competencyId'])
      .where('positionRequirements.positionId', '=', positionId)
      .where('positionRequirements.mandatory', '=', true)
      .where('positionRequirements.reviewStatus', '=', 'confirmed')
      .where('competencies.category', '=', 'qualification')
      .execute();
    if (!requirements.length) return [];
    const certifications = await query
      .selectFrom('certifications')
      .select(['id', 'title'])
      .where('active', '=', true)
      .where(
        'competencyId',
        'in',
        requirements.map((r) => String(r.competencyId)),
      )
      .execute();
    return certifications.map((c) => ({
      id: String(c.id),
      title: String(c.title),
    }));
  }

  async function scopedEmployees(
    policies: CollectionPolicies,
    filters: { departmentId?: string; positionId?: string } = {},
  ): Promise<Record<string, unknown>[]> {
    let departmentIds: Set<string> | undefined;
    if (filters.departmentId)
      departmentIds = new Set(
        await organization.descendantsOf(filters.departmentId),
      );
    const rows = (await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findMany({
        filter: (f) =>
          f.and(
            filters.positionId
              ? [f.string('positionId').eq(filters.positionId)]
              : [],
          ),
      })) as Record<string, unknown>[];
    return rows.filter(
      (row) => !departmentIds || departmentIds.has(String(row.departmentId)),
    );
  }

  async function certificateHolding(employeeIds: readonly string[]) {
    if (!employeeIds.length) return [];
    return await database
      .query()
      .selectFrom('employeeCertificates')
      .select([
        'id',
        'employeeId',
        'certificationId',
        'status',
        'expiresAt',
        'issuedAt',
        'certificateNo',
      ])
      .where('employeeId', 'in', [...employeeIds])
      .execute();
  }

  async function summarize(
    employees: readonly Record<string, unknown>[],
  ): Promise<TeamSummaryRow[]> {
    const active = employees.filter((e) => e.status !== 'leave');
    const certificates = await certificateHolding(
      active.map((e) => String(e.id)),
    );
    const byPosition = new Map<string, Record<string, unknown>[]>();
    for (const employee of active)
      byPosition.set(String(employee.positionId), [
        ...(byPosition.get(String(employee.positionId)) ?? []),
        employee,
      ]);
    const rows: TeamSummaryRow[] = [];
    for (const [positionId, people] of byPosition) {
      const required = await requiredCertifications(positionId);
      if (!required.length) continue;
      const position = await database
        .query()
        .selectFrom('positions')
        .select(['title'])
        .where('id', '=', positionId)
        .executeTakeFirst();
      for (const certification of required) {
        let valid = 0;
        let expiring = 0;
        let expired = 0;
        const missing: { employeeId: string; name: string }[] = [];
        for (const person of people) {
          const own = certificates.filter(
            (c) =>
              String(c.employeeId) === String(person.id) &&
              String(c.certificationId) === certification.id,
          );
          if (own.some((c) => c.status === 'valid')) valid += 1;
          else if (own.some((c) => c.status === 'expiring')) expiring += 1;
          else {
            if (own.some((c) => c.status === 'expired')) expired += 1;
            missing.push({
              employeeId: String(person.id),
              name: String(person.name),
            });
          }
        }
        rows.push({
          positionId,
          positionTitle: str(position?.title ?? positionId),
          certificationId: certification.id,
          certificationTitle: certification.title,
          shouldHold: people.length,
          valid,
          expiring,
          expired,
          missing,
        });
      }
    }
    return rows;
  }

  const service: InsightService = {
    async certificateWall(ctx, employeeId) {
      await visibleEmployee(ctx, employeeId);
      const policies = await tryAuthorizeAction(
        ctx.authz,
        'talent.certificate',
        'view',
      );
      const employee = await platform.employee(employeeId);
      const rows = policies
        ? ((await database
            .repository('employeeCertificates')
            .withPolicy(policyOf(policies, 'employeeCertificates'))
            .findMany({
              filter: { employeeId },
              sort: (s) => [s.field('issuedAt').desc()],
            })) as Record<string, unknown>[])
        : [];
      const titles = new Map(
        (
          await database
            .query()
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [String(c.id), String(c.title)]),
      );
      const required = employee
        ? await requiredCertifications(employee.positionId)
        : [];
      const requiredIds = new Set(required.map((r) => r.id));
      return {
        required: required.map((certification) => {
          const held = rows.find(
            (r) =>
              String(r.certificationId) === certification.id &&
              (HOLDING_STATUSES as readonly string[]).includes(
                String(r.status),
              ),
          );
          return {
            certificationId: certification.id,
            title: certification.title,
            status: !held
              ? 'missing'
              : held.status === 'expiring'
                ? 'expiring'
                : 'held',
            certificateId: held ? String(held.id) : null,
            expiresAt: held ? dateOnly(held.expiresAt) : null,
          };
        }),
        others: rows
          .filter(
            (r) =>
              !requiredIds.has(String(r.certificationId)) ||
              !(HOLDING_STATUSES as readonly string[]).includes(
                String(r.status),
              ),
          )
          .map((r) => ({
            id: String(r.id),
            certificationId: String(r.certificationId),
            title: titles.get(String(r.certificationId)) ?? '',
            certificateNo: String(r.certificateNo),
            issuedAt: dateOnly(r.issuedAt)!,
            expiresAt: dateOnly(r.expiresAt),
            status: String(r.status),
          })),
      };
    },

    async timeline(ctx, employeeId) {
      await visibleEmployee(ctx, employeeId);
      const query = database.query();
      const entries: TimelineEntry[] = [];
      const events = await query
        .selectFrom('jobEvents')
        .selectAll()
        .where('employeeId', '=', employeeId)
        .execute();
      const positions = new Map(
        (
          await query.selectFrom('positions').select(['id', 'title']).execute()
        ).map((p) => [String(p.id), String(p.title)]),
      );
      for (const event of events as Record<string, unknown>[]) {
        const to = [
          event.toDepartmentId
            ? await departmentTitle(str(event.toDepartmentId))
            : null,
          event.toPositionId ? positions.get(str(event.toPositionId)) : null,
        ]
          .filter(Boolean)
          .join(' / ');
        entries.push({
          kind: 'jobEvent',
          at: `${dateOnly(event.effectiveDate)}T00:00:00.000Z`,
          title: String(event.eventType),
          detail: to || null,
        });
      }
      const history = await tryAuthorizeAction(
        ctx.authz,
        'talent.learningHistory',
        'view',
      );
      if (history) {
        const summary = await learning.learningSummary(ctx, employeeId);
        for (const course of summary.completedCourses)
          entries.push({
            kind: 'course',
            at: course.completedAt,
            title: course.title,
            detail: null,
          });
      }
      const attempts = await query
        .selectFrom('examAttempts')
        .innerJoin('exams', 'exams.id', 'examAttempts.examId')
        .select([
          'exams.title as title',
          'examAttempts.score as score',
          'examAttempts.updatedAt as at',
        ])
        .where('examAttempts.employeeId', '=', employeeId)
        .where('examAttempts.status', '=', 'passed')
        .execute();
      if (await platform.can(ctx, 'talent.certificate', 'view')) {
        for (const attempt of attempts)
          entries.push({
            kind: 'exam',
            at: iso(attempt.at),
            title: String(attempt.title),
            detail: attempt.score == null ? null : str(attempt.score),
          });
        const certificates = await query
          .selectFrom('employeeCertificates')
          .innerJoin(
            'certifications',
            'certifications.id',
            'employeeCertificates.certificationId',
          )
          .select([
            'certifications.title as title',
            'employeeCertificates.issuedAt as issuedAt',
            'employeeCertificates.certificateNo as no',
          ])
          .where('employeeCertificates.employeeId', '=', employeeId)
          .execute();
        for (const certificate of certificates)
          entries.push({
            kind: 'certificate',
            at: `${dateOnly(certificate.issuedAt)}T00:00:00.000Z`,
            title: String(certificate.title),
            detail: String(certificate.no),
          });
      }
      const assessments = await tryAuthorizeAction(
        ctx.authz,
        'talent.assessment',
        'view',
      );
      if (assessments) {
        const rows = (await database
          .repository('employeeCompetencies')
          .withPolicy(policyOf(assessments, 'employeeCompetencies'))
          .findMany({ filter: { employeeId } })) as Record<string, unknown>[];
        const titles = new Map(
          (
            await query
              .selectFrom('competencies')
              .select(['id', 'title'])
              .execute()
          ).map((c) => [String(c.id), String(c.title)]),
        );
        for (const row of rows)
          entries.push({
            kind: 'assessment',
            at: iso(row.assessedAt),
            title: titles.get(String(row.competencyId)) ?? '',
            detail: `L${String(row.level)} · ${String(row.source)}`,
          });
      }
      return entries.sort((a, b) => b.at.localeCompare(a.at));
    },

    async recommendations(ctx, employeeId, competencyIds) {
      await visibleEmployee(ctx, employeeId);
      const query = database.query();
      const courses = await learning.coursesForCompetencies(competencyIds);
      const items: Record<
        string,
        {
          courses: { id: string; title: string }[];
          exams: { id: string; title: string }[];
          certifications: { id: string; title: string }[];
        }
      > = {};
      const exams = await query
        .selectFrom('exams')
        .selectAll()
        .where('published', '=', true)
        .where('active', '=', true)
        .execute();
      const certifications = competencyIds.length
        ? await query
            .selectFrom('certifications')
            .select(['id', 'title', 'competencyId'])
            .where('active', '=', true)
            .where('competencyId', 'in', [...competencyIds])
            .execute()
        : [];
      for (const competencyId of competencyIds) {
        const covering: { id: string; title: string }[] = [];
        for (const exam of exams) {
          let covers: boolean;
          if (exam.paperMode === 'random')
            covers = json<{ competencyId?: string | null }[]>(
              exam.randomRules,
              [],
            ).some((r) => r.competencyId === competencyId);
          else {
            const hit = await query
              .selectFrom('examQuestions')
              .innerJoin(
                'questionCompetencies',
                'questionCompetencies.questionId',
                'examQuestions.questionId',
              )
              .select(['examQuestions.id'])
              .where('examQuestions.examId', '=', String(exam.id))
              .where('questionCompetencies.competencyId', '=', competencyId)
              .executeTakeFirst();
            covers = Boolean(hit);
          }
          // A random paper that draws from any competency covers it when a certification requires the exam for this competency.
          if (!covers) {
            const viaCertification = await query
              .selectFrom('certificationExams')
              .innerJoin(
                'certifications',
                'certifications.id',
                'certificationExams.certificationId',
              )
              .select(['certificationExams.id'])
              .where('certificationExams.examId', '=', String(exam.id))
              .where('certifications.competencyId', '=', competencyId)
              .executeTakeFirst();
            covers = Boolean(viaCertification);
          }
          if (covers)
            covering.push({ id: String(exam.id), title: String(exam.title) });
        }
        items[competencyId] = {
          courses: courses[competencyId] ?? [],
          exams: covering,
          certifications: certifications
            .filter((c) => String(c.competencyId) === competencyId)
            .map((c) => ({ id: String(c.id), title: String(c.title) })),
        };
      }
      const create = await tryAuthorizeAction(
        ctx.authz,
        'talent.assignment',
        'create',
      );
      const canAssign = create
        ? Boolean(
            await database
              .repository('employees')
              .withPolicy(policyOf(create, 'employees'))
              .findOne({ filter: { id: employeeId } }),
          )
        : false;
      return { items, canAssign };
    },

    async trainingReport(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, REPORT, 'view');
      const today = platform.currentDate();
      const from = filters.from ?? addDays(today, -365);
      const to = filters.to ?? today;
      const employees = await scopedEmployees(policies, filters);
      const ids = new Set(employees.map((e) => String(e.id)));
      const names = new Map(
        employees.map((e) => [String(e.id), String(e.name)]),
      );
      const query = database.query();
      const titleOf = async (courseId: unknown, examId: unknown) => {
        if (courseId)
          return str(
            (
              await query
                .selectFrom('courses')
                .select(['title'])
                .where('id', '=', str(courseId))
                .executeTakeFirst()
            )?.title ?? '',
          );
        if (examId)
          return str(
            (
              await query
                .selectFrom('exams')
                .select(['title'])
                .where('id', '=', str(examId))
                .executeTakeFirst()
            )?.title ?? '',
          );
        return '';
      };
      const assignments = (
        (await database
          .repository('assignments')
          .withPolicy(policyOf(policies, 'assignments'))
          .findMany({})) as Record<string, unknown>[]
      ).filter((a) => ids.has(String(a.employeeId)));
      // Recommendations (optional) never count towards completion; path steps count through their path.
      const counted = assignments.filter((a) => !bool(a.optional));
      const inPeriod = counted.filter(
        (a) =>
          a.status !== 'cancelled' &&
          !a.learningPathId &&
          dateOnly(a.dueDate) &&
          dateOnly(a.dueDate)! >= from &&
          dateOnly(a.dueDate)! <= to,
      );
      const overdue = counted.filter((a) => a.status === 'overdue');
      // ---- V2 step 5: paths, offline attendance, practice and plans ----
      const pathRows = counted.filter(
        (a) =>
          a.learningPathId &&
          a.status !== 'cancelled' &&
          dateOnly(a.dueDate) &&
          dateOnly(a.dueDate)! >= from &&
          dateOnly(a.dueDate)! <= to,
      );
      const onTime = (a: Record<string, unknown>) =>
        a.status === 'completed' &&
        Boolean(a.completedAt) &&
        (dateOnly(a.completedAt) ?? '') <= (dateOnly(a.dueDate) ?? '');
      const pathTitles = new Map(
        (
          await query
            .selectFrom('learningPaths')
            .select(['id', 'title'])
            .execute()
        ).map((p) => [String(p.id), String(p.title)]),
      );
      const scopeIds = [...ids];
      const enrollments = scopeIds.length
        ? await query
            .selectFrom('trainingEnrollments')
            .innerJoin(
              'trainingSessions',
              'trainingSessions.id',
              'trainingEnrollments.sessionId',
            )
            .select([
              'trainingEnrollments.employeeId as employeeId',
              'trainingEnrollments.status as status',
              'trainingEnrollments.checkInMethod as checkInMethod',
              'trainingSessions.title as title',
              'trainingSessions.startAt as startAt',
            ])
            .where('trainingEnrollments.employeeId', 'in', scopeIds)
            .where('trainingEnrollments.status', 'in', ['attended', 'absent'])
            .execute()
        : [];
      const sessionRows = enrollments.filter((e) => {
        const at = dateOnly(e.startAt);
        return at && at >= from && at <= to;
      });
      const practices = scopeIds.length
        ? await query
            .selectFrom('practiceSessions')
            .innerJoin(
              'practiceScenarios',
              'practiceScenarios.id',
              'practiceSessions.scenarioId',
            )
            .select([
              'practiceSessions.employeeId as employeeId',
              'practiceSessions.score as score',
              'practiceSessions.completedAt as completedAt',
              'practiceScenarios.title as title',
            ])
            .where('practiceSessions.employeeId', 'in', scopeIds)
            .where('practiceSessions.status', '=', 'completed')
            .where('practiceSessions.rehearsal', '=', false)
            .execute()
        : [];
      const practiceRows = practices.filter((p) => {
        const at = dateOnly(p.completedAt);
        return at && at >= from && at <= to;
      });
      const planRows = scopeIds.length
        ? (
            await query
              .selectFrom('learningPlans')
              .select(['status', 'createdAt'])
              .where('employeeId', 'in', scopeIds)
              .execute()
          ).filter((p) => {
            const at = dateOnly(p.createdAt);
            return at && at >= from && at <= to;
          })
        : [];
      const decidedPlans = planRows.filter(
        (p) => p.status === 'approved' || p.status === 'rejected',
      );
      const attempts = (
        (await database
          .repository('examAttempts')
          .withPolicy(policyOf(policies, 'examAttempts'))
          .findMany({})) as Record<string, unknown>[]
      ).filter(
        (a) =>
          ids.has(String(a.employeeId)) &&
          a.status !== 'voided' &&
          a.status !== 'inProgress',
      );
      // First attempt per candidate and exam, when it was submitted in the period.
      const firsts = new Map<string, Record<string, unknown>>();
      for (const attempt of attempts.sort(
        (a, b) => Number(a.attemptNo) - Number(b.attemptNo),
      )) {
        const key = `${String(attempt.employeeId)}|${String(attempt.examId)}`;
        if (!firsts.has(key)) firsts.set(key, attempt);
      }
      const candidates = [...firsts.entries()].filter(([, first]) => {
        const at = dateOnly(first.submittedAt);
        return at && at >= from && at <= to;
      });
      const firstPassed = candidates.filter(
        ([, first]) => first.status === 'passed',
      ).length;
      const finalPassed = candidates.filter(([key]) =>
        attempts.some(
          (a) =>
            `${String(a.employeeId)}|${String(a.examId)}` === key &&
            a.status === 'passed',
        ),
      ).length;
      const certificates = (
        (await database
          .repository('employeeCertificates')
          .withPolicy(policyOf(policies, 'employeeCertificates'))
          .findMany({})) as Record<string, unknown>[]
      ).filter((c) => ids.has(String(c.employeeId)));
      const certificationTitles = new Map(
        (
          await query
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [String(c.id), String(c.title)]),
      );
      // Required-certification coverage.
      const active = employees.filter((e) => e.status !== 'leave');
      const coverageRows: {
        employee: Record<string, unknown>;
        required: { id: string; title: string }[];
        missing: { id: string; title: string }[];
      }[] = [];
      for (const employee of active) {
        const required = await requiredCertifications(
          String(employee.positionId),
        );
        if (!required.length) continue;
        const held = new Set(
          certificates
            .filter(
              (c) =>
                String(c.employeeId) === String(employee.id) &&
                (HOLDING_STATUSES as readonly string[]).includes(
                  String(c.status),
                ),
            )
            .map((c) => String(c.certificationId)),
        );
        coverageRows.push({
          employee,
          required,
          missing: required.filter((r) => !held.has(r.id)),
        });
      }
      const positionTitles = new Map(
        (
          await query.selectFrom('positions').select(['id', 'title']).execute()
        ).map((p) => [String(p.id), String(p.title)]),
      );
      const byDepartment = new Map<
        string,
        { covered: number; total: number }
      >();
      for (const row of coverageRows) {
        const key = String(row.employee.departmentId);
        const entry = byDepartment.get(key) ?? { covered: 0, total: 0 };
        entry.total += 1;
        if (!row.missing.length) entry.covered += 1;
        byDepartment.set(key, entry);
      }
      const gaps = await query
        .selectFrom('knowledgeGaps')
        .select(['question', 'askCount', 'lastAskedAt'])
        .where('status', '=', 'open')
        .orderBy('lastAskedAt', 'desc')
        .execute();
      // Twelve months of completion and pass rates.
      const trend: {
        month: string;
        completionRate: number | null;
        passRate: number | null;
      }[] = [];
      for (let back = 11; back >= 0; back -= 1) {
        const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
        date.setUTCMonth(date.getUTCMonth() - back);
        const month = date.toISOString().slice(0, 7);
        const due = assignments.filter(
          (a) =>
            a.status !== 'cancelled' && dateOnly(a.dueDate)?.startsWith(month),
        );
        const monthCandidates = [...firsts.values()].filter((first) =>
          dateOnly(first.submittedAt)?.startsWith(month),
        );
        trend.push({
          month,
          completionRate: rate(
            due.filter((a) => a.status === 'completed').length,
            due.length,
          ),
          passRate: rate(
            monthCandidates.filter((a) => a.status === 'passed').length,
            monthCandidates.length,
          ),
        });
      }
      const expiring = certificates.filter((c) => c.status === 'expiring');
      const expired = certificates.filter((c) => c.status === 'expired');
      return {
        metrics: {
          completionRate: rate(
            inPeriod.filter((a) => a.status === 'completed').length,
            inPeriod.length,
          ),
          overdue: overdue.length,
          firstPassRate: rate(firstPassed, candidates.length),
          finalPassRate: rate(finalPassed, candidates.length),
          coverage: rate(
            coverageRows.filter((r) => !r.missing.length).length,
            coverageRows.length,
          ),
          expiring: expiring.length,
          expired: expired.length,
          openGaps: gaps.length,
          pathCompletionRate: rate(
            pathRows.filter((a) => a.status === 'completed').length,
            pathRows.length,
          ),
          pathOnTimeRate: rate(pathRows.filter(onTime).length, pathRows.length),
          attendanceRate: rate(
            sessionRows.filter((e) => e.status === 'attended').length,
            sessionRows.length,
          ),
          practiceCount: practiceRows.length,
          practiceAverage: practiceRows.length
            ? Math.round(
                practiceRows.reduce((sum, p) => sum + Number(p.score), 0) /
                  practiceRows.length,
              )
            : null,
          planAdoptionRate: rate(
            decidedPlans.filter((p) => p.status === 'approved').length,
            decidedPlans.length,
          ),
        },
        trend,
        coverageByDepartment: await Promise.all(
          [...byDepartment.entries()].map(async ([departmentId, entry]) => ({
            departmentId,
            title: await departmentTitle(departmentId),
            coverage: rate(entry.covered, entry.total),
            ...entry,
          })),
        ),
        details: {
          completion: await Promise.all(
            inPeriod.map(async (a) => ({
              employee: names.get(String(a.employeeId)) ?? '',
              target: await titleOf(a.courseId, a.examId),
              status: String(a.status),
              dueDate: dateOnly(a.dueDate),
            })),
          ),
          overdue: await Promise.all(
            overdue.map(async (a) => ({
              employee: names.get(String(a.employeeId)) ?? '',
              target: await titleOf(a.courseId, a.examId),
              dueDate: dateOnly(a.dueDate),
            })),
          ),
          exams: await Promise.all(
            candidates.map(async ([key, first]) => ({
              employee: names.get(String(first.employeeId)) ?? '',
              exam: await titleOf(null, first.examId),
              firstPassed: first.status === 'passed',
              passed: attempts.some(
                (a) =>
                  `${String(a.employeeId)}|${String(a.examId)}` === key &&
                  a.status === 'passed',
              ),
            })),
          ),
          coverageMissing: coverageRows.flatMap((row) =>
            row.missing.map((m) => ({
              employee: String(row.employee.name),
              position:
                positionTitles.get(String(row.employee.positionId)) ?? '',
              certification: m.title,
            })),
          ),
          expiring: expiring.map((c) => ({
            employee: names.get(String(c.employeeId)) ?? '',
            certification:
              certificationTitles.get(String(c.certificationId)) ?? '',
            expiresAt: dateOnly(c.expiresAt),
          })),
          expired: expired.map((c) => ({
            employee: names.get(String(c.employeeId)) ?? '',
            certification:
              certificationTitles.get(String(c.certificationId)) ?? '',
            expiresAt: dateOnly(c.expiresAt),
          })),
          gaps: gaps.slice(0, 5).map((g) => ({
            question: String(g.question),
            askCount: Number(g.askCount),
            lastAskedAt: iso(g.lastAskedAt),
          })),
          paths: pathRows.map((a) => ({
            employee: names.get(String(a.employeeId)) ?? '',
            path: pathTitles.get(String(a.learningPathId)) ?? '',
            status: String(a.status),
            progress: Number(a.progress) || 0,
            dueDate: dateOnly(a.dueDate),
            onTime: onTime(a),
          })),
          attendance: sessionRows.map((e) => ({
            employee: names.get(String(e.employeeId)) ?? '',
            session: String(e.title),
            startAt: iso(e.startAt),
            status: String(e.status),
            method: e.checkInMethod == null ? null : str(e.checkInMethod),
          })),
          practice: practiceRows.map((p) => ({
            employee: names.get(String(p.employeeId)) ?? '',
            scenario: String(p.title),
            score: p.score == null ? null : Number(p.score),
            completedAt: iso(p.completedAt),
          })),
        },
      };
    },

    async stewardCertificates(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, STEWARD, 'use');
      const employees = await scopedEmployees(policies, {
        departmentId: filters.departmentId,
      });
      const byId = new Map(employees.map((e) => [String(e.id), e]));
      const today = platform.currentDate();
      const rows = (
        (await database
          .repository('employeeCertificates')
          .withPolicy(policyOf(policies, 'employeeCertificates'))
          .findMany({
            filter: (f) =>
              f.and([
                ...(filters.certificationId
                  ? [f.string('certificationId').eq(filters.certificationId)]
                  : []),
                ...(filters.status
                  ? [f.string('status').eq(filters.status)]
                  : []),
              ]),
          })) as Record<string, unknown>[]
      ).filter((c) => byId.has(String(c.employeeId)));
      const titles = new Map(
        (
          await database
            .query()
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [String(c.id), String(c.title)]),
      );
      const result = [];
      for (const row of rows) {
        const expiresAt = dateOnly(row.expiresAt);
        if (
          filters.expiresWithinDays !== undefined &&
          (!expiresAt ||
            daysBetween(today, expiresAt) > filters.expiresWithinDays)
        )
          continue;
        const employee = byId.get(String(row.employeeId))!;
        result.push({
          employeeId: String(row.employeeId),
          name: String(employee.name),
          department: await departmentTitle(String(employee.departmentId)),
          certification: titles.get(String(row.certificationId)) ?? '',
          certificateNo: String(row.certificateNo),
          expiresAt,
          status: String(row.status),
        });
      }
      // Lists are ordered by expiry date, soonest first.
      return result.sort((a, b) =>
        (a.expiresAt ?? '9999').localeCompare(b.expiresAt ?? '9999'),
      );
    },

    async teamSummary(ctx, departmentId) {
      const policies = await authorizeAction(ctx.authz, STEWARD, 'use');
      let department = departmentId;
      if (!department) {
        const headed = await organization.headedBy(ctx.userId);
        department = headed[0];
      }
      return summarize(
        await scopedEmployees(
          policies,
          department ? { departmentId: department } : {},
        ),
      );
    },

    async sendReminders(ctx, employeeIds, note) {
      const policies = await authorizeAction(ctx.authz, STEWARD, 'use');
      if (!employeeIds.length || employeeIds.length > 100)
        throw new HrError('INVALID_INPUT', 400);
      const scoped = new Set(
        (await scopedEmployees(policies)).map((e) => String(e.id)),
      );
      const sent: string[] = [];
      const skipped: { employeeId: string; reason: string }[] = [];
      for (const employeeId of [...new Set(employeeIds)]) {
        const employee = await platform.employee(employeeId);
        if (!employee || !scoped.has(employeeId)) {
          skipped.push({ employeeId, reason: 'outOfScope' });
          continue;
        }
        if (!employee.userId) {
          skipped.push({ employeeId, reason: 'noAccount' });
          continue;
        }
        // One reminder per person in 24 hours.
        const recent = await database
          .query()
          .selectFrom('hrReminderLog')
          .select(['sentAt'])
          .where('reminderKey', 'like', `steward:${employeeId}:%`)
          .orderBy('sentAt', 'desc')
          .executeTakeFirst();
        if (
          recent &&
          Date.now() - new Date(iso(recent.sentAt)).getTime() <
            REMIND_INTERVAL_MS
        ) {
          skipped.push({ employeeId, reason: 'recentlyReminded' });
          continue;
        }
        const stamp = new Date();
        const key = `steward:${employeeId}:${stamp.getTime()}`;
        await notify({
          key,
          userIds: [employee.userId],
          message: 'certificationReminder',
          params: { note: note ?? '' },
          path: '/talent/my-exams',
        });
        await database
          .query()
          .insertInto('hrReminderLog')
          .values({
            id: newId(),
            reminderKey: key,
            sentAt: stamp,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        sent.push(employee.name);
      }
      return { sent, skipped };
    },

    async weeklyFacts(ctx) {
      const policies = await authorizeAction(ctx.authz, STEWARD, 'use');
      const employees = (await scopedEmployees(policies)).filter(
        (e) => e.status !== 'leave',
      );
      const certificates = await certificateHolding(
        employees.map((e) => String(e.id)),
      );
      const names = new Map(
        employees.map((e) => [String(e.id), String(e.name)]),
      );
      const titles = new Map(
        (
          await database
            .query()
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [String(c.id), String(c.title)]),
      );
      const today = platform.currentDate();
      const label = (c: Record<string, unknown>) =>
        `${names.get(String(c.employeeId)) ?? ''}《${titles.get(String(c.certificationId)) ?? ''}》`;
      const summary = await summarize(employees);
      return {
        newThisWeek: certificates
          .filter(
            (c) =>
              dateOnly(c.issuedAt)! >= addDays(today, -7) &&
              (HOLDING_STATUSES as readonly string[]).includes(
                String(c.status),
              ),
          )
          .map(label),
        expiringSoon: certificates
          .filter(
            (c) =>
              (HOLDING_STATUSES as readonly string[]).includes(
                String(c.status),
              ) &&
              dateOnly(c.expiresAt) &&
              daysBetween(today, dateOnly(c.expiresAt)!) <= 30,
          )
          .sort((a, b) =>
            String(dateOnly(a.expiresAt)).localeCompare(
              String(dateOnly(b.expiresAt)),
            ),
          )
          .map((c) => `${label(c)}（${dateOnly(c.expiresAt)}）`),
        expired: certificates.filter((c) => c.status === 'expired').map(label),
        missing: summary.flatMap((row) =>
          row.missing.map((m) => `${m.name}《${row.certificationTitle}》`),
        ),
      };
    },
  };

  return service;
}

export function parseReminderInput(input: unknown): {
  employeeIds: string[];
  note: string | null;
} {
  if (
    !isRecord(input) ||
    !Array.isArray(input.employeeIds) ||
    input.employeeIds.some((id) => typeof id !== 'string')
  )
    throw new HrError('INVALID_INPUT', 400);
  return {
    employeeIds: input.employeeIds as string[],
    note: requireString(input.note, 'INVALID_INPUT', {
      optional: true,
      max: 500,
    }),
  };
}

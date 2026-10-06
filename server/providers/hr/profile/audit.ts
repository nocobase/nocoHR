/**
 * V3-11 审计导出 and 客户审核包 (hr.admin, hr.auditor; read-only):
 *
 * - 个人培训档案 (PDF): basic information without the sensitive fields,
 *   position requirements, job events, learning with course and source
 *   document versions, attendance, exam attempts, certificate history and
 *   assessments.
 * - 培训与资格台账 (Excel): per active employee of a department and position,
 *   the requirements, required certifications, certificate numbers and expiry
 *   dates, and the required courses with their versions.
 * - 审核前风险 (rules only): a required certificate expiring within 30 days
 *   with its re-certification not started; a missing or expired required
 *   certificate while the person is on published shifts within seven days
 *   either side of today; change-brief training past its due date.
 * - 客户审核包 (ZIP): a cover PDF with the risks, and a workbook of the
 *   competency matrix, training and exam records, certificates, the handling
 *   of expired and revoked certificates, and change-brief training.
 *
 * Nothing here contains mobile numbers, ID numbers, addresses or pay, so an
 * auditor's export and an administrator's are the same. Every export writes
 * `auditExports` (the application has no audit-log plugin).
 */
import * as XLSX from 'xlsx';

import { authorizeAction, policyOf } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { addDays, HrError, newId, str } from '../shared.js';
import {
  dateOnly,
  iso,
  isActive,
  toPerson,
  type LevelRow,
  type PersonRow,
  type ProfileDeps,
  type ProfileReads,
} from './context.js';
import { certState } from './insights.js';
import { renderPdf, type PdfBlock } from './pdf.js';

const AUDIT = 'talent.audit';
export const RISK_EXPIRY_DAYS = 30;
export const RISK_SCHEDULE_DAYS = 7;

export interface AuditScope {
  departmentIds: string[];
  positionIds: string[];
}

export interface AuditRisk {
  readonly kind:
    'certMissingScheduled' | 'certExpiringNoRecert' | 'revisionTrainingOverdue';
  readonly urgency: 'high' | 'medium';
  readonly employeeId: string;
  readonly name: string;
  readonly departmentTitle: string;
  readonly text: string;
  readonly evidence: readonly { type: string; id: string; label: string }[];
}

const STATE_LABEL: Record<string, string> = {
  valid: '有效',
  expiring: '即将到期',
  expired: '已过期',
  missing: '缺失',
};
// The re-certification task's state as the risk text says it (never the stored value).
const TASK_STATUS_LABEL: Record<string, string> = {
  notStarted: '未开始',
  inProgress: '进行中',
  overdue: '已逾期',
  completed: '已完成',
};
const EVENT_LABEL: Record<string, string> = {
  onboard: '入职',
  regularize: '转正',
  transfer: '调岗',
  promote: '晋升',
  offboard: '离职',
};

function sheet(book: XLSX.WorkBook, name: string, rows: unknown[][]): void {
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
}

export function createAuditService(deps: ProfileDeps, reads: ProfileReads) {
  const { platform } = deps;
  const { database, organization } = platform;

  async function scoped(
    ctx: ActorContext,
    action: string,
  ): Promise<PersonRow[]> {
    const policies = await authorizeAction(ctx.authz, AUDIT, action);
    return (
      (await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({})) as Record<string, unknown>[]
    ).map(toPerson);
  }

  async function inScope(
    people: PersonRow[],
    scope: AuditScope,
  ): Promise<PersonRow[]> {
    const departments = new Set<string>();
    for (const id of scope.departmentIds)
      for (const d of await organization.descendantsOf(id)) departments.add(d);
    return people
      .filter(isActive)
      .filter(
        (p) => !scope.departmentIds.length || departments.has(p.departmentId),
      )
      .filter(
        (p) =>
          !scope.positionIds.length ||
          scope.positionIds.includes(p.positionId ?? ''),
      )
      .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo));
  }

  async function log(
    ctx: ActorContext,
    entry: {
      kind: string;
      scope: unknown;
      fileName: string;
      summary: string;
      via?: string;
    },
  ): Promise<void> {
    const stamp = new Date();
    await database
      .query()
      .insertInto('auditExports')
      .values({
        id: newId(),
        kind: entry.kind,
        actorUserId: ctx.userId,
        scope: (entry.scope ?? null) as Record<string, unknown> | null,
        fileName: entry.fileName,
        summary: entry.summary.slice(0, 2000),
        via: entry.via ?? 'page',
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    deps.warn(
      {
        event: 'audit.export',
        kind: entry.kind,
        by: ctx.userId,
        fileName: entry.fileName,
      },
      'Audit export',
    );
  }

  async function documentVersions(): Promise<Map<string, string>> {
    return new Map(
      (
        await database
          .query()
          .selectFrom('kbDocuments')
          .select(['id', 'title', 'docNo', 'version'])
          .execute()
      ).map((d) => [
        str(d.id),
        `${str(d.docNo ?? d.title)} ${str(d.version ?? '')}`.trim(),
      ]),
    );
  }

  /** Scope names from a sentence ("苏州和成都机加工车间的 CNC 操作工") or ids. */
  async function resolveScope(input: {
    departmentIds?: unknown;
    positionIds?: unknown;
    departmentNames?: unknown;
    positionNames?: unknown;
    text?: unknown;
  }): Promise<AuditScope> {
    const departments = (await organization.listTree()).filter((d) => d.active);
    const positions = [...(await reads.positions())];
    const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => str(x)) : []);
    const departmentIds = new Set(
      list(input.departmentIds).filter((id) =>
        departments.some((d) => d.id === id),
      ),
    );
    const positionIds = new Set(
      list(input.positionIds).filter((id) => positions.some(([p]) => p === id)),
    );
    const names = [
      ...list(input.departmentNames),
      ...list(input.positionNames),
    ];
    const text = `${typeof input.text === 'string' ? input.text : ''} ${names.join(' ')}`;
    if (text.trim()) {
      const titles = departments.map((d) => ({
        id: d.id,
        parentId: d.parentId,
        title: organization.titleText(d.title),
      }));
      // Whole titles first, longest first, each taken out of the sentence once matched.
      let rest = text;
      for (const d of [...titles].sort(
        (a, b) => b.title.length - a.title.length,
      )) {
        if (!d.title || !rest.includes(d.title)) continue;
        departmentIds.add(d.id);
        rest = rest.split(d.title).join(' ');
      }
      // "苏州和成都机加工车间": a workshop title shared by several plants, qualified by each plant named.
      for (const d of titles) {
        const parent = titles.find((p) => p.id === d.parentId);
        if (!parent) continue;
        const prefix = parent.title.replace(/工厂$/u, '');
        if (!prefix || prefix === parent.title) continue;
        const generic = d.title.startsWith(prefix)
          ? d.title.slice(prefix.length)
          : d.title;
        if (generic && text.includes(generic) && text.includes(prefix))
          departmentIds.add(d.id);
      }
      // A plant named only as the qualifier of a workshop is not itself the scope.
      for (const id of [...departmentIds]) {
        const children = titles.filter(
          (c) => c.parentId === id && departmentIds.has(c.id),
        );
        if (children.length) departmentIds.delete(id);
      }
      for (const [id, title] of positions)
        if (
          title &&
          (text.includes(title) ||
            text.replace(/\s/gu, '').includes(title.replace(/\s/gu, '')))
        )
          positionIds.add(id);
    }
    return { departmentIds: [...departmentIds], positionIds: [...positionIds] };
  }

  async function scopeText(scope: AuditScope): Promise<string> {
    const positions = await reads.positions();
    const departments = [];
    for (const id of scope.departmentIds)
      departments.push(await deps.departmentTitle(id));
    return `部门：${departments.join('、') || '全部'}；岗位：${scope.positionIds.map((id) => positions.get(id) ?? id).join('、') || '全部'}`;
  }

  const service = {
    resolveScope,

    async log(ctx: ActorContext) {
      const policies = await authorizeAction(
        ctx.authz,
        AUDIT,
        'exportTrainingFile',
      ).catch(async () =>
        authorizeAction(ctx.authz, AUDIT, 'exportQualificationLedger'),
      );
      void policies;
      const rows = await database
        .query()
        .selectFrom('auditExports')
        .selectAll()
        .orderBy('createdAt', 'desc')
        .limit(200)
        .execute();
      const out = [];
      for (const row of rows)
        out.push({
          id: str(row.id),
          kind: str(row.kind),
          // A download through a customer's share link has no user (mail/audit.ts).
          actorName:
            str(row.actorUserId) === 'external'
              ? '客户（分享链接）'
              : ((await platform.userName(str(row.actorUserId))) ??
                str(row.actorUserId)),
          fileName: row.fileName ? str(row.fileName) : null,
          summary: row.summary ? str(row.summary) : null,
          via: str(row.via),
          createdAt: iso(row.createdAt) ?? '',
        });
      return out;
    },

    /** 个人培训档案. */
    async trainingFile(ctx: ActorContext, employeeId: string, via = 'page') {
      const person = (await scoped(ctx, 'exportTrainingFile')).find(
        (p) => p.id === employeeId,
      );
      if (!person) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const query = database.query();
      const positions = await reads.positions();
      const competencies = await reads.competencies();
      const versions = await documentVersions();
      const blocks: PdfBlock[] = [
        { kind: 'title', text: `个人培训档案 · ${person.name}` },
        {
          kind: 'muted',
          text: `生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC · 生成人：${(await platform.userName(ctx.userId)) ?? ''}`,
        },
        { kind: 'heading', text: '基本信息' },
        {
          kind: 'table',
          rows: [
            ['工号', '姓名', '部门', '岗位', '入职日期', '状态'],
            [
              person.employeeNo,
              person.name,
              await deps.departmentTitle(person.departmentId),
              positions.get(person.positionId ?? '') ?? '',
              person.hireDate ?? '',
              person.status,
            ],
          ],
        },
      ];
      const levels =
        (await reads.levels([person.id])).get(person.id) ?? new Map();
      const requirements =
        (await reads.requirements()).get(person.positionId ?? '') ?? [];
      blocks.push(
        { kind: 'heading', text: '岗位要求' },
        {
          kind: 'table',
          rows: [
            ['能力项', '要求等级', '当前等级', '必备'],
            ...requirements.map((r) => [
              competencies.get(r.competencyId)?.title ?? r.competencyId,
              String(r.requiredLevel),
              String(
                (levels.get(r.competencyId) as LevelRow | undefined)?.level ??
                  '未评定',
              ),
              r.mandatory ? '是' : '否',
            ]),
          ],
        },
      );
      const events = await query
        .selectFrom('jobEvents')
        .select([
          'eventType',
          'effectiveDate',
          'toDepartmentId',
          'toPositionId',
        ])
        .where('employeeId', '=', person.id)
        .orderBy('effectiveDate', 'asc')
        .execute();
      const eventRows: string[][] = [['日期', '类型', '部门', '岗位']];
      for (const e of events)
        eventRows.push([
          dateOnly(e.effectiveDate) ?? '',
          EVENT_LABEL[str(e.eventType)] ?? str(e.eventType),
          e.toDepartmentId
            ? await deps.departmentTitle(str(e.toDepartmentId))
            : '',
          e.toPositionId ? (positions.get(str(e.toPositionId)) ?? '') : '',
        ]);
      blocks.push(
        { kind: 'heading', text: '岗位变动记录' },
        { kind: 'table', rows: eventRows },
      );
      const learning = await query
        .selectFrom('assignments')
        .innerJoin('courses', 'courses.id', 'assignments.courseId')
        .select([
          'courses.title as title',
          'assignments.completedAt as completedAt',
          'assignments.courseVersion as courseVersion',
          'assignments.courseSourceDocumentId as documentId',
          'assignments.source as source',
          'courses.version as currentVersion',
        ])
        .where('assignments.employeeId', '=', person.id)
        .where('assignments.status', '=', 'completed')
        .execute();
      blocks.push(
        { kind: 'heading', text: '学习记录' },
        {
          kind: 'table',
          rows: [
            [
              '课程',
              '完成时间',
              '完成时课程版本',
              '来源文档版本',
              '现行版本',
              '来源',
            ],
            ...learning
              .sort((a, b) =>
                (iso(a.completedAt) ?? '').localeCompare(
                  iso(b.completedAt) ?? '',
                ),
              )
              .map((l) => [
                str(l.title),
                (iso(l.completedAt) ?? '').slice(0, 10),
                `V${Number(l.courseVersion ?? 1)}`,
                l.documentId ? (versions.get(str(l.documentId)) ?? '') : '—',
                `V${Number(l.currentVersion ?? 1)}`,
                str(l.source),
              ]),
          ],
        },
      );
      const enrollments = await query
        .selectFrom('trainingEnrollments')
        .innerJoin(
          'trainingSessions',
          'trainingSessions.id',
          'trainingEnrollments.sessionId',
        )
        .select([
          'trainingSessions.title as title',
          'trainingSessions.startAt as startAt',
          'trainingEnrollments.status as status',
          'trainingEnrollments.checkedInAt as checkedInAt',
        ])
        .where('trainingEnrollments.employeeId', '=', person.id)
        .execute();
      blocks.push(
        { kind: 'heading', text: '线下签到' },
        {
          kind: 'table',
          rows: [
            ['班次', '开始时间', '状态', '签到时间'],
            ...enrollments.map((e) => [
              str(e.title),
              (iso(e.startAt) ?? '').replace('T', ' ').slice(0, 16),
              str(e.status),
              (iso(e.checkedInAt) ?? '').replace('T', ' ').slice(0, 16),
            ]),
          ],
        },
      );
      const attempts = await query
        .selectFrom('examAttempts')
        .innerJoin('exams', 'exams.id', 'examAttempts.examId')
        .select([
          'exams.title as title',
          'examAttempts.score as score',
          'examAttempts.status as status',
          'examAttempts.submittedAt as submittedAt',
          'examAttempts.attemptNo as attemptNo',
        ])
        .where('examAttempts.employeeId', '=', person.id)
        .where('examAttempts.status', 'in', ['passed', 'failed', 'grading'])
        .execute();
      blocks.push(
        { kind: 'heading', text: '考试答卷' },
        {
          kind: 'table',
          rows: [
            ['考试', '第几次', '分数', '结果', '交卷时间'],
            ...attempts
              .sort((a, b) =>
                (iso(a.submittedAt) ?? '').localeCompare(
                  iso(b.submittedAt) ?? '',
                ),
              )
              .map((a) => [
                str(a.title),
                a.attemptNo == null ? '' : str(a.attemptNo),
                a.score == null ? '' : str(a.score),
                str(a.status),
                (iso(a.submittedAt) ?? '').replace('T', ' ').slice(0, 16),
              ]),
          ],
        },
      );
      const certificates = await reads.certificates([person.id]);
      const titles = new Map(
        (
          await query
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [str(c.id), str(c.title)]),
      );
      blocks.push(
        { kind: 'heading', text: '证书历史' },
        {
          kind: 'table',
          rows: [
            ['证书', '编号', '发证日', '到期日', '状态', '说明'],
            ...certificates.map((c) => [
              titles.get(c.certificationId) ?? c.certificationId,
              c.certificateNo,
              c.issuedAt ?? '',
              c.expiresAt ?? '长期',
              c.status,
              c.revokedReason ?? '',
            ]),
          ],
        },
      );
      const assessments = await query
        .selectFrom('employeeCompetencies')
        .select([
          'competencyId',
          'level',
          'source',
          'assessedBy',
          'assessedAt',
          'suggestionId',
        ])
        .where('employeeId', '=', person.id)
        .execute();
      const assessmentRows: string[][] = [
        ['能力项', '等级', '来源', '评定人', '评定时间'],
      ];
      for (const a of assessments.sort((x, y) =>
        (iso(x.assessedAt) ?? '').localeCompare(iso(y.assessedAt) ?? ''),
      ))
        assessmentRows.push([
          competencies.get(str(a.competencyId))?.title ?? str(a.competencyId),
          String(a.level),
          `${str(a.source)}${a.suggestionId ? '（采纳建议）' : ''}`,
          (await platform.userName(a.assessedBy ? str(a.assessedBy) : null)) ??
            '',
          (iso(a.assessedAt) ?? '').slice(0, 10),
        ]);
      blocks.push(
        { kind: 'heading', text: '能力评定历史' },
        { kind: 'table', rows: assessmentRows },
      );
      const fileName = `training-file-${person.employeeNo || person.id}.pdf`;
      await log(ctx, {
        kind: 'trainingFile',
        scope: { employeeId: person.id },
        fileName,
        summary: `个人培训档案：${person.name}`,
        via,
      });
      return {
        bytes: renderPdf(blocks, {
          title: `个人培训档案 ${person.name}`,
          footer: 'NocoHR 个人培训档案',
        }),
        fileName,
      };
    },

    /** Completed recommendations with a proof, for the 专项培训证明 tab. */
    async proofs(ctx: ActorContext) {
      const policies = await authorizeAction(
        ctx.authz,
        AUDIT,
        'exportRecommendationProof',
      );
      const rows = (await database
        .repository('trainingRecommendations')
        .withPolicy(policyOf(policies, 'trainingRecommendations'))
        .findMany({ filter: { status: 'completed' } })) as Record<
        string,
        unknown
      >[];
      const competencies = await reads.competencies();
      const out = [];
      for (const row of rows)
        out.push({
          id: str(row.id),
          departmentTitle: await deps.departmentTitle(str(row.departmentId)),
          competencyTitle:
            competencies.get(str(row.competencyId))?.title ??
            str(row.competencyId),
          completedAt: iso(row.completedAt),
          hasProof: Boolean(row.certificateFileId),
        });
      return out;
    },

    async logProof(ctx: ActorContext, id: string, fileName: string) {
      await log(ctx, {
        kind: 'recommendationProof',
        scope: { recommendationId: id },
        fileName,
        summary: '专项培训证明',
      });
    },

    /** 培训与资格台账. */
    async ledger(ctx: ActorContext, scope: AuditScope, via = 'page') {
      const people = await inScope(
        await scoped(ctx, 'exportQualificationLedger'),
        scope,
      );
      const workbook = await service.ledgerBook(people);
      const fileName = `qualification-ledger-${platform.currentDate()}.xlsx`;
      await log(ctx, {
        kind: 'qualificationLedger',
        scope,
        fileName,
        summary: `培训与资格台账：${await scopeText(scope)}，${people.length} 人`,
        via,
      });
      return {
        bytes: XLSX.write(workbook, {
          type: 'buffer',
          bookType: 'xlsx',
        }) as Uint8Array,
        fileName,
        people: people.length,
      };
    },

    async ledgerBook(people: PersonRow[]): Promise<XLSX.WorkBook> {
      const today = platform.currentDate();
      const positions = await reads.positions();
      const competencies = await reads.competencies();
      const requirements = await reads.requirements();
      const requiredCerts = await reads.requiredCertifications();
      const ids = people.map((p) => p.id);
      const certificates = await reads.certificates(ids);
      const levels = await reads.levels(ids);
      const versions = await documentVersions();
      const certificationCourses = await database
        .query()
        .selectFrom('certificationCourses')
        .innerJoin('courses', 'courses.id', 'certificationCourses.courseId')
        .select([
          'certificationCourses.certificationId as certificationId',
          'courses.id as courseId',
          'courses.title as title',
          'courses.version as version',
        ])
        .execute();
      const completions = ids.length
        ? await database
            .query()
            .selectFrom('assignments')
            .select([
              'employeeId',
              'courseId',
              'completedAt',
              'courseVersion',
              'courseSourceDocumentId',
            ])
            .where('employeeId', 'in', ids)
            .where('status', '=', 'completed')
            .where('courseId', 'is not', null)
            .execute()
        : [];
      const rows: unknown[][] = [
        [
          '工号',
          '姓名',
          '部门',
          '岗位',
          '岗位要求（当前/要求）',
          '必备认证',
          '认证状态',
          '证书编号',
          '到期日',
          '必修课程完成情况',
        ],
      ];
      for (const person of people) {
        const reqText = (requirements.get(person.positionId ?? '') ?? [])
          .map(
            (r) =>
              `${competencies.get(r.competencyId)?.title ?? ''} ${levels.get(person.id)?.get(r.competencyId)?.level ?? 0}/${r.requiredLevel}`,
          )
          .join('；');
        const certs = requiredCerts.get(person.positionId ?? '') ?? [];
        const department = await deps.departmentTitle(person.departmentId);
        const lines = certs.length ? certs : [null];
        for (const certification of lines) {
          const own = certificates.filter((c) => c.employeeId === person.id);
          const state = certification
            ? certState(own, certification.id, today)
            : null;
          const certificate = state?.certificateId
            ? own.find((c) => c.id === state.certificateId)
            : undefined;
          const courses = certification
            ? certificationCourses
                .filter((c) => str(c.certificationId) === certification.id)
                .map((c) => {
                  const done = completions
                    .filter(
                      (x) =>
                        str(x.employeeId) === person.id &&
                        str(x.courseId) === str(c.courseId),
                    )
                    .sort((a, b) =>
                      (iso(b.completedAt) ?? '').localeCompare(
                        iso(a.completedAt) ?? '',
                      ),
                    )[0];
                  return `${str(c.title)}：${done ? `已完成 ${(iso(done.completedAt) ?? '').slice(0, 10)}（课程 V${Number(done.courseVersion ?? 1)}，${done.courseSourceDocumentId ? (versions.get(str(done.courseSourceDocumentId)) ?? '') : '无来源文档'}）` : '未完成'}（现行 V${Number(c.version ?? 1)}）`;
                })
                .join('；')
            : '';
          rows.push([
            person.employeeNo,
            person.name,
            department,
            positions.get(person.positionId ?? '') ?? '',
            reqText,
            certification?.title ?? '—',
            state ? STATE_LABEL[state.state] : '—',
            certificate?.certificateNo ?? '',
            certificate?.expiresAt ?? state?.expiresAt ?? '',
            courses,
          ]);
        }
      }
      const book = XLSX.utils.book_new();
      sheet(book, '培训与资格台账', rows);
      return book;
    },

    /** 审核前应处理的风险, by rule, each with the records it rests on. */
    async risks(ctx: ActorContext, scope: AuditScope): Promise<AuditRisk[]> {
      const people = await inScope(await scoped(ctx, 'exportAuditPack'), scope);
      return service.risksFor(people);
    },

    async risksFor(people: PersonRow[]): Promise<AuditRisk[]> {
      const today = platform.currentDate();
      const ids = people.map((p) => p.id);
      const requiredCerts = await reads.requiredCertifications();
      const certificates = await reads.certificates(ids);
      const query = database.query();
      const recerts = ids.length
        ? await query
            .selectFrom('assignments')
            .select([
              'id',
              'employeeId',
              'certificateId',
              'examId',
              'courseId',
              'status',
              'dueDate',
              'completedAt',
              'source',
            ])
            .where('employeeId', 'in', ids)
            .execute()
        : [];
      const schedules = ids.length
        ? await query
            .selectFrom('shiftSchedules')
            .leftJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
            .select([
              'shiftSchedules.id as id',
              'shiftSchedules.employeeId as employeeId',
              'shiftSchedules.date as date',
              'shifts.title as shiftTitle',
            ])
            .where('shiftSchedules.employeeId', 'in', ids)
            .where('shiftSchedules.status', '=', 'published')
            .where('shiftSchedules.shiftId', 'is not', null)
            .where(
              'shiftSchedules.date',
              '>=',
              addDays(today, -RISK_SCHEDULE_DAYS),
            )
            .where(
              'shiftSchedules.date',
              '<=',
              addDays(today, RISK_SCHEDULE_DAYS),
            )
            .execute()
        : [];
      const risks: AuditRisk[] = [];
      for (const person of people) {
        const department = await deps.departmentTitle(person.departmentId);
        const own = certificates.filter((c) => c.employeeId === person.id);
        for (const certification of requiredCerts.get(
          person.positionId ?? '',
        ) ?? []) {
          const state = certState(own, certification.id, today);
          const certificate = own.find((c) => c.id === state.certificateId);
          const tasks = recerts.filter(
            (a) =>
              state.certificateId &&
              str(a.certificateId) === state.certificateId,
          );
          if (state.state === 'missing' || state.state === 'expired') {
            const shifts = schedules.filter(
              (s) => str(s.employeeId) === person.id,
            );
            if (!shifts.length) continue;
            const retraining = tasks.length
              ? tasks
                  .map(
                    (t) =>
                      `${TASK_STATUS_LABEL[str(t.status)] ?? str(t.status)}${t.dueDate ? `（截止 ${dateOnly(t.dueDate)}）` : ''}`,
                  )
                  .join('、')
              : '无复训任务';
            risks.push({
              kind: 'certMissingScheduled',
              urgency: 'high',
              employeeId: person.id,
              name: person.name,
              departmentTitle: department,
              text:
                state.state === 'missing'
                  ? `${person.name} 没有${certification.title}，前后 ${RISK_SCHEDULE_DAYS} 天内有 ${shifts.length} 个已发布班次`
                  : `${person.name} 的${certification.title}已于 ${state.expiresAt} 过期（复训：${retraining}），前后 ${RISK_SCHEDULE_DAYS} 天内有 ${shifts.length} 个已发布班次`,
              evidence: [
                ...(certificate
                  ? [
                      {
                        type: 'certificate',
                        id: certificate.id,
                        label: `${certificate.certificateNo} ${STATE_LABEL[state.state]} ${certificate.expiresAt ?? ''}`,
                      },
                    ]
                  : []),
                ...tasks.map((t) => ({
                  type: 'assignment',
                  id: str(t.id),
                  label: `复训任务 ${str(t.status)}`,
                })),
                ...shifts
                  .sort((a, b) => str(a.date).localeCompare(str(b.date)))
                  .map((s) => ({
                    type: 'shiftSchedule',
                    id: str(s.id),
                    label: `${dateOnly(s.date)} ${str(s.shiftTitle ?? '')}`,
                  })),
              ],
            });
          } else if (
            state.expiresAt &&
            state.expiresAt <= addDays(today, RISK_EXPIRY_DAYS) &&
            !tasks.some(
              (t) => t.status === 'inProgress' || t.status === 'completed',
            )
          )
            risks.push({
              kind: 'certExpiringNoRecert',
              urgency: 'medium',
              employeeId: person.id,
              name: person.name,
              departmentTitle: department,
              text: `${person.name} 的${certification.title} ${state.expiresAt} 到期（还有 ${Math.round((Date.parse(state.expiresAt) - Date.parse(today)) / 86_400_000)} 天），复审${tasks.length ? '任务未开始' : '尚未安排'}`,
              evidence: [
                ...(certificate
                  ? [
                      {
                        type: 'certificate',
                        id: certificate.id,
                        label: `${certificate.certificateNo} ${certificate.expiresAt ?? ''}`,
                      },
                    ]
                  : []),
                ...tasks.map((t) => ({
                  type: 'assignment',
                  id: str(t.id),
                  label: `复审任务 ${str(t.status)}`,
                })),
              ],
            });
        }
        for (const task of recerts.filter(
          (a) =>
            str(a.employeeId) === person.id &&
            a.source === 'revision' &&
            a.status !== 'completed' &&
            a.status !== 'cancelled' &&
            a.dueDate &&
            dateOnly(a.dueDate)! < today,
        ))
          risks.push({
            kind: 'revisionTrainingOverdue',
            urgency: 'medium',
            employeeId: person.id,
            name: person.name,
            departmentTitle: department,
            text: `${person.name} 的作业文件变更要点培训已过截止日 ${dateOnly(task.dueDate)} 仍未完成`,
            evidence: [
              {
                type: 'assignment',
                id: str(task.id),
                label: `差异培训 ${str(task.status)}`,
              },
            ],
          });
      }
      const order = {
        certMissingScheduled: 0,
        certExpiringNoRecert: 1,
        revisionTrainingOverdue: 2,
      };
      return risks.sort(
        (a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name),
      );
    },

    /**
     * 客户审核包: a cover PDF with the risks and one workbook; only what the caller may read.
     * For an audit request (`options.forCustomer`) the pack goes to the customer by link: it keeps
     * only the confirmed 资料类型 (`options.materials`) and its cover carries no risks — those stay
     * on the request for internal audit (V3-11: whether to tell the auditor is quality's decision).
     * On the 审计导出 page every sheet and the risks are included.
     */
    async pack(
      ctx: ActorContext,
      scope: AuditScope,
      via = 'page',
      options: { materials?: readonly string[]; forCustomer?: boolean } = {},
    ) {
      const { materials, forCustomer = false } = options;
      if (materials && !materials.length)
        throw new HrError('AUDIT_MATERIALS_REQUIRED', 400);
      const people = await inScope(await scoped(ctx, 'exportAuditPack'), scope);
      if (!people.length) throw new HrError('AUDIT_SCOPE_EMPTY', 400);
      const risks = await service.risksFor(people);
      const today = platform.currentDate();
      const positions = await reads.positions();
      const competencies = await reads.competencies();
      const requirements = await reads.requirements();
      const ids = people.map((p) => p.id);
      const levels = await reads.levels(ids);
      const certificates = await reads.certificates(ids);
      const versions = await documentVersions();
      const titles = new Map(
        (
          await database
            .query()
            .selectFrom('certifications')
            .select(['id', 'title'])
            .execute()
        ).map((c) => [str(c.id), str(c.title)]),
      );
      const names = new Map(people.map((p) => [p.id, p]));
      const book = await service.ledgerBook(people);
      const ledgerSheets = [...book.SheetNames];
      // 能力矩阵: requirement × current level.
      const columns = [
        ...new Set(
          people.flatMap((p) =>
            (requirements.get(p.positionId ?? '') ?? []).map(
              (r) => r.competencyId,
            ),
          ),
        ),
      ];
      sheet(book, '能力矩阵', [
        [
          '工号',
          '姓名',
          '岗位',
          ...columns.map((c) => competencies.get(c)?.title ?? c),
        ],
        ...people.map((p) => [
          p.employeeNo,
          p.name,
          positions.get(p.positionId ?? '') ?? '',
          ...columns.map((c) => {
            const r = (requirements.get(p.positionId ?? '') ?? []).find(
              (x) => x.competencyId === c,
            );
            return r
              ? `${levels.get(p.id)?.get(c)?.level ?? 0}/${r.requiredLevel}`
              : '—';
          }),
        ]),
      ]);
      const learning = await database
        .query()
        .selectFrom('assignments')
        .leftJoin('courses', 'courses.id', 'assignments.courseId')
        .leftJoin('exams', 'exams.id', 'assignments.examId')
        .select([
          'assignments.id as id',
          'assignments.employeeId as employeeId',
          'assignments.status as status',
          'assignments.source as source',
          'assignments.dueDate as dueDate',
          'assignments.completedAt as completedAt',
          'assignments.courseVersion as courseVersion',
          'assignments.courseSourceDocumentId as documentId',
          'assignments.certificateId as certificateId',
          'courses.title as courseTitle',
          'courses.kind as courseKind',
          'exams.title as examTitle',
        ])
        .where('assignments.employeeId', 'in', ids)
        .execute();
      const attempts = await database
        .query()
        .selectFrom('examAttempts')
        .innerJoin('exams', 'exams.id', 'examAttempts.examId')
        .select([
          'examAttempts.employeeId as employeeId',
          'exams.title as title',
          'examAttempts.score as score',
          'examAttempts.status as status',
          'examAttempts.submittedAt as submittedAt',
        ])
        .where('examAttempts.employeeId', 'in', ids)
        .where('examAttempts.status', 'in', ['passed', 'failed'])
        .execute();
      sheet(book, '培训与考试记录', [
        [
          '工号',
          '姓名',
          '类型',
          '内容',
          '状态',
          '完成/交卷时间',
          '课程版本',
          '来源文档',
          '分数',
        ],
        ...learning
          .filter((a) => a.courseTitle || a.examTitle)
          .map((a) => [
            names.get(str(a.employeeId))?.employeeNo ?? '',
            names.get(str(a.employeeId))?.name ?? '',
            a.courseTitle ? '课程' : '考试任务',
            str(a.courseTitle ?? a.examTitle ?? ''),
            str(a.status),
            (iso(a.completedAt) ?? '').slice(0, 10),
            a.courseTitle && a.status === 'completed'
              ? `V${Number(a.courseVersion ?? 1)}`
              : '',
            a.documentId ? (versions.get(str(a.documentId)) ?? '') : '',
            '',
          ]),
        ...attempts.map((a) => [
          names.get(str(a.employeeId))?.employeeNo ?? '',
          names.get(str(a.employeeId))?.name ?? '',
          '考试',
          str(a.title),
          str(a.status),
          (iso(a.submittedAt) ?? '').slice(0, 10),
          '',
          '',
          a.score == null ? '' : str(a.score),
        ]),
      ]);
      sheet(book, '证书及有效期', [
        ['工号', '姓名', '证书', '编号', '发证日', '到期日', '状态'],
        ...certificates.map((c) => [
          names.get(c.employeeId)?.employeeNo ?? '',
          names.get(c.employeeId)?.name ?? '',
          titles.get(c.certificationId) ?? c.certificationId,
          c.certificateNo,
          c.issuedAt ?? '',
          c.expiresAt ?? '长期',
          STATE_LABEL[certState([c], c.certificationId, today).state] ??
            c.status,
        ]),
      ]);
      sheet(book, '过期与吊销处理', [
        [
          '工号',
          '姓名',
          '证书',
          '编号',
          '过期日 / 吊销',
          '对应任务',
          '复训情况',
        ],
        ...certificates
          .filter(
            (c) =>
              ['expired', 'revoked'].includes(c.status) ||
              (c.expiresAt && c.expiresAt < today),
          )
          .map((c) => {
            const tasks = learning.filter(
              (a) => str(a.certificateId ?? '') === c.id,
            );
            return [
              names.get(c.employeeId)?.employeeNo ?? '',
              names.get(c.employeeId)?.name ?? '',
              titles.get(c.certificationId) ?? c.certificationId,
              c.certificateNo,
              c.status === 'revoked'
                ? `吊销：${c.revokedReason ?? ''}`
                : (c.expiresAt ?? ''),
              tasks
                .map((t) => str(t.courseTitle ?? t.examTitle ?? '复审'))
                .join('、') || '无',
              tasks
                .map(
                  (t) =>
                    `${str(t.status)}${t.completedAt ? ` ${(iso(t.completedAt) ?? '').slice(0, 10)}` : ''}`,
                )
                .join('、') || '未安排',
            ];
          }),
      ]);
      sheet(book, '差异培训完成情况', [
        ['工号', '姓名', '变更要点课程', '截止日', '状态', '完成时间'],
        ...learning
          .filter(
            (a) => a.source === 'revision' || a.courseKind === 'changeBrief',
          )
          .map((a) => [
            names.get(str(a.employeeId))?.employeeNo ?? '',
            names.get(str(a.employeeId))?.name ?? '',
            str(a.courseTitle ?? ''),
            dateOnly(a.dueDate) ?? '',
            str(a.status),
            (iso(a.completedAt) ?? '').slice(0, 10),
          ]),
      ]);
      // 审核包只含 scope 内的资料: drop the sheets of the material types not asked for.
      if (materials) {
        const sheetsOf: Record<string, readonly string[]> = {
          qualificationLedger: ledgerSheets,
          competencyMatrix: ['能力矩阵'],
          trainingRecords: ['培训与考试记录'],
          certificates: ['证书及有效期', '过期与吊销处理'],
          revisionTraining: ['差异培训完成情况'],
        };
        const keep = new Set(materials.flatMap((m) => sheetsOf[m] ?? []));
        for (const name of [...book.SheetNames])
          if (!keep.has(name)) {
            book.SheetNames.splice(book.SheetNames.indexOf(name), 1);
            delete book.Sheets[name];
          }
        if (!book.SheetNames.length)
          throw new HrError('AUDIT_MATERIALS_REQUIRED', 400);
      }
      const generatedBy = (await platform.userName(ctx.userId)) ?? ctx.userId;
      const range = await scopeText(scope);
      const cover = renderPdf(
        [
          { kind: 'title', text: '客户审核包' },
          {
            kind: 'text',
            text: `生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
          },
          {
            kind: 'text',
            text: `数据范围：${range}（在职 ${people.length} 人）`,
          },
          { kind: 'text', text: `生成人：${generatedBy}` },
          ...(forCustomer
            ? []
            : [
                { kind: 'heading' as const, text: '审核前应处理的风险' },
                ...(risks.length
                  ? risks.map((r, i) => ({
                      kind: 'text' as const,
                      text: `${i + 1}. [${r.urgency === 'high' ? '紧急' : '关注'}] ${r.text}`,
                    }))
                  : [
                      {
                        kind: 'text' as const,
                        text: '没有需要在审核前处理的风险。',
                      },
                    ]),
              ]),
          { kind: 'heading', text: '包内文件' },
          {
            kind: 'text',
            text: `audit-pack.xlsx：${book.SheetNames.join('、')}。`,
          },
          {
            kind: 'muted',
            text: forCustomer
              ? '本审核包只包含所请求的资料，不含手机号、证件号、住址与薪资。'
              : '本审核包只包含生成人有权查看的数据，不含手机号、证件号、住址与薪资。是否向审核方说明风险由质量部决定。',
          },
        ],
        { title: '客户审核包', footer: 'NocoHR 客户审核包' },
      );
      // Node's ESM loader puts CFB on the module's default export only; Vitest's interop also exposes it on the namespace.
      const xlsxModule = XLSX as unknown as {
        CFB?: unknown;
        default?: { CFB?: unknown };
      };
      const XLSXCFB = (
        { CFB: xlsxModule.CFB ?? xlsxModule.default?.CFB } as unknown as {
          CFB: {
            utils: {
              cfb_new(): unknown;
              cfb_add(c: unknown, name: string, data: Uint8Array): void;
            };
            write(
              c: unknown,
              o: { fileType: 'zip'; type: 'buffer' },
            ): Uint8Array;
          };
        }
      ).CFB;
      const zip = XLSXCFB.utils.cfb_new();
      XLSXCFB.utils.cfb_add(zip, '/cover.pdf', cover);
      XLSXCFB.utils.cfb_add(
        zip,
        '/audit-pack.xlsx',
        XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array,
      );
      const bytes = XLSXCFB.write(zip, { fileType: 'zip', type: 'buffer' });
      const fileName = `audit-pack-${today}.zip`;
      await log(ctx, {
        kind: 'auditPack',
        scope,
        fileName,
        summary: `客户审核包：${range}，${people.length} 人，风险 ${risks.length} 条`,
        via,
      });
      return {
        bytes,
        fileName,
        people: people.length,
        risks,
        sheets: [...book.SheetNames],
      };
    },
  };
  return service;
}

export type AuditService = ReturnType<typeof createAuditService>;

/**
 * V4-12 过程数据快照 and 质量与安全参考分. The snapshot keeps counts, numbers
 * and record ids of the review period only — never the description of a
 * quality issue — and is built on the server:
 *
 * | Part | Source |
 * |---|---|
 * | attendance | locked attendanceMonthlySummaries of the period's months |
 * | learning | required (non-optional) assignments due in the period |
 * | exams | examAttempts submitted in the period; certification exams listed |
 * | certificates | the position's required certifications, valid days in the period so far |
 * | quality | businessSignals of type qualityIssue in the period |
 * | competencies | employeeCompetencies assessed in the period |
 * | practice / training | practiceSessions completed, trainingRecommendations completed |
 * | jobEvents | transfers and promotions in the period |
 *
 * The quality and safety reference score follows the scheme's rules (default:
 * from 5, major −1.5, minor −0.5, on-time rate of required learning below 90 %
 * −1, any expired day of a required certificate −1, at least 1; categories in
 * `excludeCategories` — 设备故障 by default — are listed but not counted).
 */
import type { DatabaseManager } from '@nocobase/db';

import { requiredCertificationsOf } from '../certificate-hooks.js';
import { str } from '../shared.js';
import { day, iso, json, num, round2, type QualityRules } from './common.js';

export interface EvidenceSnapshot {
  generatedAt: string;
  period: { start: string; end: string; through: string };
  attendance: {
    months: string[];
    lateCount: number;
    earlyCount: number;
    missingCount: number;
    absentDays: number;
    summaryIds: string[];
  };
  learning: {
    required: number;
    dueSoFar: number;
    completedOnTime: number;
    overdue: number;
    onTimeRate: number | null;
    remedialCompleted: number;
    assignmentIds: string[];
  };
  exams: {
    attempts: number;
    firstAttempts: number;
    firstPassed: number;
    firstPassRate: number | null;
    certificationExams: {
      attemptId: string;
      examId: string;
      title: string;
      score: number | null;
      passed: boolean;
      at: string | null;
    }[];
  };
  certificates: {
    certificationId: string;
    title: string;
    validDays: number;
    periodDays: number;
    validRatio: number | null;
    expiredDays: number;
    certificateIds: string[];
  }[];
  quality: {
    critical: number;
    major: number;
    minor: number;
    issues: {
      id: string;
      externalId: string;
      severity: string | null;
      category: string | null;
      occurredAt: string | null;
      counted: boolean;
    }[];
  };
  competencies: {
    assessmentId: string;
    competencyId: string;
    title: string;
    from: number | null;
    to: number;
    source: string;
    at: string | null;
  }[];
  practice: { completed: number; sessionIds: string[] };
  training: { completedRecommendations: string[] };
  jobEvents: { id: string; type: string; date: string | null }[];
  qualitySafety: QualitySafetyScore;
}

export interface QualitySafetyScore {
  score: number;
  base: number;
  deductions: { rule: string; count: number; points: number }[];
}

const DAY = 86_400_000;
const daysIn = (from: string, to: string): number =>
  from > to
    ? 0
    : Math.round(
        (new Date(`${to}T00:00:00Z`).getTime() -
          new Date(`${from}T00:00:00Z`).getTime()) /
          DAY,
      ) + 1;

/** The reference score of a snapshot under a scheme's rules. */
export function qualitySafetyScore(
  snapshot: Pick<
    EvidenceSnapshot,
    'quality' | 'learning' | 'certificates' | 'attendance'
  >,
  rules: QualityRules,
): QualitySafetyScore {
  const excluded = new Set(rules.excludeCategories);
  const deductions: QualitySafetyScore['deductions'] = [];
  const counted = snapshot.quality.issues.filter(
    (issue) => !issue.category || !excluded.has(issue.category),
  );
  for (const severity of ['critical', 'major', 'minor'] as const) {
    const count = counted.filter((i) => i.severity === severity).length;
    if (count && rules.perIssue[severity])
      deductions.push({
        rule: `quality.${severity}`,
        count,
        points: round2(count * rules.perIssue[severity]),
      });
  }
  if (
    rules.learningOnTime.enabled &&
    snapshot.learning.onTimeRate !== null &&
    snapshot.learning.onTimeRate < rules.learningOnTime.below
  )
    deductions.push({
      rule: 'learning.onTime',
      count: 1,
      points: rules.learningOnTime.points,
    });
  const expired = snapshot.certificates.filter((c) => c.expiredDays > 0).length;
  if (rules.certificateExpired.enabled && expired)
    deductions.push({
      rule: 'certificate.expired',
      count: expired,
      points: rules.certificateExpired.points,
    });
  if (rules.absentDays.enabled && snapshot.attendance.absentDays > 0)
    deductions.push({
      rule: 'attendance.absent',
      count: snapshot.attendance.absentDays,
      points: round2(snapshot.attendance.absentDays * rules.absentDays.perDay),
    });
  const total = deductions.reduce((sum, d) => sum + d.points, 0);
  return {
    score: round2(Math.max(rules.min, rules.base + total)),
    base: rules.base,
    deductions,
  };
}

/** Recomputes the reference score of a stored snapshot (after a rule change). */
export function rescore(
  snapshot: EvidenceSnapshot,
  rules: QualityRules,
): EvidenceSnapshot {
  const excluded = new Set(rules.excludeCategories);
  const issues = snapshot.quality.issues.map((issue) => ({
    ...issue,
    counted: !issue.category || !excluded.has(issue.category),
  }));
  const quality = { ...snapshot.quality, issues };
  return {
    ...snapshot,
    quality,
    qualitySafety: qualitySafetyScore({ ...snapshot, quality }, rules),
  };
}

export async function buildSnapshot(
  database: DatabaseManager,
  input: {
    employeeId: string;
    positionId: string | null;
    periodStart: string;
    periodEnd: string;
    today: string;
    rules: QualityRules;
  },
): Promise<EvidenceSnapshot> {
  const query = database.query();
  const { employeeId, periodStart: start, periodEnd: end } = input;
  const through = input.today < end ? input.today : end;
  const inPeriod = (value: unknown) => {
    const d = day(value);
    return Boolean(d && d >= start && d <= end);
  };

  // ---- Attendance: only locked monthly summaries ----
  const summaries = (
    await query
      .selectFrom('attendanceMonthlySummaries')
      .select([
        'id',
        'month',
        'lateCount',
        'earlyCount',
        'missingCount',
        'absentDays',
        'status',
      ])
      .where('employeeId', '=', employeeId)
      .where('month', '>=', start.slice(0, 7))
      .where('month', '<=', end.slice(0, 7))
      .execute()
  ).filter((s) => str(s.status) === 'locked');
  const sum = (field: string) =>
    round2(
      summaries.reduce(
        (total, s) => total + (num((s as Record<string, unknown>)[field]) ?? 0),
        0,
      ),
    );
  const attendance = {
    months: summaries.map((s) => str(s.month)).sort(),
    lateCount: sum('lateCount'),
    earlyCount: sum('earlyCount'),
    missingCount: sum('missingCount'),
    absentDays: sum('absentDays'),
    summaryIds: summaries.map((s) => str(s.id)),
  };

  // ---- Required learning ----
  const assignments = (
    await query
      .selectFrom('assignments')
      .select(['id', 'dueDate', 'status', 'completedAt', 'source', 'optional'])
      .where('employeeId', '=', employeeId)
      .execute()
  ).filter(
    (a) =>
      str(a.status) !== 'cancelled' &&
      !(a.optional === true || a.optional === 1) &&
      inPeriod(a.dueDate),
  );
  const dueSoFar = assignments.filter((a) => (day(a.dueDate) ?? '') <= through);
  const onTime = dueSoFar.filter(
    (a) =>
      str(a.status) === 'completed' &&
      a.completedAt &&
      (iso(a.completedAt) ?? '').slice(0, 10) <= (day(a.dueDate) ?? ''),
  );
  const overdue = dueSoFar.filter(
    (a) =>
      str(a.status) !== 'completed' ||
      (iso(a.completedAt) ?? '').slice(0, 10) > (day(a.dueDate) ?? ''),
  );
  const remedial = (
    await query
      .selectFrom('assignments')
      .select(['id', 'source', 'status', 'completedAt'])
      .where('employeeId', '=', employeeId)
      .where('source', '=', 'remedial')
      .where('status', '=', 'completed')
      .execute()
  ).filter((a) => inPeriod(a.completedAt));
  const learning = {
    required: assignments.length,
    dueSoFar: dueSoFar.length,
    completedOnTime: onTime.length,
    overdue: overdue.length,
    onTimeRate: dueSoFar.length
      ? round2((onTime.length / dueSoFar.length) * 100)
      : null,
    remedialCompleted: remedial.length,
    assignmentIds: [
      ...new Set([...assignments, ...remedial].map((a) => str(a.id))),
    ],
  };

  // ---- Exams ----
  const attempts = (
    await query
      .selectFrom('examAttempts')
      .innerJoin('exams', 'exams.id', 'examAttempts.examId')
      .select([
        'examAttempts.id as id',
        'examAttempts.examId as examId',
        'examAttempts.attemptNo as attemptNo',
        'examAttempts.status as status',
        'examAttempts.score as score',
        'examAttempts.submittedAt as submittedAt',
        'exams.title as title',
      ])
      .where('examAttempts.employeeId', '=', employeeId)
      .execute()
  ).filter(
    (a) =>
      a.submittedAt &&
      inPeriod(a.submittedAt) &&
      ['passed', 'failed', 'grading'].includes(str(a.status)),
  );
  const certificationExamIds = new Set(
    (
      await query.selectFrom('certificationExams').select(['examId']).execute()
    ).map((r) => str(r.examId)),
  );
  const first = attempts.filter((a) => Number(a.attemptNo) === 1);
  const exams = {
    attempts: attempts.length,
    firstAttempts: first.length,
    firstPassed: first.filter((a) => str(a.status) === 'passed').length,
    firstPassRate: first.length
      ? round2(
          (first.filter((a) => str(a.status) === 'passed').length /
            first.length) *
            100,
        )
      : null,
    certificationExams: attempts
      .filter((a) => certificationExamIds.has(str(a.examId)))
      .map((a) => ({
        attemptId: str(a.id),
        examId: str(a.examId),
        title: str(a.title),
        score: num(a.score),
        passed: str(a.status) === 'passed',
        at: iso(a.submittedAt),
      })),
  };

  // ---- Required certificates ----
  const required = input.positionId
    ? await requiredCertificationsOf(database, input.positionId)
    : [];
  const certificates: EvidenceSnapshot['certificates'] = [];
  const periodDays = daysIn(start, through);
  for (const certification of required) {
    const held = await query
      .selectFrom('employeeCertificates')
      .select(['id', 'issuedAt', 'expiresAt', 'status'])
      .where('employeeId', '=', employeeId)
      .where('certificationId', '=', certification.id)
      .execute();
    const covered = new Set<string>();
    let firstExpiry: string | null = null;
    for (const certificate of held) {
      if (str(certificate.status) === 'revoked') continue;
      const from = day(certificate.issuedAt) ?? start;
      const expires = day(certificate.expiresAt);
      const to = expires ?? through;
      if (expires && (!firstExpiry || expires < firstExpiry))
        firstExpiry = expires;
      const a = from > start ? from : start;
      const b = to < through ? to : through;
      for (
        let d = new Date(`${a}T00:00:00Z`);
        d.toISOString().slice(0, 10) <= b;
        d.setUTCDate(d.getUTCDate() + 1)
      )
        covered.add(d.toISOString().slice(0, 10));
    }
    let expiredDays = 0;
    if (firstExpiry && firstExpiry < through)
      for (
        let d = new Date(
          `${firstExpiry > start ? firstExpiry : start}T00:00:00Z`,
        );
        d.toISOString().slice(0, 10) <= through;
        d.setUTCDate(d.getUTCDate() + 1)
      ) {
        const key = d.toISOString().slice(0, 10);
        if (key > firstExpiry && !covered.has(key)) expiredDays += 1;
      }
    certificates.push({
      certificationId: certification.id,
      title: certification.title,
      validDays: covered.size,
      periodDays,
      validRatio: periodDays ? round2((covered.size / periodDays) * 100) : null,
      expiredDays,
      certificateIds: held.map((c) => str(c.id)),
    });
  }

  // ---- Quality issues: numbers and ids only ----
  const signals = (
    await query
      .selectFrom('businessSignals')
      .select(['id', 'externalId', 'severity', 'category', 'occurredAt'])
      .where('employeeId', '=', employeeId)
      .where('signalType', '=', 'qualityIssue')
      .execute()
  )
    .filter((s) => inPeriod(s.occurredAt))
    .sort((a, b) => str(a.externalId).localeCompare(str(b.externalId)));
  const excluded = new Set(input.rules.excludeCategories);
  const issues = signals.map((s) => ({
    id: str(s.id),
    externalId: str(s.externalId),
    severity: s.severity ? str(s.severity) : null,
    category: s.category ? str(s.category) : null,
    occurredAt: iso(s.occurredAt),
    counted: !s.category || !excluded.has(str(s.category)),
  }));
  const quality = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    major: issues.filter((i) => i.severity === 'major').length,
    minor: issues.filter((i) => i.severity === 'minor').length,
    issues,
  };

  // ---- Competency changes ----
  const assessments = (
    await query
      .selectFrom('employeeCompetencies')
      .innerJoin(
        'competencies',
        'competencies.id',
        'employeeCompetencies.competencyId',
      )
      .select([
        'employeeCompetencies.id as id',
        'employeeCompetencies.competencyId as competencyId',
        'employeeCompetencies.level as level',
        'employeeCompetencies.source as source',
        'employeeCompetencies.assessedAt as assessedAt',
        'employeeCompetencies.createdAt as createdAt',
        'competencies.title as title',
      ])
      .where('employeeCompetencies.employeeId', '=', employeeId)
      .execute()
  ).sort(
    (a, b) =>
      (iso(a.assessedAt) ?? '').localeCompare(iso(b.assessedAt) ?? '') ||
      (iso(a.createdAt) ?? '').localeCompare(iso(b.createdAt) ?? ''),
  );
  const lastLevel = new Map<string, number>();
  const competencies: EvidenceSnapshot['competencies'] = [];
  for (const row of assessments) {
    const competencyId = str(row.competencyId);
    const before = lastLevel.get(competencyId) ?? null;
    const level = Number(row.level);
    if (inPeriod(row.assessedAt) && before !== level)
      competencies.push({
        assessmentId: str(row.id),
        competencyId,
        title: str(row.title),
        from: before,
        to: level,
        source: str(row.source),
        at: iso(row.assessedAt),
      });
    lastLevel.set(competencyId, level);
  }

  // ---- Practice and targeted training ----
  const sessions = (
    await query
      .selectFrom('practiceSessions')
      .select(['id', 'status', 'completedAt', 'rehearsal'])
      .where('employeeId', '=', employeeId)
      .execute()
  ).filter(
    (s) =>
      str(s.status) === 'completed' &&
      !(s.rehearsal === true || s.rehearsal === 1) &&
      inPeriod(s.completedAt),
  );
  const recommendations = (
    await query
      .selectFrom('trainingRecommendations')
      .select(['id', 'audience', 'status', 'completedAt'])
      .where('status', '=', 'completed')
      .execute()
  ).filter(
    (r) =>
      json<{ employeeId?: string }[]>(r.audience, []).some(
        (a) => a.employeeId === employeeId,
      ) && inPeriod(r.completedAt),
  );

  // ---- Job changes ----
  const events = (
    await query
      .selectFrom('jobEvents')
      .select(['id', 'eventType', 'effectiveDate'])
      .where('employeeId', '=', employeeId)
      .execute()
  ).filter(
    (e) =>
      ['transfer', 'promote'].includes(str(e.eventType)) &&
      inPeriod(e.effectiveDate),
  );

  const base = {
    generatedAt: new Date().toISOString(),
    period: { start, end, through },
    attendance,
    learning,
    exams,
    certificates,
    quality,
    competencies,
    practice: {
      completed: sessions.length,
      sessionIds: sessions.map((s) => str(s.id)),
    },
    training: {
      completedRecommendations: recommendations.map((r) => str(r.id)),
    },
    jobEvents: events.map((e) => ({
      id: str(e.id),
      type: str(e.eventType),
      date: day(e.effectiveDate),
    })),
  };
  return { ...base, qualitySafety: qualitySafetyScore(base, input.rules) };
}

/** 过程数据摘要 by rule (no more than 150 characters; numbers and record numbers only). */
export function templateSummary(snapshot: EvidenceSnapshot): string {
  const a = snapshot.attendance;
  const parts = [
    a.months.length
      ? `考勤：迟到${a.lateCount}次、早退${a.earlyCount}次、缺卡${a.missingCount}次${a.absentDays ? `、旷工${a.absentDays}天` : ''}`
      : '考勤：暂无已锁定汇总',
  ];
  const l = snapshot.learning;
  const certs = snapshot.certificates;
  parts.push(
    `必修学习${l.completedOnTime}/${l.dueSoFar}按期完成${
      certs.length
        ? `，${certs.map((c) => `${c.title}${c.expiredDays ? `过期${c.expiredDays}天` : '有效'}`).join('、')}`
        : ''
    }`,
  );
  const q = snapshot.quality;
  const counted = q.issues.filter((i) => i.counted);
  parts.push(
    counted.length
      ? `质量问题${counted.length}起（${counted
          .map((i) => `${i.externalId}${i.severity ? ` ${i.severity}` : ''}`)
          .join('、')}）`
      : '考核期内无质量问题',
  );
  const c = snapshot.competencies;
  parts.push(
    c.length
      ? `能力：${c.map((x) => `${x.title}${x.from ?? '-'}→${x.to}`).join('、')}`
      : '能力评定无变化',
  );
  const text = `${parts.join('；')}。`;
  return text.length <= 150 ? text : `${text.slice(0, 149)}…`;
}

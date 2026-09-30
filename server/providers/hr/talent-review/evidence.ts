/**
 * V4-13 盘点证据 (`getPlacementEvidence`): the facts the talent analyst may use
 * for one placement — the final rating (never the review comments), the
 * manager's potential answers, the learning speed (the onboarding path's
 * duration against the median of the same position), competency growth, the
 * exams' first-attempt pass rate and practice scores. Facts only: nothing
 * here describes a personality, and no text of a performance review is read.
 */
import { str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { day, json } from './context.js';

export interface PlacementEvidence {
  placementId: string;
  employeeId: string;
  name: string;
  finalRating: string | null;
  cycleTitle: string | null;
  performanceBand: number | null;
  potential: {
    band: number | null;
    items: { key: string; score: number | null; example: string | null }[];
  };
  learningSpeed: {
    pathDays: number | null;
    positionMedianDays: number | null;
  };
  competencyGrowth: { competency: string; from: number; to: number }[];
  exams: { attempted: number; firstPassed: number; firstPassRate: number | null };
  practice: { sessions: number; averageScore: number | null };
}

const DAY_MS = 86_400_000;

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

async function pathDays(
  ctx: TalentReviewContext,
  employeeIds: readonly string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!employeeIds.length) return map;
  const rows = await ctx.database
    .query()
    .selectFrom('assignments')
    .select(['employeeId', 'createdAt', 'completedAt'])
    .where('employeeId', 'in', [...employeeIds])
    .where('learningPathId', 'is not', null)
    .where('parentAssignmentId', 'is', null)
    .where('status', '=', 'completed')
    .execute();
  for (const row of rows) {
    if (!row.completedAt) continue;
    const days = Math.max(
      0,
      Math.round(
        (new Date(str(row.completedAt)).getTime() -
          new Date(str(row.createdAt)).getTime()) /
          DAY_MS,
      ),
    );
    const previous = map.get(str(row.employeeId));
    map.set(str(row.employeeId), previous === undefined ? days : Math.min(previous, days));
  }
  return map;
}

export async function placementEvidence(
  ctx: TalentReviewContext,
  placementId: string,
): Promise<PlacementEvidence | null> {
  const row = await ctx.database
    .query()
    .selectFrom('talentPlacements')
    .selectAll()
    .where('id', '=', placementId)
    .executeTakeFirst();
  if (!row) return null;
  const employee = await ctx.employee(str(row.employeeId));
  const review = await ctx.database
    .query()
    .selectFrom('talentReviews')
    .select(['reviewCycleId'])
    .where('id', '=', str(row.talentReviewId))
    .executeTakeFirst();
  const rating = (
    await ctx.latestRatings(
      [employee.id],
      review?.reviewCycleId ? str(review.reviewCycleId) : null,
    )
  ).get(employee.id);
  const answers = json<Record<string, { score?: number; example?: string }>>(
    row.potentialAnswers,
    {},
  );
  const settings = await ctx.settings();

  // 学习速度: the employee's onboarding path against the others on the same position.
  const peers = employee.positionId
    ? (
        await ctx.database
          .query()
          .selectFrom('employees')
          .select(['id'])
          .where('positionId', '=', employee.positionId)
          .execute()
      ).map((r) => str(r.id))
    : [employee.id];
  const days = await pathDays(ctx, peers);
  const own = days.get(employee.id) ?? null;
  const others = peers
    .filter((id) => id !== employee.id && days.has(id))
    .map((id) => days.get(id)!);

  // 能力增长: level changes in the last twelve months, per competency.
  const since = new Date(Date.now() - 365 * DAY_MS);
  const assessments = await ctx.database
    .query()
    .selectFrom('employeeCompetencies')
    .select(['competencyId', 'level', 'assessedAt', 'createdAt'])
    .where('employeeId', '=', employee.id)
    .execute();
  const byCompetency = new Map<string, { at: number; level: number }[]>();
  for (const a of assessments) {
    const list = byCompetency.get(str(a.competencyId)) ?? [];
    list.push({
      at: new Date(str(a.assessedAt ?? a.createdAt)).getTime(),
      level: Number(a.level),
    });
    byCompetency.set(str(a.competencyId), list);
  }
  const titles = await ctx.competencyTitles();
  const growth: PlacementEvidence['competencyGrowth'] = [];
  for (const [competencyId, list] of byCompetency) {
    const sorted = list.sort((a, b) => a.at - b.at);
    const before = [...sorted].reverse().find((x) => x.at < since.getTime());
    const latest = sorted.at(-1)!;
    const first = before ?? sorted[0];
    if (latest.level > first.level && latest.at >= since.getTime())
      growth.push({
        competency: titles.get(competencyId) ?? competencyId,
        from: first.level,
        to: latest.level,
      });
  }

  // 考试首次通过率: the first counted attempt of each exam.
  const attempts = await ctx.database
    .query()
    .selectFrom('examAttempts')
    .select(['examId', 'attemptNo', 'status'])
    .where('employeeId', '=', employee.id)
    .where('status', 'in', ['passed', 'failed'])
    .execute();
  const firstOf = new Map<string, { no: number; passed: boolean }>();
  for (const a of attempts) {
    const current = firstOf.get(str(a.examId));
    const no = Number(a.attemptNo);
    if (!current || no < current.no)
      firstOf.set(str(a.examId), { no, passed: a.status === 'passed' });
  }
  const firstPassed = [...firstOf.values()].filter((f) => f.passed).length;

  // 陪练表现: completed practice sessions (rehearsals excluded).
  const practice = await ctx.database
    .query()
    .selectFrom('practiceSessions')
    .select(['score', 'rehearsal'])
    .where('employeeId', '=', employee.id)
    .where('status', '=', 'completed')
    .execute();
  const scored = practice
    .filter((p) => !p.rehearsal && p.score !== null && p.score !== undefined)
    .map((p) => Number(p.score));

  return {
    placementId,
    employeeId: employee.id,
    name: employee.name,
    finalRating: rating?.rating ?? null,
    cycleTitle: rating?.cycleTitle ?? null,
    performanceBand:
      row.performanceBand === null || row.performanceBand === undefined
        ? null
        : Number(row.performanceBand),
    potential: {
      band:
        row.potentialBand === null || row.potentialBand === undefined
          ? null
          : Number(row.potentialBand),
      items: settings.potentialQuestions.map((q) => ({
        key: q.key,
        score:
          typeof answers[q.key]?.score === 'number'
            ? answers[q.key].score!
            : null,
        example: answers[q.key]?.example ?? null,
      })),
    },
    learningSpeed: { pathDays: own, positionMedianDays: median(others) },
    competencyGrowth: growth,
    exams: {
      attempted: firstOf.size,
      firstPassed,
      firstPassRate: firstOf.size
        ? Math.round((firstPassed / firstOf.size) * 100)
        : null,
    },
    practice: {
      sessions: scored.length,
      averageScore: scored.length
        ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
        : null,
    },
  };
}

/** The factual lines a rule-based pre-placement writes (no judgement of character). */
export function evidenceLines(evidence: PlacementEvidence): string[] {
  const lines: string[] = [];
  if (evidence.finalRating)
    lines.push(
      `${evidence.cycleTitle ?? '考核'}最终等级 ${evidence.finalRating}`,
    );
  else lines.push('没有已发布的考核结果，绩效维度须人工填写');
  const { pathDays: own, positionMedianDays } = evidence.learningSpeed;
  if (own !== null)
    lines.push(
      positionMedianDays !== null
        ? `上岗路径用时 ${own} 天，同岗位中位数 ${positionMedianDays} 天`
        : `上岗路径用时 ${own} 天`,
    );
  for (const g of evidence.competencyGrowth.slice(0, 3))
    lines.push(`近 12 个月${g.competency}从 ${g.from} 级升至 ${g.to} 级`);
  if (evidence.exams.firstPassRate !== null)
    lines.push(
      `考试首次通过 ${evidence.exams.firstPassed}/${evidence.exams.attempted}（${evidence.exams.firstPassRate}%）`,
    );
  if (evidence.practice.averageScore !== null)
    lines.push(
      `陪练 ${evidence.practice.sessions} 次，平均 ${evidence.practice.averageScore} 分`,
    );
  for (const item of evidence.potential.items)
    if (item.example) lines.push(`主管记录的事例：${item.example.slice(0, 120)}`);
  return lines;
}

export { day };

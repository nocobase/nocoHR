/**
 * V4-12 listRatingAnomalies: computed on the server, never by the model.
 *
 * | Type | Rule |
 * |---|---|
 * | ratingVsScore | the rating is `ratingReasonGap` (2) or more grades from the reference score's band |
 * | highRatingLowQuality | a rating scored 4 or more with a quality-and-safety reference of 2 or less |
 * | uniformRatings | every manager review of one reviewer (at least `uniformMinCount`) has the same rating |
 * | noFacts | the manager's comment cites no concrete fact (no number, record number or goal) |
 * | peerGap | the peers' average differs from the rating by 2 points or more |
 *
 * The rating checked is the current one (calibrated, else the manager's).
 * Details carry numbers and record numbers, never comments.
 */
import { bandOf, gradeGap, scoreOf, type SchemeView } from './common.js';
import type { PerformanceContext, ResultRow, ReviewRow } from './context.js';

export interface RatingAnomaly {
  type:
    | 'ratingVsScore'
    | 'highRatingLowQuality'
    | 'uniformRatings'
    | 'noFacts'
    | 'peerGap';
  detail: Record<string, string | number | null>;
}

export interface AnomalyEntry {
  resultId: string;
  employeeId: string;
  name: string;
  departmentId: string | null;
  reviewId: string | null;
  reviewerUserId: string;
  rating: string | null;
  computedScore: number | null;
  anomalies: RatingAnomaly[];
}

/** A concrete fact: a number, a record number such as QI-2026-0301, or a goal's title. */
export function citesFacts(
  comment: string | null,
  goalTitles: readonly string[],
): boolean {
  if (!comment?.trim()) return false;
  if (/\d/u.test(comment)) return true;
  return goalTitles.some(
    (title) => title.length >= 4 && comment.includes(title.slice(0, 6)),
  );
}

export function createAnomalyService(ctx: PerformanceContext) {
  return async function listAnomalies(
    cycleId: string,
    filter: {
      resultIds?: ReadonlySet<string>;
      departmentIds?: ReadonlySet<string>;
    } = {},
  ): Promise<AnomalyEntry[]> {
    const results = (await ctx.resultsOf(cycleId)).filter(
      (r) => r.status !== 'closed',
    );
    const reviews = await ctx.reviewsOf(cycleId);
    const goals = await ctx.goalsOf(cycleId);
    const schemes = new Map((await ctx.schemes()).map((s) => [s.id, s]));
    const employees = await ctx.employees();
    const settings = await ctx.settings();
    const managerReviews = reviews.filter(
      (r) => r.role === 'manager' && r.status === 'submitted',
    );
    const current = (r: ResultRow) => r.calibratedRating ?? r.managerRating;

    // Per reviewer: the ratings they gave.
    const byReviewer = new Map<string, ResultRow[]>();
    for (const r of results)
      if (r.managerRating)
        byReviewer.set(r.managerUserId, [
          ...(byReviewer.get(r.managerUserId) ?? []),
          r,
        ]);

    const out: AnomalyEntry[] = [];
    for (const result of results) {
      if (filter.resultIds && !filter.resultIds.has(result.id)) continue;
      if (
        filter.departmentIds &&
        !filter.departmentIds.has(result.departmentId ?? '')
      )
        continue;
      const scheme: SchemeView | undefined = schemes.get(result.schemeId);
      const rating = current(result);
      if (!scheme || !rating) continue;
      const review: ReviewRow | undefined = managerReviews.find(
        (r) => r.resultId === result.id,
      );
      const anomalies: RatingAnomaly[] = [];
      const band = bandOf(result.computedScore, scheme.ratingScale);
      const gap = gradeGap(rating, band, scheme.ratingScale);
      if (band && gap >= scheme.scoring.ratingReasonGap)
        anomalies.push({
          type: 'ratingVsScore',
          detail: { rating, band, gap, score: result.computedScore },
        });
      const quality = result.evidenceSnapshot?.qualitySafety.score ?? null;
      const ratingScore = scoreOf(rating, scheme.ratingScale);
      if (
        ratingScore !== null &&
        ratingScore >= 4 &&
        quality !== null &&
        quality <= 2
      ) {
        const issues = (result.evidenceSnapshot?.quality.issues ?? []).filter(
          (i) => i.counted,
        );
        anomalies.push({
          type: 'highRatingLowQuality',
          detail: {
            rating,
            quality,
            issues: issues.length,
            numbers: issues.map((i) => i.externalId).join('、'),
          },
        });
      }
      const peers = byReviewer.get(result.managerUserId) ?? [];
      if (
        peers.length >= settings.uniformMinCount &&
        peers.every((p) => p.managerRating === result.managerRating)
      )
        anomalies.push({
          type: 'uniformRatings',
          detail: { rating: result.managerRating, count: peers.length },
        });
      if (review) {
        const titles = goals
          .filter((g) => g.employeeId === result.employeeId)
          .map((g) => g.title);
        if (!citesFacts(review.comment, titles))
          anomalies.push({ type: 'noFacts', detail: {} });
      }
      const peerScores = reviews
        .filter(
          (r) =>
            r.resultId === result.id &&
            r.role === 'peer' &&
            r.status === 'submitted',
        )
        .map((r) => scoreOf(r.overallRating, scheme.ratingScale))
        .filter((s): s is number => s !== null);
      if (peerScores.length && ratingScore !== null) {
        const average =
          peerScores.reduce((a, b) => a + b, 0) / peerScores.length;
        if (Math.abs(average - ratingScore) >= 2)
          anomalies.push({
            type: 'peerGap',
            detail: { rating, peerAverage: Math.round(average * 100) / 100 },
          });
      }
      if (anomalies.length)
        out.push({
          resultId: result.id,
          employeeId: result.employeeId,
          name: employees.get(result.employeeId)?.name ?? '',
          departmentId: result.departmentId,
          reviewId: review?.id ?? null,
          reviewerUserId: result.managerUserId,
          rating,
          computedScore: result.computedScore,
          anomalies,
        });
    }
    return out;
  };
}

export type AnomalyService = ReturnType<typeof createAnomalyService>;

/** 偏差提示 by rule: points out the inconsistency, never a grade to give. */
export function hintText(anomaly: RatingAnomaly): string {
  const d = anomaly.detail;
  switch (anomaly.type) {
    case 'ratingVsScore':
      return `总评 ${String(d.rating)} 与参考分 ${String(d.score ?? '—')}（对应 ${String(d.band)} 档）相差 ${String(d.gap)} 档，请核对评分依据。`;
    case 'highRatingLowQuality':
      return `总评等级较高，但质量与安全参考分为 ${String(d.quality)}（考核期内 ${String(d.issues)} 起质量问题${d.numbers ? `：${String(d.numbers)}` : ''}），请确认评价与记录一致。`;
    case 'uniformRatings':
      return `你提交的 ${String(d.count)} 份上级评价等级全部为 ${String(d.rating)}，请确认是否反映了成员之间的差异。`;
    case 'noFacts':
      return '评语中没有引用具体事实（如目标完成情况、记录编号），建议补充依据。';
    case 'peerGap':
      return `互评平均分 ${String(d.peerAverage)} 与总评 ${String(d.rating)} 差异较大，请核对。`;
  }
}

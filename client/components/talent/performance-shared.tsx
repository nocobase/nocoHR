/**
 * V4-12 绩效: the shapes the performance endpoints answer with, and the small
 * pieces every performance page shares — stage, status and rating badges, the
 * evidence snapshot and the peer summary (hooks: performance-hooks.ts).
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

export type ReviewRole = 'self' | 'peer' | 'manager' | 'skipLevel';

export interface RatingOption {
  code: string;
  score: number;
  description: string;
}

export interface SchemeSummary {
  id: string;
  title: string;
  sections: { key: string; weight: number }[];
  ratingScale: RatingOption[];
  scoring?: { overrideReasonDelta: number; ratingReasonGap: number };
}

export interface EvidenceSnapshot {
  generatedAt: string;
  period: { start: string; end: string; through: string };
  attendance: {
    months: string[];
    lateCount: number;
    earlyCount: number;
    missingCount: number;
    absentDays: number;
  };
  learning: {
    required: number;
    dueSoFar: number;
    completedOnTime: number;
    overdue: number;
    onTimeRate: number | null;
    remedialCompleted: number;
  };
  exams: {
    attempts: number;
    firstPassRate: number | null;
    certificationExams: {
      attemptId: string;
      title: string;
      score: number | null;
      passed: boolean;
    }[];
  };
  certificates: {
    certificationId: string;
    title: string;
    validRatio: number | null;
    expiredDays: number;
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
    title: string;
    from: number | null;
    to: number;
  }[];
  practice: { completed: number };
  training: { completedRecommendations: string[] };
  jobEvents: { id: string; type: string; date: string | null }[];
  qualitySafety: {
    score: number;
    base: number;
    deductions: { rule: string; count: number; points: number }[];
  };
}

export interface GoalView {
  id: string;
  cycleId: string;
  employeeId: string | null;
  departmentId: string | null;
  title: string;
  measure: string;
  weight: number | null;
  alignedGoalId: string | null;
  alignedTitle?: string | null;
  progress: number;
  progressNotes: { at: string; progress: number; note: string }[];
  status: 'draft' | 'submitted' | 'approved' | 'cancelled';
  source: 'manual' | 'ai';
  returnNote: string | null;
}

export interface ReviewItems {
  goals?: { goalId: string; score: number | null; comment?: string | null }[];
  competencies?: {
    competencyId: string;
    level: number | null;
    comment?: string | null;
  }[];
  qualitySafety?: {
    score: number | null;
    comment?: string | null;
    reason?: string | null;
  } | null;
}

export interface AiDraft {
  comment: string;
  itemSuggestions: {
    goals: { goalId: string; comment: string }[];
    competencies: { competencyId: string; comment: string }[];
    qualitySafety: { score: number | null; comment: string } | null;
  };
  evidenceRefs: { type: string; id: string; label: string }[];
  generatedAt: string;
  source: 'ai' | 'rule';
}

export interface ReferenceScore {
  computedScore: number | null;
  band: string | null;
  bandRange: { from: number; to: number } | null;
  qualityReference: number | null;
  dimensions: Record<string, number | null>;
}

export interface ReviewContext {
  review: {
    id: string;
    role: ReviewRole;
    status: 'notStarted' | 'draft' | 'submitted' | 'cancelled';
    items: ReviewItems;
    overallRating: string | null;
    overallReason: string | null;
    comment: string | null;
    aiDraft: AiDraft | null;
    hints: {
      submission: number;
      items: { type: string; text: string }[];
      at: string;
    } | null;
    submissionCount: number;
    submittedAt: string | null;
    activeSeconds: number;
    editable: boolean;
  };
  cycle: {
    id: string;
    title: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    deadline: string | null;
  };
  employee: { id: string; name: string; departmentTitle: string };
  scheme: SchemeSummary;
  goals: GoalView[];
  evidence: {
    snapshot: EvidenceSnapshot | null;
    summary: string | null;
  } | null;
  requirements: {
    competencyId: string;
    title: string;
    requiredLevel: number;
    maxLevel: number;
    currentLevel: number | null;
  }[];
  selfReview: {
    items: ReviewItems;
    comment: string | null;
    submittedAt: string | null;
  } | null;
  peers: PeerSummary | null;
  reference: ReferenceScore | null;
}

export interface PeerSummary {
  count: number;
  averageScore: number | null;
  entries: {
    rating: string | null;
    comment: string;
    reviewerName?: string;
  }[];
}

export function CycleStatusBadge({ status }: { status: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge
      variant={
        status === 'published' || status === 'closed' ? 'secondary' : 'default'
      }
    >
      {t(`performance.cycleStatus.${status}`, { defaultValue: status })}
    </Badge>
  );
}

export function TaskStatusBadge({ status }: { status: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge
      variant={
        status === 'submitted' || status === 'approved'
          ? 'secondary'
          : 'outline'
      }
    >
      {t(`performance.taskStatus.${status}`, { defaultValue: status })}
    </Badge>
  );
}

export function RatingBadge({
  rating,
}: {
  rating: string | null | undefined;
}): ReactElement {
  return rating ? (
    <Badge variant='outline' className='font-semibold tabular-nums'>
      {rating}
    </Badge>
  ) : (
    <span className='text-muted-foreground'>—</span>
  );
}

/** 过程数据快照: counts and record numbers only; a quality issue's number opens nothing but its number. */
export function EvidenceView({
  snapshot,
  summary,
}: {
  snapshot: EvidenceSnapshot | null;
  summary: string | null;
}): ReactElement {
  const { t } = useTranslation();
  if (!snapshot)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('performance.evidence.notYet')}
      </p>
    );
  const rows: { label: string; value: string }[] = [
    {
      label: t('performance.evidence.attendance'),
      value: snapshot.attendance.months.length
        ? t('performance.evidence.attendanceValue', snapshot.attendance)
        : t('performance.evidence.attendanceNone'),
    },
    {
      label: t('performance.evidence.learning'),
      value: t('performance.evidence.learningValue', {
        done: snapshot.learning.completedOnTime,
        due: snapshot.learning.dueSoFar,
        overdue: snapshot.learning.overdue,
      }),
    },
    {
      label: t('performance.evidence.exams'),
      value: t('performance.evidence.examsValue', {
        attempts: snapshot.exams.attempts,
        rate: snapshot.exams.firstPassRate ?? '—',
      }),
    },
    {
      label: t('performance.evidence.certificates'),
      value: snapshot.certificates.length
        ? snapshot.certificates
            .map((c) =>
              c.expiredDays
                ? t('performance.evidence.certificateExpired', {
                    title: c.title,
                    days: c.expiredDays,
                  })
                : t('performance.evidence.certificateValid', {
                    title: c.title,
                  }),
            )
            .join('；')
        : '—',
    },
    {
      label: t('performance.evidence.competencies'),
      value: snapshot.competencies.length
        ? snapshot.competencies
            .map((c) => `${c.title} L${c.from ?? '-'}→L${c.to}`)
            .join('；')
        : t('performance.evidence.noChange'),
    },
  ];
  return (
    <div className='space-y-3 text-sm'>
      {summary ? (
        <p className='rounded-md bg-muted/60 p-3 leading-6'>
          <span className='me-2 font-medium'>
            {t('performance.evidence.summary')}
          </span>
          {summary}
        </p>
      ) : null}
      <dl className='grid gap-2 sm:grid-cols-[8rem_1fr]'>
        {rows.map((row) => (
          <div key={row.label} className='contents'>
            <dt className='text-muted-foreground'>{row.label}</dt>
            <dd className='min-w-0 break-words'>{row.value}</dd>
          </div>
        ))}
        <dt className='text-muted-foreground'>
          {t('performance.evidence.quality')}
        </dt>
        <dd className='flex flex-wrap gap-1.5'>
          {snapshot.quality.issues.length ? (
            snapshot.quality.issues.map((issue) => (
              <Badge
                key={issue.id}
                variant={issue.counted ? 'destructive' : 'outline'}
                title={
                  issue.counted
                    ? undefined
                    : t('performance.evidence.notCounted')
                }
              >
                {issue.externalId}
                {issue.severity ? ` · ${issue.severity}` : ''}
              </Badge>
            ))
          ) : (
            <span>{t('performance.evidence.noIssues')}</span>
          )}
        </dd>
        <dt className='text-muted-foreground'>
          {t('performance.evidence.qualitySafety')}
        </dt>
        <dd>
          <span className='font-semibold tabular-nums'>
            {snapshot.qualitySafety.score}
          </span>
          {snapshot.qualitySafety.deductions.length ? (
            <span className='ms-2 text-muted-foreground'>
              {snapshot.qualitySafety.deductions
                .map(
                  (d) =>
                    `${t(`performance.evidence.rules.${d.rule.replace('.', '_')}`, { defaultValue: d.rule })} ×${d.count} (${d.points})`,
                )
                .join('，')}
            </span>
          ) : null}
        </dd>
      </dl>
    </div>
  );
}

/** Anonymous entries have no id; their position in the (content-sorted) list names them. */
function keyed<T>(list: readonly T[]): (T & { key: string })[] {
  return list.map((item, position) => ({ ...item, key: `entry-${position}` }));
}

export function PeerSummaryView({
  peers,
}: {
  peers: PeerSummary;
}): ReactElement {
  const { t } = useTranslation();
  if (!peers.count)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('performance.peers.none')}
      </p>
    );
  return (
    <div className='space-y-2 text-sm'>
      <p className='text-muted-foreground'>
        {t('performance.peers.summary', {
          count: peers.count,
          average: peers.averageScore ?? '—',
        })}
      </p>
      <ul className='space-y-2'>
        {keyed(peers.entries).map((entry) => (
          <li key={entry.key} className='rounded-md border p-2'>
            <div className='flex items-center gap-2'>
              <RatingBadge rating={entry.rating} />
              {entry.reviewerName ? (
                <span className='text-xs text-muted-foreground'>
                  {entry.reviewerName}
                </span>
              ) : null}
            </div>
            <p className='mt-1 break-words'>{entry.comment || '—'}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

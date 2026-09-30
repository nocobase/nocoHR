/**
 * V4-12 团队考核 (`/talent/team-reviews`, heads): the people one reviews as
 * manager or skip-level reviewer in a cycle — goal status (with 确认 for
 * submitted goals), self review status, one's own review status, the
 * reference score and the rating one gave — and the peers to confirm. The
 * review itself opens as the child page `:reviewId` (review.tsx).
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAction } from '@/components/talent/performance-hooks';
import {
  CycleStatusBadge,
  RatingBadge,
  TaskStatusBadge,
  type GoalView,
} from '@/components/talent/performance-shared';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Member {
  resultId: string;
  employeeId: string;
  name: string;
  departmentTitle: string;
  role: 'manager' | 'skipLevel';
  goalStatus: string;
  submittedGoals: string[];
  selfStatus: string;
  myReviewId: string | null;
  myReviewStatus: string;
  computedScore: number | null;
  myRating: string | null;
  peerStatus: string;
  peerUserIds: string[];
}

export default function TeamReviewsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const cycles = useRemote<{ id: string; title: string; status: string }[]>(
    'talent/performance/team/cycles',
  );
  const cycleId = params.get('cycle') ?? cycles.data?.[0]?.id ?? null;
  const team = useRemote<{
    cycle: { id: string; title: string; status: string };
    members: Member[];
  }>(
    cycleId ? 'talent/performance/team' : null,
    cycleId ? { cycleId } : undefined,
  );
  const goals = useRemote<GoalView[]>(
    cycleId ? 'talent/performance/goals/team' : null,
    cycleId ? { cycleId } : undefined,
  );
  const action = useAction();
  const [reviewing, setReviewing] = useState<Member | null>(null);
  const reload = () => {
    team.reload();
    goals.reload();
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('performance.team.title')}
        description={t('performance.team.description')}
        actions={
          (cycles.data?.length ?? 0) > 1 ? (
            <NativeSelect
              aria-label={t('performance.common.cycle')}
              value={cycleId ?? ''}
              onChange={(event) => {
                const next = new URLSearchParams(params);
                next.set('cycle', event.target.value);
                setParams(next, { replace: true });
              }}
            >
              {cycles.data!.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null
        }
      />
      {cycles.error ? (
        <LoadError error={cycles.error} onRetry={cycles.reload} />
      ) : !cycles.data ? (
        <BlockSkeleton rows={4} />
      ) : !cycles.data.length ? (
        <EmptyState title={t('performance.team.empty')} />
      ) : team.error ? (
        <LoadError error={team.error} onRetry={team.reload} />
      ) : !team.data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-medium'>{team.data.cycle.title}</span>
            <CycleStatusBadge status={team.data.cycle.status} />
          </div>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('performance.team.member')}</TableHead>
                  <TableHead>{t('performance.team.goals')}</TableHead>
                  <TableHead>{t('performance.team.self')}</TableHead>
                  <TableHead>{t('performance.team.myReview')}</TableHead>
                  <TableHead className='text-end'>
                    {t('performance.team.score')}
                  </TableHead>
                  <TableHead>{t('performance.team.myRating')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {team.data.members.map((member) => (
                  <TableRow key={member.resultId}>
                    <TableCell>
                      <div className='font-medium'>{member.name}</div>
                      <div className='text-xs text-muted-foreground'>
                        {member.departmentTitle}
                        {member.role === 'skipLevel'
                          ? ` · ${t('performance.team.skipLevel')}`
                          : ''}
                      </div>
                    </TableCell>
                    <TableCell>
                      <TaskStatusBadge status={member.goalStatus} />
                    </TableCell>
                    <TableCell>
                      <TaskStatusBadge status={member.selfStatus} />
                    </TableCell>
                    <TableCell>
                      <TaskStatusBadge status={member.myReviewStatus} />
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {member.computedScore ?? '—'}
                    </TableCell>
                    <TableCell>
                      <RatingBadge rating={member.myRating} />
                    </TableCell>
                    <TableCell className='space-x-2 text-end whitespace-nowrap'>
                      {member.submittedGoals.length ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setReviewing(member)}
                        >
                          {t('performance.team.confirmGoals', {
                            count: member.submittedGoals.length,
                          })}
                        </Button>
                      ) : null}
                      {member.role === 'manager' &&
                      member.peerStatus === 'nominated' ? (
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={action.busy}
                          onClick={() => {
                            void (async () => {
                              if (
                                await action.run(
                                  {
                                    method: 'POST',
                                    path: `talent/performance/results/${encodeURIComponent(member.resultId)}/peers`,
                                  },
                                  t('performance.team.peersConfirmed'),
                                )
                              )
                                reload();
                            })();
                          }}
                        >
                          {t('performance.team.confirmPeers')}
                        </Button>
                      ) : null}
                      {member.myReviewId ? (
                        <Button
                          size='sm'
                          nativeButton={false}
                          render={
                            <Link to={encodeURIComponent(member.myReviewId)} />
                          }
                        >
                          {t(
                            member.myReviewStatus === 'submitted'
                              ? 'performance.team.openReview'
                              : 'performance.team.review',
                          )}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      <GoalsDialog
        member={reviewing}
        goals={(goals.data ?? []).filter(
          (g) =>
            g.employeeId === reviewing?.employeeId && g.status === 'submitted',
        )}
        onClose={() => setReviewing(null)}
        onDone={reload}
      />
      <Outlet context={{ reload }} />
    </PageContainer>
  );
}

function GoalsDialog({
  member,
  goals,
  onClose,
  onDone,
}: {
  member: Member | null;
  goals: GoalView[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useAction();
  const decide = async (goal: GoalView, decision: 'approve' | 'return') => {
    if (
      await action.run(
        {
          method: 'POST',
          path: `talent/performance/goals/${encodeURIComponent(goal.id)}/decide`,
          json: { decision },
        },
        t(
          decision === 'approve'
            ? 'performance.team.goalApproved'
            : 'performance.team.goalReturned',
        ),
      )
    )
      onDone();
  };
  return (
    <Dialog
      open={Boolean(member)}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('performance.team.goalsTitle', { name: member?.name ?? '' })}
          </DialogTitle>
          <DialogDescription>
            {t('performance.team.goalsHint')}
          </DialogDescription>
        </DialogHeader>
        <ul className='space-y-2 text-sm'>
          {goals.map((goal) => (
            <li key={goal.id} className='space-y-1 rounded-md border p-2'>
              <p className='font-medium break-words'>{goal.title}</p>
              <p className='text-muted-foreground break-words'>
                {goal.measure}
              </p>
              <p className='text-xs text-muted-foreground'>
                {t('performance.goals.weightProgress', {
                  weight: goal.weight ?? '—',
                  progress: goal.progress,
                })}
              </p>
              <div className='flex gap-2'>
                <Button
                  size='sm'
                  disabled={action.busy}
                  onClick={() => void decide(goal, 'approve')}
                >
                  {t('performance.team.approve')}
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={action.busy}
                  onClick={() => void decide(goal, 'return')}
                >
                  {t('performance.team.return')}
                </Button>
              </div>
            </li>
          ))}
          {!goals.length ? (
            <li className='text-muted-foreground'>
              {t('performance.team.noGoalsToConfirm')}
            </li>
          ) : null}
        </ul>
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('performance.common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

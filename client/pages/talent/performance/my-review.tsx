/**
 * V4-12 我的考核 (`/talent/my-review`, every employee): goals — draft,
 * submit (weights summing to 100), see the manager's decision and the
 * department goals they align to, update progress; the self review with one's
 * own evidence snapshot; peer tasks; and published results — the final
 * rating, the manager's comment and the anonymous peer summary, acknowledged
 * or appealed within the appeal window. Works at phone width.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAction, useDateText } from '@/components/talent/performance-hooks';
import {
  CycleStatusBadge,
  EvidenceView,
  PeerSummaryView,
  RatingBadge,
  TaskStatusBadge,
  type EvidenceSnapshot,
  type GoalView,
  type PeerSummary,
} from '@/components/talent/performance-shared';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const TABS = ['goals', 'self', 'peer', 'result'] as const;
type Tab = (typeof TABS)[number];

interface MyCycle {
  cycleId: string;
  cycleTitle: string;
  cycleStatus: string;
  periodStart: string;
  periodEnd: string;
  deadline: string | null;
  resultId: string;
  resultStatus: string;
  closedReason: string | null;
  published: boolean;
  schemeTitle: string;
  noAccount: boolean;
  goals: {
    draft: number;
    submitted: number;
    approved: number;
    aiDrafts: number;
  };
  selfReview: { reviewId: string; status: string } | null;
  peerTasks: number;
  peers: { status: string; userIds: string[]; count: number } | null;
  evidence: {
    snapshot: EvidenceSnapshot | null;
    summary: string | null;
  } | null;
}

interface MyResult {
  resultId: string;
  cycleId: string;
  cycleTitle: string;
  finalRating: string | null;
  ratingDescription: string;
  managerComment: string | null;
  peers: PeerSummary;
  status: string;
  publishedAt: string | null;
  appeal: {
    reason: string;
    result?: string | null;
    note?: string | null;
  } | null;
  appealDeadline: string;
  can: { acknowledge: boolean; appeal: boolean };
}

interface MyTask {
  reviewId: string;
  cycleId: string;
  cycleTitle: string;
  role: 'self' | 'peer';
  employeeName: string;
  status: string;
  deadline: string | null;
  editable: boolean;
}

export default function MyReviewPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const me = useRemote<{ employeeId: string | null; cycles: MyCycle[] }>(
    'talent/performance/me',
  );
  const tasks = useRemote<MyTask[]>('talent/performance/me/tasks');
  const results = useRemote<MyResult[]>('talent/performance/me/results');
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : 'goals';
  const cycles = me.data?.cycles ?? [];
  const cycleId =
    params.get('cycle') ??
    cycles.find((c) => !['published', 'closed'].includes(c.cycleStatus))
      ?.cycleId ??
    cycles[0]?.cycleId;
  const cycle = cycles.find((c) => c.cycleId === cycleId);
  const reload = useMemo(
    () => () => {
      me.reload();
      tasks.reload();
      results.reload();
    },
    [me, tasks, results],
  );
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { replace: true });
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('performance.my.title')}
        description={t('performance.my.description')}
        actions={
          cycles.length > 1 ? (
            <NativeSelect
              aria-label={t('performance.common.cycle')}
              value={cycleId ?? ''}
              onChange={(event) => set('cycle', event.target.value)}
            >
              {cycles.map((c) => (
                <NativeSelectOption key={c.cycleId} value={c.cycleId}>
                  {c.cycleTitle}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          ) : null
        }
      />
      {me.error ? (
        <LoadError error={me.error} onRetry={me.reload} />
      ) : !me.data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <>
          {cycle ? (
            <Card size='sm'>
              <CardContent className='flex flex-wrap items-center gap-x-4 gap-y-2 text-sm'>
                <span className='font-medium'>{cycle.cycleTitle}</span>
                <CycleStatusBadge status={cycle.cycleStatus} />
                <span className='text-muted-foreground'>
                  {cycle.schemeTitle}
                </span>
                {cycle.deadline ? (
                  <span className='text-muted-foreground'>
                    {t('performance.common.deadline', { date: cycle.deadline })}
                  </span>
                ) : null}
                {cycle.resultStatus === 'closed' ? (
                  <Badge variant='outline'>
                    {t(`performance.resultStatus.closed`)}
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
          <Tabs
            value={tab}
            onValueChange={(value) => set('tab', String(value))}
          >
            <TabsList className='w-full sm:w-auto'>
              {TABS.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {t(`performance.my.tabs.${name}`)}
                  {name === 'peer' &&
                  (tasks.data ?? []).filter(
                    (x) => x.role === 'peer' && x.status !== 'submitted',
                  ).length ? (
                    <Badge className='ms-1'>
                      {
                        (tasks.data ?? []).filter(
                          (x) => x.role === 'peer' && x.status !== 'submitted',
                        ).length
                      }
                    </Badge>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {tab === 'goals' ? (
            cycle ? (
              <GoalsTab key={cycle.cycleId} cycle={cycle} onChanged={reload} />
            ) : (
              <EmptyState title={t('performance.my.noCycle')} />
            )
          ) : tab === 'self' ? (
            <SelfTab cycle={cycle} />
          ) : tab === 'peer' ? (
            <TasksTab
              tasks={(tasks.data ?? []).filter((x) => x.role === 'peer')}
            />
          ) : (
            <ResultsTab
              results={results.data}
              error={results.error}
              onChanged={reload}
            />
          )}
        </>
      )}
      <Outlet context={{ reload }} />
    </PageContainer>
  );
}

function GoalsTab({
  cycle,
  onChanged,
}: {
  cycle: MyCycle;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const goals = useRemote<{
    goals: GoalView[];
    departmentGoals: GoalView[];
    totalWeight: number;
  }>('talent/performance/me/goals', { cycleId: cycle.cycleId });
  const action = useAction();
  const [editing, setEditing] = useState<GoalView | 'new' | null>(null);
  const [progress, setProgress] = useState<GoalView | null>(null);
  const reload = () => {
    goals.reload();
    onChanged();
  };
  const data = goals.data;
  const open = [
    'goalSetting',
    'selfReview',
    'peerReview',
    'managerReview',
  ].includes(cycle.cycleStatus);
  const drafts = data?.goals.filter((g) => g.status === 'draft') ?? [];
  const aligned = new Map(
    (data?.departmentGoals ?? []).map((g) => [g.id, g.title]),
  );
  return (
    <div className='space-y-4'>
      {goals.error ? (
        <LoadError error={goals.error} onRetry={goals.reload} />
      ) : !data ? (
        <BlockSkeleton rows={3} />
      ) : (
        <>
          {cycle.goals.aiDrafts ? (
            <Alert>
              <AlertDescription>
                {t('performance.goals.aiDraftsHint')}
              </AlertDescription>
            </Alert>
          ) : null}
          {data.departmentGoals.length ? (
            <Card size='sm'>
              <CardHeader>
                <CardTitle>{t('performance.goals.departmentGoals')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className='list-disc space-y-1 ps-4 text-sm'>
                  {data.departmentGoals.map((g) => (
                    <li key={g.id} className='break-words'>
                      {g.title}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {data.goals.length ? (
            <div className='grid gap-3 md:grid-cols-2'>
              {data.goals.map((goal) => (
                <Card key={goal.id}>
                  <CardHeader>
                    <CardTitle className='break-words'>{goal.title}</CardTitle>
                    <CardDescription className='break-words'>
                      {goal.measure}
                    </CardDescription>
                    <CardAction>
                      <TaskStatusBadge status={goal.status} />
                    </CardAction>
                  </CardHeader>
                  <CardContent className='space-y-1 text-sm'>
                    <p className='text-muted-foreground'>
                      {t('performance.goals.weightProgress', {
                        weight: goal.weight ?? '—',
                        progress: goal.progress,
                      })}
                    </p>
                    {goal.alignedGoalId ? (
                      <p className='text-muted-foreground break-words'>
                        {t('performance.goals.alignedTo', {
                          title: aligned.get(goal.alignedGoalId) ?? '—',
                        })}
                      </p>
                    ) : null}
                    {goal.source === 'ai' ? (
                      <Badge variant='outline'>
                        {t('performance.goals.aiSource')}
                      </Badge>
                    ) : null}
                    {goal.returnNote ? (
                      <p className='text-destructive break-words'>
                        {t('performance.goals.returned', {
                          note: goal.returnNote,
                        })}
                      </p>
                    ) : null}
                  </CardContent>
                  {open ? (
                    <CardFooter className='gap-2'>
                      {goal.status === 'draft' ? (
                        <>
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => setEditing(goal)}
                          >
                            {t('performance.common.edit')}
                          </Button>
                          <Button
                            size='sm'
                            variant='ghost'
                            disabled={action.busy}
                            onClick={() => {
                              void (async () => {
                                if (
                                  await action.run(
                                    {
                                      method: 'POST',
                                      path: `talent/performance/goals/${encodeURIComponent(goal.id)}/cancel`,
                                    },
                                    t('performance.goals.cancelled'),
                                  )
                                )
                                  reload();
                              })();
                            }}
                          >
                            {t('performance.goals.cancel')}
                          </Button>
                        </>
                      ) : goal.status === 'approved' ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setProgress(goal)}
                        >
                          {t('performance.goals.updateProgress')}
                        </Button>
                      ) : null}
                    </CardFooter>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t('performance.goals.none')}
              description={t('performance.goals.noneHint')}
            />
          )}
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
          {open ? (
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
              <p className='text-sm text-muted-foreground'>
                {t('performance.goals.total', { total: data.totalWeight })}
              </p>
              <div className='flex flex-col gap-2 sm:flex-row'>
                <Button variant='outline' onClick={() => setEditing('new')}>
                  <PlusIcon />
                  {t('performance.goals.add')}
                </Button>
                <Button
                  disabled={!drafts.length || action.busy}
                  onClick={() => {
                    void (async () => {
                      if (
                        await action.run(
                          {
                            method: 'POST',
                            path: 'talent/performance/goals/submit',
                            json: { cycleId: cycle.cycleId },
                          },
                          t('performance.goals.submitted'),
                        )
                      )
                        reload();
                    })();
                  }}
                >
                  {t('performance.goals.submit')}
                </Button>
              </div>
            </div>
          ) : null}
          {cycle.peers ? (
            <PeersCard cycle={cycle} onChanged={onChanged} />
          ) : null}
        </>
      )}
      <GoalDialog
        cycleId={cycle.cycleId}
        goal={editing}
        departmentGoals={data?.departmentGoals ?? []}
        onClose={() => setEditing(null)}
        onDone={reload}
      />
      <ProgressDialog
        goal={progress}
        onClose={() => setProgress(null)}
        onDone={reload}
      />
    </div>
  );
}

function GoalDialog({
  cycleId,
  goal,
  departmentGoals,
  onClose,
  onDone,
}: {
  cycleId: string;
  goal: GoalView | 'new' | null;
  departmentGoals: GoalView[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useAction();
  const current = goal && goal !== 'new' ? goal : null;
  const [title, setTitle] = useState('');
  const [measure, setMeasure] = useState('');
  const [weight, setWeight] = useState('');
  const [alignedGoalId, setAlignedGoalId] = useState('');
  const [seen, setSeen] = useState<GoalView | 'new' | null>(null);
  if (goal !== seen) {
    setSeen(goal);
    setTitle(current?.title ?? '');
    setMeasure(current?.measure ?? '');
    setWeight(
      current?.weight === null || current?.weight === undefined
        ? ''
        : String(current.weight),
    );
    setAlignedGoalId(current?.alignedGoalId ?? '');
  }
  async function submit(): Promise<void> {
    const json = {
      title,
      measure,
      weight: weight === '' ? null : Number(weight),
      alignedGoalId: alignedGoalId || null,
    };
    const done = current
      ? await action.run(
          {
            method: 'PATCH',
            path: `talent/performance/goals/${encodeURIComponent(current.id)}`,
            json,
          },
          t('performance.goals.saved'),
        )
      : await action.run(
          {
            method: 'POST',
            path: 'talent/performance/goals',
            json: { ...json, cycleId },
          },
          t('performance.goals.saved'),
        );
    if (done) {
      onDone();
      onClose();
    }
  }
  return (
    <Dialog
      open={Boolean(goal)}
      onOpenChange={(value) => (value ? undefined : onClose())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              current
                ? 'performance.goals.editTitle'
                : 'performance.goals.addTitle',
            )}
          </DialogTitle>
          <DialogDescription>
            {t('performance.goals.dialogHint')}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <Field>
            <FieldLabel htmlFor='goal-title'>
              {t('performance.goals.goalTitle')}
            </FieldLabel>
            <Input
              id='goal-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='goal-measure'>
              {t('performance.goals.measure')}
            </FieldLabel>
            <Textarea
              id='goal-measure'
              rows={3}
              value={measure}
              onChange={(e) => setMeasure(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='goal-weight'>
              {t('performance.goals.weight')}
            </FieldLabel>
            <Input
              id='goal-weight'
              type='number'
              min={0}
              max={100}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <FieldDescription>
              {t('performance.goals.weightHint')}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor='goal-aligned'>
              {t('performance.goals.aligned')}
            </FieldLabel>
            <NativeSelect
              id='goal-aligned'
              className='w-full'
              value={alignedGoalId}
              onChange={(e) => setAlignedGoalId(e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('performance.goals.notAligned')}
              </NativeSelectOption>
              {departmentGoals.map((g) => (
                <NativeSelectOption key={g.id} value={g.id}>
                  {g.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('performance.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !title.trim() || !measure.trim()}
            onClick={() => void submit()}
          >
            {t('performance.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProgressDialog({
  goal,
  onClose,
  onDone,
}: {
  goal: GoalView | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useAction();
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  return (
    <Dialog
      open={Boolean(goal)}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('performance.goals.updateProgress')}</DialogTitle>
          <DialogDescription className='break-words'>
            {goal?.title}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <Field>
            <FieldLabel htmlFor='goal-progress'>
              {t('performance.goals.progress')}
            </FieldLabel>
            <Input
              id='goal-progress'
              type='number'
              min={0}
              max={100}
              value={value}
              placeholder={String(goal?.progress ?? 0)}
              onChange={(e) => setValue(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='goal-note'>
              {t('performance.goals.progressNote')}
            </FieldLabel>
            <Textarea
              id='goal-note'
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('performance.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || value === ''}
            onClick={() => {
              void (async () => {
                if (!goal) return;
                if (
                  await action.run(
                    {
                      method: 'POST',
                      path: `talent/performance/goals/${encodeURIComponent(goal.id)}/progress`,
                      json: { progress: Number(value), note },
                    },
                    t('performance.goals.progressSaved'),
                  )
                ) {
                  setValue('');
                  setNote('');
                  onDone();
                  onClose();
                }
              })();
            }}
          >
            {t('performance.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PeersCard({
  cycle,
  onChanged,
}: {
  cycle: MyCycle;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const peers = cycle.peers!;
  const editable =
    ['goalSetting', 'selfReview'].includes(cycle.cycleStatus) &&
    peers.status !== 'confirmed';
  const candidates = useRemote<
    { userId: string; name: string; departmentTitle: string }[]
  >(editable ? 'talent/performance/me/peer-candidates' : null, {
    cycleId: cycle.cycleId,
  });
  const action = useAction();
  const [chosen, setChosen] = useState<string[]>(peers.userIds);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('performance.peers.nominate')}</CardTitle>
        <CardDescription>
          {t('performance.peers.nominateHint', { count: peers.count })}
        </CardDescription>
        <CardAction>
          <Badge variant='outline'>
            {t(`performance.peers.status.${peers.status}`)}
          </Badge>
        </CardAction>
      </CardHeader>
      {editable ? (
        <CardContent className='space-y-3'>
          {candidates.error ? (
            <LoadError error={candidates.error} onRetry={candidates.reload} />
          ) : (
            <div className='grid gap-2 sm:grid-cols-2'>
              {(candidates.data ?? []).map((person) => (
                <label
                  key={person.userId}
                  className='flex items-center gap-2 text-sm'
                >
                  <Checkbox
                    checked={chosen.includes(person.userId)}
                    onCheckedChange={(checked) =>
                      setChosen((list) =>
                        checked
                          ? [...list, person.userId]
                          : list.filter((id) => id !== person.userId),
                      )
                    }
                  />
                  <span>
                    {person.name}
                    <span className='ms-1 text-muted-foreground'>
                      {person.departmentTitle}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            disabled={action.busy || chosen.length < 2}
            onClick={() => {
              void (async () => {
                if (
                  await action.run(
                    {
                      method: 'POST',
                      path: 'talent/performance/me/peers',
                      json: { cycleId: cycle.cycleId, userIds: chosen },
                    },
                    t('performance.peers.nominated'),
                  )
                )
                  onChanged();
              })();
            }}
          >
            {t('performance.peers.submit')}
          </Button>
        </CardContent>
      ) : null}
    </Card>
  );
}

function SelfTab({ cycle }: { cycle: MyCycle | undefined }): ReactElement {
  const { t } = useTranslation();
  if (!cycle) return <EmptyState title={t('performance.my.noCycle')} />;
  return (
    <div className='space-y-4'>
      {cycle.selfReview ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('performance.my.selfReview')}</CardTitle>
            <CardAction>
              <TaskStatusBadge status={cycle.selfReview.status} />
            </CardAction>
          </CardHeader>
          <CardContent>
            <Button
              nativeButton={false}
              render={
                <Link
                  to={`reviews/${encodeURIComponent(cycle.selfReview.reviewId)}`}
                />
              }
            >
              {t(
                cycle.selfReview.status === 'submitted'
                  ? 'performance.my.openSelf'
                  : 'performance.my.writeSelf',
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <EmptyState
          title={t(
            cycle.noAccount
              ? 'performance.my.noAccount'
              : 'performance.my.noSelfYet',
          )}
        />
      )}
      {cycle.evidence ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('performance.evidence.mine')}</CardTitle>
            <CardDescription>
              {t('performance.evidence.description')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EvidenceView
              snapshot={cycle.evidence.snapshot}
              summary={cycle.evidence.summary}
            />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TasksTab({ tasks }: { tasks: MyTask[] }): ReactElement {
  const { t } = useTranslation();
  const date = useDateText();
  if (!tasks.length)
    return <EmptyState title={t('performance.my.noPeerTasks')} />;
  return (
    <div className='grid gap-3 md:grid-cols-2'>
      {tasks.map((task) => (
        <Card key={task.reviewId}>
          <CardHeader>
            <CardTitle>
              {t('performance.my.peerTask', { name: task.employeeName })}
            </CardTitle>
            <CardDescription>
              {task.cycleTitle} ·{' '}
              {t('performance.common.deadline', { date: date(task.deadline) })}
            </CardDescription>
            <CardAction>
              <TaskStatusBadge status={task.status} />
            </CardAction>
          </CardHeader>
          <CardFooter>
            <Button
              size='sm'
              nativeButton={false}
              render={
                <Link to={`reviews/${encodeURIComponent(task.reviewId)}`} />
              }
            >
              {t(
                task.editable
                  ? 'performance.my.writePeer'
                  : 'performance.my.openPeer',
              )}
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

function ResultsTab({
  results,
  error,
  onChanged,
}: {
  results: MyResult[] | undefined;
  error: unknown;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useAction();
  const date = useDateText();
  const [appealing, setAppealing] = useState<MyResult | null>(null);
  const [reason, setReason] = useState('');
  if (error) return <LoadError error={error} />;
  if (!results) return <BlockSkeleton rows={3} />;
  if (!results.length)
    return <EmptyState title={t('performance.my.noResult')} />;
  return (
    <div className='space-y-4'>
      {results.map((result) => (
        <Card key={result.resultId}>
          <CardHeader>
            <CardTitle className='flex flex-wrap items-center gap-2'>
              {result.cycleTitle}
              <RatingBadge rating={result.finalRating} />
            </CardTitle>
            <CardDescription>
              {result.ratingDescription} ·{' '}
              {t('performance.my.publishedAt', {
                date: date(result.publishedAt),
              })}
            </CardDescription>
            <CardAction>
              <Badge variant='outline'>
                {t(`performance.resultStatus.${result.status}`)}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent className='space-y-3 text-sm'>
            <div>
              <p className='font-medium'>
                {t('performance.my.managerComment')}
              </p>
              <p className='break-words whitespace-pre-wrap'>
                {result.managerComment ?? '—'}
              </p>
            </div>
            <div>
              <p className='font-medium'>{t('performance.peers.title')}</p>
              <PeerSummaryView peers={result.peers} />
            </div>
            {result.appeal ? (
              <Alert>
                <AlertDescription>
                  {t('performance.my.appealed', {
                    reason: result.appeal.reason,
                  })}
                  {result.appeal.result
                    ? ` ${t(`performance.appeal.results.${result.appeal.result}`)}：${result.appeal.note ?? ''}`
                    : ''}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          {result.can.acknowledge || result.can.appeal ? (
            <CardFooter className='flex-col gap-2 sm:flex-row'>
              {result.can.acknowledge ? (
                <Button
                  className='w-full sm:w-auto'
                  disabled={action.busy}
                  onClick={() => {
                    void (async () => {
                      if (
                        await action.run(
                          {
                            method: 'POST',
                            path: `talent/performance/results/${encodeURIComponent(result.resultId)}/acknowledge`,
                          },
                          t('performance.my.acknowledged'),
                        )
                      )
                        onChanged();
                    })();
                  }}
                >
                  {t('performance.my.acknowledge')}
                </Button>
              ) : null}
              {result.can.appeal ? (
                <Button
                  className='w-full sm:w-auto'
                  variant='outline'
                  onClick={() => setAppealing(result)}
                >
                  {t('performance.my.appeal', { date: result.appealDeadline })}
                </Button>
              ) : null}
            </CardFooter>
          ) : null}
        </Card>
      ))}
      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      <Dialog
        open={Boolean(appealing)}
        onOpenChange={(open) => (open ? undefined : setAppealing(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('performance.my.appealTitle')}</DialogTitle>
            <DialogDescription>{appealing?.cycleTitle}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='appeal-reason'>
              {t('performance.my.appealReason')}
            </FieldLabel>
            <Textarea
              id='appeal-reason'
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAppealing(null)}>
              {t('performance.common.cancel')}
            </Button>
            <Button
              disabled={action.busy || !reason.trim()}
              onClick={() => {
                void (async () => {
                  if (!appealing) return;
                  if (
                    await action.run(
                      {
                        method: 'POST',
                        path: `talent/performance/results/${encodeURIComponent(appealing.resultId)}/appeal`,
                        json: { reason },
                      },
                      t('performance.my.appealSent'),
                    )
                  ) {
                    setAppealing(null);
                    setReason('');
                    onChanged();
                  }
                })();
              }}
            >
              {t('performance.my.appealSubmit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

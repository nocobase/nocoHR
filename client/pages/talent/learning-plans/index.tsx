import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, ClockIcon, XIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type { LearningPlan } from '@/components/talent/training-types';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

type Tab = 'mine' | 'all';

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'default',
  approved: 'secondary',
  rejected: 'destructive',
  expired: 'outline',
};

/**
 * 学习计划 — plans the learning coach drafted. "待我确认" lists drafts waiting
 * for the caller's decision: remove items or move due dates, then approve (the
 * tasks are created in the approver's name) or reject with a reason.
 */
export default function LearningPlansPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'mine';
  const plans = useRemote<{
    items: LearningPlan[];
    adoption: { approved: number; decided: number; rate: number | null };
  }>(
    'talent/learning-plans',
    tab === 'mine' ? { mine: true, status: 'draft' } : {},
  );
  const highlighted = params.get('plan');

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentLearningPlans')}
        description={t('talent.plans.description')}
      />
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('tab', String(value));
            setParams(next, { replace: true });
          }}
        >
          <TabsList>
            <TabsTrigger value='mine'>{t('talent.plans.mine')}</TabsTrigger>
            <TabsTrigger value='all'>{t('talent.plans.all')}</TabsTrigger>
          </TabsList>
        </Tabs>
        {plans.data?.adoption.rate !== null &&
        plans.data?.adoption.rate !== undefined ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.plans.adoption', {
              rate: plans.data.adoption.rate,
              decided: plans.data.adoption.decided,
            })}
          </p>
        ) : null}
      </div>
      {plans.error ? (
        <LoadError error={plans.error} onRetry={plans.reload} />
      ) : !plans.data ? (
        <BlockSkeleton rows={4} />
      ) : !plans.data.items.length ? (
        <EmptyState
          title={
            tab === 'mine'
              ? t('talent.plans.emptyMine')
              : t('talent.plans.empty')
          }
          description={t('talent.plans.emptyDescription')}
        />
      ) : (
        <div className='grid gap-4 xl:grid-cols-2'>
          {plans.data.items.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              highlighted={plan.id === highlighted}
              onChanged={plans.reload}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}

function PlanCard({
  plan,
  highlighted,
  onChanged,
}: {
  plan: LearningPlan;
  highlighted: boolean;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const draft = plan.status === 'draft';
  const [kept, setKept] = useState<Record<string, boolean>>(
    Object.fromEntries(plan.items.map((i) => [`${i.type}:${i.refId}`, true])),
  );
  const [dueDates, setDueDates] = useState<Record<string, string>>(
    Object.fromEntries(
      plan.items.map((i) => [`${i.type}:${i.refId}`, i.dueDate]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const keptItems = plan.items.filter((i) => kept[`${i.type}:${i.refId}`]);

  async function approve(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: `talent/learning-plans/${encodeURIComponent(plan.id)}/approve`,
        method: 'POST',
        json: {
          items: keptItems.map((i) => ({
            type: i.type,
            refId: i.refId,
            dueDate: dueDates[`${i.type}:${i.refId}`],
          })),
        },
      });
      toast.add({
        type: 'success',
        title: t('talent.plans.approved', { name: plan.employeeName }),
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    if (!note.trim()) {
      setError(t('talent.plans.rejectReasonRequired'));
      return;
    }
    setBusy(true);
    try {
      await api.request({
        path: `talent/learning-plans/${encodeURIComponent(plan.id)}/reject`,
        method: 'POST',
        json: { note: note.trim() },
      });
      setRejecting(false);
      toast.add({ type: 'success', title: t('talent.plans.rejected') });
      onChanged();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={highlighted ? 'ring-2 ring-primary/40' : undefined}>
      <CardHeader>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle>
            {t('talent.plans.for', { name: plan.employeeName })}
          </CardTitle>
          <Badge variant={STATUS_VARIANT[plan.status] ?? 'outline'}>
            {t(`talent.plans.status.${plan.status}`)}
          </Badge>
        </div>
        <CardDescription className='whitespace-pre-wrap'>
          {plan.summary}
        </CardDescription>
        <p className='text-xs text-muted-foreground'>
          {t(`talent.plans.trigger.${plan.trigger}`)} ·{' '}
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
            new Date(plan.createdAt),
          )}{' '}
          · {t('talent.plans.reviewer', { name: plan.reviewerName ?? '' })}
        </p>
      </CardHeader>
      <CardContent>
        <ul className='space-y-3'>
          {plan.items.map((item) => {
            const key = `${item.type}:${item.refId}`;
            return (
              <li key={key} className='flex gap-3 rounded-md border p-3'>
                {draft && plan.can.approve ? (
                  <Checkbox
                    checked={kept[key]}
                    onCheckedChange={(checked) =>
                      setKept((previous) => ({
                        ...previous,
                        [key]: checked === true,
                      }))
                    }
                    aria-label={t('talent.plans.keepItem', {
                      title: item.title,
                    })}
                    className='mt-0.5'
                  />
                ) : null}
                <div className='min-w-0 flex-1 space-y-1 text-sm'>
                  <p className='flex flex-wrap items-center gap-2 font-medium'>
                    {item.title}
                    <Badge variant='outline'>
                      {t(`talent.plans.itemTypes.${item.type}`)}
                    </Badge>
                    {item.competencyTitle ? (
                      <Badge variant='secondary'>{item.competencyTitle}</Badge>
                    ) : null}
                  </p>
                  <p className='text-muted-foreground'>{item.reason}</p>
                  <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
                    {item.estimatedMinutes ? (
                      <span className='inline-flex items-center gap-1'>
                        <ClockIcon className='size-3' />
                        {t('talent.learning.minutes', {
                          count: item.estimatedMinutes,
                        })}
                      </span>
                    ) : null}
                    {draft && plan.can.approve ? (
                      <label className='inline-flex items-center gap-1.5'>
                        {t('talent.plans.dueDate')}
                        <Input
                          type='date'
                          className='h-7 w-40'
                          value={dueDates[key]}
                          onChange={(e) =>
                            setDueDates((previous) => ({
                              ...previous,
                              [key]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ) : (
                      <span>
                        {t('talent.learning.due', { date: item.dueDate })}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {plan.reviewNote ? (
          <p className='mt-3 text-sm text-muted-foreground'>
            {t('talent.plans.note', { note: plan.reviewNote })}
          </p>
        ) : null}
      </CardContent>
      {draft && (plan.can.approve || plan.can.reject) ? (
        <CardFooter className='flex flex-wrap justify-between gap-2'>
          <span className='text-xs text-muted-foreground'>
            {t('talent.plans.keptSummary', {
              kept: keptItems.length,
              total: plan.items.length,
              minutes: keptItems.reduce(
                (sum, i) => sum + (i.estimatedMinutes ?? 0),
                0,
              ),
            })}
          </span>
          <div className='flex gap-2'>
            {plan.can.reject ? (
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => setRejecting(true)}
              >
                <XIcon data-icon='inline-start' />
                {t('talent.plans.reject')}
              </Button>
            ) : null}
            {plan.can.approve ? (
              <Button
                disabled={busy || !keptItems.length}
                onClick={() => void approve()}
              >
                <CheckIcon data-icon='inline-start' />
                {t('talent.plans.approve')}
              </Button>
            ) : null}
          </div>
        </CardFooter>
      ) : null}
      <Dialog open={rejecting} onOpenChange={setRejecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('talent.plans.rejectTitle')}</DialogTitle>
            <DialogDescription>
              {t('talent.plans.rejectDescription')}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`reject-${plan.id}`}>
              {t('talent.plans.reason')}
            </FieldLabel>
            <Textarea
              id={`reject-${plan.id}`}
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejecting(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={busy}
              onClick={() => void reject()}
            >
              {t('talent.plans.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

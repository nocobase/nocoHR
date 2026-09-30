/**
 * V4-13 人才盘点 (`/talent/talent-reviews`, hr.admin; heads see the reviews
 * with people in their scope while they are preparing or in session). The
 * list and a new review (title, departments, the published review cycle the
 * performance axis reads). A review opens as the child page `:reviewId`.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface ReviewRow {
  id: string;
  title: string;
  status: string;
  ownerName: string;
  placements: number;
  decided: number;
  potentialDone: number;
}

export default function TalentReviewsPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ reviews: ReviewRow[]; can: { manage: boolean } }>(
    'talent/talent-reviews',
  );
  const [creating, setCreating] = useState(false);
  return (
    <PageContainer>
      <PageHeader
        title={t('talentReview.reviews.title')}
        description={t('talentReview.reviews.description')}
        actions={
          list.data?.can.manage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon='inline-start' />
              {t('talentReview.reviews.create')}
            </Button>
          ) : null
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.reviews.length ? (
        <EmptyState title={t('talentReview.reviews.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.reviews.name')}</TableHead>
                <TableHead>{t('talentReview.common.status')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.reviews.people')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.reviews.potentialDone')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.reviews.decided')}</TableHead>
                <TableHead>{t('talentReview.reviews.owner')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>
                    <Link
                      className='font-medium underline-offset-4 hover:underline'
                      to={encodeURIComponent(review.id)}
                    >
                      {review.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TrStatusBadge status={review.status} />
                  </TableCell>
                  <TableCell className='text-end tabular-nums'>{review.placements}</TableCell>
                  <TableCell className='text-end tabular-nums'>{review.potentialDone}</TableCell>
                  <TableCell className='text-end tabular-nums'>{review.decided}</TableCell>
                  <TableCell>{review.ownerName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {creating ? <CreateDialog onClose={() => setCreating(false)} /> : null}
      <Outlet context={{ reload: list.reload }} />
    </PageContainer>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lookups = useLookups();
  const cycles = useRemote<{ cycles: { id: string; title: string; status: string }[] }>(
    'talent/performance/cycles',
  );
  const action = useTrAction();
  const [title, setTitle] = useState(() =>
    t('talentReview.reviews.defaultTitle', { year: new Date().getFullYear() }),
  );
  const [departments, setDepartments] = useState<string[]>([]);
  const [cycleId, setCycleId] = useState('');
  const toggle = (id: string, on: boolean) =>
    setDepartments((current) => (on ? [...current, id] : current.filter((d) => d !== id)));
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('talentReview.reviews.create')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <Field>
            <FieldLabel htmlFor='tr-title'>{t('talentReview.reviews.name')}</FieldLabel>
            <Input id='tr-title' value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor='tr-cycle'>{t('talentReview.reviews.cycle')}</FieldLabel>
            <NativeSelect id='tr-cycle' value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
              <NativeSelectOption value=''>{t('talentReview.reviews.noCycle')}</NativeSelectOption>
              {(cycles.data?.cycles ?? []).map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <fieldset className='flex flex-col gap-2'>
            <legend className='mb-1 text-sm font-medium'>{t('talentReview.reviews.scope')}</legend>
            <div className='grid max-h-60 gap-1.5 overflow-y-auto rounded-md border p-2'>
              {lookups.departments.map((d) => (
                <label key={d.id} className='flex items-center gap-2 text-sm' style={{ paddingInlineStart: d.depth * 12 }}>
                  <Checkbox
                    checked={departments.includes(d.id)}
                    onCheckedChange={(value) => toggle(d.id, value === true)}
                  />
                  {d.label}
                </label>
              ))}
            </div>
          </fieldset>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !title.trim() || !departments.length}
            onClick={() => { void (async () => {
              const created = await action.run<{ review: { id: string } }>(
                {
                  method: 'POST',
                  path: 'talent/talent-reviews',
                  json: { title, departmentIds: departments, reviewCycleId: cycleId || null },
                },
                t('talentReview.reviews.created'),
              );
              if (created) void navigate(encodeURIComponent(created.review.id));
            })(); }}
          >
            {t('talentReview.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

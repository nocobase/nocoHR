/**
 * V2-07 招聘 / 用工计划 (`talent.workforcePlans`): the production plans the ERP
 * pushed, by month and department, with the gap; hr.admin may enter one by
 * hand (same calculation). A plan opens as a child page.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAction } from '@/components/talent/recruiting-lib';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type { Plan } from '@/components/talent/recruiting-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PlanList {
  items: Plan[];
  can: { import: boolean; settings: boolean };
}

export default function WorkforcePlansPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<PlanList>('talent/recruiting/workforce-plans');
  const [entering, setEntering] = useState(false);
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('recruiting.workforce.title')}
          description={t('recruiting.workforce.description')}
          actions={
            list.data?.can.import ? (
              <Button variant='outline' onClick={() => setEntering((v) => !v)}>
                {t('recruiting.workforce.push')}
              </Button>
            ) : null
          }
        />
        {entering ? (
          <PushForm
            onDone={() => {
              setEntering(false);
              list.reload();
            }}
          />
        ) : null}
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={4} />
        ) : !list.data.items.length ? (
          <EmptyState title={t('recruiting.workforce.empty')} />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('recruiting.common.month')}</TableHead>
                  <TableHead>{t('recruiting.common.department')}</TableHead>
                  <TableHead>{t('recruiting.common.position')}</TableHead>
                  <TableHead className='text-right'>
                    {t('recruiting.workforce.planned')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('recruiting.workforce.capacity')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('recruiting.workforce.gap')}
                  </TableHead>
                  <TableHead>{t('recruiting.common.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.items.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        className='underline-offset-4 hover:underline'
                        to={p.id}
                      >
                        {p.month}
                      </Link>
                    </TableCell>
                    <TableCell>{p.departmentTitle}</TableCell>
                    <TableCell>{p.positionTitle}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {Number(p.plannedOutput).toLocaleString()}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {Number(p.calculation?.capacity ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {p.calculation?.gapHeadcount ?? 0}
                    </TableCell>
                    <TableCell>
                      <StatusBadge kind='plan' value={p.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </PageContainer>
      <Outlet context={{ reload: list.reload }} />
    </>
  );
}

function PushForm({ onDone }: { onDone: () => void }): ReactElement {
  const { t } = useTranslation();
  const { busy, run } = useAction();
  const [form, setForm] = useState({
    department: '',
    position: '',
    month: '',
    plannedOutput: '',
    currentOutput: '',
  });
  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('recruiting.workforce.pushTitle')}</CardTitle>
        <CardDescription>
          {t('recruiting.workforce.pushDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className='grid gap-3 sm:grid-cols-2 lg:grid-cols-5'
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              'push',
              {
                path: 'talent/recruiting/workforce-plans',
                json: {
                  department: form.department.trim(),
                  position: form.position.trim(),
                  month: form.month.trim(),
                  plannedOutput: Number(form.plannedOutput),
                  ...(form.currentOutput
                    ? { currentOutput: Number(form.currentOutput) }
                    : {}),
                },
              },
              t('recruiting.common.saved'),
            ).then((result) => {
              if (result) onDone();
            });
          }}
        >
          <Field>
            <FieldLabel htmlFor='wp-department'>
              {t('recruiting.common.department')}
            </FieldLabel>
            <Input
              id='wp-department'
              required
              value={form.department}
              onChange={(e) => set('department', e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='wp-position'>
              {t('recruiting.common.position')}
            </FieldLabel>
            <Input
              id='wp-position'
              required
              value={form.position}
              onChange={(e) => set('position', e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='wp-month'>
              {t('recruiting.common.month')}
            </FieldLabel>
            <Input
              id='wp-month'
              required
              placeholder='2026-11'
              pattern='\d{4}-\d{2}'
              value={form.month}
              onChange={(e) => set('month', e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='wp-planned'>
              {t('recruiting.workforce.planned')}
            </FieldLabel>
            <Input
              id='wp-planned'
              required
              type='number'
              min={0}
              value={form.plannedOutput}
              onChange={(e) => set('plannedOutput', e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='wp-current'>
              {t('recruiting.workforce.current')}
            </FieldLabel>
            <Input
              id='wp-current'
              type='number'
              min={0}
              value={form.currentOutput}
              onChange={(e) => set('currentOutput', e.target.value)}
            />
          </Field>
          <div className='sm:col-span-2 lg:col-span-5'>
            <Button type='submit' disabled={busy !== null}>
              {t('recruiting.common.submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

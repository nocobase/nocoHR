import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type { ProfileChangeRequest } from '@/components/talent/types';
import { useRemote } from '@/components/talent/use-remote';
import { str } from '@/components/talent/text';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import type { EmployeesOutletContext } from './types.js';

function describe(value: unknown, t: (key: string) => string): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) {
    if (!value.length) return t('talent.common.none');
    return value
      .map((item) =>
        Object.entries(item as Record<string, unknown>)
          .filter(
            ([k, v]) =>
              v && !['id', 'employeeId', 'createdAt', 'updatedAt'].includes(k),
          )
          .map(([k, v]) =>
            k === 'degree' ? t(`talent.degree.${String(v)}`) : String(v),
          )
          .join(' · '),
      )
      .join('\n');
  }
  return str(value);
}

/** Route `/talent/employees/changes`: HR reviews pending self-service profile changes, field by field. */
export default function ProfileChangesPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <RouteDrawer
      title={t('talent.changes.title')}
      description={t('talent.changes.description')}
      className='sm:max-w-2xl'
    >
      <ChangesBody />
    </RouteDrawer>
  );
}

function ChangesBody(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const { reload } = useOutletContext<EmployeesOutletContext>();
  const changes = useRemote<ProfileChangeRequest[]>('talent/profile-changes', {
    status: 'pending',
  });
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function decide(
    id: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    setBusy(id);
    try {
      await api.request({
        path: `talent/profile-changes/${encodeURIComponent(id)}/${decision}`,
        method: 'POST',
        json: { comment: comments[id] ?? null },
      });
      toast.add({
        type: 'success',
        title:
          decision === 'approve'
            ? t('talent.changes.approved')
            : t('talent.changes.rejected'),
      });
      changes.reload();
      reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  if (changes.error)
    return <LoadError error={changes.error} onRetry={changes.reload} />;
  if (!changes.data) return <BlockSkeleton />;
  if (!changes.data.length)
    return <EmptyState title={t('talent.changes.empty')} />;
  return (
    <div className='space-y-4'>
      {changes.data.map((request) => (
        <Card key={request.id}>
          <CardHeader>
            <CardTitle>{request.employeeName}</CardTitle>
            <CardDescription>
              {format.format(new Date(request.createdAt))}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <dl className='space-y-2 text-sm'>
              {Object.keys(request.changes).map((field) => (
                <div
                  key={field}
                  className='grid grid-cols-[7rem_1fr_1fr] gap-2'
                >
                  <dt className='text-muted-foreground'>
                    {t(`talent.changes.fields.${field}`)}
                  </dt>
                  <dd className='whitespace-pre-line text-muted-foreground line-through'>
                    {describe(request.current[field], t)}
                  </dd>
                  <dd className='whitespace-pre-line font-medium'>
                    {describe(request.changes[field], t)}
                  </dd>
                </div>
              ))}
            </dl>
            <Field>
              <FieldLabel htmlFor={`comment-${request.id}`}>
                {t('talent.changes.comment')}
              </FieldLabel>
              <Textarea
                id={`comment-${request.id}`}
                value={comments[request.id] ?? ''}
                onChange={(e) =>
                  setComments((c) => ({ ...c, [request.id]: e.target.value }))
                }
              />
            </Field>
            <div className='flex justify-end gap-2'>
              <Button
                variant='outline'
                disabled={busy === request.id}
                onClick={() => void decide(request.id, 'reject')}
              >
                {t('talent.changes.reject')}
              </Button>
              <Button
                disabled={busy === request.id}
                onClick={() => void decide(request.id, 'approve')}
              >
                {t('talent.changes.approve')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { resolveAppUrl } from '@nocobase/app-client';
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

  const [adopted, setAdopted] = useState<
    Record<string, Record<string, { on: boolean; value: unknown }>>
  >({});
  const [failures, setFailures] = useState<Record<string, string>>({});

  /** The HR assistant's fields: all adopted as read until HR unticks or rewrites one. */
  function choicesOf(request: ProfileChangeRequest) {
    return (
      adopted[request.id] ??
      Object.fromEntries(
        Object.entries(request.changes).map(([field, value]) => [
          field,
          { on: true, value },
        ]),
      )
    );
  }

  async function decide(
    id: string,
    decision: 'approve' | 'reject',
    values?: Record<string, unknown>,
  ): Promise<void> {
    setBusy(id);
    setFailures((f) => ({ ...f, [id]: '' }));
    try {
      await api.request({
        path: `talent/profile-changes/${encodeURIComponent(id)}/${decision}`,
        method: 'POST',
        json: { comment: comments[id] ?? null, ...(values ? { values } : {}) },
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
      // Inside the drawer the message stays with the request it belongs to.
      setFailures((f) => ({ ...f, [id]: errorMessage(cause, t) }));
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
            <CardTitle className='flex flex-wrap items-center gap-2'>
              {request.employeeName}
              <Badge
                variant={request.source === 'ai' ? 'secondary' : 'outline'}
              >
                {t(`talent.changes.source.${request.source ?? 'self'}`)}
              </Badge>
            </CardTitle>
            <CardDescription>
              {format.format(new Date(request.createdAt))}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            {failures[request.id] ? (
              <Alert variant='destructive'>
                <AlertDescription>{failures[request.id]}</AlertDescription>
              </Alert>
            ) : null}
            {request.source === 'ai' ? (
              <>
                <p className='text-sm text-muted-foreground'>
                  {t('talent.changes.aiHint')}
                  {request.attachmentPath ? (
                    <>
                      {' '}
                      <a
                        className='text-primary underline-offset-4 hover:underline'
                        href={resolveAppUrl(request.attachmentPath)}
                        target='_blank'
                        rel='noreferrer'
                      >
                        {t('talent.changes.viewAttachment')}
                      </a>
                    </>
                  ) : null}
                </p>
                <ul className='space-y-3'>
                  {Object.keys(request.changes).map((field) => {
                    const choice = choicesOf(request)[field] ?? {
                      on: false,
                      value: null,
                    };
                    const confidence = request.confidence?.[field];
                    const scalar = typeof request.changes[field] !== 'object';
                    const setChoice = (next: { on: boolean; value: unknown }) =>
                      setAdopted((all) => ({
                        ...all,
                        [request.id]: { ...choicesOf(request), [field]: next },
                      }));
                    return (
                      <li
                        key={field}
                        className='space-y-2 rounded-md border p-3 text-sm'
                      >
                        <div className='flex items-center gap-2'>
                          <Checkbox
                            id={`adopt-${request.id}-${field}`}
                            checked={choice.on}
                            disabled={busy === request.id}
                            onCheckedChange={(checked) =>
                              setChoice({ ...choice, on: checked === true })
                            }
                          />
                          <label
                            htmlFor={`adopt-${request.id}-${field}`}
                            className='font-medium'
                          >
                            {t('talent.changes.adopt', {
                              field: t(`talent.changes.fields.${field}`),
                            })}
                          </label>
                          {confidence ? (
                            <span className='text-muted-foreground'>
                              {t('talent.changes.confidence', {
                                percent: Math.round(
                                  confidence.confidence * 100,
                                ),
                              })}
                            </span>
                          ) : null}
                        </div>
                        <div className='grid gap-2 sm:grid-cols-2'>
                          <div>
                            <p className='text-xs text-muted-foreground'>
                              {t('talent.changes.currentValue')}
                            </p>
                            <p className='whitespace-pre-line'>
                              {describe(request.current[field], t)}
                            </p>
                          </div>
                          <div>
                            <p className='text-xs text-muted-foreground'>
                              {t('talent.changes.readValue')}
                            </p>
                            {scalar ? (
                              <Input
                                aria-label={t('talent.changes.readValueFor', {
                                  field: t(`talent.changes.fields.${field}`),
                                })}
                                value={str(choice.value ?? '')}
                                disabled={!choice.on || busy === request.id}
                                onChange={(e) =>
                                  setChoice({
                                    ...choice,
                                    value: e.target.value,
                                  })
                                }
                              />
                            ) : (
                              <p className='whitespace-pre-line'>
                                {describe([request.changes[field]], t)}
                              </p>
                            )}
                          </div>
                        </div>
                        {confidence?.snippet ? (
                          <p className='text-xs text-muted-foreground'>
                            {t('talent.changes.snippet', {
                              text: confidence.snippet,
                            })}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
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
            )}
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
                disabled={
                  busy === request.id ||
                  (request.source === 'ai' &&
                    !Object.values(choicesOf(request)).some((c) => c.on))
                }
                onClick={() =>
                  void decide(
                    request.id,
                    'approve',
                    request.source === 'ai'
                      ? Object.fromEntries(
                          Object.entries(choicesOf(request))
                            .filter(([, c]) => c.on)
                            .map(([field, c]) => [field, c.value]),
                        )
                      : undefined,
                  )
                }
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

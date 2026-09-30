import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SearchIcon, XIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import type {
  FindConditions,
  FindLookups,
  FindResult,
} from '@/components/talent/profile/types';
import { EmptyState } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

/**
 * 找人 (V3-11): one sentence becomes structured conditions — shown, editable,
 * searched again — and each person found carries why they match. The search
 * runs within the viewer's scope on the server; without a match the
 * strictest condition is named.
 */
export default function FindPeoplePage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useRemote<FindLookups>('talent/find-people/lookups');
  const departments = useLookups();
  const [text, setText] = useState('');
  const [result, setResult] = useState<FindResult | null>(null);
  const [conditions, setConditions] = useState<FindConditions | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(path: string, json: unknown): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: FindResult }>({
        method: 'POST',
        path,
        json,
      });
      setResult(response.data);
      setConditions(response.data.conditions);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const titleOf = (
    list: { id: string; title: string }[] | undefined,
    id: string,
  ) => list?.find((i) => i.id === id)?.title ?? id;
  const update = (patch: Partial<FindConditions>) =>
    setConditions((current) => (current ? { ...current, ...patch } : current));

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.insights.findPeople.title')}
        description={t('talent.insights.findPeople.description')}
      />
      <Card>
        <CardContent className='space-y-3'>
          <Field>
            <FieldLabel htmlFor='find-text' className='sr-only'>
              {t('talent.insights.findPeople.title')}
            </FieldLabel>
            <Textarea
              id='find-text'
              rows={2}
              placeholder={t('talent.insights.findPeople.placeholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className='flex justify-end'>
            <Button
              disabled={busy || !text.trim()}
              onClick={() => void run('talent/find-people/parse', { text })}
            >
              <SearchIcon data-icon='inline-start' />
              {t('talent.insights.findPeople.search')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {conditions ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.insights.findPeople.conditions')}</CardTitle>
            {result?.parsedBy ? (
              <CardDescription>
                {t(`talent.insights.findPeople.parsedBy.${result.parsedBy}`)}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className='space-y-4 text-sm'>
            <div className='flex flex-wrap gap-2'>
              {conditions.departmentIds.map((id) => (
                <Badge key={id} variant='secondary' className='gap-1'>
                  {t('talent.insights.findPeople.departments')}:{' '}
                  {departments.departmentTitle(id) ||
                    titleOf(lookups.data?.departments, id)}
                  <button
                    type='button'
                    aria-label={t('talent.insights.findPeople.removeCondition')}
                    onClick={() =>
                      update({
                        departmentIds: conditions.departmentIds.filter(
                          (d) => d !== id,
                        ),
                      })
                    }
                  >
                    <XIcon className='size-3' />
                  </button>
                </Badge>
              ))}
              {conditions.positionIds.map((id) => (
                <Badge key={id} variant='secondary' className='gap-1'>
                  {t('talent.insights.findPeople.positions')}:{' '}
                  {titleOf(lookups.data?.positions, id)}
                  <button
                    type='button'
                    aria-label={t('talent.insights.findPeople.removeCondition')}
                    onClick={() =>
                      update({
                        positionIds: conditions.positionIds.filter(
                          (p) => p !== id,
                        ),
                      })
                    }
                  >
                    <XIcon className='size-3' />
                  </button>
                </Badge>
              ))}
              {conditions.certifications.map((c) => (
                <Badge
                  key={c.certificationId}
                  variant='secondary'
                  className='gap-1'
                >
                  {t('talent.insights.findPeople.certifications')}:{' '}
                  {titleOf(lookups.data?.certifications, c.certificationId)}
                  <button
                    type='button'
                    aria-label={t('talent.insights.findPeople.removeCondition')}
                    onClick={() =>
                      update({
                        certifications: conditions.certifications.filter(
                          (x) => x.certificationId !== c.certificationId,
                        ),
                      })
                    }
                  >
                    <XIcon className='size-3' />
                  </button>
                </Badge>
              ))}
            </div>
            {conditions.competencies.map((c, index) => (
              <div
                key={c.competencyId}
                className='flex flex-wrap items-end gap-2'
              >
                <span className='min-w-40 font-medium'>
                  {titleOf(lookups.data?.competencies, c.competencyId)}
                </span>
                <Field className='w-28'>
                  <FieldLabel htmlFor={`find-min-${index}`}>
                    {t('talent.insights.findPeople.minLevel')}
                  </FieldLabel>
                  <Input
                    id={`find-min-${index}`}
                    type='number'
                    min={0}
                    value={c.minLevel ?? ''}
                    onChange={(e) =>
                      update({
                        competencies: conditions.competencies.map((x, i) =>
                          i === index
                            ? {
                                ...x,
                                minLevel:
                                  e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Field className='w-28'>
                  <FieldLabel htmlFor={`find-max-${index}`}>
                    {t('talent.insights.findPeople.maxLevel')}
                  </FieldLabel>
                  <Input
                    id={`find-max-${index}`}
                    type='number'
                    min={0}
                    value={c.maxLevel ?? ''}
                    onChange={(e) =>
                      update({
                        competencies: conditions.competencies.map((x, i) =>
                          i === index
                            ? {
                                ...x,
                                maxLevel:
                                  e.target.value === ''
                                    ? null
                                    : Number(e.target.value),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
                <Button
                  variant='ghost'
                  size='sm'
                  onClick={() =>
                    update({
                      competencies: conditions.competencies.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  {t('talent.insights.findPeople.removeCondition')}
                </Button>
              </div>
            ))}
            <div className='flex flex-wrap items-end gap-2'>
              <Field className='w-56'>
                <FieldLabel htmlFor='find-add-competency'>
                  {t('talent.insights.findPeople.addCompetency')}
                </FieldLabel>
                <NativeSelect
                  id='find-add-competency'
                  value=''
                  onChange={(e) => {
                    if (!e.target.value) return;
                    update({
                      competencies: [
                        ...conditions.competencies,
                        {
                          competencyId: e.target.value,
                          minLevel: 1,
                          maxLevel: null,
                        },
                      ],
                    });
                  }}
                >
                  <NativeSelectOption value=''>—</NativeSelectOption>
                  {(lookups.data?.competencies ?? [])
                    .filter(
                      (c) =>
                        !conditions.competencies.some(
                          (x) => x.competencyId === c.id,
                        ),
                    )
                    .map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.title}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
              <Field className='w-40'>
                <FieldLabel htmlFor='find-signals'>
                  {t('talent.insights.findPeople.signals')}
                </FieldLabel>
                <NativeSelect
                  id='find-signals'
                  value={conditions.signals?.mode ?? ''}
                  onChange={(e) =>
                    update({
                      signals: e.target.value
                        ? {
                            mode: e.target.value as 'none' | 'some',
                            types: conditions.signals?.types ?? [
                              'qualityIssue',
                            ],
                            withinDays: conditions.signals?.withinDays ?? 180,
                          }
                        : null,
                    })
                  }
                >
                  <NativeSelectOption value=''>—</NativeSelectOption>
                  <NativeSelectOption value='none'>
                    {t('talent.insights.findPeople.signalModes.none')}{' '}
                    {t('talent.insights.signals.types.qualityIssue')}
                  </NativeSelectOption>
                  <NativeSelectOption value='some'>
                    {t('talent.insights.findPeople.signalModes.some')}{' '}
                    {t('talent.insights.signals.types.qualityIssue')}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              {conditions.signals ? (
                <Field className='w-28'>
                  <FieldLabel htmlFor='find-days'>
                    {t('talent.insights.findPeople.withinDays', {
                      days: conditions.signals.withinDays,
                    })}
                  </FieldLabel>
                  <Input
                    id='find-days'
                    type='number'
                    min={1}
                    value={conditions.signals.withinDays}
                    onChange={(e) =>
                      update({
                        signals: conditions.signals
                          ? {
                              ...conditions.signals,
                              withinDays: Number(e.target.value) || 1,
                            }
                          : null,
                      })
                    }
                  />
                </Field>
              ) : null}
              <label className='flex items-center gap-2 pb-1.5'>
                <Switch
                  checked={conditions.activeOnly}
                  onCheckedChange={(checked) => update({ activeOnly: checked })}
                />
                {t('talent.insights.findPeople.activeOnly')}
              </label>
            </div>
            <div className='flex justify-end'>
              <Button
                variant='outline'
                disabled={busy}
                onClick={() =>
                  void run('talent/find-people/search', { conditions })
                }
              >
                {t('talent.insights.findPeople.rerun')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {result ? (
        result.results.length ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {t('talent.insights.findPeople.results')} ·{' '}
                {t('talent.insights.common.people', {
                  count: result.results.length,
                })}
              </CardTitle>
            </CardHeader>
            <CardContent className='grid gap-3 md:grid-cols-2'>
              {result.results.map((person) => (
                <div
                  key={person.employeeId}
                  className='space-y-2 rounded-lg border border-border p-3 text-sm'
                >
                  <div className='flex flex-wrap items-baseline justify-between gap-2'>
                    <Link
                      to={`/talent/employees/${encodeURIComponent(person.employeeId)}`}
                      className='font-medium text-primary underline-offset-4 hover:underline'
                    >
                      {person.name}
                    </Link>
                    <span className='text-muted-foreground'>
                      {person.employeeNo} · {person.positionTitle}
                    </span>
                  </div>
                  <p className='text-muted-foreground'>
                    {t('talent.insights.findPeople.why')}
                  </p>
                  <ul className='list-disc space-y-0.5 ps-5'>
                    {person.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            title={t('talent.insights.findPeople.empty')}
            description={
              result.strictest
                ? t('talent.insights.findPeople.strictest', {
                    label: result.strictest.label,
                    count: result.strictest.passing,
                  })
                : undefined
            }
          />
        )
      ) : null}
    </PageContainer>
  );
}

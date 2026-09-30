/**
 * 起草 Offer (child page, ?applicationId=): the applicable salary structure
 * with its pay range for the position; outside the range a reason is
 * required. Saved as a draft for the recruiter to submit.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { useAction } from '@/components/talent/recruiting-lib';
import type { StructureOption } from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';

export default function NewOfferPage(): ReactElement {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const applicationId = params.get('applicationId') ?? '';
  const structures = useRemote<StructureOption[]>(
    applicationId ? 'talent/recruiting/offers/structures' : null,
    { applicationId },
  );
  const { busy, run } = useAction();
  const [structureId, setStructureId] = useState('');
  const [base, setBase] = useState('');
  const [allowances, setAllowances] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [startDate, setStartDate] = useState('');
  const [probation, setProbation] = useState(3);
  const chosen = useMemo(() => {
    const list = structures.data ?? [];
    return (
      list.find((s) => s.id === structureId) ?? list.find((s) => s.applies)
    );
  }, [structures.data, structureId]);
  const range = chosen?.range;
  const out =
    range &&
    base !== '' &&
    (Number(base) < range.min || Number(base) > range.max);
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader title={t('recruiting.offers.new')} />
        {structures.error ? (
          <LoadError error={structures.error} onRetry={structures.reload} />
        ) : !structures.data ? (
          <BlockSkeleton rows={4} />
        ) : (
          <form
            className='grid max-w-2xl gap-3'
            onSubmit={(event) => {
              void (async () => {
                event.preventDefault();
                if (!chosen) return;
                const created = await run<{ id: string }>(
                  'create',
                  {
                    path: 'talent/recruiting/offers',
                    json: {
                      applicationId,
                      salaryOffer: {
                        baseSalary: Number(base),
                        allowances: Object.entries(allowances)
                          .filter(([, v]) => v !== '')
                          .map(([code, v]) => ({ code, amount: Number(v) })),
                        salaryStructureId: chosen.id,
                      },
                      outOfRangeReason: reason || null,
                      startDate,
                      probationMonths: probation,
                    },
                  },
                  t('recruiting.common.saved'),
                );
                if (created) {
                  outlet?.reload?.();
                  void navigate(`../${created.id}`, { relative: 'path' });
                }
              })();
            }}
          >
            <Field>
              <FieldLabel htmlFor='of-structure'>
                {t('recruiting.offers.structure')}
              </FieldLabel>
              <NativeSelect
                id='of-structure'
                value={chosen?.id ?? ''}
                onChange={(e) => setStructureId(e.target.value)}
              >
                {structures.data.map((s) => (
                  <NativeSelectOption key={s.id} value={s.id}>
                    {s.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {range ? (
                <span className='text-xs text-muted-foreground'>
                  {t('recruiting.offers.range', {
                    min: range.min,
                    max: range.max,
                  })}
                </span>
              ) : null}
            </Field>
            <Field>
              <FieldLabel htmlFor='of-base'>
                {t('recruiting.offers.baseSalary')}
              </FieldLabel>
              <Input
                id='of-base'
                type='number'
                min={0}
                required
                value={base}
                onChange={(e) => setBase(e.target.value)}
              />
            </Field>
            {chosen?.allowances.map((a) => (
              <Field key={a.code}>
                <FieldLabel htmlFor={`of-al-${a.code}`}>{a.title}</FieldLabel>
                <Input
                  id={`of-al-${a.code}`}
                  type='number'
                  min={0}
                  value={allowances[a.code] ?? ''}
                  onChange={(e) =>
                    setAllowances((v) => ({ ...v, [a.code]: e.target.value }))
                  }
                />
              </Field>
            ))}
            {out ? (
              <>
                <Alert>
                  <AlertDescription>
                    {t('recruiting.offers.outOfRange')}
                  </AlertDescription>
                </Alert>
                <Field>
                  <FieldLabel htmlFor='of-reason'>
                    {t('recruiting.offers.reason')}
                  </FieldLabel>
                  <Textarea
                    id='of-reason'
                    required
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='of-start'>
                  {t('recruiting.offers.startDate')}
                </FieldLabel>
                <Input
                  id='of-start'
                  type='date'
                  required
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='of-probation'>
                  {t('recruiting.offers.probation')}
                </FieldLabel>
                <Input
                  id='of-probation'
                  type='number'
                  min={0}
                  max={6}
                  value={probation}
                  onChange={(e) => setProbation(Number(e.target.value))}
                />
              </Field>
            </div>
            <Button type='submit' disabled={busy !== null || !chosen}>
              {t('recruiting.common.save')}
            </Button>
          </form>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

/**
 * V4-13 认证项目 · 实操要求 (mounted in the certification detail page): the
 * practical assessments a certificate needs, for the first issue, the
 * recertification or both, and how long a passed record counts. Only a
 * passed record signed by the assessor (and the witness, when the form asks
 * for one) within that time lets the certificate be issued or renewed.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { useTrAction } from './talent-review-lib.js';
import { useRemote } from './use-remote.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

interface Requirement {
  assessmentIds: string[];
  practicalRequiredFor: 'initial' | 'recert' | 'both';
  practicalValidMonths: number;
}

export function CertificationPracticalsCard({
  certificationId,
  canManage,
}: {
  certificationId: string;
  canManage: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const path = `talent/practicals/certifications/${encodeURIComponent(certificationId)}`;
  const requirement = useRemote<Requirement>(path);
  const templates = useRemote<{ templates: { id: string; title: string; reviewStatus: string }[] }>(
    canManage ? 'talent/practicals/templates' : null,
  );
  const action = useTrAction();
  const [draft, setDraft] = useState<Requirement | null>(null);
  if (!requirement.data) return null;
  const value = draft ?? requirement.data;
  const titleOf = new Map((templates.data?.templates ?? []).map((tpl) => [tpl.id, tpl.title]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talentReview.certPracticals.title')}</CardTitle>
        <CardDescription>{t('talentReview.certPracticals.description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3 text-sm'>
        {canManage ? (
          <>
            <div className='flex flex-col gap-1.5'>
              {(templates.data?.templates ?? [])
                .filter((tpl) => tpl.reviewStatus === 'confirmed')
                .map((tpl) => (
                  <label key={tpl.id} className='flex items-center gap-2'>
                    <Checkbox
                      checked={value.assessmentIds.includes(tpl.id)}
                      onCheckedChange={(on) =>
                        setDraft({
                          ...value,
                          assessmentIds:
                            on === true
                              ? [...value.assessmentIds, tpl.id]
                              : value.assessmentIds.filter((id) => id !== tpl.id),
                        })
                      }
                    />
                    {tpl.title}
                  </label>
                ))}
            </div>
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='cp-for'>{t('talentReview.certPracticals.requiredFor')}</FieldLabel>
                <NativeSelect
                  id='cp-for'
                  value={value.practicalRequiredFor}
                  onChange={(e) => setDraft({ ...value, practicalRequiredFor: e.target.value as Requirement['practicalRequiredFor'] })}
                >
                  {(['initial', 'recert', 'both'] as const).map((k) => (
                    <NativeSelectOption key={k} value={k}>
                      {t(`talentReview.certPracticals.for.${k}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='cp-months'>{t('talentReview.certPracticals.validMonths')}</FieldLabel>
                <Input
                  id='cp-months'
                  type='number'
                  min={1}
                  value={value.practicalValidMonths}
                  onChange={(e) => setDraft({ ...value, practicalValidMonths: Number(e.target.value) || 1 })}
                />
              </Field>
            </div>
            {action.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{action.error}</AlertDescription>
              </Alert>
            ) : null}
            <Button
              size='sm'
              className='self-end'
              disabled={action.busy || !draft}
              onClick={() => { void (async () => {
                const done = await action.run({ method: 'PUT', path, json: value }, t('talentReview.certPracticals.saved'));
                if (done) {
                  setDraft(null);
                  requirement.reload();
                }
              })(); }}
            >
              {t('talentReview.common.save')}
            </Button>
          </>
        ) : value.assessmentIds.length ? (
          <p>
            {t('talentReview.certPracticals.summary', {
              list: value.assessmentIds.map((id) => titleOf.get(id) ?? id).join('、'),
              for: t(`talentReview.certPracticals.for.${value.practicalRequiredFor}`),
              months: value.practicalValidMonths,
            })}
          </p>
        ) : (
          <p className='text-muted-foreground'>{t('talentReview.certPracticals.none')}</p>
        )}
      </CardContent>
    </Card>
  );
}

import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type FormEvent, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { CertificationSummary } from '@/components/talent/exam-types';
import { MultiCheckList } from '@/components/talent/multi-check';
import { useRemote } from '@/components/talent/use-remote';
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
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** Create or edit a certification programme: requirements, validity, the competency it proves, lifecycle settings. */
export function CertificationDialog({
  open,
  onOpenChange,
  certification,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certification: CertificationSummary | null;
  onSaved: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const targets = useRemote<{
    courses: { id: string; title: string }[];
    exams: { id: string; title: string }[];
  }>(open ? 'talent/assignments/targets' : null);
  const competencies = useRemote<{
    competencies: {
      id: string;
      title: string;
      category: string;
      active: boolean;
      reviewStatus: string;
    }[];
  }>(open ? 'talent/competencies' : null);
  // V3-10 任职资格: the position a certification qualifies for.
  const positions = useRemote<{
    positions: { id: string; title: string; active: boolean }[];
  }>(open ? 'talent/positions' : null);
  const empty = {
    code: '',
    title: '',
    description: '',
    validityMonths: '12',
    competencyId: '',
    competencyLevel: '1',
    expiringNoticeDays: '30',
    recertAdvanceDays: '60',
    escalateDays: '7',
    recertMode: 'examOnly',
    kind: 'internal',
    issuingAuthority: '',
    qualifiesPositionId: '',
  };
  const [form, setForm] = useState(empty);
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [examIds, setExamIds] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Opening the dialog, or opening it for another record, starts from that record.
  const [synced, setSynced] = useState<{
    open: boolean;
    source: CertificationSummary | null;
  }>({
    open: false,
    source: null,
  });
  if (synced.open !== open || (open && synced.source !== certification)) {
    setSynced({ open, source: certification });
    if (open) {
      setForm(
        certification
          ? {
              code: certification.code,
              title: certification.title,
              description: certification.description ?? '',
              validityMonths:
                certification.validityMonths === null
                  ? ''
                  : String(certification.validityMonths),
              competencyId: certification.competencyId ?? '',
              competencyLevel:
                certification.competencyLevel === null
                  ? ''
                  : String(certification.competencyLevel),
              expiringNoticeDays: String(certification.expiringNoticeDays),
              recertAdvanceDays: String(certification.recertAdvanceDays),
              escalateDays: String(certification.escalateDays),
              recertMode: certification.recertMode,
              kind: certification.kind ?? 'internal',
              issuingAuthority: certification.issuingAuthority ?? '',
              qualifiesPositionId: certification.qualifiesPositionId ?? '',
            }
          : empty,
      );
      setCourseIds(certification?.courses.map((c) => c.id) ?? []);
      setExamIds(certification?.exams.map((e) => e.id) ?? []);
      setError(undefined);
    }
  }

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        ...form,
        validityMonths: form.validityMonths || null,
        competencyId: form.competencyId || null,
        competencyLevel: form.competencyId
          ? form.competencyLevel || null
          : null,
        issuingAuthority: form.issuingAuthority || null,
        qualifiesPositionId:
          form.kind === 'internal' ? form.qualifiesPositionId || null : null,
        // An external certificate type has no courses or exams.
        courseIds: form.kind === 'external' ? [] : courseIds,
        examIds: form.kind === 'external' ? [] : examIds,
      };
      const result = certification
        ? await api.request<{ data: { id: string } }>({
            path: `talent/certifications/${encodeURIComponent(certification.id)}`,
            method: 'PATCH',
            json,
          })
        : await api.request<{ data: { id: string } }>({
            path: 'talent/certifications',
            method: 'POST',
            json,
          });
      toast.add({ type: 'success', title: t('talent.certifications.saved') });
      onSaved(result.data.id);
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  // Keep requirements that are no longer published visible when editing.
  const courseOptions = [
    ...(targets.data?.courses ?? []),
    ...(certification?.courses ?? []).filter(
      (c) => !targets.data?.courses.some((x) => x.id === c.id),
    ),
  ];
  const examOptions = [
    ...(targets.data?.exams ?? []),
    ...(certification?.exams ?? []).filter(
      (e) => !targets.data?.exams.some((x) => x.id === e.id),
    ),
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {certification
              ? t('talent.certifications.editTitle')
              : t('talent.certifications.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('talent.certifications.dialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='certification-form'
          onSubmit={(e) => void submit(e)}
          className='max-h-[65svh] overflow-y-auto pr-1'
        >
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]'>
              <Field>
                <FieldLabel htmlFor='cert-code'>
                  {t('talent.certifications.fields.code')}
                </FieldLabel>
                <Input
                  id='cert-code'
                  value={form.code}
                  onChange={(e) => set('code', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='cert-title'>
                  {t('talent.certifications.fields.title')}
                </FieldLabel>
                <Input
                  id='cert-title'
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='cert-kind'>
                  {t('talent.externalCerts.fields.kind')}
                </FieldLabel>
                <NativeSelect
                  id='cert-kind'
                  className='w-full'
                  value={form.kind}
                  disabled={Boolean(certification)}
                  onChange={(e) => set('kind', e.target.value)}
                >
                  <NativeSelectOption value='internal'>
                    {t('talent.externalCerts.kinds.internal')}
                  </NativeSelectOption>
                  <NativeSelectOption value='external'>
                    {t('talent.externalCerts.kinds.external')}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              {form.kind === 'external' ? (
                <Field>
                  <FieldLabel htmlFor='cert-authority'>
                    {t('talent.externalCerts.fields.issuingAuthority')}
                  </FieldLabel>
                  <Input
                    id='cert-authority'
                    value={form.issuingAuthority}
                    onChange={(e) => set('issuingAuthority', e.target.value)}
                  />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor='cert-qualifies'>
                    {t('talent.qualification.field')}
                  </FieldLabel>
                  <NativeSelect
                    id='cert-qualifies'
                    className='w-full'
                    value={form.qualifiesPositionId}
                    onChange={(e) => set('qualifiesPositionId', e.target.value)}
                  >
                    <NativeSelectOption value=''>
                      {t('talent.common.none')}
                    </NativeSelectOption>
                    {(positions.data?.positions ?? [])
                      .filter(
                        (p) => p.active || p.id === form.qualifiesPositionId,
                      )
                      .map((p) => (
                        <NativeSelectOption key={p.id} value={p.id}>
                          {p.title}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                  <FieldDescription>
                    {t('talent.qualification.fieldHint')}
                  </FieldDescription>
                </Field>
              )}
            </div>
            <Field>
              <FieldLabel htmlFor='cert-description'>
                {t('talent.certifications.fields.description')}
              </FieldLabel>
              <Textarea
                id='cert-description'
                rows={2}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
            {form.kind === 'internal' ? (
              <div className='grid gap-4 md:grid-cols-2'>
                <Field>
                  <FieldLabel>
                    {t('talent.certifications.fields.courses')}
                  </FieldLabel>
                  <MultiCheckList
                    options={courseOptions.map((c) => ({
                      value: c.id,
                      label: c.title,
                    }))}
                    value={courseIds}
                    onChange={setCourseIds}
                    label={t('talent.certifications.fields.courses')}
                    height='h-28'
                    searchable={false}
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('talent.certifications.fields.exams')}
                  </FieldLabel>
                  <MultiCheckList
                    options={examOptions.map((e) => ({
                      value: e.id,
                      label: e.title,
                    }))}
                    value={examIds}
                    onChange={setExamIds}
                    label={t('talent.certifications.fields.exams')}
                    height='h-28'
                    searchable={false}
                  />
                </Field>
              </div>
            ) : null}
            <FieldDescription>
              {form.kind === 'external'
                ? t('talent.externalCerts.typeHint')
                : t('talent.certifications.requirementsHint')}
            </FieldDescription>
            <div className='grid gap-4 sm:grid-cols-3'>
              <Field>
                <FieldLabel htmlFor='cert-validity'>
                  {t('talent.certifications.fields.validityMonths')}
                </FieldLabel>
                <Input
                  id='cert-validity'
                  type='number'
                  min={1}
                  value={form.validityMonths}
                  onChange={(e) => set('validityMonths', e.target.value)}
                />
                <FieldDescription>
                  {t('talent.certifications.validityHint')}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor='cert-competency'>
                  {t('talent.certifications.fields.competency')}
                </FieldLabel>
                <NativeSelect
                  id='cert-competency'
                  className='w-full'
                  value={form.competencyId}
                  onChange={(e) => set('competencyId', e.target.value)}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.none')}
                  </NativeSelectOption>
                  {(competencies.data?.competencies ?? [])
                    .filter((c) => c.active && c.reviewStatus === 'confirmed')
                    .map((c) => (
                      <NativeSelectOption key={c.id} value={c.id}>
                        {c.title}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='cert-level'>
                  {t('talent.certifications.fields.competencyLevel')}
                </FieldLabel>
                <Input
                  id='cert-level'
                  type='number'
                  min={0}
                  max={5}
                  disabled={!form.competencyId}
                  value={form.competencyLevel}
                  onChange={(e) => set('competencyLevel', e.target.value)}
                />
              </Field>
            </div>
            <div className='grid gap-4 sm:grid-cols-3'>
              <Field>
                <FieldLabel htmlFor='cert-notice'>
                  {t('talent.certifications.fields.expiringNoticeDays')}
                </FieldLabel>
                <Input
                  id='cert-notice'
                  type='number'
                  min={1}
                  value={form.expiringNoticeDays}
                  onChange={(e) => set('expiringNoticeDays', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='cert-advance'>
                  {t('talent.certifications.fields.recertAdvanceDays')}
                </FieldLabel>
                <Input
                  id='cert-advance'
                  type='number'
                  min={0}
                  value={form.recertAdvanceDays}
                  onChange={(e) => set('recertAdvanceDays', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='cert-mode'>
                  {t('talent.certifications.fields.recertMode')}
                </FieldLabel>
                <NativeSelect
                  id='cert-mode'
                  className='w-full'
                  value={form.recertMode}
                  onChange={(e) => set('recertMode', e.target.value)}
                >
                  <NativeSelectOption value='examOnly'>
                    {t('talent.certifications.recertModes.examOnly')}
                  </NativeSelectOption>
                  <NativeSelectOption value='full'>
                    {t('talent.certifications.recertModes.full')}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
            </div>
            <Field className='sm:max-w-xs'>
              <FieldLabel htmlFor='cert-escalate'>
                {t('talent.certifications.fields.escalateDays')}
              </FieldLabel>
              <Input
                id='cert-escalate'
                type='number'
                min={0}
                value={form.escalateDays}
                onChange={(e) => set('escalateDays', e.target.value)}
              />
              <FieldDescription>
                {t('talent.certifications.escalateHint')}
              </FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='certification-form' disabled={busy}>
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

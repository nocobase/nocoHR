import { useApiClient, useService } from '@nocobase/app-client';
import { clientFileRepositoryManagerToken } from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type FormEvent, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { KbDocument } from '@/components/talent/learning-types';
import { MultiCheckList } from '@/components/talent/multi-check';
import { useLookups } from '@/components/talent/use-lookups';
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
  FieldContent,
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

import { DOCUMENT_CATEGORIES } from './types.js';

const ACCEPT =
  '.pdf,.docx,.md,.markdown,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain';

interface CompetencyOption {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly reviewStatus: string;
  readonly active: boolean;
}

/** Upload a document (no `document`) or edit one: title, category, competency tags and visibility. */
export function DocumentDialog({
  open,
  onOpenChange,
  document,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: KbDocument | null;
  onSaved: (document: KbDocument) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const files = useService(clientFileRepositoryManagerToken);
  const lookups = useLookups();
  const competencies = useRemote<{ competencies: CompetencyOption[] }>(
    open ? 'talent/competencies' : null,
  );
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('sop');
  const [competencyIds, setCompetencyIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'all' | 'restricted'>('all');
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [positionIds, setPositionIds] = useState<string[]>([]);
  const [reviewDate, setReviewDate] = useState<string | null>(null);
  const [autoDraftCourse, setAutoDraftCourse] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Opening the dialog, or opening it for another record, starts from that record.
  const [synced, setSynced] = useState<{
    open: boolean;
    source: typeof document;
  }>({
    open: false,
    source: null,
  });
  if (synced.open !== open || (open && synced.source !== document)) {
    setSynced({ open, source: document });
    if (open) {
      setFile(null);
      setTitle(document?.title ?? '');
      setCategory(document?.category ?? 'sop');
      setCompetencyIds(document?.competencies.map((c) => c.id) ?? []);
      setVisibility(document?.visibility ?? 'all');
      setDepartmentIds(document?.departments.map((d) => d.id) ?? []);
      setPositionIds(document?.positions.map((p) => p.id) ?? []);
      setReviewDate(document?.reviewDate ?? null);
      setAutoDraftCourse(document?.autoDraftCourse ?? true);
      setError(undefined);
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || (!document && !file)) {
      setError(t('talent.form.required'));
      return;
    }
    if (
      visibility === 'restricted' &&
      !departmentIds.length &&
      !positionIds.length
    ) {
      setError(t('talent.knowledge.restrictedNeedsScope'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      let fileId: string | undefined;
      if (file)
        fileId = String(
          (await files.repository('hrFiles').uploadOne({ file })).record.id,
        );
      const json = {
        title: title.trim(),
        category,
        competencyIds,
        visibility,
        departmentIds,
        positionIds,
        reviewDate,
        autoDraftCourse,
        ...(fileId ? { fileId } : {}),
      };
      const result = document
        ? await api.request<{ data: KbDocument }>({
            path: `talent/kb/documents/${encodeURIComponent(document.id)}`,
            method: 'PATCH',
            json,
          })
        : await api.request<{ data: KbDocument }>({
            path: 'talent/kb/documents',
            method: 'POST',
            json,
          });
      toast.add({
        type: 'success',
        title: document
          ? t('talent.knowledge.saved')
          : t('talent.knowledge.uploaded'),
      });
      onSaved(result.data);
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const competencyOptions = (competencies.data?.competencies ?? [])
    .filter((c) => c.active && c.reviewStatus === 'confirmed')
    .map((c) => ({
      value: c.id,
      label: c.title,
      hint: t(`talent.category.${c.category}`),
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {document
              ? t('talent.knowledge.editTitle')
              : t('talent.knowledge.uploadTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('talent.knowledge.uploadDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='kb-document-form'
          onSubmit={(e) => void submit(e)}
          className='max-h-[65svh] overflow-y-auto pr-1'
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='kb-file'>
                {document
                  ? t('talent.knowledge.replaceFile')
                  : t('talent.knowledge.file')}
              </FieldLabel>
              <Input
                id='kb-file'
                type='file'
                accept={ACCEPT}
                onChange={(e) => {
                  const next = e.target.files?.[0] ?? null;
                  setFile(next);
                  if (next && !title.trim())
                    setTitle(next.name.replace(/\.[^.]+$/u, ''));
                }}
              />
              <FieldDescription>
                {t('talent.knowledge.fileHint')}
              </FieldDescription>
            </Field>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='kb-title'>
                  {t('talent.knowledge.fields.title')}
                </FieldLabel>
                <Input
                  id='kb-title'
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='kb-category'>
                  {t('talent.knowledge.fields.category')}
                </FieldLabel>
                <NativeSelect
                  id='kb-category'
                  className='w-full'
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {DOCUMENT_CATEGORIES.map((c) => (
                    <NativeSelectOption key={c} value={c}>
                      {t(`talent.docCategory.${c}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field>
              <FieldLabel>
                {t('talent.knowledge.fields.competencies')}
              </FieldLabel>
              <MultiCheckList
                options={competencyOptions}
                value={competencyIds}
                onChange={setCompetencyIds}
                label={t('talent.knowledge.fields.competencies')}
                height='h-32'
              />
            </Field>
            <Field>
              <FieldLabel>{t('talent.knowledge.fields.visibility')}</FieldLabel>
              <RadioGroup
                value={visibility}
                onValueChange={(v) => setVisibility(v as 'all' | 'restricted')}
                className='flex gap-6'
              >
                {(['all', 'restricted'] as const).map((v) => (
                  <label key={v} className='flex items-center gap-2 text-sm'>
                    <RadioGroupItem value={v} />
                    {t(`talent.visibility.${v}`)}
                  </label>
                ))}
              </RadioGroup>
              <FieldDescription>
                {t('talent.knowledge.visibilityHint')}
              </FieldDescription>
            </Field>
            {visibility === 'restricted' ? (
              <div className='grid gap-4 sm:grid-cols-2'>
                <Field>
                  <FieldLabel>
                    {t('talent.knowledge.fields.departments')}
                  </FieldLabel>
                  <MultiCheckList
                    options={lookups.departments
                      .filter((d) => d.active)
                      .map((d) => ({
                        value: d.id,
                        label: d.label,
                        depth: d.depth,
                      }))}
                    value={departmentIds}
                    onChange={setDepartmentIds}
                    label={t('talent.knowledge.fields.departments')}
                    height='h-36'
                  />
                </Field>
                <Field>
                  <FieldLabel>
                    {t('talent.knowledge.fields.positions')}
                  </FieldLabel>
                  <MultiCheckList
                    options={lookups.positions
                      .filter((p) => p.active)
                      .map((p) => ({ value: p.id, label: p.title }))}
                    value={positionIds}
                    onChange={setPositionIds}
                    label={t('talent.knowledge.fields.positions')}
                    height='h-36'
                  />
                </Field>
              </div>
            ) : null}
            <Field>
              <FieldLabel htmlFor='kb-review'>
                {t('talent.knowledge.fields.reviewDate')}
              </FieldLabel>
              <Input
                id='kb-review'
                type='date'
                className='w-48'
                value={reviewDate ?? ''}
                onChange={(e) => setReviewDate(e.target.value || null)}
              />
            </Field>
            <Field orientation='horizontal'>
              <Switch
                id='kb-auto-draft'
                checked={autoDraftCourse}
                onCheckedChange={setAutoDraftCourse}
              />
              <FieldContent>
                <FieldLabel htmlFor='kb-auto-draft'>
                  {t('talent.knowledge.autoDraftCourse')}
                </FieldLabel>
                <FieldDescription>
                  {t('talent.knowledge.autoDraftHint')}
                </FieldDescription>
              </FieldContent>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='kb-document-form' disabled={busy}>
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {document ? t('actions.save') : t('talent.knowledge.upload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useApiClient, useService, resolveAppUrl } from '@nocobase/app-client';
import { clientFileRepositoryManagerToken } from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import { FileIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Outlet, useOutletContext } from 'react-router';

import { EmployeeBasics } from '@/components/talent/employee-info';
import {
  CertificateWallCard,
  GrowthTimelineCard,
} from '@/components/talent/growth';
import { LearningRecordsCard } from '@/components/talent/learning-records';
import { errorMessage } from '@/components/talent/errors';
import { CustomFieldValues } from '@/components/talent/custom-fields';
import {
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { ProfileSections } from '@/components/talent/profile-sections';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { EmployeeProfile } from '@/components/talent/types';
import { useRemote } from '@/components/talent/use-remote';
import { str } from '@/components/talent/text';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
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

import type { DetailOutletContext } from './types.js';

type Kind = 'educations' | 'experiences' | 'emergencyContacts';

const DEGREES = [
  'highSchool',
  'associate',
  'bachelor',
  'master',
  'doctor',
  'other',
] as const;
const ATTACHMENT_CATEGORIES = [
  'diploma',
  'idCard',
  'contract',
  'other',
] as const;
const KEYS: Record<Kind, readonly string[]> = {
  educations: ['school', 'degree', 'major', 'startDate', 'endDate'],
  experiences: ['company', 'title', 'startDate', 'endDate', 'description'],
  emergencyContacts: ['name', 'relation', 'phone'],
};

/** Tab "档案": basic information, identity, education, experience, contacts and attachments. */
export default function EmployeeProfileTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const outlet = useOutletContext<DetailOutletContext>();
  const { detail, departmentTitle } = outlet;
  const id = encodeURIComponent(detail.employee.id);
  const profile = useRemote<EmployeeProfile>(
    detail.can.viewProfile || detail.can.viewContacts
      ? `talent/employees/${id}/profile`
      : null,
  );
  const [editing, setEditing] = useState<{
    kind: Kind;
    item: Record<string, unknown> | null;
  } | null>(null);

  async function remove(kind: Kind, itemId: string): Promise<void> {
    try {
      await api.request({
        path: `talent/employees/${id}/profile/${kind}/${encodeURIComponent(itemId)}`,
        method: 'DELETE',
      });
      toast.add({ type: 'success', title: t('talent.profile.removed') });
      profile.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <div className='space-y-4'>
      {/* 更正任职信息 opens here as a dialog over this tab. */}
      <Outlet context={outlet} />
      <Card>
        <CardHeader>
          <CardTitle>{t('talent.detail.basic')}</CardTitle>
        </CardHeader>
        <CardContent>
          <EmployeeBasics
            detail={detail}
            departmentTitle={departmentTitle}
            full
          />
        </CardContent>
      </Card>
      <CustomFieldsCard
        values={detail.employee.customFields}
        sensitive={detail.can.viewSensitive}
      />
      <CertificateWallCard employeeId={detail.employee.id} />
      <div className='grid gap-4 lg:grid-cols-2'>
        <LearningRecordsCard employeeId={detail.employee.id} />
        <GrowthTimelineCard employeeId={detail.employee.id} />
      </div>
      {profile.error ? (
        <LoadError error={profile.error} onRetry={profile.reload} />
      ) : !profile.data ? (
        detail.can.viewProfile || detail.can.viewContacts ? (
          <BlockSkeleton rows={3} />
        ) : null
      ) : (
        <>
          <ProfileSections
            profile={profile.data}
            actions={
              profile.data.can.manage
                ? (kind, item) =>
                    item ? (
                      <div className='flex shrink-0 gap-1'>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label={t('talent.common.edit')}
                          onClick={() => setEditing({ kind, item })}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          variant='ghost'
                          size='icon-sm'
                          aria-label={t('talent.common.remove')}
                          onClick={() => void remove(kind, String(item.id))}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setEditing({ kind, item: null })}
                      >
                        <PlusIcon data-icon='inline-start' />
                        {t('talent.common.add')}
                      </Button>
                    )
                : undefined
            }
          />
          {profile.data.can.viewContacts ? (
            <Attachments
              employeeId={detail.employee.id}
              profile={profile.data}
              onChanged={profile.reload}
            />
          ) : null}
        </>
      )}
      {editing ? (
        <ItemDialog
          kind={editing.kind}
          item={editing.item}
          employeeId={detail.employee.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            profile.reload();
          }}
        />
      ) : null}
    </div>
  );
}

function ItemDialog({
  kind,
  item,
  employeeId,
  onClose,
  onSaved,
}: {
  kind: Kind;
  item: Record<string, unknown> | null;
  employeeId: string;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      KEYS[kind].map((k) => [
        k,
        item?.[k] == null ? (k === 'degree' ? 'bachelor' : '') : str(item[k]),
      ]),
    ),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function save(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const json = Object.fromEntries(
        Object.entries(draft).map(([k, v]) => [k, v.trim() || null]),
      );
      await api.request({
        path: item
          ? `talent/employees/${encodeURIComponent(employeeId)}/profile/${kind}/${encodeURIComponent(String(item.id))}`
          : `talent/employees/${encodeURIComponent(employeeId)}/profile/${kind}`,
        method: item ? 'PATCH' : 'POST',
        json,
      });
      toast.add({ type: 'success', title: t('talent.profile.saved') });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  const text = (key: string, label: string, type = 'text') => (
    <Field key={key}>
      <FieldLabel htmlFor={`item-${key}`}>{label}</FieldLabel>
      <Input
        id={`item-${key}`}
        type={type}
        value={draft[key]}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t(`talent.profile.${kind}`)}</DialogTitle>
        </DialogHeader>
        <form
          id='profile-item-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            {kind === 'educations' ? (
              <>
                {text('school', t('talent.profile.school'))}
                <Field>
                  <FieldLabel htmlFor='item-degree'>
                    {t('talent.profile.degree')}
                  </FieldLabel>
                  <NativeSelect
                    id='item-degree'
                    value={draft.degree}
                    onChange={(e) => set('degree', e.target.value)}
                  >
                    {DEGREES.map((d) => (
                      <NativeSelectOption key={d} value={d}>
                        {t(`talent.degree.${d}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {text('major', t('talent.profile.major'))}
                <div className='grid grid-cols-2 gap-4'>
                  {text('startDate', t('talent.profile.startDate'), 'date')}
                  {text('endDate', t('talent.profile.endDate'), 'date')}
                </div>
              </>
            ) : kind === 'experiences' ? (
              <>
                {text('company', t('talent.profile.company'))}
                {text('title', t('talent.profile.jobTitle'))}
                <div className='grid grid-cols-2 gap-4'>
                  {text('startDate', t('talent.profile.startDate'), 'date')}
                  {text('endDate', t('talent.profile.endDate'), 'date')}
                </div>
                <Field>
                  <FieldLabel htmlFor='item-description'>
                    {t('talent.profile.descriptionLabel')}
                  </FieldLabel>
                  <Textarea
                    id='item-description'
                    value={draft.description}
                    onChange={(e) => set('description', e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <>
                {text('name', t('talent.profile.contactName'))}
                {text('relation', t('talent.profile.relation'))}
                {text('phone', t('talent.profile.phone'))}
              </>
            )}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='profile-item-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Attachments({
  employeeId,
  profile,
  onChanged,
}: {
  employeeId: string;
  profile: EmployeeProfile;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const files = useService(clientFileRepositoryManagerToken);
  const [category, setCategory] = useState<string>('other');
  const [uploading, setUploading] = useState(false);
  async function upload(file: File): Promise<void> {
    setUploading(true);
    try {
      const { record } = await files.repository('hrFiles').uploadOne({ file });
      await api.request({
        path: `talent/employees/${encodeURIComponent(employeeId)}/profile/attachments`,
        method: 'POST',
        json: { fileId: String(record.id), category, title: file.name },
      });
      toast.add({ type: 'success', title: t('talent.profile.uploaded') });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setUploading(false);
    }
  }
  async function remove(id: string): Promise<void> {
    try {
      await api.request({
        path: `talent/employees/${encodeURIComponent(employeeId)}/profile/attachments/${encodeURIComponent(id)}`,
        method: 'DELETE',
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <CardTitle>{t('talent.profile.attachments')}</CardTitle>
        {profile.can.manage ? (
          <div className='flex items-center gap-2'>
            <NativeSelect
              aria-label={t('talent.profile.category')}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {ATTACHMENT_CATEGORIES.map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {t(`talent.attachmentCategory.${c}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              type='file'
              className='max-w-56'
              aria-label={t('talent.profile.upload')}
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = '';
              }}
            />
            {uploading ? <Spinner /> : null}
          </div>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-2'>
        {profile.attachments.length ? (
          profile.attachments.map((item) => {
            const file = item.file;
            const href = file
              ? resolveAppUrl(
                  `/uploads/hr-files/${String(file.id)}${file.ext ? `.${str(file.ext).replace(/^\./u, '')}` : ''}`,
                )
              : undefined;
            return (
              <div
                key={String(item.id)}
                className='flex items-center justify-between gap-3 text-sm'
              >
                <a
                  className='inline-flex min-w-0 items-center gap-2 hover:underline'
                  href={href}
                  target='_blank'
                  rel='noreferrer'
                >
                  <FileIcon className='size-4 shrink-0 text-muted-foreground' />
                  <span className='truncate'>
                    {str(item.title ?? file?.filename ?? '')}
                  </span>
                  <span className='text-muted-foreground'>
                    · {t(`talent.attachmentCategory.${String(item.category)}`)}
                  </span>
                </a>
                {profile.can.manage ? (
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    aria-label={t('talent.common.remove')}
                    onClick={() => void remove(String(item.id))}
                  >
                    <Trash2Icon />
                  </Button>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('talent.common.none')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** 界面追加字段 with the detail placement; a deactivated field still shows a stored value. */
function CustomFieldsCard({
  values,
  sensitive,
}: {
  values: CustomValues | undefined;
  /** Whether the viewer may read this record's sensitive fields; hidden ones are not listed at all. */
  sensitive: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const { definitions } = useCustomFieldDefinitions(
    'employees',
    'detail',
    true,
  );
  const shown = definitions.filter(
    (d) => (sensitive || !d.sensitive) && (d.active || values?.[d.key] != null),
  );
  if (!shown.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('customFields.sectionTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <CustomFieldValues definitions={shown} values={values} />
      </CardContent>
    </Card>
  );
}

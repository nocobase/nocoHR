import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useState, type ReactElement } from 'react';

import { ChainSteps } from '@/components/talent/chain-steps';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton } from '@/components/talent/states';
import type { ApprovalStep } from '@/components/talent/types';
import type { DepartmentOption } from '@/components/talent/use-lookups';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

import { ReloadConfirm } from './reload-confirm.js';
import {
  ACTION_TYPES,
  SELF_SERVICE_FIELDS,
  type ActionType,
  type Settings,
  type SettingsOptions,
  type Snapshot,
} from './types.js';
import { useSection } from './use-section.js';

export function CardShell({
  section,
  error,
  children,
  footer,
}: {
  readonly section: string;
  readonly error: string | null;
  readonly children: ReactElement | ReactElement[];
  readonly footer?: ReactElement;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`personnelSettings.${section}.title`)}</CardTitle>
        <CardDescription>
          {t(`personnelSettings.${section}.description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </CardContent>
      {footer ? (
        <CardFooter className='justify-end gap-2'>{footer}</CardFooter>
      ) : null}
    </Card>
  );
}

/** The footer every saved Card shares: reload after a conflict, then save. */
export function SaveFooter({
  section,
  dirty,
  onSave,
  onReloaded,
}: {
  readonly section: ReturnType<typeof useSection>;
  readonly dirty: boolean;
  readonly onSave: () => void;
  readonly onReloaded: (value: unknown) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      {section.conflict ? (
        <Button
          type='button'
          variant='outline'
          disabled={section.busy}
          onClick={() => setConfirm(true)}
        >
          {t('personnelSettings.reload')}
        </Button>
      ) : null}
      <Button
        type='button'
        variant='outline'
        disabled={section.busy || section.conflict || !dirty}
        onClick={onSave}
      >
        {section.saving ? <Spinner data-icon='inline-start' /> : null}
        {t(section.saving ? 'personnelSettings.saving' : 'actions.save')}
      </Button>
      <ReloadConfirm
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={async () => {
          setConfirm(false);
          const next = await section.reload();
          if (next) onReloaded(next.value);
        }}
      />
    </>
  );
}

/** 员工自助: which of the six fields employees may ask to change. */
export function SelfServiceCard({
  initial,
}: {
  readonly initial: Snapshot<Settings['selfService']>;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('selfService', initial);
  const [fields, setFields] = useState(initial.value.fields);
  const dirty =
    [...fields].sort().join() !==
    [...section.snapshot.value.fields].sort().join();
  return (
    <CardShell
      section='selfService'
      error={section.error}
      footer={
        <SaveFooter
          section={section as ReturnType<typeof useSection>}
          dirty={dirty}
          onSave={() =>
            void section.save({
              // Keep the documented order whatever the click order was.
              fields: SELF_SERVICE_FIELDS.filter((f) => fields.includes(f)),
            })
          }
          onReloaded={(value) =>
            setFields((value as Settings['selfService']).fields)
          }
        />
      }
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        {SELF_SERVICE_FIELDS.map((field) => (
          <div key={field} className='flex items-center gap-2'>
            <Checkbox
              id={`self-service-${field}`}
              checked={fields.includes(field)}
              disabled={section.busy}
              onCheckedChange={(checked) =>
                setFields((current) =>
                  checked === true
                    ? [...current, field]
                    : current.filter((f) => f !== field),
                )
              }
            />
            <Label htmlFor={`self-service-${field}`}>
              {t(`talent.changes.fields.${field}`)}
            </Label>
          </div>
        ))}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t('personnelSettings.selfService.note')}
      </p>
    </CardShell>
  );
}

function gradesOf(text: string): string[] {
  return text
    .split(/[,，<＜]/u)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** 职级顺序: per job family, the grades from lowest to highest, for telling a promotion from a transfer. */
export function GradeOrderCard({
  initial,
  options,
}: {
  readonly initial: Snapshot<Settings['gradeOrder']>;
  readonly options: SettingsOptions;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('gradeOrder', initial);
  const families = options.jobFamilies.filter(
    (f) => f.active || initial.value.families[f.id],
  );
  const textOf = (value: Settings['gradeOrder']) =>
    Object.fromEntries(
      families.map((f) => [
        f.id,
        (value.families[f.id] ?? f.grades).join(', '),
      ]),
    );
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    textOf(initial.value),
  );
  const invalid = Object.fromEntries(
    Object.entries(draft).map(([id, text]) => {
      const grades = gradesOf(text);
      return [
        id,
        grades.some((g) => g.length > 32) ||
          new Set(grades).size !== grades.length,
      ];
    }),
  );
  const saved = textOf(section.snapshot.value);
  const dirty = families.some((f) => draft[f.id] !== saved[f.id]);
  return (
    <CardShell
      section='gradeOrder'
      error={section.error}
      footer={
        <SaveFooter
          section={section as ReturnType<typeof useSection>}
          dirty={dirty && !Object.values(invalid).some(Boolean)}
          onSave={() =>
            void section.save({
              families: Object.fromEntries(
                families
                  .map((f) => [f.id, gradesOf(draft[f.id] ?? '')] as const)
                  .filter(([, grades]) => grades.length > 0),
              ),
            })
          }
          onReloaded={(value) =>
            setDraft(textOf(value as Settings['gradeOrder']))
          }
        />
      }
    >
      {families.length ? (
        <FieldGroup>
          {families.map((family) => (
            <Field key={family.id} data-invalid={invalid[family.id]}>
              <FieldLabel htmlFor={`grade-${family.id}`}>
                {family.title}
              </FieldLabel>
              <Input
                id={`grade-${family.id}`}
                value={draft[family.id] ?? ''}
                disabled={section.busy}
                placeholder={t('personnelSettings.gradeOrder.placeholder')}
                aria-invalid={invalid[family.id]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [family.id]: e.target.value }))
                }
              />
              {invalid[family.id] ? (
                <FieldError>
                  {t('personnelSettings.gradeOrder.invalid')}
                </FieldError>
              ) : null}
            </Field>
          ))}
        </FieldGroup>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('personnelSettings.gradeOrder.none')}
        </p>
      )}
    </CardShell>
  );
}

/** 任职信息: two switches, each saved as soon as it is flipped. */
export function JobInfoCard({
  initial,
}: {
  readonly initial: Snapshot<Settings['jobInfo']>;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('jobInfo', initial);
  const value = section.snapshot.value;
  async function flip(key: keyof Settings['jobInfo'], checked: boolean) {
    // Both switches share one revision: while one saves, neither can be flipped.
    const saved = await section.save({ ...value, [key]: checked });
    if (!saved)
      toast.add({
        type: 'error',
        title: t('personnelSettings.failed'),
      });
  }
  return (
    <CardShell
      section='jobInfo'
      error={section.conflict ? section.error : null}
    >
      {(['importMayChangeJob', 'allowCorrection'] as const).map((key) => (
        <div key={key} className='flex items-start justify-between gap-4'>
          <div className='space-y-1'>
            <Label htmlFor={`job-info-${key}`}>
              {t(`personnelSettings.jobInfo.${key}`)}
            </Label>
            <p className='text-sm text-muted-foreground'>
              {t(`personnelSettings.jobInfo.${key}Description`)}
            </p>
          </div>
          <Switch
            id={`job-info-${key}`}
            checked={value[key]}
            disabled={section.busy}
            onCheckedChange={(checked) => void flip(key, checked)}
          />
        </div>
      ))}
    </CardShell>
  );
}

const REVIEW_LIMITS = {
  reviewNoticeDays: 180,
  overdueIntervalDays: 60,
  defaultReviewMonths: 60,
} as const;
type ReviewKey = keyof typeof REVIEW_LIMITS;

/** 制度复核 (V1-04): when review reminders start, how often overdue ones repeat, and the default review cycle. */
export function KnowledgeReviewCard({
  initial,
}: {
  readonly initial: Snapshot<Settings['knowledge']>;
}): ReactElement {
  const { t } = useTranslation();
  const section = useSection('knowledge', initial);
  const textOf = (value: Settings['knowledge']) =>
    Object.fromEntries(
      (Object.keys(REVIEW_LIMITS) as ReviewKey[]).map((key) => [
        key,
        String(value[key]),
      ]),
    ) as Record<ReviewKey, string>;
  const [draft, setDraft] = useState(() => textOf(initial.value));
  const invalid = Object.fromEntries(
    (Object.keys(REVIEW_LIMITS) as ReviewKey[]).map((key) => {
      const text = draft[key].trim();
      return [
        key,
        !/^\d+$/u.test(text) ||
          Number(text) < 1 ||
          Number(text) > REVIEW_LIMITS[key],
      ];
    }),
  ) as Record<ReviewKey, boolean>;
  const saved = textOf(section.snapshot.value);
  const dirty = (Object.keys(REVIEW_LIMITS) as ReviewKey[]).some(
    (key) => draft[key].trim() !== saved[key],
  );
  return (
    <CardShell
      section='knowledge'
      error={section.error}
      footer={
        <SaveFooter
          section={section as ReturnType<typeof useSection>}
          dirty={dirty && !Object.values(invalid).some(Boolean)}
          onSave={() =>
            void section.save({
              reviewNoticeDays: Number(draft.reviewNoticeDays),
              overdueIntervalDays: Number(draft.overdueIntervalDays),
              defaultReviewMonths: Number(draft.defaultReviewMonths),
            })
          }
          onReloaded={(value) =>
            setDraft(textOf(value as Settings['knowledge']))
          }
        />
      }
    >
      <FieldGroup>
        {(Object.keys(REVIEW_LIMITS) as ReviewKey[]).map((key) => (
          <Field key={key} data-invalid={invalid[key]}>
            <FieldLabel htmlFor={`knowledge-${key}`}>
              {t(`personnelSettings.knowledge.${key}`)} *
            </FieldLabel>
            <Input
              id={`knowledge-${key}`}
              inputMode='numeric'
              className='w-32'
              value={draft[key]}
              disabled={section.busy}
              aria-required='true'
              aria-invalid={invalid[key]}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [key]: e.target.value }))
              }
            />
            {invalid[key] ? (
              <FieldError>
                {t('personnelSettings.knowledge.invalid', {
                  max: REVIEW_LIMITS[key],
                })}
              </FieldError>
            ) : null}
          </Field>
        ))}
      </FieldGroup>
    </CardShell>
  );
}

/** 审批链预览: the chain a new action for a department would get under the saved configuration. */
export function ChainPreviewCard({
  departments,
  dirtyChain,
  departmentTitle,
  revision,
}: {
  readonly departments: readonly DepartmentOption[];
  readonly dirtyChain: boolean;
  readonly departmentTitle: (id: string | null | undefined) => string;
  /** Changes after each save of the chain, so the preview reloads. */
  readonly revision: number;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [departmentId, setDepartmentId] = useState('');
  const [actionType, setActionType] = useState<ActionType>('onboard');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    steps?: ApprovalStep[];
    error?: unknown;
  }>();
  const key = `${departmentId}|${actionType}|${revision}|${attempt}`;
  useEffect(() => {
    if (!departmentId) return;
    const controller = new AbortController();
    api
      .request<{ data: ApprovalStep[] }>({
        path: 'talent/personnel-settings/chain-preview',
        method: 'POST',
        json: { departmentId, actionType },
        signal: controller.signal,
      })
      .then(
        (response) => {
          if (!controller.signal.aborted)
            setResult({ key, steps: response.data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({ ...previous, key, error }));
        },
      );
    return () => controller.abort();
  }, [api, departmentId, actionType, key]);
  const loading = Boolean(departmentId) && result?.key !== key;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          {t('personnelSettings.preview.title')}
          {loading && result?.steps ? <Spinner /> : null}
        </CardTitle>
        <CardDescription>
          {t('personnelSettings.preview.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field>
            <FieldLabel htmlFor='preview-department'>
              {t('personnelSettings.ruleDepartment')}
            </FieldLabel>
            <NativeSelect
              id='preview-department'
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {departments
                .filter((d) => d.active)
                .map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {'　'.repeat(d.depth)}
                    {d.label}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='preview-type'>
              {t('personnelSettings.preview.actionType')}
            </FieldLabel>
            <NativeSelect
              id='preview-type'
              value={actionType}
              onChange={(e) => setActionType(e.target.value as ActionType)}
            >
              {ACTION_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {t(`talent.actionType.${type}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {dirtyChain ? (
          <p className='text-sm text-muted-foreground'>
            {t('personnelSettings.preview.savedOnly')}
          </p>
        ) : null}
        {!departmentId ? (
          <p className='text-sm text-muted-foreground'>
            {t('personnelSettings.preview.idle')}
          </p>
        ) : result?.error && !loading ? (
          <Alert variant='destructive'>
            <AlertDescription>{errorMessage(result.error, t)}</AlertDescription>
            <AlertAction>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setAttempt((n) => n + 1)}
              >
                {t('status.retry')}
              </Button>
            </AlertAction>
          </Alert>
        ) : result?.steps ? (
          <ChainSteps steps={result.steps} departmentTitle={departmentTitle} />
        ) : (
          <BlockSkeleton rows={3} />
        )}
      </CardContent>
    </Card>
  );
}

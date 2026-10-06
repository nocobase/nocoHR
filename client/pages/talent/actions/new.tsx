import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { CategoryBadge } from '@/components/talent/badges';
import { CustomFieldInputs } from '@/components/talent/custom-fields';
import {
  compactValues,
  customFieldErrors,
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import {
  errorCode,
  errorDetails,
  errorMessage,
} from '@/components/talent/errors';
import type { EmployeeListItem } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useRouteOverlay } from '@/components/use-route-overlay';

import { EMPLOYMENT_TYPES, LEAVE_REASONS } from '../employees/types.js';
import { ActionChainPreview } from './chain-preview.js';
import { ACTION_TYPES, type ActionsOutletContext } from './types.js';

const FORM_ID = 'action-new-form';
/** The same shape the server checks for the contact address after leaving. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** What `talent/org-sync/issues/prefill` answers with (V1-03). */
interface IssuePrefill {
  readonly issueKey: string;
  readonly actionType: string;
  readonly effectiveDate?: string;
  readonly employeeId?: string | null;
  readonly name?: string;
  readonly employeeNo?: string;
  readonly email?: string;
  readonly mobile?: string;
  readonly toDepartmentId?: string | null;
  readonly toPositionId?: string | null;
  readonly createAccount?: boolean;
  readonly externalProvider?: string | null;
  readonly externalUserId?: string | null;
  readonly leaveReason?: string | null;
}

interface FrameworkLite {
  requirements: {
    positionId: string;
    competencyId: string;
    requiredLevel: number;
    mandatory: boolean;
    reviewStatus: string;
  }[];
  competencies: { id: string; title: string; category: string }[];
}

/** Route `/talent/actions/new`: raise onboarding, regularization, transfer, promotion or offboarding. */
export default function NewActionPage(): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef(false);
  return (
    <RouteDialog
      title={t('talent.actions.create')}
      description={t('talent.actions.createDescription')}
      className='sm:max-w-2xl'
      beforeClose={() => !ref.current}
      footer={<Footer submitting={submitting} />}
    >
      <ActionForm
        onSubmittingChange={(value) => {
          ref.current = value;
          setSubmitting(value);
        }}
      />
    </RouteDialog>
  );
}

function ActionForm({
  onSubmittingChange,
}: {
  onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const { reload } = useOutletContext<ActionsOutletContext>();
  const lookups = useLookups();
  const employees = useRemote<{ items: EmployeeListItem[] }>(
    'talent/employees',
  );
  const framework = useRemote<FrameworkLite>('talent/framework');
  // Links from the HR assistant's probation preparation pre-fill the form: ?type=regularize&employeeId=…
  const [params, setParams] = useSearchParams();
  const [prefill] = useState(() => {
    const presetType = params.get('type');
    return {
      actionType:
        presetType && (ACTION_TYPES as readonly string[]).includes(presetType)
          ? presetType
          : null,
      employeeId: params.get('employeeId'),
      // V3-10 任职资格材料 links a promotion with its target: &toPositionId=…(&toDepartmentId=…).
      toPositionId: params.get('toPositionId'),
      toDepartmentId: params.get('toDepartmentId'),
      // V1-03: a pending item of 组织同步 raises this action, pre-filled from the office suite.
      fromIssue: params.get('fromIssue'),
    };
  });
  useEffect(() => {
    // Read once, then drop them, so a refresh or a later visit starts clean.
    if (
      params.has('type') ||
      params.has('employeeId') ||
      params.has('toPositionId') ||
      params.has('toDepartmentId') ||
      params.has('fromIssue')
    )
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('type');
          next.delete('employeeId');
          next.delete('toPositionId');
          next.delete('toDepartmentId');
          next.delete('fromIssue');
          return next;
        },
        { replace: true },
      );
  }, [params, setParams]);
  const [draft, setDraft] = useState<Record<string, string>>(() => ({
    actionType: prefill.actionType ?? 'transfer',
    effectiveDate: new Date().toISOString().slice(0, 10),
    employmentType: 'fullTime',
    probationMonths: '3',
    leaveReason: 'resign',
    ...(prefill.employeeId ? { employeeId: prefill.employeeId } : {}),
    ...(prefill.toPositionId ? { toPositionId: prefill.toPositionId } : {}),
    ...(prefill.toDepartmentId
      ? { toDepartmentId: prefill.toDepartmentId }
      : {}),
  }));
  const [positionError, setPositionError] = useState<string>();
  const [leaveReasonError, setLeaveReasonError] = useState<string>();
  const [personalEmailError, setPersonalEmailError] = useState<string>();
  const [createAccount, setCreateAccount] = useState(false);
  // 界面追加字段 placed on the onboarding form (工服尺码, 宿舍号…).
  const { definitions: onboardFields } = useCustomFieldDefinitions(
    'employees',
    'onboardForm',
  );
  const [custom, setCustom] = useState<CustomValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [sync, setSync] = useState<{
    issueKey: string;
    externalUserId?: string;
    externalProvider?: string;
  } | null>(null);
  const [prefilling, setPrefilling] = useState(Boolean(prefill.fromIssue));
  useEffect(() => {
    const key = prefill.fromIssue;
    if (!key) return;
    let cancelled = false;
    api
      .request<{ data: IssuePrefill }>({
        path: 'talent/org-sync/issues/prefill',
        method: 'POST',
        json: { key },
      })
      .then(({ data }) => {
        if (cancelled) return;
        // 调岗 or 晋升: the page's other button overrides the suggestion.
        const actionType =
          prefill.actionType &&
          (prefill.actionType === 'transfer' ||
            prefill.actionType === 'promote') &&
          (data.actionType === 'transfer' || data.actionType === 'promote')
            ? prefill.actionType
            : data.actionType;
        const fields: Record<string, string> = { actionType };
        for (const name of [
          'effectiveDate',
          'employeeId',
          'name',
          'employeeNo',
          'email',
          'mobile',
          'toDepartmentId',
          'toPositionId',
        ] as const) {
          const value = data[name];
          if (typeof value === 'string') fields[name] = value;
        }
        if (data.actionType === 'offboard')
          fields.leaveReason = data.leaveReason ?? '';
        setDraft((d) => ({ ...d, ...fields }));
        if (data.createAccount) setCreateAccount(true);
        setSync({
          issueKey: data.issueKey,
          ...(data.actionType === 'onboard'
            ? {
                externalUserId: data.externalUserId ?? undefined,
                externalProvider: data.externalProvider ?? undefined,
              }
            : {}),
        });
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(errorMessage(cause, t));
      })
      .finally(() => {
        if (!cancelled) setPrefilling(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, prefill.fromIssue, prefill.actionType, t]);
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const type = draft.actionType;
  const employee = employees.data?.items.find((e) => e.id === draft.employeeId);
  const candidates = (employees.data?.items ?? []).filter(
    (e) =>
      e.status !== 'leave' &&
      (type !== 'regularize' || e.status === 'probation'),
  );
  // A pre-filled employee who has left, finished probation or is out of scope.
  const stalePrefill =
    Boolean(prefill.employeeId) &&
    draft.employeeId === prefill.employeeId &&
    Boolean(employees.data) &&
    !candidates.some((e) => e.id === prefill.employeeId);
  const previewRequest: Record<string, unknown> | null =
    type === 'onboard'
      ? draft.toDepartmentId
        ? { actionType: type, departmentId: draft.toDepartmentId }
        : null
      : draft.employeeId && !stalePrefill
        ? {
            actionType: type,
            employeeId: draft.employeeId,
            ...(draft.toDepartmentId
              ? { toDepartmentId: draft.toDepartmentId }
              : {}),
          }
        : null;

  // For a transfer or promotion, show the target position's mandatory requirements against the employee's current levels.
  const targetGap = useRemote<{
    rows: { competencyId: string; currentLevel: number }[];
  }>(
    employee && (type === 'transfer' || type === 'promote')
      ? `talent/employees/${encodeURIComponent(employee.id)}/gaps`
      : null,
  );
  const requirements = useMemo(() => {
    if (!framework.data || !draft.toPositionId) return [];
    const levels = new Map(
      (targetGap.data?.rows ?? []).map((r) => [r.competencyId, r.currentLevel]),
    );
    return framework.data.requirements
      .filter(
        (r) =>
          r.positionId === draft.toPositionId &&
          r.mandatory &&
          r.reviewStatus === 'confirmed',
      )
      .map((r) => {
        const competency = framework.data!.competencies.find(
          (c) => c.id === r.competencyId,
        );
        const current = levels.get(r.competencyId) ?? 0;
        return {
          ...r,
          title: competency?.title ?? r.competencyId,
          category: competency?.category ?? 'skill',
          current,
          gap: Math.max(r.requiredLevel - current, 0),
        };
      });
  }, [framework.data, draft.toPositionId, targetGap.data]);

  async function submit(): Promise<void> {
    if (type === 'offboard' && !draft.leaveReason) {
      setLeaveReasonError(t('talent.actions.leaveReasonRequired'));
      document.getElementById('action-leave')?.focus();
      return;
    }
    if (
      type === 'offboard' &&
      draft.personalEmail?.trim() &&
      !EMAIL.test(draft.personalEmail.trim())
    ) {
      setPersonalEmailError(t('talent.errors.ACTION_PERSONAL_EMAIL_INVALID'));
      document.getElementById('action-personal-email')?.focus();
      return;
    }
    const json: Record<string, unknown> = {
      actionType: type,
      effectiveDate: draft.effectiveDate,
      reason: draft.reason?.trim() || null,
    };
    if (sync) {
      json.syncIssueKey = sync.issueKey;
      if (type === 'onboard' && sync.externalUserId)
        Object.assign(json, {
          externalUserId: sync.externalUserId,
          externalProvider: sync.externalProvider,
        });
    }
    if (type === 'onboard') {
      Object.assign(json, {
        name: draft.name,
        employeeNo: draft.employeeNo,
        mobile: draft.mobile || null,
        email: draft.email || null,
        toDepartmentId: draft.toDepartmentId,
        toPositionId: draft.toPositionId,
        employmentType: draft.employmentType,
        probationMonths: Number(draft.probationMonths || 0),
        createAccount,
        ...(onboardFields.length
          ? { customFields: compactValues(custom) }
          : {}),
      });
    } else {
      Object.assign(json, { employeeId: draft.employeeId });
      if (type === 'transfer' || type === 'promote')
        Object.assign(json, {
          toDepartmentId: draft.toDepartmentId || null,
          toPositionId: draft.toPositionId,
        });
      if (type === 'offboard') {
        Object.assign(json, { leaveReason: draft.leaveReason });
        // V1-02 V2 增补: optional; sent only when given.
        const personalEmail = draft.personalEmail?.trim();
        if (personalEmail) json.personalEmail = personalEmail;
      }
    }
    onSubmittingChange(true);
    setError(undefined);
    setPositionError(undefined);
    try {
      const { data } = await api.request<{ data: { id: string } }>({
        path: 'talent/actions',
        method: 'POST',
        json,
      });
      toast.add({ type: 'success', title: t('talent.actions.created') });
      onSubmittingChange(false);
      reload();
      void navigate(`../${data.id}`, { replace: true });
    } catch (cause) {
      // A promotion to a position that is not higher in the family: shown under the target position.
      if (errorCode(cause) === 'ACTION_PROMOTE_NOT_HIGHER')
        setPositionError(errorMessage(cause, t));
      else if (errorCode(cause) === 'ACTION_PERSONAL_EMAIL_INVALID')
        setPersonalEmailError(errorMessage(cause, t));
      else if (errorCode(cause) === 'CUSTOM_FIELD_INVALID') {
        setCustomErrors(customFieldErrors(errorDetails(cause)));
        setError(errorMessage(cause, t));
      } else setError(errorMessage(cause, t));
      onSubmittingChange(false);
    }
  }

  const departmentSelect = (label: string, optional: boolean) => (
    <Field>
      <FieldLabel htmlFor='action-dept'>{label}</FieldLabel>
      <NativeSelect
        id='action-dept'
        value={draft.toDepartmentId ?? ''}
        onChange={(e) => set('toDepartmentId', e.target.value)}
      >
        <NativeSelectOption value=''>
          {optional
            ? t('talent.actions.keepDepartment')
            : t('talent.common.choose')}
        </NativeSelectOption>
        {lookups.departments
          .filter((d) => d.active)
          .map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {'  '.repeat(d.depth)}
              {d.label}
            </NativeSelectOption>
          ))}
      </NativeSelect>
    </Field>
  );
  const positionSelect = (
    <Field data-invalid={Boolean(positionError)}>
      <FieldLabel htmlFor='action-position'>
        {t('talent.actions.targetPosition')}
      </FieldLabel>
      <NativeSelect
        id='action-position'
        value={draft.toPositionId ?? ''}
        aria-invalid={Boolean(positionError)}
        onChange={(e) => {
          setPositionError(undefined);
          set('toPositionId', e.target.value);
        }}
      >
        <NativeSelectOption value=''>
          {t('talent.common.choose')}
        </NativeSelectOption>
        {lookups.positions
          .filter((p) => p.active)
          .map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.title}
            </NativeSelectOption>
          ))}
      </NativeSelect>
      {positionError ? <FieldError>{positionError}</FieldError> : null}
    </Field>
  );

  return (
    <form
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!prefilling) void submit();
      }}
    >
      <FieldGroup>
        {prefill.fromIssue ? (
          <p
            className='flex items-center gap-2 text-sm text-muted-foreground'
            role='status'
          >
            {prefilling ? <Spinner /> : null}
            {t(
              prefilling
                ? 'talent.actions.prefillingFromSync'
                : 'talent.actions.prefilledFromSync',
            )}
          </p>
        ) : null}
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field>
            <FieldLabel htmlFor='action-type'>
              {t('talent.actions.type')}
            </FieldLabel>
            <NativeSelect
              id='action-type'
              value={type}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  actionType: e.target.value,
                  employeeId: '',
                  toDepartmentId: '',
                  toPositionId: '',
                }))
              }
            >
              {ACTION_TYPES.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {t(`talent.actionType.${v}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='action-date'>
              {type === 'onboard'
                ? t('talent.fields.hireDate')
                : type === 'offboard'
                  ? t('talent.fields.leaveDate')
                  : type === 'regularize'
                    ? t('talent.fields.regularizedAt')
                    : t('talent.actions.effectiveDate')}
            </FieldLabel>
            <Input
              id='action-date'
              type='date'
              value={draft.effectiveDate}
              onChange={(e) => set('effectiveDate', e.target.value)}
            />
          </Field>
        </div>

        {type === 'onboard' ? (
          <>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='action-name'>
                  {t('talent.fields.name')}
                </FieldLabel>
                <Input
                  id='action-name'
                  value={draft.name ?? ''}
                  onChange={(e) => set('name', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='action-no'>
                  {t('talent.fields.employeeNo')}
                </FieldLabel>
                <Input
                  id='action-no'
                  value={draft.employeeNo ?? ''}
                  onChange={(e) => set('employeeNo', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='action-mobile'>
                  {t('talent.fields.mobile')}
                </FieldLabel>
                <Input
                  id='action-mobile'
                  value={draft.mobile ?? ''}
                  onChange={(e) => set('mobile', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='action-email'>
                  {t('talent.fields.email')}
                </FieldLabel>
                <Input
                  id='action-email'
                  type='email'
                  value={draft.email ?? ''}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              {departmentSelect(t('talent.actions.targetDepartment'), false)}
              {positionSelect}
              <Field>
                <FieldLabel htmlFor='action-emptype'>
                  {t('talent.fields.employmentType')}
                </FieldLabel>
                <NativeSelect
                  id='action-emptype'
                  value={draft.employmentType}
                  onChange={(e) => set('employmentType', e.target.value)}
                >
                  {EMPLOYMENT_TYPES.map((v) => (
                    <NativeSelectOption key={v} value={v}>
                      {t(`talent.employmentType.${v}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='action-probation'>
                  {t('talent.actions.probationMonths')}
                </FieldLabel>
                <NativeSelect
                  id='action-probation'
                  value={draft.probationMonths}
                  onChange={(e) => set('probationMonths', e.target.value)}
                >
                  {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                    <NativeSelectOption key={n} value={String(n)}>
                      {n}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field orientation='horizontal'>
              <Checkbox
                id='action-account'
                checked={createAccount}
                onCheckedChange={(checked) =>
                  setCreateAccount(checked === true)
                }
              />
              <FieldLabel htmlFor='action-account'>
                {t('talent.actions.createAccount')}
              </FieldLabel>
            </Field>
            {createAccount ? (
              <FieldDescription>
                {t('talent.actions.createAccountHint')}
              </FieldDescription>
            ) : null}
            {onboardFields.length ? (
              <div className='grid gap-4 sm:grid-cols-2'>
                <CustomFieldInputs
                  definitions={onboardFields}
                  values={custom}
                  onChange={(next) => {
                    setCustom(next);
                    setCustomErrors({});
                  }}
                  errors={customErrors}
                  idPrefix='action-cf'
                />
              </div>
            ) : null}
          </>
        ) : (
          <Field>
            <FieldLabel htmlFor='action-employee'>
              {type === 'regularize'
                ? t('talent.actions.probationEmployee')
                : t('talent.actions.employee')}
            </FieldLabel>
            <NativeSelect
              id='action-employee'
              value={draft.employeeId ?? ''}
              onChange={(e) => set('employeeId', e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {candidates.map((e) => (
                <NativeSelectOption key={e.id} value={e.id}>
                  {e.name} ({e.employeeNo}) ·{' '}
                  {lookups.departmentTitle(e.departmentId)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {stalePrefill ? (
              <FieldError>{t('talent.actions.prefillStale')}</FieldError>
            ) : null}
          </Field>
        )}

        {type === 'transfer' || type === 'promote' ? (
          <div className='grid gap-4 sm:grid-cols-2'>
            {departmentSelect(
              t('talent.actions.targetDepartment'),
              type === 'promote',
            )}
            {positionSelect}
          </div>
        ) : null}

        {(type === 'transfer' || type === 'promote') &&
        employee &&
        draft.toPositionId ? (
          <div className='rounded-md border bg-muted/30 p-3 text-sm'>
            <p className='mb-2 font-medium'>
              {t('talent.actions.targetRequirements')}
            </p>
            {requirements.length ? (
              <ul className='space-y-1'>
                {requirements.map((r) => (
                  <li
                    key={r.competencyId}
                    className='flex items-center justify-between gap-2'
                  >
                    <span className='flex items-center gap-2'>
                      <CategoryBadge category={r.category} />
                      {r.title}
                    </span>
                    <span
                      className={
                        r.gap > 0
                          ? 'font-medium text-destructive'
                          : 'text-muted-foreground'
                      }
                    >
                      {t('talent.actions.requirementGap', {
                        required: r.requiredLevel,
                        current: r.current,
                        gap: r.gap,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className='text-muted-foreground'>
                {t('talent.actions.noTargetRequirements')}
              </p>
            )}
          </div>
        ) : null}

        {type === 'offboard' ? (
          <Field data-invalid={Boolean(leaveReasonError)}>
            <FieldLabel htmlFor='action-leave'>
              {t('talent.fields.leaveReason')} *
            </FieldLabel>
            <NativeSelect
              id='action-leave'
              value={draft.leaveReason}
              aria-invalid={Boolean(leaveReasonError)}
              onChange={(e) => {
                setLeaveReasonError(undefined);
                set('leaveReason', e.target.value);
              }}
            >
              {draft.leaveReason ? null : (
                <NativeSelectOption value=''>
                  {t('talent.common.choose')}
                </NativeSelectOption>
              )}
              {LEAVE_REASONS.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {t(`talent.leaveReason.${r}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {leaveReasonError ? (
              <FieldError>{leaveReasonError}</FieldError>
            ) : null}
          </Field>
        ) : null}
        {type === 'offboard' ? (
          <Field data-invalid={Boolean(personalEmailError)}>
            <FieldLabel htmlFor='action-personal-email'>
              {t('talent.fields.personalEmail')}
            </FieldLabel>
            <Input
              id='action-personal-email'
              type='email'
              value={draft.personalEmail ?? ''}
              maxLength={320}
              aria-invalid={Boolean(personalEmailError)}
              onChange={(e) => {
                setPersonalEmailError(undefined);
                set('personalEmail', e.target.value);
              }}
            />
            <FieldDescription>
              {t('talent.actions.personalEmailHint')}
            </FieldDescription>
            {personalEmailError ? (
              <FieldError>{personalEmailError}</FieldError>
            ) : null}
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor='action-reason'>
            {type === 'regularize'
              ? t('talent.actions.evaluation')
              : type === 'offboard'
                ? t('talent.actions.notes')
                : t('talent.actions.reason')}
          </FieldLabel>
          <Textarea
            id='action-reason'
            value={draft.reason ?? ''}
            onChange={(e) => set('reason', e.target.value)}
          />
        </Field>
        <ActionChainPreview
          request={previewRequest}
          departmentTitle={lookups.departmentTitle}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </FieldGroup>
    </form>
  );
}

function Footer({ submitting }: { submitting: boolean }): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        variant='outline'
        disabled={submitting}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={FORM_ID} disabled={submitting}>
        {submitting ? <Spinner data-icon='inline-start' /> : null}
        {t('talent.actions.submit')}
      </Button>
    </>
  );
}

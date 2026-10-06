import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  CheckCircle2Icon,
  CircleDotIcon,
  CircleIcon,
  XCircleIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { ActionStatusBadge } from '@/components/talent/badges';
import { ActionChecklist } from '@/components/talent/change-checklist';
import { ActionCompetencyGap } from '@/components/talent/competency-gap-block';
import { CustomFieldValues } from '@/components/talent/custom-fields';
import {
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { PersonnelAction } from '@/components/talent/types';
import { stepTitle } from '@/components/talent/chain-text';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { str } from '@/components/talent/text';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import type { ActionsOutletContext } from './types.js';

/** Route `/talent/actions/:actionId`: the action, its approval timeline, and approve / reject / withdraw. */
export default function ActionDetailPage(): ReactElement {
  const { actionId = '' } = useParams();
  const { t } = useTranslation();
  const action = useRemote<PersonnelAction>(
    `talent/actions/${encodeURIComponent(actionId)}`,
  );
  return (
    <RouteDrawer
      key={actionId}
      title={
        action.data
          ? t(`talent.actionType.${action.data.actionType}`)
          : t('talent.actions.detail')
      }
      description={action.data?.employeeName ?? undefined}
      className='sm:max-w-xl'
    >
      {action.error ? (
        <LoadError error={action.error} onRetry={action.reload} />
      ) : !action.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <ActionBody action={action.data} onChanged={action.reload} />
      )}
    </RouteDrawer>
  );
}

function ActionBody({
  action,
  onChanged,
}: {
  action: PersonnelAction;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const lookups = useLookups();
  const { reload } = useOutletContext<ActionsOutletContext>();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const where = (d: string | null, p: string | null) =>
    [lookups.departmentTitle(d), lookups.positionTitle(p)]
      .filter(Boolean)
      .join(' / ') || '—';

  async function act(kind: 'approve' | 'reject' | 'cancel'): Promise<void> {
    if (kind === 'reject' && !comment.trim()) {
      setError(t('talent.errors.ACTION_REJECT_COMMENT_REQUIRED'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/actions/${encodeURIComponent(action.id)}/${kind}`,
        method: 'POST',
        json: kind === 'cancel' ? {} : { comment: comment.trim() || null },
      });
      toast.add({ type: 'success', title: t(`talent.actions.done.${kind}`) });
      setComment('');
      onChanged();
      reload();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = [
    [t('talent.fields.status'), ''],
    [t('talent.actions.effectiveDate'), action.effectiveDate],
    ...(action.actionType === 'onboard'
      ? ([
          [
            t('talent.fields.employeeNo'),
            str(action.candidate?.employeeNo ?? '—'),
          ],
          [
            t('talent.actions.targetDepartment'),
            where(action.toDepartmentId, null),
          ],
          [
            t('talent.actions.targetPosition'),
            where(null, action.toPositionId),
          ],
          [
            t('talent.fields.employmentType'),
            action.candidate?.employmentType
              ? t(
                  `talent.employmentType.${str(action.candidate.employmentType)}`,
                )
              : '—',
          ],
          [
            t('talent.actions.probationMonths'),
            str(action.candidate?.probationMonths ?? 0),
          ],
          [
            t('talent.actions.createAccount'),
            action.candidate?.createAccount
              ? t('talent.common.yes')
              : t('talent.common.no'),
          ],
        ] as [string, string][])
      : ([
          [
            t('talent.actions.from'),
            where(action.fromDepartmentId, action.fromPositionId),
          ],
          ...(action.toDepartmentId || action.toPositionId
            ? ([
                [
                  t('talent.actions.to'),
                  where(
                    action.toDepartmentId ?? action.fromDepartmentId,
                    action.toPositionId ?? action.fromPositionId,
                  ),
                ],
              ] as [string, string][])
            : []),
          ...(action.leaveReason
            ? ([
                [
                  t('talent.fields.leaveReason'),
                  t(`talent.leaveReason.${action.leaveReason}`),
                ],
              ] as [string, string][])
            : []),
          ...(action.personalEmail
            ? ([[t('talent.fields.personalEmail'), action.personalEmail]] as [
                string,
                string,
              ][])
            : []),
        ] as [string, string][])),
    [t('talent.actions.reason'), action.reason ?? '—'],
    [t('talent.actions.applicant'), action.applicantName ?? '—'],
  ];

  return (
    <div className='space-y-6'>
      <dl className='grid grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm'>
        {rows.map(([label, value], index) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='whitespace-pre-line'>
              {index === 0 ? (
                <ActionStatusBadge status={action.status} />
              ) : (
                value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div>
        <p className='mb-3 text-sm font-medium'>
          {t('talent.actions.timeline')}
        </p>
        <ol className='space-y-3'>
          <li className='flex gap-3 text-sm'>
            <CheckCircle2Icon className='mt-0.5 size-4 shrink-0 text-primary' />
            <div>
              <p>
                {t('talent.actions.submitted', {
                  name: action.applicantName ?? '',
                })}
              </p>
              <p className='text-muted-foreground'>
                {format.format(new Date(action.createdAt))}
              </p>
            </div>
          </li>
          {action.approvals.map((step) => {
            const Icon =
              step.status === 'approved' || step.status === 'auto'
                ? CheckCircle2Icon
                : step.status === 'rejected'
                  ? XCircleIcon
                  : action.status === 'pending' &&
                      step.level === action.currentLevel
                    ? CircleDotIcon
                    : CircleIcon;
            return (
              <li key={step.level} className='flex gap-3 text-sm'>
                <Icon
                  className={`mt-0.5 size-4 shrink-0 ${step.status === 'rejected' ? 'text-destructive' : step.status === 'pending' ? 'text-muted-foreground' : 'text-primary'}`}
                />
                <div>
                  <p>
                    {stepTitle(step, t, lookups.departmentTitle)}
                    <span className='text-muted-foreground'>
                      {' '}
                      · {t(`talent.approvalStatus.${step.status}`)}
                    </span>
                  </p>
                  {step.fallback ? (
                    <p className='text-muted-foreground'>
                      {t(`talent.chain.${step.fallback}`)}
                    </p>
                  ) : null}
                  {step.decidedAt && step.status !== 'pending' ? (
                    <p className='text-muted-foreground'>
                      {format.format(new Date(step.decidedAt))}
                      {step.via
                        ? ` · ${t(`talent.approvalVia.${step.via}`)}`
                        : ''}
                    </p>
                  ) : null}
                  {step.comment ? (
                    <p className='whitespace-pre-line'>{step.comment}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
          {action.status === 'effective' && action.effectiveAt ? (
            <li className='flex gap-3 text-sm'>
              <CheckCircle2Icon className='mt-0.5 size-4 shrink-0 text-primary' />
              <div>
                <p>{t('talent.actions.becameEffective')}</p>
                <p className='text-muted-foreground'>
                  {format.format(new Date(action.effectiveAt))}
                </p>
              </div>
            </li>
          ) : null}
          {action.status === 'cancelled' ? (
            <li className='flex gap-3 text-sm'>
              <XCircleIcon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
              <p>{t('talent.actions.withdrawn')}</p>
            </li>
          ) : null}
        </ol>
      </div>
      {action.actionType === 'onboard' ? (
        <>
          <OfferOrigin candidate={action.candidate} />
          <OnboardCustomFields values={action.candidate?.customFields} />
        </>
      ) : null}
      {/* V3-08: the target position's gap for a transfer or promotion; renders nothing otherwise. */}
      <ActionCompetencyGap actionId={action.id} />
      {['onboard', 'transfer', 'promote', 'offboard'].includes(
        action.actionType,
      ) ? (
        // V1-02 变动影响清单: the approver sees the impact preview, HR the open checklist.
        <ActionChecklist key={action.status} actionId={action.id} />
      ) : null}
      {action.can.approve || action.can.cancel ? (
        <div className='space-y-3 border-t pt-4'>
          {action.can.approve ? (
            <Field>
              <FieldLabel htmlFor='action-comment'>
                {t('talent.actions.comment')}
              </FieldLabel>
              <Textarea
                id='action-comment'
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('talent.actions.commentPlaceholder')}
              />
            </Field>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
          <div className='flex flex-wrap justify-end gap-2'>
            {action.can.cancel ? (
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => void act('cancel')}
              >
                {t('talent.actions.withdraw')}
              </Button>
            ) : null}
            {action.can.approve ? (
              <>
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => void act('reject')}
                >
                  {t('talent.actions.reject')}
                </Button>
                <Button disabled={busy} onClick={() => void act('approve')}>
                  {t('talent.actions.approve')}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Fields an ID can yield, labelled from talent.fields; anything else shows its name. */
const RECOGNIZED_LABELS = new Set([
  'name',
  'idType',
  'idNumber',
  'birthDate',
  'gender',
  'address',
  'mobile',
]);

/** 来自 Offer (V2-07): the accepted offer an onboarding action was raised from, and what the uploaded ID yielded. */
function OfferOrigin({
  candidate,
}: {
  candidate: Record<string, unknown> | null;
}): ReactElement | null {
  const { t } = useTranslation();
  // hr.admin does not see offer details by default; link only for those who may open the page.
  const offers = useCan({
    resource: { type: 'page', id: 'talent.offers' },
    action: 'access',
  });
  const offerId =
    typeof candidate?.offerId === 'string' ? candidate.offerId : null;
  if (!offerId) return null;
  const recognized = Array.isArray(candidate?.recognizedFields)
    ? candidate.recognizedFields.filter(
        (f): f is string => typeof f === 'string',
      )
    : [];
  return (
    <section className='space-y-1 rounded-md border p-3 text-sm'>
      <p className='font-medium'>
        {t('offerOrigin.fromOffer')}
        {offers.can ? (
          <>
            {' · '}
            <Link
              className='text-primary underline-offset-4 hover:underline'
              to={`/talent/offers/${encodeURIComponent(offerId)}`}
            >
              {t('offerOrigin.open')}
            </Link>
          </>
        ) : null}
      </p>
      {recognized.length ? (
        <>
          <p>
            {t('offerOrigin.recognized', {
              fields: recognized
                .map((f) =>
                  RECOGNIZED_LABELS.has(f) ? t(`talent.fields.${f}`) : f,
                )
                .join('、'),
            })}
          </p>
          <p className='text-muted-foreground'>
            {t('offerOrigin.recognizedHint')}
          </p>
        </>
      ) : null}
    </section>
  );
}

/** 界面追加字段 filled on the onboarding form (工服尺码, 宿舍号…), written to the employee on effect. */
function OnboardCustomFields({
  values,
}: {
  values: unknown;
}): ReactElement | null {
  const { t } = useTranslation();
  const { definitions } = useCustomFieldDefinitions('employees', 'onboardForm');
  if (!definitions.length || !values || typeof values !== 'object') return null;
  return (
    <section className='space-y-2'>
      <p className='text-sm font-medium'>{t('customFields.onboardSection')}</p>
      <CustomFieldValues
        definitions={definitions}
        values={values as CustomValues}
      />
    </section>
  );
}

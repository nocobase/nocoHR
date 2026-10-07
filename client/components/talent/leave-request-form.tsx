import { ApiClientError, useApiClient, useService } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { RouteDialog } from '@/components/route-dialog';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import {
  instantOfWallClock,
  wallClockInput,
} from '@/components/talent/attendance/dates';
import { LeaveError } from '@/components/talent/leave-error';
import { sameLeaveRange } from '@/components/talent/leave-range';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useRemote } from '@/components/talent/use-remote';
import { BlockSkeleton } from '@/components/talent/states';
import { LeaveProofButton } from '@/components/talent/leave-proof-button';
import { CustomFieldInputs } from '@/components/talent/custom-fields';
import { errorDetails, responseCode } from '@/components/talent/errors';
import {
  asText,
  compactValues,
  customFieldErrors,
  useCustomFieldDefinitions,
  type CustomFieldDefinition,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { toast } from '@/components/ui/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  clientFileRepositoryManagerToken,
  FileUploadField,
  type FileRecord,
  type FileUploadStatus,
  type ClientFileRepository,
} from '@/extensions/nocobase-file-component-ui';

interface LeaveType {
  id: string;
  title: string;
  code: string;
  unit: string;
  requiresAttachment: boolean;
}

export interface LeaveDraft {
  employeeId?: string;
  canEditHr?: boolean;
  id: string;
  updatedAt: string;
  status: string;
  leaveTypeId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
  source: string;
  attachmentFileId: string | null;
  canEdit?: boolean;
  /** 界面追加字段 values (e.g. 工作交接人), keyed by the definition's key. */
  customFields?: CustomValues;
}

/** One added value as comparable text: the server trims text and stores numbers. */
function comparable(value: unknown): string {
  if (value == null || (Array.isArray(value) && !value.length)) return '';
  return asText(value).trim();
}

/** The form's added values as sent: every form field, empty ones as null. */
function formValues(
  definitions: readonly CustomFieldDefinition[],
  values: CustomValues,
): CustomValues {
  return compactValues(
    Object.fromEntries(definitions.map((d) => [d.key, values[d.key] ?? null])),
  );
}

function sameFormValues(
  definitions: readonly CustomFieldDefinition[],
  left: CustomValues | undefined,
  right: CustomValues | undefined,
): boolean {
  return definitions.every(
    (d) => comparable(left?.[d.key]) === comparable(right?.[d.key]),
  );
}

export function ExistingLeaveDraft({
  id,
  mode = 'self',
}: {
  id: string;
  mode?: 'self' | 'hr';
}): ReactElement {
  const location = useLocation();
  const closeTo =
    mode === 'hr'
      ? `/talent/leave/balances${location.search}`
      : '/talent/me#attendance';
  const { t } = useTranslation();
  const draft = useRemote<LeaveDraft>(
    `talent/leave/requests/${encodeURIComponent(id)}`,
  );
  if (
    !draft.loading &&
    !draft.error &&
    draft.data &&
    (mode === 'hr' ? draft.data?.canEditHr : draft.data?.canEdit) &&
    draft.data.status === 'draft'
  ) {
    return (
      <LeaveRequestForm
        key={draft.data.updatedAt}
        mode={mode}
        initialDraft={draft.data}
        reload={draft.reload}
      />
    );
  }
  return (
    <RouteDialog
      title={t(
        mode === 'hr'
          ? 'attendance.leave.hrEntry.edit'
          : 'attendance.leave.editDraft',
      )}
      closeTo={closeTo}
      description={t('attendance.leave.draftDescription')}
      footer={<LeaveRequestCloseFooter />}
    >
      {draft.loading ? (
        <BlockSkeleton rows={4} />
      ) : draft.error ? (
        <LeaveError error={draft.error} retry={draft.reload} />
      ) : (
        <Alert>
          <AlertDescription>
            {t(
              mode === 'hr'
                ? 'attendance.leave.hrEntry.unavailable'
                : 'attendance.leave.draftUnavailable',
            )}
          </AlertDescription>
        </Alert>
      )}
    </RouteDialog>
  );
}

/** A stored instant as the `datetime-local` value in the application time zone. */
function localInput(value: string, zone: string): string {
  return wallClockInput(value, zone);
}

export function LeaveRequestForm({
  initialDraft,
  reload,
  mode = 'self',
}: {
  mode?: 'self' | 'hr';
  initialDraft?: LeaveDraft;
  reload?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  // Start and end are typed and shown in the application time zone, the one
  // the server computes leave in, whatever the browser's zone is.
  const zone = useAppTimeZone();
  const api = useApiClient();
  const navigate = useNavigate();
  const location = useLocation();
  const closeTo =
    mode === 'hr'
      ? `/talent/leave/balances${location.search}`
      : '/talent/me#attendance';
  const employees = useRemote<
    { id: string; name: string; employeeNo: string }[]
  >(mode === 'hr' ? 'talent/leave/requests/entry-employees' : null);
  const [employeeId, setEmployeeId] = useState(initialDraft?.employeeId ?? '');
  const [employeeLocked, setEmployeeLocked] = useState(Boolean(initialDraft));
  const employeeReady =
    mode !== 'hr' ||
    Boolean(
      !employees.loading &&
      !employees.error &&
      employees.data?.some((item) => item.id === employeeId),
    );
  const types = useRemote<LeaveType[]>('talent/leave/requests/types');
  const [leaveTypeId, setLeaveTypeId] = useState(
    initialDraft?.leaveTypeId ?? '',
  );
  const [startAt, setStartAt] = useState(() =>
    initialDraft ? localInput(initialDraft.startAt, zone) : '',
  );
  const [endAt, setEndAt] = useState(() =>
    initialDraft ? localInput(initialDraft.endAt, zone) : '',
  );
  const [reason, setReason] = useState(initialDraft?.reason ?? '');
  // 界面追加字段 placed on the leave form by HR (e.g. 工作交接人).
  const { definitions: customDefinitions } = useCustomFieldDefinitions(
    'leaveRequests',
    'form',
  );
  const [custom, setCustom] = useState<CustomValues>(
    () => initialDraft?.customFields ?? {},
  );
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [existingAttachment, setExistingAttachment] = useState(
    initialDraft?.attachmentFileId ?? null,
  );
  const [reloadOpen, setReloadOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discardRef = useRef<((allow: boolean) => void) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [proofs, setProofs] = useState<readonly FileRecord[]>([]);
  const [uploadStatus, setUploadStatus] = useState<FileUploadStatus>('idle');
  const [uploadFailed, setUploadFailed] = useState(false);
  const [uploadUncertain, setUploadUncertain] = useState(false);
  const uploadingRef = useRef(false);
  const uncertainRef = useRef(false);
  const fileManager = useService(clientFileRepositoryManagerToken);
  const proofRepository = useMemo(() => {
    // The manager returns a new repository per call. Decorate only this form's
    // uploader so Registry UI never renders raw server or storage errors.
    const repository = fileManager.repository('leaveProofFiles');
    const nativeRepository = fileManager.repository('leaveProofFiles');
    const uploadOne: ClientFileRepository['uploadOne'] = async (
      input,
      options,
    ) => {
      if (uncertainRef.current)
        throw new Error(t('attendance.leave.proofUploadUncertain'));
      uploadingRef.current = true;
      setUploadFailed(false);
      try {
        return await nativeRepository.uploadOne(input, options);
      } catch (cause) {
        // File uploads have no idempotency key. Unknown commit/cleanup state,
        // lost responses and cancellation need reconciliation, not re-upload.
        if (
          !(cause instanceof ApiClientError) ||
          cause.status >= 500 ||
          ['FILE_COMMIT_UNCERTAIN', 'FILE_CLEANUP_FAILED'].includes(
            responseCode(cause) ?? '',
          )
        ) {
          uncertainRef.current = true;
          setUploadUncertain(true);
        }
        throw new Error(
          t(
            uncertainRef.current
              ? 'attendance.leave.proofUploadUncertain'
              : 'attendance.leave.proofUploadFailed',
          ),
          { cause },
        );
      } finally {
        uploadingRef.current = false;
      }
    };
    repository.uploadOne = uploadOne;
    return repository;
  }, [fileManager, t]);
  const uploadStatusChanged = useCallback(
    (status: FileUploadStatus) => setUploadStatus(status),
    [],
  );
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const draftRef = useRef<LeaveDraft | undefined>(initialDraft);
  const submittingRef = useRef(false);
  const selected = types.data?.find((item) => item.id === leaveTypeId);
  const attachmentFileId = proofs[0]?.id ?? existingAttachment;
  const dirty =
    (mode === 'hr' && employeeId !== (initialDraft?.employeeId ?? '')) ||
    leaveTypeId !== (initialDraft?.leaveTypeId ?? '') ||
    startAt !== (initialDraft ? localInput(initialDraft.startAt, zone) : '') ||
    endAt !== (initialDraft ? localInput(initialDraft.endAt, zone) : '') ||
    reason !== (initialDraft?.reason ?? '') ||
    attachmentFileId !== (initialDraft?.attachmentFileId ?? null) ||
    !sameFormValues(customDefinitions, custom, initialDraft?.customFields);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const saveOnly =
      submitter instanceof HTMLButtonElement && submitter.value === 'draft';
    if (
      submittingRef.current ||
      conflict ||
      unavailable ||
      uploadingRef.current ||
      uploadStatus !== 'idle' ||
      uncertainRef.current ||
      types.loading ||
      types.error ||
      !employeeReady ||
      !leaveTypeId ||
      !startAt ||
      !endAt ||
      !selected ||
      (!saveOnly && selected.requiresAttachment && !attachmentFileId)
    )
      return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    setConflict(false);
    setCustomErrors({});
    try {
      const customFields = formValues(customDefinitions, custom);
      const input = {
        leaveTypeId,
        startAt: instantOfWallClock(startAt, zone),
        endAt: instantOfWallClock(endAt, zone),
        reason: reason.trim() || null,
        source: mode === 'hr' ? 'hr' : (initialDraft?.source ?? 'self'),
        ...(mode === 'hr' ? { employeeId } : {}),
        attachmentFileId,
        customFields,
      };
      const matches = (record: LeaveDraft) =>
        (mode !== 'hr' || record.employeeId === employeeId) &&
        record.leaveTypeId === input.leaveTypeId &&
        sameLeaveRange(record, input, zone) &&
        record.reason === input.reason &&
        record.source === input.source &&
        (record.attachmentFileId ?? null) === input.attachmentFileId &&
        sameFormValues(customDefinitions, record.customFields, customFields);
      let current: LeaveDraft;
      if (draftRef.current) {
        // A failed response does not prove a failed write. Read the same
        // request before retrying; never create another draft after submit.
        current = (
          await api.request<{ data: LeaveDraft }>({
            path: `talent/leave/requests/${draftRef.current.id}`,
          })
        ).data;
        if (
          !matches(current) &&
          current.updatedAt !== draftRef.current.updatedAt
        ) {
          setConflict(true);
          return;
        }
      } else {
        current = (
          await api.request<{ data: LeaveDraft }>({
            method: 'POST',
            path: 'talent/leave/requests',
            json: { ...input, clientRequestId },
          })
        ).data;
      }
      draftRef.current = current;
      setEmployeeLocked(true);
      if (current.status !== 'draft') {
        if (
          ['pending', 'approved'].includes(current.status) &&
          matches(current)
        )
          await navigate(closeTo, { replace: true });
        else setConflict(true);
        return;
      }
      if (!matches(current)) {
        current = (
          await api.request<{ data: LeaveDraft }>({
            method: 'PATCH',
            path: `talent/leave/requests/${current.id}`,
            json: { ...input, expectedUpdatedAt: current.updatedAt },
          })
        ).data;
        draftRef.current = current;
      }
      if (saveOnly) {
        toast.add({
          type: 'success',
          title: t(
            mode === 'hr'
              ? 'attendance.leave.hrEntry.draftSaved'
              : 'attendance.leave.draftSaved',
          ),
        });
        await navigate(closeTo, { replace: true });
        return;
      }
      await api.request({
        method: 'POST',
        path: `talent/leave/requests/${current.id}/submit`,
        json: { expectedUpdatedAt: current.updatedAt },
      });
      toast.add({
        type: 'success',
        title: t('attendance.leave.requestSubmitted'),
      });
      await navigate(closeTo, { replace: true });
    } catch (cause) {
      setError(cause);
      // A missing or invalid added field is marked on its input; the values stay.
      if (responseCode(cause) === 'CUSTOM_FIELD_INVALID')
        setCustomErrors(customFieldErrors(errorDetails(cause)));
      if (cause instanceof ApiClientError && cause.status === 409)
        setConflict(true);
      if (cause instanceof ApiClientError && [403, 404].includes(cause.status))
        setUnavailable(true);
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };
  return (
    <RouteDialog
      closeTo={closeTo}
      title={t(
        mode === 'hr'
          ? initialDraft
            ? 'attendance.leave.hrEntry.edit'
            : 'attendance.leave.hrEntry.title'
          : initialDraft
            ? 'attendance.leave.editDraft'
            : 'attendance.leave.request',
      )}
      description={t(
        mode === 'hr'
          ? 'attendance.leave.hrEntry.description'
          : initialDraft
            ? 'attendance.leave.draftDescription'
            : 'attendance.leave.requestDescription',
      )}
      beforeClose={() => {
        if (submittingRef.current || uploadingRef.current) return false;
        if (!dirty) return true;
        return new Promise<boolean>((resolve) => {
          discardRef.current = resolve;
          setDiscardOpen(true);
        });
      }}
      footer={
        <Footer
          busy={busy || uploadStatus === 'uploading'}
          submitDisabled={Boolean(
            selected?.requiresAttachment && !attachmentFileId,
          )}
          disabled={
            conflict ||
            unavailable ||
            types.loading ||
            Boolean(types.error) ||
            !employeeReady ||
            !selected ||
            uploadStatus !== 'idle' ||
            uploadUncertain
          }
        />
      }
    >
      <form
        id='leave-request-form'
        className='grid gap-4'
        onSubmit={(event) => void submit(event)}
      >
        {error ? <LeaveError error={error} /> : null}
        {types.error ? (
          <LeaveError error={types.error} retry={types.reload} />
        ) : null}
        {conflict ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('attendance.leave.errors.conflict')}
              <Button
                type='button'
                variant='outline'
                onClick={() => setReloadOpen(true)}
              >
                {t('attendance.leave.reloadDraft')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <p className='text-sm text-muted-foreground'>
          {t('attendance.leave.timeZone', {
            zone,
          })}
        </p>
        {mode === 'hr' ? (
          <div className='grid gap-2'>
            <Label htmlFor='leave-employee'>
              {t('attendance.leave.fields.employee')}
            </Label>
            {employees.error ? (
              <LeaveError error={employees.error} retry={employees.reload} />
            ) : null}
            <Select
              items={(employees.data ?? []).map((employee) => ({
                value: employee.id,
                label: t('attendance.leave.hrEntry.employeeLabel', {
                  name: employee.name,
                  number: employee.employeeNo,
                }),
              }))}
              value={employeeId}
              onValueChange={(value) => value && setEmployeeId(value)}
              disabled={
                busy ||
                employees.loading ||
                Boolean(employees.error) ||
                employeeLocked
              }
            >
              <SelectTrigger id='leave-employee'>
                <SelectValue
                  placeholder={t('attendance.leave.hrEntry.selectEmployee')}
                />
              </SelectTrigger>
              <SelectContent>
                {(employees.data ?? []).map((employee) => (
                  <SelectItem key={employee.id} value={employee.id}>
                    {t('attendance.leave.hrEntry.employeeLabel', {
                      name: employee.name,
                      number: employee.employeeNo,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!employees.loading &&
            !employees.error &&
            !employees.data?.length ? (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.leave.hrEntry.noEmployees')}
              </p>
            ) : null}
            {(employees.data?.length ?? 0) >= 500 ? (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.leave.cap')}
              </p>
            ) : null}
          </div>
        ) : null}
        <div className='grid gap-2'>
          <Label htmlFor='leave-type'>
            {t('attendance.leave.fields.title')}
          </Label>
          <Select
            items={(types.data ?? []).map((item) => ({
              value: item.id,
              label: item.title,
            }))}
            disabled={busy || types.loading || Boolean(types.error)}
            value={leaveTypeId}
            onValueChange={(value) => value && setLeaveTypeId(value)}
          >
            <SelectTrigger id='leave-type'>
              <SelectValue placeholder={t('attendance.leave.selectType')} />
            </SelectTrigger>
            <SelectContent>
              {(types.data ?? []).map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                  {item.requiresAttachment
                    ? ` · ${t('attendance.leave.proofRequired')}`
                    : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='leave-start'>
            {t('attendance.leave.fields.startAt')}
          </Label>
          <Input
            id='leave-start'
            disabled={busy}
            type='datetime-local'
            step={1}
            value={startAt}
            onChange={(event) => setStartAt(event.target.value)}
            required
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='leave-end'>
            {t('attendance.leave.fields.endAt')}
          </Label>
          <Input
            id='leave-end'
            disabled={busy}
            type='datetime-local'
            step={1}
            value={endAt}
            onChange={(event) => setEndAt(event.target.value)}
            required
          />
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='leave-reason'>
            {t('attendance.leave.fields.reason')}
          </Label>
          <Input
            id='leave-reason'
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={1000}
          />
        </div>
        <CustomFieldInputs
          definitions={customDefinitions}
          values={custom}
          onChange={(next) => {
            setCustom(next);
            setCustomErrors({});
          }}
          errors={customErrors}
          disabled={busy}
          idPrefix='leave-cf'
        />
        <fieldset className='grid gap-2' disabled={busy || uploadUncertain}>
          <legend className='mb-2 text-sm font-medium'>
            {t('attendance.leave.proofLabel')}
            {selected?.requiresAttachment ? (
              <span aria-hidden='true'> *</span>
            ) : null}
          </legend>
          <p className='text-sm text-muted-foreground'>
            {t('attendance.leave.proofHelp')}
          </p>
          {selected?.requiresAttachment && !attachmentFileId ? (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.leave.proofMissing')}
            </p>
          ) : null}
          {existingAttachment && initialDraft ? (
            <div className='flex flex-wrap gap-2'>
              <LeaveProofButton requestId={initialDraft.id} disabled={busy} />
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => setExistingAttachment(null)}
              >
                {t('attendance.leave.replaceProof')}
              </Button>
            </div>
          ) : null}
          <FileUploadField
            repository={proofRepository}
            value={proofs}
            onChange={(files) => {
              setProofs(files);
              setUploadFailed(false);
            }}
            onStatusChange={uploadStatusChanged}
            onError={() => setUploadFailed(true)}
            accept={['.pdf', '.png', '.jpg', '.jpeg']}
            maxSize={5 * 1024 * 1024}
            maxFiles={1}
            disabled={busy || uploadUncertain || Boolean(existingAttachment)}
            removeOnDelete={false}
            labels={{ choose: t('attendance.leave.uploadProof') }}
          />
          {uploadFailed || uploadUncertain ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {t(
                  uploadUncertain
                    ? 'attendance.leave.proofUploadUncertain'
                    : 'attendance.leave.proofUploadFailed',
                )}
              </AlertDescription>
            </Alert>
          ) : null}
        </fieldset>
        {selected ? (
          <p className='text-sm text-muted-foreground'>
            {t('attendance.leave.requestPreview', {
              unit: t(`attendance.leave.enums.${selected.unit}`),
            })}
          </p>
        ) : null}
      </form>
      <AlertDialog
        open={discardOpen}
        onOpenChange={(open) => {
          if (!open) {
            discardRef.current?.(false);
            discardRef.current = null;
            setDiscardOpen(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.leave.discardTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.leave.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('attendance.leave.keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                discardRef.current?.(true);
                discardRef.current = null;
                setDiscardOpen(false);
              }}
            >
              {t('attendance.leave.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={reloadOpen} onOpenChange={setReloadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.leave.reloadDraft')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.leave.reloadDraftDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setReloadOpen(false);
                if (reload) reload();
                else if (draftRef.current)
                  void navigate(
                    mode === 'hr'
                      ? `/talent/leave/balances/entry/${encodeURIComponent(draftRef.current.id)}${location.search}`
                      : `/talent/me/leave/${encodeURIComponent(draftRef.current.id)}/edit`,
                    { replace: true },
                  );
                else void navigate(closeTo, { replace: true });
              }}
            >
              {t('attendance.leave.reloadDraft')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </RouteDialog>
  );
}

export function LeaveRequestCloseFooter({ busy = false }: { busy?: boolean }) {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <Button
      type='button'
      variant='outline'
      disabled={busy}
      onClick={() => void close()}
    >
      {t('actions.cancel')}
    </Button>
  );
}

function Footer({
  busy,
  disabled,
  submitDisabled,
}: {
  busy: boolean;
  disabled: boolean;
  submitDisabled: boolean;
}) {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button
        type='submit'
        form='leave-request-form'
        name='intent'
        value='draft'
        variant='outline'
        disabled={busy || disabled}
      >
        {t('attendance.leave.saveDraft')}
      </Button>
      <Button
        type='submit'
        form='leave-request-form'
        disabled={busy || disabled || submitDisabled}
      >
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t('attendance.leave.submit')}
      </Button>
    </>
  );
}

import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { useLookups } from '@/components/talent/use-lookups';
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
import { toast } from '@/components/ui/toast';

import { choiceOf } from './helpers.js';
import type { SyncIssue } from './types.js';

type Lookups = ReturnType<typeof useLookups>;

/**
 * 手工指定: the department a directory department is, the parent it goes
 * under, or the binding to keep between a member and an employee. The server
 * checks the choice is one of the item's candidates.
 */
export function AssignDialog({
  issue,
  subject,
  lookups,
  employeeName,
  onClose,
  onAssigned,
}: {
  issue: SyncIssue | null;
  subject: string;
  lookups: Pick<Lookups, 'departments' | 'departmentTitle'>;
  employeeName: (id: string) => string | undefined;
  onClose: () => void;
  onAssigned: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const choice = issue ? choiceOf(issue, lookups, employeeName) : null;
  const kind = issue?.type ?? 'departmentAmbiguous';

  const reset = () => {
    setValue('');
    setInvalid(false);
    setError(undefined);
  };

  async function submit(): Promise<void> {
    if (!issue || !choice) return;
    if (!value) {
      setInvalid(true);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/org-sync/issues/assign',
        method: 'POST',
        json: { key: issue.key, [choice.field]: value },
      });
      toast.add({
        type: 'success',
        title: t('orgSync.assign.done', { name: subject }),
      });
      reset();
      onAssigned();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={Boolean(issue)}
      onOpenChange={(next) => {
        if (pending || next) return;
        reset();
        onClose();
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t(`orgSync.assign.${kind}.title`, { name: subject })}
          </DialogTitle>
          <DialogDescription>
            {t(`orgSync.assign.${kind}.description`)}
          </DialogDescription>
        </DialogHeader>
        <form
          id='assign-issue-form'
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            <Field data-invalid={invalid}>
              <FieldLabel htmlFor='assign-choice'>
                {t(`orgSync.assign.${kind}.label`)} *
              </FieldLabel>
              <NativeSelect
                id='assign-choice'
                value={value}
                aria-invalid={invalid}
                onChange={(e) => {
                  setValue(e.target.value);
                  setInvalid(false);
                }}
              >
                <NativeSelectOption value=''>
                  {t('orgSync.assign.placeholder')}
                </NativeSelectOption>
                {(choice?.options ?? []).map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {invalid ? (
                <FieldError>{t('orgSync.assign.required')}</FieldError>
              ) : null}
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={pending}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='assign-issue-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('orgSync.assign.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 开通账号 (noAccount): a login account for an employee bound to an
 * office-suite member, linked at once. The office suite's email is used; an
 * administrator enters one only when the member has none.
 */
export function AccountDialog({
  issue,
  subject,
  provider,
  onClose,
  onCreated,
}: {
  issue: SyncIssue | null;
  subject: string;
  provider: string;
  onClose: () => void;
  onCreated: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const reset = () => {
    setEmail('');
    setError(undefined);
  };

  async function submit(): Promise<void> {
    if (!issue?.employeeId) return;
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/org-sync/employees/${encodeURIComponent(issue.employeeId)}/account`,
        method: 'POST',
        json: email.trim() ? { email: email.trim() } : {},
      });
      toast.add({
        type: 'success',
        title: t('orgSync.account.done', { name: subject }),
      });
      reset();
      onCreated();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={Boolean(issue)}
      onOpenChange={(next) => {
        if (pending || next) return;
        reset();
        onClose();
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t('orgSync.account.title', { name: subject })}
          </DialogTitle>
          <DialogDescription>
            {t('orgSync.account.description', { provider })}
          </DialogDescription>
        </DialogHeader>
        <form
          id='issue-account-form'
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='issue-account-email'>
                {t('orgSync.account.email')}
              </FieldLabel>
              <Input
                id='issue-account-email'
                type='email'
                autoComplete='off'
                value={email}
                maxLength={191}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FieldDescription>
                {t('orgSync.account.emailHint', { provider })}
              </FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={pending}
            onClick={() => {
              reset();
              onClose();
            }}
          >
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='issue-account-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('orgSync.account.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

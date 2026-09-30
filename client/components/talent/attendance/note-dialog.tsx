import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';

import { attendanceErrorMessage } from './errors.js';

/**
 * A confirmation with an optional required note: 解锁 (reason), 处理异议
 * (result), 提出异议 (note), 代为确认 (no note). The dialog stays open with
 * the text kept when the request fails.
 */
export function NoteDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  confirmLabel,
  onSubmit,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** The note's label; without one the dialog only confirms. */
  label?: string;
  confirmLabel: string;
  onSubmit: (text: string) => Promise<void>;
  children?: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const missing = Boolean(label) && !text.trim();
  const submit = async () => {
    if (busyRef.current || missing) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(text.trim());
      onOpenChange(false);
    } catch (cause) {
      setError(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !busyRef.current && onOpenChange(next)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription>{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        {label ? (
          <Field>
            <FieldLabel htmlFor='attendance-note'>{label} *</FieldLabel>
            <Textarea
              id='attendance-note'
              value={text}
              maxLength={1000}
              aria-required='true'
              disabled={busy}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
        ) : null}
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {attendanceErrorMessage(error, t)}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button disabled={busy || missing} onClick={() => void submit()}>
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

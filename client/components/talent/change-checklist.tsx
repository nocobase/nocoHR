import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
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
import { toast } from '@/components/ui/toast';

import { errorMessage } from './errors.js';
import { useRemote } from './use-remote.js';

/** A 变动影响清单 as `GET talent/checklists/:id` answers (server/providers/hr/change-checklists.ts). */
export interface ChecklistItem {
  key: string;
  provider: string;
  code: string;
  params: Record<string, string>;
  status: 'auto' | 'todo' | 'done' | 'notNeeded';
  link: string | null;
  action: { type: 'adoptManager'; employeeId: string } | null;
  note: string | null;
  aiNote: string | null;
  handledBy: string | null;
  handledAt: string | null;
}
export interface Checklist {
  id: string;
  employeeId: string | null;
  employeeName: string;
  kind: 'onboard' | 'change' | 'offboard';
  actionId: string | null;
  stage: 'preview' | 'open' | 'done' | 'cancelled';
  items: ChecklistItem[];
  aiSummary: string | null;
  ownerUserId: string | null;
  dueDate: string | null;
}

const STATUS_VARIANT = {
  auto: 'secondary',
  todo: 'outline',
  done: 'secondary',
  notNeeded: 'outline',
} as const;

/**
 * The items of a checklist, each with its state, the rule's wording, the HR
 * assistant's note and — while the checklist is open — the ways to handle
 * it. A preview is read-only: it shows the approver what the change touches.
 */
export function ChecklistItems({
  checklist,
  onChanged,
}: {
  readonly checklist: Checklist;
  readonly onChanged: (next: Checklist) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [skipping, setSkipping] = useState<ChecklistItem | null>(null);
  const [note, setNote] = useState('');
  const open = checklist.stage === 'open';

  async function send(path: string, json: unknown, key: string) {
    setBusy(key);
    try {
      const result = await api.request<{ data: Checklist }>({
        path,
        method: 'POST',
        json,
      });
      onChanged(result.data);
      return true;
    } catch (error) {
      toast.add({ type: 'error', title: errorMessage(error, t) });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const itemText = (item: ChecklistItem) => {
    const params = { ...item.params };
    if (item.code === 'profileMissing')
      params.fields = (item.params.fields ?? '')
        .split(',')
        .map((f) => t(`checklists.profileFields.${f}`))
        .join('、');
    return t(`checklists.items.${item.code}`, params);
  };

  return (
    <>
      <ul className='flex flex-col divide-y'>
        {checklist.items.map((item) => (
          <li
            key={item.key}
            className='flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between'
          >
            <div className='flex min-w-0 flex-col gap-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={STATUS_VARIANT[item.status]}>
                  {t(`checklists.status.${item.status}`)}
                </Badge>
                <span className='text-sm font-medium'>
                  {t(`checklists.providers.${item.provider}`)}
                </span>
              </div>
              <p className='text-sm'>{itemText(item)}</p>
              {item.aiNote && item.aiNote !== itemText(item) ? (
                <p className='flex items-start gap-1 text-sm text-muted-foreground'>
                  <SparklesIcon className='mt-0.5 size-3.5 shrink-0' />
                  {item.aiNote}
                </p>
              ) : null}
              {item.note ? (
                <p className='text-sm text-muted-foreground'>
                  {t('checklists.noteLabel', { note: item.note })}
                </p>
              ) : null}
            </div>
            {open && item.status === 'todo' ? (
              <div className='flex shrink-0 flex-wrap gap-2'>
                {item.action?.type === 'adoptManager' ? (
                  <Button
                    size='sm'
                    disabled={busy !== null}
                    onClick={() =>
                      void send(
                        `talent/checklists/${checklist.id}/items/${item.key}/perform`,
                        {},
                        item.key,
                      )
                    }
                  >
                    {busy === item.key ? (
                      <Spinner data-icon='inline-start' />
                    ) : null}
                    {t('checklists.adoptManager')}
                  </Button>
                ) : item.link ? (
                  <Button
                    size='sm'
                    variant='outline'
                    render={<Link to={item.link} />}
                  >
                    {t('checklists.open')}
                  </Button>
                ) : null}
                <Button
                  size='sm'
                  variant='outline'
                  disabled={busy !== null}
                  onClick={() =>
                    void send(
                      `talent/checklists/${checklist.id}/items/${item.key}`,
                      { status: 'done', note: null },
                      item.key,
                    )
                  }
                >
                  <CheckIcon data-icon='inline-start' />
                  {t('checklists.markDone')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy !== null}
                  onClick={() => {
                    setNote('');
                    setSkipping(item);
                  }}
                >
                  {t('checklists.markNotNeeded')}
                </Button>
              </div>
            ) : open &&
              (item.status === 'done' || item.status === 'notNeeded') ? (
              <Button
                size='sm'
                variant='ghost'
                disabled={busy !== null}
                onClick={() =>
                  void send(
                    `talent/checklists/${checklist.id}/items/${item.key}`,
                    { status: 'todo', note: null },
                    item.key,
                  )
                }
              >
                {t('checklists.reopen')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Dialog
        open={Boolean(skipping)}
        onOpenChange={(next) => !next && setSkipping(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('checklists.notNeededTitle')}</DialogTitle>
            <DialogDescription>
              {skipping ? itemText(skipping) : null}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='checklist-note'>
              {t('checklists.notNeededReason')} *
            </FieldLabel>
            <Textarea
              id='checklist-note'
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setSkipping(null)}>
              {t('actions.cancel')}
            </Button>
            <Button
              disabled={!note.trim() || busy !== null}
              onClick={() =>
                skipping &&
                void send(
                  `talent/checklists/${checklist.id}/items/${skipping.key}`,
                  { status: 'notNeeded', note: note.trim() },
                  skipping.key,
                ).then((ok) => ok && setSkipping(null))
              }
            >
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The checklist of one personnel action, where it has one: the impact preview
 * while a transfer awaits approval, the checklist once it is open. Nothing is
 * shown to someone who may not read it (the server answers null).
 */
export function ActionChecklist({
  actionId,
}: {
  readonly actionId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const remote = useRemote<Checklist | null>(
    `talent/checklists/by-action/${encodeURIComponent(actionId)}`,
  );
  const [local, setLocal] = useState<Checklist | null>(null);
  const checklist = local ?? remote.data ?? null;
  if (!checklist) return null;
  return (
    <section className='space-y-2 border-t pt-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm font-medium'>
          {t(
            checklist.stage === 'preview'
              ? 'checklists.previewTitle'
              : `checklists.kindTitle.${checklist.kind}`,
          )}
        </p>
        {checklist.stage !== 'preview' ? (
          <Button
            size='sm'
            variant='ghost'
            render={<Link to={`/talent/checklists/${checklist.id}`} />}
          >
            {t('checklists.openPage')}
          </Button>
        ) : null}
      </div>
      {checklist.aiSummary ? (
        <p className='flex items-start gap-1 text-sm text-muted-foreground'>
          <SparklesIcon className='mt-0.5 size-3.5 shrink-0' />
          {checklist.aiSummary}
        </p>
      ) : null}
      <ChecklistItems checklist={checklist} onChanged={setLocal} />
    </section>
  );
}

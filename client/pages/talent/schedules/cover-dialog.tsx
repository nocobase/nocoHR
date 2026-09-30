import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SendIcon, SparklesIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';

import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import type {
  CoverInvitation,
  ScheduleBoard,
  ScheduleCell,
} from '@/components/talent/attendance/types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

type InviteResult = 'sent' | 'duplicate' | 'notBound' | 'noAccount' | 'failed';

interface Candidate {
  employeeId: string;
  name: string;
  restBeforeHours: number | null;
  restAfterHours: number | null;
  monthOvertimeHours: number;
  monthNightShifts: number;
}

/**
 * 顶班: who can cover a cell a leave now blocks. The HR assistant's
 * suggestion (if it made one) comes first with its reasons; the full
 * candidate list is computed by the rules on request. Picking someone only
 * fills the grid — the save validates it like any other edit.
 *
 * 发出顶班邀请 (V2-05 realigned): only on this click, each suggested colleague
 * gets a Feishu card (接受 / 不方便). The first to accept goes into a draft of
 * that shift, which the scheduler still publishes (and the checks still run).
 */
export function CoverDialog({
  cell,
  board,
  onClose,
  onPick,
  onInvited,
}: {
  cell: ScheduleCell | null;
  board: ScheduleBoard;
  onClose: () => void;
  onPick: (cell: ScheduleCell, employeeId: string) => void;
  /** The board reloads: an accepted invitation shows as a draft cell. */
  onInvited?: () => void;
}): ReactElement {
  return (
    <CoverDialogBody
      key={cell?.id ?? ''}
      cell={cell}
      board={board}
      onClose={onClose}
      onPick={onPick}
      onInvited={onInvited}
    />
  );
}

function CoverDialogBody({
  cell,
  board,
  onClose,
  onPick,
  onInvited,
}: {
  cell: ScheduleCell | null;
  board: ScheduleBoard;
  onClose: () => void;
  onPick: (cell: ScheduleCell, employeeId: string) => void;
  onInvited?: () => void;
}): ReactElement {
  const api = useApiClient();
  const [sent, setSent] = useState<{
    results: Record<string, InviteResult>;
    invitations: CoverInvitation[];
  } | null>(null);
  const [inviting, setInviting] = useState(false);
  const busyRef = useRef(false);
  const { t } = useTranslation();
  const candidates = useRemote<{ candidates: Candidate[] }>(
    cell ? `talent/schedules/${encodeURIComponent(cell.id)}/candidates` : null,
  );
  const name = (id: string) =>
    board.employees.find((e) => e.id === id)?.name ?? id;
  const shift = board.shifts.find((s) => s.id === cell?.shiftId);
  const suggested = cell?.replacementSuggestion?.candidates ?? [];
  const invitations =
    sent?.invitations ?? cell?.replacementSuggestion?.invitations ?? [];
  const accepted = invitations.find((i) => i.response === 'accepted');
  const invite = async () => {
    if (!cell || busyRef.current || !suggested.length) return;
    busyRef.current = true;
    setInviting(true);
    try {
      const response = await api.request<{
        data: {
          results: Record<string, InviteResult>;
          invitations: CoverInvitation[];
        };
      }>({
        method: 'POST',
        path: `talent/schedules/${encodeURIComponent(cell.id)}/invitations`,
        json: { candidateIds: suggested.map((c) => c.employeeId) },
      });
      setSent(response.data);
      toast.add({
        type: 'success',
        title: t('attendanceV2.invite.sent', {
          count: Object.values(response.data.results).filter(
            (r) => r === 'sent',
          ).length,
        }),
      });
      onInvited?.();
    } catch (cause) {
      toast.add({ type: 'error', title: attendanceErrorMessage(cause, t) });
    } finally {
      busyRef.current = false;
      setInviting(false);
    }
  };
  return (
    <Dialog open={Boolean(cell)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('attendance.scheduling.cover.title')}</DialogTitle>
          <DialogDescription>
            {cell
              ? t('attendance.scheduling.cover.description', {
                  name: name(cell.employeeId),
                  date: cell.date,
                  shift: shift?.title ?? '—',
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        {suggested.length ? (
          <section className='grid gap-2'>
            <h3 className='flex items-center gap-1 text-sm font-medium'>
              <SparklesIcon className='size-4 text-primary' />
              {t('attendance.scheduling.cover.suggested')}
            </h3>
            <ul className='grid gap-2'>
              {suggested.map((candidate) => (
                <li
                  key={candidate.employeeId}
                  className='flex flex-wrap items-start justify-between gap-2 rounded-lg border p-3'
                >
                  <div className='min-w-0 space-y-1'>
                    <p className='font-medium'>
                      {candidate.name ?? name(candidate.employeeId)}
                    </p>
                    {candidate.reasons?.length ? (
                      <ul className='list-disc pl-4 text-sm text-muted-foreground'>
                        {candidate.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <span className='flex items-center gap-2'>
                    {sent?.results[candidate.employeeId] ? (
                      <Badge variant='outline'>
                        {t(
                          `attendanceV2.invite.results.${sent.results[candidate.employeeId]}`,
                        )}
                      </Badge>
                    ) : null}
                    <Button
                      size='sm'
                      onClick={() => cell && onPick(cell, candidate.employeeId)}
                    >
                      {t('attendance.scheduling.cover.pick')}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <div className='grid gap-2 rounded-lg border border-dashed p-3'>
              <p className='text-sm text-muted-foreground'>
                {t('attendanceV2.invite.hint')}
              </p>
              <Button
                className='w-fit'
                variant='outline'
                disabled={inviting || Boolean(accepted)}
                onClick={() => void invite()}
              >
                {inviting ? (
                  <Spinner data-icon='inline-start' />
                ) : (
                  <SendIcon data-icon='inline-start' />
                )}
                {t('attendanceV2.invite.button')}
              </Button>
            </div>
          </section>
        ) : null}
        {invitations.length ? (
          <section className='grid gap-2'>
            <h3 className='text-sm font-medium'>
              {t('attendanceV2.invite.title')}
            </h3>
            {accepted ? (
              <p className='text-sm'>
                {t('attendanceV2.invite.accepted', {
                  name: accepted.name ?? name(accepted.employeeId),
                })}
              </p>
            ) : null}
            <ul className='grid gap-1'>
              {invitations.map((invitation) => (
                <li
                  key={invitation.employeeId}
                  className='flex items-center justify-between gap-2 text-sm'
                >
                  <span>{invitation.name ?? name(invitation.employeeId)}</span>
                  <Badge
                    variant={
                      invitation.response === 'accepted'
                        ? 'secondary'
                        : 'outline'
                    }
                  >
                    {t(
                      `attendanceV2.invite.status.${invitation.response ?? 'pending'}`,
                    )}
                  </Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <section className='grid gap-2'>
          <h3 className='text-sm font-medium'>
            {t('attendance.scheduling.cover.candidates')}
          </h3>
          {candidates.error ? (
            <LoadError error={candidates.error} onRetry={candidates.reload} />
          ) : !candidates.data ? (
            <BlockSkeleton rows={2} />
          ) : !candidates.data.candidates.length ? (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.scheduling.cover.none')}
            </p>
          ) : (
            <ul className='grid max-h-72 gap-2 overflow-y-auto'>
              {candidates.data.candidates.map((candidate) => (
                <li
                  key={candidate.employeeId}
                  className='flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3'
                >
                  <div className='min-w-0 space-y-1'>
                    <p className='font-medium'>{candidate.name}</p>
                    <div className='flex flex-wrap gap-1'>
                      <Badge variant='outline'>
                        {t('attendance.scheduling.cover.rest', {
                          before: candidate.restBeforeHours ?? '—',
                          after: candidate.restAfterHours ?? '—',
                        })}
                      </Badge>
                      <Badge variant='outline'>
                        {t('attendance.scheduling.cover.load', {
                          hours: candidate.monthOvertimeHours,
                          nights: candidate.monthNightShifts,
                        })}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => cell && onPick(cell, candidate.employeeId)}
                  >
                    {t('attendance.scheduling.cover.pick')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}

import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { ChevronDownIcon, TimerIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const TASKS = ['pull', 'compute', 'daily', 'monthly', 'yearly'] as const;

/** A task's result as `name: value` pairs; nested objects are summarized one level deep. */
function summarizeResult(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'object') return JSON.stringify(value);
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => {
      if (item && typeof item === 'object') {
        const inner = Object.entries(item as Record<string, unknown>)
          .filter(([, v]) => v == null || typeof v !== 'object')
          .map(([k, v]) => `${k} ${String(v)}`)
          .join(', ');
        return `${key}: ${inner || '…'}`;
      }
      return `${key}: ${String(item)}`;
    })
    .join('; ');
}

/**
 * 手动运行定时任务: runs a scheduled attendance task now, exactly as the
 * scheduler would (hr.admin only — the server checks the lock permission).
 */
export function TasksMenu({ onDone }: { onDone: () => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [running, setRunning] = useState<string | null>(null);
  const run = async (task: (typeof TASKS)[number]) => {
    if (running) return;
    setRunning(task);
    try {
      const response = await api.request<{ data: unknown }>({
        method: 'POST',
        path: `talent/attendance/tasks/${task}/run`,
        json: {},
      });
      toast.add({
        type: 'success',
        title: t('attendance.board.tasks.done', {
          task: t(`attendance.board.tasks.${task}`),
        }),
        description: summarizeResult(response.data),
      });
      onDone();
    } catch (cause) {
      toast.add({ type: 'error', title: attendanceErrorMessage(cause, t) });
    } finally {
      setRunning(null);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={running !== null}
        render={<Button variant='outline' />}
      >
        {running ? (
          <Spinner data-icon='inline-start' />
        ) : (
          <TimerIcon data-icon='inline-start' />
        )}
        {t('attendance.board.tasks.menu')}
        <ChevronDownIcon data-icon='inline-end' />
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {t('attendance.board.tasks.hint')}
          </DropdownMenuLabel>
          {TASKS.map((task) => (
            <DropdownMenuItem key={task} onClick={() => void run(task)}>
              {t(`attendance.board.tasks.${task}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

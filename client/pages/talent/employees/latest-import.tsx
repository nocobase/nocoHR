import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { FileSearchIcon, RefreshCwIcon, SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
import { Markdown } from '@/components/talent/markdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

export interface ImportSummary {
  readonly id: string;
  readonly importedByName: string | null;
  readonly createdCount: number;
  readonly updatedCount: number;
  readonly createdPositionIds: readonly string[];
  readonly createdAt: string;
  readonly check: {
    readonly mustFix: number;
    readonly suggested: number;
    readonly report: string;
  } | null;
}

/**
 * "最近一次导入" above the employee list, for HR administrators: what the last
 * Excel import did and what the HR assistant's health check found, with the
 * report and a way to run the check again.
 */
export function LatestImportCard({
  summary,
  onReload,
}: {
  summary: ImportSummary;
  onReload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const pending = summary.check
    ? summary.check.mustFix + summary.check.suggested
    : null;

  async function rerun(): Promise<void> {
    setRunning(true);
    try {
      const { data } = await api.request<{ data: { status: string } }>({
        path: `talent/automations/import-check/${encodeURIComponent(summary.id)}`,
        method: 'POST',
      });
      toast.add({
        type: data.status === 'failed' ? 'error' : 'success',
        title: t(`talent.latestImport.rerun.${data.status}`, {
          defaultValue: t('talent.latestImport.rerun.done'),
        }),
      });
      onReload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card size='sm'>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <CardTitle className='flex flex-wrap items-center gap-2'>
            {t('talent.latestImport.title')}
            {pending === null ? (
              <Badge variant='outline'>
                {t('talent.latestImport.checking')}
              </Badge>
            ) : pending > 0 ? (
              <Badge variant='destructive'>
                {t('talent.latestImport.pending', { count: pending })}
              </Badge>
            ) : (
              <Badge variant='secondary'>
                {t('talent.latestImport.clean')}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {t('talent.latestImport.summary', {
              batch: summary.id,
              name: summary.importedByName ?? '—',
              date: summary.createdAt.slice(0, 16).replace('T', ' '),
              created: summary.createdCount,
              updated: summary.updatedCount,
              positions: summary.createdPositionIds.length,
            })}
          </CardDescription>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            size='sm'
            nativeButton={false}
            render={
              <Link
                to={`/talent/employees?batch=${encodeURIComponent(summary.id)}`}
              />
            }
          >
            <FileSearchIcon data-icon='inline-start' />
            {t('talent.latestImport.viewBatch')}
          </Button>
          {summary.check ? (
            <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
              <SparklesIcon data-icon='inline-start' />
              {t('talent.latestImport.viewReport')}
            </Button>
          ) : null}
          <Button
            variant='ghost'
            size='sm'
            disabled={running}
            onClick={() => void rerun()}
          >
            {running ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <RefreshCwIcon data-icon='inline-start' />
            )}
            {t('talent.latestImport.rerunAction')}
          </Button>
        </div>
      </CardHeader>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('talent.latestImport.reportTitle')}</DialogTitle>
            <DialogDescription>
              {t('talent.latestImport.reportDescription', {
                batch: summary.id,
              })}
            </DialogDescription>
          </DialogHeader>
          {summary.check ? (
            // Following a filter link in the report closes the dialog so the filtered list is visible.
            <div
              role='presentation'
              onClickCapture={(event) => {
                if ((event.target as HTMLElement).closest('a')) setOpen(false);
              }}
            >
              <Markdown>{summary.check.report}</Markdown>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

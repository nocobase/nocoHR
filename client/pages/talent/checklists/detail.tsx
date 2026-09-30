import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import {
  ChecklistItems,
  type Checklist,
} from '@/components/talent/change-checklist';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Route `/talent/checklists/:checklistId` (V1-02 变动影响清单): one onboarding,
 * transfer or offboarding checklist. Reached from the workbench, the
 * notification and the action; the server decides who may read it (HR
 * administrators, its owner, an approver for a preview) and answers 404 to
 * anyone else.
 */
export default function ChecklistPage(): ReactElement {
  const { checklistId = '' } = useParams();
  const { t } = useTranslation();
  const remote = useRemote<Checklist>(
    `talent/checklists/${encodeURIComponent(checklistId)}`,
  );
  const [local, setLocal] = useState<Checklist | null>(null);
  const checklist = local ?? remote.data;
  const todo = checklist?.items.filter((i) => i.status === 'todo').length ?? 0;
  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={
          checklist
            ? t(`checklists.kindTitle.${checklist.kind}`)
            : t('checklists.title')
        }
        description={checklist?.employeeName}
        actions={
          checklist?.actionId ? (
            <Button
              variant='outline'
              render={<Link to={`/talent/actions/${checklist.actionId}`} />}
            >
              {t('checklists.openAction')}
            </Button>
          ) : undefined
        }
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !checklist ? (
        <BlockSkeleton rows={5} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className='flex flex-wrap items-center gap-2'>
              <Badge
                variant={checklist.stage === 'done' ? 'secondary' : 'outline'}
              >
                {t(`checklists.stage.${checklist.stage}`)}
              </Badge>
              <span className='text-sm font-normal text-muted-foreground'>
                {t('checklists.todoCount', { count: todo })}
                {checklist.dueDate
                  ? ` · ${t('checklists.due', { date: checklist.dueDate })}`
                  : ''}
              </span>
            </CardTitle>
            {checklist.aiSummary ? (
              <CardDescription className='flex items-start gap-1'>
                <SparklesIcon className='mt-0.5 size-3.5 shrink-0' />
                {checklist.aiSummary}
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <ChecklistItems checklist={checklist} onChanged={setLocal} />
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}

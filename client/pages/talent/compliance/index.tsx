import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface Issue {
  id: string;
  employeeId: string;
  employeeName: string;
  kind: 'secondFixedTerm' | 'probationLimit' | 'noContract' | 'expiredContract';
  status: 'open' | 'closed';
  aiNote: string | null;
  /** The assistant's note, or the template wording until it is written. */
  note: string;
  detectedAt: string;
  closedAt: string | null;
}

/**
 * Route `/talent/compliance` (V1-02 用工合规检查): the labour-contract prompts
 * the daily check found. Rules decide; the HR assistant words each prompt,
 * which always ends by saying it is not legal advice. A prompt closes by
 * itself once its cause is gone (a contract signed, a probation corrected).
 */
export default function CompliancePage(): ReactElement {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const remote = useRemote<Issue[]>('talent/compliance', { status });
  const focus = params.get('employeeId');
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
  });
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('compliance.title')}
        description={t('compliance.description')}
      />
      <ToggleGroup
        variant='outline'
        value={[status]}
        onValueChange={(value) => {
          const next = Array.isArray(value) ? value[0] : value;
          if (next === 'open' || next === 'closed') setStatus(next);
        }}
      >
        <ToggleGroupItem value='open'>{t('compliance.open')}</ToggleGroupItem>
        <ToggleGroupItem value='closed'>
          {t('compliance.closed')}
        </ToggleGroupItem>
      </ToggleGroup>
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !remote.data ? (
        <BlockSkeleton rows={4} />
      ) : !remote.data.length ? (
        <Card>
          <CardContent className='py-10 text-center text-sm text-muted-foreground'>
            {t(
              status === 'open'
                ? 'compliance.emptyOpen'
                : 'compliance.emptyClosed',
            )}
          </CardContent>
        </Card>
      ) : (
        <div className='flex flex-col gap-3'>
          {remote.data.map((issue) => (
            <Card
              key={issue.id}
              className={
                issue.employeeId === focus ? 'ring-2 ring-ring' : undefined
              }
            >
              <CardContent className='flex flex-col gap-2 py-4'>
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{issue.employeeName}</span>
                    <Badge variant='outline'>
                      {t(`compliance.kinds.${issue.kind}`)}
                    </Badge>
                  </div>
                  <span className='text-sm text-muted-foreground'>
                    {t('compliance.detectedAt', {
                      date: format.format(new Date(issue.detectedAt)),
                    })}
                  </span>
                </div>
                <p className='text-sm'>{issue.note}</p>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    render={
                      <Link
                        to={`/talent/contracts?employeeId=${encodeURIComponent(issue.employeeId)}`}
                      />
                    }
                  >
                    {t('compliance.openContracts')}
                  </Button>
                  <Button
                    size='sm'
                    variant='ghost'
                    render={
                      <Link to={`/talent/employees/${issue.employeeId}`} />
                    }
                  >
                    {t('compliance.openEmployee')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

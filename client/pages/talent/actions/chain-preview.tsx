import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useState, type ReactElement } from 'react';

import { ChainSteps } from '@/components/talent/chain-steps';
import { errorMessage } from '@/components/talent/errors';
import type { ApprovalStep } from '@/components/talent/types';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

/**
 * 审批链预览 on the action form: the chain the action would get if submitted
 * now, re-read 300 ms after the type, employee or target department changes.
 * It is information only; a failure here never blocks submitting, since the
 * server builds the chain again when the action is created.
 */
export function ActionChainPreview({
  request,
  departmentTitle,
}: {
  /** null until enough is chosen to resolve a chain. */
  readonly request: Record<string, unknown> | null;
  readonly departmentTitle: (id: string | null | undefined) => string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    steps?: ApprovalStep[];
    error?: unknown;
  }>();
  const body = request ? JSON.stringify(request) : '';
  const key = body ? `${body}|${attempt}` : '';
  useEffect(() => {
    if (!body) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .request<{ data: ApprovalStep[] }>({
          path: 'talent/actions/preview',
          method: 'POST',
          json: JSON.parse(body) as Record<string, unknown>,
          signal: controller.signal,
        })
        .then(
          (response) => {
            if (!controller.signal.aborted)
              setResult({ key, steps: response.data });
          },
          (error: unknown) => {
            if (!controller.signal.aborted)
              setResult((previous) => ({ ...previous, key, error }));
          },
        );
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, body, key]);
  const loading = Boolean(request) && result?.key !== key;
  return (
    <section
      className='space-y-3 rounded-md border bg-muted/30 p-3'
      aria-labelledby='action-chain-preview'
    >
      <p
        id='action-chain-preview'
        className='flex items-center gap-2 text-sm font-medium'
      >
        {t('talent.chain.previewTitle')}
        {loading && result?.steps ? <Spinner /> : null}
      </p>
      {!request ? (
        <p className='text-sm text-muted-foreground'>
          {t('talent.chain.previewIdle')}
        </p>
      ) : result?.error && !loading ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('talent.chain.previewFailed', {
              reason: errorMessage(result.error, t),
            })}
          </AlertDescription>
          <AlertAction>
            <Button
              variant='outline'
              size='sm'
              type='button'
              onClick={() => setAttempt((n) => n + 1)}
            >
              {t('status.retry')}
            </Button>
          </AlertAction>
        </Alert>
      ) : result?.steps ? (
        <ChainSteps steps={result.steps} departmentTitle={departmentTitle} />
      ) : (
        <div
          className='space-y-2'
          role='status'
          aria-label={t('status.loading')}
        >
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className='h-6 w-full' />
          ))}
        </div>
      )}
    </section>
  );
}

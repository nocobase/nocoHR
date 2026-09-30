import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCwIcon, SparklesIcon } from 'lucide-react';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import {
  Navigate,
  NavLink,
  Outlet,
  matchPath,
  useLocation,
  useResolvedPath,
} from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { useRemote } from '@/components/talent/use-remote';
import { Button, buttonVariants } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import {
  OrgSyncAssistantSheet,
  type AssistantContext,
} from './assistant-sheet.js';
import { runToast } from './helpers.js';
import {
  ORG_SYNC_TABS,
  type OrgSyncOutletContext,
  type OrgSyncStatus,
  type SyncIssue,
  type SyncRun,
} from './types.js';

/**
 * Route `/settings/org-sync` (V1-03 组织同步): four tabs as child routes —
 * connection, runs, pending items and job-title mappings — under one header
 * with 立即同步. The status (settings, source, last run) is loaded here and
 * shared with the tabs; a run bumps `epoch` so every tab reloads. 问人事助理
 * opens the HR assistant with the current tab — and, from an item's own
 * button, that item — as context.
 */
export default function OrgSyncPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const parent = useResolvedPath('.');
  const status = useRemote<OrgSyncStatus>('talent/org-sync');
  const [epoch, setEpoch] = useState(0);
  const bump = useCallback(() => setEpoch((n) => n + 1), []);
  const [assistant, setAssistant] = useState<AssistantContext | null>(null);
  const canAsk = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'resolveIssues',
  }).can;
  const tab =
    ORG_SYNC_TABS.find(
      (name) =>
        matchPath(
          { path: `${parent.pathname}/${name}`, end: false },
          location.pathname,
        ) !== null,
    ) ?? 'connection';
  const askAssistant = useMemo(
    () =>
      canAsk
        ? (issue: SyncIssue | null) => setAssistant({ tab, issue })
        : undefined,
    [canAsk, tab],
  );
  const context = useMemo<OrgSyncOutletContext>(
    () => ({
      status: status.data,
      statusError: status.error,
      reloadStatus: status.reload,
      epoch,
      bump,
      askAssistant,
    }),
    [status.data, status.error, status.reload, epoch, bump, askAssistant],
  );
  if (
    matchPath({ path: parent.pathname, end: true }, location.pathname) !== null
  )
    return (
      <Navigate
        replace
        to={{ pathname: 'connection', search: location.search }}
      />
    );
  return (
    <PageContainer>
      <PageHeader
        title={t('orgSync.title')}
        description={t('orgSync.description')}
        actions={
          <>
            {askAssistant ? (
              <Button variant='outline' onClick={() => askAssistant(null)}>
                <SparklesIcon data-icon='inline-start' />
                {t('orgSync.assistant.action')}
              </Button>
            ) : null}
            <RunNowButton
              onDone={() => {
                status.reload();
                bump();
              }}
            />
          </>
        }
      />
      <nav
        aria-label={t('orgSync.tabs.label')}
        className='flex flex-wrap gap-1 border-b pb-2'
      >
        {ORG_SYNC_TABS.map((tab) => (
          <NavLink
            key={tab}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground',
            )}
            to={{ pathname: tab, search: location.search }}
          >
            {t(`orgSync.tabs.${tab}`)}
          </NavLink>
        ))}
      </nav>
      <Outlet context={context} />
      <OrgSyncAssistantSheet
        context={assistant}
        onClose={() => {
          setAssistant(null);
          // The assistant may have saved notes or drafted mappings.
          bump();
        }}
      />
    </PageContainer>
  );
}

/** 立即同步: a full sync that runs to completion before answering. */
function RunNowButton({ onDone }: { onDone: () => void }): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'run',
  });
  const [running, setRunning] = useState(false);
  if (!grant.can) return null;
  return (
    <Button
      disabled={running}
      onClick={() => {
        setRunning(true);
        api
          .request<{ data: SyncRun }>({
            path: 'talent/org-sync/run',
            method: 'POST',
          })
          .then(({ data }) => {
            toast.add(runToast(data, t));
            onDone();
          })
          .catch((cause: unknown) =>
            toast.add({ type: 'error', title: errorMessage(cause, t) }),
          )
          .finally(() => setRunning(false));
      }}
    >
      {running ? (
        <Spinner data-icon='inline-start' />
      ) : (
        <RefreshCwIcon data-icon='inline-start' />
      )}
      {t(running ? 'orgSync.run.running' : 'orgSync.run.action')}
    </Button>
  );
}

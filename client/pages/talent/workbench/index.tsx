import { ApiClientError, useApiClient } from '@nocobase/app-client';
import {
  useAuthorizationRevision,
  useCan,
} from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { ListChecks, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const groups = ['today', 'week', 'later', 'completed'] as const;
type Group = (typeof groups)[number];
interface Item {
  id: string;
  title: string;
  summary: string | null;
  link: string;
  sourceKind: 'approval' | 'ai' | 'rule';
  status: 'open' | 'done' | 'dismissed';
  dueAt: string | null;
  canComplete: boolean;
  canDismiss: boolean;
}
interface Result {
  items: Item[];
  total: number;
  counts: Record<Group, number>;
  timeZone: string;
  page: number;
}
const permission = (action: string) => ({
  resource: { type: 'composite', id: 'talent.workbench' },
  action,
});

export default function WorkbenchPage(): ReactElement {
  const revision = useAuthorizationRevision();
  // Rebuild on authorization revision so cached rows never survive an account/access change.
  return <Workbench key={String(revision)} />;
}

function Workbench(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const completeGrant = useCan(permission('complete'));
  const dismissGrant = useCan(permission('dismiss'));
  const [params, setParams] = useSearchParams();
  const group = groups.includes(params.get('group') as Group)
    ? (params.get('group') as Group)
    : 'today';
  const source = ['approval', 'ai', 'rule'].includes(params.get('source') ?? '')
    ? params.get('source')!
    : 'all';
  const page = Math.max(1, Math.min(100000, Number(params.get('page')) || 1));
  const [refresh, setRefresh] = useState(0);
  const key = JSON.stringify([group, source, page, refresh]);
  const [response, setResponse] = useState<{
    key: string;
    data?: Result;
    error?: unknown;
  }>();
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    open: boolean;
    item: Item | null;
    error?: string;
    terminal?: boolean;
  }>({ open: false, item: null });
  const focusRef = useRef<HTMLButtonElement>(null);
  const data = response?.data;
  const loading = response?.key !== key;
  const error = loading ? undefined : response?.error;
  const reload = () => setRefresh((value) => value + 1);
  useEffect(() => {
    const controller = new AbortController();
    api
      .request<{ data: Result }>({
        path: 'talent/work-items',
        query: { group, source, page },
        signal: controller.signal,
      })
      .then(
        ({ data: next }) => {
          if (!controller.signal.aborted) setResponse({ key, data: next });
        },
        (failure: unknown) => {
          if (!controller.signal.aborted)
            setResponse((old) => ({
              key,
              error: failure,
              data:
                failure instanceof ApiClientError &&
                [401, 403].includes(failure.status)
                  ? undefined
                  : old?.data,
            }));
        },
      );
    return () => controller.abort();
  }, [api, group, source, page, key]);
  function change(nextGroup: Group, nextSource = source, nextPage = 1): void {
    setParams({ group: nextGroup, source: nextSource, page: String(nextPage) });
  }
  async function finish(
    item: Item,
    action: 'complete' | 'dismiss',
  ): Promise<void> {
    if (busy) return;
    setBusy(item.id);
    try {
      await api.request({
        path: `talent/work-items/${encodeURIComponent(item.id)}/${action}`,
        method: 'POST',
      });
      setResponse((old) =>
        old?.data
          ? {
              ...old,
              data: {
                ...old.data,
                items: old.data.items.filter((row) => row.id !== item.id),
                total: Math.max(0, old.data.total - 1),
                counts: {
                  ...old.data.counts,
                  [group]: Math.max(0, old.data.counts[group] - 1),
                  completed: old.data.counts.completed + 1,
                },
              },
            }
          : old,
      );
      setDialog((old) => ({ ...old, open: false }));
      toast.add({
        type: 'success',
        title: t(
          action === 'complete'
            ? 'workbench.doneToast'
            : 'workbench.dismissedToast',
          { title: item.title },
        ),
      });
      focusRef.current?.focus();
      reload();
    } catch (failure) {
      const status = failure instanceof ApiClientError ? failure.status : 0;
      const message = t(
        status === 404
          ? 'workbench.missing'
          : status === 409
            ? 'workbench.conflict'
            : status === 403
              ? 'workbench.forbidden'
              : 'workbench.saveFailed',
      );
      if (action === 'dismiss')
        setDialog((old) => ({
          ...old,
          error: message,
          terminal: [403, 404, 409].includes(status),
        }));
      else toast.add({ type: 'error', title: message });
      if ([403, 404, 409].includes(status)) {
        reload();
        focusRef.current?.focus();
      }
    } finally {
      setBusy(null);
    }
  }
  const format = new Intl.NumberFormat(locale);
  const retryable = !(
    error instanceof ApiClientError && [401, 403].includes(error.status)
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('workbench.title')}
        description={t('workbench.description')}
        actions={
          <Button
            variant='outline'
            disabled={loading || Boolean(busy)}
            onClick={reload}
          >
            {loading ? <Spinner /> : null}
            {t('workbench.refresh')}
          </Button>
        }
      />
      <div className='flex flex-wrap gap-2'>
        {groups.map((value, index) => (
          <Button
            key={value}
            ref={index === 0 ? focusRef : undefined}
            variant='outline'
            className='min-h-11 aria-pressed:bg-accent'
            aria-pressed={group === value}
            onClick={() => change(value)}
          >
            {t(`workbench.${value}`)}{' '}
            {data ? format.format(data.counts[value]) : '—'}
          </Button>
        ))}
      </div>
      <div className='flex flex-wrap items-center gap-2'>
        <label htmlFor='workbench-source'>{t('workbench.source')}</label>
        <select
          id='workbench-source'
          className='min-h-11 rounded-md border bg-background px-3 text-sm'
          value={source}
          onChange={(event) => change(group, event.target.value)}
        >
          {['all', 'approval', 'ai', 'rule'].map((value) => (
            <option key={value} value={value}>
              {t(`workbench.${value}`)}
            </option>
          ))}
        </select>
        {source !== 'all' || group !== 'today' ? (
          <Button
            variant='ghost'
            onClick={() => {
              change('today', 'all');
              focusRef.current?.focus();
            }}
          >
            {t('workbench.clear')}
          </Button>
        ) : null}
      </div>
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t(
              error instanceof ApiClientError && error.status === 403
                ? 'workbench.forbidden'
                : 'workbench.failed',
            )}
          </AlertDescription>
          {retryable ? (
            <Button
              variant='outline'
              onClick={() => {
                reload();
                focusRef.current?.focus();
              }}
            >
              {t('workbench.retry')}
            </Button>
          ) : (
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to='/login' />}
            >
              {t('workbench.signIn')}
            </Button>
          )}
        </Alert>
      ) : !data ? (
        <div
          role='status'
          aria-label={t('workbench.loading')}
          className='space-y-4'
        >
          <Skeleton className='h-32 w-full' />
          <Skeleton className='h-32 w-full' />
        </div>
      ) : (
        <>
          {data.items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <ListChecks />
                </EmptyMedia>
                <EmptyTitle>
                  {t(
                    Object.values(data.counts).some(Boolean)
                      ? 'workbench.noResults'
                      : 'workbench.emptyTitle',
                  )}
                </EmptyTitle>
                <EmptyDescription>
                  {t('workbench.emptyDescription')}
                </EmptyDescription>
              </EmptyHeader>
              <Button
                variant='outline'
                onClick={() => {
                  change('today', 'all');
                  reload();
                  focusRef.current?.focus();
                }}
              >
                {t('workbench.clear')}
              </Button>
            </Empty>
          ) : (
            data.items.map((item) => (
              <Card key={item.id}>
                <CardHeader>
                  <CardTitle>
                    <Link
                      className='break-words hover:underline'
                      to={item.link}
                    >
                      {item.title}
                    </Link>
                  </CardTitle>
                  <div className='flex flex-wrap gap-2'>
                    <Badge variant='secondary'>
                      {t(`workbench.${item.sourceKind}`)}
                    </Badge>
                    <Badge variant='outline'>
                      {t(`workbench.${item.status}`)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className='space-y-2 break-words'>
                  {item.summary ? <p>{item.summary}</p> : null}
                  <p className='text-muted-foreground'>
                    {item.dueAt
                      ? new Intl.DateTimeFormat(locale, {
                          timeZone: data.timeZone,
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(item.dueAt))
                      : t('workbench.noDue')}
                  </p>
                  {item.sourceKind === 'approval' ? (
                    <p className='text-muted-foreground'>
                      {t('workbench.automatic')}
                    </p>
                  ) : null}
                </CardContent>
                <CardFooter className='justify-between gap-2'>
                  <Button
                    variant='outline'
                    className='min-h-11'
                    nativeButton={false}
                    render={<Link to={item.link} />}
                  >
                    {t('workbench.go')}
                  </Button>
                  {(item.canComplete && completeGrant.can) ||
                  (item.canDismiss && dismissGrant.can) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant='ghost'
                            className='min-h-11 min-w-11'
                            aria-label={t('workbench.more', {
                              title: item.title,
                            })}
                            disabled={loading || Boolean(busy)}
                          />
                        }
                      >
                        {busy === item.id ? <Spinner /> : <MoreHorizontal />}
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        {item.canComplete && completeGrant.can ? (
                          <DropdownMenuItem
                            onClick={() => void finish(item, 'complete')}
                          >
                            {t('workbench.complete')}
                          </DropdownMenuItem>
                        ) : null}
                        {item.canDismiss && dismissGrant.can ? (
                          <DropdownMenuItem
                            variant='destructive'
                            onClick={() => setDialog({ open: true, item })}
                          >
                            {t('workbench.dismiss')}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </CardFooter>
              </Card>
            ))
          )}
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <Button
              variant='outline'
              disabled={page <= 1 || loading}
              onClick={() => change(group, source, page - 1)}
            >
              {t('workbench.previous')}
            </Button>
            <span>
              {t('workbench.page', {
                page: format.format(page),
                total: format.format(data.total),
              })}
            </span>
            <Button
              variant='outline'
              disabled={page * 25 >= data.total || loading}
              onClick={() => change(group, source, page + 1)}
            >
              {t('workbench.next')}
            </Button>
          </div>
        </>
      )}
      <AlertDialog
        open={dialog.open}
        onOpenChange={(open) => {
          if (!busy) {
            setDialog((old) => ({ ...old, open }));
            if (!open) focusRef.current?.focus();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('workbench.dismissTitle', { title: dialog.item?.title ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('workbench.dismissDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {dialog.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{dialog.error}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>
              {t(dialog.terminal ? 'workbench.close' : 'workbench.cancel')}
            </AlertDialogCancel>
            {!dialog.terminal ? (
              <AlertDialogAction
                variant='destructive'
                disabled={Boolean(busy)}
                onClick={() => {
                  if (dialog.item) void finish(dialog.item, 'dismiss');
                }}
              >
                {busy ? <Spinner /> : null}
                {t('workbench.dismiss')}
              </AlertDialogAction>
            ) : null}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

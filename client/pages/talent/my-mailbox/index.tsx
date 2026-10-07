/**
 * 我的邮箱 `/talent/my-mailbox` (业务邮件改用 Mail 插件, 2026-10-05): a user
 * connects their own mailbox through the Mail plugin — IMAP/SMTP with the
 * mailbox's authorization code, or Gmail / Microsoft 365 by signing in there
 * — so their correspondence with a candidate shows on the application, and
 * removes it again. The plugin keeps the credentials and checks the
 * ownership; this page only composes its public components. A Gmail or
 * Microsoft 365 authorization returns here with `?mailAuthorization=`.
 *
 * 允许作为业务邮箱 (readiness review 2026-10-07): an HR administrator can bind
 * only an account its owner allowed here; the owner is told when it is bound.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  MailAccountCard,
  MailAccountConnector,
} from '@nocobase/app-plugin-mail/client/components';
import {
  mailErrorMessage,
  useMailClient,
  type MailAccountView,
  type MailProviderView,
} from '@nocobase/app-plugin-mail/client';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, EmptyState } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

/** The history a new mailbox brings along: the last three months. */
const historyStart = (): string =>
  new Date(Date.now() - 90 * 86_400_000).toISOString();

export default function MyMailboxPage(): ReactElement {
  const { t } = useTranslation();
  const mail = useMailClient();
  const [params, setParams] = useSearchParams();
  const [providers, setProviders] = useState<readonly MailProviderView[]>();
  const [accounts, setAccounts] = useState<readonly MailAccountView[]>();
  const [connecting, setConnecting] = useState<string>();
  const [showConnector, setShowConnector] = useState(false);
  const [error, setError] = useState<string>();
  const authorization = params.get('mailAuthorization');
  // A business mailbox (招聘邮箱 …) bound to one of the user's accounts: marked, and unbound on 设置 / 邮件 before removal.
  const bindings = useRemote<{ purpose: string; accountId: string }[]>(
    'talent/mail/mine/bindings',
  );
  // The accounts the user allowed as business mailboxes.
  const offers = useRemote<string[]>('talent/mail/mine/offers');
  const api = useApiClient();
  const [savingOffer, setSavingOffer] = useState<string>();
  const setOffer = (accountId: string, offered: boolean) => {
    setSavingOffer(accountId);
    void api
      .request({
        path: `talent/mail/mine/offers/${encodeURIComponent(accountId)}`,
        method: 'PUT',
        json: { offered },
      })
      .then(() => {
        toast.add({
          type: 'success',
          title: offered ? t('myMailbox.offered') : t('myMailbox.withdrawn'),
        });
        offers.reload();
      })
      .catch((cause: unknown) =>
        toast.add({
          type: 'error',
          title: errorMessage(cause, t),
        }),
      )
      .finally(() => setSavingOffer(undefined));
  };

  const refresh = useCallback(() => {
    void Promise.all([mail.listProviders(), mail.listAccounts()])
      .then(([p, a]) => {
        setProviders(p);
        setAccounts(a);
      })
      .catch((cause: unknown) =>
        setError(mailErrorMessage(cause, t('myMailbox.loadFailed'))),
      );
  }, [mail, t]);

  useEffect(() => refresh(), [refresh]);

  // Removal finishes in the background: while an account is being removed, look again every two seconds.
  const removing = (accounts ?? []).some((a) => a.status === 'removing');
  useEffect(() => {
    if (!removing) return;
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [removing, refresh]);

  const done = () => {
    setConnecting(undefined);
    setShowConnector(false);
    refresh();
  };

  const labels = {
    accountType: t('myMailbox.accountType'),
    chooseAccountType: t('myMailbox.chooseAccountType'),
    connect: t('myMailbox.connect'),
    connecting: t('myMailbox.connecting'),
    connectedAccounts: (count: number) =>
      t('myMailbox.connectedAccounts', { count }),
    capability: (capability: string) =>
      t(`myMailbox.capabilities.${capability}`, { defaultValue: capability }),
    configurationRequired: t('myMailbox.configurationRequired'),
    emailAddress: t('myMailbox.emailAddress'),
    username: t('myMailbox.username'),
    password: t('myMailbox.password'),
    displayName: t('myMailbox.displayName'),
  };

  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={t('myMailbox.title')}
        description={t('myMailbox.description')}
        actions={
          <Button onClick={() => setShowConnector((v) => !v)}>
            {t('myMailbox.add')}
          </Button>
        }
      />
      {authorization ? (
        <Alert
          variant={authorization === 'success' ? 'default' : 'destructive'}
        >
          <AlertDescription>
            {authorization === 'success'
              ? t('myMailbox.authorized')
              : t('myMailbox.authorizationFailed')}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {showConnector && providers ? (
        <MailAccountConnector
          providers={providers}
          connectedAccountCount={(provider) =>
            (accounts ?? []).filter(
              (a) =>
                a.provider.type === provider.type &&
                a.provider.name === provider.name,
            ).length
          }
          {...(connecting ? { connectingProviderName: connecting } : {})}
          labels={labels}
          onConnect={(provider) => {
            setConnecting(provider.name);
            setError(undefined);
            void mail
              .startAuthorization({
                type: provider.type,
                name: provider.name,
                initialSyncReceivedAfter: historyStart(),
              })
              .then((result) => window.location.assign(result.authorizationUrl))
              .catch((cause: unknown) => {
                setError(
                  mailErrorMessage(cause, t('myMailbox.authorizationFailed')),
                );
                setConnecting(undefined);
              });
          }}
          onConnectCredentials={(provider, credentials) => {
            setConnecting(provider.name);
            setError(undefined);
            void mail
              .connectAccount({
                type: provider.type,
                name: provider.name,
                initialSyncReceivedAfter: historyStart(),
                ...credentials,
              })
              .then(() => {
                toast.add({
                  type: 'success',
                  title: t('myMailbox.authorized'),
                });
                done();
              })
              .catch((cause: unknown) => {
                setError(mailErrorMessage(cause, t('myMailbox.connectFailed')));
                setConnecting(undefined);
              });
          }}
        />
      ) : null}
      {!accounts ? (
        <BlockSkeleton rows={2} />
      ) : !accounts.length ? (
        <EmptyState
          title={t('myMailbox.empty')}
          description={t('myMailbox.emptyHint')}
        />
      ) : (
        <ul className='space-y-3'>
          {accounts.map((account) => (
            <li key={account.id} className='space-y-2'>
              <MailAccountCard
                account={account}
                providerLabel={
                  providers?.find(
                    (p) =>
                      p.type === account.provider.type &&
                      p.name === account.provider.name,
                  )?.label ?? account.provider.type
                }
                statusLabel={t(`myMailbox.status.${account.status}`, {
                  defaultValue: account.status,
                })}
              />
              <Field orientation='horizontal'>
                <Switch
                  id={`mail-offer-${account.id}`}
                  checked={Boolean(offers.data?.includes(account.id))}
                  disabled={
                    !offers.data ||
                    savingOffer === account.id ||
                    Boolean(
                      bindings.data?.some((b) => b.accountId === account.id),
                    )
                  }
                  onCheckedChange={(checked) => setOffer(account.id, checked)}
                />
                <FieldContent>
                  <FieldLabel htmlFor={`mail-offer-${account.id}`}>
                    {t('myMailbox.offer')}
                  </FieldLabel>
                  <FieldDescription>
                    {t('myMailbox.offerHint')}
                  </FieldDescription>
                </FieldContent>
              </Field>
              {(() => {
                const bound = bindings.data?.find(
                  (b) => b.accountId === account.id,
                );
                return bound ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('myMailbox.business', {
                      purpose: t(`mail.purposes.${bound.purpose}`),
                    })}
                  </p>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={<Button variant='outline' size='sm' />}
                    >
                      {t('myMailbox.remove')}
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('myMailbox.removeTitle')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('myMailbox.removeDescription', {
                            address: account.address,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {t('myMailbox.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          variant='destructive'
                          onClick={() => {
                            void mail
                              .removeAccount(account.id)
                              .then(() => {
                                toast.add({
                                  type: 'success',
                                  title: t('myMailbox.removed'),
                                });
                                if (authorization) {
                                  const next = new URLSearchParams(params);
                                  next.delete('mailAuthorization');
                                  setParams(next, { replace: true });
                                }
                                refresh();
                              })
                              .catch((cause: unknown) =>
                                toast.add({
                                  type: 'error',
                                  title: mailErrorMessage(
                                    cause,
                                    t('myMailbox.removeFailed'),
                                  ),
                                }),
                              );
                          }}
                        >
                          {t('myMailbox.remove')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                );
              })()}
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}

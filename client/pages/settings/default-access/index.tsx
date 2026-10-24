import { ApiClientError, useApiClient } from '@nocobase/app-client';
import {
  useAuthorizationClient,
  useAuthorizationRevision,
  useCan,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import { DEFAULT_ACCESS_SETTINGS, listDefaultAccess } from './api.js';
import type { DefaultAccessRule } from './model.js';
import { loadDefaultAccessOptions } from './api.js';
import type { AuthorizationOptionsResponse } from './model.js';
import { localizeOptions } from '../inspector/components/localized-options.js';
import { useAuthorizationTranslation } from '../inspector/i18n.js';
import { ErrorBox } from '../inspector/components/feedback.js';
import {
  PageLoading,
  PermissionsPage,
} from '../inspector/components/page-shell.js';
import { DefaultAccessPanel } from './panel.js';

type LoadedData = {
  options: AuthorizationOptionsResponse;
  rules: readonly DefaultAccessRule[];
};

export default function DefaultAccessPage(): ReactElement {
  const revision = useAuthorizationRevision();
  const { t } = useTranslation();
  const permission = useCan({
    resource: DEFAULT_ACCESS_SETTINGS,
    action: 'read',
  });
  const title = t('defaultAccess.page.title');
  const description = t('defaultAccess.page.description');

  return (
    <PermissionsPage title={title} description={description}>
      {permission.isPending ? (
        <PageLoading />
      ) : !permission.can ? (
        <PermissionFailure cause={permission.error} retry={permission.retry} />
      ) : (
        <DefaultAccessLoader key={revision} />
      )}
    </PermissionsPage>
  );
}

function DefaultAccessLoader(): ReactElement {
  const api = useApiClient();
  const authz = useAuthorizationClient();
  const t = useAuthorizationTranslation();
  const { t: translateOption } = useTranslation();
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<LoadedData>();
  const [error, setError] = useState<unknown>();
  const options = useMemo(
    () =>
      data
        ? {
            raw: data.options,
            localized: localizeOptions(data.options, translateOption),
          }
        : undefined,
    [data, translateOption],
  );
  const reload = useCallback(() => {
    setData(undefined);
    setError(undefined);
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      loadDefaultAccessOptions(authz),
      listDefaultAccess(api),
    ]).then(
      ([nextOptions, rules]) => {
        if (active) setData({ options: nextOptions, rules });
      },
      (cause: unknown) => {
        if (!active) return;
        setError(cause);
        if (isStatus(cause, 403)) authz.invalidate();
      },
    );
    return () => {
      active = false;
    };
  }, [api, authz, attempt]);

  if (error !== undefined)
    return <PermissionFailure cause={error} retry={reload} />;
  if (!data || !options) return <PageLoading />;

  return (
    <DefaultAccessPanel
      initialRules={data.rules}
      options={options.localized}
      refreshRules={async () => listDefaultAccess(api)}
      onForbidden={() => {
        setData(undefined);
        setError(new Error(t('defaultAccess.errors.forbidden')));
        authz.invalidate();
      }}
    />
  );
}

function PermissionFailure({
  cause,
  retry,
}: {
  cause: unknown;
  retry: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const status = cause instanceof ApiClientError ? cause.status : undefined;
  const message =
    status === 401
      ? t('defaultAccess.errors.sessionEnded')
      : status === 403 || cause === undefined
        ? t('defaultAccess.errors.forbidden')
        : t('defaultAccess.errors.requestFailed');
  const retryable = cause !== undefined && status !== 401 && status !== 403;
  return (
    <div className='flex flex-col gap-3'>
      <ErrorBox value={message} />
      {retryable ? (
        <button
          type='button'
          className='w-fit rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring'
          onClick={retry}
        >
          {t('defaultAccess.errors.retry')}
        </button>
      ) : null}
    </div>
  );
}

function isStatus(value: unknown, status: number): boolean {
  return value instanceof ApiClientError && value.status === status;
}

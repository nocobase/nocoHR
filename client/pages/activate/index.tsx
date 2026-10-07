/**
 * （公开）激活账号 `/activate/:token` (上线准备 · 批量开通账号): the link HR sent
 * an employee by Feishu or work email, or handed over. It shows the person's
 * name and login; the password is set by `/api/public/activation/:token`
 * through the authentication plugin's `resetPassword` (its length rule
 * applies), and the person is then signed in with the plugin's own password
 * sign-in. A used, replaced, revoked or expired link shows only that it is
 * no longer valid. Usable at 375px.
 */
import { useApiClient } from '@nocobase/app-client';
import { usePasswordLogin } from '@nocobase/app-plugin-authentication/client/actions';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { PasswordResetForm } from '@/extensions/nocobase-auth-forms/password-reset-form';
import { errorMessage } from '@/components/talent/errors';
import { useRemote } from '@/components/talent/use-remote';
import { Skeleton } from '@/components/ui/skeleton';

import { AuthPage } from '../auth/shared.js';

interface ActivationView {
  name: string;
  login: string;
  company: string;
  expiresAt: string;
  minPasswordLength: number;
  maxPasswordLength: number;
}

export default function ActivatePage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const login = usePasswordLogin();
  const { token = '' } = useParams();
  const path = `public/activation/${encodeURIComponent(token)}`;
  const view = useRemote<ActivationView>(path);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);

  async function activate(password: string): Promise<void> {
    if (!view.data) return;
    setPending(true);
    setError(undefined);
    try {
      await api.request({ path, method: 'POST', json: { password } });
    } catch (cause) {
      setError(errorMessage(cause, t));
      setPending(false);
      return;
    }
    setDone(true);
    // The plugin's own password sign-in; the landing page then forwards to the person's first page.
    await login.submit({ identifier: view.data.login, password });
    setPending(false);
    void navigate('/', { replace: true });
  }

  const data = view.data;
  return (
    <AuthPage
      title={t('goLive.activate.title')}
      description={t('goLive.activate.description')}
    >
      {view.error ? (
        <div className='flex flex-col gap-4'>
          <p className='text-sm text-muted-foreground'>
            {t('goLive.activate.invalid')}
          </p>
          <Link className='text-sm underline underline-offset-4' to='/login'>
            {t('goLive.activate.toLogin')}
          </Link>
        </div>
      ) : !data ? (
        <Skeleton className='h-48 w-full' />
      ) : (
        <div className='flex flex-col gap-6'>
          <div className='flex flex-col gap-1 text-sm'>
            <p className='font-medium'>
              {t('goLive.activate.greeting', { name: data.name })}
            </p>
            <p className='text-muted-foreground'>
              {t('goLive.activate.login', { login: data.login })}
            </p>
            {data.company ? (
              <p className='text-muted-foreground'>
                {t('goLive.activate.company', { company: data.company })}
              </p>
            ) : null}
            <p className='text-muted-foreground'>
              {t('goLive.activate.passwordHint', {
                min: data.minPasswordLength,
              })}
            </p>
          </div>
          {done ? (
            <p className='text-sm' role='status'>
              {t('goLive.activate.done')}
            </p>
          ) : (
            <PasswordResetForm
              error={error}
              footer={<Link to='/login'>{t('goLive.activate.toLogin')}</Link>}
              labels={{
                confirmPassword: t('goLive.activate.confirmPassword'),
                password: t('goLive.activate.password'),
                passwordMismatch: t('goLive.activate.passwordMismatch'),
                submit: t('goLive.activate.submit'),
                submitting: t('goLive.activate.submitting'),
              }}
              onSubmit={({ password }) => activate(password)}
              submitting={pending}
            />
          )}
        </div>
      )}
    </AuthPage>
  );
}

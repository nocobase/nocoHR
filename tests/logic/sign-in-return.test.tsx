import {
  apiClientToken,
  ClientApplicationContext,
  type ClientApplication,
  createAppClientConfig,
} from '@nocobase/app-client';
import type { AppClientRegisteredRoute } from '@nocobase/app-client/plugins';
import {
  AuthenticationProvider,
  authenticationClientToken,
  useAuthentication,
} from '@nocobase/app-plugin-authentication/client';
import {
  AuthorizationClient,
  authorizationClientToken,
} from '@nocobase/app-plugin-authorization/client';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRouter } from '../../client/routing/app-router.tsx';
import {
  readSignInReturn,
  signInPathFor,
  toSafeReturnPath,
} from '../../client/routing/sign-in-return.ts';
import { AppThemeProvider } from '../../client/theme/index.ts';

const DEEP_LINK = '/talent/actions/new?type=regularize&employeeId=emp-sunli';

describe('sign-in return target', () => {
  it('keeps an application path with its query and hash', () => {
    expect(toSafeReturnPath(DEEP_LINK)).toBe(DEEP_LINK);
    expect(toSafeReturnPath('/talent/me#certificates')).toBe(
      '/talent/me#certificates',
    );
    expect(toSafeReturnPath('/talent/../settings/users')).toBe(
      '/settings/users',
    );
  });

  it.each([
    ['empty', ''],
    ['absolute URL', 'https://evil.example/talent'],
    ['javascript URL', 'javascript:alert(1)'],
    ['protocol-relative', '//evil.example/talent'],
    ['backslash protocol-relative', '/\\evil.example'],
    ['relative without slash', 'talent/ask'],
    ['control character', '/talent\n//evil.example'],
    ['tab', '/\t/evil.example'],
    ['login page', '/login?redirect=/talent/ask'],
    ['guest page with slash', '/register/'],
  ])('rejects %s', (_label, value) => {
    expect(toSafeReturnPath(value)).toBeNull();
  });

  it('reads the target from the search string and refuses unsafe ones', () => {
    expect(readSignInReturn(`?redirect=${encodeURIComponent(DEEP_LINK)}`)).toBe(
      DEEP_LINK,
    );
    expect(readSignInReturn('?redirect=https%3A%2F%2Fevil.example')).toBe(null);
    expect(readSignInReturn('?redirect=%2F%2Fevil.example')).toBeNull();
    expect(readSignInReturn('')).toBeNull();
  });

  it('builds the sign-in path, leaving it plain for the home page', () => {
    expect(
      signInPathFor({
        pathname: '/talent/actions/new',
        search: '?type=regularize&employeeId=emp-sunli',
        hash: '',
      }),
    ).toBe(`/login?redirect=${encodeURIComponent(DEEP_LINK)}`);
    expect(signInPathFor({ pathname: '/', search: '', hash: '' })).toBe(
      '/login',
    );
  });
});

describe('signing in from a deep link', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches: query === '(min-width: 768px)',
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });

  it('carries the requested page to /login and returns there after sign-in', async () => {
    const auth = renderApplication(DEEP_LINK);

    expect(await screen.findByText('Sign-in page')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login?redirect=${encodeURIComponent(DEEP_LINK)}`,
    );

    auth.signIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Action form')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(DEEP_LINK);
  });

  it('lands on the home page when the return target is unsafe', async () => {
    const auth = renderApplication(
      '/login?redirect=%2F%2Fevil.example%2Ftalent',
    );
    expect(await screen.findByText('Sign-in page')).toBeVisible();

    auth.signIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Home page')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
  });

  it('honours the return target on the other guest pages', async () => {
    const auth = renderApplication(
      `/register?redirect=${encodeURIComponent(DEEP_LINK)}`,
    );
    expect(await screen.findByText('Registration page')).toBeVisible();

    auth.signIn();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Action form')).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(DEEP_LINK);
  });
});

function renderApplication(initialEntry: string): { signIn: () => void } {
  let signedIn = false;
  const authClient = {
    getSession: vi.fn(async () => ({
      data: signedIn
        ? {
            session: null,
            user: {
              email: 'alice@example.com',
              id: '1',
              image: null,
              name: 'Alice',
            },
          }
        : null,
    })),
    signOut: vi.fn().mockResolvedValue({ data: null }),
  };
  const authorizationClient = new AuthorizationClient({
    request: vi.fn(),
  } as never);
  vi.spyOn(authorizationClient, 'can').mockResolvedValue(true);
  const registered = new Map<unknown, unknown>([
    [
      apiClientToken,
      {
        request: vi.fn().mockResolvedValue({
          fallback: false,
          locale: 'en-US',
          requestedLocale: 'en-US',
        }),
      },
    ],
    [authenticationClientToken, authClient],
    [authorizationClientToken, authorizationClient],
  ]);
  const app = {
    config: createAppClientConfig({ rawConfig: {} }),
    runtime: { settingsRouteTree: [] },
    services: {
      has: (token: unknown) => registered.has(token),
      resolve: (token: unknown) => {
        if (registered.has(token)) return registered.get(token);
        throw new Error(`Unexpected service token: ${String(token)}`);
      },
    },
  } as unknown as ClientApplication;

  render(
    <ClientApplicationContext.Provider value={app}>
      <AuthenticationProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AppThemeProvider>
            <AppRouter
              clientRoutes={[
                createRoute('home', '/', 'required', HomePage),
                createRoute(
                  'talent-actions-new',
                  '/talent/actions/new',
                  'required',
                  ActionPage,
                ),
                createRoute('login', '/login', 'guest', LoginPage),
                createRoute('register', '/register', 'guest', RegisterPage),
              ]}
              devRouteTree={[]}
              settingsRouteTree={[]}
            />
          </AppThemeProvider>
          <LocationProbe />
        </MemoryRouter>
      </AuthenticationProvider>
    </ClientApplicationContext.Provider>,
  );

  return {
    signIn: () => {
      signedIn = true;
    },
  };
}

function createRoute(
  name: string,
  path: string,
  auth: AppClientRegisteredRoute['auth'],
  Component: ComponentType,
): AppClientRegisteredRoute {
  return {
    auth,
    authz: 'skip',
    componentLoader: async () => ({ default: Component }),
    id: `@nocobase/app-template-default:${name}`,
    name,
    packageName: '@nocobase/app-template-default',
    path,
    source: 'application',
  };
}

function LocationProbe(): ReactElement {
  const location = useLocation();
  return (
    <output data-testid='location'>
      {`${location.pathname}${location.search}${location.hash}`}
    </output>
  );
}

// Stands in for a sign-in form: the plugin's actions refresh the session after a successful sign-in.
function SignInButton(): ReactElement {
  const { refresh } = useAuthentication();
  return (
    <button onClick={() => void refresh()} type='button'>
      Sign in
    </button>
  );
}

function LoginPage(): ReactElement {
  return (
    <div>
      <p>Sign-in page</p>
      <SignInButton />
    </div>
  );
}

function RegisterPage(): ReactElement {
  return (
    <div>
      <p>Registration page</p>
      <SignInButton />
    </div>
  );
}

function HomePage(): ReactElement {
  return <p>Home page</p>;
}

function ActionPage(): ReactElement {
  return <p>Action form</p>;
}

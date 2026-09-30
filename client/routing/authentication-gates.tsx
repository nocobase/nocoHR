/**
 * Application gates around the authentication plugin's guards.
 *
 * `RequiredAuthentication` redirects an anonymous visitor to a fixed `/login` and `GuestAuthentication` sends a
 * signed-in one to a fixed `/`; neither carries the requested location, and the plugin offers no option for it. Its
 * Skill says an application needing a different landing page redirects again instead of forking the guard, so these
 * gates take the redirect first, with the location carried in `?redirect=` (see `sign-in-return.ts`), and otherwise
 * render the plugin's guard unchanged, which stays in charge of the pending state.
 */
import {
  GuestAuthentication,
  RequiredAuthentication,
  useAuthentication,
} from '@nocobase/app-plugin-authentication/client';
import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { readSignInReturn, signInPathFor } from './sign-in-return.js';

export function RequireSignIn(inputProps: {
  readonly children: ReactNode;
}): ReactElement {
  const { session, isPending } = useAuthentication();
  const location = useLocation();
  if (!isPending && !session) {
    return <Navigate replace to={signInPathFor(location)} />;
  }
  return <RequiredAuthentication>{inputProps.children}</RequiredAuthentication>;
}

export function GuestOnly(inputProps: {
  readonly children: ReactNode;
}): ReactElement {
  const { session, isPending } = useAuthentication();
  const location = useLocation();
  if (!isPending && session) {
    return <Navigate replace to={readSignInReturn(location.search) ?? '/'} />;
  }
  return <GuestAuthentication>{inputProps.children}</GuestAuthentication>;
}

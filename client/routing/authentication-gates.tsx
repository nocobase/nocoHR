/**
 * Application gates around the authentication plugin's guards.
 *
 * RequiredAuthentication still sends guests to a fixed /login. The target guest guard reads a return query,
 * while the application also rejects backslashes, control characters, guest targets and external URLs.
 * Keep the requested path/query/hash through sign-in and apply that stricter validation before the native guard.
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

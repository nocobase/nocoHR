/**
 * Where a visitor returns after signing in.
 *
 * The authentication plugin's guards redirect to a fixed `/login` and, once signed in, to a fixed `/`, so a deep link
 * opened while signed out used to lose its path and query. The application's gates in `authentication-gates.tsx`
 * carry the requested location in `?redirect=` and read it back here. The value is only ever an application-internal
 * path, relative to the router's basename: anything that could leave the application is refused.
 */
import type { Location } from 'react-router';

export const SIGN_IN_RETURN_PARAM = 'redirect';

// The guest pages themselves are never a return target: returning to one would bounce straight back to `/`.
const GUEST_PATHS = new Set([
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
]);

// Only used to parse and normalize a relative path; a result on any other origin is refused.
const PARSE_ORIGIN = 'http://app.invalid';

/**
 * Returns the normalized path, search and hash when `value` is a safe return target, otherwise `null`.
 * Accepts only a path starting with a single `/`; rejects absolute and protocol-relative URLs, backslashes, control
 * characters, guest pages and anything that resolves to another origin.
 */
export function toSafeReturnPath(
  value: string | null | undefined,
): string | null {
  if (!value || value.length > 2048) return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  // Browsers read `\` as `/` in URLs, so `/\evil.example` would be protocol-relative.
  if (value.includes('\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, PARSE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== PARSE_ORIGIN) return null;
  if (GUEST_PATHS.has(url.pathname.replace(/\/+$/, '') || '/')) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/** Reads a safe return target from a guest page's search string. */
export function readSignInReturn(search: string): string | null {
  return toSafeReturnPath(
    new URLSearchParams(search).get(SIGN_IN_RETURN_PARAM),
  );
}

/** The sign-in path that returns to `location` afterwards; plain `/login` when there is nothing worth returning to. */
export function signInPathFor(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
): string {
  const target = toSafeReturnPath(
    `${location.pathname}${location.search}${location.hash}`,
  );
  if (!target || target === '/') return '/login';
  return `/login?${new URLSearchParams({ [SIGN_IN_RETURN_PARAM]: target }).toString()}`;
}

import type { AppClientRegisteredRoute } from '@nocobase/app-client/plugins';

/** Client 3 has one route space; NocoHR retains its existing shells by path. */
export function filterRouteTree(
  routes: readonly AppClientRegisteredRoute[],
  predicate: (route: AppClientRegisteredRoute) => boolean,
): AppClientRegisteredRoute[] {
  return routes.flatMap((route) => {
    if (route.componentLoader) return predicate(route) ? [route] : [];
    const children = filterRouteTree(route.children ?? [], predicate);
    return children.length ? [{ ...route, children }] : [];
  });
}
export function inSurface(path: string, surface: 'settings' | 'dev'): boolean {
  return path === `/${surface}` || path.startsWith(`/${surface}/`);
}
export function surfaceRoutes(
  routes: readonly AppClientRegisteredRoute[],
  surface: 'settings' | 'dev',
): AppClientRegisteredRoute[] {
  return filterRouteTree(
    routes,
    (route) => route.auth === 'required' && inSurface(route.path, surface),
  ).flatMap((route) =>
    route.source === 'application' &&
    route.path === `/${surface}` &&
    !route.componentLoader
      ? [...(route.children ?? [])]
      : [route],
  );
}

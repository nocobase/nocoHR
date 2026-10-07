// @vitest-environment node
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { Application } from '@nocobase/app-server/application';

import {
  buildContentSecurityPolicy,
  contentSecurityPolicyMiddleware,
} from '../../server/http/content-security-policy.js';

function appWith(values: Record<string, unknown>): Application {
  return {
    config: { get: (key: string) => values[key] },
  } as unknown as Application;
}

async function routerFor(values: Record<string, unknown>) {
  const router = new Hono();
  await contentSecurityPolicyMiddleware.register(router, appWith(values));
  router.get('/main/talent/ask', (c) => c.html('<!doctype html><p>app</p>'));
  router.get('/main/api/talent/doc', (c) => c.html('<p>print</p>'));
  router.get('/main/assets/app.js', (c) =>
    c.body('x', 200, { 'content-type': 'text/javascript' }),
  );
  return router;
}

describe('Content-Security-Policy (readiness review 2026-10-07)', () => {
  it('keeps images, scripts and connections on the application origin', () => {
    const policy = buildContentSecurityPolicy();
    expect(policy).toContain(`img-src 'self' data: blob:`);
    expect(policy).toContain(`script-src 'self'`);
    expect(policy).toContain(`connect-src 'self'`);
    expect(policy).toContain(`frame-ancestors 'self'`);
    expect(policy).toContain(`object-src 'none'`);
    expect(policy).not.toMatch(/img-src[^;]*https:/u);
  });

  it('adds configured origins, e.g. a file bucket', () => {
    const policy = buildContentSecurityPolicy({
      imgSrc: ['https://files.example.com'],
      connectSrc: [],
      frameSrc: [],
    });
    expect(policy).toContain(
      `img-src 'self' data: blob: https://files.example.com`,
    );
  });

  it('is sent with the application page only', async () => {
    const router = await routerFor({
      contentSecurityPolicy: { enabled: true },
    });
    const page = await router.request('/main/talent/ask');
    expect(page.headers.get('content-security-policy')).toContain(
      `img-src 'self' data: blob:`,
    );
    const document = await router.request('/main/api/talent/doc');
    expect(document.headers.get('content-security-policy')).toBeNull();
    const asset = await router.request('/main/assets/app.js');
    expect(asset.headers.get('content-security-policy')).toBeNull();
  });

  it('passes API responses and errors through untouched', async () => {
    const router = new Hono();
    router.onError((error, c) =>
      c.json({ code: error.message }, error.message === 'AUTH' ? 401 : 500),
    );
    await contentSecurityPolicyMiddleware.register(
      router,
      appWith({ contentSecurityPolicy: { enabled: true } }),
    );
    router.get('/main/api/talent/secure', () => {
      throw new Error('AUTH');
    });
    const response = await router.request('/main/api/talent/secure');
    expect(response.status).toBe(401);
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('stays off while Vite serves the client, or when disabled', async () => {
    const dev = await routerFor({
      contentSecurityPolicy: { enabled: true },
      'spa.viteDevUrl': 'http://127.0.0.1:5173',
    });
    expect(
      (await dev.request('/main/talent/ask')).headers.get(
        'content-security-policy',
      ),
    ).toBeNull();
    const off = await routerFor({ contentSecurityPolicy: { enabled: false } });
    expect(
      (await off.request('/main/talent/ask')).headers.get(
        'content-security-policy',
      ),
    ).toBeNull();
  });
});

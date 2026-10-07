// @vitest-environment node

// The 模拟渠道 routes under /api/talent/ai-entry/dev/im-mock act as any IM-bound member (send a message, read the
// bot's outbox, press a card button), so production must not register any of them. A brace-less `if` once guarded
// only the first. The route factory is built directly with pass-through authentication, so an unregistered path
// answers 404 and a registered one reaches its handler.
import type { Application } from '@nocobase/app-server/application';
import { afterEach, describe, expect, it } from 'vitest';

import { aiEntryRoutes } from '../../server/routes/hr/ai-entry.ts';

const passThrough = () => async (_c: unknown, next: () => Promise<void>) =>
  next();

function buildRouter() {
  const app = {
    container: {
      resolve: () => ({ required: passThrough, middleware: passThrough }),
    },
  } as unknown as Application;
  return aiEntryRoutes.createRouter(app);
}

const MOCK_REQUESTS: Array<[string, string]> = [
  ['POST', '/talent/ai-entry/dev/im-mock'],
  ['GET', '/talent/ai-entry/dev/im-mock/outbox?senderId=fs-u-1'],
  ['POST', '/talent/ai-entry/dev/im-mock/card'],
];

async function statusOf(method: string, url: string): Promise<number> {
  const router = buildRouter();
  const response = await router.fetch(
    new Request(`http://localhost${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    }),
  );
  return response.status;
}

const savedNodeEnv = process.env.NODE_ENV;
afterEach(() => {
  process.env.NODE_ENV = savedNodeEnv;
});

describe('AI entry development mock routes', () => {
  it.each(MOCK_REQUESTS)('%s %s answers 404 in production', async (m, u) => {
    process.env.NODE_ENV = 'production';
    expect(await statusOf(m, u)).toBe(404);
  });

  it.each(MOCK_REQUESTS)('%s %s is registered in development', async (m, u) => {
    process.env.NODE_ENV = 'development';
    expect(await statusOf(m, u)).not.toBe(404);
  });
});

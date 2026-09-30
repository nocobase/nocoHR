import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { createHmac, timingSafeEqual } from 'node:crypto';

import { authorizeAction } from '../../providers/hr/authorize.js';
import type { IncomingMessage } from '../../providers/hr/im-channel.js';
import type { CardCallback } from '../../providers/hr/im-cards/service.js';
import { HrError, isRecord } from '../../providers/hr/shared.js';
import {
  aiEntryServiceToken,
  imChannelToken,
} from '../../providers/hr/tokens.js';

const PROVIDERS = ['feishu', 'dingtalk', 'wecom'] as const;

function parseMessage(provider: string, body: unknown): IncomingMessage {
  if (
    !(PROVIDERS as readonly string[]).includes(provider) ||
    !isRecord(body) ||
    typeof body.messageId !== 'string' ||
    typeof body.senderId !== 'string' ||
    typeof body.text !== 'string' ||
    (body.chatType !== 'p2p' && body.chatType !== 'group')
  )
    throw new HrError('INVALID_INPUT', 400);
  return {
    provider: provider as IncomingMessage['provider'],
    messageId: body.messageId.slice(0, 128),
    chatType: body.chatType,
    senderExternalId: body.senderId.slice(0, 128),
    text: body.text.slice(0, 2000),
  };
}
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

function parseCardAction(provider: string, body: unknown): CardCallback {
  if (
    !(PROVIDERS as readonly string[]).includes(provider) ||
    !isRecord(body) ||
    typeof body.callbackId !== 'string' ||
    typeof body.operatorId !== 'string' ||
    typeof body.cardId !== 'string' ||
    typeof body.button !== 'string' ||
    (body.comment !== undefined &&
      body.comment !== null &&
      typeof body.comment !== 'string')
  )
    throw new HrError('INVALID_INPUT', 400);
  return {
    provider: provider as CardCallback['provider'],
    callbackId: body.callbackId.slice(0, 128),
    operatorId: body.operatorId.slice(0, 128),
    cardId: body.cardId.slice(0, 64),
    button: body.button.slice(0, 32),
    comment:
      typeof body.comment === 'string' ? body.comment.slice(0, 500) : null,
  };
}

/** The HMAC-SHA256 of the raw body with IM_CALLBACK_SECRET; no secret accepts nothing. */
function signatureValid(raw: string, signature: string): boolean {
  const secret = process.env.IM_CALLBACK_SECRET;
  const expected = secret
    ? createHmac('sha256', secret).update(raw).digest('hex')
    : '';
  return (
    Boolean(expected) &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  );
}

function parseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new HrError('INVALID_INPUT', 400);
  }
}

const mockId = () =>
  `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * 统一 AI 入口 (V1-04) under `/api/talent/ai-entry`: the routing step for a
 * question, the rows a user may be routed to, and the administrators'
 * routing table and knowledge scopes. Each handler authorizes
 * `talent.aiAssistant` in the service.
 */
export const aiEntryRoutes: AppApiRouteContribution<Application> =
  defineApiRoutes((app) => {
    const auth = app.container.resolve(authenticationToken);
    const authz = app.container.resolve(authorizationToken);
    const entry = () => app.container.resolve(aiEntryServiceToken);
    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 64 * 1024 }),
    );
    installErrorHandler(routes);
    routes.get('/', async (c) => c.json({ data: await entry().get(actor(c)) }));
    routes.patch('/', async (c) =>
      c.json({ data: await entry().update(actor(c), await readJson(c)) }),
    );
    // 自助 card order and visibility: read by every signed-in user, changed by those who configure the entry.
    routes.get('/self-service', async (c) =>
      c.json({ data: await entry().selfServiceCards() }),
    );
    routes.put('/self-service', async (c) =>
      c.json({
        data: await entry().updateSelfServiceCards(actor(c), await readJson(c)),
      }),
    );
    routes.get('/routes', async (c) =>
      c.json({ data: await entry().routesFor(actor(c)) }),
    );
    routes.post('/route', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await entry().route(
          actor(c),
          isRecord(body) ? body.question : undefined,
        ),
      });
    });
    // 模拟渠道（仅开发环境）: the mock chat page sends a message as a directory member.
    if (process.env.NODE_ENV !== 'production')
      routes.post('/dev/im-mock', async (c) => {
        await authorizeAction(
          actor(c).authz,
          'talent.aiAssistant',
          'configure',
        );
        const body = await readJson(c);
        return c.json({
          data: await app.container.resolve(imChannelToken).handle(
            parseMessage('feishu', {
              ...(isRecord(body) ? body : {}),
              messageId: mockId(),
            }),
          ),
        });
      });
    // What the bot sent to one member: pushed messages and cards, each card in its latest state.
    routes.get('/dev/im-mock/outbox', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.aiAssistant', 'configure');
      const senderId = (c.req.query('senderId') ?? '').slice(0, 128);
      if (!senderId) throw new HrError('INVALID_INPUT', 400);
      const channel = app.container.resolve(imChannelToken);
      return c.json({
        data: {
          messages: (channel.mockOutbox?.(senderId) ?? [])
            .filter((m) => m.type === 'text')
            .slice(-50)
            .reverse(),
          cards: await channel.cards.listFor('feishu', senderId),
        },
      });
    });
    // A button press as the member, through the same handler a signed callback reaches.
    routes.post('/dev/im-mock/card', async (c) => {
      await authorizeAction(actor(c).authz, 'talent.aiAssistant', 'configure');
      const body = await readJson(c);
      return c.json({
        data: await app.container.resolve(imChannelToken).cards.handleCallback(
          parseCardAction('feishu', {
            ...(isRecord(body) ? body : {}),
            operatorId: isRecord(body) ? body.senderId : undefined,
            callbackId: mockId(),
          }),
        ),
      });
    });

    // Public: the office suite's message callbacks, accepted only with a valid signature.
    const callbacks = new Hono<HrEnv>();
    installErrorHandler(callbacks);
    callbacks.post(
      '/:provider',
      bodyLimit({ maxSize: 32 * 1024 }),
      async (c) => {
        const raw = await c.req.text();
        if (!signatureValid(raw, c.req.header('x-nocohr-signature') ?? ''))
          throw new HrError('IM_BAD_SIGNATURE', 403);
        return c.json({
          data: await app.container
            .resolve(imChannelToken)
            .handle(parseMessage(c.req.param('provider'), parseRaw(raw))),
        });
      },
    );
    // 飞书卡片 button presses (V1-04): signed like messages; the operator is identified by binding in the service,
    // and an unidentified operator, another user's card or a handled card runs nothing.
    callbacks.post(
      '/:provider/card',
      bodyLimit({ maxSize: 16 * 1024 }),
      async (c) => {
        const raw = await c.req.text();
        if (!signatureValid(raw, c.req.header('x-nocohr-signature') ?? ''))
          throw new HrError('IM_BAD_SIGNATURE', 403);
        return c.json({
          data: await app.container
            .resolve(imChannelToken)
            .cards.handleCallback(
              parseCardAction(c.req.param('provider'), parseRaw(raw)),
            ),
        });
      },
    );

    // 我的档案 · 通知设置: the signed-in user's own push channels; the inbox is always on.
    const channels = new Hono<HrEnv>();
    channels.use(
      '*',
      auth.required(),
      authz.middleware(),
      bodyLimit({ maxSize: 4 * 1024 }),
    );
    installErrorHandler(channels);
    channels.get('/', async (c) =>
      c.json({
        data: await app.container
          .resolve(imChannelToken)
          .push.settingsFor(actor(c).userId),
      }),
    );
    channels.put('/', async (c) =>
      c.json({
        data: await app.container
          .resolve(imChannelToken)
          .push.updateSettings(actor(c).userId, await readJson(c)),
      }),
    );

    const router = new Hono();
    router.route('/im-callback', callbacks);
    router.route('/talent/ai-entry', routes);
    router.route('/talent/notification-channels', channels);
    return router;
  });

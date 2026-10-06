import { authenticationToken } from '@nocobase/app-plugin-authentication';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  type AppApiRouteContribution,
} from '@nocobase/app-server/router';
import { Hono } from 'hono';

import {
  MAIL_PURPOSES,
  type MailPurpose,
} from '../../providers/hr/mail/types.js';
import { HrError } from '../../providers/hr/shared.js';
import {
  mailServiceToken,
  mailSettingsToken,
} from '../../providers/hr/tokens.js';
import { actor, installErrorHandler, readJson, type HrEnv } from './shared.js';

/**
 * V2-06 邮件往来 under `/api/talent/mail`. Each mailbox purpose decides who may
 * read and send its mail (the purpose's handler); 设置 / 邮件 is for HR
 * administrators. Sending is the only way mail leaves, and only for drafts.
 */
function purposeOf(value: string | undefined): MailPurpose {
  if (value && (MAIL_PURPOSES as readonly string[]).includes(value))
    return value as MailPurpose;
  throw new HrError('INVALID_INPUT', 400);
}

export const mailRoutes: AppApiRouteContribution<Application> = defineApiRoutes(
  (app) => {
    const routes = new Hono<HrEnv>();
    routes.use(
      '*',
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
    installErrorHandler(routes);
    const mail = () => app.container.resolve(mailServiceToken);
    const settings = () => app.container.resolve(mailSettingsToken);

    routes.get('/settings', async (c) => {
      const current = await settings().get(actor(c));
      return c.json({
        data: { ...current, connections: await mail().connections() },
      });
    });
    routes.put('/settings', async (c) => {
      const body = await readJson(c);
      // A mailbox may only be bound to an existing account, as its owner.
      const mailboxes = (
        body as {
          value?: {
            mailboxes?: Record<
              string,
              { accountId?: string; ownerUserId?: string }
            >;
          };
        } | null
      )?.value?.mailboxes;
      if (mailboxes) {
        await settings().get(actor(c));
        await mail().checkBindings(mailboxes);
      }
      return c.json({ data: await settings().update(actor(c), body) });
    });
    routes.get('/accounts', async (c) => {
      // HR administrators only, like the settings themselves.
      await settings().get(actor(c));
      return c.json({ data: await mail().accounts() });
    });
    routes.get('/mine/bindings', async (c) =>
      c.json({ data: await mail().myBindings(actor(c)) }),
    );
    routes.get('/mine', async (c) =>
      c.json({
        data: await mail().mine(actor(c), c.req.query('address') ?? ''),
      }),
    );
    routes.get('/mine/:accountId/:messageId', async (c) =>
      c.json({
        data: await mail().mineMessage(
          actor(c),
          c.req.param('accountId'),
          c.req.param('messageId'),
        ),
      }),
    );
    routes.get('/mailboxes', async (c) =>
      c.json({ data: await mail().mailboxes(actor(c)) }),
    );
    routes.get('/messages', async (c) =>
      c.json({
        data: await mail().list(actor(c), purposeOf(c.req.query('mailbox')), {
          status: c.req.query('status'),
        }),
      }),
    );
    routes.get('/by-record/:refType/:refId', async (c) =>
      c.json({
        data: await mail().forRecord(
          actor(c),
          purposeOf(c.req.query('mailbox')),
          c.req.param('refType'),
          c.req.param('refId'),
        ),
      }),
    );
    routes.post('/poll', async (c) =>
      c.json({
        data: await mail().pollFor(actor(c), purposeOf(c.req.query('mailbox'))),
      }),
    );
    routes.get('/messages/:id', async (c) =>
      c.json({ data: await mail().get(actor(c), c.req.param('id')) }),
    );
    routes.get('/messages/:id/attachments/:fileId', async (c) => {
      const file = await mail().attachment(
        actor(c),
        c.req.param('id'),
        c.req.param('fileId'),
      );
      return new Response(new Uint8Array(file.bytes), {
        headers: {
          'content-type': file.mimeType || 'application/octet-stream',
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
          'x-content-type-options': 'nosniff',
        },
      });
    });
    routes.post('/messages/:id/resort', async (c) =>
      c.json({ data: await mail().resort(actor(c), c.req.param('id')) }),
    );
    routes.post('/messages/:id/ignore', async (c) =>
      c.json({ data: await mail().ignore(actor(c), c.req.param('id')) }),
    );
    routes.patch('/messages/:id', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await mail().updateDraft(
          actor(c),
          c.req.param('id'),
          (body as { body?: unknown } | null)?.body,
        ),
      });
    });
    routes.patch('/messages/:id/proposal', async (c) => {
      const body = await readJson(c);
      return c.json({
        data: await mail().chooseProposal(
          actor(c),
          c.req.param('id'),
          (body as { choice?: unknown } | null)?.choice,
        ),
      });
    });
    routes.post('/messages/:id/send', async (c) =>
      c.json({ data: await mail().send(actor(c), c.req.param('id')) }),
    );

    const router = new Hono();
    router.route('/talent/mail', routes);
    return router;
  },
);

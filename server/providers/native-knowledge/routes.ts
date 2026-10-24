import { authenticationToken } from '@nocobase/app-plugin-authentication/server';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  createKnowledgeRoutes,
  createKnowledgeTicketRoutes,
  knowledgeToken,
  knowledgeAccessToken,
} from '@nocobase/app-plugin-knowledge/server';
import { defineApiRoutes, ApiError } from '@nocobase/app-server/router';
import { Hono, type Context } from 'hono';
import type { AppPluginApplication } from '@nocobase/app-server/plugins';
import { currentKnowledgeHits } from './search-results.js';

/** Keep official APIs/tickets, checking the original entry before reducing it to a user reader. */
export const nativeKnowledgeRoutes = defineApiRoutes<AppPluginApplication>(
  ({ container }) => {
    const router = new Hono();
    const knowledge = container.resolve(knowledgeToken);
    // Official bearer tickets retain their protocol and recheck the stored reader on redemption.
    router.route('/knowledge/tickets', createKnowledgeTicketRoutes(knowledge));
    const routes = new Hono<AuthorizationEnv>();
    routes.use(
      '*',
      container.resolve(authenticationToken).required(),
      container.resolve(authorizationToken).middleware(),
      async (c, next) => {
        const identity = c.get('authz').identity;
        if (
          identity.keyScope !== undefined ||
          identity.principal.type !== 'user'
        )
          throw new ApiError({
            status: 'PERMISSION_DENIED',
            domain: 'nocohr',
            reason: 'KNOWLEDGE_RESTRICTED_ENTRY',
            message:
              'This knowledge entry requires an unrestricted user session.',
          });
        await next();
      },
    );
    routes.route(
      '/',
      createKnowledgeRoutes(
        {
          ...knowledge,
          docs: {
            ...knowledge.docs,
            // Keep the official HTTP schema/envelope; its reader search needs the facade's fresh-result check too.
            search: async (reader, ...args) =>
              currentKnowledgeHits(
                knowledge,
                reader,
                await knowledge.docs.search(reader, ...args),
              ),
          },
        },
        (c) => ({
          userId: String(
            (c as Context<AuthorizationEnv>).get('authz').identity.principal.id,
          ),
        }),
        (space) => container.resolve(knowledgeAccessToken).space(space),
      ),
    );
    router.route('/knowledge', routes);
    return router;
  },
);

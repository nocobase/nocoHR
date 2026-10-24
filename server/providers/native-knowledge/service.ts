import type { Knowledge } from '@nocobase/app-plugin-knowledge/server';
import { KnowledgeError } from '@nocobase/app-plugin-knowledge/server';
import type {
  KnowledgeSearchHit,
  KnowledgeSpaceSummary,
} from '@nocobase/app-plugin-knowledge/shared/knowledge';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import { createServiceToken } from '@nocobase/service-provider';
import type { NativeKnowledgeConfig } from '../../config/native-knowledge.js';
import type { ActorContext } from '../hr/framework-service.js';
import type {
  KnowledgeService,
  KnowledgePassage,
} from '../hr/knowledge-service.js';
import { HrError } from '../hr/shared.js';
import { authorizeAction, scopeForUser } from '../hr/authorize.js';
import { assertUnrestrictedNativeAIEntry } from '../native-ai/access.js';
import type { bindKnowledgeIndex } from './indexer.js';
import { currentKnowledgeHits } from './search-results.js';

export interface DualKnowledgeSearch {
  legacy: {
    status: 'ready' | 'forbidden' | 'unavailable';
    items: KnowledgePassage[];
  };
  native: {
    status: 'ready' | 'unavailable';
    semantic: 'ready' | 'unavailable';
    items: KnowledgeSearchHit[];
  };
  spaces: KnowledgeSpaceSummary[];
}
const hidden = (error: unknown) =>
  error instanceof KnowledgeError && error.status === 404;
export function createNativeKnowledgeService(deps: {
  authorization: AppAuthorization;
  config: () => NativeKnowledgeConfig;
  knowledge: Knowledge;
  legacy: KnowledgeService;
  index: ReturnType<typeof bindKnowledgeIndex>;
}) {
  const admit = async (ctx: ActorContext) => {
    assertUnrestrictedNativeAIEntry(ctx.authz);
    const principal = ctx.authz.identity.principal;
    if (principal.type !== 'user' || String(principal.id) !== ctx.userId)
      throw new HrError('FORBIDDEN', 403);
    // Keep the original restriction check before refreshing the user's current grants.
    const authz = await scopeForUser(deps.authorization, ctx.userId);
    await authorizeAction(authz, 'talent.knowledgeAssistant', 'use');
    return { userId: ctx.userId, authz };
  };
  const spaces = async (ctx: ActorContext) => {
    const reader = { userId: ctx.userId };
    const answer: KnowledgeSpaceSummary[] = [];
    for (const space of deps.config().spaces) {
      try {
        // Only the public reference crosses into native summaries; deployment membership stays server-side.
        answer.push(
          ...(await deps.knowledge.docs.summaries(reader, [
            { scope: space.scope, scopeId: space.scopeId },
          ])),
        );
      } catch (error) {
        if (!hidden(error)) throw error;
      }
    }
    return answer;
  };
  return {
    async search(
      entry: ActorContext,
      query: string,
    ): Promise<DualKnowledgeSearch> {
      const ctx = await admit(entry);
      const legacy: DualKnowledgeSearch['legacy'] = {
        status: 'ready',
        items: [],
      };
      // Each source has its own availability: failure never becomes an empty successful search.
      const native: DualKnowledgeSearch['native'] = {
        status: 'ready',
        semantic: 'unavailable',
        items: [],
      };
      let summaries: KnowledgeSpaceSummary[] = [];
      try {
        summaries = await spaces(ctx);
        const found = await deps.index.observe(() =>
          deps.knowledge.docs.searchMany(
            { userId: ctx.userId },
            summaries.map((s) => s.space),
            query,
            { limit: 12 },
          ),
        );
        native.semantic = found.semantic;
        native.items = await currentKnowledgeHits(
          deps.knowledge,
          { userId: ctx.userId },
          found.value,
        );
        // Refresh directory labels/counts too, after a possibly long model request.
        summaries = await spaces(ctx);
      } catch {
        native.status = 'unavailable';
        native.items = [];
        summaries = [];
      }
      const refreshed = await admit(entry);
      try {
        legacy.items = await deps.legacy.search(refreshed, query, 8);
      } catch (error) {
        legacy.status =
          error instanceof HrError && error.status === 403
            ? 'forbidden'
            : 'unavailable';
      }

      return { legacy, native, spaces: summaries };
    },
    async spaces(entry: ActorContext) {
      return spaces(await admit(entry));
    },
  };
}
export const nativeKnowledgeServiceToken = createServiceToken<
  ReturnType<typeof createNativeKnowledgeService>
>('hr/native-knowledge');

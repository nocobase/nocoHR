import {
  KnowledgeError,
  type KnowledgeAccessResolver,
} from '@nocobase/app-plugin-knowledge/server';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type {
  KnowledgeAccess,
  SpaceRef,
} from '@nocobase/app-plugin-knowledge/shared/knowledge';
import type { NativeKnowledgeConfig } from '../../config/native-knowledge.js';
import { authorizeAction, scopeForUser } from '../hr/authorize.js';
import { HrError } from '../hr/shared.js';

export const sameSpace = (a: SpaceRef, b: SpaceRef) =>
  a.scope === b.scope && a.scopeId === b.scopeId;
const hidden = () =>
  new KnowledgeError(404, 'SPACE_NOT_FOUND', 'Knowledge space not found.');
/** A hard application admission check precedes the official node ACL, which can otherwise widen a space. */
export function nativeKnowledgeAccess(
  authz: AppAuthorization,
  config: () => NativeKnowledgeConfig,
): KnowledgeAccessResolver {
  return {
    space(ref) {
      return config().spaces.find((s) => sameSpace(s, ref))
        ? { scope: ref.scope, scopeId: ref.scopeId }
        : null;
    },
    inherits: () => [],
    title: async (ref) =>
      config().spaces.find((s) => sameSpace(s, ref))?.title ?? null,
    names: async () => new Map(),
    forReader(reader) {
      return {
        async access(ref): Promise<KnowledgeAccess> {
          const space = config().spaces.find((s) => sameSpace(s, ref));
          if (!space || reader.actor) throw hidden();
          const current = await scopeForUser(authz, reader.userId);
          try {
            await authorizeAction(current, 'talent.knowledgeAssistant', 'use');
          } catch (error) {
            if (error instanceof HrError && error.status === 403)
              throw hidden();
            throw error;
          }
          const allows = async (action: string) => {
            const all = await current.authorize({
              resource: { type: 'kb', id: 'kb.knowledge' },
              action: action + '.all',
            });
            if (all.effect === 'permit' && !all.conditions) return true;
            if (!space.relatedUserIds.includes(reader.userId)) return false;
            const related = await current.authorize({
              resource: { type: 'kb', id: 'kb.knowledge' },
              action: action + '.related',
            });
            return related.effect === 'permit' && !related.conditions;
          };
          // Throw, rather than returning read:false: native node grants must not bypass
          // the application's current use + explicit space-read boundary.
          if (!(await allows('read'))) throw hidden();
          const [propose, edit, manage] = await Promise.all(
            ['propose', 'edit', 'manage'].map(allows),
          );
          return { read: true, propose, edit, manage };
        },
      };
    },
  };
}

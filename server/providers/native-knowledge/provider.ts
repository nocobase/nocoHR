import { ServiceProvider } from '@nocobase/service-provider';
import type { Application } from '@nocobase/app-server/application';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  knowledgeAccessToken,
  knowledgeToken,
} from '@nocobase/app-plugin-knowledge/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { databaseManagerToken } from '@nocobase/db';
import type { NativeKnowledgeConfig } from '../../config/native-knowledge.js';
import { str } from '../hr/shared.js';
import { knowledgeServiceToken } from '../hr/tokens.js';
import { nativeKnowledgeAccess, sameSpace } from './access.js';
import { bindKnowledgeIndex, nativeKnowledgeIndexToken } from './indexer.js';
import {
  createNativeKnowledgeService,
  nativeKnowledgeServiceToken,
} from './service.js';

export default class NativeKnowledgeProvider extends ServiceProvider<Application> {
  public readonly name = 'hr/native-knowledge';
  private close?: () => void;
  private readonly configuration = (): NativeKnowledgeConfig =>
    this.app.config.get<NativeKnowledgeConfig>('nativeKnowledge') ?? {
      spaces: [],
      embedding: null,
    };
  public override register() {
    const container = this.app.container;
    container.instance(knowledgeAccessToken, {
      ...nativeKnowledgeAccess(
        container.resolve(authorizationToken),
        this.configuration,
      ),
      async names(refs) {
        const ids = refs
          .filter((ref) => ref.kind === 'user')
          .map((ref) => ref.id);
        if (!ids.length) return new Map();
        // Only names attached to an already admitted document/version are requested here.
        const users = await container
          .resolve(databaseManagerToken)
          .repository('user')
          .findMany({
            filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
            select: (s) => s.fields('id', 'name'),
          });
        return new Map(
          users.map((user) => ['user:' + str(user.id), str(user.name)]),
        );
      },
    });
    container.singleton(nativeKnowledgeIndexToken, () =>
      bindKnowledgeIndex(
        container.resolve(knowledgeToken),
        container.resolve(agentsToken),
        this.configuration,
      ),
    );
    container.singleton(nativeKnowledgeServiceToken, () =>
      createNativeKnowledgeService({
        authorization: container.resolve(authorizationToken),
        config: this.configuration,
        knowledge: container.resolve(knowledgeToken),
        legacy: container.resolve(knowledgeServiceToken),
        index: container.resolve(nativeKnowledgeIndexToken),
      }),
    );
  }
  public override boot() {
    const container = this.app.container;
    const knowledge = container.resolve(knowledgeToken);
    const config = this.configuration;
    const index = container.resolve(nativeKnowledgeIndexToken);
    // The native picker exposes only explicitly related users; no legacy authorization is copied.
    const release = knowledge.registerSubjectProvider({
      type: 'user',
      title: { key: 'nativeKnowledge.users', ns: 'hr' },
      icon: 'user',
      async search(q, { space, limit }) {
        const ids =
          config().spaces.find((s) => sameSpace(s, space))?.relatedUserIds ??
          [];
        if (!ids.length) return [];
        const users = await container
          .resolve(databaseManagerToken)
          .repository('user')
          .findMany({
            filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
            select: (s) => s.fields('id', 'name'),
          });
        return users
          .filter((u) => str(u.name).toLowerCase().includes(q.toLowerCase()))
          .slice(0, limit)
          .map((u) => ({
            type: 'user',
            id: str(u.id),
            label: str(u.name),
          }));
      },
      async describe(ids, { space }) {
        const allowed =
          config().spaces.find((s) => sameSpace(s, space))?.relatedUserIds ??
          [];
        const selected = ids.filter((id) => allowed.includes(id));
        if (!selected.length) return [];
        const users = await container
          .resolve(databaseManagerToken)
          .repository('user')
          .findMany({
            filter: (f) => f.or(selected.map((id) => f.string('id').eq(id))),
            select: (s) => s.fields('id', 'name'),
          });
        return users.map((u) => ({
          type: 'user',
          id: str(u.id),
          label: str(u.name),
        }));
      },
      subjectsOf: async (principal) =>
        principal.kind === 'user' ? [principal.id] : [],
    });
    this.close = () => {
      release();
      index.close();
    };
    return Promise.resolve();
  }
  public override shutdown() {
    this.close?.();
    return Promise.resolve();
  }
}

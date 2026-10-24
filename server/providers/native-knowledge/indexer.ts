import { createServiceToken } from '@nocobase/service-provider';
import { AsyncLocalStorage } from 'node:async_hooks';
import { gatesOf, type Knowledge } from '@nocobase/app-plugin-knowledge/server';
import type {
  Agents,
  VectorCollection,
  VectorSourceItem,
} from '@nocobase/app-plugin-agents/server/tokens';
import type { NativeKnowledgeConfig } from '../../config/native-knowledge.js';

const idOf = (docId: string, ordinal: number) => `${docId}:${ordinal}`;
/** Administrative indexing only; no reader facade exposes chunksOf/eachChunk. */
export function bindKnowledgeIndex(
  knowledge: Knowledge,
  agents: Agents,
  config: () => NativeKnowledgeConfig,
) {
  const observation = new AsyncLocalStorage<{ unavailable: boolean }>();
  const collection = agents.vectors.collection({
    name: 'nocohr-knowledge',
    source: 'native-knowledge',
    model: async () => config().embedding,
    filterable: ['spaceId', 'gate', 'docId', 'ordinal'],
    async *items() {
      for await (const rows of knowledge.eachChunk())
        yield rows.map((row) => ({
          id: idOf(row.docId, row.ordinal),
          text: row.text,
          metadata: {
            spaceId: row.spaceId,
            gate: row.gate,
            docId: row.docId,
            ordinal: row.ordinal,
            chunkId: row.chunkId,
            version: row.version,
          },
        }));
    },
  });
  const replace = async (docId: string) => {
    const { doc, chunks } = await knowledge.chunksOf(
      knowledge.connection(),
      docId,
    );
    const items: VectorSourceItem[] = doc
      ? chunks.map((chunk) => ({
          id: idOf(docId, chunk.ordinal),
          text: chunk.text,
          metadata: {
            docId,
            ordinal: chunk.ordinal,
            spaceId: doc.spaceId,
            gate: doc.gate,
            chunkId: chunk.id,
            version: doc.version,
          },
        }))
      : [];
    await collection.replace({ docId }, items);
  };
  const releases = [
    knowledge.events.on((event) =>
      event.type === 'chunks.changed' ? replace(event.docId) : undefined,
    ),
    knowledge.registerSearchProvider({
      name: 'hr-vector',
      async search(spaces, query, { limit }) {
        const gates = gatesOf(spaces.map((s) => s.gates));
        if (!gates.length) return [];
        let hits;
        try {
          hits = await collection.search(query, {
            topK: limit,
            filter: {
              spaceId: { in: spaces.map((s) => s.id) },
              gate: { in: gates },
            },
          });
        } catch (error) {
          const state = observation.getStore();
          if (state) state.unavailable = true;
          throw error;
        }
        if (hits === null) {
          const state = observation.getStore();
          if (state) state.unavailable = true;
        }
        return (hits ?? []).flatMap((hit) =>
          typeof hit.metadata.chunkId === 'string'
            ? [{ chunkId: hit.metadata.chunkId, score: hit.score }]
            : [],
        );
      },
    }),
    knowledge.registerIndexer({
      notifications: 'none',
      async states(sections) {
        const states = await collection.states(
          sections.map((s) => idOf(s.docId, s.ordinal)),
        );
        return (
          states &&
          new Map(
            [...states].map(([id, state]) => [
              id,
              { state: state.state, error: state.error },
            ]),
          )
        );
      },
      async unfinished(spaceId, limit) {
        const states = await collection.unfinished({
          filter: { spaceId },
          limit,
        });
        return (
          states &&
          states.map((s) => ({
            docId: String(s.metadata.docId),
            ordinal: Number(s.metadata.ordinal),
            state: s.state,
            error: s.error,
          }))
        );
      },
      async reindex(docId) {
        await collection.sync();
        await replace(docId);
      },
    }),
  ];
  return {
    collection,
    replace,
    async observe<T>(work: () => Promise<T>) {
      const state = {
        unavailable: (await semanticState(collection)) !== 'ready',
      };
      return observation.run(state, async () => ({
        value: await work(),
        semantic: state.unavailable
          ? ('unavailable' as const)
          : ('ready' as const),
      }));
    },
    close() {
      for (const release of releases.reverse()) release();
      collection.close();
    },
  };
}
export async function semanticState(collection: VectorCollection) {
  try {
    const state = await collection.status();
    return state.available && state.model && state.active?.status === 'ready'
      ? ('ready' as const)
      : ('unavailable' as const);
  } catch {
    return 'unavailable' as const;
  }
}

export const nativeKnowledgeIndexToken = createServiceToken<
  ReturnType<typeof bindKnowledgeIndex>
>('hr/native-knowledge-index');

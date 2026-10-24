import {
  KnowledgeError,
  type Knowledge,
} from '@nocobase/app-plugin-knowledge/server';
import type { KnowledgeSearchHit } from '@nocobase/app-plugin-knowledge/shared/knowledge';

/** Search can await a model; refresh each hit's access and version before exposing its metadata or excerpt. */
export async function currentKnowledgeHits(
  knowledge: Knowledge,
  reader: Parameters<Knowledge['docs']['get']>[0],
  hits: readonly KnowledgeSearchHit[],
): Promise<KnowledgeSearchHit[]> {
  const current: KnowledgeSearchHit[] = [];
  for (const hit of hits) {
    try {
      const doc = await knowledge.docs.get(reader, hit.docId);
      if (doc.version === hit.version) current.push(hit);
    } catch (error) {
      if (!(error instanceof KnowledgeError && error.status === 404))
        throw error;
    }
  }
  return current;
}

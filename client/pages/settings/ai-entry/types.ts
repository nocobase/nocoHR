/** The AI 入口 settings as `GET talent/ai-entry` answers them (server/providers/hr/ai-entry-service.ts). */
export const DOC_CATEGORIES = ['policy', 'sop', 'manual', 'other'] as const;
export type DocCategory = (typeof DOC_CATEGORIES)[number];

export interface EntryRoute {
  key: string;
  description: string;
  employee: string;
  /** Permission set keys whose holders may use the row; empty is everyone. */
  permissionSets: string[];
  enabled: boolean;
  /** Words that send a question here when no model is available. */
  keywords: string[];
}

export interface KnowledgeScope {
  docNos: string[];
  categories: DocCategory[];
}

export interface AiEntryValue {
  routes: EntryRoute[];
  knowledgeScopes: Record<string, KnowledgeScope>;
}

export interface AiEntrySnapshot {
  value: AiEntryValue;
  revision: number;
}

export interface AiEntryResponse extends AiEntrySnapshot {
  employees: string[];
  permissionSets: string[];
}

/** AI employees whose tools include `searchKnowledge`, so a knowledge scope applies to them. */
export const KNOWLEDGE_EMPLOYEES = ['knowledgeAssistant'] as const;

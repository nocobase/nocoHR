export interface KnowledgeOutletContext {
  readonly reload: () => void;
}

export const DOCUMENT_CATEGORIES = [
  'policy',
  'sop',
  'manual',
  'other',
] as const;

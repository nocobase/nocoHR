export interface CompetencyLevel {
  readonly id?: string;
  readonly level: number;
  readonly title: string;
  readonly behaviors: string;
}

export interface CompetencyItem {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly category: string;
  readonly description: string | null;
  readonly maxLevel: number;
  readonly source: string;
  readonly reviewStatus: string;
  readonly active: boolean;
  readonly positionCount: number;
  readonly levels: CompetencyLevel[];
}

export interface CompetenciesOutletContext {
  readonly reload: () => void;
  readonly canManage: boolean;
  readonly canConfirm: boolean;
}

export const CATEGORIES = ['skill', 'quality', 'qualification'] as const;

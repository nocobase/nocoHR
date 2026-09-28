export interface JobFamily {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface Position {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly jobFamilyId: string;
  readonly grade: string | null;
  readonly responsibilities: string | null;
  readonly aiDraftedAt: string | null;
  readonly active: boolean;
  readonly sortOrder: number;
}

export interface Competency {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly category: string;
  readonly description: string | null;
  readonly maxLevel: number;
  readonly source: string;
  readonly reviewStatus: string;
  readonly active: boolean;
  readonly levels?: readonly {
    level: number;
    title: string;
    behaviors: string;
  }[];
}

export interface Requirement {
  readonly id: string;
  readonly positionId: string;
  readonly competencyId: string;
  readonly requiredLevel: number;
  readonly mandatory: boolean;
  readonly source: string;
  readonly reviewStatus: string;
}

export interface FrameworkData {
  readonly jobFamilies: JobFamily[];
  readonly positions: Position[];
  readonly requirements: Requirement[];
  readonly competencies: Competency[];
  readonly canManage: boolean;
  readonly canConfirm: boolean;
  readonly canUseAdvisor: boolean;
}

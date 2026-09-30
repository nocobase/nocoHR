/** V3-11 API shapes (server/providers/hr/profile/*.ts, revision-service.ts). */

export interface EvidenceItem {
  readonly type: string;
  readonly id: string;
  readonly summary: string;
}

export interface SuggestionView {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeNo: string;
  readonly departmentTitle: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly currentLevel: number;
  readonly suggestedLevel: number;
  readonly rationale: string;
  readonly evidence: readonly EvidenceItem[];
  readonly reviewerName: string | null;
  readonly status: string;
  readonly decidedLevel: number | null;
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly createdAt: string;
}

export interface LearningItem {
  readonly type: 'course' | 'practice' | 'exam';
  readonly id: string;
  readonly title: string;
}

export interface RecommendationView {
  readonly id: string;
  readonly departmentId: string;
  readonly departmentTitle: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly reason: string;
  readonly evidence: readonly {
    signalId: string;
    externalId: string;
    summary: string;
    occurredAt?: string;
  }[];
  readonly audience: readonly {
    employeeId: string;
    name: string;
    employeeNo: string;
    reason: string;
    assignments: number;
    completed: number;
  }[];
  readonly items: readonly LearningItem[];
  readonly dueDate: string | null;
  readonly correctiveActionRefs: readonly string[];
  readonly reviewerName: string | null;
  readonly status: string;
  readonly reviewedByName: string | null;
  readonly reviewNote: string | null;
  readonly completedAt: string | null;
  readonly hasProof: boolean;
  readonly writebackStatus: string | null;
  readonly writebackError: string | null;
  readonly createdAt: string;
}

export interface SignalView {
  readonly id: string;
  readonly sourceSystem: string;
  readonly externalId: string;
  readonly signalType: string;
  readonly category: string | null;
  readonly severity: string | null;
  readonly title: string;
  readonly summary: string | null;
  readonly occurredAt: string;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly personKey: string;
  readonly departmentId: string | null;
  readonly departmentTitle: string | null;
  readonly competencyId: string | null;
  readonly competencyTitle: string | null;
  readonly correctiveActionRef: string | null;
  readonly link: string | null;
  readonly matchStatus: string;
  readonly customFields: Record<string, unknown>;
  readonly rawPayload?: unknown;
  readonly draftRule?: RuleView | null;
}

export interface RuleView {
  readonly id: string;
  readonly sourceSystem: string;
  readonly category: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly source: string;
  readonly reviewStatus: string;
  readonly note: string | null;
  readonly unmatchedCount: number;
  readonly updatedAt: string;
}

export interface SignalList {
  readonly items: SignalView[];
  readonly counts: Record<string, number>;
  readonly fields: { key: string; label: string; type: string }[];
  readonly can: {
    match: boolean;
    import: boolean;
    manageRules: boolean;
    retryWriteback: boolean;
  };
}

export interface SummarySentence {
  readonly text: string;
  readonly evidence: readonly {
    id: string;
    type: string;
    refId: string;
    label: string;
  }[];
}

export interface ProfileSummary {
  readonly employeeId: string;
  readonly summary: string | null;
  readonly generatedAt: string | null;
  readonly sentences: readonly SummarySentence[];
  readonly canRegenerate: boolean;
}

export interface TimelineItem {
  readonly kind: string;
  readonly at: string;
  readonly title: string;
  readonly detail: string | null;
  readonly competencyId: string | null;
  readonly competencyTitle: string | null;
  readonly link: string | null;
  readonly signalId: string | null;
  readonly signalType: string | null;
}

export interface FindConditions {
  departmentIds: string[];
  positionIds: string[];
  certifications: { certificationId: string; status: 'valid' | 'any' }[];
  competencies: {
    competencyId: string;
    minLevel: number | null;
    maxLevel: number | null;
  }[];
  signals: {
    mode: 'none' | 'some';
    types: string[];
    withinDays: number;
  } | null;
  activeOnly: boolean;
}

export interface FindResult {
  readonly conditions: FindConditions;
  readonly labels: readonly string[];
  readonly results: readonly {
    employeeId: string;
    name: string;
    employeeNo: string;
    departmentTitle: string;
    positionTitle: string;
    reasons: readonly string[];
  }[];
  readonly strictest: { label: string; passing: number } | null;
  readonly parsedBy?: 'ai' | 'rules';
}

export interface FindLookups {
  readonly departments: { id: string; title: string }[];
  readonly positions: { id: string; title: string }[];
  readonly certifications: { id: string; title: string }[];
  readonly competencies: { id: string; title: string; maxLevel: number }[];
}

export type CertState =
  'valid' | 'expiring' | 'expired' | 'missing' | 'notRequired';

export interface Dashboard {
  readonly departments: { id: string; title: string }[];
  readonly departmentId: string | null;
  readonly people: number;
  readonly certMatrix: {
    columns: { id: string; title: string }[];
    rows: {
      employeeId: string;
      name: string;
      positionTitle: string;
      cells: {
        certificationId: string;
        state: CertState;
        certificateId: string | null;
        expiresAt: string | null;
      }[];
    }[];
  };
  readonly heatmap: {
    columns: { id: string; title: string }[];
    rows: {
      employeeId: string;
      name: string;
      cells: {
        competencyId: string;
        requiredLevel: number | null;
        currentLevel: number | null;
        gap: number | null;
      }[];
    }[];
  };
  readonly trend: {
    months: string[];
    series: { competencyId: string | null; title: string; counts: number[] }[];
  };
  readonly learning: {
    inProgress: number;
    overdue: number;
    completedThisMonth: number;
  };
  readonly canExport: boolean;
}

export interface RevisionView {
  readonly id: string;
  readonly documentId: string | null;
  readonly reason: string;
  readonly targetType: 'lesson' | 'question' | 'practiceScenario';
  readonly targetId: string;
  readonly targetTitle: string;
  readonly courseId: string | null;
  readonly courseTitle: string | null;
  readonly sectionTitle: string | null;
  readonly current: Record<string, unknown>;
  readonly proposed: Record<string, unknown>;
  readonly accepted: Record<string, unknown> | null;
  readonly explanation: string;
  readonly status: string;
  readonly stale: boolean;
  readonly reviewedByName: string | null;
  readonly rejectReason: string | null;
  readonly createdAt: string;
  readonly can: { accept: boolean; reject: boolean };
}

export interface RevisionGroup {
  readonly document: {
    id: string;
    title: string;
    version: string | null;
    previousVersionId: string | null;
  } | null;
  readonly brief: { id: string; title: string; status: string } | null;
  readonly affectedEstimate: number | null;
  readonly revisions: readonly RevisionView[];
  readonly courses: readonly {
    id: string;
    title: string;
    open: number;
    accepted: number;
    canApply: boolean;
  }[];
}

export interface BriefView {
  readonly courseId: string;
  readonly title: string;
  readonly status: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly documentVersion: string | null;
  readonly revisionDueDays: number;
  readonly affectedEstimate: number;
  readonly assigned: number;
}

export interface AuditRisk {
  readonly kind: string;
  readonly urgency: 'high' | 'medium';
  readonly employeeId: string;
  readonly name: string;
  readonly departmentTitle: string;
  readonly text: string;
  readonly evidence: readonly { type: string; id: string; label: string }[];
}

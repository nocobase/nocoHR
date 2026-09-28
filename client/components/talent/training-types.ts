/** Shapes of the training operations endpoints (V2 step 5). */

export type StepType = 'course' | 'exam' | 'practice';

export interface PathStep {
  readonly id: string;
  readonly sortOrder: number;
  readonly stepType: StepType;
  readonly courseId: string | null;
  readonly examId: string | null;
  readonly practiceScenarioId: string | null;
  readonly targetTitle: string;
  readonly deliveryMode: 'online' | 'offline' | null;
  readonly dueOffsetDays: number;
  readonly required: boolean;
  readonly estimatedMinutes: number;
  readonly targetReady: boolean;
}

export interface LearningPath {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly positionId: string | null;
  readonly positionTitle: string | null;
  readonly purpose: 'onboarding' | 'development' | 'other';
  readonly sequential: boolean;
  readonly skipCompleted: boolean;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly published: boolean;
  readonly active: boolean;
  readonly steps: readonly PathStep[];
  readonly estimatedMinutes: number;
  readonly learnerCount: number;
  readonly completionRate: number | null;
  readonly can: { manage: boolean; publish: boolean };
}

export interface PathTimeline {
  readonly assignmentId: string;
  readonly pathId: string;
  readonly title: string;
  readonly status: string;
  readonly progress: number;
  readonly dueDate: string | null;
  readonly steps: readonly {
    readonly step: PathStep;
    readonly assignmentId: string | null;
    readonly status: string;
    readonly progress: number;
    readonly dueDate: string | null;
  }[];
}

export interface TrainingSession {
  readonly id: string;
  readonly courseId: string;
  readonly courseTitle: string;
  readonly title: string;
  readonly instructorUserId: string;
  readonly instructorName: string | null;
  readonly startAt: string;
  readonly endAt: string;
  readonly location: string;
  readonly capacity: number;
  readonly enrolledCount: number;
  readonly remaining: number;
  readonly enrollDeadline: string | null;
  readonly status: 'scheduled' | 'cancelled' | 'completed';
  readonly ownerUserId: string;
  readonly attendedCount: number;
  readonly absentCount: number;
  readonly myEnrollment: { id: string; status: string } | null;
  readonly can: {
    manage: boolean;
    markAttendance: boolean;
    export: boolean;
    enroll: boolean;
  };
}

export interface Enrollment {
  readonly id: string;
  readonly employeeId: string;
  readonly name: string;
  readonly employeeNo: string;
  readonly departmentTitle: string;
  readonly status: 'enrolled' | 'attended' | 'absent' | 'cancelled';
  readonly checkedInAt: string | null;
  readonly checkInMethod: 'qr' | 'manual' | null;
  readonly markedByName: string | null;
  readonly markReason: string | null;
}

export interface TrainingSessionDetail extends TrainingSession {
  readonly enrollments: readonly Enrollment[];
}

export interface RubricPoint {
  readonly point: string;
  readonly weight: number;
  readonly competencyId: string | null;
  readonly competencyTitle?: string | null;
  readonly sourceExcerpt: string | null;
}

export interface PracticeScenario {
  readonly id: string;
  readonly title: string;
  readonly persona: string;
  readonly situation: string;
  readonly openingLine: string;
  readonly rubric: readonly RubricPoint[];
  readonly sourceDocumentId: string;
  readonly sourceDocumentTitle: string | null;
  readonly maxTurns: number;
  readonly passScore: number;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly source: 'manual' | 'ai';
  readonly reviewStatus: 'draft' | 'confirmed';
  readonly active: boolean;
  readonly competencies: readonly { id: string; title: string }[];
  readonly usageCount: number;
  readonly averageScore: number | null;
  readonly can: { manage: boolean; confirm: boolean; discard: boolean };
}

export interface RubricResult {
  readonly point: string;
  readonly weight: number;
  readonly score: number;
  readonly quote: string | null;
  readonly suggestion: string;
  readonly clause: string | null;
}

export interface Practice {
  readonly id: string;
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly assignmentId: string | null;
  readonly status: 'inProgress' | 'completed' | 'abandoned';
  readonly score: number | null;
  readonly passScore: number;
  readonly passed: boolean | null;
  readonly turnCount: number;
  readonly maxTurns: number;
  readonly rehearsal: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly transcript?: readonly {
    role: 'coach' | 'employee';
    text: string;
    at: string;
  }[];
  readonly rubricResults?: readonly RubricResult[];
  readonly feedback?: string | null;
  readonly situation?: string;
  readonly rubric?: readonly RubricPoint[];
  readonly sourceDocumentId?: string;
  readonly sourceDocumentTitle?: string | null;
  readonly fullAccess: boolean;
  readonly coachSuggestsEnd?: boolean;
}

export interface PracticeSummary {
  readonly best: number | null;
  readonly lastFeedback: string | null;
  readonly lastPracticeId: string | null;
  readonly openPracticeId: string | null;
  readonly count: number;
}

export type PlanItemType = 'course' | 'learningPath' | 'exam' | 'practice';

export interface LearningPlan {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly trigger: string;
  readonly summary: string;
  readonly items: readonly {
    type: PlanItemType;
    refId: string;
    competencyId: string | null;
    competencyTitle: string | null;
    title: string;
    reason: string;
    dueDate: string;
    estimatedMinutes: number | null;
  }[];
  readonly totalMinutes: number;
  readonly reviewerUserId: string;
  readonly reviewerName: string | null;
  readonly status: 'draft' | 'approved' | 'rejected' | 'expired';
  readonly reviewedByName: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly assignmentIds: readonly string[];
  readonly source: string;
  readonly createdAt: string;
  readonly can: { approve: boolean; reject: boolean };
}

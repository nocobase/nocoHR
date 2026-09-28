export type QuestionType = 'single' | 'multiple' | 'judge' | 'blank' | 'short';

export interface QuestionOption {
  readonly key: string;
  readonly text: string;
}

export interface Question {
  readonly id: string;
  readonly type: QuestionType;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly answer: unknown;
  readonly explanation: string | null;
  readonly gradingNotes: string | null;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly sourceDocumentId: string | null;
  readonly sourceDocumentTitle: string | null;
  readonly sourceCourseId: string | null;
  readonly sourceCourseTitle: string | null;
  readonly sourceExcerpt: string | null;
  readonly score: number;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly source: string;
  readonly reviewStatus: 'draft' | 'confirmed';
  readonly active: boolean;
  readonly competencies: readonly { id: string; title: string }[];
  readonly usedInExams: number;
}

export interface RandomRule {
  readonly competencyId?: string | null;
  readonly questionType: QuestionType;
  readonly difficulty?: string | null;
  readonly count: number;
  readonly scoreEach: number;
  readonly available?: number;
}

export interface ExamSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly paperMode: 'fixed' | 'random';
  readonly questionCount: number;
  readonly totalScore: number;
  readonly durationMinutes: number;
  readonly maxAttempts: number;
  readonly passScore: number;
  readonly showAnswersAfter: 'never' | 'afterSubmit' | 'afterPass';
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly published: boolean;
  readonly active: boolean;
  readonly candidates: number;
  readonly passRate: number | null;
  readonly grading: number;
}

export interface ExamDetail extends ExamSummary {
  readonly questions: readonly {
    questionId: string;
    score: number;
    sortOrder: number;
    question: Question | null;
  }[];
  readonly randomRules: readonly (RandomRule & { available: number })[];
  readonly can: {
    manage: boolean;
    publish: boolean;
    grade: boolean;
    resetAttempts: boolean;
  };
}

export interface PaperItem {
  readonly questionId: string;
  readonly type: QuestionType;
  readonly stem: string;
  readonly options: readonly QuestionOption[];
  readonly blankCount: number;
  readonly score: number;
  readonly competencyIds: readonly string[];
}

export interface Attempt {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly attemptNo: number;
  readonly status: 'inProgress' | 'grading' | 'passed' | 'failed' | 'voided';
  readonly startedAt: string;
  readonly deadlineAt: string;
  readonly serverNow: string;
  readonly submittedAt: string | null;
  readonly items: readonly PaperItem[];
  readonly answers: Record<string, unknown>;
}

export interface AttemptResult {
  readonly id: string;
  readonly examId: string;
  readonly examTitle: string;
  readonly employeeName: string;
  readonly attemptNo: number;
  readonly status: string;
  readonly score: number | null;
  readonly passScore: number;
  readonly submittedAt: string | null;
  readonly answersVisible: boolean;
  readonly items: readonly {
    questionId: string;
    type: QuestionType;
    stem: string;
    options: readonly QuestionOption[];
    score: number;
    earned: number | null;
    correct: boolean | null;
    response: unknown;
    answer?: unknown;
    explanation?: string | null;
    gradingNotes?: string | null;
    comment?: string | null;
  }[];
  readonly wrongByCompetency: readonly {
    competencyId: string;
    title: string;
    wrong: number;
    total: number;
    courses: { id: string; title: string }[];
  }[];
}

export interface MyExam {
  readonly examId: string;
  readonly title: string;
  readonly description: string | null;
  readonly durationMinutes: number;
  readonly passScore: number;
  readonly maxAttempts: number;
  readonly attemptsUsed: number;
  readonly remainingAttempts: number;
  readonly bestScore: number | null;
  readonly bucket: 'todo' | 'grading' | 'passed' | 'failed';
  readonly inProgressAttemptId: string | null;
  readonly latestAttemptId: string | null;
  readonly dueDate: string | null;
  readonly sources: readonly ('assignment' | 'certification')[];
}

export interface Certificate {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly certificationId: string;
  readonly certificationTitle: string;
  readonly certificateNo: string;
  readonly issuedAt: string;
  readonly expiresAt: string | null;
  readonly status: 'valid' | 'expiring' | 'expired' | 'revoked' | 'superseded';
  readonly revokedReason: string | null;
  readonly supersededById: string | null;
}

export interface CertificationSummary {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string | null;
  readonly validityMonths: number | null;
  readonly competencyId: string | null;
  readonly competencyTitle: string | null;
  readonly competencyLevel: number | null;
  readonly expiringNoticeDays: number;
  readonly recertAdvanceDays: number;
  readonly escalateDays: number;
  readonly recertMode: 'examOnly' | 'full';
  readonly active: boolean;
  readonly courses: readonly { id: string; title: string }[];
  readonly exams: readonly { id: string; title: string }[];
  readonly holderCount: number;
}

export interface CertificationDetail extends CertificationSummary {
  readonly mine: {
    requirements: {
      courses: readonly { id: string; title: string; done: boolean }[];
      exams: readonly { id: string; title: string; done: boolean }[];
    };
    certificate: Certificate | null;
  } | null;
  readonly holders: readonly Certificate[] | null;
  readonly grantedPermissionSets:
    readonly { key: string; title: string }[] | null;
  readonly grantedPages: readonly string[];
  readonly can: { manage: boolean; revoke: boolean };
}

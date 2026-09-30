export interface NamedRef {
  readonly id: string;
  readonly title: string;
}

export interface KbDocument {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly fileId: string;
  readonly parseStatus: 'pending' | 'ready' | 'failed';
  readonly parseError: string | null;
  readonly visibility: 'all' | 'restricted';
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly reviewDate: string | null;
  readonly autoDraftCourse: boolean;
  readonly active: boolean;
  readonly competencies: readonly NamedRef[];
  readonly departments: readonly NamedRef[];
  readonly positions: readonly NamedRef[];
  readonly updatedAt: string;
  readonly canManage: boolean;
  /** V1-04 versions: the document number and version; a superseded version no longer answers questions. */
  readonly docNo?: string | null;
  readonly version?: string | null;
  readonly effectiveDate?: string | null;
  readonly previousVersionId?: string | null;
  readonly supersededById?: string | null;
  readonly supersededByVersion?: string | null;
  readonly lastReviewedAt?: string | null;
}

/** One section's change against the previous version (server/providers/hr/document-changes.ts). */
export interface SectionChange {
  readonly sectionTitle: string;
  readonly changeType: 'added' | 'modified' | 'removed';
  readonly before: string | null;
  readonly after: string | null;
}

export interface DocumentSection {
  readonly index: number;
  readonly title: string;
  readonly text: string;
}

export interface KbDocumentDetail extends KbDocument {
  readonly sections: readonly DocumentSection[];
  readonly courses: readonly {
    id: string;
    title: string;
    source: string;
    reviewStatus: string;
    published: boolean;
  }[];
  readonly file: {
    id: string;
    filename: string;
    ext: string;
    mimeType: string;
    size: number;
  } | null;
  /** Every version with the same document number, newest first. */
  readonly versions?: readonly {
    id: string;
    version: string | null;
    effectiveDate: string | null;
    parseStatus: string;
    superseded: boolean;
  }[];
  readonly changeSummary?: readonly SectionChange[] | null;
  readonly changeNote?: string | null;
  readonly can?: {
    uploadVersion: boolean;
    markReviewed: boolean;
    rerunRevision: boolean;
  };
}

/** A document conflict (`GET talent/kb/conflicts`). */
export interface DocumentConflict {
  readonly id: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly sectionTitle: string;
  readonly otherDocumentId: string;
  readonly otherDocumentTitle: string;
  readonly otherSectionTitle: string;
  readonly description: string;
  readonly excerpt: string | null;
  readonly otherExcerpt: string | null;
  readonly status: 'open' | 'resolved' | 'ignored';
  readonly source?: 'ai' | 'manual';
  readonly resolutionNote?: string | null;
  readonly handledByName: string | null;
  readonly createdAt: string;
  readonly can: { resolve: boolean; ignore: boolean };
}

export interface KnowledgeGap {
  readonly id: string;
  readonly question: string;
  /** The asker's department only; the gap list does not name who asked (V1-04). */
  readonly askedByName: string | null;
  readonly channel?: 'app' | 'feishu' | 'dingtalk' | 'wecom';
  readonly askCount: number;
  readonly askedAt: string;
  readonly lastAskedAt: string;
  readonly relatedDocumentId: string | null;
  readonly relatedDocumentTitle: string | null;
  readonly topic: string | null;
  readonly reportedAt: string | null;
  readonly status: 'open' | 'resolved' | 'ignored';
  readonly resolvedDocumentId: string | null;
  readonly resolvedDocumentTitle: string | null;
}

export interface Lesson {
  readonly id: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly content: string;
  readonly sourceExcerpt: string | null;
  readonly estimatedMinutes: number | null;
  readonly contentType: 'markdown' | 'video';
  readonly videoFileId: string | null;
  readonly videoSeconds: number | null;
  readonly minWatchPercent: number;
}

export interface CourseSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly sourceDocumentId: string | null;
  readonly sourceDocumentTitle: string | null;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly source: string;
  readonly reviewStatus: string;
  readonly published: boolean;
  readonly active: boolean;
  readonly deliveryMode: 'online' | 'offline';
  readonly status: 'draft' | 'confirmed' | 'published' | 'inactive';
  readonly competencies: readonly NamedRef[];
  readonly lessonCount: number;
  readonly estimatedMinutes: number;
  readonly learnerCount: number;
}

export interface CourseDetail extends CourseSummary {
  readonly lessons: readonly Lesson[];
  readonly can: {
    manage: boolean;
    confirm: boolean;
    publish: boolean;
    discard: boolean;
  };
}

export interface Assignment {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly courseId: string | null;
  readonly examId: string | null;
  readonly learningPathId: string | null;
  readonly practiceScenarioId: string | null;
  readonly parentAssignmentId: string | null;
  readonly pathStepId: string | null;
  readonly learningPlanId: string | null;
  readonly targetTitle: string;
  readonly kind: 'course' | 'exam' | 'path' | 'practice';
  readonly deliveryMode: 'online' | 'offline' | null;
  readonly status:
    | 'notStarted'
    | 'inProgress'
    | 'overdue'
    | 'completed'
    | 'cancelled'
    | 'locked';
  readonly progress: number;
  readonly dueDate: string | null;
  readonly source: string;
  readonly optional: boolean;
  readonly assignedByName: string | null;
  readonly completedAt: string | null;
  readonly lastRemindedAt: string | null;
  readonly reminderCount: number;
  readonly createdAt: string | null;
}

export interface LearnerCourse {
  readonly course: {
    id: string;
    title: string;
    description: string | null;
    deliveryMode: 'online' | 'offline';
  };
  readonly lessons: readonly (Lesson & {
    completed: boolean;
    watchedSeconds: number;
    maxPositionSeconds: number;
  })[];
  readonly assignment: {
    id: string;
    status: string;
    progress: number;
    dueDate: string | null;
  } | null;
}

export interface LearningSummary {
  readonly completedCourses: readonly {
    courseId: string;
    title: string;
    completedAt: string;
  }[];
  readonly totalMinutes: number;
}

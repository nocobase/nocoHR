import type { LocaleResource } from '@nocobase/i18n';

// The application's own server-side wording: the in-app notifications the
// talent platform sends. Plugin wording stays in each plugin's namespace.
const enUS = {
  workbench: {
    title: 'Workbench',
    description:
      'Review your approvals, AI-prepared items and system reminders.',
    today: 'Today',
    week: 'This week',
    later: 'Later',
    completed: 'Completed',
    source: 'Source',
    all: 'All sources',
    approval: 'Approval',
    ai: 'AI-prepared',
    rule: 'System reminder',
    open: 'Open',
    done: 'Done',
    dismissed: 'Dismissed',
    refresh: 'Refresh items',
    go: 'Open',
    more: 'More actions for {{title}}',
    complete: 'Mark done',
    dismiss: 'Dismiss',
    cancel: 'Cancel',
    close: 'Close',
    automatic: 'Completed by the approval process',
    emptyTitle: 'No work items yet',
    emptyDescription: 'New items from business processes will appear here.',
    noResults: 'No matching items',
    clear: 'Clear filters',
    loading: 'Loading',
    failed: 'Could not load items. Try again.',
    retry: 'Retry',
    forbidden: 'Contact an administrator for workbench access.',
    signIn: 'Sign in',
    saveFailed: 'Action failed. Try again.',
    missing:
      'This item is missing or inaccessible. The list has been refreshed.',
    conflict: 'The item changed. Review its latest status.',
    doneToast: 'Marked "{{title}}" done',
    dismissedToast: 'Dismissed "{{title}}"',
    dismissTitle: 'Dismiss "{{title}}"?',
    dismissDescription:
      'Move this reminder to Completed without changing the original business record.',
    previous: 'Previous',
    next: 'Next',
    page: 'Page {{page}}, {{total}} items',
    noDue: 'No deadline',
    view: 'View',
    recipient: 'My received items',
    wait: 'Refreshing or saving, please wait',
  },
  aiAutomations: {
    settingsTitle: 'AI employee tasks',
  },
  // Permission set titles, for server-produced text such as the permissions a lapsed certificate withdraws.
  permissionSets: {
    hrAdmin: 'HR administrator',
    hrManager: 'Department manager',
    hrEmployee: 'Employee',
    hrInstructor: 'Instructor',
    cncOperator: 'CNC machine start (demo)',
  },
  notifications: {
    hrImportCheck: {
      title:
        'Import health check: {{mustFix}} must fix, {{suggested}} suggested',
      body: '{{report}}',
    },
    hrImportCheckClean: {
      title: 'Import health check',
      body: '{{report}}',
    },
    automationPositionDrafted: {
      title: 'The framework advisor drafted a position model',
      body: '{{position}}: {{requirements}} draft requirements ({{competencies}} new competencies). Please review.',
    },
    automationDictionaryReview: {
      title: 'Monthly competency dictionary review',
      body: 'Suggested: merge {{merge}}, disable {{deactivate}}, rewrite {{rewrite}} level descriptions. See the run for details.',
    },
    automationGapReport: {
      title: 'Weekly knowledge gap report',
      body: '{{questions}} unanswered questions in {{topics}} topics: {{list}}',
    },
    automationCourseDrafted: {
      title: 'The content writer drafted a course',
      body: '"{{course}}" was drafted from "{{document}}". Check it against the source before confirming.',
    },
    automationQuestionsDrafted: {
      title: 'The content writer drafted questions',
      body: '{{count}} draft questions for "{{course}}". Please review.',
    },
    automationRecertEscalation: {
      title: 'Renewal not started',
      body: '{{text}}',
    },
    automationRemedialAssigned: {
      title: 'Remedial learning assigned',
      body: 'The renewal of "{{certification}}" was not passed. Assigned: {{courses}}. Weak areas: {{weak}}.',
    },
    automationRemedialAssignedManager: {
      title: 'Renewal failed, remedial learning assigned',
      body: '{{name}} used all renewal attempts for "{{certification}}". Assigned: {{courses}}; weak areas: {{weak}}. An instructor can reset the attempts after the learning.',
    },
    pathAssigned: {
      title: 'New learning path: {{title}}',
      body: 'You were assigned the learning path "{{title}}". Complete its steps in order by {{date}}.',
    },
    pathStepUnlocked: {
      title: 'Next step unlocked',
      body: 'The next step of "{{path}}", "{{title}}", is now open.',
    },
    pathCompleted: {
      title: 'Learning path completed',
      body: 'You completed every required step of "{{title}}".',
    },
    sessionCancelled: {
      title: 'Training session cancelled',
      body: '"{{title}}" was cancelled. Enroll in another session from My learning.',
    },
    sessionAbsent: {
      title: 'Absent from training',
      body: '{{name}} enrolled in "{{title}}" but did not check in, and is recorded absent. The learning task stays open.',
    },
    sessionReminder: {
      title: 'Training tomorrow',
      body: '"{{title}}" starts at {{time}} in {{location}}. Check in with the QR code on arrival.',
    },
    learningPlanDrafted: {
      title: 'Learning plan to review: {{name}}',
      body: 'The learning coach drafted a learning plan for {{name}} ({{count}} items). Approve or reject it.',
    },
    learningPlanApproved: {
      title: 'New learning tasks',
      body: '{{name}} approved a learning plan for you: {{count}} learning tasks were created.',
    },
    learningNudge: {
      title: 'Learning reminder',
      body: '{{message}}',
    },
    learningLagManager: {
      title: 'Team learning falling behind',
      body: 'These {{count}} learning tasks are still well behind after reminders: {{names}}.',
    },
    practiceRecommended: {
      title: 'Practice before your exam',
      body: 'Before the "{{exam}}" exam, try the practice "{{title}}". Start it from My learning · Recommended, or ignore it.',
    },
    automationScenarioDrafted: {
      title: 'Practice scenario drafted',
      body: 'After "{{course}}" was published, the practice coach drafted the scenario "{{title}}". Review and confirm it.',
    },
    examGradingNeeded: {
      title: 'Answers to grade',
      body: '{{name}} submitted {{title}}.',
    },
    examPassed: {
      title: 'Exam passed',
      body: 'You passed {{title}} with {{score}} points.',
    },
    examFailed: {
      title: 'Exam not passed',
      body: 'You scored {{score}} on {{title}}.',
    },
    certificateIssued: {
      title: 'Certificate issued',
      body: '{{name}} is now certified: {{title}} ({{no}}), valid until {{date}}.',
    },
    certificateRenewed: {
      title: 'Certificate renewed',
      body: '{{name}}: {{title}} renewed ({{no}}), valid until {{date}}.',
    },
    certificateRevoked: {
      title: 'Certificate revoked',
      body: '{{title}} was revoked: {{reason}}. Permissions withdrawn: {{sets}}.',
    },
    certificateExpiring: {
      title: 'Certificate expiring soon',
      body: "{{name}}'s {{title}} expires on {{date}}.",
    },
    certificateExpired: {
      title: 'Certificate expired',
      body: "{{name}}'s {{title}} expired on {{date}}. Permissions withdrawn: {{sets}}.",
    },
    recertificationAssigned: {
      title: 'Time to renew a certificate',
      body: '{{title}} expires on {{date}}. Renew it in My exams.',
    },
    certificationReminder: {
      title: 'Certification reminder',
      body: '{{note}}',
    },
    weeklyBrief: {
      title: 'Weekly certification brief',
      body: '{{brief}}',
    },
    assignmentCreated: {
      title: 'New learning assignment',
      body: '{{title}} · due {{date}}',
    },
    assignmentReminder: {
      title: 'Reminder: finish your assignment',
      body: 'Please finish {{title}} by {{date}}.',
    },
    assignmentOverdue: {
      title: 'Learning assignment overdue',
      body: '{{name}}: {{title}} was due on {{date}}.',
    },
    assignmentDueSoon: {
      title: 'Learning assignment due soon',
      body: '{{title}} is due on {{date}}.',
    },
    actionTypes: {
      onboard: 'Onboarding',
      regularize: 'Regularization',
      transfer: 'Transfer',
      promote: 'Promotion',
      offboard: 'Offboarding',
    },
    actionPending: {
      title: 'A personnel action awaits your approval',
      body: '{{type}}: {{name}}',
    },
    actionRejected: {
      title: 'Your personnel action was rejected',
      body: '{{type}}: {{name}}. Comment: {{comment}}',
    },
    actionEffective: {
      title: 'A personnel action has taken effect',
      body: '{{type}}: {{name}}',
    },
    actionCancelled: {
      title: 'A personnel action was withdrawn',
      body: '{{type}}: {{name}}',
    },
    profileChangePending: {
      title: 'A profile change request awaits review',
      body: 'Submitted by {{name}}',
    },
    profileChangeApproved: {
      title: 'Your profile change was approved',
      body: 'Your profile has been updated. {{comment}}',
    },
    profileChangeRejected: {
      title: 'Your profile change was rejected',
      body: 'Comment: {{comment}}',
    },
    probationEnding: {
      title: 'Probation ending soon',
      body: "{{name}}'s probation ends on {{date}}.",
    },
    contractEnding: {
      title: 'Contract ending soon',
      body: 'Contract {{contractNo}} ends on {{date}} (within {{days}} days).',
    },
    contractExpired: {
      title: 'Contract expired',
      body: 'Contract {{contractNo}} ended on {{date}} and was marked expired.',
    },
  },
};

export type AppServerResource = LocaleResource<typeof enUS>;

export default enUS;

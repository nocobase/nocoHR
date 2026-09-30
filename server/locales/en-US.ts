import type { LocaleResource } from '@nocobase/i18n';
// V2-07
import { recruitingServerEn } from './modules/recruiting.js';
// V4-12
import { performanceServerEn } from './modules/performance.js';
// V4-13
import { talentReviewServerEn } from './modules/talent-review.js';
// V4-14
import { licensedServerEn } from './modules/licensed.js';

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
    cncOperator: 'Equipment start-up sign-off',
    // V3-11
    hrAuditor: 'Auditor',
    hrIntegration: 'Quality system integration',
    // V4-13
    ...talentReviewServerEn.permissionSets,
    // V4-14
    ...licensedServerEn.permissionSets,
  },
  notifications: {
    // V2-07 用工计划与招聘入职 (server/locales/modules/recruiting.ts).
    ...recruitingServerEn.notifications,
    // V4-12 绩效 (server/locales/modules/performance.ts).
    ...performanceServerEn.notifications,
    // V4-13 人才盘点与其他 (server/locales/modules/talent-review.ts).
    ...talentReviewServerEn.notifications,
    // V4-14 行业方案 · 持证上岗 (server/locales/modules/licensed.ts).
    ...licensedServerEn.notifications,
    // V3-11 profile, suggestions and content maintenance (profile/*.ts, revision-service.ts).
    trainingRecommendationPending: {
      title:
        'Training recommendation to confirm: {{department}} · {{competency}}',
      body: 'The talent analyst recommends targeted training for {{count}} people of {{department}} after repeated quality issues; the learning coach has chosen the content. Confirm or reject it in Pending decisions.',
    },
    trainingRecommendationNeedsContent: {
      title:
        'Training recommendation needs content: {{department}} · {{competency}}',
      body: 'The learning coach found too few courses, practice scenarios or exams. Ask an instructor to add content before the head confirms.',
    },
    recommendationAssigned: {
      title: 'Targeted training: {{competency}}',
      body: 'Your head assigned targeted training on {{competency}}. Complete it by {{date}}.',
    },
    recommendationCompleted: {
      title: 'Targeted training completed: {{department}} · {{competency}}',
      body: 'Everyone completed it; the training proof is ready.',
    },
    recommendationWritebackFailed: {
      title: '8D write-back failed: {{refs}}',
      body: 'The training proof could not be sent to the quality system. Retry on Business data.',
    },
    competencySuggestionDrafted: {
      title: 'Level suggestions to decide ({{count}})',
      body: 'The talent analyst suggests level changes from business data and exam results: {{list}}. Accept or reject them in Pending decisions.',
    },
    signalRuleDrafted: {
      title: 'Matching rules to confirm ({{count}})',
      body: 'The talent analyst drafted rules for unmatched categories: {{list}}. Confirm or change them under Business data · Unmatched.',
    },
    talentMonthlyReport: {
      title: '{{month}} team capability report',
      body: '{{text}}',
    },
    talentMonthlyReportCompany: {
      title: '{{month}} company capability report',
      body: '{{text}}',
    },
    revisionReady: {
      title: 'Version revision: {{title}} {{version}}',
      body: 'The content writer drafted a change brief and {{count}} revision suggestions; about {{people}} people need the change training.',
    },
    revisionAssigned: {
      title: 'Change training: {{title}}',
      body: 'A work instruction changed. Complete "{{title}}" by {{date}}.',
    },
    questionQualityFound: {
      title: 'Question quality check: {{count}} questions to rewrite',
      body: 'The content writer found questions with an abnormal correct rate and drafted rewrites. Handle them under Revisions · Question quality.',
    },
    // V3-11 end
    hrImportCheck: {
      title:
        'Import health check: {{mustFix}} must fix, {{suggested}} suggested',
      body: '{{report}}',
    },
    hrProbationPrep: {
      title: 'Probation review: {{name}}’s probation ends on {{date}}',
      body: '{{text}}',
    },
    hrChangeChecklist: {
      title: 'Change checklist: {{name}}, {{count}} items to handle',
      body: 'The HR assistant listed what this change touches. Please go through the items.',
    },
    hrChangeChecklistOverdue: {
      title: 'Change checklist overdue: {{name}} has {{count}} items left',
      body: 'The checklist is past its due date. Please handle the remaining items.',
    },
    hrCompliance: {
      title: 'Employment compliance notice: {{name}}',
      body: '{{text}}',
    },
    hrRenewalPrep: {
      title:
        'Renewal review: contract {{contractNo}} of {{name}} ends on {{date}}',
      body: '{{text}}',
    },
    hrAttachmentExtracted: {
      title: 'The HR assistant read an attachment',
      body: '{{fields}} fields are waiting for your review under pending profile changes. The record itself is unchanged.',
    },
    hrSyncExplained: {
      title: 'The HR assistant explained {{count}} sync items',
      body: 'By type: {{types}}. {{drafts}} job-title mappings drafted. See Organization sync · Pending.',
    },
    orgSyncFailed: {
      title: 'Organization sync failed',
      body: 'Reason: {{reason}}. Check the data source and sync again.',
    },
    orgSyncOnboarded: {
      title: 'The sync created employee {{name}}',
      body: 'Complete the record and the employment contract of {{name}}.',
    },
    orgSyncOffboarded: {
      title: 'The sync set {{name}} as left',
      body: '{{name}} was deactivated in the office suite. The contract in force was not terminated; handle it in Contracts.',
    },
    orgSyncMoved: {
      title: 'The job of {{name}} changed with the sync',
      body: 'The {{type}} from the office suite was written to NocoHR.',
    },
    documentConflictFound: {
      title: '{{title}} and {{other}} disagree in {{count}} places',
      body: 'The knowledge assistant found two documents saying different things about the same matter. Check and handle it; it does not decide which is right.',
    },
    schedulePublished: {
      title: 'Your schedule for {{from}} – {{to}} is published',
      body: '{{count}} days were published. Open My attendance to see your shifts.',
    },
    scheduleChanged: {
      title: 'Your schedule for {{from}} – {{to}} changed',
      body: '{{count}} published days changed. Open My attendance to see your shifts.',
    },
    scheduleLeaveConflict: {
      title: "{{name}}'s approved leave conflicts with the {{date}} schedule",
      body: 'The shift is blocked. The HR assistant suggests cover; choose someone and save the schedule.',
    },
    replacementSuggested: {
      title: 'Cover suggestions for {{name}} on {{date}}',
      body: 'The HR assistant suggests: {{candidates}}. The schedule is unchanged until you save it.',
    },
    replacementNone: {
      title: 'No cover found for {{name}} on {{date}}',
      body: 'Nobody in the department meets the rules for that shift; consider arranging cover with another department.',
    },
    scheduleTransferBlocked: {
      title: "{{name}}'s schedule no longer fits after the transfer",
      body: '{{count}} shifts from {{from}} to {{to}} are blocked by department scope; reschedule them.',
    },
    scheduleOffboardCleared: {
      title: "{{name}}'s shifts after {{date}} were removed",
      body: '{{count}} shifts after the leaving date were cleared; check whether cover is needed.',
    },
    adjustmentPending: {
      title: '{{name}} requests an attendance change on {{date}}',
      body: 'Open Approvals to decide.',
    },
    shiftSwapConsent: {
      title: '{{name}} asks to swap shifts with you on {{date}}',
      body: 'Agree or decline in My attendance; the head decides after you.',
    },
    adjustmentApproved: {
      title: 'Your attendance request for {{date}} was approved',
      body: 'The day has been recalculated.',
    },
    adjustmentRejected: {
      title: 'Your attendance request for {{date}} was rejected',
      body: 'Open My attendance to see the reason.',
    },
    attendanceSummaryReady: {
      title: 'Your attendance summary for {{month}} is ready',
      body: 'Confirm it or raise an objection within {{days}} days.',
    },
    attendanceObjection: {
      title: '{{name}} objects to the {{month}} attendance summary',
      body: 'Handle the objection before locking the month.',
    },
    attendanceObjectionHandled: {
      title: 'Your objection to the {{month}} summary was handled',
      body: '{{result}}',
    },
    attendanceMissingSelf: {
      title: 'You missed punches on {{days}} days in a row',
      body: 'From {{from}} to {{to}}. Submit a missed-punch request if you worked.',
    },
    attendanceMissingHead: {
      title: '{{name}} missed punches on {{days}} days in a row',
      body: 'From {{from}} to {{to}}. {{name}} has no account; please follow up.',
    },
    attendanceOvertimeNear: {
      title: "{{name}}'s overtime this month is near the alert line",
      body: '{{hours}} hours approved against an alert line of {{alert}} hours.',
    },
    attendanceMonthCheck: {
      title: 'Attendance to settle before locking {{month}}',
      body: '{{list}}',
    },
    attendanceMonthCheckClean: {
      title: '{{month}} attendance has nothing left to settle',
      body: 'All summaries are confirmed and no requests are open.',
    },
    // V2-05 (realigned): leave approvals, attendance inquiries, cover invitations.
    leavePending: {
      title: '{{name}} requested {{leaveType}}',
      body: '{{from}} to {{to}}, {{duration}} in total. Decide it under Approvals.',
      body_day:
        '{{from}} to {{to}}, {{duration}} days in total. Decide it under Approvals.',
      body_hour:
        '{{from}} to {{to}}, {{duration}} hours in total. Decide it under Approvals.',
    },
    leaveApproved: {
      title: 'Your {{leaveType}} request is approved',
      body: '{{from}} to {{to}}.',
    },
    leaveRejected: {
      title: 'Your {{leaveType}} request was not approved',
      body: 'See the comment under My profile · Attendance and leave.',
    },
    attendanceInquiryHead: {
      title: '{{name}} has an attendance anomaly to follow up',
      body: '{{detail}}. {{name}} has no account or no Feishu binding, so the HR assistant cannot ask directly. Please follow up.',
    },
    attendanceInquiryOverdue: {
      title: "{{name}}'s attendance anomaly has had no reply for {{days}} days",
      body: '{{detail}}. If the day was worked as usual, submit a missed-punch request or an exception explanation.',
    },
    replacementAccepted: {
      title: '{{name}} accepted the cover invitation for {{date}}',
      body: 'It is in the draft schedule. Confirm and publish it on the Schedules page; publishing checks it as usual.',
    },
    documentReviewDue: {
      title: '{{title}} is due for review on {{date}}',
      body: 'Review the document, then mark it reviewed or upload a new version.',
    },
    documentReviewOverdue: {
      title: '{{title}} is past its review date ({{date}})',
      body: 'The document is overdue for review. Review it or upload a new version soon.',
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
      body: 'Suggested: merge {{merge}}, disable {{deactivate}}, rewrite {{rewrite}} level descriptions, {{positions}} position framework items. See the run for details.',
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
    // V3-09
    pathAutoAssignedHead: {
      title: 'Onboarding path assigned: {{name}}',
      body: 'After the job change, {{name}} was automatically assigned the learning path "{{title}}", due {{date}}.',
    },
    learningContentMissing: {
      title: 'Courses needed: {{competencies}}',
      body: 'While drafting learning plans for a target position, the learning coach found no published course for: {{competencies}}. Please add courses.',
    },
    learningPlanMerged: {
      title: 'Learning plan extended: {{name}}',
      body: 'The learning coach added {{count}} items to the draft learning plan for {{name}}. Approve or reject it as a whole.',
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
    // V3-10 exams and certification
    examGradingNeededAi: {
      title: 'An attempt to grade (AI suggestions ready)',
      body: '{{name}} submitted {{title}}. The examiner suggested scores for the short answers; confirm them and grade.',
    },
    certificateExpiredNotice: {
      title: 'Certificate expired',
      body: "{{name}}'s {{title}} expired on {{date}}. It no longer counts as a valid certificate, and the position's required qualification shows as missing.",
    },
    certificateExpiredWithSets: {
      title: 'Certificate expired',
      body: "{{name}}'s {{title}} expired on {{date}}. It no longer counts as a valid certificate, and the position's required qualification shows as missing. Permissions withdrawn: {{sets}}.",
    },
    certificateRevokedNotice: {
      title: 'Certificate revoked',
      body: '{{title}} was revoked: {{reason}}. It no longer counts as a valid certificate.',
    },
    externalCertificateExpiring: {
      title: 'External certificate expiring',
      body: 'Your {{title}} expires on {{date}}. Renew it and register the new one.',
    },
    externalCertificateVerified: {
      title: 'External certificate verified',
      body: 'Your {{title}} was verified and now counts as a valid certificate.',
    },
    externalCertificateRejected: {
      title: 'External certificate not verified',
      body: 'Your {{title}} was not verified: {{note}}. Correct it and submit it again.',
    },
    examFailedSelfStudy: {
      title: 'Where the points were lost',
      body: '{{title}} was not passed. Competencies with the most points lost: {{weak}}. Study on your own: {{content}}.',
    },
    qualificationDossierReady: {
      title: '{{name}} is qualified for {{position}}',
      body: 'The certification steward prepared the appointment material with a pre-filled promotion form. Appointing is your decision; nothing is started automatically.',
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
    // V2-06 薪酬与社保: no notification carries an amount.
    payrollOnboard: {
      title: '{{name}} needs a salary file',
      body: 'Joined on {{date}}: create the salary file and confirm the insurance enrolment.',
    },
    payrollOffboard: {
      title: '{{name}} leaves on {{date}}',
      body: 'The last month is paid by the days employed; confirm the insurance stop.',
    },
    payrollTransfer: {
      title: "{{type}}: check {{name}}'s salary structure",
      body: 'Effective {{date}}. The applicable salary structure may change; start an adjustment if needed.',
    },
    payrollAdjustmentPending: {
      title: 'A salary adjustment awaits your approval',
      body: '{{name}}, effective {{month}}',
    },
    payrollAdjustmentApproved: {
      title: 'Salary adjustment approved',
      body: '{{name}}, effective {{month}}',
    },
    payrollAdjustmentRejected: {
      title: 'Salary adjustment rejected',
      body: '{{name}}, effective {{month}}',
    },
    payrollCyclePending: {
      title: 'Payroll {{month}} awaits your approval',
      body: 'Review the payroll sheet, then approve or reject it.',
    },
    payrollCycleApproved: {
      title: 'Payroll {{month}} approved',
      body: 'The payroll sheet is locked; publish the payslips when ready.',
    },
    payrollCycleRejected: {
      title: 'Payroll {{month}} returned',
      body: 'Check the approver comment, correct and submit again.',
    },
    payrollAnomalies: {
      title: 'Payroll check {{month}}: {{count}} anomalies',
      body: 'Added: {{added}}. Resolved: {{removed}}.',
    },
    payrollAnomaliesClean: {
      title: 'Payroll check {{month}}: no anomalies found',
      body: 'Resolved: {{removed}}.',
    },
    payslipPublished: {
      title: 'Your payslip for {{month}} is ready',
      body: 'Verify your identity on the payslip page to view it.',
    },
    payrollInsuranceMonthly: {
      title: 'Insurance changes for {{month}}',
      body: 'Started: {{started}}, stopped: {{stopped}}, waiting for confirmation: {{pending}}.',
    },
    payrollBaseAdjust: {
      title: 'Insurance base adjustment {{year}}',
      body: '{{count}} suggestions to review and confirm.',
    },
    payrollVendorBillReviewed: {
      title: '{{vendor}} bill for {{month}} reconciled',
      body: '{{diffPeople}} people differ, {{diffHours}} hours in total.',
    },
    payrollVendorBillUploaded: {
      title: '{{vendor}} bill for {{month}} uploaded',
      body: '{{diffPeople}} people differ, {{diffHours}} hours in total.',
    },
  },
  // V1-04 办公软件机器人与飞书卡片 (server/providers/hr/im-channel.ts, im-cards/)
  imBot: {
    textOnly:
      'I can only answer text messages for now. Please type your question.',
    payLinkOnly:
      'Please open your payslip in NocoHR and verify your identity there: {{link}}',
    groupOnly:
      'Please message me privately, so no personal information is posted in the group.',
    unbound:
      'We could not identify you: sign in to NocoHR with Feishu once, or ask HR to create your account.',
    confirmInApp: 'This step needs your confirmation in NocoHR.',
    noAnswer: 'Nothing was found in the current documents. Please contact HR.',
    viewInApp: 'View in NocoHR: {{link}}',
    unavailable:
      'The AI assistant is unavailable right now. Try again later or check NocoHR.',
    cardSent: 'I have put your changes on a card. Check them and press Submit.',
    fieldNotAllowed:
      'Some of these fields cannot be changed through self-service. Contact HR, or submit in NocoHR.',
  },
  imCards: {
    openInApp: 'View in NocoHR',
    unknown: { title: 'Card' },
    state: {
      handled: 'Handled',
      unavailable: 'No longer available',
    },
    result: {
      duplicate: 'This press was already received.',
      notFound: 'This card is no longer available.',
      notRecipient: 'This card was not sent to you.',
      alreadyHandled: 'This item has already been handled.',
      failed: 'The operation failed ({{code}}). Please handle it in NocoHR.',
    },
    approval: {
      title: '{{type}} approval',
      effectiveDate: 'Effective {{date}}',
      applicant: 'Applicant {{name}} · level {{level}}',
      approve: 'Approve',
      reject: 'Reject',
      approved: 'approved',
      rejected: 'rejected',
      approvedDone: 'Approved. The action moves to the next step.',
      rejectedDone: 'Rejected. The applicant has been told.',
      commentRequired: 'A comment is required to reject.',
      notApprover: 'You are not the current approver of this action.',
      selfApproval: 'You cannot approve an action about yourself.',
      status: {
        draft: 'draft',
        pending: 'waiting for the next approver',
        approved: 'approved, not yet effective',
        effective: 'effective',
        rejected: 'rejected',
        cancelled: 'withdrawn',
      },
    },
    profileChange: {
      title: 'Profile change request',
      submit: 'Submit',
      discard: 'Discard',
      editInApp: 'Edit and submit in NocoHR',
      submitted: 'Submitted. HR will review it.',
      discarded: 'Discarded.',
      pending:
        'You already have a request waiting for HR. Submit again after it is handled.',
      forbidden: 'You cannot submit profile changes.',
      empty: '(empty)',
      items: '{{count}} entries',
      fields: {
        mobile: 'Mobile',
        email: 'Email',
        address: 'Address',
        emergencyContacts: 'Emergency contacts',
        educations: 'Education',
        experiences: 'Work experience',
      },
    },
  },
  // V2-05 (realigned) attendance and leave cards and inquiries (server/providers/hr/attendance-cards.ts)
  attendanceCards: {
    submit: 'Submit',
    discard: 'Discard',
    editInApp: 'Edit in NocoHR',
    customField: '{{en}}: {{value}}',
    yes: 'Yes',
    no: 'No',
    customFieldsRequired:
      'Some required fields are empty: fill them in NocoHR, then submit.',
    units: { day: 'days', halfDay: 'days', hour: 'hours' },
    types: {
      missingPunch: 'Missed punch',
      overtime: 'Overtime',
      shiftSwap: 'Shift swap',
      exception: 'Exception explanation',
    },
    anomalies: {
      late: 'late',
      earlyLeave: 'early leave',
      missingPunch: 'missed punch',
    },
    sides: { in: 'check-in', out: 'check-out' },
    leaveSubmit: {
      title: 'Leave request (drafted by the HR assistant)',
      line: '{{leaveType}} · {{from}} to {{to}} · {{duration}} {{unit}}',
      reason: 'Reason: {{reason}}',
      conflict:
        'Conflicts with the published schedule: {{date}} {{shift}} ({{time}})',
      attachment:
        'This leave type needs proof: upload it in NocoHR, then submit.',
      submitted: 'Submitted for approval.',
      discarded:
        'Discarded. The draft stays under My requests, to edit and submit later.',
      attachmentRequired: 'Upload the proof first, then submit in NocoHR.',
    },
    adjustmentSubmit: {
      title: 'Attendance request (drafted by the HR assistant)',
      missingPunch: 'Missed punch · {{date}} {{shift}} · {{side}} {{time}}',
      exception:
        'Exception explanation · {{date}} {{anomaly}} {{minutes}} minutes',
      reason: 'Reason: {{reason}}',
      policy: 'Policy: {{citation}}',
      submitted: 'Submitted {{count}} requests for approval.',
      partial:
        'Submitted {{done}}; {{failed}} could not be submitted ({{code}}). Handle them in NocoHR.',
      limit:
        'This month’s missed-punch limit ({{limit}}) is reached; ask your manager.',
      discarded: 'Discarded these drafts.',
    },
    approval: {
      leaveTitle: 'Leave approval',
      title: '{{type}} approval',
      consentTitle: 'Shift swap consent',
      leaveLine:
        '{{name}} · {{leaveType}} · {{from}} to {{to}} · {{duration}} {{unit}}',
      line: '{{name}} · {{type}} · {{date}}',
      level: 'Approval level {{level}}',
      reason: 'Reason: {{reason}}',
      agree: 'Agree',
      disagree: 'Decline',
      status: {
        pending: 'Waiting for the next level',
        approved: 'Approved',
        rejected: 'Rejected',
        cancelled: 'Withdrawn',
      },
    },
    invite: {
      title: 'Cover invitation',
      line: '{{date}} {{shift}} ({{time}})',
      from: '{{department}} · from {{inviter}}',
      accept: 'Accept',
      decline: 'Not available',
      accepted: 'Accepted. It takes effect once the scheduler publishes it.',
      declined: 'Answered: not available. Thank you.',
      expired:
        'This invitation has expired (a colleague accepted, or the schedule changed).',
      notEligible:
        'You no longer meet the cover rules for that day, so the invitation cannot be accepted.',
      state: {
        accepted: 'Accepted',
        declined: 'Not available',
        expired: 'Expired',
      },
    },
    inquiry: {
      missingOut:
        'There is no check-out on {{dates}} ({{shift}}). Did you forget to punch?',
      missingOutOne:
        'There is no check-out on {{dates}} ({{shift}}). Did you forget to punch?',
      missingIn:
        'There is no check-in on {{dates}} ({{shift}}). Did you forget to punch?',
      missingInOne:
        'There is no check-in on {{dates}} ({{shift}}). Did you forget to punch?',
      late: 'You started {{minutes}} minutes late on {{dates}}. Would you like to explain?',
      earlyLeave:
        'You left {{minutes}} minutes early on {{dates}} ({{shift}}). Would you like to explain?',
      day: 'the {{day}}',
      detailMissing: 'Missed punch on {{dates}}',
      detailLate: '{{minutes}} minutes late on {{dates}}',
      detailEarly: '{{minutes}} minutes early leave on {{dates}}',
      draftedMissing:
        'I drafted {{count}} missed-punch requests at the shift times. Check them on the card and press Submit.',
      draftedException:
        'Under “{{clause}}” of {{title}}, this can be explained. I drafted an exception explanation: check it on the card and press Submit.',
      draftedExceptionPlain:
        'I drafted an exception explanation: check it on the card and press Submit. Your manager decides on it.',
      suggestLeave:
        'If you need leave that day, request it in NocoHR. Missed punches and explanations must be truthful; whether to submit is up to you.',
      thanks:
        'Thanks. You can submit a missed-punch request or an explanation under My profile · Attendance and leave in NocoHR.',
      missingReason: 'Forgot to punch; worked as usual that day',
    },
    bot: {
      leaveCard:
        'I drafted the leave request: check it on the card and press Submit.',
      adjustmentCard:
        'I drafted the attendance request: check it on the card and press Submit.',
    },
  },
  // V3-08 能力体系
  competency: {
    assessmentTodo: {
      title: 'Assess {{name}}',
      summary:
        'Mandatory competencies not yet assessed ({{count}}): {{competencies}}',
    },
  },
  // V2-07
  // Permission set titles the recruiting and payroll seeds store (recruiting.* / payroll.* keys).
  recruiting: {
    ...recruitingServerEn.top,
    permissionSets: {
      hrRecruiter: 'Recruiter',
      hrIntegrationErp: 'ERP integration (production plans)',
    },
  },
  payroll: {
    permissionSets: {
      hrPayroll: 'Payroll specialist',
      hrPayrollApprover: 'Payroll approver',
    },
  },
};

export type AppServerResource = LocaleResource<typeof enUS>;

export default enUS;

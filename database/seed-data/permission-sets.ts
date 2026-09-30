/**
 * The initial job permission sets of the talent platform. Seeds persist them
 * once on a fresh installation; administrators edit them afterwards in
 * Settings → Authorization. Grants reference the composite declarations the
 * server registers, so a renamed action fails the type check here.
 */
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import type { PermissionGrant } from '@nocobase/authorization/core';

import {
  assessmentResource,
  competencyResource,
  contractResource,
  employeeResource,
  frameworkAdvisorResource,
  frameworkResource,
  hrAssistantResource,
  hrReportResource,
  jobEventResource,
  MANAGED_DEPARTMENTS_SCOPE,
  orgChartResource,
  personnelActionResource,
  profileChangeResource,
  profileResource,
  rosterResource,
  SELF_SCOPE,
} from '../../server/providers/hr/authz-resources.js';
import {
  certificateResource,
  certificationResource,
  certificationStewardResource,
  demoBatchResource,
  examResource,
  examTakingResource,
  questionResource,
  trainingReportResource,
} from '../../server/providers/hr/exam-resources.js';
import {
  assignmentResource,
  contentWriterResource,
  courseResource,
  kbDocumentResource,
  knowledgeAssistantResource,
  knowledgeGapResource,
  learningHistoryResource,
  learningResource,
  OWNED_BY_ME_SCOPE,
  VISIBLE_DOCUMENTS_SCOPE,
} from '../../server/providers/hr/learning-resources.js';
import {
  learningCoachResource,
  learningPathResource,
  learningPlanResource,
  practiceCoachResource,
  practiceResource,
  practiceScenarioResource,
  trainingSessionResource,
} from '../../server/providers/hr/training-resources.js';
import { leaveResource } from '../../server/providers/hr/leave-resources.js';

const ALL = 'allRecords';
const MANAGED = MANAGED_DEPARTMENTS_SCOPE;
const SELF = SELF_SCOPE;
const VISIBLE = VISIBLE_DOCUMENTS_SCOPE;
const OWNED = OWNED_BY_ME_SCOPE;
const leaveRequestParts = (scope: string) => ({
  requests: scope,
  employees: scope,
  types: ALL,
  balances: scope,
  schedules: scope,
  attendance: scope,
  configuration: ALL,
});

const page = (id: string): PermissionGrant => ({
  resource: { type: 'page', id },
  actions: [{ action: 'access' }],
});
const settings = (id: string, actions: readonly string[]): PermissionGrant => ({
  resource: { type: 'settings', id },
  actions: actions.map((action) => ({ action })),
});

const frameworkView = frameworkResource.reference().grant({
  view: { jobFamilies: ALL, positions: ALL, positionRequirements: ALL },
});
const competencyView = competencyResource
  .reference()
  .grant({ view: { competencies: ALL, competencyLevels: ALL } });
const orgChartView = orgChartResource
  .reference()
  .grant({ view: { departments: ALL, employees: ALL } });

// ---------- Knowledge and learning (V1 step 2), exams and certification (steps 3 and 4) ----------
const documentLinks = (scope: string) => ({
  kbDocumentCompetencies: scope,
  kbDocumentDepartments: scope,
  kbDocumentPositions: scope,
});
// Rows without an owner column (lessons, links) take the scope "all"; the service checks their parent course or document.
const courseParts = { lessons: ALL, courseCompetencies: ALL };
const documentsVisible = kbDocumentResource
  .reference()
  .grant({ view: { kbDocuments: VISIBLE, ...documentLinks(ALL) } });
const study = learningResource
  .reference()
  .grant({ study: { assignments: SELF, learningRecords: SELF } });
const assistant = (documents: string) =>
  knowledgeAssistantResource
    .reference()
    .grant({ use: { kbDocuments: documents, knowledgeGaps: ALL } });
/** Switching an AI employee's proactive work on or off, choosing its owner and run time, and reading its runs. */
const configure = {
  aiAutomationSettings: ALL,
  aiTaskRuns: ALL,
  aiTaskRunItems: ALL,
};
const takeExams = examTakingResource.reference().grant({
  start: { examAttempts: SELF },
  save: { examAttempts: SELF },
  submit: { examAttempts: SELF },
  viewResult: { examAttempts: SELF },
});
const browseCertifications = certificationResource.reference().grant({
  view: {
    certifications: ALL,
    certificationCourses: ALL,
    certificationExams: ALL,
  },
});
// ---------- Training operations (V2 step 5) ----------
const pathParts = (scope: string) => ({
  learningPaths: scope,
  learningPathSteps: ALL,
});
const scenarioParts = (scope: string) => ({
  practiceScenarios: scope,
  practiceScenarioCompetencies: ALL,
});
/** Every employee: practising, checking in, enrolling oneself, asking the coaches about oneself. */
const learnerTraining = [
  page('talent.practice'),
  page('talent.checkIn'),
  practiceResource.reference().grant({
    start: { practiceSessions: SELF },
    view: { practiceSessions: SELF },
  }),
  trainingSessionResource.reference().grant({
    view: { trainingSessions: ALL, trainingEnrollments: SELF },
    enroll: { trainingEnrollments: SELF, employees: SELF },
    checkIn: { trainingEnrollments: SELF },
  }),
  learningCoachResource
    .reference()
    .grant({ use: { employees: SELF, learningPlans: SELF } }),
  practiceCoachResource.reference().grant({ use: { practiceScenarios: ALL } }),
];

const LEARNER_PAGES = [
  'talent.myLearning',
  'talent.knowledgeQa',
  'talent.knowledge',
  'talent.myExams',
  'talent.certifications',
];

export const hrAdmin = definePermissionSet('hr.admin')
  .title({ key: 'permissionSets.hrAdmin', ns: 'hr' })
  .grant(
    page('talent.me'),
    page('talent.approvals'),
    page('talent.leave'),
    page('talent.employees'),
    page('talent.positions'),
    page('talent.framework'),
    page('talent.competencies'),
    page('talent.actions'),
    page('talent.contracts'),
    page('talent.hrReports'),
    page('talent.orgChart'),
    settings('talent.departments', ['read', 'update']),
    settings('talent.hr', ['administer']),
    settings('talent.aiAutomations', ['read']),
    employeeResource.reference().grant({
      view: { employees: ALL },
      list: { employees: ALL },
      viewSensitive: { employees: ALL },
      viewNotes: { employees: ALL },
      create: { employees: ALL },
      update: { employees: ALL },
      import: { employees: ALL },
      linkUser: { employees: ALL },
      markLeave: { employees: ALL },
      correctJob: { employees: ALL },
      delete: { employees: ALL },
    }),
    leaveResource.reference().grant({
      request: leaveRequestParts(ALL),
      approve: leaveRequestParts(ALL),
    }),
    hrAssistantResource.reference().grant({
      configure,
      use: { employees: SELF },
      extract: { employees: ALL },
    }),
    jobEventResource.reference().grant({ view: { jobEvents: ALL } }),
    assessmentResource.reference().grant({
      view: { employeeCompetencies: ALL },
      create: { employeeCompetencies: ALL },
    }),
    frameworkResource.reference().grant({
      view: { jobFamilies: ALL, positions: ALL, positionRequirements: ALL },
      manage: { jobFamilies: ALL, positions: ALL, positionRequirements: ALL },
      confirm: { positionRequirements: ALL },
    }),
    competencyResource.reference().grant({
      view: { competencies: ALL, competencyLevels: ALL },
      manage: { competencies: ALL, competencyLevels: ALL },
      confirm: { competencies: ALL, competencyLevels: ALL },
    }),
    frameworkAdvisorResource
      .reference()
      .grant({ use: { positions: ALL, competencies: ALL }, configure }),
    profileResource.reference().grant({
      view: { employeeEducations: ALL, employeeExperiences: ALL },
      viewContacts: {
        employeeEmergencyContacts: ALL,
        employeeAttachments: ALL,
      },
      manage: {
        employeeEducations: ALL,
        employeeExperiences: ALL,
        employeeEmergencyContacts: ALL,
        employeeAttachments: ALL,
      },
    }),
    contractResource.reference().grant({
      view: { employmentContracts: ALL },
      manage: { employmentContracts: ALL },
    }),
    personnelActionResource.reference().grant({
      view: { personnelActions: ALL },
      create: { personnelActions: ALL },
      approve: { personnelActions: ALL },
      cancel: { personnelActions: ALL },
    }),
    profileChangeResource.reference().grant({
      request: { profileChangeRequests: SELF },
      review: { profileChangeRequests: ALL },
    }),
    rosterResource.reference().grant({ export: { employees: ALL } }),
    hrReportResource.reference().grant({ view: { employees: ALL } }),
    orgChartView,
    ...LEARNER_PAGES.map(page),
    page('talent.courses'),
    page('talent.assignments'),
    page('talent.questions'),
    page('talent.exams'),
    page('talent.trainingReports'),
    kbDocumentResource.reference().grant({
      view: { kbDocuments: ALL, ...documentLinks(ALL) },
      manage: { kbDocuments: ALL, ...documentLinks(ALL) },
    }),
    knowledgeGapResource
      .reference()
      .grant({ view: { knowledgeGaps: ALL }, resolve: { knowledgeGaps: ALL } }),
    courseResource.reference().grant({
      view: { courses: ALL, ...courseParts },
      manage: { courses: ALL, ...courseParts },
      confirm: { courses: ALL },
      discard: { courses: ALL, lessons: ALL, courseCompetencies: ALL },
      publish: { courses: ALL },
    }),
    assignmentResource.reference().grant({
      view: { assignments: ALL },
      create: { assignments: ALL, employees: ALL },
      remind: { assignments: ALL },
      updateDue: { assignments: ALL },
      cancel: { assignments: ALL },
    }),
    study,
    learningHistoryResource
      .reference()
      .grant({ view: { assignments: ALL, learningRecords: ALL } }),
    knowledgeAssistantResource.reference().grant({
      use: { kbDocuments: ALL, knowledgeGaps: ALL },
      configure,
    }),
    contentWriterResource
      .reference()
      .grant({ use: { kbDocuments: ALL, courses: ALL }, configure }),
    questionResource.reference().grant({
      view: { questions: ALL, questionCompetencies: ALL },
      manage: { questions: ALL, questionCompetencies: ALL },
      confirm: { questions: ALL },
      import: { questions: ALL, questionCompetencies: ALL },
    }),
    examResource.reference().grant({
      view: { exams: ALL, examQuestions: ALL },
      manage: { exams: ALL, examQuestions: ALL },
      publish: { exams: ALL },
      grade: { exams: ALL, examAttempts: ALL },
      resetAttempts: { exams: ALL, examAttempts: ALL },
    }),
    takeExams,
    certificationResource.reference().grant({
      view: {
        certifications: ALL,
        certificationCourses: ALL,
        certificationExams: ALL,
      },
      manage: {
        certifications: ALL,
        certificationCourses: ALL,
        certificationExams: ALL,
      },
    }),
    certificateResource.reference().grant({
      view: { employeeCertificates: ALL },
      revoke: { employeeCertificates: ALL },
      download: { employeeCertificates: ALL },
    }),
    trainingReportResource.reference().grant({
      view: {
        employees: ALL,
        assignments: ALL,
        examAttempts: ALL,
        employeeCertificates: ALL,
      },
    }),
    certificationStewardResource.reference().grant({
      use: { employees: ALL, employeeCertificates: ALL },
      configure,
    }),
    page('talent.paths'),
    page('talent.sessions'),
    page('talent.practiceScenarios'),
    page('talent.learningPlans'),
    page('talent.practice'),
    page('talent.checkIn'),
    learningPathResource.reference().grant({
      view: pathParts(ALL),
      manage: pathParts(ALL),
      publish: { learningPaths: ALL },
    }),
    trainingSessionResource.reference().grant({
      view: { trainingSessions: ALL, trainingEnrollments: ALL },
      manage: { trainingSessions: ALL },
      enroll: { trainingEnrollments: ALL, employees: ALL },
      checkIn: { trainingEnrollments: SELF },
      markAttendance: { trainingEnrollments: ALL },
      export: { trainingEnrollments: ALL },
    }),
    practiceScenarioResource.reference().grant({
      view: scenarioParts(ALL),
      manage: scenarioParts(ALL),
      confirm: { practiceScenarios: ALL },
    }),
    practiceResource.reference().grant({
      start: { practiceSessions: SELF },
      view: { practiceSessions: ALL },
      viewScores: { practiceSessions: ALL },
    }),
    learningPlanResource.reference().grant({
      view: { learningPlans: ALL },
      approve: { learningPlans: ALL },
      reject: { learningPlans: ALL },
    }),
    learningCoachResource.reference().grant({
      use: { employees: ALL, learningPlans: ALL },
      configure,
    }),
    practiceCoachResource
      .reference()
      .grant({ use: { practiceScenarios: ALL }, configure }),
  )
  .build();

export const hrManager = definePermissionSet('hr.manager')
  .title({ key: 'permissionSets.hrManager', ns: 'hr' })
  .grant(
    page('talent.me'),
    page('talent.approvals'),
    page('talent.employees'),
    page('talent.positions'),
    page('talent.framework'),
    page('talent.actions'),
    page('talent.hrReports'),
    page('talent.orgChart'),
    employeeResource
      .reference()
      .grant({ view: { employees: MANAGED }, list: { employees: MANAGED } }),
    leaveResource.reference().grant({
      request: leaveRequestParts(SELF),
      approve: leaveRequestParts(MANAGED),
    }),
    assessmentResource.reference().grant({
      view: { employeeCompetencies: MANAGED },
      create: { employeeCompetencies: MANAGED },
    }),
    frameworkView,
    competencyView,
    profileResource.reference().grant({
      view: { employeeEducations: MANAGED, employeeExperiences: MANAGED },
    }),
    personnelActionResource.reference().grant({
      view: { personnelActions: MANAGED },
      create: { personnelActions: MANAGED },
      approve: { personnelActions: MANAGED },
      cancel: { personnelActions: MANAGED },
    }),
    rosterResource.reference().grant({ export: { employees: MANAGED } }),
    hrReportResource.reference().grant({ view: { employees: MANAGED } }),
    jobEventResource.reference().grant({ view: { jobEvents: MANAGED } }),
    hrAssistantResource.reference().grant({ use: { employees: SELF } }),
    orgChartView,
    ...LEARNER_PAGES.map(page),
    page('talent.assignments'),
    page('talent.trainingReports'),
    documentsVisible,
    assignmentResource.reference().grant({
      view: { assignments: MANAGED },
      create: { assignments: MANAGED, employees: MANAGED },
      remind: { assignments: MANAGED },
      updateDue: { assignments: MANAGED },
    }),
    study,
    learningHistoryResource
      .reference()
      .grant({ view: { assignments: MANAGED, learningRecords: MANAGED } }),
    assistant(VISIBLE),
    takeExams,
    browseCertifications,
    certificateResource
      .reference()
      .grant({ view: { employeeCertificates: MANAGED } }),
    trainingReportResource.reference().grant({
      view: {
        employees: MANAGED,
        assignments: MANAGED,
        examAttempts: MANAGED,
        employeeCertificates: MANAGED,
      },
    }),
    certificationStewardResource
      .reference()
      .grant({ use: { employees: MANAGED, employeeCertificates: MANAGED } }),
    page('talent.practice'),
    page('talent.checkIn'),
    practiceCoachResource
      .reference()
      .grant({ use: { practiceScenarios: ALL } }),
    page('talent.learningPlans'),
    page('talent.sessions'),
    // Plans for one's teams, or waiting for one's decision (the managed scope includes the reviewer).
    learningPlanResource.reference().grant({
      view: { learningPlans: MANAGED },
      approve: { learningPlans: MANAGED },
      reject: { learningPlans: MANAGED },
    }),
    // Sessions read-only; enrolling oneself and one's teams.
    trainingSessionResource.reference().grant({
      view: { trainingSessions: ALL, trainingEnrollments: MANAGED },
      enroll: { trainingEnrollments: MANAGED, employees: MANAGED },
      checkIn: { trainingEnrollments: SELF },
    }),
    learningCoachResource
      .reference()
      .grant({ use: { employees: MANAGED, learningPlans: MANAGED } }),
    // Practice scores of one's teams, never the conversation.
    practiceResource.reference().grant({
      start: { practiceSessions: SELF },
      view: { practiceSessions: SELF },
      viewScores: { practiceSessions: MANAGED },
    }),
  )
  .build();

export const hrEmployee = definePermissionSet('hr.employee')
  .title({ key: 'permissionSets.hrEmployee', ns: 'hr' })
  .grant(
    page('talent.me'),
    page('talent.positions'),
    page('talent.framework'),
    page('talent.orgChart'),
    employeeResource
      .reference()
      .grant({ view: { employees: SELF }, viewSensitive: { employees: SELF } }),
    leaveResource.reference().grant({ request: leaveRequestParts(SELF) }),
    assessmentResource
      .reference()
      .grant({ view: { employeeCompetencies: SELF } }),
    frameworkView,
    competencyView,
    profileResource.reference().grant({
      view: { employeeEducations: SELF, employeeExperiences: SELF },
      viewContacts: {
        employeeEmergencyContacts: SELF,
        employeeAttachments: SELF,
      },
    }),
    contractResource.reference().grant({ view: { employmentContracts: SELF } }),
    profileChangeResource
      .reference()
      .grant({ request: { profileChangeRequests: SELF } }),
    jobEventResource.reference().grant({ view: { jobEvents: SELF } }),
    hrAssistantResource.reference().grant({ use: { employees: SELF } }),
    orgChartView,
    ...LEARNER_PAGES.map(page),
    documentsVisible,
    study,
    learningHistoryResource
      .reference()
      .grant({ view: { assignments: SELF, learningRecords: SELF } }),
    assistant(VISIBLE),
    takeExams,
    browseCertifications,
    certificateResource.reference().grant({
      view: { employeeCertificates: SELF },
      download: { employeeCertificates: SELF },
    }),
    ...learnerTraining,
  )
  .build();

/** Instructors write and review the content they are responsible for. */
export const hrInstructor = definePermissionSet('hr.instructor')
  .title({ key: 'permissionSets.hrInstructor', ns: 'hr' })
  .grant(
    page('talent.knowledge'),
    page('talent.courses'),
    page('talent.questions'),
    page('talent.exams'),
    kbDocumentResource.reference().grant({
      view: { kbDocuments: VISIBLE, ...documentLinks(ALL) },
      manage: { kbDocuments: OWNED, ...documentLinks(ALL) },
    }),
    knowledgeGapResource
      .reference()
      .grant({ view: { knowledgeGaps: ALL }, resolve: { knowledgeGaps: ALL } }),
    courseResource.reference().grant({
      view: { courses: OWNED, ...courseParts },
      manage: { courses: OWNED, ...courseParts },
      confirm: { courses: OWNED },
      discard: { courses: OWNED, lessons: ALL, courseCompetencies: ALL },
      publish: { courses: OWNED },
    }),
    contentWriterResource
      .reference()
      .grant({ use: { kbDocuments: VISIBLE, courses: OWNED } }),
    questionResource.reference().grant({
      view: { questions: OWNED, questionCompetencies: ALL },
      manage: { questions: OWNED, questionCompetencies: ALL },
      confirm: { questions: OWNED },
      import: { questions: OWNED, questionCompetencies: ALL },
    }),
    examResource.reference().grant({
      view: { exams: OWNED, examQuestions: ALL },
      manage: { exams: OWNED, examQuestions: ALL },
      publish: { exams: OWNED },
      grade: { exams: OWNED, examAttempts: ALL },
      resetAttempts: { exams: OWNED, examAttempts: ALL },
    }),
    browseCertifications,
    page('talent.paths'),
    page('talent.sessions'),
    page('talent.practiceScenarios'),
    learningPathResource.reference().grant({
      view: pathParts(OWNED),
      manage: pathParts(OWNED),
      publish: { learningPaths: OWNED },
    }),
    // Sessions one owns or teaches; the service checks the session for attendance and export.
    trainingSessionResource.reference().grant({
      view: { trainingSessions: OWNED, trainingEnrollments: ALL },
      manage: { trainingSessions: OWNED },
      enroll: { trainingEnrollments: ALL, employees: ALL },
      checkIn: { trainingEnrollments: SELF },
      markAttendance: { trainingEnrollments: ALL },
      export: { trainingEnrollments: ALL },
    }),
    practiceScenarioResource.reference().grant({
      view: scenarioParts(OWNED),
      manage: scenarioParts(OWNED),
      confirm: { practiceScenarios: OWNED },
    }),
    // The whole conversation of practices on one's own scenarios.
    practiceResource.reference().grant({
      start: { practiceSessions: SELF },
      view: { practiceSessions: OWNED },
    }),
    practiceCoachResource
      .reference()
      .grant({ use: { practiceScenarios: OWNED } }),
  )
  .build();

/**
 * 设备开工登记（演示）: recording a machine start on the demonstration work
 * order ("certified to operate"). Its only assignment is the certification
 * subject of CNC 岗位上岗证, made by the demo seed. The resource and action
 * keep the earlier batch record names (demo.batch / signFilling).
 */
export const cncOperator = definePermissionSet('prod.cncOperator')
  .title({ key: 'permissionSets.cncOperator', ns: 'hr' })
  .grant(
    page('demo.batchRecord'),
    demoBatchResource.reference().grant({
      view: { demoBatchSignoffs: ALL },
      signFilling: { employees: SELF, demoBatchSignoffs: ALL },
    }),
  )
  .build();

export const HR_PERMISSION_SETS = [
  hrAdmin,
  hrManager,
  hrEmployee,
  hrInstructor,
  cncOperator,
] as const;

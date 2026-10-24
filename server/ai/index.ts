import type { AIEmployeeOptions, RegisteredTool } from './contracts.js';

interface EmployeeRegistration {
  registerEmployee(employee: AIEmployeeOptions): Promise<void>;
}

interface ToolRegistration {
  registerTools(tools: RegisteredTool[]): Promise<void>;
}

import certificationSteward from './employees/certification-steward/index.js';
import contentWriter from './employees/content-writer/index.js';
// V3-10
import examiner from './employees/examiner/index.js';
import {
  explainMyResult,
  getAttemptForGrading,
  saveGradingSuggestion,
} from './tools/examiner-tools.js';
import frameworkAdvisor from './employees/framework-advisor/index.js';
import hrAssistant from './employees/hr-assistant/index.js';
// V2-06
import { PAYROLL_TOOLS, withPayrollTools } from './tools/payroll-tools.js';
// V1-03: the HR assistant reads and explains sync items in conversations.
import { SYNC_TOOLS, withSyncTools } from './tools/hr-assistant-sync-tools.js';
// V2-07
import recruitingAssistant from './employees/recruiting-assistant/index.js';
import {
  RECRUITING_TOOLS,
  withRecruitingTools,
} from './tools/recruiting-tools.js';
import knowledgeAssistant from './employees/knowledge-assistant/index.js';
import learningCoach from './employees/learning-coach/index.js';
import practiceCoach from './employees/practice-coach/index.js';
// V4-12
import performanceAssistant from './employees/performance-assistant/index.js';
import { PERFORMANCE_TOOLS } from './tools/performance-tools.js';
// V4-13
import {
  TALENT_REVIEW_TOOLS,
  withPracticalExaminerTools,
  withTalentReviewAnalystTools,
} from './tools/talent-review-tools.js';
// V4-14
import {
  LICENSED_TOOLS,
  withLicensedStewardTools,
} from './tools/licensed-tools.js';
// V3-11
import talentAnalyst from './employees/talent-analyst/index.js';
import {
  PROFILE_TOOLS,
  withAuditPackTools,
  withRecommendationTools,
  withRevisionTools,
} from './tools/profile-tools.js';
import {
  createCompetencyDrafts,
  createRequirementDrafts,
  getPositionContext,
  listCompetencyIssues,
  // V3-08
  listPositionIssues,
  searchCompetencies,
} from './tools/framework-advisor-tools.js';
import {
  createProfileSuggestion,
  getEmployeeHrSummary,
  getMyHrProfile,
  listImportIssues,
  readAttachment,
  sendHrDigest,
} from './tools/hr-assistant-tools.js';
import {
  draftSettingsChange,
  explainAccess,
  previewApprovalChain,
  submitMyProfileChange,
} from './tools/hr-assistant-change-tools.js';
import {
  draftLeaveRequest,
  getMyAttendance,
  getMyLeaveBalance,
  getMySchedule,
  listAttendanceIssues,
  listReplacementCandidates,
  saveReplacementSuggestion,
  sendAttendanceNotice,
  // V2-05 (realigned)
  askAttendanceException,
  draftMyAttendanceAdjustment,
  inviteReplacement,
} from './tools/attendance-tools.js';
import {
  createQuestionDrafts,
  getCourse,
  listCertificates,
  listQuestions,
  sendCertificationReminder,
  teamCertificationSummary,
  traceBatchSignoffs,
} from './tools/exam-tools.js';
import {
  createCourseDraft,
  getCourseContext,
  getDocument,
  listCoursesByDocument,
  recommendCourses,
  recordKnowledgeGap,
  searchKnowledge,
} from './tools/knowledge-tools.js';
import {
  createLearningPlanDraft,
  createScenarioDraft,
  getEmployeeLearningProfile,
  searchLearningContent,
  sendLearningNudge,
} from './tools/training-tools.js';

export default class AppAIResources {
  public async collect(): Promise<{
    employees: ReadonlyMap<string, AIEmployeeOptions>;
    tools: ReadonlyMap<string, RegisteredTool>;
  }> {
    const employees = new Map<string, AIEmployeeOptions>();
    const tools = new Map<string, RegisteredTool>();
    await this.registerTools({
      async registerTools(entries) {
        for (const tool of entries) {
          if (tools.has(tool.definition.name))
            throw new Error('DUPLICATE_AI_TOOL');
          tools.set(tool.definition.name, tool);
        }
      },
    });
    await this.registerAIEmployees({
      async registerEmployee(employee) {
        if (employees.has(employee.username))
          throw new Error('DUPLICATE_AI_EMPLOYEE');
        for (const tool of employee.tools ?? [])
          if (!tools.has(tool.name))
            throw new Error('EMPLOYEE_TOOL_NOT_REGISTERED');
        employees.set(employee.username, employee);
      },
    });
    return { employees, tools };
  }
  protected async registerAIEmployees(
    manager: EmployeeRegistration,
  ): Promise<void> {
    // V2-06: the HR assistant also explains payslips and checks payroll (prompt points and tools in payroll-tools.ts).
    await manager.registerEmployee(
      // V2-07: 用工测算与新员工回访 (recruiting-tools.ts).
      withRecruitingTools(withSyncTools(withPayrollTools(hrAssistant))),
    );
    await manager.registerEmployee(frameworkAdvisor);
    await manager.registerEmployee(knowledgeAssistant);
    // V3-11: the writer's version revision, the steward's audit pack, the coach's recommendation content.
    await manager.registerEmployee(withRevisionTools(contentWriter));
    // V4-14: 认证即权限、调岗资质检查与持证操作追溯 (licensed-tools.ts).
    await manager.registerEmployee(
      withLicensedStewardTools(withAuditPackTools(certificationSteward)),
    );
    await manager.registerEmployee(withRecommendationTools(learningCoach));
    await manager.registerEmployee(practiceCoach);
    // V3-10
    // V4-13: 实操辅助记录与考核表起草.
    await manager.registerEmployee(withPracticalExaminerTools(examiner));
    // V3-11
    // V4-13: 盘点预放置、继任候选推荐与风险提醒.
    await manager.registerEmployee(withTalentReviewAnalystTools(talentAnalyst));
    // V2-07
    await manager.registerEmployee(recruitingAssistant);
    // V4-12
    await manager.registerEmployee(performanceAssistant);
  }

  protected async registerTools(manager: ToolRegistration): Promise<void> {
    await manager.registerTools([
      listImportIssues,
      sendHrDigest,
      getMyHrProfile,
      getEmployeeHrSummary,
      readAttachment,
      createProfileSuggestion,
      submitMyProfileChange,
      explainAccess,
      previewApprovalChain,
      draftSettingsChange,
      getMyAttendance,
      getMySchedule,
      getMyLeaveBalance,
      draftLeaveRequest,
      listReplacementCandidates,
      saveReplacementSuggestion,
      listAttendanceIssues,
      sendAttendanceNotice,
      draftMyAttendanceAdjustment,
      askAttendanceException,
      inviteReplacement,
      getPositionContext,
      searchCompetencies,
      createCompetencyDrafts,
      createRequirementDrafts,
      listCompetencyIssues,
      // V3-08
      listPositionIssues,
      searchKnowledge,
      recordKnowledgeGap,
      recommendCourses,
      getCourseContext,
      getDocument,
      createCourseDraft,
      listCoursesByDocument,
      getCourse,
      listQuestions,
      createQuestionDrafts,
      listCertificates,
      teamCertificationSummary,
      sendCertificationReminder,
      traceBatchSignoffs,
      getEmployeeLearningProfile,
      searchLearningContent,
      createLearningPlanDraft,
      sendLearningNudge,
      createScenarioDraft,
      // V3-10
      getAttemptForGrading,
      saveGradingSuggestion,
      explainMyResult,
      // V2-06
      ...PAYROLL_TOOLS,
      // V1-03
      ...SYNC_TOOLS,
      // V3-11
      ...PROFILE_TOOLS,
      // V2-07
      ...RECRUITING_TOOLS,
      // V4-12
      ...PERFORMANCE_TOOLS,
      // V4-13
      ...TALENT_REVIEW_TOOLS,
      // V4-14
      ...LICENSED_TOOLS,
    ]);
  }
}

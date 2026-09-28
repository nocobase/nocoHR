import type { AIEmployeeManager, ToolsManager } from '@nocobase/ai-employee';
import { AIResourceRegistrar } from '@nocobase/app-plugin-ai-employee/server';

import certificationSteward from './employees/certification-steward/index.js';
import contentWriter from './employees/content-writer/index.js';
import frameworkAdvisor from './employees/framework-advisor/index.js';
import hrAssistant from './employees/hr-assistant/index.js';
import knowledgeAssistant from './employees/knowledge-assistant/index.js';
import learningCoach from './employees/learning-coach/index.js';
import practiceCoach from './employees/practice-coach/index.js';
import {
  createCompetencyDrafts,
  createRequirementDrafts,
  getPositionContext,
  listCompetencyIssues,
  searchCompetencies,
} from './tools/framework-advisor-tools.js';
import { listImportIssues, sendHrDigest } from './tools/hr-assistant-tools.js';
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

export default class AppAIResources extends AIResourceRegistrar {
  protected override async registerAIEmployees(
    manager: AIEmployeeManager,
  ): Promise<void> {
    await manager.registerEmployee(hrAssistant);
    await manager.registerEmployee(frameworkAdvisor);
    await manager.registerEmployee(knowledgeAssistant);
    await manager.registerEmployee(contentWriter);
    await manager.registerEmployee(certificationSteward);
    await manager.registerEmployee(learningCoach);
    await manager.registerEmployee(practiceCoach);
  }

  protected override async registerTools(manager: ToolsManager): Promise<void> {
    await manager.registerTools([
      listImportIssues,
      sendHrDigest,
      getPositionContext,
      searchCompetencies,
      createCompetencyDrafts,
      createRequirementDrafts,
      listCompetencyIssues,
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
    ]);
  }
}

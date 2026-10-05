import {
  createServiceToken,
  type ServiceToken,
} from '@nocobase/service-provider';

import type { OrganizationService } from './organization-service.js';
import type { TalentService } from './talent-service.js';
import type { HrCoreService } from './core-service.js';

export const leaveServiceToken: ServiceToken<
  import('./leave-service.js').LeaveService
> =
  createServiceToken<import('./leave-service.js').LeaveService>(
    'hr/leave-service',
  );

export const leaveRequestServiceToken: ServiceToken<
  import('./leave-request-service.js').LeaveRequestService
> = createServiceToken<
  import('./leave-request-service.js').LeaveRequestService
>('hr/leave-request-service');

export const attendanceSettingsToken: ServiceToken<
  import('./attendance-settings.js').AttendanceSettingsService
> = createServiceToken<
  import('./attendance-settings.js').AttendanceSettingsService
>('hr/attendance-settings');

export const scheduleServiceToken: ServiceToken<
  import('./schedule-service.js').ScheduleService
> = createServiceToken<import('./schedule-service.js').ScheduleService>(
  'hr/schedule-service',
);

export const customFieldServiceToken: ServiceToken<
  import('./custom-fields.js').CustomFieldService
> =
  createServiceToken<import('./custom-fields.js').CustomFieldService>(
    'hr/custom-fields',
  );

export const checklistServiceToken: ServiceToken<
  import('./change-checklists.js').ChecklistService
> = createServiceToken<import('./change-checklists.js').ChecklistService>(
  'hr/change-checklists',
);

export const complianceServiceToken: ServiceToken<
  import('./compliance.js').ComplianceService
> =
  createServiceToken<import('./compliance.js').ComplianceService>(
    'hr/compliance',
  );

export const settingsDraftServiceToken: ServiceToken<
  import('./settings-drafts.js').SettingsDraftService
> =
  createServiceToken<import('./settings-drafts.js').SettingsDraftService>(
    'hr/settings-drafts',
  );

export const accessExplainerToken: ServiceToken<
  import('./access-explain.js').AccessExplainer
> = createServiceToken<import('./access-explain.js').AccessExplainer>(
  'hr/access-explainer',
);

export const personnelSettingsToken: ServiceToken<
  import('./personnel-settings.js').PersonnelSettingsService
> = createServiceToken<
  import('./personnel-settings.js').PersonnelSettingsService
>('hr/personnel-settings');

export const orgSyncServiceToken: ServiceToken<
  import('./org-sync/sync-service.js').OrgSyncService
> = createServiceToken<import('./org-sync/sync-service.js').OrgSyncService>(
  'hr/org-sync-service',
);

export const positionAliasServiceToken: ServiceToken<
  import('./org-sync/alias-service.js').AliasService
> = createServiceToken<import('./org-sync/alias-service.js').AliasService>(
  'hr/position-alias-service',
);

export const aiEntryServiceToken: ServiceToken<
  import('./ai-entry-service.js').AiEntryService
> = createServiceToken<import('./ai-entry-service.js').AiEntryService>(
  'hr/ai-entry-service',
);

export const imChannelToken: ServiceToken<import('./im-channel.js').ImChannel> =
  createServiceToken<import('./im-channel.js').ImChannel>('hr/im-channel');

export const jobEventProcessorToken: ServiceToken<
  import('./job-events.js').JobEventProcessor
> = createServiceToken<import('./job-events.js').JobEventProcessor>(
  'hr/job-event-processor',
);

export const organizationServiceToken: ServiceToken<OrganizationService> =
  createServiceToken<OrganizationService>('hr/organization-service');

export const talentServiceToken: ServiceToken<TalentService> =
  createServiceToken<TalentService>('hr/talent-service');

export const hrCoreServiceToken: ServiceToken<HrCoreService> =
  createServiceToken<HrCoreService>('hr/core-service');

export const platformToken: ServiceToken<import('./platform.js').Platform> =
  createServiceToken<import('./platform.js').Platform>('hr/platform');

export const knowledgeServiceToken: ServiceToken<
  import('./knowledge-service.js').KnowledgeService
> = createServiceToken<import('./knowledge-service.js').KnowledgeService>(
  'hr/knowledge-service',
);

export const learningServiceToken: ServiceToken<
  import('./learning-service.js').LearningService
> = createServiceToken<import('./learning-service.js').LearningService>(
  'hr/learning-service',
);

export const examServiceToken: ServiceToken<
  import('./exam-service.js').ExamService
> =
  createServiceToken<import('./exam-service.js').ExamService>(
    'hr/exam-service',
  );

export const certificationServiceToken: ServiceToken<
  import('./certification-service.js').CertificationService
> = createServiceToken<
  import('./certification-service.js').CertificationService
>('hr/certification-service');

export const insightServiceToken: ServiceToken<
  import('./insight-service.js').InsightService
> =
  createServiceToken<import('./insight-service.js').InsightService>(
    'hr/insight-service',
  );

export const automationServiceToken: ServiceToken<
  import('./automation.js').AutomationService
> = createServiceToken<import('./automation.js').AutomationService>(
  'hr/automation-service',
);

export const automationTasksToken: ServiceToken<
  import('./automation-tasks.js').AutomationTasks
> = createServiceToken<import('./automation-tasks.js').AutomationTasks>(
  'hr/automation-tasks',
);

export const demoBatchServiceToken: ServiceToken<
  import('./demo-batch.js').DemoBatchService
> = createServiceToken<import('./demo-batch.js').DemoBatchService>(
  'hr/demo-batch-service',
);

export const pathServiceToken: ServiceToken<
  import('./path-service.js').PathService
> =
  createServiceToken<import('./path-service.js').PathService>(
    'hr/path-service',
  );

export const sessionServiceToken: ServiceToken<
  import('./session-service.js').SessionService
> =
  createServiceToken<import('./session-service.js').SessionService>(
    'hr/session-service',
  );

export const practiceServiceToken: ServiceToken<
  import('./practice-service.js').PracticeService
> = createServiceToken<import('./practice-service.js').PracticeService>(
  'hr/practice-service',
);

export const planServiceToken: ServiceToken<
  import('./plan-service.js').PlanService
> =
  createServiceToken<import('./plan-service.js').PlanService>(
    'hr/plan-service',
  );

// V2-05 考勤闭环.
export const attendanceEngineToken: ServiceToken<
  import('./attendance-engine.js').AttendanceEngine
> = createServiceToken<import('./attendance-engine.js').AttendanceEngine>(
  'hr/attendance-engine',
);
export const attendanceServiceToken: ServiceToken<
  import('./attendance-service.js').AttendanceService
> = createServiceToken<import('./attendance-service.js').AttendanceService>(
  'hr/attendance-service',
);
export const adjustmentServiceToken: ServiceToken<
  import('./adjustment-service.js').AdjustmentService
> = createServiceToken<import('./adjustment-service.js').AdjustmentService>(
  'hr/adjustment-service',
);

// V3-09 学习与培训: the administrator-adjustable learning rules and the job-event learning rules.
export const learningSettingsToken: ServiceToken<
  import('./learning-settings.js').LearningSettingsService
> = createServiceToken<
  import('./learning-settings.js').LearningSettingsService
>('hr/learning-settings');
export const learningJobEventsToken: ServiceToken<
  import('./learning-job-events.js').LearningJobEvents
> = createServiceToken<import('./learning-job-events.js').LearningJobEvents>(
  'hr/learning-job-events',
);

// V3-08 能力体系: gaps, development targets, assessment to-dos and import, job descriptions.
export const competencyServiceToken: ServiceToken<
  import('./competency-service.js').CompetencyService
> = createServiceToken<import('./competency-service.js').CompetencyService>(
  'hr/competency-service',
);

// V3-10 考试与认证: the exam → competency rule and the industry pack switch, adjustable by administrators.
export const examSettingsToken: ServiceToken<
  import('./exam-settings.js').ExamSettingsService
> =
  createServiceToken<import('./exam-settings.js').ExamSettingsService>(
    'hr/exam-settings',
  );

// V2-06 薪酬与社保.
export const payrollServicesToken: ServiceToken<
  import('./payroll/index.js').PayrollServices
> = createServiceToken<import('./payroll/index.js').PayrollServices>(
  'hr/payroll-services',
);

// V3-11 画像、联动与内容维护: business data, the talent analyst's suggestions, profiles, audit exports, revisions.
export const profileServicesToken: ServiceToken<
  import('./profile/index.js').ProfileServices
> = createServiceToken<import('./profile/index.js').ProfileServices>(
  'hr/profile-services',
);
export const revisionServiceToken: ServiceToken<
  import('./revision-service.js').RevisionService
> = createServiceToken<import('./revision-service.js').RevisionService>(
  'hr/revision-service',
);
// V3-11 end

// V2-07 用工计划与招聘入职.
export const recruitingServicesToken: ServiceToken<
  import('./recruiting/index.js').RecruitingServices
> = createServiceToken<import('./recruiting/index.js').RecruitingServices>(
  'hr/recruiting-services',
);
// V2-07 end

// V4-12 绩效.
export const performanceServicesToken: ServiceToken<
  import('./performance/index.js').PerformanceServices
> = createServiceToken<import('./performance/index.js').PerformanceServices>(
  'hr/performance-services',
);
// V4-12 end
// V4-13 人才盘点与其他.
export const talentReviewServicesToken: ServiceToken<
  import('./talent-review/index.js').TalentReviewServices
> = createServiceToken<import('./talent-review/index.js').TalentReviewServices>(
  'hr/talent-review-services',
);
// V4-13 end
// V4-14 行业方案 · 持证上岗.
export const licensedServicesToken: ServiceToken<
  import('./licensed/index.js').LicensedServices
> = createServiceToken<import('./licensed/index.js').LicensedServices>(
  'hr/licensed-services',
);
// V4-14 end
// V2-06 邮件往来 (总纲 邮件约定).
export const mailSettingsToken: ServiceToken<
  import('./mail/settings.js').MailSettingsService
> = createServiceToken<import('./mail/settings.js').MailSettingsService>(
  'hr/mail-settings',
);
export const mailServiceToken: ServiceToken<
  import('./mail/service.js').MailService
> = createServiceToken<import('./mail/service.js').MailService>(
  'hr/mail-service',
);
export const recruitingMailToken: ServiceToken<
  import('./mail/recruiting.js').RecruitingMailHandler
> = createServiceToken<import('./mail/recruiting.js').RecruitingMailHandler>(
  'hr/mail-recruiting',
);
export const billingMailToken: ServiceToken<
  import('./mail/billing.js').BillingMailHandler
> = createServiceToken<import('./mail/billing.js').BillingMailHandler>(
  'hr/mail-billing',
);
// V2-06 邮件往来 end

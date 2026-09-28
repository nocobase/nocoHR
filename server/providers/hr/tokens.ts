import {
  createServiceToken,
  type ServiceToken,
} from '@nocobase/service-provider';

import type { OrganizationService } from './organization-service.js';
import type { TalentService } from './talent-service.js';
import type { HrCoreService } from './core-service.js';

export const personnelSettingsToken: ServiceToken<
  import('./personnel-settings.js').PersonnelSettingsService
> = createServiceToken<
  import('./personnel-settings.js').PersonnelSettingsService
>('hr/personnel-settings');

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

import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { automationApiRoutes } from './hr/automations.js';
import { workbenchRoutes } from './hr/workbench.js';
import { personnelSettingsRoutes } from './hr/personnel-settings.js';
import { examApiRoutes } from './hr/exams.js';
import { hrFileRoutes } from './hr/files.js';
import { insightApiRoutes } from './hr/insights.js';
import { learningApiRoutes } from './hr/learning.js';
import { organizationApiRoutes } from './hr/organization.js';
import { talentApiRoutes } from './hr/talent.js';
import { trainingApiRoutes } from './hr/training.js';

const routes: readonly AppRouteContribution<Application>[] = [
  workbenchRoutes,
  personnelSettingsRoutes,
  organizationApiRoutes,
  talentApiRoutes,
  learningApiRoutes,
  examApiRoutes,
  trainingApiRoutes,
  insightApiRoutes,
  automationApiRoutes,
  ...hrFileRoutes,
];

export default routes;

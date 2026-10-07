import type { Application } from '@nocobase/app-server/application';
import type { AppRouteContribution } from '@nocobase/app-server/router';

import { automationApiRoutes } from './hr/automations.js';
import { workbenchRoutes } from './hr/workbench.js';
import { customFieldRoutes } from './hr/custom-fields.js';
import { changeChecklistRoutes } from './hr/change-checklists.js';
import { personnelSettingsRoutes } from './hr/personnel-settings.js';
import { attendanceSettingsRoutes } from './hr/attendance-settings.js';
import { leaveRoutes } from './hr/leave.js';
import { scheduleRoutes } from './hr/schedules.js';
import { attendanceRoutes } from './hr/attendance.js';
import { examApiRoutes } from './hr/exams.js';
import { hrFileRoutes } from './hr/files.js';
import { leaveProofRoutes } from './hr/leave-proofs.js';
// V3-10
import { certificateScanRoutes } from './hr/certificate-scans.js';
import { insightApiRoutes } from './hr/insights.js';
import { learningApiRoutes } from './hr/learning.js';
import { organizationApiRoutes } from './hr/organization.js';
import { orgSyncRoutes } from './hr/org-sync.js';
import { aiEntryRoutes } from './hr/ai-entry.js';
import { talentApiRoutes } from './hr/talent.js';
import { trainingApiRoutes } from './hr/training.js';
// V2-06
import { payrollRoutes } from './hr/payroll.js';
import { auditRequestRoutes } from './hr/audit-requests.js';
import { mailRoutes } from './hr/mail.js';
import { departedRoutes } from './hr/departed.js';
// V3-08
import { competencyApiRoutes } from './hr/competency.js';
// V3-11
import { profileApiRoutes } from './hr/profile.js';
// V2-07
import { recruitingRoutes } from './hr/recruiting.js';
// V4-12
import { performanceRoutes } from './hr/performance.js';
// V4-13
import { talentReviewRoutes } from './hr/talent-review.js';
import { agentMcpRoutes } from './hr/agent-mcp.js';
// V4-14
import { licensedRoutes } from './hr/licensed.js';
// 上线准备: the go-live checklist and bulk account activation.
import { goLiveRoutes } from './hr/go-live.js';
// 初始数据导入 (上线准备)
import { dataImportRoutes } from './hr/data-import.js';
import { apiNotFoundRoutes } from './hr/not-found.js';

const routes: readonly AppRouteContribution<Application>[] = [
  // V4-13: the MCP endpoint authenticates its own bearer tokens, so it comes before routers guarding /talent/*.
  agentMcpRoutes,
  workbenchRoutes,
  customFieldRoutes,
  changeChecklistRoutes,
  personnelSettingsRoutes,
  attendanceSettingsRoutes,
  leaveRoutes,
  scheduleRoutes,
  attendanceRoutes,
  // V2-06
  payrollRoutes,
  mailRoutes,
  departedRoutes,
  // V3-11 客户审核问询
  auditRequestRoutes,
  // V2-07
  recruitingRoutes,
  organizationApiRoutes,
  orgSyncRoutes,
  aiEntryRoutes,
  talentApiRoutes,
  // V3-08
  competencyApiRoutes,
  learningApiRoutes,
  examApiRoutes,
  trainingApiRoutes,
  insightApiRoutes,
  // V3-11
  profileApiRoutes,
  // V4-12
  performanceRoutes,
  // V4-13
  talentReviewRoutes,
  // V4-14
  licensedRoutes,
  // 上线准备
  goLiveRoutes,
  automationApiRoutes,
  // 初始数据导入 (上线准备)
  dataImportRoutes,
  ...hrFileRoutes,
  ...leaveProofRoutes,
  // V3-10
  ...certificateScanRoutes,
  // Last: an unknown /api/talent, /api/public or /api/demo path is a JSON 404, not the client's index.html.
  apiNotFoundRoutes,
];

export default routes;
